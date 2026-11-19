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
 *  - 路尾一小片紅磚鋪面與三支混凝土圓柱車阻，正中一座往西下降的混凝土台階（兩側擋牆），
 *    下到約一層樓深（3 m）的中庭；
 *  - 中庭地坪是深灰方磚，兩排米色磚砌花台（草＋小棕櫚）沿中線錯開排列；
 *  - 南北兩側沿 C、D 棟各留一條地面層走廊（3 m 寬，原地坪），走廊邊是紅色鏤空花磚欄杆，
 *    欄杆下方就是中庭這一層的柱廊：北側（C 棟）白色鐵捲門、南側（D 棟）深色門洞；
 *  - 中庭東南角一段弧形混凝土矮牆，D 棟側柱廊前散置石頭與石桌；
 *  - 西端一整面寬台階往上回到地面（上方是草地與高大的樹）。
 * 座標系：原點在兩棟之間的中線（x = 0 處），s 沿兩棟牆面往西（約 WNW→WSW 的紅色箭頭方向），
 * w 往北（C 棟側）。地面在中庭範圍開洞（dormCourtPit），地面碰撞體在洞內不作用。
 */
const ORIGIN: readonly [number, number] = [0, 365.7];
const U: readonly [number, number] = [-0.98698, 0.16085]; // +s (west, along the C / D faces)
const D = -3; // courtyard floor
const PIT = { s0: 3.5, s1: 35, wS: -10.0, wN: 9.9 };
/** East stair down from the road end (centred), west stair back up (full width). */
const EAST = { w: 4, run: 6, n: 20 };
const WEST = { run: 7, n: 20 };
const FLOOR_S0 = PIT.s0 + EAST.run, FLOOR_S1 = PIT.s1 - WEST.run;
const WALL = 0.3;
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
    ring: rectRing(PIT.s0, PIT.s1, PIT.wS, PIT.wN),
    contains(x, z) {
      const [s, w] = toLocal(x, z);
      return s >= PIT.s0 && s <= PIT.s1 && w >= PIT.wS && w <= PIT.wN;
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
    box(concrete, PIT.s0, PIT.s1, D, 0, w0, w1, true);
    box(concrete, PIT.s0, PIT.s1, 0, 0.15, w0, w1);
    box(lattice, PIT.s0, PIT.s1, 0.15, 0.92, w0 + 0.08, w1 - 0.08);
    box(concrete, PIT.s0, PIT.s1, 0.92, 1.02, w0 - 0.02, w1 + 0.02);
    solid(PIT.s0, PIT.s1, 0, 1.02, w0, w1);
  }
  // East wall either side of the stair, concrete parapet.
  for (const [w0, w1] of [[PIT.wS + WALL, -EAST.w - 0.25], [EAST.w + 0.25, PIT.wN - WALL]] as const) {
    box(concrete, PIT.s0, PIT.s0 + WALL, D, 0.95, w0, w1, true);
  }
  // East stair: twenty risers down to the floor between two cheek walls.
  const stairs = new Soup();
  const riseE = -D / EAST.n, treadE = EAST.run / EAST.n;
  for (let i = 0; i < EAST.n; i++) {
    const sa = PIT.s0 + i * treadE, sb = sa + treadE, h = -(i + 1) * riseE;
    if (h > D + 1e-6) box(concrete, sa, sb, D, h, -EAST.w, EAST.w);
    stairs.quad([sa, h + riseE, -EAST.w], [sa, h + riseE, EAST.w], [sa, h, EAST.w], [sa, h, -EAST.w]);
    stairs.quad([sa, h, -EAST.w], [sa, h, EAST.w], [sb, h, EAST.w], [sb, h, -EAST.w]);
  }
  for (const [w0, w1] of [[-EAST.w - 0.25, -EAST.w], [EAST.w, EAST.w + 0.25]] as const) {
    box(concrete, PIT.s0, PIT.s0 + EAST.run, D, 0.95, w0, w1, true);
  }
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
  for (const side of [1, -1] as const) {
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

  // --- Courtyard furniture: planters with palms, curved wall, stones -------------------------------
  const planters: [number, number, boolean][] = [
    [FLOOR_S0 + 3, 3.0, true], [FLOOR_S0 + 8.5, 3.0, false], [FLOOR_S0 + 14, 3.0, true],
    [FLOOR_S0 + 5.5, -3.0, true], [FLOOR_S0 + 11, -3.0, true], [FLOOR_S0 + 16.5, -3.0, false],
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
  // Curved concrete wall near the foot of the east stair on the D side (Street View: a round drum).
  const curve = new Soup();
  const CW = { s: FLOOR_S0 + 1.8, w: -7.0, r: 2.0, t: 0.22, h: 1.3, a0: -Math.PI / 2, a1: Math.PI / 2, n: 14 };
  const cp = (r: number, a: number, h: number): number[] => [CW.s + r * Math.cos(a), h, CW.w + r * Math.sin(a)];
  for (let i = 0; i < CW.n; i++) {
    const a = CW.a0 + ((CW.a1 - CW.a0) * i) / CW.n, b = CW.a0 + ((CW.a1 - CW.a0) * (i + 1)) / CW.n;
    const ro = CW.r, ri = CW.r - CW.t, top = D + CW.h;
    curve.quad(cp(ro, a, D), cp(ro, b, D), cp(ro, b, top), cp(ro, a, top));
    curve.quad(cp(ri, a, D), cp(ri, a, top), cp(ri, b, top), cp(ri, b, D));
    curve.quad(cp(ri, a, top), cp(ro, a, top), cp(ro, b, top), cp(ri, b, top));
    const m = (a + b) / 2, [cx, cz] = toWorld(CW.s + (ro - CW.t / 2) * Math.cos(m), CW.w + (ro - CW.t / 2) * Math.sin(m));
    const segLen = (ro * (b - a)) / 2 + 0.02;
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(CW.t / 2, CW.h / 2, segLen).setTranslation(cx, D + CW.h / 2, cz).setRotation(quat(-m)),
    )));
  }
  curve.quad(cp(CW.r - CW.t, CW.a0, D), cp(CW.r, CW.a0, D), cp(CW.r, CW.a0, D + CW.h), cp(CW.r - CW.t, CW.a0, D + CW.h));
  curve.quad(cp(CW.r - CW.t, CW.a1, D), cp(CW.r - CW.t, CW.a1, D + CW.h), cp(CW.r, CW.a1, D + CW.h), cp(CW.r, CW.a1, D));
  add(curve.geometry(1), concrete);
  // Stones and a stone table in front of the D colonnade.
  const rocks: BufferGeometry[] = [];
  for (const [s, w, sc] of [[FLOOR_S0 + 6.2, -7.6, 0.45], [FLOOR_S0 + 7.4, -8.2, 0.38], [FLOOR_S0 + 9.6, -7.9, 0.42], [FLOOR_S0 + 8.4, -6.6, 0.35]] as const) {
    rocks.push(new IcosahedronGeometry(sc, 0).scale(1.2, 0.75, 1).translate(s, D + sc * 0.6, w));
    solid(s - sc, s + sc, D, D + sc * 1.2, w - sc, w + sc);
  }
  rocks.push(new IcosahedronGeometry(0.4, 0).scale(1, 0.9, 1).translate(FLOOR_S0 + 8.0, D + 0.32, -7.4));
  rocks.push(new CylinderGeometry(0.75, 0.7, 0.14, 9).translate(FLOOR_S0 + 8.0, D + 0.72, -7.4));
  solid(FLOOR_S0 + 7.3, FLOOR_S0 + 8.7, D, D + 0.79, -8.1, -6.7);
  add(mergeGeometries(rocks.map((r) => r.toNonIndexed()))!, stone);

  for (const [m, list] of boxes) add(mergeGeometries(list) ?? list[0]!, m);

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      g.removeFromParent();
    },
  };
}
