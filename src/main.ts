import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { createWorld } from 'bitecs';
import { CAMERA, FIXED_DT, MAX_SUBSTEPS, RENDER } from './config';
import { createAudioBus } from './audio/audio';
import { createPointerLock } from './input/pointerLock';
import { createSession, type GameApi } from './game/session';
import { installHotkeys } from './game/hotkeys';
import { drainCommands, type GameCommand } from './state/commands';
import { START_MINUTES, actions, gameStore, type GameState } from './state/store';
import { ITEMS } from './state/items';
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
import { campusCoinSpots } from './campus/coinSpots';
import type { CampusData } from './campus/campusTypes';
import { spawnPlayer } from './ecs/spawn';
import { createAssetLoader } from './assets/loader';
import { buildProceduralCharacter, loadCharacterModel, type CharacterModel } from './character/characterModel';
import { ANIM_NAMES, AnimState, CharacterMotor, Transform, Velocity } from './ecs/components';
import { bodies, colliders, objects } from './ecs/registry';
import { CAPSULE_CENTER_OFFSET, createCharacterControllerSystem } from './ecs/systems/characterController';
import { safeTeleportTarget } from './game/teleport';
import { animationSystem } from './ecs/systems/animation';
import { renderSyncSystem } from './ecs/systems/renderSync';
import { createThirdPersonCamera, type CameraFocus } from './camera/thirdPersonCamera';
import { createDebugHud } from './ui/debugHud';

const PLAYER_MODEL_URL = `${import.meta.env.BASE_URL}models/mascot.glb`;
const CAMPUS_DATA_URL = `${import.meta.env.BASE_URL}data/campus.json`;
const LIBRARY_URL = `${import.meta.env.BASE_URL}data/buildings/library.json`;
const FACADES_URL = `${import.meta.env.BASE_URL}data/facades.json`;

const ITEM_MESSAGES: Readonly<Record<keyof typeof ITEMS, string>> = {
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
  if (stack.id === 'bread') actions.consumeItem(slot);
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
  actions.setMapData(campus);
  const librarySrc = await loadBuildingSource(LIBRARY_URL);
  // Facade styles / photo atlases are optional: without them every building uses the default style.
  const facades = await fetch(FACADES_URL)
    .then((r) => (r.ok ? (r.json() as Promise<FacadeData>) : undefined))
    .catch(() => undefined);
  const env = createCampusWorld(scene, physics, renderer, campus, sceneResources, {
    treeExclusions: buildingFootprintRings(librarySrc),
    groundHoles: buildingGroundHoles(librarySrc),
    facades,
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
  const interiors = createInteriorManager(scene, physics, renderer, env.materials, campus, facades, sceneResources);
  const buildings = (): readonly HandBuiltBuilding[] => [library, ...interiors.active];
  const buildingById = (id: string): HandBuiltBuilding | undefined => buildings().find((b) => b.source.id === id);
  const spawn = spawnPoint();
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
      (c) => c.handle !== env.groundCollider.handle || !library.isOverBasement(x, z));
    return hit ? 2.5 - hit.timeOfImpact : 0;
  };

  const handleCommand = (cmd: GameCommand): void => {
    switch (cmd.type) {
      case 'respawn': {
        const p = spawnPoint();
        teleport(p.x, p.y, p.z, p.facing);
        renderSyncSystem(world, 1);
        rig.snap(readFocus(), p.facing + Math.PI);
        return;
      }
      case 'teleport': {
        // Fade out, stream the destination in, land on a safe spot, fade back in.
        // Off-campus targets (e.g. old waypoints) land just inside the boundary instead.
        const inside = env.clampInsideCampus(cmd.x, cmd.z);
        const target = safeTeleportTarget(campus, inside.x, inside.z);
        actions.setFading(true);
        void Promise.all([env.loadAround(target.x, target.z), new Promise((r) => window.setTimeout(r, 300))]).then(() => {
          physics.step(); // register the destination's colliders before the ground ray
          teleport(target.x, groundHeightAt(target.x, target.z), target.z);
          renderSyncSystem(world, 1);
          rig.snap(readFocus(), rig.yaw);
          actions.setFading(false);
          actions.toast(target.outsideOf ? `已傳送到 ${cmd.label}（${target.outsideOf} 外側）` : `已傳送到 ${cmd.label}`);
        });
        return;
      }
      case 'useItem':
        useItem(cmd.slot, api);
        return;
      case 'interact': {
        const target = nearestInteractable();
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
    c.handle !== groundHandle || !library.isOverBasement(Transform.x[eid]!, Transform.z[eid]!);

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
  const unsubscribe = gameStore.subscribe((st, prev) => {
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
    } else if (ui.phase === 'menu') {
      rig.rotate(dt * 14, 0); // slow attract-mode orbit behind the main menu
    }

    // Fixed-step simulation: commands → controller → Rapier → pickups.
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      drainCommands(handleCommand);
      controller.update(world, FIXED_DT, input.consumePressed(), rig.yaw, groundFilter, ui.tester);
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

    // Variable-rate presentation.
    renderSyncSystem(world, accumulator / FIXED_DT);
    animationSystem(world, dt, time);
    coins.render(world, time);
    const f = readFocus();
    rig.update(dt, f, colliders[eid], cameraFilter);
    env.followShadow(f.x, f.z);
    env.update(f.x, f.z);
    library.update(f.x, f.y, f.z);
    interiors.update(f.x, f.y, f.z);
    actions.setInteractPrompt(playing ? (nearestInteractable()?.prompt ?? null) : null);

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
    canvas.removeEventListener('click', onCanvasClick);
    unsubscribe();
    removeHotkeys();
    uiRoot.unmount();
    lock.dispose();
    audio.dispose();
    input.dispose();
    coins.dispose(world);
    library.dispose();
    interiors.dispose();
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
