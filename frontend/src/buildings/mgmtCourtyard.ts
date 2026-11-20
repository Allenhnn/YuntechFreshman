import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
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
import type { BuildingSource } from './buildingTypes';
import type { HandBuiltBuilding } from './buildingWorld';
import { createPlanTransform } from './planTransform';

/**
 * 管理學院中庭: the courtyard between 管理一館, 二館 and 三館, laid out in 管理二館's plan frame
 * (plan +x runs south, plan +y runs west) after the handbook 1F plan and the site photos:
 *  - a white grid-tiled plaza in the crook of 二館's L, with a round emblem plaza, lawns,
 *    timber decks and planters;
 *  - a sunken garden (3.2 m deep) along its east edge: a walkway at the bottom under the plaza wall
 *    (dark doorways into the undercroft), stepped grass terraces rising east, and a terracotta
 *    stair with a half landing down from the plaza;
 *  - at the garden's north end a quarter-circle amphitheatre stepping down to the garden floor;
 *  - a brick-paved plaza east of the garden with drainage grates and a manhole;
 *  - a free-standing concrete colonnade along the north edge.
 * The campus ground is cut open over the garden and amphitheatre (see courtPit), and the ground
 * collider is ignored there so the player can walk down.
 */
const D = -3.2; // garden floor
const PIT: readonly [number, number, number, number] = [7, -6, 38, 3]; // x0, y0, x1, y1
const AMP = { x: 7, y: 3, r0: 4, r1: 12.5, steps: 16 };
const WALK_Y = 0.4; // walkway y ∈ [WALK_Y, 3]; terraces y ∈ [-6, WALK_Y]
/** No trees anywhere in the courtyard [x0, y0, x1, y1]. */
const COURT: readonly [number, number, number, number] = [-11, -15, 40.5, 42];
const ARC_SEG = 24;

function inPit(px: number, py: number): boolean {
  if (px >= PIT[0] && px <= PIT[2] && py >= PIT[1] && py <= PIT[3]) return true;
  return px <= AMP.x && py <= AMP.y && Math.hypot(px - AMP.x, py - AMP.y) <= AMP.r1;
}

/** Plan outline of the opening: garden rectangle plus the amphitheatre quadrant. */
function pitOutline(): [number, number][] {
  const pts: [number, number][] = [[PIT[2], PIT[1]], [PIT[2], PIT[3]], [AMP.x - AMP.r1, AMP.y]];
  for (let i = 1; i <= ARC_SEG; i++) {
    const t = Math.PI + (i / ARC_SEG) * (Math.PI / 2);
    pts.push([AMP.x + AMP.r1 * Math.cos(t), AMP.y + AMP.r1 * Math.sin(t)]);
  }
  pts.push([AMP.x, PIT[1]]);
  return pts;
}

/** World-space opening for the campus ground, a point test for the ground collider, and the no-tree ring. */
export function courtPit(src: BuildingSource): { rings: Ring[]; contains(x: number, z: number): boolean; treeFree: Ring } {
  const xf = createPlanTransform(src);
  const [x0, y0, x1, y1] = COURT;
  return {
    rings: [pitOutline().flatMap(([x, y]) => xf.toWorld(x, y))],
    contains(x, z) {
      const [px, py] = xf.toPlan(x, z);
      return inPit(px, py);
    },
    treeFree: [...xf.toWorld(x0, y0), ...xf.toWorld(x1, y0), ...xf.toWorld(x1, y1), ...xf.toWorld(x0, y1)],
  };
}

/** Triangle soup in group-local coordinates (x = plan x, y up, z = plan y), shared by meshes and trimesh colliders. */
export class Soup {
  readonly p: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[]): void {
    this.p.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  geometry(uvScale = 1): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    const uv: number[] = [];
    for (let i = 0; i < this.p.length; i += 3) uv.push(this.p[i]! / uvScale, this.p[i + 2]! / uvScale);
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

export function canvasTex(tracker: ResourceTracker, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], seed: number): void {
  let s = seed;
  const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length]!;
    g.globalAlpha = 0.15 + r() * 0.3;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalAlpha = 1;
}

