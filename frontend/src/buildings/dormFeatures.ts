import {
  BoxGeometry,
  CanvasTexture,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from '../campus/campusTypes';
import type { CampusMaterials } from '../campus/campusMaterials';
import { campusTreeGeometry } from '../campus/campusWorld';

/**
 * 宿舍區 C / D 棟外的設施（使用者實拍，2026-11-19；南北向宿舍路與 B2 / E 之間那條路的路口西側）：
 *  - 學生宿舍C：L 形轉角內的單層「宿舍服務中心」（正面照＋使用者平面圖）。45° 正面兩端各一小段垂直接牆；
 *    正面由西到東：有窗與無障礙標誌的實牆段、玻璃店面（上排氣窗、中間大片玻璃、下排黃底紅字「宿 舍 服 … 務 中 心」）、
 *    深色窗的實牆段；店面上方深灰招牌（藍色 C、金字「國立雲林科技大學 學生宿舍服務中心」、右側紅色 LED 板），
 *    招牌下白色出挑簷口。前方 0.6 m 高的平台，外緣一圈三階台階（西端接坡道矮牆、東端接北棟牆面）；
 *    無障礙坡道從平台西南角沿南翼牆面往外下降，外側混凝土矮牆（藍色指標牌）與扶手。廣場上紅色花盆、樹穴、燈柱。
 *  - 學生宿舍D（入口正面照＋使用者要求與服務中心一樣）：東北向的凹角用同一套「切角輪廓」：上方雨遮（45° 前緣＋
 *    兩端垂直接牆的短段，前緣混凝土帶有藍色 D、三根方柱）、兩樘門（斜牆與北翼東面）與中間綠籬花台、0.6 m 平台、
 *    外緣一圈三階台階（東端接北翼牆面）、沿東翼北面往外下降的無障礙坡道；廣場鋪面、細高的樹穴樹、花盆、燈柱。
 * 每個設施都掛在一面 OSM 外牆上（建築 id ＋ 邊編號，端點對不上就略過）：局部 +x 沿牆、+z 朝外、
 * 原點在牆的終點（外環為逆時針，這樣 +z 才會朝外）。
 *
 * 閱讀順序：常數 → 幾何工具 → 牆面座標系 → 每個部件一個 add… 函式 → createDormFeatures。
 */

// ---------------------------------------------------------------- anchors (OSM id, edge, endpoints)
interface WallAnchor { id: number; edge: number; a: [number, number]; b: [number, number] }
/** 學生宿舍D 東北向斜牆（入口凹處）。 */
const D_RECESS: WallAnchor = { id: 296668594, edge: 1, a: [22.0, 380.5], b: [25.7, 383.9] };
/** 學生宿舍D 北翼東面（入口右手邊凸出的那面牆）。 */
const D_WING: WallAnchor = { id: 296668594, edge: 0, a: [20.6, 372.3], b: [22.0, 380.5] };

// ---------------------------------------------------------------- dimensions (m)
/**
 * 入口「切角輪廓」（使用者平面圖，2026-11-20；學生宿舍C 服務中心與學生宿舍D 入口共用同一套尺寸與角度）。
 * 每處都在一個「角落座標系」裡：原點是兩面牆（延長線）的交點，x 沿 x 牆往外（C：北棟南面；D：北翼東面），
 * z 沿 z 牆往外（C：南翼東面；D：東翼北面），z 牆在這個座標系裡是 x = mz·z（幾乎垂直）。兩牆之間是一段 OSM 斜牆。
 * 平面是一圈圈的切角輪廓：垂直 z 牆的一段 → 45° 斜段（x + z = k）→ 垂直 x 牆的一段。
 *  - 量體 / 雨遮（藍線）：45° 前緣 x + z = frontK，兩端各一段長 ret 的短段垂直接到兩面牆。
 *  - 平台（高 TERRACE_TOP）：前緣到台階內緣之間。
 *  - 台階（紅線）：STEP_COUNT 階、每階 TREAD；z 牆側沿 z = rampTop 接到坡道外側矮牆（內緣短段長 legInner），
 *    45° 斜段，x 牆側沿 x = eastX 接到 x 牆（外緣在 eastX + 三階）。
 *  - 無障礙坡道（沿 z 牆那段紅線）：從平台角（z = rampTop）沿 z 牆往外下降 len，離牆 inset、寬 width，外側矮牆、扶手、藍色指標牌。
 */
const ENTRY = { frontK: 8.76, ret: 1.0, legInner: 0.81, eastX: 10.65, rampTop: 10.8 };
const RAMP = { len: 4.0, width: 1.4, inset: 0.1, wall: 0.15, wallTop: 1.15 };
const RISE = 0.15;
const TREAD = 0.35;
const TERRACE_TOP = 0.6;
const STEP_COUNT = 3;

type P2 = [number, number];
/** One corner: its base wall frame and the two walls in that frame, each from its end at the OSM diagonal outward. */
interface CornerSpec { base: WallAnchor; xWall: readonly [P2, P2]; zWall: readonly [P2, P2] }
/** 學生宿舍C：北棟南面（x 牆）與南翼東面（z 牆），中間 OSM 小斜牆。 */
const C_CORNER: CornerSpec = { base: { id: 296668595, edge: 9, a: [26.4, 337.6], b: [18.3, 339.1] }, xWall: [[0, 0], [8.24, 0]], zWall: [[-3.64, 3.19], [-4.22, 13.45]] };
/** 學生宿舍D：北翼東面（x 牆）與東翼北面（z 牆），中間是入口斜牆。 */
const D_CORNER: CornerSpec = { base: { id: 296668594, edge: 1, a: [22.0, 380.5], b: [25.7, 383.9] }, xWall: [[5.04, 0], [11.6, 5.15]], zWall: [[0, 0], [-4.94, 6.95]] };

/** Corner geometry in its base wall frame: origin, axes, the z-wall slope and the walls' ends in corner coords. */
interface CornerGeom { o: P2; X: P2; Z: P2; mz: number; chamfer: [P2, P2]; xEnd: number; zEnd: P2; toBase(x: number, z: number): P2 }
function cornerGeom(sp: CornerSpec): CornerGeom {
  const [[ax, az], [bx, bz]] = sp.xWall, [[cx, cz], [dx, dz]] = sp.zWall;
  const xl = Math.hypot(bx - ax, bz - az), X: P2 = [(bx - ax) / xl, (bz - az) / xl];
  const zl = Math.hypot(dx - cx, dz - cz), zd: P2 = [(dx - cx) / zl, (dz - cz) / zl];
  // Intersection of the two wall lines: a + t·X = c + u·zd.
  const det = X[0] * -zd[1] - X[1] * -zd[0];
  const t = ((cx - ax) * -zd[1] - (cz - az) * -zd[0]) / det;
  const o: P2 = [ax + X[0] * t, az + X[1] * t];
  const Z: P2 = [-X[1], X[0]];
  const to = (p: readonly [number, number]): P2 => [(p[0] - o[0]) * X[0] + (p[1] - o[1]) * X[1], (p[0] - o[0]) * Z[0] + (p[1] - o[1]) * Z[1]];
  const mz = (zd[0] * X[0] + zd[1] * X[1]) / (zd[0] * Z[0] + zd[1] * Z[1]);
  return {
    o, X, Z, mz, chamfer: [to(sp.xWall[0]), to(sp.zWall[0])], xEnd: to(sp.xWall[1])[0], zEnd: to(sp.zWall[1]),
    toBase: (x, z) => [o[0] + X[0] * x + Z[0] * z, o[1] + X[1] * x + Z[1] * z],
  };
}
/** z wall: x at depth z, its unit direction (outward) and the unit normal toward the plaza. */
function zWallLine(g: CornerGeom): { x(z: number): number; w: P2; p: P2 } {
  const n = Math.hypot(g.mz, 1);
  return { x: (z) => g.mz * z, w: [g.mz / n, 1 / n], p: [1 / n, -g.mz / n] };
}
/** The front (body / canopy edge): west end (on the z-wall return), east end (on the x-wall return), and where the returns meet the walls. */
function entryFront(g: CornerGeom): { west: P2; east: P2; wingPt: P2; northPt: P2 } {
  const { frontK: k, ret } = ENTRY;
  const zw = (k - ret) / (1 + g.mz);
  return { west: [g.mz * zw + ret, zw], east: [k - ret, ret], wingPt: [g.mz * zw, zw], northPt: [k - ret, 0] };
}
/** Outer face of the ramp parapet at depth z. */
function rampWallX(g: CornerGeom, z: number): number {
  const wl = zWallLine(g), o = RAMP.inset + RAMP.width + RAMP.wall;
  const z0 = ENTRY.rampTop, px = wl.x(z0) + wl.p[0] * o, pz = z0 + wl.p[1] * o;
  return px + (z - pz) * (wl.w[0] / wl.w[1]);
}
/** The steps' boundary at distance d outward from their inner edge: z-wall leg, 45° run, x-wall leg. */
function stepsLine(g: CornerGeom, d: number): P2[] {
  const top = ENTRY.rampTop, k0 = rampWallX(g, top) + ENTRY.legInner + top;
  const z = top + d, k = k0 + d * Math.SQRT2, x = ENTRY.eastX + d;
  return [[rampWallX(g, z), z], [k - z, z], [x, k - x], [x, 0]];
}
/** Footprint behind the front: returns, the z wall, the OSM diagonal, the x wall (a few cm into the walls). */
function entryBody(g: CornerGeom): P2[] {
  const f = entryFront(g), [cx, cz] = g.chamfer;
  return [f.west, [f.wingPt[0] - 0.05, f.wingPt[1]], [cz[0] - 0.05, cz[1]], [cx[0] + 0.05, cx[1] - 0.05], [f.northPt[0], -0.05], f.east];
}

/** 服務中心正面分段（正面座標 x，從西端算起）：西實牆段 | 玻璃店面 | 東深色窗段（到正面全長）。 */
const SHOP = { x0: 1.8, x1: 8.6 };
/** 店面上方的招牌與白色簷口：x 範圍、高度、從牆面出挑 out、簷底厚度。 */
const FASCIA = { x0: 1.6, x1: 8.8, y0: 3.12, y1: 4.0, out: 1.0, soffit: 0.12 };
const SVC_ROOF = 3.4;
/** 學生宿舍D 雨遮：頂板高度、前緣混凝土帶高度、D 字位置（0..1）。兩樘門：斜牆（D_RECESS x）、北翼東面（D_WING x）。 */
const D_CANOPY = { y: 3.35, band: 0.95, letterX: 0.42 };
const D_DOORS = { recess: [0.5, 2.3] as const, wing: [1.2, 2.8] as const };

/** Paving pattern repeat (m): the red bands form a grid this size. */
const PAVING_BAND = 4;
/** A square tree pit (frame coords), the tree's scale and an optional extra vertical stretch. */
type Pit = { x: number; z: number; size: number; scale: number; lift?: number };
/** Plaza dressing per corner (corner coords, all outside the steps): paving outline beyond the walls' ends, pits, pots. */
interface PlazaSpec { outline: readonly P2[]; pits: readonly Pit[]; pots: readonly P2[] }
const C_PLAZA: PlazaSpec = {
  // Out to the two roads (about 0.4 m short of the kerb).
  outline: [[17.06, 0], [17.06, 12.5], [13.96, 15.0], [-0.86, 15.0]],
  pits: [{ x: 9.46, z: 8.0, size: 2.0, scale: 1.0 }, { x: 4.96, z: 12.8, size: 1.8, scale: 0.9 }],
  pots: [[7.46, 8.9], [8.76, 9.3], [12.66, 4.4], [13.56, 4.9], [6.26, 10.9]],
};
/** D's trees are slender with their crowns above the first floor (photo): the campus tree narrowed and stretched. */
const D_PLAZA: PlazaSpec = {
  outline: [[15.0, 0], [15.0, 10.0], [10.5, 15.5], [1.0, 15.5]],
  pits: [{ x: 9.46, z: 8.0, size: 1.6, scale: 0.7, lift: 1.6 }, { x: 4.96, z: 12.8, size: 1.6, scale: 0.65, lift: 1.7 }],
  pots: [[7.46, 8.9], [8.76, 9.3], [12.66, 4.4], [13.56, 4.9], [6.26, 10.9]],
};
/** Paving outline in corner coords: the front, then the plaza spec's points, then the z wall's end. */
function plazaOutline(g: CornerGeom, sp: PlazaSpec): P2[] {
  const f = entryFront(g);
  return [f.wingPt, f.west, f.east, f.northPt, ...sp.outline.map(([x, z]) => [x, z] as P2), g.zEnd];
}

// ---------------------------------------------------------------- colours
const CONCRETE = 0xb4b2ac;
const SVC_WALL = 0xc8c6bf;
const LAMP_BLACK = 0x1c1e21;
const POT = 0xb5512f;
const LEAF = 0x3f7a35;

// ---------------------------------------------------------------- textures
function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 店面：深色框、上排淺色氣窗、中間大片玻璃（看得到店內貨架）、下排黃底紅字貼紙與兩張海報，中間一樘門。 */
function storefront(g: CanvasRenderingContext2D): void {
  const W = 1360, H = 480, cols = 9, pw = W / cols;
  g.fillStyle = '#2a2522';
  g.fillRect(0, 0, W, H);
  const decals = ['宿', '舍', '服', '', '', '', '務', '中', '心'];
  for (let i = 0; i < cols; i++) {
    const x = i * pw + 7, w = pw - 14;
    g.fillStyle = '#b9c9c2'; // transom
    g.fillRect(x, 8, w, 72);
    const door = i === 4;
    g.fillStyle = door ? '#33393b' : '#6f8580';
    g.fillRect(x, 92, w, door ? H - 100 : 200);
    if (!door) {
      // Shelves and goods inside.
      for (const y of [150, 225]) { g.fillStyle = '#5a6764'; g.fillRect(x + 6, y, w - 12, 6); }
      for (let k = 0; k < 6; k++) { g.fillStyle = ['#d9c27a', '#c7655a', '#e8e4d8', '#7fa7c4'][(i + k) % 4]!; g.fillRect(x + 10 + k * (w - 20) / 6, 120 + (k % 2) * 75, (w - 20) / 8, 28); }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 4, 96, w * 0.25, 190);
      // Bottom row: yellow decals with a big red character, or posters.
      const ch = decals[i]!;
      g.fillStyle = ch ? '#f2d34a' : ['#9fd08a', '#f4f1e6', '#f4f1e6'][i % 3]!;
      g.fillRect(x + 4, 304, w - 8, H - 318);
      if (ch) {
        g.fillStyle = '#d42a24';
        g.font = "900 120px 'PingFang TC', 'Noto Sans TC', serif";
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(ch, x + w / 2, 394);
      } else {
        g.fillStyle = '#4a7bb5';
        g.fillRect(x + 20, 330, w - 40, 22);
        g.fillStyle = '#c94a3f';
        for (let k = 0; k < 4; k++) g.fillRect(x + 20, 370 + k * 20, (w - 40) * (0.5 + ((i + k) % 3) * 0.2), 8);
      }
    }
  }
  g.fillStyle = '#1c1816';
  g.fillRect(4 * pw + pw / 2 - 2, 92, 4, H - 100); // door meeting stiles
}

