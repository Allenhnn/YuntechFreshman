import type { GeoBuilder } from './chunkBuilder';
import type { CampusBuilding } from './campusTypes';

export const STUDENT_CENTRE = 296668597;
export const PERFORMANCE_HALL = 296668624;
export const ACTIVITY_COURT_RING = [128.18,168.83,93.01,175.11,86.95,151.68,123.68,144.81];

// Keep procedurally scattered trees out of the photographed north forecourt.
export const ACTIVITY_FORECOURT_RING = [-2, 38].flatMap((x, i) =>
  (i === 0 ? [-50, -24] : [-24, -50]).flatMap(z => {
    const [wx, , wz] = frame(128.18,168.83,93.01,175.11)(x,0,z);
    return [wx,wz];
  }));

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
    // North facade: exposed coffered soffit, illustrated fascia and square piers.
    const sand: Tint = [.47,.405,.31], shadow: Tint = [.25,.22,.18];
    box(.1,35.5,-28.8,-21.8,9.53,.24,sand);
    box(.1,35.5,-28.8,-28.42,8.7,1.55,sand);
    for (let bay=0; bay<=12; bay++) {
      const x=.2+bay*2.9;
      box(x,x+.28,-28.5,-21.8,8.94,.6,sand);
    }
    for (const z of [-26.2,-23.8]) box(.1,35.5,z,z+.22,9.15,.41,sand);
    for (const x of [2,11.6,23.7,33]) {
      box(x,x+.65,-25.1,-24.35,0,9.54,shadow);
      box(x-.42,x+1.07,-26.2,-23.5,8.64,.38,sand);
    }
    // The triangular glass gable presents its end to the entrance.
    const roofAt = (a:number,y:number,o:number) => at(o,y,-a);
    for (const [x0,x1,h0,h1] of [[8.5,17.8,10.1,13.55],[17.8,27.1,13.55,10.1]] as const) {
      // Short entrance gable in front of the transverse atrium lantern.
      section(glass,roofAt,20,23.5,x0,x1,h0,h1,.07,metal);
      section(solid,roofAt,23.3,23.5,x0,x1,h0-.2,h1-.2,.21,steel);
      for(let k=0;k<5;k++) {
        const x=x0+(x1-x0)*k/5, h=h0+(h1-h0)*k/5;
        box(x,x+.08,-23.5,-20,h-.08,.12,steel);
        if(h>10.2) box(x,x+.08,-23.55,-23.43,10.07,h-10.07,steel);
      }
    }
    for(const [a,b] of [[.1,8.5],[27.1,35.5]] as const) box(a,b,-23.5,-20,9.85,.28,sand);
    box(.1,35.5,-3,0,9.85,.28,sand);
    for(const [z0,z1,h0,h1] of [[-20,-11.5,10.7,13.45],[-11.5,-3,13.45,10.7]] as const) {
      section(glass,at,.1,35.5,z0,z1,h0,h1,.07,metal);
      for(let x=.2;x<35.5;x+=1.75) section(solid,at,x,x+.085,z0,z1,h0-.1,h1-.1,.11,steel);
      for(let k=0;k<5;k++) {
        const z=z0+(z1-z0)*k/5, h=h0+(h1-h0)*k/5;
        box(.1,35.5,z,z+.085,h-.1,.11,steel);
      }
    }
    for(const z of [-20,-3]) {
      section(glass,at,.1,35.5,z,z+.045,9.3,9.3,1.4,metal);
      for(let x=.25;x<35.5;x+=1.75) box(x,x+.09,z-.05,z+.07,9.3,1.4,steel);
    }
    // Ceiling and column lines over the two covered ends of the level hall.
    for(const [a,b] of [[.1,6],[28,35.7]] as const) box(a,b,-20,-3,6.82,.38,concrete);
    // Backing wall and fixed display doors by room 107 (plan right).
    box(35.47,35.8,-11.55,-4.05,1.125,3.5,concrete);
    for(const x of [6,25.5]) {
      box(x,x+2.3,-2.15,-1.55,1.46,.12,[.36,.24,.15]);
      for(const offset of [.18,1.9]) box(x+offset,x+offset+.17,-2.1,-1.6,1.125,.34,edge);
    }
    // Shadowed square openings in the two high concrete returns framing the sign.
    for (const x of [.1,31.9]) {
      box(x,x+3.6,-27,-22.5,9.8,.72);
      box(x,x+.75,-27,-22.5,10.52,1.4);
      box(x+2.65,x+3.6,-27,-22.5,10.52,1.4);
      box(x,x+3.6,-27,-22.5,11.92,.62);
    }
    // North-west stair tower. Its projecting balcony screens the recessed
    // stair from the plaza; the lower flight climbs left, then turns indoors.
    const strip = (x0:number,x1:number,z0:number,z1:number,depth:number,y:number,h:number,c:Tint) => {
      const bottom=[at(x0,y,z0),at(x1,y,z1),at(x1,y,z1+depth),at(x0,y,z0+depth)];
      const top=bottom.map(([x,base,z]):Point=>[x,base+h,z]);
      quad(solid,top,c); quad(solid,[...bottom].reverse(),c);
      for(let i=0;i<4;i++) {
        const j=(i+1)%4;
        quad(solid,[bottom[i]!,bottom[j]!,top[j]!,top[i]!],c);
      }
    };
    const front = (x:number) => {
      const t=Math.min(1,(x-32.5)/3);
      return -28.8-2.7*Math.sqrt(Math.max(0,1-(1-t)*(1-t)));
    };
    for(let i=0;i<18;i++) {
      const x=32.5+i*.5, next=x+.5, z=front(x), end=front(next);
      strip(x,next,z,end,1.05,3.28,.32,concrete);
      strip(x,next,z,end,.18,3.6,.61,concrete);
      for(const y of [4.31,4.53]) strip(x,next,z+.05,end+.05,.055,y,.055,steel);
      if(i%3===0) box(x,x+.055,z+.05,z+.11,4.21,.37,steel);
      strip(x,next,z,end,3.9,7.42,.4,concrete);
    }
    box(32.5,33.45,-29.5,-22.4,3.28,.32);
    box(39.9,41.5,-30.55,-28.7,3.28,.32);
    // Square opening cut through the high front wall, with deep reveals.
    const face=-30.0, back=-27.5;
    box(33.6,41.5,face,back,7.82,1.64);
    box(33.6,36.1,face,back,9.46,1.85);
    box(38.0,41.5,face,back,9.46,1.85);
    box(33.6,41.5,face,back,11.31,1.05);
    box(33.6,41.5,face+.04,-24.6,12.36,.16,edge);
    // Recessed walls behind the open balcony mouth, against the adjoining wing.
    box(36.55,40.65,-27.05,-26.77,0,7.43,edge);
    box(40.75,41.5,-31.4,-27.0,0,7.82,concrete);
    box(36.55,37.10,-27.55,-27.05,4.4,.1,steel);
    box(36.57,37.08,-27.52,-27.08,4.35,.05,[.8,.79,.64]);
    // Both flights have equal risers and share a level quarter-turn landing.
    const rise=3.6/22;
    for(let i=0;i<10;i++) {
      const x=39.55-(i+1)*.32;
      box(x,x+.32,-30.35,-28.7,0,(i+1)*rise,edge);
    }
    box(34.65,36.35,-30.35,-27.1,0,10*rise,edge);
    for(let i=0;i<12;i++) {
      const z=-27.1+i*.35;
      box(34.65,36.35,z,z+.35,0,(11+i)*rise,edge);
    }
    box(32.6,36.35,-22.9,-21.85,3.28,.32);
    const [sx,,sz]=at(39.55,0,-28.7), [ex,,ez]=at(39.55,0,-27.7);
    const railFrame=frame(sx,sz,ex,ez);
    section(solid,railFrame,0,.065,0,3.2,.99,10*rise+.91,.06,metal);
    section(solid,at,36.27,36.34,-27.1,-22.9,10*rise+.97,4.51,.06,metal);
    for(const i of [0,4,8]) {
      const x=39.55-(i+.5)*.32;
      box(x,x+.05,-28.7,-28.64,(i+1)*rise,.89,metal);
    }
    for(const i of [0,5,11]) {
      const z=-27.1+(i+.5)*.35;
      box(36.27,36.33,z,z+.05,(11+i)*rise,.91,metal);
    }
    // Central stair, level side bypasses and the paired stepped planting beds.
    for (let i=0;i<7;i++) box(12.5,23.5,-30.9+i*.43,-30.47+i*.43,.075,(i+1)*.15,edge);
    // Both exterior stairs terminate on one continuous first-floor platform.
    box(1.8,32.5,-27.89,.55,0,1.125,concrete);
    box(32.5,35.8,-20,-3,0,1.125,concrete);
    section(solid,at,.15,1.8,-27.89,-14.9,0,1.05,.075,edge);
    box(.15,1.8,-14.9,.55,0,1.125,concrete);
    for(const x of [1.6,24.1]) {
      box(x,x+10.1,-29.4,-26.1,.08,.65);
      box(x+.15,x+9.95,-28.85,-26.3,.73,.52);
      box(x+.24,x+9.86,-28.65,-26.45,1.25,.28,[.12,.17,.064]);
    }
    for(const x of [12.45,23.45]) {
      section(solid,at,x,x+.065,-30.78,-27.9,1.08,2.07,.065,metal);
      for(const [z,y] of [[-30.7,.23],[-29.35,.68],[-27.95,1.08]]) box(x,x+.065,z,z+.065,y,.91,metal);
    }
    for (let i=0; i<6; i++) box(9,26,2.8-i*.45,3.25-i*.45,0,(i+1)*1.125/6,edge);
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
