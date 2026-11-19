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
  SphereGeometry,
  SRGBColorSpace,
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
 *  - 學生宿舍D：東北向斜牆凹處的入口：雨遮（D 字樣）與兩根柱、深色玻璃門、抬高平台與四階台階、
 *    藍色扶手、北翼牆前的矮花台綠籬、台階旁黑色雙燈頭燈柱、廣場上一盆紅色花盆。
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
 * 宿舍服務中心（局部座標，x 往東、z 往南朝廣場）。量體平面沿著 L 形轉角：北棟南面 (0,0)–(9,0)、
 * 正面 z = depth，西側貼斜牆 (0,0)–(−3.64,3.19) 與南翼東面（x ≈ −3.7）。
 */
const SVC = { west: -3.75, east: 9.0, depth: 5.0, roof: 3.4, wing: [-3.64, 3.19] as const };
/** 正面分段：西實牆段 | 玻璃店面 | 東深色窗段。 */
const SHOP = { x0: 0.4, x1: 7.2 };
/** 店面上方的招牌與白色簷口（向外出挑 `out`）。 */
const FASCIA = { x0: 0.2, x1: 7.4, y0: 3.12, y1: 4.0, out: 1.0, soffit: 0.12 };
const RISE = 0.15;
const TREAD = 0.35;
const PORCH = { z0: SVC.depth, z1: SVC.depth + 1.6, top: 0.6 };
/** 台階（店面與東段前方，幾乎全寬）。 */
const STEPS = { x0: 2.6, x1: SVC.east };
/** 坡道：前廊前方、與立面平行，西端（x0）著地、東端（x1）接前廊；外側矮牆從 wallFrom 開始，西端留入口。 */
const RAMP = { x0: -3.4, x1: 2.4, z0: PORCH.z1, z1: PORCH.z1 + 1.4, wall: 0.15, wallFrom: -2.2, wallTop: 1.15 };
/** 前方廣場：灰色連鎖磚夾紅磚帶（照片），從前廊鋪到路邊；兩個方形樹穴（混凝土框、土面）各種一棵校園樹。 */
const PLAZA = { x0: SVC.west, x1: 10.5, z0: SVC.depth, z1: 15.0, band: 4 };
const PITS: readonly { x: number; z: number; size: number; scale: number }[] = [
  { x: 5.6, z: 11.6, size: 2.0, scale: 1.0 },
  { x: 0.2, z: 12.4, size: 1.8, scale: 0.9 },
];
/** 學生宿舍D 入口：雨遮、平台、台階。 */
const D_ENTRY = { canopy: { x0: 0.3, x1: 4.7, depth: 2.8, y: 3.2 }, deck: { x0: 0.2, x1: 4.8, depth: 3.0, top: 0.6 }, steps: { x0: -0.6, x1: 5.3 } };

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

