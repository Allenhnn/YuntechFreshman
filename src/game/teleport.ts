import type { CampusData, Ring } from '../campus/campusTypes';

/** How far outside a wall a teleport lands when the target is inside a solid OSM building (m). */
const OUTSIDE_MARGIN = 1.5;

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Teleport target on the ground plane. OSM extrusions are solid (no interior), so a point inside
 * one moves to the nearest point on its outline, pushed outward. Hand-built buildings
 * (`replacedBy`) have walkable interiors and are left alone.
 */
export function safeTeleportTarget(campus: CampusData, x: number, z: number): { x: number; z: number; outsideOf: string | null } {
  for (const b of campus.buildings) {
    if (b.replacedBy || !pointInRing(x, z, b.outer)) continue;
    if (b.holes.some((h) => pointInRing(x, z, h))) continue; // courtyard
    const r = b.outer;
    const n = r.length / 2;
    let best = { d: Infinity, x, z, nx: 0, nz: 0 };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2]!, az = r[i * 2 + 1]!, bx = r[j * 2]!, bz = r[j * 2 + 1]!;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len)));
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      // Outer rings are CCW in x/z, so (dz, -dx) points out of the building.
      if (d < best.d) best = { d, x: px, z: pz, nx: dz / len, nz: -dx / len };
    }
    return { x: best.x + best.nx * OUTSIDE_MARGIN, z: best.z + best.nz * OUTSIDE_MARGIN, outsideOf: b.name ?? '建築' };
  }
  return { x, z, outsideOf: null };
}
