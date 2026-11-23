import {
  BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3, ExtrudeGeometry, Shape, Vector2, type BufferGeometry, type Material, type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import { createPlanTransform } from './planTransform';
import { DORM_C_BATH, DORM_C_BATH_CURTAIN, DORM_C_WORK_WINDOW, DORM_C_ROOM_DOOR, DORM_C_ROOMS, DORM_C_ROOMS_FLOOR, DORM_C_UNIT_FLOOR, DORM_C_UNIT_PLAN as R, type DormCUnit } from './dormCUnit';
import { DORM_C_BALCONY } from '../campus/customFacades';

/**
 * Everything inside the 學生宿舍C flat (dormCUnit.ts gives only walls, doors, floor and ceiling), modelled from the user's
 * photos (2026-11-23):
 *  - 寢室（四間一樣）：兩側各兩座柚木色上床下桌，兩側對稱——靠窗那座床架下是書桌＋格子書架＋抽屜（書桌對書桌），靠門那座是
 *    雙門衣櫃（衣櫃對衣櫃），門邊一側開放書櫃、一側磁磚牆加鏡子；中間一座層架櫃，前面木梯一邊用斜木板接書桌、一邊直接靠衣櫃；床邊金屬圓弧護欄；窗在走道盡頭（百葉窗、下方矮櫃、上方冷氣）；米色地磚、方形日光燈、牆上線槽；
 *  - 浴室：全白方磁磚牆、灰色輕鋼架天花板＋日光燈、一排磁磚隔間的廁所（米色門）、兩個小便斗（米色隔板、橘色沖水器）、
 *    兩個洗手台與大鏡子、高處百葉通風窗與高窗；
 *  - 曬衣間：就是 2 樓正面的花磚陽台（dormCFacade.ts 畫的），這裡只補站得住的地板與碰撞，雜物間南牆一個門洞走出去；
 *  - 雜物間、走廊鞋櫃、交誼廳（沙發、茶几、電視、餐桌、鞋櫃、飲水機、窗）。
 * Plan coordinates (x, height above the flat's floor, plan y) — a room's furniture in room coordinates (u across from its
 * west wall, v from its window wall), turned into plan by the room's frame. Solid where you'd bump into it.
 */
export interface DormCUnitDecor { dispose(): void }

type Rect = readonly [number, number, number, number];
/** Room coordinates → plan: a translation, turned 180° for room 1. */
/** `dy`: the frame's floor below the flat's (the bedrooms are a building of their own, underground). */
interface Frame { m: Matrix4; toPlan(u: number, v: number): [number, number]; dy?: number }
const PLAN: Frame = { m: new Matrix4(), toPlan: (u, v) => [u, v] };
const roomFrame = (r: Rect, turned: boolean, dy = 0): Frame => turned
  ? { m: new Matrix4().makeTranslation(r[2], dy, r[3]).multiply(new Matrix4().makeRotationY(Math.PI)), toPlan: (u, v) => [r[2] - u, r[3] - v], dy }
  : { m: new Matrix4().makeTranslation(r[0], dy, r[1]), toPlan: (u, v) => [r[0] + u, r[1] + v], dy };

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

export function createDormCUnitDecor(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, unit: DormCUnit): DormCUnitDecor {
  const { source: src, balcony, clothOpen, clothDoor, roomDoors } = unit;
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
  const plaster = std(0xeeebe4, { roughness: 0.9 });
  const alu = std(0x3c3d3e, { metalness: 0.5, roughness: 0.45 });
  const steel = std(0xc4c8cc, { metalness: 0.7, roughness: 0.35 });
  const railMat = std(0xa9adb2, { metalness: 0.8, roughness: 0.3, side: DoubleSide });
  const porcelain = std(0xf7f7f4, { roughness: 0.15 });
  const basinIn = std(0xdcdcd6, { roughness: 0.2 });
  const beige = std(0xcdb894, { roughness: 0.55 }); // stall doors, urinal screens
  const beigeDark = std(0x9c8a6a, { roughness: 0.6 });
  const flush = std(0xd39a3e, { roughness: 0.5 });
  const mirror = std(0xc6d2d8, { metalness: 0.15, roughness: 0.08 });
  const darkGlass = std(0x27323a, { metalness: 0.6, roughness: 0.15 });
  const light = tracker.material(new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfdfcf4, emissiveIntensity: 1.1 }));
  const white = std(0xf2f2ee, { roughness: 0.4 });
  const panelDark = std(0x5f6368, { roughness: 0.5 });
  const mattress = std(0x5b7392, { roughness: 0.9 });
  const pillow = std(0xeeeae0, { roughness: 0.9 });
  const chairSeat = std(0x6a6d70, { roughness: 0.6 });
  const fabric = std(0x5a6a7c, { roughness: 0.95 });
  const black = std(0x1d1e20, { roughness: 0.4 });
  const doorPink = std(0xeab4aa, { roughness: 0.55 });
  const doorEdge = std(0x3a3332, { roughness: 0.6 });
  const curtainBlack = std(0x151517, { roughness: 1 });
  const frameBrown = std(0x2e241e, { roughness: 0.6 });
  const doorWood = std(0xc9a46a, { roughness: 0.6 });
  const washerGrey = std(0xc9c8c0, { roughness: 0.5 });
  const clearGlass = tracker.material(new MeshStandardMaterial({ color: 0xb8cfd8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }));
  const brownDoor = std(0x9a5a2e, { roughness: 0.6 });
  const washer2 = std(0xd9d6cb, { roughness: 0.45 });
  const navyRail = std(0x2b3650, { metalness: 0.5, roughness: 0.5 });
  const darkFloor = std(0xffffff, { map: tiles(3, [74, 62, 54], '#2f2823', 6, 8), roughness: 0.55 });
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
      .setTranslation(wx, DORM_C_UNIT_FLOOR + LIFT + (f.dy ?? 0) + (h0 + h1) / 2, wz).setRotation(q)));
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
  /**
   * A black curtain hung in a doorway on the wall face at v = `at`, centred at u = `cu`, the room on the `dir` side
   * (使用者：黑幕對黑幕按 E 傳送): a dark frame, the cloth in soft vertical folds, a rail on top.
   */
  const curtain = (f: Frame, cu: number, at: number, dir: 1 | -1, w = 1.05): void => {
    const top = 2.45, u0 = cu - w / 2, u1 = cu + w / 2;
    faceV(f, doorEdge, at, dir, u0 - 0.06, u1 + 0.06, 0, top + 0.08);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = u0 + (w * i) / n, b = a + w / n, bulge = (i % 2 ? 0.035 : 0.012) * dir;
      box(f, curtainBlack, a, b, 0.02, top, Math.min(at + bulge, at + dir * 0.005), Math.max(at + bulge, at + dir * 0.005));
    }
    box(f, steel, u0 - 0.08, u1 + 0.08, top + 0.02, top + 0.06, Math.min(at, at + dir * 0.06), Math.max(at, at + dir * 0.06));
  };

  // --- 寢室 × 4 ----------------------------------------------------------------------------------
  const room0 = DORM_C_ROOMS[0]!, RW = room0[2] - room0[0], RD = room0[3] - room0[1];
  const U0 = WALL, U1 = RW - WALL, V0 = WALL, V1 = RD - WALL;
  const DECK = 1.15, DECK_LO = 1.72, DECK_HI = 1.86, RAIL = 2.32, ARC = 0.36;
  const LADDER: [number, number] = [RD / 2 - 0.4, RD / 2 + 0.4]; // the cabinet-and-ladder in the middle of each side
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
    const f = roomFrame(r, turned, DORM_C_ROOMS_FLOOR - DORM_C_UNIT_FLOOR);
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
    for (const [at, dir] of [[V1 - 0.003, -1]] as const) {
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
  DORM_C_ROOMS.forEach((q, k) => room(q, false, 11 + 10 * k));
  // The same pink doors on the flat's walls (the bedrooms behind them are reached with E), and the bath's black curtain.
  for (const d of roomDoors) {
    if (d.curtain) {
      if (d.out[1] !== 0) {
        const dir = d.out[1] > 0 ? 1 : -1;
        curtain(PLAN, d.at[0], d.at[1] + dir * (WALL + 0.01), dir);
      } else {
        // On a wall across x: turn a quarter so the curtain helper's v axis runs along plan x.
        const f: Frame = { m: new Matrix4().makeRotationY(Math.PI / 2), toPlan: (u, v) => [v, -u] };
        curtain(f, -d.at[1], d.at[0] + d.out[0] * (WALL + 0.01), d.out[0] > 0 ? 1 : -1);
      }
      continue;
    }
    const dir = d.out[1] > 0 ? 1 : -1, at = d.at[1] + dir * (WALL + 0.003), u0 = d.at[0] - 0.5, u1 = d.at[0] + 0.5, top = 2.4 - LIFT;
    faceV(PLAN, doorEdge, at, dir, u0 - 0.03, u1 + 0.03, 0, top + 0.03);
    faceV(PLAN, doorPink, at + dir * 0.002, dir, u0, u1, 0, top);
    put(PLAN, new CylinderGeometry(0.028, 0.028, 0.05, 12).rotateX(Math.PI / 2).translate(dir > 0 ? u0 + 0.1 : u1 - 0.1, 0.98, at + dir * 0.03), steel);
    // A small number plate over the door.
    faceV(PLAN, black, at + dir * 0.004, dir, d.at[0] - 0.18, d.at[0] + 0.18, top + 0.12, top + 0.3);
  }


  // --- 浴室（地底，跟寢室同一棟；入口是一片黑幕） ------------------------------------------------
  {
    const dyB = DORM_C_ROOMS_FLOOR - DORM_C_UNIT_FLOOR;
    const f: Frame = { m: new Matrix4().makeTranslation(0, dyB, 0), toPlan: (u, v) => [u, v], dy: dyB };
    const [x0, y0, x1, y1] = DORM_C_BATH;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    floor(f, bathFloor, [X0, Y0, X1, Y1], 1);
    // White tiles floor to ceiling on every wall; grey grid ceiling.
    faceU(f, wallTile, X0 + 0.004, 1, Y0, Y1, 0, CEIL, 1);
    faceU(f, wallTile, X1 - 0.004, -1, Y0, Y1, 0, CEIL, 1);
    faceV(f, wallTile, Y0 + 0.004, 1, X0, X1, 0, CEIL, 1);
    faceV(f, wallTile, Y1 - 0.004, -1, X0, X1, 0, CEIL, 1);
    curtain(f, DORM_C_BATH_CURTAIN, Y1 - 0.01, -1);
    ceiling(f, ceilingGrid, [X0, Y0, X1, Y1], 0.6);
    ceilingPanel(f, (X0 + X1) / 2 + 0.3, Y0 + 1.4, 0.6, 1.2);
    ceilingPanel(f, (X0 + X1) / 2 + 0.3, Y1 - 1.4, 0.6, 1.2);
    // High windows in the back wall.
    windowV(f, Y0, 1, X0 + 0.2, X1 - 0.2, 2.3, 2.82, { mullions: 2 });
    // A row of three tiled stalls along the west wall, beige doors (one ajar), squat pans.
    const SF = X0 + 1.3, SW = 1.1, stallY = [Y0, Y0 + SW, Y0 + 2 * SW, Y0 + 3 * SW], SH = 2.1, end = stallY[3]!;
    for (const y of stallY.slice(1)) box(f, wallTile, X0, SF, 0, SH, y - 0.05, y + 0.05, 1);
    box(f, wallTile, X0, SF, SH, SH + 0.03, end - 0.06, end + 0.06, 1);
    for (let i = 0; i < 3; i++) {
      const a = stallY[i]! + (i === 0 ? 0 : 0.05), b = stallY[i + 1]! - 0.05;
      box(f, wallTile, SF - 0.1, SF, 0, SH, a, a + 0.12, 1); // tiled piers
      const d0 = a + 0.14, d1 = b - 0.02, hinge = d0;
      const leaf = tbox(-0.015, 0.015, 0.12, 1.95, 0, d1 - d0);
      const vent = tbox(-0.018, 0.018, 0.25, 0.55, 0.12, d1 - d0 - 0.12);
      const turn = i === 1 ? -0.6 : 0;
      for (const [g, m] of [[leaf, beige], [vent, beigeDark]] as const) put(f, g.rotateY(turn).translate(SF - 0.05, 0, hinge), m);
      box(f, steel, SF - 0.02, SF + 0.01, 1.0, 1.04, d1 - 0.12, d1 - 0.06);
      const cy = (a + b) / 2, cx = X0 + 0.6;
      box(f, porcelain, cx - 0.2, cx + 0.32, 0, 0.06, cy - 0.17, cy + 0.17);
      box(f, basinIn, cx - 0.12, cx + 0.22, 0.06, 0.065, cy - 0.11, cy + 0.11);
      box(f, white, X0, X0 + 0.16, 1.55, 1.9, cy - 0.22, cy + 0.22);
      tube(f, steel, [X0 + 0.08, 0.1, cy], [X0 + 0.08, 1.55, cy], 0.015);
    }
    solid(f, X0, SF, 0, SH, Y0, end + 0.05);
    // East wall: two wash basins under a long mirror at the far end, two urinals (beige screens, orange flush valves) by the door.
    for (const y of [Y0 + 0.6, Y0 + 1.45]) {
      box(f, porcelain, X1 - 0.46, X1, 0.72, 0.86, y - 0.28, y + 0.28);
      box(f, basinIn, X1 - 0.4, X1 - 0.12, 0.855, 0.865, y - 0.2, y + 0.2);
      box(f, steel, X1 - 0.1, X1 - 0.04, 0.86, 1.0, y - 0.02, y + 0.02);
      box(f, steel, X1 - 0.2, X1 - 0.04, 0.96, 1.0, y - 0.02, y + 0.02);
      tube(f, steel, [X1 - 0.2, 0.25, y], [X1 - 0.2, 0.72, y], 0.02);
      solid(f, X1 - 0.46, X1, 0, 0.86, y - 0.28, y + 0.28);
    }
    faceU(f, mirror, X1 - 0.008, -1, Y0 + 0.2, Y0 + 1.85, 1.2, 2.0);
    box(f, alu, X1 - 0.02, X1, 1.17, 1.2, Y0 + 0.17, Y0 + 1.88);
    for (const y of [Y0 + 2.35, Y0 + 3.0]) {
      box(f, porcelain, X1 - 0.34, X1, 0.42, 1.1, y - 0.19, y + 0.19);
      box(f, basinIn, X1 - 0.345, X1 - 0.22, 0.55, 0.95, y - 0.13, y + 0.13);
      box(f, flush, X1 - 0.14, X1, 1.22, 1.42, y - 0.08, y + 0.08);
      tube(f, steel, [X1 - 0.07, 1.1, y], [X1 - 0.07, 1.22, y], 0.015);
      solid(f, X1 - 0.34, X1, 0, 1.1, y - 0.19, y + 0.19);
    }
    for (const y of [Y0 + 2.03, Y0 + 2.68, Y0 + 3.33]) {
      box(f, beige, X1 - 0.55, X1, 0.3, 1.55, y - 0.02, y + 0.02);
      solid(f, X1 - 0.55, X1, 0, 1.55, y - 0.02, y + 0.02);
    }
    // The louvred vent high on the east wall over the urinals.
    for (let h = 2.2; h < 2.78; h += 0.07) box(f, black, X1 - 0.07, X1, h, h + 0.035, Y0 + 2.0, Y0 + 3.4);
  }

  // --- 2 樓正面的花磚陽台（曬衣間的前段） ---------------------------------------------------------
  // The facade module draws the balcony itself (dormCFacade laundryRoom, no back wall on this floor); here only what you
  // stand on and bump into: its floor, the parapet and screen, the end walls, and the step from the laundry room.
  {
    const f = PLAN, [bx0, by0, bx1, by1] = balcony, top = DORM_C_BALCONY.height;
    const fl = -LIFT + 0.02; // the balcony's tiled floor (2 cm over the storey line)
    solid(f, bx0, bx1, fl - 0.3, fl, by0, by1 + 0.2);
    solid(f, bx0, bx1, fl, top, by1, by1 + 0.2);
    solid(f, bx0 - 0.25, bx0, fl, top, by0, by1 + 0.2);
    solid(f, bx1, bx1 + 0.25, fl, top, by0, by1 + 0.2);
    floor(f, clothFloor, [clothOpen[0], R.cloth[3] - WALL, clothOpen[1], by0 + 0.02], 0.9);
  }

  // --- 曬衣間（草圖 cloth 的比例，照使用者照片布置） -------------------------------------------------
  // The balcony's lattice, parapet, floor and racks come from the facade; the rest from the photos: tiled sinks with four
  // taps along both end walls, and the back wall — a brown door near each end (the east one the open doorway into the work
  // room, the west one shut), a low white partition beside each, washing machines (one on a stand), the lower windows
  // (the east one is the work room's real window) and dark upper ones; navy drying rails. As wide as the balcony.
  {
    const f = PLAN, [cx0, cy0, cx1, cy1] = R.cloth, [, by0] = balcony;
    const X0 = cx0 + WALL, X1 = cx1 - WALL, Yb = cy0 + WALL, Yf = cy1 - WALL, mid = (X0 + X1) / 2;
    floor(f, clothFloor, [X0, Yb, X1, cy1], 0.9);
    ceiling(f, ceilingPaint, [X0, Yb, X1, cy1]);
    for (const x of [6.2, 10.2]) ceilingPanel(f, x, (Yb + cy1) / 2, 1.2, 0.3);
    const top = 2.4 - LIFT;
    // End walls: white tiles to 1.3 m, a tiled sink the whole depth with four taps.
    for (const side of [-1, 1] as const) {
      const e = side < 0 ? X0 : X1, at = (d: number): number => e - side * d;
      const sx = (d0: number, d1: number): [number, number] => [Math.min(at(d0), at(d1)), Math.max(at(d0), at(d1))];
      const end = side > 0 ? by0 : Yf; // the east end runs on into the balcony's end wall
      faceU(f, wallTile, at(0.004), side < 0 ? 1 : -1, Yb, end, 0, 1.3, 1);
      box(f, smallTile, ...sx(0.0, 0.62), 0.6, 0.84, Yb + 1.0, end - 0.1, 1);
      box(f, panelDark, ...sx(0.08, 0.54), 0.84, 0.845, Yb + 1.07, end - 0.17);
      solid(f, ...sx(0.0, 0.62), 0, 0.84, Yb + 1.0, end - 0.1);
      for (const y of [Yb + 1.25, end - 0.35]) box(f, steel, ...sx(0.25, 0.33), 0, 0.6, y - 0.04, y + 0.04);
      for (let k = 0; k < 4; k++) {
        const y = Yb + 1.4 + (k * (end - Yb - 1.9)) / 3;
        box(f, steel, ...sx(0.0, 0.15), 1.0, 1.04, y - 0.02, y + 0.02);
        box(f, steel, ...sx(0.11, 0.15), 0.94, 1.04, y - 0.02, y + 0.02);
      }
    }
    // Back wall: the doors (frames both; the west leaf shut, the east one swung open into the laundry).
    const [ed0, ed1] = clothDoor, wd0 = X0 + 0.7, wd1 = X0 + 1.6;
    for (const [d0, d1] of [[wd0, wd1], [ed0, ed1]] as const) {
      box(f, frameBrown, d0 - 0.06, d0, 0, top, Yb, Yb + 0.04);
      box(f, frameBrown, d1, d1 + 0.06, 0, top, Yb, Yb + 0.04);
      box(f, frameBrown, d0 - 0.06, d1 + 0.06, top, top + 0.06, Yb, Yb + 0.04);
    }
    box(f, brownDoor, wd0, wd1, 0.02, top - 0.04, Yb, Yb + 0.035);
    put(f, new CylinderGeometry(0.022, 0.022, 0.06, 10).rotateX(Math.PI / 2).translate(wd1 - 0.15, 0.98, Yb + 0.06), steel);
    box(f, brownDoor, ed1 - 0.04, ed1, 0.02, top - 0.04, Yb + 0.04, Yb + 0.04 + (ed1 - ed0) * 0.8);
    put(f, new CylinderGeometry(0.022, 0.022, 0.06, 10).rotateZ(Math.PI / 2).translate(ed1 - 0.07, 0.98, Yb + (ed1 - ed0) * 0.7), steel);
    // Low white partitions beside the doors (on their inner sides), washing machines (the one by each partition on a stand).
    for (const x of [wd1 + 0.15, ed0 - 0.27]) {
      box(f, white, x, x + 0.12, 0, 1.15, Yb, Yb + 0.85);
      solid(f, x, x + 0.12, 0, 1.15, Yb, Yb + 0.85);
    }
    for (const [c, lift] of [[wd1 + 0.65, 0.25], [wd1 + 1.35, 0], [ed0 - 0.77, 0.25], [ed0 - 1.47, 0]] as const) {
      if (lift) box(f, washer2, c - 0.32, c + 0.32, 0, lift, Yb + 0.03, Yb + 0.67);
      box(f, washer2, c - 0.3, c + 0.3, lift, lift + 0.85, Yb + 0.05, Yb + 0.65);
      box(f, panelDark, c - 0.3, c + 0.3, lift + 0.85, lift + 0.97, Yb + 0.05, Yb + 0.2);
      box(f, basinIn, c - 0.26, c + 0.26, lift + 0.85, lift + 0.86, Yb + 0.24, Yb + 0.61);
      solid(f, c - 0.32, c + 0.32, 0, lift + 0.97, Yb + 0.03, Yb + 0.67);
    }
    // Windows: the work room's real one (east, built in the work room), a dark one west of it, and an upper dark pair.
    const [ww0, ww1] = DORM_C_WORK_WINDOW, wwW1 = ww0 - 0.25, wwW0 = wwW1 - (ww1 - ww0);
    windowV(f, Yb, 1, wwW0, wwW1, 1.0, 2.1, { dark: true });
    for (const [p, q] of [[wwW0, wwW1], [ww0, ww1]] as const) windowV(f, Yb, 1, p, q, 2.3, 2.8, { dark: true });
    // Navy steel drying frame under the ceiling (使用者：中間的衣架拿掉).
    for (const y of [Yb + 1.0, (Yb + cy1) / 2 + 0.3, cy1 - 0.3]) box(f, navyRail, X0 + 0.7, X1 - 0.7, 2.6, 2.66, y - 0.03, y + 0.03);
    for (const x of [5.4, mid, 11.0]) {
      box(f, navyRail, x - 0.03, x + 0.03, 2.66, 2.72, Yb + 0.9, cy1 - 0.2);
      for (const y of [Yb + 1.0, cy1 - 0.3]) box(f, navyRail, x - 0.01, x + 0.01, 2.72, CEIL, y - 0.01, y + 0.01);
    }
  }

  // --- 工作室（使用者照片＋草圖 work） ---------------------------------------------------------------
  // From the corridor: a dark-framed doorway, the light wooden door standing open inside, a dark louvred panel over it, a
  // grey breaker box on the wall beside. Inside: dark floor, white walls, a white-tiled counter with three taps along the
  // west wall, a dark-framed window, and the doorway onto the laundry balcony (dark frame, louvred panel) in the far wall.
  {
    const f = PLAN, [x0, y0, x1, y1] = R.other;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    floor(f, darkFloor, [X0, Y0, X1, Y1], 0.9);
    ceiling(f, ceilingPaint, [X0, Y0, X1, Y1]);
    ceilingPanel(f, (X0 + X1) / 2, (Y0 + Y1) / 2, 0.6, 1.2);
    // The north part beside the passage: same floor and ceiling; the counter runs on along its west wall (below).
    {
      const [nx0, ny0, nx1] = R.otherNorth, NX0 = nx0 + WALL, NY0 = ny0 + WALL;
      floor(f, darkFloor, [NX0, NY0, nx1 - WALL, y0 + WALL], 0.9);
      ceiling(f, ceilingPaint, [NX0, NY0, nx1 - WALL, y0 + WALL]);
      ceilingPanel(f, (NX0 + nx1) / 2, (NY0 + y0) / 2, 0.6, 0.6);
    }
    const top = 2.4 - LIFT;
    // Entrance (north wall, 13.0–13.9): frame on both faces, louvred transom on the corridor side, door open against the east jamb.
    const e0 = R.corridor[0] + 0.1, e1 = R.other[2] - 0.1;
    for (const [at, dir] of [[y0 - WALL, -1], [y0 + WALL, 1]] as const) {
      const v0 = Math.min(at, at + dir * 0.04), v1 = Math.max(at, at + dir * 0.04);
      box(f, frameBrown, e0 - 0.07, e0, 0, top, v0, v1);
      box(f, frameBrown, e1, e1 + 0.07, 0, top, v0, v1);
      box(f, frameBrown, e0 - 0.07, e1 + 0.07, top, top + 0.07, v0, v1);
    }
    faceV(f, black, y0 - WALL - 0.004, -1, e0 - 0.07, e1 + 0.07, top + 0.07, CEIL - 0.05);
    for (let h = top + 0.12; h < CEIL - 0.08; h += 0.06) box(f, panelDark, e0 - 0.05, e1 + 0.05, h, h + 0.015, y0 - WALL - 0.03, y0 - WALL - 0.005);
    box(f, doorWood, e1 - 0.04, e1, 0, top - 0.02, Y0, Y0 + (e1 - e0) - 0.02); // the leaf, swung open against the wall
    put(f, new CylinderGeometry(0.02, 0.02, 0.06, 10).rotateZ(Math.PI / 2).translate(e1 - 0.07, 0.98, Y0 + (e1 - e0) - 0.12), steel);
    // Breaker box on the corridor wall east of the door.
    box(f, washerGrey, 12.45, 13.0, 1.55, 2.15, y0 - WALL - 0.12, y0 - WALL);
    box(f, panelDark, 12.55, 12.9, 1.8, 1.95, y0 - WALL - 0.125, y0 - WALL - 0.12);
    // The counter (使用者照片): a white-tiled slab on the west wall, open underneath, three rows of tiles behind it and three
    // beige power outlets in them.
    // The whole west wall, from the north end wall to the window wall (使用者：檯面延伸到牆壁、深一點).
    const c0 = R.otherNorth[1] + WALL, c1 = Y1, cd = 0.8;
    box(f, smallTile, X0, X0 + cd, 0.74, 0.86, c0, c1, 1);
    faceU(f, smallTile, X0 + 0.004, 1, c0, c1, 0.86, 1.48, 1);
    for (let k = 0; k < 3; k++) {
      const y = c0 + ((c1 - c0) * (k + 0.5)) / 3;
      box(f, beige, X0, X0 + 0.025, 1.12, 1.2, y - 0.06, y + 0.06);
      box(f, panelDark, X0 + 0.025, X0 + 0.03, 1.15, 1.17, y - 0.03, y + 0.03);
    }
    solid(f, X0, X0 + cd, 0.74, 0.86, c0, c1);
    // The window into the laundry at the west end of the south wall: wall below and above built here (the plan leaves a gap),
    // a dark frame round two panes of clear glass.
    const [g0, g1] = DORM_C_WORK_WINDOW, wy = y1, s0 = 1.0, s1 = 2.1;
    box(f, plaster, g0, g1, 0, s0, wy - WALL, wy + WALL);
    box(f, plaster, g0, g1, s1, CEIL, wy - WALL, wy + WALL);
    solid(f, g0, g1, 0, CEIL, wy - WALL, wy + WALL);
    for (const [a, b] of [[g0, g0 + 0.06], [g1 - 0.06, g1], [(g0 + g1) / 2 - 0.03, (g0 + g1) / 2 + 0.03]] as const) box(f, frameBrown, a, b, s0, s1, wy - 0.06, wy + 0.06);
    for (const h of [s0, s1 - 0.06]) box(f, frameBrown, g0, g1, h, h + 0.06, wy - 0.06, wy + 0.06);
    box(f, clearGlass, g0 + 0.06, g1 - 0.06, s0 + 0.06, s1 - 0.06, wy - 0.005, wy + 0.005);
  }

  // --- 走廊 ---------------------------------------------------------------------------------------
  {
    const f = PLAN, [cx0, cy0, cx1, cy1] = R.corridor;
    floor(f, roomFloor, [cx0 + WALL, cy0 + WALL, cx1, cy1 - WALL], 0.9);
    ceiling(f, ceilingPaint, [cx0 + WALL, cy0 + WALL, cx1, cy1 - WALL]);
    // No shoe rack: the corridor is short, with the bath curtain, the store-room door and two bedroom doors.
    for (const x of [12.4, 14.4, 15.9]) ceilingPanel(f, x, (cy0 + cy1) / 2, 1.2, 0.3);
  }

  // --- 交誼廳 -------------------------------------------------------------------------------------
  // The recessed hall bay only (使用者標註：紅框＝戶廳的範圍), 7.6 m in from its window; open to the corridor
  // on the west, rooms 3 and 4 off its north wall, the front door in its east wall.
  {
    const f = PLAN, [x0, y0, x1, y1] = R.living;
    const X0 = x0 + WALL, X1 = x1 - WALL, Y0 = y0 + WALL, Y1 = y1 - WALL;
    floor(f, roomFloor, [x0, Y0, X1, Y1], 0.9);
    ceiling(f, ceilingPaint, [x0, Y0, X1, Y1]);
    windowV(f, Y1, -1, X0 + 0.5, X1 - 0.5, 0.9, 2.6, { blinds: 0.3, mullions: 2 });
    for (const x of [18.0, 21.0]) for (const y of [5.3, 8.9]) ceilingPanel(f, x, y, 0.6, 0.6);
    // Sitting corner: TV on a low cabinet against the west wall (room 1 behind it), coffee table, sofa facing it.
    const tv0 = 7.0, tv1 = 9.2, tvm = (tv0 + tv1) / 2;
    box(f, wood, X0, X0 + 0.45, 0, 0.5, tv0, tv1);
    solid(f, X0, X0 + 0.45, 0, 0.5, tv0, tv1);
    box(f, black, X0 + 0.15, X0 + 0.3, 0.5, 0.56, tvm - 0.2, tvm + 0.2);
    box(f, black, X0 + 0.2, X0 + 0.26, 0.6, 1.3, tvm - 0.75, tvm + 0.75);
    box(f, wood, X0 + 1.1, X0 + 1.9, 0.4, 0.45, tvm - 0.5, tvm + 0.5);
    for (const [dx, dy] of [[1.15, -0.45], [1.85, -0.45], [1.15, 0.45], [1.85, 0.45]] as const) box(f, woodDark, X0 + dx - 0.025, X0 + dx + 0.025, 0, 0.4, tvm + dy - 0.025, tvm + dy + 0.025);
    solid(f, X0 + 1.1, X0 + 1.9, 0, 0.45, tvm - 0.5, tvm + 0.5);
    const sf0 = X0 + 2.5, sf1 = sf0 + 0.85, sa = tvm - 1.15, sb2 = tvm + 1.15;
    box(f, fabric, sf0, sf1, 0.1, 0.42, sa, sb2);
    box(f, fabric, sf1 - 0.22, sf1, 0.42, 0.88, sa, sb2);
    for (const [a, b] of [[sa, sa + 0.18], [sb2 - 0.18, sb2]] as const) box(f, fabric, sf0, sf1 - 0.22, 0.42, 0.62, a, b);
    for (let i = 0; i < 3; i++) box(f, mattress, sf0 + 0.05, sf1 - 0.24, 0.42, 0.5, sa + 0.2 + i * 0.66, sa + 0.84 + i * 0.66);
    solid(f, sf0, sf1, 0, 0.88, sa, sb2);
    // Dining table with four stools in the north part, a notice board on the north wall between rooms 3 and 4.
    const tx0 = 18.4, tx1 = 19.8, ty0 = 4.7, ty1 = 5.6;
    box(f, wood, tx0, tx1, 0.72, 0.76, ty0, ty1);
    for (const [x, y] of [[tx0 + 0.05, ty0 + 0.05], [tx1 - 0.05, ty0 + 0.05], [tx0 + 0.05, ty1 - 0.05], [tx1 - 0.05, ty1 - 0.05]] as const) box(f, steel, x - 0.02, x + 0.02, 0, 0.72, y - 0.02, y + 0.02);
    solid(f, tx0, tx1, 0, 0.76, ty0, ty1);
    for (const [x, y] of [[tx0 - 0.3, (ty0 + ty1) / 2], [tx1 + 0.3, (ty0 + ty1) / 2], [(tx0 + tx1) / 2, ty0 - 0.3], [(tx0 + tx1) / 2, ty1 + 0.3]] as const) {
      put(f, new CylinderGeometry(0.17, 0.17, 0.04, 14).translate(x, 0.45, y), blue);
      put(f, new CylinderGeometry(0.02, 0.02, 0.45, 6).translate(x, 0.225, y), steel);
    }
    box(f, woodDark, 18.75, 20.0, 1.15, 1.95, Y0, Y0 + 0.03);
    box(f, beige, 18.8, 19.95, 1.2, 1.9, Y0 + 0.03, Y0 + 0.04);
    for (const [x, h, m] of [[18.9, 1.55, pillow], [19.3, 1.35, blue], [19.6, 1.6, pillow]] as const) box(f, m, x, x + 0.2, h, h + 0.25, Y0 + 0.04, Y0 + 0.045);
    // Shoe cabinet by the front door (north of it), water dispenser against the north wall east of room 4's door.
    const sc0 = 5.0, sc1 = 6.05;
    box(f, wood, X1 - 0.38, X1, 0, 1.0, sc0, sc1);
    box(f, woodDark, X1 - 0.385, X1 - 0.38, 0.05, 0.95, (sc0 + sc1) / 2 - 0.005, (sc0 + sc1) / 2 + 0.005);
    solid(f, X1 - 0.38, X1, 0, 1.0, sc0, sc1);
    const wd0 = 21.5, wd1 = 21.85;
    box(f, white, wd0, wd1, 0, 1.05, Y0, Y0 + 0.34);
    box(f, panelDark, wd0 + 0.05, wd1 - 0.05, 0.75, 0.95, Y0 + 0.34, Y0 + 0.345);
    put(f, new CylinderGeometry(0.13, 0.13, 0.4, 14).translate((wd0 + wd1) / 2, 1.25, Y0 + 0.17), blue);
    solid(f, wd0, wd1, 0, 1.45, Y0, Y0 + 0.34);
  }

  for (const [m, list] of parts) {
    const geo = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of list) g.dispose();
    if (!geo) continue;
    const mesh = new Mesh(tracker.geometry(geo), m);
    const flat = m === view || m === light || m === blinds || m === clearGlass;
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
