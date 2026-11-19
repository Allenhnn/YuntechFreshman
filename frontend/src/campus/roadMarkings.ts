import type { CampusData, CampusRoad, Ring } from './campusTypes';
import type { GeoBuilder } from './chunkBuilder';

/**
 * Taiwan-standard road markings, generated per road from its width:
 *  - 分向限制線: double solid yellow down the centre of two-way roads (≥ 7 m);
 *    narrower two-way roads get a single dashed yellow centre line;
 *  - 車道線: white dashes (4 m line, 6 m gap) between lanes going the same way;
 *  - 路面邊線: solid white edge lines;
 *  - 禁止臨時停車線: solid red along the kerb of campus roads (Street View: no white edge lines there);
 *    禁止停車線 (yellow) on the dorm roads;
 *  - 行人穿越道 (枕木紋): white bars where a walkway crosses the road, and on each arm of a junction
 *    between campus roads (Street View: 北環路 / 東側路 corner).
 * Lines break at junctions and under crossings. Pure data → geometry, so it runs in the chunk worker.
 */
const WHITE: readonly [number, number, number] = [0.95, 0.95, 0.92];
const YELLOW: readonly [number, number, number] = [0.95, 0.77, 0.16];
const RED: readonly [number, number, number] = [0.78, 0.16, 0.14];
const Y = 0.064; // above road (0.04) and walkway (0.06) ribbons
const JUNCTION_CLEAR = 6;
const ZEBRA_LEN = 3;
const DASH: readonly [number, number] = [4, 6];
/** Box junction size along the road and diagonal spacing (m). */
const BOX_LEN = 9;
const BOX_STEP = 2;
/** Roads that are one carriageway of a divided road (both lanes run the same way). */
const ONE_WAY = new Set(['大學路三段']);

interface Line {
  off: number;
  wid: number;
  color: readonly [number, number, number];
  dash?: readonly [number, number];
}

interface Meta {
  cum: number[];
  /** Arc-length intervals left unmarked (junctions, crossings). */
  skips: [number, number][];
  zebras: number[];
  /** Arc lengths of 網狀線 (yellow box junction) centres. */
  boxes: number[];
  slows: number[];
  lines: Line[];
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function linesFor(road: CampusRoad, campus: boolean): Line[] {
  const w = road.width, edge = w / 2 - 0.4;
  const out: Line[] = [{ off: -edge, wid: 0.12, color: WHITE }, { off: edge, wid: 0.12, color: WHITE }];
  // Divided road: edge lines along the median kerb too; no centre line (the median is the divider).
  if (road.median) return [...out, { off: -(road.median / 2 + 0.3), wid: 0.12, color: WHITE }, { off: road.median / 2 + 0.3, wid: 0.12, color: WHITE }];
  // 龍潭路 west (Street View): white edge on the town side, solid yellow along the campus kerb, no centre line.
  // North is +off for these westward polylines.
  if (road.longtanWest) return [{ off: -edge, wid: 0.12, color: WHITE }, { off: w / 2 - 0.25, wid: 0.12, color: YELLOW }];
  if (road.name && ONE_WAY.has(road.name)) out.push({ off: 0, wid: 0.12, color: WHITE, dash: DASH });
  else if (w >= 7) {
    out.push({ off: -0.13, wid: 0.1, color: YELLOW }, { off: 0.13, wid: 0.1, color: YELLOW });
    if (w >= 12) out.push({ off: -w / 4, wid: 0.12, color: WHITE, dash: DASH }, { off: w / 4, wid: 0.12, color: WHITE, dash: DASH });
  } else out.push({ off: 0, wid: 0.1, color: YELLOW, dash: DASH });
  if (road.plain) return [];
  if (road.kerb === 'none') return out.slice(2);
  if (campus) {
    const kerb = road.kerb === 'yellow' ? YELLOW : RED;
    return [...out.slice(2), { off: -(w / 2 - 0.1), wid: 0.12, color: kerb }, { off: w / 2 - 0.1, wid: 0.12, color: kerb }];
  }
  return out;
}

export class RoadMarker {
  private readonly meta = new Map<CampusRoad, Meta>();

