import type { FloorPlan, Opening, Rect, Space } from './buildingTypes';
import { CELL, OUTSIDE, type FloorGrid } from './floorGrid';
import type { ColliderBox } from './buildingMesh';

/**
 * Procedural furniture layouts in plan coordinates. Every candidate footprint (plus clearance) must
 * lie entirely inside its own space (or space group) on the floor grid, which keeps furniture out of
 * walls, doors, voids, cores and neighbouring rooms without hand placement. Keep-out circles protect
 * elevator landings, signs and stair ends.
 */
export type FurnitureKind = 'shelf' | 'table' | 'chair' | 'plinth' | 'screen' | 'bed' | 'whiteboard' | 'bunk' | 'toilet' | 'sink' | 'mirror' | 'partition';

export interface FurnitureItem {
  kind: FurnitureKind;
  /** Bottom-centre position (plan x, elevation, plan y), yaw about +Y, size. */
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
  /** Book colour variation seed / fabric tint index. */
  tint: number;
}

export interface KeepOut {
  x: number;
  y: number;
  r: number;
}

const SHELF_LEN = 0.9;
/** Chair centre past the table edge: the seat front sits ~10 cm under the top. */
const TUCK = 0.12;

/** Yaw that turns an item's front (local −Z) toward plan direction (fx, fy). */
const yawToward = (fx: number, fy: number): number => Math.atan2(-fx, -fy);
const SHELF_DEPTH = 0.55;

interface Ctx {
  grid: FloorGrid;
  ids: Set<number>;
  base: number;
  keepOut: readonly KeepOut[];
  items: FurnitureItem[];
  colliders: ColliderBox[];
  /** 0.5 m occupancy so items from neighbouring rects of the same room never overlap. */
  occ: Occupancy;
}

const OCC = 0.5;

class Occupancy {
  private readonly cells = new Set<number>();
  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }
  free(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let cx = Math.floor(x0 / OCC); cx <= Math.floor((x1 - 1e-6) / OCC); cx++)
      for (let cy = Math.floor(y0 / OCC); cy <= Math.floor((y1 - 1e-6) / OCC); cy++) if (this.cells.has(this.key(cx, cy))) return false;
    return true;
  }
  take(x0: number, y0: number, x1: number, y1: number): void {
    for (let cx = Math.floor(x0 / OCC); cx <= Math.floor((x1 - 1e-6) / OCC); cx++)
      for (let cy = Math.floor(y0 / OCC); cy <= Math.floor((y1 - 1e-6) / OCC); cy++) this.cells.add(this.key(cx, cy));
  }
}

/**
 * True if the axis-aligned rect (expanded by `pad`) is entirely inside the space, clear of keep-outs
 * and not occupied; on success the rect itself is reserved.
 */
function fits(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, pad: number, occPad = 0.2): boolean {
  if (!ctx.occ.free(x0 - occPad, y0 - occPad, x1 + occPad, y1 + occPad)) return false;
  if (!fitsSpace(ctx, x0, y0, x1, y1, pad)) return false;
  // A negative margin reserves a shrunken footprint, so items meant to touch (shelf units) can.
  const shrink = Math.max(0, -occPad);
  ctx.occ.take(x0 + shrink, y0 + shrink, x1 - shrink, y1 - shrink);
  return true;
}

function fitsSpace(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, pad: number): boolean {
  const g = ctx.grid;
  const a = x0 - pad, b = y0 - pad, c = x1 + pad, d = y1 + pad;
  for (const k of ctx.keepOut) {
    const nx = Math.max(a, Math.min(k.x, c)), ny = Math.max(b, Math.min(k.y, d));
    if (Math.hypot(nx - k.x, ny - k.y) < k.r) return false;
  }
  const step = CELL * 2;
  for (let x = a; x <= c + 1e-6; x += step) {
    for (const y of [b, d]) if (!inside(g, ctx.ids, x, y)) return false;
  }
  for (let y = b; y <= d + 1e-6; y += step) {
    for (const x of [a, c]) if (!inside(g, ctx.ids, x, y)) return false;
  }
  // Interior samples catch cores / pillars that sit fully inside the rect.
  for (let x = a + 0.5; x < c; x += 1) for (let y = b + 0.5; y < d; y += 1) if (!inside(g, ctx.ids, x, y)) return false;
  return true;
}

