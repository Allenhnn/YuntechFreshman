import { bookshopExit } from './bookshopExit';
import { bookshopFlight, rear, turn, nose, axisZ, radius, stairLevels } from './bookshopStair';
import { CylinderGeometry, ExtrudeGeometry, DoubleSide, BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Shape, ShapeGeometry, RepeatWrapping, SRGBColorSpace, Vector3, type Scene } from 'three';
import type { ResourceTracker } from '../core/resources';

/** The interior references use plan-right towards room 107 (local +X)
 * and plan-up away from the north stair (local -Z). */
export function addActivityAtrium(scene: Scene, tracker: ResourceTracker) {
  const root = new Group();
  root.position.set(128.18,0,168.83);
  root.rotation.y = Math.atan2(-6.28,-35.17);
  const texture = (w:number,h:number,paint:(ctx:CanvasRenderingContext2D)=>void) => {
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    paint(c.getContext('2d')!);
    const map=new CanvasTexture(c); map.colorSpace=SRGBColorSpace;
    return map;
  };
  const tile=texture(256,256,c=>{
    c.fillStyle='#716f67'; c.fillRect(0,0,256,256);
    for(let y=0;y<8;y++) for(let x=0;x<8;x++) {
      const accent=(x<2 && y<2) || (x===5 && y===5);
      c.fillStyle=accent?'#948679':['#928e83','#908c82','#8e8a80'][(x+y*3)%3]!;
      c.fillRect(x*32+1,y*32+1,31,31);
    }
  });
  tile.wrapS=tile.wrapT=RepeatWrapping; tile.repeat.set(12,10);
  // Match the platform outline around the storage recess. ShapeGeometry
  // uses metres for UVs, so normalize against the original tile repeat.
  const platform=new Shape();
  platform.moveTo(-1.3,0).lineTo(0,0).lineTo(0,.55).lineTo(32.5,.55)
    .lineTo(32.5,-27.89).lineTo(3.75,-27.89).lineTo(3.75,-22.5)
    .lineTo(1.25,-22.5).lineTo(1.25,-25.4).lineTo(-1.3,-25.4).closePath();
  const surface=new ShapeGeometry(platform);
  const uv=surface.getAttribute('uv');
  for(let i=0;i<uv.count;i++) uv.setXY(i,(uv.getX(i)-1.8)/30.7,(uv.getY(i)+27.89)/28.44);
  const floor=new Mesh(surface,new MeshStandardMaterial({map:tile,roughness:.88,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  floor.position.y=1.145; floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; root.add(floor);

  const shadeMap=texture(128,8,c=>{
    const shade=c.createLinearGradient(0,0,128,0);
    shade.addColorStop(0,'rgba(42,35,30,.57)');
    shade.addColorStop(.58,'rgba(42,35,30,.49)');
    shade.addColorStop(1,'rgba(42,35,30,0)');
    c.fillStyle=shade;c.fillRect(0,0,128,8);
  });
  const shade=new Mesh(new PlaneGeometry(10.5,16.8),new MeshStandardMaterial({
    map:shadeMap,transparent:true,depthWrite:false,roughness:1
  }));
  shade.position.set(5.5,1.151,11.5);shade.rotation.x=-Math.PI/2;root.add(shade);

  const members:{p:Vector3; q:Vector3; w:number; h:number; color:number}[]=[];
  const member=(a:number[],b:number[],w:number,h:number,color:number)=>{
    members.push({p:new Vector3().fromArray(a),q:new Vector3().fromArray(b),w,h,color});
  };
  const beam=0x67625b;
  // Deep portal trusses repeat along the ridge. From the north stair the
  // triangular profiles overlap in perspective above the hall-side gallery.
  for(const x of [5.65,12.4,19.1,25.8,32.5]) {
    member([x,9.34,3],[x,9.34,20],.46,.56,beam);
    for(const eave of [3,20]) {
      member([x,10.52,eave],[x,13.24,11.5],.38,.46,beam);
      member([x,9.38,eave],[x,13.16,11.5],.27,.34,beam);
    }
  }
  for(const z of [3,20]) {
    member([.2,9.26,z],[35.5,9.26,z],.42,.52,beam);
  }
  for(const z of [5,12,19]) {
    member([30,1.125,z],[30,6.8,z],.63,.63,0xb2aba0);
    member([30,6.78,z],[31.7,6.78,z],.38,.08,0xffeac8);
  }
  // Bookshop frontage along the left-hand gallery. Keep a clear aisle on
  // the well side of the counter, copier and glass display case.
  const block=(x:number,y:number,z:number,w:number,h:number,d:number,color:number)=>
    member([x,y,z],[x,y+h,z],w,d,color);
  for(let x=-17;x<=-2;x+=.28) block(x,1.26,18.89,.09,2.14,.09,0x97754f);
  block(-9.5,3.36,18.76,15.2,.07,.20,0xffe2ae);
  block(-4,1.13,18.45,2.8,.92,.78,0xbfa982);
  block(-4,2.05,18.45,2.94,.06,.84,0xe6d7b7);
  block(-4.65,2.11,18.54,.48,.32,.09,0x464c4c);
  block(-9,1.13,18.45,2.4,.81,.78,0xcecfc4);
  block(-9,1.94,18.45,2.2,.09,.66,0x525554);
  block(-9,2.03,18.67,2.12,.19,.21,0xe3dfcb);
  for(const h of [1.21,1.72,2.23]) block(-14,h,18.45,2.4,.05,.76,0xb8bbb2);
  for(const x of [-15.15,-12.85]) for(const z of [18.09,18.8])
    block(x,1.13,z,.05,1.52,.05,0x757d77);
  for(const h of [1.26,1.77,2.28]) for(let i=0;i<6;i++)
    block(-14.96+i*.31,h,18.4,.17,.25,.23,[0xa77652,0x748b86,0xd5bc79][i%3]!);
  // The bottom of the well is the finished B1 lobby floor.
  const basementTile=texture(512,512,c=>{
    c.fillStyle='#a18a77';c.fillRect(0,0,512,512);
    for(let row=0;row<16;row++) for(let col=0;col<16;col++){
      const border=row===0 || col===0;
      const ring=Math.max(Math.abs(col%8-4),Math.abs(row%8-4))===2;
      c.fillStyle=border?'#526b69':ring?'#b77562':['#d7b397','#d1aa91','#caa18a'][(row+2*col)%3]!;
      c.fillRect(col*32+1,row*32+1,31,31);
    }
  });
  basementTile.wrapS=basementTile.wrapT=RepeatWrapping;
  basementTile.repeat.set(5,2);
  const wellFloor=new Mesh(new PlaneGeometry(26,10.4),new MeshStandardMaterial({
    map:basementTile,roughness:.9
  }));
  wellFloor.rotation.x=-Math.PI/2;wellFloor.position.set(-13,-2.388,12.8);
  root.add(wellFloor);

  const eaves=10.8, rise=1.85, halfSpan=2.8, ridgeZ=12.8;
  const roofGlass=new MeshStandardMaterial({
    color:0xd2e0de,emissive:0x343e40,transparent:true,opacity:.82,roughness:.65,side:DoubleSide
  });
  for(const side of [-1,1]){
    const roof=new Mesh(new PlaneGeometry(26,Math.hypot(halfSpan,rise)),roofGlass);
    roof.rotation.x=-Math.PI/2+side*Math.atan2(rise,halfSpan);
    roof.position.set(-13,eaves+rise/2,ridgeZ+side*halfSpan/2);root.add(roof);
    for(const fraction of [.5,1]){
      block(-13,eaves+rise*(1-fraction),ridgeZ+side*halfSpan*fraction,26,.08,.08,0x6c706b);
    }
  }
  for(let x=-26;x<=0;x+=1){
    const truss=(x+26)%4===0;
    const width=truss ? .18 : .055;
    for(const z of [10,15.6])
      member([x,eaves,z],[x,eaves+rise,ridgeZ],width,width,truss?0xb5ad9f:0x676e6b);
    if(truss) member([x,eaves,10],[x,eaves,15.6],.18,.24,0xb5ad9f);
  }
  for(const z of [10,15.6]) block(-13,10.68,z,26,.16,.18,0xa9a69b);
  // The upper classroom facade sits behind the galleries. Narrow roof shoulders
  // carry daylight across the two aisles to the existing glazed ridge.
  for(const [inner,outer] of [[10,7],[15.6,19]]){
    const cover=new Mesh(new PlaneGeometry(26,Math.abs(outer-inner)),roofGlass);
    cover.rotation.x=-Math.PI/2;cover.position.set(-13,eaves,(inner+outer)/2);root.add(cover);
    for(let x=-26;x<=0;x+=1) member([x,eaves,inner],[x,eaves,outer],.07,.07,0x6c706b);
  }
  // Keep the upper bookstore wall visible from 1F when the third floor is culled.
  // The inward lip overlaps the glass shoulder at z=19.
  block(-13,7.17,19.08,26,eaves-7.17+.12,.16,0xb9b5aa);
  block(-13,eaves-.08,19,26,.18,.26,0xa9a69b);
  for(const y of [3.6,7.2]){
    block(-13,y,6.96,26,1.20,.15,0xb9b5aa);
    block(-13,y+2.59,6.96,26,1.01,.15,0xb9b5aa);
    for(let x=-25;x<0;x+=2){
      block(x,y+1.2,6.96,1.94,1.39,.08,0x526268);
      block(x,y+1.2,7.015,.055,1.39,.045,0x383e40);
      block(x-.97,y+1.2,6.99,.10,1.39,.14,0xaaa79e);
    }
  }
  // Sealed glazing on the existing solid classroom wall. The panes nearest
  // Hi-Life reach the floor; the far group starts at a masonry sill.
  for(let i=0;i<8;i++){
    const fullHeight=i>=4;
    const x=-23.65+i*1.38+(fullHeight ? .72 : 0);
    const sill=fullHeight ? .055 : .65, frame=0x353a39;
    for(const [bottom,top] of [[sill,1.84],[1.98,2.37]]){
      block(x,1.125+bottom,6.803,1.34,top-bottom,.056,frame);
      block(x,1.125+bottom+.04,6.842,1.24,top-bottom-.08,.022,i<4?0x84918e:0x626f70);
    }
  }
  for(const x of [-12.12,-11.73]){
    const tank=new Mesh(new CylinderGeometry(.104,.108,.43,12),new MeshStandardMaterial({color:0xb53930,roughness:.47}));
    tank.position.set(x,1.72,6.94);root.add(tank);
    block(x,1.94,6.94,.07,.08,.07,0x574f42);
    block(x+.025,2.02,6.94,.14,.032,.045,0x9c3932);
    block(x,1.69,7.044,.11,.16,.016,0xf0dcaf);
    member([x+.07,1.98,6.98],[x+.14,1.62,6.98],.026,.026,0x393d3c);
  }
  // Restroom lobby: open side leaves, cream double service door on the return wall.
  const floorY=1.125;
  for(const x of [-28.2,-23.2]){
    block(x-.48,floorY,3.46,.065,2.07,1.02,0x655044);
    for(const h of [.55,1.10,1.65])
      block(x-.44,floorY+h,3.46,.014,.32,.77,0xc0c2ac);
  }
  for(const [x0,x1] of [[-29,-28.75],[-27.65,-25.96],[-24.74,-23.75],[-22.65,-22.2]]){
    block((x0+x1)/2,floorY,4.12,x1-x0,1.16,.036,0x999c91);
    block((x0+x1)/2,floorY+1.16,4.12,x1-x0,.065,.042,0x767d76);
  }
  // Each cubicle has a basin and a toilet set back from the entry.
  for(const x of [-28,-25.6,-23.25]){
    block(x,floorY,1.47,.39,.36,.52,0xb9c1bd);
    block(x,floorY+.37,1.65,.48,.09,.62,0xe1e4d9);
    block(x,floorY+.41,1.28,.45,.38,.16,0xd1d8ce);
    block(x+.69,floorY+.76,2.18,.42,.15,.48,0xd9dcd3);
    block(x+.80,floorY+.91,2.18,.04,.12,.045,0x777f79);
  }
  for(const z of [4.41,5.06]){
    block(-22.23,floorY,z,.06,2.12,.64,0xd2cfbe);
    block(-22.273,floorY+1.02,z+(z<4.5 ? .25 : -.25),.046,.04,.08,0x545a56);
  }
  block(-22.48,floorY,6.03,.5,1.43,.5,0x5c6161);
  block(-22.74,floorY+.92,6.03,.03,.32,.36,0x353b3d);
  block(-22.76,floorY+1.15,6.03,.018,.105,.21,0xa5d3cf);
  block(-22.76,floorY+.94,6.03,.04,.07,.075,0xb55a50);
  block(-22.75,floorY+.74,6.03,.11,.045,.32,0x979e9c);
  block(-22.35,floorY,6.52,.30,2.47,.32,0xc0beb2);
  for(const z of [5.49,5.69]){
    const tank=new Mesh(new CylinderGeometry(.078,.082,.34,12),new MeshStandardMaterial({color:0xb43830}));
    tank.position.set(-22.32,floorY+.78,z);root.add(tank);
    block(-22.32,floorY+.96,z,.06,.055,.10,0x514d43);
    block(-22.40,floorY+.73,z,.015,.12,.09,0xe6dbb6);
  }
  const speaker=new Mesh(new CylinderGeometry(.135,.135,.045,24),new MeshStandardMaterial({color:0x747a76}));
  speaker.rotation.z=Math.PI/2;speaker.position.set(-22.52,floorY+1.98,6.52);root.add(speaker);
  for(let i=-2;i<=2;i++) block(-22.55,floorY+1.98+i*.034,6.52,.012,.011,.18-Math.abs(i)*.022,0x424745);
  // Waist-high wall finish, casework and lit lintel in the bookstore exit passage.
  for(const x of [-28.975,-23.14]){
    block(x,1.13,24.5,.05,1.04,10.96,0xa09e93);
    block(x,2.17,24.5,.055,.045,10.96,0x786f65);
  }
  block(-23.18,2.20,27.0,.07,.97,2.75,0x987e60);
  block(-28.955,2.38,27.85,.09,.76,1.26,0x9a815f);
  const exit=bookshopExit, frame=0x2e3030;
  const glass=new MeshStandardMaterial({color:0x728282,transparent:true,opacity:.5,roughness:.28,side:DoubleSide});
  const fixedPane=(x:number,y:number,w:number,h:number)=>{
    const mesh=new Mesh(new PlaneGeometry(w,h),glass);
    mesh.position.set(x,floorY+y,exit.z+.08);root.add(mesh);
  };
  const sideWidth=(exit.width-exit.slidingWidth)/2;
  for(const side of [-1,1]){
    const cx=exit.x+side*(exit.slidingWidth+sideWidth)/2;
    fixedPane(cx,exit.slidingHeight/2,sideWidth,exit.slidingHeight);
    block(cx,floorY+1.04,exit.z+.055,sideWidth,.075,.018,0xb2bfbc);
    for(const offset of [exit.width/2,exit.slidingWidth/2])
      block(exit.x+side*offset,floorY,exit.z+.08,.055,exit.glazingHeight,.075,frame);
  }
  const transom=exit.glazingHeight-exit.slidingHeight;
  fixedPane(exit.x,exit.slidingHeight+transom/2,exit.width,transom);
  for(const h of [0,exit.slidingHeight,exit.glazingHeight])
    block(exit.x,floorY+h,exit.z+.08,exit.width,.045,.075,frame);
  for(const dx of [-.94,0,.94]) block(exit.x+dx,floorY+exit.slidingHeight,exit.z+.08,.04,transom,.065,frame);
  block(exit.x,3.41,29.94,.45,.12,.075,0x90e7b0);
  const paving=texture(256,512,c=>{
    c.fillStyle='#a59887';c.fillRect(0,0,256,512);
    for(let j=0;j<16;j++) for(let i=0;i<8;i++){
      c.fillStyle=j===5?'#70847f':(i+3*j)%7===0?'#b99680':'#cebcab';
      c.fillRect(i*32+1,j*32+1,31,31);
    }
  });
  const exitFloor=new Mesh(new PlaneGeometry(5.92,10.98),new MeshStandardMaterial({map:paving,roughness:.8}));
  exitFloor.position.set(exit.x,1.211,24.5);exitFloor.rotation.x=-Math.PI/2;root.add(exitFloor);
  // The half landings and their parapets continue around the turn as single curved faces.
  const curvedSlab=(shape:Shape, bottom:number, thickness:number, color:number)=>{
    const geometry=new ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:24});
    geometry.rotateX(-Math.PI/2);
    const mesh=new Mesh(geometry,new MeshStandardMaterial({color,roughness:.88}));
    mesh.position.y=bottom;mesh.receiveShadow=true;root.add(mesh);
  };
  const landing=(r:number)=>new Shape().moveTo(turn,-axisZ-r).lineTo(nose,-axisZ-r)
    .absarc(nose,-axisZ,r,-Math.PI/2,Math.PI/2,false).lineTo(turn,-axisZ+r).closePath();
  const rim=(r:number,width:number)=>new Shape().moveTo(turn,-axisZ-r).lineTo(nose,-axisZ-r)
    .absarc(nose,-axisZ,r,-Math.PI/2,Math.PI/2,false).lineTo(turn,-axisZ+r)
    .lineTo(turn,-axisZ+r-width).lineTo(nose,-axisZ+r-width)
    .absarc(nose,-axisZ,r-width,Math.PI/2,-Math.PI/2,true).lineTo(turn,-axisZ-r+width).closePath();
  const stone=0xb8b2a5, metal=0x646965;
  for(let level=0;level<stairLevels.length-1;level++){
    const base=stairLevels[level]!,height=stairLevels[level+1]!-base,half=base+height/2;
    block((rear+turn)/2,base,axisZ,turn-rear,height,.18,stone);
    curvedSlab(landing(radius),half-.20,.20,0x686762);
    curvedSlab(rim(radius+.03,.14),half-.23,.94,stone);
    for(const h of [.80,.97]) curvedSlab(rim(radius,.045),half+h,.044,metal);
    for(let i=0;i<=8;i++){
      const angle=Math.PI*(i/8-.5);
      block(nose+(radius-.025)*Math.cos(angle),half+.69,axisZ+(radius-.025)*Math.sin(angle),.045,.28,.045,metal);
    }
    for(const returning of [false,true]){
      const steps=bookshopFlight(height,returning);
      const edge=axisZ+(returning?-radius:radius);
      for(const [i,step] of steps.entries()){
        const top=base+step.top;
        block(step.x,top-.20,step.z,step.depth,.20,radius,0x656661);
        block(step.x,top-.20,edge,step.depth,.91,.12,stone);
        if(i%3===0) block(step.x,top+.70,edge,.045,.30,.045,metal);
      }
      const yRear=returning?base+height:base;
      for(const h of [.86,1.0]) member([rear,yRear+h,edge],[turn,half+h,edge],.055,.055,metal);
    }
  }
  const ground=stairLevels[0];
  curvedSlab(landing(radius+.38),ground+.09,.19,0x979387);
  curvedSlab(landing(radius+.18),ground+.28,.38,stone);
  curvedSlab(landing(radius+.07),ground+.66,.05,0x6c7452);
  block((rear+turn)/2,ground,axisZ+radius+.34,turn-rear,.68,.65,stone);
  for(let i=0;i<38;i++){
    const angle=Math.PI*(i/37-.5),r=radius-.07+.09*Math.sin(i*13);
    block(nose+r*Math.cos(angle),ground+.71,axisZ+r*Math.sin(angle),.19,.15+.13*(i%3),.22,i%2?0x70864c:0x849659);
  }
  for(let i=0;i<19;i++) block(rear+(i+.5)*(turn-rear)/19,ground+.67,axisZ+radius+.34,.24,.21+(i%3)*.05,.40,i%2?0x738754:0x849656);
  for(const x of [-6.8,-11.3]) {
    block(x,1.13,16.15,.42,.06,.42,0x767974);
    block(x,1.19,16.15,.07,.57,.07,0x858780);
    block(x,1.76,16.15,.43,.09,.38,0x9c6355);
  }
  const batch=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial({roughness:.9}),members.length);
  const temp=new Object3D(), direction=new Vector3(),axis=new Vector3(0,1,0);
  members.forEach(({p,q,w,h,color},i)=>{
    direction.subVectors(q,p);temp.position.copy(p).lerp(q,.5);temp.scale.set(w,direction.length(),h);
    temp.quaternion.setFromUnitVectors(axis,direction.normalize());temp.updateMatrix();batch.setMatrixAt(i,temp.matrix);
    batch.setColorAt(i,new Color(color));
  }); root.add(batch);
  const panel=(w:number,h:number,x:number,y:number,z:number,yaw:number,map:CanvasTexture)=>{
    const m=new Mesh(new PlaneGeometry(w,h),new MeshStandardMaterial({map,roughness:.88}));
    m.position.set(x,y,z);m.rotation.y=yaw;root.add(m);
  };
  for(const [i,x] of [-5,-12,-19].entries()){
    const z=i%2?11.1:14.25;
    const top=10.7-i*.24;
    const banner=texture(128,384,c=>{
      c.fillStyle=['#bd815c','#658896','#9b6980'][i]!;
      c.fillRect(0,0,128,384);c.fillStyle='#f4ecdb';c.textAlign='center';
      c.font='bold 29px sans-serif';
      Array.from('雲林科技大學').forEach((ch,j)=>c.fillText(ch,64,42+j*34));
      c.beginPath();c.arc(64,266,32,0,Math.PI*2);c.fill();
      c.fillStyle='#414547';c.fillRect(52,263,4,6);c.fillRect(72,263,4,6);
      c.font='bold 21px sans-serif';c.fillText('YunTech',64,343);
    });
    const flag=new Mesh(new PlaneGeometry(.88,2.9),new MeshStandardMaterial({map:banner,side:DoubleSide}));
    flag.position.set(x,top-1.45,z);flag.rotation.y=Math.PI*.43;root.add(flag);
  }
  panel(.68,.24,-11.93,2.31,6.815,0,texture(384,128,c=>{
    c.fillStyle='#a7302a';c.fillRect(0,0,384,128);c.fillStyle='#fff6db';
    c.textAlign='center';c.font='bold 81px sans-serif';c.fillText('滅火器',192,93);
  }));
  for(const [x,label] of [[-28.2,'男廁'],[-25.35,'♿ 無障礙廁所'],[-23.2,'女廁']] as const){
    panel(.89,.22,x,3.43,4.14,0,texture(384,96,c=>{
      c.fillStyle='#e3e4d8';c.fillRect(0,0,384,96);c.fillStyle='#344a4c';
      c.textAlign='center';c.font='bold 50px sans-serif';c.fillText(label,192,65);
    }));
  }
  panel(1.18,.46,-22.27,2.62,4.74,-Math.PI/2,texture(384,128,c=>{
    c.fillStyle='#d2cfbe';c.fillRect(0,0,384,128);c.fillStyle='#475069';
    c.textAlign='center';c.font='42px serif';c.fillText('雲林科技大學',192,81);
  }));
  panel(2.62,.85,-23.23,2.685,27,-Math.PI/2,texture(640,208,c=>{
    c.fillStyle='#47716b';c.fillRect(0,0,640,208);
    c.fillStyle='#e6dfc9';c.fillRect(34,136,58,65);
    c.fillStyle='#ab9b6d';c.fillRect(58,134,12,6);
  }));
  panel(1.12,.63,-28.90,2.76,27.85,Math.PI/2,texture(384,216,c=>{
    c.fillStyle='#d2c7aa';c.fillRect(0,0,384,216);
    c.fillStyle='#a6b4ac';c.fillRect(12,12,360,192);
    for(const [ridge,color] of [[80,'#81958e'],[121,'#657d70'],[151,'#53695f']] as const){
      c.fillStyle=color;c.beginPath();c.moveTo(12,204);
      for(let x=12;x<=372;x+=12)c.lineTo(x,ridge+13*Math.sin(x/42+ridge)+8*Math.cos(x/24));
      c.lineTo(372,204);c.fill();
    }
  }));
  panel(.56,.13,exit.x,floorY+exit.slidingHeight+.04,29.945,Math.PI,texture(320,80,c=>{
    c.fillStyle='#38383d';c.fillRect(0,0,320,80);c.fillStyle='#f2eee1';
    c.textAlign='center';c.font='bold 51px sans-serif';c.fillText('A10出口',160,60);
  }));
  // Display glazing beside the corridor mouth, facing the landing.
  panel(5.6,1.18,-1.12,2.28,12.9,Math.PI/2,texture(512,128,c=>{
    c.fillStyle='#494740'; c.fillRect(0,0,512,128);
    for(let i=0;i<6;i++){
      const x=5+i*84;
      c.fillStyle=i%2?'#dfbe83':'#e9d5a0'; c.fillRect(x,5,78,114);
      c.fillStyle='#8e795a'; c.fillRect(x,78,78,5);
      c.fillStyle='#fff1c0'; c.fillRect(x+8,13,61,5);
    }
  }));
  panel(3.4,.46,-7,3.02,18.80,Math.PI,texture(640,96,c=>{
    c.fillStyle='#514439';c.fillRect(0,0,640,96);
    c.fillStyle='#fae7b5';c.font='bold 64px sans-serif';
    c.textAlign='center';c.fillText('雲院書城',320,71);
  }));
  panel(18,1.35,17.8,7.52,2.42,0,texture(1536,128,c=>{
    c.fillStyle='#e1d9bd';c.fillRect(0,0,1536,128);c.fillStyle='#4d7867';
    c.font='bold 85px serif';c.fillText('36',90,98);c.font='44px sans-serif';
    c.fillText('國立雲林科技大學 36 週年校慶',340,55);
    c.fillStyle='#595850';c.fillText('雲起三智・科創六合',370,111);
  }));
  panel(6.8,2.9,35.45,2.59,7.8,-Math.PI/2,texture(1024,448,c=>{
    c.fillStyle='#37393b';c.fillRect(0,0,1024,448);
    for(let i=0;i<5;i++){
      const x=9+i*203; c.fillStyle='#cfc9b6';c.fillRect(x,8,194,85);c.fillRect(x,108,194,329);
      for(let j=0;j<8;j++){c.fillStyle=j%2?'#c4bcaa':'#ded8c7';c.fillRect(x+j*24,111,12,323);}
      c.fillStyle='#a3c9bf';c.fillRect(x,238,194,15);c.fillStyle='#cf944d';c.fillRect(x,394,194,40);
      c.save();c.translate(x+96,345);c.rotate((i%2-.5)*.4);
      c.fillStyle='#44413f';c.beginPath();c.arc(0,-17,9,0,7);c.fill();
      c.strokeStyle='#44413f';c.lineWidth=8;c.beginPath();c.moveTo(-23,-4);c.lineTo(0,1);c.lineTo(20,-14);c.moveTo(0,1);c.lineTo(3,22);c.lineTo(-12,42);c.moveTo(3,22);c.lineTo(23,36);c.stroke();c.restore();
    }
  }));
  scene.add(tracker.object(root));
}
