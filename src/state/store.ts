import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { HOTBAR_SIZE, ITEMS, starterInventory, type ItemId, type ItemStack } from './items';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { CampusData } from '../campus/campusTypes';
import type { BikeStation } from '../bikes/bikeStations';
import { clearProgress, loadProgress, type SaveData } from './saveGame';

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
export type Modal = 'none' | 'inventory' | 'phone' | 'elevator' | 'shop' | 'chat' | 'camera';
export type PhonePage = 'home' | 'settings' | 'album';
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

export interface SpawnPoint {
  x: number;
  z: number;
  facing: number;
}

const SPAWN_KEY = 'yfm.spawn.v1';
const RACE_BEST_KEY = 'yfm.raceBest.v1';

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

/** Track time-trial HUD (null when no run is in progress). */
export interface RaceState {
  phase: 'countdown' | 'running';
  countdown: number;
  time: number;
  /** Gate being run to, 1-based. */
  gate: number;
  gates: number;
  testing: boolean;
}

export interface ShopMenu {
  title: string;
  items: readonly { id: ItemId; price: number }[];
}

/** Navigation in progress: goal, route (flat x, z) and metres left along it. */
export interface NavState {
  name: string;
  x: number;
  z: number;
  path: number[];
  remaining: number;
}

/** Centre-screen area title (entering a building, the sports ground, the gate). */
export interface AreaBanner {
  id: number;
  title: string;
  subtitle: string;
}

export interface Toast {
  id: number;
  text: string;
}

/** One line in the chat box: what the player typed, or the game's reply to a command. */
export interface ChatLine {
  id: number;
  text: string;
  from: 'me' | 'system' | 'error';
  at: number;
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
  areaBanner: AreaBanner | null;
  nav: NavState | null;
  /** Prompt for the nearest interactable (e.g. "按 E 搭乘電梯"), or null. */
  interactPrompt: string | null;
  elevator: ElevatorMenu | null;
  /** Full-screen fade used to hide teleports (elevators). */
  fading: boolean;

  settings: Settings;
  /** Static top-down layout for the minimap; set once after the scene is built. */
  mapData: CampusData | null;

  bikeStations: readonly BikeStation[];
  race: RaceState | null;
  /** Best time-trial time (s), kept per browser. */
  raceBest: number | null;
  shop: ShopMenu | null;
  /** Time-trial start line (map pin and teleport target); null when the field is absent. */
  raceStart: { x: number; z: number } | null;
  /** This browser holds progress that "繼續遊戲" can resume. */
  hasSave: boolean;
  /** Phone camera: front (selfie) lens. */
  cameraSelfie: boolean;
  /** Bumped whenever the album changes (the phone re-reads it). */
  albumVersion: number;
  /** Page the phone opens on. */
  phonePage: PhonePage;
  tester: TesterState;
  /** Chat box history (newest last, capped). */
  chat: ChatLine[];
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
  areaBanner: null,
  nav: null,
  interactPrompt: null,
  elevator: null,
  fading: false,
  settings: loadSettings(),
  mapData: null,
  bikeStations: [],
  race: null,
  raceBest: loadJson<number | null>(RACE_BEST_KEY, null),
  shop: null,
  raceStart: null,
  hasSave: loadProgress() !== null,
  cameraSelfie: false,
  albumVersion: 0,
  phonePage: 'home',
  tester: { enabled: false, fly: false, noclip: false, speed: 1 },
  chat: [],
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
  setRaceStart(raceStart: { x: number; z: number } | null): void {
    set({ raceStart });
  },
  setCameraSelfie(cameraSelfie: boolean): void {
    set({ cameraSelfie });
  },
  bumpAlbum(): void {
    set({ albumVersion: get().albumVersion + 1 });
  },
  setPhonePage(phonePage: PhonePage): void {
    set({ phonePage });
  },
  setHasSave(hasSave: boolean): void {
    if (get().hasSave !== hasSave) set({ hasSave });
  },
  restoreProgress(s: SaveData): void {
    set({ coins: s.coins, gameMinutes: s.gameMinutes, inventory: s.inventory, hotbarIndex: s.hotbarIndex, heldSlot: null });
  },
  /** Wipes all progress (settings stay). */
  resetProgress(): void {
    clearProgress();
    saveJson(RACE_BEST_KEY, null);
    saveJson(SPAWN_KEY, null);
    set({ coins: 0, gameMinutes: START_MINUTES, inventory: starterInventory(), hotbarIndex: 0, heldSlot: null, raceBest: null, customSpawn: null, hasSave: false });
  },
  setRace(race: RaceState | null): void {
    set({ race });
  },
  setRaceBest(raceBest: number): void {
    set({ raceBest });
    saveJson(RACE_BEST_KEY, raceBest);
  },
  setShop(shop: ShopMenu | null): void {
    set({ shop });
  },
  /** Pays `price` and adds the item; returns why it could not, or null on success. */
  buy(id: ItemId, price: number): string | null {
    const { coins, inventory } = get();
    if (coins < price) return `錢不夠，還差 NT$ ${price - coins}`;
    const next = inventory.slice();
    const i = next.findIndex((s) => s?.id === id && s.count < ITEMS[id].maxStack);
    const slot = i >= 0 ? i : next.findIndex((s) => s === null);
    if (slot < 0) return '背包滿了';
    next[slot] = { id, count: (next[slot]?.count ?? 0) + 1 };
    set({ inventory: next, coins: coins - price });
    return null;
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
    actions.moveSlot(heldSlot, i);
  },
  /** Moves the stack in `from` onto `to`: merges equal items up to the stack limit, else swaps. */
  moveSlot(from: number, to: number): void {
    const inventory = get().inventory;
    if (from === to || !inventory[from]) {
      set({ heldSlot: null });
      return;
    }
    const next = inventory.slice();
    const a = next[from] ?? null;
    const b = next[to] ?? null;
    if (a && b && a.id === b.id) {
      const max = ITEMS[a.id].maxStack;
      const moved = Math.min(a.count, max - b.count);
      next[to] = { id: b.id, count: b.count + moved };
      next[from] = a.count - moved > 0 ? { id: a.id, count: a.count - moved } : null;
    } else {
      next[to] = a;
      next[from] = b;
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
  chat(text: string, from: ChatLine['from'] = 'system'): void {
    set({ chat: [...get().chat, { id: ++toastId, text, from, at: Date.now() }].slice(-40) });
  },
  clearChat(): void {
    set({ chat: [] });
  },
  setNav(nav: NavState | null): void {
    set({ nav });
  },
  setNavRemaining(remaining: number): void {
    const nav = get().nav;
    if (nav && Math.abs(nav.remaining - remaining) >= 1) set({ nav: { ...nav, remaining } });
  },
  showArea(title: string, subtitle = ''): void {
    set({ areaBanner: { id: ++toastId, title, subtitle } });
  },
  clearArea(id: number): void {
    if (get().areaBanner?.id === id) set({ areaBanner: null });
  },
  clearToast(id: number): void {
    if (get().toast?.id === id) set({ toast: null });
  },
  setTester(patch: Partial<TesterState>): void {
    const next = { ...get().tester, ...patch };
    if (!next.enabled) Object.assign(next, { fly: false, noclip: false, speed: 1 });
    if (next.noclip) next.fly = true;
    set({ tester: next });
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
