import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import { RENDER, WORLD } from '../config';
import { DEG2RAD, mulberry32 } from '../core/math';
import type { ResourceTracker } from '../core/resources';
import type { ToonPalette } from '../render/toon';
import type { ShadowQuality } from '../state/settings';
import { KEEP_OUT, PLAZA_RADIUS, distanceToTrackCenterline, terrainHeight, TRACK } from './layout';
import groundParsVert from '../shaders/ground/ground_pars.vert.glsl';
import groundParsFrag from '../shaders/ground/ground_pars.frag.glsl';
import skyVert from '../shaders/sky.vert.glsl';
import skyFrag from '../shaders/sky.frag.glsl';

const SKY_HORIZON = new Color(0xd9efff);
const SUN_OFFSET = new Vector3(28, 42, 18);

/** Top-down footprints for the minimap, taken from the same data that builds the scene. */
export interface MapData {
  rects: readonly { x: number; z: number; hx: number; hz: number; top: number; color: number }[];
  trees: readonly { x: number; z: number; r: number }[];
}


export interface Environment {
  readonly sun: DirectionalLight;
  readonly mapData: MapData;
  /** Keeps the shadow frustum centred on the player, snapped to shadow-map texels to avoid shimmering. */
  followShadow(x: number, z: number): void;
  setShadowQuality(quality: ShadowQuality): void;
}

const SHADOW_MAP_SIZE: Readonly<Record<Exclude<ShadowQuality, 'off'>, number>> = { low: 1024, high: RENDER.shadowMapSize };

interface BoxSpec {
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  color: number;
  rotX?: number; rotZ?: number;
  collide?: boolean;
}

export function buildEnvironment(scene: Scene, physics: RAPIER.World, palette: ToonPalette, tracker: ResourceTracker): Environment {
  const root = tracker.object(new Group());
  root.name = 'environment';
  scene.add(root);

  // --- Sky + fog --------------------------------------------------------------------------
  const sunDir = SUN_OFFSET.clone().normalize();
  const sky = new Mesh(
    tracker.geometry(new SphereGeometry(1, 32, 16)),
    tracker.material(
      new ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new Color(0x4f9be8) },
          uHorizon: { value: SKY_HORIZON.clone() },
          uGround: { value: new Color(0x9cc78a) },
          uSunDir: { value: sunDir },
        },
      }),
    ),
  );
  sky.scale.setScalar(300);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  root.add(sky);
  scene.fog = new Fog(SKY_HORIZON, 70, 190);

  // --- Lights ------------------------------------------------------------------------------
  root.add(new HemisphereLight(0xd4ecff, 0x6f8f52, 1.25));
  const sun = new DirectionalLight(0xfff0d8, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  const ext = RENDER.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);

  // --- Terrain: one height function drives both the render mesh and the Rapier heightfield ---
  const n = WORLD.segments;
  const size = WORLD.size;
  const terrainGeo = tracker.geometry(new PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2));
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  terrainGeo.computeVertexNormals();

  const groundMat = palette.get(0xffffff).clone();
  tracker.material(groundMat);
  groundMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${groundParsVert}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${groundParsFrag}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= groundAlbedo(vGroundWorld);');
  };
  groundMat.customProgramCacheKey = () => 'campus-ground-v1';
  const terrain = new Mesh(terrainGeo, groundMat);
  terrain.receiveShadow = true;
  root.add(terrain);

  // Rapier heightfield: (nrows+1) x (ncols+1) samples, column-major, rows along Z, cols along X.
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let col = 0; col <= n; col++) {
    for (let row = 0; row <= n; row++) {
      const x = -size / 2 + (col / n) * size;
      const z = -size / 2 + (row / n) * size;
      heights[row + col * (n + 1)] = terrainHeight(x, z);
    }
  }
  tracker.collider(physics.createCollider(RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size })));

  // Invisible boundary walls (the hills alone are climbable).
  const b = WORLD.boundary;
  for (const [x, z, hx, hz] of [[b, 0, 0.5, b], [-b, 0, 0.5, b], [0, b, b, 0.5], [0, -b, b, 0.5]] as const) {
    tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, 20, hz).setTranslation(x, 10, z)));
  }

  // --- Static boxes: one InstancedMesh draw call, one cuboid collider each --------------------
  const boxes: BoxSpec[] = [];
  addEastTestZone(boxes);
  addWestTestZone(boxes);
  addBuildings(boxes);

  const boxGeo = tracker.geometry(new BoxGeometry(1, 1, 1));
  const boxMesh = new InstancedMesh(boxGeo, palette.get(0xffffff), boxes.length);
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();
  const c = new Color();
  boxes.forEach((box, i) => {
    e.set(box.rotX ?? 0, 0, box.rotZ ?? 0);
    q.setFromEuler(e);
    m.compose(p.set(box.x, box.y, box.z), q, s.set(box.hx * 2, box.hy * 2, box.hz * 2));
    boxMesh.setMatrixAt(i, m);
    boxMesh.setColorAt(i, c.setHex(box.color));
    if (box.collide !== false) {
      tracker.collider(
        physics.createCollider(
          RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
            .setTranslation(box.x, box.y, box.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        ),
      );
    }
  });
  boxMesh.computeBoundingSphere();
  root.add(boxMesh);

  // --- Plaza centrepiece: low pedestal (auto-step test) + flagpole ---------------------------
  const pedestal = new Mesh(tracker.geometry(new CylinderGeometry(3, 3.1, 0.3, 40)), palette.get(0xcfc6b4));
  pedestal.position.set(0, 0.15, 0);
  const pole = new Mesh(tracker.geometry(new CylinderGeometry(0.07, 0.09, 7, 10)), palette.get(0xe8e8e8));
  pole.position.set(0, 3.8, 0);
  const flag = new Mesh(tracker.geometry(new BoxGeometry(1.8, 1.1, 0.04)), palette.get(0x1f8f4a));
  flag.position.set(0.95, 6.6, 0);
  for (const mesh of [pedestal, pole, flag]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(0.15, 3.05).setTranslation(0, 0.15, 0)));
  tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(3.5, 0.09).setTranslation(0, 3.8, 0)));

  // --- Trees: two InstancedMeshes (trunk + canopy), cylinder collider per trunk ---------------
  const trees = addTrees(root, physics, palette, tracker);

  const rects = boxes
    .filter((bx) => bx.collide !== false)
    .map((bx) => {
      const rz = bx.rotZ ?? 0;
      const rx = bx.rotX ?? 0;
      return {
        x: bx.x,
        z: bx.z,
        hx: Math.abs(bx.hx * Math.cos(rz)) + Math.abs(bx.hy * Math.sin(rz)),
        hz: Math.abs(bx.hz * Math.cos(rx)) + Math.abs(bx.hy * Math.sin(rx)),
        top: bx.y + Math.abs(bx.hy * Math.cos(rz) * Math.cos(rx)) + Math.abs(bx.hx * Math.sin(rz)),
        color: bx.color,
      };
    });
  rects.push({ x: 0, z: 0, hx: 3, hz: 3, top: 0.3, color: 0xcfc6b4 });

  let snap = (2 * RENDER.shadowExtent) / sun.shadow.mapSize.x;
  return {
    sun,
    mapData: { rects, trees: trees.map((t) => ({ x: t.x, z: t.z, r: 1.5 * t.s })) },
    setShadowQuality(quality) {
      sun.castShadow = quality !== 'off';
      if (quality === 'off') return;
      const sizePx = SHADOW_MAP_SIZE[quality];
      if (sun.shadow.mapSize.x === sizePx) return;
      sun.shadow.mapSize.set(sizePx, sizePx);
      sun.shadow.map?.dispose(); // re-allocated at the new size on the next render
      sun.shadow.map = null;
      snap = (2 * RENDER.shadowExtent) / sizePx;
    },
    followShadow(x, z) {
      const sx = Math.round(x / snap) * snap;
      const sz = Math.round(z / snap) * snap;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
    },
  };
}

