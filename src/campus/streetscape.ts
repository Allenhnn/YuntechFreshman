import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, CampusRoad, Ring } from './campusTypes';
import { isCentralAxis } from './campusFixes';
import { isLongtanMain } from './longtanConst';

/**
 * Street furniture read off Street View (people's 360° photos cover almost every campus road):
 *  - campus roads: tall grey street lamps with a single arm over the carriageway, every ~30 m on
 *    one side (the street-tree rows are in chunkBuilder, the red kerb lines in roadMarkings);
 *  - the central pedestrian axis: a row of palms down each side and short black post lanterns.
 * Positions are deterministic from the road data; each item skips spots on other roads, paths,
 * buildings and the tree-free rings (bike stations, scooter lots, entrances…).
 */
const LAMP_STEP = 30;
const LAMP_H = 8;
const ARM = 1.6;
const PALM_STEP = 8;
const AXIS_LAMP_STEP = 16;

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const roadDist = (x: number, z: number, r: CampusRoad): number => {
  let best = Infinity;
  const p = r.points;
  for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, segDist(x, z, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!));
  return best;
};

interface Spot { x: number; z: number; yaw: number }

/** Points every `step` m along a polyline at lateral offset `off` (+ = left of travel); yaw turns local +x toward the line. */
function along(points: readonly number[], step: number, off: number, phase = 0.5): Spot[] {
  const segs: { ax: number; az: number; ux: number; uz: number; len: number; at: number }[] = [];
  let total = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!, az = points[i + 1]!, bx = points[i + 2]!, bz = points[i + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    segs.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, at: total });
    total += len;
  }
  const out: Spot[] = [];
  const sg = Math.sign(off) || 1;
  for (let d = step * phase; d < total; d += step) {
    const s = segs.find((q) => d >= q.at && d <= q.at + q.len) ?? segs[segs.length - 1]!;
    const t = d - s.at;
    out.push({ x: s.ax + s.ux * t - s.uz * off, z: s.az + s.uz * t + s.ux * off, yaw: Math.atan2(s.ux * sg, s.uz * sg) });
  }
  return out;
}

