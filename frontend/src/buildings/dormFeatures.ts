import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
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

/**
 * 宿舍區 C / D 棟外的設施（使用者實拍，2026-11-19；南北向宿舍路與 B2 / E 之間那條路的路口西側）：
 *  - 學生宿舍C：L 形轉角內、面向路口廣場的單層「宿舍服務中心」：玻璃店面、灰色招牌帶（C 字樣與跑馬燈）、
 *    出挑屋簷、抬高的前廊、正面三階台階、西側有混凝土矮牆與扶手的無障礙坡道，前方廣場幾盆紅色花盆、
 *    坡道口一支黑色雙燈頭燈柱。
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
/** 宿舍服務中心：沿牆 x 範圍、深度、高度。 */
const SVC = { x0: 0.5, x1: 8.0, depth: 5.5, height: 3.6, eave: 0.7, band: 0.9 };
const PORCH = { x0: 0.2, x1: 8.0, z0: SVC.depth, z1: SVC.depth + 2.0, top: 0.45 };
const RISE = 0.15;
const TREAD = 0.35;
/** 坡道：前廊西端往外下降（1:12）。 */
const RAMP = { x0: 0.2, x1: 1.6, len: PORCH.top * 12, wall: 0.15 };
/** 學生宿舍D 入口：雨遮、平台、台階。 */
const D_ENTRY = { canopy: { x0: 0.3, x1: 4.7, depth: 2.8, y: 3.2 }, deck: { x0: 0.2, x1: 4.8, depth: 3.0, top: 0.6 }, steps: { x0: -0.6, x1: 5.3 } };

// ---------------------------------------------------------------- colours
const CONCRETE = 0xb4b2ac;
const SVC_WALL = 0xc8c6bf;
const BAND = 0x8d9094;
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

/** Storefront: pale green glass panes in dark frames, a transom row, posters on a few panes. */
function storefront(g: CanvasRenderingContext2D): void {
  const W = 1024, H = 320;
  g.fillStyle = '#2b2f33';
  g.fillRect(0, 0, W, H);
  const cols = 10, pw = W / cols;
  for (let i = 0; i < cols; i++) {
    const x = i * pw;
    g.fillStyle = '#9fc4b4';
    g.fillRect(x + 6, 8, pw - 12, 60); // transom
    g.fillStyle = i === 4 || i === 5 ? '#3b4a50' : '#8fb8a8'; // the doors are darker (interior shows through)
    g.fillRect(x + 6, 78, pw - 12, H - 86);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + 10, 82, (pw - 20) * 0.3, H - 94);
  }
  // Posters and notices taped to the lower panes (photo: a row of colourful sheets).
  const posters = ['#e8c547', '#e5735b', '#f2f0e6', '#6fb3d9', '#e8c547', '#f2f0e6', '#d36b8f'];
  posters.forEach((c, k) => {
    const i = [0, 1, 2, 3, 6, 7, 8][k]!;
    g.fillStyle = c;
    g.fillRect(i * pw + 18, 210, pw - 36, 80);
  });
}

