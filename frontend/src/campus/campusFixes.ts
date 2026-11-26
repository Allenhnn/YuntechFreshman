import type { CampusData } from './campusTypes';
import type { TracedIndex } from '../buildings/buildingTypes';
import type { Entrance } from './entrances';
import { DORM_B_RINGS, DORM_B_SPECS, DORM_C, DORM_C_PIECES, DORM_C_TO_D_IDS, dormCToD } from './customFacades';
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
  // 龍潭路 is one road (user, 2026-11-20): the wide stretch keeps its width and sidewalks but has no
  // planted median — one carriageway each way with a centre line.
  const east = { ...road, points: p.slice(0, cut + 2), width: LONGTAN_DIVIDED.width };
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

/**
 * 管理學院 frontage on 北環路 (the user's photos between 管理一館 and 管理二館): the footpath along the
 * north kerb sits back behind a strip of street trees, and a paved path runs north between the two
 * buildings. The OSM footpath segment (its two vertices) moves `shift` m north; the path is added.
 */
const MGMT_A: readonly [number, number] = [-70.49, -147.31];
const MGMT_B: readonly [number, number] = [-233.96, -112.48];
export function mgmtFrontage(): { ax: number; az: number; bx: number; bz: number; ux: number; uz: number; nx: number; nz: number; shift: number } {
  const len = Math.hypot(MGMT_B[0] - MGMT_A[0], MGMT_B[1] - MGMT_A[1]);
  const ux = (MGMT_B[0] - MGMT_A[0]) / len, uz = (MGMT_B[1] - MGMT_A[1]) / len;
  const nx = -uz, nz = ux; // north (−z) of the westward footpath
  const shift = 2.6;
  return { ax: MGMT_A[0] + nx * shift, az: MGMT_A[1] + nz * shift, bx: MGMT_B[0] + nx * shift, bz: MGMT_B[1] + nz * shift, ux, uz, nx, nz, shift };
}
/** The path between 管理二館 and 管理一館: from the footpath's north edge to behind the buildings. */
export const MGMT_PATH = { points: [-168.8, -130.3, -168.9, -152] as const, width: 2.4 };

