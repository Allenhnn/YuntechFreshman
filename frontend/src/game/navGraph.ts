import type { CampusData, Ring } from '../campus/campusTypes';

/**
 * Walking network for navigation: every road / walkway polyline inside campus becomes graph
 * edges; vertices closer than SNAP are merged and dead ends within BRIDGE of another vertex are
 * joined, which closes the small gaps OSM leaves between paths. Routes run A* between the points
 * on the network nearest the start and the goal, with straight legs to and from it.
 */
const SNAP = 1.5;
const BRIDGE = 8;

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface NavGraph {
  /** Flat [x, z, x, z, …] route from (sx, sz) to (tx, tz). */
  route(sx: number, sz: number, tx: number, tz: number): number[];
}

export function buildNavGraph(campus: CampusData): NavGraph {
  const xs: number[] = [], zs: number[] = [];
  const adj: Map<number, number>[] = [];
  const cell = new Map<string, number[]>();
  const cellKey = (x: number, z: number): string => `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
  const nodeAt = (x: number, z: number): number => {
    const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const i of cell.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(xs[i]! - x, zs[i]! - z) < SNAP) return i;
    }
    const i = xs.length;
    xs.push(x);
    zs.push(z);
    adj.push(new Map());
    const k = cellKey(x, z);
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(i);
    return i;
  };
  const link = (a: number, b: number): void => {
    if (a === b) return;
    const d = Math.hypot(xs[a]! - xs[b]!, zs[a]! - zs[b]!);
    adj[a]!.set(b, d);
    adj[b]!.set(a, d);
  };
  const edges: [number, number][] = [];
  for (const road of campus.roads) {
    let prev = -1;
    for (let i = 0; i < road.points.length; i += 2) {
      const x = road.points[i]!, z = road.points[i + 1]!;
      if (!pointInRing(x, z, campus.boundary)) { prev = -1; continue; }
      const n = nodeAt(x, z);
      if (prev >= 0 && prev !== n) { link(prev, n); edges.push([prev, n]); }
      prev = n;
    }
  }
  // Dead ends: join to the nearest other vertex within BRIDGE.
  for (let i = 0; i < xs.length; i++) {
    if (adj[i]!.size > 1) continue;
    let best = -1, bestD = BRIDGE;
    const cx = Math.floor(xs[i]! / 10), cz = Math.floor(zs[i]! / 10);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (j === i || adj[i]!.has(j)) continue;
        const d = Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!);
        if (d < bestD) { bestD = d; best = j; }
      }
    }
    if (best >= 0) { link(i, best); edges.push([i, best]); }
  }

  /** Nearest point on any edge: its position and the edge's ends. */
  const nearest = (x: number, z: number): { x: number; z: number; a: number; b: number } | null => {
    let best: { x: number; z: number; a: number; b: number } | null = null;
    let bestD = Infinity;
    for (const [a, b] of edges) {
      const ax = xs[a]!, az = zs[a]!, dx = xs[b]! - ax, dz = zs[b]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; best = { x: px, z: pz, a, b }; }
    }
    return best;
  };

  return {
    route(sx, sz, tx, tz) {
      const s = nearest(sx, sz), t = nearest(tx, tz);
      const direct = [sx, sz, tx, tz];
      if (!s || !t) return direct;
      // Straight there when walking the network would not help (close, or both far from it).
      const straight = Math.hypot(tx - sx, tz - sz);
      if (straight < 25) return direct;
      // A* from the start projection (virtual node −1) to the goal projection (−2).
      const S = -1, T = -2;
      const pos = (i: number): [number, number] => (i === S ? [s.x, s.z] : i === T ? [t.x, t.z] : [xs[i]!, zs[i]!]);
      const neighbours = (i: number): [number, number][] => {
        const out: [number, number][] = [];
        const [px, pz] = pos(i);
        const dist = (j: number): number => { const [qx, qz] = pos(j); return Math.hypot(qx - px, qz - pz); };
        if (i === S) for (const j of [s.a, s.b]) out.push([j, dist(j)]);
        else {
          for (const [j, d] of adj[i]!) out.push([j, d]);
          if (i === t.a || i === t.b) out.push([T, dist(T)]);
        }
        if (i === S && ((s.a === t.a && s.b === t.b) || (s.a === t.b && s.b === t.a))) out.push([T, dist(T)]);
        return out;
      };
      const h = (i: number): number => { const [px, pz] = pos(i); return Math.hypot(px - t.x, pz - t.z); };
      const g = new Map<number, number>([[S, 0]]);
      const from = new Map<number, number>();
      const open: number[] = [S];
      const closed = new Set<number>();
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (g.get(open[k]!)! + h(open[k]!) < g.get(open[bi]!)! + h(open[bi]!)) bi = k;
        const cur = open.splice(bi, 1)[0]!;
        if (cur === T) break;
        if (closed.has(cur)) continue;
        closed.add(cur);
        for (const [j, d] of neighbours(cur)) {
          const ng = g.get(cur)! + d;
          if (ng < (g.get(j) ?? Infinity)) {
            g.set(j, ng);
            from.set(j, cur);
            open.push(j);
          }
        }
      }
      if (!from.has(T)) return direct;
      const chain: number[] = [];
      for (let c: number | undefined = T; c !== undefined; c = from.get(c)) chain.push(c);
      chain.reverse();
      const out = [sx, sz];
      for (const c of chain) out.push(...pos(c));
      out.push(tx, tz);
      // Drop zero-length steps.
      const clean: number[] = [out[0]!, out[1]!];
      for (let i = 2; i < out.length; i += 2) {
        if (Math.hypot(out[i]! - clean[clean.length - 2]!, out[i + 1]! - clean[clean.length - 1]!) > 0.3) clean.push(out[i]!, out[i + 1]!);
      }
      return clean;
    },
  };
}

/** Remaining length along `path` from the point on it nearest (x, z), and how far off it that is. */
export function progressOn(path: readonly number[], x: number, z: number): { remaining: number; off: number } {
  let best = { d: Infinity, seg: 0, px: path[0] ?? x, pz: path[1] ?? z };
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i]!, az = path[i + 1]!, dx = path[i + 2]! - ax, dz = path[i + 3]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, seg: i, px, pz };
  }
  let remaining = Math.hypot(path[best.seg + 2]! - best.px, path[best.seg + 3]! - best.pz);
  for (let i = best.seg + 2; i + 3 < path.length; i += 2) remaining += Math.hypot(path[i + 2]! - path[i]!, path[i + 3]! - path[i + 1]!);
  return { remaining: Number.isFinite(remaining) ? remaining : 0, off: best.d };
}

/** The part of `path` still ahead of (x, z): from its nearest point on the path to the goal. */
export function pathAhead(path: readonly number[], x: number, z: number): number[] {
  let best = { d: Infinity, seg: 0, px: path[0] ?? x, pz: path[1] ?? z };
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i]!, az = path[i + 1]!, dx = path[i + 2]! - ax, dz = path[i + 3]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, seg: i, px, pz };
  }
  return [best.px, best.pz, ...path.slice(best.seg + 2)];
}
