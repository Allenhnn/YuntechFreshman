import { BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Vector3, type Scene } from 'three';
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
  const floor=new Mesh(new PlaneGeometry(30.7,28.44),new MeshStandardMaterial({map:tile,roughness:.88}));
  floor.position.set(17.15,1.128,13.67); floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; root.add(floor);

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
  shade.position.set(5.5,1.136,11.5);shade.rotation.x=-Math.PI/2;root.add(shade);

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
  // Display glazing beside the corridor mouth, facing the landing.
  panel(5.6,1.18,.18,2.28,8,Math.PI/2,texture(512,128,c=>{
    c.fillStyle='#494740'; c.fillRect(0,0,512,128);
    for(let i=0;i<6;i++){
      const x=5+i*84;
      c.fillStyle=i%2?'#dfbe83':'#e9d5a0'; c.fillRect(x,5,78,114);
      c.fillStyle='#8e795a'; c.fillRect(x,78,78,5);
      c.fillStyle='#fff1c0'; c.fillRect(x+8,13,61,5);
    }
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
