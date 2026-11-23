import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * The name the player goes by in the story (roll call, student card). Kept only in this browser's
 * localStorage under its own key: it is not part of the story progress, so the cloud save never
 * uploads it.
 */
const KEY = 'yfm.playerName.v1';

/**
 * 台灣最常撞名的三字姓名（內政部姓名統計中重複最多的那一批），骰子從這裡挑。
 */
export const COMMON_NAMES = [
  '陳怡君', '林怡君', '陳怡婷', '張雅婷', '陳雅婷', '林雅婷', '黃怡婷', '王怡婷', '李怡君', '張怡君',
  '陳冠宇', '林冠宇', '黃冠宇', '陳彥廷', '林彥廷', '陳家豪', '林家豪', '張家豪', '陳俊宏', '陳建宏',
  '林志偉', '陳志偉', '陳宗翰', '林宗翰', '陳柏翰', '林柏翰', '陳承恩', '林承恩', '陳宥廷', '陳品妍',
  '林品妍', '陳詩涵', '林詩涵', '陳佳穎', '林佳穎', '陳志明', '林淑芬', '陳淑芬', '陳美玲', '張志豪',
] as const;

export const NAME_MAX = 8;

export function randomName(not?: string): string {
  let n: string;
  do n = COMMON_NAMES[Math.floor(Math.random() * COMMON_NAMES.length)]!;
  while (n === not);
  return n;
}

function load(): string {
  try {
    return (localStorage.getItem(KEY) ?? '').slice(0, NAME_MAX);
  } catch {
    return '';
  }
}

export const nameStore = createStore<{ name: string }>(() => ({ name: load() }));

export function setPlayerName(name: string): void {
  const n = name.trim().slice(0, NAME_MAX);
  nameStore.setState({ name: n });
  try {
    localStorage.setItem(KEY, n);
  } catch {
    // private mode: the name lasts for this session only
  }
}

/** The name, or a stand-in before one is chosen. */
export const playerName = (): string => nameStore.getState().name || '新鮮人';
export const usePlayerName = (): string => useStore(nameStore, (s) => s.name) || '新鮮人';

/** The full student number on the card: 學年 114, 系碼 12, then the three digits from the save. */
export const studentId = (last3: string): string => `B11412${last3.padStart(3, '0')}`;
