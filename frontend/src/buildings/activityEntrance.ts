import { CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, TorusGeometry, Vector3, type Scene } from 'three';
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
      const x=start+(plant%20)*.48, z=27.5+Math.floor(plant/20)*.5;
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
  for (const [x,z,yaw,paint] of [[7,30.5,.22,0x517974],[9.3,30.1,-.15,0x84564c],[27,30,.32,0x65706a]] as const) {
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
