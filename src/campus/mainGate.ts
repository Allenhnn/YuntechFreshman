import {
  BoxGeometry,
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

  // --- Forecourt: red brick from the kerb to the guardhouse, white lane markings.
  const brickTex = canvasTexture(256, 256, bricks, tracker);
  brickTex.wrapS = brickTex.wrapT = RepeatWrapping;
  const brick = std(0xffffff, 0.92, { map: brickTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const paving = (a0: number, a1: number, n0: number, n1: number): void => {
    const g = new PlaneGeometry(a1 - a0, n1 - n0).rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (a1 - a0)) / 2.4, (uv.getY(i) * (n1 - n0)) / 2.4);
    const m = add(g, brick, (a0 + a1) / 2, 0.065, (n0 + n1) / 2);
    m.castShadow = false;
  };
  paving(-38, 46, 4.5, 24.5);
  paving(-14, 18, 24.5, 55);
  const white = std(0xf4f2ea, 0.7, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mark = (w: number, d: number, a: number, n: number): void => {
    add(new PlaneGeometry(w, d).rotateX(-Math.PI / 2), white, a, 0.07, n).castShadow = false;
  };
  mark(30, 0.4, 2, 6.5); // stop line
  for (let n = 9; n < 52; n += 4) mark(0.18, 2, GUARD.a, n < 38 ? n : n + 20); // centre dashes up to the guardhouse
  for (const [a, n] of [[-6, 14], [10, 14], [-6, 30], [10, 30]] as const) {
    mark(0.35, 2.4, a, n); // lane arrows: shaft + head
    add(new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), white, a, 0.07, n + 1.4).castShadow = false;
  }

  // --- Low walls with flower planters along the road.
  const concrete = std(0xbdb9b1, 0.9);
  const capMat = std(0xd2cfc8, 0.8);
  const planterMat = std(0x9d9a93, 0.9);
  const flowerTex = canvasTexture(128, 128, flowers, tracker);
  flowerTex.wrapS = flowerTex.wrapT = RepeatWrapping;
  const flowerMat = std(0xffffff, 0.95, { map: flowerTex });
  const WALL_N = 24.6;
  const wall = (a0: number, a1: number): void => {
    const w = a1 - a0, mid = (a0 + a1) / 2;
    box(w, 1.7, 0.6, mid, 0, WALL_N, concrete, true);
    box(w + 0.1, 0.1, 0.7, mid, 1.7, WALL_N, capMat);
    box(w - 0.4, 0.45, 0.9, mid, 0, WALL_N - 0.85, planterMat, true);
    const f = box(w - 0.6, 0.18, 0.7, mid, 0.42, WALL_N - 0.85, flowerMat);
    f.castShadow = false;
  };
  wall(-38, -27.5);
  wall(-21, -12);
  wall(17, 27);
  wall(29, 46);

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
  const plate = add(new PlaneGeometry(6.4, 1.0), std(0xffffff, 0.6, { map: plateTex }), -16.5, 1.05, WALL_N - 0.31, Math.PI);
  plate.castShadow = false;

  // --- Name pillar with the sculpture on top.
  const stone = std(0xa9aaa5, 0.85);
  const P = { a: -24.2, n: 21.8 };
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
  box(0.5, 1.1, 0.5, -11.4, 0, WALL_N, std(0xd9b420, 0.6), true);
  box(0.5, 1.1, 0.5, 16.4, 0, WALL_N, std(0xd9b420, 0.6), true);
  add(new BoxGeometry(27.4, 0.12, 0.12), std(0xffffff, 0.6, { map: stripeTex }), 2.5, 0.95, WALL_N);

  // --- Traffic signals at both corners, heads over the road.
  const poleMat = std(0x6f7377, 0.5, { metalness: 0.5 });
  const headMat = std(0x1c1d1f, 0.6);
  const lamp = (color: number): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.6 }));
  for (const [a, armDir] of [[-36.5, 1], [44.5, -1]] as const) {
    const n = 5.2;
    add(new CylinderGeometry(0.11, 0.13, 6, 10), poleMat, a, 3, n);
    {
      const [wx, wz] = toWorld(a, n);
      colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.15).setTranslation(wx, 3, wz))));
    }
    box(5.2, 0.12, 0.12, a + armDir * 2.6, 5.7, n, poleMat);
    const ha = a + armDir * 4.6;
    box(1.0, 0.36, 0.3, ha, 5.25, n, headMat);
    [0xd8322a, 0xf2b31b, 0x2fb35a].forEach((c, i) => box(0.24, 0.24, 0.05, ha + (i - 1) * 0.3, 5.31, n - 0.17, lamp(c)));
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
