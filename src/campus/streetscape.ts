import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry as Geometry,
  CanvasTexture,
  ConeGeometry,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
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
/** Roads with a clipped hedge between the carriageway and the footpath beside it (first OSM vertex). */
const HEDGE_ROADS: readonly [number, number][] = [
  [-87.04, -303.02], // 4: central N–S road
  [-47.75, -77.03], // 198: 龍潭路 – 雲泰 road
];

/** Central-axis paving, one 8 m bay: red brick, grey edge bands, a grey cross band and a grey inset panel. */
function axisPaving(): CanvasTexture {
  const W = 320, H = 256; // 10 m across × 8 m along
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const m = W / 10;
  const bricks = (x0: number, y0: number, w: number, h: number, base: string, joint: string, bw: number, bh: number): void => {
    g.fillStyle = base;
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = joint;
    g.lineWidth = 1;
    for (let y = y0, row = 0; y < y0 + h; y += bh, row++) {
      g.beginPath();
      g.moveTo(x0, y + 0.5);
      g.lineTo(x0 + w, y + 0.5);
      g.stroke();
      for (let x = x0 + (row % 2 ? bw / 2 : 0); x < x0 + w; x += bw) {
        g.beginPath();
        g.moveTo(x + 0.5, y);
        g.lineTo(x + 0.5, Math.min(y + bh, y0 + h));
        g.stroke();
      }
    }
  };
  bricks(0, 0, W, H, '#9c4e3c', '#7c3a2c', m * 0.4, m * 0.2);
  // Shade variation, brick by brick.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,220,200' : '40,10,0'},0.08)`;
    g.fillRect(Math.floor(Math.random() * 25) * m * 0.4, Math.floor(Math.random() * 40) * m * 0.2, m * 0.4, m * 0.2);
  }
  const grey = (x: number, y: number, w: number, h: number): void => bricks(x, y, w, h, '#a9a7a2', '#8a8883', m * 0.3, m * 0.3);
  grey(0, 0, m * 0.9, H);
  grey(W - m * 0.9, 0, m * 0.9, H);
  grey(0, 0, W, m * 0.6);
  grey(W / 2 - m * 1.6, H / 2 - m * 1.6 + m * 0.3, m * 3.2, m * 3.2);
  g.strokeStyle = '#6f6d69';
  g.lineWidth = 2;
  g.strokeRect(W / 2 - m * 1.6, H / 2 - m * 1.3, m * 3.2, m * 3.2);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Flat ribbon along a polyline: u across (0..1), v along in units of `period` metres. */
