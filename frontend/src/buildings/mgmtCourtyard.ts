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
 *  - a sunken moat (3.2 m deep) along its east edge under the plaza wall (dark glazed bays into the
 *    undercroft), lawns at brick level east of it, and the crossing in the site photo: granite steps
 *    down from the brick plaza to a landing over the moat, a red stair with red handrails up through
 *    the wall to the plaza, and granite stairs down to the moat floor either side of the landing;
 *  - at the garden's north end a quarter-circle amphitheatre stepping down to the garden floor;
 *  - a brick-paved plaza east of the garden with drainage grates and a manhole;
 *  - a free-standing concrete colonnade along the north edge.
 * The campus ground is cut open over the garden and amphitheatre (see courtPit), and the ground
 * collider is ignored there so the player can walk down.
 */
const D = -3.2; // garden floor
const PIT: readonly [number, number, number, number] = [7, -1, 38, 3]; // x0, y0, x1, y1: the moat
/** Edge of the brick plaza; lawns run from here to the moat. */
const BRICK_Y = -6;
/**
 * The crossing (photo of the east side): granite steps down from the brick plaza (`approach` steps)
 * to a landing at height `h` over the moat (to plan y `landing`), a red stair up through the plaza
 * wall (half-width `stair`), granite stairs down to the moat floor either side.
 */
const BR = { x: 23, half: 2.6, stair: 2.3, h: -0.9, landing: 1.0, approach: 5 };
const AMP = { x: 7, y: 3, r0: 4, r1: 12.5, steps: 16 };
/** No trees anywhere in the courtyard [x0, y0, x1, y1]. */
const COURT: readonly [number, number, number, number] = [-11, -15, 40.5, 42];
const ARC_SEG = 24;

function inPit(px: number, py: number): boolean {
  if (px >= PIT[0] && px <= PIT[2] && py >= PIT[1] && py <= PIT[3]) return true;
  if (Math.abs(px - BR.x) <= BR.half + 0.3 && py >= BRICK_Y && py <= PIT[1]) return true; // the approach
  return px <= AMP.x && py <= AMP.y && Math.hypot(px - AMP.x, py - AMP.y) <= AMP.r1;
}

