import type { CampusData } from './campusTypes';

function inRing(x: number, z: number, r: readonly number[]): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** A spot well inside a building's footprint (2.5 m clear of its outline), closest to its centre. */
export function insidePoint(campus: CampusData, name: string): { x: number; z: number } | null {
  const r = campus.buildings.find((b) => b.name === name)?.outer;
  if (!r) return null;
  const xs = r.filter((_, i) => i % 2 === 0), zs = r.filter((_, i) => i % 2 === 1);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  let best: { x: number; z: number; d: number } | null = null;
  for (let dx = -60; dx <= 60; dx += 1.5) for (let dz = -60; dz <= 60; dz += 1.5) {
    const x = cx + dx, z = cz + dz;
    if ([[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].every(([ox, oz]) => inRing(x + ox!, z + oz!, r))) {
      const dd = Math.hypot(dx, dz);
      if (!best || dd < best.d) best = { x, z, d: dd };
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}
