import { mulberry32 } from '../core/math';
import type { CampusData, Ring } from '../campus/campusTypes';

/**
 * Bike stations: random spots beside campus roads, drawn from a fixed seed so every session has
 * them in the same places and players can learn where they are.
 */
export interface BikeStation {
  name: string;
  x: number;
  z: number;
  /** Unit vector along the rack (parallel to the road). */
  ax: number;
  az: number;
  /** Unit vector from the road toward the rack; parked bikes point this way. */
  nx: number;
  nz: number;
}

const SEED = 20261109;
const COUNT = 8;
const MIN_SPACING = 110;
const ROAD_GAP = 2.6;
const BUILDING_CLEARANCE = 5;
const BOUNDARY_CLEARANCE = 6;

export function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function ringDistance(px: number, pz: number, r: Ring): number {
  let d = Infinity;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    d = Math.min(d, segmentDistance(px, pz, r[i * 2]!, r[i * 2 + 1]!, r[j * 2]!, r[j * 2 + 1]!));
  }
  return d;
}

function centroid(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

export function placeBikeStations(campus: CampusData): BikeStation[] {
  const rand = mulberry32(SEED);
  const roads = campus.roads.filter((r) => r.kind !== 'walkway' && r.points.length >= 4);
  const out: BikeStation[] = [];
  for (let attempt = 0; attempt < 6000 && out.length < COUNT && roads.length; attempt++) {
    const road = roads[Math.floor(rand() * roads.length)]!;
    const seg = Math.floor(rand() * (road.points.length / 2 - 1)) * 2;
    const ax = road.points[seg]!, az = road.points[seg + 1]!, bx = road.points[seg + 2]!, bz = road.points[seg + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 10) continue;
    const t = 0.15 + rand() * 0.7;
    const side = rand() < 0.5 ? 1 : -1;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = -uz * side, nz = ux * side;
    const x = ax + (bx - ax) * t + nx * (road.width / 2 + ROAD_GAP);
    const z = az + (bz - az) * t + nz * (road.width / 2 + ROAD_GAP);

    if (!pointInRing(x, z, campus.boundary) || ringDistance(x, z, campus.boundary) < BOUNDARY_CLEARANCE) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < MIN_SPACING)) continue;
    if (campus.buildings.some((b) => pointInRing(x, z, b.outer) || ringDistance(x, z, b.outer) < BUILDING_CLEARANCE)) continue;
    // The pad must not sit on any road (including a neighbouring one) or walkway.
    const onRoad = campus.roads.some((r) => {
      for (let i = 0; i + 3 < r.points.length; i += 2) {
        if (segmentDistance(x, z, r.points[i]!, r.points[i + 1]!, r.points[i + 2]!, r.points[i + 3]!) < r.width / 2 + 2) return true;
      }
      return false;
    });
    if (onRoad) continue;

    let name = '校園';
    let nearest = 160;
    for (const b of campus.buildings) {
      if (!b.name || !b.inCampus) continue;
      const [cx, cz] = centroid(b.outer);
      const d = Math.hypot(cx - x, cz - z);
      if (d < nearest) { nearest = d; name = b.name; }
    }
    out.push({ name: `${name}腳踏車站`, x, z, ax: ux, az: uz, nx, nz });
  }
  return out;
}

/** Square no-tree zones around the stations (campus tree scatter). */
export function stationClearings(stations: readonly BikeStation[]): Ring[] {
  const R = 4.5;
  return stations.map((s) => [s.x - R, s.z - R, s.x + R, s.z - R, s.x + R, s.z + R, s.x - R, s.z + R]);
}

/** Tests whether a point is inside any building footprint (bikes stay outdoors). */
export function createBuildingTest(campus: CampusData): (x: number, z: number) => boolean {
  const boxes = campus.buildings.map((b) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < b.outer.length; i += 2) {
      x0 = Math.min(x0, b.outer[i]!); x1 = Math.max(x1, b.outer[i]!);
      z0 = Math.min(z0, b.outer[i + 1]!); z1 = Math.max(z1, b.outer[i + 1]!);
    }
    return { x0, z0, x1, z1, ring: b.outer };
  });
  return (x, z) => {
    for (const b of boxes) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInRing(x, z, b.ring)) return true;
    }
    return false;
  };
}