export function streetscapeFixes(campus: CampusData): void {
  const added: CampusData['roads'] = [];
  const f = mgmtFrontage();
  for (const r of campus.roads) {
    if (r.kind !== 'walkway') continue;
    for (let i = 0; i < r.points.length; i += 2) {
      for (const [x, z] of [MGMT_A, MGMT_B]) {
        if (Math.hypot(r.points[i]! - x, r.points[i + 1]! - z) < 0.05) {
          r.points[i] = x + f.nx * f.shift;
          r.points[i + 1] = z + f.nz * f.shift;
        }
      }
    }
  }
  added.push({ kind: 'walkway', width: MGMT_PATH.width, points: [...MGMT_PATH.points], sidewalk: true });
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

/**
 * Buildings closed to visitors (user, 2026-11-20): 人文學院、設計學院、工程學院、技職大樓、設計工坊、
 * 未來學院、學人宿舍、雲旭樓、營建材料檢測中心、貴賓招待所、產學研大樓、燃燒與動力實驗室. Their exteriors stay
 * as they are (doors drawn shut); no interior is generated or loaded and nobody can get in, which saves
 * the memory and build time of those interiors.
 */
export const SEALED_BUILDINGS: readonly string[] = [
  '人科一館', '人科二館',
  '設計一館', '設計二館', '設計三館', '設計學院',
  '工程一館', '工程二館', '工程三館', '工程四館', '工程五館', '工程六館',
  '技職大樓', '設計工坊', '未來學院', '學人宿舍', '雲旭樓', '營建材料檢測中心', '貴賓招待所',
  '產學研大樓(北棟)', '產學研大樓(南棟)', '燃燒與動力實驗室',
];

export function sealBuildings(campus: CampusData): void {
  const names = new Set(SEALED_BUILDINGS);
  for (const b of campus.buildings) if (b.name && names.has(b.name)) b.sealed = true;
  // 學生宿舍C C1（使用者 2026-11-24：移除 C1 的內部建模）：4 層（照片），沒有室內、沒有門，外觀由 dormCFacade.ts 做。
  // C2（使用者照片 2026-11-24）：整棟外觀由 dormCFacade.ts 接手，舊的自動入口沒地方放，比照 C1、C3 封起來（故事不用它的室內）。
  const c2 = campus.buildings.find((b) => b.id === DORM_C.c2);
  if (c2) c2.sealed = true;
  const c1 = campus.buildings.find((b) => b.id === DORM_C.c1);
  if (c1) {
    c1.sealed = true;
    c1.levels = DORM_C.c1Levels;
    c1.height = Math.round(DORM_C.c1Levels * 3.6 * 10) / 10;
    // 使用者（2026-11-24）：東側沒有凹進去，整面是一個平面（跟南面一樣）——OSM 在東北角的凹口（vertex 6、7）拿掉：
    // 北面（5 → 6）直接延伸到東面（8 → 9）那條線上，兩線交點取代 vertex 6、7、8。
    const r = c1.outer;
    if (r.length === 28 && Math.hypot(r[12]! - 21.04, r[13]! - 326.03) < 0.3 && Math.hypot(r[16]! - 24.97, r[17]! - 330.11) < 0.3) {
      const [ax, az, dx, dz] = [r[10]!, r[11]!, r[12]! - r[10]!, r[13]! - r[11]!];
      const [qx, qz, ex, ez] = [r[16]!, r[17]!, r[18]! - r[16]!, r[19]! - r[17]!];
      const t = ((qx - ax) * -ez - (qz - az) * -ex) / (dx * -ez - dz * -ex);
      c1.outer = [...r.slice(0, 12), ax + dx * t, az + dz * t, ...r.slice(18)];
    }
  }
}

/**
 * 學生宿舍C 北棟（OSM 296668596，U 形）：使用者實拍中段 4 層、左右兩翼 3 層，OSM 卻是一個 5 層 18 m 的多邊形。
 * 切成三塊（customFacades.ts `DORM_C_PIECES`）：中段保留原 id，兩翼是新 id；分界牆由 `PARTY_WALLS` 處理。
 * Skipped (nothing changes) if the OSM ring no longer has the expected shape.
 */
export function splitDormC(campus: CampusData): void {
  const i = campus.buildings.findIndex((b) => b.id === DORM_C.middle);
  const b = campus.buildings[i];
  if (!b || b.outer.length !== 40 || Math.hypot(b.outer[24]! + 8.9, b.outer[25]! - 308.8) > 0.3 || Math.hypot(b.outer[4]! + 29.0, b.outer[5]! - 303.0) > 0.3) return;
  const r = b.outer;
  type P = [number, number];
  const V = (k: number): P => [r[k * 2]!, r[k * 2 + 1]!];
  const add = (p: P, d: P, t: number): P => [p[0] + d[0] * t, p[1] + d[1] * t];
  /** Where p + t·d meets the line through q along e. */
  const meet = (p: P, d: P, q: P, e: P): P => {
    const det = d[0] * -e[1] - d[1] * -e[0];
    return add(p, d, ((q[0] - p[0]) * -e[1] - (q[1] - p[1]) * -e[0]) / det);
  };
  // Front (vertex 13 → 14), unit; the projecting front takes in one room west of the balcony:
  // its west return (vertices 14, 15) slides west by `roomWidth` (使用者標註).
  const f13 = V(13), fl = Math.hypot(r[28]! - f13[0], r[29]! - f13[1]);
  const fu: P = [(r[28]! - f13[0]) / fl, (r[29]! - f13[1]) / fl];
  const p14 = add(V(14), fu, DORM_C.roomWidth), p15 = add(V(15), fu, DORM_C.roomWidth);
  // The east wing keeps its OSM shape (使用者地圖) but moves `eastShift` m further east along the front, so the
  // hall beside the balcony (the old notch, now part of the 4-storey middle) shows about as wide as the west hall
  // (使用者：右側戶廳 4 層、露出比例跟左側差不多). The middle ends on a line from the moved vertex 11 along the
  // east wing's inner face (vertex 8 → 9) up to the north face (3 → 4).
  const sh = (k: number): P => add(V(k), fu, -DORM_C.eastShift);
  const pts: Record<string, P> = { p14, p15 };
  for (const k of [4, 5, 6, 7, 8, 9, 10, 11]) pts[`${k}s`] = sh(k);
  pts.Q = meet(pts['11s']!, [r[18]! - r[16]!, r[19]! - r[17]!], V(3), [r[8]! - r[6]!, r[9]! - r[7]!]);
  // 使用者（2026-11-24）：西翼與中段的分界不要斜的——沿西翼內側牆面（vertex 16 → 17 的線）筆直往北，接到北面的 1 → 2 上。
  pts.B = meet(V(16), [r[34]! - r[32]!, r[35]! - r[33]!], V(1), [r[4]! - r[2]!, r[5]! - r[3]!]);
  const ring = (ids: readonly (number | string)[]): number[] => ids.flatMap((k) => (typeof k === 'number' ? V(k) : pts[k]!));
  // 使用者（2026-11-23）：北棟的室內先整個拿掉——三塊都封起來（門畫成關著的，沒有室內）。故事的寢室在南邊那棟 C（296668592），不受影響。
  const piece = (id: number, ids: readonly (number | string)[], levels: number) => ({ ...b, id, outer: ring(ids), holes: [], levels, height: Math.round(levels * 3.6 * 10) / 10, sealed: true });
  campus.buildings.splice(i, 1,
    piece(DORM_C.middle, DORM_C_PIECES.middle, DORM_C.middleLevels),
    piece(DORM_C.westWing, DORM_C_PIECES.westWing, DORM_C.wingLevels),
    piece(DORM_C.eastWing, DORM_C_PIECES.eastWing, DORM_C.wingLevels));
}

/**
 * 學生宿舍D（使用者 2026-11-24：整個 C 區的配置複製到 D 區）：after `sealBuildings` and `splitDormC`, each D building's
 * outline becomes its C counterpart's mirrored across (customFacades.ts `dormCToD`, vertex order reversed so it stays CCW),
 * with the same storeys; all sealed (外觀就好、門進不去). The south building takes C3's three pieces: the middle keeps the
 * OSM id, the wings are new. Skipped if any C piece or D building is missing.
 */
export function copyDormCToD(campus: CampusData): void {
  const pairs = DORM_C_TO_D_IDS.map(([c, d]) => [campus.buildings.find((b) => b.id === c), d] as const);
  const template = campus.buildings.find((b) => b.id === DORM_C_TO_D_IDS[2]![1]);
  if (pairs.some(([c]) => !c) || !template) return;
  for (const [c, id] of pairs) {
    const r = c!.outer, out: number[] = [];
    for (let k = r.length / 2 - 1; k >= 0; k--) out.push(...dormCToD(r[k * 2]!, r[k * 2 + 1]!));
    const d = { ...(campus.buildings.find((b) => b.id === id) ?? template), id, outer: out, holes: [], levels: c!.levels, height: c!.height, sealed: true };
    const at = campus.buildings.findIndex((b) => b.id === id);
    if (at >= 0) campus.buildings[at] = d;
    else campus.buildings.push(d);
  }
}

/**
 * 學生宿舍B（使用者 2026-11-25，B 區一樓平面圖）：三棟的外環換成照平面圖描的（customFacades.ts `DORM_B_RINGS`）；三棟都封起來
 * （外觀由 dormCFacade.ts site 'B' 做，不做室內）。
 */
export function reshapeDormB(campus: CampusData): void {
  for (const { id } of DORM_B_SPECS) {
    const b = campus.buildings.find((x) => x.id === id);
    if (!b) continue;
    const ring = DORM_B_RINGS[id];
    if (ring) { b.outer = ring.flatMap(([x, z]) => [x, z]); b.holes = []; }
    b.sealed = true;
  }
}

/**
 * 學生宿舍E.F（使用者 2026-11-26，E、F 一樓平面圖）：兩棟外環照平面圖描（0.049 m/px，平面圖北朝下：轉 180° 再轉 −11.1°）。
 * F 的 OSM 外形跟平面圖對得很準（四角差 1 m 內），用 F 定位；E 照平面圖跟 F 的相對位置放（比 OSM 往西約 5 m、南北深 22 m）。
 * F：北側長條 71.4 × 12.9 m、兩翼往北伸到 23.4 m、中間入口凸出 2 m；E：兩翼 13.1 m 寬、南側長條 35.5 m、中間入口凸出 2 m。
 * 使用者（2026-11-26）：只有兩翼之間那兩道圍牆的門是門，兩棟其他地方都沒有門——封起來、不畫門（`doorless`），沒有室內。
 */
const DORM_EF_RINGS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  296668591: [[132.71, 414.43], [61.36, 428.47], [58.87, 415.82], [66.52, 414.32], [66.9, 416.29], [71.04, 415.48], [68.32, 401.63], [80.86, 399.16], [82.31, 406.52], [80.24, 406.92], [81.56, 413.61], [88.14, 412.31], [87.77, 410.39], [101.42, 407.7], [101.8, 409.63], [108.39, 408.33], [107.07, 401.65], [105.0, 402.05], [103.56, 394.7], [116.15, 392.22], [118.88, 406.07], [122.96, 405.26], [122.58, 403.29], [130.22, 401.79]],
  292500724: [[102.11, 382.5], [89.22, 385.03], [87.71, 377.34], [89.68, 376.95], [88.73, 372.14], [82.58, 373.36], [82.96, 375.28], [69.25, 377.97], [68.88, 376.05], [62.72, 377.26], [63.67, 382.07], [65.64, 381.68], [67.15, 389.37], [54.27, 391.91], [51.38, 377.25], [57.87, 375.97], [56.22, 367.55], [91.07, 360.7], [92.73, 369.11], [99.22, 367.83]],
};
export function reshapeDormEF(campus: CampusData): void {
  for (const [id, ring] of Object.entries(DORM_EF_RINGS)) {
    const b = campus.buildings.find((x) => x.id === Number(id));
    if (b) { b.outer = ring.flatMap(([x, z]) => [x, z]); b.holes = []; b.sealed = true; b.doorless = true; }
  }
}

