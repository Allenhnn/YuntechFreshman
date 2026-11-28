import { rightEntranceFront } from "../campus/activityComplex";
import { BufferGeometry, Float32BufferAttribute, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, TorusGeometry, Vector3, type Scene } from 'three';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';

/** Sign, brickwork and planting on the north approach. Local +Z faces the plaza. */
export function addActivityEntrance(scene: Scene, tracker: ResourceTracker) {
  const root = new Group();
  root.name = 'Student Activity Center north entrance';
  root.position.set(128.18, 0, 168.83);
  root.rotation.y = Math.atan2(-6.28, -35.17);
  const random = mulberry32(296668597);
  const banner = new TextureLoader().load(new URL('./activity-entrance-sign.webp', import.meta.url).href);
  banner.colorSpace = SRGBColorSpace;
  const sign = new Mesh(new PlaneGeometry(35.4, 1.55), new MeshStandardMaterial({ map: banner, roughness: 1 }));
  sign.position.set(17.8, 9.475, 28.815);
  root.add(sign);

  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#725c50';
  ctx.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 8; col++) {
      ctx.fillStyle = ['#a17360','#966b59','#ae806a','#9e7360'][Math.floor(random()*4)]!;
      ctx.fillRect(col*64 + (row%2)*32, row*32, 62, 30);
    }
  }
  const paving = new CanvasTexture(canvas);
  paving.colorSpace = SRGBColorSpace;
  paving.wrapS = paving.wrapT = RepeatWrapping;
  paving.repeat.set(21, 37);
  const plaza = new Mesh(new PlaneGeometry(35.4, 48), new MeshStandardMaterial({ map: paving, color: 0xbba593, roughness: 1 }));
  plaza.rotation.x = -Math.PI/2;
  plaza.position.set(17.8, .079, 24);
  plaza.receiveShadow = true;
  root.add(plaza);

  // Square paving distinguishes the recessed side entry from the brick plaza.
  const grid = document.createElement('canvas'); grid.width=grid.height=64;
  const grout=grid.getContext('2d')!;
  grout.fillStyle='#81796b'; grout.fillRect(0,0,64,64);
  grout.fillStyle='#aaa194'; grout.fillRect(1,1,62,62);
  const tiles=new CanvasTexture(grid);tiles.colorSpace=SRGBColorSpace;
  tiles.wrapS=tiles.wrapT=RepeatWrapping;tiles.repeat.set(32,33);
  const apron=new Mesh(new PlaneGeometry(12.4,12.9),new MeshStandardMaterial({map:tiles,roughness:1}));
  apron.rotation.x=-Math.PI/2;apron.position.set(-2.45,.085,32.05);root.add(apron);
  const rightApron=new Mesh(new PlaneGeometry(8.25,4.45),new MeshStandardMaterial({map:tiles,roughness:1}));
  rightApron.rotation.x=-Math.PI/2;rightApron.position.set(36.625,.088,31.125);root.add(rightApron);

  // Small mottled ceramic tiles wrap the two curved fascias and the stair jamb.
  const mosaic=document.createElement('canvas'); mosaic.width=mosaic.height=256;
  const ceramic=mosaic.getContext('2d')!, glaze=mulberry32(89576);
  ceramic.fillStyle='#8b867e';ceramic.fillRect(0,0,256,256);
  for(let row=0;row<32;row++) for(let col=0;col<32;col++) {
    const value=Math.round(170+glaze()*26);
    ceramic.fillStyle='rgb('+value+','+(value-3)+','+(value-10)+')';
    ceramic.fillRect(col*8+.4,row*8+.4,7.2,7.2);
  }
  const enamel=new CanvasTexture(mosaic);enamel.colorSpace=SRGBColorSpace;
  enamel.wrapS=enamel.wrapT=RepeatWrapping;
  const positions:number[]=[],coords:number[]=[],indices:number[]=[];
  function tiledFace(x:number,z:number,endX:number,endZ:number,base:number,top:number,u:number) {
    const k=positions.length/3, end=u+Math.hypot(endX-x,endZ-z);
    positions.push(x,base,z,endX,base,endZ,endX,top,endZ,x,top,z);
    coords.push(u,base,end,base,end,top,u,top);
    indices.push(k,k+1,k+2,k,k+2,k+3);
    return end;
  }
  let distance=0;
  for(let i=0;i<32;i++) {
    const x=32.5+i*8.25/32,endX=32.5+(i+1)*8.25/32;
    const z=-rightEntranceFront(x)+.008,endZ=-rightEntranceFront(endX)+.008;
    tiledFace(x,z,endX,endZ,7.36,8.50,distance);
    distance=tiledFace(x,z,endX,endZ,3.61,4.71,distance);
  }
  tiledFace(40.74,31.45,40.74,26.22,.09,3.55,0);
  tiledFace(40.74,26.22,40.74,18.5,1.125,3.55,5.23);
  tiledFace(40.74,31.45,40.74,25.1,3.86,7.32,0);
  const facing=new BufferGeometry();
  facing.setAttribute('position',new Float32BufferAttribute(positions,3));
  facing.setAttribute('uv',new Float32BufferAttribute(coords,2));
  facing.setIndex(indices);facing.computeVertexNormals();
  root.add(new Mesh(facing,new MeshStandardMaterial({map:enamel,side:DoubleSide,roughness:.93})));
  const drum=new CylinderGeometry(.31,.30,.95,16), lid=new CylinderGeometry(.325,.325,.055,16);
  const blue=new MeshStandardMaterial({color:0x304e86}), rimBlue=new MeshStandardMaterial({color:0x283e66});
  for(const z of [23.55,24.25]) for(const x of [1.68,2.37,3.06]) {
    const bin=new Mesh(drum,blue),cap=new Mesh(lid,rimBlue);
    bin.position.set(x,.565,z);cap.position.set(x,1.05,z);root.add(bin,cap);
  }
  const welcome=document.createElement('canvas');welcome.width=256;welcome.height=384;
  const art=welcome.getContext('2d')!;
  art.fillStyle='#cfe2e1';art.fillRect(0,0,256,384);
  art.fillStyle='#696292';art.font='bold 43px sans-serif';art.textAlign='center';art.fillText('YunTech',128,62);
  for(const [x,y,color] of [[68,220,'#d5a579'],[135,244,'#9cc68b'],[199,207,'#ad95bc']] as const){
    art.fillStyle=color;art.beginPath();art.ellipse(x,y,37,52,0,0,Math.PI*2);art.fill();
    art.fillStyle='#50485b';for(const eye of [-11,11]){art.beginPath();art.arc(x+eye,y-6,3,0,Math.PI*2);art.fill();}
  }
  art.fillStyle='#665f89';art.fillRect(0,330,256,54);art.fillStyle='white';art.font='bold 25px sans-serif';
  art.fillText('新生領航營',128,365);
  const print=new CanvasTexture(welcome);print.colorSpace=SRGBColorSpace;
  const poster=new Mesh(new CylinderGeometry(1,1,4.35,12,1,true,.16,.86),
    new MeshStandardMaterial({map:print,roughness:.95,side:DoubleSide}));
  poster.scale.set(4.66,1,1.66);poster.position.set(-6.08,3.75,28.5);root.add(poster);

  // Clusters of narrow, pointed cordyline leaves above the clipped green hedge.
  const leaf = new PlaneGeometry(1,1,1,2);
  const pos = leaf.attributes.position!;
  for (let i=0;i<pos.count;i++) {
    const y=pos.getY(i);
    pos.setX(i,pos.getX(i)*(y===0 ? 1 : .06));
    pos.setZ(i,y*y*.65);
  }
  leaf.computeVertexNormals();
  const plants = new InstancedMesh(leaf,new MeshStandardMaterial({side:DoubleSide,roughness:.9}),2*40*9);
  const transform = new Object3D(), tint = new Color();
  let index=0;
  for (const start of [2,24.5]) {
    for(let plant=0; plant<40; plant++) {
      const x=(start===2?4.15:start)+(plant%20)*(start===2?.37:.48), z=27.5+Math.floor(plant/20)*.5;
      for(let k=0;k<9;k++) {
        const yaw=random()*Math.PI*2, spread=.25+random()*.18;
        transform.position.set(x+Math.sin(yaw)*spread,1.78+random()*.4,z+Math.cos(yaw)*spread);
        transform.rotation.set(.4+random()*.55,yaw,0,'YXZ');
        transform.scale.set(.19+random()*.1,.85+random()*.4,1);
        transform.updateMatrix();
        plants.setMatrixAt(index,transform.matrix);
        plants.setColorAt(index++,tint.set(['#632839','#873747','#59303b','#9c4e56'][Math.floor(random()*4)]!));
      }
    }
  }
  root.add(plants);

  const tyre = new MeshStandardMaterial({color:0x292724}), tube = new CylinderGeometry(.024,.024,1,6);
  const rim = new TorusGeometry(.34,.035,6,24), axis = new Vector3(0,1,0);
  for (const [x,z,yaw,paint] of [[2.42,26.45,.75,0xc4c4b9],[7,30.5,.22,0x517974],[9.3,30.1,-.15,0x84564c],[27,30,.32,0x65706a]] as const) {
    const bike=new Group(), enamel=new MeshStandardMaterial({color:paint});
    bike.position.set(x,.09,z); bike.rotation.y=yaw;
    for(const wx of [-.56,.56]) {
      const wheel=new Mesh(rim,tyre); wheel.position.set(wx,.35,0); bike.add(wheel);
    }
    const bar=(ax:number,ay:number,bx:number,by:number,material=enamel)=>{
      const d=new Vector3(bx-ax,by-ay,0), mesh=new Mesh(tube,material);
      mesh.position.set((ax+bx)/2,(ay+by)/2,0); mesh.scale.y=d.length();
      mesh.quaternion.setFromUnitVectors(axis,d.normalize()); bike.add(mesh);
    };
    bar(-.56,.35,-.18,.84); bar(-.56,.35,0,.4); bar(0,.4,-.18,.84);
    bar(-.18,.84,.37,.82); bar(0,.4,.37,.82); bar(.56,.35,.33,1.02);
    bar(-.31,.88,-.07,.88,tyre); bar(.24,1.03,.45,1.03,tyre);
    root.add(bike);
  }
  scene.add(tracker.object(root));
}
