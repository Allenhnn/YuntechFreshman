import type { Opening, OpeningKind, Rect, Space } from './buildingTypes';

/**
 * Rasterises a floor's spaces (later spaces override earlier ones, like layers in a drawing) into a
 * 10 cm grid, then derives everything else from cell boundaries: wall segments between different
 * spaces or the outside, per-space merged rectangles for floors/ceilings, and traced areas.
 * Pure and deterministic: used by the build-time validator and the runtime mesh builder alike.
 */
export const CELL = 0.1;
export const OUTSIDE = -1;

export interface FloorGrid {
  x0: number;
  y0: number;
  w: number;
  h: number;
  ids: Int16Array;
}

export function rasterize(spaces: readonly { rects: readonly Rect[] }[]): FloorGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of spaces) for (const [a, b, c, d] of s.rects) {
    minX = Math.min(minX, a); minY = Math.min(minY, b); maxX = Math.max(maxX, c); maxY = Math.max(maxY, d);
  }
  const x0 = Math.floor(minX) - 1, y0 = Math.floor(minY) - 1;
  const w = Math.ceil((maxX - x0) / CELL) + 10, h = Math.ceil((maxY - y0) / CELL) + 10;
  const ids = new Int16Array(w * h).fill(OUTSIDE);
  spaces.forEach((s, id) => {
    for (const [a, b, c, d] of s.rects) {
      const c0 = Math.round((a - x0) / CELL), c1 = Math.round((c - x0) / CELL);
      const r0 = Math.round((b - y0) / CELL), r1 = Math.round((d - y0) / CELL);
      for (let r = r0; r < r1; r++) ids.fill(id, r * w + c0, r * w + c1);
    }
  });
  return { x0, y0, w, h, ids };
}

const at = (g: FloorGrid, c: number, r: number): number => (c < 0 || r < 0 || c >= g.w || r >= g.h ? OUTSIDE : g.ids[r * g.w + c]!);

/**
 * A straight run of boundary between two regions. For 'h' segments (constant y) `a` is the space on
 * the −Y side and `b` on the +Y side; for 'v' segments (constant x) `a` is −X and `b` is +X.
 */
export interface Segment {
  axis: 'h' | 'v';
  /** Constant coordinate (y for 'h', x for 'v'). */
  at: number;
  from: number;
  to: number;
  a: number;
  b: number;
  /** Set when this piece of boundary is an opening. */
  opening?: OpeningKind;
  label?: string;
}

export function boundarySegments(g: FloorGrid): Segment[] {
  const out: Segment[] = [];
  // Horizontal boundaries between rows r-1 and r.
  for (let r = 0; r <= g.h; r++) {
    let run: Segment | null = null;
    for (let c = 0; c <= g.w; c++) {
      const a = c < g.w ? at(g, c, r - 1) : OUTSIDE;
      const b = c < g.w ? at(g, c, r) : OUTSIDE;
      const edge = c < g.w && a !== b;
      if (run && (!edge || run.a !== a || run.b !== b)) {
        out.push(run);
        run = null;
      }
      if (edge && !run) run = { axis: 'h', at: g.y0 + r * CELL, from: g.x0 + c * CELL, to: 0, a, b };
      if (run) run.to = g.x0 + (c + 1) * CELL;
    }
  }
  // Vertical boundaries between columns c-1 and c.
  for (let c = 0; c <= g.w; c++) {
    let run: Segment | null = null;
    for (let r = 0; r <= g.h; r++) {
      const a = r < g.h ? at(g, c - 1, r) : OUTSIDE;
      const b = r < g.h ? at(g, c, r) : OUTSIDE;
      const edge = r < g.h && a !== b;
      if (run && (!edge || run.a !== a || run.b !== b)) {
        out.push(run);
        run = null;
      }
      if (edge && !run) run = { axis: 'v', at: g.x0 + c * CELL, from: g.y0 + r * CELL, to: 0, a, b };
      if (run) run.to = g.y0 + (r + 1) * CELL;
    }
  }
  return out;
}

/** Splits boundary segments where openings lie on them; returns the pieces and any unmatched openings. */
export function applyOpenings(segments: readonly Segment[], openings: readonly Opening[]): { pieces: Segment[]; unmatched: Opening[] } {
  const TOL = 0.06;
  const matched = new Set<Opening>();
  const pieces: Segment[] = [];
  for (const s of segments) {
    const cuts: { from: number; to: number; o: Opening }[] = [];
    for (const o of openings) {
      const horizontal = Math.abs(o.a[1] - o.b[1]) < TOL;
      const vertical = Math.abs(o.a[0] - o.b[0]) < TOL;
      if (s.axis === 'h' && horizontal && Math.abs(o.a[1] - s.at) < TOL) {
        const lo = Math.max(s.from, Math.min(o.a[0], o.b[0])), hi = Math.min(s.to, Math.max(o.a[0], o.b[0]));
        if (hi - lo > TOL) cuts.push({ from: lo, to: hi, o });
      } else if (s.axis === 'v' && vertical && Math.abs(o.a[0] - s.at) < TOL) {
        const lo = Math.max(s.from, Math.min(o.a[1], o.b[1])), hi = Math.min(s.to, Math.max(o.a[1], o.b[1]));
        if (hi - lo > TOL) cuts.push({ from: lo, to: hi, o });
      }
    }
    cuts.sort((p, q) => p.from - q.from);
    let cur = s.from;
    for (const cut of cuts) {
      matched.add(cut.o);
      if (cut.from > cur + 1e-6) pieces.push({ ...s, from: cur, to: cut.from });
      pieces.push({ ...s, from: cut.from, to: cut.to, opening: cut.o.kind, ...(cut.o.label ? { label: cut.o.label } : {}) });
      cur = cut.to;
    }
    if (s.to > cur + 1e-6) pieces.push({ ...s, from: cur });
  }
  return { pieces, unmatched: openings.filter((o) => !matched.has(o)) };
}

/** Greedy merge of a region's cells into axis-aligned rectangles (for floors, ceilings, slabs, colliders). */
export function regionRects(g: FloorGrid, test: (id: number) => boolean): Rect[] {
  const used = new Uint8Array(g.w * g.h);
  const rects: Rect[] = [];
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const i = r * g.w + c;
      if (used[i] || !test(g.ids[i]!)) continue;
      let c1 = c;
      while (c1 < g.w && !used[r * g.w + c1] && test(g.ids[r * g.w + c1]!)) c1++;
      let r1 = r + 1;
      grow: while (r1 < g.h) {
        for (let k = c; k < c1; k++) if (used[r1 * g.w + k] || !test(g.ids[r1 * g.w + k]!)) break grow;
        r1++;
      }
      for (let rr = r; rr < r1; rr++) used.fill(1, rr * g.w + c, rr * g.w + c1);
      rects.push([g.x0 + c * CELL, g.y0 + r * CELL, g.x0 + c1 * CELL, g.y0 + r1 * CELL]);
    }
  }
  return rects;
}

export function areaOf(g: FloorGrid, id: number): number {
  let n = 0;
  for (let i = 0; i < g.ids.length; i++) if (g.ids[i] === id) n++;
  return n * CELL * CELL;
}

/** Walkable spaces never get a wall between them and an 'open' opening; void edges get railings. */
export function isWalkable(s: Space | undefined): boolean {
  return !!s && s.kind !== 'stair' && s.kind !== 'elevator' && s.kind !== 'void';
}