export function createStreetscape(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker, keepClear: readonly Ring[]): { dispose(): void } {
  const vehicles = campus.roads.filter((r) => r.kind !== 'walkway');
  const walks = campus.roads.filter((r) => r.kind === 'walkway');
  const inCampus = (x: number, z: number): boolean => pointInRing(x, z, campus.boundary);
  const clear = (x: number, z: number, self: CampusRoad | null, pad: number): boolean => {
    if (!inCampus(x, z)) return false;
    for (const r of vehicles) if (r !== self && roadDist(x, z, r) < r.width / 2 + pad) return false;
    for (const r of walks) if (r !== self && roadDist(x, z, r) < r.width / 2 + 0.4) return false;
    for (const b of campus.buildings) if (pointInRing(x, z, b.outer)) return false;
    for (const ring of keepClear) if (pointInRing(x, z, ring)) return false;
    return true;
  };

  const colliders: RAPIER.Collider[] = [];
  const meshes: InstancedMesh[] = [];
  const post = (x: number, z: number, h: number, r: number): void => {
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cuboid(r, h / 2, r).setTranslation(x, h / 2, z))));
  };
  const instance = (geo: BufferGeometry, mat: Material, spots: Spot[], scale: (s: Spot, i: number) => number = () => 1): void => {
    if (!spots.length) return;
    const m = new InstancedMesh(tracker.geometry(geo), mat, spots.length);
    const M = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), p = new Vector3(), s = new Vector3();
    spots.forEach((sp, i) => {
      const k = scale(sp, i);
      m.setMatrixAt(i, M.compose(p.set(sp.x, 0, sp.z), q.setFromAxisAngle(up, sp.yaw), s.set(k, k, k)));
    });
    m.computeBoundingSphere();
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'streetscape';
    scene.add(m);
    meshes.push(m);
  };
  const mat = (color: number, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.6, ...extra }));

  // --- Street lamps along campus roads. ----------------------------------------------------------
  // Local frame: pole at the origin, arm along +x (over the road), lamp head at its end.
  const lampGeo = mergeGeometries([
    new CylinderGeometry(0.08, 0.13, LAMP_H, 10).translate(0, LAMP_H / 2, 0),
    new BoxGeometry(ARM, 0.08, 0.08).translate(ARM / 2, LAMP_H - 0.15, 0),
    new BoxGeometry(0.55, 0.12, 0.26).translate(ARM, LAMP_H - 0.25, 0),
    new CylinderGeometry(0.2, 0.2, 0.25, 10).translate(0, 0.12, 0),
  ])!;
  const lamps: Spot[] = [];
  for (const r of vehicles) {
    if (isLongtanMain(r) || r.median) continue;
    const p = r.points;
    const mid = Math.floor(p.length / 4) * 2;
    if (!inCampus(p[mid]!, p[mid + 1]!)) continue;
    let len = 0;
    for (let i = 0; i + 3 < p.length; i += 2) len += Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!);
    if (len < 25) continue;
    const off = r.width / 2 + 0.7;
    for (const s of along(p, LAMP_STEP, off)) {
      if (!clear(s.x, s.z, r, 1.5)) continue;
      if (lamps.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 12)) continue; // junctions: one lamp, not a cluster
      lamps.push(s);
      post(s.x, s.z, LAMP_H, 0.13);
    }
  }
  instance(lampGeo, mat(0x9a9d9f, { metalness: 0.4 }), lamps);
  // Lit heads: a small emissive box at the arm end.
  instance(new BoxGeometry(0.45, 0.04, 0.2).translate(ARM, LAMP_H - 0.32, 0), mat(0xffffff, { emissive: 0xfff2d6, emissiveIntensity: 0.8 }), lamps);

  // --- Central axis: palms both sides and black post lanterns. -----------------------------------
  for (const axis of campus.roads.filter(isCentralAxis)) {
    const half = axis.width / 2;
    const palms: Spot[] = [];
    for (const side of [-1, 1]) {
      for (const s of along(axis.points, PALM_STEP, side * (half + 1.2))) {
        if (!clear(s.x, s.z, axis, 1.0)) continue;
        palms.push(s);
        post(s.x, s.z, 3, 0.22);
      }
    }
    // Palm: tapered grey trunk, a bulge at the crown, eight drooping fronds.
    const trunk = mergeGeometries([
      new CylinderGeometry(0.17, 0.26, 7.2, 8).translate(0, 3.6, 0),
      new SphereGeometry(0.35, 8, 6).translate(0, 7.2, 0),
    ])!;
    const fronds: BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = new ConeGeometry(0.45, 3.4, 4, 1).scale(1, 1, 0.15).translate(0, 1.7, 0).rotateZ(-Math.PI / 2 - 0.35).rotateY(a).translate(0, 7.25, 0);
      fronds.push(f);
    }
    const crown = mergeGeometries(fronds)!;
    const sz = (s: Spot): number => 0.9 + (((s.x * 12.9898 + s.z * 78.233) % 1) + 1) % 1 * 0.25;
    instance(trunk, mat(0x8f8a80, { roughness: 0.95 }), palms, sz);
    instance(crown, mat(0x3f7a35, { roughness: 0.8 }), palms, sz);

    const lanterns: Spot[] = [];
    for (const side of [-1, 1]) {
      for (const s of along(axis.points, AXIS_LAMP_STEP, side * (half - 0.4), side > 0 ? 0.25 : 0.75)) {
        if (!clear(s.x, s.z, axis, 1.0)) continue;
        lanterns.push(s);
        post(s.x, s.z, 3.6, 0.09);
      }
    }
    instance(mergeGeometries([
      new CylinderGeometry(0.07, 0.09, 3.4, 8).translate(0, 1.7, 0),
      new BoxGeometry(0.3, 0.45, 0.3).translate(0, 3.55, 0),
      new ConeGeometry(0.26, 0.2, 4).rotateY(Math.PI / 4).translate(0, 3.88, 0),
    ])!, mat(0x1f2124, { metalness: 0.5 }), lanterns);
    instance(new BoxGeometry(0.22, 0.34, 0.22).translate(0, 3.55, 0), mat(0xffffff, { emissive: 0xfff0cc, emissiveIntensity: 0.7 }), lanterns);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const m of meshes) m.removeFromParent();
    },
  };
}
