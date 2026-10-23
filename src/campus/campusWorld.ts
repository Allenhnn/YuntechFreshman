import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  PMREMGenerator,
  Path,
  Quaternion,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Comlink from 'comlink';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { ShadowQuality } from '../state/settings';
import skyVert from '../shaders/sky.vert.glsl';
import skyFrag from '../shaders/sky.frag.glsl';
import { createCampusMaterials, type CampusMaterials } from './campusMaterials';
import { CHUNK_SIZE, chunkKey, chunkOf, type CampusData, type ChunkBuild, type MeshBuffers, type Ring } from './campusTypes';
import type { CampusWorkerApi } from './campusWorker';

/** Visual streaming radius (m, to the nearest point of a chunk) and unload hysteresis. */
const LOAD_RADIUS = 600;
const UNLOAD_RADIUS = 760;
/** Building colliders only exist near the player. */
const PHYSICS_RADIUS = 60;
const PHYSICS_RELEASE = 120;
const MAX_IN_FLIGHT = 2;
/** Beyond this, chunk trees switch to a 20-triangle canopy, hide trunks and stop casting shadows. */
const TREE_LOD_DISTANCE = 220;

const SHADOW_EXTENT = 40;
const SHADOW_SIZE: Readonly<Record<Exclude<ShadowQuality, 'off'>, number>> = { low: 1024, high: 2048 };
const SUN_OFFSET = new Vector3(110, 170, 80);
const SKY_HORIZON = new Color(0xdbe9f2);

export interface CampusWorld {
  readonly data: CampusData;
  readonly materials: CampusMaterials;
  /** The grade-level ground collider (hand-built basements tell physics to ignore it). */
  readonly groundCollider: RAPIER.Collider;
  /** Streams chunks around the player; call every frame. */
  update(x: number, z: number): void;
  /** Resolves once every chunk within the load radius of (x, z) is built. */
  loadAround(x: number, z: number, onProgress?: (fraction: number) => void): Promise<void>;
  followShadow(x: number, z: number): void;
  setShadowQuality(quality: ShadowQuality): void;
  stats(): { chunks: number; colliders: number };
  dispose(): void;
}

interface ChunkRecord {
  cx: number;
  cz: number;
  state: 'loading' | 'ready';
  cancelled: boolean;
  group: Group | null;
  release: (() => void) | null;
  trees: { trunks: InstancedMesh; canopies: InstancedMesh } | null;
  treesFar: boolean;
  colliderData: ChunkBuild['collider'];
  collider: RAPIER.Collider | null;
}

