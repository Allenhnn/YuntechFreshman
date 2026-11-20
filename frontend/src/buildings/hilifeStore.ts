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
import type { CampusData } from '../campus/campusTypes';
import { insidePoint } from '../campus/insidePoint';

/**
 * 萊爾富 in 學生活動中心 1F (the floor plan lists it there): a small convenience store in the lobby —
 * counter with a register and the clerk behind it, two shelves of goods and a drinks cooler at the
 * back, a snack rack at the side, a lit sign board, a floor mat in front. Shopping happens at the
 * counter (story runtime: within reach of `counter`).
 * Local frame: +z points out of the store toward the lobby centre (where customers come from).
 */
export interface HilifeStore {
  /** Where customers stand to shop (in front of the counter). */
  counter: { x: number; z: number };
  /** Where the clerk stands. */
  clerk: { x: number; z: number };
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
    // Three colour bands along the bottom (store sign), name in the middle.
    const bands = ['#e8352b', '#f6a21a', '#1f5fb8'];
    bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * (512 / 3), 92, 512 / 3 + 1, 20); });
    g.fillStyle = '#e8352b';
    g.font = "bold 58px 'PingFang TC', 'Noto Sans TC', system-ui, sans-serif";
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText('萊爾富', 190, 48);
    g.fillStyle = '#1f5fb8';
    g.font = "bold 40px system-ui, sans-serif";
    g.fillText('Hi-Life', 380, 50);
    g.fillStyle = '#f6a21a';
    g.font = "bold 22px system-ui, sans-serif";
    g.fillText('24H', 475, 22);
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createHilifeStore(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): HilifeStore | null {
  const c = insidePoint(campus, '學生活動中心');
  if (!c) return null;
  // Off the lobby centre, facing it.
  const ax = c.x + 5, az = c.z - 3.5;
  const yaw = Math.atan2(c.x - ax, c.z - az); // local +z toward the centre
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const toWorld = (lx: number, lz: number): { x: number; z: number } => {
    const v = new Vector3(lx, 0, lz).applyQuaternion(q);
    return { x: ax + v.x, z: az + v.z };
  };
  const root = new Group();
  root.position.set(ax, 0, az);
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
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x, hy, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
  };
  const white = mat(0xf4f4f2);
  const red = mat(0xe8352b);
  const steel = mat(0xb9c0c4, { metalness: 0.5, roughness: 0.4 });
  const dark = mat(0x2a2d31);

  // Floor: light tiles for the shop, a mat at the entrance side.
  add(new PlaneGeometry(7, 5.4).rotateX(-Math.PI / 2), mat(0xe9e6df, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 0, 0.012, -1.3);
  add(new PlaneGeometry(2.4, 1.0).rotateX(-Math.PI / 2), mat(0x3c4a5a, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), 0, 0.016, 1.9);

  // Counter (white with a red band) and the register.
  add(new BoxGeometry(3.2, 1.0, 0.7), white, 0, 0.5, 0.6);
  add(new BoxGeometry(3.22, 0.12, 0.72), red, 0, 0.82, 0.6);
  add(new BoxGeometry(3.3, 0.05, 0.85), mat(0xd9d4c8), 0, 1.025, 0.6);
  add(new BoxGeometry(0.42, 0.22, 0.34), dark, -0.8, 1.16, 0.6);
  add(new BoxGeometry(0.34, 0.24, 0.04), mat(0x1c2a36, { emissive: 0x3a7bd5, emissiveIntensity: 0.6 }), -0.8, 1.38, 0.5);
  add(new BoxGeometry(0.5, 0.35, 0.35), mat(0xf6a21a), 0.9, 1.2, 0.6); // hot food warmer
  solid(0, 0.6, 1.65, 0.55, 0.4);

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

  // Sign board on two posts behind the shelves, lit.
  const sign = new Mesh(tracker.geometry(new PlaneGeometry(3.8, 0.83)), tracker.material(new MeshStandardMaterial({ map: signTexture(tracker), emissive: 0xffffff, emissiveMap: signTexture(tracker), emissiveIntensity: 0.55, roughness: 0.5 })));
  sign.position.set(0, 2.75, -2.86);
  root.add(sign);
  add(new BoxGeometry(3.95, 0.95, 0.12), white, 0, 2.75, -2.94);
  for (const x of [-1.8, 1.8]) add(new BoxGeometry(0.1, 2.3, 0.1), steel, x, 1.15, -2.95);

  return {
    counter: toWorld(0, 1.6),
    clerk: toWorld(0, -0.3),
    dispose() {
      for (const col of colliders) physics.removeCollider(col, false);
      root.removeFromParent();
    },
  };
}
