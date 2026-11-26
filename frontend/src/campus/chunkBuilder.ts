import { CUSTOM_FACADE_EDGES, CUSTOM_FACADE_OPENINGS, PARTY_WALLS, STYLE_ALIAS } from './customFacades';
import { ShapeUtils, Vector2 } from 'three';
import { mulberry32 } from '../core/math';
import {
  CHUNK_SIZE,
  chunkOf,
  type CampusBuilding,
  type CampusData,
  type CampusField,
  type CampusRoad,
  type ChunkBuild,
  type MeshBuffers,
  type Ring,
} from './campusTypes';
import { ACTIVITY_COURT_RING, ACTIVITY_FORECOURT_RING, buildActivityComplex, PERFORMANCE_HALL, STUDENT_CENTRE } from './activityComplex';
import { addFacadeDetails } from './facadeDetails';
import { DOOR_HEIGHT, DOOR_WIDTH, buildingEntrance, enterableShape, hasInterior, type Entrance } from './entrances';
import { SHELL_WALL, buildingKind, generateInterior } from '../interiors/generateInterior';
import type { BuildingSource } from '../buildings/buildingTypes';
import { RoadMarker } from './roadMarkings';
import { SIDEWALK_W, isLongtanMain } from './longtanConst';
import { PAVED_TRIM, trimEnds } from './polyline';
import { createPlanTransform } from '../buildings/planTransform';
import { DEFAULT_CAMPUS_STYLE, DEFAULT_TOWN_STYLE, DETAIL_DEFAULTS, PATTERN_ID, type FacadeData, type FacadeStyle, type PhotoEdge } from './facadeTypes';

/** Facade texture covers one structural bay (m) by one floor (m). */
export const BAY_WIDTH = 3.6;
export const FLOOR_HEIGHT = 3.6;

/** Layer heights above the ground plane; polygon offset on the materials resolves the rest. */
const Y_FIELD = 0.02;
const Y_ROAD = 0.04;
const Y_WALK = 0.06;
const WALL_BASE = -0.3;

/** Growable geometry accumulator (worker-side, so plain arrays are fine). */
const STREET_TREE_STEP = 8;

/** A closed glass double door on the outside face of a wall (sealed buildings): light frame, dark leaves. */
function addShutDoor(g: GeoBuilder, ring: readonly number[], e: Entrance): void {
  const n = ring.length / 2, j = (e.edge + 1) % n;
  const ax = ring[e.edge * 2]!, az = ring[e.edge * 2 + 1]!, dx = ring[j * 2]! - ax, dz = ring[j * 2 + 1]! - az;
  const len = Math.hypot(dx, dz);
  if (len < DOOR_WIDTH) return;
  const ux = dx / len, uz = dz / len, nx = dz / len, nz = -dx / len; // CCW ring: (dz, -dx) points out
  const quad = (a0: number, a1: number, y0: number, y1: number, off: number, c: readonly [number, number, number]): void => {
    const p = (a: number, y: number): number => g.vertex(ax + ux * (e.along + a) + nx * off, y, az + uz * (e.along + a) + nz * off, nx, 0, nz, 0, 0, c);
    const v0 = p(a0, y0), v1 = p(a1, y0), v2 = p(a1, y1), v3 = p(a0, y1);
    g.tri(v0, v2, v1);
    g.tri(v0, v3, v2);
  };
  const half = DOOR_WIDTH / 2;
  quad(-half - 0.08, half + 0.08, 0, DOOR_HEIGHT + 0.08, 0.03, [0.78, 0.8, 0.81]); // frame
  quad(-half + 0.04, -0.03, 0.06, DOOR_HEIGHT - 0.04, 0.045, [0.17, 0.22, 0.26]); // left leaf
  quad(0.03, half - 0.04, 0.06, DOOR_HEIGHT - 0.04, 0.045, [0.17, 0.22, 0.26]); // right leaf
  quad(-0.5, -0.12, 1.0, 1.06, 0.06, [0.85, 0.86, 0.86]); // push bars
  quad(0.12, 0.5, 1.0, 1.06, 0.06, [0.85, 0.86, 0.86]);
}

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c?: readonly [number, number, number]): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (c) this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Adds a triangle on a horizontal plane, flipping the winding so it faces +Y. */
  triUp(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3]!, az = p[a * 3 + 2]!;
    const cy = (p[b * 3 + 2]! - az) * (p[c * 3]! - ax) - (p[b * 3]! - ax) * (p[c * 3 + 2]! - az);
    if (cy >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): MeshBuffers | null {
    if (this.empty) return null;
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      color: this.col.length ? new Float32Array(this.col) : null,
      index: new Uint32Array(this.idx),
    };
  }
}

/** Walls carrying their procedural facade style per vertex: trim + glass colours and the window grid. */
export class FacadeBuilder extends GeoBuilder {
  readonly trim: number[] = [];
  readonly glass: number[] = [];
  readonly params: number[] = [];

  styled(x: number, y: number, z: number, nx: number, nz: number, u: number, v: number, s: ResolvedStyle): number {
    this.trim.push(...s.trim);
    this.glass.push(...s.glass);
    this.params.push(...s.params);
    return this.vertex(x, y, z, nx, 0, nz, u, v, s.wall);
  }

  override build(): MeshBuffers | null {
    const b = super.build();
    if (!b) return null;
    b.extra = [
      { name: 'facadeTrim', size: 3, array: new Float32Array(this.trim) },
      { name: 'facadeGlass', size: 3, array: new Float32Array(this.glass) },
      { name: 'facadeParams', size: 4, array: new Float32Array(this.params) },
    ];
    return b;
  }
}

/** A facade style in shader form: linear colours, (window width, window height, sill, pattern + 4·groundGlass + 8·brick). */
interface ResolvedStyle {
  wall: [number, number, number];
  trim: [number, number, number];
  glass: [number, number, number];
  params: [number, number, number, number];
  bay: number;
}

// --- Geometry helpers ------------------------------------------------------------------------

function ringBounds(r: Ring): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]!); maxX = Math.max(maxX, r[i]!);
    minZ = Math.min(minZ, r[i + 1]!); maxZ = Math.max(maxZ, r[i + 1]!);
  }
  return [minX, minZ, maxX, maxZ];
}