/** Canopy fascia of 學生宿舍D's entrance: white band with a blue "D". */
function dBand(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#e6e6e0';
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#2a6fb0';
  g.font = '900 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('D', 256, 34);
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

function wallFrame(ctx: Ctx, campus: CampusData, w: WallAnchor, name: string): Frame | null {
  const b = campus.buildings.find((q) => q.id === w.id);
  if (!b) return null;
  const r = b.outer, n = r.length / 2, i = w.edge, j = (i + 1) % n;
  if (i >= n) return null;
  const ax = r[i * 2]!, az = r[i * 2 + 1]!, bx = r[j * 2]!, bz = r[j * 2 + 1]!;
  // The OSM data moved: skip rather than float the feature off its wall.
  if (Math.hypot(ax - w.a[0], az - w.a[1]) > 0.5 || Math.hypot(bx - w.b[0], bz - w.b[1]) > 0.5) return null;
  const len = Math.hypot(ax - bx, az - bz);
  const ux = (ax - bx) / len, uz = (az - bz) / len; // end → start
  const g = new Group();
  g.name = name;
  g.position.set(bx, 0, bz);
  g.rotation.y = Math.atan2(-uz, ux); // local +x → (ux, uz), local +z → (−uz, ux): outward for a CCW ring
  ctx.scene.add(g);
  ctx.groups.push(g);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), g.rotation.y);
  const world = (x: number, z: number): [number, number] => [bx + ux * x - uz * z, bz + uz * x + ux * z];
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
function addServiceCentre(ctx: Ctx, f: Frame): void {
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const wall = ctx.mat(SVC_WALL, { roughness: 0.85 });
  const white = ctx.mat(0xe8e8e4, { roughness: 0.7 });
  const { west: W0, east: E, depth: D, roof: R } = SVC;
  const [wx, wz] = SVC.wing;

  // Body: footprint along the L (north block, the diagonal, the wing), extruded to the roof.
  // Shape points are (x, −z): after rotateX(−π/2) the shape's y becomes −z and the extrusion runs up.
  const plan = new Shape();
  plan.moveTo(0, -0);
  plan.lineTo(E, -0);
  plan.lineTo(E, -D);
  plan.lineTo(W0, -D);
  plan.lineTo(wx - 0.05, -wz);
  plan.lineTo(0, -0);
  f.add(new ExtrudeGeometry(plan, { depth: R, bevelEnabled: false }).rotateX(-Math.PI / 2), wall);
  f.solid(E / 2, R / 2, D / 2, E / 2, R / 2, D / 2);
  f.solid((W0 + 0) / 2, R / 2, (wz + D) / 2, -W0 / 2, R / 2, (D - wz) / 2);
  f.add(span(W0 - 0.05, E + 0.15, R, R + 0.18, wz, D + 0.15), white); // roof edge
  f.add(span(-1.5, E + 0.15, R, R + 0.18, 0, wz), white);

  // Front, west to east: wall with windows and the wheelchair sign | storefront | dark windows.
  const face = (x0: number, x1: number, y0: number, y1: number, map: CanvasTexture): void => {
    const m = f.add(new PlaneGeometry(x1 - x0, y1 - y0), ctx.tracker.material(new MeshStandardMaterial({ map, roughness: 0.5 })), false);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, D + 0.01);
  };
  const top = PORCH.top;
  face(W0, SHOP.x0, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.08, 0.42], [0.5, 0.82]], true), ctx.tracker));
  face(SHOP.x0, SHOP.x1, top, FASCIA.y0, canvasTexture(1360, 480, storefront, ctx.tracker));
  face(SHOP.x1, E, top, R - 0.1, canvasTexture(512, 336, wallSection([[0.1, 0.9]], false), ctx.tracker));

  // White soffit edge projecting over the storefront, the dark sign box on top of it.
  const { x0: fx0, x1: fx1, y0: fy0, y1: fy1, out, soffit } = FASCIA;
  f.add(span(fx0 - 0.2, fx1 + 0.2, fy0 - soffit, fy0, D, D + out + 0.05), white);
  const sign = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1440, 176, signBand, ctx.tracker), roughness: 0.6 }));
  const dark = ctx.mat(0x5f6368);
  const box = f.add(new BoxGeometry(fx1 - fx0, fy1 - fy0, out), [dark, dark, dark, dark, sign, dark]);
  box.position.set((fx0 + fx1) / 2, (fy0 + fy1) / 2, D + out / 2);

  // Porch the full width of the front.
  f.add(span(W0, E, 0, top, PORCH.z0, PORCH.z1), concrete);
  f.solid((W0 + E) / 2, top / 2, (PORCH.z0 + PORCH.z1) / 2, (E - W0) / 2, top / 2, (PORCH.z1 - PORCH.z0) / 2);
  // Steps down to the plaza in front of the storefront and the east section.
  addSteps(f, STEPS.x0, STEPS.x1, PORCH.z1, top, concrete);

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
    [-0.8, PORCH.z1 - 0.4, top], [1.0, PORCH.z1 - 0.4, top], [7.8, PORCH.z0 + 0.4, top], [8.6, PORCH.z0 + 0.4, top],
    [3.4, 9.6], [4.4, 10.1], [9.8, 8.6], [-1.4, 8.9], [0.6, 9.1],
  ]);
  addLanterns(ctx, f, [[-2.6, 10.2]]);
}

