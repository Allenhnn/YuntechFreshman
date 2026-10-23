import { mulberry32 } from '../core/math';
import type { CampusData } from './campusTypes';

const SPACING = 32;
const MAX_COINS = 60;
const COIN_HEIGHT = 0.9;

function pointInRing(x: number, z: number, r: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Coins along on-campus walkways and service roads, evenly spaced, deterministic per dataset. */
export function campusCoinSpots(data: CampusData): [number, number, number][] {
  const candidates: [number, number, number][] = [];
  for (const road of data.roads) {
    if (road.kind !== 'walkway' && road.kind !== 'service') continue;
    const p = road.points;
    let carry = SPACING / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, dx = p[i + 2]! - ax, dz = p[i + 3]! - az;
      const len = Math.hypot(dx, dz);
      let t = carry;
      while (t < len) {
        const x = ax + (dx * t) / len, z = az + (dz * t) / len;
        if (pointInRing(x, z, data.boundary)) candidates.push([x, COIN_HEIGHT, z]);
        t += SPACING;
      }
      carry = t - len;
    }
  }
  // Keep a spread-out subset: shuffle deterministically, then reject coins too close to kept ones.
  const rand = mulberry32(10);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const kept: [number, number, number][] = [];
  for (const c of candidates) {
    if (kept.length >= MAX_COINS) break;
    if (kept.every((k) => Math.hypot(k[0] - c[0], k[2] - c[2]) > SPACING * 0.8)) kept.push(c);
  }
  return kept;
}