function ringCentroid(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function distToRingEdge(px: number, pz: number, r: Ring): number {
  let d = Infinity;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    d = Math.min(d, distToSegment(px, pz, r[i * 2]!, r[i * 2 + 1]!, r[j * 2]!, r[j * 2 + 1]!));
  }
  return d;
}

/** Triangulates a polygon with holes at height y, appending upward-facing triangles. */
function addPolygon(g: GeoBuilder, outer: Ring, holes: readonly Ring[], y: number, uvScale: number, color?: readonly [number, number, number]): void {
  const toVec = (r: Ring): Vector2[] => {
    const out: Vector2[] = [];
    for (let i = 0; i < r.length; i += 2) out.push(new Vector2(r[i]!, r[i + 1]!));
    return out;
  };
  const contour = toVec(outer);
  const holeVecs = holes.map(toVec);
  const faces = ShapeUtils.triangulateShape(contour, holeVecs);
  const all = contour.concat(...holeVecs);
  const base = g.pos.length / 3;
  for (const p of all) g.vertex(p.x, y, p.y, 0, 1, 0, p.x / uvScale, p.y / uvScale, color);
  for (const [a, b, c] of faces) g.triUp(base + a, base + b, base + c);
}

/**
 * Extruded walls for one ring. Outer rings are CCW and holes CW, so (dz, -dx) always points away
 * from the mass. UVs are (bays, floors) so the facade shader's window grid is fract(uv); edges listed
 * in `photo` go to `photoOut` instead, with UVs into the building's atlas.
 */
/** A window opening on one outer-ring edge: metres along the edge and height above ground. */
interface WindowCut {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  /** Left empty (no glass or frames): a hand-built module fills the opening (CUSTOM_FACADE_OPENINGS). */
  open?: boolean;
}

const WIN_SILL = 0.9;
const WIN_HEAD = 2.3;
const WIN_STEP = 0.25;
/** How far inside the facade the classroom probe sits: past the shell wall and the plan raster's slack. */
const WIN_PROBE = SHELL_WALL + 1.0;
const FRAME_COLOR: readonly [number, number, number] = [0.42, 0.45, 0.48];
const INNER_WALL: readonly [number, number, number] = [0.9, 0.89, 0.86];
const SLAB_TOP: readonly [number, number, number] = [0.8, 0.79, 0.76];
const SLAB_UNDER: readonly [number, number, number] = [0.93, 0.93, 0.91];

/**
 * Window bands where the generated interior (same deterministic layout the streamed interior
 * uses) puts a classroom against the outside wall: sampled just inside each edge, per storey,
 * one opening per classroom stretch with a pier left at either end.
 */
function classroomWindows(b: CampusBuilding, src: BuildingSource, door: Entrance | null, skip: ReadonlySet<number>): Map<number, WindowCut[]> {
  const out = new Map<number, WindowCut[]>();
  const xf = createPlanTransform(src);
  const r = b.outer, n = r.length / 2;
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!, dx = r[j * 2]! - px, dz = r[j * 2 + 1]! - pz;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const ux = dx / len, uz = dz / len, ix = -uz, iz = ux; // inward = −outward (rings are CCW)
    const cuts: WindowCut[] = [];
    for (const level of src.levels) {
      const plan = src.floors[level.id];
      if (!plan || level.elevation + WIN_HEAD > b.height - 0.3) continue;
      const rooms = plan.spaces.filter((s) => s.furnish === 'classroom');
      if (!rooms.length) continue;
      let run: { room: number; t0: number; t1: number } | null = null;
      const flush = (): void => {
        if (run && run.t1 - run.t0 - 0.8 >= 0.8) cuts.push({ a0: run.t0 + 0.4, a1: run.t1 - 0.4, y0: level.elevation + WIN_SILL, y1: level.elevation + WIN_HEAD });
        run = null;
      };
      for (let t = WIN_STEP / 2; t < len; t += WIN_STEP) {
        const nearDoor = door?.edge === i && Math.abs(t - door.along) < DOOR_WIDTH / 2 + 1;
        const [qx, qy] = xf.toPlan(px + ux * t + ix * WIN_PROBE, pz + uz * t + iz * WIN_PROBE);
        // The front wall (the board's: the short side at the low end) keeps no windows.
        const room = nearDoor ? -1 : rooms.findIndex((s) => s.rects.some(([x0, y0, x1, y1]) =>
          qx >= x0 && qx <= x1 && qy >= y0 && qy <= y1 && (x1 - x0 >= y1 - y0 ? qx - x0 : qy - y0) > 1.6));
        const cur = run as { room: number; t0: number; t1: number } | null;
        if (room < 0 || (cur && cur.room !== room)) flush();
        if (room < 0) continue;
        if (!run) run = { room, t0: t - WIN_STEP / 2, t1: t + WIN_STEP / 2 };
        else (run as { t1: number }).t1 = t + WIN_STEP / 2;
      }
      flush();
    }
    if (cuts.length) out.set(i, cuts);
  }
  return out;
}

