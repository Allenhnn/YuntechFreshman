import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, Ring } from './campusTypes';

/**
 * Open-air scooter and car parks: asphalt, white bays in back-to-back rows, parked vehicles (about
 * 60 % full) and a sign at the entrance. Bays skip anything running through a lot (roads, walkways,
 * buildings) and anything outside campus.
 */
export interface ScooterLot {
  name: string;
  /** Corners in order: p0 → p1 is the long side the rows run along, p0 → p3 the depth. */
  ring: Ring;
  /** Default scooter. */
  kind?: 'scooter' | 'car';
}

export const SCOOTER_LOTS: readonly ScooterLot[] = [
  { name: '機車停車場（大門西側）', ring: [-252, -332, -27, -377, -20, -339, -246, -294] },
  { name: '機車停車場（大門東側）', ring: [64, -391, 293, -433, 300, -397, 71, -350] },
  { name: '汽車停車場（管理學院）', ring: [-243, -90, -76, -124, -70, -94, -238, -62], kind: 'car' },
  // Along the north side of 龍潭路 (behind its sidewalk), and beside the service road west of 警衛室 / 技職大樓.
  { name: '機車停車格（龍潭路）', ring: [-151.69, -55.99, -281.69, -23.59, -283.14, -29.41, -153.14, -61.81] },
  { name: '機車停車格（警衛室旁）', ring: [-113.3, -46, -111.67, 20, -105.47, 19.85, -107.1, -46.15] },
  { name: '機車停車場（司令台）', ring: [266, -133, 346, -148, 351, -119, 271, -103] },
];

/** Bay width, vehicle length (bay depth), aisle, collider height per kind. */
const SIZES = {
  scooter: { bay: 1.0, len: 1.8, aisle: 3.2, h: 0.55 },
  car: { bay: 2.5, len: 4.8, aisle: 6.0, h: 0.75 },
} as const;
const FILL = 0.6;

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

