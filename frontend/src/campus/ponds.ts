import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  Vector3,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';
import type { Ring } from './campusTypes';

/**
 * 雲夢湖 (Lotus Pond, south of 學生活動中心, its arm running east between 表演廳 and 學生餐廳) and 荷花池
 * (the park between 卡璐佶 and 設計工坊), placed from the campus map onto the open ground between the
 * real buildings. Each pond cuts the ground open: the bottom shelves from the shore (ground level) to
 * about a metre deep, so you can wade in and walk back out (≈ 20° banks); water stands 0.3 m below
 * the ground with a slow ripple, a stone kerb runs round the shore, lotus leaves and flowers float on
 * it. Wading is slow; falling into 雲夢湖 makes a splash (and an achievement in the story).
 */
export interface Pond {
  name: string;
  ring: Ring;
  /** Lotus density (leaves per 100 m²). */
  lotus: number;
}

export const PONDS: readonly Pond[] = [
  {
    name: '雲夢湖',
    ring: [
      33.5, 205, 62, 198, 94, 197, 110, 195.5, 125, 193, 138, 190, 160, 188, 191, 187, 212, 188.5, 212.6, 192.6,
      191, 192.8, 167, 193.0, 147, 194.8, 138, 197.5, 132, 202, 127, 210, 116, 216, 111, 226, 109, 240, 100, 254,
      74, 259.5, 48, 259.5, 33.5, 249, 28.7, 227,
    ],
    lotus: 1.2,
  },
  {
    name: '荷花池',
    ring: [
      -75.5, 59.5, -55.2, 57.3, -41.6, 62.9, -36.0, 74.2, -38.2, 87.7, -43.9, 94.5, -37.1, 103.5, -41.6, 111.4,
      -57.4, 113.7, -68.7, 109.2, -75.5, 99.0, -80.0, 87.7, -81.1, 74.2,
    ],
    lotus: 9,
  },
];

export const WATER_Y = -0.3;
const MAX_DEPTH = 1.0;
const BANK_SLOPE = 0.4; // depth per metre from the shore