/** 招牌：深灰底、左側藍色 C、金色校名與「學生宿舍服務中心」、右側紅色 LED 板。 */
function signBand(g: CanvasRenderingContext2D): void {
  const W = 1440, H = 176;
  g.fillStyle = '#5f6368';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#4a4e53';
  g.fillRect(0, H - 14, W, 14);
  g.strokeStyle = '#2f73c0';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(78, 84, 46, Math.PI * 0.25, Math.PI * 1.75);
  g.stroke();
  g.fillStyle = '#e2c26a';
  g.font = "800 50px 'PingFang TC', 'Noto Sans TC', serif";
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('國立雲林科技大學 學生宿舍服務中心', 150, 86, 940);
  g.fillStyle = '#121314';
  g.fillRect(1120, 40, 300, 90);
  g.fillStyle = '#ff3b30';
  g.font = "800 50px 'PingFang TC', 'Noto Sans TC', sans-serif";
  g.fillText('歡迎光臨', 1140, 86);
  g.fillStyle = '#3aa7ff';
  g.fillRect(1356, 52, 52, 20);
  g.fillStyle = '#5dff7a';
  g.fillRect(1356, 92, 52, 20);
}

/** 牆面段：灰牆、兩扇窗（`windows` 為 0..1 的起訖），可選無障礙標誌。 */
function wallSection(windows: readonly [number, number][], sign: boolean): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const W = 512, H = 336;
    g.fillStyle = '#a9a69e';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#9a978f';
    g.fillRect(0, H - 40, W, 40); // plinth
    for (const [a, b] of windows) {
      const x0 = a * W, x1 = b * W;
      g.fillStyle = '#3d3a36';
      g.fillRect(x0, 70, x1 - x0, 170);
      g.fillStyle = '#7c8a88';
      for (let k = 0; k < 3; k++) g.fillRect(x0 + 8 + k * ((x1 - x0 - 16) / 3), 78, (x1 - x0 - 16) / 3 - 6, 154);
    }
    if (sign) {
      g.fillStyle = '#1f5fb8';
      g.fillRect(W - 70, 150, 44, 44);
      g.fillStyle = '#fff';
      g.font = '900 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('♿', W - 48, 174);
    }
  };
}