/** Ramps start at (x0, 0) and climb toward +X with their top surface flush with the ground. */
function ramp(out: BoxSpec[], x0: number, z: number, angleDeg: number, length: number, halfWidth: number, color: number): number {
  const a = angleDeg * DEG2RAD;
  const t = 0.4;
  out.push({
    x: x0 + Math.cos(a) * length * 0.5 + Math.sin(a) * t * 0.5,
    y: Math.sin(a) * length * 0.5 - Math.cos(a) * t * 0.5,
    z,
    hx: length * 0.5, hy: t * 0.5, hz: halfWidth,
    rotZ: a,
    color,
  });
  return Math.sin(a) * length;
}

function addEastTestZone(out: BoxSpec[]): void {
  const concrete = 0xd8d2c4;
  const accent = 0xf2c230;

  // 20° ramp onto a platform: walkable.
  const top20 = ramp(out, 18, 10, 20, 10, 2, accent);
  out.push({ x: 18 + Math.cos(20 * DEG2RAD) * 10 + 2, y: top20 / 2, z: 10, hx: 2, hy: top20 / 2, hz: 2, color: concrete });

  // 50° ramp: above the 45° climb limit, the character must slide back down.
  const top50 = ramp(out, 24, 17, 50, 5, 1.5, 0xe0704a);
  out.push({ x: 24 + Math.cos(50 * DEG2RAD) * 5 + 1.5, y: top50 / 2, z: 17, hx: 1.5, hy: top50 / 2, hz: 1.5, color: concrete });

  // Stairs: 8 steps x 0.25 m rise (below the 0.35 m auto-step height).
  for (let i = 0; i < 8; i++) {
    const h = 0.25 * (i + 1);
    out.push({ x: 20 + i * 0.5, y: h / 2, z: 0, hx: 0.25, hy: h / 2, hz: 1.5, color: i % 2 ? concrete : 0xc9c2b2 });
  }
  out.push({ x: 25.5, y: 1, z: 0, hx: 1.5, hy: 1, hz: 1.5, color: concrete });

  // Kerbs: 0.3 m auto-steps, 0.5 m needs a jump.
  out.push({ x: 33, y: 0.15, z: 0, hx: 1, hy: 0.15, hz: 1.5, color: accent });
  out.push({ x: 37, y: 0.25, z: 0, hx: 1, hy: 0.25, hz: 1.5, color: 0xe0704a });
}