export function createMgmtCourtyard(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, mb: HandBuiltBuilding): { dispose(): void } {
  const [ox, oz] = mb.planToWorld(0, 0), [px1, pz1] = mb.planToWorld(1, 0);
  const yaw = -Math.atan2(pz1 - oz, px1 - ox);
  const g = new Group();
  g.name = 'MGMT courtyard';
  g.position.set(ox, 0, oz);
  g.rotation.y = yaw; // local +x = plan +X, local +z = plan +Y
  scene.add(g);
  const colliders: RAPIER.Collider[] = [];
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
  /** Axis-aligned solid in plan coordinates: x range, y (height) range, plan-y range. */
  const solid = (x0: number, x1: number, h0: number, h1: number, y0: number, y1: number): void => {
    const [wx, wz] = mb.planToWorld((x0 + x1) / 2, (y0 + y1) / 2);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (h1 - h0) / 2, (y1 - y0) / 2).setTranslation(wx, (h0 + h1) / 2, wz).setRotation(rot),
    )));
  };
  const trimesh = (soup: Soup): void => {
    const v = new Float32Array(soup.p.length);
    for (let i = 0; i < soup.p.length; i += 3) {
      const [wx, wz] = mb.planToWorld(soup.p[i]!, soup.p[i + 2]!);
      v[i] = wx;
      v[i + 1] = soup.p[i + 1]!;
      v[i + 2] = wz;
    }
    const idx = new Uint32Array(v.length / 3).map((_, i) => i);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.trimesh(v, idx))));
  };

  // --- Materials ---------------------------------------------------------------------------------
  const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ side: DoubleSide, ...o }));
  const concreteTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#b9b7b0';
    c.fillRect(0, 0, 128, 128);
    speckle(c, 128, 128, 900, ['#8d8b85', '#d3d0c8', '#77756f'], 7);
  });
  const concrete = std({ map: concreteTex, roughness: 0.9 });
  // White mosaic squares framed by grey bands, one 3 m bay per repeat.
  const tileTex = canvasTex(tracker, 256, 256, (c) => {
    c.fillStyle = '#8f9192';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#e9e9e4';
    c.fillRect(14, 14, 228, 228);
    c.strokeStyle = 'rgba(150,150,145,0.55)';
    c.lineWidth = 1;
    for (let i = 14; i <= 242; i += 9.5) {
      c.beginPath(); c.moveTo(i, 14); c.lineTo(i, 242); c.stroke();
      c.beginPath(); c.moveTo(14, i); c.lineTo(242, i); c.stroke();
    }
    speckle(c, 256, 256, 600, ['#a9aaa6', '#ffffff', '#6f7172'], 11);
  });
  tileTex.repeat.set(1 / 3, 1 / 3);
  const tile = std({ map: tileTex, roughness: 0.7 });
  // Worn red-brown concrete pavers in a broken bond.
  const brickTex = canvasTex(tracker, 256, 256, (c) => {
    c.fillStyle = '#4a3a36';
    c.fillRect(0, 0, 256, 256);
    let s = 3;
    const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    const tones = ['#7b5a52', '#6a4b45', '#8a6a5f', '#5d4641', '#94786b', '#735950'];
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 9; col++) {
        const x = col * 32 + (row % 2) * 16, y = row * 16;
        c.fillStyle = tones[Math.floor(r() * tones.length)]!;
        c.fillRect(x + 1, y + 1, 30, 14);
      }
    }
    speckle(c, 256, 256, 800, ['#2f2523', '#a08a80'], 5);
  });
  brickTex.repeat.set(1 / 4, 1 / 4);
  const brick = std({ map: brickTex, roughness: 0.95 });
  const grassTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#4f8a3a';
    c.fillRect(0, 0, 128, 128);
    speckle(c, 128, 128, 1500, ['#3e7330', '#6aa84c', '#2f5f25', '#7dbb5a'], 13);
  });
  grassTex.repeat.set(1 / 2, 1 / 2);
  const grass = std({ map: grassTex, roughness: 1 });
  const woodTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#b97a55';
    c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      c.fillStyle = 'rgba(70,40,25,0.55)';
      c.fillRect(0, y, 128, 2);
    }
    speckle(c, 128, 128, 500, ['#9c6243', '#d39a72'], 17);
  });
  woodTex.repeat.set(1 / 1.6, 1 / 1.6);
  const wood = std({ map: woodTex, roughness: 0.75 });
  const terracotta = std({ color: 0xb85a3c, roughness: 0.8 });
  const steel = std({ color: 0xa6abaf, roughness: 0.35, metalness: 0.7 });
  const dark = std({ color: 0x15171a, roughness: 0.9 });
  const gratingTex = canvasTex(tracker, 64, 64, (c) => {
    c.fillStyle = '#2a2d30';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#8c9296';
    for (let i = 0; i < 64; i += 6) c.fillRect(i, 0, 2, 64);
    c.fillRect(0, 0, 64, 3);
    c.fillRect(0, 32, 64, 2);
  });
  gratingTex.repeat.set(1 / 0.6, 1 / 0.6);
  const grating = std({ map: gratingTex, roughness: 0.5, metalness: 0.5 });
  const shrub = std({ color: 0x3f7a33, roughness: 0.9, flatShading: true });
  const emblemTex = canvasTex(tracker, 512, 512, (c) => {
    c.fillStyle = '#c9c8c2';
    c.beginPath(); c.arc(256, 256, 256, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,120,115,0.6)'; // cobble ring
    for (let r = 214; r < 256; r += 10) { c.beginPath(); c.arc(256, 256, r, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#6f706c'; c.lineWidth = 6;
    c.beginPath(); c.arc(256, 256, 212, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#e4e3dd';
    c.beginPath(); c.arc(256, 256, 208, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(160,160,155,0.5)'; c.lineWidth = 1;
    for (let i = 48; i < 470; i += 9) { c.beginPath(); c.moveTo(i, 40); c.lineTo(i, 472); c.stroke(); c.beginPath(); c.moveTo(40, i); c.lineTo(472, i); c.stroke(); }
    // The emblem: a red-brick band with a teal chevron across it.
    c.fillStyle = '#c47a5c';
    c.fillRect(120, 150, 272, 210);
    c.fillStyle = '#8fb3a4';
    c.beginPath(); c.moveTo(120, 300); c.lineTo(200, 220); c.lineTo(256, 270); c.lineTo(312, 220); c.lineTo(392, 300); c.lineTo(392, 360); c.lineTo(312, 280); c.lineTo(256, 330); c.lineTo(200, 280); c.lineTo(120, 360); c.closePath(); c.fill();
    c.fillStyle = '#ffffff';
    c.fillRect(150, 196, 120, 6);
    speckle(c, 512, 512, 2500, ['#8a8a85', '#ffffff', '#4d4d4a'], 19);
  });
  emblemTex.wrapS = emblemTex.wrapT = ClampToEdgeWrapping;
  const emblem = std({ map: emblemTex, roughness: 0.75 });

  // --- Merged boxes per material ----------------------------------------------------------------
  const boxes = new Map<Material, BufferGeometry[]>();
  /** Box from plan x0..x1, height h0..h1, plan y0..y1 (visual); `solidToo` adds a collider. */
  const box = (m: Material, x0: number, x1: number, h0: number, h1: number, y0: number, y1: number, solidToo = false): void => {
    const geo = new BoxGeometry(x1 - x0, h1 - h0, y1 - y0).translate((x0 + x1) / 2, (h0 + h1) / 2, (y0 + y1) / 2);
    // Planar UVs in metres for the tiled materials.
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      const u = nx > 0.5 ? pos.getZ(i) : pos.getX(i), v = ny > 0.5 ? pos.getZ(i) : pos.getY(i);
      uv.setXY(i, u, v);
    }
    const list = boxes.get(m);
    if (list) list.push(geo);
    else boxes.set(m, [geo]);
    if (solidToo) solid(x0, x1, h0, h1, y0, y1);
  };
  const add = (geo: BufferGeometry, m: Material, shadow = true): Mesh => {
    const mesh = new Mesh(tracker.geometry(geo), m);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    g.add(mesh);
    return mesh;
  };
  /** Flat slab from a plan polygon at height h (shape in (x, -y) so rotateX(-90°) lands it on plan y). */
  const slab = (pts: readonly (readonly [number, number])[], h: number, m: Material, holes: (readonly (readonly [number, number])[])[] = []): void => {
    const s = new Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
    s.closePath();
    for (const hole of holes) {
      const p = new Path();
      hole.forEach(([x, y], i) => (i ? p.lineTo(x, -y) : p.moveTo(x, -y)));
      p.closePath();
      s.holes.push(p);
    }
    add(new ShapeGeometry(s).rotateX(-Math.PI / 2).translate(0, h, 0), m, false);
  };

  // --- Paving --------------------------------------------------------------------------------------
  const arc = (from: number, to: number, r: number, n = ARC_SEG): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n;
      return [AMP.x + r * Math.cos(t), AMP.y + r * Math.sin(t)] as [number, number];
    });
  // Tiled plaza over the crook of the L (west of the garden).
  slab([[-10, 3], [40.4, 3], [40.4, 41.8], [-10, 41.8]], 0.03, tile);
  // Brick plaza: east of the garden and round the amphitheatre to the north-east corner.
  slab([[40.4, -14], [-9, -14], [-9, 3], ...arc(Math.PI, 1.5 * Math.PI, AMP.r1), [AMP.x, PIT[1]], [40.4, PIT[1]]], 0.03, brick);

  // --- Sunken garden -----------------------------------------------------------------------------
  const [GX0, GY0, GX1] = PIT;
  box(concrete, GX0, GX1, D - 0.3, D, GY0, PIT[3], true); // floor
  slab([[GX0, WALK_Y], [GX1, WALK_Y], [GX1, 3], [GX0, 3]], D + 0.01, tile); // walkway paving
  // West wall under the plaza (with parapet), stair-top gap at x 7.4–9.
  box(concrete, AMP.x - AMP.r1, 7.4, D, 0.95, 3, 3.3, true);
  box(concrete, 9, GX1 + 0.3, D, 0.95, 3, 3.3, true);
  box(concrete, 7.4, 9, D, 0.03, 3, 3.3);
  // Undercroft doorways: dark recesses in the wall.
  for (const x of [22.5, 28.5, 34.5]) {
    const m = add(new BoxGeometry(2.4, 2.4, 0.02).translate(x, D + 1.2, 2.985), dark, false);
    m.receiveShadow = false;
    box(concrete, x - 1.35, x - 1.2, D, D + 2.55, 2.85, 3);
    box(concrete, x + 1.2, x + 1.35, D, D + 2.55, 2.85, 3);
    box(concrete, x - 1.35, x + 1.35, D + 2.4, D + 2.55, 2.85, 3);
  }
  // South end wall and the east curb.
  box(concrete, GX1, GX1 + 0.3, D, 0.95, GY0 - 0.25, 3.3, true);
  box(concrete, GX0, GX1, -0.75, 0.12, GY0 - 0.25, GY0, true);
  box(concrete, AMP.x - 0.25, AMP.x, D, 0.12, AMP.y - AMP.r1, GY0, true); // where the amphitheatre meets the brick plaza
  // Grass terraces rising east: concrete boxes with a grass top inset.
  const tiers: [number, number, number][] = [[-1.2, WALK_Y, -2.6], [-2.8, -1.2, -2.0], [-4.4, -2.8, -1.35], [GY0, -4.4, -0.7]];
  for (const [y0, y1, top] of tiers) {
    box(concrete, GX0, GX1, D, top, y0, y1, true);
    box(grass, GX0 + 0.15, GX1 - 0.15, top, top + 0.04, y0 + 0.14, y1 - 0.14);
  }
  // Terracotta stair against the west wall: top landing, flight, half landing, flight.
  const SY0 = 1.6, SY1 = 2.98;
  box(concrete, 7.4, 9, D, 0.03, SY0, SY1, true);
  box(terracotta, 7.4, 9, -0.05, 0.03, SY0, SY1);
  const stairs = new Soup();
  const flight = (x0: number, h0: number, n: number): number => {
    const tread = 0.45, rise = 1.6 / n;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * tread, xb = xa + tread, h = h0 - (i + 1) * rise;
      box(terracotta, xa, xb, h - 0.08, h, SY0, SY1);
      stairs.quad([xa, h + rise, SY0], [xa, h + rise, SY1], [xa, h, SY1], [xa, h, SY0]);
      stairs.quad([xa, h, SY0], [xa, h, SY1], [xb, h, SY1], [xb, h, SY0]);
    }
    return x0 + n * tread;
  };
  const midX = flight(9, 0, 10);
  box(terracotta, midX, midX + 1.5, -1.68, -1.6, SY0, SY1);
  box(concrete, midX, midX + 1.5, D, -1.68, SY1 - 0.3, SY1, true);
  stairs.quad([midX, -1.6, SY0], [midX, -1.6, SY1], [midX + 1.5, -1.6, SY1], [midX + 1.5, -1.6, SY0]);
  const endX = flight(midX + 1.5, -1.6, 10);
  trimesh(stairs);
  // Handrail on the open side: posts and a rail following each flight.
  for (const [xa, xb, ha, hb] of [[7.4, 9, 0, 0], [9, midX, 0, -1.6], [midX, midX + 1.5, -1.6, -1.6], [midX + 1.5, endX, -1.6, D]] as const) {
    const n = Math.max(1, Math.round((xb - xa) / 1.1));
    for (let i = 0; i <= n; i++) {
      const x = xa + ((xb - xa) * i) / n, h = ha + ((hb - ha) * i) / n;
      box(steel, x - 0.025, x + 0.025, h, h + 0.95, SY0 + 0.02, SY0 + 0.07);
    }
    const len = Math.hypot(xb - xa, hb - ha), ang = Math.atan2(hb - ha, xb - xa);
    const rail = new BoxGeometry(len, 0.05, 0.06).rotateZ(ang).translate((xa + xb) / 2, (ha + hb) / 2 + 0.95, SY0 + 0.045);
    add(rail, steel);
  }

  // --- Amphitheatre: concentric steps down to the garden floor ------------------------------------
  const amp = new Soup();
  const dr = (AMP.r1 - AMP.r0) / AMP.steps, rise = -D / AMP.steps;
  const pt = (r: number, t: number, h: number): number[] => [AMP.x + r * Math.cos(t), h, AMP.y + r * Math.sin(t)];
  for (let s = 0; s < ARC_SEG; s++) {
    const t0 = Math.PI + (s / ARC_SEG) * (Math.PI / 2), t1 = Math.PI + ((s + 1) / ARC_SEG) * (Math.PI / 2);
    amp.quad(pt(0, t0, D), pt(AMP.r0, t0, D), pt(AMP.r0, t1, D), pt(0, t1, D)); // floor fan
    for (let i = 0; i < AMP.steps; i++) {
      const ra = AMP.r0 + i * dr, rb = ra + dr, h = D + (i + 1) * rise;
      amp.quad(pt(ra, t0, h - rise), pt(ra, t1, h - rise), pt(ra, t1, h), pt(ra, t0, h)); // riser
      amp.quad(pt(ra, t0, h), pt(ra, t1, h), pt(rb, t1, h), pt(rb, t0, h)); // tread
    }
  }
  add(amp.geometry(1), concrete);
  trimesh(amp);
  // Bench-like lighter edges on every other tread.
  for (let i = 1; i < AMP.steps; i += 2) {
    const r = AMP.r0 + (i + 1) * dr - 0.06, h = D + (i + 1) * rise;
    const edge = new Soup();
    for (let s = 0; s < ARC_SEG; s++) {
      const t0 = Math.PI + (s / ARC_SEG) * (Math.PI / 2), t1 = Math.PI + ((s + 1) / ARC_SEG) * (Math.PI / 2);
      edge.quad(pt(r - 0.12, t0, h + 0.005), pt(r - 0.12, t1, h + 0.005), pt(r, t1, h + 0.005), pt(r, t0, h + 0.005));
    }
    add(edge.geometry(1), tile, false);
  }

  // --- On the plaza: emblem circle, lawns, decks, planters ----------------------------------------
  const disc = add(new CircleGeometry(7.5, 64).rotateX(-Math.PI / 2).translate(22, 0.05, 25), emblem, false);
  disc.renderOrder = 1;
  for (const [x0, x1, y0, y1] of [[32.5, 40.2, 5, 14.5], [32.5, 40.2, 31, 41.6], [-7, 2, 10, 22]] as const) {
    box(concrete, x0, x1, 0, 0.12, y0, y1);
    box(grass, x0 + 0.15, x1 - 0.15, 0.12, 0.14, y0 + 0.15, y1 - 0.15);
  }
  for (const [x0, x1, y0, y1, h] of [[10.5, 15.5, 3.4, 7.4, 0.3], [15.5, 19, 3.4, 6.2, 0.18], [26, 32, 36.5, 41, 0.3], [2.5, 6.5, 26, 31, 0.24]] as const) {
    box(wood, x0, x1, 0, h, y0, y1, true);
  }
  // Planters with shrubs along the garden parapet (south end, as in the photos).
  const shrubGeo = new IcosahedronGeometry(0.55, 0);
  const shrubs: BufferGeometry[] = [];
  for (let x = 25; x < 37.5; x += 4.2) {
    box(concrete, x, x + 3.6, 0, 0.7, 3.3, 4.6, true);
    box(grass, x + 0.12, x + 3.48, 0.7, 0.72, 3.42, 4.48);
    for (let k = 0; k < 3; k++) shrubs.push(shrubGeo.clone().scale(1.1, 0.8, 1).translate(x + 0.65 + k * 1.15, 1.0, 3.95));
  }
  add(mergeGeometries(shrubs) ?? shrubGeo, shrub);

  // --- Drainage grates and a manhole on the brick plaza --------------------------------------------
  box(grating, GX0 + 0.3, GX1, 0.03, 0.045, GY0 - 0.85, GY0 - 0.3);
  for (const x of [14, 26]) box(grating, x, x + 1.2, 0.03, 0.045, -12.6, -11.4);
  add(new CircleGeometry(0.55, 24).rotateX(-Math.PI / 2).translate(20, 0.05, -10), grating, false);

  // --- Colonnade: two rows of square columns under a deep slab with a railing, standing free --------
  const CX0 = -9.6, CX1 = -6.4, CY0 = -13, CY1 = 21, H = 4.4;
  for (let y = CY0 + 0.3; y <= CY1 - 0.3 + 1e-6; y += (CY1 - CY0 - 0.6) / 8) {
    for (const x of [CX0 + 0.3, CX1 - 0.3]) box(concrete, x - 0.28, x + 0.28, 0, H, y - 0.28, y + 0.28, true);
  }
  box(concrete, CX0, CX1, H, H + 0.25, CY0, CY1);
  for (const x of [CX0, CX1 - 0.3]) box(concrete, x, x + 0.3, H - 0.7, H + 0.9, CY0, CY1); // deep edge beams, upstand
  box(concrete, CX0, CX1, H - 0.7, H + 0.9, CY0, CY0 + 0.3);
  box(concrete, CX0, CX1, H - 0.7, H + 0.9, CY1 - 0.3, CY1);
  for (let y = CY0 + 0.6; y < CY1; y += 1.6) for (const x of [CX0 + 0.15, CX1 - 0.15]) box(steel, x - 0.025, x + 0.025, H + 0.9, H + 1.75, y - 0.025, y + 0.025);
  for (const x of [CX0 + 0.15, CX1 - 0.15]) box(steel, x - 0.03, x + 0.03, H + 1.72, H + 1.78, CY0, CY1);

  for (const [m, list] of boxes) add(mergeGeometries(list) ?? list[0]!, m);

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      g.removeFromParent();
    },
  };
}
