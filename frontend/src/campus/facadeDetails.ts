import { mulberry32 } from '../core/math';
import type { CampusBuilding, CampusRoad, Ring } from './campusTypes';
import type { FacadeStyle } from './facadeTypes';
import { DOOR_WIDTH, buildingEntrance, type Entrance } from './entrances';
import type { GeoBuilder } from './chunkBuilder';

/**
 * 3D facade details for OSM extrusions (balconies, sunshades, pilasters, entrance canopy,
 * parapet, rooftop clutter), generated from the building's facade style. Everything is plain
 * boxes in wall space, merged into one mesh per chunk; none of it collides (B2: simplified
 * collision keeps the player sliding along the flat wall).
 */
type RGB = readonly [number, number, number];

export interface DetailColors {
  wall: RGB;
  trim: RGB;
}

/** Walls shorter than this get no wall details (corners, jogs). */
const MIN_WALL = 3;
const SLAB = 0.15;
const RAIL_H = 1.0;
const RAIL_T = 0.1;
const COLUMN_W = 0.5;
const COLUMN_D = 0.35;
const FIN_T = 0.12;
const PARAPET_T = 0.25;
const GREY: RGB = [0.42, 0.44, 0.45];
const TANK: RGB = [0.62, 0.64, 0.62];

/** Wall frame: origin at the edge start, `d` along the wall, `n` outward, y up. */
interface WallFrame {
  px: number; pz: number;
  dx: number; dz: number;
  nx: number; nz: number;
  len: number;
}

/** Box in wall space: [a0, a1] along, [o0, o1] outward, [y0, y1] up. */
function wallBox(g: GeoBuilder, w: WallFrame, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, c: RGB): void {
  if (a1 - a0 < 1e-3 || o1 - o0 < 1e-3 || y1 - y0 < 1e-3) return;
  const P = (a: number, o: number): [number, number] => [w.px + w.dx * a + w.nx * o, w.pz + w.dz * a + w.nz * o];
  // Emits a quad facing (nx, ny, nz): the winding is flipped if needed so it is CCW from that side.
  const quad = (pts: [number, number, number][], nx: number, ny: number, nz: number): void => {
    const [p0, p1, p2] = pts as [[number, number, number], [number, number, number], [number, number, number]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const facing = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    const ordered = facing >= 0 ? pts : pts.slice().reverse();
    const i = ordered.map(([x, y, z]) => g.vertex(x, y, z, nx, ny, nz, 0, 0, c));
    g.tri(i[0]!, i[1]!, i[2]!);
    g.tri(i[0]!, i[2]!, i[3]!);
  };
  const [ax, az] = P(a0, o0), [bx, bz] = P(a1, o0), [cx, cz] = P(a1, o1), [dx, dz] = P(a0, o1);
  quad([[dx, y0, dz], [cx, y0, cz], [cx, y1, cz], [dx, y1, dz]], w.nx, 0, w.nz); // front (outward)
  quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], -w.nx, 0, -w.nz); // back (toward the wall)
  quad([[ax, y0, az], [ax, y1, az], [dx, y1, dz], [dx, y0, dz]], -w.dx, 0, -w.dz); // start side
  quad([[bx, y0, bz], [bx, y1, bz], [cx, y1, cz], [cx, y0, cz]], w.dx, 0, w.dz); // end side
  quad([[ax, y1, az], [bx, y1, bz], [cx, y1, cz], [dx, y1, dz]], 0, 1, 0); // top
  quad([[ax, y0, az], [bx, y0, bz], [cx, y0, cz], [dx, y0, dz]], 0, -1, 0); // underside (balconies are seen from below)
}

/** Axis-aligned box on the roof (x/z centre, half sizes, base y). */
function roofBox(g: GeoBuilder, x: number, z: number, hx: number, hz: number, y0: number, h: number, yaw: number, c: RGB): void {
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  const w: WallFrame = { px: x - dx * hx + dz * hz, pz: z - dz * hx - dx * hz, dx, dz, nx: -dz, nz: dx, len: hx * 2 };
  wallBox(g, w, 0, hx * 2, 0, hz * 2, y0, y0 + h, c);
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function walls(r: Ring): WallFrame[] {
  const out: WallFrame[] = [];
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!;
    const dx = r[j * 2]! - px, dz = r[j * 2 + 1]! - pz;
    const len = Math.hypot(dx, dz);
    // Outer rings are CCW in x/z, so (dz, -dx) points out of the building.
    out.push({ px, pz, dx: dx / (len || 1), dz: dz / (len || 1), nx: dz / (len || 1), nz: -dx / (len || 1), len });
  }
  return out;
}

