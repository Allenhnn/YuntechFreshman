import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { HOTBAR_SIZE, ITEMS, starterInventory, type ItemStack } from './items';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { CampusData } from '../campus/campusTypes';
import type { BikeStation } from '../bikes/bikeStations';

/**
 * Single source of truth for everything the DOM UI shows. The game loop writes here only
 * when a value actually changes (coins, game minute), never per frame; per-frame data the
 * minimap needs lives in `telemetry.ts` instead.
 *
 *   phase:  loading → menu → playing ⇄ paused → menu
 *   modal:  none | inventory | phone        (only while playing; releases pointer lock)
 */
export type GamePhase = 'loading' | 'menu' | 'playing' | 'paused';
export type MenuPanel = 'root' | 'controls' | 'settings';
export type Modal = 'none' | 'inventory' | 'phone' | 'elevator';
export type MapMode = 'mini' | 'full';
export type LookMode = 'pointerLock' | 'drag';

export interface ElevatorMenu {
  building: string;
  title: string;
  current: string;
  levels: { id: string; enabled: boolean; note: string }[];
}

/** Dev-build testing aids (fly, noclip, speed). Never persisted; off in production builds. */
export interface TesterState {
  enabled: boolean;
  fly: boolean;
  /** Pass through walls and floors (implies fly). */
  noclip: boolean;
  /** Movement speed multiplier. */
  speed: number;
}
export const TESTER_SPEEDS = [1, 2, 5, 10] as const;
export const TESTER_AVAILABLE = import.meta.env.DEV;

/** A saved map location, x/z in campus metres. */
export interface Waypoint {
  id: number;
  name: string;
  x: number;
  z: number;
}

export interface SpawnPoint {
  x: number;
  z: number;
  facing: number;
}

const WAYPOINTS_KEY = 'yfm.waypoints.v1';
const SPAWN_KEY = 'yfm.spawn.v1';

/** Per-browser storage that may be unavailable (private mode): failures fall back to defaults. */
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export interface Toast {
  id: number;
  text: string;
}

export interface GameState {
  phase: GamePhase;
  loadProgress: number;
  menuPanel: MenuPanel;
  modal: Modal;
  mapMode: MapMode;
  lookMode: LookMode;
  /** Playing, but the pointer is unlocked (e.g. modal closed with Esc): a click resumes mouse look. */
  needsRelock: boolean;
  menuHint: string;

  /** Cash collected, in NT$ (each coin is NT$10). */
  coins: number;
  /** Minutes since day 1 00:00. One real second = one game minute. */
  gameMinutes: number;

  inventory: (ItemStack | null)[];
  hotbarIndex: number;
  /** Inventory slot picked up for moving, or null. */
  heldSlot: number | null;
  toast: Toast | null;
  /** Prompt for the nearest interactable (e.g. "按 E 搭乘電梯"), or null. */
  interactPrompt: string | null;
  elevator: ElevatorMenu | null;
  /** Full-screen fade used to hide teleports (elevators). */
  fading: boolean;

  settings: Settings;
  /** Static top-down layout for the minimap; set once after the scene is built. */
  mapData: CampusData | null;

  bikeStations: readonly BikeStation[];
  tester: TesterState;
  waypoints: Waypoint[];
  /** Respawn point chosen on the map; null = the campus default (dorm C entrance). */
  customSpawn: SpawnPoint | null;
}

export const START_MINUTES = 8 * 60;

export const gameStore = createStore<GameState>()(() => ({
  phase: 'loading',
  loadProgress: 0,
  menuPanel: 'root',
  modal: 'none',
  mapMode: 'mini',
  lookMode: 'pointerLock',
  needsRelock: false,
  menuHint: '',
  coins: 0,
  gameMinutes: START_MINUTES,
  inventory: starterInventory(),
  hotbarIndex: 0,
  heldSlot: null,
  toast: null,
  interactPrompt: null,
  elevator: null,
  fading: false,
  settings: loadSettings(),
  mapData: null,
  bikeStations: [],
  tester: { enabled: false, fly: false, noclip: false, speed: 1 },
  waypoints: loadJson<Waypoint[]>(WAYPOINTS_KEY, []),
  customSpawn: loadJson<SpawnPoint | null>(SPAWN_KEY, null),
}));

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

