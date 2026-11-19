/**
 * Usage:
 *   npm run campus:fetch            download OSM data for the Yuntech campus, then convert
 *   npm run campus:fetch -- --offline   re-convert from assets-src/campus/osm-raw.json
 *
 * Output: public/data/campus.json (see src/campus/campusTypes.ts).
 * Building heights: OSM `height` > `building:levels` > assets-src/campus/height-overrides.json
 * (by name, in floors) > defaults by building type. Data © OpenStreetMap contributors (ODbL).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { CampusBuilding, CampusData, CampusField, CampusRoad, FieldKind, Ring, RoadKind } from '../src/campus/campusTypes';

const RAW = 'assets-src/campus/osm-raw.json';
const FLOORPLANS = 'assets-src/floorplans';
const OVERRIDES = 'assets-src/campus/height-overrides.json';
/** OSM id → building name, for buildings OSM leaves unnamed or names generically. */
const NAME_OVERRIDES = 'assets-src/campus/name-overrides.json';
/** Optional fixed spawn point { x, z, facing, label }; otherwise the main gate is used. */
const SPAWN_OVERRIDE = 'assets-src/campus/spawn.json';
const OUT = 'public/data/campus.json';

/** OSM relation of 國立雲林科技大學 and its bounding box (from Nominatim). */
const CAMPUS_RELATION = 9348317;
const CAMPUS_BBOX = { south: 23.6881508, west: 120.5297915, north: 23.6966395, east: 120.5383688 };
/** Surrounding context included around the campus (m). */
const MARGIN_M = 150;
const FLOOR_HEIGHT = 3.6;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---------------------------------------------------------------------------------------------
// Overpass types (only what we read)

interface LatLon { lat: number; lon: number }
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmWay { type: 'way'; id: number; geometry?: LatLon[]; tags?: Record<string, string> }
interface OsmMember { type: string; role: string; geometry?: LatLon[] }
interface OsmRelation { type: 'relation'; id: number; members: OsmMember[]; tags?: Record<string, string> }
type OsmElement = OsmNode | OsmWay | OsmRelation;

// ---------------------------------------------------------------------------------------------

const origin = { lat: (CAMPUS_BBOX.south + CAMPUS_BBOX.north) / 2, lon: (CAMPUS_BBOX.west + CAMPUS_BBOX.east) / 2 };
const R = 6378137;
const rad = (d: number): number => (d * Math.PI) / 180;
const cosLat0 = Math.cos(rad(origin.lat));

/** Local tangent-plane projection; error is far below a centimetre over ~1 km. */
function project(p: LatLon): [number, number] {
  return [rad(p.lon - origin.lon) * R * cosLat0, -rad(p.lat - origin.lat) * R];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

function toRing(points: LatLon[]): Ring {
  const flat: number[] = [];
  for (const p of points) {
    const [x, z] = project(p);
    const n = flat.length;
    if (n >= 2 && Math.abs(flat[n - 2]! - x) < 0.05 && Math.abs(flat[n - 1]! - z) < 0.05) continue;
    flat.push(round2(x), round2(z));
  }
  const n = flat.length;
  if (n >= 4 && Math.abs(flat[0]! - flat[n - 2]!) < 0.05 && Math.abs(flat[1]! - flat[n - 1]!) < 0.05) flat.length = n - 2;
  return flat;
}

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2]! * r[j * 2 + 1]! - r[j * 2]! * r[i * 2 + 1]!;
  }
  return a / 2;
}

function orient(r: Ring, positive: boolean): Ring {
  if (signedArea(r) > 0 === positive) return r;
  const out: number[] = [];
  for (let i = r.length / 2 - 1; i >= 0; i--) out.push(r[i * 2]!, r[i * 2 + 1]!);
  return out;
}