/** 廣場鋪面一格（4 m）：灰色長方形連鎖磚，靠一邊與一端各一條紅磚帶（磚帶在相鄰格之間連成格網）。 */
function plazaPaving(g: CanvasRenderingContext2D): void {
  const S = 512, cell = S / 4; // px per metre
  let seed = 11;
  const r = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const band = 0.7 * cell;
  for (let y = 0; y < S; y += 0.1 * cell) {
    const row = Math.round(y / (0.1 * cell));
    for (let x = (row % 2) * 0.1 * cell - 0.2 * cell; x < S; x += 0.2 * cell) {
      const inBand = y < band || x + 0.1 * cell < band;
      const v = Math.floor(r() * 18);
      g.fillStyle = inBand ? `rgb(${150 + v},${92 + v / 2},${86 + v / 2})` : `rgb(${150 + v},${150 + v},${146 + v})`;
      g.fillRect(x + 1, y + 1, 0.2 * cell - 2, 0.1 * cell - 2);
    }
  }
}

/** 學生宿舍D 門廊前緣的混凝土帶：灰白底、細的上下分縫，藍色 D 在 letterX（0..1）處。 */
function dBand(g: CanvasRenderingContext2D): void {
  const W = 1024, H = 96;
  g.fillStyle = '#d9d8d2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c4c3bd';
  g.fillRect(0, 0, W, 6);
  g.fillRect(0, H - 8, W, 8);
  g.fillStyle = '#2a6fb0';
  g.font = '800 70px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('D', W * D_CANOPY.letterX, H / 2 + 2);
}

