import {
  BoxGeometry,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';
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
  /**
   * Style of 學生宿舍C 前門 (user photos, 2026-11-22): instead of pillars and a red-tile roof, a solid
   * cream gatehouse block (PORTAL) with brass dome lamps, cream walls with tall red lattice panels, a
   * pale-blue gate, and the approach on the courtyard side (see C_FRONT).
   */
  portal?: boolean;
  /**
   * Fixed wall ends (campus metres) instead of probing the nearest wings. 學生宿舍C 前門 stays where it was
   * before 學生宿舍C 東翼 moved 1.6 m east (campusFixes.ts splitDormC) — 使用者：改回原本的位置; the wall now
   * meets that wing's south wall about 1.6 m short of its corner.
   */
  ends?: readonly [readonly [number, number], readonly [number, number]];
}

export const DORM_GATES: readonly GateMark[] = [
  { name: '學生宿舍C 後門', a: [-52.0, 341.5], b: [-28.1, 331.7] },
  { name: '學生宿舍C 前門', a: [1.8, 327.5], b: [27.9, 319.9], portal: true, ends: [[10.92, 327.66], [8.57, 319.27]] },
  { name: '學生宿舍B 前門', a: [38.3, 319.9], b: [62.2, 313.4] },
  { name: '學生宿舍B 後門', a: [92.7, 311.2], b: [117.7, 303.6] },
  { name: '學生宿舍A 前門', a: [143.8, 296.0], b: [164.5, 289.5] },
  { name: '學生宿舍A 後門', a: [211.2, 286.2], b: [231.9, 279.6] },
  { name: '學生宿舍D 後門', a: [-36.7, 412.3], b: [-12.8, 406.9] },
  { name: '學生宿舍D 前門', a: [6.8, 403.7], b: [32.9, 397.2] },
  { name: '學生宿舍E.F 前門', a: [54.6, 397.2], b: [80.7, 388.5] },
  { name: '學生宿舍E.F 後門', a: [97.0, 388.3], b: [118.7, 380.6] },
];

/**
 * Each dorm group (A, B, C, D, E.F) is one closed courtyard reached only through its two gates; the
 * groups do not connect. Three-wing groups have a third gap between two wings: closed with a plain
 * wall (OSM building ids of the two wings; the wall follows the shortest segment between them).
 */
const CLOSED_GAPS: readonly [number, number][] = [
  [234786931, 234786932], // 學生宿舍A1 – A2
  [234786934, 234786935], // 學生宿舍B1 – B2
  [296668592, 296668595], // 學生宿舍C (west wing – east wing, toward the C/D courtyard)
  [296668593, 296668594], // 學生宿舍D (west wing – east wing, toward the C/D courtyard)
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

/** Shed frame: centre, long-axis unit vector, length and width (long axis between the short sides). */
function shedFrame(s: Ring): { cx: number; cz: number; lx: number; lz: number; L: number; W: number } {
  const m0 = [(s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2], m1 = [(s[4]! + s[6]!) / 2, (s[5]! + s[7]!) / 2];
  const L = Math.hypot(m1[0]! - m0[0]!, m1[1]! - m0[1]!);
  return { cx: (m0[0]! + m1[0]!) / 2, cz: (m0[1]! + m1[1]!) / 2, lx: (m1[0]! - m0[0]!) / L, lz: (m1[1]! - m0[1]!) / L, L, W: Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!) };
}

/**
 * Every bike in the dorm parking rows and sheds — all rideable (the bike system draws and rides them)
 * — plus the dorm scooter by the road next to the new-player start (faster than a bike).
 * Seeded, so the same bikes stand in the same places every visit.
 */
export function dormRideables(): { x: number; z: number; yaw: number; kind: 'bike' | 'scooter' }[] {
  const out: { x: number; z: number; yaw: number; kind: 'bike' | 'scooter' }[] = [];
  const rnd = mulberry32(20261120);
  const row = (ax: number, az: number, bx: number, bz: number, step: number, facing: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0.4; t < len - 0.3; t += step) {
      if (rnd() < 0.12) continue; // the odd empty slot
      // Bike axis (+Z local) across the row; yaw maps +Z onto (sin, cos).
      out.push({ x: ax + ux * t, z: az + uz * t, yaw: Math.atan2(-uz, ux) + Math.PI / 2 + facing + (rnd() - 0.5) * 0.25, kind: 'bike' });
    }
  };
  for (const r of BIKE_ROWS) for (let i = 0; i + 3 < r.length; i += 2) row(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!, 0.75, 0);
  for (const sh of SHEDS) {
    const f = shedFrame(sh);
    const toWorld = (a: number, b: number): [number, number] => [f.cx + f.lx * a - f.lz * b, f.cz + f.lz * a + f.lx * b];
    for (const side of [-1, 1]) {
      const [ax, az] = toWorld(-f.L / 2 + 0.5, side * (f.W / 2 - 1.3));
      const [bx, bz] = toWorld(f.L / 2 - 0.5, side * (f.W / 2 - 1.3));
      row(ax, az, bx, bz, 0.7, side > 0 ? Math.PI : 0);
    }
  }
  out.push({ x: 27.4, z: 314.6, yaw: 0, kind: 'scooter' });
  return out;
}

