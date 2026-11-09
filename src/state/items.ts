export const ITEMS = {
  studentCard: { name: '學生證', icon: '🪪', maxStack: 1, description: '雲科大學生證。進出圖書館與宿舍都需要它。' },
  waterBottle: { name: '水壺', icon: '🧴', maxStack: 1, description: '裝滿水的隨行水壺，跑完操場記得補水。' },
  bread: { name: '菠蘿麵包', icon: '🍞', maxStack: 10, description: '福利社的招牌麵包，使用後消耗一個。' },
  notebook: { name: '筆記本', icon: '📓', maxStack: 1, description: '寫著課表與待辦事項。' },
  campusMap: { name: '校園地圖', icon: '🗺️', maxStack: 1, description: '使用後打開全螢幕地圖（M）。' },
  bento: { name: '排骨便當', icon: '🍱', maxStack: 5, description: '學生餐廳的人氣便當，使用後消耗一個。' },
  buffet: { name: '自助餐', icon: '🍛', maxStack: 5, description: '三菜一肉，夾到飽足。使用後消耗一個。' },
  beefNoodles: { name: '牛肉麵', icon: '🍜', maxStack: 5, description: '湯頭濃郁的牛肉麵，使用後消耗一個。' },
  plainNoodles: { name: '陽春麵', icon: '🍲', maxStack: 5, description: '便宜又暖胃，使用後消耗一個。' },
  bubbleTea: { name: '珍珠奶茶', icon: '🧋', maxStack: 5, description: '下課必備，使用後消耗一個。' },
  soyMilk: { name: '豆漿', icon: '🥛', maxStack: 5, description: '冰的，使用後消耗一個。' },
} as const;

export type ItemId = keyof typeof ITEMS;

export interface ItemStack {
  id: ItemId;
  count: number;
}

export const INVENTORY_SIZE = 20;
export const HOTBAR_SIZE = 5;

export function starterInventory(): (ItemStack | null)[] {
  const slots: (ItemStack | null)[] = new Array<ItemStack | null>(INVENTORY_SIZE).fill(null);
  slots[0] = { id: 'studentCard', count: 1 };
  slots[1] = { id: 'bread', count: 3 };
  slots[2] = { id: 'waterBottle', count: 1 };
  slots[5] = { id: 'notebook', count: 1 };
  slots[6] = { id: 'campusMap', count: 1 };
  return slots;
}

/** What each cafeteria stall sells (NT$), keyed by stall menu id. */
export const STALL_MENUS = {
  buffet: [{ id: 'buffet', price: 70 }, { id: 'soyMilk', price: 20 }],
  noodles: [{ id: 'beefNoodles', price: 80 }, { id: 'plainNoodles', price: 40 }],
  bento: [{ id: 'bento', price: 60 }, { id: 'bread', price: 20 }],
  drinks: [{ id: 'bubbleTea', price: 50 }, { id: 'soyMilk', price: 20 }],
} as const satisfies Record<string, readonly { id: ItemId; price: number }[]>;

export type StallMenuId = keyof typeof STALL_MENUS;
