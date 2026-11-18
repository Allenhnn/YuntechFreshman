import type { CampusData } from './campusTypes';
import buildingRings from './buildingRings.json';

/**
 * Corrections to the OSM-derived campus applied at load time, so `npm run campus:fetch` output
 * stays untouched.
 *
 * 龍潭路 (the west half, from the N–S branch at x ≈ −125 to the west boundary) belongs to campus,
 * but the OSM outline runs along its north kerb. Move that stretch of boundary to just south of
 * the road (its south edge + 2 m), so the whole road is walkable campus.
 */
const OUTSET = 6; // m from the road centreline: half of the 8 m road plus a 2 m verge

export function includeLongtanRoad(campus: CampusData): void {
  const road = campus.roads.find((r) => r.name === '龍潭路' && Math.abs(r.points[0]! + 129) < 2 && Math.abs(r.points[1]! + 54) < 2 && r.points.length > 8);
  const b = campus.boundary;
  const find = (x: number, z: number): number => {
    for (let i = 0; i < b.length; i += 2) if (Math.hypot(b[i]! - x, b[i + 1]! - z) < 3) return i / 2;
    return -1;
  };
  const from = find(-122, -64), to = find(-390, 9);
  if (!road || from < 0 || to < from) return;
  // Road vertices west to x ≈ −389, pushed south (rings are CCW; south of a westward road is its left).
  const pts: number[] = [];
  const p = road.points;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i]! < -395) break;
    const j = Math.min(i + 2, p.length - 2), k = Math.max(i - 2, 0);
    const dx = p[j]! - p[k]!, dz = p[j + 1]! - p[k + 1]!, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len; // left of the westward direction = south
    const sx = nz > 0 ? nx : -nx, sz = nz > 0 ? nz : -nz;
    pts.push(p[i]! + sx * OUTSET, p[i + 1]! + sz * OUTSET);
  }
  // Keep the corner east of the N–S branch, then follow the road's south side west.
  const corner = [-121, -51];
  campus.boundary = [...b.slice(0, from * 2), ...corner, ...pts, ...b.slice(to * 2 + 2)];
}

/** Campus vehicle lanes (OSM `service`, 5 m) become 8 m two-lane roads; 龍潭路 and public roads keep their width. */
const CAMPUS_LANE = 8;

