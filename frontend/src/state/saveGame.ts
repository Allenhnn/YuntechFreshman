import { INVENTORY_SIZE, ITEMS, type ItemId, type ItemStack } from './items';

/**
 * Game progress kept in this browser's localStorage. One slot; the position includes height,
 * so a player saved on an upper floor comes back on that floor.
 */
export interface SaveData {
  coins: number;
  gameMinutes: number;
  inventory: (ItemStack | null)[];
  hotbarIndex: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Interior layout generation the position was saved under (see INTERIOR_LAYOUT). */
  layout?: number;
}

const SAVE_KEY = 'yfm.save.v1';
/** Bumped when generated interiors are re-laid-out: an indoor position from an older layout may now be inside a wall. */
export const INTERIOR_LAYOUT = 2;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readStack(v: unknown): ItemStack | null {
  const s = v as Partial<ItemStack> | null | undefined;
  if (!s || typeof s.id !== 'string' || !(s.id in ITEMS) || !finite(s.count) || s.count < 1) return null;
  return { id: s.id as ItemId, count: Math.min(Math.floor(s.count), ITEMS[s.id as ItemId].maxStack) };
}

/** The stored progress, or null when there is none or it is unusable. */
export function loadProgress(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (!finite(d.coins) || !finite(d.gameMinutes) || !finite(d.x) || !finite(d.y) || !finite(d.z) || !finite(d.facing) || !Array.isArray(d.inventory)) return null;
    const inventory: (ItemStack | null)[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) inventory.push(readStack(d.inventory[i]));
    return {
      coins: d.coins,
      gameMinutes: d.gameMinutes,
      inventory,
      hotbarIndex: finite(d.hotbarIndex) ? d.hotbarIndex : 0,
      x: d.x,
      y: d.y,
      z: d.z,
      facing: d.facing,
      ...(finite(d.layout) ? { layout: d.layout } : {}),
    };
  } catch {
    return null;
  }
}

export function saveProgress(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable or full: the session just isn't saved */
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}