function addWalls(
  g: FacadeBuilder,
  r: Ring,
  height: number,
  floors: number,
  style: ResolvedStyle,
  photo?: { edges: ReadonlyMap<number, PhotoEdge>; out: GeoBuilder },
  doors: readonly Entrance[] = [],
  windows?: { cuts: ReadonlyMap<number, WindowCut[]>; glass: GeoBuilder; frames: GeoBuilder },
  /** Heavy outer wall: an inner face `t` m inside the facade plus reveals round every opening. */
  thick?: { out: GeoBuilder; t: number },
  /** Party walls (edge → height the wall starts at): the neighbouring piece's interior runs through below. */
  wallFrom: Readonly<Record<number, number>> = {},
): void {
  const n = r.length / 2;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!, qx = r[j * 2]!, qz = r[j * 2 + 1]!;
    const dx = qx - px, dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    const at = (a: number, y: number, off: number): [number, number, number] => [px + (dx * a) / len + nx * off, y, pz + (dz * a) / len + nz * off];
    const quad = (gb: GeoBuilder, a0: number, a1: number, y0: number, y1: number, off: number, side: 1 | -1, color?: readonly [number, number, number]): void => {
      const v = [at(a0, y0, off), at(a1, y0, off), at(a1, y1, off), at(a0, y1, off)].map(([x, y, z], k) =>
        gb.vertex(x, y, z, nx * side, 0, nz * side, k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0, color));
      if (side > 0) { gb.tri(v[0]!, v[2]!, v[1]!); gb.tri(v[0]!, v[3]!, v[2]!); }
      else { gb.tri(v[0]!, v[1]!, v[2]!); gb.tri(v[0]!, v[2]!, v[3]!); }
    };
    const T = thick?.t ?? 0;
    // Inner face of the thick wall; runs T past the edge ends so corners close either way round.
    const inner = (a0: number, a1: number, y0: number, y1: number): void => {
      if (thick) quad(thick.out, a0 <= 1e-3 ? -T : a0, a1 >= len - 1e-3 ? len + T : a1, Math.max(0, y0), y1, -T, -1, INNER_WALL);
    };
    // Reveal across the wall thickness: `pts` are (a, y) corners on the facade plane, swept inward.
    const reveal = (a0: number, y0: number, a1: number, y1: number): void => {
      if (!thick) return;
      const o = thick.out;
      const c = [at(a0, y0, 0), at(a1, y1, 0), at(a1, y1, -T), at(a0, y0, -T)];
      for (const flip of [false, true]) {
        const v = c.map(([x, y, z]) => o.vertex(x, y, z, 0, flip ? -1 : 1, 0, 0, 0, INNER_WALL));
        if (flip) { o.tri(v[0]!, v[2]!, v[1]!); o.tri(v[0]!, v[3]!, v[2]!); }
        else { o.tri(v[0]!, v[1]!, v[2]!); o.tri(v[0]!, v[2]!, v[3]!); }
      }
    };
    const party = wallFrom[i];
    const shot = party === undefined ? photo?.edges.get(i) : undefined;
    if (shot && photo) {
      inner(0, len, 0, height);
      // Photo spans ground → roof; the strip below grade reuses the bottom row. Seen from outside,
      // vertex i is on the viewer's right, so the image's left edge (u0) belongs to vertex i + 1.
      const [u0, vb, u1, vt] = shot.uv;
      const o = photo.out;
      const p0 = o.vertex(px, WALL_BASE, pz, nx, 0, nz, u1, vb);
      const q0 = o.vertex(qx, WALL_BASE, qz, nx, 0, nz, u0, vb);
      const q1 = o.vertex(qx, height, qz, nx, 0, nz, u0, vt);
      const p1 = o.vertex(px, height, pz, nx, 0, nz, u1, vt);
      o.tri(p0, q1, q0);
      o.tri(p0, p1, q1);
      continue;
    }
    // Snap the bay count per wall so windows never get cut at corners.
    const bays = Math.max(1, Math.round(len / style.bay));
    const u0 = u;
    // One wall panel from a0 to a1 (m along the edge), y0 to y1; UVs stay continuous across panels.
    const panel = (a0: number, a1: number, y0: number, y1: number): void => {
      const ua = u0 + (bays * a0) / len, ub = u0 + (bays * a1) / len;
      const va = (y0 / height) * floors, vb = (y1 / height) * floors;
      const ax = px + (dx * a0) / len, az = pz + (dz * a0) / len, bx = px + (dx * a1) / len, bz = pz + (dz * a1) / len;
      const p0 = g.styled(ax, y0, az, nx, nz, ua, va, style);
      const q0 = g.styled(bx, y0, bz, nx, nz, ub, va, style);
      const q1 = g.styled(bx, y1, bz, nx, nz, ub, vb, style);
      const p1 = g.styled(ax, y1, az, nx, nz, ua, vb, style);
      g.tri(p0, q1, q0);
      g.tri(p0, p1, q1);
    };
    // A wall piece with this edge's window openings left out (strips between cut boundaries).
    const cuts = party === undefined ? windows?.cuts.get(i) ?? [] : [];
    const piece = (a0: number, a1: number, y0: number, y1: number, emit: (a0: number, a1: number, y0: number, y1: number) => void = panel): void => {
      const xs = [a0, a1];
      for (const c of cuts) if (c.a1 > a0 && c.a0 < a1) xs.push(Math.max(a0, c.a0), Math.min(a1, c.a1));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) {
        const s = xs[k]!, t = xs[k + 1]!;
        if (t - s < 1e-3) continue;
        const mid = (s + t) / 2;
        let y = y0;
        for (const c of cuts.filter((c) => c.a0 <= mid && c.a1 >= mid && c.y1 > y0 && c.y0 < y1).sort((a, b) => a.y0 - b.y0)) {
          if (c.y0 > y) emit(s, t, y, c.y0);
          y = Math.max(y, c.y1);
        }
        if (y < y1) emit(s, t, y, y1);
      }
    };
    if (windows) {
      const set = -T * 0.4; // the glazing sits back in the wall
      for (const c of cuts) {
        reveal(c.a0, c.y0, c.a1, c.y0); // sill
        reveal(c.a0, c.y1, c.a1, c.y1); // head
        reveal(c.a0, c.y0, c.a0, c.y1); // jambs
        reveal(c.a1, c.y0, c.a1, c.y1);
        if (c.open) continue;
        quad(windows.glass, c.a0, c.a1, c.y0, c.y1, set, 1);
        // Aluminium frame on both faces: sill, head, jambs and mullions every ~1.2 m.
        const bars: [number, number, number, number][] = [[c.a0, c.a1, c.y0 - 0.06, c.y0 + 0.04], [c.a0, c.a1, c.y1 - 0.05, c.y1 + 0.03]];
        const panes = Math.max(1, Math.round((c.a1 - c.a0) / 1.2));
        for (let k = 0; k <= panes; k++) {
          const a = c.a0 + ((c.a1 - c.a0) * k) / panes;
          bars.push([a - 0.035, a + 0.035, c.y0, c.y1]);
        }
        bars.push([c.a0, c.a1, c.y0 + (c.y1 - c.y0) * 0.72 - 0.025, c.y0 + (c.y1 - c.y0) * 0.72 + 0.025]); // transom
        for (const [a0, a1, y0, y1] of bars) {
          quad(windows.frames, Math.max(c.a0, a0), Math.min(c.a1, a1), y0, y1, set + 0.03, 1, FRAME_COLOR);
          quad(windows.frames, Math.max(c.a0, a0), Math.min(c.a1, a1), y0, y1, set - 0.03, -1, FRAME_COLOR);
        }
      }
    }
    if (party !== undefined) {
      if (party < height) {
        piece(0, len, party, height);
        piece(0, len, party, height, inner);
      }
      u = u0 + bays;
      continue;
    }
    // Walls start below the ground plane so the wall/ground seam never forms a collision crease.
    const here = height > DOOR_HEIGHT + 0.2 ? doors.filter((d) => d.edge === i).sort((a, b) => a.along - b.along) : [];
    let from = 0;
    for (const d of here) {
      const w = d.width ?? DOOR_WIDTH, dh = Math.min(height - 0.2, d.height ?? DOOR_HEIGHT);
      const d0 = Math.max(from, d.along - w / 2), d1 = Math.min(len, d.along + w / 2);
      if (d1 - d0 < 0.5) continue;
      piece(from, d0, WALL_BASE, height);
      piece(d0, d1, dh, height); // lintel over the entrance
      piece(from, d0, 0, height, inner);
      piece(d0, d1, dh, height, inner);
      reveal(d0, 0, d0, dh);
      reveal(d1, 0, d1, dh);
      reveal(d0, dh, d1, dh);
      from = d1;
    }
    piece(from, len, WALL_BASE, height);
    piece(from, len, 0, height, inner);
    u = u0 + bays;
  }
}