export function widenCampusRoads(campus: CampusData): void {
  const inside = (x: number, z: number): boolean => {
    const r = campus.boundary;
    let hit = false;
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  for (const road of campus.roads) {
    if (road.kind !== 'service' || road.width >= CAMPUS_LANE) continue;
    let within = 0;
    for (let i = 0; i < road.points.length; i += 2) if (inside(road.points[i]!, road.points[i + 1]!)) within++;
    if (within * 2 >= road.points.length / 2) road.width = CAMPUS_LANE;
  }
}

/**
 * 龍潭路 east of the 技職大樓 junction (x > −40) is a divided road, as on Street View: a raised,
 * planted median (shrubs, a row of trees) between two one-way carriageways. OSM draws one 8 m
 * centreline plus service lanes along both sides that are really those carriageways or parking
 * aisles; they are dropped (or trimmed back to where they leave the road) so the stretch reads as
 * one boulevard instead of three parallel roads. West of the junction it stays a two-way street.
 * Street View puts the median north of the OSM line (that line is the south carriageway, the
 * north service lane the other one), so the divided road is centred `north` metres north of it;
 * side roads that end on the line move with it.
 */
export const LONGTAN_DIVIDED = { width: 13.6, median: 2.4, westX: -40, north: 4 } as const;

export function divideLongtan(campus: CampusData): void {
  const idx = campus.roads.findIndex((r) => r.name === '龍潭路' && r.points[0]! > 400);
  if (idx < 0) return;
  const road = campus.roads[idx]!;
  const p = road.points;
  let cut = -1;
  for (let i = 0; i < p.length; i += 2) if (p[i]! >= LONGTAN_DIVIDED.westX - 0.5) cut = i;
  if (cut < 2) return;
  const east = { ...road, points: p.slice(0, cut + 2), width: LONGTAN_DIVIDED.width, median: LONGTAN_DIVIDED.median };
  const west = { ...road, points: p.slice(cut) };
  campus.roads.splice(idx, 1, east, ...(west.points.length >= 4 ? [west] : []));
  // The two-way stretch west of here (this piece and the polyline on from the N–S branch).
  for (const r of campus.roads) if (r.name === '龍潭路' && !r.median && (r === west || (Math.abs(r.points[0]! + 129) < 2 && Math.abs(r.points[1]! + 54) < 2 && r.points.length > 8))) r.longtanWest = true;
  // Street View: an alley on the town side at x ≈ −345 has a box junction too.
  for (const r of campus.roads) if (r.longtanWest && r.points.some((v, i) => i % 2 === 0 && v < -300)) r.boxAt = [-345.5, -0.1];
  // …and white rumble bars on the approach to the 管理學院 corner.
  for (const r of campus.roads) if (r.longtanWest && r.points.some((v, i) => i % 2 === 0 && v > -99) && r.points.some((v, i) => i % 2 === 0 && v < -99)) r.slowAt = [-99, -63.5];

  // Nearest point of the divided stretch: distance and its direction.
  const e = east.points;
  const near = (x: number, z: number): { d: number; ux: number; uz: number } => {
    const e = east.points; // the current line (shifted north once that is done)
    let best = { d: Infinity, ux: 1, uz: 0 };
    for (let i = 0; i + 3 < e.length; i += 2) {
      const ax = e[i]!, az = e[i + 1]!, dx = e[i + 2]! - ax, dz = e[i + 3]! - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best.d) best = { d, ux: dx / Math.sqrt(l2), uz: dz / Math.sqrt(l2) };
    }
    return best;
  };
  const alongside = (q: number[], i: number): boolean => {
    const ax = q[i]!, az = q[i + 1]!, bx = q[i + 2]!, bz = q[i + 3]!, len = Math.hypot(bx - ax, bz - az) || 1;
    const na = near(ax, az), nb = near(bx, bz);
    return na.d < 10.5 && nb.d < 10.5 && Math.abs(((bx - ax) * na.ux + (bz - az) * na.uz) / len) > 0.9;
  };
  campus.roads = campus.roads.filter((r) => {
    if (r.kind !== 'service') return true;
    const q = r.points;
    let a = 0, b = q.length - 2;
    while (a < b && alongside(q, a)) a += 2;
    while (b > a && alongside(q, b - 2)) b -= 2;
    if (b - a < 2) return false;
    r.points = q.slice(a, b + 2);
    return true;
  });

  // Shift north (−z), all but the junction vertex at the west end, and carry joining roads along.
  const moved = new Map<string, [number, number]>();
  const key = (x: number, z: number): string => `${Math.round(x * 10)},${Math.round(z * 10)}`;
  const n = e.length / 2;
  const shifted = e.slice();
  for (let i = 0; i < n - 1; i++) {
    const j = Math.min(i + 1, n - 1), k = Math.max(i - 1, 0);
    const dx = e[j * 2]! - e[k * 2]!, dz = e[j * 2 + 1]! - e[k * 2 + 1]!, len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len, nz = dx / len;
    if (nz > 0) { nx = -nx; nz = -nz; }
    shifted[i * 2] = e[i * 2]! + nx * LONGTAN_DIVIDED.north;
    shifted[i * 2 + 1] = e[i * 2 + 1]! + nz * LONGTAN_DIVIDED.north;
    moved.set(key(e[i * 2]!, e[i * 2 + 1]!), [shifted[i * 2]!, shifted[i * 2 + 1]!]);
  }
  east.points = shifted;
  for (const r of campus.roads) {
    if (r === east) continue;
    for (let i = 0; i < r.points.length; i += 2) {
      const m = moved.get(key(r.points[i]!, r.points[i + 1]!));
      if (m) [r.points[i], r.points[i + 1]] = m;
    }
  }

  // Footpaths OSM draws along the carriageway itself (now inside the wider road): cut those stretches out.
  const inside = LONGTAN_DIVIDED.width / 2 + 0.5;
  const along = (q: number[], i: number): boolean => {
    const ax = q[i]!, az = q[i + 1]!, bx = q[i + 2]!, bz = q[i + 3]!, len = Math.hypot(bx - ax, bz - az) || 1;
    const na = near(ax, az), nb = near(bx, bz);
    return na.d < inside && nb.d < inside && Math.abs(((bx - ax) * na.ux + (bz - az) * na.uz) / len) > 0.85;
  };
  const kept: CampusData['roads'] = [];
  for (const r of campus.roads) {
    if (r.kind !== 'walkway') { kept.push(r); continue; }
    const q = r.points;
    let start = 0;
    for (let i = 0; i + 3 < q.length; i += 2) {
      if (!along(q, i)) continue;
      if (i > start) kept.push({ ...r, points: q.slice(start, i + 2) });
      start = i + 2;
    }
    if (q.length - start >= 4) kept.push(start === 0 ? r : { ...r, points: q.slice(start) });
  }
  campus.roads = kept;
}

