import type { FloorPlan, Opening, Rect, Space } from './buildingTypes';
import { CELL, OUTSIDE, type FloorGrid } from './floorGrid';
import type { ColliderBox } from './buildingMesh';

/**
 * Procedural furniture layouts in plan coordinates. Every candidate footprint (plus clearance) must
 * lie entirely inside its own space (or space group) on the floor grid, which keeps furniture out of
 * walls, doors, voids, cores and neighbouring rooms without hand placement. Keep-out circles protect
 * elevator landings, signs and stair ends.
 */
export type FurnitureKind = 'shelf' | 'table' | 'chair' | 'plinth' | 'screen' | 'bed';

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
        ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: y - d / 2 - 0.35, ry: 0, sx: 1, sy: 1, sz: 1, tint: hash(cx, y) });
        ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: y + d / 2 + 0.35, ry: Math.PI, sx: 1, sy: 1, sz: 1, tint: hash(y, cx) });
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
  const facing = alongX ? -Math.PI / 2 : Math.PI; // seats look toward the screen (−X or −Y)
  ctx.items.push(alongX
    ? { kind: 'screen', x: screenAt, y: ctx.base + 0.9, z: (y0 + y1) / 2, ry: Math.PI / 2, sx: Math.min(wid - 1.2, 5), sy: 2.0, sz: 0.06, tint: 0 }
    : { kind: 'screen', x: (x0 + x1) / 2, y: ctx.base + 0.9, z: screenAt, ry: 0, sx: Math.min(wid - 1.2, 5), sy: 2.0, sz: 0.06, tint: 0 });
  const pitch = withDesks ? 1.5 : 1.0;
  for (let a = 2.6; a < len - 1.0; a += pitch) {
    for (let b = 1.0; b < wid - 1.0; b += withDesks ? 1.3 : 0.6) {
      const px = alongX ? x0 + a : x0 + b, py = alongX ? y0 + b : y0 + a;
      if (!fits(ctx, px - 0.25, py - 0.25, px + 0.25, py + 0.25, 0.3)) continue;
      ctx.items.push({ kind: 'chair', x: px, y: ctx.base, z: py, ry: facing, sx: 1, sy: 1, sz: 1, tint: 0.85 });
      if (withDesks) {
        const dx = alongX ? px - 0.5 : px, dy = alongX ? py : py - 0.5;
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
    const chairX = (dm[0] ?? cx) < cx ? wallX - 0.7 : wallX + 0.7;
    ctx.items.push({ kind: 'table', x: wallX, y: ctx.base, z: cy, ry: Math.PI / 2, sx: Math.min(1.2, y1 - y0 - 0.3), sy: 0.75, sz: 0.6, tint: 0 });
    ctx.items.push({ kind: 'chair', x: chairX, y: ctx.base, z: cy, ry: (dm[0] ?? cx) < cx ? Math.PI / 2 : -Math.PI / 2, sx: 1, sy: 1, sz: 1, tint: 0.3 });
  } else {
    const wallY = (dm[1] ?? cy) < cy ? y1 - 0.35 : y0 + 0.35;
    const chairY = (dm[1] ?? cy) < cy ? wallY - 0.7 : wallY + 0.7;
    ctx.items.push({ kind: 'table', x: cx, y: ctx.base, z: wallY, ry: 0, sx: Math.min(1.2, x1 - x0 - 0.3), sy: 0.75, sz: 0.6, tint: 0 });
    ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: chairY, ry: (dm[1] ?? cy) < cy ? 0 : Math.PI, sx: 1, sy: 1, sz: 1, tint: 0.3 });
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
      const off = side * ((alongX ? d : w) / 2 + 0.35);
      ctx.items.push(alongX
        ? { kind: 'chair', x: cx + t, y: ctx.base, z: cy + off, ry: side < 0 ? 0 : Math.PI, sx: 1, sy: 1, sz: 1, tint: hash(t, side) }
        : { kind: 'chair', x: cx + off, y: ctx.base, z: cy + t, ry: side < 0 ? Math.PI / 2 : -Math.PI / 2, sx: 1, sy: 1, sz: 1, tint: hash(side, t) });
    }
  }
}

/** Two-person dorm room: beds along both long walls at the far end, desks after them. */
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
  const BED_L = 2.0, BED_W = 0.95, DESK_L = 1.1, DESK_D = 0.6;
  for (const [lat, latSide] of [[latLo + 0.1 + BED_W / 2, 1], [latHi - 0.1 - BED_W / 2, -1]] as const) {
    const bedMid = end + dir * (0.1 + BED_L / 2);
    const [bx0, by0, bx1, by1] = alongX
      ? [bedMid - BED_L / 2, lat - BED_W / 2, bedMid + BED_L / 2, lat + BED_W / 2]
      : [lat - BED_W / 2, bedMid - BED_L / 2, lat + BED_W / 2, bedMid + BED_L / 2];
    if (fits(ctx, bx0, by0, bx1, by1, 0.05, 0)) {
      ctx.items.push(alongX
        ? { kind: 'bed', x: bedMid, y: ctx.base, z: lat, ry: Math.PI / 2 * -dir, sx: BED_W, sy: 1, sz: BED_L, tint: hash(bedMid, lat) }
        : { kind: 'bed', x: lat, y: ctx.base, z: bedMid, ry: dir > 0 ? Math.PI : 0, sx: BED_W, sy: 1, sz: BED_L, tint: hash(lat, bedMid) });
      ctx.colliders.push({ c: [(bx0 + bx1) / 2, ctx.base + 0.25, (by0 + by1) / 2], h: [(bx1 - bx0) / 2, 0.25, (by1 - by0) / 2] });
    }
    // Desk against the same wall, just past the bed, with a chair facing it.
    const deskMid = end + dir * (0.1 + BED_L + 0.15 + DESK_L / 2);
    const deskLat = latSide > 0 ? latLo + DESK_D / 2 : latHi - DESK_D / 2;
    const [dx0, dy0, dx1, dy1] = alongX
      ? [deskMid - DESK_L / 2, deskLat - DESK_D / 2, deskMid + DESK_L / 2, deskLat + DESK_D / 2]
      : [deskLat - DESK_D / 2, deskMid - DESK_L / 2, deskLat + DESK_D / 2, deskMid + DESK_L / 2];
    if (!fits(ctx, dx0, dy0, dx1, dy1, 0.05, 0)) continue;
    const chairLat = deskLat + latSide * (DESK_D / 2 + 0.35);
    ctx.items.push(alongX
      ? { kind: 'table', x: deskMid, y: ctx.base, z: deskLat, ry: 0, sx: DESK_L, sy: 0.75, sz: DESK_D, tint: 0 }
      : { kind: 'table', x: deskLat, y: ctx.base, z: deskMid, ry: Math.PI / 2, sx: DESK_L, sy: 0.75, sz: DESK_D, tint: 0 });
    // Chair yaw 0 faces −Z: turn it to face the desk across the room's short axis.
    const chairYaw = alongX ? (latSide > 0 ? 0 : Math.PI) : (latSide > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.items.push(alongX
      ? { kind: 'chair', x: deskMid, y: ctx.base, z: chairLat, ry: chairYaw, sx: 1, sy: 1, sz: 1, tint: hash(deskMid, chairLat) }
      : { kind: 'chair', x: chairLat, y: ctx.base, z: deskMid, ry: chairYaw, sx: 1, sy: 1, sz: 1, tint: hash(chairLat, deskMid) });
  }
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
    for (const r of s.rects) {
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
      }
    }
  });
  return { items, colliders };
}
