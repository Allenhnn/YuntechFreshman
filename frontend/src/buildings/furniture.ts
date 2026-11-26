import type { FloorPlan, Opening, Rect, Space } from './buildingTypes';
import { CELL, OUTSIDE, type FloorGrid } from './floorGrid';
import { WALL_T } from './wallConst';
import type { ColliderBox } from './buildingMesh';

/**
 * Procedural furniture layouts in plan coordinates. Every candidate footprint (plus clearance) must
 * lie entirely inside its own space (or space group) on the floor grid, which keeps furniture out of
 * walls, doors, voids, cores and neighbouring rooms without hand placement. Keep-out circles protect
 * elevator landings, signs and stair ends.
 */
export type FurnitureKind = 'shelf' | 'table' | 'chair' | 'plinth' | 'stage' | 'riser' | 'screen' | 'bed' | 'whiteboard' | 'bunk' | 'toilet' | 'sink' | 'mirror' | 'partition' | 'hydrant' | 'bins' | 'sign' | 'bracket' | 'vending' | 'loft' | 'podium' | 'student' | 'teacher' | 'head' | 'counter' | 'mic' | 'woodbox' | 'stonebox';

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
  /** Hanging signs: the text on this face. */
  label?: string;
  /** Chairs with a student figure on them (not offered as a seat). */
  taken?: boolean;
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
  const at = (a: number, b: number): [number, number] => (alongX ? [x0 + a, y0 + b] : [x0 + b, y0 + a]);
  if (withDesks && len > 6 && wid > 3.4) {
    // 講台: a low platform across the front, a lectern on it and the professor behind it facing the class.
    const mid = wid / 2;
    const [sx, sy] = at(1.05, mid);
    ctx.items.push({ kind: 'stage', x: sx, y: ctx.base, z: sy, ry: 0, sx: alongX ? 1.5 : Math.min(wid - 1.2, 4.5), sy: 0.18, sz: alongX ? Math.min(wid - 1.2, 4.5) : 1.5, tint: 0 });
    ctx.colliders.push({ c: [sx, ctx.base + 0.09, sy], h: [alongX ? 0.75 : Math.min(wid - 1.2, 4.5) / 2, 0.09, alongX ? Math.min(wid - 1.2, 4.5) / 2 : 0.75] });
    const toClass = alongX ? yawToward(1, 0) : yawToward(0, 1);
    const [lx, ly] = at(1.55, mid + 0.9);
    ctx.items.push({ kind: 'podium', x: lx, y: ctx.base + 0.18, z: ly, ry: toClass, sx: 1, sy: 1, sz: 1, tint: 0 });
    ctx.colliders.push({ c: [lx, ctx.base + 0.18 + 0.55, ly], h: [0.32, 0.55, 0.32] });
    const [tx, ty] = at(1.0, mid + 0.9);
    ctx.items.push({ kind: 'teacher', x: tx, y: ctx.base + 0.18, z: ty, ry: toClass, sx: 1.25, sy: 1.25, sz: 1.25, tint: 0.62 });
    ctx.items.push({ kind: 'head', x: tx, y: ctx.base + 0.18 + 0.98 * 1.25, z: ty, ry: toClass, sx: 0.34 * 1.25, sy: 0.34 * 1.25, sz: 0.34 * 1.25, tint: 0 });
    ctx.colliders.push({ c: [tx, ctx.base + 1.0, ty], h: [0.3, 0.8, 0.3] });
    ctx.occ.take(Math.min(lx, tx) - 0.5, Math.min(ly, ty) - 0.5, Math.max(lx, tx) + 0.5, Math.max(ly, ty) + 0.5);
  }
  const pitch = withDesks ? 1.5 : 1.0;
  for (let a = 2.6; a < len - 1.0; a += pitch) {
    for (let b = 1.0; b < wid - 1.0; b += withDesks ? 1.3 : 0.6) {
      const px = alongX ? x0 + a : x0 + b, py = alongX ? y0 + b : y0 + a;
      if (!fits(ctx, px - 0.25, py - 0.25, px + 0.25, py + 0.25, 0.3)) continue;
      // Most classroom seats have a student in them; a few stay free (for you).
      const student = withDesks && hash(px * 1.7, py * 2.3) < 0.7;
      ctx.items.push({ kind: 'chair', x: px, y: ctx.base, z: py, ry: facing, sx: 1, sy: 1, sz: 1, tint: 0.85, ...(student ? { taken: true } : {}) });
      if (student) {
        ctx.items.push({ kind: 'student', x: px, y: ctx.base, z: py, ry: facing, sx: 1, sy: 1, sz: 1, tint: hash(py, px) });
        ctx.items.push({ kind: 'head', x: px, y: ctx.base + 1.12, z: py, ry: facing, sx: 0.32, sy: 0.32, sz: 0.32, tint: 0 });
      }
      if (withDesks) {
        const dx = alongX ? px - 0.4 : px, dy = alongX ? py : py - 0.4;
        ctx.items.push({ kind: 'table', x: dx, y: ctx.base, z: dy, ry: alongX ? Math.PI / 2 : 0, sx: 1.1, sy: 0.75, sz: 0.5, tint: 0 });
      }
    }
  }
}

/**
 * 多功能教室 (MA214, from the user's photo): the front is the wall across from the door — a projection
 * screen, and a low dais with the lectern and the professor facing the class and the door. Then an open
 * strip of floor and three tiers of long wooden desks (front panel, a microphone every other seat, black
 * chairs behind), each tier 16 cm higher; the side blocks turn in a little, like a horseshoe. The back
 * tier leaves an aisle along the door wall.
 */