const hash = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function createScooterLots(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): { dispose(): void } {
  const colliders: RAPIER.Collider[] = [];
  const meshes: Mesh[] = [];
  const blocked = (x: number, z: number): boolean => {
    if (!pointInRing(x, z, campus.boundary)) return true;
    for (const r of campus.roads) {
      const p = r.points;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (Math.abs(p[i]! - x) > 40 && Math.abs(p[i + 2]! - x) > 40) continue;
        if (segDist(x, z, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) < r.width / 2 + 1.1) return true;
      }
    }
    for (const b of campus.buildings) if (b.inCampus && pointInRing(x, z, b.outer)) return true;
    return false;
  };

  const asphalt = tracker.material(new MeshStandardMaterial({ color: 0x6f716f, roughness: 0.95, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const lineMat = tracker.material(new MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const lineGeos: BufferGeometry[] = [];
  // Scooter-park furniture (after the site photo): canopy roofs, steel posts / rails, back fence, red kerb paint.
  const roofGeos: BufferGeometry[] = [], steelGeos: BufferGeometry[] = [], fenceGeos: BufferGeometry[] = [], redGeos: BufferGeometry[] = [];
  /** A box from (a0, d0) to (a1, d1) in a lot's frame, y0..y1. */
  const lotBox = (at: (a: number, d: number) => [number, number], yaw: number, a0: number, a1: number, d0: number, d1: number, y0: number, y1: number): BufferGeometry => {
    const [cx, cz] = at((a0 + a1) / 2, (d0 + d1) / 2);
    return new BoxGeometry(Math.abs(a1 - a0), y1 - y0, Math.abs(d1 - d0)).rotateY(yaw).translate(cx, (y0 + y1) / 2, cz);
  };
  const scooters: { x: number; z: number; yaw: number; tint: number }[] = [];
  const cars: { x: number; z: number; yaw: number; tint: number }[] = [];

  for (const lot of SCOOTER_LOTS) {
    const kind = lot.kind ?? 'scooter';
    const { bay: BAY_W, len: SCOOTER_L, aisle: AISLE, h: COLL_H } = SIZES[kind];
    const parked = kind === 'car' ? cars : scooters;
    const r = lot.ring;
    const ox = r[0]!, oz = r[1]!;
    const lx = r[2]! - ox, lz = r[3]! - oz, L = Math.hypot(lx, lz);
    const ux = lx / L, uz = lz / L; // along the rows
    const dxr = r[6]! - ox, dzr = r[7]! - oz;
    const D = Math.abs(dxr * -uz + dzr * ux);
    const side = dxr * -uz + dzr * ux > 0 ? 1 : -1;
    const vx = -uz * side, vz = ux * side; // into the lot
    const at = (a: number, d: number): [number, number] => [ox + ux * a + vx * d, oz + uz * a + vz * d];

    // Asphalt (below roads and walkways, so those still show where they cross the lot).
    const pos: number[] = [];
    for (const [a, d] of [[0, 0], [L, 0], [L, D], [0, 0], [L, D], [0, D]] as const) {
      const [x, z] = at(a, d);
      pos.push(x, 0.03, z);
    }
    const ground = new BufferGeometry();
    ground.setAttribute('position', new Float32BufferAttribute(pos, 3));
    ground.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3));
    const gm = new Mesh(tracker.geometry(ground), asphalt);
    gm.receiveShadow = true;
    scene.add(gm);
    meshes.push(gm);

    // Back-to-back rows: [scooters facing −v | scooters facing +v], then an aisle.
    const yawAlong = Math.atan2(vx, vz); // scooter local +z (nose) → +v
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-uz, ux));
    for (let d0 = 1.2; d0 + SCOOTER_L * 2 <= D - 0.8; d0 += SCOOTER_L * 2 + AISLE) {
      for (const [rowD, nose] of [[d0 + SCOOTER_L / 2, -1], [d0 + SCOOTER_L * 1.5, 1]] as const) {
        let run: [number, number] | null = null;
        const flush = (): void => {
          if (!run) return;
          const [a0, a1] = run;
          const [cx, cz] = at((a0 + a1) / 2, rowD);
          colliders.push(tracker.collider(physics.createCollider(
            RAPIER.ColliderDesc.cuboid((a1 - a0) / 2 - (kind === 'car' ? 0.3 : 0), COLL_H, SCOOTER_L / 2 - 0.15).setTranslation(cx, COLL_H, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
          )));
          run = null;
        };
        for (let a = 1 + BAY_W / 2; a + BAY_W / 2 <= L - 1; a += BAY_W) {
          const [x, z] = at(a, rowD);
          const [ex, ez] = at(a, rowD + (SCOOTER_L / 2) * nose);
          if (blocked(x, z) || blocked(ex, ez)) { flush(); continue; }
          // Bay line on the bay's start edge.
          const [l0x, l0z] = at(a - BAY_W / 2, rowD);
          lineGeos.push(new PlaneGeometry(0.08, SCOOTER_L).rotateX(-Math.PI / 2).rotateY(Math.atan2(vx, vz)).translate(l0x, 0.035, l0z));
          if (hash(x, z) < FILL) {
            parked.push({ x, z, yaw: nose > 0 ? yawAlong : yawAlong + Math.PI, tint: hash(z, x) });
            if (!run) run = [a - BAY_W / 2, a + BAY_W / 2];
            else run[1] = a + BAY_W / 2;
          } else flush();
        }
        flush();
      }
    }

    if (kind === 'scooter') {
      const yaw = Math.atan2(-uz, ux);
      const steelPost = (a: number, d: number, h: number, r = 0.05): void => {
        const [x, z] = at(a, d);
        if (blocked(x, z)) return;
        steelGeos.push(new BoxGeometry(r * 2, h, r * 2).translate(x, h / 2, z));
        colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r + 0.02).setTranslation(x, h / 2, z))));
      };
      // Canopy over each back-to-back pair of rows: a shallow pitched sheet roof on two lines of posts.
      for (let d0 = 1.2; d0 + SCOOTER_L * 2 <= D - 0.8; d0 += SCOOTER_L * 2 + AISLE) {
        const r0 = d0 - 0.3, r1 = d0 + SCOOTER_L * 2 + 0.3;
        for (let a0 = 1; a0 < L - 1.5; a0 += 12) {
          const a1 = Math.min(L - 1, a0 + 12);
          const [mx, mz] = at((a0 + a1) / 2, (r0 + r1) / 2);
          if (blocked(mx, mz)) continue;
          roofGeos.push(lotBox(at, yaw, a0, a1, r0, r1, 2.45, 2.52));
          steelGeos.push(lotBox(at, yaw, a0, a1, r0 - 0.04, r0 + 0.04, 2.3, 2.45), lotBox(at, yaw, a0, a1, r1 - 0.04, r1 + 0.04, 2.3, 2.45)); // eaves beams
          for (let a = a0 + 0.3; a <= a1 - 0.2; a += 4) for (const d of [r0 + 0.1, r1 - 0.1]) steelPost(a, d, 2.45, 0.05);
        }
      }
      // Front: red kerb paint and a low steel rail with a gap every 10 m to walk in.
      redGeos.push(lotBox(at, yaw, 0.5, L - 0.5, 0.15, 0.3, 0.03, 0.045));
      for (let a0 = 0.8; a0 < L - 1; a0 += 10) {
        const a1 = Math.min(L - 0.8, a0 + 7.5);
        const [mx, mz] = at((a0 + a1) / 2, 0.6);
        if (blocked(mx, mz)) continue;
        steelGeos.push(lotBox(at, yaw, a0, a1, 0.57, 0.63, 0.82, 0.88));
        for (let a = a0; a <= a1 + 1e-6; a += 2.5) steelPost(a, 0.6, 0.85, 0.03);
        const [cx, cz] = at((a0 + a1) / 2, 0.6);
        const qq0 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        colliders.push(tracker.collider(physics.createCollider(
          RAPIER.ColliderDesc.cuboid((a1 - a0) / 2, 0.45, 0.05).setTranslation(cx, 0.45, cz).setRotation({ x: qq0.x, y: qq0.y, z: qq0.z, w: qq0.w }),
        )));
      }
      // Back: dark railing fence.
      for (let a0 = 0.5; a0 < L - 0.5; a0 += 6) {
        const a1 = Math.min(L - 0.5, a0 + 6);
        const [mx, mz] = at((a0 + a1) / 2, D - 0.2);
        if (blocked(mx, mz)) continue;
        for (const y of [0.15, 1.55]) fenceGeos.push(lotBox(at, yaw, a0, a1, D - 0.23, D - 0.17, y, y + 0.05));
        for (let a = a0; a < a1; a += 0.14) fenceGeos.push(lotBox(at, yaw, a, a + 0.025, D - 0.215, D - 0.185, 0.15, 1.6));
        const [cx, cz] = at((a0 + a1) / 2, D - 0.2);
        const qq0 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        colliders.push(tracker.collider(physics.createCollider(
          RAPIER.ColliderDesc.cuboid((a1 - a0) / 2, 0.8, 0.05).setTranslation(cx, 0.8, cz).setRotation({ x: qq0.x, y: qq0.y, z: qq0.z, w: qq0.w }),
        )));
      }
    }

    // Sign at the lot's first corner.
    const [sx, sz] = at(0.8, 0.8);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#1f5fa8';
      g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = "900 72px system-ui, sans-serif";
      g.fillText('P', 56, 80);
      g.font = "800 34px system-ui, 'PingFang TC', sans-serif";
      g.fillText(kind === 'car' ? '汽車' : '機車', 170, 56);
      g.fillText('停車場', 170, 104);
    }
    const tex = tracker.texture(new CanvasTexture(c));
    tex.colorSpace = SRGBColorSpace;
    const board = new Mesh(tracker.geometry(new BoxGeometry(1.4, 0.88, 0.06)), [
      ...Array.from({ length: 4 }, () => tracker.material(new MeshStandardMaterial({ color: 0x1f5fa8 }))),
      tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6 })),
      tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6 })),
    ]);
    board.position.set(sx, 2.0, sz);
    board.rotation.y = Math.atan2(-uz, ux);
    const post = new Mesh(tracker.geometry(new BoxGeometry(0.09, 1.6, 0.09).translate(0, 0.8, 0)), tracker.material(new MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.4, roughness: 0.5 })));
    post.position.set(sx, 0, sz);
    board.castShadow = post.castShadow = true;
    scene.add(board, post);
    meshes.push(board, post);
    colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(0.8, 0.08).setTranslation(sx, 0.8, sz))));
  }

  const furnish = (list: BufferGeometry[], mat: MeshStandardMaterial, shadow = true): void => {
    if (!list.length) return;
    const mesh = new Mesh(tracker.geometry(mergeGeometries(list)!), tracker.material(mat));
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
    for (const l of list) l.dispose();
  };
  furnish(roofGeos, new MeshStandardMaterial({ color: 0xc9ccce, roughness: 0.5, metalness: 0.5, side: DoubleSide }));
  furnish(steelGeos, new MeshStandardMaterial({ color: 0xb7bbbf, roughness: 0.35, metalness: 0.7 }));
  furnish(fenceGeos, new MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.5, metalness: 0.4 }));
  furnish(redGeos, new MeshStandardMaterial({ color: 0xd04a3c, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false);

  if (lineGeos.length) {
    const lines = new Mesh(tracker.geometry(mergeGeometries(lineGeos)!), lineMat);
    lines.receiveShadow = true;
    scene.add(lines);
    meshes.push(lines);
    for (const l of lineGeos) l.dispose();
  }

  // Scooter: body + shield (tinted) and seat / wheels / bars (dark), nose toward local +z.
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): BoxGeometry => new BoxGeometry(w, h, d).translate(x, y + h / 2, z) as BoxGeometry;
  const bodyGeo = tracker.geometry(mergeGeometries([box(0.34, 0.32, 1.15, 0, 0.22, -0.05), box(0.4, 0.62, 0.14, 0, 0.3, 0.5), box(0.28, 0.16, 0.42, 0, 0.92, 0.55)])!);
  const darkGeo = tracker.geometry(mergeGeometries([
    box(0.3, 0.12, 0.62, 0, 0.56, -0.18), // seat
    box(0.1, 0.42, 0.42, 0, 0, 0.62), box(0.1, 0.42, 0.42, 0, 0, -0.62), // wheels
    box(0.62, 0.04, 0.04, 0, 1.06, 0.5), // handlebar
  ])!);
  const body = new InstancedMesh(bodyGeo, tracker.material(new MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 })), scooters.length);
  const dark = new InstancedMesh(darkGeo, tracker.material(new MeshStandardMaterial({ color: 0x24262a, roughness: 0.7 })), scooters.length);
  const palette = [0xf2f2f0, 0x1f1f22, 0xc8302a, 0x2c6fd6, 0x9aa3a8, 0xe8b923, 0x6fa3c8, 0xd8a7b8, 0x3f7f55];
  const m = new Matrix4(), qq = new Quaternion(), p = new Vector3(), s = new Vector3(1, 1, 1), up = new Vector3(0, 1, 0), col = new Color();
  scooters.forEach((sc, i) => {
    qq.setFromAxisAngle(up, sc.yaw + (sc.tint - 0.5) * 0.12);
    m.compose(p.set(sc.x, 0, sc.z), qq, s);
    body.setMatrixAt(i, m);
    dark.setMatrixAt(i, m);
    body.setColorAt(i, col.setHex(palette[Math.floor(sc.tint * palette.length) % palette.length]!));
  });
  for (const mesh of [body, dark]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    meshes.push(mesh);
  }

  // Car: tinted body and roof, dark glass and wheels, nose toward local +z.
  const carBody = tracker.geometry(mergeGeometries([box(1.78, 0.62, 4.3, 0, 0.3, 0), box(1.5, 0.08, 2.0, 0, 1.42, -0.25)])!);
  const carDark = tracker.geometry(mergeGeometries([
    box(1.56, 0.52, 2.3, 0, 0.92, -0.2), // glasshouse
    ...[[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]].map(([x, z]) => box(0.24, 0.62, 0.62, x!, 0, z!)), // wheels
  ])!);
  const carPaint = new InstancedMesh(carBody, tracker.material(new MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 })), Math.max(1, cars.length));
  const carGlass = new InstancedMesh(carDark, tracker.material(new MeshStandardMaterial({ color: 0x1e2830, roughness: 0.15, metalness: 0.5 })), Math.max(1, cars.length));
  carPaint.count = carGlass.count = cars.length;
  const carColours = [0xf4f4f2, 0x1b1c1f, 0x9ea4a9, 0x5a5f66, 0xb3262a, 0x274f8c, 0xd9d4c7, 0x3d5a46];
  cars.forEach((c, i) => {
    qq.setFromAxisAngle(up, c.yaw + (c.tint - 0.5) * 0.05);
    m.compose(p.set(c.x, 0, c.z), qq, s);
    carPaint.setMatrixAt(i, m);
    carGlass.setMatrixAt(i, m);
    carPaint.setColorAt(i, col.setHex(carColours[Math.floor(c.tint * carColours.length) % carColours.length]!));
  });
  for (const mesh of [carPaint, carGlass]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    meshes.push(mesh);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const mesh of meshes) mesh.removeFromParent();
    },
  };
}
