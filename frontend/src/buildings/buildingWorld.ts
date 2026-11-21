import {
  BoxGeometry,
  CanvasTexture,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RAPIER } from '../physics/physics';
import { ResourceTracker } from '../core/resources';
import type { CampusMaterials } from '../campus/campusMaterials';
import type { MeshBuffers, Ring } from '../campus/campusTypes';
import { stampFacadeStyle } from '../campus/chunkBuilder';
import { toGeometry } from '../campus/campusWorld';
import { DEFAULT_CAMPUS_STYLE, type FacadeStyle } from '../campus/facadeTypes';
import type { BuildingSource, Stall, Vec2 } from './buildingTypes';
import { buildBuildingMeshes, type BuildingMeshes, type BuildingPart, type ColliderBox, type StairPortal } from './buildingMesh';
import { OUTSIDE, rasterize, regionRects } from './floorGrid';
import { WALL_T } from './wallConst';
import { createInteriorMaterials, type InteriorMaterials } from './interiorMaterials';
import { buildPlates, paintDirectory, paintEntranceSign } from './signs';
import { createFurnitureKit, instanceFurniture, type FurnitureKit } from './furnitureMeshes';

/** Classroom doors open and close with E within this distance of the doorway. */
const DOOR_REACH = 1.7;
const SWING_SPEED = 1.6; // fraction of the swing per second
const SWING_ANGLE = 1.6; // rad (≈ 92°)
/** Mirrors reflect (render the scene again) only within this distance. */
const MIRROR_RANGE = 22;

const STALL_COLORS: Readonly<Record<string, string>> = { 自助餐: '#1f8f4a', 麵食: '#c0562b', 便當: '#2c6fd6', 飲料: '#d99a1f', 回收區: '#6c7a72' };

/** One stall, local +z toward the customers, origin at the centre of its floor footprint. */
function buildStall(st: Stall, tracker: ResourceTracker, dark: Material): Group {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  const colour = STALL_COLORS[st.name] ?? '#1f8f4a';
  if (g) {
    g.fillStyle = colour;
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#fffdf6';
    g.font = "800 58px system-ui, 'PingFang TC', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(st.name, 256, 50);
  }
  const tex = tracker.texture(new CanvasTexture(c));
  tex.colorSpace = SRGBColorSpace;
  const w = st.width;
  const out = new Group();
  const wall = tracker.material(new MeshStandardMaterial({ color: 0xece6d8, roughness: 0.8 }));
  const top = tracker.material(new MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.35, metalness: 0.2 }));
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: Material): void => {
    const mesh = new Mesh(tracker.geometry(new BoxGeometry(sx, sy, sz)), m);
    mesh.position.set(x, y, z);
    out.add(mesh);
  };
  box(w, 2.7, 0.14, 0, 1.35, -1.43, wall); // back panel
  box(0.14, 2.7, 2.2, -w / 2, 1.35, -0.4, wall);
  box(0.14, 2.7, 2.2, w / 2, 1.35, -0.4, wall);
  box(w, 0.95, 0.7, 0, 0.475, 0.3, tracker.material(new MeshStandardMaterial({ color: colour, roughness: 0.7 }))); // counter
  box(w + 0.1, 0.06, 0.8, 0, 0.98, 0.3, top);
  box(w, 0.8, 0.08, 0, 2.95, 0.72, dark); // sign backing
  const sign = new Mesh(tracker.geometry(new PlaneGeometry(w - 0.2, 0.68)), tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 })));
  sign.position.set(0, 2.95, 0.77);
  out.add(sign);
  return out;
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

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
  /** Stair curtain doorways; interactable `<id>:stairs:<index>` uses the entry at that index. */
  readonly stairPortals: StairPortal[];
  /** Opens or closes room door `<id>:door:<index>` (E); returns a message when it won't open. */
  toggleDoor(index: number): string | null;
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

export { createPlanTransform } from './planTransform';
import { createPlanTransform } from './planTransform';

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

