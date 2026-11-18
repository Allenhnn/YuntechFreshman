import { BoxGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3, type Material, type Scene } from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { HandBuiltBuilding } from './buildingWorld';

/**
 * The covered 2F sky bridge between 管理二館 and 管理一館 (after the photos): a deck at the 2F
 * floor, washed-stone parapets with a steel handrail, a concrete roof slab with downstand beams on
 * slim columns, two piers to the ground, and a red-brick mosaic panel on the 管理二館 end wall.
 * Ends are given in each building's plan coordinates, so the bridge follows the traced doors.
 */
export interface BridgeEnd {
  building: HandBuiltBuilding;
  /** Door centre on the building's outer wall (plan metres). */
  at: [number, number];
}

const WIDTH = 2.6;
const PARAPET = 1.05;
const CLEAR = 2.9; // deck to underside of the roof
const DECK_T = 0.35;

function grain(color: string, speck: string[], tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    let s = 3;
    const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = speck[i % speck.length]!;
      g.globalAlpha = 0.25 + r() * 0.4;
      g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2);
    }
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function brickMosaic(tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#d8d4cc';
    g.fillRect(0, 0, 256, 256);
    let s = 11;
    const r = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const k = r();
        g.fillStyle = k < 0.12 ? '#2e3433' : k < 0.2 ? '#5b6a64' : ['#b65d43', '#a9533b', '#c06a4d', '#9e4c37'][Math.floor(r() * 4)]!;
        g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
      }
    }
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createSkyBridge(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, from: BridgeEnd, to: BridgeEnd, level: number): { dispose(): void } {
  const [ax, az] = from.building.planToWorld(from.at[0], from.at[1]);
  const [bx, bz] = to.building.planToWorld(to.at[0], to.at[1]);
  const len = Math.hypot(bx - ax, bz - az);
  const yaw = Math.atan2(-(bz - az), bx - ax); // local +x runs from `from` to `to`
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const root = new Group();
  root.name = 'sky bridge';
  root.position.set((ax + bx) / 2, level, (az + bz) / 2);
  root.rotation.y = yaw;
  scene.add(root);

  const stoneTex = grain('#a9a7a0', ['#7f7d77', '#c9c6be', '#6b6964', '#d8d5cd'], tracker);
  const stone = tracker.material(new MeshStandardMaterial({ map: stoneTex, roughness: 0.9 }));
  const concrete = tracker.material(new MeshStandardMaterial({ color: 0xc9c7c1, roughness: 0.85 }));
  const floor = tracker.material(new MeshStandardMaterial({ color: 0x9a9c99, roughness: 0.7 }));
  const steel = tracker.material(new MeshStandardMaterial({ color: 0xd4d7da, roughness: 0.25, metalness: 0.85 }));
  const colliders: RAPIER.Collider[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: Material, solid: boolean): void => {
    const m = new Mesh(tracker.geometry(new BoxGeometry(w, h, d)), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    if (!solid) return;
    const p = new Vector3(x, level + y + h / 2, z).applyQuaternion(q).add(new Vector3(root.position.x, 0, root.position.z));
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  };
  // Run 0.3 m into each building so the deck meets its floor without a seam.
  const L = len + 0.6, half = WIDTH / 2;
  box(L, DECK_T, WIDTH + 0.4, 0, -DECK_T, 0, concrete, true); // deck (top at the 2F floor)
  box(L, 0.04, WIDTH, 0, 0, 0, floor, false); // tiled walking surface
  for (const side of [-1, 1]) {
    box(len - 0.2, PARAPET, 0.22, 0, 0, side * (half + 0.09), stone, true); // parapet
    box(len - 0.2, 0.05, 0.06, 0, PARAPET + 0.12, side * (half + 0.09), steel, false); // handrail
    for (let x = -len / 2 + 1; x < len / 2 - 0.5; x += 1.6) box(0.04, 0.12, 0.04, x, PARAPET, side * (half + 0.09), steel, false);
  }
  // Roof slab with downstand beams on four columns per side.
  box(L, 0.22, WIDTH + 1.0, 0, CLEAR, 0, concrete, false);
  const bays = Math.max(2, Math.round(len / 5));
  for (let i = 0; i <= bays; i++) {
    const x = -len / 2 + 0.3 + ((len - 0.6) * i) / bays;
    box(0.25, 0.35, WIDTH + 1.0, x, CLEAR - 0.35, 0, concrete, false);
    for (const side of [-1, 1]) box(0.24, CLEAR - PARAPET, 0.24, x, PARAPET, side * (half + 0.09), stone, false);
  }
  // Piers to the ground at the third points.
  for (const t of [-1 / 6, 1 / 6]) box(0.5, level - DECK_T, 0.9, t * len, -level, 0, stone, true);
  // Red-brick mosaic on the 管理二館 end, beside the door.
  const mosaic = new Mesh(tracker.geometry(new BoxGeometry(0.02, 2.2, 2.0)), tracker.material(new MeshStandardMaterial({ map: brickMosaic(tracker), roughness: 0.6 })));
  mosaic.position.set(-len / 2 + 0.25, 0.3 + 1.1, -half - 1.4);
  root.add(mosaic);

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
