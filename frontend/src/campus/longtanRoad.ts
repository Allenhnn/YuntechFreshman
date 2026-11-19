import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, CampusRoad, Ring } from './campusTypes';
import { KERB_H, SIDEWALK_W, isLongtanMain } from './longtanConst';

/**
 * 龍潭路's raised sidewalks: a paved strip on both sides, a kerb step up from the carriageway.
 * The strip breaks wherever another vehicle road joins or crosses, or a building stands.
 * East of the 技職大樓 junction the road is divided (road.median): a raised planted median runs down
 * the middle, kerbed in concrete, grassed and filled with low clumps of shrubs, breaking for
 * junctions and crossings. (The street trees, including the median row, are scattered with the
 * other trees, in chunkBuilder.)
 */
const MEDIAN_H = 0.2;
const CLUMP_STEP = 1.1;
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

  // Planted median: kerb sides + grass top (one mesh), shrub clumps (another).
  const walks = campus.roads.filter((r) => r.kind === 'walkway');
  const mPos: number[] = [], mNrm: number[] = [], mCol: number[] = [];
  const GRASS = [0.36, 0.5, 0.26], KERB = [0.72, 0.7, 0.66];
  const mQuad = (a: number[], b: number[], c: number[], d: number[], n: number[], col: number[]): void => {
    for (const v of [a, b, c, a, c, d]) {
      mPos.push(v[0]!, v[1]!, v[2]!);
      mNrm.push(n[0]!, n[1]!, n[2]!);
      mCol.push(col[0]!, col[1]!, col[2]!);
    }
  };
  const clumps: BufferGeometry[] = [];
  const clumpBase = new IcosahedronGeometry(0.3, 0);
  const posts: BufferGeometry[] = [];
  const postBase = new CylinderGeometry(0.055, 0.07, 0.75, 8).translate(0, 0.375, 0);
  for (const road of mine) {
    if (!road.median) continue;
    const p = road.points, hm = road.median / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
      const n = Math.max(1, Math.round(len / PIECE));
      let run: [number, number] | null = null;
      const flush = (): void => {
        if (!run) return;
        const [t0, t1] = run;
        run = null;
        if (t1 - t0 < 1.5) return;
        const P = (t: number, off: number, y: number): number[] => [ax + ux * t + nx * off, y, az + uz * t + nz * off];
        mQuad(P(t0, -hm, MEDIAN_H), P(t1, -hm, MEDIAN_H), P(t1, hm, MEDIAN_H), P(t0, hm, MEDIAN_H), [0, 1, 0], GRASS);
        mQuad(P(t0, -hm, 0), P(t1, -hm, 0), P(t1, -hm, MEDIAN_H), P(t0, -hm, MEDIAN_H), [-nx, 0, -nz], KERB);
        mQuad(P(t0, hm, 0), P(t1, hm, 0), P(t1, hm, MEDIAN_H), P(t0, hm, MEDIAN_H), [nx, 0, nz], KERB);
        mQuad(P(t0, -hm, 0), P(t0, hm, 0), P(t0, hm, MEDIAN_H), P(t0, -hm, MEDIAN_H), [-ux, 0, -uz], KERB);
        mQuad(P(t1, -hm, 0), P(t1, hm, 0), P(t1, hm, MEDIAN_H), P(t1, -hm, MEDIAN_H), [ux, 0, uz], KERB);
        // Kerb top rim, slightly lighter, so the edge reads from the road.
        for (const side of [-1, 1]) mQuad(P(t0, side * hm, MEDIAN_H + 0.005), P(t1, side * hm, MEDIAN_H + 0.005), P(t1, side * (hm - 0.15), MEDIAN_H + 0.005), P(t0, side * (hm - 0.15), MEDIAN_H + 0.005), [0, 1, 0], KERB);
        const tm = (t0 + t1) / 2, cx = ax + ux * tm, cz = az + uz * tm;
        q.setFromAxisAngle(up, Math.atan2(-uz, ux));
        colliders.push(tracker.collider(physics.createCollider(
          RAPIER.ColliderDesc.cuboid((t1 - t0) / 2, MEDIAN_H / 2, hm).setTranslation(cx, MEDIAN_H / 2, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        )));
        // Flexible yellow bollards guarding each nose of the median.
        for (const [t, dir] of [[t0, -1], [t1, 1]] as const) {
          for (const o of [-hm * 0.5, 0, hm * 0.5]) {
            const g = postBase.clone();
            g.translate(ax + ux * (t + dir * 0.5) + nx * o, 0, az + uz * (t + dir * 0.5) + nz * o);
            posts.push(g);
          }
        }
        // Shrubs: two staggered rows of low clumps.
        for (let t = t0 + 0.6; t < t1 - 0.5; t += CLUMP_STEP) {
          for (const side of [-1, 1]) {
            const h = Math.abs(Math.sin(ax * 3.1 + az * 1.7 + t * 12.9898 + side * 4.2)) % 1;
            const off = side * (hm * 0.42) + (h - 0.5) * 0.2;
            const g = clumpBase.clone();
            const sc = 0.85 + h * 0.4;
            g.scale(sc * 1.1, sc * (0.6 + h * 0.3), sc * 1.1);
            g.rotateY(h * 6.28);
            g.translate(ax + ux * (t + side * 0.3) + nx * off, MEDIAN_H + 0.1, az + uz * (t + side * 0.3) + nz * off);
            clumps.push(g);
          }
        }
      };
      for (let k = 0; k < n; k++) {
        const t0 = (k / n) * len, t1 = ((k + 1) / n) * len, tm = (t0 + t1) / 2;
        const x = ax + ux * tm, z = az + uz * tm;
        const blocked = nearRoad(x, z, others, 1.5) || walks.some((w) => {
          const q2 = w.points;
          for (let j = 0; j + 3 < q2.length; j += 2) {
            // Only paths that cross the road, not ones running along it.
            const dx = q2[j + 2]! - q2[j]!, dz = q2[j + 3]! - q2[j + 1]!, l = Math.hypot(dx, dz) || 1;
            if (Math.abs((dx * ux + dz * uz) / l) > 0.8) continue;
            if (segDist(x, z, q2[j]!, q2[j + 1]!, q2[j + 2]!, q2[j + 3]!) < w.width / 2 + 1) return true;
          }
          return false;
        });
        if (blocked) { flush(); continue; }
        if (run) run[1] = t1;
        else run = [t0, t1];
      }
      flush();
    }
  }
  clumpBase.dispose();
  postBase.dispose();
  const postMeshes: Mesh[] = [];
  if (posts.length) {
    const pg = mergeGeometries(posts);
    for (const g of posts) g.dispose();
    if (pg) postMeshes.push(new Mesh(tracker.geometry(pg), tracker.material(new MeshStandardMaterial({ color: 0xf2b51b, roughness: 0.6 }))));
  }
  const medianMeshes: Mesh[] = [];
  if (mPos.length) {
    const mg = new BufferGeometry();
    mg.setAttribute('position', new Float32BufferAttribute(mPos, 3));
    mg.setAttribute('normal', new Float32BufferAttribute(mNrm, 3));
    mg.setAttribute('color', new Float32BufferAttribute(mCol, 3));
    const m = new Mesh(tracker.geometry(mg), tracker.material(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide })));
    m.receiveShadow = true;
    medianMeshes.push(m);
  }
  if (clumps.length) {
    const cg = mergeGeometries(clumps.map((g) => g.toNonIndexed()));
    for (const g of clumps) g.dispose();
    if (cg) {
      cg.computeVertexNormals();
      const m = new Mesh(tracker.geometry(cg), tracker.material(new MeshStandardMaterial({ color: 0x4b7d34, roughness: 0.9, flatShading: true })));
      m.castShadow = true;
      m.receiveShadow = true;
      medianMeshes.push(m);
    }
  }
  medianMeshes.push(...postMeshes);
  for (const m of medianMeshes) scene.add(m);

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
      for (const m of medianMeshes) m.removeFromParent();
    },
  };
}