/**
 * Storey slabs for a building with a generated interior: the interior's floor stops at its plan
 * raster, so the shell supplies the floor (and the ceiling below) out to the wall. Stair and
 * elevator shafts stay open.
 */
function addSlabs(visual: GeoBuilder, solid: GeoBuilder, b: CampusBuilding, src: BuildingSource): void {
  const xf = createPlanTransform(src);
  for (const level of src.levels) {
    const plan = src.floors[level.id];
    if (!plan) continue;
    const shafts: Ring[] = [];
    if (level.elevation > 0.1) {
      for (const s of plan.spaces) {
        if (s.kind !== 'stair' && s.kind !== 'elevator' && s.kind !== 'void') continue;
        for (const [x0, y0, x1, y1] of s.rects) {
          shafts.push([...xf.toWorld(x0 - 0.1, y0 - 0.1), ...xf.toWorld(x1 + 0.1, y0 - 0.1), ...xf.toWorld(x1 + 0.1, y1 + 0.1), ...xf.toWorld(x0 - 0.1, y1 + 0.1)]);
        }
      }
    }
    const holes = [...b.holes, ...shafts];
    const top = level.elevation + 0.06; // just under the interior's floor finish
    addPolygon(visual, b.outer, holes, top, 4, SLAB_TOP);
    addPolygon(solid, b.outer, holes, top, 4);
    if (level.elevation > 0.1) {
      // Underside, facing down: the ceiling of the storey below where the interior has none.
      const tmp = new GeoBuilder();
      addPolygon(tmp, b.outer, holes, level.elevation - 0.25, 4);
      const base = visual.pos.length / 3;
      for (let i = 0; i < tmp.pos.length; i += 3) visual.vertex(tmp.pos[i]!, tmp.pos[i + 1]!, tmp.pos[i + 2]!, 0, -1, 0, 0, 0, SLAB_UNDER);
      for (let i = 0; i < tmp.idx.length; i += 3) visual.tri(base + tmp.idx[i]!, base + tmp.idx[i + 2]!, base + tmp.idx[i + 1]!);
    }
  }
}

/** Road ribbon: one quad per segment plus a disc at each joint to close the gaps at bends. */
function addRibbon(g: GeoBuilder, pts: readonly number[], width: number, y: number, uvScale: number): void {
  const hw = width / 2;
  const n = pts.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 2]!, az = pts[i * 2 + 1]!, bx = pts[i * 2 + 2]!, bz = pts[i * 2 + 3]!;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ox = (-dz / len) * hw, oz = (dx / len) * hw;
    const v = (x: number, z: number): number => g.vertex(x, y, z, 0, 1, 0, x / uvScale, z / uvScale);
    const a0 = v(ax + ox, az + oz), a1 = v(ax - ox, az - oz), b1 = v(bx - ox, bz - oz), b0 = v(bx + ox, bz + oz);
    g.triUp(a0, a1, b1);
    g.triUp(a0, b1, b0);
  }
  const SEG = 10;
  for (let i = 1; i + 1 < n; i++) {
    const cx = pts[i * 2]!, cz = pts[i * 2 + 1]!;
    const c = g.vertex(cx, y, cz, 0, 1, 0, cx / uvScale, cz / uvScale);
    let prev = -1;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = cx + Math.cos(a) * hw, z = cz + Math.sin(a) * hw;
      const cur = g.vertex(x, y, z, 0, 1, 0, x / uvScale, z / uvScale);
      if (prev >= 0) g.triUp(c, prev, cur);
      prev = cur;
    }
  }
}

// --- Colours ---------------------------------------------------------------------------------

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: number): [number, number, number] => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
];

const hexString = (hex: string): [number, number, number] => hexLinear(Number.parseInt(hex.replace('#', ''), 16));

function resolveStyle(s: FacadeStyle): ResolvedStyle {
  return {
    wall: hexString(s.wall),
    trim: hexString(s.trim),
    glass: hexString(s.glass),
    params: [s.win[0], s.win[1], s.sill, PATTERN_ID[s.pattern] + (s.groundGlass ? 4 : 0) + (s.brick ? 8 : 0)],
    bay: s.bay,
  };
}

/** Gives walls built elsewhere (hand-built buildings) the facade style attributes the shader needs. */
export function stampFacadeStyle(buf: MeshBuffers, style: FacadeStyle): void {
  const r = resolveStyle(style);
  const n = buf.position.length / 3;
  const fill = (size: number, v: readonly number[]): Float32Array<ArrayBuffer> => {
    const a = new Float32Array(n * size);
    for (let i = 0; i < n; i++) a.set(v, i * size);
    return a;
  };
  buf.color = fill(3, r.wall);
  buf.extra = [
    { name: 'facadeTrim', size: 3, array: fill(3, r.trim) },
    { name: 'facadeGlass', size: 3, array: fill(3, r.glass) },
    { name: 'facadeParams', size: 4, array: fill(4, r.params) },
  ];
}

/** Small per-building tone variation so neighbours sharing a style don't read as clones. */
function varied(s: ResolvedStyle, id: number): ResolvedStyle {
  const k = 0.94 + ((Math.abs(id) * 2654435761) % 1000) / 1000 * 0.1;
  return { ...s, wall: [s.wall[0] * k, s.wall[1] * k, s.wall[2] * k] };
}

