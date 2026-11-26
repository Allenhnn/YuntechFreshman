import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';

/**
 * Sensor-operated sliding glass doors at building entrances: two aluminium-framed glass leaves in
 * the door gap. When the player comes within OPEN_R (on the ground floor) the leaves slide apart
 * into the wall and the blocking collider switches off; they close again past CLOSE_R. All leaves
 * share two InstancedMeshes; only moving doors rewrite their matrices.
 */
export interface DoorSpec {
  /** Centre of the gap at ground level and the unit direction along the wall. */
  x: number;
  z: number;
  baseY?: number;
  ux: number;
  uz: number;
  width: number;
  height: number;
  /** Black-anodised frames (default aluminium). */
  dark?: boolean;
}

const OPEN_R = 3;
const CLOSE_R = 4.5;
const SPEED = 1.6; // m/s of leaf travel
const DEPTH = 0.06;
const MAX_FLOOR_Y = 1.5; // only someone on the ground floor triggers them

export interface AutoDoors {
  /** Per frame; returns true on the frame a door starts to open (for a sound). */
  update(dt: number, px: number, py: number, pz: number): boolean;
  dispose(): void;
}

export function createAutoDoors(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker, specs: readonly DoorSpec[]): AutoDoors {
  // One leaf = 1 × 1 × 1 unit (scaled per door): glass pane and its aluminium frame.
  const frameGeo = tracker.geometry(mergeGeometries([
    new BoxGeometry(1, 0.06, 1).translate(0, 0.97, 0), new BoxGeometry(1, 0.08, 1).translate(0, 0.04, 0),
    new BoxGeometry(0.05, 1, 1).translate(-0.475, 0.5, 0), new BoxGeometry(0.05, 1, 1).translate(0.475, 0.5, 0),
    new BoxGeometry(0.04, 0.12, 1.6).translate(0.36, 0.48, 0), // pull handle
  ])!);
  const glassGeo = tracker.geometry(new BoxGeometry(0.9, 0.9, 0.4).translate(0, 0.5, 0));
  const frameMat = tracker.material(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.7 }));
  const glassMat = tracker.material(new MeshStandardMaterial({ color: new Color(0xb9d4e2), roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }));
  const n = specs.length * 2;
  const frames = new InstancedMesh(frameGeo, frameMat, Math.max(1, n));
  const glass = new InstancedMesh(glassGeo, glassMat, Math.max(1, n));
  frames.count = glass.count = n;
  frames.castShadow = true;
  glass.renderOrder = 1;
  for (const m of [frames, glass]) {
    m.frustumCulled = false;
    scene.add(m);
  }

  const m4 = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  const doors = specs.map((d, i) => {
    const yaw = Math.atan2(-d.uz, d.ux); // local +x along the wall
    const collider = tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(d.width / 2, d.height / 2, 0.08).setTranslation(d.x, (d.baseY ?? 0) + d.height / 2, d.z)
        .setRotation((() => { const r = new Quaternion().setFromAxisAngle(up, yaw); return { x: r.x, y: r.y, z: r.z, w: r.w }; })()),
    ));
    return { d, i, yaw, open: 0, wantOpen: false, collider };
  });
  const place = (door: (typeof doors)[number]): void => {
    const { d, i, yaw } = door;
    const leaf = d.width / 2;
    q.setFromAxisAngle(up, yaw);
    for (const side of [-1, 1] as const) {
      // Closed: each leaf fills its half; open: it slides `open` metres outward into the wall.
      const along = side * (leaf / 2 + door.open);
      p.set(d.x + d.ux * along, d.baseY ?? 0, d.z + d.uz * along);
      m4.compose(p, q, s.set(leaf, d.height, DEPTH));
      const k = i * 2 + (side < 0 ? 0 : 1);
      frames.setMatrixAt(k, m4);
      glass.setMatrixAt(k, m4);
    }
  };
  for (const door of doors) place(door);
  const silver = new Color(0xb9bdc2), black = new Color(0x1c1d1f);
  doors.forEach((door) => {
    for (const k of [door.i * 2, door.i * 2 + 1]) frames.setColorAt(k, door.d.dark ? black : silver);
  });
  if (frames.instanceColor) frames.instanceColor.needsUpdate = true;
  frames.instanceMatrix.needsUpdate = glass.instanceMatrix.needsUpdate = true;

  return {
    update(dt, px, py, pz) {
      let opened = false, dirty = false;
      for (const door of doors) {
        const dist = Math.hypot(px - door.d.x, pz - door.d.z);
        const near = door.d.baseY === undefined ? py < MAX_FLOOR_Y : Math.abs(py - door.d.baseY) < MAX_FLOOR_Y;
        if (!door.wantOpen && near && dist < OPEN_R) {
          door.wantOpen = true;
          door.collider.setEnabled(false);
          opened = true;
        } else if (door.wantOpen && (dist > CLOSE_R || !near)) {
          door.wantOpen = false;
        }
        const target = door.wantOpen ? door.d.width / 2 - 0.08 : 0;
        if (door.open === target) continue;
        door.open += Math.max(-SPEED * dt, Math.min(SPEED * dt, target - door.open));
        if (!door.wantOpen && door.open < 0.05) door.collider.setEnabled(true); // shut: solid again
        place(door);
        dirty = true;
      }
      if (dirty) frames.instanceMatrix.needsUpdate = glass.instanceMatrix.needsUpdate = true;
      return opened;
    },
    dispose() {
      for (const door of doors) physics.removeCollider(door.collider, false);
      frames.removeFromParent();
      glass.removeFromParent();
    },
  };
}
