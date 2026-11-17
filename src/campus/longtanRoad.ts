import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, CampusRoad, Ring } from './campusTypes';
import { KERB_H, SIDEWALK_W, isLongtanMain } from './longtanConst';

/**
 * 龍潭路's raised sidewalks: a paved strip on both sides, a kerb step up from the carriageway.
 * The strip breaks wherever another vehicle road joins or crosses, or a building stands.
 * (The street trees that line it are scattered with the other trees, in chunkBuilder.)
 */
const PIECE = 2;

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const nearRoad = (x: number, z: number, roads: readonly CampusRoad[], pad: number): boolean => roads.some((r) => {
  const p = r.points;
  for (let i = 0; i + 3 < p.length; i += 2) if (segDist(x, z, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) < r.width / 2 + pad) return true;
  return false;
});

/** The 龍潭路 polylines on (or along) campus. */
export function longtanRoads(campus: CampusData): CampusRoad[] {
  const { minX, maxX, minZ, maxZ } = campus.bounds;
  return campus.roads.filter((r) => isLongtanMain(r) && r.points.some((v, i) => (i % 2 ? v > minZ && v < maxZ : v > minX && v < maxX)));
}

export function createLongtanSidewalks(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): { dispose(): void } {
  const mine = longtanRoads(campus);
  const others = campus.roads.filter((r) => r.kind !== 'walkway' && !mine.includes(r));
  const buildings = campus.buildings.filter((b) => b.inCampus).map((b) => b.outer);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const colliders: RAPIER.Collider[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]): void => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0]!, v[1]!, v[2]!);
      nrm.push(n[0]!, n[1]!, n[2]!);
      uv.push((v[0]! + v[2]!) / 1.5, v[1]! / 1.5);
    }
  };
  const up = new Vector3(0, 1, 0), q = new Quaternion();

  for (const road of mine) {
    const p = road.points, hw = road.width / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (const side of [-1, 1]) {
        const nx = -uz * side, nz = ux * side; // outward
        const n = Math.max(1, Math.round(len / PIECE));
        let run: [number, number] | null = null;
        const flush = (): void => {
          if (!run) return;
          const [t0, t1] = run;
          // Top, kerb face toward the road, outer face.
          const P = (t: number, off: number, y: number): number[] => [ax + ux * t + nx * off, y, az + uz * t + nz * off];
          const i0 = hw, i1 = hw + SIDEWALK_W;
          quad(P(t0, i0, KERB_H), P(t1, i0, KERB_H), P(t1, i1, KERB_H), P(t0, i1, KERB_H), [0, 1, 0]);
          quad(P(t0, i0, 0), P(t1, i0, 0), P(t1, i0, KERB_H), P(t0, i0, KERB_H), [-nx, 0, -nz]);
          quad(P(t0, i1, 0), P(t1, i1, 0), P(t1, i1, KERB_H), P(t0, i1, KERB_H), [nx, 0, nz]);
          const tm = (t0 + t1) / 2, cx = ax + ux * tm + nx * (hw + SIDEWALK_W / 2), cz = az + uz * tm + nz * (hw + SIDEWALK_W / 2);
          q.setFromAxisAngle(up, Math.atan2(-uz, ux));
          colliders.push(tracker.collider(physics.createCollider(
            RAPIER.ColliderDesc.cuboid((t1 - t0) / 2, KERB_H / 2, SIDEWALK_W / 2).setTranslation(cx, KERB_H / 2, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
          )));
          run = null;
        };
        for (let k = 0; k < n; k++) {
          const t0 = (k / n) * len, t1 = ((k + 1) / n) * len, tm = (t0 + t1) / 2;
          const x = ax + ux * tm + nx * (hw + SIDEWALK_W / 2), z = az + uz * tm + nz * (hw + SIDEWALK_W / 2);
          const blocked = nearRoad(x, z, others, SIDEWALK_W / 2 + 0.3) || buildings.some((r) => pointInRing(x, z, r));
          if (blocked) { flush(); continue; }
          if (run) run[1] = t1;
          else run = [t0, t1];
        }
        flush();
      }
    }
  }

  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#b9b2a6';
    g.fillRect(0, 0, 128, 128);
    const tones = ['#c9c1b3', '#a99f92', '#bdb5a8', '#9d9488'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = tones[(x * 3 + y * 5) % tones.length]!;
      g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  }
  const tex = tracker.texture(new CanvasTexture(c));
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const mesh = new Mesh(tracker.geometry(geo), tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.9, side: DoubleSide })));
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    dispose() {
      for (const col of colliders) physics.removeCollider(col, false);
      mesh.removeFromParent();
    },
  };
}