export interface HandBuiltOptions {
  facadeStyle?: FacadeStyle;
  /**
   * Generated interiors inside an OSM shell: no exterior walls, roofs or signs of their own (the
   * campus extrusion with its entrance gap is the shell).
   */
  interiorOnly?: boolean;
  /** Meshes built elsewhere (the interior worker) instead of on this thread. */
  meshes?: BuildingMeshes;
  /** Materials and furniture kit shared by all generated interiors. */
  shared?: { imats: InteriorMaterials; kit: FurnitureKit };
  /** World rings of the footprint: with them, the player's level comes from height alone (no plan grids). */
  footprints?: Ring[];
}

export function createHandBuiltBuilding(
  src: BuildingSource,
  scene: Scene,
  physics: RAPIER.World,
  renderer: WebGLRenderer,
  campus: CampusMaterials,
  sceneTracker: ResourceTracker,
  options: HandBuiltOptions = {},
): HandBuiltBuilding {
  const { facadeStyle = DEFAULT_CAMPUS_STYLE, interiorOnly = false } = options;
  const xf = createPlanTransform(src);
  const meshes: BuildingMeshes = options.meshes ?? buildBuildingMeshes(src);
  const imats: InteriorMaterials = options.shared?.imats ?? createInteriorMaterials(renderer, sceneTracker, src.style?.interior);
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
      [part.curtain, imats.curtain],
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

  // --- Exterior: always present (unless the campus shell stands in for it) --------------------
  const exteriorGroup = placeGroup(`${src.id}:exterior`);
  const exteriorColliders: RAPIER.Collider[] = [];
  if (!interiorOnly) {
    addPart(meshes.exterior, exteriorGroup, sceneTracker, true);
    addColliders(meshes.exterior.colliders, exteriorColliders);
  }
  for (const floor of interiorOnly ? [] : Object.values(src.floors)) {
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
  const kit = options.shared?.kit ?? createFurnitureKit(sceneTracker);
  // Classroom doors, numbered across all levels; open / closed survives interior reloads.
  const swingIndex = new Map<object, number>();
  const swingDoors = meshes.levels.flatMap((lvl) => lvl.doors.filter((d) => d.kind === 'swing'));
  swingDoors.forEach((d, i) => swingIndex.set(d, i));
  const doorOpen: boolean[] = swingDoors.map(() => false);
  interface LoadedInterior {
    root: Group;
    levels: { id: string; base: number; group: Group }[];
    tracker: ResourceTracker;
    colliders: RAPIER.Collider[];
    instanced: InstancedMesh[];
    swings: SwingDoor[];
    mirrors: { mesh: Reflector; x: number; y: number; base: number }[];
  }
  /** A hinged classroom door: one or two leaves turning about their hinge posts. */
  interface SwingDoor {
    /** Index into doorOpen / the `:door:` interactables. */
    index: number;
    collider: RAPIER.Collider;
    x: number;
    y: number;
    base: number;
    leaves: { pivot: Group; closed: number; sign: number }[];
    open: number;
  }
  let interior: LoadedInterior | null = null;
  /** Colliders the camera passes through: furniture, stair ramps, guards and landings (tight shafts). */
  const cameraTransparent = new Set<number>();

  const loadInterior = (): void => {
    const tracker = new ResourceTracker(physics);
    const root = placeGroup(`${src.id}:interior`);
    const colliders: RAPIER.Collider[] = [];
    const instanced: InstancedMesh[] = [];
    const swings: SwingDoor[] = [];
    const mirrors: LoadedInterior['mirrors'] = [];
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
        if (d.kind === 'swing') {
          // Leaves along the wall from each hinge; they turn toward the room side.
          const ux = d.axis === 'h' ? 1 : 0, uy = 1 - ux;
          const nx = d.axis === 'h' ? 0 : d.room ?? 1, ny = d.axis === 'h' ? d.room ?? 1 : 0;
          const hinge = (t: number): [number, number] => (d.axis === 'h' ? [t, d.at] : [d.at, t]);
          const parts: [number, number, number][] = [[d.from, 1, len]]; // classroom doors are single leaves
          const cx = d.axis === 'h' ? (d.from + d.to) / 2 : d.at, cy = d.axis === 'h' ? d.at : (d.from + d.to) / 2;
          const [wx, wz] = xf.toWorld(cx, cy);
          // Closed, the leaf blocks the doorway.
          const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(d.axis === 'h' ? len / 2 : 0.06, 1.15, d.axis === 'h' ? 0.06 : len / 2)
            .setTranslation(wx, d.base + 1.15, wz).setRotation(rapierRot));
          colliders.push(collider);
          cameraTransparent.add(collider.handle);
          const index = swingIndex.get(d)!;
          const door: SwingDoor = { index, collider, x: cx, y: cy, base: d.base, leaves: [], open: 0 };
          for (const [t, dir, w] of parts) {
            const dx = ux * dir, dy = uy * dir;
            const pivot = new Group();
            const [hx, hy] = hinge(t);
            pivot.position.set(hx, d.base, hy);
            const closed = Math.atan2(-dy, dx); // local +x along the closed leaf
            pivot.rotation.y = closed;
            const leaf = new Mesh(tracker.geometry(new BoxGeometry(w - 0.03, 2.3, 0.05).translate(w / 2, 1.15, 0)), imats.door);
            leaf.castShadow = true;
            const handle = new Mesh(tracker.geometry(new BoxGeometry(0.03, 0.18, 0.16).translate(w - 0.12, 1.0, 0)), frameMat);
            pivot.add(leaf, handle);
            group.add(pivot);
            door.leaves.push({ pivot, closed, sign: Math.sign(dy * nx - dx * ny) || 1 });
          }
          swings.push(door);
          continue;
        }
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

      // Full-length wall mirrors: a live reflection (rendered only while the player is close).
      for (const f of src.floors[lvl.id]?.fixtures ?? []) {
        if (f.kind !== 'mirror') continue;
        const ratio = f.width / 2.05;
        const mirror = new Reflector(new PlaneGeometry(f.width, 2.05), {
          textureWidth: Math.round(Math.min(2048, 512 * ratio)), textureHeight: 512, color: 0xc4ccd0, clipBias: 0.003,
        });
        const off = WALL_T / 2 + 0.03;
        mirror.position.set(f.at[0] + f.facing[0] * off, lvl.base + 0.12 + 1.025, f.at[1] + f.facing[1] * off);
        mirror.rotation.y = Math.atan2(f.facing[0], f.facing[1]);
        mirror.visible = false;
        group.add(mirror);
        mirrors.push({ mesh: mirror, x: f.at[0], y: f.at[1], base: lvl.base });
      }

      // Cafeteria stalls: back panel, counter, name board.
      for (const st of src.floors[lvl.id]?.stalls ?? []) {
        const stall = buildStall(st, tracker, frameMat);
        stall.position.set(st.at[0], lvl.base, st.at[1]);
        stall.rotation.y = Math.atan2(st.facing[0], st.facing[1]);
        group.add(stall);
        addColliders([{ c: [st.at[0], lvl.base + 0.6, st.at[1] - st.facing[1] * 0.45], h: [st.width / 2, 0.6, 1.05] }], colliders);
        cameraTransparent.add(colliders[colliders.length - 1]!.handle);
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
    interior = { root, levels, tracker, colliders, instanced, swings, mirrors };
  };

  const unloadInterior = (): void => {
    if (!interior) return;
    for (const c of interior.colliders) physics.removeCollider(c, false);
    cameraTransparent.clear();
    for (const im of interior.instanced) im.dispose();
    for (const m of interior.mirrors) m.mesh.dispose();
    interior.root.removeFromParent();
    interior.tracker.dispose();
    interior = null;
  };

  /**
   * Inside: show the player's floor and its neighbours (voids look one floor up / down).
   * Outside: only the ground floor and basement (seen through doors and the stairwell).
   */
  const rings = options.footprints;
  const levelGrids = rings ? [] : meshes.levels.map((l) => ({ id: l.id, base: l.base, grid: rasterize(src.floors[l.id]!.spaces) }));
  const updateVisibility = (px: number, py: number, pz: number): void => {
    if (!interior) return;
    let current = -1;
    if (rings) {
      if (rings.some((r) => pointInRing(px, pz, r))) meshes.levels.forEach((l, i) => { if (py + 0.8 >= l.base) current = i; });
    } else {
      const [x, y] = xf.toPlan(px, pz);
      levelGrids.forEach((l, i) => {
        if (py + 0.8 >= l.base && cellOf(l.grid, x, y) !== OUTSIDE) current = i;
      });
    }
    interior.levels.forEach((l, i) => {
      l.group.visible = current < 0 ? l.base <= 0 : Math.abs(i - current) <= 1;
    });
  };

  // --- Classroom doors swing open as the player comes near; mirrors render only close by ------------
  let lastDoorTime = performance.now();
  const animateDoors = (px: number, py: number, pz: number): void => {
    const now = performance.now(), dt = Math.min(0.1, (now - lastDoorTime) / 1000);
    lastDoorTime = now;
    if (!interior) return;
    const [x, y] = xf.toPlan(px, pz);
    for (const d of interior.swings) {
      const want = doorOpen[d.index] ?? false;
      const target = want ? 1 : 0;
      d.collider.setEnabled(!want && d.open < 0.05); // passable as soon as it starts to open
      if (d.open === target) continue;
      d.open = Math.max(0, Math.min(1, d.open + (target > d.open ? 1 : -1) * SWING_SPEED * dt));
      const e = d.open * d.open * (3 - 2 * d.open); // ease in and out
      for (const leaf of d.leaves) leaf.pivot.rotation.y = leaf.closed + leaf.sign * SWING_ANGLE * e;
    }
    for (const m of interior.mirrors) m.mesh.visible = Math.abs(py - m.base) < 2.5 && Math.hypot(x - m.x, y - m.y) < MIRROR_RANGE;
  };

  // --- Interactables -------------------------------------------------------------------------------
  const interactables: Interactable[] = [];
  for (const [levelId, floor] of Object.entries(src.floors)) {
    if (!floor.elevator) continue;
    const [x, z] = xf.toWorld(floor.elevator.landing[0], floor.elevator.landing[1]);
    const y = src.levels.find((l) => l.id === levelId)?.elevation ?? 0;
    interactables.push({ id: `${src.id}:elevator:${levelId}`, prompt: '按 E 搭乘電梯', x, y, z, radius: ELEVATOR_REACH });
  }

  const doorInteractables = swingDoors.map((d, i) => {
    const [x, z] = d.axis === 'h' ? xf.toWorld((d.from + d.to) / 2, d.at) : xf.toWorld(d.at, (d.from + d.to) / 2);
    const it: Interactable = { id: `${src.id}:door:${i}`, prompt: d.locked ? '按 E 開門（實驗室）' : '按 E 開門', x, y: d.base, z, radius: DOOR_REACH };
    interactables.push(it);
    return it;
  });

  meshes.portals.forEach((pt, i) => {
    const [x, z] = xf.toWorld(pt.at[0], pt.at[2]);
    interactables.push({ id: `${src.id}:stairs:${i}`, prompt: `按 E ${pt.up ? '上樓' : '下樓'}到 ${pt.level}`, x, y: pt.at[1], z, radius: 1.5 });
  });

  for (const [levelId, floor] of Object.entries(src.floors)) {
    const y = src.levels.find((l) => l.id === levelId)?.elevation ?? 0;
    (floor.stalls ?? []).forEach((st, i) => {
      if (!st.menu) return;
      const [x, z] = xf.toWorld(st.at[0] + st.facing[0] * 2.4, st.at[1] + st.facing[1] * 2.4);
      interactables.push({ id: `${src.id}:stall:${levelId}:${i}`, prompt: `按 E 買${st.name}`, x, y, z, radius: 2.4 });
    });
  }

  for (const [levelId, floor] of Object.entries(src.floors)) {
    const y = src.levels.find((l) => l.id === levelId)?.elevation ?? 0;
    (floor.fixtures ?? []).forEach((f, i) => {
      if (f.kind !== 'vending') return;
      const [x, z] = xf.toWorld(f.at[0] + f.facing[0] * 1.4, f.at[1] + f.facing[1] * 1.4);
      interactables.push({ id: `${src.id}:vending:${levelId}:${i}`, prompt: '按 E 用販賣機買飲料', x, y, z, radius: 1.3 });
    });
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
    stairPortals: meshes.portals,
    toggleDoor(i) {
      if (i < 0 || i >= doorOpen.length) return null;
      if (swingDoors[i]!.locked) return '實驗室上鎖了，非相關人員不可進入';
      doorOpen[i] = !doorOpen[i];
      doorInteractables[i]!.prompt = doorOpen[i] ? '按 E 關門' : '按 E 開門';
      return null;
    },
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
      animateDoors(px, py, pz);
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
