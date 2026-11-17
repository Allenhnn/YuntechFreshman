import type { CampusData, CampusRoad, Ring } from './campusTypes';
import type { GeoBuilder } from './chunkBuilder';

/**
 * Taiwan-standard road markings, generated per road from its width:
 *  - 分向限制線: double solid yellow down the centre of two-way roads (≥ 7 m);
 *    narrower two-way roads get a single dashed yellow centre line;
 *  - 車道線: white dashes (4 m line, 6 m gap) between lanes going the same way;
 *  - 路面邊線: solid white edge lines;
 *  - 禁止停車線: solid yellow along the kerb of campus roads;
 *  - 行人穿越道 (枕木紋): white bars where a walkway crosses the road.
 * Lines break at junctions and under crossings. Pure data → geometry, so it runs in the chunk worker.
 */
const WHITE: readonly [number, number, number] = [0.95, 0.95, 0.92];
const YELLOW: readonly [number, number, number] = [0.95, 0.77, 0.16];
const Y = 0.064; // above road (0.04) and walkway (0.06) ribbons
const JUNCTION_CLEAR = 6;
const ZEBRA_LEN = 3;
const DASH: readonly [number, number] = [4, 6];
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
  if (road.name && ONE_WAY.has(road.name)) out.push({ off: 0, wid: 0.12, color: WHITE, dash: DASH });
  else if (w >= 7) {
    out.push({ off: -0.13, wid: 0.1, color: YELLOW }, { off: 0.13, wid: 0.1, color: YELLOW });
    if (w >= 12) out.push({ off: -w / 4, wid: 0.12, color: WHITE, dash: DASH }, { off: w / 4, wid: 0.12, color: WHITE, dash: DASH });
  } else out.push({ off: 0, wid: 0.1, color: YELLOW, dash: DASH });
  if (campus) out.push({ off: -(w / 2 - 0.1), wid: 0.12, color: YELLOW }, { off: w / 2 - 0.1, wid: 0.12, color: YELLOW });
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
      for (let i = 0; i < n; i++) {
        const others = at.get(key(p[i * 2]!, p[i * 2 + 1]!))!;
        if (others.size < 2) continue;
        let widest = 0;
        for (const o of others) if (o !== r) widest = Math.max(widest, o.width);
        const clear = JUNCTION_CLEAR + widest / 2;
        skips.push([cum[i]! - clear, cum[i]! + clear]);
      }
      const zebras: number[] = [];
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
      let campus = false;
      for (let i = 0; i < p.length && !campus; i += 2) campus = pointInRing(p[i]!, p[i + 1]!, data.boundary);
      this.meta.set(r, { cum, skips, zebras, lines: linesFor(r, campus && r.kind === 'service') });
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
      for (const z of m.zebras) {
        if (z < s0 || z >= s1) continue;
        for (let o = -road.width / 2 + 0.6; o <= road.width / 2 - 0.6 + 1e-6; o += 0.8) quad(z - ZEBRA_LEN / 2, z + ZEBRA_LEN / 2, o, 0.4, WHITE);
      }
    }
  }
}