/**
 * After `splitDormC`: the plan-traced interior that covered 296668596 now spans the three pieces, and
 * its shell doors (edge + metres along it) are moved onto whichever piece's wall they now lie on.
 * Every piece gets an entry (maybe empty), so none of them falls back to a generated interior.
 */
export function remapSplitTraced(traced: TracedIndex | undefined, campus: CampusData): void {
  // Only while a traced plan covers it (FLOORPLAN_INTERIORS); otherwise each piece gets a generated interior.
  if (!traced?.buildings.some((t) => t.osmIds.includes(DORM_C.middle))) return;
  const pieces = [DORM_C.middle, DORM_C.westWing, DORM_C.eastWing].map((id) => campus.buildings.find((b) => b.id === id));
  if (pieces.some((p) => !p) || !campus.buildings.some((b) => b.id === DORM_C.westWing)) return;
  for (const t of traced.buildings) if (t.osmIds.includes(DORM_C.middle)) for (const id of [DORM_C.westWing, DORM_C.eastWing]) if (!t.osmIds.includes(id)) t.osmIds.push(id);
  const old = traced.entrances[String(DORM_C.middle)] ?? [];
  const oldRing = OLD_DORM_C_NORTH; // the doors are all on the original north face (vertex 3 → 4)
  const out = new Map<number, Entrance[]>(pieces.map((p) => [p!.id, []]));
  for (const en of old) {
    if (en.edge !== 3) continue;
    const [ax, az, bx, bz] = oldRing, len = Math.hypot(bx - ax, bz - az);
    const x = ax + ((bx - ax) * en.along) / len, z = az + ((bz - az) * en.along) / len;
    for (const p of pieces) {
      const rr = p!.outer, n = rr.length / 2;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n, px = rr[k * 2]!, pz = rr[k * 2 + 1]!, qx = rr[j * 2]!, qz = rr[j * 2 + 1]!;
        const l = Math.hypot(qx - px, qz - pz), s = ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / l;
        const off = Math.abs((x - px) * (qz - pz) - (z - pz) * (qx - px)) / l;
        if (off < 0.3 && s > 1.3 && s < l - 1.3) out.get(p!.id)!.push({ edge: k, along: s });
      }
    }
  }
  for (const [id, list] of out) traced.entrances[String(id)] = list;
}
/** The original north face of 296668596 (vertex 3 → 4), where its three shell doors are. */
const OLD_DORM_C_NORTH = [-29.23, 301.79, 0.38, 296.58] as const;