/** 白色告示牌（門口旁的立牌）。 */
function noticeBoard(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#2f5d8a';
  g.fillRect(10, 10, 108, 22);
  g.fillStyle = '#8a8a86';
  for (let k = 0; k < 6; k++) g.fillRect(14, 46 + k * 18, 100 - (k % 3) * 18, 7);
}

// ---------------------------------------------------------------- geometry helpers
const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
/** Box spanning x0..x1, y0..y1, z0..z1. */
const span = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry =>
  box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/** Black twin-head lantern (both photos): slim pole, short crossbar along local x, a lantern at each end. */
function lanternGeometry(): { body: BufferGeometry; lit: BufferGeometry } {
  const body = mergeGeometries([
    new CylinderGeometry(0.06, 0.09, 3.7, 8).translate(0, 1.85, 0),
    new CylinderGeometry(0.16, 0.18, 0.3, 8).translate(0, 0.15, 0),
    box(0.95, 0.06, 0.06, 0, 3.62, 0),
    ...[-0.45, 0.45].flatMap((x) => [
      box(0.26, 0.34, 0.26, x, 3.38, 0),
      new ConeGeometry(0.24, 0.16, 4).rotateY(Math.PI / 4).translate(x, 3.62, 0),
    ]),
  ])!;
  const lit = mergeGeometries([-0.45, 0.45].map((x) => box(0.2, 0.26, 0.2, x, 3.38, 0)))!;
  return { body, lit };
}

/** Small terracotta pot with a tall, thin plant (photos: potted podocarpus / small trees). */
function potGeometry(): { pot: BufferGeometry; leaves: BufferGeometry } {
  return {
    pot: new CylinderGeometry(0.21, 0.16, 0.34, 12).translate(0, 0.17, 0),
    leaves: mergeGeometries([
      new CylinderGeometry(0.02, 0.025, 0.5, 5).translate(0, 0.55, 0),
      new SphereGeometry(0.17, 8, 6).scale(1, 2.0, 1).translate(0, 0.85, 0),
      new SphereGeometry(0.12, 8, 6).scale(1, 1.6, 1).translate(0.06, 1.2, 0.02),
    ])!,
  };
}

