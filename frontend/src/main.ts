import { ACESFilmicToneMapping, Euler, Group, PCFShadowMap, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { createToolProps, type ToolSpot } from './items/toolProps';
import { MY_ROOM } from './story/storyData';
import { createWardrobePreview, wardrobeView } from './character/wardrobePreview';
import { playerName, studentId } from './state/playerName';
import { createPhoneCamera } from './game/phoneCamera';
import { addPhoto } from './state/album';
import { createWorld } from 'bitecs';
import { CAMERA, CHARACTER, FIXED_DT, FLOORPLAN_INTERIOR_IDS, FLOORPLAN_INTERIORS, MAX_SUBSTEPS, RENDER } from './config';
import { createAudioBus } from './audio/audio';
import { createPointerLock } from './input/pointerLock';
import { createSession, type GameApi } from './game/session';
import { installHotkeys } from './game/hotkeys';
import { dispatch, drainCommands, type GameCommand } from './state/commands';
import { bindStreetView, updateStreetView } from './tools/streetViewSync';
import { installSurvey } from './tools/svSurvey';
import { START_MINUTES, actions, gameStore, type GameState } from './state/store';
import { ITEMS, STALL_MENUS, type ItemId } from './state/items';
import type { Settings } from './state/settings';
import { telemetry } from './state/telemetry';
import { createCoinSystem } from './ecs/systems/coins';
import { mountUI } from './ui/App';
import { ResourceTracker } from './core/resources';
import { RAPIER, initPhysics } from './physics/physics';
import { Action, createInput } from './input/input';
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
  type Seat,
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
import { SCOOTER_SPEED_FACTOR, createBikeSystem } from './bikes/bikeSystem';
import { createTraffic } from './ambient/traffic';
import { createStoryRuntime, storyEvents, type StoryFrame } from './story/storyRuntime';
import { storyActions, storyStore } from './state/story';
import { createNavPointer } from './game/navPointer';
import { sportFinished } from './minigames/sportsGames';
import { trackFinished } from './playground/playground';
import { createPlayground } from './playground/playground';
import { createCourts } from './minigames/sportsCourts';
import { createSportsGames } from './minigames/sportsGames';
import { addCafeteriaSign } from './buildings/cafeteriaSign';
import { createSkyBridge } from './buildings/skyBridge';
import { createAutoDoors, type DoorSpec } from './buildings/autoDoors';
import { DOOR_HEIGHT, DOOR_WIDTH, buildingEntrance, hasInterior } from './campus/entrances';
import { SHELL_WALL } from './interiors/generateInterior';
import { createMgmtFeatures } from './buildings/mgmtFeatures';
import { addActivityCorner } from './buildings/activityCorner';
import { addActivityAtrium } from './buildings/activityAtrium';
import { addActivityEntrance } from './buildings/activityEntrance';
import { createYuntayExterior, yuntayTreeFree } from './buildings/yuntayExterior';
import { createDormFeatures, dormTreeFree } from './buildings/dormFeatures';
import { createDormCFacade, dormCFacadeTreeFree, dormCLobbyDoor } from './buildings/dormCFacade';
import { DORM_C_LOFT_TOP, DORM_C_ROOMS, DORM_C_ROOMS_FLOOR, DORM_C_UNIT_FLOOR, dormCRoomBeds, dormCUnit } from './buildings/dormCUnit';
import { createDormCUnitDecor } from './buildings/dormCUnitDecor';
import { courtPit, createMgmtCourtyard } from './buildings/mgmtCourtyard';
import { createDormCourtyard, dormCourtPit } from './buildings/dormCourtyard';
import { createDormYard, dormRideables, dormYardClearings } from './campus/dormYard';
import { createHilifeStore } from './buildings/hilifeStore';
import { PONDS, WATER_Y, createPonds, pondAt } from './campus/ponds';
import { createMbLobby } from './buildings/mbLobby';
import { MAIN_GATE_GUARDHOUSE, createMainGate, gateTreeExclusions, inGateZone } from './campus/mainGate';
import { addBoundaryZone } from './campus/boundaryZone';
import { createBlockWallZone, createBlockWalls } from './campus/blockWall';
import { applyBuildingFixes, copyDormCToD, reshapeDormB, divideLongtan, includeLongtanRoad, remapSplitTraced, sealBuildings, splitDormC, streetscapeFixes, widenCampusRoads, widenCentralAxis } from './campus/campusFixes';
import { createLongtanSidewalks } from './campus/longtanRoad';
import { createStreetscape, staffGateZone } from './campus/streetscape';
import { SCOOTER_LOTS, createScooterLots } from './campus/scooterLots';
import { createSensorGates } from './campus/sensorGates';
import { inGateArea } from './campus/mainGate';
import { UNLABELLED_NAMES } from './campus/placeNames';
import { createBuildingTest, placeBikeStations, stationClearings } from './bikes/bikeStations';
import { findMascotJoints } from './character/mascot';
import { createOutfitter } from './character/outfit';
import { createItemModel, type ItemModel } from './items/itemModels';
import { inspectView } from './items/inspectView';
import { RACE_ROUTE } from './story/storyData';
import { BODY_REST_Y, CLOCK_RATE, applyPose, computeCrouchPose, computeFallPose, computeLiePose, computeRidePose, computeSitPose, computeSwimPose, createPose } from './character/pose';
import { safeTeleportTarget } from './game/teleport';
import { buildNavGraph, pathAhead, progressOn } from './game/navGraph';
import { createNavLine } from './game/navLine';
import { INTERIOR_LAYOUT, loadProgress, saveProgress } from './state/saveGame';
import { animationSystem } from './ecs/systems/animation';
import { renderSyncSystem } from './ecs/systems/renderSync';
import { createThirdPersonCamera, type CameraFocus } from './camera/thirdPersonCamera';
import { createDebugHud } from './ui/debugHud';

const AUTOSAVE_SECONDS = 5;
/** How close you must be to a cyclist to take their bike (m). */
const ROB_REACH = 2.2;
/** How long a restored game waits for an upper floor to stream in. */
const FLOOR_WAIT_MS = 10000;
const MENU_ORBIT_RATE = 0.06;
const MENU_ORBIT_RADIUS = 95;
const MENU_ORBIT_HEIGHT = 46;
const PLAYER_MODEL_URL = `${import.meta.env.BASE_URL}models/mascot.glb`;
const CAMPUS_DATA_URL = `${import.meta.env.BASE_URL}data/campus.json`;
const LIBRARY_URL = `${import.meta.env.BASE_URL}data/buildings/library.json`;
/** Other hand-traced buildings (scripts/floorplan/handbuilt/*.py), each replacing its OSM extrusion. */
const HAND_BUILT_URLS = [`${import.meta.env.BASE_URL}data/buildings/activity-centre.json`, `${import.meta.env.BASE_URL}data/buildings/ma.json`, `${import.meta.env.BASE_URL}data/buildings/mb.json`];
const FACADES_URL = `${import.meta.env.BASE_URL}data/facades.json`;
const TRACED_URL = `${import.meta.env.BASE_URL}data/buildings/traced.json`;

/** The traced index cut down to `ids` (and the shell entrances of their OSM buildings). */
function onlyTraced(t: TracedIndex, ids: readonly string[]): TracedIndex {
  const buildings = t.buildings.filter((b) => ids.includes(b.id));
  const osm = new Set(buildings.flatMap((b) => b.osmIds.map(String)));
  return { buildings, entrances: Object.fromEntries(Object.entries(t.entrances).filter(([id]) => osm.has(id))) };
}

/** Day 1 lunch: the roommates' table in 學生餐廳 (dining hall), and the 街宣 stand by 人科一館 / 龍潭路 (world). */
const CAFETERIA_TABLE = { x: 153.97, z: 212.18 };
const PROMO_STAND = { x: -18.5, z: -76 };
/** 聯誼: the covered plaza under the 36 週年校慶 banner between 學生活動中心 and 雲泰表演廳 (activityAtrium.ts). */
const MIXER_PLAZA = { x: 108.9, z: 158.4 };
/** 路跑道具: speed up or slow down (storyRuntime.raceItem). */
const RACE_ITEMS: ReadonlySet<ItemId> = new Set<ItemId>(['energyDrink', 'energyGel', 'bananaPeel', 'mysteryDrink', 'heavyShoes']);
const FOOD: ReadonlySet<ItemId> = new Set<ItemId>(['catFood', 'brunchSet', 'latte', 'waffle', 'friedRice', 'friedNoodles', 'dumplings', 'wontonSoup', 'sideDish', 'bread', 'bento', 'buffet', 'beefNoodles', 'plainNoodles', 'bubbleTea', 'soyMilk', 'onigiri', 'teaEgg', 'sportsDrink', 'cupNoodles', 'mineralWater', 'greenTea', 'cannedCoffee']);

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
  onigiri: '鮪魚飯糰，好吃！',
  teaEgg: '茶葉蛋香噴噴。',
  sportsDrink: '咕嚕咕嚕… 電解質補滿！',
  cupNoodles: '呼～宿舍泡麵的味道。',
  mineralWater: '咕嚕咕嚕… 透心涼！',
  greenTea: '無糖綠茶，清爽解膩。',
  cannedCoffee: '咖啡因上線，精神來了！',
  healthForm: '📋 新生健康資料表：記得交到健康中心',
  raceBib: '🎽 雲科路跑 參賽號碼布',
  lostCard: '🪪 別人的學生證，送到行政大樓或警衛室',
  broom: '',
  mop: '',
  usbDrive: '💾 阿凱的隨身碟：拿回宿舍給他',
  catFood: '嘎吱嘎吱……貓飼料的味道……意外地不差？',
  keychain: '🔑 街宣活動送的雲科鑰匙圈',
  energyDrink: '', energyGel: '', bananaPeel: '', mysteryDrink: '', heavyShoes: '',
  brunchSet: '總匯三明治配薯餅，早午餐吃飽飽！',
  latte: '拿鐵香濃，精神來了！',
  waffle: '鬆餅好香，蜂蜜甜甜的。',
  friedRice: '粒粒分明的蛋炒飯，好吃！',
  friedNoodles: '什錦炒麵，鑊氣十足！',
  dumplings: '十顆水餃一下就吃光了。',
  wontonSoup: '餛飩湯暖暖的。',
  sideDish: '滷味小菜，越吃越涮嘴。',
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
  if (RACE_ITEMS.has(stack.id)) {
    // Speed items work any time (the race is where you find them).
    if (storyEvents.raceItem(stack.id)) actions.consumeItem(slot);
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
  const svDir = new Vector3();
  bindStreetView({ origin: campus.origin, teleport: (x, z, label) => dispatch({ type: 'teleport', x, z, label }) });
  // The main gate's guardhouse is hand-built (campus/mainGate.ts), not extruded.
  const guardhouse = campus.buildings.find((b) => b.id === MAIN_GATE_GUARDHOUSE);
  if (guardhouse) guardhouse.replacedBy = 'mainGate';
  includeLongtanRoad(campus);
  divideLongtan(campus);
  sealBuildings(campus);
  applyBuildingFixes(campus);
  splitDormC(campus); // 學生宿舍C 北棟：4 層中段＋3 層兩翼
  copyDormCToD(campus); // 學生宿舍D：C 區三棟的外環鏡射過去（外觀由 dormCFacade.ts 同一套做）
  reshapeDormB(campus); // 學生宿舍B：照平面圖的外環、封起來（外觀由 dormCFacade.ts site 'B' 做）
  widenCampusRoads(campus);
  widenCentralAxis(campus);
  streetscapeFixes(campus);
  campus.parking = SCOOTER_LOTS.map((l) => ({ name: l.name, ring: l.ring }));
  actions.setMapData(campus);
  const librarySrc = await loadBuildingSource(LIBRARY_URL);
  const handBuiltSrcs = await Promise.all(HAND_BUILT_URLS.map((url) => loadBuildingSource(url)));
  // 管理學院中庭: the sunken garden cuts the ground open; no trees anywhere in the courtyard.
  const mbSrc = handBuiltSrcs.find((s) => s.id === 'mb');
  const court = mbSrc ? courtPit(mbSrc) : null;
  // 學生宿舍 C / D 之間的下沉中庭: also cut into the ground.
  const dormPit = dormCourtPit();
  for (const src of handBuiltSrcs) {
    for (const b of campus.buildings) if (b.name && src.osmReplaces.includes(b.name)) b.replacedBy = src.id;
  }
  // Facade styles / photo atlases are optional: without them every building uses the default style.
  const facades = await fetch(FACADES_URL)
    .then((r) => (r.ok ? (r.json() as Promise<FacadeData>) : undefined))
    .catch(() => undefined);
  // Plan-traced interiors (scripts/floorplan/trace.py) and the shell door gaps they need.
  const traced = FLOORPLAN_INTERIORS || FLOORPLAN_INTERIOR_IDS.length
    ? await fetch(TRACED_URL)
        .then((r) => (r.ok ? (r.json() as Promise<TracedIndex>) : undefined))
        .then((t) => (t && !FLOORPLAN_INTERIORS ? onlyTraced(t, FLOORPLAN_INTERIOR_IDS) : t))
        .catch(() => undefined)
    : undefined;
  remapSplitTraced(traced, campus);
  const bikeStations = placeBikeStations(campus);
  actions.setBikeStations(bikeStations);
  const keepClear = [...buildingFootprintRings(librarySrc), ...handBuiltSrcs.flatMap(buildingFootprintRings), ...stationClearings(bikeStations), ...gateTreeExclusions(), ...SCOOTER_LOTS.map((l) => l.ring), ...(court ? [court.treeFree] : []), ...yuntayTreeFree(), ...dormTreeFree(), ...dormCFacadeTreeFree(campus), dormPit.treeFree, ...dormYardClearings(), ...PONDS.map((p) => p.ring), [157.43, 235.45, 168.81, 233.24, 169.86, 238.64, 158.48, 240.85] /* 學生餐廳 entrance steps */];
  campus.water = PONDS.map((p) => ({ name: p.name, ring: p.ring }));
  const env = createCampusWorld(scene, physics, renderer, campus, sceneResources, {
    treeExclusions: keepClear,
    groundHoles: [...buildingGroundHoles(librarySrc), ...handBuiltSrcs.flatMap(buildingGroundHoles), ...(court?.rings ?? []), dormPit.ring, ...PONDS.map((p) => p.ring)],
    facades,
    entrances: traced?.entrances,
  });
  const library = createHandBuiltBuilding(librarySrc, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, librarySrc.osmReplaces[0] ?? librarySrc.name),
  });
  // Respawn point: one chosen on the map (saved per browser), else the game's start (the dorm room, below).
  const spawnPoint = (): { x: number; y: number; z: number; facing: number } => {
    const custom = gameStore.getState().customSpawn;
    return custom ? { ...custom, y: 0 } : startPoint();
  };
  // Every other campus building: generated interiors streamed in near the player.
  const interiors = createInteriorManager(scene, physics, renderer, env.materials, campus, facades, sceneResources, traced);
  const handBuilt = handBuiltSrcs.map((src) => createHandBuiltBuilding(src, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, src.osmReplaces[0] ?? src.name),
  }));
  // 學生宿舍C 的一戶寢室（buildings/dormCUnit.ts，中段 2 樓 C3 正上方）: entered from the C3 lobby with 「進入宿舍」, left with 「離開宿舍」.
  const unit = dormCUnit(campus);
  const lobbyDoor = dormCLobbyDoor(campus);
  const unitBuilding = unit ? createHandBuiltBuilding(unit.source, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, '學生宿舍C'),
  }) : null;
  if (unitBuilding && unit && lobbyDoor) {
    handBuilt.push(unitBuilding);
    unitBuilding.interactables.push(
      { id: 'dormC-unit:enter', prompt: '按 E 進入宿舍', x: lobbyDoor.x + lobbyDoor.outX * 1.0, y: lobbyDoor.floor, z: lobbyDoor.z + lobbyDoor.outZ * 1.0, radius: 2.4 },
      // Inside the C3 lobby too (使用者：進入門後就無法進入宿舍): the whole 4.2 m deep lobby offers it.
      { id: 'dormC-unit:enter:lobby', prompt: '按 E 進入宿舍', x: lobbyDoor.x - lobbyDoor.outX * 2.4, y: lobbyDoor.floor, z: lobbyDoor.z - lobbyDoor.outZ * 2.4, radius: 3.2 },
      (() => { const [x, z] = unitBuilding.planToWorld(unit.leave[0], unit.leave[1]); return { id: 'dormC-unit:leave', prompt: '按 E 離開宿舍', x, y: DORM_C_UNIT_FLOOR, z, radius: 1.0 }; })(),
      // Bedroom doors don't open: E at one walks you through (使用者：門不要做開關，靠近門按 E 進入房間).
      // The bedrooms are a building of their own (underground): E at a door on the flat's corridor takes you in, E inside by
      // its door takes you back (使用者：寢室挪到 C3 任何一處，靠近房門按 E 直接傳送到寢室內).
      ...unit.roomDoors.flatMap((d, i) => {
        const [ix, iz] = unitBuilding.planToWorld(d.at[0] + d.out[0] * 0.7, d.at[1] + d.out[1] * 0.7);
        const [ox, oz] = unitBuilding.planToWorld(d.inside[0], d.inside[1] - 0.7);
        return [
          { id: `dormC-room:in:${i}`, prompt: d.name === MY_ROOM.label ? `按 E 進入你的寢室 ${MY_ROOM.number}` : `按 E 進入${d.name}`, x: ix, y: DORM_C_UNIT_FLOOR, z: iz, radius: 0.9 },
          { id: `dormC-room:out:${i}`, prompt: `按 E 離開${d.name}`, x: ox, y: DORM_C_ROOMS_FLOOR, z: oz, radius: 0.9 },
        ];
      }),
      // Your room's wardrobe (寢室 4, door-end wardrobes): changing clothes any time from Day 2.
      (() => {
        const q = DORM_C_ROOMS[Number(MY_ROOM.label.replace(/\D/g, '')) - 1] ?? DORM_C_ROOMS[3]!;
        const [x, z] = unitBuilding.planToWorld((q[0] + q[2]) / 2, q[1] + 5.6);
        return { id: 'dormC-wardrobe', prompt: '按 E 打開衣櫃', x, y: DORM_C_ROOMS_FLOOR, z, radius: 1.3 };
      })(),
    );
  }
  const roomsBuilding = unit ? createHandBuiltBuilding(unit.rooms, scene, physics, renderer, env.materials, sceneResources, {
    facadeStyle: facadeStyleOf(facades, campus, '學生宿舍C'),
  }) : null;
  if (roomsBuilding) handBuilt.push(roomsBuilding);
  // The bedrooms' loft beds (modelled in the decor, not generated furniture): seats for lying down and the story's wake-up.
  // Getting on and off one happens at the foot of its ladder (使用者：上床下床改為靠近樓梯): `dormBedLadder`.
  const dormBedLadder = new Map<Seat, { x: number; y: number; z: number }>();
  const dormBeds: Seat[] = unit && unitBuilding ? dormCRoomBeds().map((b) => {
    const [x, z] = unitBuilding.planToWorld(b.at[0], b.at[1]);
    const st: Seat = { kind: 'bed', x, y: DORM_C_ROOMS_FLOOR + DORM_C_LOFT_TOP, z, base: DORM_C_ROOMS_FLOOR, yaw: unitBuilding.planFacing(b.head), building: unit.rooms.name, room: `寢室 ${b.room + 1}` };
    const [lx, lz] = unitBuilding.planToWorld(b.ladder[0], b.ladder[1]);
    dormBedLadder.set(st, { x: lx, y: DORM_C_ROOMS_FLOOR, z: lz });
    return st;
  }) : [];
  const unitDecor = unit && unitBuilding ? createDormCUnitDecor(scene, physics, sceneResources, unit) : null;
  // 2F sky bridge 管理二館 → 管理一館: from the door at the north end of MB's east wing to MA's west corridor end.
  const byId = (id: string): HandBuiltBuilding | undefined => handBuilt.find((b) => b.source.id === id);
  const activity = byId('activity-centre');
  const ma = byId('ma'), mb = byId('mb');
  const skyBridge = ma && mb ? createSkyBridge(scene, physics, sceneResources, { building: mb, at: [50.95, -2.3] }, { building: ma, at: [76.5, 12.75] }, 3.6) : null;
  const mgmtFeatures = createMgmtFeatures(scene, physics, sceneResources, ma);
  // 管理一館 工具室 (every floor): a broom and a mop to pick up, a bucket.
  const toolProps = (() => {
    const spots: ToolSpot[] = [];
    const buckets: { x: number; y: number; z: number }[] = [];
    if (ma) {
      const lean = ma.planFacing([0, -1]);
      for (const [e, x0] of [[0, 63.8], [3.6, 63.8], [7.2, 64.5]] as const) {
        const at = (px: number, py: number): [number, number] => ma.planToWorld(px, py);
        const [bx, bz] = at(x0 + 0.45, 0.35), [mx, mz] = at(x0 + 0.9, 0.35), [kx, kz] = at(x0 + 1.5, 0.45);
        spots.push({ x: bx, y: e + 0.08, z: bz, yaw: lean, tool: 'broom' }, { x: mx, y: e + 0.08, z: mz, yaw: lean, tool: 'mop' });
        buckets.push({ x: kx, y: e + 0.08, z: kz });
      }
    }
    return createToolProps(scene, sceneResources, spots, buckets);
  })();
  addActivityEntrance(scene, sceneResources);
  addActivityAtrium(scene, sceneResources);
  addActivityCorner(scene, sceneResources);
  const yuntayExterior = createYuntayExterior(scene, physics, sceneResources);
  const dormFeatures = createDormFeatures(scene, physics, campus, sceneResources, env.materials);
  const dormCFacade = createDormCFacade(scene, physics, campus, sceneResources);
  const dormDFacade = createDormCFacade(scene, physics, campus, sceneResources, 'D'); // 學生宿舍D：C 區外觀鏡射過去
  const dormBFacade = createDormCFacade(scene, physics, campus, sceneResources, 'B'); // 學生宿舍B：D 區同一套風格
  const dormCourtyard = createDormCourtyard(scene, physics, sceneResources);
  const dormYard = createDormYard(scene, physics, campus, sceneResources);
  const hilife = activity ? createHilifeStore(scene, physics, activity, sceneResources) : null;
  const ponds = createPonds(scene, physics, sceneResources);
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
    // Listed in the traced index (even with no doors): its doors are the plan's, no fallback door.
    const listed = traced?.entrances[String(b.id)];
    const e = listed ? listed[0] : buildingEntrance(b, campus.roads, photoEdges);
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
  // A new game starts in 學生宿舍C 寢室 4 (使用者：最右邊那間寢室設為遊戲出生點), just inside its door facing the window;
  // the dorm C courtyard if the flat isn't there. A custom point only applies to respawning.
  const startPoint = (): { x: number; y: number; z: number; facing: number } => {
    const d = unit && unitBuilding ? unit.roomDoors.find((r) => r.name === '寢室 4') : undefined;
    if (!d || !unitBuilding) return { x: campus.spawn.x, y: 0, z: campus.spawn.z, facing: campus.spawn.facing };
    const [x, z] = unitBuilding.planToWorld(d.inside[0], d.inside[1] - 1.7);
    return { x, y: DORM_C_ROOMS_FLOOR, z, facing: unitBuilding.planFacing([0, -1]) };
  };
  const spawn = startPoint();
  for (const b of handBuilt) b.update(spawn.x, spawn.y, spawn.z); // the room's walls and floor before the player lands
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
  const phoneCam = createPhoneCamera(scene, renderer, camera, sceneResources);
  let inCameraMode = false;
  const feet = new Vector3();
  const playground = createPlayground(scene, physics, campus, sceneResources);
  actions.setRaceStart(playground?.startSpot ?? null);
  const courts = createCourts(scene, physics, campus, sceneResources);
  const sports = createSportsGames(scene, sceneResources, courts, playground?.pitch ?? null);
  addCafeteriaSign(scene, campus, sceneResources);
  const mainGate = createMainGate(scene, physics, campus, sceneResources);
  const onBlockWall = createBlockWallZone(campus);
  const staffGap = staffGateZone(campus);
  addBoundaryZone(scene, campus, sceneResources, (x, z) => inGateZone(x, z) || onBlockWall(x, z) || staffGap(x, z));
  const blockWalls = createBlockWalls(scene, physics, campus, sceneResources);
  const scooterLots = createScooterLots(scene, physics, campus, sceneResources);
  const longtanSidewalks = createLongtanSidewalks(scene, physics, campus, sceneResources);
  const streetscape = createStreetscape(scene, physics, campus, sceneResources, keepClear);
  const sensorGates = createSensorGates(scene, physics, sceneResources);
  // Navigation obstacles: every building (entered through its door) and the ponds.
  const navObstacles = [
    ...campus.buildings.map((b) => {
      const photoEdges = new Set((facades?.photos[String(b.id)]?.edges ?? []).map((e) => e.edge));
      const e = b.sealed ? null : traced?.entrances[String(b.id)]?.[0] ?? (hasInterior(b) ? buildingEntrance(b, campus.roads, photoEdges) : null);
      let door: { x: number; z: number } | null = null;
      if (e) {
        const r = b.outer, n = r.length / 2, j = (e.edge + 1) % n;
        const dx = r[j * 2]! - r[e.edge * 2]!, dz = r[j * 2 + 1]! - r[e.edge * 2 + 1]!, len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len; // rings are CCW: (uz, −ux) points out of the building
        door = { x: r[e.edge * 2]! + ux * e.along + uz * 1.6, z: r[e.edge * 2 + 1]! + uz * e.along - ux * 1.6 };
      }
      return { ring: b.outer, door };
    }),
    ...PONDS.map((p) => ({ ring: p.ring, door: null })),
    ...dormYard.blockers.map((ring) => ({ ring, door: null })), // dorm courtyard walls: through the gates
  ];
  const navGraph = buildNavGraph(campus, navObstacles);
  const navLine = createNavLine(scene, sceneResources);
  const bikes = createBikeSystem(scene, bikeStations, sceneResources, dormRideables());
  const inPit = (x: number, z: number): boolean => dormPit.contains(x, z) || !!court?.contains(x, z) || !!pondAt(x, z);
  const traffic = createTraffic(scene, campus, sceneResources, inPit);
  /** 路跑 day: the campus walkers and every vehicle are taken off (the runners own the course). */
  let raceMode = false;
  const applyAmbient = (a: GameState['ambient']): void => {
    traffic.setEnabled('people', a.people && !raceMode);
    traffic.setEnabled('vehicles', a.vehicles && !raceMode);
  };
  applyAmbient(gameStore.getState().ambient);
  const centreOf = (name: string): { x: number; z: number } | null => {
    const b = campus.buildings.find((q) => q.name === name);
    if (!b) return null;
    let x = 0, z = 0;
    const n = b.outer.length / 2;
    for (let i = 0; i < n; i++) { x += b.outer[i * 2]!; z += b.outer[i * 2 + 1]!; }
    return { x: x / n, z: z / n };
  };
  /** Nearest point on a campus road or walkway (race checkpoints). */
  const snapToRoad = (x: number, z: number): { x: number; z: number } => {
    let best = { x, z }, bestD = Infinity;
    for (const r of campus.roads) {
      for (let i = 2; i < r.points.length; i += 2) {
        const ax = r.points[i - 2]!, az = r.points[i - 1]!, dx = r.points[i]! - ax, dz = r.points[i + 1]! - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const qx = ax + dx * t, qz = az + dz * t, dd = Math.hypot(qx - x, qz - z);
        if (dd < bestD) { bestD = dd; best = { x: qx, z: qz }; }
      }
    }
    return best;
  };
  const story = createStoryRuntime({
    scene, tracker: sceneResources, campus,
    placeOf: (name) => {
      if (name === '籃球場') { const h = courts.hoops[0]; return h ? { x: h.x, z: h.z } : null; }
      if (name === '排球場') { const v = courts.volley[0]; return v ? { x: v.x, z: v.z } : null; }
      if (name === '足球場' && playground) { const [x, z] = playground.pitch.toWorld(playground.pitch.halfLength - 11, 0); return { x, z }; }
      if (name === '路跑起點') return snapToRoad(RACE_ROUTE[0]!.x, RACE_ROUTE[0]!.z);
      if (name === 'MA214' && ma) { const [x, z] = ma.planToWorld(47.75, 19.25); return { x, z }; }
      if (name === 'MB109' && mb) { const [x, z] = mb.planToWorld(26, 49); return { x, z }; }
      if (name === '熱舞社' && mb) { const [x, z] = mb.planToWorld(44.6, 50.15); return { x, z }; }
      if (name === '學餐餐桌') return { ...CAFETERIA_TABLE };
      if (name === '街宣') return { ...PROMO_STAND };
      if (name === '聯誼廣場') return { ...MIXER_PLAZA };
      if (name === '管院貓咪') { const c = centreOf('管理一館'); return c ? snapToRoad(c.x, c.z) : null; }
      if (name === '操場黑狗' && playground) { const [x, z] = playground.pitch.toWorld(-24, 12); return { x, z }; }
      if (name === '宿舍大笨鳥') return { x: -9.5, z: 335 };
      if (name === '操場') return playground ? { ...playground.startSpot } : null;
      if (name === '大門') return centreOf('警衛室');
      // 學生宿舍C is three OSM parts; the story's dorm is the courtyard by the C entrance where you start.
      if (name === '學生宿舍C') return { x: -15, z: 331 };
      return centreOf(name);
    },
    route: (ax, az, bx, bz) => navGraph.route(ax, az, bx, bz),
    setClock: (m) => { clockSeconds = m - START_MINUTES; actions.setGameMinutes(m); },
    fade: (mid) => {
      actions.setFading(true);
      window.setTimeout(() => { mid(); actions.setFading(false); }, 600);
    },
    navigate: (x, z, name, quiet) => dispatch({ type: 'navigate', x, z, name, quiet }),
    openStoryModal: () => api.openModal('story'),
    closeStoryModal: () => api.closeModal(),
    sound: (n) => audio.play(n),
    bikeStations,
    groundAt: (x, z) => groundHeightAt(x, z),
    blocked: inPit,
    hilife: hilife ? { counter: hilife.counter, clerk: hilife.clerk } : null,
    putInBed: (place) => putInBed(place),
    standUp: () => standUp(),
    roomAt: (x, y, z) => {
      for (const b of buildings()) {
        // Plan coordinates by inverting the plan → world transform (two basis points).
        const [ax, az] = b.planToWorld(0, 0), [bx, bz] = b.planToWorld(1, 0), [cx, cz] = b.planToWorld(0, 1);
        const ux = bx - ax, uz = bz - az, vx = cx - ax, vz = cz - az, det = ux * vz - uz * vx;
        if (Math.abs(det) < 1e-9) continue;
        const rx = x - ax, rz = z - az;
        const px = (rx * vz - rz * vx) / det, py = (ux * rz - uz * rx) / det;
        const levels = [...b.source.levels].sort((p, q) => p.elevation - q.elevation);
        const lvl = levels.filter((l) => l.elevation <= y + 0.5).pop();
        const plan = lvl ? b.source.floors[lvl.id] : undefined;
        const sp = plan?.spaces.find((q) => q.rects.some(([x0, y0, x1, y1]) => px >= x0 && px <= x1 && py >= y0 && py <= y1));
        if (sp) return sp.code ?? sp.id;
      }
      return null;
    },
    seatIn: (_building, room) => {
      let best: Seat | null = null, bestD = Infinity;
      for (const b of buildings()) for (const st of b.seats) {
        if (st.kind !== 'chair' || st.room !== room) continue;
        const d = Math.hypot(st.x - Transform.x[eid]!, st.z - Transform.z[eid]!);
        if (d < bestD) { bestD = d; best = st; }
      }
      if (!best) return false;
      sitOn(best);
      return true;
    },
    goOutsideDorm: (after) => {
      // In front of the 學生宿舍C lobby (the dorm courtyard spawn if that door isn't known).
      actions.setFading(true);
      window.setTimeout(() => {
        if (seat) standUp();
        const x = lobbyDoor ? lobbyDoor.x + lobbyDoor.outX * 2.4 : campus.spawn.x;
        const z = lobbyDoor ? lobbyDoor.z + lobbyDoor.outZ * 2.4 : campus.spawn.z;
        const facing = lobbyDoor ? Math.atan2(lobbyDoor.outX, lobbyDoor.outZ) : campus.spawn.facing;
        teleport(x, lobbyDoor ? lobbyDoor.floor : 0, z, facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), facing + Math.PI);
        actions.setFading(false);
        after();
      }, 350);
    },
    shove: (dx, dz) => shiftPlayer(dx, dz),
    teleportTo: (x, z) => { teleport(x, 0.3, z); renderSyncSystem(world, 1); },
    openPhone: (from) => {
      storyActions.focusThread(from);
      actions.setPhonePage('chat');
      if (gameStore.getState().modal === 'none') api.openModal('phone');
    },
    snapToRoad,
    walkSpeed: CHARACTER.walkSpeed,
  });
  const onSport = (kind: 'basketball' | 'volleyball' | 'soccer' | 'tennis', score: number): void => { if (kind !== 'tennis') storyEvents.sport(kind, score); };
  const onTrack = (t: number): void => storyEvents.track(t);
  sportFinished.add(onSport);
  trackFinished.add(onTrack);
  const navPointer = createNavPointer();
  let wasRiding = false;
  let inWater = false;
  let swimStroke = 0;
  let lastWake = 0;
  let lastNight = -1;
  const storyFrame: StoryFrame = { x: 0, y: 0, z: 0, area: null, minutes: 0, riding: false, sprinting: false, playing: false, viewYaw: 0, seatedIn: null, seatedRoom: null, bed: null, lying: false, jumps: 0, modal: 'none' };
  const insideBuilding = createBuildingTest(campus);
  const moveMods: MoveModifiers = { fly: false, noclip: false, speed: 1, bike: false, blocked: null };
  const joints = findMascotJoints(model.root);
  // Inspect view: the item held up in front of the camera (turned with the mouse) and in the hand.
  let held: { id: string; view: ItemModel; hand: ItemModel } | null = null;
  /** 蹲下: held Ctrl (or the story's sneak); the duck-walk phase. */
  let crouching = false;
  let crouchGait = 0;
  /** The broom or mop in the right hand (selected on the hotbar). */
  let handTool: { id: string; g: Group } | null = null;
  const heldTurn = { yaw: 0, pitch: 0, zoom: 1 };
  const heldEuler = new Euler(0, 0, 0, 'YXZ');
  const heldQ = new Quaternion();
  const viewDir = new Vector3();
  const dropHeld = (): void => {
    if (!held) return;
    held.view.dispose();
    held.hand.dispose();
    held = null;
  };
  // Wardrobe clothes follow the saved outfit; opening the wardrobe turns the camera to face you.
  const outfitter = createOutfitter(model.root);
  outfitter.apply(storyStore.getState().progress.outfit ?? {});
  const wardrobePreview = createWardrobePreview(renderer, model.root);
  const unsubOutfit = storyStore.subscribe((st, prev) => {
    if (st.progress.outfit !== prev.progress.outfit) { outfitter.apply(st.progress.outfit ?? {}); wardrobePreview.invalidate(); }
    if (st.scene?.kind === 'wardrobe' && prev.scene?.kind !== 'wardrobe') { wardrobeView.yaw = 0; wardrobePreview.invalidate(); }
  });
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
    for (const b of handBuilt) b.update(x, y, z); // load a hand-built interior at the destination first (e.g. the dorm room)
    bodies[eid]?.setTranslation({ x, y: y + CAPSULE_CENTER_OFFSET, z }, true);
    Transform.x[eid] = Transform.prevX[eid] = x;
    Transform.y[eid] = Transform.prevY[eid] = y;
    Transform.z[eid] = Transform.prevZ[eid] = z;
    if (facing !== undefined) Transform.rotY[eid] = Transform.prevRotY[eid] = facing;
    Velocity.x[eid] = Velocity.y[eid] = Velocity.z[eid] = 0;
  };
  renderSyncSystem(world, 1);
  rig.snap(readFocus(), spawn.facing + Math.PI); // start behind the character

  // --- Sitting on chairs and lying on beds (E, or the story puts you in bed) -------------------
  let seat: { s: Seat; x: number; y: number; z: number; facing: number; standX: number; standY: number; standZ: number } | null = null;
  const MOVE_BITS = Action.Forward | Action.Back | Action.Left | Action.Right | Action.Jump;
  const nearestSeat = (): Seat | null => {
    const px = Transform.x[eid]!, py = Transform.y[eid]!, pz = Transform.z[eid]!;
    let best: Seat | null = null, bestD = Infinity;
    for (const st of [...buildings().flatMap((b) => b.seats), ...dormBeds]) {
      {
        if (Math.abs(st.base - py) > 0.7) continue;
        const at = dormBedLadder.get(st) ?? st; // a loft bed is reached from its ladder
        const d = Math.hypot(at.x - px, at.z - pz);
        if (d < (dormBedLadder.has(st) ? 0.9 : st.kind === 'bed' ? 1.5 : 0.95) && d < bestD) { best = st; bestD = d; }
      }
    }
    return best;
  };
  /** Free floor beside a bed (the room side): the longer clear ray of the two sideways. */
  /** A free standing spot on the floor (nothing overlapping a body-sized probe). */
  const standProbe = new RAPIER.Capsule(0.45, 0.3);
  const freeAt = (x: number, base: number, z: number): boolean =>
    !physics.intersectionWithShape({ x, y: base + 0.82, z }, { x: 0, y: 0, z: 0, w: 1 }, standProbe, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, colliders[eid]);
  /** Where to stand after getting out of bed: the first free spot beside it (room side first), else its foot end. */
  const besideBed = (st: Seat): { x: number; z: number } => {
    const lx = Math.cos(st.yaw), lz = -Math.sin(st.yaw), hx = Math.sin(st.yaw), hz = Math.cos(st.yaw);
    const spots: [number, number][] = [];
    for (const d of [0.95, 1.25, 1.6]) for (const side of [1, -1]) for (const along of [0, -0.6, 0.6]) spots.push([lx * side * d + hx * along, lz * side * d + hz * along]);
    for (const d of [1.4, 1.8]) spots.push([-hx * d, -hz * d], [hx * d, hz * d]);
    const free = spots.find(([dx, dz]) => freeAt(st.x + dx, st.base, st.z + dz));
    const [dx, dz] = free ?? [lx * 0.95, lz * 0.95];
    return { x: st.x + dx, z: st.z + dz };
  };
  const sitOn = (st: Seat, stand?: { x: number; y: number; z: number }): void => {
    const up = stand ?? dormBedLadder.get(st) ?? (st.kind === 'bed' ? { ...besideBed(st), y: st.base } : { x: Transform.x[eid]!, y: Transform.y[eid]!, z: Transform.z[eid]! });
    const hx = Math.sin(st.yaw), hz = Math.cos(st.yaw);
    seat = st.kind === 'bed'
      ? { s: st, x: st.x - hx * 0.25, y: st.y, z: st.z - hz * 0.25, facing: st.yaw + Math.PI, standX: up.x, standY: up.y, standZ: up.z }
      : { s: st, x: st.x, y: st.base, z: st.z, facing: st.yaw, standX: up.x, standY: up.y, standZ: up.z };
    teleport(seat.x, seat.y, seat.z, seat.facing);
    renderSyncSystem(world, 1);
    if (st.kind === 'chair') rig.snap(readFocus(), st.yaw + Math.PI); // look where the seat faces (the board)
    storyEvents.sit(st.kind, st.building);
  };
  const standUp = (): void => {
    if (!seat) return;
    const s0 = seat;
    seat = null;
    teleport(s0.standX, s0.standY, s0.standZ, s0.facing + (s0.s.kind === 'bed' ? 0 : Math.PI));
    renderSyncSystem(world, 1);
    storyEvents.stand(s0.s.kind);
  };
  /** Getting up on purpose (E or a move key): not while the professor is lecturing. */
  let seatNagAt = 0;
  const tryStandUp = (): void => {
    const why = story.seatLock();
    if (why !== null) {
      const now = performance.now();
      if (why && now - seatNagAt > 2500) { seatNagAt = now; actions.toast(why); }
      return;
    }
    standUp();
  };
  // --- Checkpoints: where 「回到上一個紀錄點」 (pause menu) puts you back if you get stuck ---------
  // Taken when a story step begins and after every door / stair / elevator teleport, once you are
  // standing (not seated, riding or knocked down). Kept in this browser.
  const CHECKPOINT_KEY = 'yfm.checkpoint.v1';
  type Checkpoint = { x: number; y: number; z: number; facing: number };
  const loadCheckpoint = (): Checkpoint | null => {
    try {
      const c = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) ?? 'null') as Checkpoint | null;
      return c && [c.x, c.y, c.z, c.facing].every(Number.isFinite) ? c : null;
    } catch { return null; }
  };
  let checkpointTimer = 0;
  const takeCheckpoint = (delay = 1500): void => {
    window.clearTimeout(checkpointTimer);
    checkpointTimer = window.setTimeout(() => {
      if (seat || knock || bikes.ridden >= 0 || CharacterMotor.grounded[eid] !== 1) { takeCheckpoint(2000); return; }
      const c: Checkpoint = { x: Transform.x[eid]!, y: Transform.y[eid]!, z: Transform.z[eid]!, facing: Transform.rotY[eid]! };
      if (![c.x, c.y, c.z].every(Number.isFinite)) return;
      try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(c)); } catch { /* private mode */ }
    }, delay);
  };
  storyStore.subscribe((s, prev) => {
    if (s.progress.day !== prev.progress.day || s.progress.step !== prev.progress.step) takeCheckpoint(2500);
  });
  // --- Bumping into people and vehicles; knocked down by a car --------------------------------
  /** Knocked down: thrown along (dx, dz), sliding until `speed` dies out or a wall stops it. */
  let knock: { t: number; total: number; dx: number; dz: number; speed: number; facing: number } | null = null;
  const KNOCK_TIME = 2.4;
  const shiftPlayer = (dx: number, dz: number): void => {
    const b = bodies[eid];
    if (!b) return;
    const p = b.translation();
    b.setTranslation({ x: p.x + dx, y: p.y, z: p.z + dz }, true);
    Transform.x[eid] = Transform.x[eid]! + dx;
    Transform.z[eid] = Transform.z[eid]! + dz;
  };
  /** Free distance along (dx, dz) at waist height before a wall or object. */
  const clearAhead = (dx: number, dz: number, max: number): number => {
    const ray = new RAPIER.Ray({ x: Transform.x[eid]!, y: Transform.y[eid]! + 0.5, z: Transform.z[eid]! }, { x: dx, y: 0, z: dz });
    const hit = physics.castRay(ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, colliders[eid], undefined, groundFilter);
    return hit ? hit.timeOfImpact : max;
  };
  const knockDown = (k: { dx: number; dz: number; speed: number }): void => {
    if (bikes.ridden >= 0) bikes.dismount();
    if (seat) standUp();
    const facing = Math.atan2(-k.dx, -k.dz); // facing what hit you, falling away from it
    knock = { t: 0, total: KNOCK_TIME, dx: k.dx, dz: k.dz, speed: Math.min(9, 2 + k.speed * 0.8), facing };
    Transform.rotY[eid] = Transform.prevRotY[eid] = facing;
    audio.play('thud');
    audio.play('hit');
    actions.toast(k.speed > 4 ? '💥 被車撞飛了！' : '💥 撞到車，跌倒了！');
  };

  /** Story: wake up in a bed of `place` (a dorm); false until its interior has streamed in. */
  const putInBed = (place: string): boolean => {
    const px = Transform.x[eid]!, pz = Transform.z[eid]!;
    let best: Seat | null = null, bestD = Infinity;
    // A bed right here (the game starts in the dorm room, 使用者：寢室 4 是出生點): wake up in the nearest one.
    for (const st of dormBeds) {
      if (!st.building.startsWith(place)) continue;
      const d = Math.hypot(st.x - px, st.z - pz);
      if (d < 15 && d < bestD) { bestD = d; best = st; }
    }
    if (best) {
      if (seat) standUp();
      bikes.dismount();
      sitOn(best);
      rig.snap(readFocus(), best.yaw + Math.PI);
      return true;
    }
    for (const b of buildings()) {
      if (!b.source.name.startsWith(place)) continue;
      for (const st of b.seats) {
        if (st.kind !== 'bed' || st.y - st.base > 1) continue; // a lower bed, not the top of a loft
        const d = Math.hypot(st.x - px, st.z - pz) + st.base * 4;
        if (d < bestD) { bestD = d; best = st; }
      }
    }
    if (!best) {
      // Lofts only: the top bunk then.
      for (const b of buildings()) {
        if (!b.source.name.startsWith(place)) continue;
        for (const st of b.seats) if (st.kind === 'bed') { const d = Math.hypot(st.x - px, st.z - pz) + st.base * 4; if (d < bestD) { bestD = d; best = st; } }
      }
    }
    if (!best) return false;
    if (seat) standUp();
    bikes.dismount();
    sitOn(best);
    rig.snap(readFocus(), best.yaw + Math.PI); // from the foot end, looking along the bed
    return true;
  };

  /** Standing height at (x, z): the first floor below 2.5 m (library 1F / B1 slab or the ground). */
  const groundHeightAt = (x: number, z: number): number => {
    const ray = new RAPIER.Ray({ x, y: 2.5, z }, { x: 0, y: -1, z: 0 });
    const hit = physics.castRay(ray, 20, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, colliders[eid], undefined,
      (c) => c.handle !== env.groundCollider.handle || !(library.isOverBasement(x, z) || activity?.isOverBasement(x, z) || !!court?.contains(x, z) || dormPit.contains(x, z) || !!pondAt(x, z)));
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
        sports.cancel();
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
        if (!cmd.quiet) actions.toast(`開始導航：${cmd.name}`);
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
        try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* private mode */ }
        introPending = true;
        actions.setNav(null);
        navLine.set(null);
        clockSeconds = 0;
        bikes.dismount();
        playground?.cancel();
        sports.cancel();
        teleport(spawn.x, spawn.y, spawn.z, spawn.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), spawn.facing + Math.PI);
        story.restart();
        return;
      case 'checkpoint': {
        bikes.dismount();
        playground?.cancel();
        sports.cancel();
        if (seat) standUp();
        knock = null;
        const p = loadCheckpoint() ?? spawn;
        teleport(p.x, p.y, p.z, p.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), p.facing + Math.PI);
        actions.toast('↩️ 回到上一個紀錄點');
        return;
      }
      case 'toStart':
      case 'respawn': {
        bikes.dismount();
        playground?.cancel();
        sports.cancel();
        const p = cmd.type === 'toStart' ? spawn : spawnPoint();
        teleport(p.x, p.y, p.z, p.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), p.facing + Math.PI);
        return;
      }
      case 'leaveSport':
        if (sports.active) {
          sports.cancel();
          actions.toast('已結束小遊戲');
        }
        return;
      case 'cameraLook':
        phoneCam.look(cmd.dx, cmd.dy);
        return;
      case 'photo': {
        const obj = objects[eid];
        if (!obj) return;
        const st = gameStore.getState();
        const m = st.gameMinutes;
        const label = `第 ${Math.floor(m / 1440) + 1} 天 ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        audio.play('click');
        void phoneCam.capture(obj.position, model.root, st.cameraSelfie).then(async (blob) => {
          if (!blob) return;
          await addPhoto(blob, label);
          actions.bumpAlbum();
          actions.toast('已存到相簿');
          storyEvents.photo(areaAt(obj.position.x, obj.position.y, obj.position.z)?.title ?? null, st.cameraSelfie);
        });
        return;
      }
      case 'teleport': {
        // Fade out, stream the destination in, land on a safe spot, fade back in.
        // Off-campus targets land just inside the boundary instead.
        const inside = env.clampInsideCampus(cmd.x, cmd.z);
        const target = safeTeleportTarget(campus, inside.x, inside.z);
        bikes.dismount();
        playground?.cancel();
        sports.cancel();
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
      case 'useItem': {
        const item = gameStore.getState().inventory[cmd.slot]?.id;
        if (item === 'broom' || item === 'mop') {
          // Put it down on the floor in front of you.
          const yaw = Transform.rotY[eid]!;
          const fx = Transform.x[eid]! + Math.sin(yaw) * 0.8, fz = Transform.z[eid]! + Math.cos(yaw) * 0.8;
          toolProps.drop(item, fx, Transform.y[eid]!, fz, yaw + Math.PI / 2);
          actions.consumeItem(cmd.slot);
          actions.toast(`放下${ITEMS[item].name}`);
          if (gameStore.getState().modal === 'inspect') api.closeModal();
          return;
        }
        useItem(cmd.slot, api);
        if (item && FOOD.has(item)) storyEvents.eat(item);
        if (item === 'studentCard') actions.toast(`🪪 國立雲林科技大學・${playerName()}　學號 ${studentId(storyStore.getState().progress.studentNo)}`);
        return;
      }
      case 'storyGuide':
        story.guide();
        return;
      case 'setClock': {
        const day = Math.floor(gameStore.getState().gameMinutes / 1440);
        const m = day * 1440 + cmd.minuteOfDay;
        clockSeconds = m - START_MINUTES;
        actions.setGameMinutes(m);
        return;
      }
      case 'storyAdmin':
        if (cmd.op === 'jump') story.jump(cmd.day, cmd.step);
        else if (cmd.op === 'complete') story.completeStep();
        else story.restart();
        return;
      case 'interact': {
        if (bikes.ridden >= 0) {
          bikes.dismount();
          return;
        }
        if (seat) { tryStandUp(); return; }
        if (knock) return;
        const target = nearestInteractable();
        if (target?.id.includes(':stall:')) {
          const [buildingId, , levelId, index] = target.id.split(':');
          const stall = buildingById(buildingId ?? '')?.source.floors[levelId ?? '']?.stalls?.[Number(index)];
          if (stall?.menu) {
            actions.setShop({ title: stall.name, items: STALL_MENUS[stall.menu], menu: stall.menu });
            api.openModal('shop');
          }
          return;
        }
        if (target?.id.includes(':vending:')) {
          actions.setShop({ title: '自動販賣機', items: STALL_MENUS.vending, menu: 'vending' });
          api.openModal('shop');
          return;
        }
        if (target?.id.includes(':door:')) {
          const [buildingId, index] = target.id.split(':door:');
          const refused = buildingById(buildingId ?? '')?.toggleDoor(Number(index), (room) => story.roomGate(buildingId ?? '', room));
          if (refused) {
            actions.toast(refused);
            audio.play('close');
          } else audio.play('click');
          return;
        }
        if (target?.id.startsWith('tool:')) {
          const tool = toolProps.take(target.id);
          if (tool) {
            if (actions.hasItem(tool)) { toolProps.drop(tool, target.x, target.y, target.z, 0); actions.toast(`你已經拿著${ITEMS[tool].name}了`); }
            else if (actions.giveItem(tool)) { actions.toast(`🧹 拿起${ITEMS[tool].name}（快捷欄選它就拿在手上，背包裡使用＝放下）`); audio.play('click'); }
            else { toolProps.drop(tool, target.x, target.y, target.z, 0); actions.toast('背包滿了'); }
          }
          return;
        }
        if (target?.id === 'dormC-wardrobe') {
          story.openWardrobe();
          return;
        }
        if (target?.id.startsWith('dormC-room:') && unit && unitBuilding) {
          // 學生宿舍C bedroom door: fade, then stand inside the bedroom by its door (or back in the corridor), facing on.
          const [, way, index] = target.id.split(':');
          const d = unit.roomDoors[Number(index)];
          if (!d || gameStore.getState().fading) return;
          const entering = way === 'in';
          actions.setFading(true);
          window.setTimeout(() => {
            const [x, z] = entering
              ? unitBuilding.planToWorld(d.inside[0], d.inside[1] - 1.7)
              : unitBuilding.planToWorld(d.at[0] + d.out[0] * 1.7, d.at[1] + d.out[1] * 1.7);
            const facing = unitBuilding.planFacing(entering ? [0, -1] : d.out);
            teleport(x, entering ? DORM_C_ROOMS_FLOOR : DORM_C_UNIT_FLOOR, z, facing);
            renderSyncSystem(world, 1);
            rig.snap(readFocus(), facing + Math.PI);
            actions.setFading(false);
            takeCheckpoint();
            audio.play('click');
          }, 300);
          return;
        }
        if ((target?.id.startsWith('dormC-unit:enter') || target?.id === 'dormC-unit:leave') && unit && unitBuilding && lobbyDoor) {
          // 學生宿舍C: into the flat's living room by its front door, or back out in front of the C3 lobby.
          if (gameStore.getState().fading) return;
          const entering = target.id.startsWith('dormC-unit:enter');
          actions.setFading(true);
          window.setTimeout(() => {
            let x: number, y: number, z: number, facing: number;
            if (entering) {
              [x, z] = unitBuilding.planToWorld(unit.arrive.at[0], unit.arrive.at[1]);
              y = DORM_C_UNIT_FLOOR;
              facing = unitBuilding.planFacing(unit.arrive.facing);
            } else {
              x = lobbyDoor.x + lobbyDoor.outX * 2.2;
              z = lobbyDoor.z + lobbyDoor.outZ * 2.2;
              y = lobbyDoor.floor;
              facing = Math.atan2(lobbyDoor.outX, lobbyDoor.outZ);
            }
            teleport(x, y, z, facing);
            renderSyncSystem(world, 1);
            rig.snap(readFocus(), facing + Math.PI);
            actions.setFading(false);
            takeCheckpoint();
            actions.toast(entering ? '回到宿舍了' : '離開宿舍');
          }, 350);
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
            takeCheckpoint();
            actions.toast(`${portal.level} 到了`);
          }, 350);
          return;
        }
        if (!target && !sports.active && bikes.ridden < 0) {
          const used = story.interact(storyFrame);
          if (used === 'done') return;
          if (used === 'hilife') {
            actions.setShop({ title: '萊爾富 Hi-Life', items: STALL_MENUS.hilife, menu: 'hilife' });
            api.openModal('shop');
            return;
          }
        }
        if (!target && !sports.active && sports.prompt(Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!)) {
          if (gameStore.getState().countdown) return;
          // Big 3-2-1 first; the game (and its clock) starts on 開始！ from where E was pressed.
          const sx = Transform.x[eid]!, sy = Transform.y[eid]!, sz = Transform.z[eid]!;
          actions.startCountdown(() => {
            const p = sports.start(sx, sy, sz);
            if (p) {
              teleport(p.x, 0, p.z, p.facing);
              renderSyncSystem(world, 1);
              rig.snap(readFocus(), p.facing + Math.PI);
            }
          });
          return;
        }
        if (sports.active) return;
        if (!target && playground?.canStart(Transform.x[eid]!, Transform.z[eid]!)) {
          const p = playground.start(gameStore.getState().tester.enabled);
          teleport(p.x, 0, p.z, p.facing);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), p.facing + Math.PI);
          return;
        }
        if (playground?.racing) return;
        if (story.racing && bikes.nearest(Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!) >= 0 && !nearestSeat()) {
          actions.toast('🚫 路跑進行中，禁止騎乘任何車輛！');
          return;
        }
        // Take a cyclist's bike (they end up on foot, shouting).
        if (!target && Transform.y[eid]! < 1.5) {
          const robbed = traffic.robCyclist(Transform.x[eid]!, Transform.z[eid]!, ROB_REACH);
          if (robbed) {
            const i = bikes.spawnAt(robbed.x, robbed.z, robbed.yaw);
            teleport(robbed.x, Transform.y[eid]!, robbed.z, robbed.yaw);
            bikes.mount(i);
            storyEvents.robBike();
            audio.play('robbed');
            return;
          }
        }
        if (!target) {
          const st = nearestSeat();
          if (st && !sports.active) { sitOn(st); return; }
          const bike = bikes.nearest(Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!);
          if (bike >= 0) {
            const b = bikes.pose(bike);
            teleport(b.x, Transform.y[eid]!, b.z, b.yaw);
            bikes.mount(bike);
            if (bikes.riddenKind === 'bike') storyEvents.mount();
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
    c.handle !== groundHandle || !(library.isOverBasement(Transform.x[eid]!, Transform.z[eid]!) || activity?.isOverBasement(Transform.x[eid]!, Transform.z[eid]!) || !!court?.contains(Transform.x[eid]!, Transform.z[eid]!) || dormPit.contains(Transform.x[eid]!, Transform.z[eid]!) || !!pondAt(Transform.x[eid]!, Transform.z[eid]!));

  const cameraFilter = (c: { handle: number }): boolean =>
    groundFilter(c) && !env.isBoundaryCollider(c.handle) && !buildings().some((b) => b.isCameraTransparent(c.handle));

  const nearestInteractable = (): Interactable | null => {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of [...buildings().flatMap((b) => b.interactables), ...toolProps.interactables]) {
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
    if (st.ambient !== prev.ambient) applyAmbient(st.ambient);
    if (st.settings !== prev.settings || st.phase !== prev.phase) applyDebugVisibility(st);
    if (st.phase !== prev.phase || st.modal !== prev.modal || st.lookMode !== prev.lookMode || st.mapMode !== prev.mapMode) applyInputGate(st);
  });
  const onCanvasClick = (): void => api.relock();
  canvas.addEventListener('click', onCanvasClick);
  // Left click (mouse captured): use the item in the selected hotbar slot (使用者：道具欄的道具可以用滑鼠左鍵使用).
  // In drag-to-look mode the mouse is never captured: a quick click (no drag) uses it instead.
  let clickStart: { x: number; y: number; t: number } | null = null;
  const useHeld = (): void => {
    const st = gameStore.getState();
    if (st.phase !== 'playing' || st.modal !== 'none' || st.mapMode !== 'mini' || st.sport || !st.inventory[st.hotbarIndex]) return;
    dispatch({ type: 'useItem', slot: st.hotbarIndex });
  };
  const onCanvasDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (lock.isLocked()) useHeld();
    else if (gameStore.getState().lookMode === 'drag') clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onCanvasUp = (e: MouseEvent): void => {
    if (e.button !== 0 || !clickStart) return;
    const quick = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) < 6 && performance.now() - clickStart.t < 350;
    clickStart = null;
    if (quick) useHeld();
  };
  canvas.addEventListener('mousedown', onCanvasDown);
  canvas.addEventListener('mouseup', onCanvasUp);

  actions.setLoadProgress(1);
  actions.setPhase('menu');

  if (import.meta.env.DEV) {
    installSurvey(campus, { teleport: (x, y, z) => teleport(x, y, z), look: (yaw) => rig.snap(readFocus(), yaw) });
    // Console handle for tuning and automated checks: __game.teleport(20, 0, 10), __game.state()
    Object.assign(window, {
      __game: {
        teleport,
        /** Rapier world and module (dev checks: floor heights by ray, overlaps). */
        physics,
        RAPIER,
        store: gameStore,
        model: model.source,
        world: env,
        scene,
        library,
        interiors,
        playground,
        buildings: () => buildings(),
        courts,
        story,
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
      // …and stopped while a visual-novel scene is on screen.
      if (storyStore.getState().scene?.kind !== 'vn') clockSeconds += dt;
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
      if (seat && (input.held() & MOVE_BITS)) tryStandUp();
      // Not while a story scene (dialogue, mini-game) is on screen: you move again once it is closed.
      // 蹲下 (Ctrl held, or sneaking out of class): slow and low.
      crouching = !seat && !knock && bikes.ridden < 0 && !inWater && !sports.active && ((input.held() & Action.Crouch) !== 0 || story.forceCrouch);
      moveMods.speed = seat || knock || storyStore.getState().scene || playground?.frozen || sports.frozen || (ui.countdown && ui.countdown.text !== '開始！') ? 0 : ui.tester.speed * story.speedFactor * sports.speedFactor * (bikes.riddenKind === 'scooter' ? SCOOTER_SPEED_FACTOR : 1) * (inWater ? 0.55 : 1) * (crouching ? 0.4 : 1);
      moveMods.noJump = sports.active || !!knock || crouching;
      moveMods.bike = riding;
      moveMods.blocked = riding ? insideBuilding : null;
      controller.update(world, FIXED_DT, input.consumePressed(), rig.yaw, groundFilter, moveMods);
      physics.step();
      if (seat) teleport(seat.x, seat.y, seat.z, seat.facing); // held in place while seated
      if (knock) {
        // Thrown: slide along the ground, slowing, stopped by walls; then get up.
        knock.t += FIXED_DT;
        const step = knock.speed * FIXED_DT;
        if (step > 0.001) {
          const free = clearAhead(knock.dx, knock.dz, step + 0.45);
          if (free > step + 0.4) shiftPlayer(knock.dx * step, knock.dz * step);
          else knock.speed = 0;
        }
        knock.speed *= Math.exp(-3.2 * FIXED_DT);
        Transform.rotY[eid] = Transform.prevRotY[eid] = knock.facing;
        if (knock.t >= knock.total) knock = null;
      } else if (playing && !seat && !ui.tester.noclip && !ui.tester.fly && Math.abs(Transform.y[eid]!) < 1.5) {
        // People and vehicles are solid; a moving vehicle (or running into one fast) knocks you down.
        // Only at street level: not from upstairs (or the underground dorm rooms) above / below where they walk.
        const c = traffic.collide(Transform.x[eid]!, Transform.z[eid]!, bikes.ridden >= 0 ? 0.55 : 0.32, Velocity.x[eid]!, Velocity.z[eid]!);
        if (c.push) shiftPlayer(c.push[0], c.push[1]);
        if (c.knock) knockDown(c.knock);
      }
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
    if (dormYard.update(dt, Transform.x[eid]!, Transform.y[eid]!, Transform.z[eid]!) && playing) audio.play('click', 0.4);
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
    if (knock && joints) {
      applyPose(joints, computeFallPose(knock.t, knock.total, ridePose));
    } else if (seat && joints) {
      applyPose(joints, seat.s.kind === 'bed' ? computeLiePose(time, ridePose) : computeSitPose(time, ridePose, storyStore.getState().handUp));
    } else if (crouching && joints) {
      const speed = Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!);
      crouchGait += dt * speed * 4.5;
      applyPose(joints, computeCrouchPose(crouchGait, time * CLOCK_RATE, speed > 0.2, ridePose));
    } else if (bikes.ridden >= 0 && objects[eid]) {
      const o = objects[eid]!;
      bikes.update(dt, o.position.x, o.position.y, o.position.z, o.rotation.y, Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!));
      // After the animation driver, so the seated pose wins over the locomotion clips.
      if (joints) applyPose(joints, computeRidePose(bikes.pedal, time * CLOCK_RATE, ridePose));
    } else if (joints && objects[eid] && inWater) {
      // Deep enough to swim: crawl when moving, tread water when still (hips at the water line).
      const footY = Transform.y[eid]!;
      const depth = WATER_Y - footY;
      if (depth > 0.3) {
        const speed = Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!);
        const moving = speed > 0.4;
        swimStroke += dt * (moving ? 2.2 + speed * 0.6 : 1);
        const float = Math.max(0, depth - BODY_REST_Y - (moving ? 0.12 : 0.42));
        applyPose(joints, computeSwimPose(swimStroke, time * CLOCK_RATE, moving, float, ridePose));
        // A wake: small splash rings every so often while swimming.
        if (moving && time - lastWake > 0.55) {
          lastWake = time;
          ponds.splash(Transform.x[eid]!, Transform.z[eid]!);
        }
      }
    }
    coins.render(world, time);
    if (story.racing !== raceMode) {
      raceMode = story.racing;
      applyAmbient(gameStore.getState().ambient);
      if (raceMode && bikes.ridden >= 0) { bikes.dismount(); actions.toast('🚫 路跑進行中，禁止騎乘任何車輛！'); }
    }
    traffic.update(dt, Transform.x[eid]!, Transform.z[eid]!);
    ponds.update(dt, time);
    {
      // In the water: slow wading; a splash (and the story hears of it) on the way in.
      const px = Transform.x[eid]!, pz = Transform.z[eid]!;
      const pond = pondAt(px, pz);
      const wet = !!pond && Transform.y[eid]! < WATER_Y + 0.15;
      if (wet && !inWater && pond) {
        ponds.splash(px, pz);
        audio.play('close');
        storyEvents.lake(pond.name);
      }
      inWater = wet;
    }
    {
      const night = env.setTimeOfDay(ui.gameMinutes % 1440);
      if (night !== lastNight) {
        lastNight = night;
        streetscape.setNight(night);
        traffic.setNight(night);
      }
    }
    {
      const riding = bikes.ridden >= 0;
      const px = Transform.x[eid]!, pz = Transform.z[eid]!;
      if (riding && playing) {
        const moved = Math.hypot(px - storyFrame.x, pz - storyFrame.z);
        if (moved < 5) storyEvents.bikeMoved(moved);
        if (Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!) > 2.5 && traffic.hit(px, pz, 0.9)) {
          storyEvents.bikeHit();
          audio.play('thud', 0.7);
          audio.play('hit');
        }
      }
      if (wasRiding && !riding) storyEvents.dismount(px, pz);
      wasRiding = riding;
      storyFrame.x = px;
      storyFrame.y = Transform.y[eid]!;
      storyFrame.z = pz;
      storyFrame.y = Transform.y[eid]!;
      storyFrame.area = areaAt(px, Transform.y[eid]!, pz)?.title ?? null;
      storyFrame.minutes = ui.gameMinutes;
      storyFrame.riding = riding;
      storyFrame.sprinting = focus.sprinting;
      storyFrame.playing = playing && ui.modal !== 'story';
      storyFrame.viewYaw = rig.yaw;
      storyFrame.seatedIn = seat && seat.s.kind === 'chair' ? seat.s.building : null;
      storyFrame.seatedRoom = seat && seat.s.kind === 'chair' ? seat.s.room : null;
      storyFrame.bed = seat && seat.s.kind === 'bed' ? { building: seat.s.building, room: seat.s.room ?? '' } : null;
      storyFrame.lying = !!seat && seat.s.kind === 'bed';
      storyFrame.jumps = CharacterMotor.jumpSeq[eid]!;
      storyFrame.modal = ui.modal;
      story.update(dt, storyFrame);
      // On-screen pointer: the navigation goal, else the main objective.
      const sst = storyStore.getState();
      const mainPin = sst.pins.find((p) => p.key === 'main');
      const target = ui.nav ? { x: ui.nav.x, z: ui.nav.z, name: ui.nav.name, color: '#2f6fd0', icon: '🏁' }
        : mainPin && sst.enabled ? { x: mainPin.x, z: mainPin.z, name: sst.live.place ?? '主線目標', color: '#f08a24', icon: mainPin.icon } : null;
      navPointer.update(camera, target, px, pz, playing && ui.modal === 'none' && ui.mapMode === 'mini');
    }
    // A broom / mop selected on the hotbar is carried in the right hand.
    {
      const sel = ui.inventory[ui.hotbarIndex]?.id;
      const want = (sel === 'broom' || sel === 'mop') && ui.modal !== 'inspect' ? sel : null;
      if (handTool && handTool.id !== want) { handTool.g.removeFromParent(); handTool = null; }
      if (want && !handTool) {
        const arm = model.root.getObjectByName('armR');
        if (arm) {
          const g = new Group();
          const m = toolProps.makeModel(want);
          m.position.y = -0.8; // grip it a little above the middle of the stick
          g.add(m);
          g.scale.setScalar(1.6); // the arm joint is scaled down with the mascot
          g.position.set(0, -0.3, 0.06);
          arm.add(g);
          handTool = { id: want, g };
        }
      }
    }
    // Held item (inspect view): in front of the camera, turned by the mouse; a small copy in the hand.
    {
      const insp = playing && ui.modal === 'inspect' ? ui.inspect : null;
      if (!insp || (held && held.id !== insp.id)) dropHeld();
      if (insp && !held) {
        const extra = { name: playerName(), id: studentId(storyStore.getState().progress.studentNo) };
        held = { id: insp.id, view: createItemModel(insp.id, extra), hand: createItemModel(insp.id, extra) };
        held.view.group.renderOrder = 10;
        scene.add(held.view.group);
        const hand = model.root.getObjectByName('armR');
        held.hand.group.scale.setScalar(0.14);
        held.hand.group.position.set(0, -0.34, 0.05);
        hand?.add(held.hand.group);
        heldTurn.yaw = inspectView.yaw; heldTurn.pitch = inspectView.pitch; heldTurn.zoom = inspectView.zoom;
      }
      if (held) {
        const k = Math.min(1, dt * 10);
        heldTurn.yaw += (inspectView.yaw - heldTurn.yaw) * k;
        heldTurn.pitch += (inspectView.pitch - heldTurn.pitch) * k;
        heldTurn.zoom += (inspectView.zoom - heldTurn.zoom) * k;
        camera.getWorldDirection(viewDir);
        const g = held.view.group;
        g.position.copy(camera.position).addScaledVector(viewDir, 0.62 / heldTurn.zoom);
        g.position.y -= 0.03;
        heldEuler.set(heldTurn.pitch, heldTurn.yaw, 0);
        g.quaternion.copy(camera.quaternion).multiply(heldQ.setFromEuler(heldEuler));
        g.scale.setScalar(0.26);
        if (joints) joints.armR.rotation.x = -1.3; // holding it up
      }
    }
    const f = readFocus();
    rig.setFirstPerson(playing && sports.firstPerson);
    rig.update(dt, f, colliders[eid], cameraFilter);
    // In a tight spot the camera sits right behind the character: hide it rather than fill the view.
    model.root.visible = !rig.firstPerson && (rig.distance > CAMERA.hideCharacterBelow || !!seat); // seated in a small room: keep it on screen
    // Phone camera: first person, the character turns with the view; hidden from the main camera.
    if (ui.phase === 'playing' && ui.modal === 'camera' && objects[eid]) {
      if (!inCameraMode) {
        inCameraMode = true;
        phoneCam.enter(Transform.rotY[eid]!);
      }
      Transform.rotY[eid] = Transform.prevRotY[eid] = phoneCam.facing;
      objects[eid]!.rotation.y = phoneCam.facing;
      phoneCam.frame(feet.copy(objects[eid]!.position), model.root, ui.cameraSelfie);
    } else if (inCameraMode) {
      inCameraMode = false;
      phoneCam.exit();
      rig.snap(readFocus(), Transform.rotY[eid]! + Math.PI);
    }
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
    const earned = playing ? (playground?.update(dt, time, f.x, f.z) ?? 0) + sports.update(dt, time, f.x, f.y, f.z, rig.yaw, rig.pitch) : 0;
    if (earned > 0) {
      actions.addCoins(earned);
      audio.play('coin');
    }
    actions.setInteractPrompt(
      !playing || playground?.racing ? null
        : knock ? null
        : bikes.ridden >= 0 ? (bikes.riddenKind === 'scooter' ? '按 E 停車下來' : '按 E 下車')
          : seat ? (seat.s.kind === 'bed' ? '按 E 或移動鍵下床' : '按 E 或移動鍵起身')
          : nearestInteractable()?.prompt
            ?? (sports.active ? null : story.prompt(storyFrame))
            ?? (sports.prompt(f.x, f.y, f.z))
            ?? (sports.active ? null : (() => { const st = nearestSeat(); return st ? (st.kind === 'bed' ? '按 E 躺上床' : '按 E 坐下') : null; })())
            ?? (f.y < 1.5 && traffic.cyclistNear(f.x, f.z, ROB_REACH) ? '按 E 搶走他的腳踏車' : null)
            ?? (playground?.canStart(f.x, f.z) ? '按 E 開始跑道計時賽' : bikes.nearest(f.x, f.y, f.z) >= 0 && !raceMode ? (bikes.kindOf(bikes.nearest(f.x, f.y, f.z)) === 'scooter' ? '按 E 騎機車' : '按 E 騎腳踏車') : null),
    );

    telemetry.x = f.x;
    telemetry.z = f.z;
    telemetry.facing = Transform.rotY[eid]!;
    telemetry.cameraYaw = rig.yaw;
    camera.getWorldDirection(svDir);
    updateStreetView(f.x, f.z, (Math.atan2(svDir.x, -svDir.z) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, svDir.y))) * 180) / Math.PI);
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
    // 衣櫃: the character preview in the box the wardrobe leaves on the left.
    if (storyStore.getState().scene?.kind === 'wardrobe') {
      const box = document.querySelector('.wd-preview')?.getBoundingClientRect();
      if (box) wardrobePreview.render(box);
    }

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
    canvas.removeEventListener('mousedown', onCanvasDown);
    canvas.removeEventListener('mouseup', onCanvasUp);
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
    yuntayExterior.dispose();
    dormFeatures.dispose();
    dormCFacade.dispose();
    dormDFacade.dispose();
    dormBFacade.dispose();
    unitDecor?.dispose();
    dormCourtyard.dispose();
    dormYard.dispose();
    hilife?.dispose();
    ponds.dispose();
    mgmtCourtyard?.dispose();
    mbLobby?.dispose();
    interiors.dispose();
    bikes.dispose();
    traffic.dispose();
    story.dispose();
    unsubOutfit();
    dropHeld();
    outfitter.dispose();
    navPointer.dispose();
    sportFinished.delete(onSport);
    trackFinished.delete(onTrack);
    playground?.dispose();
    sports.dispose();
    courts.dispose();
    mainGate?.dispose();
    navLine.dispose();
    scooterLots.dispose();
    longtanSidewalks.dispose();
    streetscape.dispose();
    blockWalls.dispose();
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
