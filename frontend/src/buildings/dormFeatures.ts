import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
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
  type BufferGeometry,
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
 *  - 學生宿舍C：L 形轉角內、貼著北棟南面與西側斜牆 / 南翼的單層「宿舍服務中心」（正面照）。正面由西到東：
 *    有窗與無障礙標誌的實牆段、玻璃店面（上排氣窗、中間大片玻璃、下排黃底紅字「宿 舍 服 … 務 中 心」）、
 *    深色窗的實牆段；店面上方深灰招牌（藍色 C、金字「國立雲林科技大學 學生宿舍服務中心」、右側紅色 LED 板），
 *    招牌下白色出挑簷口。前面整排前廊、幾乎全寬的三階台階；西段前方是與立面平行、往東上升的無障礙坡道，
 *    外側整面混凝土矮牆（藍色指標牌）與扶手。前廊與廣場上多盆紅色花盆，坡道口一支黑色雙燈頭燈柱。
 *  - 學生宿舍D（入口正面照）：東北向的凹角整個做成門廊，寬度從東翼北面到北翼東面（約 12.4 m、深 3.6 m）：
 *    門廊頂板與前緣厚混凝土帶（藍色 D）、下方方柱、兩樘門（斜牆一樘、北翼東面一樘）之間一長條綠籬花台、
 *    全寬平台與四階台階、左側藍色扶手與白色告示牌；前方灰色連鎖磚夾紅磚帶的廣場、三個方形樹穴、紅色花盆、
 *    兩側各一支黑色雙燈頭燈柱；北翼東面門廊外一段矮花台綠籬。
 * 每個設施都掛在一面 OSM 外牆上（建築 id ＋ 邊編號，端點對不上就略過）：局部 +x 沿牆、+z 朝外、
 * 原點在牆的終點（外環為逆時針，這樣 +z 才會朝外）。
 *
 * 閱讀順序：常數 → 幾何工具 → 牆面座標系 → 每個部件一個 add… 函式 → createDormFeatures。
 */

// ---------------------------------------------------------------- anchors (OSM id, edge, endpoints)
interface WallAnchor { id: number; edge: number; a: [number, number]; b: [number, number] }
/** 學生宿舍C 北棟南面（L 形轉角內）。 */
const C_SOUTH: WallAnchor = { id: 296668595, edge: 9, a: [26.4, 337.6], b: [18.3, 339.1] };
/** 學生宿舍D 東北向斜牆（入口凹處）。 */
const D_RECESS: WallAnchor = { id: 296668594, edge: 1, a: [22.0, 380.5], b: [25.7, 383.9] };
/** 學生宿舍D 北翼東面（入口右手邊凸出的那面牆）。 */
const D_WING: WallAnchor = { id: 296668594, edge: 0, a: [20.6, 372.3], b: [22.0, 380.5] };

// ---------------------------------------------------------------- dimensions (m)
/**
 * 宿舍服務中心。正面照：店面是一道斜的立面，斜切學生宿舍C 的 L 形內角、朝東南面向路口（左邊南翼往鏡頭凸出、
 * 右邊北棟往後退）。先在 C_SOUTH 的牆面座標系（x 往東沿北棟南面、z 往南）定出內角：北棟南面 z = 0、
 * OSM 的小斜牆 (0,0)–(−3.64,3.19)、南翼東面 (−3.64,3.19)–(−4.22,13.45)；店面牆是 x + z = WALL_K、前廊外緣是 x + z = outerK 這兩條 45° 線，
 * 從南翼牆面切到北棟牆面。其餘部件都在「正面座標系」裡：x 沿正面由西（南翼端）往東（北棟端）、
 * z 朝外（東南），正面在 z = depth。
 */
/**
 * outerK：前廊外緣（台階起點）的 45° 線 x + z = outerK；店面牆退到前廊後面（前廊在建築輪廓內、上有屋頂），
 * 只有台階（與旁邊的坡道）突出到廣場。
 */
