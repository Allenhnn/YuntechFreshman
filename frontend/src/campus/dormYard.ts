import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
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
import { dormBToA, dormCToD } from './customFacades';

/**
 * Dorm area layout from the user's marked map (2026-11-20) and Street View:
 *  - 前門 / 後門 (red): every dorm group closes the gap between two wings with a white wall and a
 *    gate in the middle — two pillars carrying a small red-tile roof, the iron sliding gate pushed
 *    open, a card reader, and red-and-grey pavers running through (Street View: 學生宿舍 gate).
 *    The wall ends are found at run time by probing from the marked centre to each wing's wall.
 *  - 腳踏車停放區 (blue lines): rows of parked bikes along the dorm roads and the south edge.
 *  - 腳踏車車棚 (blue boxes): open bike sheds after the user's photos (2026-11-26): teal steel columns
 *    and I-beams with exposed ribs under two corrugated roofs at different heights, an asphalt aisle
 *    down the middle with two rows of bikes on each side, and at the entrance (north end) a yellow
 *    hatched 禁止停車 box, a two-step granite threshold between washed-pebble curbs, and shrub beds.
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
  /** 學生宿舍C 前門 only: its courtyard approach (walk, plaza by the east wing, platform; see C_FRONT). */
  approach?: boolean;
  /**
   * 學生宿舍C 後門 (使用者照片 2026-11-24, same gate as 前門): a red fire-main pipe along the foot of the wall on the
   * outside, and a plain concrete footpath through the gate.
   */
  firePipe?: boolean;
  /**
   * 學生宿舍C C1–C2 之間（使用者照片 2026-11-24）：同一款門樓，但門是白色方格鐵門、打不開——固定在開口裡，一直擋著，
   * 沒有感應、不會開。
   */
  locked?: boolean;
  /**
   * Fixed wall ends (campus metres) instead of probing the nearest wings. 學生宿舍C 前門 stays where it was
   * before 學生宿舍C 東翼 moved 1.6 m east (campusFixes.ts splitDormC) — 使用者：改回原本的位置; the wall now
   * meets that wing's south wall about 1.6 m short of its corner.
   */
  ends?: readonly [readonly [number, number], readonly [number, number]];
  /** The gate's centre moved this many metres from the wall's middle toward the second end (`ends[1]`). */
  shift?: number;
  /** 學生宿舍D's mirrored copy of a 學生宿舍C gate (its approach uses D_FRONT). */
  site?: 'D';
  /**
   * 學生宿舍B B 圍牆（使用者照片 2026-11-25）：same lattice walls, but no gatehouse — two cream piers hold a wide pale-blue
   * barred double gate, fixed shut (`portal` must be set too).
   */
  barred?: boolean;
}

const BASE_GATES: readonly GateMark[] = [
  // 使用者平面圖（C 區，2026-11-24）：C2–C3 之間的圍牆沿兩棟的外側邊線——從 C3 西翼西南角往外 2.2 m，筆直接到 C2
  // 西北角（不是從兩棟中間穿過）；門在中間。ends: C3 end, C2 end.
  // 使用者照片（2026-11-24）：門的樣式跟前門一樣（奶油色門樓、花磚牆、淡藍色門），牆腳外側一條紅色消防水管、門外水泥步道。
  // `a` on the courtyard side (east), so the gate swings in and the pipe runs outside.
  { name: '學生宿舍C 後門', a: [-30.9, 333.8], b: [-54.6, 337.3], portal: true, firePipe: true, ends: [[-44.47, 323.98], [-41.0, 347.1]] },
  { name: '學生宿舍C 前門', a: [1.8, 327.5], b: [27.9, 319.9], portal: true, approach: true, ends: [[10.92, 327.66], [8.57, 319.27]] },
  // 使用者照片（2026-11-24）：C1–C2 之間不是素面牆，是同款門樓＋花磚牆，門打不開。ends: C2 corner, C1 wall (the old
  // CLOSED_GAPS segment); `a` on the courtyard side (north).
  // 使用者 C2 背面照（2026-11-24）：牆從 C2 樓梯間（凸出 1.6 m，dormCFacade.ts C2.tower）正面的東角接到 C1 西面；門樓靠 C1，
  // C1 那側只剩窄窄一段、C2 那側約 2.4 m。
  { name: '學生宿舍C C1–C2 側門', a: [-1.67, 347.6], b: [-0.43, 357.6], portal: true, locked: true, ends: [[-4.24, 354.6], [2.69, 354.5]], shift: 0.9 },
  // 學生宿舍B（使用者一樓平面圖紅線＋照片，2026-11-25）：三道 L 形圍牆，門在較長那段，短的那段是 WALL_STUBS。
  // A（西邊，B2–B3，腳踏車停車場旁）：同款門樓、藍色門會開。B（東南，B1–B2）：沒有門樓，兩根奶油色墩夾一樘藍色鐵柵雙開門（固定）。
  // C（東北，B1–B3，照片糊，推算）：跟 A 同款。`a` 在中庭那側。
  { name: '學生宿舍B A 門', a: [55.0, 314.5], b: [48.8, 315.7], portal: true, ends: [[52.7, 319.3], [51.1, 310.96]] },
  { name: '學生宿舍B B 門', a: [104.4, 331.5], b: [105.0, 337.6], portal: true, barred: true, ends: [[108.24, 334.18], [101.07, 334.99]] },
  { name: '學生宿舍B C 門', a: [111.2, 303.7], b: [117.4, 302.6], portal: true, ends: [[115.15, 307.91], [113.47, 298.45]] },
  // 學生宿舍A：使用者（2026-11-25）跟 B 一樣——前門、後門、A1–A2 之間的牆換成 B 那三道圍牆轉過去（見下面 DORM_GATES）。
  { name: '學生宿舍E.F 前門', a: [54.6, 397.2], b: [80.7, 388.5] },
  { name: '學生宿舍E.F 後門', a: [97.0, 388.3], b: [118.7, 380.6] },
];

