import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, Ring } from './campusTypes';

/**
 * Dorm area layout from the user's marked map (2026-11-20) and Street View:
 *  - 前門 / 後門 (red): every dorm group closes the gap between two wings with a white wall and a
 *    gate in the middle — two pillars carrying a small red-tile roof, the iron sliding gate pushed
 *    open, a card reader, and red-and-grey pavers running through (Street View: 學生宿舍 gate).
 *    The wall ends are found at run time by probing from the marked centre to each wing's wall.
 *  - 腳踏車停放區 (blue lines): rows of parked bikes along the dorm roads and the south edge.
 *  - 腳踏車車棚 (blue boxes): open bike sheds with a green roof and two rows of bikes inside.
 * Marks were read off the minimap (4.5975 px / m) and converted to campus metres.
 */
interface GateMark {
  name: string;
  /** Marked bar in the gap, along the way through: two ends in campus metres. */
  a: [number, number];
  b: [number, number];
}

export const DORM_GATES: readonly GateMark[] = [
  { name: '學生宿舍C 後門', a: [-52.0, 341.5], b: [-28.1, 331.7] },
  { name: '學生宿舍C 前門', a: [1.8, 327.5], b: [27.9, 319.9] },
  { name: '學生宿舍B 前門', a: [38.3, 319.9], b: [62.2, 313.4] },
  { name: '學生宿舍B 後門', a: [92.7, 311.2], b: [117.7, 303.6] },
  { name: '學生宿舍A 前門', a: [143.8, 296.0], b: [164.5, 289.5] },
  { name: '學生宿舍A 後門', a: [211.2, 286.2], b: [231.9, 279.6] },
  { name: '學生宿舍D 後門', a: [-36.7, 412.3], b: [-12.8, 406.9] },
  { name: '學生宿舍D 前門', a: [6.8, 403.7], b: [32.9, 397.2] },
  { name: '學生宿舍E.F 前門', a: [54.6, 397.2], b: [80.7, 388.5] },
  { name: '學生宿舍E.F 後門', a: [97.0, 388.3], b: [118.7, 380.6] },
];

/** Bike parking rows (polylines). */
const BIKE_ROWS: readonly (readonly number[])[] = [
  [30.3, 330.8, 32.9, 349.3],
  [41.6, 327.1, 45.3, 346.5],
  [49.2, 369.9, 53.6, 385.6],
  [56.8, 406.5, 59.0, 413.9],
  [-18.6, 442.2, 1.4, 438.5, 25.3, 436.3],
  [66.6, 432.6, 97.1, 427.6, 131.9, 421.7],
];

/** Bike sheds: four corners each. */
const SHEDS: readonly Ring[] = [
  [9.0, 293.8, 23.1, 292.3, 24.4, 311.7, 11.4, 313.4],
  [27.0, 411.7, 39.4, 409.5, 44.4, 431.3, 32.5, 433.5],
];

/**
 * Rideable vehicles in the dorm bike parking (the parked rows are scenery): one bike just before the
 * start of each row, one beside the north shed, and the dorm scooter by the road next to the new-player
 * start (faster than a bike).
 */
export function dormRideables(): { x: number; z: number; yaw: number; kind: 'bike' | 'scooter' }[] {
  const out: { x: number; z: number; yaw: number; kind: 'bike' | 'scooter' }[] = [];
  for (const r of BIKE_ROWS) {
    const ax = r[0]!, az = r[1]!, len = Math.hypot(r[2]! - ax, r[3]! - az);
    const ux = (r[2]! - ax) / len, uz = (r[3]! - az) / len;
    out.push({ x: ax - ux * 1.1, z: az - uz * 1.1, yaw: Math.atan2(-uz, ux) + Math.PI / 2, kind: 'bike' });
  }
  out.push({ x: 25.8, z: 300.5, yaw: Math.PI / 2, kind: 'bike' });
  out.push({ x: 27.4, z: 314.6, yaw: 0, kind: 'scooter' });
  return out;
}

const WALL_H = 2.1;
const WALL_T = 0.28;
const GATE_W = 4.4;

