import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { createWorld } from 'bitecs';
import { CAMERA, FIXED_DT, FLOORPLAN_INTERIORS, MAX_SUBSTEPS, RENDER } from './config';
import { createAudioBus } from './audio/audio';
import { createPointerLock } from './input/pointerLock';
import { createSession, type GameApi } from './game/session';
import { installHotkeys } from './game/hotkeys';
import { drainCommands, type GameCommand } from './state/commands';
import { START_MINUTES, actions, gameStore, type GameState } from './state/store';
import { STALL_MENUS, type ItemId } from './state/items';
import type { Settings } from './state/settings';
import { telemetry } from './state/telemetry';
import { createCoinSystem } from './ecs/systems/coins';
import { mountUI } from './ui/App';
import { ResourceTracker } from './core/resources';
import { RAPIER, initPhysics } from './physics/physics';
import { createInput } from './input/input';
import { ToonPalette, createOutlineMaterial, createToonRamp } from './render/toon';
import { createCampusWorld } from './campus/campusWorld';
import { facadeStyleOf, type FacadeData } from './campus/facadeTypes';
import {
  buildingFootprintRings,
  buildingGroundHoles,
  createHandBuiltBuilding,
  loadBuildingSource,
  type HandBuiltBuilding,
  type Interactable,
} from './buildings/buildingWorld';
import { createInteriorManager } from './interiors/interiorManager';
import type { TracedIndex } from './buildings/buildingTypes';
import { campusCoinSpots } from './campus/coinSpots';
import type { CampusData } from './campus/campusTypes';
import { spawnPlayer } from './ecs/spawn';
import { createAssetLoader } from './assets/loader';
import { buildProceduralCharacter, loadCharacterModel, type CharacterModel } from './character/characterModel';
import { ANIM_NAMES, AnimState, CharacterMotor, Transform, Velocity } from './ecs/components';
import { bodies, colliders, objects } from './ecs/registry';
import { CAPSULE_CENTER_OFFSET, createCharacterControllerSystem, type MoveModifiers } from './ecs/systems/characterController';
import { createBikeSystem } from './bikes/bikeSystem';
import { createPlayground } from './playground/playground';
import { addCafeteriaSign } from './buildings/cafeteriaSign';
import { createSkyBridge } from './buildings/skyBridge';
import { createAutoDoors, type DoorSpec } from './buildings/autoDoors';
import { DOOR_HEIGHT, DOOR_WIDTH, buildingEntrance, hasInterior } from './campus/entrances';
import { SHELL_WALL } from './interiors/generateInterior';
import { createMgmtFeatures } from './buildings/mgmtFeatures';
import { courtPit, createMgmtCourtyard } from './buildings/mgmtCourtyard';
import { createMbLobby } from './buildings/mbLobby';
import { MAIN_GATE_GUARDHOUSE, createMainGate, gateTreeExclusions, inGateZone } from './campus/mainGate';
import { addBoundaryZone } from './campus/boundaryZone';
import { includeLongtanRoad, widenCampusRoads } from './campus/campusFixes';
import { SCOOTER_LOTS, createScooterLots } from './campus/scooterLots';
import { createSensorGates } from './campus/sensorGates';
import { inGateArea } from './campus/mainGate';
import { UNLABELLED_NAMES } from './campus/placeNames';
import { createBuildingTest, placeBikeStations, stationClearings } from './bikes/bikeStations';
import { findMascotJoints } from './character/mascot';
import { CLOCK_RATE, applyPose, computeRidePose, createPose } from './character/pose';
import { safeTeleportTarget } from './game/teleport';
import { buildNavGraph, pathAhead, progressOn } from './game/navGraph';
import { createNavLine } from './game/navLine';
import { INTERIOR_LAYOUT, loadProgress, saveProgress } from './state/saveGame';
import { animationSystem } from './ecs/systems/animation';
import { renderSyncSystem } from './ecs/systems/renderSync';
import { createThirdPersonCamera, type CameraFocus } from './camera/thirdPersonCamera';
import { createDebugHud } from './ui/debugHud';

const AUTOSAVE_SECONDS = 5;
/** How long a restored game waits for an upper floor to stream in. */
const FLOOR_WAIT_MS = 10000;
const MENU_ORBIT_RATE = 0.06;
const MENU_ORBIT_RADIUS = 95;
const MENU_ORBIT_HEIGHT = 46;
const PLAYER_MODEL_URL = `${import.meta.env.BASE_URL}models/mascot.glb`;
const CAMPUS_DATA_URL = `${import.meta.env.BASE_URL}data/campus.json`;
const LIBRARY_URL = `${import.meta.env.BASE_URL}data/buildings/library.json`;
/** Other hand-traced buildings (scripts/floorplan/handbuilt/*.py), each replacing its OSM extrusion. */
const HAND_BUILT_URLS = [`${import.meta.env.BASE_URL}data/buildings/ma.json`, `${import.meta.env.BASE_URL}data/buildings/mb.json`];
const FACADES_URL = `${import.meta.env.BASE_URL}data/facades.json`;
const TRACED_URL = `${import.meta.env.BASE_URL}data/buildings/traced.json`;

const FOOD: ReadonlySet<ItemId> = new Set<ItemId>(['bread', 'bento', 'buffet', 'beefNoodles', 'plainNoodles', 'bubbleTea', 'soyMilk']);

