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
import { DORM_C, DORM_C_BALCONY as BAL, DORM_C_BALCONY_SPAN, DORM_C_HALL_2F as HALL, DORM_C_LOBBY as LOBBY } from '../campus/customFacades';

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
 *  - 背面（北面，使用者背面照 2026-11-24）：淺灰素面牆基、約 3.4 m 一根壁柱；1 樓每格一排棕色菱形鐵窗花＋一排棕框窗，
 *    樓上每層窗台、上下兩排棕框橫窗、混凝土遮陽，部分窗台冷氣、幾根白色落水管；兩端短牆是樓梯間（每層一扇高窗）。北面不再有門。
 * 遊戲可進入的門（描圖資料）都在北面。外皮貼在 OSM 外牆外側（程序立面的遮陽板等細節由 CUSTOM_FACADE_EDGES 略過），
 * 每面牆一個座標系：原點在「從外面看的左端」，+x 往右、+z 朝外、+y 向上。
 */

// ---------------------------------------------------------------- anchors and dimensions (m)
type Anchor = { id: number; i: number; a: readonly [number, number]; b: readonly [number, number] };
/** Walls drawn here: building piece, edge, and its expected endpoints (vertex i, vertex i+1); skipped if the data moved. */
const EDGES = {
  // As splitDormC lays them out: the front a room longer to the west than OSM; the east wing moved 1.6 m east,
  // the hall between them part of the 4-storey middle.
  centre: { id: DORM_C.middle, i: 5, a: [-8.4, 311.4], b: [-24.72, 314.31] },
  westReturn: { id: DORM_C.middle, i: 6, a: [-24.72, 314.31], b: [-25.07, 312.37] },
  westFlank: { id: DORM_C.middle, i: 7, a: [-25.07, 312.37], b: [-30.8, 313.4] },
  eastReturn: { id: DORM_C.middle, i: 4, a: [-8.9, 308.8], b: [-8.4, 311.4] },
  eastFlank: { id: DORM_C.middle, i: 3, a: [-3.12, 307.82], b: [-8.9, 308.8] },
  eastJogWest: { id: DORM_C.eastWing, i: 7, a: [-2.32, 312.22], b: [-3.12, 307.82] },
  eastJogSouth: { id: DORM_C.eastWing, i: 6, a: [-4.52, 312.62], b: [-2.32, 312.22] },
  eastWingEast: { id: DORM_C.eastWing, i: 3, a: [7.47, 303.68], b: [10.15, 318.99] },
  eastWingSouth: { id: DORM_C.eastWing, i: 4, a: [10.15, 318.99], b: [-3.02, 321.32] },
  eastWingWest: { id: DORM_C.eastWing, i: 5, a: [-3.02, 321.32], b: [-4.52, 312.62] },
  westWingEast: { id: DORM_C.westWing, i: 0, a: [-30.8, 313.4], b: [-29.4, 321.3] },
  westWingSouth: { id: DORM_C.westWing, i: 1, a: [-29.4, 321.3], b: [-42.3, 323.6] },
  westWingWest: { id: DORM_C.westWing, i: 2, a: [-42.3, 323.6], b: [-44.6, 310.4] },
  // The back (north side, 使用者背面照 2026-11-24).
  backMiddle: { id: DORM_C.middle, i: 1, a: [-29.23, 301.79], b: [-4.89, 297.51] },
  backMiddleStair: { id: DORM_C.middle, i: 9, a: [-32.53, 303.63], b: [-29.02, 303.01] },
  backMiddleJog: { id: DORM_C.middle, i: 0, a: [-29.02, 303.01], b: [-29.23, 301.79] },
  backWest: { id: DORM_C.westWing, i: 3, a: [-44.64, 310.41], b: [-33.71, 308.48] },
  backWestJog: { id: DORM_C.westWing, i: 4, a: [-33.71, 308.48], b: [-34.49, 303.97] },
  backWestStub: { id: DORM_C.westWing, i: 5, a: [-34.49, 303.97], b: [-32.53, 303.63] },
  backEast: { id: DORM_C.eastWing, i: 0, a: [-4.89, 297.51], b: [1.96, 296.3] },
  backEastSide: { id: DORM_C.eastWing, i: 1, a: [1.96, 296.3], b: [3.39, 304.4] },
  backEastEnd: { id: DORM_C.eastWing, i: 2, a: [3.39, 304.4], b: [7.47, 303.68] },
} as const satisfies Record<string, Anchor>;

const STOREY = 3.6;
/** Eaves and upper floor levels of the 4-storey middle and the 3-storey wings. */
const MIDDLE = { H: DORM_C.middleLevels * STOREY, floors: [3.6, 7.2, 10.8] };
const WINGS = { H: DORM_C.wingLevels * STOREY, floors: [3.6, 7.2] };
const PARAPET = 1.0; // the band above the eaves (the procedural parapet is 1 m)
/** Centre bay: frame depth, end piers, the open bays at both ends of the balcony front (the lattice fills the rest). */
const CENTRE = { depth: 1.5, endPier: DORM_C_BALCONY_SPAN[0], open: 1.3 }; // the balcony's depth is the frame's (the room behind starts at the wall)
/** Ground floor of the centre bay: canopy beam (bottom, top, depth), the lobby glass set back by `lobby`. */
const CANOPY = { y0: 2.85, y1: 3.58, depth: 2.1, lobby: 0.35 }; // top under the 2F balcony floor
/** Flanks beside the centre bay: frame depth, pier width, target bay width, sunshade depth. */
const FLANK = { depth: 0.45, pier: 0.6, bay: 3.4, shade: 0.8 };
/** The halls' windows (使用者：縮小): this wide at most, centred in the hall's wall. */
const HALL_WINDOW = 2.4;
/** The C3 storefront split across the lobby (正面照): fixed | shut double door | open double door | fixed. */
const STOREFRONT = [0.157, 0.482, 0.813] as const;
/** Wing faces: frame depth, pier, lattice bay width (incl. its open slot), slot width, window bay, hood depth, plinth top. */
const WING = { depth: 0.5, pier: 0.6, lattice: 3.0, slot: 0.7, bay: 2.6, hood: 0.6, plinth: 0.9 };
/** Entrance terrace in front of the centre bay: depth from the wall, steps (count, rise, tread). */
const TERRACE = { depth: 3.2, steps: 4, rise: 0.14, tread: 0.35 };
const PLANTER = { width: 2.3, top: 0.75 };
/**
 * The back (north) faces, 使用者背面照: a tall smooth grey plinth; pilasters about every 3.4 m; per bay on the ground floor
 * a band of brown diamond-mesh grilles under a band of brown-framed windows; upper floors a sill, two bands of brown
 * strip windows (a tall lower one, a shorter upper one), a concrete hood over them; split ACs on some sills.
 */
const BACK = { pier: 0.55, pierDepth: 0.42, bay: 3.4, plinth: 1.25, plinthDepth: 0.22, pane: 0.75 };
/**
 * 學生宿舍C C1（OSM 296668595，使用者照片 2026-11-24）：4 層洗石子混凝土。面向前門廣場的斜面（edge 3）中間一座凸出的
 * 多邊形陽台塔：2F 以上每層一圈樓板＋兩側矮牆、正面整片紅色花磚、轉角白柱，塔頂高出屋頂一截；一樓縮進去是玻璃大廳
 * （dormYard.ts C_FRONT.shop），2F 樓板正面藍綠色「C1」。左右兩塊量體面向廣場的短牆（edge 2、4）是素面牆；其他各面
 * 每層一排混凝土框的窗，牆腳一段深灰牆基。`ring`：OSM 外環（edge i 從頂點 i 到 i + 1），東北角的凹口已由 campusFixes.ts
 * sealBuildings 填平（使用者：東側是一個平面），對不上就整個略過。
 */
