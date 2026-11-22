import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
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
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';
import type { CampusData, Ring } from '../campus/campusTypes';
import { DOOR_HEIGHT, DOOR_WIDTH } from '../campus/entrances';
import { DORM_C_BALCONY as BAL } from '../campus/customFacades';

/**
 * 學生宿舍C 北棟（OSM 296668596，U 形）中段面向 C 中庭的南面，依使用者實拍＋遊戲截圖與小地圖（紅色箭頭：從中庭往北看，2026-11-22）：
 *  - 2F–5F 中段兩片紅色花磚格柵（鏤空圓環磚）後面是一間洗衣陽台（使用者室內照）：外牆挖開（CUSTOM_FACADE_OPENINGS）、
 *    往室內深 DORM_C_BALCONY.depth；白色方磚地、兩端牆下半白磁磚與磁磚洗手台（三個水龍頭）、後牆兩扇木門、
 *    門旁矮隔牆、四台洗衣機（靠門那台墊高）、中間上下各兩扇窗（下排有鐵窗花）、天花板深藍色曬衣桿、日光燈、不鏽鋼曬衣架。
 *    門是裝飾，陽台本身走不進去（描圖平面在這裡是寢室與儲藏室）。
 *  - 中段（edge 13，比兩側往中庭凸出約 2 m）：洗石子混凝土外框往外凸 0.9 m，由左到右
 *    端柱 | 窗列（每層深窗洞、冷氣機）| 柱 | 紅褐磁磚凹陽台（實心矮牆、內牆紅磚、落地門窗）| 中柱（細長窗）| 鏡射另一半。
 *    照片右半被樹擋住，依使用者說明與左半對稱。
 *  - 一樓：整排深色出挑雨遮梁，梁正面藍綠色「C」；中間玻璃門廳（棕框雙開門、上排氣窗），兩側深色玻璃、綠色踢腳板。
 *  - 門前：四階台階上到平台（前方與左側都有台階），右側斜向石砌花台與盆栽；地面灰色地磚，中線一條紅磚帶。
 *  - 兩側退縮的牆段（西 edge 15、東 edge 11 在東翼旁的凹口內）與轉角短牆（edge 14、12）：同色混凝土框、每層窗洞與遮陽板，
 *    一樓深色玻璃店面。遊戲可進入的門（描圖資料）都在北面，中段的門是裝飾。
 * 外皮貼在 OSM 外牆外側（程序立面的遮陽板等細節由 CUSTOM_FACADE_EDGES 略過），每面牆一個座標系：
 * 原點在「從外面看的左端」，+x 往右、+z 朝外、+y 向上。
 */

// ---------------------------------------------------------------- anchors and dimensions (m)
const BUILDING = 296668596;
/** Edges drawn here and their expected endpoints (vertex i, vertex i+1): skipped if the data moved. */
const EDGES = {
  westWing: { i: 15, a: [-21.7, 311.8], b: [-30.8, 313.4] },
  westReturn: { i: 14, a: [-21.4, 313.7], b: [-21.7, 311.8] },
  centre: { i: 13, a: [-8.4, 311.4], b: [-21.4, 313.7] },
  eastReturn: { i: 12, a: [-8.9, 308.8], b: [-8.4, 311.4] },
  eastWing: { i: 11, a: [-4.7, 308.1], b: [-8.9, 308.8] },
} as const;
/** Real entrances on these edges (public/data/buildings/traced.json: metres from vertex i). None: they are all on the north face. */
const DOORS: Readonly<Record<number, readonly number[]>> = {};

const H = 18; // eaves (OSM height)
const TOP = 19; // top of the parapet band (the procedural parapet is 1 m)
const FLOORS = [3.6, 7.2, 10.8, 14.4]; // 2F–5F
/** Centre bay: frame depth, column widths from the left end (mirrored about the middle). */
const CENTRE = { depth: 0.9, endPier: 0.6, win: 1.8, pier: 0.8, middle: 0.8 };
/** Ground floor of the centre bay: canopy beam (bottom, top, depth), the lobby glass set back by `lobby`. */
const CANOPY = { y0: 2.85, y1: 3.58, depth: 1.5, lobby: 0.35 }; // top under the 2F balcony floor
/** Wings: frame depth, pier width, target bay width, sunshade depth. */
const WING = { depth: 0.45, pier: 0.6, bay: 3.4, shade: 0.8 };
/** Entrance terrace in front of the centre bay: depth from the wall, steps (count, rise, tread). */
const TERRACE = { depth: 3.2, steps: 4, rise: 0.14, tread: 0.35 };
const PLANTER = { width: 2.3, top: 0.75 };