const FIELD_COLORS: Readonly<Record<CampusField['kind'], [number, number, number]>> = {
  soccer: hexLinear(0x5f9a49),
  court: hexLinear(0x3f7d73),
  track: hexLinear(0xb05a43),
  park: hexLinear(0x79a85c),
};

// --- Builder ---------------------------------------------------------------------------------

interface Indexed<T> {
  item: T;
  bounds: [number, number, number, number];
}

/**
 * Turns campus data into per-chunk render + collision buffers. Pure and synchronous so it can
 * run in a Web Worker (see campusWorker.ts); items belong to the chunk containing their centroid
 * (roads: each segment by its midpoint), so every item is built exactly once.
 */
export class ChunkBuilder {
  private readonly buildings = new Map<string, CampusBuilding[]>();
  private readonly roadSegs = new Map<string, { road: CampusRoad; from: number; to: number }[]>();
  private readonly fields = new Map<string, CampusField[]>();
  private readonly allBuildings: Indexed<CampusBuilding>[];
  private readonly allFields: Indexed<CampusField>[];

  /** Extra no-tree zones (world rings), e.g. the footprints of hand-built buildings. */
  private readonly exclusions: Indexed<Ring>[];

  private readonly styles: ResolvedStyle[];
  private readonly rawStyles: FacadeStyle[];
  private readonly photos = new Map<number, { atlas: string; edges: Map<number, PhotoEdge> }>();
  private readonly marker: RoadMarker;