/**
 * Appends one building's details to `g`. `skipEdges` are walls covered by photos (their real
 * balconies are in the image already), `floors` / `height` match the extrusion.
 */
export function addFacadeDetails(
  g: GeoBuilder,
  b: CampusBuilding,
  style: FacadeStyle,
  colors: DetailColors,
  roads: readonly CampusRoad[],
  skipEdges: ReadonlySet<number>,
  doors: readonly Entrance[] = [],
): void {
  const floors = Math.max(1, b.levels || Math.round(b.height / 3.6));
  const fh = b.height / floors;
  const ws = walls(b.outer);
  // The two Lotus Pond buildings meet at the east end of the student centre.
  // Edge indices follow the surveyed campus footprints, with outward depth positive.
  if (b.id === 296668597) {
    const court = ws[1]!;
    const depth = 3.8;
    for (const y of [fh, 2 * fh, b.height]) {
      wallBox(g, court, 0, court.len, 0, depth, y - 0.35, y, colors.wall);
      wallBox(g, court, 0, court.len, depth - 0.22, depth, y, y + 0.7, colors.trim);
    }
    for (let bay = 0; bay <= 6; bay++) {
      const a = 0.4 + (court.len - 0.8) * bay / 6;
      wallBox(g, court, a - 0.32, a + 0.32, depth - 0.7, depth, 0, b.height, colors.wall);
    }
    // Raised pitched skylight above the central circulation hall.
    const run = 5;
    const rise = 2.4;
    for (const side of [-1, 1]) {
      const slope = side * rise / run;
      const norm = Math.hypot(1, slope);
      const vertex = (a: number, offset: number, lift: number, color: RGB) => {
        const o = -12 + side * offset;
        return g.vertex(court.px + court.dx * a + court.nx * o,
          b.height + rise * (1 - offset / run) + lift, court.pz + court.dz * a + court.nz * o,
          court.nx * slope / norm, 1 / norm, court.nz * slope / norm, 0, 0, color);
      };
      const panel = (a: number, end: number, lift: number, color: RGB) => {
        const v = [vertex(a, 0, lift, color), vertex(end, 0, lift, color),
          vertex(end, run, lift, color), vertex(a, run, lift, color)];
        if (side < 0) v.reverse();
        g.tri(v[0]!, v[1]!, v[2]!);
        g.tri(v[0]!, v[2]!, v[3]!);
      };
      panel(3, court.len - 3, 0.04, [0.35, 0.43, 0.45]);
      for (let a = 3; a < court.len - 3; a += 2) panel(a, a + 0.12, 0.08, colors.trim);
    }
  }
  if (b.id === 296668624) {
    // The upper glazed gallery follows the faceted curve toward Lotus Pond.
    for (let edge = 12; edge <= 22; edge++) {
      const w = ws[edge]!;
      wallBox(g, w, 0, w.len, 0, 0.16, fh, 2 * fh, [0.10, 0.15, 0.16]);
      for (const y of [fh, fh * 1.72, 2 * fh]) {
        wallBox(g, w, 0, w.len, 0.16, 0.23, y, y + 0.12, colors.trim);
      }
      const panes = Math.ceil(w.len / 1.4);
      for (let p = 0; p < panes; p++) {
        const a = p * w.len / panes;
        wallBox(g, w, a, a + 0.09, 0.16, 0.23, fh, 2 * fh, colors.trim);
      }
      wallBox(g, w, 0, w.len, 0, 1.2, fh - 0.3, fh, colors.wall);
    }
  }
  const longest = Math.max(...ws.map((w) => w.len));
  const rand = mulberry32(Math.abs(b.id) >>> 0);

  ws.forEach((w, i) => {
    if (w.len < MIN_WALL) return;
    // Parapet runs on every wall, photo or not (it sits above the photo's top edge).
    if (style.parapet > 0) wallBox(g, w, 0, w.len, -PARAPET_T, 0, b.height, b.height + style.parapet, colors.trim);
    if (skipEdges.has(i)) return;
    const bays = Math.max(1, Math.round(w.len / style.bay));
    const bw = w.len / bays;
    const winTop = (style.sill + style.win[1]) * fh;
    const halfWin = (bw * style.win[0]) / 2;

    if (style.columns) {
      for (let k = 0; k <= bays; k++) {
        const a = k * bw;
        if (doors.some((d) => d.edge === i && Math.abs(a - d.along) < DOOR_WIDTH / 2 + COLUMN_W)) continue; // keep doorways clear
        wallBox(g, w, Math.max(0, a - COLUMN_W / 2), Math.min(w.len, a + COLUMN_W / 2), 0, COLUMN_D, 0, b.height, colors.trim);
      }
    }
    if (style.fins === 'horizontal' || style.fins === 'both') {
      for (let f = style.groundGlass ? 1 : 0; f < floors; f++) {
        const y = f * fh + winTop;
        wallBox(g, w, 0, w.len, 0, style.finDepth, y, y + FIN_T, colors.trim);
      }
    }
    if ((style.fins === 'vertical' || style.fins === 'both') && style.pattern !== 'blank') {
      for (let k = 0; k < bays; k++) {
        const c = (k + 0.5) * bw;
        for (const a of style.pattern === 'punched' ? [c - halfWin, c + halfWin] : [k * bw]) {
          wallBox(g, w, Math.max(0, a - FIN_T / 2), Math.min(w.len, a + FIN_T / 2), 0, style.finDepth, fh, b.height, colors.trim);
        }
      }
    }
    // Balconies only on the long walls (the façades people actually see from the paths).
    if (style.balcony !== 'none' && floors > 1 && w.len >= Math.max(6, longest * 0.5)) {
      const depth = style.balconyDepth;
      const spans: [number, number][] = style.balcony === 'continuous'
        ? [[0.3, w.len - 0.3]]
        : Array.from({ length: bays }, (_, k) => [k * bw + 0.35, (k + 1) * bw - 0.35] as [number, number]);
      for (let f = 1; f < floors; f++) {
        const y = f * fh;
        for (const [a0, a1] of spans) {
          // Slab in the wall colour, balustrade in the trim colour so it reads against the wall behind.
          wallBox(g, w, a0, a1, 0, depth, y - SLAB, y, colors.wall);
          wallBox(g, w, a0, a1, depth - RAIL_T, depth, y, y + RAIL_H, colors.trim);
          wallBox(g, w, a0, a0 + RAIL_T, 0, depth - RAIL_T, y, y + RAIL_H, colors.trim);
          wallBox(g, w, a1 - RAIL_T, a1, 0, depth - RAIL_T, y, y + RAIL_H, colors.trim);
        }
      }
    }
  });

  // Canopy over the entrance (or, for buildings without an interior, the wall facing the nearest road).
  const entrance = doors[0] ?? (style.canopy ? buildingEntrance(b, roads, skipEdges) : null);
  if (style.canopy && entrance) {
    const w = ws[entrance.edge];
    if (w && w.len >= 6) {
      const mid = entrance.along;
      const half = Math.min(3, mid - 0.3, w.len - mid - 0.3);
      const y = Math.min(3.2, fh * 0.85);
      wallBox(g, w, mid - half, mid + half, 0, 3, y, y + 0.25, colors.trim);
      for (const a of [mid - half + 0.15, mid + half - 0.3]) wallBox(g, w, a, a + 0.15, 2.7, 2.85, 0, y, colors.trim);
    }
  }

  if (style.rooftop) {
    // Stair bulkhead, water tank on legs and a row of AC units, placed where they fit on the roof.
    const xs = b.outer.filter((_, k) => k % 2 === 0), zs = b.outer.filter((_, k) => k % 2 === 1);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const longW = ws.reduce((a, w) => (w.len > a.len ? w : a));
    const yaw = Math.atan2(longW.dz, longW.dx);
    const fits = (x: number, z: number, r: number): boolean =>
      [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([ox, oz]) => pointInRing(x + ox!, z + oz!, b.outer));
    const place = (r: number): [number, number] | null => {
      for (let t = 0; t < 12; t++) {
        const x = minX + (maxX - minX) * (0.2 + rand() * 0.6), z = minZ + (maxZ - minZ) * (0.2 + rand() * 0.6);
        if (fits(x, z, r + 1)) return [x, z];
      }
      return null;
    };
    const top = b.height;
    const stair = place(2.5);
    if (stair) roofBox(g, stair[0], stair[1], 2.5, 1.8, top, 2.8, yaw, colors.wall);
    const tank = place(1.2);
    if (tank) {
      roofBox(g, tank[0], tank[1], 1.1, 1.1, top + 0.8, 1.6, yaw, TANK);
      roofBox(g, tank[0], tank[1], 0.9, 0.9, top, 0.8, yaw + Math.PI / 4, GREY);
    }
    const ac = place(1.5);
    if (ac) for (let k = -1; k <= 1; k++) roofBox(g, ac[0] + Math.cos(yaw) * k * 1.3, ac[1] + Math.sin(yaw) * k * 1.3, 0.5, 0.4, top, 0.9, yaw, GREY);
  }
}