function inside(g: FloorGrid, ids: Set<number>, x: number, y: number): boolean {
  const col = Math.floor((x - g.x0) / CELL), row = Math.floor((y - g.y0) / CELL);
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return false;
  const v = g.ids[row * g.w + col]!;
  return v !== OUTSIDE && ids.has(v);
}

const hash = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Shelf rows along the rect's long axis; units of 0.9 m grouped into runs with cross aisles. */
function stacks(ctx: Ctx, r: Rect, height: number, pitch: number, double: boolean): void {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0;
  const depth = double ? SHELF_DEPTH : 0.4;
  const crossFrom = (alongX ? y0 : x0) + 1.2, crossTo = alongX ? y1 - 1.0 : x1 - 1.0;
  const runFrom = (alongX ? x0 : y0) + 1.2, runTo = (alongX ? x1 : y1) - 1.2;
  const RUN_UNITS = 7;
  for (let c = crossFrom + depth / 2; c + depth / 2 <= crossTo; c += pitch) {
    let run: { start: number; end: number } | null = null;
    let units = 0;
    const flush = (): void => {
      if (!run) return;
      const mid = (run.start + run.end) / 2, half = (run.end - run.start) / 2;
      ctx.colliders.push(alongX
        ? { c: [mid, ctx.base + height / 2, c], h: [half, height / 2, depth / 2] }
        : { c: [c, ctx.base + height / 2, mid], h: [depth / 2, height / 2, half] });
      run = null;
      units = 0;
    };
    for (let u = runFrom; u + SHELF_LEN <= runTo; u += SHELF_LEN) {
      if (units === RUN_UNITS) {
        flush();
        u += 1.2 - SHELF_LEN; // cross aisle
        continue;
      }
      const [ax, ay, bx, by] = alongX ? [u, c - depth / 2, u + SHELF_LEN, c + depth / 2] : [c - depth / 2, u, c + depth / 2, u + SHELF_LEN];
      // Units in a run butt against each other, so they skip the occupancy margin.
      if (!fits(ctx, ax, ay, bx, by, 0.75, -0.26)) {
        flush();
        continue;
      }
      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      ctx.items.push({ kind: 'shelf', x: cx, y: ctx.base, z: cy, ry: alongX ? 0 : Math.PI / 2, sx: SHELF_LEN, sy: height, sz: depth, tint: hash(cx, cy) });
      if (!run) run = { start: u, end: u + SHELF_LEN };
      else run.end = u + SHELF_LEN;
      units++;
    }
    flush();
  }
}

/** Grid of tables with chairs on both long sides. */
function tables(ctx: Ctx, r: Rect, w: number, d: number, pitchX: number, pitchY: number, chairsPerSide: number): void {
  const [x0, y0, x1, y1] = r;
  for (let x = x0 + 1.4 + w / 2; x + w / 2 <= x1 - 1.4; x += pitchX) {
    for (let y = y0 + 1.6 + d / 2; y + d / 2 <= y1 - 1.6; y += pitchY) {
      if (!fits(ctx, x - w / 2, y - d / 2, x + w / 2, y + d / 2, 0.9)) continue;
      ctx.items.push({ kind: 'table', x, y: ctx.base, z: y, ry: 0, sx: w, sy: 0.75, sz: d, tint: 0 });
      for (let i = 0; i < chairsPerSide; i++) {
        const cx = x - w / 2 + (w * (i + 0.5)) / chairsPerSide;
        ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: y - d / 2 - TUCK, ry: Math.PI, sx: 1, sy: 1, sz: 1, tint: hash(cx, y) });
        ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: y + d / 2 + TUCK, ry: 0, sx: 1, sy: 1, sz: 1, tint: hash(y, cx) });
      }
    }
  }
}