/** No campus trees on the steps, planter and the paving in front. */
export function dormCFacadeTreeFree(campus: CampusData): Ring[] {
  const f = edgeFrame(campus, EDGES.centre);
  if (!f) return [];
  return [[f.world(-3, 0), f.world(f.len + 4, 0), f.world(f.len + 4, 9), f.world(-3, 9)].flat()];
}

// ---------------------------------------------------------------- wall frames
interface Frame { len: number; ox: number; oz: number; rx: number; rz: number; nx: number; nz: number; yaw: number; world(x: number, z: number): [number, number] }
function edgeFrame(campus: CampusData, e: { i: number; a: readonly number[]; b: readonly number[] }): Frame | null {
  const b = campus.buildings.find((x) => x.id === BUILDING);
  if (!b) return null;
  const r = b.outer, n = r.length / 2, j = (e.i + 1) % n;
  const px = r[e.i * 2]!, pz = r[e.i * 2 + 1]!, qx = r[j * 2]!, qz = r[j * 2 + 1]!;
  if (Math.hypot(px - e.a[0]!, pz - e.a[1]!) > 0.5 || Math.hypot(qx - e.b[0]!, qz - e.b[1]!) > 0.5) return null;
  const len = Math.hypot(qx - px, qz - pz), dx = (qx - px) / len, dz = (qz - pz) / len;
  // Outer rings are CCW: (dz, −dx) points out. Seen from outside, vertex i + 1 is on the left.
  const rx = -dx, rz = -dz, nx = dz, nz = -dx;
  return { len, ox: qx, oz: qz, rx, rz, nx, nz, yaw: Math.atan2(dz, -dx) /* local +x → (rx, rz), +z → (nx, nz) */, world: (x, z) => [qx + rx * x + nx * z, qz + rz * x + nz * z] };
}

// ---------------------------------------------------------------- geometry helpers
const span = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry =>
  new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
/** Box-projected UVs in metres / `scale`, so textures keep their size on every box. */
function uvBox(g: BufferGeometry, scale: number): BufferGeometry {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u / scale, v / scale);
  }
  return g;
}
function canvasTexture(tracker: ResourceTracker, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
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

// ---------------------------------------------------------------- textures
/** Exposed-aggregate concrete (洗石子): warm grey with dark and light pebbles. */
function aggregate(g: CanvasRenderingContext2D): void {
  const rnd = mulberry32(5922);
  g.fillStyle = '#aaa59b';
  g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) {
    const v = rnd();
    g.fillStyle = v < 0.45 ? '#8f8b83' : v < 0.8 ? '#c7c3ba' : '#77736c';
    const s = 1 + rnd() * 2.5;
    g.fillRect(rnd() * 256, rnd() * 256, s, s);
  }
  // Faint weathering streaks.
  g.fillStyle = 'rgba(70,66,60,0.06)';
  for (let k = 0; k < 10; k++) g.fillRect(rnd() * 256, 0, 3 + rnd() * 8, 256);
}
/** Terracotta breeze blocks (使用者照片): rows of interlocking rings, see-through between them (alpha cut-out). */
function latticeRings(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, 128, 128);
  for (let r = -1; r <= 4; r++) for (let i = -1; i <= 2; i++) {
    const cx = 32 + i * 64 + (r % 2 === 0 ? 0 : 32), cy = r * 32;
    g.lineWidth = 9;
    g.strokeStyle = '#9a4a35';
    g.beginPath(); g.arc(cx, cy, 27, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = '#6d3224'; // shadowed inner lip
    g.beginPath(); g.arc(cx, cy + 2, 21, 0.2, Math.PI - 0.2); g.stroke();
  }
}
/** Square floor tiles (0.3 m), pale grey with grout. */
function floorTile(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#8f908c';
  g.fillRect(0, 0, 64, 64);
  const tones = ['#c9cbc7', '#c2c4c0', '#cfd0cc', '#bdbfbb'];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = tones[x + y * 2]!; g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30); }
}
/** Small white wall tiles (0.15 m). */
function wallTile(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#c9c9c4';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2f2ee';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
}
/** Grey square pavers. */
function pavers(g: CanvasRenderingContext2D): void {
  const rnd = mulberry32(777);
  g.fillStyle = '#6f6b66';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = ['#a29e97', '#97938c', '#aaa69f', '#8e8a84'][Math.floor(rnd() * 4)]!;
    g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
  }
}
function letterC(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#4fa6b4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = "900 230px 'Arial Rounded MT Bold', system-ui, sans-serif";
  g.fillText('C', 128, 140);
}

