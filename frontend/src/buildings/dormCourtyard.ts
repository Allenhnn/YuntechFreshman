import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { Ring } from '../campus/campusTypes';
import { Soup, canvasTex, speckle } from './mgmtCourtyard';

/**
 * 學生宿舍 C / D 之間的下沉中庭（使用者 Street View 實拍，2026-11-20；以紅色箭頭為準：
 * 從宿舍服務路的路尾往西看、以及從中庭往東看回路尾）：
 *  - 路尾一小片紅磚鋪面與三支混凝土圓柱車阻；往西下到約一層樓深（3 m）的中庭：
 *    南側（D 棟側）是迴旋無障礙坡道——外道從路尾地面往西下到半圓平台、內道折返往東下到
 *    第一根柱子旁的中庭地坪；坡道隔牆以北到 C 側牆整面是台階（使用者手繪，2026-11-20）；
 *  - 中庭地坪是深灰方磚，兩排米色磚砌花台（草＋小棕櫚）沿中線錯開排列；
 *  - 南北兩側沿 C、D 棟各留一條地面層走廊（3 m 寬，原地坪），走廊邊是紅色鏤空花磚欄杆，
 *    欄杆下方就是中庭這一層的柱廊：北側（C 棟）白色鐵捲門、南側（D 棟）深色門洞；
 *  - 石桌與石頭在迴旋坡道轉彎平台正前方；兩排花台左右對齊；
 *  - C 側柱廊依實拍改成有深度的騎樓：池邊方柱、深梁、後牆玻璃店面＋木門、最西一跨白色鐵捲門、冷氣與紅色水管；
 *  - 西端一整面寬台階往上回到地面（上方是草地與高大的樹）。
 * 座標系：原點在兩棟之間的中線（x = 0 處），s 沿兩棟牆面往西（約 WNW→WSW 的紅色箭頭方向），
 * w 往北（C 棟側）。地面在中庭範圍開洞（dormCourtPit），地面碰撞體在洞內不作用。
 */
const ORIGIN: readonly [number, number] = [0, 365.7];
const U: readonly [number, number] = [-0.98698, 0.16085]; // +s (west, along the C / D faces)
const D = -3; // courtyard floor
const PIT = { s0: 3.5, s1: 35, wS: -10.0, wN: 9.9 };
/** The C-side colonnade is a real arcade: the opening runs on under the corridor to its back wall. */
const ARCADE_BACK = 12.9;
/** East stair down from the road end (from the ramp divider to the C wall), west stair back up (full width). */
const EAST = { run: 6, n: 20 };
const WEST = { run: 7, n: 20 };
const FLOOR_S0 = PIT.s0 + EAST.run, FLOOR_S1 = PIT.s1 - WEST.run;
const WALL = 0.3;
/**
 * Switchback ramp along the D side (user sketch 2026-11-20): the outer lane leaves the road end at
 * ground level and runs west down to a half-round landing, the inner lane comes back east down to the
 * courtyard floor beside the first column, where its inner wall stops short so it opens onto the floor.
 * w bands: outer wall | outer lane | divider | inner lane | inner wall.
 */
const RAMP = { wOut: -7.8, wDiv0: -5.95, wDiv1: -5.75, wIn: -3.9, t: 0.2, sTurn: 21.5, sEnd: FLOOR_S0 + 0.5, innerWall0: FLOOR_S0 + 2, rail: 1.0 };
/** Ground-level corridors along the buildings, and the brick apron at the road end. */
const CORR = { n: 13.0, s: -13.15 };
const APRON_S0 = -4;

function toWorld(s: number, w: number): [number, number] {
  return [ORIGIN[0] + s * U[0] - w * U[1], ORIGIN[1] + s * U[1] + w * U[0]];
}
function toLocal(x: number, z: number): [number, number] {
  const dx = x - ORIGIN[0], dz = z - ORIGIN[1];
  return [dx * U[0] + dz * U[1], -dx * U[1] + dz * U[0]];
}
function rectRing(s0: number, s1: number, w0: number, w1: number): Ring {
  return [...toWorld(s0, w0), ...toWorld(s1, w0), ...toWorld(s1, w1), ...toWorld(s0, w1)];
}