const CORNER = { outerK: 6.725, diag: [[0, 0], [-3.64, 3.19]] as const, wing: [[-3.64, 3.19], [-4.22, 13.45]] as const };
const SVC = { depth: 4.7, roof: 3.4 };
/** 正面分段（正面座標 x）：西實牆段 | 玻璃店面 | 東深色窗段（東段到正面全長 len）。 */
const SHOP = { x0: 2.8, x1: 9.6 };
/** 前廊外緣上方的招牌（x 範圍、高度），前廊頂的白色簷底厚度。 */
const FASCIA = { x0: 2.6, x1: 9.8, y0: 3.12, y1: 4.0, soffit: 0.12 };
const RISE = 0.15;
const TREAD = 0.35;
/** 內凹前廊：店面牆（z = depth）到外緣（z1），上方是屋頂與招牌。 */
const PORCH = { z0: SVC.depth, z1: SVC.depth + 1.6, top: 0.6 };
/** 店面牆的 45° 線（outerK 往內退前廊深度）。 */
const WALL_K = CORNER.outerK - (PORCH.z1 - PORCH.z0) * Math.SQRT2;
/** 台階從 x0 到前廊外緣的東端（店面與東段前方）。 */
const STEPS = { x0: 4.8 };
/** 坡道：前廊前方、與立面平行，西端（x0）著地、東端（x1）接前廊；外側矮牆從 wallFrom 開始，西端留入口。 */
const RAMP = { x0: -1.2, x1: 4.6, z0: PORCH.z1, z1: PORCH.z1 + 1.4, wall: 0.15, wallFrom: 0.0, wallTop: 1.15 };
/**
 * 前方廣場（C_SOUTH 牆面座標）：灰色連鎖磚夾紅磚帶（照片），從正面鋪到兩條路邊；
 * 多邊形 = 正面西端 → 正面東端 → 沿北棟南面延伸到南北向路邊 → 沿兩條路邊（路口處切角）→ 南翼東南角；離路緣約 0.4 m。
 */
const PLAZA = { east: 13.6, eastSouth: 12.5, southEast: 10.5, south: 15.0, band: 4 };
/** A square tree pit (frame coords), the tree's scale and an optional extra vertical stretch. */
type Pit = { x: number; z: number; size: number; scale: number; lift?: number };
/** 樹穴（正面座標）：混凝土框、土面，各種一棵校園樹。 */
const PITS: readonly Pit[] = [
  { x: 7.0, z: SVC.depth + 6.3, size: 2.0, scale: 1.0 },
  { x: 0.9, z: SVC.depth + 6.6, size: 1.8, scale: 0.9 },
];

/** 正面兩端（C_SOUTH 牆面座標）：西端 = 正面線與南翼牆面的交點，東端 = 與北棟南面（z = 0）的交點。 */
function frontEnds(k = WALL_K): { west: [number, number]; east: [number, number]; len: number } {
  const [[ax, az], [bx, bz]] = CORNER.wing;
  // Wing line x = ax + (bx − ax)·t, z = az + (bz − az)·t; solve x + z = k.
  const t = (k - ax - az) / (bx - ax + bz - az);
  const west: [number, number] = [ax + (bx - ax) * t, az + (bz - az) * t];
  const east: [number, number] = [k, 0];
  return { west, east, len: Math.hypot(east[0] - west[0], east[1] - west[1]) };
}

/** Plaza (and tree-free) outline in C_SOUTH wall coordinates. */
function plazaOutline(): [number, number][] {
  const { west, east } = frontEnds();
  const [, wingEnd] = CORNER.wing;
  return [west, east, [PLAZA.east, 0], [PLAZA.east, PLAZA.eastSouth], [PLAZA.southEast, PLAZA.south], [wingEnd[0] - 0.1, PLAZA.south], [wingEnd[0], wingEnd[1]]];
}

/** 學生宿舍D 入口：雨遮、平台、台階。 */
/**
 * 學生宿舍D 入口（D_RECESS 牆面座標：x 沿斜牆從東翼端往北翼端，z 朝東北外）。凹角的兩面翼牆（OSM 外環）：
 * 東翼北面 (0,0)–(−4.94,6.95)、北翼東面 (5.04,0)–(11.6,5.15)；門廊前緣在 z = depth，左右各切到翼牆為止。
 */
