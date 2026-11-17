import { GeoBuilder } from '../campus/chunkBuilder';
import type { MeshBuffers } from '../campus/campusTypes';
import type { BuildingSource, FloorPlan, OpeningKind, Rect, Space, Stair } from './buildingTypes';
import { CELL, OUTSIDE, applyOpenings, boundarySegments, isWalkable, rasterize, regionRects, type FloorGrid, type Segment } from './floorGrid';
import { layoutFurniture, type FurnitureItem, type KeepOut } from './furniture';

/**
 * Builds render buffers and collider boxes for a hand-built building in plan-local coordinates
 * (x = plan X, y = up, z = plan Y). The caller places the result with the plan → world transform.
 *
 * Split in two so the interior can be streamed: `exterior` (facades, roofs, upper-floor shells,
 * above-grade exterior walls) is always present; `interior` (partitions, floors, ceilings, slabs,
 * railings, stairs, basement) only near the player.
 */
export { WALL_T } from './wallConst';
import { WALL_T } from './wallConst';
const DOOR_H = 2.4;
const RAIL_H = 1.1;
const FLOOR_Y = 0.08; // above campus walkway ribbons (0.06)
const SLAB_T = 0.3;
const BAY = 3.6;
const RISER = 0.17;
const STAIR_SIDE = 0.12;
/** Clerestory strip, above the floor (m). */
const CLERESTORY: readonly [number, number] = [2.3, 2.9];
/** Real glazing in exterior walls (style.windows): where the facade shader paints its window band. */
const WINDOW: readonly [number, number] = [1.15, 2.66];
const MULLION = 0.12;

export interface ColliderBox {
  /** Centre and half extents in plan-local axes. */
  c: [number, number, number];
  h: [number, number, number];
  /** Optional tilt (ramps) about a local horizontal axis, applied before the building rotation. */
  tilt?: { axis: 'x' | 'z'; angle: number };
}

export interface DoorPanel {
  kind: 'closed' | 'elevator';
  axis: 'h' | 'v';
  at: number;
  from: number;
  to: number;
  base: number;
  label?: string;
}

export interface PlateSpot {
  /** Plate centre (plan-local) and outward normal. */
  p: [number, number, number];
  n: [number, number];
  code?: string;
  text: string;
}

export interface BuildingPart {
  facade: MeshBuffers | null;
  paint: MeshBuffers | null;
  roof: MeshBuffers | null;
  floor: MeshBuffers | null;
  ceiling: MeshBuffers | null;
  glass: MeshBuffers | null;
  colliders: ColliderBox[];
}

export interface LevelMeshes {
  id: string;
  base: number;
  part: BuildingPart;
  doors: DoorPanel[];
  plates: PlateSpot[];
  furniture: FurnitureItem[];
  /** Kept apart from `part.colliders` so the camera can ignore furniture. */
  furnitureColliders: ColliderBox[];
}

export interface BuildingMeshes {
  exterior: BuildingPart;
  /** Interior per modelled level, so floors can be shown / hidden independently. */
  levels: LevelMeshes[];
  /** Stair flights (visible with the interior regardless of level). */
  stairs: BuildingPart;
  /** Plan-local footprint rects of the ground floor (tree exclusion, minimap). */
  footprint: Rect[];
}

class PartBuilder {
  readonly facade = new GeoBuilder();
  readonly paint = new GeoBuilder();
  readonly roof = new GeoBuilder();
  readonly floor = new GeoBuilder();
  readonly ceiling = new GeoBuilder();
  readonly glass = new GeoBuilder();
  readonly colliders: ColliderBox[] = [];

  build(): BuildingPart {
    return {
      facade: this.facade.build(),
      paint: this.paint.build(),
      roof: this.roof.build(),
      floor: this.floor.build(),
      ceiling: this.ceiling.build(),
      glass: this.glass.build(),
      colliders: this.colliders,
    };
  }
}

type V3 = [number, number, number];
const TINT: V3 = [0.78, 0.7, 0.6]; // warm tile facade, linear

/** Quad with explicit corners; winding is fixed up so the face points along `n`. */
function quad(g: GeoBuilder, p: V3[], n: V3, uv: [number, number][], tint?: V3): void {
  const [a, b, c] = p as [V3, V3, V3];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!, cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
  const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
  const idx = p.map((v, i) => g.vertex(v[0], v[1], v[2], n[0], n[1], n[2], uv[i]![0], uv[i]![1], tint));
  const [i0, i1, i2, i3] = idx as [number, number, number, number];
  if (flip) {
    g.tri(i0, i2, i1);
    g.tri(i0, i3, i2);
  } else {
    g.tri(i0, i1, i2);
    g.tri(i0, i2, i3);
  }
}

