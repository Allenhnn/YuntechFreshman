import { DoubleSide, BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Shape, ShapeGeometry, RepeatWrapping, SRGBColorSpace, Vector3, type Scene } from 'three';
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
  // Glazed upper gallery facing the bookstore. Its lower edge sits on the parapet.
  for(const y of [3.6,7.2]){
    block(-13,y,9.97,26,1.20,.15,0xb9b5aa);
    block(-13,y+2.59,9.97,26,1.01,.15,0xb9b5aa);
    for(let x=-25;x<0;x+=2){
      block(x,y+1.2,9.97,1.94,1.39,.08,0x526268);
      block(x,y+1.2,10.025,.055,1.39,.045,0x383e40);
      block(x-.97,y+1.2,10, .10,1.39,.14,0xaaa79e);
    }
  }
  // A curved planting bed hugs the B1 stair nose. Both side entrances stay clear.
  for(let i=0;i<18;i++){
    const point=(j:number,y:number,r:number)=>{
      const angle=(j/18-.5)*Math.PI*.82;
      return [-16.5+(1.65+r)*Math.cos(angle),y,12.8+(2.8+r)*Math.sin(angle)];
    };
    member(point(i,-2.20,.32),point(i+1,-2.20,.32),.40,.38,0xa29c8e);
    member(point(i,-1.99,.24),point(i+1,-1.99,.24),.26,.2,i%3?0x798757:0x94a36a);
  }
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