function conference(ctx: Ctx, r: Rect, door: Opening | undefined): void {
  const [x0, y0, x1, y1] = r;
  const dm: [number, number] = door ? [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2] : [(x0 + x1) / 2, y0];
  // Front wall: the one across from the door. `a` runs from it toward the door, `b` across.
  const alongX = Math.abs(dm[0] - (x0 + x1) / 2) / (x1 - x0) > Math.abs(dm[1] - (y0 + y1) / 2) / (y1 - y0);
  const frontLow = alongX ? dm[0] > (x0 + x1) / 2 : dm[1] > (y0 + y1) / 2; // front at the low edge when the door is high
  const len = alongX ? x1 - x0 : y1 - y0, wid = alongX ? y1 - y0 : x1 - x0;
  const P = (a: number, b: number): [number, number] => {
    const along = frontLow ? (alongX ? x0 : y0) + a : (alongX ? x1 : y1) - a;
    return alongX ? [along, y0 + b] : [x0 + b, along];
  };
  const dirA: [number, number] = alongX ? [frontLow ? 1 : -1, 0] : [0, frontLow ? 1 : -1]; // toward the door
  const toFront = yawToward(-dirA[0], -dirA[1]);
  const toDoor = yawToward(dirA[0], dirA[1]);
  const box = (a0: number, a1: number, b0: number, b1: number): [number, number, number, number] => {
    const [p, q] = P(a0, b0), [s, t] = P(a1, b1);
    return [Math.min(p, s), Math.min(q, t), Math.max(p, s), Math.max(q, t)];
  };
  const mid = wid / 2;
  // Screen on the front wall.
  const [scx, scy] = P(0.12, mid);
  ctx.items.push({ kind: 'screen', x: scx, y: ctx.base + 0.9, z: scy, ry: alongX ? Math.PI / 2 : 0, sx: Math.min(wid - 2, 5.5), sy: 2.2, sz: 0.06, tint: 0 });
  // Dais, lectern and professor, facing the class and the door.
  const dais = box(0.4, 1.9, mid - 2.6, mid + 2.6);
  ctx.items.push({ kind: 'stage', x: (dais[0] + dais[2]) / 2, y: ctx.base, z: (dais[1] + dais[3]) / 2, ry: 0, sx: dais[2] - dais[0], sy: 0.18, sz: dais[3] - dais[1], tint: 0 });
  ctx.colliders.push({ c: [(dais[0] + dais[2]) / 2, ctx.base + 0.09, (dais[1] + dais[3]) / 2], h: [(dais[2] - dais[0]) / 2, 0.09, (dais[3] - dais[1]) / 2] });
  const [lx, ly] = P(1.55, mid + 1.1);
  ctx.items.push({ kind: 'podium', x: lx, y: ctx.base + 0.18, z: ly, ry: toDoor, sx: 1, sy: 1, sz: 1, tint: 0 });
  ctx.colliders.push({ c: [lx, ctx.base + 0.18 + 0.55, ly], h: [0.32, 0.55, 0.32] });
  const [tx, ty] = P(1.0, mid + 1.1);
  ctx.items.push({ kind: 'teacher', x: tx, y: ctx.base + 0.18, z: ty, ry: toDoor, sx: 1.25, sy: 1.25, sz: 1.25, tint: 0.62 });
  ctx.items.push({ kind: 'head', x: tx, y: ctx.base + 0.18 + 0.98 * 1.25, z: ty, ry: toDoor, sx: 0.34 * 1.25, sy: 0.34 * 1.25, sz: 0.34 * 1.25, tint: 0 });
  ctx.colliders.push({ c: [tx, ctx.base + 1.0, ty], h: [0.3, 0.8, 0.3] });
  // Tiers: desk line at `a`, chairs 0.55 behind; side blocks angled in.
  const TIER_H = 0.16, ROW = 1.9;
  const aisle = 1.0, sideW = Math.max(2.2, (wid - 2 * aisle - 0.8) * 0.3), centreW = wid - 2 * aisle - 2 * sideW - 0.8;
  for (let k = 0; k < 3; k++) {
    const a = 3.7 + k * ROW;
    if (a + 1.5 > len - 1.2) break; // keep the aisle along the door wall
    const h = TIER_H * k;
    if (h > 0) {
      // The tier's floor: from just in front of the desk to the back of the chairs (the next tier sits on top).
      const t = box(a - 0.45, k === 2 || a + ROW + 1.5 > len - 1.2 ? a + 1.35 : a + ROW - 0.45, 0.25, wid - 0.25);
      ctx.items.push({ kind: 'riser', x: (t[0] + t[2]) / 2, y: ctx.base, z: (t[1] + t[3]) / 2, ry: 0, sx: t[2] - t[0], sy: h, sz: t[3] - t[1], tint: 0 });
      ctx.colliders.push({ c: [(t[0] + t[2]) / 2, ctx.base + h / 2, (t[1] + t[3]) / 2], h: [(t[2] - t[0]) / 2, h / 2, (t[3] - t[1]) / 2] });
    }
    const blocks: { b0: number; b1: number; turn: number }[] = [
      { b0: 0.4, b1: 0.4 + sideW, turn: -0.18 },
      { b0: 0.4 + sideW + aisle, b1: 0.4 + sideW + aisle + centreW, turn: 0 },
      { b0: wid - 0.4 - sideW, b1: wid - 0.4, turn: 0.18 },
    ];
    for (const bl of blocks) {
      const w = bl.b1 - bl.b0, bm = (bl.b0 + bl.b1) / 2;
      const turn = alongX ? -bl.turn : bl.turn;
      const [cx, cy] = P(a, bm);
      ctx.items.push({ kind: 'counter', x: cx, y: ctx.base + h, z: cy, ry: toFront + turn, sx: w, sy: 1, sz: 1, tint: 0 });
      // Desk collider (axis-aligned around the slightly turned desk is close enough).
      ctx.colliders.push({ c: [cx, ctx.base + h + 0.4, cy], h: alongX ? [0.3, 0.4, w / 2] : [w / 2, 0.4, 0.3] });
      const n = Math.max(1, Math.floor(w / 0.85));
      for (let i = 0; i < n; i++) {
        const b = bl.b0 + (w * (i + 0.5)) / n;
        const [px, py] = P(a + 0.55, b);
        const student = hash(px * 1.7, py * 2.3) < 0.68;
        ctx.items.push({ kind: 'chair', x: px, y: ctx.base + h, z: py, ry: toFront + turn, sx: 1, sy: 1, sz: 1, tint: 0.85, ...(student ? { taken: true } : {}) });
        if (student) {
          ctx.items.push({ kind: 'student', x: px, y: ctx.base + h, z: py, ry: toFront + turn, sx: 1, sy: 1, sz: 1, tint: hash(py, px) });
          ctx.items.push({ kind: 'head', x: px, y: ctx.base + h + 1.12, z: py, ry: toFront + turn, sx: 0.32, sy: 0.32, sz: 0.32, tint: 0 });
        }
        if (i % 2 === 0) {
          const [mx, my] = P(a - 0.12, b);
          ctx.items.push({ kind: 'mic', x: mx, y: ctx.base + h + 0.78, z: my, ry: toFront + turn, sx: 1, sy: 1, sz: 1, tint: 0 });
        }
      }
    }
  }
}