function horizontal(g: GeoBuilder, [x0, z0, x1, z1]: Rect, y: number, up: boolean, uvScale: number): void {
  quad(g, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, up ? 1 : -1, 0], [[x0 / uvScale, z0 / uvScale], [x1 / uvScale, z0 / uvScale], [x1 / uvScale, z1 / uvScale], [x0 / uvScale, z1 / uvScale]]);
}

/** One face of a wall piece, offset from the boundary line toward `side` (−1 = a side, +1 = b side). */
function wallFace(g: GeoBuilder, s: Segment, from: number, to: number, y0: number, y1: number, side: -1 | 1, facade: boolean, floorH: number, vBase = 0): void {
  const off = (side * WALL_T) / 2;
  const len = to - from;
  const u0 = facade ? 0 : from / 2, u1 = facade ? Math.max(1, Math.round(len / BAY)) : to / 2;
  // Paint: 2 m per texture repeat, measured from this storey's floor so dados and skirtings line up on every level.
  const v0 = facade ? y0 / floorH : (y0 - vBase) / 2, v1 = facade ? y1 / floorH : (y1 - vBase) / 2;
  const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const tint = facade ? TINT : undefined;
  if (s.axis === 'h') {
    const z = s.at + off;
    quad(g, [[from, y0, z], [to, y0, z], [to, y1, z], [from, y1, z]], [0, 0, side], uv, tint);
  } else {
    const x = s.at + off;
    quad(g, [[x, y0, from], [x, y0, to], [x, y1, to], [x, y1, from]], [side, 0, 0], uv, tint);
  }
}

function wallBox(s: Segment, from: number, to: number, y0: number, y1: number, t = WALL_T): ColliderBox {
  const mid = (from + to) / 2, half = (to - from) / 2;
  return s.axis === 'h'
    ? { c: [mid, (y0 + y1) / 2, s.at], h: [half, (y1 - y0) / 2, t / 2] }
    : { c: [s.at, (y0 + y1) / 2, mid], h: [t / 2, (y1 - y0) / 2, half] };
}

function slabBox([x0, z0, x1, z1]: Rect, top: number, t = SLAB_T): ColliderBox {
  return { c: [(x0 + x1) / 2, top - t / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, t / 2, (z1 - z0) / 2] };
}

function capTop(g: GeoBuilder, s: Segment, from: number, to: number, y: number): void {
  const t = WALL_T / 2;
  const r: Rect = s.axis === 'h' ? [from, s.at - t, to, s.at + t] : [s.at - t, from, s.at + t, to];
  horizontal(g, r, y, true, 2);
}

interface ModelledLevel {
  id: string;
  plan: FloorPlan;
  grid: FloorGrid;
  base: number;
}

const cellAt = (g: FloorGrid, x: number, y: number): number => {
  const c = Math.floor((x - g.x0) / CELL), r = Math.floor((y - g.y0) / CELL);
  return c < 0 || r < 0 || c >= g.w || r >= g.h ? OUTSIDE : g.ids[r * g.w + c]!;
};

/** Points 0.15 m to either side of a boundary line, for probing what lies across it on another level. */
function sidePoint(s: Segment, along: number, side: -1 | 1): [number, number] {
  return s.axis === 'h' ? [along, s.at + side * 0.15] : [s.at + side * 0.15, along];
}