const C1 = {
  ring: [[2.1, 349.72], [4.39, 349.23], [2.76, 339.26], [7.33, 338.44], [11.57, 331.92], [10.92, 327.66], [24.08, 325.54], [26.44, 337.63], [18.27, 339.1], [15.33, 342.85], [16.64, 353.14], [2.76, 355.1]] as const,
  bayEdge: 3, blank: [0, 2, 4] as readonly number[], noPlinth: [3] as readonly number[],
  /**
   * 側面照（使用者 2026-11-24，陽台塔右手邊；edge 2 是正面照裡的素面量體，不動）：edge 1 一轉過角（`split` 以前）就是一條
   * 內凹直條，每層一扇深框窗、一樓上下兩排窗；後面每層一排深框窗（部分冷氣）、一樓上下兩排窗。edge 0（凸出那塊的側面）
   * 是一般牆面（使用者紅框）。edge 1、2 牆基較高（`tallPlinth`）。
   */
  side: 1, split: 2.6, tallPlinth: 1.8, tallPlinthEdges: [1, 2, 5] as readonly number[],
  /**
   * 另一側的側面照（使用者 2026-11-24，edge 5，朝 C3／前門那面）：從東端（x = 0）起——樓梯間（每層一扇窄高窗）、
   * 壁柱分格每層一排窗＋冷氣、靠塔那段每層一條深的內凹橫窗帶；一樓上下兩排窗、高牆基。正面不動。
   */
  sideN: 5, stairW: 2.4, rowsEnd: 6.4,
  /**
   * 南面照（使用者 2026-11-24，edge 10，朝 C2 側門）：大部分素面；中間偏左一列窄長窗（2F 以上每層一扇，`southColumn`：
   * 中心在牆長的這個比例、寬度 m），一樓偏右一扇寬的上下兩排窗（`southGround`：牆長的比例）。使用者：東側（edge 6、9）
   * 跟靠 C2 那面一模一樣——`southLike` 都用這一套（edge 9 後來改成跟宿服中心上方對稱，見 `svcMirror`）。edge 6 原本北段有一個退縮凹口，使用者說沒有凹進去、是一個平面，已填平。
   */
  /**
   * 宿服中心上方（使用者照片 2026-11-24）：服務中心屋頂以上兩面。`svcBack`（edge 7，北棟朝南那面）：靠斜角那端一條窄窗列，
   * 其餘分三格，每層一條寬窗帶、上下凸出的深混凝土橫帶、格間壁柱、窗下掛冷氣。`svcDiag`（edge 8，OSM 小斜牆）：每層一個深凹的
   * 開口（暗色內牆、窗、冷氣），整列疊上去。
   */
  svcBack: 7, svcDiag: 8, svcBays: 3,
  /** 使用者：以宿服中心為中心，另一邊（edge 9，南翼朝東那面）一樣、對稱——窄窗列在靠斜角那端（右邊）。 */
  svcMirror: 9,
  southLike: [10, 6] as readonly number[], southColumn: { at: 0.45, w: 0.8 }, southGround: [0.532, 0.777] as readonly [number, number],
  /** Balcony tower on the bay edge: back width, front width, depth out from the wall. */
  bay: { back: 5.4, front: 4.0, depth: 1.6 },
  plinth: 1.3, window: { w: 1.6, y0: 1.0, y1: 2.3, every: 3.4 },
};