function centroid(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Joins relation member ways into closed rings (members may be split into several ways). */
function assembleRings(segments: LatLon[][]): LatLon[][] {
  const same = (a: LatLon, b: LatLon): boolean => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
  const open = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: LatLon[][] = [];
  while (open.length) {
    let ring = open.shift()!;
    let grown = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i]!;
        const end = ring[ring.length - 1]!;
        if (same(end, s[0]!)) ring = ring.concat(s.slice(1));
        else if (same(end, s[s.length - 1]!)) ring = ring.concat(s.slice().reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------------------------------------

function defaultLevels(name: string | undefined, area: number, inCampus: boolean): number {
  if (name) {
    if (/警衛|司令台|涼亭|廁所/.test(name)) return 1;
    if (/宿舍/.test(name)) return 7;
    if (/餐廳|活動中心|表演廳|藝術中心|招待所|工坊|實驗室|檢測中心/.test(name)) return 3;
    if (/館|大樓|中心|學院|會議廳|樓|閣|園區/.test(name)) return 5;
  }
  if (!inCampus) return area < 60 ? 2 : 3; // surrounding townhouses (透天厝)
  return area < 150 ? 1 : 2;
}

const ROAD_KINDS: Readonly<Record<string, [RoadKind, number]>> = {
  trunk: ['major', 14], primary: ['major', 12], secondary: ['major', 10],
  tertiary: ['minor', 8], residential: ['minor', 7], unclassified: ['minor', 6], living_street: ['minor', 6],
  service: ['service', 5],
  pedestrian: ['walkway', 4], footway: ['walkway', 2.5], path: ['walkway', 2], steps: ['walkway', 2.5], cycleway: ['walkway', 2],
};

function fieldKind(tags: Record<string, string>): FieldKind | null {
  if (tags.leisure === 'track') return 'track';
  if (tags.leisure === 'park') return 'park';
  if (tags.leisure === 'pitch' || tags.leisure === 'stadium') {
    return /soccer|football|rugby|baseball|softball/.test(tags.sport ?? 'soccer') ? 'soccer' : 'court';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------

async function download(): Promise<OsmElement[]> {
  const dLat = MARGIN_M / 111320;
  const dLon = MARGIN_M / (111320 * cosLat0);
  const bbox = `${CAMPUS_BBOX.south - dLat},${CAMPUS_BBOX.west - dLon},${CAMPUS_BBOX.north + dLat},${CAMPUS_BBOX.east + dLon}`;
  const query = `[out:json][timeout:120];(
    way["building"](${bbox});
    rel["building"](${bbox});
    way["highway"](${bbox});
    way["leisure"~"^(pitch|track|park|stadium)$"](${bbox});
    node["natural"="tree"](${bbox});
    node["barrier"~"^(gate|entrance)$"](${bbox});
    node["entrance"](${bbox});
    rel(${CAMPUS_RELATION});
  );out geom;`;
  let wait = 5;
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length]!;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'YuntechFreshMan-dev/0.1' },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) {
        writeFileSync(RAW, text);
        console.log(`[campus] downloaded ${(text.length / 1024).toFixed(0)} KB from ${url}`);
        return (JSON.parse(text) as { elements: OsmElement[] }).elements;
      }
      console.warn(`[campus] ${url} → HTTP ${res.status}, retrying in ${wait}s`);
    } catch (err: unknown) {
      console.warn(`[campus] ${url} failed (${String(err)}), retrying in ${wait}s`);
    }
    await new Promise((r) => setTimeout(r, wait * 1000));
    wait = Math.min(wait * 2, 60);
  }
  throw new Error('Overpass unavailable after retries');
}

