import {
  BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3, ExtrudeGeometry, Shape, Vector2, type BufferGeometry, type Material, type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { BuildingSource } from './buildingTypes';
import { createPlanTransform } from './planTransform';
import { latticeRings } from './dormCFacade';
import { DORM_C_ROOM_DOOR, DORM_C_UNIT_FLOOR, DORM_C_UNIT_PLAN as R } from './dormCUnit';

/**
 * Everything inside the 學生宿舍C flat (dormCUnit.ts gives only walls, doors, floor and ceiling), modelled from the user's
 * photos (2026-11-23):
 *  - 寢室（四間一樣）：兩側各兩座柚木色上床下桌，兩側對稱——靠窗那座床架下是書桌＋格子書架＋抽屜（書桌對書桌），靠門那座是
 *    雙門衣櫃（衣櫃對衣櫃），門邊一側開放書櫃、一側磁磚牆加鏡子；中間一座層架櫃，前面木梯一邊用斜木板接書桌、一邊直接靠衣櫃；床邊金屬圓弧護欄；窗在走道盡頭（百葉窗、下方矮櫃、上方冷氣）；米色地磚、方形日光燈、牆上線槽；
 *  - 浴室：全白方磁磚牆、灰色輕鋼架天花板＋日光燈、一排磁磚隔間的廁所（米色門）、兩個小便斗（米色隔板、橘色沖水器）、
 *    兩個洗手台與大鏡子、高處百葉通風窗與高窗；
 *  - 曬衣間：外側紅色鏤空花磚牆＋磁磚矮牆、西端開口（矮牆＋長條磁磚洗手台）、北牆兩扇鐵窗＋高窗、洗衣機、
 *    深藍鋼管曬衣架、不鏽鋼曬衣架、白磁磚腰牆；
 *  - 雜物間、走廊鞋櫃、交誼廳（沙發、茶几、電視、餐桌、鞋櫃、飲水機、窗）。
 * Plan coordinates (x, height above the flat's floor, plan y) — a room's furniture in room coordinates (u across from its
 * west wall, v from its window wall), turned into plan by the room's frame. Solid where you'd bump into it.
 */
export interface DormCUnitDecor { dispose(): void }

type Rect = readonly [number, number, number, number];
/** Room coordinates → plan: a translation, turned 180° for room 1. */
interface Frame { m: Matrix4; toPlan(u: number, v: number): [number, number] }
const PLAN: Frame = { m: new Matrix4(), toPlan: (u, v) => [u, v] };
const roomFrame = (r: Rect, turned: boolean): Frame => turned
  ? { m: new Matrix4().makeTranslation(r[2], 0, r[3]).multiply(new Matrix4().makeRotationY(Math.PI)), toPlan: (u, v) => [r[2] - u, r[3] - v] }
  : { m: new Matrix4().makeTranslation(r[0], 0, r[1]), toPlan: (u, v) => [r[0] + u, r[1] + v] };

/** The generated floor finish stands this far above the level (buildingMesh FLOOR_Y): everything here sits on it. */
const LIFT = 0.08;
const CEIL = 3.0 - LIFT; // the generated ceiling, measured from the floor finish
const WALL = 0.1; // half a wall: inner faces stand this far off the plan lines

/** A box x0..x1 × y0..y1 (height) × z0..z1 whose UVs are in units of `s` metres (tiles and grain keep their size). */
function tbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, s = 1): BufferGeometry {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, (uv.getX(i) * dims[f]![0]) / s, (uv.getY(i) * dims[f]![1]) / s);
  }
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** A plane w × h facing +z, UVs in units of `s` metres (s = 0: one image over the whole plane). */
function tplane(w: number, h: number, s = 0): BufferGeometry {
  const g = new PlaneGeometry(w, h);
  if (s > 0) {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / s, (uv.getY(i) * h) / s);
  }
  return g;
}
/** Tiny deterministic random for book colours and grain. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export function createDormCUnitDecor(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, src: BuildingSource): DormCUnitDecor {
  const xf = createPlanTransform(src);
  const [ox, oz] = xf.toWorld(0, 0);
  const root = new Group();
  root.name = '學生宿舍C flat interior';
  root.position.set(ox, DORM_C_UNIT_FLOOR + LIFT, oz);
  root.rotation.y = xf.rotY;
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];

  // --- Materials ----------------------------------------------------------------------------------
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) draw(g, w, h);
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  /** Square tiles: `n` per texture, face colour with a little variation, grout lines. */
  const tiles = (n: number, face: [number, number, number], grout: string, vary = 6, seed = 1) => canvasTex(256, 256, (g, w) => {
    const r = rng(seed), step = w / n;
    g.fillStyle = grout;
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = (r() - 0.5) * vary;
      g.fillStyle = `rgb(${face[0] + k},${face[1] + k},${face[2] + k})`;
      g.fillRect(i * step + 1.5, j * step + 1.5, step - 3, step - 3);
    }
  });
  const std = (color: number, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.7, ...extra }));

  // Teak-orange wood (one texture = 1 m), the lofts, wardrobes, desks and doors.
  const woodTex = canvasTex(256, 256, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#c98443';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x0 = r() * w, a = 0.08 + r() * 0.22, dark = r() < 0.6;
      g.strokeStyle = dark ? `rgba(130,62,18,${a})` : `rgba(240,180,110,${a})`;
      g.lineWidth = 0.8 + r() * 2.2;
      g.beginPath();
      for (let y = 0; y <= h; y += 16) g.lineTo(x0 + Math.sin(y / 40 + i) * 4, y);
      g.stroke();
    }
  });
  const wood = std(0xffffff, { map: woodTex, roughness: 0.55 });
  const woodDark = std(0x7a4219, { roughness: 0.6 });
  const wallTile = std(0xffffff, { map: tiles(5, [242, 242, 238], '#9c9c98', 5, 2), roughness: 0.3 }); // 0.2 m white tiles
  const smallTile = std(0xffffff, { map: tiles(10, [238, 238, 232], '#a9a9a2', 5, 3), roughness: 0.35 }); // 0.1 m (counters)
  const roomFloor = std(0xffffff, { map: tiles(3, [214, 199, 172], '#b4a382', 8, 4), roughness: 0.5 }); // 0.3 m beige
  const bathFloor = std(0xffffff, { map: tiles(5, [232, 228, 216], '#7c776c', 10, 5), roughness: 0.4 }); // grimy grout
  const clothFloor = std(0xffffff, { map: tiles(3, [168, 165, 156], '#7f7b72', 10, 6), roughness: 0.6 });
  // Ceilings get little light from below: a touch of their own glow keeps them looking painted, not black.
  const gridTex = canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#7c8086';
    g.fillRect(0, 0, w, w);
    g.fillStyle = '#d6d6d2';
    g.fillRect(0, 0, w, 4);
    g.fillRect(0, 0, 4, w);
  });
  const ceilingGrid = std(0xffffff, { map: gridTex, emissiveMap: gridTex, emissive: 0x6a6a6a, roughness: 0.8 });
  const ceilingPaint = std(0xf2f0ea, { emissive: 0x8c8a84, roughness: 0.9 });
  const blindsTex = canvasTex(32, 64, (g, w, h) => {
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = '#d9dad6';
      g.fillRect(0, y, w, 6);
      g.fillStyle = '#a8aaa6';
      g.fillRect(0, y + 5, w, 1);
    }
  });
  const blinds = std(0xffffff, { map: blindsTex, alphaTest: 0.5, side: DoubleSide, roughness: 0.6 });
  // What you see out of the windows: sky, the next dorm block, campus trees.
  const viewTex = canvasTex(512, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#8fbce6');
    sky.addColorStop(1, '#d8e8f2');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#cfc6b8';
    g.fillRect(w * 0.55, h * 0.28, w * 0.32, h * 0.5);
    g.fillStyle = '#8d8a84';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) g.fillRect(w * 0.57 + i * w * 0.05, h * 0.32 + j * h * 0.1, w * 0.03, h * 0.05);
    const r = rng(9);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = h * (0.55 + r() * 0.3), rad = 14 + r() * 30;
      g.fillStyle = `rgb(${50 + r() * 40},${100 + r() * 50},${45 + r() * 30})`;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 14; i++) { // bougainvillea
      g.fillStyle = `rgba(214,${70 + r() * 40},${140 + r() * 40},0.9)`;
      g.beginPath();
      g.arc(r() * w, h * (0.55 + r() * 0.25), 4 + r() * 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#7d8a6a';
    g.fillRect(0, h * 0.86, w, h * 0.14);
  });
  const view = tracker.material(new MeshBasicMaterial({ map: viewTex }));
  const lattice = tracker.material(new MeshStandardMaterial({ map: canvasTex(128, 128, (g) => latticeRings(g)), alphaTest: 0.5, side: DoubleSide, roughness: 0.9 }));
  const plaster = std(0xeeebe4, { roughness: 0.9 });
  const alu = std(0x3c3d3e, { metalness: 0.5, roughness: 0.45 });
  const steel = std(0xc4c8cc, { metalness: 0.7, roughness: 0.35 });
  const railMat = std(0xa9adb2, { metalness: 0.8, roughness: 0.3, side: DoubleSide });
  const navy = std(0x2b3650, { metalness: 0.5, roughness: 0.5 });
  const porcelain = std(0xf7f7f4, { roughness: 0.15 });
  const basinIn = std(0xdcdcd6, { roughness: 0.2 });
  const beige = std(0xcdb894, { roughness: 0.55 }); // stall doors, urinal screens
  const beigeDark = std(0x9c8a6a, { roughness: 0.6 });
  const flush = std(0xd39a3e, { roughness: 0.5 });
  const mirror = std(0xc6d2d8, { metalness: 0.15, roughness: 0.08 });
  const darkGlass = std(0x27323a, { metalness: 0.6, roughness: 0.15 });
  const light = tracker.material(new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfdfcf4, emissiveIntensity: 1.1 }));
  const white = std(0xf2f2ee, { roughness: 0.4 });
  const washer = std(0xd9d6cb, { roughness: 0.45 });
  const panelDark = std(0x5f6368, { roughness: 0.5 });
  const mattress = std(0x5b7392, { roughness: 0.9 });
  const pillow = std(0xeeeae0, { roughness: 0.9 });
  const chairSeat = std(0x6a6d70, { roughness: 0.6 });
  const fabric = std(0x5a6a7c, { roughness: 0.95 });
  const black = std(0x1d1e20, { roughness: 0.4 });
  const doorPink = std(0xeab4aa, { roughness: 0.55 });
  const doorEdge = std(0x3a3332, { roughness: 0.6 });
  const blue = std(0x5d8fc4, { roughness: 0.4 });
  const bookMats = [0xb03a2e, 0x2e6fb0, 0xe0b23a, 0x3c8d5a, 0xf0f0f0, 0x6b4a9a].map((c) => std(c, { roughness: 0.8 }));

  // --- Geometry collection ------------------------------------------------------------------------
  const parts = new Map<Material, BufferGeometry[]>();
  const put = (f: Frame, g: BufferGeometry, m: Material): void => {
    g.applyMatrix4(f.m);
    const list = parts.get(m);
    if (list) list.push(g);
    else parts.set(m, [g]);
  };
  const q = { x: 0, y: Math.sin(xf.rotY / 2), z: 0, w: Math.cos(xf.rotY / 2) };
  /** Solid for the player: box u0..u1 × h0..h1 × v0..v1 in frame `f`. */
  const solid = (f: Frame, u0: number, u1: number, h0: number, h1: number, v0: number, v1: number): void => {
    const [ax, ay] = f.toPlan(u0, v0), [bx, by] = f.toPlan(u1, v1);
    const [wx, wz] = xf.toWorld((ax + bx) / 2, (ay + by) / 2);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(Math.abs(bx - ax) / 2, (h1 - h0) / 2, Math.abs(by - ay) / 2)
      .setTranslation(wx, DORM_C_UNIT_FLOOR + LIFT + (h0 + h1) / 2, wz).setRotation(q)));
  };
  const box = (f: Frame, m: Material, u0: number, u1: number, h0: number, h1: number, v0: number, v1: number, s = 1): void =>
    put(f, tbox(u0, u1, h0, h1, v0, v1, s), m);
  /** A tube between two points (room coordinates). */
  const tube = (f: Frame, m: Material, a: [number, number, number], b: [number, number, number], r = 0.02): void => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    const g = new CylinderGeometry(r, r, len, 8);
    // Cylinder runs along +y; turn it onto the segment.
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const axis = { x: dir.z, y: 0, z: -dir.x }, s = Math.hypot(axis.x, axis.z);
    if (s > 1e-6) g.applyMatrix4(new Matrix4().makeRotationAxis(new Vector3(axis.x / s, 0, axis.z / s), Math.acos(Math.max(-1, Math.min(1, dir.y)))));
    else if (dir.y < 0) g.rotateX(Math.PI);
    put(f, g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), m);
  };
  /** Wall finish on the face at u = `at` (facing +u if dir > 0), spanning v0..v1, h0..h1. */
  const faceU = (f: Frame, m: Material, at: number, dir: 1 | -1, v0: number, v1: number, h0: number, h1: number, s = 0): void =>
    put(f, tplane(v1 - v0, h1 - h0, s).rotateY(dir > 0 ? Math.PI / 2 : -Math.PI / 2).translate(at, (h0 + h1) / 2, (v0 + v1) / 2), m);
  /** Wall finish on the face at v = `at` (facing +v if dir > 0), spanning u0..u1, h0..h1. */
  const faceV = (f: Frame, m: Material, at: number, dir: 1 | -1, u0: number, u1: number, h0: number, h1: number, s = 0): void =>
    put(f, tplane(u1 - u0, h1 - h0, s).rotateY(dir > 0 ? 0 : Math.PI).translate((u0 + u1) / 2, (h0 + h1) / 2, at), m);
  const floor = (f: Frame, m: Material, r: Rect, s: number, h = 0.006): void =>
    put(f, tplane(r[2] - r[0], r[3] - r[1], s).rotateX(-Math.PI / 2).translate((r[0] + r[2]) / 2, h, (r[1] + r[3]) / 2), m);
  /** Plain painted ceiling over a rect (covers the generated acoustic grid). */
  const ceiling = (f: Frame, m: Material, r: Rect, s = 0): void =>
    put(f, tplane(r[2] - r[0], r[3] - r[1], s).rotateX(Math.PI / 2).translate((r[0] + r[2]) / 2, CEIL - 0.004, (r[1] + r[3]) / 2), m);
  const ceilingPanel = (f: Frame, cu: number, cv: number, wu: number, wv: number): void => {
    box(f, white, cu - wu / 2 - 0.04, cu + wu / 2 + 0.04, CEIL - 0.06, CEIL - 0.005, cv - wv / 2 - 0.04, cv + wv / 2 + 0.04);
    box(f, light, cu - wu / 2, cu + wu / 2, CEIL - 0.07, CEIL - 0.06, cv - wv / 2, cv + wv / 2);
  };
  /**
   * A window in the wall face at v = `at` (room looks toward −dir… i.e. the window faces +v when dir > 0), u0..u1, h0..h1:
   * dark aluminium frame and mullion, the outside view (or dark glass), optional blinds and security grille.
   */
  const windowV = (f: Frame, at: number, dir: 1 | -1, u0: number, u1: number, h0: number, h1: number,
    o: { blinds?: number; grille?: boolean; dark?: boolean; mullions?: number } = {}): void => {
    const d = dir * 0.06, fw = 0.05, v0 = Math.min(at, at + d), v1 = Math.max(at, at + d);
    faceV(f, o.dark ? darkGlass : view, at + dir * 0.004, dir, u0, u1, h0, h1);
    box(f, alu, u0 - fw, u1 + fw, h0 - fw, h0, v0, v1);
    box(f, alu, u0 - fw, u1 + fw, h1, h1 + fw, v0, v1);
    box(f, alu, u0 - fw, u0, h0, h1, v0, v1);
    box(f, alu, u1, u1 + fw, h0, h1, v0, v1);
    const n = o.mullions ?? 1;
    for (let i = 1; i <= n; i++) { const u = u0 + ((u1 - u0) * i) / (n + 1); box(f, alu, u - 0.02, u + 0.02, h0, h1, v0, v1); }
    if (o.blinds) {
      const bh = (h1 - h0) * o.blinds;
      faceV(f, blinds, at + dir * 0.075, dir, u0 + 0.02, u1 - 0.02, h1 - bh, h1, 0.25);
      box(f, white, u0 - 0.02, u1 + 0.02, h1 - 0.06, h1 + 0.02, Math.min(at + dir * 0.06, at + dir * 0.11), Math.max(at + dir * 0.06, at + dir * 0.11));
    }
    if (o.grille) {
      const gv0 = Math.min(at + dir * 0.07, at + dir * 0.09), gv1 = Math.max(at + dir * 0.07, at + dir * 0.09);
      for (let u = u0 + 0.12; u < u1 - 0.05; u += 0.12) box(f, black, u - 0.008, u + 0.008, h0, h1, gv0, gv1);
      for (const h of [h0 + (h1 - h0) / 3, h0 + ((h1 - h0) * 2) / 3]) box(f, black, u0, u1, h - 0.01, h + 0.01, gv0, gv1);
    }
  };
  /** Same, in a wall face at plan x = `at`, spanning plan y v0..v1: a frame turned a quarter (room u = −plan y, v = plan x). */
  const windowU = (at: number, dir: 1 | -1, v0: number, v1: number, h0: number, h1: number, o: Parameters<typeof windowV>[7] = {}): void => {
    const f: Frame = { m: new Matrix4().makeRotationY(Math.PI / 2), toPlan: (u, v) => [v, -u] };
    windowV(f, at, dir, -v1, -v0, h0, h1, o);
  };

  // --- 寢室 × 4 ----------------------------------------------------------------------------------
  const RW = R.room2[2] - R.room2[0], RD = R.room2[3] - R.room2[1];
  const U0 = WALL, U1 = RW - WALL, V0 = WALL, V1 = RD - WALL;
  const DECK = 1.15, DECK_LO = 1.72, DECK_HI = 1.86, RAIL = 2.32, ARC = 0.36;
  const LADDER: [number, number] = [3.6, 4.4];
  /** Box measured from the side wall: a = distance off the wall (0 at the wall face), side −1 = west wall, +1 = east wall. */
  const sb = (f: Frame, side: -1 | 1, m: Material, a0: number, a1: number, h0: number, h1: number, v0: number, v1: number, s = 1): void =>
    side < 0 ? box(f, m, U0 + a0, U0 + a1, h0, h1, v0, v1, s) : box(f, m, U1 - a1, U1 - a0, h0, h1, v0, v1, s);
  const sSolid = (f: Frame, side: -1 | 1, a0: number, a1: number, h0: number, h1: number, v0: number, v1: number): void =>
    side < 0 ? solid(f, U0 + a0, U0 + a1, h0, h1, v0, v1) : solid(f, U1 - a1, U1 - a0, h0, h1, v0, v1);
  const sU = (side: -1 | 1, a: number): number => (side < 0 ? U0 + a : U1 - a);

  const loft = (f: Frame, side: -1 | 1, v0: number, v1: number, bedAtStart: boolean, seed: number): void => {
    sb(f, side, wood, 0, DECK, DECK_LO, DECK_HI, v0, v1); // deck, held by the walls (使用者：床沒有另外的支撐條)
    sb(f, side, wood, DECK - 0.04, DECK, DECK_LO - 0.12, DECK_HI + 0.1, v0, v1); // thick front fascia
    // Raised end board where the bed meets the ladder (使用者：床連接到樓梯的地方一樣會有凸起來的擋板).
    const le = bedAtStart ? v1 - 0.03 : v0;
    sb(f, side, wood, 0, DECK, DECK_LO - 0.12, DECK_HI + 0.32, le, le + 0.03);
    sSolid(f, side, 0, DECK, DECK_LO - 0.12, DECK_HI + 0.15, v0, v1);
    // Mattress, pillow and a folded quilt.
    const m0 = bedAtStart ? v0 + 0.08 : v1 - 2.08, m1 = m0 + 2.0;
    sb(f, side, mattress, 0.05, DECK - 0.1, DECK_HI, DECK_HI + 0.12, m0, m1);
    const head = bedAtStart ? m0 + 0.05 : m1 - 0.45;
    sb(f, side, pillow, 0.2, 0.8, DECK_HI + 0.12, DECK_HI + 0.2, head, head + 0.4);
    const r = rng(seed);
    if (r() < 0.7) { const qv = bedAtStart ? m1 - 0.6 - r() * 0.3 : m0 + 0.2 + r() * 0.3; sb(f, side, pillow, 0.15, 0.85, DECK_HI + 0.12, DECK_HI + 0.24, qv, qv + 0.4); }
    // Steel rail with rounded ends along the aisle edge.
    const u = sU(side, DECK - 0.02), vs = v0 + 0.12, ve = v1 - 0.12, top = RAIL, base = DECK_HI + 0.12;
    tube(f, railMat, [u, top, vs + ARC], [u, top, ve - ARC]);
    for (const [v, turn] of [[vs + ARC, Math.PI / 2], [ve - ARC, -Math.PI / 2]] as const) {
      put(f, new TorusGeometry(ARC, 0.02, 6, 12, Math.PI / 2).rotateY(turn).translate(u, top - ARC, v), railMat);
    }
    for (const v of [vs, ve]) tube(f, railMat, [u, base, v], [u, top - ARC, v]);
    for (let v = vs + 1.0; v < ve - 0.6; v += 1.0) tube(f, railMat, [u, base, v], [u, top, v], 0.012);
  };
  /**
   * Wardrobes against the ladder (no gap), as deep as the ladder's foot; at the door end either an open bookcase or a
   * tiled niche with a mirror (使用者照片：一側衣櫃旁是書櫃，另一側是磁磚牆加鏡子).
   */
  const WARD_D = 0.88;
  const wardrobes = (f: Frame, side: -1 | 1, v0: number, v1: number, end: 'shelf' | 'mirror'): void => {
    const endW = end === 'shelf' ? 0.45 : 0.7;
    const w0 = v0, w1 = v1 - endW, sh0 = w1, sh1 = v1;
    sb(f, side, wood, 0, WARD_D, 0, DECK_LO - 0.02, w0, w1);
    const mid = (w0 + w1) / 2;
    for (const [a, b] of [[w0, mid], [mid, w1]] as const) {
      const c = (a + b) / 2;
      for (const v of [a + 0.01, c, b - 0.01]) sb(f, side, woodDark, WARD_D, WARD_D + 0.005, 0.04, DECK_LO - 0.06, v - 0.004, v + 0.004); // door seams
      for (const v of [c - 0.06, c + 0.06]) sb(f, side, steel, WARD_D, WARD_D + 0.025, 0.95, 0.99, v - 0.012, v + 0.012); // latches
    }
    sSolid(f, side, 0, WARD_D, 0, DECK_LO, w0, w1);
    if (end === 'shelf') {
      sb(f, side, wood, 0, 0.42, 0, DECK_LO - 0.02, sh1 - 0.02, sh1);
      for (let h = 0.02; h < DECK_LO - 0.1; h += 0.34) sb(f, side, wood, 0, 0.42, h, h + 0.02, sh0, sh1);
      sSolid(f, side, 0, 0.42, 0, DECK_LO, sh0, sh1);
    } else {
      const at = side < 0 ? U0 : U1, dir = side < 0 ? 1 : -1;
      faceU(f, wallTile, at + dir * 0.004, dir, sh0, sh1, 0, 1.0, 1);
      sb(f, side, wood, 0, 0.03, 1.0, 1.04, sh0 + 0.04, sh1 - 0.04);
      sb(f, side, wood, 0, 0.03, 1.62, 1.66, sh0 + 0.04, sh1 - 0.04);
      faceU(f, mirror, at + dir * 0.02, dir, sh0 + 0.06, sh1 - 0.06, 1.04, 1.62);
    }
  };
  /**
   * Two people's desks along one loft (使用者：一個人的書桌上方書櫃只有六格、桌下抽屜只有兩個): one desk top, a divider
   * under it between the two, two drawers each, and over each desk a 3 × 2 cubby shelf. `clear`: the window-end stretch
   * the low built-in cabinet runs under, kept free of drawers.
   */
  const desks = (f: Frame, side: -1 | 1, v0: number, v1: number, seed: number, clear = 0): void => {
    const r = rng(seed), half = (v0 + v1) / 2;
    sb(f, side, wood, 0, 0.66, 0.72, 0.76, v0, v1); // desk top
    for (const v of [v0 + 0.015, half, v1 - 0.015]) sb(f, side, wood, 0, 0.64, 0, 0.72, v - 0.015, v + 0.015);
    // Two drawers per person, hung under the top at the front.
    for (const [p0, p1] of [[v0 + clear, half], [half, v1]] as const) {
      const a0 = p0 + 0.03, a1 = p1 - 0.03, mid = (a0 + a1) / 2;
      sb(f, side, wood, 0.42, 0.63, 0.58, 0.72, a0, a1);
      sb(f, side, woodDark, 0.63, 0.634, 0.58, 0.72, mid - 0.004, mid + 0.004);
      for (const c of [(a0 + mid) / 2, (mid + a1) / 2]) sb(f, side, steel, 0.63, 0.65, 0.64, 0.66, c - 0.03, c + 0.03);
    }
    // Over the two desks: one shelf unit, joined (使用者：兩個座位上方的櫃子連在一起) — three columns × two rows per person.
    const c0 = 1.0, c1 = DECK_LO - 0.04, cd = 0.32, rows = 2, cols = 6;
    const q0 = v0 + 0.05, q1 = v1 - 0.05;
    for (let k = 0; k <= rows; k++) { const h = c0 + ((c1 - c0 - 0.02) * k) / rows; sb(f, side, wood, 0, cd, h, h + 0.02, q0, q1); }
    for (let i = 0; i <= cols; i++) { const v = q0 + ((q1 - q0) * i) / cols; sb(f, side, wood, 0, cd, c0, c1, v - 0.01, v + 0.01); }
    for (let i = 0; i < cols; i++) for (let row = 0; row < rows; row++) {
      if (r() < 0.4) continue;
      const cv0 = q0 + ((q1 - q0) * i) / cols + 0.03, h = c0 + 0.02 + ((c1 - c0) / rows) * row;
      const end = cv0 + (q1 - q0) / cols - 0.06;
      let v = cv0;
      while (v < end - 0.03) {
        const t = 0.025 + r() * 0.03;
        sb(f, side, bookMats[Math.floor(r() * bookMats.length)]!, 0.04, 0.24 + r() * 0.05, h, h + 0.15 + r() * 0.1, v, v + t);
        v += t + 0.004;
      }
    }
    sSolid(f, side, 0, 0.66, 0, 0.78, v0, v1);
    sSolid(f, side, 0, cd, 0.78, DECK_LO, v0, v1);
    // Folding chairs pulled out from the desk.
    for (const t of [0.28, 0.72]) {
      const v = v0 + (v1 - v0) * t + (r() - 0.5) * 0.15, a = 0.95 + r() * 0.1;
      sb(f, side, chairSeat, a - 0.2, a + 0.2, 0.44, 0.47, v - 0.2, v + 0.2);
      sb(f, side, chairSeat, a + 0.17, a + 0.2, 0.62, 0.9, v - 0.19, v + 0.19);
      for (const [da, dv] of [[-0.18, -0.18], [-0.18, 0.18], [0.18, -0.18], [0.18, 0.18]] as const) {
        sb(f, side, steel, a + da - 0.01, a + da + 0.01, 0, da > 0 ? 0.9 : 0.45, v + dv - 0.01, v + dv + 0.01);
      }
    }
  };
  /**
   * The middle unit between a side's two lofts (使用者照片：中間有櫃子也有梯子): a cabinet of open shelves against the wall
   * up to the decks, with a wooden ladder leaning on its front — two stiles and board rungs — up to the loft.
   */
  const ladder = (f: Frame, side: -1 | 1): void => {
    const [v0, v1] = LADDER, cab = 0.58;
    // Cabinet: sides, back, top, shelves (deeper-set back so the cubbies read dark).
    sb(f, side, wood, 0, cab, 0, DECK_LO, v0, v0 + 0.025);
    sb(f, side, wood, 0, cab, 0, DECK_LO, v1 - 0.025, v1);
    sb(f, side, woodDark, 0, 0.02, 0, DECK_LO, v0, v1);
    sb(f, side, wood, 0, cab, DECK_LO - 0.03, DECK_LO, v0, v1);
    for (let h = 0.02; h < DECK_LO - 0.2; h += 0.34) sb(f, side, wood, 0, cab, h, h + 0.025, v0 + 0.025, v1 - 0.025);
    // Ladder (使用者照片：樓梯一邊直接一塊木板連到書桌，另一邊直接靠在衣櫃上): on the desk side a wide slanted board
    // from the wall out to the ladder's foot, on the wardrobe side the rungs run straight into the wardrobe; flat rungs every 0.3 m.
    const foot = WARD_D, top = cab + 0.04, hTop = DECK_HI;
    const board = new Shape([new Vector2(sU(side, 0), 0), new Vector2(sU(side, foot), 0), new Vector2(sU(side, top), hTop), new Vector2(sU(side, 0), hTop)]);
    put(f, new ExtrudeGeometry(board, { depth: 0.03, bevelEnabled: false }).translate(0, 0, v0 - 0.03), wood);
    for (let h = 0.3; h < hTop - 0.1; h += 0.3) {
      const a = foot - ((foot - top) * h) / hTop;
      sb(f, side, wood, a - 0.07, a, h - 0.02, h + 0.02, v0, v1);
    }
    sSolid(f, side, 0, foot, 0, DECK_HI, v0, v1);
  };
  const room = (r: Rect, turned: boolean, seed: number): void => {
    const f = roomFrame(r, turned);
    floor(f, roomFloor, [U0, V0, U1, V1], 0.9);
    ceiling(f, ceilingPaint, [U0, V0, U1, V1]);
    // Both sides alike (使用者：衣櫃對面是衣櫃、書桌對面是書桌；書桌與衣櫃對調；樓梯一邊直接接書桌、一邊直接接衣櫃):
    // desks under the window-end loft, the cabinet-and-ladder, wardrobes under the door-end loft, then a bookcase on one side
    // and a tiled mirror niche on the other at the door.
    for (const side of [-1, 1] as const) {
      const k = side < 0 ? 0 : 3;
      loft(f, side, V0, LADDER[0], true, seed + k);
      desks(f, side, V0, LADDER[0], seed + k + 2);
      ladder(f, side);
      loft(f, side, LADDER[1], V1, false, seed + k + 1);
      wardrobes(f, side, LADDER[1], V1, side < 0 ? 'mirror' : 'shelf');
    }
    // Under the window (使用者：窗下 4 個櫃子、左右同樣木頭延伸到書桌下方；不要凸出，做材質就好、全部跟牆壁貼平): only a
    // wood finish on the wall face, four cabinet doors drawn under the window, the same wood on under both desks.
    const wu0 = U0 + DECK + 0.15, wu1 = U1 - DECK - 0.15;
    // Two window bands across the end wall (使用者照片): one over the desks running from desk to desk, one over the bed
    // heads running wall to wall; blinds in both.
    windowV(f, V0, 1, U0 + 0.4, U1 - 0.4, 0.82, 1.6, { blinds: 0.7 });
    windowV(f, V0, 1, U0 + 0.08, U1 - 0.08, 2.02, 2.52, { blinds: 0.85 });
    faceV(f, wood, V0 + 0.004, 1, U0, U1, 0, 0.7, 1);
    box(f, plaster, U0 + 0.4, U1 - 0.4, 0.7, 0.76, V0, V0 + 0.06); // sill ledge
    const d0 = wu0 - 0.05, d1 = wu1 + 0.05, dw = (d1 - d0) / 4;
    for (let i = 0; i <= 4; i++) { const u = d0 + dw * i; faceV(f, woodDark, V0 + 0.006, 1, u - 0.005, u + 0.005, 0.05, 0.62); }
    faceV(f, woodDark, V0 + 0.006, 1, d0, d1, 0.62, 0.63);
    const ac0 = (U0 + U1) / 2 - 0.45;
    box(f, white, ac0, ac0 + 0.9, 2.6, CEIL - 0.04, V0, V0 + 0.22);
    box(f, panelDark, ac0 + 0.05, ac0 + 0.85, 2.62, 2.66, V0 + 0.2, V0 + 0.225);
    // Ceiling lights, wiring trunk along the west wall, light switch by the door.
    ceilingPanel(f, RW / 2, RD * 0.32, 0.6, 0.6);
    ceilingPanel(f, RW / 2, RD * 0.7, 0.6, 0.6);
    box(f, white, U0, U0 + 0.08, 2.84, 2.92, V0, V1);
    box(f, white, U1 - 0.08, U1, 2.84, 2.92, V0, V1);
    // The door itself (使用者照片：粉紅色平板門): painted flat on both faces of the solid wall, a thin dark edge, a round knob.
    const [dq0, dq1] = DORM_C_ROOM_DOOR, dqTop = 2.4 - LIFT;
    for (const [at, dir] of [[V1 - 0.003, -1], [RD + WALL + 0.003, 1]] as const) {
      faceV(f, doorEdge, at, dir, dq0 - 0.03, dq1 + 0.03, 0, dqTop + 0.03);
      faceV(f, doorPink, at + dir * 0.002, dir, dq0, dq1, 0, dqTop);
      const kv = at + dir * 0.03;
      put(f, new CylinderGeometry(0.028, 0.028, 0.05, 12).rotateX(Math.PI / 2).translate(dir < 0 ? dq1 - 0.1 : dq0 + 0.1, 0.98, kv), steel);
    }
    // Over the door (使用者照片): a dark louvred vent with a white exhaust fan in it; a wall lamp and the switches beside it.
    const [dr0, dr1] = DORM_C_ROOM_DOOR, dTop = 2.4 - LIFT;
    faceV(f, black, V1 - 0.004, -1, dr0, dr1, dTop + 0.02, CEIL - 0.04);
    for (let h = dTop + 0.06; h < CEIL - 0.06; h += 0.05) box(f, panelDark, dr0 + 0.02, dr1 - 0.02, h, h + 0.012, V1 - 0.02, V1 - 0.005);
    const fc = (dr0 + dr1) / 2 + 0.05, fh = (dTop + CEIL) / 2;
    box(f, white, fc - 0.2, fc + 0.2, fh - 0.2, fh + 0.2, V1 - 0.09, V1 - 0.01);
    put(f, new CylinderGeometry(0.16, 0.16, 0.01, 20).rotateX(Math.PI / 2).translate(fc, fh, V1 - 0.095), black);
    put(f, new CylinderGeometry(0.04, 0.04, 0.02, 12).rotateX(Math.PI / 2).translate(fc, fh, V1 - 0.1), white);
    box(f, light, dr0 - 0.32, dr0 - 0.2, 2.0, 2.18, V1 - 0.1, V1 - 0.01);
    box(f, white, dr0 - 0.2, dr0 - 0.12, 1.15, 1.27, V1 - 0.02, V1);
    const sw = DORM_C_ROOM_DOOR[1] + 0.2;
    box(f, white, sw, sw + 0.08, 1.15, 1.27, V1 - 0.02, V1);
  };
  room(R.room2, false, 11);
  room(R.room3, false, 21);
  room(R.room4, false, 31);
  room(R.room1, true, 41);

  // --- 浴室 ---------------------------------------------------------------------------------------
  {
    const f = PLAN, [x0, y0, x1, y1] = R.bath;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    const door: [number, number] = [8.7, 9.6];
    floor(f, bathFloor, [X0, Y0, X1, Y1], 1);
    // White tiles floor to ceiling on every wall; grey grid ceiling.
    faceU(f, wallTile, X0 + 0.004, 1, Y0, Y1, 0, CEIL, 1);
    faceU(f, wallTile, X1 - 0.004, -1, Y0, Y1, 0, CEIL, 1);
    faceV(f, wallTile, Y0 + 0.004, 1, X0, X1, 0, CEIL, 1);
    faceV(f, wallTile, Y1 - 0.004, -1, X0, door[0], 0, CEIL, 1);
    faceV(f, wallTile, Y1 - 0.004, -1, door[1], X1, 0, CEIL, 1);
    faceV(f, wallTile, Y1 - 0.004, -1, door[0], door[1], 2.4 - LIFT, CEIL, 1);
    ceiling(f, ceilingGrid, [X0, Y0, X1, Y1], 0.6);
    ceilingPanel(f, (X0 + X1) / 2 + 0.3, 2.6, 0.6, 1.2);
    ceilingPanel(f, (X0 + X1) / 2 + 0.3, 5.6, 0.6, 1.2);
    // High windows in the north wall over the stalls, a dark louvred vent high on the west wall over the urinals.
    windowV(f, Y0, 1, X0 + 0.25, X1 - 0.25, 2.3, 2.82, { mullions: 3 });
    for (let h = 2.2; h < 2.78; h += 0.07) box(f, black, X0, X0 + 0.07, h, h + 0.035, 6.0, 7.3);
    box(f, alu, X0, X0 + 0.09, 2.15, 2.2, 5.95, 7.35);
    box(f, alu, X0, X0 + 0.09, 2.78, 2.83, 5.95, 7.35);
    // A row of four tiled stalls along the west wall, beige doors (one ajar), squat pans.
    const SF = X0 + 1.45, stallY = [Y0, 1.45, 2.8, 4.15, 5.5], SH = 2.1;
    for (const y of stallY.slice(1)) box(f, wallTile, X0, SF, 0, SH, y - 0.05, y + 0.05, 1);
    box(f, wallTile, X0, SF, SH, SH + 0.03, stallY[4]! - 0.06, stallY[4]! + 0.06, 1);
    for (let i = 0; i < 4; i++) {
      const a = stallY[i]! + (i === 0 ? 0 : 0.05), b = stallY[i + 1]! - 0.05;
      box(f, wallTile, SF - 0.1, SF, 0, SH, a, a + 0.12, 1); // tiled piers
      const d0 = a + 0.14, d1 = b - 0.02, hinge = d0;
      const leaf = tbox(-0.015, 0.015, 0.12, 1.95, 0, d1 - d0);
      const vent = tbox(-0.018, 0.018, 0.25, 0.55, 0.12, d1 - d0 - 0.12);
      const turn = i === 1 ? -0.6 : 0;
      for (const [g, m] of [[leaf, beige], [vent, beigeDark]] as const) put(f, g.rotateY(turn).translate(SF - 0.05, 0, hinge), m);
      box(f, steel, SF - 0.02, SF + 0.01, 1.0, 1.04, d1 - 0.12, d1 - 0.06);
      const cy = (a + b) / 2, cx = X0 + 0.65;
      box(f, porcelain, cx - 0.2, cx + 0.32, 0, 0.06, cy - 0.17, cy + 0.17);
      box(f, basinIn, cx - 0.12, cx + 0.22, 0.06, 0.065, cy - 0.11, cy + 0.11);
      box(f, white, X0, X0 + 0.16, 1.55, 1.9, cy - 0.22, cy + 0.22);
      tube(f, steel, [X0 + 0.08, 0.1, cy], [X0 + 0.08, 1.55, cy], 0.015);
    }
    solid(f, X0, SF, 0, SH, Y0, stallY[4]! + 0.05);
    // Urinals with beige screens and orange flush valves, by the door.
    for (const y of [6.3, 7.1]) {
      box(f, porcelain, X0, X0 + 0.34, 0.42, 1.1, y - 0.19, y + 0.19);
      box(f, basinIn, X0 + 0.22, X0 + 0.345, 0.55, 0.95, y - 0.13, y + 0.13);
      box(f, flush, X0, X0 + 0.14, 1.22, 1.42, y - 0.08, y + 0.08);
      tube(f, steel, [X0 + 0.07, 1.1, y], [X0 + 0.07, 1.22, y], 0.015);
      solid(f, X0, X0 + 0.34, 0, 1.1, y - 0.19, y + 0.19);
    }
    for (const y of [5.9, 6.7, 7.5]) {
      box(f, beige, X0, X0 + 0.6, 0.3, 1.55, y - 0.02, y + 0.02);
      solid(f, X0, X0 + 0.6, 0, 1.55, y - 0.02, y + 0.02);
    }
    // Two wash basins on brackets, a long mirror over them (east wall).
    for (const y of [3.9, 4.8]) {
      box(f, porcelain, X1 - 0.46, X1, 0.72, 0.86, y - 0.28, y + 0.28);
      box(f, basinIn, X1 - 0.4, X1 - 0.12, 0.855, 0.865, y - 0.2, y + 0.2);
      box(f, steel, X1 - 0.1, X1 - 0.04, 0.86, 1.0, y - 0.02, y + 0.02);
      box(f, steel, X1 - 0.2, X1 - 0.04, 0.96, 1.0, y - 0.02, y + 0.02);
      tube(f, steel, [X1 - 0.2, 0.25, y], [X1 - 0.2, 0.72, y], 0.02);
      solid(f, X1 - 0.46, X1, 0, 0.86, y - 0.28, y + 0.28);
    }
    faceU(f, mirror, X1 - 0.008, -1, 3.45, 5.25, 1.2, 2.0);
    box(f, alu, X1 - 0.02, X1, 1.17, 1.2, 3.42, 5.28);
  }

  // --- 曬衣間 -------------------------------------------------------------------------------------
  {
    const f = PLAN, [x0, y0, x1, y1] = R.cloth;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    floor(f, clothFloor, [X0, Y0, X1, Y1], 0.9);
    ceiling(f, ceilingPaint, [x0 - WALL, Y0, X1, y1 + WALL]);
    floor(f, clothFloor, [x0 - WALL, y0 + 0.2, X0, y1 - 0.3], 0.9); // sill under the west opening
    floor(f, clothFloor, [x0 + 0.3, Y1, x1 - 0.3, y1 + WALL], 0.9);
    // White tile dado on the inner walls (north: around the store-room door; east).
    faceV(f, smallTile, Y0 + 0.004, 1, X0, 7.4, 0, 1.1, 1);
    faceV(f, smallTile, Y0 + 0.004, 1, 8.4, X1, 0, 1.1, 1);
    faceU(f, smallTile, X1 - 0.004, -1, Y0, Y1, 0, 1.1, 1);
    // North wall: two windows with security grilles, a strip of high windows above.
    windowV(f, Y0, 1, 1.6, 2.9, 1.15, 2.05, { grille: true });
    windowV(f, Y0, 1, 3.7, 5.0, 1.15, 2.05, { grille: true });
    windowV(f, Y0, 1, 0.5, 6.0, 2.4, 2.85, { mullions: 4 });
    // East wall (to room 1): a dark window.
    windowU(X1, -1, 14.0, 15.6, 1.15, 2.05, { dark: true });
    // Washing machines in front of the north wall.
    for (const c of [2.25, 4.35, 6.25]) {
      box(f, washer, c - 0.3, c + 0.3, 0, 0.92, Y0 + 0.02, Y0 + 0.64);
      box(f, panelDark, c - 0.26, c + 0.26, 0.92, 0.935, Y0 + 0.18, Y0 + 0.6);
      box(f, washer, c - 0.3, c + 0.3, 0.92, 1.1, Y0 + 0.02, Y0 + 0.16);
      box(f, panelDark, c - 0.2, c + 0.2, 0.97, 1.06, Y0 + 0.16, Y0 + 0.17);
      solid(f, c - 0.3, c + 0.3, 0, 1.1, Y0 + 0.02, Y0 + 0.64);
    }
    // West end open to the air: tiled parapet with a long sink counter in front, a column halfway, a beam over it.
    box(f, smallTile, x0 - WALL, x0 + WALL, 0, 1.25, y0 + 0.2, y1 - 0.3, 1);
    box(f, plaster, x0 - WALL, x0 + WALL, 2.62, CEIL, y0 + 0.2, y1 - 0.3);
    box(f, plaster, x0 - WALL, x0 + WALL, 0, CEIL, 15.3, 15.65);
    box(f, smallTile, X0, X0 + 0.62, 0.62, 0.84, 12.6, 18.2, 1);
    box(f, panelDark, X0 + 0.08, X0 + 0.54, 0.84, 0.845, 12.7, 18.1);
    for (const y of [13.2, 14.6, 16.2, 17.6]) {
      box(f, steel, X0, X0 + 0.16, 1.0, 1.04, y - 0.015, y + 0.015);
      box(f, steel, X0, X0 + 0.04, 0.96, 1.08, y - 0.02, y + 0.02);
    }
    for (const y of [12.7, 15.4, 18.1]) box(f, plaster, X0, X0 + 0.55, 0, 0.62, y - 0.05, y + 0.05);
    solid(f, x0 - WALL, X0 + 0.62, 0, 0.84, y0 + 0.2, y1 - 0.3);
    solid(f, x0 - WALL, x0 + WALL, 0, CEIL, y0 + 0.2, y1 - 0.3); // can't climb out
    // South side: low tiled wall, red breeze-block screen up to a beam.
    const sx0 = x0 + 0.3, sx1 = x1 - 0.3, sh0 = 0.95, sh1 = 2.68;
    box(f, smallTile, sx0, sx1, 0, sh0, y1 - WALL, y1 + WALL, 1);
    box(f, plaster, sx0, sx1, sh1, CEIL, y1 - WALL, y1 + WALL);
    for (const dz of [-0.03, 0.03]) put(f, tplane(sx1 - sx0, sh1 - sh0, 0.3).translate((sx0 + sx1) / 2, (sh0 + sh1) / 2, y1 + dz), lattice);
    solid(f, sx0, sx1, 0, CEIL, y1 - WALL, y1 + WALL);
    // Outside: the campus seen past the balcony (west and south).
    put(f, tplane(9.5, 7.5).rotateY(Math.PI / 2).translate(x0 - 2.2, 1.2, (y0 + y1) / 2), view);
    put(f, tplane(13, 7.5).rotateY(Math.PI).translate((x0 + x1) / 2, 1.2, y1 + 2.2), view);
    // Navy steel drying frame under the ceiling, two stainless racks.
    for (const y of [13.6, 15.4, 17.2]) box(f, navy, 0.4, 9.4, 2.6, 2.66, y - 0.03, y + 0.03);
    for (const x of [0.5, 4.9, 9.3]) {
      box(f, navy, x - 0.03, x + 0.03, 2.66, 2.72, 13.4, 17.4);
      for (const y of [13.6, 17.2]) box(f, navy, x - 0.01, x + 0.01, 2.72, CEIL, y - 0.01, y + 0.01);
    }
    for (const [ra, rb] of [[2.3, 4.4], [5.6, 7.7]] as const) {
      const ry = 15.9;
      for (const h of [0.95, 1.55]) for (const dy of [-0.28, 0.28]) tube(f, steel, [ra, h, ry + dy], [rb, h, ry + dy], 0.012);
      for (const x of [ra, rb]) {
        tube(f, steel, [x, 0, ry - 0.45], [x, 1.55, ry + 0.28], 0.013);
        tube(f, steel, [x, 0, ry + 0.45], [x, 1.55, ry - 0.28], 0.013);
      }
    }
  }

  // --- 雜物間 -------------------------------------------------------------------------------------
  {
    const f = PLAN, [x0, y0, x1, y1] = R.other;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    floor(f, clothFloor, [X0, Y0, X1, Y1], 0.9);
    ceiling(f, ceilingPaint, [X0, Y0, X1, Y1]);
    // Steel shelving with boxes, a tiled mop sink, a bucket.
    for (const y of [8.4, 10.6]) for (const x of [X0 + 0.02, X0 + 0.43]) box(f, steel, x, x + 0.03, 0, 1.8, y, y + 0.03);
    const r = rng(77);
    for (const h of [0.15, 0.6, 1.05, 1.5]) {
      box(f, steel, X0, X0 + 0.48, h, h + 0.02, 8.4, 10.63);
      for (let y = 8.5; y < 10.4; y += 0.5) if (r() < 0.75) box(f, r() < 0.5 ? beige : pillow, X0 + 0.05, X0 + 0.42, h + 0.02, h + 0.2 + r() * 0.15, y, y + 0.38);
    }
    solid(f, X0, X0 + 0.48, 0, 1.8, 8.4, 10.63);
    box(f, smallTile, X0, X0 + 0.6, 0, 0.42, Y1 - 0.7, Y1, 1);
    box(f, panelDark, X0 + 0.06, X0 + 0.54, 0.42, 0.425, Y1 - 0.64, Y1 - 0.06);
    box(f, steel, X0, X0 + 0.14, 0.75, 0.79, Y1 - 0.37, Y1 - 0.33);
    solid(f, X0, X0 + 0.6, 0, 0.42, Y1 - 0.7, Y1);
    put(f, new CylinderGeometry(0.15, 0.12, 0.3, 14).translate(X1 - 0.35, 0.15, Y1 - 0.4), blue);
    tube(f, woodDark, [X1 - 0.3, 0.05, Y1 - 0.15], [X1 - 0.12, 1.35, Y1 - 0.08], 0.012);
  }

  // --- 走廊 ---------------------------------------------------------------------------------------
  {
    const f = PLAN, [, cy0, cx1, cy1] = R.corridor;
    floor(f, roomFloor, [8.6 + WALL, cy0 + WALL, cx1 - WALL, cy1], 0.9);
    ceiling(f, ceilingPaint, [8.6 + WALL, cy0 + WALL, cx1 - WALL, cy1]);
    ceiling(f, ceilingPaint, [R.corridorNook[0] + WALL, cy1, R.corridorNook[2] - WALL, R.corridorNook[3] - WALL]);
    floor(f, roomFloor, [R.corridorNook[0] + WALL, cy1, R.corridorNook[2] - WALL, R.corridorNook[3] - WALL], 0.9);
    // Shoe racks against the north wall between the room doors.
    const r = rng(55);
    for (const [a, b] of [[12.6, 15.4], [16.8, 19.6]] as const) {
      box(f, wood, a, b, 0, 0.85, cy0 + WALL, cy0 + WALL + 0.34);
      for (const h of [0.28, 0.56]) box(f, woodDark, a + 0.02, b - 0.02, h, h + 0.015, cy0 + WALL + 0.33, cy0 + WALL + 0.345);
      for (let x = a + 0.1; x < b - 0.3; x += 0.32) if (r() < 0.6) {
        box(f, bookMats[Math.floor(r() * bookMats.length)]!, x, x + 0.11, 0.85, 0.93, cy0 + WALL + 0.06, cy0 + WALL + 0.3);
        box(f, bookMats[Math.floor(r() * bookMats.length)]!, x + 0.13, x + 0.24, 0.85, 0.93, cy0 + WALL + 0.06, cy0 + WALL + 0.3);
      }
      solid(f, a, b, 0, 0.93, cy0 + WALL, cy0 + WALL + 0.34);
    }
    for (const x of [10.6, 14.2, 17.8, 21.2]) ceilingPanel(f, x, (cy0 + cy1) / 2, 1.2, 0.3);
  }

  // --- 交誼廳 -------------------------------------------------------------------------------------
  {
    const f = PLAN, [x0, y0, x1, y1] = R.living;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y1 = y1 - WALL;
    floor(f, roomFloor, [X0, y0, X1, Y1], 0.9);
    ceiling(f, ceilingPaint, [X0, y0, X1, Y1]);
    windowV(f, Y1, -1, 15.0, 17.2, 0.95, 2.15, { blinds: 0.35 });
    windowV(f, Y1, -1, 18.3, 20.5, 0.95, 2.15, { blinds: 0.35 });
    ceilingPanel(f, 16.6, 14.0, 0.6, 0.6);
    ceilingPanel(f, 19.8, 14.0, 0.6, 0.6);
    // TV on a low cabinet (west wall), coffee table, three-seat sofa facing it.
    box(f, wood, X0, X0 + 0.45, 0, 0.5, 12.6, 14.8);
    solid(f, X0, X0 + 0.45, 0, 0.5, 12.6, 14.8);
    box(f, black, X0 + 0.15, X0 + 0.3, 0.5, 0.56, 13.5, 13.9);
    box(f, black, X0 + 0.2, X0 + 0.26, 0.6, 1.3, 12.95, 14.45);
    box(f, wood, 15.4, 16.4, 0.4, 0.45, 13.1, 14.3);
    for (const [x, y] of [[15.45, 13.15], [16.35, 13.15], [15.45, 14.25], [16.35, 14.25]] as const) box(f, woodDark, x - 0.025, x + 0.025, 0, 0.4, y - 0.025, y + 0.025);
    solid(f, 15.4, 16.4, 0, 0.45, 13.1, 14.3);
    box(f, fabric, 16.95, 17.8, 0.1, 0.42, 12.5, 14.9);
    box(f, fabric, 17.58, 17.8, 0.42, 0.88, 12.5, 14.9);
    for (const [a, b] of [[12.5, 12.68], [14.72, 14.9]] as const) box(f, fabric, 16.95, 17.58, 0.42, 0.62, a, b);
    for (let i = 0; i < 3; i++) box(f, mattress, 17.0, 17.56, 0.42, 0.5, 12.7 + i * 0.68, 13.36 + i * 0.68);
    solid(f, 16.95, 17.8, 0, 0.88, 12.5, 14.9);
    // Dining table with four stools.
    box(f, wood, 18.8, 20.0, 0.72, 0.76, 15.3, 16.5);
    for (const [x, y] of [[18.85, 15.35], [19.95, 15.35], [18.85, 16.45], [19.95, 16.45]] as const) box(f, steel, x - 0.02, x + 0.02, 0, 0.72, y - 0.02, y + 0.02);
    solid(f, 18.8, 20.0, 0, 0.76, 15.3, 16.5);
    for (const [x, y] of [[18.5, 15.9], [20.3, 15.9], [19.4, 15.0], [19.4, 16.8]] as const) {
      put(f, new CylinderGeometry(0.17, 0.17, 0.04, 14).translate(x, 0.45, y), blue);
      put(f, new CylinderGeometry(0.02, 0.02, 0.45, 6).translate(x, 0.225, y), steel);
    }
    // Shoe cabinet by the front door, water dispenser.
    box(f, wood, X1 - 0.38, X1, 0, 1.0, 10.9, 12.35);
    box(f, woodDark, X1 - 0.385, X1 - 0.38, 0.05, 0.95, 11.62, 11.63);
    solid(f, X1 - 0.38, X1, 0, 1.0, 10.9, 12.35);
    box(f, white, X1 - 0.34, X1, 0, 1.05, 15.8, 16.15);
    box(f, panelDark, X1 - 0.345, X1 - 0.34, 0.75, 0.95, 15.85, 16.1);
    put(f, new CylinderGeometry(0.13, 0.13, 0.4, 14).translate(X1 - 0.17, 1.25, 15.975), blue);
    solid(f, X1 - 0.34, X1, 0, 1.45, 15.8, 16.15);
  }

  for (const [m, list] of parts) {
    const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of list) g.dispose();
    if (!geo) continue;
    const mesh = new Mesh(tracker.geometry(geo), m);
    const flat = m === view || m === light || m === lattice || m === blinds;
    mesh.castShadow = !flat;
    mesh.receiveShadow = m !== view && m !== light;
    root.add(mesh);
  }
  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