/**
 * Per-building corrections read off Street View during the campus remodel (docs/campus-remodel.md):
 * storeys and height (m) where OSM is wrong. Keyed by OSM building id.
 */
export const BUILDING_FIXES: Record<number, { levels?: number; height?: number }> = {};

/**
 * Outlines redrawn from newer floor plans than OSM's (world x, z pairs), written by the hand-built
 * plan scripts (scripts/floorplan/handbuilt/yuntay.py → buildingRings.json), so the shell matches the
 * traced interior inside it. build-buildings.ts applies the same fixes before placing shell doors.
 */
const RINGS = buildingRings as Record<string, number[]>;

export function applyBuildingFixes(campus: CampusData): void {
  for (const b of campus.buildings) {
    const ring = RINGS[String(b.id)];
    if (ring) b.outer = [...ring];
    const f = BUILDING_FIXES[b.id];
    if (!f) continue;
    if (f.levels !== undefined) b.levels = f.levels;
    if (f.height !== undefined) b.height = f.height;
    else if (f.levels !== undefined) b.height = Math.round(f.levels * 3.6 * 10) / 10;
  }
}

/**
 * The central north–south pedestrian axis (OSM: a 2 m path from 63,−102 to 101,114) is on Street View a
 * broad paved boulevard between rows of palms. Widened here; the palms and its lamps are in streetscape.ts.
 */
export const CENTRAL_AXIS = { points: [63.36, -101.5, 64.96, -93.46, 89.0, 40.0, 100.65, 113.72] as const, width: 10 };

/** A walkway on the central axis (also the pieces left where 龍潭路 cuts it): every vertex on the axis line. */
export function isCentralAxis(r: { kind: string; points: readonly number[] }): boolean {
  if (r.kind !== 'walkway' || r.points.length < 4) return false;
  const a = CENTRAL_AXIS.points;
  const off = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const ax = a[i]!, az = a[i + 1]!, dx = a[i + 2]! - ax, dz = a[i + 3]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
    return best;
  };
  const p = r.points;
  let len = 0;
  for (let i = 0; i + 3 < p.length; i += 2) len += Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!);
  for (let i = 0; i < p.length; i += 2) if (off(p[i]!, p[i + 1]!) > 4.5) return false; // its end is pulled ~4 m onto 龍潭路
  return len > 15;
}

export function widenCentralAxis(campus: CampusData): void {
  for (const r of campus.roads) if (isCentralAxis(r)) r.width = CENTRAL_AXIS.width;
}