  constructor(data: CampusData) {
    const vehicles = data.roads.filter((r) => r.kind !== 'walkway' && r.points.length >= 4);
    const walks = data.roads.filter((r) => r.kind === 'walkway');
    const key = (x: number, z: number): string => `${Math.round(x)},${Math.round(z)}`;
    const at = new Map<string, Set<CampusRoad>>();
    for (const r of vehicles) {
      for (let i = 0; i < r.points.length; i += 2) {
        const k = key(r.points[i]!, r.points[i + 1]!);
        (at.get(k) ?? at.set(k, new Set()).get(k)!).add(r);
      }
    }
    // Walkway segments with bounds, for the crossing test.
    const walkSegs: [number, number, number, number][] = [];
    for (const w of walks) for (let i = 0; i + 3 < w.points.length; i += 2) walkSegs.push([w.points[i]!, w.points[i + 1]!, w.points[i + 2]!, w.points[i + 3]!]);

    for (const r of vehicles) {
      const p = r.points, n = p.length / 2;
      const cum = [0];
      for (let i = 0; i + 1 < n; i++) cum.push(cum[i]! + Math.hypot(p[i * 2 + 2]! - p[i * 2]!, p[i * 2 + 3]! - p[i * 2 + 1]!));
      const skips: [number, number][] = [];
      const boxes: number[] = [];
      let campus = false;
      for (let i = 0; i < p.length && !campus; i += 2) campus = pointInRing(p[i]!, p[i + 1]!, data.boundary);
      campus &&= r.kind === 'service';
      const zebras: number[] = [];
      for (let i = 0; i < n; i++) {
        const others = at.get(key(p[i * 2]!, p[i * 2 + 1]!))!;
        if (others.size < 2) continue;
        let widest = 0;
        for (const o of others) if (o !== r) widest = Math.max(widest, o.width);
        const clear = JUNCTION_CLEAR + widest / 2;
        skips.push([cum[i]! - clear, cum[i]! + clear]);
        // Junction crossings on campus: one just outside the crossing road, on each arm.
        if (campus && r.width >= 6 && widest >= 6) {
          for (const s of [cum[i]! - widest / 2 - 2.4, cum[i]! + widest / 2 + 2.4]) {
            if (s > 2 && s < cum[n - 1]! - 2 && zebras.every((z) => Math.abs(z - s) > 6)) zebras.push(s);
          }
        }
        if (r.longtanWest && i > 0 && i < n - 1) boxes.push(cum[i]!);
      }
      // Boxes OSM has no junction for, and rumble bars: nearest arc length on this road.
      const slows: number[] = [];
      const extra = [...(r.boxAt ?? []).map((v, i) => [v, i] as const), ...(r.slowAt ?? []).map((v, i) => [v, i + 1e6] as const)];
      for (let b = 0; b + 1 < extra.length; b += 2) {
        const ex = extra[b]![0], ez = extra[b + 1]![0], slow = extra[b]![1] >= 1e6;
        let best = Infinity, at = 0;
        for (let i = 0; i + 1 < n; i++) {
          const ax = p[i * 2]!, az = p[i * 2 + 1]!, dx = p[i * 2 + 2]! - ax, dz = p[i * 2 + 3]! - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ez - az) * dz) / l2));
          const d = Math.hypot(ex - ax - dx * t, ez - az - dz * t);
          if (d < best) { best = d; at = cum[i]! + t * Math.sqrt(l2); }
        }
        if (best < 8) (slow ? slows : boxes).push(at);
      }
      for (let i = 0; i + 1 < n; i++) {
        const ax = p[i * 2]!, az = p[i * 2 + 1]!, bx = p[i * 2 + 2]!, bz = p[i * 2 + 3]!;
        const rx = bx - ax, rz = bz - az;
        for (const [cx, cz, dx, dz] of walkSegs) {
          if (Math.max(cx, dx) < Math.min(ax, bx) || Math.min(cx, dx) > Math.max(ax, bx) || Math.max(cz, dz) < Math.min(az, bz) || Math.min(cz, dz) > Math.max(az, bz)) continue;
          const sx = dx - cx, sz = dz - cz;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          // Only where the path really crosses (not where it runs along the road).
          const cos = Math.abs(rx * sx + rz * sz) / (Math.hypot(rx, rz) * Math.hypot(sx, sz) || 1);
          if (cos > 0.8) continue;
          const s = cum[i]! + t * (cum[i + 1]! - cum[i]!);
          if (zebras.every((z) => Math.abs(z - s) > 9)) zebras.push(s);
        }
      }
      for (const z of zebras) skips.push([z - ZEBRA_LEN / 2 - 0.6, z + ZEBRA_LEN / 2 + 0.6]);
      this.meta.set(r, { cum, skips, zebras, boxes, slows, lines: linesFor(r, campus) });
    }
  }

  /** Markings for segments [from, to) of `road`. */
  emit(g: GeoBuilder, road: CampusRoad, from: number, to: number): void {
    const m = this.meta.get(road);
    if (!m) return;
    const p = road.points;
    for (let i = from; i < to; i++) {
      const ax = p[i * 2]!, az = p[i * 2 + 1]!, bx = p[i * 2 + 2]!, bz = p[i * 2 + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
      const s0 = m.cum[i]!, s1 = m.cum[i + 1]!;
      const quad = (a: number, b: number, off: number, wid: number, color: readonly [number, number, number]): void => {
        const pt = (s: number, o: number): number => g.vertex(ax + ux * (s - s0) + nx * o, Y, az + uz * (s - s0) + nz * o, 0, 1, 0, 0, 0, color);
        const v0 = pt(a, off - wid / 2), v1 = pt(b, off - wid / 2), v2 = pt(b, off + wid / 2), v3 = pt(a, off + wid / 2);
        g.triUp(v0, v1, v2);
        g.triUp(v0, v2, v3);
      };
      // Marked stretches of this segment: [s0, s1] minus the skips.
      let spans: [number, number][] = [[s0, s1]];
      for (const [k0, k1] of m.skips) {
        spans = spans.flatMap(([a, b]): [number, number][] => (k1 <= a || k0 >= b ? [[a, b]] : [[a, Math.min(b, k0)], [Math.max(a, k1), b]]));
      }
      spans = spans.filter(([a, b]) => b - a > 0.2);
      for (const l of m.lines) {
        for (const [a, b] of spans) {
          if (!l.dash) { quad(a, b, l.off, l.wid, l.color); continue; }
          const period = l.dash[0] + l.dash[1];
          for (let k = Math.floor(a / period); k * period < b; k++) {
            const d0 = Math.max(a, k * period), d1 = Math.min(b, k * period + l.dash[0]);
            if (d1 - d0 > 0.3) quad(d0, d1, l.off, l.wid, l.color);
          }
        }
      }
      // 網狀線: yellow outline and a diagonal grid, centred on the junction.
      const line = (sa: number, oa: number, sb: number, ob: number, wid: number): void => {
        const ls = sb - sa, lo = ob - oa, l = Math.hypot(ls, lo) || 1;
        const ps = (-lo / l) * wid / 2, po = (ls / l) * wid / 2;
        const pt = (s: number, o: number): number => g.vertex(ax + ux * (s - s0) + nx * o, Y + 0.002, az + uz * (s - s0) + nz * o, 0, 1, 0, 0, 0, YELLOW);
        const v0 = pt(sa - ps, oa - po), v1 = pt(sb - ps, ob - po), v2 = pt(sb + ps, ob + po), v3 = pt(sa + ps, oa + po);
        g.triUp(v0, v1, v2);
        g.triUp(v0, v2, v3);
      };
      for (const c of m.boxes) {
        if (c < s0 || c >= s1) continue;
        const L = BOX_LEN / 2, W = road.width / 2 - 0.5;
        line(c - L, -W, c + L, -W, 0.15);
        line(c - L, W, c + L, W, 0.15);
        line(c - L, -W, c - L, W, 0.15);
        line(c + L, -W, c + L, W, 0.15);
        for (let d = -L - W + BOX_STEP / 2; d < L + W; d += BOX_STEP) {
          const a1 = Math.max(-W, -L - d), b1 = Math.min(W, L - d);
          if (b1 - a1 > 0.2) line(c + d + a1, a1, c + d + b1, b1, 0.12);
          const a2 = Math.max(-W, d - L), b2 = Math.min(W, d + L);
          if (b2 - a2 > 0.2) line(c + d - a2, a2, c + d - b2, b2, 0.12);
        }
      }
      // 減速標線: three groups of four bars across the road.
      for (const c of m.slows) {
        if (c < s0 || c >= s1) continue;
        for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) {
          const s = c + (k - 1) * 4 + j * 0.6;
          quad(s, s + 0.3, 0, road.width - 0.8, WHITE);
        }
      }
      for (const z of m.zebras) {
        if (z < s0 || z >= s1) continue;
        for (let o = -road.width / 2 + 0.6; o <= road.width / 2 - 0.6 + 1e-6; o += 0.8) quad(z - ZEBRA_LEN / 2, z + ZEBRA_LEN / 2, o, 0.4, WHITE);
      }
    }
  }
}