const D_CORNER = { right: [[0, 0], [-4.94, 6.95]] as const, left: [[5.04, 0], [11.6, 5.15]] as const };
const D_PORCH = { depth: 3.6, top: 0.6, roof: 3.35, band: 0.95, letterX: 0.42 };
/** 方柱（門廊前緣內側），兩樘門：斜牆上一樘（x 範圍）、北翼東面一樘（D_WING x 範圍）。 */
const D_COLUMNS: readonly number[] = [-1.3, 2.2, 5.6];
const D_DOORS = { recess: [0.5, 2.3] as const, wing: [1.2, 2.8] as const };
/** 台階：門廊前緣往外四階，左右範圍；扶手在左端。 */
const D_STEPS = { x0: -2.2, x1: 9.4 };
/** 廣場（D_RECESS 座標）：沿兩面翼牆到翼角，再往外到這兩點；樹穴三個。 */
const D_PLAZA: readonly [number, number][] = [[11, 13.5], [-6.5, 13]];
/** 照片裡這三棵是細高的樹、樹冠在二樓以上（門廊不被擋住）：同一個校園樹模型，縮窄並拉高（lift）。 */
const D_PITS: readonly Pit[] = [
  { x: -0.2, z: 8.0, size: 1.6, scale: 0.7, lift: 1.6 },
  { x: 3.6, z: 9.2, size: 1.6, scale: 0.65, lift: 1.7 },
  { x: 7.2, z: 7.8, size: 1.6, scale: 0.72, lift: 1.55 },
];

/** x of a wing face at depth z (the line through `pts`). */
const faceX = (pts: readonly (readonly [number, number])[], z: number): number => {
  const [[ax, az], [bx, bz]] = pts as [[number, number], [number, number]];
  return ax + ((bx - ax) * (z - az)) / (bz - az);
};
/** D's plaza / tree-free outline in D_RECESS coordinates: the recess, out along both wing faces, then to the road side. */
function dPlazaOutline(): [number, number][] {
  return [[0, 0], [5.04, 0], [D_CORNER.left[1][0], D_CORNER.left[1][1]], ...D_PLAZA.map(([x, z]) => [x, z] as [number, number]), [D_CORNER.right[1][0], D_CORNER.right[1][1]]];
}

// ---------------------------------------------------------------- colours
const CONCRETE = 0xb4b2ac;
const SVC_WALL = 0xc8c6bf;
const LAMP_BLACK = 0x1c1e21;
const POT = 0xb5512f;
const LEAF = 0x3f7a35;
const RAIL_BLUE = 0x2f8fc9;

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
  g.fillText('D', W * D_PORCH.letterX, H / 2 + 2);
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

