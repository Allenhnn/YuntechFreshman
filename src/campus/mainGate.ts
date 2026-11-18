import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  InstancedMesh,
  Matrix4,
  Shape,
  ShapeGeometry,
  ExtrudeGeometry,
  SphereGeometry,
  Vector2,
  CanvasTexture,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from './campusTypes';

/** OSM 警衛室 at the main gate on 大學路三段; the hand-built gate replaces its extrusion. */
export const MAIN_GATE_GUARDHOUSE = 167826283;

/**
 * The main gate on 大學路三段 (after the street-view photo): red-brick forecourt with lane
 * markings, the guardhouse between the in / out lanes, low grey walls with flower planters, the
 * school-name plate, the tall name pillar with its sculpture, and traffic signals at the corners.
 *
 * Local frame: +x (`a`) runs east along the road, +z (`n`) points from the road into campus;
 * the origin is the gate road's junction with 大學路三段.
 */
const ORIGIN: readonly [number, number] = [0, -429];
const ROAD_DIR: readonly [number, number] = [29, -6]; // 大學路三段 at the gate, heading east
const GUARD = { a: 1.6, n: 46.3 };

/** Gate frame coordinates (a along the road, n into campus) of a world point. */
function toGate(x: number, z: number): [number, number] {
  const len = Math.hypot(ROAD_DIR[0], ROAD_DIR[1]);
  const ax = ROAD_DIR[0] / len, az = ROAD_DIR[1] / len;
  const dx = x - ORIGIN[0], dz = z - ORIGIN[1];
  return [dx * ax + dz * az, dx * -az + dz * ax];
}

/** The gate forecourt, where its own walls and barrier replace the boundary fence. */
export function inGateZone(x: number, z: number): boolean {
  const [a, n] = toGate(x, z);
  return a > -40 && a < 48 && n > -6 && n < 40;
}

/** No-tree zones (world rings) for the campus scatter: forecourt, boulevard median and the fountain. */
export function gateTreeExclusions(): number[][] {
  const len = Math.hypot(ROAD_DIR[0], ROAD_DIR[1]);
  const ax = ROAD_DIR[0] / len, az = ROAD_DIR[1] / len;
  const w = (a: number, n: number): [number, number] => [ORIGIN[0] + ax * a - az * n, ORIGIN[1] + az * a + ax * n];
  const rect = (a0: number, a1: number, n0: number, n1: number): number[] => [...w(a0, n0), ...w(a1, n0), ...w(a1, n1), ...w(a0, n1)];
  return [rect(-30, 34, 14, 70), rect(-4, 8, 66, 110), rect(-9, 13, 118, 140)];
}

/** Where the map's 大門 entry lands: on the gate road just inside the boundary. */
export function gateSpot(): { x: number; z: number } {
  const len = Math.hypot(ROAD_DIR[0], ROAD_DIR[1]);
  const ax = ROAD_DIR[0] / len, az = ROAD_DIR[1] / len;
  const a = GUARD.a - 6, n = 32;
  return { x: ORIGIN[0] + ax * a - az * n, z: ORIGIN[1] + az * a + ax * n };
}

/** The forecourt and guardhouse island, for the area banner. */
export function inGateArea(x: number, z: number): boolean {
  const [a, n] = toGate(x, z);
  return a > -38 && a < 46 && n > 4 && n < 56;
}

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

function bricks(g: CanvasRenderingContext2D): void {
  const shades = ['#b8644a', '#ad5b43', '#c06d52', '#a9573f', '#b56a50'];
  g.fillStyle = '#93533f';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 4; col++) {
      const x = col * 64 + (row % 2 ? 32 : 0);
      g.fillStyle = shades[(row * 7 + col * 3 + 11) % shades.length]!;
      g.fillRect(x + 2, row * 32 + 2, 60, 28);
    }
  }
}

function flowers(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#3f6e2e';
  g.fillRect(0, 0, 128, 128);
  const colors = ['#d8322a', '#e8572a', '#c21f3a', '#f08a24', '#e33b4f'];
  let s = 7;
  const rand = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = i % 5 === 0 ? '#5d8f3a' : colors[i % colors.length]!;
    g.beginPath();
    g.arc(rand() * 128, rand() * 128, 2.5 + rand() * 3.5, 0, Math.PI * 2);
    g.fill();
  }
}

export interface MainGate {
  dispose(): void;
}

