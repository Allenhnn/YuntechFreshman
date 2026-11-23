import type { GeoBuilder } from './chunkBuilder';
import type { CampusBuilding } from './campusTypes';

export const STUDENT_CENTRE = 296668597;
export const PERFORMANCE_HALL = 296668624;
export const ACTIVITY_COURT_RING = [128.18,168.83,93.01,175.11,86.95,151.68,123.68,144.81];

type Point = [number, number, number];
type Tint = readonly [number, number, number];
const concrete: Tint = [0.44, 0.43, 0.39];
const edge: Tint = [0.32, 0.31, 0.28];
const steel: Tint = [0.19, 0.20, 0.19];
const metal: Tint = [0.55, 0.56, 0.52];

/** Local x along a surveyed wall, z out toward the plaza, y above grade. */
function frame(x: number, z: number, endX: number, endZ: number) {
  const length = Math.hypot(endX - x, endZ - z);
  const dx = (endX - x) / length, dz = (endZ - z) / length;
  return (a: number, y: number, o: number): Point => [x + a * dx + o * dz, y, z + a * dz - o * dx];
}

function quad(g: GeoBuilder, points: Point[], color: Tint) {
  const [a, b, c] = points as [Point, Point, Point, Point];
  const u = b.map((v, i) => v - a[i]!), v = c.map((n, i) => n - a[i]!);
  const nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!;
  const len = Math.hypot(nx, ny, nz);
  const ids = points.map(([x, y, z]) => g.vertex(x, y, z, nx / len, ny / len, nz / len, 0, 0, color));
  g.tri(ids[0]!, ids[1]!, ids[2]!);
  g.tri(ids[0]!, ids[2]!, ids[3]!);
}

/** Sloped rectangular section. Heights are specified at its two depth edges. */
function section(g: GeoBuilder, at: ReturnType<typeof frame>, x0: number, x1: number,
  z0: number, z1: number, low0: number, low1: number, height: number, color: Tint) {
  const bottom = [at(x0, low0, z0), at(x1, low0, z0), at(x1, low1, z1), at(x0, low1, z1)];
  const top = bottom.map(([x,y,z]): Point => [x,y + height,z]);
  quad(g, top, color);
  quad(g, [...bottom].reverse(), color);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(g, [bottom[i]!, bottom[j]!, top[j]!, top[i]!], color);
  }
}

export function buildActivityComplex(b: CampusBuilding, solid: GeoBuilder, glass: GeoBuilder) {
  const centre = b.id === STUDENT_CENTRE;
  // The centre's open court spans its old east wing to the shared hall wall.
  const at = centre ? frame(128.18,168.83,93.01,175.11) : frame(181.09,123.37,187.55,164.46);
  const box = (x0: number,x1: number,z0: number,z1: number,y: number,h: number,c: Tint = concrete) =>
    section(solid, at, x0,x1,z0,z1,y,y,h,c);
  if (centre) {
    // Photos 14–16 and 23–26: two open ends, galleries down the sides,
    // overhead bridges and a glazed ridge visible from inside the court.
    for (const x of [1, 32]) {
      for (const z of [-22,-13,-4]) box(x,x+.65,z,z+.65,0,10.8);
      for (const y of [3.6,7.2]) {
        box(x-1,x+2.6,-24,0,y-.32,.32);
        const inner = x < 10 ? x+2.4 : x-1;
        box(inner,inner+.16,-24,0,y,.95,edge);
      }
    }
    for (const z of [-23.6,-2.4]) {
      box(.1,35.5,z,z+2.3,6.8,.4);
      box(.1,35.5,z,z+.2,7.2,.95,edge);
      box(.1,35.5,z+2.1,z+2.3,7.2,.95,edge);
    }
    for (const [z0,z1,h0,h1] of [[-24,-12,10.8,14],[-12,0,14,10.8]] as const) {
      section(glass,at,.1,35.5,z0,z1,h0,h1,.06,metal);
      for (let x=0; x<=35; x+=5) section(solid,at,x,x+.23,z0,z1,h0-.34,h1-.34,.34,steel);
      for (let k=0; k<4; k++) {
        const z=z0+(z1-z0)*k/4, h=h0+(h1-h0)*k/4;
        box(.1,35.5,z,z+.12,h-.1,.13,steel);
      }
    }
    // Broad pond-side entrance steps and a raised viewing landing; the
    // flanking bays remain level with the plaza for step-free passage.
    for (let i=0; i<6; i++) box(9,26,2.8-i*.45,3.25-i*.45,0,(i+1)*.15);
    box(9,26,-2,.55,0,.9);
    for (let i=0; i<5; i++) box(9,26,-2.45-i*.45,-2-i*.45,0,(5-i)*.15);
  } else {
    // Photos 40–44: the east return has a concrete flight against the
    // solid auditorium wall, a projecting landing, and pale metal rails.
    const count=22, tread=.33, rise=3.6/count, start=10;
    for (let i=0; i<count; i++) {
      const x=start+i*tread, y=(i+1)*rise;
      box(x,x+tread,.05,2.85,0,y);
      if (i%3===0) box(x,x+.06,2.75,2.82,y,1,metal);
    }
    const end=start+count*tread;
    // Reorient the frame so the rail slopes continuously along the flight.
    const [sx,,sz]=at(start,0,0), [ex,,ez]=at(start,0,1);
    const stairFrame=frame(sx,sz,ex,ez);
    for (const h of [.52,1]) section(solid,stairFrame,2.75,2.82,-count*tread,0,3.6+h,h,.06,metal);
    box(end,end+3.5,.02,2.85,3.32,.28);
    box(end+.6,end+2.9,0,.10,3.6,2.35,steel);
    box(end+1.72,end+1.79,.10,.14,3.6,2.35,metal);
    for (const x of [end,end+1.7,end+3.44]) box(x,x+.06,2.75,2.82,3.6,1,metal);
    for (const y of [4.12,4.6]) box(end,end+3.5,2.75,2.82,y,.06,metal);
    box(end+3.44,end+3.5,.12,2.82,3.6,1,edge);
  }
}