/** Rows of seats (optionally with desks) facing a screen on the far short wall. */
function seating(ctx: Ctx, r: Rect, withDesks: boolean): void {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0; // rows advance along the long axis
  const len = alongX ? x1 - x0 : y1 - y0;
  const wid = alongX ? y1 - y0 : x1 - x0;
  const screenAt = alongX ? x0 + 0.15 : y0 + 0.15;
  const facing = alongX ? yawToward(-1, 0) : yawToward(0, -1); // seats look toward the board (−X or −Y)
  // Classrooms get a whiteboard on the front wall; lecture halls a projection screen.
  const board = withDesks
    ? { kind: 'whiteboard' as const, y: ctx.base + 0.85, sx: Math.min(wid - 1.6, 3.6), sy: 1.2, sz: 0.05 }
    : { kind: 'screen' as const, y: ctx.base + 0.9, sx: Math.min(wid - 1.2, 5), sy: 2.0, sz: 0.06 };
  ctx.items.push(alongX
    ? { ...board, x: screenAt, z: (y0 + y1) / 2, ry: Math.PI / 2, tint: 0 }
    : { ...board, x: (x0 + x1) / 2, z: screenAt, ry: 0, tint: 0 });
  const pitch = withDesks ? 1.5 : 1.0;
  for (let a = 2.6; a < len - 1.0; a += pitch) {
    for (let b = 1.0; b < wid - 1.0; b += withDesks ? 1.3 : 0.6) {
      const px = alongX ? x0 + a : x0 + b, py = alongX ? y0 + b : y0 + a;
      if (!fits(ctx, px - 0.25, py - 0.25, px + 0.25, py + 0.25, 0.3)) continue;
      ctx.items.push({ kind: 'chair', x: px, y: ctx.base, z: py, ry: facing, sx: 1, sy: 1, sz: 1, tint: 0.85 });
      if (withDesks) {
        const dx = alongX ? px - 0.4 : px, dy = alongX ? py : py - 0.4;
        ctx.items.push({ kind: 'table', x: dx, y: ctx.base, z: dy, ry: alongX ? Math.PI / 2 : 0, sx: 1.1, sy: 0.75, sz: 0.5, tint: 0 });
      }
    }
  }
}

function singleDesk(ctx: Ctx, r: Rect, door: Opening | undefined): void {
  const [x0, y0, x1, y1] = r;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // Desk against the wall farthest from the door, chair facing it.
  const dm = door ? [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2] : [x0, cy];
  const awayX = Math.abs((dm[0] ?? cx) - cx) >= Math.abs((dm[1] ?? cy) - cy);
  if (awayX) {
    const wallX = (dm[0] ?? cx) < cx ? x1 - 0.35 : x0 + 0.35;
    const chairX = (dm[0] ?? cx) < cx ? wallX - 0.3 - TUCK : wallX + 0.3 + TUCK;
    ctx.items.push({ kind: 'table', x: wallX, y: ctx.base, z: cy, ry: Math.PI / 2, sx: Math.min(1.2, y1 - y0 - 0.3), sy: 0.75, sz: 0.6, tint: 0 });
    ctx.items.push({ kind: 'chair', x: chairX, y: ctx.base, z: cy, ry: yawToward(Math.sign(wallX - chairX), 0), sx: 1, sy: 1, sz: 1, tint: 0.3 });
  } else {
    const wallY = (dm[1] ?? cy) < cy ? y1 - 0.35 : y0 + 0.35;
    const chairY = (dm[1] ?? cy) < cy ? wallY - 0.3 - TUCK : wallY + 0.3 + TUCK;
    ctx.items.push({ kind: 'table', x: cx, y: ctx.base, z: wallY, ry: 0, sx: Math.min(1.2, x1 - x0 - 0.3), sy: 0.75, sz: 0.6, tint: 0 });
    ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: chairY, ry: yawToward(0, Math.sign(wallY - chairY)), sx: 1, sy: 1, sz: 1, tint: 0.3 });
  }
}

/** One meeting table centred in the room, chairs along both long sides. */
function discussion(ctx: Ctx, r: Rect): void {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0;
  const long = Math.min(2.4, (alongX ? x1 - x0 : y1 - y0) - 1.6);
  const short = Math.min(1.1, (alongX ? y1 - y0 : x1 - x0) - 1.8);
  if (long < 0.8 || short < 0.5) return;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = alongX ? long : short, d = alongX ? short : long;
  if (!fits(ctx, cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, 0.5)) return;
  ctx.items.push({ kind: 'table', x: cx, y: ctx.base, z: cy, ry: 0, sx: w, sy: 0.75, sz: d, tint: 0 });
  const n = Math.max(1, Math.round(long / 0.8));
  for (let i = 0; i < n; i++) {
    const t = -long / 2 + (long * (i + 0.5)) / n;
    for (const side of [-1, 1] as const) {
      const off = side * ((alongX ? d : w) / 2 + TUCK);
      ctx.items.push(alongX
        ? { kind: 'chair', x: cx + t, y: ctx.base, z: cy + off, ry: yawToward(0, -side), sx: 1, sy: 1, sz: 1, tint: hash(t, side) }
        : { kind: 'chair', x: cx + off, y: ctx.base, z: cy + t, ry: yawToward(-side, 0), sx: 1, sy: 1, sz: 1, tint: hash(side, t) });
    }
  }
}

