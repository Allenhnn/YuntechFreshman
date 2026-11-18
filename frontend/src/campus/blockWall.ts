import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
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
import type { CampusData, CampusRoad } from './campusTypes';
import { SIDEWALK_W, isLongtanMain } from './longtanConst';
import { SCOOTER_LOTS } from './scooterLots';

/**
 * The ~2 m grey concrete breeze-block wall (鏤空花磚圍牆) seen on Street View along the campus's west
 * side and along the north side of 龍潭路's west stretch: a solid plinth, a perforated block screen,
 * square pilasters every 3 m and a coping on top.
 *
 * - West side: replaces the iron boundary fence on the long west boundary edge (the invisible
 *   boundary wall is the collision there).
 * - 龍潭路 west, north side: just behind the raised sidewalk (the sidewalk and its street trees are
 *   untouched), solid, with gaps wherever a road or walkway leads into campus; where the roadside
 *   scooter bays (機車停車格（龍潭路）) stand behind the sidewalk, the wall steps back behind them.
 */
const H = 2;
const PLINTH = 0.45;
const COPING = 0.1;
const T = 0.2; // screen thickness
const PIER = 0.34;
const PIER_STEP = 3;
const BLOCK = 0.4; // one breeze block, m
const STEP = 0.5; // sampling along the wall line
const NORTH_GAP_PAD = 1.2; // clearance either side of a road / walkway crossing the wall
const FENCE_OFFSET = 0.25; // same line as the boundary fence it replaces

type Pt = [number, number];

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function inRing(x: number, z: number, r: readonly number[]): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
function ringDist(x: number, z: number, r: readonly number[]): number {
  let d = Infinity;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) d = Math.min(d, segDist(x, z, r[j * 2]!, r[j * 2 + 1]!, r[i * 2]!, r[i * 2 + 1]!));
  return d;
}

/** The long west boundary edge (both ends west of x = −415, running north–south for > 150 m). */
function westEdge(campus: CampusData): [Pt, Pt] | null {
  const r = campus.boundary, n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2]!, az = r[i * 2 + 1]!, bx = r[j * 2]!, bz = r[j * 2 + 1]!;
    if (ax < -415 && bx < -415 && Math.abs(bz - az) > 150) {
      const len = Math.hypot(bx - ax, bz - az), ox = (bz - az) / len, oz = -(bx - ax) / len; // outward (CCW ring)
      return [[ax + ox * FENCE_OFFSET, az + oz * FENCE_OFFSET], [bx + ox * FENCE_OFFSET, bz + oz * FENCE_OFFSET]];
    }
  }
  return null;
}

/** True on the stretch of boundary where the block wall stands instead of the iron fence. */
export function createBlockWallZone(campus: CampusData): (x: number, z: number) => boolean {
  const e = westEdge(campus);
  if (!e) return () => false;
  return (x, z) => segDist(x, z, e[0][0], e[0][1], e[1][0], e[1][1]) < 1;
}

/** 龍潭路's west stretch (from the N–S branch at x ≈ −129 westward). */
function longtanWest(campus: CampusData): CampusRoad | undefined {
  return campus.roads.find((r) => isLongtanMain(r) && r.points[0]! < -120 && r.points[0]! > -140 && r.points[2]! < r.points[0]!);
}