function addWestTestZone(out: BoxSpec[]): void {
  const colors = [0x6fb5e8, 0x4f95d0, 0x2f74b8, 0x1d5a99];
  // Pillar staircase: each top 1.0 m higher than the last (jump apex is 1.4 m).
  for (let i = 0; i < 4; i++) {
    const h = 1 + i;
    out.push({ x: -20 - i * 3, y: h / 2, z: 6, hx: 1.1, hy: h / 2, hz: 1.1, color: colors[i] ?? 0x2f74b8 });
  }
  // Unreachable from the ground. Edges below apex + capsule radius (~1.8 m) get mounted by the
  // rounded capsule bottom, which acts as built-in ledge forgiveness, so this one is 2.2 m.
  out.push({ x: -22, y: 1.1, z: -2, hx: 1.2, hy: 1.1, hz: 1.2, color: 0xe0704a });
  // Low ceiling: 2.2 m underside, tests head bonk (capsule top reaches 2.7 m at apex).
  out.push({ x: -32, y: 2.4, z: -2, hx: 2.5, hy: 0.2, hz: 2.5, color: 0xd8d2c4 });
  out.push({ x: -34.3, y: 1.1, z: -4.3, hx: 0.2, hy: 1.1, hz: 0.2, color: 0xc9c2b2 });
  out.push({ x: -29.7, y: 1.1, z: 0.3, hx: 0.2, hy: 1.1, hz: 0.2, color: 0xc9c2b2 });
}

function addBuildings(out: BoxSpec[]): void {
  const wall = 0xefe6d2;
  const glass = 0x5b7d99;
  const roof = 0xb5523b;
  const blocks = [
    { x: -20, z: 38, hx: 12, hy: 5, hz: 6 },
    { x: 10, z: 40, hx: 14, hy: 6.5, hz: 6 },
    { x: 34, z: 34, hx: 5, hy: 4, hz: 8 },
  ];
  for (const bl of blocks) {
    out.push({ x: bl.x, y: bl.hy, z: bl.z, hx: bl.hx, hy: bl.hy, hz: bl.hz, color: wall });
    out.push({ x: bl.x, y: bl.hy * 2 + 0.2, z: bl.z, hx: bl.hx + 0.4, hy: 0.2, hz: bl.hz + 0.4, color: roof });
    // Window bands on the plaza-facing side: decoration only, no colliders.
    const front = bl.z - bl.hz - 0.04;
    for (let floor = 0; floor < Math.floor(bl.hy * 2 / 3.2); floor++) {
      out.push({ x: bl.x, y: 1.9 + floor * 3.2, z: front, hx: bl.hx - 0.8, hy: 0.55, hz: 0.06, color: glass, collide: false });
    }
  }
}

function addTrees(root: Group, physics: RAPIER.World, palette: ToonPalette, tracker: ResourceTracker): { x: number; z: number; s: number }[] {
  const rand = mulberry32(20261022);
  const spots: { x: number; z: number; s: number; r: number }[] = [];
  const limit = 40;
  for (let attempt = 0; attempt < 2000 && spots.length < 70; attempt++) {
    const x = (rand() * 2 - 1) * limit;
    const z = (rand() * 2 - 1) * limit;
    if (Math.hypot(x, z) < PLAZA_RADIUS + 3) continue;
    if (Math.abs(distanceToTrackCenterline(x, z)) < TRACK.halfWidth + 2 || distanceToTrackCenterline(x, z) < 0) continue;
    if (KEEP_OUT.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
    if (spots.some((o) => Math.hypot(o.x - x, o.z - z) < 4.5)) continue;
    spots.push({ x, z, s: 0.8 + rand() * 0.5, r: rand() * Math.PI * 2 });
  }

  const trunks = new InstancedMesh(tracker.geometry(new CylinderGeometry(0.16, 0.24, 2, 7).translate(0, 1, 0)), palette.get(0x8a5a3b), spots.length);
  // Polyhedron geometry is already non-indexed, so recomputing normals gives faceted low-poly shading.
  const canopyGeo = new IcosahedronGeometry(1.5, 0).translate(0, 2.9, 0);
  canopyGeo.computeVertexNormals();
  const canopies = new InstancedMesh(tracker.geometry(canopyGeo), palette.get(0xffffff), spots.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const s = new Vector3();
  const c = new Color();
  const greens = [0x3f9a46, 0x4caa4f, 0x2f8a40, 0x5bb860];
  spots.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z);
    q.setFromAxisAngle(up, t.r);
    m.compose(p.set(t.x, y, t.z), q, s.setScalar(t.s));
    trunks.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
    canopies.setColorAt(i, c.setHex(greens[i % greens.length] ?? 0x3f9a46));
    tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(t.s, 0.25 * t.s).setTranslation(t.x, y + t.s, t.z)));
  });
  for (const mesh of [trunks, canopies]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  return spots;
}