/** A C-area point on its mirrored D copy (customFacades.ts `dormCToD`). */
const toD = (p: readonly [number, number]): [number, number] => dormCToD(p[0], p[1]);
/**
 * 學生宿舍D（使用者 2026-11-24：整個 C 區的配置複製到 D 區）：C 的後門、前門、C1–C2 側門鏡射過去，取代 D 原本的兩道感應門和
 * D1–D2 之間的素面牆；同一款門樓、花磚牆，前門的步道／廣場／平台（D_FRONT）、後門的消防水管、側門打不開，都一樣。
 */
const toA = (p: readonly [number, number]): [number, number] => dormBToA(p[0], p[1]);
export const DORM_GATES: readonly GateMark[] = [
  ...BASE_GATES,
  // 學生宿舍A（使用者 2026-11-25：跟 B 一樣）：B 區三道圍牆的門鏡射過去。
  ...BASE_GATES.filter((g) => g.name.startsWith('學生宿舍B')).map((g): GateMark => ({
    ...g, name: g.name.replace('學生宿舍B', '學生宿舍A'), a: toA(g.a), b: toA(g.b),
    ...(g.ends ? { ends: [toA(g.ends[0]), toA(g.ends[1])] as const } : {}),
  })),
  ...BASE_GATES.filter((g) => g.name.startsWith('學生宿舍C')).map((g): GateMark => ({
    ...g, name: g.name.replace(/C/g, 'D'), a: toD(g.a), b: toD(g.b), site: 'D',
    ...(g.ends ? { ends: [toD(g.ends[0]), toD(g.ends[1])] as const } : {}),
  })),
];

/**
 * Each dorm group (A, B, C, D, E.F) is one closed courtyard reached only through its two gates; the
 * groups do not connect. Three-wing groups have a third gap between two wings: closed with a plain
 * wall (OSM building ids of the two wings; the wall follows the shortest segment between them).
 */
const CLOSED_GAPS: readonly [number, number][] = [
];

/**
 * Short plain wall pieces (two ends, campus metres) that don't close a gap between wings on their own:
 * 學生宿舍C 後門's wall leaves C3's west wing a little outside its corner (使用者平面圖) — this stub joins them.
 */
const WALL_STUBS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [[-42.3, 323.6], [-44.47, 323.98]],
  [toD([-42.3, 323.6]), toD([-44.47, 323.98])], // 學生宿舍D 的同一段
];
/**
 * 學生宿舍B 三道 L 形圍牆的短段（平面圖紅線）。使用者：不要全白——跟門那段同一款：奶油色牆、灰色牆基與壓頂、1～2 片紅花磚。
 */
const LATTICE_STUBS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [[51.1, 310.96], [53.5, 310.27]],
  [[101.07, 334.99], [99.96, 329.4]],
  [[113.47, 298.45], [107.95, 299.94]],
  // 學生宿舍A 的同三段（B 轉過去）。
  [toA([51.1, 310.96]), toA([53.5, 310.27])],
  [toA([101.07, 334.99]), toA([99.96, 329.4])],
  [toA([113.47, 298.45]), toA([107.95, 299.94])],
];

