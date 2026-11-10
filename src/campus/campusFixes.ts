import type { CampusData } from './campusTypes';

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
