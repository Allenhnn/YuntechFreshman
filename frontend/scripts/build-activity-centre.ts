/** Rebuild the paired building from the B1, 1F, two complementary 2F and 3F drawings.
 * Plan X increases towards the activity wing; plan Y increases towards the street.
 * The two courtyard faces are registered to the existing north stair and glazed roof. */
import { writeFileSync } from 'node:fs';
import { boundarySegments, rasterize } from '../src/buildings/floorGrid';
import type { BuildingSource, FloorPlan, Rect, Space, Vec2 } from '../src/buildings/buildingTypes';

const levels = [['B1',-2.475],['1F',1.125],['2F',3.6],['3F',7.2]] as const;
const bookshopWell: Rect = [-17,10,-1.5,15.6];
const basementFlight: Rect = [-11,21,0,23.2];
const source: BuildingSource = {
  id:'activity-centre', name:'學生活動中心暨表演廳', osmReplaces:['學生活動中心','表演廳'],
  transform:{angleDeg:Math.atan2(6.28,-35.17)*180/Math.PI,planCentroid:[0,0],worldCentroid:[128.18,168.83]},
  floorHeight:3.6, levels:levels.map(([id,elevation])=>({id,elevation,built:true})),
  floors:{},shell:{},directory:[],undergroundLevel:'B1',style:{clerestory:false,windows:true},
  groundOpenings:[bookshopWell,basementFlight,[-26,9,-18,13],[50,9,58,13],[7,-8,28,1.9]],
};
for(const [index,[id,base]] of levels.entries()) {
  const height=(levels[index+1]?.[1]??10.8)-base;
  const f:FloorPlan={bandTop:height,spaces:[],openings:[],signs:[],extras:{items:[],colliders:[]}};
  const space=(name:string, kind:Space['kind'], rects:Rect[], other:Partial<Space>={})=>{
    f.spaces.push({id:id+'-'+f.spaces.length,name,kind,ceiling:height,rects,...other});
  };
  // The auditorium and club wings have different depths on the pond side.
  const west:Rect[]=[[36,0,88,25],[40,-8,75,0],[46,25,86,29],[39,0,82,28]];
  const east:Rect[]=[[-59,-5,0,25],[-55,-10,-5,-5],[-40,-15,-16,-10],[-58,25,-6,30]];
  if(id==='3F') {
    space('三樓連廊','corridor',[[-33,3,0,27],[36,2,68,26]],{group:'hall'});
  } else space('兩翼走廊','corridor',[...west,...east],{group:'hall'});
  if(id==='B1') space('地下一樓中央通廊','lobby',[[0,2,36,23],[7,-8,28,2]],{group:'hall'});
  if(id==='2F'||id==='3F') {
    space('中庭前後連橋','corridor',[[0,2.5,36,5],[0,17,36,20]],{group:'hall',noCeiling:true});
  }
  const room=(code:string,r:Rect,opts:Partial<Space>={})=>space(code+' 室','room',[r],{code,...opts});
  const row=(codes:string[],x0:number,x1:number,y0:number,y1:number)=>{
    const step=(x1-x0)/codes.length;
    codes.forEach((code,i)=>room(code,[+(x0+i*step).toFixed(1),y0,+(x0+(i+1)*step).toFixed(1),y1]));
  };
  const column=(codes:string[],x0:number,x1:number,y0:number,y1:number)=>{
    const step=(y1-y0)/codes.length;
    codes.forEach((code,i)=>room(code,[x0,+(y0+i*step).toFixed(1),x1,+(y0+(i+1)*step).toFixed(1)]));
  };
  if(id==='B1'){
    room('B31',[-34,19,-2,27]);row(['B35','B34','B33'],-32,-2,-5,6);
    row(['B32a','B32b'],0,15,2,6);room('B04',[19,2,33,6]);row(['B05','B06','B07'],37,72,-5,5);
    room('B08',[75,4,87,25]);row(['B01','B02','B03'],40,72,19,27);
    column(['B10','B09'],34,39,17,23);row(['B37','B40','B39'],-43,-33,-5,1);
  } else if(id==='1F'){
    room('133',[-56,19,-36,28]);row(['135','134'],-55,-40,26,29);
    room('131',[-23,19,-2,28]);room('132',[-21,-6,-7,5]);room('140',[-6,-4,-2,5]);
    row(['137','138'],-33,-25,-4,1);
    room('107',[38,-3,59,6]);room('109',[60,-3,65,6]);
    room('110',[67,-4,74,1]);room('108',[66,2,82,8]);
    row(['111','112','113','114','115'],66,87,10,14);
    room('106',[65,17,86,25]);room('101',[42,18,54,25]);
    column(['102','103'],37,41,18,24);row(['104','105'],43,54,25,28);
    row(['117','116'],55,60,19,27);
  } else if(id==='2F'){
    row(['209','210','211','212','213','214','215','216','217','218'],40,75,-7,-1);
    row(['202','203','204','205','206','207','208'],42,63,2,7);
    column(['219','220','221','222','223','224','225','226'],66,74,6,25);
    column(['227','228','229','230','231','232','233','234','235'],78,86,3,25);
    room('201',[40,18,53,26]);room('200',[61,21,65,25]);
    row(['236','237'],54,60,22,27);room('238',[54,18,60,20]);
    row(['254','255','256','252','251','250','249','248','246'],-33,-2,-6,0);
    row(['253','247'],-28,-5,3,7);row(['245','244'],-56,-35,17,21);
    row(['243','242'],-56,-35,24,29);room('241',[-25,16,-5,20]);room('240',[-22,23,-5,28]);
  } else {
    row(['333','332','331'],-32,-1,21,27);row(['301','302'],38,67,19,26);
    room('303',[30,9,36,17]);
  }
  const extras=f.extras!;
  const box=(x:number,z:number,y:number,w:number,h:number,d:number,kind:'riser'|'stage'='riser')=>{
    extras.items.push({kind,x,z,y,ry:0,sx:w,sy:h,sz:d,tint:0});
    extras.colliders.push({c:[x,y+h/2,z],h:[w/2,h/2,d/2]});
  };
  if(id==='1F'||id==='B1'){
    space('表演廳觀眾席','room',[[-57,-4,-36,16]],{code:id==='1F'?'表演廳':'地下觀眾席',noCeiling:true,group:'auditorium'});
    if(id==='B1') {
      box(-46.5,-1.8,0,18,.65,3.4,'stage');
      // One auditorium spanning B1 and 1F: a low stage, a raked house and
      // two aisles of half-steps up to the street-side rear lobby.
      box(-46.5,-3.2,.65,17,2.8,.22,'stage');
      for(let row=0;row<12;row++) {
        const z=.5+row*1.22, y=(row+1)*.30;
        box(-46.5,z,0,15.2,y,1.22);
        for(const x of [-55.3,-37.7]) {
          box(x,z-.305,0,2.4,y-.15,.61);box(x,z+.305,0,2.4,y,.61);
        }
        for(let seat=0;seat<12;seat++) extras.items.push({kind:'chair',x:-53.4+seat*1.2+(seat>=6?.4:0),
          y,z,ry:0,sx:1,sy:1,sz:1,tint:.35});
      }
      box(-46.5,15.3,0,20,3.6,1.4);
    } else {
      space('Auditorium opening','void',[[-56.8,-3.8,-36.2,14.6]],{noCeiling:true,customEdge:true,ceiling:height+.1,group:'auditorium'});
    }
  }
  // Open stairwells in both wings. Alternating directions stack consecutive
  // flights over the same cutout. Walkable treads use exactly their visual size.
  for(const [left,right] of [[-26,-18],[50,58]]) {
    space('樓梯井','void',[[left,9,right,13]],{noCeiling:true,customEdge:true,ceiling:height+.1});
    if(index<3){
      const n=Math.ceil(height/.17), step=(right-left)/n;
      for(let k=0;k<n;k++){
        const x=index%2===0?left+(k+.5)*step:right-(k+.5)*step;
        const top=(k+1)*height/n;
        box(x,index%2===0?10:12,top-.15,step,.15,2);
      }
    }
  }
  if(id==='3F') for(const [a,b] of [[-24,-2],[38,57]]) space('Open gallery','void',[[a,13.5,b,16]],{noCeiling:true,ceiling:height+.1});
  if(id==='2F') {
    space('觀眾席上方挑空','void',[[-57,-4,-36,16]],{noCeiling:false});
    for(const [a,b] of [[-24,-2],[38,57]]) space('翼廊挑空','void',[[a,13.5,b,16]],{noCeiling:true});
  }
  for(const [a,b] of [[-26,-18],[50,58]]) {
    space('Stair landings','corridor',[[a-1.6,8.8,a,13.2],[b,8.8,b+1.6,13.2]],{group:'hall'});
  }
  // Flight guards follow the shaft edges; its two ends stay open to both landings.
  for(const [a,b] of [[-26,-18],[50,58]]) for(const y of [9.02,12.98]) {
    box((a+b)/2,y,.86,b-a,.08,.07);
    for(let x=a+.25;x<b;x+=2) box(x,y,0,.07,.86,.07);
  }
  if(id==='B1') {
    // Open-air pond-side court: broad terraces rise from the basement to grade.
    space('Sunken court','lobby',[[7,-8,28,2]],{group:'hall',noCeiling:true});
    for(let i=0;i<15;i++) box(17.5,1.75-i*.65,0,19,(i+1)*2.475/15,.65);
  }
  if(id==='1F') {
    // Broad entrance flight at the auditorium lobby, seen from the north.
    for(let i=0;i<7;i++) box(-46,33.8-i*.45,-base,11,(i+1)*base/7,.45);
    box(-46,30.55,-base,11,base,1.3);
    box(-46,31.2,2.5,13,.32,2.8,'stage');
  }
  if(id==='1F') {
    space('書城走道間挑空','void',[bookshopWell],{noCeiling:true});
    space('通往地下室的直梯','void',[basementFlight],{noCeiling:true,customEdge:true});
    // Fixtures sit against the bookshop wall, leaving the route beside the rail clear.
    for(const [x,width] of [[-4,2.8],[-9,2.4],[-14,2.4]]) {
      extras.colliders.push({c:[x,.48,18.45],h:[width/2,.48,.39]});
    }
  }
  if(id==='B1') {
    space('書城下方中庭','lobby',[bookshopWell],{group:'hall',noCeiling:true});
    space('直梯下方及出口','corridor',[[-13,18,-11,23.2],basementFlight],
      {group:'hall',noCeiling:true});
    const count=22, tread=11/count;
    for(let i=0;i<count;i++) {
      box(-11+(i+.5)*tread,22.1,0,tread,(i+1)*height/count,2.2);
    }
  }
  // Doors on the longest available wall facing circulation. A nested service
  // room (e.g. 134/135) may instead connect through its adjoining parent.
  const grid=rasterize(f.spaces), edges=boundarySegments(grid);
  const connected=new Set(f.spaces.flatMap((s,i)=>s.kind==='corridor'||s.kind==='lobby'?[i]:[]));
  const pending=new Set(f.spaces.flatMap((s,i)=>s.kind==='room'?[i]:[]));
  const open=(axis:string,at:number,mid:number,width:number,kind:'door'|'open'|'exit',label:string)=>{
    const pt=(t:number):Vec2=>axis==='v'?[at,t]:[t,at];
    f.openings.push({kind,a:pt(mid-width/2),b:pt(mid+width/2),label});
  };
  while(pending.size) {
    const before=pending.size;
    for(const i of pending) {
      const edge=edges.filter(e=>e.to-e.from>=1.3&&((e.a===i&&connected.has(e.b))||(e.b===i&&connected.has(e.a))))
        .sort((a,b)=>(b.to-b.from)-(a.to-a.from))[0];
      if(!edge)continue;
      open(edge.axis,edge.at,(edge.from+edge.to)/2,1.2,'door',f.spaces[i]!.name);
      connected.add(i);pending.delete(i);
    }
    if(before===pending.size)throw Error('Unreachable rooms: '+[...pending].map(i=>f.spaces[i]!.name));
  }
  // Upper bridge edges remain open to both wings. At ground level the court
  // itself is the exterior platform, entered at the mouths of both corridors.
  if(id==='1F') {
    open('v',36,13,4,'open','中庭');
    open('v',0,17.4,1.8,'exit','雲院書城');
    open('v',0,8.4,1.8,'exit','翼廊');
    open('v',0,22.1,2.2,'open','B1');
  }
  if(id==='B1') open('h',-8,17.5,19,'open','Courtyard');
  if(id==='3F') open('v',36,13,1.4,'door','303');
  if(id==='2F'||id==='3F') for(const y of [2.5,5,17,20]) {
    open('h',y,18,35.8,'open','Gallery');
  }
  if(id==='1F') {open('h',30,-46,2.4,'exit','表演廳');open('h',29,70,2.4,'exit','活動中心');}
  source.floors[id]=f;source.directory.push({level:id,items:f.spaces.flatMap(s=>s.code?[s.code]:[])});
}
const path='assets-src/floorplans/活動中心/activity-centre.source.json';
writeFileSync(path,JSON.stringify(source));
