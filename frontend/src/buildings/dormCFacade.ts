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
import { DORM_C, DORM_C_BALCONY as BAL } from '../campus/customFacades';

/**
 * 學生宿舍C 北棟（OSM 296668596，U 形），依使用者實拍＋遊戲截圖與小地圖（2026-11-22）。載入時切成三塊
 * （campusFixes.ts `splitDormC`）：中段 4 層（14.4 m）、左右兩翼 3 層（10.8 m）。
 *  - 中段凸出部分（面向 C 中庭）：洗石子混凝土，兩端粗柱；2F–4F 每層一間長條洗衣陽台：前面薄矮牆（磁磚壓頂），
 *    中間一大片紅色鏤空圓環花磚，兩端各一段開口（白色水管柱、橫桿）。陽台往室內深 DORM_C_BALCONY.depth，
 *    外牆挖開（CUSTOM_FACADE_OPENINGS）：白色方磚地、兩端牆下半白磁磚與磁磚洗手台（三個水龍頭）、後牆兩端木門、
 *    門旁矮隔牆、洗衣機（靠門那台墊高）、中間上下各兩扇窗（下排鐵窗花）、天花板深藍色曬衣桿、日光燈、不鏽鋼曬衣架。
 *    門是裝飾，陽台走不進去（描圖平面在這裡是寢室與儲藏室）。
 *  - 一樓：整排出挑雨遮梁，梁正面藍綠色「C」；兩柱之間整面玻璃門廳、棕框雙開門。
 *  - 門前：四階台階上到平台（前方與左側都有台階），右側斜向石砌花台與盆栽；地面灰色地磚，中線一條紅磚帶。
 *  - 中段兩側退縮的牆段（西側 4 層；東側凹口內屬東翼，3 層）與轉角短牆：同色混凝土框、每層窗洞與遮陽板，一樓深色玻璃。
 *  - 兩翼（3 層，轉角照）：灰色混凝土牆基；面向中庭的端牆兩側各一列深框紅花磚格柵（每層一格、旁邊一段開口與白柱），
 *    中間每層窗戶加混凝土遮陽板、冷氣；長邊每層小窗與遮陽板，轉角一樓一格花磚。
 * 遊戲可進入的門（描圖資料）都在北面。外皮貼在 OSM 外牆外側（程序立面的遮陽板等細節由 CUSTOM_FACADE_EDGES 略過），
 * 每面牆一個座標系：原點在「從外面看的左端」，+x 往右、+z 朝外、+y 向上。
 */

// ---------------------------------------------------------------- anchors and dimensions (m)
type Anchor = { id: number; i: number; a: readonly [number, number]; b: readonly [number, number] };
/** Walls drawn here: building piece, edge, and its expected endpoints (vertex i, vertex i+1); skipped if the data moved. */
const EDGES = {
  // The front and west return as moved by splitDormC (one room further west than OSM).
  centre: { id: DORM_C.middle, i: 4, a: [-8.4, 311.4], b: [-24.75, 314.29] },
  westReturn: { id: DORM_C.middle, i: 5, a: [-24.75, 314.29], b: [-25.05, 312.39] },
  westFlank: { id: DORM_C.middle, i: 6, a: [-25.05, 312.39], b: [-30.8, 313.4] },
  eastReturn: { id: DORM_C.middle, i: 3, a: [-8.9, 308.8], b: [-8.4, 311.4] },
  eastFlank: { id: DORM_C.eastWing, i: 8, a: [-4.7, 308.1], b: [-8.9, 308.8] },
  eastWingEast: { id: DORM_C.eastWing, i: 3, a: [5.9, 304.0], b: [8.6, 319.3] },
  eastWingSouth: { id: DORM_C.eastWing, i: 4, a: [8.6, 319.3], b: [-4.6, 321.6] },
  eastWingWest: { id: DORM_C.eastWing, i: 5, a: [-4.6, 321.6], b: [-6.1, 312.9] },
  westWingEast: { id: DORM_C.westWing, i: 0, a: [-30.8, 313.4], b: [-29.4, 321.3] },
  westWingSouth: { id: DORM_C.westWing, i: 1, a: [-29.4, 321.3], b: [-42.3, 323.6] },
  westWingWest: { id: DORM_C.westWing, i: 2, a: [-42.3, 323.6], b: [-44.6, 310.4] },
} as const satisfies Record<string, Anchor>;

