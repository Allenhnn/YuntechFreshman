import { smoothstep } from '../core/math';

/**
 * Test-campus layout shared by collision, rendering and tree scattering.
 * Keep the plaza / track constants in sync with shaders/ground/ground_pars.frag.glsl.
 */
export const PLAZA_RADIUS = 16;
export const TRACK = { ax: -18, bx: 18, z: -36, radius: 10, halfWidth: 2.5 } as const;

/** Terrain height: flat play area, rolling hills ringing the boundary. */
export function terrainHeight(x: number, z: number): number {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rise = smoothstep(48, 62, edge);
  return rise * (7 + 1.5 * Math.sin(x * 0.15) * Math.cos(z * 0.13));
}

export function distanceToTrackCenterline(x: number, z: number): number {
  const cx = Math.min(Math.max(x, TRACK.ax), TRACK.bx);
  return Math.hypot(x - cx, z - TRACK.z) - TRACK.radius;
}

/** Axis-aligned keep-out rectangles for scattering props (minX, minZ, maxX, maxZ). */
export const KEEP_OUT: readonly (readonly [number, number, number, number])[] = [
  [16, -6, 42, 21], // east test zone (ramps / stairs)
  [-42, -6, -16, 16], // west test zone (platforms)
  [-36, 28, 42, 48], // buildings
  [-3, -26, 3, -12], // north path
  [-3, 12, 3, 30], // south path
];

/** Campus paths (segment endpoints + half width). Keep in sync with ground_pars.frag.glsl. */
export const PATHS: readonly { ax: number; az: number; bx: number; bz: number; halfWidth: number }[] = [
  { ax: 0, az: -12, bx: 0, bz: -23.5, halfWidth: 1.6 },
  { ax: 12, az: 0, bx: 40, bz: 4, halfWidth: 1.6 },
  { ax: -12, az: 0, bx: -40, bz: 4, halfWidth: 1.6 },
  { ax: 0, az: 12, bx: 0, bz: 30, halfWidth: 2.2 },
];

/** Coin spots [x, y, z]: y is the coin centre. Some reward the movement tests (ramp top, pillars). */
export function coinSpots(): [number, number, number][] {
  const spots: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    spots.push([Math.cos(a) * 12, 0.7, Math.sin(a) * 12]);
  }
  // Running track lane centre: both straights and both bends.
  for (const x of [-10, 0, 10]) {
    spots.push([x, 0.7, TRACK.z - TRACK.radius]);
    spots.push([x, 0.7, TRACK.z + TRACK.radius]);
  }
  spots.push([TRACK.ax - TRACK.radius, 0.7, TRACK.z], [TRACK.bx + TRACK.radius, 0.7, TRACK.z]);
  spots.push([29.4, 4.1, 10]); // top of the 20° ramp platform
  spots.push([25.5, 2.7, 0]); // top of the stairs
  for (let i = 0; i < 4; i++) spots.push([-20 - i * 3, 1 + i + 0.7, 6]); // pillar staircase
  spots.push([-22, 2.9, -2]); // on the unreachable 2.2 m block: a teaser
  return spots;
}
