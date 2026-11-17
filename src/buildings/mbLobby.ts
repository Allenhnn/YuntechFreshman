import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { HandBuiltBuilding } from './buildingWorld';

/**
 * 管理二館 1F breezeway lobby, the parts the plan pipeline can't draw (see the lobby block in
 * scripts/floorplan/handbuilt/mb.py, whose wave this must match):
 *  - the 2F floor edge over the double-height breezeway: a smooth wave of mosaic parapet with a
 *    steel handrail, its face running down over the slab edge;
 *  - the parapet along the 2F floor east of the void.
 * (The stair outside 107 is an ordinary black-curtain flight in the plan.)
 * All in 管理二館's plan frame; the 2F floor is at FH.
 */
const FH = 3.6;
const X0 = 41.9, X1 = 52.1;
const wave = (x: number): number => 45.5 + 0.8 * Math.sin((2 * Math.PI * (x - X0)) / (X1 - X0));
const SOUTH_Y = 55.7; // south wall
const PARAPET = { t: 0.22, top: FH + 1.0, bottom: FH - 0.5 };

export function createMbLobby(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, mb: HandBuiltBuilding): { dispose(): void } {
  const [ox, oz] = mb.planToWorld(0, 0), [px1, pz1] = mb.planToWorld(1, 0);
  const yaw = -Math.atan2(pz1 - oz, px1 - ox);
  const g = new Group();
  g.name = 'MB lobby';
  g.position.set(ox, 0, oz);
  g.rotation.y = yaw; // local +x = plan +X, local +z = plan +Y
  scene.add(g);
  const colliders: RAPIER.Collider[] = [];
  const up = new Vector3(0, 1, 0);
  /** Box collider: centre (plan x, height, plan y), half sizes along / up / across, direction angle in plan. */
  const solid = (cx: number, cy: number, h0: number, h1: number, len: number, thick: number, ang = 0): void => {
    const [wx, wz] = mb.planToWorld(cx, cy);
    const q = new Quaternion().setFromAxisAngle(up, yaw - ang);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, (h1 - h0) / 2, thick / 2).setTranslation(wx, (h0 + h1) / 2, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  };

  const mosaicTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    if (x) {
      let s = 9;
      const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
      const tones = ['#d9d6cf', '#c9c5bc', '#e6e3dc', '#b8b4ab', '#d0ccc3', '#a9a59c'];
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
          x.fillStyle = tones[Math.floor(r() * tones.length)]!;
          x.fillRect(i * 8, j * 8, 7, 7);
        }
      }
      x.fillStyle = '#9e9a92';
      for (let i = 0; i < 16; i++) { x.fillRect(i * 8 + 7, 0, 1, 128); x.fillRect(0, i * 8 + 7, 128, 1); }
    }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  })();
  const mosaic = tracker.material(new MeshStandardMaterial({ map: mosaicTex, roughness: 0.6, side: DoubleSide }));
  const steel = tracker.material(new MeshStandardMaterial({ color: 0xc3c7cb, roughness: 0.25, metalness: 0.85 }));
  const glass = tracker.material(new MeshStandardMaterial({ color: 0xbfd6e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false, side: DoubleSide }));

  const boxes = new Map<Material, BufferGeometry[]>();
  const box = (m: Material, w: number, h: number, d: number, x: number, y: number, z: number, ang = 0): void => {
    const geo = new BoxGeometry(w, h, d).rotateY(-ang).translate(x, y, z);
    const list = boxes.get(m);
    if (list) list.push(geo);
    else boxes.set(m, [geo]);
  };

  // --- Wave parapet: a ribbon along the curve plus a run along the landing edge -----------------
  const path: [number, number][] = [];
  for (let x = X0; x <= X1 + 1e-6; x += 0.1) path.push([x, wave(x)]);
  for (let y = wave(X1) + 0.2; y < SOUTH_Y - 0.15; y += 0.4) path.push([X1, y]);
  path.push([X1, SOUTH_Y - 0.12]);
  const pos: number[] = [], uv: number[] = [];
  let run = 0;
  const T = PARAPET.t / 2;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i]!, [bx, by] = path[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    for (const side of [-1, 1]) {
      const o = side * T;
      const a0 = [ax + nx * o, PARAPET.bottom, ay + ny * o], a1 = [ax + nx * o, PARAPET.top, ay + ny * o];
      const b0 = [bx + nx * o, PARAPET.bottom, by + ny * o], b1 = [bx + nx * o, PARAPET.top, by + ny * o];
      pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
      const u0 = run / 1.2, u1 = (run + len) / 1.2, v0 = 0, v1 = (PARAPET.top - PARAPET.bottom) / 1.2;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
    // Cap.
    const c = [[ax - nx * T, ay - ny * T], [bx - nx * T, by - ny * T], [bx + nx * T, by + ny * T], [ax + nx * T, ay + ny * T]];
    const P = (k: number): number[] => [c[k]![0], PARAPET.top, c[k]![1]];
    pos.push(...P(0), ...P(1), ...P(2), ...P(0), ...P(2), ...P(3));
    uv.push(0, 0, 0.2, 0, 0.2, 0.2, 0, 0, 0.2, 0.2, 0, 0.2);
    run += len;
    // Handrail on brackets, and collision.
    const ang = Math.atan2(by - ay, bx - ax);
    box(steel, len + 0.01, 0.05, 0.06, (ax + bx) / 2, PARAPET.top + 0.12, (ay + by) / 2, ang);
    solid((ax + bx) / 2, (ay + by) / 2, FH, PARAPET.top + 0.15, len + 0.02, PARAPET.t, ang);
  }
  for (let i = 0; i < path.length; i += 10) {
    const [x, y] = path[i]!;
    box(steel, 0.03, 0.12, 0.03, x, PARAPET.top + 0.06, y);
  }
  const ribbon = new BufferGeometry();
  ribbon.setAttribute('position', new Float32BufferAttribute(pos, 3));
  ribbon.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  ribbon.computeVertexNormals();
  const parapet = new Mesh(tracker.geometry(ribbon), mosaic);
  parapet.castShadow = parapet.receiveShadow = true;
  g.add(parapet);

  for (const [m, list] of boxes) {
    const mesh = new Mesh(tracker.geometry(mergeGeometries(list) ?? list[0]!), m);
    mesh.castShadow = m !== glass;
    mesh.receiveShadow = true;
    if (m === glass) mesh.renderOrder = 1;
    g.add(mesh);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      g.removeFromParent();
    },
  };
}