const ITEM_MESSAGES: Readonly<Record<ItemId, string>> = {
  bento: '排骨便當好吃！',
  buffet: '三菜一肉，吃飽了！',
  beefNoodles: '呼嚕呼嚕… 湯頭真濃！',
  plainNoodles: '暖暖的陽春麵。',
  bubbleTea: '珍珠好Q！',
  soyMilk: '冰豆漿，舒暢！',
  studentCard: '📛 國立雲林科技大學 · 新鮮人',
  waterBottle: '咕嚕咕嚕… 補充水分！',
  bread: '吃了一個菠蘿麵包，元氣滿滿！',
  notebook: '今日待辦：探索校園、收集金幣、找到圖書館',
  campusMap: '',
};

/** Gameplay effect of using an inventory item (runs inside the fixed step via the command queue). */
function useItem(slot: number, api: GameApi): void {
  const stack = gameStore.getState().inventory[slot];
  if (!stack) return;
  if (stack.id === 'campusMap') {
    api.closeModal();
    api.toggleMap();
    return;
  }
  if (FOOD.has(stack.id)) actions.consumeItem(slot);
  actions.toast(ITEM_MESSAGES[stack.id]);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game');
  const debugEl = document.getElementById('debug');
  const uiEl = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !debugEl || !uiEl) throw new Error('missing #game, #debug or #ui-root');

  // UI first, so the loading screen shows while physics / assets initialise.
  const lock = createPointerLock(canvas);
  const audio = createAudioBus();
  const api = createSession(lock, audio);
  const uiRoot = mountUI(uiEl, api);
  const removeHotkeys = installHotkeys(api, lock);

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA.baseFov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);

  const physics = await initPhysics();
  actions.setLoadProgress(0.25);
  const sceneResources = new ResourceTracker(physics);
  const palette = new ToonPalette(createToonRamp(sceneResources), sceneResources);
  const outline = createOutlineMaterial(sceneResources);
  const campusRes = await fetch(CAMPUS_DATA_URL);
  if (!campusRes.ok) throw new Error(`${CAMPUS_DATA_URL}: HTTP ${campusRes.status} (run npm run campus:fetch)`);
  const campus = (await campusRes.json()) as CampusData;
  // The main gate's guardhouse is hand-built (campus/mainGate.ts), not extruded.
  const guardhouse = campus.buildings.find((b) => b.id === MAIN_GATE_GUARDHOUSE);
  if (guardhouse) guardhouse.replacedBy = 'mainGate';
  includeLongtanRoad(campus);
  widenCampusRoads(campus);
  campus.parking = SCOOTER_LOTS.map((l) => ({ name: l.name, ring: l.ring }));
  actions.setMapData(campus);
  const librarySrc = await loadBuildingSource(LIBRARY_URL);
  const handBuiltSrcs = await Promise.all(HAND_BUILT_URLS.map((url) => loadBuildingSource(url)));
  // 管理學院中庭: the sunken garden cuts the ground open; no trees anywhere in the courtyard.
  const mbSrc = handBuiltSrcs.find((s) => s.id === 'mb');
  const court = mbSrc ? courtPit(mbSrc) : null;
  for (const src of handBuiltSrcs) {
    for (const b of campus.buildings) if (b.name && src.osmReplaces.includes(b.name)) b.replacedBy = src.id;
  }
  // Facade styles / photo atlases are optional: without them every building uses the default style.
  const facades = await fetch(FACADES_URL)
    .then((r) => (r.ok ? (r.json() as Promise<FacadeData>) : undefined))
    .catch(() => undefined);
  // Plan-traced interiors (scripts/floorplan/trace.py) and the shell door gaps they need.
  const traced = FLOORPLAN_INTERIORS
    ? await fetch(TRACED_URL)
        .then((r) => (r.ok ? (r.json() as Promise<TracedIndex>) : undefined))
        .catch(() => undefined)
    : undefined;
  const bikeStations = placeBikeStations(campus);
  actions.setBikeStations(bikeStations);
  const env = createCampusWorld(scene, physics, renderer, campus, sceneResources, {
    treeExclusions: [...buildingFootprintRings(librarySrc), ...handBuiltSrcs.flatMap(buildingFootprintRings), ...stationClearings(bikeStations), ...gateTreeExclusions(), ...SCOOTER_LOTS.map((l) => l.ring), ...(court ? [court.treeFree] : [])],
    groundHoles: [...buildingGroundHoles(librarySrc), ...(court?.rings ?? [])],
    facades,
    entrances: traced?.entrances,
  });
  const library = createHandBuiltBuilding(librarySrc, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, librarySrc.osmReplaces[0] ?? librarySrc.name),
  });
  // Respawn point: one chosen on the map (saved per browser), else the campus default (dorm C entrance).
  const spawnPoint = (): { x: number; y: number; z: number; facing: number } => {
    const custom = gameStore.getState().customSpawn;
    return custom ? { ...custom, y: 0 } : { x: campus.spawn.x, y: 0, z: campus.spawn.z, facing: campus.spawn.facing };
  };
  // Every other campus building: generated interiors streamed in near the player.
  const interiors = createInteriorManager(scene, physics, renderer, env.materials, campus, facades, sceneResources, traced);
  const handBuilt = handBuiltSrcs.map((src) => createHandBuiltBuilding(src, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, src.osmReplaces[0] ?? src.name),
  }));
  // 2F sky bridge 管理二館 → 管理一館: from the door at the north end of MB's east wing to MA's west corridor end.
  const byId = (id: string): HandBuiltBuilding | undefined => handBuilt.find((b) => b.source.id === id);
  const ma = byId('ma'), mb = byId('mb');
  const skyBridge = ma && mb ? createSkyBridge(scene, physics, sceneResources, { building: mb, at: [50.95, -2.3] }, { building: ma, at: [76.5, 12.75] }, 3.6) : null;
  const mgmtFeatures = createMgmtFeatures(scene, physics, sceneResources, ma);
  const mgmtCourtyard = mb ? createMgmtCourtyard(scene, physics, sceneResources, mb) : null;
  const mbLobby = mb ? createMbLobby(scene, physics, sceneResources, mb) : null;

  // Sensor sliding doors: plan exits of the hand-built buildings, and the shell entrance of every
  // building with a generated interior (the same entrance the campus chunks leave open).
  const doorSpecs: DoorSpec[] = [];
  for (const b of [library, ...handBuilt]) {
    const ground = b.source.levels.find((l) => l.elevation === 0);
    for (const o of (ground && b.source.floors[ground.id]?.openings) ?? []) {
      if (o.kind !== 'exit') continue;
      const [ax, az] = b.planToWorld(o.a[0], o.a[1]), [bx, bz] = b.planToWorld(o.b[0], o.b[1]);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.8) continue;
      doorSpecs.push({ x: (ax + bx) / 2, z: (az + bz) / 2, ux: (bx - ax) / len, uz: (bz - az) / len, width: len, height: 2.35, ...(o.frame === 'dark' ? { dark: true } : {}) });
    }
  }
  for (const b of campus.buildings) {
    if (!hasInterior(b)) continue;
    const photoEdges = new Set((facades?.photos[String(b.id)]?.edges ?? []).map((e) => e.edge));
    const e = traced?.entrances[String(b.id)]?.[0] ?? buildingEntrance(b, campus.roads, photoEdges);
    if (!e) continue;
    const r = b.outer, n = r.length / 2, j = (e.edge + 1) % n;
    const dx = r[j * 2]! - r[e.edge * 2]!, dz = r[j * 2 + 1]! - r[e.edge * 2 + 1]!, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, inx = -uz, inz = ux; // rings are CCW: (−dz, dx) points into the building
    doorSpecs.push({
      x: r[e.edge * 2]! + ux * e.along - inx * -SHELL_WALL / 2, z: r[e.edge * 2 + 1]! + uz * e.along - inz * -SHELL_WALL / 2,
      ux, uz, width: DOOR_WIDTH, height: DOOR_HEIGHT - 0.05,
    });
  }
  const autoDoors = createAutoDoors(scene, physics, sceneResources, doorSpecs);
  const buildings = (): readonly HandBuiltBuilding[] => [library, ...handBuilt, ...interiors.active];
  const buildingById = (id: string): HandBuiltBuilding | undefined => buildings().find((b) => b.source.id === id);
  // A new game always starts at the dorm C courtyard; a custom point only applies to respawning.
  const spawn = { x: campus.spawn.x, y: 0, z: campus.spawn.z, facing: campus.spawn.facing };
  await env.loadAround(spawn.x, spawn.z, (f) => actions.setLoadProgress(0.25 + f * 0.25));
  physics.step(); // build the query pipeline before the first shape/ray casts
  actions.setLoadProgress(0.5);

  const world = createWorld();
  const input = createInput(canvas);
  const coins = createCoinSystem(world, scene, sceneResources, campusCoinSpots(campus));
  const controller = createCharacterControllerSystem(physics, input);
  const assets = createAssetLoader(renderer);
  const playerResources = new ResourceTracker(physics);
  let model: CharacterModel;
  try {
    model = await loadCharacterModel(assets, PLAYER_MODEL_URL, palette, outline, playerResources, (f) => actions.setLoadProgress(0.5 + f * 0.45));
  } catch (err: unknown) {
    console.warn(`[assets] ${PLAYER_MODEL_URL} failed to load, using the procedural mascot`, err);
    model = buildProceduralCharacter(palette, outline, playerResources);
  }
  const player = spawnPlayer(world, scene, physics, model, playerResources, spawn, spawn.facing);
  const eid = player.eid;
  const rig = createThirdPersonCamera(camera, physics);
  const playground = createPlayground(scene, physics, campus, sceneResources);
  actions.setRaceStart(playground?.startSpot ?? null);
  addCafeteriaSign(scene, campus, sceneResources);
  const mainGate = createMainGate(scene, physics, campus, sceneResources);
  addBoundaryZone(scene, campus, sceneResources, inGateZone);
  const scooterLots = createScooterLots(scene, physics, campus, sceneResources);
  const sensorGates = createSensorGates(scene, physics, sceneResources);
  const navGraph = buildNavGraph(campus);
  const navLine = createNavLine(scene, sceneResources);
  const bikes = createBikeSystem(scene, bikeStations, sceneResources);
  const insideBuilding = createBuildingTest(campus);
  const moveMods: MoveModifiers = { fly: false, noclip: false, speed: 1, bike: false, blocked: null };
  const joints = findMascotJoints(model.root);
  const ridePose = createPose();

  const focus: CameraFocus = { x: 0, y: 0, z: 0, sprinting: false, landingSeq: 0, landingSpeed: 0 };
  const readFocus = (): CameraFocus => {
    const obj = objects[eid];
    if (obj) {
      focus.x = obj.position.x;
      focus.y = obj.position.y;
      focus.z = obj.position.z;
    }
    focus.sprinting = CharacterMotor.sprinting[eid] === 1 && Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!) > 0.5;
    focus.landingSeq = CharacterMotor.landingSeq[eid]!;
    focus.landingSpeed = CharacterMotor.landingSpeed[eid]!;
    return focus;
  };
  const teleport = (x: number, y: number, z: number, facing?: number): void => {
    bodies[eid]?.setTranslation({ x, y: y + CAPSULE_CENTER_OFFSET, z }, true);
    Transform.x[eid] = Transform.prevX[eid] = x;
    Transform.y[eid] = Transform.prevY[eid] = y;
    Transform.z[eid] = Transform.prevZ[eid] = z;
    if (facing !== undefined) Transform.rotY[eid] = Transform.prevRotY[eid] = facing;
    Velocity.x[eid] = Velocity.y[eid] = Velocity.z[eid] = 0;
  };
  renderSyncSystem(world, 1);
  rig.snap(readFocus(), spawn.facing + Math.PI); // start behind the character

  /** Standing height at (x, z): the first floor below 2.5 m (library 1F / B1 slab or the ground). */
  const groundHeightAt = (x: number, z: number): number => {
    const ray = new RAPIER.Ray({ x, y: 2.5, z }, { x: 0, y: -1, z: 0 });
    const hit = physics.castRay(ray, 20, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, colliders[eid], undefined,
      (c) => c.handle !== env.groundCollider.handle || !(library.isOverBasement(x, z) || !!court?.contains(x, z)));
    return hit ? 2.5 - hit.timeOfImpact : 0;
  };

  // --- Area banner: which named place the player is in (building + storey, sports ground, gate).
  const areaBuildings = campus.buildings
    .filter((b) => b.name && b.inCampus && !UNLABELLED_NAMES.has(b.name))
    .map((b) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < b.outer.length; i += 2) {
        x0 = Math.min(x0, b.outer[i]!); x1 = Math.max(x1, b.outer[i]!);
        z0 = Math.min(z0, b.outer[i + 1]!); z1 = Math.max(z1, b.outer[i + 1]!);
      }
      return { b, x0, z0, x1, z1, storey: b.height / Math.max(1, b.levels) };
    });
  const inRing = (x: number, z: number, r: readonly number[]): boolean => {
    let inside = false;
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const sportsField = playground
    ? campus.fields.filter((f) => f.kind === 'soccer').sort((a, b) =>
      Math.hypot(a.outer[0]! - playground.startSpot.x, a.outer[1]! - playground.startSpot.z) - Math.hypot(b.outer[0]! - playground.startSpot.x, b.outer[1]! - playground.startSpot.z))[0]
    : undefined;
  const nearField = (x: number, z: number): boolean => {
    if (!sportsField) return false;
    if (inRing(x, z, sportsField.outer)) return true;
    const r = sportsField.outer;
    for (let i = 0, n = r.length / 2; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2]!, az = r[i * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 14) return true; // the track around the pitch
    }
    return false;
  };
  const areaAt = (x: number, y: number, z: number): { key: string; title: string; subtitle: string } | null => {
    for (const a of areaBuildings) {
      if (x < a.x0 || x > a.x1 || z < a.z0 || z > a.z1 || !inRing(x, z, a.b.outer)) continue;
      const name = a.b.name!;
      if (a.b.levels <= 1) return { key: name, title: name, subtitle: '' };
      const floor = Math.max(1, Math.floor((y + 0.4) / a.storey) + 1);
      return { key: `${name}|${floor}`, title: name, subtitle: `${floor}F` };
    }
    if (nearField(x, z)) return { key: '操場', title: '操場', subtitle: '跑道計時賽' };
    const lot = campus.parking?.find((l) => inRing(x, z, l.ring));
    if (lot) return { key: lot.name, title: '機車停車場', subtitle: lot.name.replace(/^機車停車場（|）$/g, '') };
    if (inGateArea(x, z)) return { key: '大門', title: '大門', subtitle: '國立雲林科技大學' };
    return null;
  };
  let introPending = false;
  // --- Navigation upkeep: trim the guide as the player walks, reroute when far off it, arrive.
  let lastNavCheck = 0;
  let lastReroute = -Infinity;
  const NAV_ARRIVE = 6, NAV_OFF_ROUTE = 15;
  const updateNav = (now: number, x: number, z: number): void => {
    const nav = gameStore.getState().nav;
    if (!nav || now - lastNavCheck < 0.3) return;
    lastNavCheck = now;
    if (Math.hypot(nav.x - x, nav.z - z) < NAV_ARRIVE) {
      actions.setNav(null);
      navLine.set(null);
      actions.toast(`🏁 已抵達 ${nav.name}`);
      audio.play('coin');
      return;
    }
    const prog = progressOn(nav.path, x, z);
    if (prog.off > NAV_OFF_ROUTE && now - lastReroute > 2) {
      lastReroute = now;
      const path = navGraph.route(x, z, nav.x, nav.z);
      actions.setNav({ ...nav, path, remaining: progressOn(path, x, z).remaining });
      navLine.set(path);
      return;
    }
    actions.setNavRemaining(prog.remaining + prog.off);
    navLine.set(pathAhead(nav.path, x, z));
  };
  let areaKey: string | null = null;
  let lastAreaCheck = 0;
  const areaShownAt = new Map<string, number>();
  const AREA_REPEAT_S = 20;
  const updateArea = (now: number, x: number, y: number, z: number): void => {
    if (now - lastAreaCheck < 0.25) return;
    lastAreaCheck = now;
    const area = areaAt(x, y, z);
    if (introPending) {
      introPending = false;
      areaKey = area?.key ?? null;
      if (area) areaShownAt.set(area.key, now);
      actions.showArea(area?.title ?? '國立雲林科技大學', area ? area.subtitle : '雲寶寶上學趣');
      return;
    }
    const key = area?.key ?? null;
    if (key === areaKey) return;
    areaKey = key;
    if (!area || now - (areaShownAt.get(area.key) ?? -Infinity) < AREA_REPEAT_S) return;
    areaShownAt.set(area.key, now);
    actions.showArea(area.title, area.subtitle);
  };

  /** Destination of a load in progress: the world streams around it instead of the player. */
  let streamAt: { x: number; y: number; z: number } | null = null;

  /** Waits for the floor under a saved spot (an upper storey streams in); null if it never comes. */
  const awaitFloor = async (x: number, y: number, z: number): Promise<number | null> => {
    const ray = new RAPIER.Ray({ x, y: y + 1, z }, { x: 0, y: -1, z: 0 });
    for (const deadline = performance.now() + FLOOR_WAIT_MS; performance.now() < deadline;) {
      const hit = physics.castRay(ray, 2.5, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, colliders[eid]);
      if (hit) return y + 1 - hit.timeOfImpact;
      await new Promise((r) => window.setTimeout(r, 100));
    }
    return null;
  };

  const handleCommand = (cmd: GameCommand): void => {
    switch (cmd.type) {
      case 'loadSave': {
        introPending = true;
        actions.setNav(null);
        navLine.set(null);
        const save = loadProgress();
        if (!save) return;
        actions.restoreProgress(save);
        clockSeconds = save.gameMinutes - START_MINUTES;
        bikes.dismount();
        playground?.cancel();
        streamAt = save;
        actions.setFading(true);
        void env.loadAround(save.x, save.z).then(() => awaitFloor(save.x, save.y, save.z)).then((floor) => {
          // An indoor spot saved under an older interior layout may now be inside a wall: use the respawn point.
          const stale = save.layout !== INTERIOR_LAYOUT && insideBuilding(save.x, save.z);
          const p = floor === null || stale ? spawnPoint() : { x: save.x, y: floor, z: save.z, facing: save.facing };
          teleport(p.x, p.y, p.z, p.facing);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), p.facing + Math.PI);
          streamAt = null;
          actions.setFading(false);
          if (floor === null) actions.toast('存檔位置載入失敗，已回到重生點');
          else if (stale) actions.toast('室內格局已更新，已回到重生點（金錢與物品保留）');
        });
        return;
      }
      case 'navigate': {
        const px = Transform.x[eid]!, pz = Transform.z[eid]!;
        const path = navGraph.route(px, pz, cmd.x, cmd.z);
        actions.setNav({ name: cmd.name, x: cmd.x, z: cmd.z, path, remaining: progressOn(path, px, pz).remaining });
        navLine.set(path);
        lastReroute = time;
        actions.toast(`開始導航：${cmd.name}`);
        return;
      }
      case 'stopNav':
        actions.setNav(null);
        navLine.set(null);
        actions.toast('已結束導航');
        return;
      case 'leaveRace':
        if (playground?.racing) {
          playground.cancel();
          actions.toast('已離開計時賽');
        }
        return;
      case 'newGame':
        introPending = true;
        actions.setNav(null);
        navLine.set(null);
        clockSeconds = 0;
        bikes.dismount();
        playground?.cancel();
        teleport(spawn.x, spawn.y, spawn.z, spawn.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), spawn.facing + Math.PI);
        return;
      case 'toStart':
      case 'respawn': {
        bikes.dismount();
        playground?.cancel();
        const p = cmd.type === 'toStart' ? spawn : spawnPoint();
        teleport(p.x, p.y, p.z, p.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), p.facing + Math.PI);
        return;
      }
      case 'teleport': {
        // Fade out, stream the destination in, land on a safe spot, fade back in.
        // Off-campus targets land just inside the boundary instead.
        const inside = env.clampInsideCampus(cmd.x, cmd.z);
        const target = safeTeleportTarget(campus, inside.x, inside.z);
        bikes.dismount();
        playground?.cancel();
        actions.setFading(true);
        streamAt = { x: target.x, y: 0, z: target.z };
        void Promise.all([env.loadAround(target.x, target.z), new Promise((r) => window.setTimeout(r, 300))]).then(() => {
          physics.step(); // register the destination's colliders before the ground ray
          teleport(target.x, groundHeightAt(target.x, target.z), target.z);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), rig.yaw);
          streamAt = null;
          actions.setFading(false);
          actions.toast(target.outsideOf ? `已傳送到 ${cmd.label}（${target.outsideOf} 外側）` : `已傳送到 ${cmd.label}`);
        });
        return;
      }
      case 'useItem':
        useItem(cmd.slot, api);
        return;
      case 'interact': {
        if (bikes.ridden >= 0) {
          bikes.dismount();
          return;
        }
        const target = nearestInteractable();
        if (target?.id.includes(':stall:')) {
          const [buildingId, , levelId, index] = target.id.split(':');
          const stall = buildingById(buildingId ?? '')?.source.floors[levelId ?? '']?.stalls?.[Number(index)];
          if (stall?.menu) {
            actions.setShop({ title: stall.name, items: STALL_MENUS[stall.menu] });
            api.openModal('shop');
          }
          return;
        }
        if (target?.id.includes(':door:')) {
          const [buildingId, index] = target.id.split(':door:');
          const refused = buildingById(buildingId ?? '')?.toggleDoor(Number(index));
          if (refused) {
            actions.toast(refused);
            audio.play('close');
          } else audio.play('click');
          return;
        }
        if (target?.id.includes(':stairs:')) {
          // Stair curtain: fade out, arrive in front of the curtain on the other floor, fade back in.
          const [buildingId, index] = target.id.split(':stairs:');
          const building = buildingById(buildingId ?? '');
          const portal = building?.stairPortals[Number(index)];
          if (!building || !portal || gameStore.getState().fading) return;
          actions.setFading(true);
          window.setTimeout(() => {
            const [x, z] = building.planToWorld(portal.to[0], portal.to[2]);
            const facing = building.planFacing(portal.facing);
            teleport(x, portal.to[1], z, facing);
            renderSyncSystem(world, 1);
            rig.snap(readFocus(), facing + Math.PI);
            actions.setFading(false);
            actions.toast(`${portal.level} 到了`);
          }, 350);
          return;
        }
        if (!target && playground?.canStart(Transform.x[eid]!, Transform.z[eid]!)) {
          const p = playground.start(gameStore.getState().tester.enabled);
          teleport(p.x, 0, p.z, p.facing);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), p.facing + Math.PI);
          return;
        }
        if (playground?.racing) return;
        if (!target) {
          const bike = bikes.nearest(Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!);
          if (bike >= 0) {
            const b = bikes.pose(bike);
            teleport(b.x, Transform.y[eid]!, b.z, b.yaw);
            bikes.mount(bike);
          }
          return;
        }
        const building = target ? buildingById(target.id.split(':elevator:')[0] ?? '') : undefined;
        if (!target || !building) return;
        const src = building.source;
        const current = target.id.split(':elevator:')[1] ?? '1F';
        const directory = new Map(src.directory.map((d) => [d.level, d.items.join('、')]));
        actions.setElevator({
          building: src.id,
          title: src.name,
          current,
          levels: src.levels.map((l) => ({
            id: l.id,
            enabled: l.built && l.elevator !== false,
            note: !l.built
              ? `建置中 · ${directory.get(l.id) ?? ''}`
              : l.elevator === false
                ? `電梯不停靠，請走樓梯 · ${directory.get(l.id) ?? ''}`
                : (directory.get(l.id) ?? ''),
          })),
        });
        api.openModal('elevator');
        return;
      }
      case 'elevatorTo': {
        const building = buildingById(cmd.building);
        if (!building) return;
        const level = building.source.levels.find((l) => l.id === cmd.level);
        const landing = building.source.floors[cmd.level]?.elevator;
        const current = gameStore.getState().elevator?.current;
        if (!level?.built || !landing) {
          actions.toast(`${cmd.level} 尚在建置中`);
          return;
        }
        if (cmd.level === current) {
          actions.toast(`您已在 ${cmd.level}`);
          return;
        }
        // Fade out, move to the landing of the chosen floor, fade back in.
        actions.setFading(true);
        window.setTimeout(() => {
          const [x, z] = building.planToWorld(landing.landing[0], landing.landing[1]);
          const facing = building.planFacing(landing.facing);
          teleport(x, level.elevation, z, facing);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), facing + Math.PI);
          actions.setFading(false);
          actions.toast(`${cmd.level} 到了`);
        }, 350);
        return;
      }
    }
  };

  // Over a basement the campus ground collider is ignored; the basement's own top slab takes over.
  const groundHandle = env.groundCollider.handle;
  const groundFilter = (c: { handle: number }): boolean =>
    c.handle !== groundHandle || !(library.isOverBasement(Transform.x[eid]!, Transform.z[eid]!) || !!court?.contains(Transform.x[eid]!, Transform.z[eid]!));

  const cameraFilter = (c: { handle: number }): boolean =>
    groundFilter(c) && !env.isBoundaryCollider(c.handle) && !buildings().some((b) => b.isCameraTransparent(c.handle));

  const nearestInteractable = (): Interactable | null => {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of buildings().flatMap((b) => b.interactables)) {
      const d = Math.hypot(Transform.x[eid]! - it.x, Transform.z[eid]! - it.z);
      if (d < it.radius && d < bestD && Math.abs(Transform.y[eid]! - it.y) < 1.5) {
        best = it;
        bestD = d;
      }
    }
    return best;
  };

  // --- Store → engine bindings (settings, input gating) --------------------------------------
  const applySettings = (st: Settings): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio) * st.renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    env.setShadowQuality(st.shadows);
    audio.setVolumes(st.masterVolume, st.sfxVolume);
  };
  const applyDebugVisibility = (st: GameState): void => {
    debugEl.style.display = st.settings.showDebug && st.phase === 'playing' ? '' : 'none';
  };
  const applyInputGate = (st: GameState): void => {
    input.setEnabled(st.phase === 'playing' && st.modal === 'none' && st.mapMode === 'mini');
    input.setDragLook(st.lookMode === 'drag');
  };
  applySettings(gameStore.getState().settings);
  applyInputGate(gameStore.getState());
  applyDebugVisibility(gameStore.getState());
  /** Stores the current progress, unless the character's position isn't a real one right now. */
  const saveNow = (): void => {
    const st = gameStore.getState();
    if (streamAt || st.fading || st.tester.fly || st.tester.noclip || Transform.y[eid]! < -40) return;
    saveProgress({
      coins: st.coins,
      gameMinutes: st.gameMinutes,
      inventory: st.inventory,
      hotbarIndex: st.hotbarIndex,
      x: Transform.x[eid]!,
      y: Transform.y[eid]!,
      z: Transform.z[eid]!,
      facing: Transform.rotY[eid]!,
      layout: INTERIOR_LAYOUT,
    });
    actions.setHasSave(true);
  };
  const saveIfPlaying = (): void => {
    if (gameStore.getState().phase === 'playing') saveNow();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') saveIfPlaying();
  };
  window.addEventListener('pagehide', saveIfPlaying);
  document.addEventListener('visibilitychange', onVisibility);

  const unsubscribe = gameStore.subscribe((st, prev) => {
    if (prev.phase === 'playing' && st.phase !== 'playing') saveNow(); // before quitting moves the player
    if (st.settings !== prev.settings) applySettings(st.settings);
    if (st.settings !== prev.settings || st.phase !== prev.phase) applyDebugVisibility(st);
    if (st.phase !== prev.phase || st.modal !== prev.modal || st.lookMode !== prev.lookMode || st.mapMode !== prev.mapMode) applyInputGate(st);
  });
  const onCanvasClick = (): void => api.relock();
  canvas.addEventListener('click', onCanvasClick);

  actions.setLoadProgress(1);
  actions.setPhase('menu');

  if (import.meta.env.DEV) {
    // Console handle for tuning and automated checks: __game.teleport(20, 0, 10), __game.state()
    Object.assign(window, {
      __game: {
        teleport,
        store: gameStore,
        model: model.source,
        world: env,
        scene,
        library,
        interiors,
        playground,
        /** Point the camera along a world yaw (dev inspection). */
        look(yaw: number) {
          rig.snap(readFocus(), yaw);
        },
        root: model.root,
        state: () => ({
          x: Transform.x[eid], y: Transform.y[eid], z: Transform.z[eid],
          vy: Velocity.y[eid], grounded: CharacterMotor.grounded[eid] === 1,
          anim: ANIM_NAMES[AnimState.current[eid]!], cameraYaw: rig.yaw, fov: camera.fov,
        }),
      },
    });
  }

  const updateDebug = createDebugHud(debugEl, renderer);
  let clockSeconds = 0;
  let lastSave = 0;
  let lastJumpSeq = 0;
  let lastLandingSeq = 0;

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applySettings(gameStore.getState().settings); // DPR may change when moving between monitors
  };
  window.addEventListener('resize', onResize);

  const mouse = { dx: 0, dy: 0 };
  let accumulator = 0;
  let lastBoundaryWarning = -Infinity;
  let menuOrbit = 0.6;
  let last = performance.now();
  let time = 0;

  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;

    const ui = gameStore.getState();
    const playing = ui.phase === 'playing';

    input.consumeMouse(mouse);
    if (playing) {
      const k = ui.settings.mouseSensitivity;
      rig.rotate(mouse.dx * k, mouse.dy * k * (ui.settings.invertY ? -1 : 1));
      // Game clock: one real second = one game minute, frozen in menus.
      clockSeconds += dt;
      actions.setGameMinutes(START_MINUTES + Math.floor(clockSeconds));
    }

    // Fixed-step simulation: commands → controller → Rapier → pickups.
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      drainCommands(handleCommand);
      const riding = bikes.ridden >= 0;
      moveMods.fly = ui.tester.fly && !riding;
      moveMods.noclip = ui.tester.noclip && !riding;
      moveMods.speed = playground?.frozen ? 0 : ui.tester.speed;
      moveMods.bike = riding;
      moveMods.blocked = riding ? insideBuilding : null;
      controller.update(world, FIXED_DT, input.consumePressed(), rig.yaw, groundFilter, moveMods);
      physics.step();
      // Safety net: anything that drops the player out of the world (a missed collider) respawns them.
      if (playing && Transform.y[eid]! < -40) {
        handleCommand({ type: 'respawn' });
        actions.toast('已回到重生點');
      }
      // Walking into the invisible campus boundary: say why, at most every few seconds.
      if (playing && time - lastBoundaryWarning > 4 && env.distanceToBoundary(Transform.x[eid]!, Transform.z[eid]!) < 1.2) {
        lastBoundaryWarning = time;
        actions.toast('🚧 校外區域禁止進入');
      }
      const gained = coins.collect(world, Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!, time);
      if (gained > 0) {
        actions.addCoins(gained);
        audio.play('coin');
      }
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accumulator = 0;

    if (playing && !streamAt && !ui.fading) updateArea(time, Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!);
    if (playing && !streamAt && !ui.fading) updateNav(time, Transform.x[eid]!, Transform.z[eid]!);
    navLine.update(dt, time);
    if (autoDoors.update(dt, Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!) && playing) audio.play('click', 0.4);
    const gateEvent = sensorGates.update(dt, time, Transform.x[eid]!, Transform.z[eid]!, ui.inventory.some((s) => s?.id === 'studentCard'));
    if (playing && gateEvent === 'opened') { actions.toast('嗶！學生證感應成功'); audio.play('click'); }
    else if (playing && gateEvent === 'noCard') actions.toast('🚫 需要學生證感應才能通過');
    if (!playing) lastSave = time;
    else if (time - lastSave > AUTOSAVE_SECONDS) {
      lastSave = time;
      saveNow();
    }

    // Variable-rate presentation.
    renderSyncSystem(world, accumulator / FIXED_DT);
    animationSystem(world, dt, time);
    if (bikes.ridden >= 0 && objects[eid]) {
      const o = objects[eid]!;
      bikes.update(dt, o.position.x, o.position.y, o.position.z, o.rotation.y, Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!));
      // After the animation driver, so the seated pose wins over the locomotion clips.
      if (joints) applyPose(joints, computeRidePose(bikes.pedal, time * CLOCK_RATE, ridePose));
    }
    coins.render(world, time);
    const f = readFocus();
    rig.update(dt, f, colliders[eid], cameraFilter);
    // In a tight spot the camera sits right behind the character: hide it rather than fill the view.
    model.root.visible = rig.distance > CAMERA.hideCharacterBelow;
    if (ui.phase === 'menu') {
      // Title screen: a slow aerial orbit around the dorms behind the menu panel.
      menuOrbit += dt * MENU_ORBIT_RATE;
      camera.position.set(spawn.x + Math.cos(menuOrbit) * MENU_ORBIT_RADIUS, MENU_ORBIT_HEIGHT, spawn.z + Math.sin(menuOrbit) * MENU_ORBIT_RADIUS);
      camera.lookAt(spawn.x, 8, spawn.z);
    }
    env.followShadow(f.x, f.z);
    const near = streamAt ?? f;
    env.update(near.x, near.z);
    library.update(f.x, f.y, f.z);
    for (const b of handBuilt) b.update(f.x, f.y, f.z);
    interiors.update(near.x, near.y, near.z);
    const earned = playing ? (playground?.update(dt, time, f.x, f.z) ?? 0) : 0;
    if (earned > 0) {
      actions.addCoins(earned);
      audio.play('coin');
    }
    actions.setInteractPrompt(
      !playing || playground?.racing ? null
        : bikes.ridden >= 0 ? '按 E 下車'
          : nearestInteractable()?.prompt
            ?? (playground?.canStart(f.x, f.z) ? '按 E 開始跑道計時賽' : bikes.nearest(f.x, f.y, f.z) >= 0 ? '按 E 騎腳踏車' : null),
    );

    telemetry.x = f.x;
    telemetry.z = f.z;
    telemetry.facing = Transform.rotY[eid]!;
    telemetry.cameraYaw = rig.yaw;
    if (CharacterMotor.jumpSeq[eid] !== lastJumpSeq) {
      lastJumpSeq = CharacterMotor.jumpSeq[eid]!;
      audio.play('jump', 0.7);
    }
    if (CharacterMotor.landingSeq[eid] !== lastLandingSeq) {
      lastLandingSeq = CharacterMotor.landingSeq[eid]!;
      const impact = CharacterMotor.landingSpeed[eid]!;
      if (impact > 3) audio.play('land', Math.min(1, impact / 12));
    }
    renderer.render(scene, camera);

    if (ui.settings.showDebug) updateDebug(dt, {
      x: f.x, y: f.y, z: f.z,
      speed: Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!),
      grounded: CharacterMotor.grounded[eid] === 1,
      anim: ANIM_NAMES[AnimState.current[eid]!] ?? '?',
      ...env.stats(),
    });
  });

  // Full teardown path, exercised by Vite HMR so leaks show up during development.
  import.meta.hot?.dispose(() => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', saveIfPlaying);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('click', onCanvasClick);
    unsubscribe();
    removeHotkeys();
    uiRoot.unmount();
    lock.dispose();
    audio.dispose();
    input.dispose();
    coins.dispose(world);
    library.dispose();
    for (const b of handBuilt) b.dispose();
    skyBridge?.dispose();
    autoDoors.dispose();
    mgmtFeatures.dispose();
    mgmtCourtyard?.dispose();
    mbLobby?.dispose();
    interiors.dispose();
    bikes.dispose();
    playground?.dispose();
    mainGate?.dispose();
    navLine.dispose();
    scooterLots.dispose();
    sensorGates.dispose();
    env.dispose();
    player.despawn();
    assets.dispose();
    controller.dispose();
    sceneResources.dispose();
    physics.free();
    renderer.dispose();
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:8px;left:8px;color:#b00">${String(err)}</pre>`);
});