function buildModelledFloor(
  lvl: ModelledLevel,
  below: ModelledLevel | undefined,
  above: ModelledLevel | undefined,
  ext: PartBuilder,
  int: PartBuilder,
  doors: DoorPanel[],
  plates: PlateSpot[],
  floorH: number,
  reach = 0,
  clerestory = false,
  windows = false,
): void {
  const { plan, grid, base } = lvl;
  const underground = base < 0;
  const { pieces } = applyOpenings(boundarySegments(grid), plan.openings);
  const ends = new Set<string>();
  for (const p of pieces) ends.add(`${p.axis}:${p.at.toFixed(2)}:${p.from.toFixed(2)}`), ends.add(`${p.axis}:${p.at.toFixed(2)}:${p.to.toFixed(2)}e`);
  const space = (id: number): Space | undefined => (id === OUTSIDE ? undefined : plan.spaces[id]);

  for (const p of pieces) {
    const A = space(p.a), B = space(p.b);
    // Spaces in one group are a single room split only to vary the ceiling: no wall, just the step above.
    const sameGroup = !!A?.group && A.group === B?.group;
    const kind: OpeningKind | undefined = p.opening ?? (sameGroup ? 'open' : undefined);

    // Mezzanine edge: the "outside" across the boundary is a double-height space on the floor below.
    if ((!A || !B) && below && !kind) {
      const outSide: -1 | 1 = !A ? -1 : 1;
      const [qx, qy] = sidePoint(p, (p.from + p.to) / 2, outSide);
      const under = below.plan.spaces[cellAt(below.grid, qx, qy)];
      if (under && below.base + under.ceiling > base + 0.5) {
        for (const side of [-1, 1] as const) wallFace(int.glass, p, p.from, p.to, base, base + RAIL_H, side, false, floorH);
        capTop(int.paint, p, p.from, p.to, base + RAIL_H);
        int.colliders.push(wallBox(p, p.from, p.to, base, base + RAIL_H));
        continue;
      }
    }

    const exterior = (!A || !B) && !underground;
    const part = exterior ? ext : int;
    const top = !A || !B ? plan.bandTop : Math.max(A?.ceiling ?? 0, B?.ceiling ?? 0);

    // Railing between a walkable space and a void.
    const voidEdge = (A?.kind === 'void' && isWalkable(B)) || (B?.kind === 'void' && isWalkable(A));
    if (voidEdge && !kind) {
      for (const side of [-1, 1] as const) wallFace(part.glass, p, p.from, p.to, base, base + RAIL_H, side, false, floorH);
      capTop(part.paint, p, p.from, p.to, base + RAIL_H);
      part.colliders.push(wallBox(p, p.from, p.to, base, base + RAIL_H));
      continue;
    }
    if (voidEdge && kind === 'open') continue; // stair landing into the void

    // Extend plain walls by half a thickness at free ends so corners close without gaps.
    let from = p.from, to = p.to;
    if (!kind) {
      const key = `${p.axis}:${p.at.toFixed(2)}:`;
      if (!ends.has(`${key}${p.from.toFixed(2)}e`)) from -= WALL_T / 2;
      if (!ends.has(`${key}${p.to.toFixed(2)}`)) to += WALL_T / 2;
    }

    // Generated interiors stop short of the shell wall: partitions that end at the plan edge reach on to it.
    if (!kind && A && B && reach > 0) {
      const openEnd = (along: number): boolean => {
        const [ax, ay] = sidePoint(p, along, -1), [bx, by] = sidePoint(p, along, 1);
        return cellAt(grid, ax, ay) === OUTSIDE && cellAt(grid, bx, by) === OUTSIDE;
      };
      if (openEnd(p.from - 0.25)) from = p.from - reach;
      if (openEnd(p.to + 0.25)) to = p.to + reach;
    }

    let y0 = base;
    if (kind === 'open') y0 = base + Math.min(A?.ceiling ?? top, B?.ceiling ?? top);
    else if (kind === 'door' || kind === 'exit') y0 = base + DOOR_H;
    if (kind === 'closed' || kind === 'elevator') {
      doors.push({ kind, axis: p.axis, at: p.at, from: p.from, to: p.to, base, ...(p.label ? { label: p.label } : {}) });
      y0 = base + DOOR_H;
      part.colliders.push(wallBox(p, from, to, base, base + DOOR_H, 0.12)); // the door leaf itself blocks
    }

    // Walls stop under a mezzanine floor that passes over them (checked per ~1 m so partial overlaps split).
    const steps = Math.max(1, Math.ceil((to - from) / 1));
    for (let k = 0; k < steps; k++) {
      const a = from + ((to - from) * k) / steps, b = from + ((to - from) * (k + 1)) / steps;
      let y1 = base + top;
      if (above && above.base < y1) {
        const mid = (a + b) / 2;
        const [ax, ay] = sidePoint(p, mid, -1), [bx, by] = sidePoint(p, mid, 1);
        if (cellAt(above.grid, ax, ay) !== OUTSIDE || cellAt(above.grid, bx, by) !== OUTSIDE) y1 = above.base - 0.02;
      }
      if (y1 - y0 <= 0.01) continue;
      // Clerestory: a high glazed strip where a room meets a corridor (the wall stays solid for collision).
      const corridorSide = (s?: Space): boolean => s?.kind === 'corridor' || s?.kind === 'lobby';
      const roomSide = (s?: Space): boolean => s?.kind === 'room';
      const strip = clerestory && !kind && A && B && ((roomSide(A) && corridorSide(B)) || (roomSide(B) && corridorSide(A)))
        && y0 <= base + 0.01 && y1 >= base + CLERESTORY[1] + 0.1;
      // Windows: an exterior wall of a room or corridor is glazed where the facade paints its windows.
      const inside = A ?? B;
      const pane = windows && exterior && !kind && (roomSide(inside) || corridorSide(inside))
        && y0 <= base + 0.01 && y1 >= base + WINDOW[1] + 0.1 && b - a > 0.5;
      const cut = strip ? CLERESTORY : pane ? WINDOW : null;
      const bands: [number, number, boolean][] = cut
        ? [[y0, base + cut[0], false], [base + cut[0], base + cut[1], true], [base + cut[1], y1, false]]
        : [[y0, y1, false]];
      for (const [b0, b1, glazed] of bands) {
        if (glazed) {
          // An exterior pane sits between two slim posts so the wall reads as framed bays.
          const m = pane ? MULLION / 2 : 0;
          for (const side of [-1, 1] as const) wallFace(part.glass, p, a + m, b - m, b0, b1, side, false, floorH, base);
          for (const yy of [b0, b1]) capTop(part.paint, p, a, b, yy); // sill and head
          if (pane) {
            for (const [m0, m1] of [[a, a + m], [b - m, b]] as const) {
              for (const side of [-1, 1] as const) wallFace(part.paint, p, m0, m1, b0, b1, side, false, floorH, base);
            }
          }
          continue;
        }
        wallFace(!A && !underground ? part.facade : part.paint, p, a, b, b0, b1, -1, !A && !underground, floorH, base);
        wallFace(!B && !underground ? part.facade : part.paint, p, a, b, b0, b1, 1, !B && !underground, floorH, base);
      }
      capTop(part.roof, p, a, b, y1);
      part.colliders.push(wallBox(p, a, b, y0, y1));
    }

    // Door plates: on each side, name the space you would enter.
    if (kind === 'door' || kind === 'exit' || kind === 'closed' || kind === 'elevator') {
      for (const side of [-1, 1] as const) {
        const here = side < 0 ? A : B;
        const there = side < 0 ? B : A;
        if (!here) continue; // no plates on the outside face
        const text = p.label ?? there?.name ?? (kind === 'exit' ? '出口' : '');
        if (!text) continue;
        const along = p.to + 0.45;
        const off = side * (WALL_T / 2 + 0.02);
        const pos: V3 = p.axis === 'h' ? [along, base + 1.75, p.at + off] : [p.at + off, base + 1.75, along];
        const n: [number, number] = p.axis === 'h' ? [0, side] : [side, 0];
        plates.push({ p: pos, n, ...(there?.code && !p.label ? { code: there.code } : {}), text: !there && kind === 'exit' ? '出口 EXIT' : text });
      }
    }
  }

  // Floors, ceilings, slabs.
  plan.spaces.forEach((s, id) => {
    for (const r of regionRects(grid, (v) => v === id)) {
      const walkable = s.kind !== 'stair' && s.kind !== 'elevator' && s.kind !== 'void';
      if (walkable) horizontal(int.floor, r, base + FLOOR_Y, true, 0.6);
      if (walkable && base !== 0) int.colliders.push(slabBox(r, base)); // grade-level floors stand on the ground
      if (base > 0 && s.kind !== 'stair') horizontal(int.ceiling, r, base - 0.02, false, 1.2); // underside seen from the hall below
      if (!s.noCeiling) {
        horizontal(int.ceiling, r, base + s.ceiling, false, 1.2);
        // Camera-only ceiling, kept just *below* the ceiling plane: a collider above it would poke
        // through the floor of the storey above (whose surface is at exactly that height).
        if (s.kind !== 'void') int.colliders.push({ c: [(r[0] + r[2]) / 2, base + s.ceiling - 0.15, (r[1] + r[3]) / 2], h: [(r[2] - r[0]) / 2, 0.1, (r[3] - r[1]) / 2] });
      }
      // A basement's top replaces the campus ground collider (except where it is open to the floor above).
      if (underground && !s.noCeiling) int.colliders.push(slabBox(r, base + plan.bandTop));
    }
  });
  if (!underground) for (const r of regionRects(grid, (v) => v !== OUTSIDE)) horizontal(ext.roof, r, base + plan.bandTop, true, 4);
}