// ---------------------------------------------------------------- context
interface Ctx {
  scene: Scene;
  physics: RAPIER.World;
  tracker: ResourceTracker;
  colliders: RAPIER.Collider[];
  groups: Group[];
  mat: (color: number, extra?: ConstructorParameters<typeof MeshStandardMaterial>[0]) => MeshStandardMaterial;
}

/** A wall's local frame: origin at the anchor's end vertex, +x back along the wall, +z out of the building. */
interface Frame {
  g: Group;
  /** Local (x, z) → world (x, z). */
  world(x: number, z: number): [number, number];
  /** Cuboid collider: centre in local coords, half extents, extra yaw / pitch about local x. */
  solid(x: number, y: number, z: number, hx: number, hy: number, hz: number, pitch?: number): void;
  add(geo: BufferGeometry, m: Material | Material[], shadow?: boolean): Mesh;
}

/** Frame with its origin at world (ox, oz) and local +x along world (ux, uz); local +z is (−uz, ux). */
function frameAt(ctx: Ctx, ox: number, oz: number, ux: number, uz: number, name: string): Frame {
  const g = new Group();
  g.name = name;
  g.position.set(ox, 0, oz);
  g.rotation.y = Math.atan2(-uz, ux); // local +x → (ux, uz), local +z → (−uz, ux)
  ctx.scene.add(g);
  ctx.groups.push(g);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), g.rotation.y);
  const world = (x: number, z: number): [number, number] => [ox + ux * x - uz * z, oz + uz * x + ux * z];
  return {
    g,
    world,
    solid(x, y, z, hx, hy, hz, pitch = 0) {
      const [wx, wz] = world(x, z);
      const qq = pitch ? q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)) : q;
      ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(wx, y, wz).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w }),
      )));
    },
    add(geo, m, shadow = true) {
      const o = new Mesh(ctx.tracker.geometry(geo), m);
      o.castShadow = shadow;
      o.receiveShadow = true;
      g.add(o);
      return o;
    },
  };
}

function wallFrame(ctx: Ctx, campus: CampusData, w: WallAnchor, name: string): Frame | null {
  const b = campus.buildings.find((q) => q.id === w.id);
  if (!b) return null;
  const r = b.outer, n = r.length / 2, i = w.edge, j = (i + 1) % n;
  if (i >= n) return null;
  const ax = r[i * 2]!, az = r[i * 2 + 1]!, bx = r[j * 2]!, bz = r[j * 2 + 1]!;
  // The OSM data moved: skip rather than float the feature off its wall.
  if (Math.hypot(ax - w.a[0], az - w.a[1]) > 0.5 || Math.hypot(bx - w.b[0], bz - w.b[1]) > 0.5) return null;
  const len = Math.hypot(ax - bx, az - bz);
  // Origin at the edge's end vertex, +x back along the wall: +z then points out of a CCW ring.
  return frameAt(ctx, bx, bz, (ax - bx) / len, (az - bz) / len, name);
}

/** The corner frame for a spec (null if its base wall moved in the OSM data). */
function cornerFrame(ctx: Ctx, campus: CampusData, sp: CornerSpec, name: string): { f: Frame; g: CornerGeom } | null {
  const base = wallFrame(ctx, campus, sp.base, name);
  if (!base) return null;
  const g = cornerGeom(sp);
  const [ox, oz] = base.world(...g.o), [x1, z1] = base.world(g.o[0] + g.X[0], g.o[1] + g.X[1]);
  return { f: frameAt(ctx, ox, oz, x1 - ox, z1 - oz, name), g };
}
/** The front's own frame inside a corner frame: origin at the front's west end, x along it, z out. */
function frontFrame(ctx: Ctx, f: Frame, g: CornerGeom, name: string): { ff: Frame; len: number } {
  const { west, east } = entryFront(g);
  const len = Math.hypot(east[0] - west[0], east[1] - west[1]);
  const [ox, oz] = f.world(...west), [x1, z1] = f.world(west[0] + (east[0] - west[0]) / len, west[1] + (east[1] - west[1]) / len);
  return { ff: frameAt(ctx, ox, oz, x1 - ox, z1 - oz, name), len };
}

/** Prism over a polygon in frame `f` coords (exact shape), with a convex-hull collider (fine where the hull only adds area under something taller). */
function prism(ctx: Ctx, f: Frame, pts: readonly P2[], y0: number, y1: number, m: Material, solid = true): void {
  f.add(new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0), m);
  if (!solid) return;
  const v: number[] = [];
  for (const [x, z] of pts) { const [wx, wz] = f.world(x, z); v.push(wx, y0, wz, wx, y1, wz); }
  const d = RAPIER.ColliderDesc.convexHull(new Float32Array(v));
  if (d) ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(d)));
}

// ---------------------------------------------------------------- parts
/** Black twin-head lanterns at local (x, z) of a frame, crossbar along the frame's x. */
function addLanterns(ctx: Ctx, f: Frame, spots: readonly [number, number][]): void {
  const { body, lit } = lanternGeometry();
  const black = ctx.mat(LAMP_BLACK, { metalness: 0.5 });
  const glow = ctx.mat(0xffffff, { emissive: 0xfff0cc, emissiveIntensity: 0.7 });
  for (const [x, z] of spots) {
    f.add(body.clone().translate(x, 0, z), black);
    f.add(lit.clone().translate(x, 0, z), glow, false);
    f.solid(x, 1.85, z, 0.09, 1.85, 0.09);
  }
  body.dispose();
  lit.dispose();
}