/** The service centre's front frame, inside the C_SOUTH wall frame `c`: x along the diagonal front, z out (SE), front at z = depth. */
function serviceFrontFrame(ctx: Ctx, c: Frame): { f: Frame; len: number; toFront(x: number, z: number): [number, number] } {
  const { west, east, len } = frontEnds();
  const ux = (east[0] - west[0]) / len, uz = (east[1] - west[1]) / len; // along the front, in C coords
  const nx = -uz, nz = ux; // out of the front (south-east)
  const ox = west[0] - nx * SVC.depth, oz = west[1] - nz * SVC.depth;
  const [wox, woz] = c.world(ox, oz), [w1x, w1z] = c.world(ox + ux, oz + uz);
  const f = frameAt(ctx, wox, woz, w1x - wox, w1z - woz, '宿舍服務中心');
  const toFront = (x: number, z: number): [number, number] => [(x - ox) * ux + (z - oz) * uz, (x - ox) * nx + (z - oz) * nz];
  return { f, len, toFront };
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

/** Straight flight from height `top` down to the ground, starting at local z0 and running out (+z). */
function addSteps(f: Frame, x0: number, x1: number, z0: number, top: number, m: Material): number {
  const n = Math.round(top / RISE);
  for (let k = 0; k < n; k++) {
    const h = top - (k + 1) * RISE, za = z0 + k * TREAD;
    if (h <= 0.001) break;
    f.add(span(x0, x1, 0, h, za, za + TREAD), m);
    f.solid((x0 + x1) / 2, h / 2, za + TREAD / 2, (x1 - x0) / 2, h / 2, TREAD / 2);
  }
  return z0 + (n - 1) * TREAD;
}

/** 學生宿舍C：宿舍服務中心（量體、正面三段、招牌與簷口、前廊、台階、坡道、花盆、燈柱）。 */
function addServiceCentre(ctx: Ctx, c: Frame): Frame {
  const { f, len: E, toFront } = serviceFrontFrame(ctx, c);
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const wall = ctx.mat(SVC_WALL, { roughness: 0.85 });
  const white = ctx.mat(0xe8e8e4, { roughness: 0.7 });
  const W0 = 0;
  const { depth: D, roof: R } = SVC;

  // Body: the corner the diagonal front cuts off the L — front, north block face, OSM's short
  // diagonal, wing face — extruded to the roof (a few cm into the walls so no seam shows).
  const { west, east } = frontEnds();
  const plan = [west, east, [east[0] + 0.05, -0.05], [CORNER.diag[0][0] + 0.05, CORNER.diag[0][1] - 0.05], [CORNER.diag[1][0] - 0.05, CORNER.diag[1][1]]]
    .map(([x, z]) => toFront(x!, z!));
  // Shape points are (x, −z): after rotateX(−π/2) the shape's y becomes −z and the extrusion runs up.
  const shape = new Shape(plan.map(([x, z]) => new Vector2(x, -z)));
  f.add(new ExtrudeGeometry(shape, { depth: R, bevelEnabled: false }).rotateX(-Math.PI / 2), wall);
  f.add(new ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, R, 0), white); // roof slab
  const hull: number[] = [];
  for (const [x, z] of plan) {
    const [wx, wz] = f.world(x, z);
    hull.push(wx, 0, wz, wx, R, wz);
  }
  const body = RAPIER.ColliderDesc.convexHull(new Float32Array(hull));
  if (body) ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(body)));

  // Front, west to east: wall with windows and the wheelchair sign | storefront | dark windows.
  const face = (x0: number, x1: number, y0: number, y1: number, map: CanvasTexture): void => {
    const m = f.add(new PlaneGeometry(x1 - x0, y1 - y0), ctx.tracker.material(new MeshStandardMaterial({ map, roughness: 0.5 })), false);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, D + 0.01);
  };
  const top = PORCH.top;
  face(W0, SHOP.x0, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.08, 0.42], [0.5, 0.82]], true), ctx.tracker));
  face(SHOP.x0, SHOP.x1, top, FASCIA.y0, canvasTexture(1360, 480, storefront, ctx.tracker));
  face(SHOP.x1, E, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.1, 0.9]], false), ctx.tracker));

  // Recessed porch inside the outline: its floor, and above it the building carried out to the
  // porch's outer edge (wall-coloured lintel, white soffit, roof) — wall to wall, so only the steps
  // and the ramp stand proud of the building. The trapezoid widens outward along the two walls.
  const outer = frontEnds(CORNER.outerK);
  const [owx] = toFront(...outer.west), [oex] = toFront(...outer.east);
  const porch: [number, number][] = [[W0, PORCH.z0], [E, PORCH.z0], [oex, PORCH.z1], [owx, PORCH.z1]];
  const slab = (y0: number, y1: number, m: Material): void => {
    f.add(new ExtrudeGeometry(new Shape(porch.map(([x, z]) => new Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0), m);
  };
  slab(0, top, concrete);
  const floor: number[] = [];
  for (const [x, z] of porch) { const [wx, wz] = f.world(x, z); floor.push(wx, 0, wz, wx, top, wz); }
  const porchHull = RAPIER.ColliderDesc.convexHull(new Float32Array(floor));
  if (porchHull) ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(porchHull)));
  const { x0: fx0, x1: fx1, y0: fy0, y1: fy1, soffit } = FASCIA;
  slab(fy0 - soffit, fy0, white); // soffit
  slab(fy0, R, wall); // lintel
  slab(R, R + 0.18, white); // roof
  // The dark sign box on the porch's outer edge, standing above the roof line.
  const sign = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1440, 176, signBand, ctx.tracker), roughness: 0.6 }));
  const dark = ctx.mat(0x5f6368);
  const box = f.add(new BoxGeometry(fx1 - fx0, fy1 - fy0, 0.32), [dark, dark, dark, dark, sign, dark]);
  box.position.set((fx0 + fx1) / 2, (fy0 + fy1) / 2, PORCH.z1 - 0.14);

  // Steps down from the porch's outer edge to the plaza, in front of the storefront and the east section.
  addSteps(f, STEPS.x0, oex, PORCH.z1, top, concrete);

  // Ramp along the front of the west section, rising eastward onto the porch; a solid concrete
  // parapet on its outer side (open at the low west end) with a steel rail and a blue sign.
  const { x0: rx0, x1: rx1, z0: rz0, z1: rz1, wall: t, wallFrom, wallTop } = RAMP;
  const run = rx1 - rx0, slope = Math.atan2(top, run), hyp = Math.hypot(top, run);
  const ramp = f.add(new BoxGeometry(hyp, 0.1, rz1 - rz0), concrete);
  ramp.position.set((rx0 + rx1) / 2, top / 2 - 0.05, (rz0 + rz1) / 2);
  ramp.rotation.z = slope; // +x (east) end up
  {
    const [cx, cz] = f.world((rx0 + rx1) / 2, (rz0 + rz1) / 2);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.g.rotation.y).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), slope));
    ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(hyp / 2, 0.05, (rz1 - rz0) / 2).setTranslation(cx, top / 2 - 0.05, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  }
  f.add(span(rx1, STEPS.x0, 0, top, rz0, rz1), concrete); // landing between the ramp top and the steps
  f.solid((rx1 + STEPS.x0) / 2, top / 2, (rz0 + rz1) / 2, (STEPS.x0 - rx1) / 2, top / 2, (rz1 - rz0) / 2);
  f.add(span(wallFrom, STEPS.x0, 0, wallTop, rz1, rz1 + t), concrete);
  f.solid((wallFrom + STEPS.x0) / 2, wallTop / 2, rz1 + t / 2, (STEPS.x0 - wallFrom) / 2, wallTop / 2, t / 2);
  const steel = ctx.mat(0xc9ccce, { metalness: 0.7, roughness: 0.3 });
  const rail = f.add(new CylinderGeometry(0.025, 0.025, hyp, 8).rotateZ(Math.PI / 2), steel);
  rail.position.set((rx0 + rx1) / 2, top / 2 + 0.85, rz1 - 0.1);
  rail.rotation.z = slope;
  const blue = f.add(new PlaneGeometry(0.5, 0.35), ctx.mat(0x1f5fb8), false);
  blue.position.set(wallFrom + 0.6, wallTop - 0.35, rz1 + t + 0.01);

  // Pots along the porch edge and on the plaza, the lantern by the ramp's low end.
  addPots(ctx, f, [
    [-0.6, PORCH.z1 - 0.4, top], [1.0, PORCH.z1 - 0.4, top], [10.4, PORCH.z0 + 0.4, top], [11.1, PORCH.z0 + 0.4, top],
    [5.6, D + 4.6], [4.4, D + 4.9], [12.2, D + 3.9], [1.4, D + 3.9], [3.0, D + 4.1],
  ]);
  addLanterns(ctx, f, [[-0.8, D + 5.2]]);
  return f;
}