export function createCampusWorld(
  scene: Scene,
  physics: RAPIER.World,
  renderer: WebGLRenderer,
  data: CampusData,
  tracker: ResourceTracker,
  treeExclusions: readonly Ring[] = [],
  groundHoles: readonly Ring[] = [],
): CampusWorld {
  const root = new Group();
  root.name = 'campus';
  scene.add(root);
  const mats = createCampusMaterials(renderer, tracker);

  // --- Sky, fog, image-based ambient ----------------------------------------------------------
  const sky = new Mesh(
    tracker.geometry(new SphereGeometry(1, 32, 16)),
    tracker.material(
      new ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new Color(0x5a98d8) },
          uHorizon: { value: SKY_HORIZON.clone() },
          uGround: { value: new Color(0xa9b8a0) },
          uSunDir: { value: SUN_OFFSET.clone().normalize() },
        },
      }),
    ),
  );
  sky.scale.setScalar(1400);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  root.add(sky);
  scene.fog = new Fog(SKY_HORIZON, 260, 1250);

  const pmrem = new PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.35;

  root.add(new HemisphereLight(0xdcecff, 0x6f7a58, 0.9));
  const sun = new DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_SIZE.high, SHADOW_SIZE.high);
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 10, far: 420 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);

  // --- Ground: one large plane (UVs in 4 m tiles), plus static collision ----------------------
  const span = 4000;
  const groundMat = mats.ground.clone();
  groundMat.map = mats.ground.map?.clone() ?? null;
  let groundGeo: BufferGeometry;
  if (groundHoles.length) {
    // Shape in (x, -z) so rotateX(-90°) maps it back onto the XZ plane; UVs are metres → 4 m tiles.
    const shape = new Shape();
    shape.moveTo(-span / 2, -span / 2).lineTo(span / 2, -span / 2).lineTo(span / 2, span / 2).lineTo(-span / 2, span / 2).closePath();
    for (const ring of groundHoles) {
      const hole = new Path();
      for (let i = 0; i < ring.length; i += 2) {
        if (i === 0) hole.moveTo(ring[i]!, -ring[i + 1]!);
        else hole.lineTo(ring[i]!, -ring[i + 1]!);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
    groundGeo = tracker.geometry(new ShapeGeometry(shape).rotateX(-Math.PI / 2));
    if (groundMat.map) groundMat.map.repeat.set(0.25, 0.25);
  } else {
    groundGeo = tracker.geometry(new PlaneGeometry(span, span).rotateX(-Math.PI / 2));
    if (groundMat.map) groundMat.map.repeat.set(span / 4, span / 4);
  }
  tracker.material(groundMat);
  const ground = new Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  root.add(ground);

  const { minX, minZ, maxX, maxZ } = data.bounds;
  const pad = 120;
  const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2 + pad, hz = (maxZ - minZ) / 2 + pad;
  // Flat heightfield, not one huge cuboid: a km-scale cuboid loses enough precision in Rapier's
  // character-controller queries to let the capsule sink ~0.2 m. It also leaves a slot for real DEM heights.
  const cells = 64;
  const groundCollider = tracker.collider(
    physics.createCollider(
      RAPIER.ColliderDesc.heightfield(cells, cells, new Float32Array((cells + 1) * (cells + 1)), { x: hx * 2 + 20, y: 1, z: hz * 2 + 20 })
        .setTranslation(cxm, 0, czm),
    ),
  );
  for (const [x, z, sx, sz] of [[cxm - hx, czm, 0.5, hz], [cxm + hx, czm, 0.5, hz], [cxm, czm - hz, hx, 0.5], [cxm, czm + hz, hx, 0.5]] as const) {
    tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cuboid(sx, 30, sz).setTranslation(x, 30, z)));
  }

  // --- Shared tree geometry --------------------------------------------------------------------
  const trunkGeo = tracker.geometry(new CylinderGeometry(0.16, 0.28, 3.2, 7).translate(0, 1.6, 0));
  const canopyGeo = tracker.geometry(buildCanopyGeometry());
  const canopyFarGeo = tracker.geometry(new IcosahedronGeometry(2.1, 0).scale(1, 0.85, 1).translate(0, 4.1, 0));

  // --- Worker ----------------------------------------------------------------------------------
  const worker = new Worker(new URL('./campusWorker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<CampusWorkerApi>(worker);
  const initDone = remote.init(data, [...treeExclusions]);

  const chunks = new Map<string, ChunkRecord>();
  const queue: { cx: number; cz: number; d: number }[] = [];
  let inFlight = 0;
  let disposed = false;
  const rangeX = [chunkOf(minX), chunkOf(maxX)] as const;
  const rangeZ = [chunkOf(minZ), chunkOf(maxZ)] as const;

  const rectDist = (cx: number, cz: number, x: number, z: number): number => {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK_SIZE));
    const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK_SIZE));
    return Math.hypot(dx, dz);
  };

  const pump = (): void => {
    queue.sort((a, b) => a.d - b.d);
    while (inFlight < MAX_IN_FLIGHT && queue.length) {
      const job = queue.shift()!;
      const rec = chunks.get(chunkKey(job.cx, job.cz));
      if (!rec || rec.cancelled) continue;
      inFlight++;
      void initDone
        .then(() => remote.build(job.cx, job.cz))
        .then((build) => {
          inFlight--;
          if (disposed) return;
          if (rec.cancelled) {
            chunks.delete(chunkKey(job.cx, job.cz));
          } else {
            applyBuild(rec, build);
          }
          pump();
        })
        .catch((err: unknown) => {
          inFlight--;
          chunks.delete(chunkKey(job.cx, job.cz));
          console.error('[campus] chunk build failed', err);
        });
    }
  };

  const applyBuild = (rec: ChunkRecord, b: ChunkBuild): void => {
    const group = new Group();
    group.name = `chunk ${rec.cx},${rec.cz}`;
    const geos: BufferGeometry[] = [];
    const instanced: InstancedMesh[] = [];
    const add = (buf: MeshBuffers | null, mat: CampusMaterials[keyof CampusMaterials], cast: boolean): void => {
      if (!buf) return;
      const geo = toGeometry(buf);
      geos.push(geo);
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    add(b.facade, mats.facade, true);
    add(b.roof, mats.roof, true);
    add(b.fields, mats.field, false);
    add(b.roads, mats.road, false);
    add(b.walkways, mats.walkway, false);

    const treeCount = b.trees.length / 5;
    if (treeCount > 0) {
      const trunks = new InstancedMesh(trunkGeo, mats.trunk, treeCount);
      const canopies = new InstancedMesh(canopyGeo, mats.canopy, treeCount);
      const m = new Matrix4();
      const q = new Quaternion();
      const p = new Vector3();
      const s = new Vector3();
      const c = new Color();
      const up = new Vector3(0, 1, 0);
      for (let i = 0; i < treeCount; i++) {
        const o = i * 5;
        q.setFromAxisAngle(up, b.trees[o + 3]!);
        m.compose(p.set(b.trees[o]!, 0, b.trees[o + 1]!), q, s.setScalar(b.trees[o + 2]!));
        trunks.setMatrixAt(i, m);
        canopies.setMatrixAt(i, m);
        const shift = b.trees[o + 4]!;
        canopies.setColorAt(i, c.setRGB(0.16 + shift * 0.08, 0.3 + shift * 0.12, 0.1 + shift * 0.05));
      }
      for (const mesh of [trunks, canopies]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
        instanced.push(mesh);
      }
      rec.trees = { trunks, canopies };
      rec.treesFar = false;
    }

    root.add(group);
    rec.group = group;
    rec.colliderData = b.collider;
    rec.state = 'ready';
    rec.release = () => {
      group.removeFromParent();
      for (const g of geos) g.dispose();
      for (const im of instanced) im.dispose(); // shared trunk/canopy geometry stays alive
    };
  };

  const dropCollider = (rec: ChunkRecord): void => {
    if (rec.collider) {
      physics.removeCollider(rec.collider, false);
      rec.collider = null;
    }
  };

  const update = (x: number, z: number): void => {
    for (let cx = Math.max(rangeX[0], chunkOf(x - LOAD_RADIUS)); cx <= Math.min(rangeX[1], chunkOf(x + LOAD_RADIUS)); cx++) {
      for (let cz = Math.max(rangeZ[0], chunkOf(z - LOAD_RADIUS)); cz <= Math.min(rangeZ[1], chunkOf(z + LOAD_RADIUS)); cz++) {
        const d = rectDist(cx, cz, x, z);
        const key = chunkKey(cx, cz);
        const rec = chunks.get(key);
        if (d > LOAD_RADIUS) continue;
        if (!rec) {
          chunks.set(key, { cx, cz, state: 'loading', cancelled: false, group: null, release: null, trees: null, treesFar: false, colliderData: null, collider: null });
          queue.push({ cx, cz, d });
        } else if (rec.cancelled) {
          rec.cancelled = false; // came back into range while its build was still in flight
        }
      }
    }
    for (const [key, rec] of chunks) {
      const d = rectDist(rec.cx, rec.cz, x, z);
      if (d > UNLOAD_RADIUS) {
        dropCollider(rec);
        if (rec.state === 'ready') {
          rec.release?.();
          chunks.delete(key);
        } else {
          rec.cancelled = true;
        }
        continue;
      }
      if (rec.trees && (d > TREE_LOD_DISTANCE) !== rec.treesFar) {
        rec.treesFar = d > TREE_LOD_DISTANCE;
        rec.trees.canopies.geometry = rec.treesFar ? canopyFarGeo : canopyGeo;
        rec.trees.canopies.castShadow = !rec.treesFar;
        rec.trees.trunks.visible = !rec.treesFar;
      }
      if (rec.state !== 'ready' || !rec.colliderData) continue;
      if (!rec.collider && d < PHYSICS_RADIUS) {
        rec.collider = physics.createCollider(RAPIER.ColliderDesc.trimesh(rec.colliderData.vertices, rec.colliderData.indices));
      } else if (rec.collider && d > PHYSICS_RELEASE) {
        dropCollider(rec);
      }
    }
    if (queue.length) pump();
  };

  const snapStep = (): number => (2 * SHADOW_EXTENT) / sun.shadow.mapSize.x;

  return {
    data,
    materials: mats,
    groundCollider,
    update,
    loadAround(x, z, onProgress) {
      update(x, z);
      const total = Math.max(1, [...chunks.values()].length);
      return new Promise((resolve) => {
        const check = (): void => {
          update(x, z);
          const loading = [...chunks.values()].filter((c) => c.state !== 'ready').length;
          onProgress?.(1 - loading / total);
          if (loading === 0) resolve();
          else setTimeout(check, 30);
        };
        check();
      });
    },
    followShadow(x, z) {
      const s = snapStep();
      const sx = Math.round(x / s) * s;
      const sz = Math.round(z / s) * s;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
    },
    setShadowQuality(quality) {
      sun.castShadow = quality !== 'off';
      if (quality === 'off') return;
      const px = SHADOW_SIZE[quality];
      if (sun.shadow.mapSize.x === px) return;
      sun.shadow.mapSize.set(px, px);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
    stats() {
      let colliders = 0;
      for (const c of chunks.values()) if (c.collider) colliders++;
      return { chunks: chunks.size, colliders };
    },
    dispose() {
      disposed = true;
      for (const rec of chunks.values()) {
        dropCollider(rec);
        rec.release?.();
      }
      chunks.clear();
      remote[Comlink.releaseProxy]();
      worker.terminate();
      envTarget.dispose();
      scene.environment = null;
      root.removeFromParent();
    },
  };
}

function toGeometry(b: MeshBuffers): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.position, 3));
  g.setAttribute('normal', new BufferAttribute(b.normal, 3));
  g.setAttribute('uv', new BufferAttribute(b.uv, 2));
  if (b.color) g.setAttribute('color', new BufferAttribute(b.color, 3));
  g.setIndex(new BufferAttribute(b.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Clustered, slightly lumpy canopy so instanced trees don't read as perfect spheres. */
function buildCanopyGeometry(): BufferGeometry {
  const blobs: [number, number, number, number][] = [
    [0, 4.4, 0, 1.9],
    [1.1, 3.8, 0.4, 1.4],
    [-1.0, 3.9, -0.5, 1.5],
    [0.2, 3.6, -1.1, 1.3],
  ];
  const parts = blobs.map(([x, y, z, r]) => {
    // Detail 1 (80 tris per blob, ~320 per tree): thousands of instances stay well under budget.
    const g = new IcosahedronGeometry(r, 1);
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const n = 1 + 0.12 * Math.sin(vx * 3.1 + vz * 2.3) * Math.cos(vy * 2.7 + vx);
      pos.setXYZ(i, vx * n + x, vy * n * 0.85 + y, vz * n + z);
    }
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(parts) ?? new IcosahedronGeometry(2, 1);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  // Planar UVs for the leaf grain texture.
  const pos = merged.attributes.position!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 0.5 + pos.getZ(i) * 0.25;
    uv[i * 2 + 1] = pos.getY(i) * 0.5;
  }
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  return merged;
}