/**
 * 休息區 (the user's photo): a narrow room off the corridor, reddish wood everywhere — panels up the
 * long walls (gaps at doors), a wooden floor, a deep wooden frame round the entrance on the corridor
 * side; low wooden benches along one wall, a long low bench-table on the other, a small table by the
 * window at the far end. Entrance on the short side nearest the corridor (the long axis's high or low end).
 */
function lounge(ctx: Ctx, r: Rect, openings: readonly Opening[]): void {
  const [x0, y0, x1, y1] = r;
  const alongY = y1 - y0 >= x1 - x0;
  const len = alongY ? y1 - y0 : x1 - x0, wid = alongY ? x1 - x0 : y1 - y0;
  // Entrance end: the short side with no wall (the corridor) — taken as the high end here (y1 / x1).
  const P = (a: number, b: number): [number, number] => (alongY ? [x0 + b, y1 - a] : [x1 - a, y0 + b]); // a from the entrance
  const box = (a: number, b: number, la: number, lb: number, y: number, h: number, collide = true): void => {
    const [cx, cz] = P(a, b);
    const sx = alongY ? lb : la, sz = alongY ? la : lb;
    ctx.items.push({ kind: 'woodbox', x: cx, y: ctx.base + y, z: cz, ry: 0, sx, sy: h, sz, tint: 0 });
    if (collide) ctx.colliders.push({ c: [cx, ctx.base + y + h / 2, cz], h: [sx / 2, h / 2, sz / 2] });
  };
  // Floor (a thin layer on the tiles, inside the wall faces).
  const inset = WALL_T / 2;
  box(len / 2, wid / 2, len - 0.04, wid - 2 * inset, 0.07, 0.04, false); // room floors sit 8 cm up (FLOOR_Y)
  // Panels up both long walls, skipping doorways.
  const doorsOn = (side: 0 | 1): [number, number][] => openings
    .filter((o) => {
      const vx = Math.abs(o.a[0] - o.b[0]) < 0.05, wallAt = alongY ? (side ? x1 : x0) : (side ? y1 : y0);
      return (alongY ? vx && Math.abs(o.a[0] - wallAt) < 0.06 : !vx && Math.abs(o.a[1] - wallAt) < 0.06);
    })
    .map((o) => {
      const p = alongY ? [y1 - Math.max(o.a[1], o.b[1]), y1 - Math.min(o.a[1], o.b[1])] : [x1 - Math.max(o.a[0], o.b[0]), x1 - Math.min(o.a[0], o.b[0])];
      return [p[0]! - 0.12, p[1]! + 0.12] as [number, number];
    });
  for (const side of [0, 1] as const) {
    const b = side ? wid - inset - 0.025 : inset + 0.025;
    let a0 = 0.02;
    for (const [d0, d1] of [...doorsOn(side), [len, len] as [number, number]].sort((p, q) => p[0] - q[0])) {
      if (d0 - a0 > 0.1) box((a0 + d0) / 2, b, d0 - a0, 0.04, 0, 2.5, false);
      a0 = Math.max(a0, d1);
    }
  }
  // Entrance frame: two deep posts and a lintel.
  for (const b of [inset + 0.14, wid - inset - 0.14]) box(0.2, b, 0.4, 0.28, 0, 2.75);
  box(0.2, wid / 2, 0.4, wid - 2 * inset, 2.35, 0.4, false);
  // Benches along the low wall (b small), a long low bench-table along the other, a table by the window.
  const n = Math.max(1, Math.floor((len - 2.6) / 1.9));
  for (let i = 0; i < n; i++) box(1.4 + i * 1.9 + 0.8, 0.45, 1.5, 0.42, 0, 0.42);
  box(len * 0.55, wid - 0.55, Math.min(3.2, len * 0.4), 0.6, 0, 0.45);
  box(len - 0.9, wid / 2, 0.7, 0.9, 0, 0.72);
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

/** Dorm room lane sizes (m): bed / desk length along the wall, gap between pieces, gap to the wall. */
export const DORM_LANE = { bed: 2.0, desk: 1.0, gap: 0.06, wall: 0.05 } as const;

export interface DormPiece {
  kind: 'loft' | 'bunk' | 'desk';
  /** +1: lane along the low wall (latLo), −1: along the high wall. */
  side: 1 | -1;
  /** Centre along the room's long axis. */
  u: number;
}

/**
 * Pure layout of a four-person dorm room in rect `r` (room's largest rectangle) with its door:
 * the pieces that fit, in placement order. Shared by the furniture pass and the room generator
 * (which turns rooms that can't take all of them into a common room).
 */
export function planDormRoom(r: Rect, door: Pick<Opening, 'a' | 'b'> | undefined, loft: boolean): { pieces: DormPiece[]; wanted: number; alongX: boolean; dir: 1 | -1 } {
  const [x0, y0, x1, y1] = r;
  const alongX = x1 - x0 >= y1 - y0;
  const lo = alongX ? x0 : y0, hi = alongX ? x1 : y1;
  const latLo = alongX ? y0 : x0, latHi = alongX ? y1 : x1;
  const { bed: BED_L, desk: DESK_L, gap: GAP, wall: WALL } = DORM_LANE;
  const BED_W = 0.95;
  const queue: DormPiece['kind'][] = loft ? ['loft', 'loft', 'loft', 'loft'] : ['bunk', 'bunk', 'desk', 'desk', 'desk', 'desk'];
  const uv = (p: readonly [number, number]): [number, number] => (alongX ? [p[0], p[1]] : [p[1], p[0]]);
  const da = door ? uv(door.a) : null, db = door ? uv(door.b) : null;
  const doorU = da && db ? (da[0] + db[0]) / 2 : lo;
  const dir: 1 | -1 = Math.abs(doorU - lo) < Math.abs(doorU - hi) ? -1 : 1; // fill from the far end
  if (hi - lo < 2.2 || latHi - latLo < 1.6) return { pieces: [], wanted: queue.length, alongX, dir };
  interface Lane { side: 1 | -1; spans: [number, number][]; cur: number[] }
  const lanes: Lane[] = ([1, -1] as const).map((side) => {
    const wall = side > 0 ? latLo : latHi;
    const l0 = Math.min(wall, wall + side * (WALL + BED_W)), l1 = Math.max(wall, wall + side * (WALL + BED_W));
    let spans: [number, number][] = [[lo + WALL, hi - WALL]];
    const cut = (a: number, b: number): void => {
      spans = spans.flatMap(([s0, s1]): [number, number][] => (b <= s0 || a >= s1 ? [[s0, s1]] : [[s0, a], [b, s1]])).filter(([p, q]) => q - p > 0.3);
    };
    if (da && db) {
      if (Math.abs(da[1] - db[1]) < 0.05 && Math.abs(da[1] - wall) < 0.1) {
        cut(Math.min(da[0], db[0]) - 0.3, Math.max(da[0], db[0]) + 0.3); // door in this lane's wall
      } else if (Math.abs(da[0] - db[0]) < 0.05) {
        // Door in a short wall: keep the swing clear where it overlaps the lane.
        const dl0 = Math.min(da[1], db[1]) - 0.1, dl1 = Math.max(da[1], db[1]) + 0.1;
        if (dl1 > l0 && dl0 < l1) cut(da[0] - 1.1, da[0] + 1.1);
      }
    }
    if (dir < 0) spans.reverse();
    return { side, spans, cur: spans.map(([a, b]) => (dir > 0 ? a : b)) };
  });
  const take = (lane: Lane, len: number): number | null => {
    for (let k = 0; k < lane.spans.length; k++) {
      const [a, b] = lane.spans[k]!;
      const c = lane.cur[k]!;
      if (dir > 0 ? c + len > b + 1e-6 : c - len < a - 1e-6) continue;
      const u0 = dir > 0 ? c : c - len;
      lane.cur[k] = dir > 0 ? u0 + len + GAP : u0 - GAP;
      return u0 + len / 2;
    }
    return null;
  };
  const pieces: DormPiece[] = [];
  queue.forEach((kind, i) => {
    for (const lane of [lanes[i % 2]!, lanes[(i + 1) % 2]!]) {
      const u = take(lane, kind === 'desk' ? DESK_L : BED_L);
      if (u !== null) { pieces.push({ kind, side: lane.side, u }); return; }
    }
  });
  return { pieces, wanted: queue.length, alongX, dir };
}

/**
 * Four-person dorm room: four beds and four desks (each with a chair) in two lanes along the long
 * walls, from the end away from the door (planDormRoom).
 *  - `loft` (上床下書桌): four lofts, each a bed over its own desk.
 *  - bunks (上下舖): two bunk beds and four desks.
 */
function dormRoom(ctx: Ctx, r: Rect, door: Opening | undefined, loft: boolean): void {
  const [x0, y0, x1, y1] = r;
  const { pieces, alongX, dir } = planDormRoom(r, door, loft);
  const latLo = alongX ? y0 : x0, latHi = alongX ? y1 : x1;
  const { bed: BED_L, desk: DESK_L, wall: WALL } = DORM_LANE;
  const BED_W = 0.95, DESK_D = 0.6, BUNK_H = 1.85, PLATFORM = 1.5;
  const pt = (u: number, l: number): [number, number] => (alongX ? [u, l] : [l, u]);
  const rect = (u0: number, u1: number, l0: number, l1: number): Rect => {
    const [ax, ay] = pt(Math.min(u0, u1), Math.min(l0, l1)), [bx, by] = pt(Math.max(u0, u1), Math.max(l0, l1));
    return [ax, ay, bx, by];
  };
  const wallOf = (side: 1 | -1): number => (side > 0 ? latLo : latHi);
  const box = (side: 1 | -1, u: number, len: number, depth: number, y: number, h: number): void => {
    const wall = wallOf(side);
    const [bx0, by0, bx1, by1] = rect(u - len / 2, u + len / 2, wall + side * WALL, wall + side * (WALL + depth));
    ctx.colliders.push({ c: [(bx0 + bx1) / 2, ctx.base + y + h / 2, (by0 + by1) / 2], h: [(bx1 - bx0) / 2, h / 2, (by1 - by0) / 2] });
  };
  const chair = (side: 1 | -1, u: number, lat: number): void => {
    const [cx, cy] = pt(u, lat);
    const [fx, fy] = pt(0, -side);
    ctx.items.push({ kind: 'chair', x: cx, y: ctx.base, z: cy, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: hash(cx, cy) });
  };
  for (const { kind, side, u } of pieces) {
    const wall = wallOf(side);
    const len = kind === 'desk' ? DESK_L : BED_L;
    {
      const [ox0, oy0, ox1, oy1] = rect(u - len / 2, u + len / 2, wall + side * WALL, wall + side * (WALL + (kind === 'desk' ? DESK_D : BED_W)));
      ctx.occ.take(ox0, oy0, ox1, oy1);
    }
    const [px, py] = pt(u, wall + side * (WALL + BED_W / 2));
    if (kind === 'loft') {
      // Local +x of the loft points at the wall (its desk side).
      const ry = alongX ? side * Math.PI / 2 : side > 0 ? Math.PI : 0;
      ctx.items.push({ kind: 'loft', x: px, y: ctx.base, z: py, ry, sx: BED_W, sy: 1, sz: BED_L, tint: hash(px, py) });
      box(side, u, 1.6, DESK_D, 0, 0.78); // desk under the bed
      box(side, u, BED_L, BED_W, PLATFORM, 0.44); // bed platform overhead
      chair(side, u, wall + side * (WALL + DESK_D + TUCK + 0.1));
    } else if (kind === 'bunk') {
      const ry = alongX ? Math.PI / 2 * -dir : dir > 0 ? Math.PI : 0;
      ctx.items.push({ kind: 'bunk', x: px, y: ctx.base, z: py, ry, sx: BED_W, sy: 1, sz: BED_L, tint: hash(px, py) });
      box(side, u, BED_L, BED_W, 0, BUNK_H);
    } else {
      const deskLat = wall + side * (WALL + 0.03 + DESK_D / 2);
      const [dx, dy] = pt(u, deskLat);
      ctx.items.push({ kind: 'table', x: dx, y: ctx.base, z: dy, ry: alongX ? 0 : Math.PI / 2, sx: DESK_L, sy: 0.75, sz: DESK_D, tint: 0 });
      box(side, u, DESK_L, DESK_D + 0.03, 0, 0.75);
      chair(side, u, deskLat + side * (DESK_D / 2 + TUCK));
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
  if (hi - lo < 3 || latHi - latLo < 2.0) return;
  // Narrow washrooms (a dorm flat's, 2–2.8 m wide): shallower stalls and sink counter, the same layout.
  const narrow = latHi - latLo < 2.8;
  const dm = door ? (alongX ? (door.a[0] + door.b[0]) / 2 : (door.a[1] + door.b[1]) / 2) : lo;
  const farHigh = Math.abs(dm - lo) < Math.abs(dm - hi);
  const dir = farHigh ? -1 : 1;
  const end = farHigh ? hi - 0.03 : lo + 0.03; // wall lines sample as outside: stay just inside
  // Stalls go on the long wall without the door (sinks opposite); `s` points from the stall wall into the room.
  const doorLat = door ? (alongX ? (door.a[1] + door.b[1]) / 2 : (door.a[0] + door.b[0]) / 2) : latHi;
  const s = Math.abs(doorLat - latLo) < 0.1 ? -1 : 1;
  const stallWall = s > 0 ? latLo : latHi, sinkWall = s > 0 ? latHi : latLo;
  const pt = (u: number, l: number): [number, number] => (alongX ? [u, l] : [l, u]);
  const box = (u0: number, u1: number, l0: number, l1: number): Rect => {
    const [ax, ay] = pt(Math.min(u0, u1), Math.min(l0, l1)), [bx, by] = pt(Math.max(u0, u1), Math.max(l0, l1));
    return [ax, ay, bx, by];
  };
  /** Axis-aligned panel from (u0, l0) to (u1, l1) in room axes, `h` tall from `y`. */
  const panel = (u0: number, u1: number, l0: number, l1: number, y: number, h: number, solid: boolean): void => {
    const [ax, ay, bx, by] = box(u0, u1, l0, l1);
    const sx = Math.max(bx - ax, 0.04), sz = Math.max(by - ay, 0.04);
    ctx.items.push({ kind: 'partition', x: (ax + bx) / 2, y, z: (ay + by) / 2, ry: 0, sx, sy: h, sz, tint: 0 });
    if (solid) ctx.colliders.push({ c: [(ax + bx) / 2, y + h / 2, (ay + by) / 2], h: [sx / 2, h / 2, sz / 2] });
  };

  // Stalls: 1.0 m wide, 1.4 m deep, keeping 1.6 m clear by the door; fewer if the full row won't fit.
  const STALL_W = 1.0, STALL_D = narrow ? 1.15 : 1.4, PART_H = 1.8, LIFT = 0.12;
  const back = stallWall + s * 0.03;
  const front = back + s * STALL_D;
  for (let count = Math.min(4, Math.floor((hi - lo - 1.6) / STALL_W)); count > 0; count--) {
    const stallFar = end, stallNear = end + dir * count * STALL_W;
    const [ax, ay, bx, by] = box(stallFar, stallNear, back, front);
    if (!fits(ctx, ax, ay, bx, by, 0, 0)) continue;
    for (let k = 0; k <= count; k++) {
      const u = end + dir * k * STALL_W;
      panel(u - 0.02, u + 0.02, back, front, ctx.base + LIFT, PART_H, true);
    }
    for (let k = 0; k < count; k++) {
      const ua = end + dir * k * STALL_W, ub = ua + dir * STALL_W;
      const uMid = (ua + ub) / 2;
      // Front: narrow fixed panels either side of a 0.6 m door left ajar into the stall.
      panel(ua, ua + dir * 0.2, front - 0.02, front + 0.02, ctx.base + LIFT, PART_H, true);
      panel(ub - dir * 0.2, ub, front - 0.02, front + 0.02, ctx.base + LIFT, PART_H, true);
      const hinge = pt(ua + dir * 0.2, front);
      const open = 1.1; // radians the leaf has swung in from the closed line
      const [ldx, ldy] = pt(dir * Math.cos(open), -s * Math.sin(open));
      ctx.items.push({ kind: 'partition', x: hinge[0] + ldx * 0.3, y: ctx.base + LIFT, z: hinge[1] + ldy * 0.3, ry: Math.atan2(-ldy, ldx), sx: 0.6, sy: PART_H, sz: 0.035, tint: 0 });
      const [tx, ty] = pt(uMid, back + s * 0.3);
      const [fx, fy] = pt(0, s);
      ctx.items.push({ kind: 'toilet', x: tx, y: ctx.base, z: ty, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: 0 });
    }
    panel(stallFar, stallNear, front - 0.03, front + 0.03, ctx.base + PART_H + LIFT - 0.06, 0.06, false); // head rail
    break;
  }

  // Sinks along the opposite wall, centred on the room, mirror above.
  const SINK_W = 0.6, SINK_D = narrow ? 0.45 : 0.55;
  const sinks = Math.min(3, Math.floor((hi - lo - 1.4) / SINK_W));
  if (sinks < 1) return;
  const half = (sinks * SINK_W) / 2;
  const face = sinkWall - s * 0.03; // inset: the far wall line samples as outside
  // Centred on the wall, else slid toward either end (clear of a door in the middle of that wall).
  const mid = [(lo + hi) / 2, lo + 0.1 + half, hi - 0.1 - half].find((m) => {
    const [ax, ay, bx, by] = box(m - half, m + half, face - s * SINK_D, face);
    return fits(ctx, ax, ay, bx, by, 0, 0);
  });
  if (mid === undefined) return;
  const [cx0, cy0, cx1, cy1] = box(mid - half, mid + half, face - s * SINK_D, face);
  const [fx, fy] = pt(0, -s);
  for (let k = 0; k < sinks; k++) {
    const [px, py] = pt(mid - half + SINK_W * (k + 0.5), face - s * (SINK_D / 2));
    ctx.items.push({ kind: 'sink', x: px, y: ctx.base, z: py, ry: yawToward(fx, fy), sx: 1, sy: 1, sz: 1, tint: 0 });
  }
  ctx.colliders.push({ c: [(cx0 + cx1) / 2, ctx.base + 0.45, (cy0 + cy1) / 2], h: [(cx1 - cx0) / 2, 0.45, (cy1 - cy0) / 2] });
  const [mx0, my0, mx1, my1] = box(mid - half, mid + half, face, sinkWall - s * 0.01);
  ctx.items.push({ kind: 'mirror', x: (mx0 + mx1) / 2, y: ctx.base + 1.15, z: (my0 + my1) / 2, ry: 0, sx: Math.max(mx1 - mx0, 0.02), sy: 0.85, sz: Math.max(my1 - my0, 0.02), tint: 0 });
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
    // Walled rooms (dorm rooms, restrooms) only keep clear of what is inside them (their own door):
    // stair, elevator and sign keep-outs belong to the corridor on the other side of the wall.
    const walled = s.furnish === 'dorm' || s.furnish === 'dormLoft' || s.furnish === 'restroom';
    // (The restroom's own door keeps a small circle: sinks may stand beside the hinge.)
    const own = walled
      ? keepOut.filter((k) => s.furnish === 'restroom' && s.rects.some(([a, b, c, d]) => k.x >= a - 0.05 && k.x <= c + 0.05 && k.y >= b - 0.05 && k.y <= d + 0.05)).map((k) => ({ ...k, r: Math.min(k.r, 0.55) }))
      : keepOut;
    const ctx: Ctx = { grid, ids, base, keepOut: own, items, colliders, occ: new Occupancy() };
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
        case 'conference': conference(ctx, r, door); break;
        case 'lounge': lounge(ctx, r, plan.openings); break;
        case 'exhibit': plinths(ctx, r); break;
        case 'dorm': dormRoom(ctx, r, door, false); break;
        case 'dormLoft': dormRoom(ctx, r, door, true); break;
        case 'restroom': restroom(ctx, r, door); break;
      }
    }
  });
  corridorProps(plan, grid, base, keepOut, items, colliders);
  for (const it of plan.extras?.items ?? []) items.push({ ...it, y: base + it.y });
  for (const c of plan.extras?.colliders ?? []) colliders.push({ c: [c.c[0], base + c.c[1], c.c[2]], h: [...c.h] });
  return { items, colliders };
}

