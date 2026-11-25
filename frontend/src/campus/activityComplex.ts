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
      for (const z of (x === 1 ? [-4] : [-22,-13,-4])) box(x,x+.65,z,z+.65,0,10.8);
      for (const y of [3.6,7.2]) {
        if (x === 1 && y === 3.6) {
          // Leave headroom over the first treads of the inset return stair.
          box(-1.3,3.6,-22.5,0,y-.32,.32);
          box(-1.3,1.25,-24,-22.5,y-.32,.32);
        } else box(x-1,x+2.6,-24,0,y-.32,.32);
        const inner = x < 10 ? x+2.4 : x-1;
        box(inner,inner+.16,x === 1 && y === 3.6 ? -22.5 : -24,0,y,.95,edge);
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
      if (x !== 2) box(x,x+.65,-25.1,-24.35,0,9.54,shadow);
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
    // The hall-side gallery crosses the sightline from the north stair.
    // Its two outer piers leave the ground-floor axis open into the wing.
    box(0,6,-20,-3,3.34,.26);
    box(5.65,6,-20,-3,3.6,.57);
    for (const z of [-19.75,-4.05]) {
      box(5.3,6,z,z+.72,1.125,8.18);
      box(.25,.85,z,z+.62,1.125,2.22);
    }
    for (const y of [4.32,4.54]) box(5.78,5.84,-19.7,-3.3,y,.055,steel);
    for (let z=-19.5;z<-3.3;z+=2) box(5.78,5.84,z,z+.055,4.17,.42,steel);
    box(5.4,6,-20,-3,7.04,.60);
    // The opposite wing keeps its covered upper landing.
    box(28,35.7,-20,-3,6.82,.38,concrete);
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
    // stair from the plaza; one straight flight climbs into the first-floor hall.
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
    box(37.65,40.65,-27.05,-26.77,0,7.43,edge);
    box(40.75,41.5,-31.4,-27.0,0,7.82,concrete);
    box(36.55,37.10,-27.55,-27.05,4.4,.1,steel);
    box(36.57,37.08,-27.52,-27.08,4.35,.05,[.8,.79,.64]);
    // Looking in from the forecourt the flight climbs left and away.
    // Use the central stair's landing elevation for the whole side approach.
    const platformY = 1.125;
    const stairAt = (a:number,y:number,t:number) =>
      at(37.9 + .8*a - .6*t, y, -29.45 + .6*a + .8*t);
    const count = 7, tread = .43, run = count*tread, halfWidth = .85;
    for(let i=0;i<count;i++) {
      section(solid,stairAt,-halfWidth,halfWidth,i*tread,(i+1)*tread,0,0,
        (i+1)*platformY/count,edge);
    }
    // Splay the level landing into the existing slab. The two inside
    // corners land on its x=32.5 edge, so walking straight reaches the hall.
    const join = (a:number) => (37.9 + .8*a - 32.5)/.6;
    const plan = [[-halfWidth,run],[halfWidth,run],[halfWidth,join(halfWidth)],[-halfWidth,join(-halfWidth)]];
    const lower=plan.map(([a,t])=>stairAt(a!,0,t!));
    const upper=plan.map(([a,t])=>stairAt(a!,platformY,t!));
    quad(solid,upper,concrete);
    for(let i=0;i<4;i++) {
      const j=(i+1)%4;
      quad(solid,[lower[i]!,lower[j]!,upper[j]!,upper[i]!],concrete);
    }
    // A recessed cheek wall and a continuous handrail frame the small opening.
    section(solid,stairAt,.94,1.09,0,run+.4,0,0,3.25,concrete);
    section(solid,stairAt,.79,.85,.12,run,.99,platformY+.88,.055,metal);
    for(const i of [0,3,6]) {
      const t=(i+.5)*tread, y=(i+1)*platformY/count;
      section(solid,stairAt,.79,.85,t,t+.055,y,y,.86,metal);
    }
    // The opposite end of the gallery retains its original flight.
    const eastSteps=16, eastTread=.31;
    for(let i=0;i<eastSteps;i++) {
      const z=-20-(eastSteps-i)*eastTread;
      box(29,30.65,z,z+eastTread,platformY,(i+1)*(3.6-platformY)/eastSteps,edge);
    }
    section(solid,at,29,29.06,-20-eastSteps*eastTread,-20,platformY+1.03,4.52,.06,metal);
    // Plaza-left entrance beside the planter. The straight flight meets the
    // bookshop door's platform beneath the projecting concrete balcony.
    const leftFoot=-28.41, leftTop=-25.4, leftSteps=7;
    const leftTread=(leftTop-leftFoot)/leftSteps;
    const tile: Tint=[.55,.53,.48], reveal: Tint=[.26,.25,.23];
    for(let i=0;i<leftSteps;i++) {
      const z=leftFoot+i*leftTread, top=platformY*(i+1)/leftSteps;
      box(-1.2,1.12,z,z+leftTread,0,top,tile);
      box(-1.2,1.12,z,z+.055,top-.025,.032,edge);
    }
    box(-1.3,0,leftTop,-25,0,platformY,tile);
    box(-1.3,0,-25,0,0,platformY,tile);
    box(-1.48,-1.2,-28.5,-25,0,7.5,tile);
    box(-1.48,-1.2,-25,-21.4,3.6,3.9,tile);
    for(const x of [-1.12,1.03]) {
      section(solid,at,x,x+.055,leftFoot,leftTop,.94,platformY+.94,.055,metal);
      for(let i=0;i<leftSteps;i+=3) {
        const z=leftFoot+(i+.5)*leftTread;
        box(x,x+.055,z,z+.055,platformY*(i+1)/leftSteps,.88,metal);
      }
    }
    // Shallow storage bay beside the stairs, beneath the sloping soffit.
    box(1.12,1.25,leftFoot,leftTop,0,platformY,tile);
    // Return flight over the blue drums. Enter from the first-floor
    // platform, climb toward the plaza and turn left onto the balcony.
    const bottomZ=-22.5, landingZ=-27.05, balconyY=3.86, returnSteps=17;
    const returnTread=(bottomZ-landingZ)/returnSteps, rise=(balconyY-platformY)/returnSteps;
    box(3.52,3.75,-28.2,-24.39,0,7.65,tile);
    for(let i=0;i<returnSteps;i++) {
      const z=bottomZ-i*returnTread, top=platformY+(i+1)*rise;
      box(1.25,3.52,z-returnTread,z,top-rise-.14,rise+.14,tile);
    }
    section(solid,at,1.25,3.52,landingZ,bottomZ,balconyY-rise-.17,platformY-.17,.07,tile);
    for(const x of [1.27,3.44]) {
      section(solid,at,x,x+.055,landingZ,bottomZ,balconyY+.9,platformY+.9,.055,metal);
      for(let i=1;i<returnSteps;i+=4) {
        const z=bottomZ-(i+.5)*returnTread, top=platformY+(i+1)*rise;
        box(x,x+.055,z,z+.055,top,.9,metal);
      }
    }
    // Both curved fascias share the same radius. Between them the
    // balcony is open, with its rear doorway set back from the rail.
    const lip=(x:number)=>-28.5+1.15*(1-Math.sqrt(1-Math.min(1,Math.max(0,(x-2.25)/1.5))**2));
    for(let i=0;i<16;i++) {
      const x=-1.48+i*5.23/16, next=x+5.23/16;
      const z=lip(x), end=lip(next);
      // Extend each curved front panel only to the head of the stairs.
      strip(x,next,z,end,Math.max(landingZ-z,landingZ-end)+.01,3.58,.28,tile);
      strip(x,next,z,end,.17,3.86,.90,tile);
      for(const y of [4.84,4.99]) strip(x,next,z+.04,end+.04,.055,y,.055,metal);
      if(i%3===0) box(x,x+.055,z+.04,z+.095,4.76,.28,metal);
      strip(x,next,z,end,7.2,7.12,.38,tile);
      strip(x,next,z,end,.19,7.5,.52,tile);
    }
    box(-1.48,3.75,-28.48,-28.12,7.95,1.68,tile);
    box(-1.48,.28,-28.48,-28.12,9.63,1.58,tile);
    box(1.86,3.75,-28.48,-28.12,9.63,1.58,tile);
    box(-1.48,3.75,-28.48,-28.12,11.21,1.05,tile);
    box(-1.48,3.75,-28.12,-21.3,12.1,.16,tile);
    box(-1.48,-1.2,-28.12,-21.3,7.95,4.15,tile);
    box(-1.48,1.25,landingZ,-22.3,3.58,.28,tile);
    // Level out onto the existing 2F gallery (3.60 m) through the return.
    section(solid,at,0,1.25,-22.3,-20.5,3.58,3.32,.28,tile);
    box(-1.2,0,-21.72,-21.5,balconyY,3.26,reveal);
    box(1.5,3.5,-21.72,-21.5,balconyY,3.26,reveal);
    // The adjoining 1F/2F wing ends at x=-6 on the z=-30 street line.
    // Its curved return meets the tower at x=-1.48, z=-28.5.
    const cornerX=-6.08, cornerZ=-28.5;
    for(let i=0;i<20;i++) {
      const angle=i*Math.PI/40, next=(i+1)*Math.PI/40;
      const x=cornerX+4.60*Math.sin(angle), xx=cornerX+4.60*Math.sin(next);
      const z=cornerZ-1.55*Math.cos(angle), zz=cornerZ-1.55*Math.cos(next);
      strip(x,xx,z,zz,.18,.02,12.24,tile);
      strip(x,xx,z,zz,3.3,12.10,.16,tile);
      for(const y of [2.08,5.3]) {
        strip(x,xx,z-.035,zz-.035,.04,y,1.0,[.16,.20,.21]);
        strip(x,xx,z-.06,zz-.06,.065,y-.08,.08,edge);
        if(i%3===0) box(x,x+.05,z-.075,z+.06,y,1.0,edge);
      }
    }
    // Close the returns up to the recessed top floor and the tower window wall.
    box(cornerX,cornerX+.16,-30,-26.85,7.2,5.06,tile);
    box(-1.48,-1.3,cornerZ,-24.85,.02,12.24,tile);
    // Central stair, level side bypasses and the paired stepped planting beds.
    for (let i=0;i<7;i++) box(12.5,23.5,-30.9+i*.43,-30.47+i*.43,.075,(i+1)*.15,edge);
    // Both exterior stairs terminate on one continuous first-floor platform.
    box(3.75,32.5,-27.89,.55,0,platformY,concrete);
    box(1.8,3.75,bottomZ,.55,0,platformY,concrete);
    box(32.5,36,-20,-3,0,1.125,concrete);
    box(0,1.25,leftTop,bottomZ,0,platformY);
    box(0,1.8,bottomZ,.55,0,platformY);
    for(const start of [1.6,24.1]) {
      const x=start<2?3.78:start, end=start+10.1;
      box(x,end,-29.4,-26.1,.08,.65);
      box(x+.15,end-.15,-28.85,-26.3,.73,.52);
      box(x+.24,end-.24,-28.65,-26.45,1.25,.28,[.12,.17,.064]);
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