function buildShellLevel(rects: Rect[], below: Rect[], base: number, height: number, ext: PartBuilder, floorH: number): void {
  const grid = rasterize([{ rects }]);
  for (const s of boundarySegments(grid)) {
    const outsideSide: -1 | 1 = s.a === OUTSIDE ? -1 : 1;
    const from = s.from - WALL_T / 2, to = s.to + WALL_T / 2;
    wallFace(ext.facade, s, from, to, base, base + height, outsideSide, true, floorH);
    ext.colliders.push(wallBox(s, from, to, base, base + height));
  }
  for (const r of regionRects(grid, (v) => v !== OUTSIDE)) horizontal(ext.roof, r, base + height, true, 4);
  // Soffits only where this level overhangs everything below (avoids z-fighting with ceilings).
  const covered = (x: number, y: number): boolean => below.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d);
  const overhang = rasterize([{ rects }]);
  for (let i = 0; i < overhang.ids.length; i++) {
    if (overhang.ids[i] === OUTSIDE) continue;
    const c = i % overhang.w, r = Math.floor(i / overhang.w);
    if (covered(overhang.x0 + (c + 0.5) * CELL, overhang.y0 + (r + 0.5) * CELL)) overhang.ids[i] = OUTSIDE;
  }
  for (const r of regionRects(overhang, (v) => v !== OUTSIDE)) horizontal(ext.roof, r, base - 0.02, false, 4);
}