/**
 * Corridor fittings, placed from the plan so every building gets them:
 *  - a set of three sorting bins on the corridor wall beside each toilet door;
 *  - red fire-hose cabinets on corridor walls, spread out (≥ 18 m apart) in a seeded random order;
 *  - a black projecting pictogram sign at every toilet door (women | men, or the accessible WC) and prayer room;
 *  - two-faced hanging direction signs along corridors, pointing ahead to the nearest exit,
 *    stairs, toilets and sky bridge.
 */
/** Side of the square toilet signs (m). */
const WC_SIGN = 0.46;

function corridorProps(plan: FloorPlan, grid: FloorGrid, base: number, keepOut: readonly KeepOut[], items: FurnitureItem[], colliders: ColliderBox[]): void {
  const spaceAt = (x: number, y: number): Space | undefined => {
    const c = Math.floor((x - grid.x0) / CELL), r = Math.floor((y - grid.y0) / CELL);
    if (c < 0 || r < 0 || c >= grid.w || r >= grid.h) return undefined;
    const id = grid.ids[r * grid.w + c]!;
    return id === OUTSIDE ? undefined : plan.spaces[id];
  };
  const isCirc = (s?: Space): boolean => s?.kind === 'corridor' || s?.kind === 'lobby';
  const taken: [number, number, number][] = []; // x, y, radius
  const free = (x: number, y: number, r: number): boolean => taken.every(([tx, ty, tr]) => Math.hypot(tx - x, ty - y) > tr + r);
  const clear = (x: number, y: number, r: number): boolean => free(x, y, r) && keepOut.every((k) => Math.hypot(k.x - x, k.y - y) > k.r + r);
  /** No opening on the wall line `at` (axis h: y = at) overlapping [from, to]. */
  const wallFree = (axis: 'h' | 'v', at: number, from: number, to: number): boolean => plan.openings.every((o) => {
    const oh = Math.abs(o.a[1] - o.b[1]) < 1e-3;
    if ((axis === 'h') !== oh) return true;
    const line = oh ? o.a[1] : o.a[0];
    if (Math.abs(line - at) > 0.06) return true;
    const a = oh ? Math.min(o.a[0], o.b[0]) : Math.min(o.a[1], o.b[1]), b = oh ? Math.max(o.a[0], o.b[0]) : Math.max(o.a[1], o.b[1]);
    return b < from - 0.25 || a > to + 0.25;
  });
  const solidBox = (x: number, y: number, hx: number, hy: number, hz: number, yUp: number): void => {
    colliders.push({ c: [x, base + yUp, y], h: [hx, hy, hz] });
  };
  /** Place a wall-hung / wall-standing item: wall line (axis, at), along position t, normal into the corridor. */
  const onWall = (axis: 'h' | 'v', at: number, t: number, n: 1 | -1, off: number): { x: number; y: number; ry: number } => {
    const x = axis === 'h' ? t : at + n * off, y = axis === 'h' ? at + n * off : t;
    const [fx, fy] = axis === 'h' ? [0, n] : [n, 0];
    return { x, y, ry: yawToward(fx, fy) };
  };
  /** A black mounting part, axis-aligned: spans [o0, o1] out from the wall line and `w` along it, from y0 up h. */
  const mount = (axis: 'h' | 'v', at: number, t: number, n: 1 | -1, o0: number, o1: number, w: number, y0: number, h: number): void => {
    const o = at + n * (o0 + o1) / 2, d = Math.abs(o1 - o0);
    items.push(axis === 'h'
      ? { kind: 'bracket', x: t, y: y0, z: o, ry: 0, sx: w, sy: h, sz: d, tint: 0 }
      : { kind: 'bracket', x: o, y: y0, z: t, ry: 0, sx: d, sy: h, sz: w, tint: 0 });
  };
  /** Wall plate, stand-off and top arm holding a projecting sign of size WC_SIGN centred at height yc. */
  const signBracket = (axis: 'h' | 'v', at: number, t: number, n: 1 | -1, yc: number): void => {
    const face = WALL_T / 2, top = yc + WC_SIGN / 2;
    mount(axis, at, t, n, face, face + 0.018, 0.1, yc - WC_SIGN / 2 - 0.06, WC_SIGN + 0.16); // plate on the wall
    mount(axis, at, t, n, face, face + 0.06, 0.04, yc - WC_SIGN / 2, WC_SIGN); // stand-off to the sign's edge
    mount(axis, at, t, n, face, face + 0.06 + WC_SIGN + 0.025, 0.04, top, 0.04); // arm over the top
  };

  // --- Hand-placed fixtures from the plan: vending machines and full-length wall mirrors.
  for (const f of plan.fixtures ?? []) {
    const [fx, fy] = f.facing;
    if (f.kind === 'vending') {
      const D = 0.8, H = 1.83;
      const x = f.at[0] + fx * (WALL_T / 2 + 0.03 + D / 2), y = f.at[1] + fy * (WALL_T / 2 + 0.03 + D / 2);
      items.push({ kind: 'vending', x, y: base, z: y, ry: yawToward(fx, fy), sx: f.width - 0.04, sy: H, sz: D, tint: 0 });
      solidBox(x, y, Math.abs(fx) > 0.5 ? D / 2 : f.width / 2, H / 2, Math.abs(fx) > 0.5 ? f.width / 2 : D / 2, H / 2);
      taken.push([x, y, f.width / 2 + 0.6]);
    } else {
      const x = f.at[0] + fx * (WALL_T / 2 + 0.012), y = f.at[1] + fy * (WALL_T / 2 + 0.012);
      const along = Math.abs(fx) > 0.5;
      // A dark frame; the reflecting glass is a live Reflector added by buildingWorld.
      items.push({ kind: 'bracket', x, y: base + 0.08, z: y, ry: 0, sx: along ? 0.02 : f.width + 0.08, sy: (f.height ?? 2.05) + 0.08, sz: along ? f.width + 0.08 : 0.02, tint: 0 });
      taken.push([x, y, f.width / 2]);
    }
  }

  // --- Prayer rooms: the same black projecting sign, with the kneeling figures.
  for (const o of plan.openings) {
    if (o.kind !== 'door') continue;
    const axis: 'h' | 'v' = Math.abs(o.a[1] - o.b[1]) < 1e-3 ? 'h' : 'v';
    const at = axis === 'h' ? o.a[1] : o.a[0];
    const b = axis === 'h' ? Math.max(o.a[0], o.b[0]) : Math.max(o.a[1], o.b[1]);
    const mid = (b + (axis === 'h' ? Math.min(o.a[0], o.b[0]) : Math.min(o.a[1], o.b[1]))) / 2;
    const side = (n: number): Space | undefined => (axis === 'h' ? spaceAt(mid, at + n * 0.3) : spaceAt(at + n * 0.3, mid));
    const pray = (s?: Space): boolean => !!s?.name.includes('祈禱室');
    const n: 1 | -1 | 0 = pray(side(1)) && isCirc(side(-1)) ? -1 : pray(side(-1)) && isCirc(side(1)) ? 1 : 0;
    if (!n) continue;
    const sp = onWall(axis, at, b + 0.3, n, WALL_T / 2 + 0.06 + WC_SIGN / 2);
    for (const d of [1, -1]) {
      const [fx, fy] = axis === 'h' ? [d, 0] : [0, d];
      items.push({ kind: 'sign', x: sp.x + fx * 0.012, y: base + 2.42, z: sp.y + fy * 0.012, ry: yawToward(-fx, -fy), sx: WC_SIGN, sy: WC_SIGN, sz: 1, tint: 0, label: 'wc:pray' });
    }
    signBracket(axis, at, b + 0.3, n, base + 2.42);
  }

  // --- Bins beside toilet doors.
  for (const o of plan.openings) {
    if (o.kind !== 'door') continue;
    const axis: 'h' | 'v' = Math.abs(o.a[1] - o.b[1]) < 1e-3 ? 'h' : 'v';
    const at = axis === 'h' ? o.a[1] : o.a[0];
    const a = axis === 'h' ? Math.min(o.a[0], o.b[0]) : Math.min(o.a[1], o.b[1]);
    const b = axis === 'h' ? Math.max(o.a[0], o.b[0]) : Math.max(o.a[1], o.b[1]);
    const mid = (a + b) / 2;
    const side = (n: number): Space | undefined => (axis === 'h' ? spaceAt(mid, at + n * 0.3) : spaceAt(at + n * 0.3, mid));
    const n: 1 | -1 | 0 = side(1)?.kind === 'toilet' && isCirc(side(-1)) ? -1 : side(-1)?.kind === 'toilet' && isCirc(side(1)) ? 1 : 0;
    if (!n) continue;
    // A black projecting sign over the door edge, read from both ways along the corridor.
    const toilet = side(-n as 1 | -1);
    const wc = toilet?.name.includes('無障礙') ? 'wc:acc' : toilet?.name.includes('男') ? 'wc:m' : toilet?.name.includes('女') ? 'wc:f' : 'wc:both';
    const sp = onWall(axis, at, b + 0.3, n, WALL_T / 2 + 0.06 + WC_SIGN / 2);
    for (const d of [1, -1]) {
      const [fx, fy] = axis === 'h' ? [d, 0] : [0, d];
      items.push({ kind: 'sign', x: sp.x + fx * 0.012, y: base + 2.42, z: sp.y + fy * 0.012, ry: yawToward(-fx, -fy), sx: WC_SIGN, sy: WC_SIGN, sz: 1, tint: 0, label: wc });
    }
    signBracket(axis, at, b + 0.3, n, base + 2.42);
    for (const t of [b + 1.0, a - 1.0, b + 1.6, a - 1.6]) { // clear of the door frame (wallFree keeps a 0.25 m margin)
      const p = onWall(axis, at, t, n, WALL_T / 2 + 0.25);
      // Walking room in front of both ends of the set.
      const front = (u: number): Space | undefined => (axis === 'h' ? spaceAt(u, at + n * 0.85) : spaceAt(at + n * 0.85, u));
      const across = isCirc(front(t - 0.55)) && isCirc(front(t + 0.55)) ? front(t) : undefined;
      // Beside its own door on purpose, so only other fittings (not the doorway keep-outs) count.
      if (!wallFree(axis, at, t - 0.65, t + 0.65) || !isCirc(across) || !free(p.x, p.y, 0.7)) continue;
      const ends = axis === 'h' ? [spaceAt(t - 0.6, at - n * 0.15), spaceAt(t + 0.6, at - n * 0.15)] : [spaceAt(at - n * 0.15, t - 0.6), spaceAt(at - n * 0.15, t + 0.6)];
      if (ends.some((s) => !s || isCirc(s))) continue; // a wall must stand behind the whole set
      items.push({ kind: 'bins', x: p.x, y: base, z: p.y, ry: p.ry, sx: 1, sy: 1, sz: 1, tint: 0 });
      solidBox(p.x, p.y, axis === 'h' ? 0.6 : 0.24, 0.4, axis === 'h' ? 0.24 : 0.6, 0.4);
      taken.push([p.x, p.y, 0.7]);
      break;
    }
  }

  // --- Fire-hose cabinets on corridor walls.
  const cands: { axis: 'h' | 'v'; at: number; t: number; n: 1 | -1; h: number }[] = [];
  for (const s of plan.spaces) {
    if (!isCirc(s)) continue;
    for (const [x0, y0, x1, y1] of s.rects) {
      const alongX = x1 - x0 >= y1 - y0;
      const len = alongX ? x1 - x0 : y1 - y0;
      if (len < 6 || (alongX ? y1 - y0 : x1 - x0) < 1.8) continue;
      for (const [at, n] of (alongX ? [[y0, 1], [y1, -1]] : [[x0, 1], [x1, -1]]) as [number, 1 | -1][]) {
        for (let t = (alongX ? x0 : y0) + 1; t <= (alongX ? x1 : y1) - 1; t += 0.5) {
          const behind = alongX ? spaceAt(t, at - n * 0.2) : spaceAt(at - n * 0.2, t);
          if (isCirc(behind) || behind?.kind === 'void') continue; // no wall here (open to a hall / void)
          if (!wallFree(alongX ? 'h' : 'v', at, t - 0.5, t + 0.5)) continue;
          cands.push({ axis: alongX ? 'h' : 'v', at, t, n, h: hash(at * 3.1 + t, t * 1.7 - at) });
        }
      }
    }
  }
  cands.sort((p, q) => p.h - q.h);
  const hydrants: [number, number][] = [];
  for (const c of cands) {
    const p = onWall(c.axis, c.at, c.t, c.n, WALL_T / 2 + 0.13);
    if (hydrants.some(([hx, hy]) => Math.hypot(hx - p.x, hy - p.y) < 18) || !clear(p.x, p.y, 0.6)) continue;
    hydrants.push([p.x, p.y]);
    taken.push([p.x, p.y, 0.6]);
    items.push({ kind: 'hydrant', x: p.x, y: base + 0.25, z: p.y, ry: p.ry, sx: 1, sy: 1, sz: 1, tint: 0 });
    solidBox(p.x, p.y, c.axis === 'h' ? 0.38 : 0.13, 0.8, c.axis === 'h' ? 0.13 : 0.38, 1.05);
  }

  // --- Hanging direction signs.
  const targets: { label: string; x: number; y: number }[] = [];
  for (const o of plan.openings) {
    const mx = (o.a[0] + o.b[0]) / 2, my = (o.a[1] + o.b[1]) / 2;
    const h = Math.abs(o.a[1] - o.b[1]) < 1e-3;
    const sides = h ? [spaceAt(mx, my - 0.3), spaceAt(mx, my + 0.3)] : [spaceAt(mx - 0.3, my), spaceAt(mx + 0.3, my)];
    if (o.label?.includes('空橋')) targets.push({ label: '空橋', x: mx, y: my });
    else if (o.kind === 'exit') targets.push({ label: '出口', x: mx, y: my });
    else if (sides.some((s) => s?.kind === 'stair')) targets.push({ label: '樓梯', x: mx, y: my });
    else if (o.kind === 'door' && sides.some((s) => s?.kind === 'toilet')) targets.push({ label: '廁所', x: mx, y: my });
  }
  const ORDER = ['出口', '樓梯', '廁所', '空橋'];
  for (const s of plan.spaces) {
    if (!isCirc(s)) continue;
    const hang = Math.min(s.ceiling - 0.55, 2.55);
    for (const [x0, y0, x1, y1] of s.rects) {
      const alongX = x1 - x0 >= y1 - y0;
      const lo = alongX ? x0 : y0, hi = alongX ? x1 : y1, len = hi - lo;
      if (len < 10 || (alongX ? y1 - y0 : x1 - x0) < 1.8) continue;
      const mid = alongX ? (y0 + y1) / 2 : (x0 + x1) / 2;
      for (let t = lo + 4; t <= hi - 4; t += 14) {
        const px = alongX ? t : mid, py = alongX ? mid : t;
        if (s.noCeiling || spaceAt(px, py) !== s || !clear(px, py, 0.4)) continue;
        for (const dir of [1, -1]) {
          const ahead = ORDER.filter((label) => targets.some((g) => g.label === label && ((alongX ? g.x - px : g.y - py) * dir) > 2.5 && Math.hypot(g.x - px, g.y - py) < 70));
          if (!ahead.length) continue;
          // The face read by someone walking toward `dir` faces back the other way.
          const [fx, fy] = alongX ? [-dir, 0] : [0, -dir];
          items.push({ kind: 'sign', x: px + fx * 0.02, y: base + hang, z: py + fy * 0.02, ry: yawToward(-fx, -fy), sx: 1.5, sy: 0.34, sz: 1, tint: 0, label: `↑ ${ahead.slice(0, 3).join('　')}` });
        }
        // Black hangers: a rail along the top and two rods up to the ceiling.
        const top = base + hang + 0.17, rod = s.ceiling + base - top;
        const bar = (cx: number, cy: number, w: number, h: number, y0: number): void => {
          items.push({ kind: 'bracket', x: cx, y: y0, z: cy, ry: 0, sx: alongX ? 0.06 : w, sy: h, sz: alongX ? w : 0.06, tint: 0 });
        };
        bar(px, py, 1.5, 0.035, top);
        for (const k of [-0.6, 0.6]) bar(alongX ? px : px + k, alongX ? py + k : py, 0.025, rod, top);
        taken.push([px, py, 0.4]);
      }
    }
  }
}
