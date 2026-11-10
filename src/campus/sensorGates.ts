import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';

/**
 * Card-sensor boom barriers where campus roads meet 龍潭路. With a student card in the bag, the
 * boom lifts when the player comes within OPEN_R and drops once they are past CLOSE_R; without
 * one it stays down (its collider blocks the lane) and the reader says why.
 */
interface GateSpot {
  /** Centre of the lane under the boom and the road direction (unit-free). */
  x: number;
  z: number;
  dx: number;
  dz: number;
  width: number;
}

const SPOTS: readonly GateSpot[] = [
  { x: 168.6, z: -141.5, dx: 0.14, dz: 1, width: 5 }, // 龍潭路 × the road north past 雲泰表演廳
  { x: 173.6, z: -113.0, dx: 0.18, dz: 0.98, width: 5 }, // 龍潭路 × the same road heading south
  { x: -44.6, z: -55.0, dx: 0.175, dz: 0.985, width: 5 }, // 龍潭路 × the road south past 技職大樓
];

const OPEN_R = 4.5;
const CLOSE_R = 7;
const NO_CARD_R = 3;
const LIFT_SPEED = 2.4; // rad / s

export type GateEvent = 'opened' | 'noCard';

export interface SensorGates {
  /** Per frame; returns what happened this frame (for a toast / sound). */
  update(dt: number, time: number, px: number, pz: number, hasCard: boolean): GateEvent | null;
  dispose(): void;
}

export function createSensorGates(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): SensorGates {
  const stripe = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 16;
    const g = c.getContext('2d');
    if (g) for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f4f2ea' : '#c8302a'; g.fillRect(k * 32, 0, 32, 16); }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.repeat.set(2, 1);
    return t;
  })();
  const boomMat = tracker.material(new MeshStandardMaterial({ map: stripe, roughness: 0.6 }));
  const housingMat = tracker.material(new MeshStandardMaterial({ color: 0xe8b923, roughness: 0.5, metalness: 0.2 }));
  const readerMat = tracker.material(new MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5 }));
  const ledOff = tracker.material(new MeshStandardMaterial({ color: 0xc8302a, emissive: 0xc8302a, emissiveIntensity: 0.7 }));
  const ledOn = tracker.material(new MeshStandardMaterial({ color: 0x2fb35a, emissive: 0x2fb35a, emissiveIntensity: 0.9 }));

  const gates = SPOTS.map((s) => {
    const len = Math.hypot(s.dx, s.dz);
    const ux = s.dx / len, uz = s.dz / len; // along the road
    const nx = -uz, nz = ux; // across it
    const half = s.width / 2;
    const root = new Group();
    // Local frame: +x across the road (boom), +z along it.
    root.position.set(s.x, 0, s.z);
    root.rotation.y = -Math.atan2(nz, nx); // local +x → (nx, nz)
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MeshStandardMaterial, parent: Group = root): Mesh => {
      const mesh = new Mesh(tracker.geometry(new BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // Housing on the −x kerb, card reader on a short post before it, boom pivoting at the housing.
    box(0.45, 1.0, 0.4, -half - 0.4, 0.5, 0, housingMat);
    box(0.12, 1.05, 0.12, -half - 0.4, 0.52, -1.4, readerMat);
    box(0.26, 0.34, 0.1, -half - 0.4, 1.15, -1.4, readerMat);
    const led = box(0.12, 0.06, 0.02, -half - 0.4, 1.26, -1.46, ledOff);
    const pivot = new Group();
    pivot.position.set(-half - 0.4, 0.92, 0);
    root.add(pivot);
    box(s.width + 0.6, 0.09, 0.09, (s.width + 0.6) / 2 + 0.1, 0, 0, boomMat, pivot);
    scene.add(root);
    const collider = tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(half + 0.2, 0.75, 0.15).setTranslation(s.x, 0.75, s.z)
        .setRotation({ x: 0, y: Math.sin(root.rotation.y / 2), z: 0, w: Math.cos(root.rotation.y / 2) }),
    ));
    const housing = tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 0.5, 0.22).setTranslation(s.x + nx * (-half - 0.4), 0.5, s.z + nz * (-half - 0.4)),
    ));
    return { s, root, pivot, led, collider, housing, angle: 0, open: false };
  });

  let lastNoCard = -Infinity;
  return {
    update(dt, time, px, pz, hasCard) {
      let event: GateEvent | null = null;
      for (const g of gates) {
        const d = Math.hypot(px - g.s.x, pz - g.s.z);
        if (!g.open && d < OPEN_R && hasCard) {
          g.open = true;
          g.collider.setEnabled(false);
          g.led.material = ledOn;
          event = 'opened';
        } else if (g.open && d > CLOSE_R) {
          g.open = false;
          g.collider.setEnabled(true);
          g.led.material = ledOff;
        } else if (!g.open && !hasCard && d < NO_CARD_R && time - lastNoCard > 4) {
          lastNoCard = time;
          event = 'noCard';
        }
        const target = g.open ? Math.PI * 0.47 : 0;
        g.angle += Math.max(-LIFT_SPEED * dt, Math.min(LIFT_SPEED * dt, target - g.angle));
        g.pivot.rotation.z = g.angle;
      }
      return event;
    },
    dispose() {
      for (const g of gates) {
        physics.removeCollider(g.collider, false);
        physics.removeCollider(g.housing, false);
        g.root.removeFromParent();
      }
    },
  };
}