/** 宿舍服務中心前的廣場鋪面與樹穴（樹用校園樹的幾何與材質，沒有碰撞，同校園其他樹）。 */
function addPlaza(ctx: Ctx, c: Frame, f: Frame, trees: Pick<CampusMaterials, 'trunk' | 'canopy'> | undefined): void {
  addPaving(ctx, c, plazaOutline());
  addTreePits(ctx, f, PITS, trees);
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
  tex.repeat.set(1 / PLAZA.band, 1 / PLAZA.band);
  const paving = ctx.tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  f.add(new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.025, 0), paving, false);
}

/** 學生宿舍D：凹角門廊（頂板、D 字混凝土帶、方柱、門、綠籬花台）、全寬平台與台階、藍色扶手、告示牌、廣場。 */
function addDormDEntrance(ctx: Ctx, f: Frame, wing: Frame | null, trees: Pick<CampusMaterials, 'trunk' | 'canopy'> | undefined): void {
  const band = ctx.mat(0xd9d8d2, { roughness: 0.85 });
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const { depth: PD, top, roof, band: bh } = D_PORCH;
  const xr = faceX(D_CORNER.right, PD), xl = faceX(D_CORNER.left, PD); // portico front ends on the wing faces
  // Recess polygon (deck and portico roof): diagonal wall, out along both wing faces to the front line.
  const recess: [number, number][] = [[0, 0], [5.04, 0], [xl, PD], [xr, PD]];
  const extrude = (pts: readonly [number, number][], h: number, y: number): BufferGeometry =>
    new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, -z))), { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y, 0);
  const hull = (pts: readonly [number, number][], y0: number, y1: number): void => {
    const v: number[] = [];
    for (const [x, z] of pts) { const [wx, wz] = f.world(x, z); v.push(wx, y0, wz, wx, y1, wz); }
    const d = RAPIER.ColliderDesc.convexHull(new Float32Array(v));
    if (d) ctx.colliders.push(ctx.tracker.collider(ctx.physics.createCollider(d)));
  };

  // Deck (the floor of the portico) and the roof slab over it; the front band with the blue D.
  f.add(extrude(recess, top, 0), concrete);
  hull(recess, 0, top);
  f.add(extrude(recess, 0.3, roof), band);
  const face = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1024, 96, dBand, ctx.tracker), roughness: 0.8 }));
  const front = f.add(new BoxGeometry(xl - xr + 0.3, bh, 0.3), [band, band, band, band, face, band]);
  front.position.set((xl + xr) / 2, roof + bh / 2 - 0.05, PD - 0.15);

  // Square columns just inside the front line.
  for (const x of D_COLUMNS) {
    f.add(span(x - 0.22, x + 0.22, top, roof, PD - 0.6, PD - 0.16), band);
    f.solid(x, (top + roof) / 2, PD - 0.38, 0.22, (roof - top) / 2, 0.22);
  }

  // Doors: dark glass in grey frames, one on the diagonal wall and one on the north wing's face;
  // a long clipped-hedge planter on the diagonal between them.
  const frame = ctx.mat(0x5c6166, { metalness: 0.4 }), glass = ctx.mat(0x232b31, { roughness: 0.15, metalness: 0.4 });
  const door = (fr: Frame, x0: number, x1: number, y: number): void => {
    fr.add(span(x0, x1, y, y + 2.6, 0, 0.08), frame);
    fr.add(span(x0 + 0.12, x1 - 0.12, y + 0.05, y + 2.45, 0.08, 0.1), glass, false);
    fr.add(span((x0 + x1) / 2 - 0.02, (x0 + x1) / 2 + 0.02, y + 0.05, y + 2.45, 0.1, 0.12), frame, false);
  };
  door(f, D_DOORS.recess[0], D_DOORS.recess[1], top);
  if (wing) door(wing, D_DOORS.wing[0], D_DOORS.wing[1], top);
  f.add(span(2.6, 4.9, top, top + 0.45, 0.1, 0.9), concrete);
  f.add(span(2.68, 4.82, top + 0.45, top + 0.95, 0.18, 0.82), ctx.mat(0x3e6f2e, { roughness: 0.95 }));
  f.solid(3.75, top + 0.475, 0.5, 1.15, 0.475, 0.4);

  // Full-width steps down from the front line, the blue handrail down their left end.
  const end = addSteps(f, D_STEPS.x0, D_STEPS.x1, PD, top, concrete);
  const blue = ctx.mat(RAIL_BLUE, { metalness: 0.4, roughness: 0.4 });
  const rx = D_STEPS.x0 + 0.25, z0 = PD - 0.5, z1 = end + TREAD;
  const len = z1 - z0, hyp = Math.hypot(len, top - RISE);
  const rail = f.add(new CylinderGeometry(0.03, 0.03, hyp, 8).rotateX(Math.PI / 2), blue);
  rail.position.set(rx, (top + RISE) / 2 + 0.9, (z0 + z1) / 2);
  rail.rotation.x = Math.atan2(top - RISE, len);
  const lower = f.add(new CylinderGeometry(0.03, 0.03, hyp, 8).rotateX(Math.PI / 2), blue);
  lower.position.set(rx, (top + RISE) / 2 + 0.45, (z0 + z1) / 2);
  lower.rotation.x = rail.rotation.x;
  for (const z of [z0, z1]) {
    const h = z === z0 ? top : RISE;
    f.add(span(rx - 0.03, rx + 0.03, 0, h + 0.95, z - 0.03, z + 0.03), blue);
  }
  f.solid(rx, 0.6, (z0 + z1) / 2, 0.05, 0.6, len / 2);
  // White notice board on a post, on the deck by the left column.
  const board = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(128, 160, noticeBoard, ctx.tracker), roughness: 0.6 }));
  const nb = f.add(new BoxGeometry(0.6, 0.75, 0.05), [frame, frame, frame, frame, board, frame]);
  nb.position.set(-0.6, top + 1.25, PD - 1.0);
  f.add(span(-0.62, -0.58, top, top + 0.9, PD - 1.02, PD - 0.98), frame);

  // Plaza: paving out to the road side, three tree pits, a pot, the two lanterns.
  addPaving(ctx, f, dPlazaOutline());
  addTreePits(ctx, f, D_PITS, trees);
  addPots(ctx, f, [[5.4, 7.0]]);
  addLanterns(ctx, f, [[-6.2, 8.8], [10.2, 7.2]]);
}

