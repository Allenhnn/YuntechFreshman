import { BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, type Scene } from 'three';
import { mulberry32 } from '../core/math';
import type { ResourceTracker } from '../core/resources';

/** Rounded west wing seen on the right when approaching the north entrance. */
export function addActivityCorner(scene: Scene, tracker: ResourceTracker) {
  const wing = new Group();
  wing.name = 'Student centre poster corner';
  wing.position.set(79.93, 0, 147.1);
  wing.rotation.y = Math.atan2(-7.52, -44.13);
  const mat = (color: number) => new MeshStandardMaterial({ color, roughness: .94 });
  const loader = new TextureLoader();
  const photo = (url: string) => {
    const map = loader.load(url);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    return new MeshStandardMaterial({ map, roughness: 1, side: DoubleSide });
  };
  const cement = mat(0x88867d), casing = mat(0xc2bcb0), vent = mat(0x585954);
  const cube = new BoxGeometry();
  const box = (x:number,y:number,z:number,w:number,h:number,d:number, material:MeshStandardMaterial) => {
    const piece = new Mesh(cube, material);
    piece.position.set(x,y,z); piece.scale.set(w,h,d); wing.add(piece);
  };
  // Follow the turn from the straight window bays to the courtyard. Both the
  // print and its concrete backing wrap around the same radius.
  const radius = 6.2, height = 11.42;
  function arc(inner: number, outer: number, low: number, high: number, material: MeshStandardMaterial) {
    const p:number[] = [], uv:number[] = [], indices:number[] = [];
    for (let i=0; i<=32; i++) {
      const t=i/32, angle=t*Math.PI*.49;
      for (const [r,y,v] of [[inner,low,0],[outer,high,1]]) {
        p.push(-r!*Math.sin(angle),y!,r!*Math.cos(angle)-radius);
        uv.push(1-t,v!);
      }
      const k=i*2;
      if(i>0) indices.push(k-2,k-1,k,k,k-1,k+1);
    }
    const geo=new BufferGeometry();
    geo.setAttribute('position',new Float32BufferAttribute(p,3));
    geo.setAttribute('uv',new Float32BufferAttribute(uv,2));
    geo.setIndex(indices); geo.computeVertexNormals();
    wing.add(new Mesh(geo,material));
  }
  arc(6.44,6.44,.02,height,photo(new URL('./activity-corner.webp',import.meta.url).href));
  cement.side=DoubleSide;
  arc(6.47,6.47,height-.13,height+.02,cement);
  arc(5.45,6.47,height+.02,height+.02,cement);
  const width=13.2;
  const front = new Mesh(new PlaneGeometry(width,height),photo(new URL('./activity-window-bays.webp',import.meta.url).href));
  front.position.set(width/2,height/2,.24); wing.add(front);
  // Projecting lower bay: carry the barred windows onto its outer face.
  const bayStart=5.2, bayEnd=12.95, bayHeight=5.2;
  const bayGeo=new PlaneGeometry(bayEnd-bayStart,bayHeight);
  const bayUV=bayGeo.attributes.uv!;
  for(let i=0;i<bayUV.count;i++) bayUV.setXY(i,(bayStart+bayUV.getX(i)*(bayEnd-bayStart))/width,bayUV.getY(i)*bayHeight/height);
  const bay=new Mesh(bayGeo,front.material);
  bay.position.set((bayStart+bayEnd)/2,bayHeight/2,1.05); wing.add(bay);
  for(const x of [bayStart,bayEnd]) box(x,bayHeight/2,.64,.14,bayHeight,.82,cement);
  box((bayStart+bayEnd)/2,bayHeight,.64,bayEnd-bayStart+.16,.18,.94,cement);
  for(const x of [bayStart,bayStart+2.6,bayStart+5.2,bayEnd]) box(x,bayHeight+.32,1.04,.045,.65,.045,vent);
  for(const y of [bayHeight+.32,bayHeight+.62]) box((bayStart+bayEnd)/2,y,1.04,bayEnd-bayStart,.045,.045,vent);
  box(width/2,height-.045,.13,width,.13,.26,cement);
  box(width-.08,height/2,.12,.16,height,.28,cement);
  // The condenser boxes cast real side shadows when seen along the wall.
  const fan = new CylinderGeometry(.26,.26,.04,16);
  for (const x of [.72,7.2,11.7]) {
    box(x,8.49,.49,1.05,.68,.5,casing);
    const grille=new Mesh(fan,vent);
    grille.rotation.x=Math.PI/2; grille.position.set(x-.12,8.49,.755); wing.add(grille);
    for (let row=-2;row<=2;row++) box(x-.12,8.49+row*.078,.784,.40,.018,.018,casing);
    for (const offset of [-.38,.38]) box(x+offset,8.10,.44,.08,.1,.44,vent);
  }
  // Grey interlocking paving continues from the edge of the brick forecourt.
  const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=128;
  const ctx=canvas.getContext('2d')!, random=mulberry32(597);
  ctx.fillStyle='#66645c'; ctx.fillRect(0,0,256,128);
  for(let row=0;row<4;row++) for(let col=-1;col<4;col++) {
    const x=col*64+(row%2)*32,y=row*32, tone=Math.floor(117+random()*20);
    ctx.fillStyle='rgb('+tone+','+(tone-1)+','+(tone-8)+')';
    ctx.beginPath(); ctx.moveTo(x+2,y+1); ctx.lineTo(x+62,y+1); ctx.lineTo(x+62,y+10);
    ctx.lineTo(x+66,y+13); ctx.lineTo(x+66,y+20); ctx.lineTo(x+62,y+23); ctx.lineTo(x+62,y+31);
    ctx.lineTo(x+2,y+31);ctx.lineTo(x+2,y+23);ctx.lineTo(x+6,y+20);ctx.lineTo(x+6,y+13);ctx.lineTo(x+2,y+10);ctx.fill();
  }
  const paving=new CanvasTexture(canvas); paving.colorSpace=SRGBColorSpace;
  paving.wrapS=paving.wrapT=RepeatWrapping; paving.repeat.set(21,12);
  // Extend the corner strip around the arc until it meets the brick forecourt.
  const pavingGeo=new PlaneGeometry(24.5,7.5,50,1), positions=pavingGeo.attributes.position!;
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i)+2.1;
    if(positions.getY(i)>0 && x<0) {
      const front=-radius+Math.sqrt(Math.max(0,radius*radius-x*x));
      positions.setY(i,3.85-front);
    }
  }
  const apron=new Mesh(pavingGeo, new MeshStandardMaterial({map:paving,roughness:1}));
  apron.rotation.x=-Math.PI/2; apron.position.set(2.1,.085,3.85); apron.receiveShadow=true;
  wing.add(apron); scene.add(tracker.object(wing));
}