/**
 * 學生宿舍C 前門, courtyard side (user photo looking east at the gate, 2026-11-22), campus metres:
 *  - a straight grey-and-red paver walk from the courtyard to the gate (along the way through);
 *  - left of it (學生宿舍C north wing) a grass strip with a black lamppost and a shrub;
 *  - right of it dark red pavers up to the 學生宿舍C east wing, whose two faces by the gate carry a
 *    raised entrance platform (three steps round its free sides) with glass doors and a shopfront.
 * `faces` are the east wing's outline corners from the gate corner southward (OSM 296668595).
 */
const C_FRONT = {
  walk: { from: -7, to: 30, half: 2.0 }, // through the gate (replaces the shared gate pavers)
  plaza: [[10.7, 327.7], [11.4, 331.9], [7.2, 338.2], [2.6, 338.9], [-7.1, 337.5], [-9.0, 330.8], [9.8, 325.5]] as const,
  faces: [[10.9, 327.7], [11.6, 331.9], [7.3, 338.4]] as const,
  platform: { start: 0.25, end: 4.5, depth: 2.2, top: 0.45, rise: 0.15, tread: 0.35, steps: 3 },
  lamp: [5.0, 321.4] as const,
  shrub: [2.7, 322.4] as const,
};

/** 學生宿舍C 前門's gatehouse (close-up photo): opening, block width / height / depth, lintel underside, lattice panel and pier widths. */
const PORTAL = { open: 2.7, width: 3.9, height: 3.15, depth: 0.8, lintel: 2.25, panel: 0.8, pier: 0.95 };

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
  // 學生宿舍C 前門 approach: the walk (gate → courtyard) and the plaza by the east wing.
  out.push(band(9.7, 323.5, -19.2, 331.6, 3.5), C_FRONT.plaza.flatMap(([x, z]) => [x, z]));
  return out;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error('dorm yard geometry merge failed');
  return g;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
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

/** Sensor gates open within OPEN_R of the gate centre and close past CLOSE_R. */
const OPEN_R = 4.5;
const CLOSE_R = 6.5;
const GATE_SPEED = 2.2; // m/s of leaf travel
/** How far the swing leaves of 學生宿舍C 前門 open (rad, just short of flat against the jambs). */
const SWING = Math.PI * 0.48;

export interface DormYard {
  /** Footprints (rectangles) of every solid piece — walls, gate posts, sheds — for route planning. */
  readonly blockers: number[][];
  /** Per frame (sensor gates); returns true on the frame a gate starts to open (for a sound). */
  update(dt: number, px: number, py: number, pz: number): boolean;
  dispose(): void;
}