/** Bike parking rows (polylines). */
const BIKE_ROWS: readonly (readonly number[])[] = [
  // (使用者 2026-11-26: the two rows either side of the walk between 學生宿舍C 東翼 and B are gone.)
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

/** Shed layout across the width (local z): aisle half-width, the bike rows' centres, the column lines. */
const SHED = { aisle: 1.25, entry: 3.3, step: 0.62, colStep: 4.6 };
const shedRows = (W: number): number[] => [SHED.aisle + 0.95, W / 2 - 1.2];
const shedColumnsZ = (W: number): number[] => [-W / 2 + 0.35, -SHED.aisle, SHED.aisle, W / 2 - 0.35];
const shedColumnsX = (L: number): number[] => {
  const n = Math.max(2, Math.round((L - 0.8) / SHED.colStep) + 1);
  return Array.from({ length: n }, (_, i) => -L / 2 + 0.4 + (i * (L - 0.8)) / (n - 1));
};

/** Shed frame: centre, long-axis unit vector, length and width (long axis between the short sides). */
function shedFrame(s: Ring): { cx: number; cz: number; lx: number; lz: number; L: number; W: number } {
  const m0 = [(s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2], m1 = [(s[4]! + s[6]!) / 2, (s[5]! + s[7]!) / 2];
  const L = Math.hypot(m1[0]! - m0[0]!, m1[1]! - m0[1]!);
  return { cx: (m0[0]! + m1[0]!) / 2, cz: (m0[1]! + m1[1]!) / 2, lx: (m1[0]! - m0[0]!) / L, lz: (m1[1]! - m0[1]!) / L, L, W: Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!) };
}

/**
 * Every bike in the dorm parking rows and sheds — all rideable (the bike system draws and rides them)
 * — plus the scooter (faster than a bike), parked in the bays beside the 警衛室 by 技職大樓.
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
      // All parallel, square to the row (使用者：腳踏車請平行排列).
      out.push({ x: ax + ux * t, z: az + uz * t, yaw: Math.atan2(-uz, ux) + Math.PI / 2 + facing, kind: 'bike' });
    }
  };
  for (const r of BIKE_ROWS) for (let i = 0; i + 3 < r.length; i += 2) row(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!, 0.75, 0);
  for (const sh of SHEDS) {
    const f = shedFrame(sh);
    const toWorld = (a: number, b: number): [number, number] => [f.cx + f.lx * a - f.lz * b, f.cz + f.lz * a + f.lx * b];
    // Entrance at the north end (local −x): the hatch and shrub beds keep the first metres clear.
    const cols = shedColumnsX(f.L);
    for (const side of [-1, 1]) for (const zr of shedRows(f.W)) {
      for (let a = -f.L / 2 + SHED.entry + 0.3; a < f.L / 2 - 0.4; a += SHED.step) {
        if (rnd() < 0.08 || cols.some((c) => Math.abs(c - a) < 0.35)) continue;
        const [x, z] = toWorld(a, side * zr);
        out.push({ x, z, yaw: Math.atan2(-f.lz, f.lx) + Math.PI / 2 + (side > 0 ? Math.PI : 0), kind: 'bike' });
      }
    }
  }
  // 使用者：摩托車移至警衛室旁 — on the open side of 「機車停車格（警衛室旁）」's fence, just north of the 警衛室 (技職大樓).
  out.push({ x: -103.4, z: -45.2, yaw: 0, kind: 'scooter' });
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
  // 使用者 C1 照片（2026-11-24）：台階在陽台塔正前方，整個斜面那麼寬；大廳玻璃（shop，沿斜面從轉角量起）在塔下。
  platform: { start: 0.25, end: 7.0, depth: 2.2, top: 0.45, rise: 0.15, tread: 0.35, steps: 3 },
  shop: [1.95, 5.85] as const,
  lamp: [5.0, 321.4] as const,
  shrub: [2.7, 322.4] as const,
};
/** 學生宿舍D 前門's courtyard side: C_FRONT mirrored onto D (the walk and platform sizes are the same). */
const D_FRONT: typeof C_FRONT = {
  ...C_FRONT,
  plaza: C_FRONT.plaza.map(toD) as unknown as typeof C_FRONT.plaza,
  faces: C_FRONT.faces.map(toD) as unknown as typeof C_FRONT.faces,
  lamp: toD(C_FRONT.lamp) as unknown as typeof C_FRONT.lamp,
  shrub: toD(C_FRONT.shrub) as unknown as typeof C_FRONT.shrub,
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
  // … and its mirrored copy at 學生宿舍D.
  out.push(band(...toD([9.7, 323.5]), ...toD([-19.2, 331.6]), 3.5), D_FRONT.plaza.flatMap(([x, z]) => [x, z]));
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
  const firePipeRed = mat(0xc0322b, { roughness: 0.45, metalness: 0.2 });
  const kickGreen = mat(0x3f7f4a, { roughness: 0.7 });
  const footpath = mat(0xa8a69f, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
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
  const cFrontApproach = (FR: typeof C_FRONT, cx: number, cz: number, mx: number, mz: number): void => {
    const { walk, platform: P } = FR;
    const lx = -mz, lz = mx; // across the walk
    const at = (t: number, l: number): [number, number] => [cx + mx * t + lx * l, cz + mz * t + lz * l];
    // UVs across (u) and along (v) the walk so the red bands run crosswise.
    decal([at(walk.from, -walk.half), at(walk.to, -walk.half), at(walk.to, walk.half), at(walk.from, walk.half)], 0.036, walkPavers,
      (x, z) => [(x - cx) * lx + (z - cz) * lz, (x - cx) * mx + (z - cz) * mz]);
    decal(FR.plaza, 0.03, plazaPavers);
    // Entrance platform along the two faces, three steps round the free sides (outline offset by d).
    const [f0, f1, f2] = FR.faces;
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
    // The lobby glass on the long face, under C1's balcony tower. 使用者正面照（2026-11-24）：門旁那面（gate side）是素面牆，沒有玻璃門。
    const [sh0, sh1] = FR.shop;
    panel(f1, d2, o2, sh0 - 0.1, sh1 + 0.1, P.top, P.top + 2.9, 0, 0.08, frameGrey);
    panel(f1, d2, o2, sh0, sh1, P.top + 0.4, P.top + 2.8, 0.08, 0.02, glass);
    for (let s = sh0; s <= sh1 + 1e-6; s += (sh1 - sh0) / 4) panel(f1, d2, o2, s - 0.03, s + 0.03, P.top + 0.4, P.top + 2.8, 0.1, 0.03, frameGrey);
    panel(f1, d2, o2, sh0, sh1, P.top, P.top + 0.4, 0.08, 0.03, kickGreen); // green kick plate (照片)
    // Black lamppost with a box head, and a shrub, on the grass strip by the north wing.
    const [lpx, lpz] = FR.lamp;
    const post = new Mesh(tracker.geometry(merged([box(0.12, 3.6, 0.12, 0, 1.8, 0), box(0.34, 0.42, 0.34, 0, 3.75, 0), box(0.3, 0.3, 0.3, 0, 0.15, 0)])), black);
    post.position.set(lpx, 0, lpz);
    post.castShadow = true;
    root.add(post);
    const head = new Mesh(tracker.geometry(box(0.26, 0.08, 0.26, 0, 3.52, 0)), globeMat);
    head.position.set(lpx, 0, lpz);
    root.add(head);
    solid(lpx, 1.8, lpz, 0.1, 1.8, 0.1, 0);
    const [shx, shz] = FR.shrub;
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
  // Plain walls closing the third gap of each three-wing group, and the stubs.
  const plainWalls: { d: number; p: [number, number]; q: [number, number] }[] = [];
  for (const [ia, ib] of CLOSED_GAPS) {
    const A = dorms.find((b) => b.id === ia), B = dorms.find((b) => b.id === ib);
    if (!A || !B) continue;
    const oa = outline(A.outer), ob = outline(B.outer);
    let best: { d: number; p: [number, number]; q: [number, number] } | null = null;
    for (const p of oa) for (const q of ob) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, p, q };
    }
    if (best && best.d >= 0.4 && best.d <= 25) plainWalls.push(best);
  }
  for (const [p, q] of WALL_STUBS) plainWalls.push({ d: Math.hypot(q[0] - p[0], q[1] - p[1]), p: [p[0], p[1]], q: [q[0], q[1]] });
  for (const best of plainWalls) {
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

  // 學生宿舍B 圍牆短段: the gate walls' style (cream wall, grey plinth and coping) with one or two red lattice panels.
  for (const [p, q] of LATTICE_STUBS) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / d, uz = (q[1] - p[1]) / d;
    const cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2, yaw = Math.atan2(-uz, ux), w = d + 0.1;
    const grp = new Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = yaw;
    root.add(grp);
    const put = (geo: BufferGeometry, m: MeshStandardMaterial): void => {
      const mesh = new Mesh(tracker.geometry(geo), m);
      mesh.castShadow = mesh.receiveShadow = true;
      grp.add(mesh);
    };
    put(box(w, WALL_H, WALL_T, 0, WALL_H / 2, 0), cream);
    put(box(w, 0.2, WALL_T + 0.06, 0, 0.1, 0), plinth);
    put(box(w + 0.04, 0.13, WALL_T + 0.18, 0, WALL_H + 0.065, 0), plinth);
    const PP = PORTAL.panel, n = w >= 3.6 ? 2 : 1;
    for (let k = 0; k < n; k++) put(box(PP, 1.8, WALL_T + 0.03, n === 1 ? 0 : (k === 0 ? -1 : 1) * w / 4, 1.1, 0), lattice);
    solid(cx, WALL_H / 2, cz, w / 2, WALL_H / 2, WALL_T / 2 + 0.05, yaw);
  }

  for (const g of DORM_GATES) {
    const mx = (g.a[0] + g.b[0]) / 2, mz = (g.a[1] + g.b[1]) / 2;
    const br = g.ends ? { p: [g.ends[0][0], g.ends[0][1]] as [number, number], q: [g.ends[1][0], g.ends[1][1]] as [number, number] } : bridge(mx, mz);
    if (!br) continue;
    const span = Math.hypot(br.q[0] - br.p[0], br.q[1] - br.p[1]);
    if (span < GATE_W + 1.5) continue;
    const ux = (br.q[0] - br.p[0]) / span, uz = (br.q[1] - br.p[1]) / span;
    const sh = g.shift ?? 0;
    const cx = (br.p[0] + br.q[0]) / 2 + ux * sh, cz = (br.p[1] + br.q[1]) / 2 + uz * sh;
    const left = span / 2 + sh - 0.05, right = span / 2 - sh - 0.05;
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
      /** Half-width of what stands in the gap: the gatehouse, or (barred) the gate between its two piers. */
      const BO = 3.0, BP = 0.5, inner = g.barred ? BO / 2 + BP : PW / 2;
      for (const [s0, s1, dir] of [[-left, -inner, -1], [inner, right, 1]] as const) {
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
          const near = inner + 0.05 + k * (PP + pier), far = near + PP;
          add(box(PP, 1.8, WALL_T + 0.03, dir * (near + far) / 2, 1.1, 0), lattice);
        }
        const [wx, wz] = world(mid, 0);
        solid(wx, WALL_H / 2, wz, w / 2, WALL_H / 2, WALL_T / 2 + 0.05, yaw);
      }
      if (g.barred) {
        // Two cream piers with a grey cap, and a pale-blue barred double gate fixed between them (照片).
        for (const s of [-1, 1]) {
          add(box(BP, WALL_H + 0.35, BP, s * (BO / 2 + BP / 2), (WALL_H + 0.35) / 2, 0), cream);
          add(box(BP + 0.08, 0.12, BP + 0.08, s * (BO / 2 + BP / 2), WALL_H + 0.41, 0), plinth);
          const [px, pz] = world(s * (BO / 2 + BP / 2), 0);
          solid(px, (WALL_H + 0.35) / 2, pz, BP / 2, (WALL_H + 0.35) / 2, BP / 2, yaw);
        }
        const LW2 = BO / 2 - 0.04, bars: BufferGeometry[] = [];
        for (const s of [-1, 1]) {
          const c = s * (LW2 / 2 + 0.02);
          for (const y of [0.12, 0.95, 1.95]) bars.push(box(LW2, 0.05, 0.05, c, y, 0));
          for (const x of [c - LW2 / 2 + 0.03, c + LW2 / 2 - 0.03]) bars.push(box(0.05, 1.9, 0.05, x, 1.05, 0));
          for (let k = 1; k < 10; k++) bars.push(box(0.025, 1.8, 0.025, c - LW2 / 2 + (LW2 * k) / 10, 1.05, 0));
        }
        bars.push(box(0.1, 0.2, 0.06, 0, 1.0, 0.04));
        add(merged(bars), mat(0x3d8fd6, { metalness: 0.3, roughness: 0.45 })); // bright blue (照片)
        const [lx, lz] = world(0, 0);
        solid(lx, 1.05, lz, BO / 2, 1.05, 0.12, yaw);
        continue;
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
      if (g.locked) {
        // White square-grid iron gate fixed in the opening (照片：打不開): frame, bars both ways, always blocking.
        const bars: BufferGeometry[] = [
          box(GO - 0.1, 0.06, 0.06, 0, 0.1, 0), box(GO - 0.1, 0.06, 0.06, 0, 2.1, 0),
          box(0.06, 2.06, 0.06, -GO / 2 + 0.08, 1.1, 0), box(0.06, 2.06, 0.06, GO / 2 - 0.08, 1.1, 0), box(0.05, 2.0, 0.05, 0, 1.1, 0),
        ];
        for (let x = -GO / 2 + 0.25; x < GO / 2 - 0.15; x += 0.17) bars.push(box(0.025, 1.95, 0.025, x, 1.1, 0));
        for (let y = 0.3; y < 2.05; y += 0.17) bars.push(box(GO - 0.16, 0.025, 0.025, 0, y, 0));
        add(merged(bars), white);
        const [lx, lz] = world(0, 0);
        solid(lx, 1.1, lz, GO / 2, 1.1, 0.12, yaw);
        continue;
      }
      // Pale-blue gate: a plated left leaf (the door) and a barred right half, hinged at the jambs. 使用者（2026-11-24）：
      // 只有門那一扇會開闔，藍色柵欄那一半是固定的——only the left leaf swings into the courtyard; the barred half stays
      // shut and always blocks. Each leaf is built in its hinge's frame, running from the hinge (x = 0) toward the middle.
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
      for (const [hx, parts, sign, moves] of [[-hinge, leftParts, -inward, true], [hinge, rightParts, inward, false]] as const) {
        const pivot = new Group();
        pivot.position.set(hx, 0, 0);
        grp.add(pivot);
        const m = new Mesh(tracker.geometry(merged(parts)), paleBlue);
        m.castShadow = true;
        pivot.add(m);
        // Hinge pins on the jamb.
        for (const y of [0.35, 1.7]) add(box(0.06, 0.12, 0.06, hx + Math.sign(hx) * 0.01, y, 0), paleBlue);
        if (moves) leaves.push({ pivot, sign });
      }
      // The fixed barred half always blocks.
      const [fx, fz] = world(GO / 4, 0);
      solid(fx, 1.0, fz, GO / 4, 1.0, 0.12, yaw);
      swing = (t) => { for (const l of leaves) l.pivot.rotation.y = l.sign * t * SWING; };
      if (g.firePipe) {
        // Red fire-main pipe along the wall foot on the outside, on small grey saddles, either side of the gatehouse.
        const pz = -inward * (WALL_T / 2 + 0.12);
        for (const [s0, s1] of [[-left, -PW / 2], [PW / 2, right]] as const) {
          const w = s1 - s0;
          if (w < 0.3) continue;
          add(new CylinderGeometry(0.075, 0.075, w, 12).rotateZ(Math.PI / 2).translate((s0 + s1) / 2, 0.3, pz), firePipeRed);
          for (let x = s0 + 0.4; x < s1 - 0.2; x += 2.2) add(box(0.12, 0.22, 0.2, x, 0.11, pz), plinth);
        }
        // Plain concrete footpath through the gate: out across the grass, and a short way in.
        const walk = new Mesh(tracker.geometry(new PlaneGeometry(1.4, 12).rotateX(-Math.PI / 2).translate(0, 0.04, -inward * 4.2)), footpath);
        walk.receiveShadow = true;
        grp.add(walk);
      }
      // `leaf` stays as the sliding-leaf handle for the shared code below; the swing replaces the slide.
      leaf = new Mesh();
      light = add(box(0.12, 0.12, 0.05, -GO / 2 - 0.2, PL - 0.15, PD / 2 + 0.03), sensorRed);
    }
    leaf.position.set(0, 0, leafZ);
    // The portal gate's block covers only its swinging door (the left half); the barred half has its own solid.
    const [gx, gz] = world(g.portal ? -GW / 4 : 0, leafZ);
    const block = physics.createCollider(RAPIER.ColliderDesc.cuboid(g.portal ? GW / 4 : GW / 2, 1.0, 0.12).setTranslation(gx, 1.0, gz)
      .setRotation((() => { const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw); return { x: q.x, y: q.y, z: q.z, w: q.w }; })()));
    colliders.push(block);
    // Swing leaves travel about a quarter circle at their tips.
    gates.push({ x: g.portal ? world(-GW / 4, 0)[0] : cx, z: g.portal ? world(-GW / 4, 0)[1] : cz, leaf, light, block, open: 0, target: 0, travel: swing ? (GW / 2) * SWING : GW + 0.55, swing });
    // Pavers through the gate (both sides); the portal gate's walk runs through instead.
    if (!g.portal) {
      const path = new Mesh(tracker.geometry(new PlaneGeometry(GATE_W - 0.4, 14).rotateX(-Math.PI / 2).translate(0, 0.035, 0)), pavers);
      (path.geometry.attributes.uv!.array as Float32Array).forEach((v, i, arr) => { arr[i] = v * (i % 2 === 0 ? 2 : 7); });
      path.receiveShadow = true;
      grp.add(path);
    }
    if (g.approach) {
      // Way into the courtyard: the side of the wall the mark's start lies on.
      const nx = -uz, nz = ux, inward = (g.a[0] - cx) * nx + (g.a[1] - cz) * nz > 0 ? 1 : -1;
      cFrontApproach(g.site === 'D' ? D_FRONT : C_FRONT, cx, cz, inward * nx, inward * nz);
    }
  }

  // --- Sheds (teal steel, after the user's photos) ------------------------------------------------
  const teal = mat(0x56c2b2, { roughness: 0.6, metalness: 0.15 });
  const tealDark = mat(0x3f9d90, { roughness: 0.6, metalness: 0.15 });
  const sheet = tracker.material(new MeshStandardMaterial({
    map: canvas(tracker, 64, 64, (g) => {
      for (let x = 0; x < 64; x++) { const v = 150 + Math.round(40 * Math.sin((x / 64) * Math.PI * 8)); g.fillStyle = `rgb(${v},${v + 4},${v + 6})`; g.fillRect(x, 0, 1, 64); }
    }),
    roughness: 0.55, metalness: 0.3,
  }));
  sheet.map!.repeat.set(60, 1); // corrugation every ~35 cm along the shed
  const asphalt = mat(0x55585a, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const paint = mat(0xe8e6dc, { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 });
  const granite = mat(0xc9c7c1, { roughness: 0.85 });
  const pebble = tracker.material(new MeshStandardMaterial({
    map: canvas(tracker, 64, 64, (g) => {
      g.fillStyle = '#8d8a83'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 700; i++) { g.fillStyle = ['#5f5c57', '#b7b3aa', '#746f68', '#d6d2c8'][i % 4]!; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
    }),
    roughness: 0.95,
  }));
  const tube = mat(0xffffff, { emissive: 0xf2fff8, emissiveIntensity: 1.2 });
  const grass = mat(0x55883c, { roughness: 1 });
  const shrubGreen = mat(0x3f7c34, { roughness: 0.9, flatShading: true });
  const shrubRed = mat(0x8a3a3a, { roughness: 0.9, flatShading: true });
  const hatch = tracker.material(new MeshStandardMaterial({
    map: (() => {
      const t = canvas(tracker, 512, 384, (g) => {
        g.clearRect(0, 0, 512, 384);
        g.strokeStyle = '#e8b52a'; g.lineWidth = 12; g.lineJoin = 'round';
        g.strokeRect(14, 14, 484, 356);
        // Zigzags along the long sides, diagonal hatching at the ends.
        for (const y of [70, 314]) {
          g.beginPath();
          for (let i = 0; i <= 8; i++) g.lineTo(110 + i * 36.5, y + (i % 2 ? (y < 192 ? -40 : 40) : 0));
          g.stroke();
        }
        for (const x0 of [14, 410]) {
          for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x0, 14 + k * 90); g.lineTo(x0 + 88, 104 + k * 90); g.stroke(); g.beginPath(); g.moveTo(x0 + 88, 14 + k * 90); g.lineTo(x0, 104 + k * 90); g.stroke(); }
        }
        g.fillStyle = '#e8b52a'; g.textAlign = 'center';
        g.font = 'bold 58px "PingFang TC","Noto Sans TC",sans-serif';
        g.fillText('禁 止 停 車', 256, 182);
        g.font = 'bold 50px sans-serif';
        g.fillText('NO PARKING', 256, 250);
      });
      t.wrapS = t.wrapT = 1001; // ClampToEdgeWrapping
      return t;
    })(),
    transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12,
  }));
  const signMat = tracker.material(new MeshStandardMaterial({
    map: canvas(tracker, 256, 96, (g) => {
      g.fillStyle = '#7a2a28'; g.fillRect(0, 0, 256, 96);
      g.strokeStyle = '#f1e7da'; g.lineWidth = 4; g.strokeRect(6, 6, 244, 84);
      g.fillStyle = '#f6efe4'; g.textAlign = 'center';
      g.font = 'bold 34px "PingFang TC","Noto Sans TC",sans-serif'; g.fillText('腳踏車停車場', 128, 50);
      g.font = '18px sans-serif'; g.fillText('Bicycle parking area', 128, 78);
    }),
    roughness: 0.6,
  }));
  const shrubGeo = new IcosahedronGeometry(0.4, 0);
  for (const s of SHEDS) {
    const { cx, cz, lx, lz, L, W: Wd } = shedFrame(s);
    const yaw = Math.atan2(-lz, lx);
    const grp = new Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = yaw; // local +x = long axis (south), entrance at −x
    root.add(grp);
    const toW = (a: number, b: number): [number, number] => [cx + lx * a - lz * b, cz + lz * a + lx * b];
    const addM = (parts: BufferGeometry[], m: MeshStandardMaterial, shadow = true): void => {
      const mesh = new Mesh(tracker.geometry(merged(parts)), m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      grp.add(mesh);
    };
    const X0 = -L / 2, xs = shedColumnsX(L), zs = shedColumnsZ(Wd);
    // Two roofs: the west half lower than the east half (the photo's step between the two sheds).
    const halves = [{ z0: -Wd / 2, z1: 0, h: 2.75 }, { z0: 0, z1: Wd / 2, h: 3.1 }];
    const tealParts: BufferGeometry[] = [], darkParts: BufferGeometry[] = [], sheetParts: BufferGeometry[] = [], tubes: BufferGeometry[] = [];
    for (const z of zs) {
      const h = (z < 0 ? halves[0]! : halves[1]!).h;
      for (const x of xs) {
        tealParts.push(box(0.4, h, 0.4, x, h / 2, z));
        const [wx, wz] = toW(x, z);
        solid(wx, h / 2, wz, 0.2, h / 2, 0.2, yaw);
      }
      tealParts.push(box(L + 0.8, 0.42, 0.26, 0, h + 0.21, z)); // main I-beam along the shed
    }
    for (const hf of halves) {
      const w = hf.z1 - hf.z0, zc = (hf.z0 + hf.z1) / 2;
      for (const x of xs) darkParts.push(box(0.24, 0.34, w + 0.6, x, hf.h + 0.17, zc)); // cross girders
      for (let x = -L / 2 - 0.3; x <= L / 2 + 0.3; x += 1.05) tealParts.push(box(0.12, 0.3, w + 1.1, x, hf.h + 0.57, zc)); // ribs
      sheetParts.push(box(L + 1.0, 0.04, w + 1.2, 0, hf.h + 0.74, zc));
      for (let x = -L / 2 + 2; x < L / 2 - 1; x += 4.6) tubes.push(box(1.2, 0.05, 0.08, x, hf.h - 0.02, zc));
    }
    addM(tealParts, teal);
    addM(darkParts, tealDark);
    addM(sheetParts, sheet);
    addM(tubes, tube, false);
    // Floor: asphalt with the aisle lines; the hatched box at the entrance.
    const floor = new Mesh(tracker.geometry(new PlaneGeometry(L, Wd).rotateX(-Math.PI / 2).translate(0, 0.03, 0)), asphalt);
    floor.receiveShadow = true;
    grp.add(floor);
    const lines: BufferGeometry[] = [];
    for (const zl of [-SHED.aisle, SHED.aisle]) lines.push(new PlaneGeometry(L - SHED.entry, 0.1).rotateX(-Math.PI / 2).translate(SHED.entry / 2, 0.035, zl));
    addM(lines, paint, false);
    const hb = new Mesh(tracker.geometry(new PlaneGeometry(3.9, 2.9).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(X0 + 1.85, 0.04, 0)), hatch);
    grp.add(hb);
    // Threshold: two granite steps between washed-pebble curbs, at the outer edge of the entrance.
    addM([box(0.4, 0.12, 3.2, X0 + 0.2, 0.06, 0), box(0.4, 0.06, 3.2, X0 + 0.6, 0.03, 0)], granite);
    for (const side of [-1, 1]) {
      addM([box(0.9, 0.36, 0.7, X0 + 0.45, 0.18, side * 1.95)], pebble);
      const [wx, wz] = toW(X0 + 0.45, side * 1.95);
      solid(wx, 0.18, wz, 0.45, 0.18, 0.35, yaw);
      // Shrub beds either side of the hatch: grass, green and red-leaf shrubs.
      const z0 = 2.4, z1 = Wd / 2 - 0.2, zc = side * (z0 + z1) / 2;
      addM([box(SHED.entry - 0.3, 0.06, z1 - z0, X0 + SHED.entry / 2, 0.03, zc)], grass, false);
      const g1: BufferGeometry[] = [], g2: BufferGeometry[] = [];
      for (let x = X0 + 0.6; x < X0 + SHED.entry - 0.4; x += 0.9) for (let z = z0 + 0.4; z < z1 - 0.2; z += 1.0) {
        ((Math.round(x * 3 + z * 7) & 1) ? g1 : g2).push(shrubGeo.clone().scale(1, 0.9 + ((x * 13 + z) % 0.4), 1).translate(x, 0.4, side * z));
      }
      if (g1.length) addM(g1, shrubGreen);
      if (g2.length) addM(g2, shrubRed);
    }
    // 「腳踏車停車場」 sign hanging off the front girder.
    const sign = new Mesh(tracker.geometry(new PlaneGeometry(1.4, 0.52).rotateY(-Math.PI / 2).translate(X0 - 0.02 + 0.4 - 0.15, 2.3, -Wd / 4)), signMat);
    grp.add(sign);
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