function convert(elements: OsmElement[]): CampusData {
  const overrides: Record<string, number> = existsSync(OVERRIDES) ? (JSON.parse(readFileSync(OVERRIDES, 'utf8')) as Record<string, number>) : {};
  if (!existsSync(OVERRIDES)) writeFileSync(OVERRIDES, '{\n  "行政大樓": 5\n}\n');
  const nameOverrides: Record<string, string> = existsSync(NAME_OVERRIDES) ? (JSON.parse(readFileSync(NAME_OVERRIDES, 'utf8')) as Record<string, string>) : {};

  // Campus boundary.
  const campusRel = elements.find((e): e is OsmRelation => e.type === 'relation' && e.id === CAMPUS_RELATION);
  const boundaryRings = campusRel ? assembleRings(campusRel.members.filter((m) => m.role !== 'inner').map((m) => m.geometry ?? [])) : [];
  const boundary = orient(toRing(boundaryRings.sort((a, b) => b.length - a.length)[0] ?? []), true);

  const buildings: CampusBuilding[] = [];
  const addBuilding = (id: number, tags: Record<string, string>, outerLL: LatLon[], holesLL: LatLon[][]): void => {
    const outer = orient(toRing(outerLL), true);
    if (outer.length < 6) return;
    const area = signedArea(outer);
    if (area < 4) return;
    const [cx, cz] = centroid(outer);
    const inCampus = boundary.length >= 6 && pointInRing(cx, cz, boundary);
    const name = nameOverrides[String(id)] ?? tags.name;
    const parsedHeight = Number.parseFloat(tags.height ?? '');
    const osmLevels = Number.parseInt(tags['building:levels'] ?? '', 10);
    const levels = (name !== undefined ? overrides[name] : undefined) ?? (Number.isFinite(osmLevels) ? osmLevels : defaultLevels(name, area, inCampus));
    const height = Number.isFinite(parsedHeight) ? parsedHeight : Math.max(1, levels) * FLOOR_HEIGHT;
    buildings.push({
      id,
      ...(name ? { name } : {}),
      outer,
      holes: holesLL.map((h) => orient(toRing(h), false)).filter((h) => h.length >= 6),
      height: round2(height),
      levels,
      inCampus,
    });
  };

  const roads: CampusRoad[] = [];
  const fields: CampusField[] = [];
  const trees: number[] = [];
  const gates: { x: number; z: number; name: string }[] = [];

  for (const e of elements) {
    const tags = e.tags ?? {};
    if (e.type === 'way' && e.geometry) {
      if (tags.building && tags.building !== 'no') {
        addBuilding(e.id, tags, e.geometry, []);
        continue;
      }
      const road = tags.highway ? ROAD_KINDS[tags.highway] : undefined;
      if (road && tags.area !== 'yes') {
        roads.push({ kind: road[0], width: road[1], points: toRing(e.geometry), ...(tags.name ? { name: tags.name } : {}) });
        continue;
      }
      const fk = fieldKind(tags);
      if (fk) {
        const outer = orient(toRing(e.geometry), true);
        if (outer.length >= 6) fields.push({ kind: fk, outer });
      }
    } else if (e.type === 'relation' && tags.building) {
      const outers = assembleRings(e.members.filter((m) => m.role === 'outer').map((m) => m.geometry ?? []));
      const inners = assembleRings(e.members.filter((m) => m.role === 'inner').map((m) => m.geometry ?? []));
      outers.forEach((o, i) => addBuilding(e.id * 10 + i, tags, o, inners));
    } else if (e.type === 'node') {
      const [x, z] = project(e);
      if (tags.natural === 'tree') trees.push(round2(x), round2(z));
      else gates.push({ x, z, name: tags.name ?? tags.entrance ?? tags.barrier ?? '' });
    }
  }

  // Spawn: a named main gate if mapped, else just inside the guard house closest to 大學路.
  const mainGate = gates.find((g) => /大門|校門|正門|main/.test(g.name));
  const facingCentre = (x: number, z: number): number => Math.atan2(-x, -z);
  const daxue = roads.filter((rd) => rd.name?.includes('大學路'));
  const distToDaxue = (x: number, z: number): number => {
    let best = Infinity;
    for (const r of daxue) {
      for (let i = 0; i + 3 < r.points.length; i += 2) {
        best = Math.min(best, distToSegment(x, z, r.points[i]!, r.points[i + 1]!, r.points[i + 2]!, r.points[i + 3]!));
      }
    }
    return best;
  };
  const guard = buildings
    .filter((b) => b.name?.includes('警衛'))
    .map((b) => ({ c: centroid(b.outer), d: 0 }))
    .map((g) => ({ ...g, d: distToDaxue(g.c[0], g.c[1]) }))
    .sort((a, b) => a.d - b.d)[0];
  let spawn: CampusData['spawn'];
  if (existsSync(SPAWN_OVERRIDE)) {
    spawn = JSON.parse(readFileSync(SPAWN_OVERRIDE, 'utf8')) as CampusData['spawn'];
  } else if (mainGate) {
    spawn = { x: round2(mainGate.x), z: round2(mainGate.z), facing: facingCentre(mainGate.x, mainGate.z), label: mainGate.name };
  } else if (guard) {
    const [gx, gz] = guard.c;
    const len = Math.hypot(gx, gz) || 1;
    const x = gx - (gx / len) * 18;
    const z = gz - (gz / len) * 18;
    spawn = { x: round2(x), z: round2(z), facing: facingCentre(x, z), label: '大學路校門口' };
  } else {
    spawn = { x: 0, z: 0, facing: 0, label: '校園中心' };
  }

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = (r: number[]): void => {
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]!); maxX = Math.max(maxX, r[i]!);
      minZ = Math.min(minZ, r[i + 1]!); maxZ = Math.max(maxZ, r[i + 1]!);
    }
  };
  grow(boundary);
  for (const b of buildings) grow(b.outer);

  // OSM buildings superseded by hand-built models (assets-src/floorplans/*/*.source.json → osmReplaces).
  const replaced = new Map<string, string>();
  if (existsSync(FLOORPLANS)) {
    for (const dir of readdirSync(FLOORPLANS)) {
      for (const f of readdirSync(`${FLOORPLANS}/${dir}`).filter((n) => n.endsWith('.source.json'))) {
        const src = JSON.parse(readFileSync(`${FLOORPLANS}/${dir}/${f}`, 'utf8')) as { id: string; osmReplaces?: string[] };
        for (const name of src.osmReplaces ?? []) replaced.set(name, src.id);
      }
    }
  }
  for (const b of buildings) {
    const by = b.name ? replaced.get(b.name) : undefined;
    if (by) b.replacedBy = by;
  }
  if (replaced.size) console.log(`[campus] replaced by hand-built models: ${[...replaced].map(([n, id]) => `${n}→${id}`).join(', ')}`);

  return {
    attribution: '© OpenStreetMap contributors',
    generatedAt: new Date().toISOString(),
    origin,
    bounds: { minX: round2(minX), minZ: round2(minZ), maxX: round2(maxX), maxZ: round2(maxZ) },
    boundary,
    spawn,
    buildings,
    roads,
    fields,
    trees,
  };
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');
  const elements = offline
    ? (JSON.parse(readFileSync(RAW, 'utf8')) as { elements: OsmElement[] }).elements
    : await download();
  const data = convert(elements);
  writeFileSync(OUT, JSON.stringify(data));
  const named = data.buildings.filter((b) => b.name).length;
  const inCampus = data.buildings.filter((b) => b.inCampus).length;
  console.log(`[campus] buildings ${data.buildings.length} (${inCampus} on campus, ${named} named), roads ${data.roads.length}, fields ${data.fields.length}, trees ${data.trees.length / 2}`);
  console.log(`[campus] bounds x ${data.bounds.minX}..${data.bounds.maxX}, z ${data.bounds.minZ}..${data.bounds.maxZ}; boundary ${data.boundary.length / 2} pts`);
  console.log(`[campus] spawn ${data.spawn.label} at (${data.spawn.x}, ${data.spawn.z})`);
  console.log(`[campus] wrote ${OUT} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
