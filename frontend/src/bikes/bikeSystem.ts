import {
  Mesh,
  Group,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIKE } from '../config';
import type { ResourceTracker } from '../core/resources';
import type { BikeStation } from './bikeStations';

/**
 * Parked and ridden bikes as instanced meshes (one draw call per part, at most a few hundred
 * triangles per bike). Parked bikes write their matrices once; only the ridden bike updates each
 * frame. Bikes are walk-through: like trees and kerbs they have no collider.
 */
/** A rideable vehicle standing on its own (no rack): dorm bike parking, the dorm scooter. */
export interface LooseVehicle {
  x: number;
  z: number;
  yaw: number;
  kind: 'bike' | 'scooter';
}

/** Scooters cruise this much faster than bikes. */
export const SCOOTER_SPEED_FACTOR = 1.6;

export interface BikeSystem {
  /** Index of the bike being ridden, or -1. */
  readonly ridden: number;
  /** What the rider is on (null when walking). */
  readonly riddenKind: 'bike' | 'scooter' | null;
  kindOf(index: number): 'bike' | 'scooter';
  /** Nearest parked bike within reach of (x, y, z), or -1. */
  nearest(x: number, y: number, z: number): number;
  /** World position and heading of a parked bike. */
  pose(index: number): { x: number; z: number; yaw: number };
  mount(index: number): void;
  /** Leaves the bike where it is. */
  dismount(): void;
  /** Moves the ridden bike under the rider and turns its wheels and pedals. */
  update(dt: number, x: number, y: number, z: number, yaw: number, speed: number): void;
  /** Pedal angle (radians) for the rider's pose. */
  readonly pedal: number;
  dispose(): void;
}

const BIKES_PER_STATION = 4;
const SLOT_SPACING = 1;
const WHEEL_R = 0.27;
const AXLE_Z = 0.46;
const CRANK = new Vector3(0, 0.24, -0.02);
/** The saddle sits behind the bike's centre: shift the bike so it is under the rider's hips. */
const RIDER_OFFSET = 0.22;
const FRAME_COLORS = [0x1f8f4a, 0x2c6fd6, 0xf2c230, 0xd8553a].map((c) => new Color(c));

type P = readonly [number, number, number];

/** Cylinder running from a to b. */
function tube(a: P, b: P, r: number): BufferGeometry {
  const from = new Vector3(...a), to = new Vector3(...b);
  const dir = to.clone().sub(from);
  const g = new CylinderGeometry(r, r, dir.length(), 6, 1);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const clean = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(clean);
  if (!merged) throw new Error('bike geometry merge failed');
  return merged;
}

function signTexture(tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#1f8f4a';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fffdf6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "700 62px system-ui, 'PingFang TC', sans-serif";
    g.fillText('🚲', 128, 44);
    g.font = "800 32px system-ui, 'PingFang TC', sans-serif";
    g.fillText('腳踏車站', 128, 100);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return tracker.texture(t);
}