/**
 * Four-person dorm room: a bunk bed along each long wall at the far end, then two desks per wall
 * with chairs tucked in (as many as the room length allows).
 */
function dormRoom(ctx: Ctx, r: Rect, door: Opening | undefined): void {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0;
  const lo = alongX ? x0 : y0, hi = alongX ? x1 : y1;
  const latLo = alongX ? y0 : x0, latHi = alongX ? y1 : x1;
  if (hi - lo < 3.2 || latHi - latLo < 2.4) return;
  const dm = door ? (alongX ? (door.a[0] + door.b[0]) / 2 : (door.a[1] + door.b[1]) / 2) : lo;
  const farHigh = Math.abs(dm - lo) < Math.abs(dm - hi); // door near the low end → beds at the high end
  const dir = farHigh ? -1 : 1;
  const end = farHigh ? hi : lo;
  const BED_L = 2.0, BED_W = 0.95, DESK_L = 1.0, DESK_D = 0.6, BUNK_H = 1.85;
  // (u along the room, l across it) → plan rect / point.
  const rect = (u0: number, u1: number, l0: number, l1: number): Rect =>
    alongX ? [Math.min(u0, u1), l0, Math.max(u0, u1), l1] : [l0, Math.min(u0, u1), l1, Math.max(u0, u1)];
  const pt = (u: number, l: number): [number, number] => (alongX ? [u, l] : [l, u]);
  for (const latSide of [1, -1] as const) {
    const wall = latSide > 0 ? latLo : latHi;
    const lat = wall + latSide * (0.1 + BED_W / 2);
    const bedMid = end + dir * (0.1 + BED_L / 2);
    const [bx0, by0, bx1, by1] = rect(bedMid - BED_L / 2, bedMid + BED_L / 2, lat - BED_W / 2, lat + BED_W / 2);
    if (fits(ctx, bx0, by0, bx1, by1, 0.05, 0)) {
      const [px, py] = pt(bedMid, lat);
      ctx.items.push(alongX
        ? { kind: 'bunk', x: px, y: ctx.base, z: py, ry: Math.PI / 2 * -dir, sx: BED_W, sy: 1, sz: BED_L, tint: hash(px, py) }
        : { kind: 'bunk', x: px, y: ctx.base, z: py, ry: dir > 0 ? Math.PI : 0, sx: BED_W, sy: 1, sz: BED_L, tint: hash(px, py) });
      ctx.colliders.push({ c: [(bx0 + bx1) / 2, ctx.base + BUNK_H / 2, (by0 + by1) / 2], h: [(bx1 - bx0) / 2, BUNK_H / 2, (by1 - by0) / 2] });
    }
    // Two desks against the same wall past the bunk, chairs tucked in facing the wall.
    const deskLat = wall + latSide * (DESK_D / 2);
    for (let k = 0; k < 2; k++) {
      const deskMid = end + dir * (0.1 + BED_L + 0.15 + DESK_L / 2 + k * (DESK_L + 0.05));
      const [dx0, dy0, dx1, dy1] = rect(deskMid - DESK_L / 2, deskMid + DESK_L / 2, deskLat - DESK_D / 2, deskLat + DESK_D / 2);
      if (!fits(ctx, dx0, dy0, dx1, dy1, 0.05, 0)) break;
      const [px, py] = pt(deskMid, deskLat);
      ctx.items.push({ kind: 'table', x: px, y: ctx.base, z: py, ry: alongX ? 0 : Math.PI / 2, sx: DESK_L, sy: 0.75, sz: DESK_D, tint: 0 });
      const [cx, cy] = pt(deskMid, deskLat + latSide * (DESK_D / 2 + TUCK));
      const [fx, fy] = pt(0, -latSide);
      ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: cy, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: hash(cx, cy) });
    }
  }
}

/**
 * Shared restroom: a row of toilet stalls (partitions, doors left ajar, a toilet each) along one
 * long wall from the far end, and a sink counter with a mirror on the opposite wall.
 */