/** Ground opening, point test for the ground collider, and the no-tree / no-lamp ring. */
export function dormCourtPit(): { ring: Ring; contains(x: number, z: number): boolean; treeFree: Ring } {
  return {
    ring: rectRing(PIT.s0, PIT.s1, PIT.wS, ARCADE_BACK),
    contains(x, z) {
      const [s, w] = toLocal(x, z);
      return s >= PIT.s0 && s <= PIT.s1 && w >= PIT.wS && w <= ARCADE_BACK;
    },
    treeFree: rectRing(APRON_S0 - 1, PIT.s1 + 0.5, CORR.s - 0.3, CORR.n + 0.3),
  };
}

export function createDormCourtyard(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): { dispose(): void } {
  const yaw = -Math.atan2(U[1], U[0]);
  const g = new Group();
  g.name = 'Dorm C/D sunken courtyard';
  g.position.set(ORIGIN[0], 0, ORIGIN[1]);
  g.rotation.y = yaw; // local +x = s, local +z = w
  scene.add(g);
  const colliders: RAPIER.Collider[] = [];
  const quat = (extra = 0): { x: number; y: number; z: number; w: number } => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw + extra);
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  };
  const rot = quat();
  const solid = (s0: number, s1: number, h0: number, h1: number, w0: number, w1: number): void => {
    const [wx, wz] = toWorld((s0 + s1) / 2, (w0 + w1) / 2);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid((s1 - s0) / 2, (h1 - h0) / 2, (w1 - w0) / 2).setTranslation(wx, (h0 + h1) / 2, wz).setRotation(rot),
    )));
  };
  const trimesh = (soup: Soup): void => {
    const v = new Float32Array(soup.p.length);
    for (let i = 0; i < soup.p.length; i += 3) {
      const [wx, wz] = toWorld(soup.p[i]!, soup.p[i + 2]!);
      v[i] = wx;
      v[i + 1] = soup.p[i + 1]!;
      v[i + 2] = wz;
    }
    const idx = new Uint32Array(v.length / 3).map((_, i) => i);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.trimesh(v, idx))));
  };

  // --- Materials ---------------------------------------------------------------------------------
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ side: DoubleSide, ...o }));
  const decal = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 };
  const concreteTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#bdbab2';
    c.fillRect(0, 0, 128, 128);
    speckle(c, 128, 128, 900, ['#8d8b85', '#d6d3cb', '#77756f'], 23);
  });
  const concrete = std({ map: concreteTex, roughness: 0.92 });
  // Dark grey slate squares (≈0.6 m) on the courtyard floor.
  const slateTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#4c4f52';
    c.fillRect(0, 0, 128, 128);
    const tones = ['#6a6d70', '#62666a', '#727578', '#5d6064'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      c.fillStyle = tones[i * 2 + j]!;
      c.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
    speckle(c, 128, 128, 700, ['#3d4043', '#868a8d'], 29);
  });
  slateTex.repeat.set(1 / 1.2, 1 / 1.2);
  const slate = std({ map: slateTex, roughness: 0.85, ...decal });
  const brickTex = canvasTex(tracker, 256, 256, (c) => {
    c.fillStyle = '#5a3b32';
    c.fillRect(0, 0, 256, 256);
    let s = 41;
    const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    const tones = ['#9a5a44', '#8a4f3d', '#a8664d', '#7c4838', '#b0735a'];
    for (let row = 0; row < 16; row++) for (let col = -1; col < 9; col++) {
      c.fillStyle = tones[Math.floor(r() * tones.length)]!;
      c.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
    }
    speckle(c, 256, 256, 800, ['#3a2620', '#c09080'], 31);
  });
  brickTex.repeat.set(1 / 4, 1 / 4);
  const brick = std({ map: brickTex, roughness: 0.95, ...decal });
  const walkTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#a9a7a0';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(90,88,84,0.5)';
    c.strokeRect(0.5, 0.5, 127, 127);
    speckle(c, 128, 128, 700, ['#8a8882', '#c4c2bb'], 37);
  });
  walkTex.repeat.set(1 / 1.5, 1 / 1.5);
  const walk = std({ map: walkTex, roughness: 0.9, ...decal });
  // Red breeze-block balustrade: brick-red screen with dark diamond openings.
  const latticeTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#a4452e';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#3b1f19';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const cx = i * 32 + 16, cy = j * 32 + 16;
      c.beginPath(); c.moveTo(cx, cy - 11); c.lineTo(cx + 11, cy); c.lineTo(cx, cy + 11); c.lineTo(cx - 11, cy); c.closePath(); c.fill();
    }
    speckle(c, 128, 128, 500, ['#7d3020', '#c46a52'], 43);
  });
  latticeTex.repeat.set(2, 2);
  const lattice = std({ map: latticeTex, roughness: 0.9 });
  const shutterTex = canvasTex(tracker, 64, 64, (c) => {
    c.fillStyle = '#e4e4df';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = 'rgba(120,120,115,0.55)';
    for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 1);
  });
  shutterTex.repeat.set(1, 1 / 0.8);
  const shutter = std({ map: shutterTex, roughness: 0.6 });
  const glass = std({ color: 0x2c3438, roughness: 0.15, metalness: 0.4 });
  const timber = std({ color: 0x5a3b28, roughness: 0.8 });
  const acUnit = std({ color: 0xd9d8d2, roughness: 0.7 });
  const redPipe = std({ color: 0xb3261e, roughness: 0.6 });
  const beigeTex = canvasTex(tracker, 64, 64, (c) => {
    c.fillStyle = '#c8b79a';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = 'rgba(110,95,75,0.6)';
    for (let y = 0; y < 64; y += 16) c.fillRect(0, y, 64, 2);
    for (let y = 0; y < 64; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < 64; x += 32) c.fillRect(x, y, 2, 16);
  });
  beigeTex.repeat.set(1 / 0.5, 1 / 0.5);
  const beige = std({ map: beigeTex, roughness: 0.85 });
  const grassTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#5f9a3c';
    c.fillRect(0, 0, 128, 128);
    speckle(c, 128, 128, 1500, ['#4a7f2f', '#7db955', '#3a6a28', '#9ccf6a'], 47);
  });
  grassTex.repeat.set(1 / 2, 1 / 2);
  const grass = std({ map: grassTex, roughness: 1 });
  const dark = std({ color: 0x1d1f22, roughness: 0.9 });
  const frame = std({ color: 0x8e8b84, roughness: 0.8 });
  const stone = std({ color: 0x5f5d59, roughness: 0.95, flatShading: true });
  const frond = std({ color: 0x8fae3a, roughness: 0.8 });
  const bark = std({ color: 0x9a9070, roughness: 0.95 });

  // --- Merged boxes per material (as in mgmtCourtyard) -------------------------------------------
  const boxes = new Map<Material, BufferGeometry[]>();
  const box = (m: Material, s0: number, s1: number, h0: number, h1: number, w0: number, w1: number, solidToo = false): void => {
    const geo = new BoxGeometry(s1 - s0, h1 - h0, w1 - w0).translate((s0 + s1) / 2, (h0 + h1) / 2, (w0 + w1) / 2);
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      uv.setXY(i, nx > 0.5 ? pos.getZ(i) : pos.getX(i), ny > 0.5 ? pos.getZ(i) : pos.getY(i));
    }
    const list = boxes.get(m);
    if (list) list.push(geo);
    else boxes.set(m, [geo]);
    if (solidToo) solid(s0, s1, h0, h1, w0, w1);
  };
  const add = (geo: BufferGeometry, m: Material, shadow = true): Mesh => {
    const mesh = new Mesh(tracker.geometry(geo), m);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    g.add(mesh);
    return mesh;
  };
  const slab = (pts: readonly (readonly [number, number])[], h: number, m: Material): void => {
    const sh = new Shape();
    pts.forEach(([s, w], i) => (i ? sh.lineTo(s, -w) : sh.moveTo(s, -w)));
    sh.closePath();
    const geo = new ShapeGeometry(sh).rotateX(-Math.PI / 2).translate(0, h, 0);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    add(geo, m, false);
  };
  const rect = (s0: number, s1: number, w0: number, w1: number): [number, number][] => [[s0, w0], [s1, w0], [s1, w1], [s0, w1]];

  // --- Ground level: brick apron at the road end, corridors along C and D -------------------------
  slab(rect(APRON_S0, PIT.s0, CORR.s, CORR.n), 0.035, brick);
  slab(rect(PIT.s0, PIT.s1, PIT.wN + WALL, CORR.n), 0.03, walk);
  slab(rect(PIT.s0, PIT.s1, CORR.s, PIT.wS - WALL), 0.03, walk);
  // Concrete bollards across the top of the stair (Street View: three stubby cylinders).
  const bollards: BufferGeometry[] = [];
  for (const w of [-3.2, 0, 3.2]) {
    bollards.push(new CylinderGeometry(0.3, 0.32, 0.6, 14).translate(2.5, 0.3, w));
    const [x, z] = toWorld(2.5, w);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(0.3, 0.31).setTranslation(x, 0.3, z))));
  }
  add(mergeGeometries(bollards)!, concrete);

  // --- Pit: floor, retaining walls, balustrades ---------------------------------------------------
  box(concrete, PIT.s0, PIT.s1, D - 0.3, D, PIT.wS, PIT.wN, true);
  slab(rect(PIT.s0, PIT.s1, PIT.wS, PIT.wN), D + 0.01, slate);
  // Long walls (the corridor edges) with the red lattice balustrade on top.
  for (const [w0, w1] of [[PIT.wN - WALL, PIT.wN], [PIT.wS, PIT.wS + WALL]] as const) {
    if (w0 < 0) box(concrete, PIT.s0, PIT.s1, D, 0, w0, w1, true); // C side: arcade below (see colonnades)
    box(concrete, PIT.s0, PIT.s1, 0, 0.15, w0, w1);
    box(lattice, PIT.s0, PIT.s1, 0.15, 0.92, w0 + 0.08, w1 - 0.08);
    box(concrete, PIT.s0, PIT.s1, 0.92, 1.02, w0 - 0.02, w1 + 0.02);
    solid(PIT.s0, PIT.s1, 0, 1.02, w0, w1);
  }
  // East stair: twenty risers down to the floor, from the ramp divider across to the C-side wall.
  const stairs = new Soup();
  const ew0 = RAMP.wDiv1, ew1 = PIT.wN - WALL;
  const riseE = -D / EAST.n, treadE = EAST.run / EAST.n;
  for (let i = 0; i < EAST.n; i++) {
    const sa = PIT.s0 + i * treadE, sb = sa + treadE, h = -(i + 1) * riseE;
    if (h > D + 1e-6) box(concrete, sa, sb, D, h, ew0, ew1);
    stairs.quad([sa, h + riseE, ew0], [sa, h + riseE, ew1], [sa, h, ew1], [sa, h, ew0]);
    stairs.quad([sa, h, ew0], [sa, h, ew1], [sb, h, ew1], [sb, h, ew0]);
  }

  // --- Switchback ramp ---------------------------------------------------------------------------
  const runOut = RAMP.sTurn - PIT.s0, runIn = RAMP.sTurn - RAMP.sEnd;
  const grade = -D / (runOut + runIn);
  const hMid = -runOut * grade;
  const outerH = (s: number): number => -(s - PIT.s0) * grade;
  const innerH = (s: number): number => hMid - (RAMP.sTurn - s) * grade;
  const rampSoup = new Soup();
  /** Solid from the floor up to a top that slopes linearly along s; drawn and given a convex collider. */
  const sloped = (s0: number, s1: number, w0: number, w1: number, top: (s: number) => number): void => {
    const t0 = top(s0), t1 = top(s1);
    const v = (s: number, h: number, w: number): number[] => [s, h, w];
    rampSoup.quad(v(s0, t0, w0), v(s0, t0, w1), v(s1, t1, w1), v(s1, t1, w0)); // top
    rampSoup.quad(v(s0, D, w0), v(s1, D, w0), v(s1, t1, w0), v(s0, t0, w0)); // sides
    rampSoup.quad(v(s0, D, w1), v(s0, t0, w1), v(s1, t1, w1), v(s1, D, w1));
    rampSoup.quad(v(s0, D, w0), v(s0, t0, w0), v(s0, t0, w1), v(s0, D, w1)); // ends
    rampSoup.quad(v(s1, D, w0), v(s1, D, w1), v(s1, t1, w1), v(s1, t1, w0));
    const pts: number[] = [];
    for (const [s, h] of [[s0, D], [s0, t0], [s1, D], [s1, t1]] as const) {
      for (const w of [w0, w1]) {
        const [x, z] = toWorld(s, w);
        pts.push(x, h, z);
      }
    }
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) colliders.push(tracker.collider(physics.createCollider(desc)));
  };
  const { wOut, wDiv0, wDiv1, wIn, t, sTurn, sEnd, innerWall0, rail } = RAMP;
  sloped(PIT.s0, sTurn, wOut + t, wDiv0, outerH); // outer lane: road end → landing
  sloped(sEnd, sTurn, wDiv1, wIn - t, innerH); // inner lane: landing → courtyard floor
  sloped(PIT.s0, sTurn, wOut, wOut + t, (s) => outerH(s) + rail); // outer wall
  sloped(PIT.s0, sTurn, wDiv0, wDiv1, (s) => outerH(s) + rail); // divider (also the stair's south cheek)
  sloped(innerWall0, sTurn, wIn - t, wIn, (s) => innerH(s) + rail); // inner wall, open at its east end
  // Between the ramp and the D colonnade, under the upper lane's start: solid to ground level.
  box(concrete, PIT.s0, FLOOR_S0, D, 0, PIT.wS + WALL, wOut, true);
  add(rampSoup.geometry(1), concrete);
  // Half-round landing and its curved parapet (the round drum in the Street View photo).
  const wc = (wOut + wIn) / 2, R = (wIn - wOut) / 2, ARC = 16;
  add(new CylinderGeometry(R - t, R - t, hMid - D, ARC, 1, false, 0, Math.PI).translate(sTurn, (D + hMid) / 2, wc), concrete);
  const land: number[] = [];
  for (let i = 0; i <= ARC; i++) {
    const a = (i / ARC) * Math.PI, [x, z] = toWorld(sTurn + (R - t) * Math.sin(a), wc + (R - t) * Math.cos(a));
    land.push(x, D, z, x, hMid, z);
  }
  const landDesc = RAPIER.ColliderDesc.convexHull(new Float32Array(land));
  if (landDesc) colliders.push(tracker.collider(physics.createCollider(landDesc)));
  const curve = new Soup();
  const top = hMid + rail;
  const cp = (r: number, a: number, h: number): number[] => [sTurn + r * Math.sin(a), h, wc + r * Math.cos(a)];
  for (let i = 0; i < ARC; i++) {
    const a = (i / ARC) * Math.PI, b = ((i + 1) / ARC) * Math.PI, ro = R, ri = R - t;
    curve.quad(cp(ro, a, D), cp(ro, a, top), cp(ro, b, top), cp(ro, b, D));
    curve.quad(cp(ri, a, D), cp(ri, b, D), cp(ri, b, top), cp(ri, a, top));
    curve.quad(cp(ri, a, top), cp(ri, b, top), cp(ro, b, top), cp(ro, a, top));
    const m = (a + b) / 2, [cx, cz] = toWorld(sTurn + (ro - t / 2) * Math.sin(m), wc + (ro - t / 2) * Math.cos(m));
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(t / 2, (top - D) / 2, (ro * (b - a)) / 2 + 0.02).setTranslation(cx, (D + top) / 2, cz)
        .setRotation(quat(m - Math.PI / 2)),
    )));
  }
  add(curve.geometry(1), concrete);
  // West stair: full width, back up to the lawn under the tall trees.
  const riseW = -D / WEST.n, treadW = WEST.run / WEST.n;
  const ww0 = PIT.wS + WALL, ww1 = PIT.wN - WALL;
  for (let i = 0; i < WEST.n; i++) {
    const sa = FLOOR_S1 + i * treadW, sb = sa + treadW, h = D + (i + 1) * riseW;
    box(concrete, sa, sb, D, h, ww0, ww1);
    stairs.quad([sa, h - riseW, ww0], [sa, h - riseW, ww1], [sa, h, ww1], [sa, h, ww0]);
    stairs.quad([sa, h, ww0], [sa, h, ww1], [sb, h, ww1], [sb, h, ww0]);
  }
  trimesh(stairs);

  // --- Colonnades under the corridors: columns, edge beam, doors ----------------------------------
  const BAYS = 4;
  const bay = (FLOOR_S1 - FLOOR_S0) / BAYS;
  for (const side of [-1] as const) {
    const face = side > 0 ? PIT.wN - WALL : PIT.wS + WALL; // wall face towards the courtyard
    const into = -side; // from the face into the courtyard
    const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
    for (let k = 0; k <= BAYS; k++) {
      const s = FLOOR_S0 + k * bay;
      box(concrete, s - 0.25, s + 0.25, D, 0, ...span(face, face + into * 0.4), true);
    }
    box(concrete, FLOOR_S0 - 0.25, FLOOR_S1 + 0.25, -0.45, 0, ...span(face, face + into * 0.45));
    for (let k = 0; k < BAYS; k++) {
      const s0 = FLOOR_S0 + k * bay + 0.25, s1 = s0 + bay - 0.5;
      // Two openings per bay: C side white roller shutters / dark doorways, D side dark doors in frames.
      for (const [a, b] of [[s0 + 0.3, (s0 + s1) / 2 - 0.15], [(s0 + s1) / 2 + 0.15, s1 - 0.3]] as const) {
        const m = side > 0 && (k + (a > (s0 + s1) / 2 ? 1 : 0)) % 2 === 0 ? shutter : dark;
        box(m, a, b, D, D + 2.3, ...span(face, face + into * 0.02));
        box(frame, a - 0.08, b + 0.08, D + 2.3, D + 2.4, ...span(face, face + into * 0.04));
      }
    }
  }

  // C side (Street View, facing north from the courtyard): a deep arcade under the corridor — square
  // columns on the pit edge, a deep edge beam, and a back wall with glazed shopfronts and timber doors,
  // a white roller shutter in the westmost bay, air-conditioner units and a red pipe at the east end.
  {
    const f0 = PIT.wN - WALL, back = ARCADE_BACK - 0.2, CB = 5;
    const cbay = (FLOOR_S1 - FLOOR_S0) / CB;
    box(concrete, PIT.s0, PIT.s1, -0.35, 0, f0, ARCADE_BACK + 0.1, true); // corridor slab
    box(concrete, FLOOR_S0 - 0.25, FLOOR_S1 + 0.25, -0.75, -0.35, f0, f0 + 0.35); // edge beam
    for (const [a, b] of [[PIT.s0, FLOOR_S0 - 0.25], [FLOOR_S1 + 0.25, PIT.s1]] as const) box(concrete, a, b, D, -0.35, f0, ARCADE_BACK, true);
    box(concrete, FLOOR_S0, FLOOR_S1, D - 0.3, D, PIT.wN, ARCADE_BACK, true); // arcade floor
    slab(rect(FLOOR_S0, FLOOR_S1, PIT.wN, ARCADE_BACK), D + 0.01, slate);
    box(concrete, FLOOR_S0 - 0.25, FLOOR_S1 + 0.25, D, -0.35, back, ARCADE_BACK, true); // back wall
    for (let k = 0; k <= CB; k++) {
      const sc = FLOOR_S0 + k * cbay;
      box(concrete, sc - 0.25, sc + 0.25, D, -0.35, f0, f0 + 0.5, true);
      box(concrete, sc - 0.2, sc + 0.2, D, -0.35, back - 0.25, back); // pilaster on the back wall
    }
    for (let k = 0; k < CB; k++) {
      const s0 = FLOOR_S0 + k * cbay + 0.45, s1 = s0 + cbay - 0.9;
      if (k === CB - 1) {
        box(shutter, s0, s1, D, D + 2.35, back - 0.03, back); // white roller shutter (west end)
        box(frame, s0 - 0.06, s1 + 0.06, D + 2.35, D + 2.5, back - 0.06, back);
        continue;
      }
      // Glazed shopfront: dark glass in a grey frame with mullions, a timber door at one end.
      const door = k % 2 === 0 ? s1 - 1.0 : s0;
      const g0 = k % 2 === 0 ? s0 : s0 + 1.1, g1 = k % 2 === 0 ? s1 - 1.1 : s1;
      box(glass, g0, g1, D + 0.4, D + 2.4, back - 0.03, back);
      box(frame, g0, g1, D, D + 0.4, back - 0.05, back);
      box(frame, g0 - 0.05, g1 + 0.05, D + 2.4, D + 2.5, back - 0.06, back);
      const nm = Math.max(1, Math.round((g1 - g0) / 0.9));
      for (let i = 0; i <= nm; i++) {
        const x = g0 + ((g1 - g0) * i) / nm;
        box(frame, x - 0.03, x + 0.03, D + 0.4, D + 2.4, back - 0.06, back);
      }
      box(timber, door, door + 1.0, D, D + 2.2, back - 0.04, back);
      box(frame, door - 0.05, door + 1.05, D + 2.2, D + 2.28, back - 0.06, back);
    }
    // East end: air conditioners and a red pipe down the column.
    for (const [sa, h] of [[FLOOR_S0 + 0.6, D + 1.6], [FLOOR_S0 + 1.6, D + 1.6], [FLOOR_S0 + 0.9, D + 0.5]] as const) {
      box(acUnit, sa, sa + 0.8, h, h + 0.55, back - 0.3, back);
    }
    box(redPipe, FLOOR_S0 + 2.9, FLOOR_S0 + 3.0, D, -0.35, back - 0.15, back - 0.05);
  }

  // --- Courtyard furniture: planters with palms, curved wall, stones -------------------------------
  const planters: [number, number, boolean][] = [
    [FLOOR_S0 + 3, 3.0, true], [FLOOR_S0 + 8.5, 3.0, false], [FLOOR_S0 + 14, 3.0, true],
    // The ramp-side row lines up with the C-side row (user, 2026-11-20).
    [FLOOR_S0 + 3, -3.0, true], [FLOOR_S0 + 8.5, -3.0, true], [FLOOR_S0 + 14, -3.0, false],
  ];
  const trunks: BufferGeometry[] = [];
  const leaves: BufferGeometry[] = [];
  for (const [s, w, palm] of planters) {
    box(beige, s - 1.2, s + 1.2, D, D + 0.55, w - 0.65, w + 0.65, true);
    box(grass, s - 1.08, s + 1.08, D + 0.55, D + 0.58, w - 0.53, w + 0.53);
    if (!palm) continue;
    // Areca clump: three slim stems leaning out, a fan of drooping fronds on each.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + s, lean = 0.12, hgt = 1.9 + 0.35 * k;
      const bx = s + Math.cos(a) * 0.25, bw = w + Math.sin(a) * 0.25;
      const tx = bx + Math.cos(a) * hgt * lean, tw = bw + Math.sin(a) * hgt * lean, top = D + 0.55 + hgt;
      trunks.push(new CylinderGeometry(0.045, 0.07, hgt, 6).translate(0, hgt / 2, 0)
        .rotateZ(-Math.cos(a) * lean).rotateX(Math.sin(a) * lean).translate(bx, D + 0.55, bw));
      for (let f = 0; f < 7; f++) {
        const fa = (f / 7) * Math.PI * 2 + k;
        leaves.push(new ConeGeometry(0.22, 1.3, 4, 1).scale(1, 1, 0.2).translate(0, 0.65, 0)
          .rotateZ(-Math.PI / 2 - 0.5).rotateY(fa).translate(tx, top, tw));
      }
    }
  }
  add(mergeGeometries(trunks)!, bark);
  add(mergeGeometries(leaves)!, frond);
  // Stone table with stones round it, in front of the ramp's turn (user, 2026-11-20).
  const rocks: BufferGeometry[] = [];
  // In front of the ramp's half-round landing, on its centre line.
  const TS = RAMP.sTurn + (RAMP.wIn - RAMP.wOut) / 2 + 1.9, TW = (RAMP.wOut + RAMP.wIn) / 2;
  for (const [ds, dw, sc] of [[-1.0, 0.5, 0.36], [0.9, 0.7, 0.34], [-0.4, -1.0, 0.38], [1.0, -0.6, 0.32]] as const) {
    const s = TS + ds, w = TW + dw;
    rocks.push(new IcosahedronGeometry(sc, 0).scale(1.2, 0.75, 1).translate(s, D + sc * 0.6, w));
    solid(s - sc, s + sc, D, D + sc * 1.2, w - sc, w + sc);
  }
  rocks.push(new IcosahedronGeometry(0.4, 0).scale(1, 0.9, 1).translate(TS, D + 0.32, TW));
  rocks.push(new CylinderGeometry(0.75, 0.7, 0.14, 9).translate(TS, D + 0.72, TW));
  solid(TS - 0.7, TS + 0.7, D, D + 0.79, TW - 0.7, TW + 0.7);
  add(mergeGeometries(rocks.map((r) => r.toNonIndexed()))!, stone);

  for (const [m, list] of boxes) add(mergeGeometries(list) ?? list[0]!, m);

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      g.removeFromParent();
    },
  };
}
