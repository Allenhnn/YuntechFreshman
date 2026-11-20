import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ACHIEVEMENTS, DAYS, SIDE_QUESTS } from '../story/storyData';
import { notifySaveChanged } from './saveGame';

/**
 * Story progress (main line, side quests, achievements) and the story UI state.
 * Progress is saved in this browser and mirrored to the account with the rest of the save
 * (net/cloudSave.ts); the on/off switches are per browser (管理員模式).
 */
export interface SideState {
  state: 'active' | 'done';
  /** Count towards `total`, or a list of what has been done (tour stops, photo spots, stalls). */
  done: string[];
  /** Quest-specific target (bike station name). */
  target?: string;
}

export interface StoryProgress {
  v: 1;
  /** 1-based; DAYS.length + 1 = the week is over (free play). */
  day: number;
  step: number;
  /** Last three digits of the student number (roll call). */
  studentNo: string;
  rollcalls: { ok: number; total: number };
  flags: {
    skipped?: number;
    absent?: number;
    cheated?: boolean;
    caught?: boolean;
    quizScore?: number;
    mixer?: number;
    badRecord?: number;
    runTime?: number;
    /** Bike metres ridden since the last hit. */
    safeMetres?: number;
  };
  side: Record<string, SideState>;
  /** Achievement id → unlock time (ms). */
  achievements: Record<string, number>;
  /** Buildings walked into. */
  visited: string[];
}

export type StoryScene =
  | { kind: 'dialog'; id: string; lines: { who: string; text: string }[] }
  | { kind: 'rollcall'; advanced: boolean; sudden: boolean }
  | { kind: 'quiz' }
  | { kind: 'mixer' }
  | { kind: 'wake' }
  | { kind: 'clubFair' }
  | { kind: 'summary' };

export interface StoryState {
  progress: StoryProgress;
  /** 管理員模式 switches. */
  enabled: boolean;
  achievementsOn: boolean;
  /** Open story scene (dialog / mini-game), shown in the story modal. */
  scene: StoryScene | null;
  /** Live objective details: distance (m) and direction to the target, timers. */
  live: { distance: number | null; bearing: number | null; timer: string | null; stamina: number | null; note: string | null; place: string | null; photoSpot?: string | null };
  /** Achievements waiting for their popup (first = showing). */
  unlockQueue: string[];
  /** Quest targets for the minimap and full map (same as the beacons). */
  pins: { key: string; x: number; z: number; icon: string; color: number; main?: boolean }[];
  /** Big moments (side quest done, day over): confetti and a card. */
  celebration: { title: string; sub: string; at: number } | null;
}

const KEY = 'yfm.story.v1';
const CFG_KEY = 'yfm.storyCfg.v1';

export function freshProgress(): StoryProgress {
  return {
    v: 1, day: 1, step: 0,
    studentNo: String(100 + Math.floor(Math.random() * 900)),
    rollcalls: { ok: 0, total: 0 },
    flags: {}, side: {}, achievements: {}, visited: [],
  };
}

function validProgress(p: unknown): StoryProgress | null {
  const d = p as Partial<StoryProgress> | null;
  if (!d || d.v !== 1 || typeof d.day !== 'number' || typeof d.step !== 'number' || typeof d.studentNo !== 'string') return null;
  return {
    ...freshProgress(), ...d,
    day: Math.max(1, Math.min(DAYS.length + 1, Math.floor(d.day))),
    step: Math.max(0, Math.floor(d.step)),
    rollcalls: d.rollcalls ?? { ok: 0, total: 0 },
    flags: d.flags ?? {}, side: d.side ?? {}, achievements: d.achievements ?? {}, visited: d.visited ?? [],
  } as StoryProgress;
}

function load(): StoryProgress {
  try {
    return validProgress(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? freshProgress();
  } catch {
    return freshProgress();
  }
}
function loadCfg(): { enabled: boolean; achievementsOn: boolean } {
  try {
    return { enabled: true, achievementsOn: true, ...(JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') as object) };
  } catch {
    return { enabled: true, achievementsOn: true };
  }
}

export const storyStore = createStore<StoryState>()(() => ({
  progress: load(),
  ...loadCfg(),
  scene: null,
  live: { distance: null, bearing: null, timer: null, stamina: null, note: null, place: null },
  unlockQueue: [],
  celebration: null,
  pins: [],
}));

export function useStory<T>(selector: (s: StoryState) => T): T {
  return useStore(storyStore, selector);
}

const set = storyStore.setState;
const get = storyStore.getState;

function persist(progress: StoryProgress, notify = true): void {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode */ }
  if (notify) notifySaveChanged();
}

export const storyActions = {
  update(fn: (p: StoryProgress) => StoryProgress): void {
    const progress = fn(get().progress);
    set({ progress });
    persist(progress);
  },
  /** Progress fetched from the account (or reset with a new game). */
  replace(p: unknown, notify = false): void {
    const progress = validProgress(p) ?? freshProgress();
    set({ progress, scene: null });
    persist(progress, notify);
  },
  reset(): void {
    const progress = freshProgress();
    set({ progress, scene: null });
    persist(progress);
  },
  setConfig(patch: Partial<{ enabled: boolean; achievementsOn: boolean }>): void {
    set(patch);
    const { enabled, achievementsOn } = get();
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ enabled, achievementsOn })); } catch { /* private mode */ }
  },
  openScene(scene: StoryScene | null): void {
    set({ scene });
  },
  setLive(live: Partial<StoryState['live']>): void {
    const cur = get().live;
    if (Object.entries(live).every(([k, v]) => cur[k as keyof StoryState['live']] === v)) return;
    set({ live: { ...cur, ...live } });
  },
  unlocked(id: string): void {
    set({ unlockQueue: [...get().unlockQueue, id] });
  },
  setPins(pins: StoryState['pins']): void {
    const cur = get().pins;
    if (cur.length === pins.length && cur.every((p, i) => p.key === pins[i]!.key && Math.abs(p.x - pins[i]!.x) < 0.5 && Math.abs(p.z - pins[i]!.z) < 0.5)) return;
    set({ pins });
  },
  celebrate(title: string, sub: string): void {
    set({ celebration: { title, sub, at: Date.now() } });
  },
  popUnlock(): void {
    set({ unlockQueue: get().unlockQueue.slice(1) });
  },
};

export const achievementById = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const sideById = new Map(SIDE_QUESTS.map((q) => [q.id, q]));