/** No trees on the gates, sheds and bike rows (campus tree scatter). */
export function dormYardClearings(): Ring[] {
  const out: Ring[] = [];
  const band = (ax: number, az: number, bx: number, bz: number, half: number): Ring => {
    const len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len * half, nz = (bx - ax) / len * half;
    return [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz];
  };
  for (const g of DORM_GATES) {
    // The wall closes the gap across the mark, the paving runs along it: keep a square around it clear.
    const cx = (g.a[0] + g.b[0]) / 2, cz = (g.a[1] + g.b[1]) / 2;
    out.push([cx - 13, cz - 13, cx + 13, cz - 13, cx + 13, cz + 13, cx - 13, cz + 13]);
  }
  for (const r of BIKE_ROWS) for (let i = 0; i + 3 < r.length; i += 2) out.push(band(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!, 1.4));
  out.push(...SHEDS.map((s) => s.slice()));
  return out;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error('dorm yard geometry merge failed');
  return g;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
function tube(a: [number, number, number], b: [number, number, number], r: number): BufferGeometry {
  const from = new Vector3(...a), to = new Vector3(...b), dir = to.clone().sub(from);
  const g = new CylinderGeometry(r, r, dir.length(), 6, 1);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

function canvas(tracker: ResourceTracker, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function createDormYard(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): { dispose(): void } {
  const root = new Group();
  root.name = 'dorm yard (gates, bike parking, sheds)';
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];
  const mat = (color: number, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.75, ...extra }));
  const white = mat(0xf2f0e8, { roughness: 0.9 });
  const coping = mat(0xbdbab0);
  const iron = mat(0x5a6168, { metalness: 0.5, roughness: 0.5 });
  const tile = mat(0xb5463a, { roughness: 0.8 });
  const dark = mat(0x2a2d31, { roughness: 0.5 });
  const pavers = tracker.material(new MeshStandardMaterial({
    map: canvas(tracker, 128, 128, (g) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const red = (x * 7 + y * 3) % 5 === 0 || y % 4 === 0;
        g.fillStyle = red ? (Math.random() < 0.5 ? '#a8574c' : '#9b4e45') : ['#8f8c88', '#9b9894', '#86837f'][Math.floor(Math.random() * 3)]!;
        g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
      }
    }),
    roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
  const solid = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number): void => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
  };
  const dorms = campus.buildings.filter((b) => b.name?.startsWith('學生宿舍'));

  // --- Gates (前門 / 後門) -----------------------------------------------------------------------
  // The mark lies in the gap between two wings and points along the way through. The wall closes the
  // gap along the shortest segment between the two wings near the mark; the gate is in its middle.
  const outline = (r: Ring): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0, n = r.length / 2; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2]!, az = r[i * 2 + 1]!, bx = r[j * 2]!, bz = r[j * 2 + 1]!;
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let t = 0; t < k; t++) out.push([ax + ((bx - ax) * t) / k, az + ((bz - az) * t) / k]);
    }
    return out;
  };
  const outlines = dorms.map((b) => outline(b.outer));
  const bridge = (cx: number, cz: number): { p: [number, number]; q: [number, number] } | null => {
    const nearest = outlines.map((o, i) => ({ i, d: Math.min(...o.map(([x, z]) => Math.hypot(x - cx, z - cz))) })).sort((m, n) => m.d - n.d);
    if (nearest.length < 2) return null;
    const A = outlines[nearest[0]!.i]!.filter(([x, z]) => Math.hypot(x - cx, z - cz) < 18);
    const B = outlines[nearest[1]!.i]!.filter(([x, z]) => Math.hypot(x - cx, z - cz) < 18);
    let best: { score: number; p: [number, number]; q: [number, number] } | null = null;
    for (const p of A) for (const q of B) {
      const score = Math.hypot(p[0] - q[0], p[1] - q[1]) + 0.15 * Math.hypot((p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - cz);
      if (!best || score < best.score) best = { score, p, q };
    }
    return best;
  };
  for (const g of DORM_GATES) {
    const mx = (g.a[0] + g.b[0]) / 2, mz = (g.a[1] + g.b[1]) / 2;
    const br = bridge(mx, mz);
    if (!br) continue;
    const span = Math.hypot(br.q[0] - br.p[0], br.q[1] - br.p[1]);
    if (span < GATE_W + 1.5) continue;
    const ux = (br.q[0] - br.p[0]) / span, uz = (br.q[1] - br.p[1]) / span;
    const cx = (br.p[0] + br.q[0]) / 2, cz = (br.p[1] + br.q[1]) / 2;
    const left = span / 2 - 0.05, right = span / 2 - 0.05;
    const yaw = Math.atan2(-uz, ux); // local +x along the wall
    const grp = new Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = yaw;
    root.add(grp);
    const add = (geo: BufferGeometry, m: MeshStandardMaterial): Mesh => {
      const mesh = new Mesh(tracker.geometry(geo), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
      return mesh;
    };
    const world = (lx: number, lz: number): [number, number] => [cx + ux * lx - uz * lz, cz + uz * lx + ux * lz];
    // Wall segments either side of the opening, with pilasters every ~3 m and a grey coping.
    for (const [s0, s1] of [[-left, -GATE_W / 2 - 0.35], [GATE_W / 2 + 0.35, right]] as const) {
      const w = s1 - s0;
      if (w < 0.3) continue;
      const mid = (s0 + s1) / 2;
      add(box(w, WALL_H, WALL_T, mid, WALL_H / 2, 0), white);
      add(box(w + 0.06, 0.08, WALL_T + 0.1, mid, WALL_H + 0.04, 0), coping);
      for (let s = s0; s <= s1 + 0.01; s += Math.max(2.4, w / Math.max(1, Math.round(w / 3)))) add(box(0.42, WALL_H + 0.18, 0.42, s, (WALL_H + 0.18) / 2, 0), white);
      const [wx, wz] = world(mid, 0);
      solid(wx, WALL_H / 2, wz, w / 2, WALL_H / 2, WALL_T / 2 + 0.05, yaw);
    }
    // Gate pillars and the small red-tile roof (門樓).
    for (const s of [-1, 1]) {
      add(box(0.7, 2.9, 0.7, s * (GATE_W / 2 + 0.35), 1.45, 0), white);
      const [px, pz] = world(s * (GATE_W / 2 + 0.35), 0);
      solid(px, 1.45, pz, 0.35, 1.45, 0.35, yaw);
    }
    add(box(GATE_W + 1.6, 0.22, 1.5, 0, 3.0, 0), white); // lintel
    const roofW = GATE_W + 2.4;
    for (const side of [-1, 1]) {
      const slope = add(box(roofW, 0.12, 1.25, 0, 3.42, side * 0.52), tile);
      slope.rotation.x = side * 0.42;
    }
    add(box(roofW + 0.1, 0.12, 0.18, 0, 3.66, 0), mat(0x8c3a30)); // ridge
    // Sliding gate, pushed open behind the right-hand wall; card reader by the left pillar.
    const bars: BufferGeometry[] = [box(GATE_W, 0.06, 0.06, 0, 0.12, 0), box(GATE_W, 0.06, 0.06, 0, 1.75, 0)];
    for (let i = 0; i <= 14; i++) bars.push(box(0.035, 1.7, 0.035, -GATE_W / 2 + (i * GATE_W) / 14, 0.93, 0));
    const gate = add(merged(bars), iron);
    gate.position.set(GATE_W / 2 + 0.35 + GATE_W / 2 + 0.2, 0, 0.32);
    add(box(0.14, 1.15, 0.14, -GATE_W / 2 - 0.9, 0.58, 0.6), iron);
    add(box(0.22, 0.3, 0.1, -GATE_W / 2 - 0.9, 1.25, 0.63), dark);
    // Pavers through the gate (both sides).
    const path = new Mesh(tracker.geometry(new PlaneGeometry(GATE_W - 0.4, 14).rotateX(-Math.PI / 2).translate(0, 0.035, 0)), pavers);
    (path.geometry.attributes.uv!.array as Float32Array).forEach((v, i, arr) => { arr[i] = v * (i % 2 === 0 ? 2 : 7); });
    path.receiveShadow = true;
    grp.add(path);
  }

  // --- Parked bikes (rows and sheds) -------------------------------------------------------------
  const bikeFrame = merged([
    tube([0, 0.3, -0.46], [0, 0.62, -0.18], 0.022), tube([0, 0.62, -0.18], [0, 0.66, 0.28], 0.022),
    tube([0, 0.3, -0.06], [0, 0.66, 0.28], 0.022), tube([0, 0.3, -0.06], [0, 0.3, -0.46], 0.018),
    tube([0, 0.62, -0.18], [0, 0.3, -0.06], 0.022), tube([0, 0.66, 0.28], [0, 0.3, 0.46], 0.02),
    box(0.5, 0.03, 0.03, 0, 0.82, 0.3), tube([0, 0.66, 0.28], [0, 0.82, 0.3], 0.018), box(0.12, 0.04, 0.22, 0, 0.66, -0.2),
    box(0.26, 0.16, 0.2, 0, 0.78, 0.44), // front basket
  ]);
  const wheelGeo = new TorusGeometry(0.3, 0.022, 5, 14).rotateY(Math.PI / 2).translate(0, 0.3, 0);
  const spots: { x: number; z: number; yaw: number }[] = [];
  const row = (ax: number, az: number, bx: number, bz: number, step: number, facing: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0.4; t < len - 0.3; t += step) {
      if (Math.random() < 0.12) continue; // the odd empty slot
      // Bike axis (+Z local) across the row; yaw maps +Z onto (sin, cos).
      const yaw = Math.atan2(-uz, ux) + Math.PI / 2 + facing + (Math.random() - 0.5) * 0.25;
      spots.push({ x: ax + ux * t, z: az + uz * t, yaw });
    }
  };
  for (const r of BIKE_ROWS) for (let i = 0; i + 3 < r.length; i += 2) row(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!, 0.7, 0);

  // --- Sheds --------------------------------------------------------------------------------------
  const roofMat = mat(0x5f9a78, { roughness: 0.4, transparent: true, opacity: 0.88 });
  for (const s of SHEDS) {
    // Long axis from the first short side's midpoint to the opposite one.
    const m0 = [(s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2], m1 = [(s[4]! + s[6]!) / 2, (s[5]! + s[7]!) / 2];
    const cx = (m0[0]! + m1[0]!) / 2, cz = (m0[1]! + m1[1]!) / 2;
    const L = Math.hypot(m1[0]! - m0[0]!, m1[1]! - m0[1]!);
    const Wd = Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!);
    const lx = (m1[0]! - m0[0]!) / L, lz = (m1[1]! - m0[1]!) / L; // long axis
    const grp = new Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = Math.atan2(-lz, lx); // local +x = long axis
    root.add(grp);
    const posts: BufferGeometry[] = [];
    const nPost = Math.max(2, Math.round(L / 4) + 1);
    for (let i = 0; i < nPost; i++) for (const side of [-1, 1]) {
      const px = -L / 2 + (i * L) / (nPost - 1);
      posts.push(box(0.12, 2.6, 0.12, px, 1.3, side * (Wd / 2 - 0.2)));
    }
    posts.push(box(L, 0.1, 0.1, 0, 2.6, Wd / 2 - 0.2), box(L, 0.1, 0.1, 0, 2.6, -Wd / 2 + 0.2));
    const frame = new Mesh(tracker.geometry(merged(posts)), iron);
    frame.castShadow = true;
    grp.add(frame);
    const roof = new Mesh(tracker.geometry(box(L + 0.6, 0.06, Wd + 0.4, 0, 2.72, 0)), roofMat);
    roof.rotation.x = 0.05;
    roof.castShadow = true;
    grp.add(roof);
    const slab = new Mesh(tracker.geometry(new PlaneGeometry(L, Wd).rotateX(-Math.PI / 2).translate(0, 0.03, 0)), mat(0xa9a59d, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    slab.receiveShadow = true;
    grp.add(slab);
    // Two rows of bikes along the long sides, nosed in.
    const toWorld = (ax: number, az: number): [number, number] => [cx + lx * ax - lz * az, cz + lz * ax + lx * az];
    for (const side of [-1, 1]) {
      const [ax, az] = toWorld(-L / 2 + 0.5, side * (Wd / 2 - 1.3));
      const [bx, bz] = toWorld(L / 2 - 0.5, side * (Wd / 2 - 1.3));
      row(ax, az, bx, bz, 0.62, side > 0 ? Math.PI : 0);
    }
  }

  const colors = [0x1f8f4a, 0x2c6fd6, 0xf2c230, 0xd8553a, 0x1d1d20, 0xf4f4f4, 0x8a5bd6, 0x9ea4aa].map((c) => new Color(c));
  const frames = new InstancedMesh(tracker.geometry(bikeFrame), mat(0xffffff, { roughness: 0.5 }), Math.max(1, spots.length));
  const wheels = new InstancedMesh(tracker.geometry(wheelGeo), dark, Math.max(1, spots.length * 2));
  const M = new Matrix4(), W = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), one = new Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    M.compose(p.set(s.x, 0, s.z), q.setFromAxisAngle(up, s.yaw), one);
    frames.setMatrixAt(i, M);
    frames.setColorAt(i, colors[i % colors.length]!);
    wheels.setMatrixAt(i * 2, W.copy(M).multiply(new Matrix4().makeTranslation(0, 0, 0.46)));
    wheels.setMatrixAt(i * 2 + 1, W.copy(M).multiply(new Matrix4().makeTranslation(0, 0, -0.46)));
  });
  frames.count = spots.length;
  wheels.count = spots.length * 2;
  for (const m of [frames, wheels]) {
    m.castShadow = true;
    m.computeBoundingSphere();
    root.add(m);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
