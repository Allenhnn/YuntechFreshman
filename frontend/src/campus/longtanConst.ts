/** 龍潭路: name in the OSM data and the size of its raised sidewalks (shared with the chunk worker). */
export const LONGTAN = '龍潭路';
export const SIDEWALK_W = 2.5;
export const KERB_H = 0.15;

/** The east–west 龍潭路 (not its branch heading south past 警衛室): the stretch with sidewalks and street trees. */
export function isLongtanMain(road: { name?: string; points: readonly number[] }): boolean {
  if (road.name !== LONGTAN) return false;
  const p = road.points;
  let dx = 0, dz = 0;
  for (let i = 0; i + 3 < p.length; i += 2) { dx += Math.abs(p[i + 2]! - p[i]!); dz += Math.abs(p[i + 3]! - p[i + 1]!); }
  return dx > dz;
}