/** Straight flight: steps, stringers, glass balustrades, a walkable ramp collider and side guards. */
function buildStair(st: Stair, int: PartBuilder): void {
  const [x0, y0, x1, y1] = st.rect;
  const alongX = st.axis === 'x';
  const runFrom = alongX ? x0 : y0, runTo = alongX ? x1 : y1;
  const latFrom = alongX ? y0 : x0, latTo = alongX ? y1 : x1;
  const run = runTo - runFrom, rise = st.high - st.low;
  const n = Math.max(2, Math.round(rise / RISER));
  // Position along the run where the flight is at height h (0 at the low end).
  const lowAt = st.up === '+' ? runFrom : runTo;
  const dir = st.up === '+' ? 1 : -1;
  const P = (along: number, lat: number, y: number): V3 => (alongX ? [along, y, lat] : [lat, y, along]);
  const N = (alongN: number, latN: number, yN: number): V3 => (alongX ? [alongN, yN, latN] : [latN, yN, alongN]);
  const tread = run / n;

  for (let i = 0; i < n; i++) {
    const a = lowAt + dir * i * tread, b = lowAt + dir * (i + 1) * tread;
    const top = st.low + (i + 1) * (rise / n), bottom = st.low + i * (rise / n);
    // Tread (top) and riser (front face, toward the low end).
    quad(int.floor, [P(a, latFrom, top), P(b, latFrom, top), P(b, latTo, top), P(a, latTo, top)], N(0, 0, 1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    quad(int.paint, [P(a, latFrom, bottom), P(a, latTo, bottom), P(a, latTo, top), P(a, latFrom, top)], N(-dir, 0, 0), [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]);
  }
  for (const [lat, side] of [[latFrom, -1], [latTo, 1]] as const) {
    const lowEnd = lowAt, highEnd = lowAt + dir * run;
    // Stringer face down to the low floor, then a glass balustrade 1 m above the pitch line.
    quad(int.paint, [P(lowEnd, lat, st.low), P(highEnd, lat, st.low), P(highEnd, lat, st.high), P(lowEnd, lat, st.low + 0.05)], N(0, side, 0), [[0, 0], [1, 0], [1, 1], [0, 0]]);
    quad(int.glass, [P(lowEnd, lat, st.low), P(highEnd, lat, st.high), P(highEnd, lat, st.high + 1.0), P(lowEnd, lat, st.low + 1.0)], N(0, side, 0), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // Side guard: blocks falling off the flight and walking underneath it.
    const mid = (lowEnd + highEnd) / 2;
    const h0 = st.low, h1 = st.high + RAIL_H;
    int.colliders.push({
      c: alongX ? [mid, (h0 + h1) / 2, lat] : [lat, (h0 + h1) / 2, mid],
      h: alongX ? [run / 2, (h1 - h0) / 2, STAIR_SIDE / 2] : [STAIR_SIDE / 2, (h1 - h0) / 2, run / 2],
    });
  }
  // Ramp collider along the pitch line (the character controller climbs it like a slope).
  const len = Math.hypot(run, rise);
  const angle = Math.atan2(rise, run);
  const t = 0.2;
  const midAlong = (runFrom + runTo) / 2, midLat = (latFrom + latTo) / 2;
  const midY = (st.low + st.high) / 2 - (t / 2) * Math.cos(angle);
  const tiltAngle = alongX ? dir * angle : -dir * angle; // rotation sign depends on the run axis
  int.colliders.push({
    c: alongX ? [midAlong, midY, midLat] : [midLat, midY, midAlong],
    h: alongX ? [len / 2, t / 2, (latTo - latFrom) / 2] : [(latTo - latFrom) / 2, t / 2, len / 2],
    tilt: { axis: alongX ? 'z' : 'x', angle: tiltAngle },
  });
}

export function buildBuildingMeshes(src: BuildingSource): BuildingMeshes {
  const ext = new PartBuilder();
  const stairsPart = new PartBuilder();
  const fh = src.floorHeight;

  const modelled: ModelledLevel[] = src.levels
    .filter((l) => src.floors[l.id])
    .map((l) => ({ id: l.id, plan: src.floors[l.id]!, grid: rasterize(src.floors[l.id]!.spaces), base: l.elevation }));
  const levels: LevelMeshes[] = modelled.map((lvl, i) => {
    const int = new PartBuilder();
    const doors: DoorPanel[] = [];
    const plates: PlateSpot[] = [];
    const below = modelled[i - 1];
    const above = modelled[i + 1];
    // Only floors that sit directly on top of each other interact (B1 under 1F, 1F under its mezzanine).
    buildModelledFloor(lvl, below && lvl.base - below.base <= fh + 0.01 && lvl.base > 0 ? below : undefined, above && above.base - lvl.base < lvl.plan.bandTop ? above : undefined, ext, int, doors, plates, fh, src.wallReach ?? 0, src.style?.clerestory ?? false, src.style?.windows ?? false);

    // Furniture keeps clear of elevator landings, signs, doorways and stair ends on this level.
    const keepOut: KeepOut[] = [];
    if (lvl.plan.elevator) keepOut.push({ x: lvl.plan.elevator.landing[0], y: lvl.plan.elevator.landing[1], r: 2.6 });
    for (const sg of lvl.plan.signs) keepOut.push({ x: sg.at[0], y: sg.at[1], r: 1.6 });
    // Stalls and the queue in front of them.
    for (const st of lvl.plan.stalls ?? []) keepOut.push({ x: st.at[0] + st.facing[0] * 1.5, y: st.at[1] + st.facing[1] * 1.5, r: st.width / 2 + 2 });
    for (const o of lvl.plan.openings) keepOut.push({ x: (o.a[0] + o.b[0]) / 2, y: (o.a[1] + o.b[1]) / 2, r: 1.3 });
    for (const st of src.stairs ?? []) {
      if (st.low !== lvl.base && st.high !== lvl.base) continue;
      const [x0, y0, x1, y1] = st.rect;
      keepOut.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 + 1.5 });
    }
    const { items, colliders } = layoutFurniture(lvl.plan, lvl.grid, lvl.base, keepOut);
    return { id: lvl.id, base: lvl.base, part: int.build(), doors, plates, furniture: items, furnitureColliders: colliders };
  });

  const ground = modelled.find((m) => m.base === 0);
  const footprint = ground ? regionRects(ground.grid, (v) => v !== OUTSIDE) : [];
  let belowAll: Rect[] = modelled.filter((m) => m.base >= 0).flatMap((m) => regionRects(m.grid, (v) => v !== OUTSIDE));
  for (const level of src.levels) {
    const shell = src.shell[level.id];
    if (!shell || src.floors[level.id]) continue;
    buildShellLevel(shell, belowAll, level.elevation, fh, ext, fh);
    belowAll = belowAll.concat(shell);
  }
  for (const st of src.stairs ?? []) buildStair(st, stairsPart);
  for (const l of src.landings ?? []) {
    horizontal(stairsPart.floor, l.rect, l.elevation + 0.02, true, 0.6);
    horizontal(stairsPart.ceiling, l.rect, l.elevation - 0.25, false, 1.2);
    stairsPart.colliders.push(slabBox(l.rect, l.elevation, 0.25));
  }
  return { exterior: ext.build(), levels, stairs: stairsPart.build(), footprint };
}