/** No campus trees on the steps, planter and the paving in front. */
export function dormCFacadeTreeFree(campus: CampusData): Ring[] {
  const f = edgeFrame(campus, EDGES.centre);
  if (!f) return [];
  // Out to the halls either side (and the ground the east wing gave up).
  return [[f.world(-7, 0), f.world(f.len + 7, 0), f.world(f.len + 7, 9), f.world(-7, 9)].flat()];
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
export function latticeRings(g: CanvasRenderingContext2D): void {
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
/** Diamond wire mesh of the ground-floor window grilles (背面照): brown wires over the glass behind (opaque, no moiré). */
function diamondMesh(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#4f5a5e';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#6a4a33';
  g.lineWidth = 4;
  for (let k = -64; k <= 128; k += 32) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke();
  }
}
/** A block's name (「C1」, 「C2」) in teal-green letters with a dark offset (正面照). */
const letterSign = (text: string) => (g: CanvasRenderingContext2D): void => {
  g.clearRect(0, 0, 256, 128);
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = "800 110px 'Arial Rounded MT Bold', system-ui, sans-serif";
  for (const [dx, col] of [[5, '#2f5f55'], [0, '#5c9c8a']] as const) { g.fillStyle = col; g.fillText(text, 128 + dx, 66 + dx); }
};
/**
 * 學生宿舍C C2（OSM 296668592，使用者照片 2026-11-24）：5 層。面向中庭的中間凸出塊（edge 2）：壁柱分三格——中間內凹
 * 陽台（背牆紅色花磚、兩側開口白色管柱、每層厚樓板帶），左右每層上下兩排棕框窗＋冷氣；一樓三格玻璃（中間是門），上方
 * 「C2」；門前平台＋三階台階、左邊花台、右邊藍色扶手。兩翼與其他長牆：壁柱、每層兩排棕框橫窗、一樓深色窗＋牆基。
 */
const C2 = {
  ring: [[-41.01, 347.12], [-29.18, 345.14], [-29.57, 342.81], [-17.45, 340.79], [-17.04, 343.18], [-6.45, 341.4], [-4.5, 353.02], [-35.95, 358.29], [-36.17, 356.96], [-39.27, 357.47]] as const,
  front: 2, plain: [1, 3, 5, 7, 8] as readonly number[], // 5: the side toward C1 is a plain wall (使用者)
  /** Front block across: pier, side column, centre balcony. */
  pier: 0.5, centre: 5.0, plinth: 0.9,
  terrace: { depth: 2.6, top: 0.45, rise: 0.15, tread: 0.35 },
};
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
/** 「C3」 in teal-green raised letters (正面照): a big C, a smaller 3 at its lower right, a dark offset for depth. */
function letterC(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, 360, 256);
  g.textBaseline = 'alphabetic';
  g.font = "800 230px 'Arial Rounded MT Bold', system-ui, sans-serif";
  for (const [dx, col] of [[7, '#2f5f55'], [0, '#5c9c8a']] as const) { g.fillStyle = col; g.fillText('C', 20 + dx, 210 + dx); }
  g.font = "800 130px 'Arial Rounded MT Bold', system-ui, sans-serif";
  for (const [dx, col] of [[5, '#2f5f55'], [0, '#5c9c8a']] as const) { g.fillStyle = col; g.fillText('3', 205 + dx, 235 + dx); }
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
  const letter = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 360, 256, letterC), transparent: true, roughness: 0.5 }));
  // Lobby (正面照): clear glass you can see into, dark brown frames, green dado, dark polished floor.
  const clearGlass = mat(0xa9bfc6, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const brownFrame = mat(0x3d2c22, { metalness: 0.3, roughness: 0.5 });
  const dado = mat(0x7fb83a, { roughness: 0.6 });
  const lobbyFloor = mat(0x3c3f42, { roughness: 0.25, metalness: 0.1 });
  const boardGreen = mat(0x2f6b4f, { roughness: 0.8 });
  const vendLit = mat(0xf4f8ff, { emissive: 0xdfefff, emissiveIntensity: 0.7, roughness: 0.2 });
  // The back (背面照): brown aluminium frames, pale reflective glass, brown diamond-mesh grilles.
  const backFrame = mat(0x6e5039, { metalness: 0.35, roughness: 0.5 });
  const backGlass = mat(0x7d898d, { metalness: 0.35, roughness: 0.18 });
  const grille = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 64, 64, diamondMesh), roughness: 0.5, metalness: 0.2 }));
  const backPlinth = mat(0xb3b1aa, { roughness: 0.9 }); // smooth pale grey render (背面照)

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
  /** `plain`: one fixed pane in an outer frame — no middle mullion or transom (no sashes, no screen). */
  const windowAt = (b: ReturnType<typeof build>, x0: number, x1: number, y0: number, y1: number, pane: Material = glass, plain = false): void => {
    b.put(span(x0, x1, y0, y1, 0.06, 0.1), pane);
    for (const x of plain ? [x0, x1 - 0.05] : [x0, (x0 + x1) / 2 - 0.025, x1 - 0.05]) b.put(span(x, x + 0.05, y0, y1, 0.06, 0.13), frameGrey);
    for (const y of plain ? [y0, y1 - 0.05] : [y0, y1 - 0.05, y0 + (y1 - y0) * 0.62]) b.put(span(x0, x1, y, y + 0.05, 0.06, 0.13), frameGrey);
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
    // 2F: no back wall — the balcony is the front of the dorm flat's laundry, which goes on deeper behind it (dormCUnit.ts);
    // its back wall, doors, partitions, washers, windows, sinks and rails are built there (dormCUnitDecor.ts).
    const flat = fy === BAL.floors[0];
    if (!flat) b.put(span(x0, x1, fy, top, zb - 0.02, zb), paint, 2);
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
      if (!flat) box(0.015, 0.6, fy + 0.55, fy + 0.82, zb + 0.05, zf - 0.3, wallTiles, 0.6);
      if (!flat) box(0.09, 0.52, fy + 0.82, fy + 0.83, zb + 0.12, zf - 0.37, basin);
      for (const z of flat ? [] : [zb + 0.25, zf - 0.5]) box(0.25, 0.33, fy, fy + 0.55, z - 0.04, z + 0.04, steel);
      for (let k = 0; k < (flat ? 0 : 3); k++) {
        const z = zb + 0.45 + k * ((zf - zb - 1.1) / 2);
        box(0.015, 0.14, fy + 1.0, fy + 1.04, z - 0.02, z + 0.02, steel);
        box(0.11, 0.14, fy + 0.94, fy + 1.04, z - 0.02, z + 0.02, steel);
      }
      // Wooden door into the building, a low partition, two washing machines (the one by the door on a stand).
      if (!flat) {
        box(0.7, 1.6, fy, fy + 2.1, zb, zb + 0.04, wood);
        box(0.62, 1.68, fy + 2.1, fy + 2.16, zb, zb + 0.05, panelDark);
        box(1.45, 1.5, fy + 0.95, fy + 1.05, zb + 0.04, zb + 0.08, steel);
      }
      if (!flat) box(1.75, 1.87, fy, fy + 1.15, zb, zb + 0.85, paint, 2);
      for (const [d, lift] of flat ? [] : [[2.25, 0.25], [2.95, 0]] as const) {
        const y = fy + lift;
        if (lift) box(d - 0.32, d + 0.32, fy, y, zb + 0.03, zb + 0.67, washer);
        box(d - 0.3, d + 0.3, y, y + 0.85, zb + 0.05, zb + 0.65, washer);
        box(d - 0.3, d + 0.3, y + 0.85, y + 0.97, zb + 0.05, zb + 0.2, panelDark);
        box(d - 0.26, d + 0.26, y + 0.85, y + 0.86, zb + 0.24, zb + 0.61, basin);
      }
      // Back-wall windows toward the middle: a lower pair with grilles, an upper pair (not on 2F: no back wall there).
      for (const [y0, y1, grille] of flat ? [] : [[fy + 1.05, fy + 2.05, true], [fy + 2.4, fy + 3.1, false]] as const) {
        const [p, q] = sx(mid - x0 - 1.3, mid - x0 - 0.2);
        b.put(span(p, q, y0, y1, zb, zb + 0.02), glass);
        for (const yy of [y0, y1 - 0.05]) b.put(span(p, q, yy, yy + 0.05, zb, zb + 0.05), frameGrey);
        for (const xx of [p, q - 0.05]) b.put(span(xx, xx + 0.05, y0, y1, zb, zb + 0.05), frameGrey);
        if (grille) {
          for (let xx = p + 0.14; xx < q - 0.1; xx += 0.14) b.put(span(xx - 0.01, xx + 0.01, y0, y1, zb + 0.05, zb + 0.07), black);
          for (let yy = y0 + 0.14; yy < y1 - 0.1; yy += 0.14) b.put(span(p, q, yy - 0.01, yy + 0.01, zb + 0.05, zb + 0.07), black);
        }
      }
      // Stainless drying rack behind the screen, between the machines and the windows (not on 2F: 使用者：窗戶旁邊的衣架移除).
      const rz = zf - 0.55;
      for (const y of flat ? [] : [fy + 1.1, fy + 1.45]) box(2.2, 3.6, y, y + 0.03, rz - 0.015, rz + 0.015, steel);
      for (const d of flat ? [] : [2.25, 3.55]) for (const dz of [-0.2, 0.2]) box(d - 0.015, d + 0.015, fy, fy + 1.45, rz + dz - 0.015, rz + dz + 0.015, steel);
    }
    // Navy drying rails under the ceiling: three along the room, five across (2F: the flat's laundry has its own, full depth).
    if (!flat) for (const z of [zb + 0.4, (zb + zf) / 2, zf - 0.45]) b.put(span(x0, x1, top - 0.38, top - 0.33, z - 0.025, z + 0.025), navy);
    for (let k = 0; k < (flat ? 0 : 5); k++) {
      const x = x0 + 1.2 + (k * (x1 - x0 - 2.4)) / 4;
      b.put(span(x - 0.025, x + 0.025, top - 0.33, top - 0.28, zb, zf), navy);
      for (const z of [zb + 0.15, zf - 0.15]) b.put(span(x - 0.012, x + 0.012, top - 0.28, top - 0.03, z - 0.012, z + 0.012), navy); // hangers
    }
    // Fluorescent tube on the right-hand end wall.
    b.put(span(x1 - 0.07, x1 - 0.02, fy + 2.55, fy + 2.6, zb + 0.4, zb + 1.6), tube);
  };

  /**
   * The lobby seen through the storefront (正面照): dark floor level with the landing, white walls over a green dado,
   * two brown doors and a notice board on the back wall, a lit vending machine behind the right-hand glass,
   * two ceiling fans and a light. Walls and floor are solid; the open door lets you walk in.
   */
  const lobbyRoom = (b: ReturnType<typeof build>, x0: number, x1: number, f0: number, top: number, SF: number): void => {
    const zb = -LOBBY.depth, mid = (x0 + x1) / 2, Wd = x1 - x0;
    b.put(span(x0, x1, -0.3, f0, zb, SF), lobbyFloor);
    b.solid(x0, x1, 0, f0, zb, SF);
    b.put(span(x0, x1, top, top + 0.12, zb, SF), paint, 2);
    b.put(span(x0, x1, f0, top, zb - 0.1, zb), paint, 2);
    b.solid(x0, x1, f0, top, zb - 0.1, zb);
    b.put(span(x0, x1, f0, f0 + 0.95, zb, zb + 0.015), dado);
    for (const [a, c, inner] of [[x0 - 0.1, x0, x0], [x1, x1 + 0.1, x1]] as const) {
      b.put(span(a, c, f0, top, zb, 0.02), paint, 2);
      b.solid(a, c, f0, top, zb, 0.02);
      const s = inner === x0 ? 1 : -1;
      b.put(span(Math.min(inner, inner + s * 0.015), Math.max(inner, inner + s * 0.015), f0, f0 + 0.95, zb, 0.02), dado);
    }
    // Back wall: two brown doors and a green board.
    for (const dx of [Wd * 0.33, Wd * 0.62]) {
      b.put(span(x0 + dx - 0.45, x0 + dx + 0.45, f0, f0 + 2.1, zb, zb + 0.04), wood);
      b.put(span(x0 + dx - 0.5, x0 + dx + 0.5, f0 + 2.1, f0 + 2.16, zb, zb + 0.05), brownFrame);
    }
    b.put(span(x0 + Wd * 0.12, x0 + Wd * 0.2, f0 + 1.0, f0 + 1.6, zb, zb + 0.03), boardGreen);
    // Vending machine behind the right-hand fixed glass, its lit front to the street.
    const vx0 = x1 - 1.05, vx1 = x1 - 0.15;
    b.put(span(vx0, vx1, f0, f0 + 1.85, -1.1, -0.35), washer);
    b.put(span(vx0 + 0.08, vx1 - 0.3, f0 + 0.6, f0 + 1.75, -0.35, -0.33), vendLit);
    b.put(span(vx1 - 0.25, vx1 - 0.08, f0 + 0.9, f0 + 1.3, -0.35, -0.33), panelDark);
    b.solid(vx0, vx1, f0, f0 + 1.85, -1.1, -0.35);
    // Ceiling: two fans and a light.
    for (const fx of [x0 + Wd * 0.35, x0 + Wd * 0.7]) {
      b.put(new CylinderGeometry(0.02, 0.02, 0.35, 6).translate(fx, top - 0.18, zb / 2), black);
      b.put(new CylinderGeometry(0.12, 0.12, 0.1, 10).translate(fx, top - 0.4, zb / 2), black);
      for (let k = 0; k < 3; k++) {
        b.put(new BoxGeometry(0.55, 0.015, 0.12).translate(0.35, 0, 0).rotateY((k * Math.PI * 2) / 3).translate(fx, top - 0.43, zb / 2), black);
      }
    }
    b.put(span(mid - 0.6, mid + 0.6, top - 0.03, top, zb + 0.6, zb + 0.9), tube);
  };

  // --- Centre bay (middle edge 4) -------------------------------------------------------------------
  const centre = edgeFrame(campus, EDGES.centre);
  if (centre) {
    const f = centre, L = f.len, D = CENTRE.depth, b = build(f), { H, floors } = MIDDLE, E = CENTRE.endPier;
    // [0, C0] and [C1, L]: a room bay each side (使用者標註); [C0, C1]: the balcony bay, its balcony between end piers E wide.
    const C1 = L - DORM_C.roomWidth, C0 = C1 - (BAL.a1 - BAL.a0 + 2 * E);
    // Balcony room between the end piers (the opening along the edge: a from vertex i → x = L − a).
    const X0 = L - BAL.a1, X1 = L - BAL.a0;
    // Holes: the balconies, and the lobby behind the storefront (the same span, from below ground to its lintel).
    skin(b, f, H, [...BAL.floors.map((y) => [X0, X1, y, y + BAL.height] as const), [L - LOBBY.a1, L - LOBBY.a0, -0.3, LOBBY.top] as const]);
    for (const [a, c] of [[0, FLANK.pier], [C0, C0 + E], [C1 - E, C1], [L - FLANK.pier, L]] as const) {
      b.put(span(a, c, 0, H, 0.02, D), concrete, 2);
      b.solid(a, c, 0, CANOPY.y0, 0.02, D);
    }
    // Room bays: one dorm room per floor, a deep window with an AC unit (outer side); dark glass with a green kick plate below.
    for (const [a, c] of [[FLANK.pier, C0], [C1, L - FLANK.pier]] as const) {
      for (const fy of floors) {
        b.put(span(a, c, fy - 0.25, fy + 0.9, 0.02, D), concrete, 2);
        b.put(span(a, c, fy + 2.6, fy + 3.35, 0.02, D), concrete, 2);
        windowAt(b, a + 0.15, c - 0.15, fy + 0.9, fy + 2.6);
        acUnit(b, a < L / 2 ? a + 0.7 : c - 0.7, fy + 0.92);
      }
      b.put(span(a, c, 0, CANOPY.y0, 0.06, 0.1), glass);
      b.put(span(a, c, 0, 0.55, 0.1, 0.12), kick);
      for (const xm of [a, (a + c) / 2 - 0.03, c - 0.06]) b.put(span(xm, xm + 0.06, 0, CANOPY.y0, 0.06, 0.15), frameGrey);
      b.put(span(a, c, CANOPY.y0, 3.35, 0.02, D), concrete, 2); // head band up to the 2F spandrel
    }
    for (const fy of BAL.floors) {
      // Front (正面照): thin parapet with a tiled top, one wide screen, an open bay at each end with a
      // white pipe on its outer side and a steel rail across.
      b.put(span(C0 + E, C1 - E, fy - 0.25, fy + 0.95, D - 0.2, D), concrete, 2);
      b.put(span(C0 + E, C1 - E, fy + 0.95, fy + 0.98, D - 0.22, D + 0.01), wallTiles, 0.6);
      latticePanel(b, C0 + E + CENTRE.open, C1 - E - CENTRE.open, fy + 0.98, fy + BAL.height, D - 0.1);
      for (const [o0, o1] of [[C0 + E, C0 + E + CENTRE.open], [C1 - E - CENTRE.open, C1 - E]] as const) {
        b.put(span(o0, o1, fy + 1.3, fy + 1.34, D - 0.14, D - 0.1), steel);
        pipe(b, o0 < (C0 + C1) / 2 ? o0 + 0.15 : o1 - 0.15, fy + 0.98, fy + BAL.height, D - 0.3);
      }
      laundryRoom(b, X0, X1, fy, D);
    }
    // Ground floor (正面照): no canopy — a recessed lintel, the「C3」 on the band above, and between the two piers a
    // dark-brown storefront set back SF: fixed glass | double door (shut) | double door (open outward) | fixed glass,
    // a row of transoms above; clear glass onto the lobby, whose floor is level with the landing.
    const lob0 = C0 + E, lob1 = C1 - E, W = lob1 - lob0, f0 = LOBBY.floor, top = LOBBY.top, dTop = f0 + 2.1, SF = 0.6;
    const xs = [lob0, ...STOREFRONT.map((t) => lob0 + W * t), lob1]; // fixed | shut doors | open doors | fixed
    const [, dl0, dr0, dr1] = xs as [number, number, number, number, number];
    b.put(span(lob0, lob1, top, 3.35, 0.02, D - 0.3), concrete, 2); // lintel
    for (const [a, c] of [[C0, C0 + E], [C1 - E, C1]] as const) b.put(span(a - 0.06, c + 0.06, 0, 0.95, 0.02, D + 0.08), plinthGrey, 2); // rough stone pier bases
    b.put(new PlaneGeometry(1.4, 1.0).translate((lob0 + lob1) / 2, 3.98, D + 0.012), letter);
    // Glass: the fixed panes and transoms, the shut double door; frames round everything.
    const pane = (x0: number, x1: number, y0: number, y1: number, z = SF): void => { b.put(span(x0, x1, y0, y1, z - 0.01, z + 0.01), clearGlass); };
    const bar = (x0: number, x1: number, y0: number, y1: number, z = SF, t = 0.08): void => { b.put(span(x0, x1, y0, y1, z - t / 2, z + t / 2), brownFrame); };
    pane(lob0, dl0, f0 + 0.3, dTop); pane(dr1, lob1, f0 + 0.3, dTop);
    for (const [x0, x1] of [[lob0, dl0], [dr1, lob1]] as const) b.put(span(x0, x1, f0, f0 + 0.3, SF - 0.05, SF + 0.05), plinthGrey, 2); // stone kerb under the fixed panes
    pane(lob0, lob1, dTop, top);
    bar(lob0, lob1, dTop - 0.04, dTop + 0.04); bar(lob0, lob1, top - 0.08, top);
    for (const x of xs) bar(x - 0.04, x + 0.04, f0, top);
    for (let k = 1; k < 6; k++) { const x = lob0 + (W * k) / 6; bar(x - 0.03, x + 0.03, dTop, top); } // transom mullions
    // Shut double door: two glazed leaves, mid rail, pull handles, a paper notice.
    const dm = (dl0 + dr0) / 2;
    for (const [x0, x1] of [[dl0, dm], [dm, dr0]] as const) {
      pane(x0 + 0.06, x1 - 0.06, f0 + 0.1, dTop - 0.06);
      bar(x0, x0 + 0.07, f0, dTop); bar(x1 - 0.07, x1, f0, dTop);
      bar(x0, x1, f0, f0 + 0.1); bar(x0, x1, f0 + 1.0, f0 + 1.08);
    }
    for (const s of [-1, 1]) bar(dm + s * 0.12 - 0.02, dm + s * 0.12 + 0.02, f0 + 0.85, f0 + 1.5, SF + 0.07, 0.04);
    b.put(span(dm - 0.45, dm - 0.2, f0 + 1.25, f0 + 1.55, SF + 0.02, SF + 0.025), notice);
    b.put(span(dm + 0.06, dm + 0.3, f0 + 1.2, f0 + 1.5, SF + 0.02, SF + 0.025), notice);
    b.solid(lob0, dr0, f0, top, SF - 0.05, SF + 0.05);
    b.solid(dr1, lob1, f0, top, SF - 0.05, SF + 0.05);
    // Open double door: both leaves swung right out, standing square to the front at the jambs.
    const leafW = (dr1 - dr0) / 2;
    for (const x of [dr0 + 0.04, dr1 - 0.04]) {
      b.put(span(x - 0.025, x + 0.025, f0 + 0.1, dTop - 0.06, SF, SF + leafW), clearGlass);
      for (const [y0, y1] of [[f0, f0 + 0.1], [f0 + 1.0, f0 + 1.08], [dTop - 0.06, dTop]] as const) b.put(span(x - 0.035, x + 0.035, y0, y1, SF, SF + leafW), brownFrame);
      b.put(span(x - 0.035, x + 0.035, f0, dTop, SF + leafW - 0.07, SF + leafW), brownFrame);
      b.solid(x - 0.04, x + 0.04, f0, dTop, SF, SF + leafW);
    }
    lobbyRoom(b, lob0, lob1, f0, top, SF);
    // Notice board on the left pier (photo: white box by the lobby).
    b.put(span(C0 + E - 0.75, C0 + E - 0.25, 1.3, 1.75, D, D + 0.03), notice);
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
    b.put(new PlaneGeometry(0.5, 6).rotateX(-Math.PI / 2).translate((C0 + C1) / 2, 0.035, reach + 3), brickBand);
    b.done();
  }

  // --- Flanks beside the centre bay, and the short returns -----------------------------------------
  // Each side of the projecting front: the hall (戶廳，使用者標註) — one bay, a tall window per floor, no AC.
  // East: the hall (4 storeys, part of the middle) faces the courtyard beside the east wing (使用者：紅框複製到右邊).
  for (const [e, { H, floors }, hall] of [[EDGES.westFlank, MIDDLE, true], [EDGES.eastFlank, MIDDLE, true]] as const) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, Dw = FLANK.depth, b = build(f);
    // East hall, 2F: the dorm flat's living room is behind it — the wall skin is cut and the glass is clear, so it looks
    // out (使用者：戶廳的窗戶可以看到外面; the shell wall is opened by DORM_C_HALL_2F).
    // East: the window sits where DORM_C_HALL_2F opens the shell (a0/a1 from vertex i), centred on the notch's open part,
    // clear of the east wing's wall in front of the rest (使用者：戶廳窗戶的造型怪怪的).
    const see = e === EDGES.eastFlank;
    const hm = see ? L - (HALL.a0 + HALL.a1) / 2 : (FLANK.pier + L) / 2, hh = see ? (HALL.a1 - HALL.a0) / 2 : Math.min(HALL_WINDOW, L - FLANK.pier) / 2;
    const seeFy = floors[0]!;
    skin(b, f, H, see ? [[hm - hh, hm + hh, seeFy + 0.6, seeFy + 2.8]] : []);
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
        // The hall's window (使用者：縮小): at most HALL_WINDOW wide, solid wall either side at the frame face.
        const half = see ? hh : hall ? Math.min(HALL_WINDOW, c - a) / 2 : (c - a) / 2, m = see ? hm : (a + c) / 2;
        // The living room's window (使用者：單純窗戶就好，不要紗窗、不要看起來能開的): one clear pane, outer frame only.
        windowAt(b, m - half, m + half, w0, w1, see && fy === seeFy ? clearGlass : glass, see && fy === seeFy);
        if (m - half > a + 0.01) for (const [p, q] of [[a, m - half], [m + half, c]] as const) b.put(span(p, q, w0, w1, 0.02, Dw), concrete, 2);
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
  // Short returns; the east wing's two jog faces beside the hall (3 storeys) are solid walls (使用者平面圖；戶廳窗不要了).
  for (const [e, { H, floors }, solid] of [[EDGES.westReturn, MIDDLE, false], [EDGES.eastReturn, MIDDLE, false], [EDGES.eastJogSouth, WINGS, true], [EDGES.eastJogWest, WINGS, true]] as const) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, b = build(f);
    skin(b, f, H, []);
    if (solid) b.put(span(-0.02, L + 0.02, -0.3, WING.plinth, 0.02, 0.16), plinthGrey, 2);
    for (const fy of solid ? [] : [0, ...floors]) {
      if (fy > 0) b.put(span(0, L, fy - 0.25, fy + 0.1, 0.02, 0.3), concrete, 2);
      b.put(span(L / 2 - 0.35, L / 2 + 0.35, fy + 0.9, fy + 2.5, 0.06, 0.1), glass);
    }
    b.put(span(-0.05, L + 0.05, H - 0.25, H + PARAPET, 0.02, 0.35), concrete, 2);
    b.done();
  }

  // --- The 3-storey wings (轉角照) -------------------------------------------------------------------
  // Layouts (使用者標註＋轉角照):
  //  - clothLeft: the west wing's end wall — outer corner a deep lattice bay (the laundry), two rooms, inner corner the hall's big window;
  //  - eastWest / eastSouth / eastEast: the east wing as in the user's plan sketch and corner photo — its inner face one
  //    room (a window with AC) and one laundry (a deep bay with a white post and lattice at the corner), each half the
  //    wall; its south end the laundry's big lattice bay at the corner, then solid wall (corridor and bathroom behind);
  //    its east face three rooms, and solid wall at the south corner (the bathroom);
  //  - side: the west wing's west face — a plain wall at the north (left) corner (使用者), then windows with hoods;
  //  - plain: the west wing's inner face — a plain wall, nothing on it.
  type Layout = 'clothLeft' | 'eastSouth' | 'eastWest' | 'eastEast' | 'side' | 'plain';
  const wingWalls: [Anchor, Layout][] = [[EDGES.westWingSouth, 'clothLeft'], [EDGES.eastWingSouth, 'eastSouth'], [EDGES.eastWingWest, 'eastWest'], [EDGES.eastWingEast, 'eastEast'], [EDGES.westWingEast, 'plain'], [EDGES.westWingWest, 'side']];
  for (const [e, layout] of wingWalls) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, Dw = WING.depth, b = build(f), { H, floors } = WINGS;
    const P = WING.pier, LAT = WING.lattice, SLOT = WING.slot;
    skin(b, f, H, []);
    // Grey concrete plinth along the foot of the wall.
    b.put(span(-0.02, L + 0.02, -0.3, WING.plinth, 0.02, 0.16), plinthGrey, 2);
    type Kind = 'pier' | 'lattice' | 'screen' | 'hall' | 'groundLattice' | 'windows' | 'single' | 'room' | 'blank';
    const cols: [number, number, Kind][] = [];
    const push = (w: number, k: Kind): void => { const x = cols.length ? cols[cols.length - 1]![1] : 0; cols.push([x, x + w, k]); };
    if (layout === 'plain') {
      // nothing on it
    } else if (layout === 'clothLeft') {
      push(P, 'pier'); push(LAT, 'lattice'); push(P, 'pier'); push(L - 2 * (2 * P + LAT), 'windows'); push(P, 'pier'); push(LAT, 'hall'); push(P, 'pier');
    } else if (layout === 'eastSouth') {
      // Seen from outside the laundry's corner is on the left; behind the rest are the corridor and the bathroom.
      const scr = Math.max(2.6, L * 0.37 - 1.2);
      push(0.7, 'pier'); push(scr, 'screen'); push(0.5, 'pier'); push(L - 0.7 - scr - 0.5, 'blank');
    } else if (layout === 'eastEast') {
      // Seen from outside the south corner (the bathroom) is on the left, solid; three rooms to the right.
      push(0.6, 'pier'); push(3.0, 'blank'); push(P, 'pier'); push(L - 0.6 - 3.0 - P - P, 'windows'); push(P, 'pier');
    } else if (layout === 'eastWest') {
      // Seen from outside the corner is on the right. Only one room and one laundry (使用者): two equal bays.
      const half = (L - P - P - 0.7) / 2;
      push(P, 'pier'); push(half, 'room'); push(P, 'pier'); push(half, 'lattice'); push(0.7, 'pier');
    } else if (layout === 'side') {
      // 使用者（2026-11-24）：北端那一段（原本 1 樓花磚、樓上一列窄窗）是純牆面。
      push(P + LAT, 'blank'); push(P, 'pier'); push(L - 3 * P - LAT, 'windows'); push(P, 'pier');
    } else if (L > 2 * P + LAT + 3) {
      push(P, 'pier'); push(LAT, 'groundLattice'); push(P, 'pier'); push(L - 3 * P - LAT, 'windows'); push(P, 'pier');
    } else {
      push(P, 'pier'); push(L - 2 * P, 'windows'); push(P, 'pier');
    }
    for (const [a, c, k] of cols) {
      if (k === 'blank') {
        // Solid wall, flush with the frame face (so the piers beside it don't stand out as loose fins).
        b.put(span(a, c, WING.plinth, H, 0.02, Dw), concrete, 2);
        b.put(span(a, c, -0.3, WING.plinth, 0.02, Dw + 0.04), plinthGrey, 2);
        b.solid(a, c, 0, 2.6, 0.02, Dw + 0.04);
        continue;
      }
      if (k === 'pier') {
        b.put(span(a, c, WING.plinth, H, 0.02, Dw), concrete, 2);
        b.put(span(a, c, -0.3, WING.plinth, 0.02, Dw + 0.04), plinthGrey, 2);
        b.solid(a, c, 0, 2.6, 0.02, Dw + 0.04);
        continue;
      }
      for (const fy of [0, ...floors]) {
        const lat = k === 'lattice' || k === 'screen' || (k === 'groundLattice' && fy === 0);
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
          const slot = k === 'screen' ? 0 : Math.min(SLOT, (c - a) * 0.4); // the big screen fills its bay
          if (slot) pipe(b, a + slot / 2, s1, h0, Dw * 0.5);
          latticePanel(b, a + slot, c, s1, h0, Dw * 0.55);
          continue;
        }
        // Windows: one per bay (end walls: two rooms; `single`: one small window), a concrete hood above, AC on some upper ones.
        const nb = k === 'room' ? 1 : k === 'single' ? Math.max(1, Math.round((c - a) / 3.2)) : layout === 'clothLeft' ? 2 : layout === 'eastEast' ? 3 : Math.max(1, Math.round((c - a) / WING.bay)), st = (c - a) / nb;
        for (let q = 0; q < nb; q++) {
          const small = k === 'single';
          const m = a + (q + 0.5) * st, w = small ? Math.min(1.0, st - 0.4) : Math.min(1.6, st - (st < 2 ? 0.35 : 0.8)), y0 = fy + (small ? 1.15 : 1.05), y1 = fy + (small ? 2.05 : 2.25);
          windowAt(b, m - w / 2, m + w / 2, y0, y1);
          b.put(span(m - w / 2 - 0.2, m + w / 2 + 0.2, y1 + 0.1, y1 + 0.22, 0.02, WING.hood), concrete, 2);
          for (const s of [-1, 1]) b.put(span(m + s * (w / 2 + 0.1) - 0.1, m + s * (w / 2 + 0.1) + 0.1, y0 - 0.1, y1 + 0.22, 0.02, 0.22), concrete, 2);
          if (fy > 0 && !small && seeded() < 0.45) acUnit(b, m + (seeded() < 0.5 ? -1 : 1) * (w / 2 + 0.6), y0 - 0.2);
        }
        // Floor band between storeys.
        if (fy > 0) b.put(span(a, c, fy - 0.25, fy + 0.1, 0.02, 0.2), concrete, 2);
      }
      // Head band over the top floor's windows up to the parapet.
      b.put(span(a, c, H - 0.25, H, 0.02, k === 'windows' || k === 'single' || k === 'room' ? 0.2 : Dw), concrete, 2);
    }
    b.put(span(-0.05, L + 0.05, H, H + PARAPET, 0.02, Dw + 0.05), concrete, 2);
    b.done();
  }

  // --- The back (north side, 使用者背面照 2026-11-24) ------------------------------------------------------
  // bays: the long faces (plinth, pilasters, per bay a grille band and window band downstairs, two strip-window bands and a
  // hood upstairs); stair: the short end faces, one tall window per floor at the landing; plain: the short jogs, bare wall.
  /** Brown strip window: glass, a frame round it, mullions about every BACK.pane m. */
  const stripWindow = (b: ReturnType<typeof build>, x0: number, x1: number, y0: number, y1: number): void => {
    b.put(span(x0, x1, y0, y1, 0.05, 0.08), backGlass);
    const n = Math.max(1, Math.round((x1 - x0) / BACK.pane));
    for (let k = 0; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n; b.put(span(Math.max(x0, x - 0.03), Math.min(x1, x + 0.03), y0, y1, 0.05, 0.12), backFrame); }
    for (const y of [y0, y1 - 0.05]) b.put(span(x0, x1, y, y + 0.05, 0.05, 0.12), backFrame);
  };
  type Back = 'bays' | 'stair' | 'plain';
  const backWalls: [Anchor, Back, typeof MIDDLE | typeof WINGS][] = [
    [EDGES.backMiddle, 'bays', MIDDLE], [EDGES.backMiddleStair, 'stair', MIDDLE], [EDGES.backMiddleJog, 'plain', MIDDLE],
    [EDGES.backWest, 'bays', WINGS], [EDGES.backWestJog, 'stair', WINGS], [EDGES.backWestStub, 'plain', WINGS],
    [EDGES.backEast, 'bays', WINGS], [EDGES.backEastSide, 'bays', WINGS], [EDGES.backEastEnd, 'stair', WINGS],
  ];
  for (const [e, kind, { H, floors }] of backWalls) {
    const f = edgeFrame(campus, e);
    if (!f) continue;
    const L = f.len, b = build(f);
    skin(b, f, H, []);
    // Smooth grey plinth along the foot, and the band above the eaves.
    b.put(span(-0.02, L + 0.02, -0.3, BACK.plinth, 0.02, BACK.plinthDepth), backPlinth);
    b.solid(0, L, 0, BACK.plinth, 0.02, BACK.plinthDepth);
    b.put(span(-0.05, L + 0.05, H - 0.25, H + PARAPET, 0.02, 0.3), concrete, 2);
    if (kind === 'stair') {
      const m = L / 2, w = Math.min(1.1, L - 0.8);
      for (const fy of [0, ...floors]) {
        const y0 = fy + 1.7, y1 = fy + 3.2;
        if (y1 > H - 0.3) continue;
        stripWindow(b, m - w / 2, m + w / 2, y0, y1);
        b.put(span(m - w / 2 - 0.1, m + w / 2 + 0.1, y0 - 0.12, y0, 0.02, 0.22), concrete, 2);
      }
    }
    if (kind === 'bays') {
      const P = BACK.pier, n = Math.max(1, Math.round((L - P) / BACK.bay)), st = (L - P) / n;
      for (let k = 0; k <= n; k++) {
        const a = k * st, c = a + P;
        b.put(span(a, c, BACK.plinth, H - 0.25, 0.02, BACK.pierDepth), concrete, 2);
        b.put(span(a - 0.05, c + 0.05, -0.3, BACK.plinth + 0.15, 0.02, BACK.pierDepth + 0.06), backPlinth);
        b.solid(a, c, 0, 2.6, 0.02, BACK.pierDepth + 0.06);
        if (n >= 3 && (k === 1 || k === n - 1)) pipe(b, (a + c) / 2, -0.3, H, BACK.pierDepth + 0.08); // white downpipes on some pilasters
      }
      for (let k = 0; k < n; k++) {
        const a = k * st + P, c = (k + 1) * st, x0 = a + 0.12, x1 = c - 0.12;
        // Ground floor: sill on the plinth, the diamond-mesh grille band (dark room behind), a ledge, the window band, a hood.
        b.put(span(a, c, BACK.plinth, BACK.plinth + 0.12, 0.02, 0.3), concrete, 2);
        const gw = x1 - x0, gh = 2.3 - BACK.plinth - 0.12, gg = new PlaneGeometry(gw, gh).translate((x0 + x1) / 2, BACK.plinth + 0.12 + gh / 2, 0.14);
        const guv = gg.getAttribute('uv');
        for (let i = 0; i < guv.count; i++) guv.setXY(i, (guv.getX(i) * gw) / 0.4, (guv.getY(i) * gh) / 0.4);
        b.put(gg, grille);
        const gn = Math.max(1, Math.round(gw / BACK.pane));
        for (let q = 0; q <= gn; q++) { const x = x0 + (gw * q) / gn; b.put(span(Math.max(x0, x - 0.03), Math.min(x1, x + 0.03), BACK.plinth + 0.12, 2.3, 0.05, 0.16), backFrame); }
        b.put(span(a, c, 2.3, 2.45, 0.02, 0.28), concrete, 2);
        stripWindow(b, x0, x1, 2.45, 3.15);
        b.put(span(a, c, 3.15, 3.45, 0.02, 0.34), concrete, 2);
        // Upper floors: sill, the two strip-window bands, a hood; an AC on some sills.
        for (const fy of floors) {
          b.put(span(a, c, fy + 0.85, fy + 0.97, 0.02, 0.3), concrete, 2);
          stripWindow(b, x0, x1, fy + 0.97, fy + 1.9);
          b.put(span(x0, x1, fy + 1.9, fy + 1.98, 0.05, 0.12), backFrame);
          stripWindow(b, x0, x1, fy + 1.98, fy + 2.7);
          b.put(span(a, c, fy + 2.7, fy + 3.0, 0.02, 0.4), concrete, 2);
          if (seeded() < 0.55) acUnit(b, x0 + 0.6 + seeded() * (x1 - x0 - 1.2), fy + 0.97);
        }
      }
    }
    b.done();
  }

  // --- C1 (使用者照片 2026-11-24) ---------------------------------------------------------------------------
  const c1 = campus.buildings.find((x) => x.id === DORM_C.c1);
  if (c1) {
    const H = c1.height, floors = Array.from({ length: Math.max(0, c1.levels - 1) }, (_, k) => (k + 1) * STOREY);
    const c1Plinth = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 256, aggregate), color: 0xa19e96, roughness: 0.95 }));
    const c1Letters = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 128, letterSign('C1')), transparent: true, roughness: 0.5 }));
    /** A box from (x0, z0) to (x1, z1) in the frame's ground plane, `t` thick, y0..y1. */
    const seg = (b: ReturnType<typeof build>, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, t: number, m: Material): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      b.put(new BoxGeometry(len, y1 - y0, t).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), m, 2);
    };
    /** A flat polygon (frame x, z) from y = top − t to top. */
    const slab = (b: ReturnType<typeof build>, pts: readonly (readonly [number, number])[], top: number, t: number, m: Material): void => {
      const g = new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, z))), { depth: t, bevelEnabled: false });
      b.put(g.rotateX(Math.PI / 2).translate(0, top, 0), m, 2);
    };
    const n = C1.ring.length;
    for (let i = 0; i < n; i++) {
      const f = edgeFrame(campus, { id: DORM_C.c1, i, a: C1.ring[i]!, b: C1.ring[(i + 1) % n]! });
      if (!f) continue;
      const L = f.len, b = build(f);
      skin(b, f, H, []);
      b.put(span(-0.05, L + 0.05, H - 0.2, H + PARAPET, 0.02, 0.14), concrete, 2); // band above the eaves
      const side = C1.tallPlinthEdges.includes(i), PL = side ? C1.tallPlinth : C1.plinth;
      if (!C1.noPlinth.includes(i)) {
        b.put(span(-0.02, L + 0.02, -0.3, PL, 0.02, side ? 0.22 : 0.16), c1Plinth, 2);
        b.solid(0, L, 0, PL, 0.02, side ? 0.22 : 0.16);
      }
      /** A window in a deep concrete frame: hood, cheeks and sill `d` out. */
      const framed = (x0: number, x1: number, y0: number, y1: number, d = 0.45): void => {
        windowAt(b, x0, x1, y0, y1);
        b.put(span(x0 - 0.18, x1 + 0.18, y1, y1 + 0.18, 0.02, d), concrete, 2);
        for (const s of [x0 - 0.18, x1]) b.put(span(s, s + 0.18, y0 - 0.12, y1, 0.02, d), concrete, 2);
        b.put(span(x0 - 0.18, x1 + 0.18, y0 - 0.12, y0, 0.02, d - 0.15), concrete, 2);
      };
      /** Ground floor of the side faces: two window bands one above the other on the tall plinth, a ledge between. */
      const twoBands = (x0: number, x1: number): void => {
        const y0 = PL + 0.15, ym = PL + 0.85, y1 = STOREY - 0.2;
        windowAt(b, x0, x1, y0, ym);
        windowAt(b, x0, x1, ym + 0.1, y1);
        b.put(span(x0 - 0.1, x1 + 0.1, ym, ym + 0.1, 0.02, 0.3), concrete, 2);
        b.put(span(x0 - 0.18, x1 + 0.18, PL, PL + 0.15, 0.02, 0.4), concrete, 2);
        b.put(span(x0 - 0.18, x1 + 0.18, y1, y1 + 0.2, 0.02, 0.45), concrete, 2);
        for (const s of [x0 - 0.18, x1]) b.put(span(s, s + 0.18, PL, y1, 0.02, 0.45), concrete, 2);
      };
      if (i === C1.bayEdge) {
        // Balcony tower, centred on the face: back corners on the wall, front corners `depth` out.
        const { back, front, depth: D } = C1.bay, xc = L / 2;
        const poly: [number, number][] = [[xc - back / 2, 0], [xc + back / 2, 0], [xc + front / 2, D], [xc - front / 2, D]];
        for (const fy of [...floors, H]) {
          const roof = fy === H, top = fy + 0.15, next = roof ? H + 1.2 : fy + STOREY - 0.25;
          slab(b, poly, top, 0.45, steps);
          // Low side walls along the angled sides; the front all red lattice between white posts.
          for (const s of [-1, 1]) seg(b, xc + (s * back) / 2, 0.02, xc + (s * front) / 2, D - 0.06, top, roof ? next : top + 0.95, 0.12, steps);
          latticePanel(b, xc - front / 2 + 0.12, xc + front / 2 - 0.12, top, next, D - 0.08);
          for (const s of [-1, 1]) {
            b.put(span(xc + (s * front) / 2 - 0.09, xc + (s * front) / 2 + 0.09, top, next, D - 0.17, D + 0.01), paint);
            if (!roof) pipe(b, xc + (s * (back + front)) / 4, top, next, D / 2); // thin white posts in the open sides
          }
          if (roof) b.put(span(xc - front / 2 - 0.05, xc + front / 2 + 0.05, next, next + 0.12, -0.05, D + 0.05), steps, 2);
          else {
            // The balcony's back wall, dark behind the lattice.
            b.put(span(xc - back / 2 + 0.15, xc + back / 2 - 0.15, top, next, 0.06, 0.07), voidDark);
          }
        }
        // Ground floor: the lobby set back under the tower (glass in dormYard.ts), two columns at its front corners,
        // 「C1」 on the 2F slab's front.
        for (const s of [-1, 1]) {
          const x = xc + (s * front) / 2;
          b.put(span(x - 0.17, x + 0.17, 0, floors[0]! - 0.25, D - 0.4, D - 0.06), steps, 2);
          b.solid(x - 0.17, x + 0.17, 0, floors[0]! - 0.25, D - 0.4, D - 0.06);
        }
        b.put(new PlaneGeometry(1.5, 0.75).translate(xc, floors[0]! + 0.55, D + 0.02), c1Letters); // in front of the lattice, just above the slab (照片)
      } else if (i === C1.side) {
        // Seen from outside the corner with the plain front face is on the left (x = 0). Right at the corner: a recessed strip
        // with one deep window per floor and the two ground-floor bands; then a row of windows per floor.
        const S = Math.min(C1.split, L - 3);
        const r0 = S - 1.8, r1 = S - 0.2;
        twoBands(r0, r1);
        for (const fy of floors) framed(r0, r1, fy + 1.0, fy + 2.2, 0.6);
        b.put(span(r1 + 0.15, r1 + 0.25, STOREY, H - 0.2, 0.02, 0.5), concrete, 2); // the strip's edge toward the rest
        const k = Math.max(1, Math.round((L - S - 0.4) / 3.0)), st = (L - S - 0.4) / k;
        for (let q = 0; q < k; q++) {
          const x0 = S + q * st + 0.3, x1 = S + (q + 1) * st - 0.3;
          twoBands(x0, x1);
          for (const fy of floors) {
            framed(x0, x1, fy + 1.0, fy + 2.2);
            if (seeded() < 0.6) acUnit(b, x0 + 0.5 + seeded() * (x1 - x0 - 1.0), fy + 0.95);
          }
        }
      } else if (i === C1.sideN) {
        // Seen from outside the east end is on the left (x = 0), the corner by the tower on the right (x = L).
        const s1 = C1.stairW, s2 = Math.min(L - 3.5, C1.rowsEnd);
        for (const fy of [0, ...floors]) framed(s1 / 2 - 0.35, s1 / 2 + 0.35, fy + (fy === 0 ? PL + 0.4 : 1.5), fy + 3.1, 0.3);
        b.put(span(s1 - 0.3, s1, PL, H - 0.2, 0.02, 0.45), concrete, 2); // the stair column's edge
        const k = Math.max(1, Math.round((s2 - s1) / 2.0)), st = (s2 - s1) / k;
        for (let q = 0; q < k; q++) {
          const x0 = s1 + q * st + 0.25, x1 = s1 + (q + 1) * st - 0.25;
          twoBands(x0, x1);
          for (const fy of floors) {
            framed(x0, x1, fy + 1.0, fy + 2.2);
            if (seeded() < 0.7) acUnit(b, (x0 + x1) / 2, fy + 0.95);
          }
          if (q > 0) b.put(span(x0 - 0.38, x0 - 0.12, PL, H - 0.2, 0.02, 0.4), concrete, 2); // pilaster between bays
        }
        b.put(span(s2 - 0.05, s2 + 0.25, PL, H - 0.2, 0.02, 0.45), concrete, 2);
        twoBands(s2 + 0.45, L - 0.4);
        for (const fy of floors) framed(s2 + 0.45, L - 0.4, fy + 1.2, fy + 2.2, 0.7); // deep recessed band per floor
      } else if (i === C1.svcBack || i === C1.svcMirror) {
        // `u` is measured from the diagonal corner: on edge 7 that is x = 0 (left, seen from outside), on the mirrored
        // edge 9 it is x = L (right). The service centre covers the ground floor.
        const X = (u0: number, u1: number): [number, number] => (i === C1.svcMirror ? [L - u1, L - u0] : [u0, u1]);
        const nc = 1.3, u0b = nc + 0.15, st = (L - 0.3 - u0b) / C1.svcBays;
        for (const fy of floors) {
          framed(...X(0.35, nc - 0.25), fy + 1.1, fy + 2.3, 0.3);
          b.put(span(...X(u0b - 0.1, L - 0.1), fy + 0.8, fy + 0.98, 0.02, 0.45), concrete, 2); // sill band
          b.put(span(...X(u0b - 0.1, L - 0.1), fy + 2.4, fy + 2.7, 0.02, 0.55), concrete, 2); // hood band
          for (let q = 0; q < C1.svcBays; q++) {
            const [x0, x1] = X(u0b + q * st + 0.15, u0b + (q + 1) * st - 0.15);
            windowAt(b, x0, x1, fy + 0.98, fy + 2.4);
            if (seeded() < 0.75) acUnit(b, (x0 + x1) / 2 + (seeded() - 0.5) * 0.6, fy + 0.25);
          }
        }
        for (let q = 0; q <= C1.svcBays; q++) { const [x0, x1] = X(u0b + q * st - 0.12, u0b + q * st + 0.12); b.put(span(x0, x1, STOREY, H - 0.2, 0.02, 0.5), concrete, 2); }
      } else if (i === C1.svcDiag) {
        // One deep opening per floor: cheeks and slabs well out from the wall, a dark back with a window, an AC.
        const x0 = 0.5, x1 = L - 0.5, D = 0.8;
        for (const fy of floors) {
          const y0 = fy + 0.9, y1 = fy + 2.6;
          b.put(span(x0, x1, y0, y1, 0.03, 0.05), voidDark);
          windowAt(b, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.2);
          b.put(span(x0 - 0.25, x1 + 0.25, y1, y1 + 0.3, 0.02, D), concrete, 2);
          b.put(span(x0 - 0.25, x1 + 0.25, y0 - 0.25, y0, 0.02, D), concrete, 2);
          for (const sx of [x0 - 0.25, x1]) b.put(span(sx, sx + 0.25, y0, y1, 0.02, D), concrete, 2);
          acUnit(b, x1 - 0.7, y0);
        }
      } else if (C1.southLike.includes(i)) {
        // Mostly plain: a column of narrow windows a little left of the middle, one wide two-band window downstairs right of it.
        const { at, w } = C1.southColumn, [g0, g1] = C1.southGround;
        for (const fy of floors) framed(L * at - w / 2, L * at + w / 2, fy + 0.9, fy + 2.6, 0.35);
        twoBands(L * g0, L * g1);
      } else if (!C1.blank.includes(i)) {
        // A row of windows per floor, each in a deep concrete frame (hood, cheeks, sill).
        const { w, y0: wy0, y1: wy1, every } = C1.window;
        const k = Math.max(1, Math.floor((L - 0.6) / every));
        for (let q = 0; q < k; q++) {
          const m = (L * (q + 0.5)) / k, x0 = m - w / 2, x1 = m + w / 2;
          if (x0 < 0.3) continue;
          for (const fy of [0, ...floors]) {
            const y0 = fy + (fy === 0 ? C1.plinth + 0.15 : wy0), y1 = fy + wy1;
            windowAt(b, x0, x1, y0, y1);
            b.put(span(x0 - 0.18, x1 + 0.18, y1, y1 + 0.18, 0.02, 0.45), concrete, 2);
            for (const s of [x0 - 0.18, x1]) b.put(span(s, s + 0.18, y0 - 0.12, y1, 0.02, 0.45), concrete, 2);
            b.put(span(x0 - 0.18, x1 + 0.18, y0 - 0.12, y0, 0.02, 0.3), concrete, 2);
          }
        }
      }
      b.done();
    }
  }

  // --- C2 (使用者照片 2026-11-24) ---------------------------------------------------------------------------
  const c2 = campus.buildings.find((x) => x.id === DORM_C.c2);
  if (c2) {
    const H = c2.height, floors = Array.from({ length: Math.max(0, c2.levels - 1) }, (_, k) => (k + 1) * STOREY);
    const c2Letters = tracker.material(new MeshStandardMaterial({ map: canvasTexture(tracker, 256, 128, letterSign('C2')), transparent: true, roughness: 0.5 }));
    const railBlue = mat(0x6fc3d8, { metalness: 0.3, roughness: 0.4 });
    const n = C2.ring.length;
    for (let i = 0; i < n; i++) {
      const f = edgeFrame(campus, { id: DORM_C.c2, i, a: C2.ring[i]!, b: C2.ring[(i + 1) % n]! });
      if (!f) continue;
      const L = f.len, b = build(f);
      skin(b, f, H, []);
      b.put(span(-0.05, L + 0.05, H - 0.2, H + PARAPET, 0.02, 0.14), concrete, 2);
      /** Sill, two strip-window bands and a hood for one upper floor between x0 and x1; an AC on some. */
      const upper = (x0: number, x1: number, fy: number, ac: boolean): void => {
        b.put(span(x0 - 0.1, x1 + 0.1, fy + 0.85, fy + 0.97, 0.02, 0.3), concrete, 2);
        stripWindow(b, x0, x1, fy + 0.97, fy + 1.9);
        b.put(span(x0, x1, fy + 1.9, fy + 1.98, 0.05, 0.12), backFrame);
        stripWindow(b, x0, x1, fy + 1.98, fy + 2.7);
        b.put(span(x0 - 0.1, x1 + 0.1, fy + 2.7, fy + 2.95, 0.02, 0.35), concrete, 2);
        if (ac && seeded() < 0.6) acUnit(b, x0 + 0.5 + seeded() * Math.max(0, x1 - x0 - 1.0), fy + 0.97);
      };
      if (i === C2.front) {
        // Seen from outside: pier | side column | pier | centre balcony | pier | side column | pier.
        const P = C2.pier, side = (L - 4 * P - C2.centre) / 2;
        const xs = [0, P + side, 2 * P + side + C2.centre, L - P];
        for (const x of xs) {
          b.put(span(x, x + P, 0, H - 0.2, 0.02, 0.32), concrete, 2);
          b.solid(x, x + P, 0, 2.6, 0.02, 0.32);
        }
        const cols: [number, number][] = [[P, P + side], [L - P - side, L - P]];
        const c0 = 2 * P + side, c1 = c0 + C2.centre;
        for (const fy of floors) {
          b.put(span(0, L, fy - 0.3, fy + 0.25, 0.02, 0.3), concrete, 2); // floor band across the block
          for (const [a, c] of cols) upper(a + 0.15, c - 0.15, fy, true);
          // Centre balcony: dark loggia, red lattice in the middle, white posts in the open sides, a thin rail.
          b.put(span(c0, c1, fy + 0.25, fy + STOREY - 0.3, 0.06, 0.07), voidDark);
          const l0 = c0 + 1.15, l1 = c1 - 1.15;
          latticePanel(b, l0, l1, fy + 0.25, fy + STOREY - 0.3, 0.2);
          for (const x of [l0, l1]) b.put(span(x - 0.06, x + 0.06, fy + 0.25, fy + STOREY - 0.3, 0.12, 0.3), paint);
          for (const x of [c0 + 0.55, c1 - 0.55]) pipe(b, x, fy + 0.25, fy + STOREY - 0.3, 0.22);
          for (const [a, c] of [[c0, l0], [l1, c1]] as const) b.put(span(a, c, fy + 1.0, fy + 1.05, 0.24, 0.28), paint);
          b.put(span(c0, c1, fy + STOREY - 0.55, fy + STOREY - 0.3, 0.02, 0.3), concrete, 2); // head of the loggia
        }
        // Ground floor: three glass bays (doors in the middle), green kick plates, 「C2」 above the doors.
        const T = C2.terrace.top;
        for (const [a, c] of [...cols, [c0, c1]] as const) {
          b.put(span(a, c, T, STOREY - 0.3, 0.06, 0.1), glass);
          b.put(span(a, c, T, T + 0.4, 0.1, 0.12), kick);
          for (let x = a; x <= c + 1e-6; x += (c - a) / 4) b.put(span(Math.max(a, x - 0.03), Math.min(c, x + 0.03), T, STOREY - 0.3, 0.06, 0.14), brownFrame);
          b.put(span(a, c, T + 2.3, T + 2.36, 0.06, 0.14), brownFrame);
        }
        b.put(span(0, L, STOREY - 0.3, STOREY + 0.25, 0.02, 0.3), concrete, 2);
        b.put(new PlaneGeometry(1.2, 0.6).translate((c0 + c1) / 2, STOREY - 0.02, 0.32), c2Letters);
        // Terrace in front, three steps down in the middle, a low planter wall on the left and a blue rail on the right.
        const { depth: TD, rise: R, tread: TR } = C2.terrace;
        b.put(span(0.2, L - 0.2, -0.3, T, 0.02, TD), steps, 2);
        b.solid(0.2, L - 0.2, 0, T, 0.02, TD);
        for (let k = 1; k <= 2; k++) {
          const top = T - k * R, z1 = TD + k * TR;
          b.put(span(c0, c1, -0.3, top, TD, z1), steps, 2);
          b.solid(c0, c1, 0, top, TD, z1);
        }
        for (const [a, c] of [[0.2, c0], [c1, L - 0.2]] as const) {
          b.put(span(a, c, T, T + 0.45, TD - 0.25, TD), concrete, 2); // low wall along the terrace edge
          b.solid(a, c, 0, T + 0.45, TD - 0.25, TD);
        }
        for (const x of [0.5, 0.9, 1.3]) {
          b.put(new CylinderGeometry(0.14, 0.11, 0.25, 10).translate(x, T + 0.125, TD - 0.55), mat(0xb35a3c, { roughness: 0.8 }));
          b.put(new SphereGeometry(0.2, 8, 6).translate(x, T + 0.35, TD - 0.55), mat(0x497a32, { roughness: 0.9, flatShading: true }));
        }
        const rx0 = c1 + 0.5, rx1 = L - 0.3;
        for (const x of [rx0, (rx0 + rx1) / 2, rx1]) b.put(new CylinderGeometry(0.03, 0.03, 0.9, 8).translate(x, T + 0.45 + 0.45, TD - 0.12), railBlue);
        b.put(new CylinderGeometry(0.035, 0.035, rx1 - rx0, 8).rotateZ(Math.PI / 2).translate((rx0 + rx1) / 2, T + 1.35, TD - 0.12), railBlue);
      } else if (!C2.plain.includes(i)) {
        // Wings and long faces: pilasters about every 3.4 m, two strip bands per upper floor, dark windows over a plinth.
        b.put(span(-0.02, L + 0.02, -0.3, C2.plinth, 0.02, 0.18), plinthGrey, 2);
        b.solid(0, L, 0, C2.plinth, 0.02, 0.18);
        const P = 0.45, k = Math.max(1, Math.round((L - P) / 3.4)), st = (L - P) / k;
        for (let q = 0; q <= k; q++) b.put(span(q * st, q * st + P, C2.plinth, H - 0.2, 0.02, 0.3), concrete, 2);
        for (let q = 0; q < k; q++) {
          const a = q * st + P + 0.12, c = (q + 1) * st - 0.12;
          windowAt(b, a, c, C2.plinth + 0.25, STOREY - 0.5);
          b.put(span(a - 0.1, c + 0.1, STOREY - 0.5, STOREY - 0.25, 0.02, 0.3), concrete, 2);
          for (const fy of floors) upper(a, c, fy, true);
        }
      }
      b.done();
    }
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}

/**
 * The C3 lobby's open double door (正面照), world: its middle on the storefront line, and the outward
 * unit normal (toward the courtyard). For the 「進入宿舍」 prompt and where 「離開宿舍」 puts you back.
 */
export function dormCLobbyDoor(campus: CampusData): { x: number; z: number; outX: number; outZ: number; floor: number } | null {
  const f = edgeFrame(campus, EDGES.centre);
  if (!f) return null;
  const E = CENTRE.endPier, L = f.len;
  const C1 = L - DORM_C.roomWidth, C0 = C1 - (BAL.a1 - BAL.a0 + 2 * E);
  const lob0 = C0 + E, W = C1 - E - lob0;
  const mid = lob0 + W * (STOREFRONT[1] + STOREFRONT[2]) / 2; // the open double door
  const [x, z] = f.world(mid, 0.6);
  return { x, z, outX: f.nx, outZ: f.nz, floor: LOBBY.floor };
}