/** 學生宿舍D 北翼東面、門廊外：矮混凝土花台與修剪綠籬（D_WING 座標）。 */
function addDormDPlanter(ctx: Ctx, f: Frame): void {
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const x0 = 6.2, x1 = 8.2, z0 = 0.15, z1 = 1.15, h = 0.45;
  f.add(span(x0, x1, 0, h, z0, z1), concrete);
  f.add(span(x0 + 0.08, x1 - 0.08, h, h + 0.5, z0 + 0.08, z1 - 0.08), ctx.mat(0x3e6f2e, { roughness: 0.95 }));
  f.solid((x0 + x1) / 2, (h + 0.5) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (h + 0.5) / 2, (z1 - z0) / 2);
}

// ---------------------------------------------------------------- public
/** Tree-free rings over the features (campus tree scatter), in world x/z. */
export function dormTreeFree(): number[][] {
  const toWorld = (w: WallAnchor): ((x: number, z: number) => [number, number]) => {
    const len = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
    const ux = (w.a[0] - w.b[0]) / len, uz = (w.a[1] - w.b[1]) / len;
    return (x: number, z: number): [number, number] => [w.b[0] + ux * x - uz * z, w.b[1] + uz * x + ux * z];
  };
  const rect = (w: WallAnchor, x0: number, x1: number, z0: number, z1: number): number[] => {
    const p = toWorld(w);
    return [...p(x0, z0), ...p(x1, z0), ...p(x1, z1), ...p(x0, z1)];
  };
  const c = toWorld(C_SOUTH);
  // The plaza plus the corner behind the front (north block face, OSM diagonal, wing face).
  const { east } = frontEnds();
  const svc: [number, number][] = [[0, 0], [east[0], 0], ...plazaOutline().slice(2), [CORNER.diag[1][0], CORNER.diag[1][1]]];
  return [
    svc.flatMap(([x, z]) => c(x, z)),
    dPlazaOutline().flatMap(([x, z]) => toWorld(D_RECESS)(x, z)),
    rect(D_WING, 6.0, 8.5, 0, 3.0),
  ];
}

export function createDormFeatures(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker, trees?: Pick<CampusMaterials, 'trunk' | 'canopy'>): { dispose(): void } {
  const ctx: Ctx = {
    scene, physics, tracker, colliders: [], groups: [],
    mat: (color, extra = {}) => tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra })),
  };
  const c = wallFrame(ctx, campus, C_SOUTH, '宿舍服務中心');
  if (c) {
    const front = addServiceCentre(ctx, c);
    addPlaza(ctx, c, front, trees);
  }
  const wing = wallFrame(ctx, campus, D_WING, '學生宿舍D 北翼');
  const d = wallFrame(ctx, campus, D_RECESS, '學生宿舍D 入口');
  if (d) addDormDEntrance(ctx, d, wing, trees);
  if (wing) addDormDPlanter(ctx, wing);
  return {
    dispose() {
      for (const col of ctx.colliders) physics.removeCollider(col, false);
      for (const g of ctx.groups) g.removeFromParent();
    },
  };
}