export function createDormYard(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): DormYard {
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
  const sensorRed = mat(0xc62828, { emissive: 0xff3030, emissiveIntensity: 0.9 });
  const sensorGreen = mat(0x2e7d32, { emissive: 0x30ff60, emissiveIntensity: 0.9 });
  /** `swing` (swing gates) sets the leaves for 0..1 open; sliding gates move `leaf` by `travel` instead. */
  interface SensorGate { x: number; z: number; leaf: Mesh; light: Mesh; block: RAPIER.Collider; open: number; target: number; travel: number; swing: ((t: number) => void) | null }
  const gates: SensorGate[] = [];
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
  const blockers: number[][] = [];
  const solid = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number): void => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    // Ground rectangle (local x along yaw's x axis, z along its z axis), counter-clockwise.
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const corner = (a: number, b: number): [number, number] => [x + a * c + b * sn, z - a * sn + b * c];
    if (hy > 0.4) blockers.push([...corner(-hx, -hz), ...corner(hx, -hz), ...corner(hx, hz), ...corner(-hx, hz)]);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
  };
  const dorms = campus.buildings.filter((b) => b.name?.startsWith('學生宿舍'));

  // Red-brown diamond lattice (breeze-block screen) over a dark, teal-lit void; one panel 0.8 × 1.8 m.
  const lattice = tracker.material(new MeshStandardMaterial({
    map: canvas(tracker, 128, 288, (g) => {
      g.fillStyle = '#1f2423';
      g.fillRect(0, 0, 128, 288);
      g.fillStyle = 'rgba(60,125,120,0.45)';
      g.fillRect(0, 0, 128, 288);
      g.strokeStyle = '#a3503b';
      g.lineWidth = 6;
      for (let k = -288; k < 416; k += 26) {
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 288, 288); g.stroke();
        g.beginPath(); g.moveTo(k + 288, 0); g.lineTo(k, 288); g.stroke();
      }
      g.strokeStyle = '#8a8378';
      g.lineWidth = 6;
      g.strokeRect(3, 3, 122, 282);
    }),
    roughness: 0.9,
  }));
  const cream = mat(0xeee6d0, { roughness: 0.95 });
  const plinth = mat(0x8d8b85, { roughness: 0.9 });
  const paleBlue = mat(0xa9d2e3, { metalness: 0.3, roughness: 0.5 });
  const dome = tracker.geometry(new SphereGeometry(0.15, 14, 10).scale(1, 1, 0.6));
  const brass = mat(0xc9a24d, { metalness: 0.6, roughness: 0.35, emissive: 0x6b5220, emissiveIntensity: 0.4 });
  const lightBox = mat(0x6c6e70, { roughness: 0.6 });
  const globeMat = mat(0xfff6dc, { emissive: 0xffe6a8, emissiveIntensity: 0.8, roughness: 0.3 });
  const plazaPavers = tracker.material(new MeshStandardMaterial({
    map: (() => {
      const t = canvas(tracker, 128, 128, (g) => {
        g.fillStyle = '#4a3934';
        g.fillRect(0, 0, 128, 128);
        const tones = ['#7a5148', '#6c4a43', '#83605a', '#5f4540', '#8a6c64'];
        for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
          g.fillStyle = tones[(x * 3 + y * 7) % tones.length]!;
          g.fillRect(x * 32 + (y % 2) * 16 + 1, y * 16 + 1, 30, 14);
        }
      });
      t.repeat.set(1 / 2, 1 / 2);
      return t;
    })(),
    roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }));
  // Grey interlocking pavers (0.2 × 0.1 m) with a red double band every 3 m (photo of the C walk).
  const walkPavers = tracker.material(new MeshStandardMaterial({
    map: (() => {
      const t = canvas(tracker, 256, 192, (g) => {
        g.fillStyle = '#5d5a57';
        g.fillRect(0, 0, 256, 192);
        for (let row = 0; row < 32; row++) {
          const band = row < 2;
          for (let col = -1; col < 21; col++) {
            const v = (row * 31 + col * 17) % 7;
            g.fillStyle = band ? ['#9a5246', '#a45a4c', '#8e4b40'][v % 3]! : ['#8d8a86', '#97948f', '#85827e', '#9e9b96'][v % 4]!;
            g.fillRect(col * 12.8 + (row % 2) * 6.4 + 0.6, row * 6 + 0.6, 11.6, 4.8);
          }
        }
      });
      t.repeat.set(1 / 4, 1 / 3);
      return t;
    })(),
    roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
  const concrete = mat(0xb9b7b0, { roughness: 0.9 });
  const glass = mat(0x24313a, { roughness: 0.15, metalness: 0.4 });
  const frameGrey = mat(0x5c6166, { metalness: 0.4 });
  const black = mat(0x1d1f22, { metalness: 0.4, roughness: 0.6 });
  const leafGreen = mat(0x4f7d35, { roughness: 0.9, flatShading: true });
  /** A flat polygon (campus x / z) slightly above the ground, UVs in metres. */
  const decal = (pts: readonly (readonly [number, number])[], y: number, m: MeshStandardMaterial, uvOf: (x: number, z: number) => [number, number] = (x, z) => [x, z]): void => {
    const sh = new Shape(pts.map(([x, z]) => new Vector2(x, -z)));
    const geo = new ShapeGeometry(sh).rotateX(-Math.PI / 2).translate(0, y, 0);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, ...uvOf(pos.getX(i), pos.getZ(i)));
    const mesh = new Mesh(tracker.geometry(geo), m);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  /** A vertical prism over a convex campus polygon, with a matching collider. */
  const prism = (pts: readonly (readonly [number, number])[], y0: number, y1: number, m: MeshStandardMaterial): void => {
    const geo = new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0);
    const mesh = new Mesh(tracker.geometry(geo), m);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    const v: number[] = [];
    for (const [x, z] of pts) v.push(x, y0, z, x, y1, z);
    const d = RAPIER.ColliderDesc.convexHull(new Float32Array(v));
    if (d) colliders.push(physics.createCollider(d));
  };
  /** A thin panel standing on a wall from a, running along unit dir for s0..s1, set out by `out` along n. */
  const panel = (a: readonly [number, number], dir: [number, number], n: [number, number], s0: number, s1: number, y0: number, y1: number, out: number, depth: number, m: MeshStandardMaterial): void => {
    const sm = (s0 + s1) / 2, cxp = a[0] + dir[0] * sm + n[0] * (out + depth / 2), czp = a[1] + dir[1] * sm + n[1] * (out + depth / 2);
    const mesh = new Mesh(tracker.geometry(box(s1 - s0, y1 - y0, depth, 0, (y0 + y1) / 2, 0)), m);
    mesh.position.set(cxp, 0, czp);
    mesh.rotation.y = Math.atan2(-dir[1], dir[0]);
    mesh.castShadow = true;
    root.add(mesh);
  };
  /** 學生宿舍C 前門, courtyard side: the walk, the plaza, the entrance platform, lamppost and shrub. */
  const cFrontApproach = (cx: number, cz: number, mx: number, mz: number): void => {
    const { walk, platform: P } = C_FRONT;
    const lx = -mz, lz = mx; // across the walk
    const at = (t: number, l: number): [number, number] => [cx + mx * t + lx * l, cz + mz * t + lz * l];
    // UVs across (u) and along (v) the walk so the red bands run crosswise.
    decal([at(walk.from, -walk.half), at(walk.to, -walk.half), at(walk.to, walk.half), at(walk.from, walk.half)], 0.036, walkPavers,
      (x, z) => [(x - cx) * lx + (z - cz) * lz, (x - cx) * mx + (z - cz) * mz]);
    decal(C_FRONT.plaza, 0.03, plazaPavers);
    // Entrance platform along the two faces, three steps round the free sides (outline offset by d).
    const [f0, f1, f2] = C_FRONT.faces;
    const unit = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const d1 = unit(f0, f1), d2 = unit(f1, f2);
    // Outward normals: the courtyard side of each face (away from the building's inside).
    const n1: [number, number] = [-d1[1], d1[0]], n2: [number, number] = [-d2[1], d2[0]];
    const side = (n: [number, number], f: readonly [number, number]): [number, number] => ((cx - f[0]) * n[0] + (cz - f[1]) * n[1] > 0 ? n : [-n[0], -n[1]]);
    const o1 = side(n1, f0), o2 = side(n2, f2);
    const s0: [number, number] = [f0[0] + d1[0] * P.start, f0[1] + d1[1] * P.start];
    const e: [number, number] = [f1[0] + d2[0] * P.end, f1[1] + d2[1] * P.end];
    const miter = (d: number): [number, number] => {
      // f1 + d·o1 + a·d1 = f1 + d·o2 + b·d2
      const rx = d * (o2[0] - o1[0]), rz = d * (o2[1] - o1[1]);
      const det = d1[0] * -d2[1] - d1[1] * -d2[0];
      const a = (rx * -d2[1] - rz * -d2[0]) / det;
      return [f1[0] + d * o1[0] + a * d1[0], f1[1] + d * o1[1] + a * d1[1]];
    };
    for (let k = P.steps; k >= 0; k--) {
      const d = P.depth + k * P.tread, ext = k * P.tread, top = P.top - k * P.rise;
      const a: [number, number] = [s0[0] - d1[0] * ext, s0[1] - d1[1] * ext];
      const b: [number, number] = [e[0] + d2[0] * ext, e[1] + d2[1] * ext];
      const m = miter(d);
      prism([a, f1, m, [a[0] + o1[0] * d, a[1] + o1[1] * d]], 0, top, concrete);
      prism([f1, b, [b[0] + o2[0] * d, b[1] + o2[1] * d], m], 0, top, concrete);
    }
    // Glass doors on the gate-side face, a shopfront on the long face.
    const face1 = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]);
    panel(f0, d1, o1, face1 / 2 - 1.3, face1 / 2 + 1.3, P.top, P.top + 2.7, 0, 0.08, frameGrey);
    panel(f0, d1, o1, face1 / 2 - 1.2, face1 / 2 + 1.2, P.top + 0.05, P.top + 2.6, 0.08, 0.02, glass);
    panel(f0, d1, o1, face1 / 2 - 0.03, face1 / 2 + 0.03, P.top + 0.05, P.top + 2.6, 0.1, 0.03, frameGrey);
    panel(f1, d2, o2, 0.5, P.end - 0.3, P.top, P.top + 2.9, 0, 0.08, frameGrey);
    panel(f1, d2, o2, 0.6, P.end - 0.4, P.top + 0.4, P.top + 2.8, 0.08, 0.02, glass);
    for (let s = 0.6; s <= P.end - 0.4 + 1e-6; s += (P.end - 1.0) / 3) panel(f1, d2, o2, s - 0.03, s + 0.03, P.top + 0.4, P.top + 2.8, 0.1, 0.03, frameGrey);
    // Black lamppost with a box head, and a shrub, on the grass strip by the north wing.
    const [lpx, lpz] = C_FRONT.lamp;
    const post = new Mesh(tracker.geometry(merged([box(0.12, 3.6, 0.12, 0, 1.8, 0), box(0.34, 0.42, 0.34, 0, 3.75, 0), box(0.3, 0.3, 0.3, 0, 0.15, 0)])), black);
    post.position.set(lpx, 0, lpz);
    post.castShadow = true;
    root.add(post);
    const head = new Mesh(tracker.geometry(box(0.26, 0.08, 0.26, 0, 3.52, 0)), globeMat);
    head.position.set(lpx, 0, lpz);
    root.add(head);
    solid(lpx, 1.8, lpz, 0.1, 1.8, 0.1, 0);
    const [shx, shz] = C_FRONT.shrub;
    const bush = new Mesh(tracker.geometry(merged([new IcosahedronGeometry(0.55, 0).scale(1.2, 0.85, 1).translate(0, 0.5, 0), new IcosahedronGeometry(0.4, 0).translate(0.45, 0.75, 0.2)])), leafGreen);
    bush.position.set(shx, 0, shz);
    bush.castShadow = true;
    root.add(bush);
  };

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
  // Plain walls closing the third gap of each three-wing group.
  for (const [ia, ib] of CLOSED_GAPS) {
    const A = dorms.find((b) => b.id === ia), B = dorms.find((b) => b.id === ib);
    if (!A || !B) continue;
    const oa = outline(A.outer), ob = outline(B.outer);
    let best: { d: number; p: [number, number]; q: [number, number] } | null = null;
    for (const p of oa) for (const q of ob) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, p, q };
    }
    if (!best || best.d < 0.4 || best.d > 25) continue;
    const ux = (best.q[0] - best.p[0]) / best.d, uz = (best.q[1] - best.p[1]) / best.d;
    const cx = (best.p[0] + best.q[0]) / 2, cz = (best.p[1] + best.q[1]) / 2;
    const yaw = Math.atan2(-uz, ux);
    const grp = new Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = yaw;
    root.add(grp);
    const w = best.d + 0.1;
    for (const [geo, m] of [[box(w, WALL_H, WALL_T, 0, WALL_H / 2, 0), white], [box(w + 0.06, 0.08, WALL_T + 0.1, 0, WALL_H + 0.04, 0), coping]] as const) {
      const mesh = new Mesh(tracker.geometry(geo), m);
      mesh.castShadow = mesh.receiveShadow = true;
      grp.add(mesh);
    }
    const n = Math.max(1, Math.round(w / 3));
    for (let i = 0; i <= n; i++) {
      const pil = new Mesh(tracker.geometry(box(0.42, WALL_H + 0.18, 0.42, -w / 2 + (i * w) / n, (WALL_H + 0.18) / 2, 0)), white);
      pil.castShadow = true;
      grp.add(pil);
    }
    solid(cx, WALL_H / 2, cz, w / 2, WALL_H / 2, WALL_T / 2 + 0.05, yaw);
  }

  for (const g of DORM_GATES) {
    const mx = (g.a[0] + g.b[0]) / 2, mz = (g.a[1] + g.b[1]) / 2;
    const br = g.ends ? { p: [g.ends[0][0], g.ends[0][1]] as [number, number], q: [g.ends[1][0], g.ends[1][1]] as [number, number] } : bridge(mx, mz);
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
    const GW = g.portal ? PORTAL.open : GATE_W;
    const leafZ = g.portal ? 0 : 0.32;
    let leaf: Mesh, light: Mesh;
    let swing: ((t: number) => void) | null = null;
    if (!g.portal) {
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
      // Sensor sliding gate (感應門): closed across the opening, slides behind the right-hand wall
      // when someone comes close; card reader and a sensor light by the left pillar.
      const bars: BufferGeometry[] = [box(GATE_W, 0.06, 0.06, 0, 0.12, 0), box(GATE_W, 0.06, 0.06, 0, 1.75, 0)];
      for (let i = 0; i <= 14; i++) bars.push(box(0.035, 1.7, 0.035, -GATE_W / 2 + (i * GATE_W) / 14, 0.93, 0));
      leaf = add(merged(bars), iron);
      add(box(0.14, 1.15, 0.14, -GATE_W / 2 - 0.9, 0.58, 0.6), iron);
      add(box(0.22, 0.3, 0.1, -GATE_W / 2 - 0.9, 1.25, 0.63), dark);
      light = add(box(0.16, 0.16, 0.06, -GATE_W / 2 - 0.35, 2.55, 0.38), sensorRed);
    } else {
      // 學生宿舍C 前門 (close-up photo, 2026-11-22): cream walls with a grey plinth and a heavy grey coping,
      // tall red lattice panels (0.8 m) between plain piers; a solid cream gatehouse block standing above
      // the walls with a door-sized opening, a brass dome lamp either side of it on both faces, a grey
      // light box above the opening and a small card reader; a pale-blue gate in the opening.
      const { open: GO, width: PW, height: PH, depth: PD, lintel: PL, panel: PP, pier: PR } = PORTAL;
      for (const [s0, s1, dir] of [[-left, -PW / 2, -1], [PW / 2, right, 1]] as const) {
        const w = s1 - s0;
        if (w < 0.3) continue;
        const mid = (s0 + s1) / 2;
        add(box(w, WALL_H, WALL_T, mid, WALL_H / 2, 0), cream);
        add(box(w, 0.2, WALL_T + 0.06, mid, 0.1, 0), plinth);
        add(box(w + 0.04, 0.13, WALL_T + 0.18, mid, WALL_H + 0.065, 0), plinth);
        // Lattice panels from the gatehouse outward: panel, pier, panel, … As many panels as fit with
        // piers of at least PIER_MIN (narrowing the piers below PR when needed), so the short walls
        // either side of the gatehouse still get a second panel at their outer end (user screenshot).
        const avail = w - 0.05 - 0.12, PIER_MIN = 0.3;
        const n = Math.max(1, Math.floor((avail + PIER_MIN) / (PP + PIER_MIN)));
        const pier = n > 1 ? Math.min(PR, (avail - n * PP) / (n - 1)) : 0;
        for (let k = 0; k < n; k++) {
          const near = PW / 2 + 0.05 + k * (PP + pier), far = near + PP;
          add(box(PP, 1.8, WALL_T + 0.03, dir * (near + far) / 2, 1.1, 0), lattice);
        }
        const [wx, wz] = world(mid, 0);
        solid(wx, WALL_H / 2, wz, w / 2, WALL_H / 2, WALL_T / 2 + 0.05, yaw);
      }
      const sideW = (PW - GO) / 2;
      for (const s of [-1, 1]) {
        add(box(sideW, PH, PD, s * (GO / 2 + sideW / 2), PH / 2, 0), cream);
        const [px, pz] = world(s * (GO / 2 + sideW / 2), 0);
        solid(px, PH / 2, pz, sideW / 2, PH / 2, PD / 2, yaw);
      }
      add(box(PW, PH - PL, PD, 0, (PL + PH) / 2, 0), cream);
      add(box(PW + 0.08, 0.08, PD + 0.08, 0, PH + 0.04, 0), plinth);
      add(box(GO + 0.3, 0.05, PD + 0.5, 0, 0.025, 0), plinth); // stone threshold
      for (const face of [-1, 1]) {
        for (const s of [-1, 1]) {
          const lamp = new Mesh(dome, brass);
          lamp.position.set(s * (PW / 2 - 0.4), PL + 0.2, face * (PD / 2));
          grp.add(lamp);
        }
        add(box(0.55, 0.3, 0.1, 0.75, PH - 0.5, face * (PD / 2 + 0.05)), lightBox);
        add(box(0.16, 0.24, 0.08, GO / 2 + 0.2, PL - 0.15, face * (PD / 2 + 0.04)), lightBox);
      }
      // Pale-blue gate (user, 2026-11-22: it swings open like a pair of doors, not sideways): two leaves
      // hinged at the jambs, a plated left leaf and a barred right leaf, swinging into the courtyard.
      // Each leaf is built in its hinge's frame, running from the hinge (x = 0) toward the middle.
      const LW = GO / 2 - 0.06; // leaf width: a hinge gap at the jamb and a meeting gap in the middle
      const frame = (dirX: 1 | -1): BufferGeometry[] => [
        box(LW, 0.05, 0.05, dirX * LW / 2, 0.1, 0), box(LW, 0.05, 0.05, dirX * LW / 2, 1.95, 0),
        box(0.05, 1.9, 0.05, dirX * 0.025, 1.02, 0), box(0.05, 1.9, 0.05, dirX * (LW - 0.025), 1.02, 0),
      ];
      const leftParts = [...frame(1), box(LW - 0.1, 1.6, 0.025, LW / 2, 1.02, 0)];
      const rightParts = frame(-1);
      for (let x = 0.17; x < LW - 0.08; x += 0.17) rightParts.push(box(0.03, 1.85, 0.03, -x, 1.02, 0));
      const inward = (g.a[0] - cx) * -uz + (g.a[1] - cz) * ux > 0 ? 1 : -1; // courtyard side (local +z = inward)
      const hinge = GO / 2 - 0.04;
      const leaves: { pivot: Group; sign: number }[] = [];
      for (const [hx, parts, sign] of [[-hinge, leftParts, -inward], [hinge, rightParts, inward]] as const) {
        const pivot = new Group();
        pivot.position.set(hx, 0, 0);
        grp.add(pivot);
        const m = new Mesh(tracker.geometry(merged(parts)), paleBlue);
        m.castShadow = true;
        pivot.add(m);
        // Hinge pins on the jamb.
        for (const y of [0.35, 1.7]) add(box(0.06, 0.12, 0.06, hx + Math.sign(hx) * 0.01, y, 0), paleBlue);
        leaves.push({ pivot, sign });
      }
      swing = (t) => { for (const l of leaves) l.pivot.rotation.y = l.sign * t * SWING; };
      // `leaf` stays as the sliding-leaf handle for the shared code below; the swing replaces the slide.
      leaf = new Mesh();
      light = add(box(0.12, 0.12, 0.05, -GO / 2 - 0.2, PL - 0.15, PD / 2 + 0.03), sensorRed);
    }
    leaf.position.set(0, 0, leafZ);
    const [gx, gz] = world(0, leafZ);
    const block = physics.createCollider(RAPIER.ColliderDesc.cuboid(GW / 2, 1.0, 0.12).setTranslation(gx, 1.0, gz)
      .setRotation((() => { const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw); return { x: q.x, y: q.y, z: q.z, w: q.w }; })()));
    colliders.push(block);
    // Swing leaves travel about a quarter circle at their tips.
    gates.push({ x: cx, z: cz, leaf, light, block, open: 0, target: 0, travel: swing ? (GW / 2) * SWING : GW + 0.55, swing });
    // Pavers through the gate (both sides); the portal gate's walk runs through instead.
    if (!g.portal) {
      const path = new Mesh(tracker.geometry(new PlaneGeometry(GATE_W - 0.4, 14).rotateX(-Math.PI / 2).translate(0, 0.035, 0)), pavers);
      (path.geometry.attributes.uv!.array as Float32Array).forEach((v, i, arr) => { arr[i] = v * (i % 2 === 0 ? 2 : 7); });
      path.receiveShadow = true;
      grp.add(path);
    }
    if (g.portal) {
      // Way into the courtyard: the side of the wall the mark's start lies on.
      const nx = -uz, nz = ux, inward = (g.a[0] - cx) * nx + (g.a[1] - cz) * nz > 0 ? 1 : -1;
      cFrontApproach(cx, cz, inward * nx, inward * nz);
    }
  }

  // --- Sheds --------------------------------------------------------------------------------------
  const roofMat = mat(0x5f9a78, { roughness: 0.4, transparent: true, opacity: 0.88 });
  for (const s of SHEDS) {
    const { cx, cz, lx, lz, L, W: Wd } = shedFrame(s);
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
  }

  return {
    blockers,
    update(dt, px, py, pz) {
      let started = false;
      for (const g of gates) {
        const d = Math.hypot(px - g.x, pz - g.z);
        const want = py < 1.5 && d < OPEN_R ? 1 : d > CLOSE_R || py >= 1.5 ? 0 : g.target;
        if (want === 1 && g.target === 0) started = true;
        g.target = want;
        if (g.open === g.target) continue;
        g.open = g.target > g.open ? Math.min(1, g.open + (dt * GATE_SPEED) / g.travel) : Math.max(0, g.open - (dt * GATE_SPEED) / g.travel);
        if (g.swing) g.swing(g.open);
        else g.leaf.position.x = g.open * g.travel;
        g.light.material = g.open > 0 ? sensorGreen : sensorRed;
        // Passable once it is mostly open; blocks again as soon as it starts closing over the gap.
        g.block.setEnabled(g.open < 0.6);
      }
      return started;
    },
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
