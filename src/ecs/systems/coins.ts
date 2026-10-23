import { addComponent, addEntity, query, removeEntity, type World } from 'bitecs';
import {
  CanvasTexture,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../../core/resources';
import { Collectible, Transform } from '../components';

/** NT$10 coin, scaled up from the real 26 mm so it reads at gameplay distance. */
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
  const face = tracker.material(
    new MeshStandardMaterial({ map: tracker.texture(paintCoinFace()), metalness: 0.75, roughness: 0.32 }),
  );
  const rim = tracker.material(new MeshStandardMaterial({ color: 0xd6d8da, metalness: 0.85, roughness: 0.28 }));
  const mesh = new InstancedMesh(geo, [rim, face, face], positions.length);
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

/**
 * Stylised NT$10 face: silver-white cupronickel, raised rim, "10" and "NT$". The portrait and
 * official motifs are deliberately left out (no faithful reproduction of currency).
 */
function paintCoinFace(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    const r = size / 2;
    const base = g.createRadialGradient(r * 0.7, r * 0.6, r * 0.1, r, r, r);
    base.addColorStop(0, '#f7f8f9');
    base.addColorStop(0.7, '#c9ccd0');
    base.addColorStop(1, '#a7abb0');
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#8e9297';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(r, r, r - 12, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(r, r, r - 22, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Embossed look: dark offset then light text.
    g.font = 'bold 118px system-ui, sans-serif';
    g.fillStyle = 'rgba(70,74,80,0.55)';
    g.fillText('10', r + 3, r + 8);
    g.fillStyle = '#eef0f2';
    g.fillText('10', r, r + 5);
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillStyle = '#6f747a';
    g.fillText('NT$', r, r - 66);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
