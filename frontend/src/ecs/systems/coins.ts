import { addComponent, addEntity, query, removeEntity, type World } from 'bitecs';
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../../core/resources';
import { Collectible, Transform } from '../components';

/** NT$10 coin, scaled up from the real 26 mm so it reads at gameplay distance. */
const COIN_TEXTURES = `${import.meta.env.BASE_URL}textures/coin/`;
export const COIN_VALUE = 10;
const COIN_RADIUS = 0.25;
const COIN_THICKNESS = 0.05;

const PICKUP_RADIUS = 0.85;
const PICKUP_HEIGHT = 1.4;
const RESPAWN_SECONDS = 30;
const POP_SECONDS = 0.35;

export interface CoinSystem {
  /** Fixed step: pickup tests against the player's feet position. Returns coins collected this step. */
  collect(world: World, px: number, py: number, pz: number, time: number): number;
  /** Per frame: spin / bob / pop-in written to the shared InstancedMesh. */
  render(world: World, time: number): void;
  dispose(world: World): void;
}

/**
 * Coins are ECS entities (Transform + Collectible) drawn by one InstancedMesh, so hundreds cost
 * a single draw call. Hidden coins get a zero-scale matrix instead of being removed, keeping the
 * instance layout stable and allocation-free.
 */
export function createCoinSystem(
  world: World,
  scene: Scene,
  tracker: ResourceTracker,
  positions: readonly (readonly [number, number, number])[],
): CoinSystem {
  // CylinderGeometry groups: 0 = rim, 1 = top face, 2 = bottom face; faces turned to ±Z.
  const geo = tracker.geometry(new CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 32).rotateX(Math.PI / 2));
  // Faces from the NT$10 photos: portrait (obverse) on +Z, 拾圓 / plum blossoms (reverse) on −Z.
  const loader = new TextureLoader();
  const faceTexture = (file: string): Texture => {
    const t = tracker.texture(loader.load(COIN_TEXTURES + file));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    // Cap UVs (after rotateX) put the image's top toward +X on both faces: turn it upright.
    t.center.set(0.5, 0.5);
    t.rotation = Math.PI / 2;
    return t;
  };
  const faceMat = (map: Texture): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ map, color: 0xf2f3f5, metalness: 0.55, roughness: 0.38 }));
  const obverse = faceMat(faceTexture('obverse.png'));
  const reverse = faceMat(faceTexture('reverse.png'));
  const rim = tracker.material(new MeshStandardMaterial({ color: 0xd6d8da, metalness: 0.85, roughness: 0.28 }));
  const mesh = new InstancedMesh(geo, [rim, obverse, reverse], positions.length);
  mesh.castShadow = true;
  mesh.frustumCulled = false; // instances are spread over the whole map
  scene.add(mesh);

  const eids: number[] = positions.map(([x, y, z], i) => {
    const eid = addEntity(world);
    addComponent(world, eid, Transform);
    addComponent(world, eid, Collectible);
    Transform.x[eid] = x;
    Transform.y[eid] = y;
    Transform.z[eid] = z;
    Collectible.active[eid] = 1;
    Collectible.respawnAt[eid] = -POP_SECONDS; // already fully popped in
    Collectible.instance[eid] = i;
    Collectible.value[eid] = COIN_VALUE;
    return eid;
  });

  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);

  return {
    collect(w, px, py, pz, time) {
      let gained = 0;
      for (const eid of query(w, [Transform, Collectible])) {
        if (Collectible.active[eid] === 0) {
          if (time >= Collectible.respawnAt[eid]!) {
            Collectible.active[eid] = 1;
            Collectible.respawnAt[eid] = time; // pop-in starts now
          }
          continue;
        }
        const dx = Transform.x[eid]! - px;
        const dz = Transform.z[eid]! - pz;
        const dy = Transform.y[eid]! - py;
        if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && dy > -0.3 && dy < PICKUP_HEIGHT) {
          Collectible.active[eid] = 0;
          Collectible.respawnAt[eid] = time + RESPAWN_SECONDS;
          gained += Collectible.value[eid]!;
        }
      }
      return gained;
    },
    render(w, time) {
      for (const eid of query(w, [Transform, Collectible])) {
        const i = Collectible.instance[eid]!;
        if (Collectible.active[eid] === 0) {
          m.makeScale(0, 0, 0);
        } else {
          const pop = Math.min(1, (time - Collectible.respawnAt[eid]!) / POP_SECONDS);
          const scale = pop < 1 ? 1.25 * Math.sin(pop * Math.PI * 0.5) : 1;
          q.setFromAxisAngle(up, time * 2.4 + i * 0.7);
          p.set(Transform.x[eid]!, Transform.y[eid]! + Math.sin(time * 2 + i) * 0.08, Transform.z[eid]!);
          m.compose(p, q, s.setScalar(scale));
        }
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(w) {
      mesh.removeFromParent();
      for (const eid of eids) removeEntity(w, eid);
    },
  };
}