function restroom(ctx: Ctx, r: Rect, door: Opening | undefined): void {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0;
  const lo = alongX ? x0 : y0, hi = alongX ? x1 : y1;
  const latLo = alongX ? y0 : x0, latHi = alongX ? y1 : x1;
  if (hi - lo < 3 || latHi - latLo < 2.8) return;
  const dm = door ? (alongX ? (door.a[0] + door.b[0]) / 2 : (door.a[1] + door.b[1]) / 2) : lo;
  const farHigh = Math.abs(dm - lo) < Math.abs(dm - hi);
  const dir = farHigh ? -1 : 1;
  const end = farHigh ? hi : lo;
  const pt = (u: number, l: number): [number, number] => (alongX ? [u, l] : [l, u]);
  /** Axis-aligned panel from (u0, l0) to (u1, l1) in room axes, `h` tall from `y`. */
  const panel = (u0: number, u1: number, l0: number, l1: number, y: number, h: number, solid: boolean): void => {
    const [ax, ay] = pt(Math.min(u0, u1), Math.min(l0, l1)), [bx, by] = pt(Math.max(u0, u1), Math.max(l0, l1));
    const sx = Math.max(bx - ax, 0.04), sz = Math.max(by - ay, 0.04);
    ctx.items.push({ kind: 'partition', x: (ax + bx) / 2, y, z: (ay + by) / 2, ry: 0, sx, sy: h, sz, tint: 0 });
    if (solid) ctx.colliders.push({ c: [(ax + bx) / 2, y + h / 2, (ay + by) / 2], h: [sx / 2, h / 2, sz / 2] });
  };

  // Stalls: 1.0 m wide, 1.4 m deep, keeping 1.6 m clear by the door.
  const STALL_W = 1.0, STALL_D = 1.4, PART_H = 1.8, LIFT = 0.12;
  const count = Math.min(4, Math.floor((hi - lo - 1.6) / STALL_W));
  const front = latLo + STALL_D;
  const stallFar = end, stallNear = end + dir * count * STALL_W;
  const [sx0, sy0] = pt(Math.min(stallFar, stallNear), latLo), [sx1, sy1] = pt(Math.max(stallFar, stallNear), front);
  if (count > 0 && fits(ctx, Math.min(sx0, sx1), Math.min(sy0, sy1), Math.max(sx0, sx1), Math.max(sy0, sy1), 0, 0)) {
    for (let k = 0; k <= count; k++) {
      const u = end + dir * k * STALL_W;
      panel(u - 0.02, u + 0.02, latLo, front, ctx.base + LIFT, PART_H, true);
    }
    for (let k = 0; k < count; k++) {
      const ua = end + dir * k * STALL_W, ub = ua + dir * STALL_W;
      const uMid = (ua + ub) / 2;
      // Front: narrow fixed panels either side of a 0.6 m door left ajar into the stall.
      panel(ua, ua + dir * 0.2, front - 0.02, front + 0.02, ctx.base + LIFT, PART_H, true);
      panel(ub - dir * 0.2, ub, front - 0.02, front + 0.02, ctx.base + LIFT, PART_H, true);
      const hinge = pt(ua + dir * 0.2, front);
      const open = 1.1; // radians the leaf has swung in from the closed line
      const [ldx, ldy] = pt(dir * Math.cos(open), -Math.sin(open));
      ctx.items.push({ kind: 'partition', x: hinge[0] + ldx * 0.3, y: ctx.base + LIFT, z: hinge[1] + ldy * 0.3, ry: Math.atan2(-ldy, ldx), sx: 0.6, sy: PART_H, sz: 0.035, tint: 0 });
      const [tx, ty] = pt(uMid, latLo + 0.3);
      const [fx, fy] = pt(0, 1);
      ctx.items.push({ kind: 'toilet', x: tx, y: ctx.base, z: ty, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: 0 });
    }
    panel(stallFar, stallNear, front - 0.03, front + 0.03, ctx.base + PART_H + LIFT - 0.06, 0.06, false); // head rail
  }

  // Sinks along the opposite wall, centred on the room, mirror above.
  const SINK_W = 0.6, SINK_D = 0.55;
  const sinks = Math.min(3, Math.floor((hi - lo - 1.4) / SINK_W));
  if (sinks < 1) return;
  const mid = (lo + hi) / 2, half = (sinks * SINK_W) / 2;
  const [cx0, cy0] = pt(mid - half, latHi - SINK_D), [cx1, cy1] = pt(mid + half, latHi - 0.03); // inset: the far wall line samples as outside
  if (!fits(ctx, Math.min(cx0, cx1), Math.min(cy0, cy1), Math.max(cx0, cx1), Math.max(cy0, cy1), 0, 0)) return;
  const [fx, fy] = pt(0, -1);
  for (let k = 0; k < sinks; k++) {
    const [px, py] = pt(mid - half + SINK_W * (k + 0.5), latHi - 0.03 - SINK_D / 2);
    ctx.items.push({ kind: 'sink', x: px, y: ctx.base, z: py, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: 0 });
  }
  ctx.colliders.push({ c: [(cx0 + cx1) / 2, ctx.base + 0.45, (cy0 + cy1) / 2], h: [Math.abs(cx1 - cx0) / 2, 0.45, Math.abs(cy1 - cy0) / 2] });
  const [mx0, my0] = pt(mid - half, latHi - 0.03), [mx1, my1] = pt(mid + half, latHi - 0.01);
  ctx.items.push({ kind: 'mirror', x: (mx0 + mx1) / 2, y: ctx.base + 1.15, z: (my0 + my1) / 2, ry: 0, sx: Math.max(Math.abs(mx1 - mx0), 0.02), sy: 0.85, sz: Math.max(Math.abs(my1 - my0), 0.02), tint: 0 });
}