// ---------------------------------------------------------------- build
export interface DormCFacade { dispose(): void }

export function createDormCFacade(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): DormCFacade {
  const root = new Group();
  root.name = '學生宿舍C south facade';
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];
  const mat = (color: number, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
  const concrete = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 256, aggregate), roughness: 0.95 }));
  const lattice = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 128, 128, latticeRings), alphaTest: 0.5, side: DoubleSide, roughness: 0.9 }));
  const floorTiles = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 64, 64, floorTile), roughness: 0.6 }));
  const wallTiles = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 64, 64, wallTile), roughness: 0.4 }));
  const steps = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 256, aggregate), color: 0xd8d6d0, roughness: 0.95 }));
  const paving = tracker.material(new MeshStandardMaterial({
    map: canvasTexture(tracker, 128, 128, pavers), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }));
  const brickBand = mat(0x9b4f42, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const glass = mat(0x26323a, { roughness: 0.12, metalness: 0.55 });
  const frameGrey = mat(0x50555b, { metalness: 0.4, roughness: 0.5 });
  const doorBrown = mat(0x6b4a33, { roughness: 0.6 });
  const kick = mat(0x5d8b3d, { roughness: 0.7 });
  const acWhite = mat(0xd9d8d2, { roughness: 0.6 });
  const stone = mat(0x958f84, { roughness: 0.95, flatShading: true });
  const soil = mat(0x4a3a2c, { roughness: 1 });
  const pot = mat(0xb35a3c, { roughness: 0.8 });
  const leaf = mat(0x497a32, { roughness: 0.9, flatShading: true });
  const notice = mat(0xf1efe6, { roughness: 0.7 });
  const paint = mat(0xe9e7e0, { roughness: 0.95 });
  const navy = mat(0x2d3852, { metalness: 0.5, roughness: 0.5 });
  const steel = mat(0xc4c8cc, { metalness: 0.7, roughness: 0.35 });
  const wood = mat(0x9a5b36, { roughness: 0.6 });
  const washer = mat(0xe6e6e0, { roughness: 0.45 });
  const panelDark = mat(0x7d8288, { roughness: 0.5 });
  const basin = mat(0xb9bcbc, { roughness: 0.4 });
  const black = mat(0x26282b, { metalness: 0.4, roughness: 0.6 });
  const tube = mat(0xffffff, { emissive: 0xf4f7ff, emissiveIntensity: 1.2 });
  const letter = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 256, letterC), transparent: true, roughness: 0.5 }));

  /** Per-frame geometry, merged into one mesh per material at the end. */
  const build = (f: Frame): { put(g: BufferGeometry, m: Material, uv?: number): void; solid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void; done(): void } => {
    const parts = new Map<Material, BufferGeometry[]>();
    const grp = new Group();
    grp.position.set(f.ox, 0, f.oz);
    grp.rotation.y = f.yaw;
    root.add(grp);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.yaw);
    return {
      put(g, m, uv) {
        const list = parts.get(m) ?? [];
        list.push(uv ? uvBox(g, uv) : g);
        parts.set(m, list);
      },
      solid(x0, x1, y0, y1, z0, z1) {
        const [wx, wz] = f.world((x0 + x1) / 2, (z0 + z1) / 2);
        colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
          .setTranslation(wx, (y0 + y1) / 2, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
      },
      done() {
        for (const [m, list] of parts) {
          const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
          if (!geo) continue;
          const mesh = new Mesh(tracker.geometry(geo), m);
          // Cut-out lattice would cast a solid shadow (no depth material), so it casts none.
          mesh.castShadow = !(m as MeshStandardMaterial).transparent && !(m as MeshStandardMaterial).alphaTest;
          mesh.receiveShadow = true;
          grp.add(mesh);
        }
      },
    };
  };

  /** Concrete skin over the OSM wall (2 cm out), leaving holes (x0, x1, y0, y1): doorways, the balconies. */
  const skin = (b: ReturnType<typeof build>, f: Frame, holes: readonly (readonly [number, number, number, number])[]): void => {
    const xs = [...new Set([0, f.len, ...holes.flatMap((h) => [h[0], h[1]])].filter((x) => x >= 0 && x <= f.len))].sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k++) {
      const s0 = xs[k]!, s1 = xs[k + 1]!, mid = (s0 + s1) / 2;
      let y = -0.3;
      for (const h of holes.filter((h) => h[0] <= mid && h[1] >= mid).sort((m, n) => m[2] - n[2])) {
        if (h[2] > y) b.put(span(s0, s1, y, h[2], 0.02, 0.06), concrete, 2);
        y = Math.max(y, h[3]);
      }
      if (y < H) b.put(span(s0, s1, y, H, 0.02, 0.06), concrete, 2);
    }
  };
  /** Breeze-block screen between x0..x1, y0..y1, centred at depth z (two faces 6 cm apart). */
  const latticePanel = (b: ReturnType<typeof build>, x0: number, x1: number, y0: number, y1: number, z: number): void => {
    const w = x1 - x0, h = y1 - y0, CELL = 0.5; // one texture tile: 2 × 4 rings about 0.22 m across
    for (const dz of [-0.03, 0.03]) {
      const g = new PlaneGeometry(w, h).translate((x0 + x1) / 2, (y0 + y1) / 2, z + dz);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / CELL, uv.getY(i) * h / CELL);
      b.put(g, lattice);
    }
    b.put(span(x0, x1, y0, y0 + 0.03, z - 0.05, z + 0.05), concrete, 2);
  };
  /** A window in a recess: frame, glass and a middle mullion on the wall plane. */
  const windowAt = (b: ReturnType<typeof build>, x0: number, x1: number, y0: number, y1: number): void => {
    b.put(span(x0, x1, y0, y1, 0.06, 0.1), glass);
    for (const x of [x0, (x0 + x1) / 2 - 0.025, x1 - 0.05]) b.put(span(x, x + 0.05, y0, y1, 0.06, 0.13), frameGrey);
    for (const y of [y0, y1 - 0.05, y0 + (y1 - y0) * 0.62]) b.put(span(x0, x1, y, y + 0.05, 0.06, 0.13), frameGrey);
  };
  const acUnit = (b: ReturnType<typeof build>, x: number, y: number): void => {
    b.put(span(x - 0.4, x + 0.4, y, y + 0.55, 0.06, 0.36), acWhite);
    b.put(span(x - 0.3, x + 0.3, y + 0.08, y + 0.47, 0.36, 0.37), frameGrey);
  };
  const seeded = mulberry32(296668592);

  /**
   * One laundry balcony (室內照): x0..x1 between the inner piers, from the back wall (z = −depth) to the
   * parapet (z = D − 0.2), floor at fy. Mirrored about the middle except the light and the drying rack.
   */
  const laundryRoom = (b: ReturnType<typeof build>, x0: number, x1: number, fy: number, D: number): void => {
    const zb = -BAL.depth, zf = D - 0.2, top = fy + BAL.height, mid = (x0 + x1) / 2;
    b.put(span(x0, x1, fy - 0.25, fy + 0.02, zb - 0.15, zf), floorTiles, 0.6);
    b.put(span(x0, x1, top - 0.03, top + 0.25, zb - 0.15, zf), paint, 2);
    b.put(span(x0, x1, fy, top, zb - 0.15, zb), paint, 2);
    for (const side of [-1, 1] as const) {
      // In this side's terms: `e` is the end wall, `at(d)` is d metres in from it.
      const e = side < 0 ? x0 : x1, at = (d: number): number => e - side * d;
      const sx = (d0: number, d1: number): [number, number] => [Math.min(at(d0), at(d1)), Math.max(at(d0), at(d1))];
      const box = (d0: number, d1: number, y0: number, y1: number, z0: number, z1: number, m: Material, uv?: number): void => {
        const [p, q] = sx(d0, d1);
        b.put(span(p, q, y0, y1, z0, z1), m, uv);
      };
      // End wall behind the pier line, then white tiles to 1.3 m and paint above, 1.5 cm proud of the pier face.
      box(-0.2, 0, fy, top, zb - 0.15, 0.02, paint, 2);
      box(0, 0.015, fy, fy + 1.3, zb, zf, wallTiles, 0.6);
      box(0, 0.012, fy + 1.3, top - 0.03, zb, zf, paint, 2);
      // Tiled sink along the end wall: trough on two legs, three taps.
      box(0.015, 0.6, fy + 0.55, fy + 0.82, zb + 0.05, zf - 0.3, wallTiles, 0.6);
      box(0.09, 0.52, fy + 0.82, fy + 0.83, zb + 0.12, zf - 0.37, basin);
      for (const z of [zb + 0.25, zf - 0.5]) box(0.25, 0.33, fy, fy + 0.55, z - 0.04, z + 0.04, steel);
      for (let k = 0; k < 3; k++) {
        const z = zb + 0.45 + k * ((zf - zb - 1.1) / 2);
        box(0.015, 0.14, fy + 1.0, fy + 1.04, z - 0.02, z + 0.02, steel);
        box(0.11, 0.14, fy + 0.94, fy + 1.04, z - 0.02, z + 0.02, steel);
      }
      // Wooden door into the building, a low partition, two washing machines (the one by the door on a stand).
      box(0.7, 1.6, fy, fy + 2.1, zb, zb + 0.04, wood);
      box(0.62, 1.68, fy + 2.1, fy + 2.16, zb, zb + 0.05, panelDark);
      box(1.45, 1.5, fy + 0.95, fy + 1.05, zb + 0.04, zb + 0.08, steel);
      box(1.75, 1.87, fy, fy + 1.15, zb, zb + 0.85, paint, 2);
      for (const [d, lift] of [[2.25, 0.25], [2.95, 0]] as const) {
        const y = fy + lift;
        if (lift) box(d - 0.32, d + 0.32, fy, y, zb + 0.03, zb + 0.67, washer);
        box(d - 0.3, d + 0.3, y, y + 0.85, zb + 0.05, zb + 0.65, washer);
        box(d - 0.3, d + 0.3, y + 0.85, y + 0.97, zb + 0.05, zb + 0.2, panelDark);
        box(d - 0.26, d + 0.26, y + 0.85, y + 0.86, zb + 0.24, zb + 0.61, basin);
      }
      // Back-wall windows over the machines: a lower pair with grilles, an upper pair.
      for (const [y0, y1, grille] of [[fy + 1.05, fy + 2.05, true], [fy + 2.4, fy + 3.1, false]] as const) {
        const [p, q] = sx(mid - x0 - 1.3, mid - x0 - 0.2);
        b.put(span(p, q, y0, y1, zb, zb + 0.02), glass);
        for (const yy of [y0, y1 - 0.05]) b.put(span(p, q, yy, yy + 0.05, zb, zb + 0.05), frameGrey);
        for (const xx of [p, q - 0.05]) b.put(span(xx, xx + 0.05, y0, y1, zb, zb + 0.05), frameGrey);
        if (grille) {
          for (let xx = p + 0.14; xx < q - 0.1; xx += 0.14) b.put(span(xx - 0.01, xx + 0.01, y0, y1, zb + 0.05, zb + 0.07), black);
          for (let yy = y0 + 0.14; yy < y1 - 0.1; yy += 0.14) b.put(span(p, q, yy - 0.01, yy + 0.01, zb + 0.05, zb + 0.07), black);
        }
      }
    }
    // Navy drying rails under the ceiling: three along the room, three across.
    for (const z of [zb + 0.4, (zb + zf) / 2, zf - 0.45]) b.put(span(x0, x1, top - 0.38, top - 0.33, z - 0.025, z + 0.025), navy);
    for (const x of [x0 + 1.2, mid, x1 - 1.2]) b.put(span(x - 0.03, x + 0.03, top - 0.33, top - 0.03, zb, zf), navy);
    // Fluorescent tube on the right-hand end wall.
    b.put(span(x1 - 0.07, x1 - 0.02, fy + 2.55, fy + 2.6, zb + 0.4, zb + 1.6), tube);
    // Stainless drying rack in front of the left-hand screen.
    const rz = zf - 0.55;
    for (const y of [fy + 1.1, fy + 1.45]) b.put(span(x0 + 1.0, x0 + 2.7, y, y + 0.03, rz - 0.015, rz + 0.015), steel);
    for (const x of [x0 + 1.05, x0 + 2.65]) for (const dz of [-0.2, 0.2]) b.put(span(x - 0.015, x + 0.015, fy, fy + 1.45, rz + dz - 0.015, rz + dz + 0.015), steel);
  };

  // --- Centre bay (edge 2) ------------------------------------------------------------------------
  const centre = edgeFrame(campus, EDGES.centre);
  if (centre) {
    const f = centre, L = f.len, D = CENTRE.depth, b = build(f);
    // Balcony room: frame x from the opening along the edge (a from vertex i → x = L − a).
    const X0 = L - BAL.a1, X1 = L - BAL.a0;
    skin(b, f, BAL.floors.map((y) => [X0, X1, y, y + BAL.height] as const));
    const { endPier: E, win: W, pier: P } = CENTRE;
    const B = (L - 2 * (E + W + P) - CENTRE.middle) / 2; // balcony width: the rest, with a slim middle column
    // Column layout from the left: [x0, x1, kind], mirrored about the middle.
    const half: [number, number, 'pier' | 'win' | 'balcony'][] = [];
    let x = 0;
    for (const [w, kind] of [[E, 'pier'], [W, 'win'], [P, 'pier'], [B, 'balcony']] as const) { half.push([x, x + w, kind]); x += w; }
    const cols = [...half, ...half.map(([a, c, k]) => [L - c, L - a, k] as [number, number, typeof k]).reverse()];
    const midX0 = x, midX1 = L - x;
    // Piers run from the ground (end piers, and the inner piers beside the lobby) to the top band.
    for (const [a, c, k] of cols) {
      if (k !== 'pier') continue;
      b.put(span(a, c, 0, H, 0.02, D), concrete, 2);
      b.solid(a, c, 0, CANOPY.y0, 0.02, D);
    }
    // Middle column: solid from the canopy up, a slim window per floor.
    b.put(span(midX0, midX1, CANOPY.y0, H, 0.02, D), concrete, 2);
    for (const fy of FLOORS) b.put(span((midX0 + midX1) / 2 - 0.14, (midX0 + midX1) / 2 + 0.14, fy + 0.9, fy + 2.6, D, D + 0.03), glass);
    for (const fy of FLOORS) {
      for (const [a, c, k] of cols) {
        if (k === 'win') {
          // Deep window: spandrel and head band at the frame face, glass on the wall plane, AC on some.
          b.put(span(a, c, fy - 0.25, fy + 0.9, 0.02, D), concrete, 2);
          b.put(span(a, c, fy + 2.6, fy + 3.35, 0.02, D), concrete, 2);
          windowAt(b, a, c, fy + 0.9, fy + 2.6);
          if (seeded() < 0.6) acUnit(b, (a + c) / 2, fy + 0.92);
        } else if (k === 'balcony') {
          // Laundry balcony front: a thin parapet with a tiled top, the breeze-block screen above it.
          b.put(span(a, c, fy - 0.25, fy + 1.0, D - 0.2, D), concrete, 2);
          b.put(span(a, c, fy + 1.0, fy + 1.03, D - 0.22, D + 0.01), wallTiles, 0.6);
          latticePanel(b, a, c, fy + 1.03, fy + BAL.height, D - 0.1);
        }
      }
    }
    for (const fy of BAL.floors) laundryRoom(b, X0, X1, fy, D);
    // Ground floor: side glass (green kick plates), the lobby set back, the canopy beam with the「C」.
    for (const [a, c, k] of cols) {
      if (k !== 'win') continue;
      b.put(span(a, c, 0, CANOPY.y0, 0.06, 0.1), glass);
      b.put(span(a, c, 0, 0.55, 0.1, 0.12), kick);
      for (const xm of [a, (a + c) / 2 - 0.03, c - 0.06]) b.put(span(xm, xm + 0.06, 0, CANOPY.y0, 0.06, 0.15), frameGrey);
      b.put(span(a, c, 2.3, 2.36, 0.06, 0.15), frameGrey);
    }
    const lob0 = E + W + P, lob1 = L - lob0, z = CANOPY.lobby;
    // Lobby: walls of glass from the canopy down, a transom, mullions, double doors in the middle.
    b.put(span(lob0, lob1, 0, CANOPY.y0, z, z + 0.04), glass);
    b.solid(lob0, lob1, 0, CANOPY.y0, 0.02, z + 0.04);
    b.put(span(lob0, lob1, 2.4, 2.46, z, z + 0.1), frameGrey);
    b.put(span(lob0, lob1, 0, 0.12, z, z + 0.1), frameGrey);
    const doorW = 2.0, dc = L / 2;
    for (let xm = lob0; xm <= lob1 + 1e-6; xm += (lob1 - lob0) / 5) {
      if (Math.abs(xm - dc) < doorW / 2 + 0.05) continue;
      b.put(span(xm - 0.04, xm + 0.04, 0, CANOPY.y0, z, z + 0.1), frameGrey);
    }
    for (const s of [-1, 1]) {
      const d0 = Math.min(dc, dc + s * doorW / 2), d1 = Math.max(dc, dc + s * doorW / 2);
      b.put(span(d0, d0 + 0.08, 0, 2.4, z, z + 0.12), doorBrown);
      b.put(span(d1 - 0.08, d1, 0, 2.4, z, z + 0.12), doorBrown);
      b.put(span(d0, d1, 2.32, 2.4, z, z + 0.12), doorBrown);
      b.put(span(d0, d1, 0.9, 0.98, z, z + 0.12), doorBrown);
      b.put(span(dc + s * 0.15 - 0.02, dc + s * 0.15 + 0.02, 0.9, 1.6, z + 0.12, z + 0.16), frameGrey); // pull handles
    }
    // Notice board on the left inner pier (photo: white sign by the lobby).
    b.put(span(lob0 - 0.65, lob0 - 0.2, 1.3, 1.75, D, D + 0.03), notice);
    // Canopy beam across the whole bay.
    b.put(span(-0.05, L + 0.05, CANOPY.y0, CANOPY.y1, 0.02, CANOPY.depth), concrete, 2);
    const sign = new PlaneGeometry(0.9, 0.9).translate(L / 2 - 1.5, (CANOPY.y0 + CANOPY.y1) / 2, CANOPY.depth + 0.01);
    b.put(sign, letter);
    // Top band and parapet over the whole bay.
    b.put(span(-0.05, L + 0.05, 17.6, TOP, 0.02, D + 0.05), concrete, 2);

    // Terrace and steps (front and left), planter on the right, paving with a red brick band.
    const { depth: TD, steps: N, rise: R, tread: T } = TERRACE;
    for (let k = 1; k <= N; k++) {
      const ext = (N - k) * T, top = k * R;
      b.put(span(-ext, L, 0, top, 0.02, TD + ext), steps, 1.5);
      b.solid(-ext, L, 0, top, 0.02, TD + ext);
    }
    const reach = TD + N * T;
    const tri = new Shape([new Vector2(L, 0.02), new Vector2(L + PLANTER.width, 0.02), new Vector2(L, reach)].map((p) => new Vector2(p.x, -p.y)));
    const planterGeo = new ExtrudeGeometry(tri, { depth: PLANTER.top, bevelEnabled: false }).rotateX(-Math.PI / 2);
    b.put(planterGeo, stone);
    const soilTri = new Shape([new Vector2(L + 0.15, 0.2), new Vector2(L + PLANTER.width - 0.45, 0.2), new Vector2(L + 0.15, reach - 0.7)].map((p) => new Vector2(p.x, -p.y)));
    b.put(new ShapeGeometry(soilTri).rotateX(-Math.PI / 2).translate(0, PLANTER.top + 0.01, 0), soil);
    {
      const v: number[] = [];
      for (const [px, pz] of [[L, 0.02], [L + PLANTER.width, 0.02], [L, reach]] as const) {
        const [wx, wz] = f.world(px, pz);
        v.push(wx, 0, wz, wx, PLANTER.top, wz);
      }
      const d = RAPIER.ColliderDesc.convexHull(new Float32Array(v));
      if (d) colliders.push(physics.createCollider(d));
    }
    // Potted plants on the planter and at the foot of the steps (photo: right-hand side).
    const potGeo = new CylinderGeometry(0.2, 0.15, 0.32, 12).translate(0, 0.16, 0);
    const bushGeo = new SphereGeometry(0.3, 8, 6).scale(1, 0.9, 1).translate(0, 0.5, 0);
    for (const [px, pz, py] of [[L + 0.45, 0.6, PLANTER.top], [L + 1.0, 0.45, PLANTER.top], [L + 0.4, 1.5, PLANTER.top], [L - 0.5, reach + 0.4, 0]] as const) {
      b.put(potGeo.clone().translate(px, py, pz), pot);
      b.put(bushGeo.clone().translate(px, py, pz), leaf);
    }
    // Paving in front, and the red brick band along the middle (the arrow in the photo).
    const pave = new PlaneGeometry(L + 3, 6).rotateX(-Math.PI / 2).translate(L / 2 - 1, 0.03, reach + 3);
    pave.getAttribute('uv').array.forEach((_, i, arr) => { (arr as Float32Array)[i] *= i % 2 === 0 ? (L + 3) / 2 : 3; });
    b.put(pave, paving);
    b.put(new PlaneGeometry(0.5, 6).rotateX(-Math.PI / 2).translate(L / 2, 0.035, reach + 3), brickBand);
    b.done();
  }

  // --- Wings (edges 0, 4) and the short returns (edges 1, 3) --------------------------------------
  for (const e of [EDGES.westWing, EDGES.eastWing]) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, Dw = WING.depth, b = build(f);
    // Doorways: metres from vertex i → this frame's x (from the left end).
    const gaps = (DOORS[e.i] ?? []).map((a) => [L - a - DOOR_WIDTH / 2, L - a + DOOR_WIDTH / 2] as [number, number]).sort((m, n) => m[0] - n[0]);
    const inGap = (x0: number, x1: number): boolean => gaps.some(([g0, g1]) => x1 > g0 && x0 < g1);
    skin(b, f, gaps.map(([g0, g1]) => [g0, g1, -0.3, DOOR_HEIGHT] as const));
    const nBay = Math.max(1, Math.round((L - WING.pier) / WING.bay));
    const step = (L - WING.pier) / nBay;
    for (let k = 0; k <= nBay; k++) {
      const a = k * step, c = a + WING.pier;
      const y0 = inGap(a, c) ? DOOR_HEIGHT + 0.2 : 0;
      b.put(span(a, c, y0, H, 0.02, Dw), concrete, 2);
      if (y0 === 0) b.solid(a, c, 0, 2.6, 0.02, Dw);
    }
    for (let k = 0; k < nBay; k++) {
      const a = k * step + WING.pier, c = (k + 1) * step;
      for (const fy of FLOORS) {
        b.put(span(a, c, fy - 0.25, fy + 0.9, 0.02, Dw), concrete, 2);
        b.put(span(a, c, fy + 2.5, fy + 3.35, 0.02, Dw), concrete, 2);
        b.put(span(a - 0.1, c + 0.1, fy + 2.5, fy + 2.6, Dw, WING.shade), concrete, 2); // sunshade
        windowAt(b, a, c, fy + 0.9, fy + 2.5);
        if (seeded() < 0.5) acUnit(b, a + 0.6 + seeded() * (c - a - 1.2), fy + 0.92);
      }
      // Ground floor: dark shop glass with a green kick plate, except across a real doorway.
      if (!inGap(a, c)) {
        b.put(span(a, c, 0, 2.9, 0.06, 0.1), glass);
        b.put(span(a, c, 0, 0.55, 0.1, 0.12), kick);
        for (const xm of [a, (a + c) / 2 - 0.03, c - 0.06]) b.put(span(xm, xm + 0.06, 0, 2.9, 0.06, 0.15), frameGrey);
      }
      b.put(span(a, c, 2.9, 3.35, 0.02, Dw), concrete, 2);
    }
    // Real doorway: a frame round the opening (the wall behind is open into the building).
    for (const [g0, g1] of gaps) {
      b.put(span(g0 - 0.12, g0, 0, DOOR_HEIGHT + 0.12, 0.02, 0.3), doorBrown);
      b.put(span(g1, g1 + 0.12, 0, DOOR_HEIGHT + 0.12, 0.02, 0.3), doorBrown);
      b.put(span(g0 - 0.12, g1 + 0.12, DOOR_HEIGHT, DOOR_HEIGHT + 0.12, 0.02, 0.3), doorBrown);
      b.put(span(g0, g1, DOOR_HEIGHT + 0.12, 3.35, 0.02, 0.08), glass);
    }
    b.put(span(-0.05, L + 0.05, 17.6, TOP, 0.02, Dw + 0.05), concrete, 2);
    b.done();
  }
  for (const e of [EDGES.westReturn, EDGES.eastReturn]) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, b = build(f);
    skin(b, f, []);
    for (const fy of [0, ...FLOORS]) {
      if (fy > 0) b.put(span(0, L, fy - 0.25, fy + 0.1, 0.02, 0.3), concrete, 2);
      b.put(span(L / 2 - 0.35, L / 2 + 0.35, fy + 0.9, fy + 2.5, 0.06, 0.1), glass);
    }
    b.put(span(-0.05, L + 0.05, 17.6, TOP, 0.02, 0.35), concrete, 2);
    b.done();
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}

