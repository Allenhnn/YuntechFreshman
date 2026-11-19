import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type MeshStandardMaterialParameters,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { BuildingSource } from './buildingTypes';
import { createPlanTransform } from './planTransform';
import frame from './yuntayFrame.json';

/**
 * 雲泰表演廳 outside, from photos of the building (the campus extrusion only gives a 7.2 m box):
 *  - the curved east front: a colonnade of square piers under a dark grey canopy band, standing on a
 *    raised walk with steps down to the plaza, globe lamp posts along the steps;
 *  - the auditorium drum rising above the 2-storey wings in light grey panels with a dark cornice,
 *    and the stage fly tower behind it;
 *  - the A門 portal on the south: a deep grey frame with 「雲泰表演廳 Yun Tay Performance Hall」;
 *  - the dark grey sign pylon by the south walk.
 * Laid out in the plan frame of the traced interior (scripts/floorplan/handbuilt/yuntay.py writes
 * yuntayFrame.json), so it stays in register with the rooms inside.
 *
 * Reading order: constants → geometry helpers → context (group, colliders, materials) → one
 * `add…` function per part → `createYuntayExterior`, which just calls them.
 */

// ---------------------------------------------------------------- frame (from yuntayFrame.json)
type Pt = [number, number];
/** x0, y0, x1, y1 in plan metres. */
type Rect = [number, number, number, number];

const PLAN = createPlanTransform({ transform: frame.transform as BuildingSource['transform'] });
const [CX, CY, R] = frame.outer as [number, number, number]; // the curved facade is this circle (plan)
const [ARC_X0, ARC_X1] = frame.arcX as Pt; // its extent along plan x
const FLY_TOWER = frame.flyTower as Rect;
const PORTAL_RECT = frame.portal as Rect;
const [PYLON_X, PYLON_Y] = frame.pylon as Pt;
/** Angle on the facade circle at plan x (0 = straight "up" the plan, +y towards the plan's top). */
const arcAngle = (x: number): number => Math.asin((x - CX) / R);
const ARC_T0 = arcAngle(ARC_X0), ARC_T1 = arcAngle(ARC_X1);

// ---------------------------------------------------------------- dimensions (m)
const SHELL = frame.shellHeight; // top of the two-storey wings
const DRUM_TOP = 11.6;
const FLY_TOP = 15.5;
/** Plan y of the drum's straight back wall (the same wall yuntay.py ends the rear gallery at). */
const DRUM_BACK_Y = 120.5;
const DRUM_SKIN = 0.02; // the drum's front sits this far outside the facade circle
const CORNICE = { out: 0.15, below: 0.7, above: 0.3 };
const WING_REVEAL = { inset: -0.1, height: 0.6 }; // dark reveal where the drum meets the wings' roof
const CAP = { overhang: 0.3, height: 0.5, lift: 0.05 }; // fly tower's dark cap

/** One storey-less course of the light grey cladding. */
const COURSE = { width: 1.2, height: 0.9 };

const ARC_MARGIN = 0.012; // the colonnade stops this far (rad) short of the facade's ends
const WALK = 3.0; // raised walk under the canopy, depth outward from the facade
const STEP = 0.4; // tread depth of the steps down to the plaza
const RISE = 0.15; // riser height
const FLOOR = 0.45; // walk surface height
const WALK_END = WALK + 2 * STEP;
/** Walk and the two steps below it: depth range from the facade and surface height. */
const TIERS = [
  { from: 0, to: WALK, top: FLOOR },
  { from: WALK, to: WALK + STEP, top: FLOOR - RISE },
  { from: WALK + STEP, to: WALK_END, top: FLOOR - 2 * RISE },
] as const;
const CANOPY = { under: 4.6, top: 5.4 };
const PIER = { size: 0.7, spacing: 4.4, offset: 2.3, inset: 0.006 }; // offset: depth from the facade
const LAMP = {
  every: 3, phase: 1, // a lamp in front of every 3rd pier, starting at the 2nd
  outset: 0.8, // beyond the lowest step
  base: 0.6, baseH: 0.45, poleH: 3.6, poleTop: 0.09, poleBottom: 0.12,
  globeR: 0.24, globeRest: 0.22, // the globe sits 0.02 m into the pole's top
  colliderH: 4.4,
};
const PORTAL = { post: 0.8, out: 0.9, top: 6.8, lintelBottom: 5.0 };
const PYLON = { w: 1.1, h: 4.6, d: 0.45, colliderPad: 0.005 };