/** Runs of wall line north of 龍潭路 west, clipped to campus and broken at crossings. */
function northRuns(campus: CampusData, road: CampusRoad): Pt[][] {
  const p = road.points, off = road.width / 2 + SIDEWALK_W + 0.5;
  const crossers = campus.roads.filter((r) => r !== road && !isLongtanMain(r));
  const blocked = (x: number, z: number): boolean =>
    !inRing(x, z, campus.boundary) || ringDist(x, z, campus.boundary) < 0.8 ||
    crossers.some((r) => {
      const q = r.points;
      for (let i = 0; i + 3 < q.length; i += 2) if (segDist(x, z, q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!) < r.width / 2 + NORTH_GAP_PAD) return true;
      return false;
    }) ||
    campus.buildings.some((b) => b.inCampus && inRing(x, z, b.outer));
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  const flush = (): void => {
    if (run.length >= 3) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    let nx = -uz, nz = ux;
    if (nz > 0) { nx = -nx; nz = -nz; } // north = −z
    // Corner joins: offset each vertex along the averaged normal of the segments meeting there.
    const steps = Math.max(1, Math.ceil(len / STEP));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = (len * k) / steps;
      let mx = nx, mz = nz;
      if (k === steps && i + 5 < p.length) {
        const cx = p[i + 4]!, cz = p[i + 5]!, l2 = Math.hypot(cx - bx, cz - bz) || 1;
        let n2x = -(cz - bz) / l2, n2z = (cx - bx) / l2;
        if (n2z > 0) { n2x = -n2x; n2z = -n2z; }
        const ax2 = nx + n2x, az2 = nz + n2z, l = Math.hypot(ax2, az2) || 1, cos = (ax2 / l) * nx + (az2 / l) * nz;
        mx = ax2 / l / Math.max(cos, 0.5);
        mz = az2 / l / Math.max(cos, 0.5);
      }
      let o = off, x = ax + ux * t + mx * o, z = az + uz * t + mz * o;
      while (o < off + 10 && SCOOTER_LOTS.some((l) => inRing(x, z, l.ring) || ringDist(x, z, l.ring) < 0.5)) {
        o += 0.25;
        x = ax + ux * t + mx * o;
        z = az + uz * t + mz * o;
      }
      if (blocked(x, z)) flush();
      else run.push([x, z]);
    }
  }
  flush();
  return runs;
}