export function createBikeSystem(scene: Scene, stations: readonly BikeStation[], tracker: ResourceTracker, loose: readonly LooseVehicle[] = []): BikeSystem {
  const looseBikes = loose.filter((v) => v.kind === 'bike');
  const looseScooters = loose.filter((v) => v.kind === 'scooter');
  // --- Shared geometry (forward = +Z, ground at y = 0) ----------------------------------------
  const seat: P = [0, 0.62, -0.2], bracket: P = [0, CRANK.y, CRANK.z], head: P = [0, 0.7, 0.32];
  const rear: P = [0, WHEEL_R, -AXLE_Z], front: P = [0, WHEEL_R, AXLE_Z];
  const frameGeo = tracker.geometry(merge([
    tube(bracket, seat, 0.022), tube(bracket, head, 0.024), tube(seat, head, 0.02), tube(rear, bracket, 0.016),
    tube(rear, seat, 0.014), tube(head, front, 0.02), tube(head, [0, 0.86, 0.3], 0.018),
  ]));
  const darkGeo = tracker.geometry(merge([
    tube(seat, [0, 0.72, -0.23], 0.016), box(0.13, 0.05, 0.26, 0, 0.74, -0.24),
    tube([-0.25, 0.86, 0.3], [0.25, 0.86, 0.3], 0.016),
  ]));
  const spokes = [0, 1, 2, 3].map((k) => {
    const a = (k * Math.PI) / 4;
    const s = Math.sin(a) * (WHEEL_R - 0.02), c = Math.cos(a) * (WHEEL_R - 0.02);
    return tube([0, -s, -c], [0, s, c], 0.004);
  });
  const wheelGeo = tracker.geometry(merge([new TorusGeometry(WHEEL_R - 0.015, 0.018, 6, 22).rotateY(Math.PI / 2), tube([-0.03, 0, 0], [0.03, 0, 0], 0.03), ...spokes]));
  const crankGeo = tracker.geometry(merge([
    tube([0.06, 0, 0], [-0.06, 0, 0], 0.03), tube([0.06, 0, 0], [0.06, 0.15, 0], 0.012), tube([-0.06, 0, 0], [-0.06, -0.15, 0], 0.012),
    box(0.09, 0.02, 0.05, 0.12, 0.15, 0), box(0.09, 0.02, 0.05, -0.12, -0.15, 0),
  ]));
  const rackLen = BIKES_PER_STATION * SLOT_SPACING + 0.6;
  const rackGeo = tracker.geometry(merge([
    tube([-rackLen / 2, 0.55, 0], [rackLen / 2, 0.55, 0], 0.03), tube([-rackLen / 2, 0, 0], [-rackLen / 2, 0.55, 0], 0.03), tube([rackLen / 2, 0, 0], [rackLen / 2, 0.55, 0], 0.03),
  ]));
  const padGeo = tracker.geometry(new PlaneGeometry(rackLen + 1.4, 3.2).rotateX(-Math.PI / 2));
  const poleGeo = tracker.geometry(tube([0, 0, 0], [0, 2.3, 0], 0.04));
  const boardGeo = tracker.geometry(new BoxGeometry(0.9, 0.46, 0.05));

  // --- Materials -------------------------------------------------------------------------------
  const paint = tracker.material(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.2 }));
  const dark = tracker.material(new MeshStandardMaterial({ color: 0x24272a, roughness: 0.7 }));
  const steel = tracker.material(new MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.4, metalness: 0.6 }));
  const pad = tracker.material(new MeshStandardMaterial({ color: 0xb9b4a8, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  const face = tracker.material(new MeshStandardMaterial({ map: signTexture(tracker), roughness: 0.6 }));

  // --- Instances --------------------------------------------------------------------------------
  const count = stations.length * BIKES_PER_STATION + looseBikes.length;
  const frames = new InstancedMesh(frameGeo, paint, count);
  const darks = new InstancedMesh(darkGeo, dark, count);
  const wheels = new InstancedMesh(wheelGeo, dark, count * 2);
  const cranks = new InstancedMesh(crankGeo, dark, count);
  const bikeMeshes = [frames, darks, wheels, cranks];
  const statics: InstancedMesh[] = [];
  const stationMesh = (geo: BufferGeometry, mat: Material | Material[]): InstancedMesh => {
    const m = new InstancedMesh(geo, mat, stations.length);
    statics.push(m);
    return m;
  };
  const racks = stationMesh(rackGeo, steel);
  const pads = stationMesh(padGeo, pad);
  const poles = stationMesh(poleGeo, steel);
  const boards = stationMesh(boardGeo, [steel, steel, steel, steel, face, face]);

  const m = new Matrix4(), q = new Quaternion(), qs = new Quaternion(), p = new Vector3(), v = new Vector3(), one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0), right = new Vector3(1, 0, 0);

  interface Bike { x: number; y: number; z: number; yaw: number; wheel: number; crank: number }
  const bikes: Bike[] = [];

  const write = (i: number): void => {
    const b = bikes[i]!;
    q.setFromAxisAngle(up, b.yaw);
    p.set(b.x, b.y, b.z);
    m.compose(p, q, one);
    frames.setMatrixAt(i, m);
    darks.setMatrixAt(i, m);
    for (const [k, az] of [[0, -AXLE_Z], [1, AXLE_Z]] as const) {
      v.set(0, WHEEL_R, az).applyQuaternion(q).add(p);
      qs.copy(q).multiply(new Quaternion().setFromAxisAngle(right, b.wheel));
      m.compose(v, qs, one);
      wheels.setMatrixAt(i * 2 + k, m);
    }
    v.copy(CRANK).applyQuaternion(q).add(p);
    qs.copy(q).multiply(new Quaternion().setFromAxisAngle(right, b.crank));
    m.compose(v, qs, one);
    cranks.setMatrixAt(i, m);
  };

  stations.forEach((s, si) => {
    const rackYaw = Math.atan2(-s.az, s.ax); // the rack's local +X runs along the road
    q.setFromAxisAngle(up, rackYaw);
    p.set(s.x, 0, s.z);
    m.compose(p, q, one);
    racks.setMatrixAt(si, m);
    p.set(s.x + s.nx * 0.5, 0, s.z + s.nz * 0.5);
    m.compose(p, q, one);
    pads.setMatrixAt(si, m);
    const half = (BIKES_PER_STATION * SLOT_SPACING) / 2 + 0.9;
    p.set(s.x + s.ax * half - s.nx, 0, s.z + s.az * half - s.nz);
    m.compose(p, q, one);
    poles.setMatrixAt(si, m);
    p.y = 2.05;
    // The board faces the road: BoxGeometry's textured sides are ±Z.
    q.setFromAxisAngle(up, Math.atan2(-s.nx, -s.nz));
    m.compose(p, q, one);
    boards.setMatrixAt(si, m);
    for (let k = 0; k < BIKES_PER_STATION; k++) {
      const off = (k - (BIKES_PER_STATION - 1) / 2) * SLOT_SPACING;
      const i = bikes.length;
      bikes.push({ x: s.x + s.ax * off - s.nx * 0.35, y: 0, z: s.z + s.az * off - s.nz * 0.35, yaw: Math.atan2(s.nx, s.nz), wheel: 0, crank: k * 1.3 });
      frames.setColorAt(i, FRAME_COLORS[(si + k) % FRAME_COLORS.length]!);
      write(i);
    }
  });

  looseBikes.forEach((v, k) => {
    const i = bikes.length;
    bikes.push({ x: v.x, y: 0, z: v.z, yaw: v.yaw, wheel: 0, crank: k * 0.9 });
    frames.setColorAt(i, FRAME_COLORS[(k + 1) % FRAME_COLORS.length]!);
    write(i);
  });

  // --- Scooters: one group each (few), moved with the rider like the bikes ----------------------
  const scooterBody = tracker.material(new MeshStandardMaterial({ color: 0xd8553a, roughness: 0.35, metalness: 0.25 }));
  const chrome = tracker.material(new MeshStandardMaterial({ color: 0xcfd6db, roughness: 0.2, metalness: 0.8 }));
  const lamp = tracker.material(new MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 0.6 }));
  const scooterGeo = tracker.geometry(merge([
    box(0.32, 0.12, 0.95, 0, 0.3, 0.02), box(0.4, 0.36, 0.62, 0, 0.52, -0.36), box(0.36, 0.34, 0.16, 0, 0.62, 0.44),
    box(0.3, 0.42, 0.1, 0, 0.88, 0.5), box(0.24, 0.1, 0.42, 0, 0.27, 0.62),
  ]));
  const seatGeo = tracker.geometry(box(0.32, 0.1, 0.6, 0, 0.75, -0.34));
  const barGeo = tracker.geometry(merge([tube([0, 0.72, 0.5], [0, 1.02, 0.46], 0.02), tube([-0.32, 1.02, 0.46], [0.32, 1.02, 0.46], 0.016), tube([-0.24, 1.02, 0.46], [-0.3, 1.18, 0.44], 0.008), tube([0.24, 1.02, 0.46], [0.3, 1.18, 0.44], 0.008), box(0.08, 0.05, 0.02, -0.3, 1.2, 0.44), box(0.08, 0.05, 0.02, 0.3, 1.2, 0.44)]));
  const lampGeo = tracker.geometry(box(0.16, 0.1, 0.04, 0, 0.98, 0.56));
  const sWheelGeo = tracker.geometry(new CylinderGeometry(0.21, 0.21, 0.11, 14).rotateZ(Math.PI / 2));
  interface Scooter { x: number; y: number; z: number; yaw: number; wheel: number; group: Group; wheels: Mesh[] }
  const scooters: Scooter[] = looseScooters.map((v) => {
    const group = new Group();
    const body = new Mesh(scooterGeo, scooterBody);
    const seat = new Mesh(seatGeo, dark);
    const bar = new Mesh(barGeo, chrome);
    const light = new Mesh(lampGeo, lamp);
    const ws = [0.55, -0.5].map((z) => { const w = new Mesh(sWheelGeo, dark); w.position.set(0, 0.21, z); return w; });
    group.add(body, seat, bar, light, ...ws);
    group.traverse((o) => { o.castShadow = true; });
    scene.add(group);
    return { x: v.x, y: 0, z: v.z, yaw: v.yaw, wheel: 0, group, wheels: ws };
  });
  const placeScooter = (s: Scooter): void => {
    s.group.position.set(s.x, s.y, s.z);
    s.group.rotation.y = s.yaw;
    for (const w of s.wheels) w.rotation.x = s.wheel;
  };
  scooters.forEach(placeScooter);

  for (const mesh of [...bikeMeshes, ...statics]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = mesh !== pads;
    mesh.receiveShadow = true;
    // Instances span the whole campus and one of them moves: per-object culling buys nothing.
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  let ridden = -1;
  let pedal = 0;

  /** Bikes are indices 0 … bikes.length − 1, scooters follow. */
  const kindOf = (i: number): 'bike' | 'scooter' => (i >= bikes.length ? 'scooter' : 'bike');
  return {
    get ridden() { return ridden; },
    get riddenKind() { return ridden < 0 ? null : kindOf(ridden); },
    kindOf,
    get pedal() { return pedal; },
    nearest(x, y, z) {
      let best = -1, bestD: number = BIKE.reach;
      [...bikes, ...scooters].forEach((b, i) => {
        const d = Math.hypot(b.x - x, b.z - z);
        if (d < bestD && Math.abs(b.y - y) < 1.5) { best = i; bestD = d; }
      });
      return best;
    },
    pose(i) {
      const b = i >= bikes.length ? scooters[i - bikes.length]! : bikes[i]!;
      return { x: b.x, z: b.z, yaw: b.yaw };
    },
    mount(i) { ridden = i; },
    dismount() { ridden = -1; },
    update(dt, x, y, z, yaw, speed) {
      if (ridden < 0) return;
      if (ridden >= bikes.length) {
        const s = scooters[ridden - bikes.length]!;
        s.x = x + Math.sin(yaw) * 0.3;
        s.y = y;
        s.z = z + Math.cos(yaw) * 0.3;
        s.yaw = yaw;
        s.wheel = (s.wheel + (speed / 0.21) * dt) % (Math.PI * 2);
        pedal = 0; // feet on the deck
        placeScooter(s);
        return;
      }
      const b = bikes[ridden]!;
      b.x = x + Math.sin(yaw) * RIDER_OFFSET;
      b.y = y;
      b.z = z + Math.cos(yaw) * RIDER_OFFSET;
      b.yaw = yaw;
      b.wheel = (b.wheel + (speed / WHEEL_R) * dt) % (Math.PI * 2);
      pedal = (pedal + (speed / WHEEL_R) * dt * 0.42) % (Math.PI * 2);
      b.crank = pedal;
      write(ridden);
      for (const mesh of bikeMeshes) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const s of scooters) s.group.removeFromParent();
      for (const mesh of [...bikeMeshes, ...statics]) {
        mesh.removeFromParent();
        mesh.dispose();
      }
    },
  };
}