/** Plan outline of the opening: garden rectangle plus the amphitheatre quadrant. */
function pitOutline(): [number, number][] {
  const pts: [number, number][] = [[PIT[2], PIT[1]], [PIT[2], PIT[3]], [AMP.x - AMP.r1, AMP.y]];
  for (let i = 1; i <= ARC_SEG; i++) {
    const t = Math.PI + (i / ARC_SEG) * (Math.PI / 2);
    pts.push([AMP.x + AMP.r1 * Math.cos(t), AMP.y + AMP.r1 * Math.sin(t)]);
  }
  pts.push([AMP.x, PIT[1]], [BR.x - BR.half - 0.3, PIT[1]], [BR.x - BR.half - 0.3, BRICK_Y], [BR.x + BR.half + 0.3, BRICK_Y], [BR.x + BR.half + 0.3, PIT[1]]);
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
  const terracotta = std({ color: 0xc2604a, roughness: 0.8 });
  const nosing = std({ color: 0xe0a080, roughness: 0.8 });
  const redSteel = std({ color: 0xa83a48, roughness: 0.45, metalness: 0.4 });
  // Speckled granite (the approach and landing).
  const graniteTex = canvasTex(tracker, 128, 128, (c) => {
    c.fillStyle = '#c9c8c4';
    c.fillRect(0, 0, 128, 128);
    speckle(c, 128, 128, 2600, ['#3d3d3f', '#ffffff', '#86868a', '#e8e6e0'], 23);
  });
  const granite = std({ map: graniteTex, roughness: 0.85 });
  const graniteEdge = std({ map: graniteTex, color: 0xdedcd6, roughness: 0.7 });
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
  slab([[40.4, -14], [-9, -14], [-9, 3], ...arc(Math.PI, 1.5 * Math.PI, AMP.r1), [AMP.x, BRICK_Y], [40.4, BRICK_Y]], 0.03, brick);

  // --- Sunken garden: a moat along the plaza wall, crossed by the granite approach and red stair ----
  const [GX0, , GX1] = PIT;
  const BX0 = BR.x - BR.half, BX1 = BR.x + BR.half; // landing / approach
  const CH = 0.3; // cheek walls beside the approach
  box(concrete, GX0, GX1, D - 0.3, D, PIT[1], PIT[3], true); // floor
  slab([[GX0, PIT[1]], [GX1, PIT[1]], [GX1, 3], [GX0, 3]], D + 0.01, tile); // moat paving
  // West wall under the plaza (with parapet), open where the red stair climbs through.
  const SX0 = BR.x - BR.stair, SX1 = BR.x + BR.stair;
  box(concrete, AMP.x - AMP.r1, SX0 - 0.3, D, 0.95, 3, 3.3, true);
  box(concrete, SX1 + 0.3, GX1 + 0.3, D, 0.95, 3, 3.3, true);
  // Undercroft: dark glazed bays in the wall on both sides of the stair.
  for (const x of [11.5, 15.5, 30.5, 34.5]) {
    const m = add(new BoxGeometry(3.2, 2.3, 0.02).translate(x, D + 1.25, 2.985), dark, false);
    m.receiveShadow = false;
    box(concrete, x - 1.75, x - 1.6, D, D + 2.55, 2.85, 3);
    box(concrete, x + 1.6, x + 1.75, D, D + 2.55, 2.85, 3);
    box(concrete, x - 1.75, x + 1.75, D + 2.4, D + 2.55, 2.85, 3);
    for (const dx of [-0.55, 0.55]) box(steel, x + dx - 0.03, x + dx + 0.03, D + 0.1, D + 2.4, 2.95, 2.99); // mullions
  }
  // South end wall, the east retaining wall (lawn above) and the amphitheatre's edge.
  box(concrete, GX1, GX1 + 0.3, D, 0.95, PIT[1] - 0.3, 3.3, true);
  box(concrete, GX0, BX0 - CH, D, 0.12, PIT[1] - 0.3, PIT[1], true);
  box(concrete, BX1 + CH, GX1, D, 0.12, PIT[1] - 0.3, PIT[1], true);
  box(concrete, AMP.x - 0.25, AMP.x, D, 0.12, AMP.y - AMP.r1, PIT[1], true);
  // Lawns at brick level between the brick plaza and the moat, either side of the approach.
  for (const [x0, x1] of [[GX0, BX0 - CH], [BX1 + CH, GX1]] as const) {
    box(concrete, x0, x1, 0, 0.1, BRICK_Y, PIT[1] - 0.3);
    box(grass, x0 + 0.12, x1 - 0.12, 0.1, 0.12, BRICK_Y + 0.12, PIT[1] - 0.42);
  }
  // Steel railing along the lawn edge above the moat.
  for (const [x0, x1] of [[GX0, BX0 - CH], [BX1 + CH, GX1]] as const) {
    for (let x = x0 + 0.1; x <= x1 - 0.05; x += 1.5) box(steel, x - 0.025, x + 0.025, 0.12, 1.05, PIT[1] - 0.2, PIT[1] - 0.15);
    box(steel, x0 + 0.1, x1 - 0.1, 1.0, 1.05, PIT[1] - 0.21, PIT[1] - 0.14);
  }

  // Granite approach from the brick plaza: broad steps down to the landing over the moat.
  const steps = new Soup();
  const flat = (xa: number, xb: number, ya: number, yb: number, h: number): void => steps.quad([xa, h, ya], [xa, h, yb], [xb, h, yb], [xb, h, ya]);
  const riser = (xa: number, xb: number, y: number, h0: number, h1: number): void => steps.quad([xa, h0, y], [xb, h0, y], [xb, h1, y], [xa, h1, y]);
  const ARISE = -BR.h / BR.approach, ATREAD = (PIT[1] - BRICK_Y) / BR.approach;
  for (let i = 0; i < BR.approach; i++) {
    const ya = BRICK_Y + i * ATREAD, h = -(i + 1) * ARISE;
    box(granite, BX0, BX1, D, h, ya, ya + ATREAD, false);
    box(graniteEdge, BX0, BX1, h - 0.04, h + 0.003, ya, ya + 0.12);
    riser(BX0, BX1, ya, h + ARISE, h);
    flat(BX0, BX1, ya, ya + ATREAD, h);
  }
  for (const x of [BX0 - CH, BX1]) box(granite, x, x + CH, D, 0.16, BRICK_Y, PIT[1], true); // cheek walls
  // The landing: a granite deck on a solid pier, stairs down to the moat on both sides.
  const LY1 = BR.landing;
  box(concrete, BX0, BX1, D, BR.h - 0.12, PIT[1], LY1, true);
  box(granite, BX0, BX1, BR.h - 0.12, BR.h, PIT[1], LY1);
  box(graniteEdge, BX0, BX1, BR.h - 0.12, BR.h + 0.003, LY1 - 0.12, LY1);
  flat(BX0, BX1, PIT[1], LY1, BR.h);
  const SIDE = { y1: PIT[1] + 1.25, n: 13, tread: 0.32 };
  const srise = (BR.h - D) / SIDE.n;
  for (const dir of [-1, 1] as const) {
    const x0 = dir < 0 ? BX0 : BX1;
    for (let i = 0; i < SIDE.n; i++) {
      const xa = x0 + dir * i * SIDE.tread, xb = xa + dir * SIDE.tread, h = BR.h - (i + 1) * srise;
      box(granite, Math.min(xa, xb), Math.max(xa, xb), D, h, PIT[1], SIDE.y1);
      steps.quad([xa, h + srise, PIT[1]], [xa, h + srise, SIDE.y1], [xa, h, SIDE.y1], [xa, h, PIT[1]]);
      steps.quad([xa, h, PIT[1]], [xa, h, SIDE.y1], [xb, h, SIDE.y1], [xb, h, PIT[1]]);
    }
  }
  // Red stair from the landing up through the wall to the plaza, between planted cheek walls.
  const RN = 6, RTREAD = (3.3 - LY1) / RN, RRISE = -BR.h / RN;
  for (let i = 0; i < RN; i++) {
    const ya = LY1 + i * RTREAD, h = BR.h + (i + 1) * RRISE;
    box(concrete, SX0, SX1, D, h - 0.06, ya, ya + RTREAD);
    box(terracotta, SX0, SX1, h - 0.06, h, ya, ya + RTREAD);
    box(nosing, SX0, SX1, h - 0.065, h + 0.004, ya, ya + 0.07);
    riser(SX0, SX1, ya, h - RRISE, h);
    flat(SX0, SX1, ya, ya + RTREAD, h);
  }
  box(terracotta, SX0, SX1, -0.06, 0.03, 3.3, 3.9); // top landing into the plaza
  for (const x of [SX0 - 0.3, SX1]) {
    box(concrete, x, x + 0.3, D, 0.95, LY1, 3.3, true);
    box(concrete, x, x + 0.3, 0, 0.95, 3.3, 4.6, true);
  }
  for (const [x0, x1] of [[SX0 - 2.4, SX0 - 0.3], [SX1 + 0.3, SX1 + 2.4]] as const) {
    box(concrete, x0, x1, 0, 0.7, 3.3, 4.6, true);
    box(grass, x0 + 0.12, x1 - 0.12, 0.7, 0.72, 3.42, 4.48);
  }
  trimesh(steps);
  // Red handrails: both sides of the red stair, the landing's open edges and the side stairs.
  const rail = (xa: number, ya: number, ha: number, xb: number, yb: number, hb: number): void => {
    const len = Math.hypot(xb - xa, yb - ya), n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = xa + (xb - xa) * t, y = ya + (yb - ya) * t, h = ha + (hb - ha) * t;
      box(redSteel, x - 0.03, x + 0.03, h, h + 0.95, y - 0.03, y + 0.03);
    }
    const run = Math.hypot(xb - xa, yb - ya), geo = new BoxGeometry(Math.hypot(run, hb - ha), 0.05, 0.05)
      .rotateZ(Math.atan2(hb - ha, run)).rotateY(-Math.atan2(yb - ya, xb - xa)).translate((xa + xb) / 2, (ha + hb) / 2 + 0.95, (ya + yb) / 2);
    add(geo, redSteel);
  };
  for (const x of [SX0 + 0.1, SX1 - 0.1]) rail(x, LY1, BR.h, x, 3.3, 0);
  for (const dir of [-1, 1] as const) {
    const x0 = dir < 0 ? BX0 : BX1, x1 = x0 + dir * SIDE.n * SIDE.tread;
    rail(x0, LY1 - 0.05, BR.h, x0, SIDE.y1, BR.h); // landing edge beyond the side stair
    rail(x0, SIDE.y1, BR.h, x1, SIDE.y1, D); // open side of the side stair
    solid(Math.min(x0, x1), Math.max(x0, x1), D, BR.h + 1, SIDE.y1, SIDE.y1 + 0.05);
    solid(x0 - 0.03, x0 + 0.03, BR.h, BR.h + 1, SIDE.y1, LY1);
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
  for (const [x0, x1, y0, y1, h] of [[10.5, 15.5, 3.4, 7.4, 0.3], [15.5, 17.8, 3.4, 6.2, 0.18], [26, 32, 36.5, 41, 0.3], [2.5, 6.5, 26, 31, 0.24]] as const) {
    box(wood, x0, x1, 0, h, y0, y1, true);
  }
  // Planters with shrubs along the garden parapet (south end, as in the photos).
  const shrubGeo = new IcosahedronGeometry(0.55, 0);
  const shrubs: BufferGeometry[] = [];
  for (let x = 27.8; x < 37.5; x += 4.2) {
    box(concrete, x, x + 3.6, 0, 0.7, 3.3, 4.6, true);
    box(grass, x + 0.12, x + 3.48, 0.7, 0.72, 3.42, 4.48);
    for (let k = 0; k < 3; k++) shrubs.push(shrubGeo.clone().scale(1.1, 0.8, 1).translate(x + 0.65 + k * 1.15, 1.0, 3.95));
  }
  add(mergeGeometries(shrubs) ?? shrubGeo, shrub);

  // --- Drainage grates and a manhole on the brick plaza --------------------------------------------
  box(grating, GX0 + 0.3, GX1, 0.03, 0.045, BRICK_Y - 0.85, BRICK_Y - 0.3);
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