const STOREY = 3.6;
/** Eaves and upper floor levels of the 4-storey middle and the 3-storey wings. */
const MIDDLE = { H: DORM_C.middleLevels * STOREY, floors: [3.6, 7.2, 10.8] };
const WINGS = { H: DORM_C.wingLevels * STOREY, floors: [3.6, 7.2] };
const PARAPET = 1.0; // the band above the eaves (the procedural parapet is 1 m)
/** Centre bay: frame depth, end piers, the open bays at both ends of the balcony front (the lattice fills the rest). */
const CENTRE = { depth: 1.5, endPier: BAL.a0, open: 1.8 }; // the balcony's depth is the frame's (the room behind starts at the wall)
/** Ground floor of the centre bay: canopy beam (bottom, top, depth), the lobby glass set back by `lobby`. */
const CANOPY = { y0: 2.85, y1: 3.58, depth: 2.1, lobby: 0.35 }; // top under the 2F balcony floor
/** Flanks beside the centre bay: frame depth, pier width, target bay width, sunshade depth. */
const FLANK = { depth: 0.45, pier: 0.6, bay: 3.4, shade: 0.8 };
/** Wing faces: frame depth, pier, lattice bay width (incl. its open slot), slot width, window bay, hood depth, plinth top. */
const WING = { depth: 0.5, pier: 0.6, lattice: 3.0, slot: 0.7, bay: 2.6, hood: 0.6, plinth: 0.9 };
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
function edgeFrame(campus: CampusData, e: Anchor): Frame | null {
  const b = campus.buildings.find((x) => x.id === e.id);
  if (!b) return null;
  const r = b.outer, n = r.length / 2, j = (e.i + 1) % n;
  const px = r[e.i * 2]!, pz = r[e.i * 2 + 1]!, qx = r[j * 2]!, qz = r[j * 2 + 1]!;
  if (Math.hypot(px - e.a[0], pz - e.a[1]) > 0.5 || Math.hypot(qx - e.b[0], qz - e.b[1]) > 0.5) return null;
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
  const pipeWhite = mat(0xf0efe9, { roughness: 0.5 });
  const plinthGrey = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 256, aggregate), color: 0x9a9890, roughness: 0.95 }));
  const voidDark = mat(0x2b2d2f, { roughness: 1 });
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

  /** Concrete skin over the OSM wall (2 cm out) up to the eaves `H`, leaving holes (x0, x1, y0, y1) for the balconies. */
  const skin = (b: ReturnType<typeof build>, f: Frame, H: number, holes: readonly (readonly [number, number, number, number])[]): void => {
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
  /** A window on the wall plane: frame, glass and a middle mullion. */
  const windowAt = (b: ReturnType<typeof build>, x0: number, x1: number, y0: number, y1: number): void => {
    b.put(span(x0, x1, y0, y1, 0.06, 0.1), glass);
    for (const x of [x0, (x0 + x1) / 2 - 0.025, x1 - 0.05]) b.put(span(x, x + 0.05, y0, y1, 0.06, 0.13), frameGrey);
    for (const y of [y0, y1 - 0.05, y0 + (y1 - y0) * 0.62]) b.put(span(x0, x1, y, y + 0.05, 0.06, 0.13), frameGrey);
  };
  const acUnit = (b: ReturnType<typeof build>, x: number, y: number): void => {
    b.put(span(x - 0.4, x + 0.4, y, y + 0.55, 0.06, 0.36), acWhite);
    b.put(span(x - 0.3, x + 0.3, y + 0.08, y + 0.47, 0.36, 0.37), frameGrey);
  };
  /** White rainwater pipe from y0 to y1 at (x, z). */
  const pipe = (b: ReturnType<typeof build>, x: number, y0: number, y1: number, z: number): void => {
    b.put(new CylinderGeometry(0.05, 0.05, y1 - y0, 8).translate(x, (y0 + y1) / 2, z), pipeWhite);
  };
  const seeded = mulberry32(296668596);

  /**
   * One laundry balcony (室內照): x0..x1 between the end piers, from the back wall (z = −depth) to the
   * parapet (z = D − 0.2), floor at fy. Mirrored about the middle except the light and the drying racks.
   */
  const laundryRoom = (b: ReturnType<typeof build>, x0: number, x1: number, fy: number, D: number): void => {
    const zb = -BAL.depth, zf = D - 0.2, top = fy + BAL.height, mid = (x0 + x1) / 2;
    // Walls stop 2 cm behind the back wall's face: the dorm room on the other side starts there.
    b.put(span(x0, x1, fy - 0.25, fy + 0.02, zb - 0.02, zf), floorTiles, 0.6);
    b.put(span(x0, x1, top - 0.03, top + 0.25, zb - 0.02, zf), paint, 2);
    b.put(span(x0, x1, fy, top, zb - 0.02, zb), paint, 2);
    for (const side of [-1, 1] as const) {
      // In this side's terms: `e` is the end wall, `at(d)` is d metres in from it.
      const e = side < 0 ? x0 : x1, at = (d: number): number => e - side * d;
      const sx = (d0: number, d1: number): [number, number] => [Math.min(at(d0), at(d1)), Math.max(at(d0), at(d1))];
      const box = (d0: number, d1: number, y0: number, y1: number, z0: number, z1: number, m: Material, uv?: number): void => {
        const [p, q] = sx(d0, d1);
        b.put(span(p, q, y0, y1, z0, z1), m, uv);
      };
      // End wall behind the pier line, then white tiles to 1.3 m and paint above, 1.5 cm proud of the pier face.
      box(-0.2, 0, fy, top, zb - 0.02, 0.02, paint, 2);
      box(0, 0.015, fy, fy + 1.3, zb, zf, wallTiles, 0.6);
      box(0, 0.012, fy + 1.3, top - 0.03, zb, zf, paint, 2);
      // Tiled sink along the end wall (behind the open bay): trough on two legs, three taps.
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
      // Back-wall windows toward the middle: a lower pair with grilles, an upper pair.
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
      // Stainless drying rack behind the screen, between the machines and the windows.
      const rz = zf - 0.55;
      for (const y of [fy + 1.1, fy + 1.45]) box(2.2, 3.9, y, y + 0.03, rz - 0.015, rz + 0.015, steel);
      for (const d of [2.25, 3.85]) for (const dz of [-0.2, 0.2]) box(d - 0.015, d + 0.015, fy, fy + 1.45, rz + dz - 0.015, rz + dz + 0.015, steel);
    }
    // Navy drying rails under the ceiling: three along the room, five across.
    for (const z of [zb + 0.4, (zb + zf) / 2, zf - 0.45]) b.put(span(x0, x1, top - 0.38, top - 0.33, z - 0.025, z + 0.025), navy);
    for (let k = 0; k < 5; k++) {
      const x = x0 + 1.2 + (k * (x1 - x0 - 2.4)) / 4;
      b.put(span(x - 0.025, x + 0.025, top - 0.33, top - 0.28, zb, zf), navy);
      for (const z of [zb + 0.15, zf - 0.15]) b.put(span(x - 0.012, x + 0.012, top - 0.28, top - 0.03, z - 0.012, z + 0.012), navy); // hangers
    }
    // Fluorescent tube on the right-hand end wall.
    b.put(span(x1 - 0.07, x1 - 0.02, fy + 2.55, fy + 2.6, zb + 0.4, zb + 1.6), tube);
  };

  // --- Centre bay (middle edge 4) -------------------------------------------------------------------
  const centre = edgeFrame(campus, EDGES.centre);
  if (centre) {
    const f = centre, L = f.len, D = CENTRE.depth, b = build(f), { H, floors } = MIDDLE, E = CENTRE.endPier;
    // [0, C0]: the room bay (使用者標註); [C0, L]: the balcony bay, its balcony between end piers E wide.
    const C0 = L - (BAL.a0 + BAL.a1);
    // Balcony room between the end piers (the opening along the edge: a from vertex i → x = L − a).
    const X0 = L - BAL.a1, X1 = L - BAL.a0;
    skin(b, f, H, BAL.floors.map((y) => [X0, X1, y, y + BAL.height] as const));
    for (const [a, c] of [[0, FLANK.pier], [C0, C0 + E], [L - E, L]] as const) {
      b.put(span(a, c, 0, H, 0.02, D), concrete, 2);
      b.solid(a, c, 0, CANOPY.y0, 0.02, D);
    }
    // Room bay: one dorm room per floor, a deep window with an AC unit; dark glass with a green kick plate below.
    {
      const a = FLANK.pier, c = C0;
      for (const fy of floors) {
        b.put(span(a, c, fy - 0.25, fy + 0.9, 0.02, D), concrete, 2);
        b.put(span(a, c, fy + 2.6, fy + 3.35, 0.02, D), concrete, 2);
        windowAt(b, a + 0.15, c - 0.15, fy + 0.9, fy + 2.6);
        acUnit(b, a + 0.7, fy + 0.92);
      }
      b.put(span(a, c, 0, CANOPY.y0, 0.06, 0.1), glass);
      b.put(span(a, c, 0, 0.55, 0.1, 0.12), kick);
      for (const xm of [a, (a + c) / 2 - 0.03, c - 0.06]) b.put(span(xm, xm + 0.06, 0, CANOPY.y0, 0.06, 0.15), frameGrey);
    }
    for (const fy of BAL.floors) {
      // Front (正面照): thin parapet with a tiled top, one wide screen, an open bay at each end with a
      // white pipe on its outer side and a steel rail across.
      b.put(span(C0 + E, L - E, fy - 0.25, fy + 0.95, D - 0.2, D), concrete, 2);
      b.put(span(C0 + E, L - E, fy + 0.95, fy + 0.98, D - 0.22, D + 0.01), wallTiles, 0.6);
      latticePanel(b, C0 + E + CENTRE.open, L - E - CENTRE.open, fy + 0.98, fy + BAL.height, D - 0.1);
      for (const [o0, o1] of [[C0 + E, C0 + E + CENTRE.open], [L - E - CENTRE.open, L - E]] as const) {
        b.put(span(o0, o1, fy + 1.3, fy + 1.34, D - 0.14, D - 0.1), steel);
        pipe(b, o0 < (C0 + L) / 2 ? o0 + 0.15 : o1 - 0.15, fy + 0.98, fy + BAL.height, D - 0.3);
      }
      laundryRoom(b, X0, X1, fy, D);
    }
    // Ground floor: one glass lobby between the piers, brown double doors left of centre, the canopy beam with the「C」.
    const z = CANOPY.lobby, lob0 = C0 + E, lob1 = L - E;
    b.put(span(lob0, lob1, 0, CANOPY.y0, z, z + 0.04), glass);
    b.solid(lob0, lob1, 0, CANOPY.y0, 0.02, z + 0.04);
    b.put(span(lob0, lob1, 2.4, 2.46, z, z + 0.1), frameGrey);
    b.put(span(lob0, lob1, 0, 0.12, z, z + 0.1), frameGrey);
    const doorW = 2.0, dc = lob0 + (lob1 - lob0) * 0.32;
    b.put(span(lob0, dc - doorW / 2, 0.12, 0.5, z - 0.03, z), kick);
    b.put(span(dc + doorW / 2, lob1, 0.12, 0.5, z - 0.03, z), kick);
    for (let xm = lob0; xm <= lob1 + 1e-6; xm += (lob1 - lob0) / 7) {
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
    // Notice board on the left pier (photo: white sign by the lobby).
    b.put(span(C0 + E - 0.75, C0 + E - 0.25, 1.3, 1.75, D, D + 0.03), notice);
    b.put(span(-0.05, L + 0.05, CANOPY.y0, CANOPY.y1, 0.02, CANOPY.depth), concrete, 2);
    b.put(new PlaneGeometry(0.9, 0.9).translate((C0 + L) / 2, (CANOPY.y0 + CANOPY.y1) / 2, CANOPY.depth + 0.01), letter);
    // Top band and parapet over the whole bay (starts where the top-floor screen ends).
    b.put(span(-0.05, L + 0.05, H - 0.25, H + PARAPET, 0.02, D + 0.05), concrete, 2);

    // Terrace and steps (front and left), planter on the right, paving with a red brick band.
    const { depth: TD, steps: N, rise: R, tread: T } = TERRACE;
    for (let k = 1; k <= N; k++) {
      const ext = (N - k) * T, top = k * R;
      b.put(span(-ext, L, 0, top, 0.02, TD + ext), steps, 1.5);
      b.solid(-ext, L, 0, top, 0.02, TD + ext);
    }
    const reach = TD + N * T;
    const tri = new Shape([new Vector2(L, 0.02), new Vector2(L + PLANTER.width, 0.02), new Vector2(L, reach)].map((p) => new Vector2(p.x, -p.y)));
    b.put(new ExtrudeGeometry(tri, { depth: PLANTER.top, bevelEnabled: false }).rotateX(-Math.PI / 2), stone);
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
    b.put(new PlaneGeometry(0.5, 6).rotateX(-Math.PI / 2).translate((C0 + L) / 2, 0.035, reach + 3), brickBand);
    b.done();
  }

  // --- Flanks beside the centre bay, and the short returns -----------------------------------------
  // West of the projecting front: the hall (戶廳，使用者標註) — one bay, a tall window per floor, no AC.
  for (const [e, { H, floors }, hall] of [[EDGES.westFlank, MIDDLE, true], [EDGES.eastFlank, WINGS, false]] as const) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, Dw = FLANK.depth, b = build(f);
    skin(b, f, H, []);
    const nBay = hall ? 1 : Math.max(1, Math.round((L - FLANK.pier) / FLANK.bay));
    const step = (L - FLANK.pier) / nBay;
    for (let k = 0; k <= nBay; k++) {
      const a = k * step, c = a + FLANK.pier;
      b.put(span(a, c, 0, H, 0.02, Dw), concrete, 2);
      b.solid(a, c, 0, 2.6, 0.02, Dw);
    }
    for (let k = 0; k < nBay; k++) {
      const a = k * step + FLANK.pier, c = (k + 1) * step;
      for (const fy of floors) {
        const w0 = hall ? fy + 0.6 : fy + 0.9, w1 = hall ? fy + 2.8 : fy + 2.5;
        b.put(span(a, c, fy - 0.25, w0, 0.02, Dw), concrete, 2);
        b.put(span(a, c, w1, fy + 3.35, 0.02, Dw), concrete, 2);
        b.put(span(a - 0.1, c + 0.1, w1, w1 + 0.1, Dw, FLANK.shade), concrete, 2); // sunshade
        windowAt(b, a, c, w0, w1);
        if (!hall && seeded() < 0.5) acUnit(b, a + 0.6 + seeded() * (c - a - 1.2), fy + 0.92);
      }
      // Ground floor: dark shop glass with a green kick plate.
      b.put(span(a, c, 0, 2.9, 0.06, 0.1), glass);
      b.put(span(a, c, 0, 0.55, 0.1, 0.12), kick);
      for (const xm of [a, (a + c) / 2 - 0.03, c - 0.06]) b.put(span(xm, xm + 0.06, 0, 2.9, 0.06, 0.15), frameGrey);
      b.put(span(a, c, 2.9, 3.35, 0.02, Dw), concrete, 2);
    }
    b.put(span(-0.05, L + 0.05, H - 0.25, H + PARAPET, 0.02, Dw + 0.05), concrete, 2);
    b.done();
  }
  for (const e of [EDGES.westReturn, EDGES.eastReturn]) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, b = build(f), { H, floors } = MIDDLE;
    skin(b, f, H, []);
    for (const fy of [0, ...floors]) {
      if (fy > 0) b.put(span(0, L, fy - 0.25, fy + 0.1, 0.02, 0.3), concrete, 2);
      b.put(span(L / 2 - 0.35, L / 2 + 0.35, fy + 0.9, fy + 2.5, 0.06, 0.1), glass);
    }
    b.put(span(-0.05, L + 0.05, H - 0.25, H + PARAPET, 0.02, 0.35), concrete, 2);
    b.done();
  }

  // --- The 3-storey wings (轉角照) -------------------------------------------------------------------
  // End walls toward the courtyard (使用者標註，每層)：outer corner a deep lattice bay (the laundry), two rooms,
  // inner corner the hall's big window. `cloth`: which end (seen from outside) the laundry is at.
  // Long sides: windows with hoods, one ground-floor lattice bay at the left corner.
  for (const [e, cloth] of [[EDGES.eastWingSouth, 'right'], [EDGES.westWingSouth, 'left'], [EDGES.eastWingEast, null], [EDGES.eastWingWest, null], [EDGES.westWingEast, null], [EDGES.westWingWest, null]] as const) {
    const ends = cloth !== null;
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, Dw = WING.depth, b = build(f), { H, floors } = WINGS, P = WING.pier, LAT = WING.lattice;
    skin(b, f, H, []);
    // Grey concrete plinth along the foot of the wall.
    b.put(span(-0.02, L + 0.02, -0.3, WING.plinth, 0.02, 0.16), plinthGrey, 2);
    type Kind = 'pier' | 'lattice' | 'hall' | 'groundLattice' | 'windows';
    const cols: [number, number, Kind][] = [];
    const push = (w: number, k: Kind): void => { const x = cols.length ? cols[cols.length - 1]![1] : 0; cols.push([x, x + w, k]); };
    if (ends && L > 2 * (2 * P + LAT) + 2) {
      push(P, 'pier'); push(LAT, cloth === 'left' ? 'lattice' : 'hall'); push(P, 'pier'); push(L - 2 * (2 * P + LAT), 'windows'); push(P, 'pier'); push(LAT, cloth === 'left' ? 'hall' : 'lattice'); push(P, 'pier');
    } else if (!ends && L > 2 * P + LAT + 3) {
      push(P, 'pier'); push(LAT, 'groundLattice'); push(P, 'pier'); push(L - 3 * P - LAT, 'windows'); push(P, 'pier');
    } else {
      push(P, 'pier'); push(L - 2 * P, 'windows'); push(P, 'pier');
    }
    for (const [a, c, k] of cols) {
      if (k === 'pier') {
        b.put(span(a, c, WING.plinth, H, 0.02, Dw), concrete, 2);
        b.put(span(a, c, -0.3, WING.plinth, 0.02, Dw + 0.04), plinthGrey, 2);
        b.solid(a, c, 0, 2.6, 0.02, Dw + 0.04);
        continue;
      }
      for (const fy of [0, ...floors]) {
        const lat = k === 'lattice' || (k === 'groundLattice' && fy === 0);
        if (k === 'hall') {
          // The hall (戶廳): the same deep frame round one big window.
          const s0 = fy === 0 ? -0.3 : fy - 0.25, s1 = fy + 0.9, h0 = fy + 2.95, h1 = fy + STOREY - 0.25;
          b.put(span(a, c, s0, s1, 0.02, Dw), fy === 0 ? plinthGrey : concrete, 2);
          if (fy + STOREY <= H) b.put(span(a, c, h0, h1, 0.02, Dw), concrete, 2);
          windowAt(b, a + 0.1, c - 0.1, s1, h0);
          continue;
        }
        if (lat) {
          // Deep bay: sill and head at the frame face, a dark void, an open slot with a white post, the screen.
          const s0 = fy === 0 ? -0.3 : fy - 0.25, s1 = fy + 0.9, h0 = fy + 2.95, h1 = fy + STOREY - 0.25;
          b.put(span(a, c, s0, s1, 0.02, Dw), fy === 0 ? plinthGrey : concrete, 2);
          if (fy + STOREY <= H) b.put(span(a, c, h0, h1, 0.02, Dw), concrete, 2);
          b.put(span(a, c, s1, h0, 0.06, 0.08), voidDark);
          pipe(b, a + WING.slot / 2, s1, h0, Dw * 0.5);
          latticePanel(b, a + WING.slot, c, s1, h0, Dw * 0.55);
          continue;
        }
        // Windows: one per bay, a concrete hood above, AC units on some upper ones.
        const nb = ends ? 2 : Math.max(1, Math.round((c - a) / WING.bay)), st = (c - a) / nb; // end walls: two rooms
        for (let q = 0; q < nb; q++) {
          const m = a + (q + 0.5) * st, w = Math.min(1.6, st - 0.8), y0 = fy + 1.05, y1 = fy + 2.25;
          windowAt(b, m - w / 2, m + w / 2, y0, y1);
          b.put(span(m - w / 2 - 0.2, m + w / 2 + 0.2, y1 + 0.1, y1 + 0.22, 0.02, WING.hood), concrete, 2);
          for (const s of [-1, 1]) b.put(span(m + s * (w / 2 + 0.1) - 0.1, m + s * (w / 2 + 0.1) + 0.1, y0 - 0.1, y1 + 0.22, 0.02, 0.22), concrete, 2);
          if (fy > 0 && seeded() < 0.45) acUnit(b, m + (seeded() < 0.5 ? -1 : 1) * (w / 2 + 0.6), y0 - 0.2);
        }
        // Floor band between storeys.
        if (fy > 0) b.put(span(a, c, fy - 0.25, fy + 0.1, 0.02, 0.2), concrete, 2);
      }
      // Head band over the top floor's windows up to the parapet.
      b.put(span(a, c, H - 0.25, H, 0.02, k === 'windows' ? 0.2 : Dw), concrete, 2);
    }
    b.put(span(-0.05, L + 0.05, H, H + PARAPET, 0.02, Dw + 0.05), concrete, 2);
    b.done();
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
