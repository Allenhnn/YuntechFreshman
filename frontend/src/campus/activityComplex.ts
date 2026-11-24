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
    // 使用者照片（2026-11-24，從北面廣場往南看）重新建模，不沿用舊模型。座標：a 沿北面從東端（a = 0）往西，o 往北為負，y 從廣場地面算。
    // 由左（東）到右（西）：左半邊一道 7 階大台階上到門廊平台；右半邊一整排花台（前段矮牆＋綠籬、後段高牆＋紅色朱蕉）接到樓梯塔；
    // 門廊：四根方柱撐起深挑簷，簷口一條橫幅（activityEntrance.ts），每根橫梁的梁頭在簷口下是往下收窄的 V 形托架；
    // 門廊後面二樓一條走廊（欄杆）、上面一排窗；中庭屋頂中間一座玻璃金字塔天窗，從廣場看得到它露出橫幅上方。
    // 西端樓梯塔：上半是實心量體、正面一個深的方形開口；下半左角是圓弧陽台（厚弧牆＋欄杆），陽台下凹進去一個暗的入口。
    const C: Tint = [.36,.35,.32], soffit: Tint = [.24,.235,.22], darkT: Tint = [.1,.1,.1], hedge: Tint = [.17,.29,.11], soil: Tint = [.12,.1,.08];
    const PY = 1.125; // portico / court floor
    const E = 32.3;   // west end of the portico, where the stair tower starts (the rounded corner beyond: buildings/activityCorner.ts)
    // Raised floor under the portico and the court; steps down on the south and the east.
    box(0,E,-28.2,0,0,PY,C);
    for (let i=0;i<7;i++) box(9,26,i*.45,(i+1)*.45,0,PY-i*PY/7,C);
    for (let i=0;i<7;i++) box(-(i+1)*.42,-i*.42,-20,-4,0,PY-i*PY/7,C);
    // Front stair, left half.
    for (let i=0;i<7;i++) box(.3,17,-31.21+i*.43,-28.2,0,(i+1)*PY/7,C);
    for (const x of [.35,16.9]) {
      section(solid,at,x,x+.06,-31.1,-28.2,.95,PY+.95,.06,metal);
      for (const [z,y] of [[-31,.16],[-29.7,.65],[-28.3,PY]] as const) box(x,x+.06,z,z+.06,y,.92,metal);
    }
    // Planter, right half: a low front wall with a clipped hedge, then a taller wall; cordylines behind (activityEntrance.ts).
    box(17.3,26,-30.6,-28.2,0,.75,C);
    box(17.5,25.8,-30.45,-29.6,.75,.7,hedge);
    box(26,E-.3,-30.6,-28.2,0,1.05,C);
    box(17.5,E-.5,-29.6,-28.3,.75,.32,soil);
    box(26.2,E-.5,-29.6,-28.3,1.05,.03,soil);
    // Portico: square columns, a deep fascia carrying the banner, soffit beams with V-shaped brackets at the front.
    for (const x of [3.2,10.4,17.6,24.8,31.6]) {
      box(x-.45,x+.45,-27.9,-27,PY,8.7-PY,C);
      box(x-.4,x+.4,-21.4,-20.6,PY,10.3-PY,C);
    }
    box(0,E,-29,-28.6,8.7,1.6,C);
    box(0,E,-29.05,-28.55,10.3,.18,C);
    box(0,E,-28.6,-19.5,9.6,.7,soffit);
    for (let x=.3; x<E; x+=2.88) {
      box(x-.16,x+.16,-28.6,-21,8.85,.75,soffit);
      for (const [w,y,h] of [[1.5,8.32,.38],[1,7.94,.38],[.5,7.56,.38]] as const) box(x-w/2,x+w/2,-28.95,-28.35,y,h,C);
    }
    // Upper floor behind the columns: a gallery with a rail, a band of windows above it.
    box(0,E,-24,-19.5,4.55,.3,C);
    for (const y of [5.4,5.85]) box(0,E,-24.05,-23.95,y,.05,metal);
    for (let x=.4; x<E; x+=1.5) box(x,x+.05,-24.05,-23.95,4.85,1.05,metal);
    section(glass,at,.2,E-.2,-19.45,-19.4,5.3,5.3,2.3,metal);
    for (let x=.2; x<E; x+=1.75) box(x,x+.09,-19.5,-19.35,5.3,2.3,steel);
    box(0,E,-19.6,-19.3,7.6,2,C);
    box(0,E,-19.6,-19.3,PY,.1,C);
    // Court behind: galleries round it at the upper floor, columns, a roof with the glass pyramid in the middle.
    box(0,E,-3,0,4.55,.3,C);
    for (const [a0,a1] of [[0,2.6],[E-2.6,E]] as const) box(a0,a1,-19.5,-3,4.55,.3,C);
    for (const x of [3.2,10.4,17.6,24.8,31.6]) box(x-.35,x+.35,-3.4,-2.7,PY,10.3-PY,C);
    for (const [a0,a1,z0,z1] of [[0,12,-19.5,0],[21,E,-19.5,0],[12,21,-16.5,0]] as const) box(a0,a1,z0,z1,10.3,.35,C);
    for (let i=0;i<16;i++) box(.3,2.3,-9.5-(i+1)*.6,-9.5-i*.6,PY,(i+1)*(4.55-PY)/16,C);
    for (let i=0;i<16;i++) box(E-2.3,E-.3,-9.5-(i+1)*.6,-9.5-i*.6,PY,(i+1)*(4.55-PY)/16,C);
    {
      const ax=16.5, az=-21, half=5.2, base=10.65, apex=18; // right behind the fascia, so it shows above the banner (照片)
      const P=(dx:number,dz:number,y:number)=>at(ax+dx,y,az+dz);
      const corners=[[-half,-half],[half,-half],[half,half],[-half,half]] as const;
      for (let k=0;k<4;k++) {
        const [x0,z0]=corners[k]!, [x1,z1]=corners[(k+1)%4]!;
        const top=P(0,0,apex);
        quad(glass,[P(x0,z0,base),P(x1,z1,base),top,top],metal);
        quad(glass,[top,top,P(x1,z1,base),P(x0,z0,base)],metal);
      }
      box(ax-half-.2,ax+half+.2,az-half-.2,az+half+.2,10.3,.4,C);
      for (const t of [0,.2,.4,.6,.8]) {
        const h=half*(1-t), y=base+(apex-base)*t;
        for (const [a0,a1,z0,z1] of [[-h,h,-h,-h+.08],[-h,h,h-.08,h],[-h,-h+.08,-h,h],[h-.08,h,-h,h]] as const) box(ax+a0,ax+a1,az+z0,az+z1,y,.08,steel);
      }
      // Dark rafters up each face (stepped little boxes from the base to the apex).
      for (const f of [-.6,-.2,.2,.6]) for (let k=0;k<12;k++) {
        const t=k/12, h=half*(1-t), y=base+(apex-base)*t, x=f*h;
        box(ax+x-.04,ax+x+.04,az-h,az-h+.25,y,(apex-base)/12,steel);
        box(ax+x-.04,ax+x+.04,az+h-.25,az+h,y,(apex-base)/12,steel);
      }
    }
    // West stair tower.
    const T0=E, T1=38.6, TF=-30.8, s0=33.8, s1=37;
    box(T0,s0,TF,-22,7.3,5,C);
    box(s1,T1,TF,-22,7.3,5,C);
    box(s0,s1,TF,-22,7.3,1.9,C);
    box(s0,s1,TF,-22,11.4,.9,C);
    box(s0,s1,-28.3,-22,9.2,2.2,C);
    box(s0+.05,s1-.05,-28.35,-28.3,9.2,2.2,darkT);
    box(T0,T1,TF-.05,-22,12.3,.25,C);
    // Curved balcony at the lower left: slab, a thick curved wall, a rail on its top.
    const strip=(x0:number,x1:number,z0:number,z1:number,depth:number,y:number,h:number,c:Tint)=>{
      const bottom=[at(x0,y,z0),at(x1,y,z1),at(x1,y,z1+depth),at(x0,y,z0+depth)];
      const top=bottom.map(([x,base,z]):Point=>[x,base+h,z]);
      quad(solid,top,c); quad(solid,[...bottom].reverse(),c);
      for(let i=0;i<4;i++){ const j=(i+1)%4; quad(solid,[bottom[i]!,bottom[j]!,top[j]!,top[i]!],c); }
    };
    const front=(x:number)=>{ const t=Math.min(1,(x-T0)/3); return -28.4+(TF+28.4)*Math.sqrt(Math.max(0,1-(1-t)*(1-t))); }; // -28.4 at the corner, out to TF
    for (let i=0;i<Math.ceil((T1-T0)/.5);i++) {
      const x=T0+i*.5, next=Math.min(T1,x+.5), z=front(x), end=front(next);
      strip(x,next,z,end,-z-22,3.3,.32,C);           // slab back to the building
      strip(x,next,z,end,.3,3.62,1.05,C);            // thick curved wall
      for (const y of [4.85,5.08]) strip(x,next,z+.12,end+.12,.05,y,.05,steel);
      if (i%2===0) box(x,x+.05,z+.12,z+.17,4.67,.45,steel);
      strip(x,next,z,end,-z-22,6.95,.35,C);          // soffit of the upper block, the same curve
    }
    // Behind the balcony: wall with dark windows upstairs, a dark recessed entrance and a column downstairs.
    box(T0,T1,-27,-22,3.62,3.33,C);
    box(34.6,37.8,-27.05,-27,4.4,1.8,darkT);
    box(T0,34.2,-28,-22,0,3.3,C);
    box(37.6,T1,-28,-22,0,3.3,C);
    box(34.2,37.6,-26,-22,0,3.3,C);
    box(34.25,37.55,-26.05,-26,0,3.0,darkT);
    box(33,33.6,-29.6,-29,0,3.3,C);
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