/** Sign band: grey fascia, a big "C" and the LED marquee 「宿舍服務中心」. */
function signBand(g: CanvasRenderingContext2D): void {
  const W = 1024, H = 128;
  g.fillStyle = '#8d9094';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2a6fb0';
  g.font = '900 104px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText('C', 80, 68);
  g.fillStyle = '#16181b';
  g.fillRect(170, 26, 820, 78);
  g.fillStyle = '#ff4fa0';
  g.font = "800 58px 'PingFang TC', 'Noto Sans TC', sans-serif";
  g.textAlign = 'left';
  g.fillText('宿舍服務中心', 196, 67);
  g.fillStyle = '#5dff7a';
  g.font = "700 34px 'PingFang TC', 'Noto Sans TC', sans-serif";
  g.fillText('歡迎光臨 · 生活用品', 620, 67);
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

/** Terracotta pot with a small shrub. */
function potGeometry(): { pot: BufferGeometry; leaves: BufferGeometry } {
  return {
    pot: new CylinderGeometry(0.3, 0.22, 0.45, 12).translate(0, 0.225, 0),
    leaves: mergeGeometries([new SphereGeometry(0.34, 8, 6).scale(1, 1.4, 1).translate(0, 0.8, 0), new SphereGeometry(0.22, 8, 6).translate(0.12, 1.2, 0.05)])!,
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

function addPots(ctx: Ctx, f: Frame, spots: readonly [number, number][]): void {
  const { pot, leaves } = potGeometry();
  const clay = ctx.mat(POT, { roughness: 0.85 }), leaf = ctx.mat(LEAF, { roughness: 0.9 });
  for (const [x, z] of spots) {
    f.add(pot.clone().translate(x, 0, z), clay);
    f.add(leaves.clone().translate(x, 0, z), leaf);
    f.solid(x, 0.3, z, 0.3, 0.3, 0.3);
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

/** 學生宿舍C：宿舍服務中心（單層玻璃店面、招牌帶、前廊、台階、坡道）。 */
function addServiceCentre(ctx: Ctx, f: Frame): void {
  const concrete = ctx.mat(CONCRETE, { roughness: 0.9 });
  const wall = ctx.mat(SVC_WALL, { roughness: 0.85 });
  const { x0, x1, depth: D, height: H, eave, band } = SVC;
  const W = x1 - x0, cx = (x0 + x1) / 2;

  // Body: solid east and west walls, a back against the dorm, roof slab with an eave over the porch.
  f.add(span(x0, x1, 0, H, 0, D - 0.15), wall);
  f.solid(cx, H / 2, (D - 0.15) / 2, W / 2, H / 2, (D - 0.15) / 2);
  f.add(span(x0 - 0.1, x1 + 0.1, H - 0.05, H + 0.25, 0, D + eave), concrete);
  // Storefront glass on the front (+z) face, under the sign band.
  const glass = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1024, 320, storefront, ctx.tracker), roughness: 0.25, metalness: 0.1 }));
  const front = f.add(new PlaneGeometry(W - 0.3, H - band - 0.1), glass, false);
  front.position.set(cx, (H - band - 0.1) / 2 + 0.05, D - 0.14);
  // Sign band on the front of the eave, and a plain band round the east end.
  const sign = ctx.tracker.material(new MeshStandardMaterial({ map: canvasTexture(1024, 128, signBand, ctx.tracker), roughness: 0.6 }));
  const bandMats: Material[] = [ctx.mat(BAND), ctx.mat(BAND), ctx.mat(BAND), ctx.mat(BAND), sign, ctx.mat(BAND)];
  const fascia = f.add(new BoxGeometry(W + 0.2, band, 0.12), bandMats);
  fascia.position.set(cx, H - band / 2 + 0.2, D + eave + 0.06);
  f.add(span(x1 + 0.1, x1 + 0.22, H - band + 0.2, H + 0.2, 0, D + eave + 0.12), ctx.mat(BAND));

  // Raised porch along the front, three steps down to the plaza east of the ramp.
  const { x0: px0, x1: px1, z0: pz0, z1: pz1, top } = PORCH;
  f.add(span(px0, px1, 0, top, pz0, pz1), concrete);
  f.solid((px0 + px1) / 2, top / 2, (pz0 + pz1) / 2, (px1 - px0) / 2, top / 2, (pz1 - pz0) / 2);
  addSteps(f, RAMP.x1 + 0.2, px1, pz1, top, concrete);

  // Ramp down from the porch's west end (1:12), between a low wall on the dorm side and a
  // concrete parapet with a steel handrail on the steps side (photo).
  const { x0: rx0, x1: rx1, len: L, wall: t } = RAMP;
  const slope = Math.atan2(top, L), hyp = Math.hypot(top, L);
  const ramp = f.add(new BoxGeometry(rx1 - rx0, 0.1, hyp), concrete);
  ramp.position.set((rx0 + rx1) / 2, top / 2 - 0.05, pz1 + L / 2);
  ramp.rotation.x = slope; // its far (+z) end down at the ground
  f.solid((rx0 + rx1) / 2, top / 2 - 0.05, pz1 + L / 2, (rx1 - rx0) / 2, 0.05, hyp / 2, slope);
  const capY = top + 0.9;
  for (const x of [rx0 - t / 2, rx1 + t / 2]) {
    f.add(span(x - t / 2, x + t / 2, 0, capY, pz1, pz1 + L), concrete);
    f.solid(x, capY / 2, pz1 + L / 2, t / 2, capY / 2, L / 2);
  }
  const steel = ctx.mat(0xc9ccce, { metalness: 0.7, roughness: 0.3 });
  const rail = f.add(new CylinderGeometry(0.025, 0.025, hyp, 8).rotateX(Math.PI / 2), steel);
  rail.position.set(rx1 - 0.08, top / 2 + 0.85, pz1 + L / 2);
  rail.rotation.x = slope;
  for (const z of [pz1 + 0.3, pz1 + L / 2, pz1 + L - 0.3]) {
    const h = top * (1 - (z - pz1) / L);
    f.add(new CylinderGeometry(0.02, 0.02, 0.85, 6).translate(rx1 - 0.08, h + 0.425, z), steel);
  }

  // Pots on the plaza and a lantern at the foot of the ramp.
  addPots(ctx, f, [[3.0, pz1 + 2.0], [5.6, pz1 + 3.2], [8.6, pz1 + 1.6], [10.8, pz1 + 3.8], [7.4, pz1 + 5.2]]);
  addLanterns(ctx, f, [[-0.6, pz1 + L - 0.4]]);
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
    rect(C_SOUTH, -1.5, 12.5, 0, PORCH.z1 + RAMP.len + 1.5),
    rect(D_RECESS, -1.5, 7.5, 0, D_ENTRY.deck.depth + 2.5),
    rect(D_WING, 0, 7.5, 0, 3.5),
  ];
}

export function createDormFeatures(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): { dispose(): void } {
  const ctx: Ctx = {
    scene, physics, tracker, colliders: [], groups: [],
    mat: (color, extra = {}) => tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra })),
  };
  const c = wallFrame(ctx, campus, C_SOUTH, '宿舍服務中心');
  if (c) addServiceCentre(ctx, c);
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