/** 宿舍服務中心前的廣場鋪面與樹穴（樹用校園樹的幾何與材質，沒有碰撞，同校園其他樹）。 */
function addPlaza(ctx: Ctx, f: Frame, trees: Pick<CampusMaterials, 'trunk' | 'canopy'> | undefined): void {
  const { x0, x1, z0, z1, band } = PLAZA;
  const tex = canvasTexture(512, 512, plazaPaving, ctx.tracker);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set((x1 - x0) / band, (z1 - z0) / band);
  const paving = ctx.tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  const ground = f.add(new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), paving, false);
  ground.position.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2);

  const curb = ctx.mat(0xa9a7a0, { roughness: 0.9 });
  const soil = ctx.mat(0x6b5a45, { roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  for (const p of PITS) {
    const h = p.size / 2, t = 0.14;
    for (const [ax0, ax1, az0, az1] of [[-h, h, -h, -h + t], [-h, h, h - t, h], [-h, -h + t, -h + t, h - t], [h - t, h, -h + t, h - t]] as const) {
      f.add(span(p.x + ax0, p.x + ax1, 0, 0.12, p.z + az0, p.z + az1), curb);
    }
    f.add(new PlaneGeometry(p.size - 2 * t, p.size - 2 * t).rotateX(-Math.PI / 2).translate(p.x, 0.06, p.z), soil, false);
  }
  if (!trees) return;
  // Instanced like the chunk trees, with the same per-instance canopy tint (campusWorld.ts).
  const { trunk, canopy } = campusTreeGeometry();
  const trunks = new InstancedMesh(ctx.tracker.geometry(trunk), trees.trunk, PITS.length);
  const canopies = new InstancedMesh(ctx.tracker.geometry(canopy), trees.canopy, PITS.length);
  const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), c = new Color();
  PITS.forEach((p, i) => {
    m.compose(new Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.x), new Vector3(p.scale, p.scale, p.scale));
    trunks.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    const shift = (i + 1) / (PITS.length + 1);
    canopies.setColorAt(i, c.setRGB(0.16 + shift * 0.08, 0.3 + shift * 0.12, 0.1 + shift * 0.05));
  });
  for (const mesh of [trunks, canopies]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    f.g.add(mesh);
  }
}

/** 學生宿舍D：入口雨遮、門、平台與台階、藍色扶手。 */
function addDormDEntrance(ctx: Ctx, f: Frame): void {
  const trim = ctx.mat(0xe6e6e0, { roughness: 0.8 });
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const { canopy: C, deck, steps } = D_ENTRY;

  // Canopy slab on two square columns, the fascia with a blue "D".
  f.add(span(C.x0, C.x1, C.y, C.y + 0.3, 0, C.depth), trim);
  for (const x of [C.x0 + 0.2, C.x1 - 0.2]) {
    f.add(span(x - 0.15, x + 0.15, deck.top, C.y, C.depth - 0.35, C.depth - 0.05), trim);
    f.solid(x, (deck.top + C.y) / 2, C.depth - 0.2, 0.15, (C.y - deck.top) / 2, 0.15);
  }
  const face = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(512, 64, dBand, ctx.tracker), roughness: 0.7 }));
  const fascia = f.add(new PlaneGeometry(C.x1 - C.x0, 0.3), face, false);
  fascia.position.set((C.x0 + C.x1) / 2, C.y + 0.15, C.depth + 0.006);

  // Dark glass double door in a grey frame on the wall.
  const mid = (C.x0 + C.x1) / 2;
  f.add(span(mid - 1.15, mid + 1.15, deck.top, deck.top + 2.7, 0.0, 0.08), ctx.mat(0x5c6166, { metalness: 0.4 }));
  f.add(span(mid - 1.0, mid + 1.0, deck.top + 0.05, deck.top + 2.55, 0.08, 0.1), ctx.mat(0x232b31, { roughness: 0.15, metalness: 0.4 }), false);

  // Raised deck under the canopy and four steps fanning out to the plaza.
  f.add(span(deck.x0, deck.x1, 0, deck.top, 0, deck.depth), concrete);
  f.solid((deck.x0 + deck.x1) / 2, deck.top / 2, deck.depth / 2, (deck.x1 - deck.x0) / 2, deck.top / 2, deck.depth / 2);
  const end = addSteps(f, steps.x0, steps.x1, deck.depth, deck.top, concrete);

  // Blue handrail down the left of the flight (photo), posts at the top and bottom.
  const blue = ctx.mat(RAIL_BLUE, { metalness: 0.4, roughness: 0.4 });
  const rx = steps.x0 + 0.25, z0 = deck.depth - 0.6, z1 = end + TREAD;
  const len = z1 - z0, hyp = Math.hypot(len, deck.top - RISE);
  const rail = f.add(new CylinderGeometry(0.03, 0.03, hyp, 8).rotateX(Math.PI / 2), blue);
  rail.position.set(rx, (deck.top + RISE) / 2 + 0.9, (z0 + z1) / 2);
  rail.rotation.x = Math.atan2(deck.top - RISE, len);
  f.add(span(rx - 0.03, rx + 0.03, 0, deck.top + 0.95, z0 - 0.03, z0 + 0.03), blue);
  f.add(span(rx - 0.03, rx + 0.03, 0, RISE + 0.95, z1 - 0.03, z1 + 0.03), blue);
  f.solid(rx, 0.6, (z0 + z1) / 2, 0.05, 0.6, len / 2);
}

