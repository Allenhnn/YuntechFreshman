import type { CampusBuilding, Ring } from '../campus/campusTypes';
import type { BuildingSource, Rect } from '../buildings/buildingTypes';
import { createPlanTransform } from '../buildings/planTransform';

function pointInRing(x: number, z: number, r: Ring): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * A plan-traced interior can span several OSM shells of different heights (學生宿舍C: a 4-storey
 * middle between 3-storey wings, split in campusFixes.ts). Drops the plan cells of every storey that
 * would stick out above the shell it stands in, so no room floats over a lower roof:
 *  - a rect whose centre is inside a shell too low for that storey (and inside no tall-enough shell) goes;
 *  - doors and openings onto a dropped cell go (the room keeps a plain wall there), as do signs in it;
 *  - an elevator landing that went moves to the nearest corridor / lobby cell left on that storey;
 *  - a storey left with no spaces is no longer built.
 * Cells outside every shell (the plan raster's slack at the walls) are kept.
 */
export function clipToShells(src: BuildingSource, shells: readonly CampusBuilding[]): BuildingSource {
  if (shells.length < 2 || new Set(shells.map((s) => s.height)).size < 2) return src;
  const xf = createPlanTransform(src);
  const fh = src.floorHeight;
  for (const level of src.levels) {
    const plan = src.floors[level.id];
    if (!plan) continue;
    const need = level.elevation + fh - 0.1;
    /** -1: in no shell; 0: only in shells too low for this storey; 1: fits. */
    const fit = (x: number, y: number): -1 | 0 | 1 => {
      const [wx, wz] = xf.toWorld(x, y);
      let inAny = false;
      for (const s of shells) {
        if (!pointInRing(wx, wz, s.outer)) continue;
        if (s.height >= need) return 1;
        inAny = true;
      }
      return inAny ? 0 : -1;
    };
    const dropped: Rect[] = [];
    for (const sp of plan.spaces) {
      sp.rects = sp.rects.filter((r) => {
        const keep = fit((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) !== 0;
        if (!keep) dropped.push(r);
        return keep;
      });
    }
    if (!dropped.length) continue;
    plan.spaces = plan.spaces.filter((sp) => sp.rects.length);
    const inDropped = (x: number, y: number): boolean => dropped.some((r) => x >= r[0] - 1e-6 && x <= r[2] + 1e-6 && y >= r[1] - 1e-6 && y <= r[3] + 1e-6);
    // Openings lie on cell borders: test a point a quarter metre to either side of the middle.
    plan.openings = plan.openings.filter((o) => {
      const mx = (o.a[0] + o.b[0]) / 2, my = (o.a[1] + o.b[1]) / 2;
      const ux = o.b[0] - o.a[0], uy = o.b[1] - o.a[1], l = Math.hypot(ux, uy) || 1;
      const nx = (-uy / l) * 0.25, ny = (ux / l) * 0.25;
      return !inDropped(mx + nx, my + ny) && !inDropped(mx - nx, my - ny);
    });
    plan.signs = plan.signs.filter((s) => !inDropped(s.at[0], s.at[1]));
    if (plan.elevator && inDropped(plan.elevator.landing[0], plan.elevator.landing[1])) {
      // The elevator works as a per-storey landing: move it to the nearest corridor / lobby cell left.
      const [lx, ly] = plan.elevator.landing;
      let best: [number, number] | null = null, bestD = Infinity;
      for (const sp of plan.spaces) {
        if (sp.kind !== 'corridor' && sp.kind !== 'lobby') continue;
        for (const r of sp.rects) {
          if (r[2] - r[0] < 1 || r[3] - r[1] < 1) continue; // room to stand
          const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, dd = Math.hypot(cx - lx, cy - ly);
          if (dd < bestD) { bestD = dd; best = [cx, cy]; }
        }
      }
      if (best) plan.elevator = { ...plan.elevator, landing: best };
      else {
        delete plan.elevator;
        level.elevator = false;
      }
    }
    if (!plan.spaces.length) level.built = false;
  }
  return src;
}