/** Breeze-block screen: grey blocks, each with a four-petal cut-out (transparent, alpha-tested). */
function screenTexture(tracker: ResourceTracker): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#a9a8a2';
    g.fillRect(0, 0, S, S);
    // mortar joints
    g.fillStyle = '#8f8e88';
    g.fillRect(0, 0, S, 4);
    g.fillRect(0, 0, 4, S);
    g.globalCompositeOperation = 'destination-out';
    const m = S / 2;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.beginPath();
      g.ellipse(m + dx * 22, m + dy * 22, 17, 17, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.ellipse(m, m, 9, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // a little shading on the hole rims so the screen reads as thick
    g.strokeStyle = 'rgba(70,70,66,0.55)';
    g.lineWidth = 3;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.beginPath();
      g.ellipse(m + dx * 22, m + dy * 22, 18, 18, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function createBlockWalls(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): { dispose(): void } {
  const lines: { pts: Pt[]; solid: boolean }[] = [];
  const west = westEdge(campus);
  if (west) {
    const [[ax, az], [bx, bz]] = west;
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / STEP);
    const pts: Pt[] = [];
    for (let k = 0; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    lines.push({ pts, solid: false });
  }
  const road = longtanWest(campus);
  if (road) for (const pts of northRuns(campus, road)) lines.push({ pts, solid: true });

  const sPos: number[] = [], sUv: number[] = [];
  const cPos: number[] = [], cNrm: number[] = [];
  const colliders: RAPIER.Collider[] = [];
  const up = new Vector3(0, 1, 0), q = new Quaternion();

  /** Axis-aligned-in-local box from a to b (centre line), half thickness ht, y0..y1. */
  const box = (ax: number, az: number, bx: number, bz: number, ht: number, y0: number, y1: number): void => {
    const len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
    const P = (t: number, s: number, y: number): number[] => [ax + ux * t + nx * s, y, az + uz * t + nz * s];
    const face = (a: number[], b: number[], c: number[], d: number[], n: number[]): void => {
      for (const v of [a, b, c, a, c, d]) { cPos.push(v[0]!, v[1]!, v[2]!); cNrm.push(n[0]!, n[1]!, n[2]!); }
    };
    face(P(0, -ht, y0), P(len, -ht, y0), P(len, -ht, y1), P(0, -ht, y1), [-nx, 0, -nz]);
    face(P(len, ht, y0), P(0, ht, y0), P(0, ht, y1), P(len, ht, y1), [nx, 0, nz]);
    face(P(0, ht, y1), P(0, -ht, y1), P(len, -ht, y1), P(len, ht, y1), [0, 1, 0]);
    face(P(0, ht, y0), P(0, -ht, y0), P(0, -ht, y1), P(0, ht, y1), [-ux, 0, -uz]);
    face(P(len, -ht, y0), P(len, ht, y0), P(len, ht, y1), P(len, -ht, y1), [ux, 0, uz]);
  };

  for (const { pts, solid } of lines) {
    let along = 0, nextPier = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      // plinth + coping (solid boxes), screen (one double-sided quad on the centre line)
      box(ax, az, bx, bz, T / 2 + 0.03, 0, PLINTH);
      box(ax, az, bx, bz, T / 2 + 0.05, H - COPING, H);
      const v0 = along / BLOCK, v1 = (along + len) / BLOCK, h = (H - COPING - PLINTH) / BLOCK;
      for (const [x, y, z, u, v] of [
        [ax, PLINTH, az, v0, 0], [bx, PLINTH, bz, v1, 0], [bx, H - COPING, bz, v1, h],
        [ax, PLINTH, az, v0, 0], [bx, H - COPING, bz, v1, h], [ax, H - COPING, az, v0, h],
      ] as const) { sPos.push(x, y, z); sUv.push(u, v); }
      while (nextPier <= along + len) {
        const t = nextPier - along, ux = (bx - ax) / len, uz = (bz - az) / len;
        const cx = ax + ux * t, cz = az + uz * t;
        box(cx - ux * PIER / 2, cz - uz * PIER / 2, cx + ux * PIER / 2, cz + uz * PIER / 2, PIER / 2, 0, H + 0.06);
        nextPier += PIER_STEP;
      }
      along += len;
    }
    // closing pier at the run's end
    const [ex, ez] = pts[pts.length - 1]!, [px, pz] = pts[pts.length - 2]!;
    const l = Math.hypot(ex - px, ez - pz) || 1, ux = (ex - px) / l, uz = (ez - pz) / l;
    box(ex - ux * PIER / 2, ez - uz * PIER / 2, ex + ux * PIER / 2, ez + uz * PIER / 2, PIER / 2, 0, H + 0.06);
    if (solid) {
      // one cuboid per ~6 m of line, so curved runs stay tight
      let s = 0;
      while (s < pts.length - 1) {
        // stop a chunk at a step-back (a jump between samples), which gets a cuboid of its own
        const jump = (k: number): boolean => Math.hypot(pts[k + 1]![0] - pts[k]![0], pts[k + 1]![1] - pts[k]![1]) > STEP * 1.5;
        let e = s + 1;
        if (!jump(s)) while (e < pts.length - 1 && e < s + 12 && !jump(e)) e++;
        const [x0, z0] = pts[s]!, [x1, z1] = pts[e]!;
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len > 0.05) {
          q.setFromAxisAngle(up, Math.atan2(-(z1 - z0), x1 - x0));
          colliders.push(tracker.collider(physics.createCollider(
            RAPIER.ColliderDesc.cuboid(len / 2 + PIER / 2, H / 2, PIER / 2).setTranslation((x0 + x1) / 2, H / 2, (z0 + z1) / 2).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
          )));
        }
        s = e;
      }
    }
  }

  const meshes: Mesh[] = [];
  if (cPos.length) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(cPos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(cNrm), 3));
    const m = new Mesh(tracker.geometry(geo), tracker.material(new MeshStandardMaterial({ color: 0x9f9e98, roughness: 0.95 })));
    m.castShadow = m.receiveShadow = true;
    meshes.push(m);
  }
  if (sPos.length) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(sPos), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(sUv), 2));
    geo.computeVertexNormals();
    const m = new Mesh(tracker.geometry(geo), tracker.material(new MeshStandardMaterial({ map: screenTexture(tracker), alphaTest: 0.5, side: DoubleSide, roughness: 0.95 })));
    m.receiveShadow = true;
    meshes.push(m);
  }
  for (const m of meshes) {
    m.name = 'block wall';
    scene.add(m);
  }
  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const m of meshes) m.removeFromParent();
    },
  };
}