export function createMainGate(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): MainGate | null {
  if (!campus.buildings.some((b) => b.id === MAIN_GATE_GUARDHOUSE)) return null;
  const len = Math.hypot(ROAD_DIR[0], ROAD_DIR[1]);
  const ax = ROAD_DIR[0] / len, az = ROAD_DIR[1] / len; // local +x
  const nx = -az, nz = ax; // local +z, into campus
  const yaw = Math.atan2(nx, nz);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const toWorld = (a: number, n: number): [number, number] => [ORIGIN[0] + ax * a + nx * n, ORIGIN[1] + az * a + nz * n];

  const root = new Group();
  root.name = 'main gate';
  root.position.set(ORIGIN[0], 0, ORIGIN[1]);
  root.rotation.y = yaw;
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];

  const std = (color: number, roughness = 0.85, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial =>
    tracker.material(Object.assign(new MeshStandardMaterial({ color, roughness }), extra));
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, ry = 0): Mesh => {
    const m = new Mesh(tracker.geometry(geo), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  /** Box resting on y0 (local a, n centre), optionally solid. */
  const box = (w: number, h: number, d: number, a: number, y0: number, n: number, mat: Material, solid = false): Mesh => {
    if (solid) {
      const [wx, wz] = toWorld(a, n);
      colliders.push(tracker.collider(physics.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(wx, y0 + h / 2, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      )));
    }
    return add(new BoxGeometry(w, h, d), mat, a, y0 + h / 2, n);
  };

  // Road markings on 大學路三段 and the campus lanes come from campus/roadMarkings.ts; these are the forecourt's own.
  const white = std(0xf4f2ea, 0.7, { polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
  const mark = (w: number, d: number, a: number, n: number, mat: Material = white): void => {
    add(new PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat, a, 0.072, n).castShadow = false;
  };

  // --- Forecourt: a red-brick trapezoid from the kerb (n 16.5) narrowing to the guardhouse island.
  const brickTex = canvasTexture(256, 256, bricks, tracker);
  brickTex.wrapS = brickTex.wrapT = RepeatWrapping;
  const brick = std(0xffffff, 0.92, { map: brickTex, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  /** Flat paving polygon in local (a, n), UVs in `tile`-metre repeats. */
  const paving = (pts: readonly [number, number][], mat: Material, tile: number, y = 0.065): void => {
    const shape = new Shape(pts.map(([a, n]) => new Vector2(a, -n)));
    const g = new ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
    add(g, mat, 0, y, 0).castShadow = false;
  };
  paving([[-26, 16.5], [30, 16.5], [16, 40], [16, 58], [-12, 58], [-12, 40]], brick, 2.4);
  for (let n = 19; n < 38; n += 4) mark(0.18, 2, GUARD.a, n); // centre dashes to the guardhouse
  for (const [a, n, out] of [[-5, 24, false], [10, 24, true], [-5, 33, false], [10, 33, true]] as const) {
    mark(0.35, 2.4, a, n); // lane arrows: in on the west lane, out on the east
    add(new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), white, a, 0.072, n + (out ? -1.4 : 1.4)).castShadow = false;
  }
  // Grey checker paving across both lanes behind the guardhouse.
  const checkerTex = canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? '#9a9c9a' : '#c4c5c1';
      g.fillRect(i * 32, j * 32, 32, 32);
    }
    g.strokeStyle = '#7d7f7c';
    g.lineWidth = 2;
    for (let k = 0; k <= 128; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 128); g.moveTo(0, k); g.lineTo(128, k); g.stroke(); }
  }, tracker);
  checkerTex.wrapS = checkerTex.wrapT = RepeatWrapping;
  paving([[-12, 58], [16, 58], [16, 68], [-12, 68]], std(0xffffff, 0.9, { map: checkerTex, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), 2.4);

  // --- Low walls with flower planters along the road, either side of the forecourt.
  const concrete = std(0xbdb9b1, 0.9);
  const capMat = std(0xd2cfc8, 0.8);
  const planterMat = std(0x9d9a93, 0.9);
  const flowerTex = canvasTexture(128, 128, flowers, tracker);
  flowerTex.wrapS = flowerTex.wrapT = RepeatWrapping;
  const flowerMat = std(0xffffff, 0.95, { map: flowerTex });
  const WALL_N = 19.2;
  const BARRIER_N = 25;
  const wall = (a0: number, a1: number): void => {
    const w = a1 - a0, mid = (a0 + a1) / 2;
    box(w, 1.7, 0.6, mid, 0, WALL_N, concrete, true);
    box(w + 0.1, 0.1, 0.7, mid, 1.7, WALL_N, capMat);
    box(w - 0.4, 0.45, 0.9, mid, 0, WALL_N - 0.85, planterMat, true);
    const f = box(w - 0.6, 0.18, 0.7, mid, 0.42, WALL_N - 0.85, flowerMat);
    f.castShadow = false;
  };
  wall(-48, -38);
  wall(-36.5, -27.5);
  wall(31.5, 41);
  wall(42.5, 52);

  // School-name plate on the west wall, facing the road.
  const plateTex = canvasTexture(1024, 160, (g) => {
    g.fillStyle = '#d7d4cc';
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#1f5fa8';
    g.beginPath();
    g.arc(90, 80, 52, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = "800 46px system-ui, 'PingFang TC', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('雲', 90, 82);
    g.fillStyle = '#1d3354';
    g.font = "800 84px 'Songti TC', 'PingFang TC', serif";
    g.textAlign = 'left';
    g.fillText('國立雲林科技大學', 175, 86);
  }, tracker);
  const plate = add(new PlaneGeometry(6.4, 1.0), std(0xffffff, 0.6, { map: plateTex }), -32, 1.05, WALL_N - 0.31, Math.PI);
  plate.castShadow = false;

  // --- Name pillar with the sculpture on top.
  const stone = std(0xa9aaa5, 0.85);
  const P = { a: -23.5, n: 20 }; // right front corner of the forecourt, by the kerb
  box(2.8, 0.8, 2.8, P.a, 0, P.n, stone, true);
  const SHAFT_H = 11;
  add(new CylinderGeometry(0.9, 0.95, SHAFT_H, 8), stone, P.a, 0.8 + SHAFT_H / 2, P.n, Math.PI / 8);
  {
    const [wx, wz] = toWorld(P.a, P.n);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder((SHAFT_H + 0.8) / 2, 0.95).setTranslation(wx, (SHAFT_H + 0.8) / 2, wz))));
  }
  const nameTex = canvasTexture(128, 1024, (g) => {
    g.fillStyle = '#8f908b';
    g.fillRect(0, 0, 128, 1024);
    g.fillStyle = '#1e4a3a';
    g.font = "800 92px 'Songti TC', 'PingFang TC', serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [...'國立雲林科技大學'].forEach((ch, i) => g.fillText(ch, 64, 70 + i * 120));
  }, tracker);
  add(new PlaneGeometry(0.62, 6.2), std(0xffffff, 0.75, { map: nameTex }), P.a, 0.8 + 6.4, P.n - 0.86, Math.PI).castShadow = false;
  const sculpture = std(0xc9cbc6, 0.6, { metalness: 0.15 });
  const top = 0.8 + SHAFT_H;
  for (const [x, y, z, r] of [[0, 0.7, 0, 0.9], [0.55, 1.1, 0.2, 0.6], [-0.5, 1.2, -0.25, 0.65], [0.1, 1.75, 0.35, 0.55], [-0.2, 1.9, -0.3, 0.5], [0.45, 1.7, -0.45, 0.45], [-0.55, 0.65, 0.45, 0.5]] as const) {
    add(new IcosahedronGeometry(r, 1), sculpture, P.a + x, top + y, P.n + z);
  }

  // --- Guardhouse between the in / out lanes.
  const G = GUARD;
  const W = 6.4, L = 12.6;
  box(W + 0.6, 0.5, L + 0.6, G.a, 0, G.n, std(0x8d8982, 0.9), true);
  box(W, 2.6, L, G.a, 0.5, G.n, std(0xe6e2da, 0.8), true);
  const glass = std(0x4f6675, 0.25, { metalness: 0.3 });
  box(W + 0.06, 1.35, L + 0.06, G.a, 1.25, G.n, glass);
  const mullion = std(0x5a5d60, 0.5, { metalness: 0.4 });
  for (let k = -L / 2 + 1.4; k < L / 2 - 0.5; k += 1.6) box(W + 0.12, 1.35, 0.1, G.a, 1.25, G.n + k, mullion);
  for (const k of [-1.6, 0, 1.6]) box(0.1, 1.35, L + 0.12, G.a + k, 1.25, G.n, mullion);
  box(W + 1.4, 0.3, L + 1.4, G.a, 3.1, G.n, std(0xf1efe9, 0.7));
  box(W + 1.5, 0.55, L + 1.5, G.a, 3.4, G.n, std(0x2f7d4f, 0.7));
  const signTex = canvasTexture(1024, 96, (g) => {
    g.fillStyle = '#2f7d4f';
    g.fillRect(0, 0, 1024, 96);
    g.fillStyle = '#fffdf6';
    g.font = "800 62px system-ui, 'PingFang TC', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('國立雲林科技大學  NATIONAL YUNLIN UNIVERSITY OF SCIENCE AND TECHNOLOGY', 512, 52, 1000);
  }, tracker);
  add(new PlaneGeometry(W + 1.4, 0.5), std(0xffffff, 0.6, { map: signTex }), G.a, 3.675, G.n - (L + 1.5) / 2 - 0.01, Math.PI).castShadow = false;
  // Flower beds at the road end and along the sides of the guardhouse island.
  box(W + 0.4, 0.45, 1.0, G.a, 0, G.n - L / 2 - 1.2, planterMat, true);
  box(W, 0.18, 0.8, G.a, 0.42, G.n - L / 2 - 1.2, flowerMat).castShadow = false;
  for (const s of [-1, 1]) {
    box(0.9, 0.4, L - 2, G.a + s * (W / 2 + 0.95), 0, G.n, planterMat, true);
    box(0.7, 0.16, L - 2.2, G.a + s * (W / 2 + 0.95), 0.38, G.n, flowerMat).castShadow = false;
  }

  // --- Boom barrier across the lane gap on the boundary line (the fence stops at the gate walls).
  const stripeTex = canvasTexture(256, 32, (g) => {
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 2 ? '#f4f2ea' : '#c8302a';
      g.fillRect(k * 32, 0, 32, 32);
    }
  }, tracker);
  stripeTex.wrapS = RepeatWrapping;
  stripeTex.repeat.set(4, 1);
  box(0.5, 1.1, 0.5, -11.4, 0, BARRIER_N, std(0xd9b420, 0.6), true);
  box(0.5, 1.1, 0.5, 16.4, 0, BARRIER_N, std(0xd9b420, 0.6), true);
  add(new BoxGeometry(27.4, 0.12, 0.12), std(0xffffff, 0.6, { map: stripeTex }), 2.5, 0.95, BARRIER_N);

  // --- Traffic signals at both corners, heads over the road.
  const poleMat = std(0x6f7377, 0.5, { metalness: 0.5 });
  const headMat = std(0x1c1d1f, 0.6);
  const lamp = (color: number): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.6 }));
  for (const [a, armDir] of [[-37.2, 1], [41.8, -1]] as const) {
    const n = 17.2;
    add(new CylinderGeometry(0.11, 0.13, 6, 10), poleMat, a, 3, n);
    {
      const [wx, wz] = toWorld(a, n);
      colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.15).setTranslation(wx, 3, wz))));
    }
    // Arm reaches out over the near carriageway; the head faces oncoming traffic.
    box(0.12, 0.12, 6, a, 5.7, n - 3, poleMat);
    const hn = n - 5.4;
    box(0.3, 0.36, 1.0, a, 5.25, hn, headMat);
    [0xd8322a, 0xf2b31b, 0x2fb35a].forEach((c, i) => box(0.05, 0.24, 0.24, a - armDir * 0.17, 5.31, hn + (i - 1) * 0.3, lamp(c)));
  }

  // --- Boulevard to the fountain: planted median with a tree row, street trees outside both lanes.
  const grassMat = std(0x5f9a45, 0.95, { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const kerb = std(0xc9c6bd, 0.85);
  box(6.4, 0.15, 36, 2, 0, 88, kerb, false); // between the two 8 m lanes
  paving([[-1.0, 70.2], [5.0, 70.2], [5.0, 105.8], [-1.0, 105.8]], grassMat, 4, 0.16);
  const trees: [number, number, number][] = []; // a, n, scale
  for (let n = 72; n <= 104; n += 8) trees.push([2, n, 1]);
  for (let n = 62; n <= 106; n += 7) trees.push([-13.5, n, 1.1], [17.5, n + 3, 1.1]);
  // Tree belt along the road on both sides of the gate, inside the boundary.
  for (let a = -100; a <= -30; a += 7) trees.push([a, 30, 1.25], [a + 3.5, 37, 1.15]);
  for (let a = 62; a <= 110; a += 7) trees.push([a, 30, 1.25], [a + 3.5, 37, 1.15]);
  const trunkGeo = tracker.geometry(new CylinderGeometry(0.22, 0.32, 3.2, 8).translate(0, 1.6, 0));
  const canopyGeo = tracker.geometry(mergeGeometries([
    new IcosahedronGeometry(2.4, 1).translate(0, 4.6, 0),
    new IcosahedronGeometry(1.8, 1).translate(1.3, 4.1, 0.6),
    new IcosahedronGeometry(1.7, 1).translate(-1.2, 4.3, -0.7),
    new IcosahedronGeometry(1.5, 1).translate(0.2, 5.8, -0.3),
  ])!);
  const trunkMesh = new InstancedMesh(trunkGeo, std(0x6b4f3a, 0.95), trees.length);
  const canopyMesh = new InstancedMesh(canopyGeo, std(0x3f7f35, 0.9, { flatShading: true }), trees.length);
  const tm = new Matrix4(), tq = new Quaternion(), tp = new Vector3(), ts = new Vector3(), tint = new Color();
  trees.forEach(([a, n, k], i) => {
    const jitter = Math.sin(a * 12.9898 + n * 78.233) * 0.5 + 0.5;
    tq.setFromAxisAngle(new Vector3(0, 1, 0), jitter * Math.PI * 2);
    const sc = k * (0.85 + jitter * 0.3);
    tm.compose(tp.set(a, 0, n), tq, ts.set(sc, sc, sc));
    trunkMesh.setMatrixAt(i, tm);
    canopyMesh.setMatrixAt(i, tm);
    canopyMesh.setColorAt(i, tint.setHSL(0.27 + jitter * 0.05, 0.42, 0.3 + jitter * 0.08));
    const [wx, wz] = toWorld(a, n);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(1.6 * sc, 0.3 * sc).setTranslation(wx, 1.6 * sc, wz))));
  });
  for (const m of [trunkMesh, canopyMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    root.add(m);
  }

  // --- Fountain at the head of the boulevard (Street View): a paved circle round a square pool
  // with chamfered corners, a low concrete rim, greenish water, a row of small jets, and three
  // flagpoles on the far side.
  const F = { a: 2, n: 129 };
  const ringPave = std(0xdedbd2, 0.85, { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  add(new CircleGeometry(10.4, 48).rotateX(-Math.PI / 2), ringPave, F.a, 0.066, F.n).castShadow = false;
  const POOL = 6, CHAMFER = 1.8, RIM = 0.45, RIM_H = 0.55;
  const outline = (h: number, c: number): Shape => {
    const sh = new Shape();
    sh.moveTo(-h + c, -h);
    for (const [x, y] of [[h - c, -h], [h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c]] as const) sh.lineTo(x, y);
    sh.closePath();
    return sh;
  };
  const rimShape = outline(POOL, CHAMFER);
  rimShape.holes.push(outline(POOL - RIM, CHAMFER * 0.8));
  add(new ExtrudeGeometry(rimShape, { depth: RIM_H, bevelEnabled: false }).rotateX(-Math.PI / 2), std(0xc9c6bd, 0.8), F.a, 0.04, F.n);
  add(new ShapeGeometry(outline(POOL - RIM, CHAMFER * 0.8)).rotateX(-Math.PI / 2), std(0x4f8a52, 0.12, { metalness: 0.2, emissive: new Color(0x173a1c), emissiveIntensity: 0.25 }), F.a, RIM_H - 0.12, F.n).castShadow = false;
  const spray = std(0xffffff, 0.2, { transparent: true, opacity: 0.55, depthWrite: false });
  for (const [da, dn, h] of [[-3, 0, 1.1], [-1.5, 0, 1.5], [0, 0, 2.2], [1.5, 0, 1.5], [3, 0, 1.1], [0, -2.5, 1.0], [0, 2.5, 1.0]] as const) {
    add(new ConeGeometry(0.16, h, 8, 1, true), spray, F.a + da, RIM_H - 0.1 + h / 2, F.n + dn).castShadow = false;
  }
  box(POOL * 2, RIM_H, POOL * 2, F.a, 0, F.n, std(0xc9c6bd, 0.8), true).visible = false;
  const pole = std(0xeeeeec, 0.4, { metalness: 0.5 });
  for (const da of [-3, 0, 3]) {
    add(new CylinderGeometry(0.06, 0.1, 11, 10), pole, F.a + da, 5.5, F.n + POOL + 2.2);
    add(new SphereGeometry(0.13, 10, 8), std(0xd8b545, 0.4, { metalness: 0.6 }), F.a + da, 11.05, F.n + POOL + 2.2);
    box(0.5, 0.3, 0.5, F.a + da, 0, F.n + POOL + 2.2, std(0xa9aaa5, 0.85), true);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