function addPots(ctx: Ctx, f: Frame, spots: readonly (readonly [number, number, number?])[]): void {
  const { pot, leaves } = potGeometry();
  const clay = ctx.mat(POT, { roughness: 0.85 }), leaf = ctx.mat(LEAF, { roughness: 0.9 });
  for (const [x, z, y = 0] of spots) {
    f.add(pot.clone().translate(x, y, z), clay);
    f.add(leaves.clone().translate(x, y, z), leaf);
    f.solid(x, y + 0.3, z, 0.2, 0.3, 0.2);
  }
  pot.dispose();
  leaves.dispose();
}


/** Terrace, wrap-around steps and the ramp along the z wall, in a corner frame. */
function addEntryGround(ctx: Ctx, f: Frame, g: CornerGeom): void {
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const top = TERRACE_TOP, fr = entryFront(g), wl = zWallLine(g);

  // Terrace: z wall → ramp top → steps' inner edge → x wall → the returns and the front.
  prism(ctx, f, [fr.wingPt, [wl.x(ENTRY.rampTop), ENTRY.rampTop], ...stepsLine(g, 0), fr.northPt, fr.east, fr.west], 0, top, concrete);
  // Steps: STEP_COUNT bands around the terrace, each one riser lower.
  for (let k = 0; k < STEP_COUNT; k++) {
    const a = stepsLine(g, k * TREAD), b = stepsLine(g, (k + 1) * TREAD);
    prism(ctx, f, [...a, ...b.reverse()], 0, top - (k + 1) * RISE, concrete);
  }

  // Ramp down along the z wall from the terrace's corner: sloped slab (top edge at terrace height),
  // the parapet on the plaza side with a steel rail and the blue sign.
  const { len: L, width: W, inset, wall: t, wallTop } = RAMP;
  const origin: P2 = [wl.x(ENTRY.rampTop), ENTRY.rampTop];
  const P = (o: number, s: number): P2 => [origin[0] + wl.p[0] * o + wl.w[0] * s, origin[1] + wl.p[1] * o + wl.w[1] * s];
  const rA = P(inset, 0), rB = P(inset + W, 0), rC = P(inset + W, L), rD = P(inset, L);
  {
    const V = (q: P2, y: number): number[] => [q[0], y, q[1]];
    const tris = [
      [V(rA, top), V(rB, top), V(rC, 0)], [V(rA, top), V(rC, 0), V(rD, 0)],
      [V(rA, 0), V(rB, 0), V(rB, top)], [V(rA, 0), V(rB, top), V(rA, top)],
      [V(rA, 0), V(rA, top), V(rD, 0)], [V(rB, 0), V(rC, 0), V(rB, top)],
    ];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(tris.flat(2), 3));
    geo.computeVertexNormals();
    f.add(geo, ctx.tracker.material(new MeshStandardMaterial({ color: CONCRETE, roughness: 0.9, side: DoubleSide })));
    const v: number[] = [];
    for (const [q, y] of [[rA, top], [rB, top], [rA, 0], [rB, 0], [rC, 0], [rD, 0]] as const) { const [wx, wz] = f.world(q[0], q[1]); v.push(wx, y, wz); }
    const d = RAPIER.ColliderDesc.convexHull(new Float32Array(v));
    if (d) ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(d)));
  }
  prism(ctx, f, [rB, rC, P(inset + W + t, L), P(inset + W + t, 0)], 0, wallTop, concrete);
  const steel = ctx.mat(0xc9ccce, { metalness: 0.7, roughness: 0.3 });
  {
    const [ax, az] = P(inset + W - 0.1, 0), [bx, bz] = P(inset + W - 0.1, L);
    const a = new Vector3(ax, top + 0.85, az), b = new Vector3(bx, 0.85, bz);
    const dir = b.clone().sub(a);
    const rail = f.add(new CylinderGeometry(0.025, 0.025, dir.length(), 8), steel);
    rail.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    rail.position.copy(a.add(b).multiplyScalar(0.5));
  }
  const blue = f.add(new PlaneGeometry(0.5, 0.35), ctx.mat(0x1f5fb8), false);
  const [bx, bz] = P(inset + W + t + 0.01, L - 1.0);
  blue.position.set(bx, wallTop - 0.4, bz);
  blue.rotation.y = Math.atan2(wl.p[0], wl.p[1]);
}

/** Plaza paving, tree pits, pots and a lantern a little off the ramp's low end. */
function addEntryPlaza(ctx: Ctx, f: Frame, g: CornerGeom, sp: PlazaSpec, trees: Pick<CampusMaterials, 'trunk' | 'canopy'> | undefined): void {
  addPaving(ctx, f, plazaOutline(g, sp));
  addTreePits(ctx, f, sp.pits, trees);
  addPots(ctx, f, sp.pots);
  const z = ENTRY.rampTop + RAMP.len - 0.8;
  addLanterns(ctx, f, [[rampWallX(g, z) + 1.2, z]]);
}