/**
 * Per-road details read off Street View (docs/streetscape-remodel.md), roads matched by their first
 * OSM vertex:
 *  - the dorm-area roads have a yellow kerb line instead of the red one;
 *  - two dorm lanes (79, 142) are paver lanes, not asphalt, with no markings;
 *  - the dorm road (19) has a sidewalk right at the kerb on both sides, which OSM leaves out.
 * Roads with no panorama of their own, read from the panoramas at their entrances:
 *  - 31 (between dorms C/D) is a red-brick lane, 78 (to dorm road 79) has a yellow kerb and a sidewalk
 *    on its east side;
 *  - the staff-housing lanes (37, 39, 29, 30) have no kerb lines, 住宅道路 (64) no markings at all.
 */
const YELLOW_KERB: readonly [number, number][] = [
  [26.5, 281.1], // 19: dorm road east
  [22.8, 258.0], // 79
  [222.8, 200.7], // 116
  [144.0, 332.2], // 142
  [13.46, 210.25], // 78
];
const PAVED: readonly [number, number][] = [[22.8, 258.0], [144.0, 332.2], [245.51, 315.51]];
const RED_BRICK: readonly [number, number][] = [[245.51, 315.51]];
/** Roads given kerb sidewalks, and on which side (0 both, ±1 one side: +1 left of the polyline). */
const KERB_SIDEWALK: readonly [number, number, 0 | 1 | -1][] = [[26.5, 281.1, 0], [13.46, 210.25, -1]];
const NO_KERB: readonly [number, number][] = [[-432.98, -203.75], [-361.62, -207.47], [-373.42, -217.32], [-383.68, -106.24]];
const PLAIN: readonly [number, number][] = [[-333.34, -80.81]];
const SIDEWALK_WIDTH = 2.2;

const matches = (r: { points: number[] }, list: readonly (readonly number[])[]): boolean =>
  list.some(([x, z]) => Math.hypot(r.points[0]! - x!, r.points[1]! - z!) < 0.5);

function inRing(x: number, z: number, r: number[]): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function polyDist(x: number, z: number, p: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!, az = p[i + 1]!, dx = p[i + 2]! - ax, dz = p[i + 3]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** Footpaths at `off` m either side of a road, sampled every metre and broken where they would run into a building or another road. */
function kerbSidewalks(campus: CampusData, road: CampusData['roads'][number], sides: readonly number[]): CampusData['roads'] {
  const off = road.width / 2 + SIDEWALK_WIDTH / 2;
  const others = campus.roads.filter((r) => r !== road && r.kind !== 'walkway');
  const out: CampusData['roads'] = [];
  for (const side of sides) {
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 8) out.push({ kind: 'walkway', width: SIDEWALK_WIDTH, points: run, sidewalk: true });
      run = [];
    };
    const p = road.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let t = 0; t < len; t += 1) {
        const x = ax + ux * t - uz * side * off, z = az + uz * t + ux * side * off;
        const ok = inRing(x, z, campus.boundary)
          && polyDist(x, z, p) > off - 0.3 // the inside of a bend
          && !campus.buildings.some((b) => inRing(x, z, b.outer))
          && others.every((o) => polyDist(x, z, o.points) > o.width / 2 + SIDEWALK_WIDTH / 2 + 0.3);
        if (ok) run.push(+x.toFixed(2), +z.toFixed(2));
        else flush();
      }
    }
    flush();
  }
  return out;
}

export function streetscapeFixes(campus: CampusData): void {
  const added: CampusData['roads'] = [];
  for (const r of campus.roads) {
    if (r.kind === 'walkway') continue;
    if (matches(r, YELLOW_KERB)) r.kerb = 'yellow';
    if (matches(r, PAVED)) r.paved = true;
    if (matches(r, RED_BRICK)) r.brick = 'red';
    if (matches(r, NO_KERB)) r.kerb = 'none';
    if (matches(r, PLAIN)) r.plain = true;
    const sw = KERB_SIDEWALK.find(([x, z]) => Math.hypot(r.points[0]! - x, r.points[1]! - z) < 0.5);
    if (sw) added.push(...kerbSidewalks(campus, r, sw[2] ? [sw[2]] : [-1, 1]));
  }
  campus.roads.push(...added);
}