  constructor(
    private readonly data: CampusData,
    exclusions: readonly Ring[] = [],
    private readonly facades: FacadeData = { styles: [DEFAULT_CAMPUS_STYLE, DEFAULT_TOWN_STYLE], building: {}, photos: {} },
    /** Door gaps from the traced plans, by OSM id (overrides the single road-facing entrance). */
    private readonly entrances: Readonly<Record<string, readonly Entrance[]>> = {},
  ) {
    // Styles built before the 3D details existed lack those fields.
    this.rawStyles = facades.styles.map((st) => ({ ...DETAIL_DEFAULTS, ...st }));
    this.styles = this.rawStyles.map(resolveStyle);
    for (const [id, p] of Object.entries(facades.photos)) {
      this.photos.set(Number(id), { atlas: p.atlas, edges: new Map(p.edges.map((e) => [e.edge, e])) });
    }
    this.exclusions = [...exclusions, ACTIVITY_COURT_RING, ACTIVITY_FORECOURT_RING, [65, 149, 64, 141, 89, 137, 91, 147]].map((r) => ({ item: r, bounds: ringBounds(r) }));
    this.marker = new RoadMarker(data);
    const key = (x: number, z: number): string => `${chunkOf(x)},${chunkOf(z)}`;
    const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const b of data.buildings) push(this.buildings, key(...ringCentroid(b.outer)), b);
    for (const f of data.fields) push(this.fields, key(...ringCentroid(f.outer)), f);
    for (const road of data.roads) {
      // Group consecutive segments that fall in the same chunk into one polyline run.
      const n = road.points.length / 2;
      let runStart = 0;
      let runKey = '';
      for (let i = 0; i + 1 < n; i++) {
        const mx = (road.points[i * 2]! + road.points[i * 2 + 2]!) / 2;
        const mz = (road.points[i * 2 + 1]! + road.points[i * 2 + 3]!) / 2;
        const k = key(mx, mz);
        if (i === 0) runKey = k;
        if (k !== runKey) {
          push(this.roadSegs, runKey, { road, from: runStart, to: i });
          runStart = i;
          runKey = k;
        }
      }
      if (n >= 2) push(this.roadSegs, runKey, { road, from: runStart, to: n - 1 });
    }
    this.allBuildings = data.buildings.map((b) => ({ item: b, bounds: ringBounds(b.outer) }));
    this.allFields = data.fields.filter((f) => f.kind !== 'park').map((f) => ({ item: f, bounds: ringBounds(f.outer) }));
  }

  build(cx: number, cz: number): ChunkBuild {
    const k = `${cx},${cz}`;
    const facade = new FacadeBuilder();
    const photoWalls: ChunkBuild['photoWalls'] = [];
    const roof = new GeoBuilder();
    const details = new GeoBuilder();
    const roads = new GeoBuilder();
    const walks = new GeoBuilder();
    const fields = new GeoBuilder();
    const glass = new GeoBuilder();
    const marks = new GeoBuilder();
    const slabs = new GeoBuilder(); // collision only: storey floors between the interior and the shell wall

    for (const b of this.buildings.get(k) ?? []) {
      if (b.replacedBy) continue; // drawn and collided by its hand-built model instead
      if (!b.inCampus) continue; // off campus: no-go zone, nothing built there
      const styleIndex = this.facades.building[String(STYLE_ALIAS[b.id] ?? b.id)] ?? (b.inCampus ? 0 : 1);
      const style = varied(this.styles[styleIndex]!, STYLE_ALIAS[b.id] ?? b.id);
      const floors = Math.max(1, b.levels || Math.round(b.height / 3.6));
      const shots = this.photos.get(b.id);
      const photoOut = shots ? new GeoBuilder() : null;
      const photoEdges = new Set(shots?.edges.keys() ?? []);
      // Plan-traced buildings open where the plans have exits; others get one entrance facing the road.
      const fallback = hasInterior(b) ? buildingEntrance(b, this.data.roads, photoEdges) : null;
      // Sealed buildings keep their doors on the outside (canopy, frame) but shut: no gap in the wall.
      const shut = b.sealed && !b.doorless
        ? this.entrances[String(b.id)]?.filter((d) => !photoEdges.has(d.edge)) ?? (enterableShape(b) ? [buildingEntrance(b, this.data.roads, photoEdges)].filter((e): e is Entrance => !!e) : [])
        : [];
      const doors = b.sealed ? [] : this.entrances[String(b.id)]?.filter((d) => !photoEdges.has(d.edge)) ?? (fallback ? [fallback] : []);
      // Generated teaching interiors: real windows where a classroom meets the outside wall.
      // Buildings with a generated interior get a heavy shell: thick outer walls and a slab per storey.
      const interior = !this.entrances[String(b.id)] && hasInterior(b) ? generateInterior(b, fallback)?.source ?? null : null;
      // Plan-traced interiors too: their rooms stop at a 0.25 m raster, so on curved or slanted walls
      // the gap to the outline would show the ground; the thick wall's inner face hides it.
      const thick = interior || (this.entrances[String(b.id)] && !b.sealed) ? { out: details, t: SHELL_WALL } : undefined;
      let cuts = interior && buildingKind(b.name) === 'teaching' ? classroomWindows(b, interior, fallback, photoEdges) : null;
      const openings = CUSTOM_FACADE_OPENINGS[b.id];
      if (openings?.length) {
        cuts = new Map(cuts ?? []);
        const r = b.outer, n = r.length / 2;
        for (const o of openings) {
          const j = (o.edge + 1) % n, len = Math.hypot(r[j * 2]! - r[o.edge * 2]!, r[j * 2 + 1]! - r[o.edge * 2 + 1]!);
          const [a0, a1] = o.fromEnd ? [len - o.a1, len - o.a0] : [o.a0, o.a1];
          cuts.set(o.edge, [...(cuts.get(o.edge) ?? []), { a0, a1, y0: o.y0, y1: o.y1, open: true }]);
        }
      }
      addWalls(facade, b.outer, b.height, floors, style, shots && photoOut ? { edges: shots.edges, out: photoOut } : undefined, doors,
        // Party walls only open up for one traced plan running through the pieces; generated interiors are
        // one per piece, so each keeps its own full wall.
        cuts?.size ? { cuts, glass, frames: details } : undefined, thick, this.entrances[String(b.id)] ? PARTY_WALLS[b.id] : undefined);
      for (const h of b.holes) addWalls(facade, h, b.height, floors, style, undefined, [], undefined, thick);
      if (interior) addSlabs(details, slabs, b, interior);
      const custom = CUSTOM_FACADE_EDGES[b.id];
      const detailSkip = custom ? new Set([...photoEdges, ...custom]) : photoEdges;
      addFacadeDetails(details, b, this.rawStyles[styleIndex]!, { wall: style.wall, trim: style.trim }, this.data.roads, detailSkip, b.sealed ? shut : doors);
      if (b.id === STUDENT_CENTRE || b.id === PERFORMANCE_HALL) {
        const vertexStart = details.pos.length / 3;
        const indexStart = details.idx.length;
        buildActivityComplex(b, details, glass);
        // Use the same geometry for the visible steps, galleries and their colliders.
        const indexOffset = slabs.pos.length / 3 - vertexStart;
        slabs.pos.push(...details.pos.slice(vertexStart * 3));
        for (let i = indexStart; i < details.idx.length; i++) slabs.idx.push(details.idx[i]! + indexOffset);
      }
      for (const e of shut) addShutDoor(details, b.outer, e);
      const photoMesh = photoOut?.build();
      if (shots && photoMesh) photoWalls.push({ building: b.id, atlas: shots.atlas, mesh: photoMesh });
      addPolygon(roof, b.outer, b.holes, b.height, 4);
    }
    for (const f of this.fields.get(k) ?? []) if (pointInRing(...ringCentroid(f.outer), this.data.boundary)) addPolygon(fields, f.outer, [], Y_FIELD, 6, FIELD_COLORS[f.kind]);
    for (const { road, from, to } of this.roadSegs.get(k) ?? []) {
      const pts = road.points.slice(from * 2, to * 2 + 2);
      if (road.kind === 'walkway') addRibbon(walks, pts, road.width, Y_WALK, 2);
      else if (road.paved) addRibbon(walks, trimEnds(pts, from === 0 ? PAVED_TRIM : 0, to === road.points.length / 2 - 1 ? PAVED_TRIM : 0), road.width, Y_ROAD, 2);
      else {
        addRibbon(roads, pts, road.width, Y_ROAD, 6);
        this.marker.emit(marks, road, from, to);
      }
    }

    // Collision = building walls + roofs only (B2: simplified, trees / cars / kerbs are walk-through).
    let collider: ChunkBuild['collider'] = null;
    const parts: { pos: ArrayLike<number>; idx: ArrayLike<number> }[] = [facade, roof, glass, slabs, ...photoWalls.map((p) => ({ pos: p.mesh.position, idx: p.mesh.index }))];
    if (!roof.empty) {
      const vertices = new Float32Array(parts.reduce((n, p) => n + p.pos.length, 0));
      const indices = new Uint32Array(parts.reduce((n, p) => n + p.idx.length, 0));
      let vo = 0, io = 0;
      for (const p of parts) {
        vertices.set(p.pos, vo);
        for (let i = 0; i < p.idx.length; i++) indices[io + i] = p.idx[i]! + vo / 3;
        vo += p.pos.length;
        io += p.idx.length;
      }
      collider = { vertices, indices };
    }

    return {
      cx, cz,
      facade: facade.build(),
      photoWalls,
      roof: roof.build(),
      details: details.build(),
      roads: roads.build(),
      walkways: walks.build(),
      fields: fields.build(),
      glass: glass.build(),
      marks: marks.build(),
      trees: this.scatterTrees(cx, cz),
      collider,
    };
  }

  /** Deterministic tree scatter on open ground (OSM has no tree nodes here). */
  private scatterTrees(cx: number, cz: number): Float32Array<ArrayBuffer> {
    const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const pad = 12;
    const near = <T>(list: Indexed<T>[]): Indexed<T>[] =>
      list.filter(({ bounds: [a, b, c, d] }) => c > x0 - pad && a < x0 + CHUNK_SIZE + pad && d > z0 - pad && b < z0 + CHUNK_SIZE + pad);
    const buildings = near(this.allBuildings);
    const fields = near(this.allFields);
    const roads: { road: CampusRoad; from: number; to: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roads.push(...(this.roadSegs.get(`${cx + dx},${cz + dz}`) ?? []));
    const { bounds, boundary } = this.data;

    const out: number[] = [];
    const STEP = 9;
    for (let gx = x0; gx < x0 + CHUNK_SIZE; gx += STEP) {
      for (let gz = z0; gz < z0 + CHUNK_SIZE; gz += STEP) {
        const x = gx + rand() * STEP;
        const z = gz + rand() * STEP;
        const r = rand();
        if (x < bounds.minX - 60 || x > bounds.maxX + 60 || z < bounds.minZ - 60 || z > bounds.maxZ + 60) continue;
        const campus = pointInRing(x, z, boundary);
        if (!campus || r > 0.32) continue; // no trees off campus
        if (buildings.some(({ item, bounds: [a, b, c, d] }) => x > a - 4 && x < c + 4 && z > b - 4 && z < d + 4 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 4))) continue;
        if (this.exclusions.some(({ item, bounds: [a, b, c, d] }) => x > a - 4 && x < c + 4 && z > b - 4 && z < d + 4 && (pointInRing(x, z, item) || distToRingEdge(x, z, item) < 4))) continue;
        if (fields.some(({ item, bounds: [a, b, c, d] }) => x > a - 2 && x < c + 2 && z > b - 2 && z < d + 2 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 2))) continue;
        let onRoad = false;
        for (const { road, from, to } of roads) {
          const p = road.points;
          for (let i = from; i < to && !onRoad; i++) {
            if (distToSegment(x, z, p[i * 2]!, p[i * 2 + 1]!, p[i * 2 + 2]!, p[i * 2 + 3]!) < road.width / 2 + (isLongtanMain(road) ? SIDEWALK_W + 2 : road.kind === 'walkway' ? 2 : 4.5)) onRoad = true; // vehicle roads: the verge rows only
          }
          if (onRoad) break;
        }
        if (onRoad) continue;
        out.push(x, z, 0.8 + rand() * 0.6, rand() * Math.PI * 2, rand());
      }
    }
    // 龍潭路 street trees: a row down the middle of each sidewalk, every ~8 m, on both sides.
    const inChunk = (x: number, z: number): boolean => x >= x0 && x < x0 + CHUNK_SIZE && z >= z0 && z < z0 + CHUNK_SIZE;
    const seen = new Set<string>();
    for (const { road, from, to } of roads) {
      if (!isLongtanMain(road)) continue;
      const p = road.points, off = road.width / 2 + SIDEWALK_W / 2;
      for (let i = from; i < to; i++) {
        const key = `${p[i * 2]},${p[i * 2 + 1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ax = p[i * 2]!, az = p[i * 2 + 1]!, bx = p[i * 2 + 2]!, bz = p[i * 2 + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 4) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const n = Math.max(1, Math.round(len / STREET_TREE_STEP));
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n) * len;
          for (const side of [-1, 1]) {
            // On the sidewalk; where a service road runs right alongside, step out past it instead.
            let x = 0, z = 0, ok = false;
            for (let extra = 0; extra <= 12 && !ok; extra += 1) {
              x = ax + ux * t - uz * side * (off + extra);
              z = az + uz * t + ux * side * (off + extra);
              let crossing = false;
              for (const { road: other, from: f, to: t2 } of roads) {
                if (isLongtanMain(other) || other.kind === 'walkway') continue;
                const q = other.points;
                for (let j = f; j < t2 && !crossing; j++) if (distToSegment(x, z, q[j * 2]!, q[j * 2 + 1]!, q[j * 2 + 2]!, q[j * 2 + 3]!) < other.width / 2 + 2.5) crossing = true;
                if (crossing) break;
              }
              ok = !crossing;
            }
            if (!ok || !inChunk(x, z)) continue;
            if (this.exclusions.some(({ item, bounds: [a, b, c, d] }) => x > a - 1 && x < c + 1 && z > b - 1 && z < d + 1 && pointInRing(x, z, item))) continue;
            if (buildings.some(({ item, bounds: [a, b, c, d] }) => x > a - 3 && x < c + 3 && z > b - 3 && z < d + 3 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 3))) continue;
            const h = ((x * 12.9898 + z * 78.233) % 1 + 1) % 1;
            out.push(x, z, 1.0 + h * 0.35, h * Math.PI * 2, h);
          }
          // Divided stretch: a row down the planted median, clear of junctions and crossings.
          if (road.median) {
            const x = ax + ux * t, z = az + uz * t;
            if (!inChunk(x, z)) continue;
            let crossing = false;
            for (const { road: other, from: f, to: t2 } of roads) {
              if (other === road) continue;
              const q = other.points;
              for (let j = f; j < t2 && !crossing; j++) if (distToSegment(x, z, q[j * 2]!, q[j * 2 + 1]!, q[j * 2 + 2]!, q[j * 2 + 3]!) < other.width / 2 + 3) crossing = true;
              if (crossing) break;
            }
            if (crossing) continue;
            const h = ((x * 7.123 + z * 31.77) % 1 + 1) % 1;
            out.push(x, z, 0.95 + h * 0.3, h * Math.PI * 2, h);
          }
        }
      }
    }
    // Campus roads (Street View): a row of street trees in the grass verge along both sides.
    const seenCampus = new Set<string>();
    for (const { road, from, to } of roads) {
      if (road.kind === 'walkway' || isLongtanMain(road) || road.median) continue;
      const p = road.points;
      const mid = Math.floor(p.length / 4) * 2;
      if (!pointInRing(p[mid]!, p[mid + 1]!, boundary)) continue;
      const off = road.width / 2 + 2.2;
      for (let i = from; i < to; i++) {
        const key = `${p[i * 2]},${p[i * 2 + 1]},${p[i * 2 + 2]}`;
        if (seenCampus.has(key)) continue;
        seenCampus.add(key);
        const ax = p[i * 2]!, az = p[i * 2 + 1]!, bx = p[i * 2 + 2]!, bz = p[i * 2 + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 6) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const n = Math.max(1, Math.round(len / CAMPUS_TREE_STEP));
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n) * len;
          for (const side of [-1, 1]) {
            // The verge row; where a footpath runs there, the strip between kerb and footpath instead (Street View).
            let x = 0, z = 0, placed = false;
            for (const o of [off, road.width / 2 + 1.0]) {
              x = ax + ux * t - uz * side * o;
              z = az + uz * t + ux * side * o;
              let blocked = !inChunk(x, z) || !pointInRing(x, z, boundary);
              for (const { road: other, from: f, to: t2 } of roads) {
                if (blocked) break;
                const q = other.points;
                const pad = other === road ? o - 0.5 : other.width / 2 + (other.kind === 'walkway' ? 0.8 : 2.2);
                for (let j = f; j < t2 && !blocked; j++) if (distToSegment(x, z, q[j * 2]!, q[j * 2 + 1]!, q[j * 2 + 2]!, q[j * 2 + 3]!) < pad) blocked = true;
              }
              if (!blocked) { placed = true; break; }
            }
            if (!placed) continue;
            if (this.exclusions.some(({ item, bounds: [a, b, c, d] }) => x > a - 1 && x < c + 1 && z > b - 1 && z < d + 1 && pointInRing(x, z, item))) continue;
            if (buildings.some(({ item, bounds: [a, b, c, d] }) => x > a - 3 && x < c + 3 && z > b - 3 && z < d + 3 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 3))) continue;
            if (fields.some(({ item, bounds: [a, b, c, d] }) => x > a - 2 && x < c + 2 && z > b - 2 && z < d + 2 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 2))) continue;
            const h = ((x * 12.9898 + z * 78.233) % 1 + 1) % 1;
            out.push(x, z, 1.1 + h * 0.3, h * Math.PI * 2, h);
          }
        }
      }
    }
    // Footpaths that run alongside a campus road (北環路, Street View): a tree tunnel, one row on
    // each side of the path. Segments within 16 m of a parallel campus road only.
    const vehiclesNear = roads.filter(({ road }) => road.kind !== 'walkway' && !isLongtanMain(road) && !road.median);
    const parallelRoad = (ax: number, az: number, ux: number, uz: number, len: number): boolean => {
      const mx = ax + ux * len / 2, mz = az + uz * len / 2;
      for (const { road, from, to } of vehiclesNear) {
        const q = road.points;
        for (let j = from; j < to; j++) {
          const qx = q[j * 2]!, qz = q[j * 2 + 1]!, rx = q[j * 2 + 2]! - qx, rz = q[j * 2 + 3]! - qz, rl = Math.hypot(rx, rz) || 1;
          if (Math.abs((rx * ux + rz * uz) / rl) < 0.94) continue;
          if (distToSegment(mx, mz, qx, qz, qx + rx, qz + rz) < 16 && pointInRing(mx, mz, boundary)) return true;
        }
      }
      return false;
    };
    const seenWalk = new Set<string>();
    const taken = (x: number, z: number): boolean => {
      for (let k = 0; k < out.length; k += 5) if (Math.abs(out[k]! - x) < 4 && Math.abs(out[k + 1]! - z) < 4) return true;
      return false;
    };
    // Trees go every CAMPUS_TREE_STEP m of arc length along the whole path, so finely sampled
    // polylines (the generated kerb sidewalks, 1 m segments) get them too.
    const arcs = new Map<CampusRoad, number[]>();
    const arcOf = (r: CampusRoad): number[] => {
      let c = arcs.get(r);
      if (!c) {
        c = [0];
        for (let i = 0; i + 3 < r.points.length; i += 2) c.push(c[c.length - 1]! + Math.hypot(r.points[i + 2]! - r.points[i]!, r.points[i + 3]! - r.points[i + 1]!));
        arcs.set(r, c);
      }
      return c;
    };
    for (const { road, from, to } of roads) {
      if (road.kind !== 'walkway' || road.width > 4) continue;
      const p = road.points, off = road.width / 2 + 1.3;
      const cum = arcOf(road);
      for (let i = from; i < to; i++) {
        const key = `${p[i * 2]},${p[i * 2 + 1]},${p[i * 2 + 2]}`;
        if (seenWalk.has(key)) continue;
        seenWalk.add(key);
        const ax = p[i * 2]!, az = p[i * 2 + 1]!, bx = p[i * 2 + 2]!, bz = p[i * 2 + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        if (!parallelRoad(ax, az, ux, uz, len)) continue;
        const s0 = cum[i]!;
        for (let d = Math.ceil((s0 - CAMPUS_TREE_STEP / 2) / CAMPUS_TREE_STEP) * CAMPUS_TREE_STEP + CAMPUS_TREE_STEP / 2; d < s0 + len; d += CAMPUS_TREE_STEP) {
          const t = d - s0;
          for (const side of [-1, 1]) {
            const x = ax + ux * t - uz * side * off, z = az + uz * t + ux * side * off;
            if (!inChunk(x, z) || taken(x, z)) continue;
            let blocked = false;
            for (const { road: other, from: f, to: t2 } of roads) {
              const q = other.points;
              const pad = other === road ? off - 0.5 : other.width / 2 + (other.kind === 'walkway' ? 0.8 : 2.2);
              for (let j = f; j < t2 && !blocked; j++) if (distToSegment(x, z, q[j * 2]!, q[j * 2 + 1]!, q[j * 2 + 2]!, q[j * 2 + 3]!) < pad) blocked = true;
              if (blocked) break;
            }
            if (blocked) continue;
            if (this.exclusions.some(({ item, bounds: [a, b, c, d] }) => x > a - 1 && x < c + 1 && z > b - 1 && z < d + 1 && pointInRing(x, z, item))) continue;
            if (buildings.some(({ item, bounds: [a, b, c, d] }) => x > a - 3 && x < c + 3 && z > b - 3 && z < d + 3 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 3))) continue;
            if (fields.some(({ item, bounds: [a, b, c, d] }) => x > a - 2 && x < c + 2 && z > b - 2 && z < d + 2 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 2))) continue;
            const h = ((x * 3.71 + z * 51.3) % 1 + 1) % 1;
            out.push(x, z, 1.0 + h * 0.3, h * Math.PI * 2, h);
          }
        }
      }
    }
    return new Float32Array(out);
  }
}

/** Spacing of the street-tree rows along campus roads (m). */
const CAMPUS_TREE_STEP = 8.5;

/** All transferable buffers of a build, for zero-copy postMessage. */
export function transferablesOf(b: ChunkBuild): ArrayBuffer[] {
  const out: ArrayBuffer[] = [b.trees.buffer];
  for (const m of [b.facade, b.roof, b.details, b.roads, b.walkways, b.fields, b.glass, b.marks, ...b.photoWalls.map((p) => p.mesh)]) {
    if (!m) continue;
    out.push(m.position.buffer, m.normal.buffer, m.uv.buffer, m.index.buffer);
    if (m.color) out.push(m.color.buffer);
    for (const e of m.extra ?? []) out.push(e.array.buffer);
  }
  if (b.collider) out.push(b.collider.vertices.buffer, b.collider.indices.buffer);
  return out;
}