/** 學生宿舍C：宿舍服務中心量體、正面三段、招牌與簷口。 */
function addServiceCentre(ctx: Ctx, f: Frame, g: CornerGeom): void {
  const wall = ctx.mat(SVC_WALL, { roughness: 0.85 });
  const white = ctx.mat(0xe8e8e4, { roughness: 0.7 });
  const R = SVC_ROOF, top = TERRACE_TOP;
  const body = entryBody(g);
  prism(ctx, f, body, 0, R, wall);
  prism(ctx, f, body, R, R + 0.18, white, false);

  const { ff, len: E } = frontFrame(ctx, f, g, '宿舍服務中心 正面');
  // Front (frame z = 0), west to east: wall with windows and the wheelchair sign | storefront | dark windows.
  const face = (x0: number, x1: number, y0: number, y1: number, map: CanvasTexture): void => {
    const m = ff.add(new PlaneGeometry(x1 - x0, y1 - y0), ctx.tracker.material(new MeshStandardMaterial({ map, roughness: 0.5 })), false);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0.01);
  };
  face(0, SHOP.x0, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.1, 0.6]], true), ctx.tracker));
  face(SHOP.x0, SHOP.x1, top, FASCIA.y0, canvasTexture(1360, 480, storefront, ctx.tracker));
  face(SHOP.x1, E, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.12, 0.88]], false), ctx.tracker));
  // White soffit projecting over the storefront, the dark sign box on it (photo); roof edge.
  const { x0: fx0, x1: fx1, y0: fy0, y1: fy1, out, soffit } = FASCIA;
  ff.add(span(fx0 - 0.2, fx1 + 0.2, fy0 - soffit, fy0, 0, out + 0.05), white);
  const sign = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1440, 176, signBand, ctx.tracker), roughness: 0.6 }));
  const dark = ctx.mat(0x5f6368);
  const box = ff.add(new BoxGeometry(fx1 - fx0, fy1 - fy0, out), [dark, dark, dark, dark, sign, dark]);
  box.position.set((fx0 + fx1) / 2, (fy0 + fy1) / 2, out / 2);
  ff.add(span(-0.05, E + 0.05, R, R + 0.18, -0.1, 0.15), white);
}

/** Square tree pits (concrete curb, soil) with a campus tree in each, instanced and tinted like the chunk trees (campusWorld.ts). */
function addTreePits(ctx: Ctx, f: Frame, pits: readonly Pit[], trees: Pick<CampusMaterials, 'trunk' | 'canopy'> | undefined): void {
  const curb = ctx.mat(0xa9a7a0, { roughness: 0.9 });
  const soil = ctx.mat(0x6b5a45, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  for (const p of pits) {
    const h = p.size / 2, t = 0.14;
    for (const [ax0, ax1, az0, az1] of [[-h, h, -h, -h + t], [-h, h, h - t, h], [-h, -h + t, -h + t, h - t], [h - t, h, -h + t, h - t]] as const) {
      f.add(span(p.x + ax0, p.x + ax1, 0, 0.12, p.z + az0, p.z + az1), curb);
    }
    f.add(new PlaneGeometry(p.size - 2 * t, p.size - 2 * t).rotateX(-Math.PI / 2).translate(p.x, 0.06, p.z), soil, false);
  }
  if (!trees) return;
  const { trunk, canopy } = campusTreeGeometry();
  const trunks = new InstancedMesh(ctx.tracker.geometry(trunk), trees.trunk, pits.length);
  const canopies = new InstancedMesh(ctx.tracker.geometry(canopy), trees.canopy, pits.length);
  const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), tint = new Color();
  pits.forEach((p, i) => {
    m.compose(new Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.x), new Vector3(p.scale, p.scale * (p.lift ?? 1), p.scale));
    trunks.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    const shift = (i + 1) / (pits.length + 1);
    canopies.setColorAt(i, tint.setRGB(0.16 + shift * 0.08, 0.3 + shift * 0.12, 0.1 + shift * 0.05));
  });
  for (const mesh of [trunks, canopies]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    f.g.add(mesh);
  }
}

/** Paving laid over an outline given in frame `f`'s coordinates (UVs in metres, 4 m pattern). */
function addPaving(ctx: Ctx, f: Frame, outline: readonly (readonly [number, number])[]): void {
  const tex = canvasTexture(512, 512, plazaPaving, ctx.tracker);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1 / PAVING_BAND, 1 / PAVING_BAND);
  const paving = ctx.tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  f.add(new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.025, 0), paving, false);
}

/**
 * 學生宿舍D：雨遮（與服務中心量體同一個輪廓：頂板、前緣與短段的混凝土帶、藍色 D、方柱）、兩樘門、
 * 斜牆前的綠籬花台、白色告示牌。地面（平台、台階、坡道）與廣場由 addEntryGround / addEntryPlaza 做。
 */