function ribbon(points: readonly number[], width: number, y: number, period: number): Geometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let v = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!, az = points[i + 1]!, bx = points[i + 2]!, bz = points[i + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = -(bz - az) / len * width / 2, nz = (bx - ax) / len * width / 2;
    const b = pos.length / 3;
    pos.push(ax - nx, y, az - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz);
    uv.push(0, v, 1, v, 0, v + len / period, 1, v + len / period);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    v += len / period;
  }
  const geo = new Geometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

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
  const meshes: (InstancedMesh | Mesh)[] = [];
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
  const paving = tracker.material(new MeshStandardMaterial({ map: tracker.texture(axisPaving()), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }));
  const racks: Spot[] = [];
  const bins: Spot[] = [];
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

    // Red-and-grey paving laid over the plain path ribbon.
    const pave = new Mesh(tracker.geometry(ribbon(axis.points, axis.width, 0.062, 8)), paving);
    pave.receiveShadow = true;
    pave.name = 'streetscape';
    scene.add(pave);
    meshes.push(pave);

    // Bike racks between the palms (Street View: bikes parked along the edges) and a bin by every other lantern.
    for (const side of [-1, 1]) {
      for (const s of along(axis.points, PALM_STEP * 3, side * (half - 1.1), side > 0 ? 1 / 3 : 5 / 6)) {
        if (!clear(s.x, s.z, axis, 1.0)) continue;
        racks.push(s);
        post(s.x, s.z, 0.8, 0.3);
      }
    }
    lanterns.forEach((l, i) => {
      if (i % 2) return;
      const s = { x: l.x + Math.sin(l.yaw + Math.PI / 2) * 0.7, z: l.z + Math.cos(l.yaw + Math.PI / 2) * 0.7, yaw: l.yaw };
      bins.push(s);
      post(s.x, s.z, 0.95, 0.25);
    });
  }
  // Rack: three inverted-U hoops across the axis edge (local +x points into the axis), spaced along it.
  instance(mergeGeometries([-0.9, 0, 0.9].map((z) => new TorusGeometry(0.38, 0.03, 6, 12, Math.PI).translate(0, 0.42, z)))!, mat(0x8a8d90, { metalness: 0.6 }), racks);
  // Bin: green cylinder with a grey lid.
  instance(new CylinderGeometry(0.26, 0.23, 0.9, 12).translate(0, 0.45, 0), mat(0x2f6b45), bins);
  instance(new CylinderGeometry(0.29, 0.29, 0.06, 12).translate(0, 0.93, 0), mat(0x6d7174, { metalness: 0.3 }), bins);

  // --- Clipped hedges between road and footpath (roads 4, 198). ----------------------------------
  const hedgeRoads = vehicles.filter((r) => HEDGE_ROADS.some(([x, z]) => Math.hypot(r.points[0]! - x, r.points[1]! - z) < 0.5));
  const hedges: { x: number; z: number; yaw: number; len: number }[] = [];
  for (const w of walks) {
    if (w.width > 4 || isCentralAxis(w)) continue;
    const p = w.points;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 8) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // A hedge road running alongside: which side of the path it is on.
      let side = 0;
      for (const r of hedgeRoads) {
        const d = roadDist(mx, mz, r);
        if (d < r.width / 2 + 1.5 || d > 14) continue;
        const l = roadDist(mx - uz * 2, mz + ux * 2, r), rr = roadDist(mx + uz * 2, mz - ux * 2, r);
        // Parallel: both ends about as far from the road as the middle.
        if (Math.abs(roadDist(ax, az, r) - d) > 2.5 || Math.abs(roadDist(bx, bz, r) - d) > 2.5) continue;
        side = l < rr ? 1 : -1;
      }
      if (!side) continue;
      const off = w.width / 2 + 0.75;
      // Runs of clear 1 m steps, broken at crossings.
      let run: number[] = [];
      const flush = (): void => {
        if (run.length >= 3) {
          const t0 = run[0]!, t1 = run[run.length - 1]! + 1;
          const t = (t0 + t1) / 2;
          hedges.push({ x: ax + ux * t - uz * side * off, z: az + uz * t + ux * side * off, yaw: Math.atan2(ux, uz), len: t1 - t0 });
        }
        run = [];
      };
      for (let t = 1; t + 1 < len; t += 1) {
        const x = ax + ux * (t + 0.5) - uz * side * off, z = az + uz * (t + 0.5) + ux * side * off;
        if (clear(x, z, w, 1.2) && hedgeRoads.every((r) => roadDist(x, z, r) > r.width / 2 + 0.6)) run.push(t);
        else flush();
      }
      flush();
    }
  }
  if (hedges.length) {
    const geo = new BoxGeometry(0.8, 0.75, 1).translate(0, 0.375, 0);
    const m = new InstancedMesh(tracker.geometry(geo), mat(0x3e6f2e, { roughness: 0.95 }), hedges.length);
    const M = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0);
    hedges.forEach((h, i) => {
      m.setMatrixAt(i, M.compose(new Vector3(h.x, 0, h.z), q.setFromAxisAngle(up, h.yaw), new Vector3(1, 1, h.len)));
      colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.375, h.len / 2).setTranslation(h.x, 0.375, h.z).setRotation(q.clone()))));
    });
    m.computeBoundingSphere();
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'streetscape';
    scene.add(m);
    meshes.push(m);
  }

  // --- Bollards where a footpath meets a campus road (Street View: grey concrete posts). ---------
  const bollards: Spot[] = [];
  for (const w of walks) {
    if (w.width < 2 || isCentralAxis(w)) continue;
    const p = w.points, n = p.length / 2;
    for (const [e, f] of [[0, 1], [n - 1, n - 2]] as const) {
      const ex = p[e * 2]!, ez = p[e * 2 + 1]!, fx = p[f * 2]!, fz = p[f * 2 + 1]!;
      const road = vehicles.find((r) => !isLongtanMain(r) && !r.median && roadDist(ex, ez, r) < r.width / 2 + 1.5);
      if (!road || !inCampus(ex, ez)) continue;
      const len = Math.hypot(fx - ex, fz - ez);
      if (len < 4) continue;
      const ux = (fx - ex) / len, uz = (fz - ez) / len;
      // The path must leave the road, not run along it.
      const back = roadDist(ex + ux * 3, ez + uz * 3, road);
      if (back < roadDist(ex, ez, road) + 2) continue;
      // Walk in from the end to just past the kerb.
      let t = 0;
      while (t < len && roadDist(ex + ux * t, ez + uz * t, road) < road.width / 2 + 0.5) t += 0.25;
      if (t >= len) continue;
      const cx = ex + ux * t, cz = ez + uz * t;
      const count = Math.max(2, Math.round(w.width / 1.3) + 1);
      for (let k = 0; k < count; k++) {
        const o = (k - (count - 1) / 2) * (w.width / (count - 1 || 1)) * 0.9;
        const x = cx - uz * o, z = cz + ux * o;
        if (bollards.some((b) => Math.hypot(b.x - x, b.z - z) < 0.9)) continue;
        bollards.push({ x, z, yaw: 0 });
        post(x, z, 0.8, 0.12);
      }
    }
  }
  instance(mergeGeometries([
    new CylinderGeometry(0.12, 0.13, 0.75, 10).translate(0, 0.375, 0),
    new SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.75, 0),
  ])!, mat(0xb4b2ac, { roughness: 0.85 }), bollards);


  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const m of meshes) m.removeFromParent();
    },
  };
}