const set = gameStore.setState;
const get = gameStore.getState;
let toastId = 0;

/** Pure state transitions. Side effects (pointer lock, audio) live in game/session.ts. */
export const actions = {
  setMapData(mapData: CampusData): void {
    set({ mapData });
  },
  setBikeStations(bikeStations: readonly BikeStation[]): void {
    set({ bikeStations });
  },
  setLoadProgress(p: number): void {
    set({ loadProgress: p });
  },
  setPhase(phase: GamePhase): void {
    set(phase === 'playing' ? { phase, menuHint: '' } : { phase, modal: 'none', heldSlot: null, menuPanel: 'root', mapMode: 'mini' });
  },
  setMenuPanel(menuPanel: MenuPanel): void {
    set({ menuPanel });
  },
  setMenuHint(menuHint: string): void {
    set({ menuHint });
  },
  setModal(modal: Modal): void {
    set({ modal, heldSlot: null });
  },
  setLookMode(lookMode: LookMode): void {
    set({ lookMode });
  },
  setNeedsRelock(needsRelock: boolean): void {
    if (get().needsRelock !== needsRelock) set({ needsRelock });
  },
  toggleMap(): void {
    set({ mapMode: get().mapMode === 'mini' ? 'full' : 'mini' });
  },
  addCoins(n: number): void {
    set({ coins: get().coins + n });
  },
  setGameMinutes(gameMinutes: number): void {
    if (get().gameMinutes !== gameMinutes) set({ gameMinutes });
  },
  selectHotbar(i: number): void {
    if (i >= 0 && i < HOTBAR_SIZE) set({ hotbarIndex: i });
  },
  /** Click-to-move: first click picks a stack up, second click drops / merges / swaps it. */
  clickSlot(i: number): void {
    const { heldSlot, inventory } = get();
    if (heldSlot === null) {
      if (inventory[i]) set({ heldSlot: i });
      return;
    }
    if (heldSlot === i) {
      set({ heldSlot: null });
      return;
    }
    const next = inventory.slice();
    const from = next[heldSlot] ?? null;
    const to = next[i] ?? null;
    if (from && to && from.id === to.id) {
      const max = ITEMS[from.id].maxStack;
      const moved = Math.min(from.count, max - to.count);
      next[i] = { id: to.id, count: to.count + moved };
      next[heldSlot] = from.count - moved > 0 ? { id: from.id, count: from.count - moved } : null;
    } else {
      next[i] = from;
      next[heldSlot] = to;
    }
    set({ inventory: next, heldSlot: null });
  },
  consumeItem(slot: number, n = 1): void {
    const next = get().inventory.slice();
    const stack = next[slot];
    if (!stack) return;
    next[slot] = stack.count - n > 0 ? { id: stack.id, count: stack.count - n } : null;
    set({ inventory: next });
  },
  setInteractPrompt(interactPrompt: string | null): void {
    if (get().interactPrompt !== interactPrompt) set({ interactPrompt });
  },
  setElevator(elevator: ElevatorMenu | null): void {
    set({ elevator });
  },
  setFading(fading: boolean): void {
    set({ fading });
  },
  toast(text: string): void {
    set({ toast: { id: ++toastId, text } });
  },
  clearToast(id: number): void {
    if (get().toast?.id === id) set({ toast: null });
  },
  setTester(patch: Partial<TesterState>): void {
    if (!TESTER_AVAILABLE) return;
    const next = { ...get().tester, ...patch };
    if (!next.enabled) Object.assign(next, { fly: false, noclip: false, speed: 1 });
    if (next.noclip) next.fly = true;
    set({ tester: next });
  },
  addWaypoint(name: string, x: number, z: number): void {
    const list = get().waypoints;
    const waypoints = [...list, { id: Math.max(0, ...list.map((w) => w.id)) + 1, name, x, z }];
    set({ waypoints });
    saveJson(WAYPOINTS_KEY, waypoints);
  },
  removeWaypoint(id: number): void {
    const waypoints = get().waypoints.filter((w) => w.id !== id);
    set({ waypoints });
    saveJson(WAYPOINTS_KEY, waypoints);
  },
  setCustomSpawn(customSpawn: SpawnPoint | null): void {
    set({ customSpawn });
    saveJson(SPAWN_KEY, customSpawn);
  },
  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
  },
};
