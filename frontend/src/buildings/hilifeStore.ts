import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { HandBuiltBuilding } from './buildingWorld';

/** The shop faces the bookshop across the activity centre's first-floor lightwell. */
export interface HilifeStore {
  /** Where customers stand to shop (in front of the counter). */
  counter: { x: number; y: number; z: number };
  /** Where the clerk stands. */
  clerk: { x: number; y: number; z: number };
  dispose(): void;
}

const PRODUCT_COLORS = [0xd8553a, 0xf2c230, 0x2c6fd6, 0x1f8f4a, 0xf48fb1, 0xffffff, 0x8a5bd6, 0xf08a24].map((c) => new Color(c));

function signTexture(tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 112;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 112);
    g.fillStyle='#bf5575';g.fillRect(0,20,512,39);
    g.fillStyle='#346699';g.fillRect(0,69,512,19);
    g.fillStyle='#fcf7ea';g.fillRect(166,0,180,112);
    g.textAlign='center';g.fillStyle='#b83450';
    g.font='bold 40px sans-serif';g.fillText('Hi-Life',256,46);
    g.font='bold 27px sans-serif';g.fillText('萊爾富',256,84);
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createHilifeStore(scene: Scene, physics: RAPIER.World, building: HandBuiltBuilding, tracker: ResourceTracker): HilifeStore {
  const level=building.source.levels.find(l=>l.id==='1F')!;
  const shop=building.source.floors['1F']!.spaces.find(s=>s.name==='萊爾富')!;
  const [left,,right,front]=shop.rects[0]!;
  const [ax,az]=building.planToWorld((left+right)/2,front-2);
  const floorY=level.elevation+.08;
  const [fx,fz]=building.planToWorld((left+right)/2,front);
  const yaw=Math.atan2(fx-ax,fz-az);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const toWorld = (lx: number, lz: number): { x: number; y: number; z: number } => {
    const v = new Vector3(lx, 0, lz).applyQuaternion(q);
    return { x: ax + v.x, y: floorY, z: az + v.z };
  };
  const root = new Group();
  root.name = 'Hi-Life';
  root.position.set(ax, floorY, az);
  root.quaternion.copy(q);
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];
  const mat = (color: number, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
  const add = (geo: BufferGeometry, m: MeshStandardMaterial, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(tracker.geometry(geo), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const solid = (lx: number, lz: number, hx: number, hy: number, hz: number): void => {
    const p = toWorld(lx, lz);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x, floorY+hy, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
  };
  const white = mat(0xf4f4f2);
  const red = mat(0xe8352b);
  const steel = mat(0xb9c0c4, { metalness: 0.5, roughness: 0.4 });
  const dark = mat(0x2a2d31);

  // Floor: light tiles for the shop, a mat at the entrance side.
  add(new PlaneGeometry(7, 5.4).rotateX(-Math.PI / 2), mat(0xe9e6df, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 0, 0.012, -1.3);
  add(new PlaneGeometry(2.4, 1.0).rotateX(-Math.PI / 2), mat(0x318887, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), 0, 0.016, 1.35);

  // Checkout on the right as seen through the doors, with the clerk behind it.
  add(new BoxGeometry(.82,.98,2.15),white,1.74,.49,.17);
  add(new BoxGeometry(.93,.07,2.23),mat(0xb6a28b),1.74,1.015,.17);
  add(new BoxGeometry(.36,.26,.32),dark,1.74,1.19,.38);
  add(new BoxGeometry(.34,.23,.05),mat(0x526375),1.74,1.41,.32);
  add(new BoxGeometry(.44,.32,.4),mat(0xe1aa64),1.74,1.23,-.52);
  solid(1.74,.17,.47,.54,1.12);

  // Back shelves with rows of goods (instanced boxes).
  const shelves: { x: number; z: number }[] = [{ x: -1.5, z: -2.6 }, { x: 1.0, z: -2.6 }];
  const goods: Matrix4[] = [];
  const m4 = new Matrix4(), one = new Vector3(1, 1, 1), qi = new Quaternion();
  for (const s of shelves) {
    // Back board and sides; shelf boards stick out in front with the goods on them.
    add(new BoxGeometry(2.2, 1.9, 0.08), steel, s.x, 0.95, s.z - 0.21);
    for (const side of [-1, 1]) add(new BoxGeometry(0.05, 1.9, 0.5), steel, s.x + side * 1.08, 0.95, s.z);
    for (let row = 0; row < 4; row++) {
      add(new BoxGeometry(2.2, 0.03, 0.46), mat(0xdfe3e5), s.x, 0.22 + row * 0.45, s.z + 0.02);
      for (let k = 0; k < 9; k++) goods.push(m4.clone().compose(new Vector3(s.x - 0.95 + k * 0.235, 0.36 + row * 0.45, s.z + 0.06), qi, one));
    }
    solid(s.x, s.z, 1.1, 0.95, 0.3);
  }
  // Drinks cooler: steel frame, lit glass door, bottles.
  // Hollow frame (back, sides, top, base) so the bottles show through the glass door.
  add(new BoxGeometry(1.4, 2.1, 0.05), steel, 2.95, 1.05, -1.93);
  for (const side of [-1, 1]) add(new BoxGeometry(0.06, 2.1, 0.7), steel, 2.95 + side * 0.67, 1.05, -1.6);
  add(new BoxGeometry(1.4, 0.18, 0.7), steel, 2.95, 2.01, -1.6);
  add(new BoxGeometry(1.4, 0.2, 0.7), steel, 2.95, 0.1, -1.6);
  for (let row = 0; row < 4; row++) add(new BoxGeometry(1.28, 0.02, 0.6), mat(0xe8eef1), 2.95, 0.22 + row * 0.42, -1.62);
  add(new BoxGeometry(1.25, 1.75, 0.03), mat(0xcfe8f4, { transparent: true, opacity: 0.3, emissive: 0xbfe3ff, emissiveIntensity: 0.3 }), 2.95, 1.08, -1.26);
  for (let row = 0; row < 4; row++) for (let k = 0; k < 5; k++) goods.push(m4.clone().compose(new Vector3(2.52 + k * 0.215, 0.41 + row * 0.42, -1.55), qi, new Vector3(0.6, 1.4, 0.6)));
  solid(2.95, -1.6, 0.7, 1.05, 0.35);
  // Snack rack at the side.
  add(new BoxGeometry(0.6, 1.3, 1.6), steel, -3.0, 0.65, -0.8);
  for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) goods.push(m4.clone().compose(new Vector3(-2.7, 0.35 + row * 0.4, -1.4 + k * 0.3), qi, one));
  solid(-3.0, -0.8, 0.3, 0.65, 0.8);
  const prod = new InstancedMesh(tracker.geometry(new BoxGeometry(0.18, 0.26, 0.16)), mat(0xffffff, { roughness: 0.5 }), goods.length);
  goods.forEach((g, i) => { prod.setMatrixAt(i, g); prod.setColorAt(i, PRODUCT_COLORS[(i * 7 + (i >> 3)) % PRODUCT_COLORS.length]!); });
  prod.castShadow = true;
  root.add(prod);

  const signMap=signTexture(tracker);
  const signMat=mat(0xffffff,{map:signMap,emissive:0xffffff,emissiveMap:signMap,emissiveIntensity:.45});
  add(new PlaneGeometry(7.96,.40),signMat,0,2.17,2.03);
  const glass=mat(0xe1f2f4,{transparent:true,opacity:.13,depthWrite:false});
  for(const side of [-1,1]) {
    const cx=side*2.51;
    add(new BoxGeometry(2.96,1.97,.045),glass,cx,.985,2);
    solid(cx,2,1.48,.985,.023);
    for(const x of [side*1.03,side*3.98]) add(new BoxGeometry(.055,1.97,.08),steel,x,.985,2);
    add(new BoxGeometry(2.96,.065,.06),white,cx,.82,2);
  }
  // Life-ET kiosk, overhead display and rows of square ceiling lights.
  add(new BoxGeometry(.65,1.13,.56),red,3.32,.565,1.14);
  add(new BoxGeometry(.64,.44,.47),white,3.32,1.35,1.14);
  add(new BoxGeometry(.47,.28,.04),dark,3.32,1.36,1.39);
  solid(3.32,1.14,.325,.8,.28);
  add(new BoxGeometry(.95,.47,.1),mat(0x526998,{emissive:0x45557b}),2.85,1.94,-.85);
  const diffuser=mat(0xfff9e5,{emissive:0xfff6dc,emissiveIntensity:.85});
  for(const x of [-2.7,0,2.7]) for(const z of [-3,-.9,1.2])
    add(new BoxGeometry(.66,.035,.62),diffuser,x,2.12,z);
  return {
    counter: toWorld(.85,.3),
    clerk: toWorld(2.65,.2),
    dispose() {
      for (const col of colliders) physics.removeCollider(col, false);
      root.removeFromParent();
    },
  };
}