function addDormDCanopy(ctx: Ctx, f: Frame, g: CornerGeom, recess: Frame | null, wing: Frame | null): void {
  const band = ctx.mat(0xd9d8d2, { roughness: 0.85 });
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const { y: CY, band: bh } = D_CANOPY;
  const top = TERRACE_TOP;
  prism(ctx, f, entryBody(g), CY, CY + 0.3, band, false);
  // Under the canopy the terrace runs on back to the walls (user, 2026-11-20: it was open to the ground
  // behind the steps), so the doors, the hedge planter and the columns all stand on it.
  prism(ctx, f, entryBody(g), 0, top, concrete);

  // Front band with the blue D along the 45° edge, plain bands on the two returns.
  const { ff, len } = frontFrame(ctx, f, g, '學生宿舍D 雨遮');
  const face = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1024, 96, dBand, ctx.tracker), roughness: 0.8 }));
  const front = ff.add(new BoxGeometry(len + 0.3, bh, 0.3), [band, band, band, band, face, band]);
  front.position.set(len / 2, CY + bh / 2 - 0.05, -0.15);
  const fr = entryFront(g);
  for (const [a, b] of [[fr.wingPt, fr.west], [fr.east, fr.northPt]] as const) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const m = f.add(new BoxGeometry(l, bh, 0.3), band);
    m.position.set((a[0] + b[0]) / 2, CY + bh / 2 - 0.05, (a[1] + b[1]) / 2);
    m.rotation.y = yaw;
  }
  // Square columns just inside the front edge.
  for (const x of [0.5, len / 2, len - 0.5]) {
    ff.add(span(x - 0.22, x + 0.22, top, CY, -0.6, -0.16), band);
    ff.solid(x, (top + CY) / 2, -0.38, 0.22, (CY - top) / 2, 0.22);
  }

  // Doors: dark glass in grey frames, on the diagonal wall and on the north wing's face; a clipped-hedge
  // planter on the diagonal between them; the notice board by the west column.
  const frame = ctx.mat(0x5c6166, { metalness: 0.4 }), glass = ctx.mat(0x232b31, { roughness: 0.15, metalness: 0.4 });
  const door = (fr2: Frame, x0: number, x1: number): void => {
    fr2.add(span(x0, x1, top, top + 2.6, 0, 0.08), frame);
    fr2.add(span(x0 + 0.12, x1 - 0.12, top + 0.05, top + 2.45, 0.08, 0.1), glass, false);
    fr2.add(span((x0 + x1) / 2 - 0.02, (x0 + x1) / 2 + 0.02, top + 0.05, top + 2.45, 0.1, 0.12), frame, false);
  };
  if (recess) {
    door(recess, D_DOORS.recess[0], D_DOORS.recess[1]);
    recess.add(span(2.6, 4.9, top, top + 0.45, 0.1, 0.9), concrete);
    recess.add(span(2.68, 4.82, top + 0.45, top + 0.95, 0.18, 0.82), ctx.mat(0x3e6f2e, { roughness: 0.95 }));
    recess.solid(3.75, top + 0.475, 0.5, 1.15, 0.475, 0.4);
  }
  if (wing) door(wing, D_DOORS.wing[0], D_DOORS.wing[1]);
  const board = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(128, 160, noticeBoard, ctx.tracker), roughness: 0.6 }));
  const nb = ff.add(new BoxGeometry(0.6, 0.75, 0.05), [frame, frame, frame, frame, board, frame]);
  nb.position.set(0.9, top + 1.25, 0.6);
  ff.add(span(0.88, 0.92, top, top + 0.9, 0.58, 0.62), frame);
}

// ---------------------------------------------------------------- public
/** Tree-free rings over the features (campus tree scatter), in world x/z. */
export function dormTreeFree(): number[][] {
  const toWorld = (w: WallAnchor): ((x: number, z: number) => [number, number]) => {
    const len = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
    const ux = (w.a[0] - w.b[0]) / len, uz = (w.a[1] - w.b[1]) / len;
    return (x: number, z: number): [number, number] => [w.b[0] + ux * x - uz * z, w.b[1] + uz * x + ux * z];
  };
  // Each corner: its plaza plus everything between the walls (body, terrace, steps, ramp).
  const ring = (sp: CornerSpec, pl: PlazaSpec): number[] => {
    const g = cornerGeom(sp), w = toWorld(sp.base);
    const pts: P2[] = [g.chamfer[0], ...pl.outline.map(([x, z]) => [x, z] as P2), g.zEnd, g.chamfer[1]];
    return pts.flatMap(([x, z]) => w(...g.toBase(x, z)));
  };
  return [ring(C_CORNER, C_PLAZA), ring(D_CORNER, D_PLAZA)];
}

export function createDormFeatures(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker, trees?: Pick<CampusMaterials, 'trunk' | 'canopy'>): { dispose(): void } {
  const ctx: Ctx = {
    scene, physics, tracker, colliders: [], groups: [],
    mat: (color, extra = {}) => tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra })),
  };
  const c = cornerFrame(ctx, campus, C_CORNER, '宿舍服務中心');
  if (c) {
    addServiceCentre(ctx, c.f, c.g);
    addEntryGround(ctx, c.f, c.g);
    addEntryPlaza(ctx, c.f, c.g, C_PLAZA, trees);
  }
  const d = cornerFrame(ctx, campus, D_CORNER, '學生宿舍D 入口');
  if (d) {
    const recess = wallFrame(ctx, campus, D_RECESS, '學生宿舍D 斜牆');
    const wing = wallFrame(ctx, campus, D_WING, '學生宿舍D 北翼');
    addDormDCanopy(ctx, d.f, d.g, recess, wing);
    addEntryGround(ctx, d.f, d.g);
    addEntryPlaza(ctx, d.f, d.g, D_PLAZA, trees);
  }
  return {
    dispose() {
      for (const col of ctx.colliders) physics.removeCollider(col, false);
      for (const g of ctx.groups) g.removeFromParent();
    },
  };
}
