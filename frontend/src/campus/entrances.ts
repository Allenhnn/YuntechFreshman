import { CUSTOM_FACADE_EDGES } from './customFacades';
import type { CampusBuilding, CampusRoad, Ring } from './campusTypes';

/**
 * Which OSM buildings are enterable and where their entrance is. Shared by the chunk worker (door
 * gap in the shell), facade details (canopy above the door) and the interior generator, so all
 * three agree on the same wall and position.
 */
export const DOOR_WIDTH = 2.4;
export const DOOR_HEIGHT = 2.6;
/** Smallest footprint that gets a walkable interior (m²). */
const MIN_INTERIOR_AREA = 30;
const MIN_ENTRANCE_WALL = DOOR_WIDTH + 1.2;

export interface Entrance {
  /** Outer-ring edge index (edge i runs from vertex i to vertex i + 1). */
  edge: number;
  /** Door centre, measured along the edge from vertex i (m). */
  along: number;
}

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2]! * r[j * 2 + 1]! - r[j * 2]! * r[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

/** Campus buildings (not hand-built replacements, not slivers, not sealed) get a generated interior. */
export function hasInterior(b: CampusBuilding): boolean {
  return enterableShape(b) && !b.sealed;
}

/** Would be enterable if it were open: where a sealed building still shows its (closed) doors. */
export function enterableShape(b: CampusBuilding): boolean {
  return b.inCampus && !b.replacedBy && ringArea(b.outer) >= MIN_INTERIOR_AREA;
}

/**
 * Entrance on the wall that faces the nearest road (walkways count less), else the longest wall.
 * Photo walls are skipped so the door never cuts through a photographed facade.
 */
export function buildingEntrance(b: CampusBuilding, roads: readonly CampusRoad[], photoEdges: ReadonlySet<number> = new Set()): Entrance | null {
  const r = b.outer;
  const n = r.length / 2;
  const custom = CUSTOM_FACADE_EDGES[b.id];
  let best = -1, bestScore = Infinity, longest = -1, longestLen = 0;
  for (let i = 0; i < n; i++) {
    if (photoEdges.has(i) || custom?.includes(i)) continue; // photo walls and hand-built facades keep their wall
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!, dx = r[j * 2]! - px, dz = r[j * 2 + 1]! - pz;
    const len = Math.hypot(dx, dz);
    if (len < MIN_ENTRANCE_WALL) continue;
    if (len > longestLen) { longestLen = len; longest = i; }
    // Outer rings are CCW in x/z, so (dz, -dx) points out of the building.
    const nx = dz / len, nz = -dx / len;
    const mx = px + dx / 2, mz = pz + dz / 2;
    for (const road of roads) {
      const weight = road.kind === 'walkway' ? 1.6 : 1;
      for (let k = 0; k + 3 < road.points.length; k += 2) {
        const ax = road.points[k]!, az = road.points[k + 1]!, sx = road.points[k + 2]! - ax, sz = road.points[k + 3]! - az;
        const t = Math.max(0, Math.min(1, ((mx - ax) * sx + (mz - az) * sz) / (sx * sx + sz * sz || 1)));
        const qx = ax + sx * t - mx, qz = az + sz * t - mz;
        const d = Math.hypot(qx, qz);
        // Only roads in front of the wall count, and a longer wall is a likelier main entrance.
        if (d > 70 || qx * nx + qz * nz < d * 0.5) continue;
        const score = d * weight - Math.min(len, 30) * 0.3;
        if (score < bestScore) { bestScore = score; best = i; }
      }
    }
  }
  const edge = best >= 0 ? best : longest;
  if (edge < 0) return null;
  const j = (edge + 1) % n;
  return { edge, along: Math.hypot(r[j * 2]! - r[edge * 2]!, r[j * 2 + 1]! - r[edge * 2 + 1]!) / 2 };
}