/** 學生宿舍D 北翼牆前：矮混凝土花台與修剪綠籬。 */
function addDormDPlanter(ctx: Ctx, f: Frame): void {
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const x0 = 0.8, x1 = 6.6, z0 = 0.15, z1 = 1.15, h = 0.45;
  f.add(span(x0, x1, 0, h, z0, z1), concrete);
  f.add(span(x0 + 0.08, x1 - 0.08, h, h + 0.5, z0 + 0.08, z1 - 0.08), ctx.mat(0x3e6f2e, { roughness: 0.95 }));
  f.solid((x0 + x1) / 2, (h + 0.5) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (h + 0.5) / 2, (z1 - z0) / 2);
}

// ---------------------------------------------------------------- public
/** Tree-free rings over the features (campus tree scatter), in world x/z. */
export function dormTreeFree(): number[][] {
  const rect = (w: WallAnchor, x0: number, x1: number, z0: number, z1: number): number[] => {
    const len = Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]);
    const ux = (w.a[0] - w.b[0]) / len, uz = (w.a[1] - w.b[1]) / len;
    const p = (x: number, z: number): [number, number] => [w.b[0] + ux * x - uz * z, w.b[1] + uz * x + ux * z];
    return [...p(x0, z0), ...p(x1, z0), ...p(x1, z1), ...p(x0, z1)];
  };
  return [
    rect(C_SOUTH, SVC.west - 0.3, PLAZA.x1, 0, PLAZA.z1),
    rect(D_RECESS, -1.5, 7.5, 0, D_ENTRY.deck.depth + 2.5),
    rect(D_WING, 0, 7.5, 0, 3.5),
  ];
}

export function createDormFeatures(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker, trees?: Pick<CampusMaterials, 'trunk' | 'canopy'>): { dispose(): void } {
  const ctx: Ctx = {
    scene, physics, tracker, colliders: [], groups: [],
    mat: (color, extra = {}) => tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra })),
  };
  const c = wallFrame(ctx, campus, C_SOUTH, '宿舍服務中心');
  if (c) {
    addServiceCentre(ctx, c);
    addPlaza(ctx, c, trees);
  }
  const d = wallFrame(ctx, campus, D_RECESS, '學生宿舍D 入口');
  if (d) {
    addDormDEntrance(ctx, d);
    addPots(ctx, d, [[-2.5, 5.5]]);
    addLanterns(ctx, d, [[6.4, 4.0]]);
  }
  const wing = wallFrame(ctx, campus, D_WING, '學生宿舍D 花台');
  if (wing) addDormDPlanter(ctx, wing);
  return {
    dispose() {
      for (const col of ctx.colliders) physics.removeCollider(col, false);
      for (const g of ctx.groups) g.removeFromParent();
    },
  };
}