// ---------------------------------------------------------------- tessellation
const DRUM_SEGMENTS = 72;
const COLONNADE_SEGMENTS = 96;
const COLLIDER_SEGMENTS = 64;

// ---------------------------------------------------------------- colours
const COLOUR = { dark: 0x5e6265, pier: 0xc9cbca, paving: 0xb8b5ae, roof: 0xa9aaa6, canopyUnder: 0x7a7e81, frame: 0x6b6f72, pylon: 0x5a5754 };
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

const NAME_ZH = '雲泰表演廳';
const NAME_EN = ['Yun Tay', 'Performance Hall'];

// ---------------------------------------------------------------- geometry helpers
/** Point on the facade circle grown by `d` metres, at angle `t` (plan x, plan y). */
const onArc = (t: number, d = 0): Pt => [CX + (R + d) * Math.sin(t), CY - (R + d) * Math.cos(t)];

const arcPts = (t0: number, t1: number, d: number, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => onArc(t0 + ((t1 - t0) * i) / n, d));

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Indexed geometry from flat position / uv / index lists, with normals. */
function meshData(pos: number[], uv: number[], idx: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical ribbon along a plan polyline from y0 to y1; u and v run in metres. */
function ribbon(pts: Pt[], y0: number, y1: number): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let u = 0;
  pts.forEach(([x, z], i) => {
    if (i > 0) u += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    pos.push(x, y0, z, x, y1, z);
    uv.push(u, 0, u, y1 - y0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  return meshData(pos, uv, idx);
}

/** Horizontal strip between the facade circle grown by d0 and by d1, at height y. */
function annulus(t0: number, t1: number, d0: number, d1: number, y: number, n: number): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const [ax, az] = onArc(t, d0), [bx, bz] = onArc(t, d1);
    pos.push(ax, y, az, bx, y, bz);
    uv.push(ax / 2, az / 2, bx / 2, bz / 2);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return meshData(pos, uv, idx);
}

// ---------------------------------------------------------------- tree-free zones
const TREE_FREE = { landward: -0.5, seaward: 7, segments: 48, portalSide: 3, portalFront: 4, pylonHalf: 2.5 };

/** World rings kept free of campus trees: the colonnade walk and steps, the portal and the pylon. */
export function yuntayTreeFree(): number[][] {
  const { landward, seaward, segments, portalSide, portalFront, pylonHalf } = TREE_FREE;
  const band = [...arcPts(ARC_T0, ARC_T1, landward, segments), ...arcPts(ARC_T0, ARC_T1, seaward, segments).reverse()];
  const [x0, y0, x1, y1] = PORTAL_RECT;
  const rect = (a: number, b: number, c: number, d: number): Pt[] => [[a, b], [c, b], [c, d], [a, d]];
  return [
    band,
    rect(x0 - portalSide, y0, x1 + portalSide, y1 + portalFront),
    rect(PYLON_X - pylonHalf, PYLON_Y - pylonHalf, PYLON_X + pylonHalf, PYLON_Y + pylonHalf),
  ].map((ring) => ring.flatMap(([x, y]) => PLAN.toWorld(x, y)));
}

// ---------------------------------------------------------------- context
/** An axis-aligned box resting on `y0` (default ground), turned by `yaw` about its centre. */
interface SolidBox {
  y0?: number;
  height: number;
  /** Half extents along / across the box's local x / z. */
  hw: number;
  hd: number;
  yaw?: number;
}

interface Ctx {
  tracker: ResourceTracker;
  /** A tracked mesh in the exterior's group; it receives shadows and casts them unless `cast` is false. */
  add(geo: BufferGeometry, mat: Material | Material[], cast?: boolean): Mesh;
  /** A mesh of an already tracked geometry (repeated piers and lamp parts); always casts. */
  put(geo: BufferGeometry, mat: Material, receive?: boolean): Mesh;
  mat(color: number, extra?: MeshStandardMaterialParameters): MeshStandardMaterial;
  /** Collider at plan point (x, z). */
  solid(x: number, z: number, box: SolidBox): void;
  /** Light grey panel material for a face `w` × `h` m (the texture repeats once per course). */
  cladding(w: number, h: number): MeshStandardMaterial;
  palette: Record<keyof typeof COLOUR, MeshStandardMaterial> & { glow: MeshStandardMaterial };
  dispose(): void;
}

function createContext(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): Ctx {
  const [ox, oz] = PLAN.toWorld(0, 0), [px, pz] = PLAN.toWorld(1, 0);
  const groupYaw = -Math.atan2(pz - oz, px - ox);
  const group = new Group();
  group.name = `${NAME_ZH} exterior`;
  group.position.set(ox, 0, oz);
  group.rotation.y = groupYaw; // local +x = plan X, local +z = plan Y
  scene.add(group);

  const colliders: RAPIER.Collider[] = [];
  const mat = (color: number, extra: MeshStandardMaterialParameters = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.85, side: DoubleSide, ...extra }));
  const put = (geo: BufferGeometry, material: Material, receive = true): Mesh => {
    const m = new Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };
  const add = (geo: BufferGeometry, material: Material | Material[], cast = true): Mesh => {
    const m = new Mesh(tracker.geometry(geo), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Light grey cladding panels, one course per texture repeat.
  const panelTexture = canvasTexture(128, 96, (c) => {
    c.fillStyle = '#b4b7b8';
    c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#979a9b';
    c.fillRect(0, 0, 128, 3);
    c.fillRect(0, 0, 2, 96);
  }, tracker);

  return {
    tracker,
    add,
    put,
    mat,
    solid(x, z, { y0 = 0, height, hw, hd, yaw = 0 }) {
      const [wx, wz] = PLAN.toWorld(x, z);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), groupYaw + yaw);
      colliders.push(tracker.collider(physics.createCollider(
        RAPIER.ColliderDesc.cuboid(hw, height / 2, hd).setTranslation(wx, y0 + height / 2, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      )));
    },
    cladding(w, h) {
      const t = panelTexture.clone();
      t.needsUpdate = true;
      tracker.texture(t);
      t.repeat.set(w / COURSE.width, h / COURSE.height);
      return mat(0xffffff, { map: t });
    },
    palette: {
      dark: mat(COLOUR.dark),
      pier: mat(COLOUR.pier),
      paving: mat(COLOUR.paving, { roughness: 0.95 }),
      roof: mat(COLOUR.roof, { roughness: 0.95 }),
      canopyUnder: mat(COLOUR.canopyUnder),
      frame: mat(COLOUR.frame),
      pylon: mat(COLOUR.pylon),
      glow: mat(0xffffff, { emissive: 0xfff6e0, emissiveIntensity: 0.6, roughness: 0.3 }),
    },
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------- parts
/** Drum over the auditorium side: curved front, straight back wall, roof, cornice. */
function addDrum({ add, palette, cladding }: Ctx): void {
  const front = arcPts(ARC_T0, ARC_T1, DRUM_SKIN, DRUM_SEGMENTS);
  const [ax0, ay0] = front[0], [ax1, ay1] = front[DRUM_SEGMENTS];
  const back: Pt[] = [[ax1, ay1], [ax1, DRUM_BACK_Y], [ax0, DRUM_BACK_Y], [ax0, ay0]];
  const panels = cladding(1, 1); // ribbon uv is in metres: repeat per metre of wall
  add(ribbon(front, SHELL, DRUM_TOP), panels);
  add(ribbon(back, SHELL, DRUM_TOP), panels);
  const roof = new Shape();
  [...front, ...back.slice(1, 3)].forEach(([x, z], i) => (i ? roof.lineTo(x, -z) : roof.moveTo(x, -z)));
  add(new ShapeGeometry(roof).rotateX(-Math.PI / 2).translate(0, DRUM_TOP, 0), palette.roof, false);
  add(ribbon(arcPts(ARC_T0, ARC_T1, CORNICE.out, DRUM_SEGMENTS), DRUM_TOP - CORNICE.below, DRUM_TOP + CORNICE.above), palette.dark);
  add(ribbon(arcPts(ARC_T0, ARC_T1, WING_REVEAL.inset, DRUM_SEGMENTS), SHELL, SHELL + WING_REVEAL.height), palette.dark);
}

/** Fly tower over the stage. */
function addFlyTower({ add, palette, cladding }: Ctx): void {
  const [x0, y0, x1, y1] = FLY_TOWER;
  const w = x1 - x0, d = y1 - y0, h = FLY_TOP - SHELL;
  const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2;
  const side = cladding(w, h), end = cladding(d, h);
  add(new BoxGeometry(w, h, d), [end, end, palette.roof, palette.roof, side, side]).position.set(cx, SHELL + h / 2, cz);
  add(new BoxGeometry(w + CAP.overhang, CAP.height, d + CAP.overhang), palette.dark).position.set(cx, FLY_TOP + CAP.lift, cz);
}

/** Raised walk and the two steps below it, with their colliders. */
function addWalk({ add, solid, palette }: Ctx, t0: number, t1: number): void {
  for (const { from, to, top } of TIERS) add(annulus(t0, t1, from, to, top, COLONNADE_SEGMENTS), palette.paving, false);
  TIERS.forEach(({ to, top }, k) => {
    const below = TIERS[k + 1]?.top ?? 0; // the last riser runs down to the ground
    add(ribbon(arcPts(t0, t1, to, COLONNADE_SEGMENTS), below, top), palette.paving, false);
  });
  for (const t of [t0, t1]) add(ribbon([onArc(t, 0), onArc(t, WALK_END)], 0, FLOOR), palette.paving, false);
  // Tangent boxes along the arc.
  for (let i = 0; i < COLLIDER_SEGMENTS; i++) {
    const t = t0 + ((t1 - t0) * (i + 0.5)) / COLLIDER_SEGMENTS;
    const len = ((t1 - t0) / COLLIDER_SEGMENTS) * (R + WALK);
    for (const { from, to, top } of TIERS) {
      const [x, z] = onArc(t, (from + to) / 2);
      solid(x, z, { height: top, hw: len / 2 + 0.03, hd: (to - from) / 2, yaw: -t });
    }
  }
}

/** Canopy band over the walk: underside, top and the dark fascia. */
function addCanopy({ add, palette }: Ctx, t0: number, t1: number): void {
  add(annulus(t0, t1, 0, WALK, CANOPY.under, COLONNADE_SEGMENTS), palette.canopyUnder, false);
  add(annulus(t0, t1, 0, WALK, CANOPY.top, COLONNADE_SEGMENTS), palette.dark, false);
  add(ribbon(arcPts(t0, t1, WALK, COLONNADE_SEGMENTS), CANOPY.under, CANOPY.top), palette.dark);
}

/** Square piers every ~PIER.spacing m, and a globe lamp on a pedestal in front of every third. */
function addPiersAndLamps({ tracker, put, solid, palette }: Ctx, t0: number, t1: number): void {
  const pierH = CANOPY.under - FLOOR;
  const pierGeo = tracker.geometry(new BoxGeometry(PIER.size, pierH, PIER.size));
  const baseGeo = tracker.geometry(new BoxGeometry(LAMP.base, LAMP.baseH, LAMP.base));
  const poleGeo = tracker.geometry(new CylinderGeometry(LAMP.poleTop, LAMP.poleBottom, LAMP.poleH, 10));
  const globeGeo = tracker.geometry(new SphereGeometry(LAMP.globeR, 16, 12));
  const count = Math.floor(((t1 - t0) * (R + PIER.offset)) / PIER.spacing);
  for (let i = 0; i <= count; i++) {
    const t = t0 + PIER.inset + ((t1 - t0 - 2 * PIER.inset) * i) / count;
    const [x, z] = onArc(t, PIER.offset);
    const pier = put(pierGeo, palette.pier);
    pier.position.set(x, FLOOR + pierH / 2, z);
    pier.rotation.y = -t;
    solid(x, z, { y0: FLOOR, height: pierH, hw: PIER.size / 2, hd: PIER.size / 2, yaw: -t });
    if (i % LAMP.every !== LAMP.phase) continue;

    const [lx, lz] = onArc(t, WALK_END + LAMP.outset);
    put(baseGeo, palette.pier, false).position.set(lx, LAMP.baseH / 2, lz);
    put(poleGeo, palette.pier, false).position.set(lx, LAMP.baseH + LAMP.poleH / 2, lz);
    put(globeGeo, palette.glow, false).position.set(lx, LAMP.baseH + LAMP.poleH + LAMP.globeRest, lz);
    solid(lx, lz, { height: LAMP.colliderH, hw: LAMP.base / 2, hd: LAMP.base / 2 });
  }
}

/** Colonnade, raised walk and steps along the curved front. */
function addColonnade(ctx: Ctx): void {
  const t0 = ARC_T0 + ARC_MARGIN, t1 = ARC_T1 - ARC_MARGIN;
  addWalk(ctx, t0, t1);
  addCanopy(ctx, t0, t1);
  addPiersAndLamps(ctx, t0, t1);
}

/** A門 portal with the name. */
function addPortal({ tracker, add, solid, palette }: Ctx): void {
  const [x0, y0, x1, y1] = PORTAL_RECT;
  const { post, out, top, lintelBottom } = PORTAL;
  const depth = y1 - y0 + out;
  const cz = y0 + depth / 2;
  for (const x of [x0 - post / 2, x1 + post / 2]) {
    add(new BoxGeometry(post, top, depth), palette.frame).position.set(x, top / 2, cz);
    solid(x, cz, { height: top, hw: post / 2, hd: depth / 2 });
  }
  const plate = canvasTexture(2048, 320, (c) => {
    c.fillStyle = css(COLOUR.frame);
    c.fillRect(0, 0, 2048, 320);
    c.fillStyle = '#3b3f43';
    c.textBaseline = 'middle';
    c.font = '700 150px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    c.textAlign = 'right';
    c.fillText([...NAME_ZH].join(' '), 1250, 165);
    c.textAlign = 'left';
    c.font = '700 66px system-ui, sans-serif';
    c.fillText(NAME_EN[0], 1320, 120);
    c.fillText(NAME_EN[1], 1320, 205);
  }, tracker);
  const plateMat = tracker.material(new MeshStandardMaterial({ map: plate, roughness: 0.8 }));
  const lintel = add(new BoxGeometry(x1 - x0 + 2 * post, top - lintelBottom, depth), [palette.frame, palette.frame, palette.frame, palette.frame, plateMat, palette.frame]);
  lintel.position.set((x0 + x1) / 2, (top + lintelBottom) / 2, cz);
}

/** Sign pylon by the south walk. */
function addPylon({ tracker, add, solid, palette }: Ctx): void {
  const face = canvasTexture(256, 1024, (c) => {
    c.fillStyle = css(COLOUR.pylon);
    c.fillRect(0, 0, 256, 1024);
    c.fillStyle = '#d9dadb';
    c.textAlign = 'center';
    c.font = '700 120px "Noto Sans TC", "PingFang TC", sans-serif';
    [...NAME_ZH].forEach((ch, i) => c.fillText(ch, 165, 175 + i * 150));
    c.save();
    c.translate(70, 120);
    c.rotate(Math.PI / 2);
    c.font = '600 46px system-ui, sans-serif';
    c.fillText(NAME_EN.join(' '), 330, 0);
    c.restore();
    c.fillStyle = '#4a4744';
    for (let i = 0; i < 3; i++) c.fillRect(100 + i * 24, 900, 12, 90);
  }, tracker);
  const faceMat = tracker.material(new MeshStandardMaterial({ map: face, roughness: 0.7 }));
  const { w, h, d, colliderPad } = PYLON;
  add(new BoxGeometry(w, h, d), [palette.pylon, palette.pylon, palette.pylon, palette.pylon, faceMat, faceMat]).position.set(PYLON_X, h / 2, PYLON_Y);
  solid(PYLON_X, PYLON_Y, { height: h, hw: w / 2, hd: d / 2 + colliderPad });
}

export function createYuntayExterior(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): { dispose(): void } {
  const ctx = createContext(scene, physics, tracker);
  addDrum(ctx);
  addFlyTower(ctx);
  addColonnade(ctx);
  addPortal(ctx);
  addPylon(ctx);
  return { dispose: ctx.dispose };
}
