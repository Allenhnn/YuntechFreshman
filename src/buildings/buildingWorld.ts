import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RAPIER } from '../physics/physics';
import { ResourceTracker } from '../core/resources';
import type { CampusMaterials } from '../campus/campusMaterials';
import type { MeshBuffers, Ring } from '../campus/campusTypes';
import { stampFacadeStyle } from '../campus/chunkBuilder';
import { toGeometry } from '../campus/campusWorld';
import { DEFAULT_CAMPUS_STYLE, type FacadeStyle } from '../campus/facadeTypes';
import type { BuildingSource, Vec2 } from './buildingTypes';
import { buildBuildingMeshes, type BuildingMeshes, type BuildingPart, type ColliderBox } from './buildingMesh';
import { OUTSIDE, rasterize, regionRects } from './floorGrid';
import { createInteriorMaterials, type InteriorMaterials } from './interiorMaterials';
import { buildPlates, paintDirectory, paintEntranceSign } from './signs';
import { createFurnitureKit, instanceFurniture } from './furnitureMeshes';

/** Interior (partitions, floors, ceilings, plates, colliders) streams in near the building. */
const INTERIOR_LOAD = 90;
const INTERIOR_UNLOAD = 120;
const ELEVATOR_REACH = 2.6;

export interface Interactable {
  id: string;
  prompt: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface HandBuiltBuilding {
  readonly source: BuildingSource;
  /** World-space footprint rings of the ground floor (no-tree zones). */
  readonly footprintRings: Ring[];
  readonly interactables: Interactable[];
  planToWorld(x: number, y: number): [number, number];
  /** Furniture and stair-flight colliders block the player but not the camera's spring arm. */
  isCameraTransparent(handle: number): boolean;
  /** True over the basement footprint, where the campus ground collider must be ignored. */
  isOverBasement(x: number, z: number): boolean;
  /** World rings where the visible campus ground is cut open. */
  readonly groundHoles: Ring[];
  /** Character facing (rotY) in world space for a plan direction. */
  planFacing(dir: Vec2): number;
  update(px: number, py: number, pz: number): void;
  interiorLoaded(): boolean;
  dispose(): void;
}

export async function loadBuildingSource(url: string): Promise<BuildingSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (run npm run buildings:build)`);
  return (await res.json()) as BuildingSource;
}

/** Plan → world transform helpers without needing the meshes (used before the campus is built). */
export function createPlanTransform(src: BuildingSource): {
  toWorld(x: number, y: number): [number, number];
  toPlan(x: number, z: number): [number, number];
  rotY: number;
} {
  const t = src.transform;
  const a = (t.angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return {
    toWorld(x, y) {
      const qx = x - t.planCentroid[0], qy = y - t.planCentroid[1];
      return [qx * c - qy * s + t.worldCentroid[0], qx * s + qy * c + t.worldCentroid[1]];
    },
    toPlan(x, z) {
      const qx = x - t.worldCentroid[0], qz = z - t.worldCentroid[1];
      return [qx * c + qz * s + t.planCentroid[0], -qx * s + qz * c + t.planCentroid[1]];
    },
    // Object3D.rotation.y = φ maps (x, z) → (x cosφ + z sinφ, −x sinφ + z cosφ); we need R(+a) → φ = −a.
    rotY: -a,
  };
}

/** World rings of the plan rects where the campus ground plane is cut open. */
export function buildingGroundHoles(src: BuildingSource): Ring[] {
  const xf = createPlanTransform(src);
  return (src.groundOpenings ?? []).map(([a, b, c, d]) => [...xf.toWorld(a, b), ...xf.toWorld(c, b), ...xf.toWorld(c, d), ...xf.toWorld(a, d)]);
}

/** Ground-floor footprint in world space, computable before any mesh exists (tree exclusion). */
export function buildingFootprintRings(src: BuildingSource): Ring[] {
  const xf = createPlanTransform(src);
  const ground = src.levels.find((l) => l.elevation === 0);
  const plan = ground ? src.floors[ground.id] : undefined;
  if (!plan) return [];
  return regionRects(rasterize(plan.spaces), (v) => v !== OUTSIDE).map(([a, b, c, d]) => [
    ...xf.toWorld(a, b), ...xf.toWorld(c, b), ...xf.toWorld(c, d), ...xf.toWorld(a, d),
  ]);
}

export function createHandBuiltBuilding(
  src: BuildingSource,
  scene: Scene,
  physics: RAPIER.World,
  renderer: WebGLRenderer,
  campus: CampusMaterials,
  sceneTracker: ResourceTracker,
  facadeStyle: FacadeStyle = DEFAULT_CAMPUS_STYLE,
): HandBuiltBuilding {
  const xf = createPlanTransform(src);
  const meshes: BuildingMeshes = buildBuildingMeshes(src);
  const imats: InteriorMaterials = createInteriorMaterials(renderer, sceneTracker);
  const [ox, oz] = xf.toWorld(0, 0);
  const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), xf.rotY);
  const rapierRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

  const placeGroup = (name: string): Group => {
    const g = new Group();
    g.name = name;
    g.position.set(ox, 0, oz);
    g.rotation.y = xf.rotY;
    scene.add(g);
    return g;
  };

  const tiltQ = new Quaternion();
  const axisX = new Vector3(1, 0, 0), axisZ = new Vector3(0, 0, 1);
  const addColliders = (boxes: readonly ColliderBox[], into: RAPIER.Collider[]): void => {
    for (const b of boxes) {
      const [wx, wz] = xf.toWorld(b.c[0], b.c[2]);
      let r = rapierRot;
      if (b.tilt) {
        tiltQ.setFromAxisAngle(b.tilt.axis === 'x' ? axisX : axisZ, b.tilt.angle).premultiply(rot);
        r = { x: tiltQ.x, y: tiltQ.y, z: tiltQ.z, w: tiltQ.w };
      }
      into.push(
        physics.createCollider(
          RAPIER.ColliderDesc.cuboid(Math.max(0.01, b.h[0]), Math.max(0.01, b.h[1]), Math.max(0.01, b.h[2]))
            .setTranslation(wx, b.c[1], wz)
            .setRotation(r),
        ),
      );
    }
  };

  const addPart = (part: BuildingPart, group: Group, tracker: ResourceTracker, castShadow: boolean): void => {
    const entries: [MeshBuffers | null, Material][] = [
      [part.facade, campus.facade],
      [part.paint, imats.paint],
      [part.roof, campus.roof],
      [part.floor, imats.floor],
      [part.ceiling, imats.ceiling],
      [part.glass, imats.glass],
    ];
    if (part.facade) stampFacadeStyle(part.facade, facadeStyle);
    for (const [buf, mat] of entries) {
      if (!buf) continue;
      const mesh = new Mesh(tracker.geometry(toGeometry(buf)), mat);
      mesh.castShadow = castShadow && mat !== imats.glass;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  };

  // --- Exterior: always present ----------------------------------------------------------------
  const exteriorGroup = placeGroup(`${src.id}:exterior`);
  const exteriorColliders: RAPIER.Collider[] = [];
  addPart(meshes.exterior, exteriorGroup, sceneTracker, true);
  addColliders(meshes.exterior.colliders, exteriorColliders);
  for (const floor of Object.values(src.floors)) {
    for (const sign of floor.signs) {
      if (sign.kind !== 'entrance') continue;
      const tex = paintEntranceSign(src.name.replace('暨專業大樓', ''), sceneTracker);
      const board = new Mesh(
        sceneTracker.geometry(new PlaneGeometry(7.2, 0.9)),
        sceneTracker.material(new MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15, roughness: 0.6 })),
      );
      board.position.set(sign.at[0] + sign.facing[0] * 0.14, 3.6, sign.at[1] + sign.facing[1] * 0.14);
      board.rotation.y = Math.atan2(sign.facing[0], sign.facing[1]);
      exteriorGroup.add(board);
    }
  }

  // --- Interior: streamed, one group per level so floors away from the player can be hidden -------
  const kit = createFurnitureKit(sceneTracker);
  interface LoadedInterior {
    root: Group;
    levels: { id: string; base: number; group: Group }[];
    tracker: ResourceTracker;
    colliders: RAPIER.Collider[];
    instanced: InstancedMesh[];
  }
  let interior: LoadedInterior | null = null;
  /** Colliders the camera passes through: furniture, stair ramps, guards and landings (tight shafts). */
  const cameraTransparent = new Set<number>();

  const loadInterior = (): void => {
    const tracker = new ResourceTracker(physics);
    const root = placeGroup(`${src.id}:interior`);
    const colliders: RAPIER.Collider[] = [];
    const instanced: InstancedMesh[] = [];
    const frameMat = tracker.material(new MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.5, metalness: 0.3 }));

    const stairsGroup = new Group();
    stairsGroup.name = 'stairs';
    addPart(meshes.stairs, stairsGroup, tracker, false);
    const stairsFrom = colliders.length;
    addColliders(meshes.stairs.colliders, colliders);
    for (let i = stairsFrom; i < colliders.length; i++) cameraTransparent.add(colliders[i]!.handle);
    root.add(stairsGroup);

    const levels = meshes.levels.map((lvl) => {
      const group = new Group();
      group.name = `level ${lvl.id}`;
      addPart(lvl.part, group, tracker, false);
      addColliders(lvl.part.colliders, colliders);
      const before = colliders.length;
      addColliders(lvl.furnitureColliders, colliders);
      for (let i = before; i < colliders.length; i++) cameraTransparent.add(colliders[i]!.handle);

      // Door leaves: closed doors (stairs not yet open) and elevator doors.
      for (const d of lvl.doors) {
        const len = d.to - d.from;
        const leaf = new Mesh(tracker.geometry(new BoxGeometry(d.axis === 'h' ? len : 0.08, 2.3, d.axis === 'h' ? 0.08 : len)), d.kind === 'elevator' ? imats.elevatorDoor : imats.door);
        const mid = (d.from + d.to) / 2;
        leaf.position.set(d.axis === 'h' ? mid : d.at, d.base + 1.15, d.axis === 'h' ? d.at : mid);
        group.add(leaf);
      }
      const plates = buildPlates(lvl.plates, tracker);
      if (plates) group.add(plates);
      for (const im of instanceFurniture(lvl.furniture, kit)) {
        group.add(im);
        instanced.push(im);
      }

      // Free-standing directory boards.
      const floor = src.floors[lvl.id];
      const dirs = floor?.signs.filter((sg) => sg.kind === 'directory') ?? [];
      if (dirs.length) {
        const tex = paintDirectory(src, lvl.id, tracker);
        const faceMat = tracker.material(new MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2, roughness: 0.6 }));
        for (const sign of dirs) {
          const board = new Group();
          const frame = new Mesh(tracker.geometry(new BoxGeometry(1.3, 2.15, 0.08)), frameMat);
          frame.position.y = 1.4;
          const face = new Mesh(tracker.geometry(new PlaneGeometry(1.2, 2.0)), faceMat);
          face.position.set(0, 1.4, 0.045);
          const foot = new Mesh(tracker.geometry(new BoxGeometry(0.6, 0.3, 0.4)), frameMat);
          foot.position.y = 0.15;
          board.add(frame, face, foot);
          board.position.set(sign.at[0], lvl.base, sign.at[1]);
          board.rotation.y = Math.atan2(sign.facing[0], sign.facing[1]);
          group.add(board);
          const [wx, wz] = xf.toWorld(sign.at[0], sign.at[1]);
          colliders.push(physics.createCollider(RAPIER.ColliderDesc.cuboid(0.65, 1.2, 0.25).setTranslation(wx, lvl.base + 1.2, wz).setRotation(rapierRot)));
        }
      }
      root.add(group);
      return { id: lvl.id, base: lvl.base, group };
    });
    interior = { root, levels, tracker, colliders, instanced };
  };

  const unloadInterior = (): void => {
    if (!interior) return;
    for (const c of interior.colliders) physics.removeCollider(c, false);
    cameraTransparent.clear();
    for (const im of interior.instanced) im.dispose();
    interior.root.removeFromParent();
    interior.tracker.dispose();
    interior = null;
  };

  /**
   * Inside: show the player's floor and its neighbours (voids look one floor up / down).
   * Outside: only the ground floor and basement (seen through doors and the stairwell).
   */
  const levelGrids = meshes.levels.map((l) => ({ id: l.id, base: l.base, grid: rasterize(src.floors[l.id]!.spaces) }));
  const updateVisibility = (px: number, py: number, pz: number): void => {
    if (!interior) return;
    const [x, y] = xf.toPlan(px, pz);
    let current = -1;
    levelGrids.forEach((l, i) => {
      if (py + 0.8 >= l.base && cellOf(l.grid, x, y) !== OUTSIDE) current = i;
    });
    interior.levels.forEach((l, i) => {
      l.group.visible = current < 0 ? l.base <= 0 : Math.abs(i - current) <= 1;
    });
  };

  // --- Interactables -------------------------------------------------------------------------------
  const interactables: Interactable[] = [];
  for (const [levelId, floor] of Object.entries(src.floors)) {
    if (!floor.elevator) continue;
    const [x, z] = xf.toWorld(floor.elevator.landing[0], floor.elevator.landing[1]);
    const y = src.levels.find((l) => l.id === levelId)?.elevation ?? 0;
    interactables.push({ id: `${src.id}:elevator:${levelId}`, prompt: '按 E 搭乘電梯', x, y, z, radius: ELEVATOR_REACH });
  }

  const footprintRings: Ring[] = meshes.footprint.map(([a, b, c, d]) => [
    ...xf.toWorld(a, b), ...xf.toWorld(c, b), ...xf.toWorld(c, d), ...xf.toWorld(a, d),
  ]);
  const [cx, cz] = xf.toWorld(src.transform.planCentroid[0], src.transform.planCentroid[1]);
  const basementPlan = src.undergroundLevel ? src.floors[src.undergroundLevel] : undefined;
  const basementGrid = basementPlan ? rasterize(basementPlan.spaces) : null;

  return {
    source: src,
    footprintRings,
    interactables,
    planToWorld: xf.toWorld,
    groundHoles: buildingGroundHoles(src),
    isCameraTransparent: (handle) => cameraTransparent.has(handle),
    isOverBasement(x, z) {
      if (!basementGrid) return false;
      const [px, py] = xf.toPlan(x, z);
      const col = Math.floor((px - basementGrid.x0) / 0.1), row = Math.floor((py - basementGrid.y0) / 0.1);
      if (col < 0 || row < 0 || col >= basementGrid.w || row >= basementGrid.h) return false;
      return basementGrid.ids[row * basementGrid.w + col] !== OUTSIDE;
    },
    planFacing(dir) {
      const [x1, z1] = xf.toWorld(dir[0], dir[1]);
      const [x0, z0] = xf.toWorld(0, 0);
      return Math.atan2(x1 - x0, z1 - z0);
    },
    update(px, py, pz) {
      const d = Math.hypot(px - cx, pz - cz);
      if (!interior && d < INTERIOR_LOAD) loadInterior();
      else if (interior && d > INTERIOR_UNLOAD) unloadInterior();
      updateVisibility(px, py, pz);
    },
    interiorLoaded: () => interior !== null,
    dispose() {
      unloadInterior();
      for (const c of exteriorColliders) physics.removeCollider(c, false);
      exteriorGroup.removeFromParent();
    },
  };
}


function cellOf(g: { x0: number; y0: number; w: number; h: number; ids: Int16Array }, x: number, y: number): number {
  const col = Math.floor((x - g.x0) / 0.1), row = Math.floor((y - g.y0) / 0.1);
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return OUTSIDE;
  return g.ids[row * g.w + col]!;
}