function inRing(x: number, z: number, r: Ring): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
function edgeDist(x: number, z: number, r: Ring): number {
  let best = Infinity;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n, ax = r[i * 2]!, az = r[i * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** The pond (by name) containing (x, z), or null. */
export function pondAt(x: number, z: number): Pond | null {
  return PONDS.find((p) => inRing(x, z, p.ring)) ?? null;
}

/** Bottom height at (x, z) inside a pond. */
function bottomY(x: number, z: number, r: Ring): number {
  return -Math.min(MAX_DEPTH, edgeDist(x, z, r) * BANK_SLOPE);
}

export interface Ponds {
  update(dt: number, time: number): void;
  /** A splash ring and droplets at (x, z) on the water. */
  splash(x: number, z: number): void;
  dispose(): void;
}

export function createPonds(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): Ponds {
  const colliders: RAPIER.Collider[] = [];
  const meshes: Mesh[] = [];
  // Ripple texture (scrolled each frame) used as a bump map on the water.
  const rc = document.createElement('canvas');
  rc.width = rc.height = 128;
  const rg = rc.getContext('2d');
  if (rg) {
    const rnd = mulberry32(7);
    rg.fillStyle = '#808080';
    rg.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * 128, y = rnd() * 128, r = 4 + rnd() * 14;
      const gr = rg.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.floor(100 + rnd() * 100);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      gr.addColorStop(1, 'rgba(128,128,128,0)');
      rg.fillStyle = gr;
      rg.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const ripple = tracker.texture(new CanvasTexture(rc));
  ripple.wrapS = ripple.wrapT = RepeatWrapping;
  ripple.repeat.set(0.08, 0.08);
  const waterMat = tracker.material(new MeshStandardMaterial({
    color: 0x4f9cbf, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.82, bumpMap: ripple, bumpScale: 0.6,
    depthWrite: false,
  }));
  const bottomMat = tracker.material(new MeshStandardMaterial({ color: 0x5d6b4a, roughness: 1 }));
  const stoneMat = tracker.material(new MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.9 }));
  const leafMat = tracker.material(new MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.7 }));
  const flowerMat = tracker.material(new MeshStandardMaterial({ color: 0xf2a3c4, roughness: 0.6, emissive: 0x401020, emissiveIntensity: 0.2 }));

  const leaves: Matrix4[] = [];
  const flowers: Matrix4[] = [];
  const up = new Vector3(0, 1, 0);

  for (const pond of PONDS) {
    const r = pond.ring;
    // Water surface (shape in x, −z, laid flat facing up).
    const shape = new Shape();
    for (let i = 0; i < r.length; i += 2) (i === 0 ? shape.moveTo(r[i]!, -r[i + 1]!) : shape.lineTo(r[i]!, -r[i + 1]!));
    const water = new Mesh(tracker.geometry(new ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, WATER_Y, 0)), waterMat);
    water.renderOrder = 2;
    scene.add(water);
    meshes.push(water);

    // Bottom: a 1 m grid over the pond, each cell clipped to "inside", sloping from the shore.
    const xs = r.filter((_, i) => i % 2 === 0), zs = r.filter((_, i) => i % 2 === 1);
    const x0 = Math.floor(Math.min(...xs)) - 1, x1 = Math.ceil(Math.max(...xs)) + 1;
    const z0 = Math.floor(Math.min(...zs)) - 1, z1 = Math.ceil(Math.max(...zs)) + 1;
    const nx = x1 - x0 + 1, nz = z1 - z0 + 1;
    const pos: number[] = [];
    const idx: number[] = [];
    const vid = new Int32Array(nx * nz).fill(-1);
    const vert = (i: number, k: number): number => {
      const key = k * nx + i;
      if (vid[key]! >= 0) return vid[key]!;
      const x = x0 + i, z = z0 + k;
      const y = inRing(x, z, r) ? bottomY(x, z, r) : 0.02;
      vid[key] = pos.length / 3;
      pos.push(x, y, z);
      return vid[key]!;
    };
    for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
      const cx = x0 + i + 0.5, cz = z0 + k + 0.5;
      // Keep cells touching the pond (a ring of shore cells closes the gap to the cut ground).
      if (!inRing(cx, cz, r) && edgeDist(cx, cz, r) > 1.2) continue;
      const a = vert(i, k), b = vert(i + 1, k), c = vert(i + 1, k + 1), d = vert(i, k + 1);
      idx.push(a, c, b, a, d, c);
    }
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    bg.setIndex(idx);
    bg.computeVertexNormals();
    const bottom = new Mesh(tracker.geometry(bg), bottomMat);
    bottom.receiveShadow = true;
    scene.add(bottom);
    meshes.push(bottom);
    colliders.push(physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx))));

    // Stone kerb round the shore: low blocks along each edge.
    const kerb = new InstancedMesh(tracker.geometry(new CylinderGeometry(0.28, 0.32, 0.22, 6).translate(0, 0.05, 0)), stoneMat, 2000);
    let kn = 0;
    const m4 = new Matrix4(), q = new Quaternion(), s = new Vector3();
    const rnd = mulberry32(pond.name.length * 97);
    for (let i = 0, n = r.length / 2; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2]!, az = r[i * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az;
      const len = Math.hypot(dx, dz);
      for (let t = 0; t < len && kn < 2000; t += 0.55) {
        const k = 0.8 + rnd() * 0.5;
        kerb.setMatrixAt(kn++, m4.compose(new Vector3(ax + (dx * t) / len, 0, az + (dz * t) / len), q.setFromAxisAngle(up, rnd() * 6), s.set(k, 0.8 + rnd() * 0.6, k)));
      }
    }
    kerb.count = kn;
    kerb.castShadow = kerb.receiveShadow = true;
    scene.add(kerb);
    meshes.push(kerb);

    // Lotus leaves (flat discs) and a few flowers, clear of the shore.
    const area = Math.abs(r.reduce((acc, _v, i) => (i % 2 ? acc : acc + r[i]! * r[(i + 3) % r.length]! - r[(i + 2) % r.length]! * r[i + 1]!), 0)) / 2;
    const want = Math.floor((area / 100) * pond.lotus);
    for (let tries = 0, made = 0; made < want && tries < want * 20; tries++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!inRing(x, z, r)) continue;
      const e = edgeDist(x, z, r);
      if (e < 1.5 || (pond.lotus < 3 && e > 7)) continue; // the big lake: lotus near its edges only
      const k = 0.5 + rnd() * 0.7;
      leaves.push(new Matrix4().compose(new Vector3(x, WATER_Y + 0.02, z), new Quaternion().setFromAxisAngle(up, rnd() * 6), new Vector3(k, 1, k)));
      if (rnd() < 0.18) flowers.push(new Matrix4().compose(new Vector3(x + 0.2, WATER_Y + 0.25, z), new Quaternion(), new Vector3(1, 1, 1).multiplyScalar(0.8 + rnd() * 0.4)));
      made++;
    }
  }
  const leafMesh = new InstancedMesh(tracker.geometry(new CylinderGeometry(0.5, 0.5, 0.02, 10, 1, false, 0.3, Math.PI * 2 - 0.6)), leafMat, Math.max(1, leaves.length));
  leaves.forEach((m, i) => leafMesh.setMatrixAt(i, m));
  leafMesh.count = leaves.length;
  const flowerMesh = new InstancedMesh(tracker.geometry(new ConeGeometry(0.16, 0.3, 7, 1, true).rotateX(Math.PI)), flowerMat, Math.max(1, flowers.length));
  flowers.forEach((m, i) => flowerMesh.setMatrixAt(i, m));
  flowerMesh.count = flowers.length;
  for (const m of [leafMesh, flowerMesh]) { m.receiveShadow = true; scene.add(m); meshes.push(m); }

  // Splashes: expanding rings that fade.
  const splashMat = tracker.material(new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  const splashGeo = tracker.geometry(new CylinderGeometry(1, 1, 0.04, 24, 1, true));
  const splashes: { mesh: Mesh; t: number }[] = [];

  return {
    update(dt, time) {
      ripple.offset.set(time * 0.012, time * 0.007);
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i]!;
        s.t += dt;
        const k = 0.4 + s.t * 3.5;
        s.mesh.scale.set(k, 1 + s.t * 2, k);
        (s.mesh.material as MeshStandardMaterial).opacity = Math.max(0, 0.8 - s.t * 0.9);
        if (s.t > 0.9) { scene.remove(s.mesh); splashes.splice(i, 1); }
      }
    },
    splash(x, z) {
      for (let k = 0; k < 2; k++) {
        const mesh = new Mesh(splashGeo, splashMat.clone());
        mesh.position.set(x, WATER_Y + 0.05, z);
        scene.add(mesh);
        splashes.push({ mesh, t: -k * 0.18 });
      }
    },
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const m of meshes) m.removeFromParent();
      for (const s of splashes) s.mesh.removeFromParent();
    },
  };
}

export const POND_COLOR = new Color(0x7cc3e0);