function plinths(ctx: Ctx, r: Rect): void {
  const [x0, y0, x1, y1] = r;
  for (let x = x0 + 2.5; x < x1 - 2; x += 4) {
    for (let y = y0 + 2.5; y < y1 - 2; y += 4) {
      if (!fits(ctx, x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.2)) continue;
      ctx.items.push({ kind: 'plinth', x, y: ctx.base, z: y, ry: 0, sx: 0.8, sy: 1.0, sz: 0.8, tint: 0 });
      ctx.colliders.push({ c: [x, ctx.base + 0.5, y], h: [0.4, 0.5, 0.4] });
    }
  }
}

export function layoutFurniture(plan: FloorPlan, grid: FloorGrid, base: number, keepOut: readonly KeepOut[]): { items: FurnitureItem[]; colliders: ColliderBox[] } {
  const items: FurnitureItem[] = [];
  const colliders: ColliderBox[] = [];
  plan.spaces.forEach((s: Space, id) => {
    if (!s.furnish) return;
    const ids = new Set<number>();
    plan.spaces.forEach((o, j) => {
      if (j === id || (s.group && o.group === s.group)) ids.add(j);
    });
    const ctx: Ctx = { grid, ids, base, keepOut, items, colliders, occ: new Occupancy() };
    const door = plan.openings.find((o) => s.rects.some(([a, b, c, d]) => {
      const mx = (o.a[0] + o.b[0]) / 2, my = (o.a[1] + o.b[1]) / 2;
      return mx >= a - 0.05 && mx <= c + 0.05 && my >= b - 0.05 && my <= d + 0.05;
    }));
    const area = (q: Rect): number => (q[2] - q[0]) * (q[3] - q[1]);
    const rects = s.furnishMain ? [s.rects.reduce((a, q) => (area(q) > area(a) ? q : a))] : s.rects;
    for (const r of rects) {
      switch (s.furnish) {
        case 'stacks': stacks(ctx, r, 2.1, 1.6, true); break;
        case 'periodicals': stacks(ctx, r, 1.4, 2.4, true); break;
        case 'picturebooks': stacks(ctx, r, 1.0, 2.6, false); break;
        case 'reading': tables(ctx, r, 1.6, 0.8, 3.0, 2.8, 2); break;
        case 'office': tables(ctx, r, 1.4, 0.7, 2.6, 2.6, 1); break;
        case 'discussion': discussion(ctx, r); break;
        case 'carrel': singleDesk(ctx, r, door); break;
        case 'theater': seating(ctx, r, false); break;
        case 'classroom': seating(ctx, r, true); break;
        case 'exhibit': plinths(ctx, r); break;
        case 'dorm': dormRoom(ctx, r, door); break;
        case 'restroom': restroom(ctx, r, door); break;
      }
    }
  });
  return { items, colliders };
}
