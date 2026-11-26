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
  onigiri: { name: '鮪魚飯糰', icon: '🍙', maxStack: 5, description: '萊爾富的三角飯糰，使用後消耗一個。' },
  teaEgg: { name: '茶葉蛋', icon: '🥚', maxStack: 10, description: '超商必買，使用後消耗一個。' },
  sportsDrink: { name: '運動飲料', icon: '🥤', maxStack: 5, description: '流汗後補充電解質，使用後消耗一個。' },
  mineralWater: { name: '礦泉水', icon: '💧', maxStack: 5, description: '販賣機的瓶裝水，使用後消耗一個。' },
  greenTea: { name: '綠茶', icon: '🍵', maxStack: 5, description: '販賣機的無糖綠茶，使用後消耗一個。' },
  cannedCoffee: { name: '罐裝咖啡', icon: '☕', maxStack: 5, description: '早八救星，使用後消耗一個。' },
  cupNoodles: { name: '泡麵', icon: '🍜', maxStack: 5, description: '宿舍宵夜首選，使用後消耗一個。' },
  healthForm: { name: '健康資料表', icon: '📋', maxStack: 1, description: '新生健康檢查資料表，要交到健康中心。' },
  raceBib: { name: '號碼布', icon: '🎽', maxStack: 1, description: '雲科路跑的參賽號碼布。' },
  lostCard: { name: '撿到的學生證', icon: '🪪', maxStack: 1, description: '不是你的學生證，送到行政大樓或警衛室吧。' },
  brunchSet: { name: '早午餐套餐', icon: '🥪', maxStack: 5, description: '猩猩複合式餐飲的總匯三明治＋薯餅，使用後消耗一個。' },
  latte: { name: '拿鐵', icon: '☕', maxStack: 5, description: '猩猩複合式餐飲現煮的拿鐵，使用後消耗一個。' },
  waffle: { name: '鬆餅', icon: '🧇', maxStack: 5, description: '猩猩的下午茶點心，淋上蜂蜜。使用後消耗一個。' },
  friedRice: { name: '炒飯', icon: '🍛', maxStack: 5, description: '猴子食堂的招牌蛋炒飯，使用後消耗一個。' },
  friedNoodles: { name: '炒麵', icon: '🍝', maxStack: 5, description: '猴子食堂的什錦炒麵，使用後消耗一個。' },
  dumplings: { name: '水餃', icon: '🥟', maxStack: 5, description: '一盒十顆高麗菜水餃，使用後消耗一個。' },
  wontonSoup: { name: '餛飩湯', icon: '🍲', maxStack: 5, description: '熱騰騰的餛飩湯，使用後消耗一個。' },
  sideDish: { name: '滷味小菜', icon: '🥢', maxStack: 5, description: '豆干、海帶、滷蛋的小菜拼盤，使用後消耗一個。' },
  broom: { name: '掃把', icon: '🧹', maxStack: 1, description: '管理一館工具室拿的掃把。選在快捷欄就拿在手上；使用＝放在地上。' },
  mop: { name: '拖把', icon: '🧽', maxStack: 1, description: '管理一館工具室拿的拖把。選在快捷欄就拿在手上；使用＝放在地上。' },
  usbDrive: { name: '阿凱的隨身碟', icon: '💾', maxStack: 1, description: '阿凱忘在 MB109 的隨身碟，報告檔案都在裡面。拿回宿舍給他。' },
  catFood: { name: '貓飼料', icon: '🐟', maxStack: 5, description: '三位神秘人物給的貓飼料。沒什麼用……但好像可以吃？' },
  keychain: { name: '雲科鑰匙圈', icon: '🔑', maxStack: 3, description: '街宣活動拍照打卡送的小禮物。' },
  // 路跑道具 (the race's ? boxes): select one in the hotbar and left-click (or 使用) to use it.
  energyDrink: { name: '能量飲料', icon: '⚡', maxStack: 3, description: '路跑道具：喝下去衝刺 5 秒（大幅加速）。' },
  energyGel: { name: '能量果膠', icon: '🟢', maxStack: 3, description: '路跑道具：慢慢吸收，9 秒小幅加速。' },
  bananaPeel: { name: '香蕉皮', icon: '🍌', maxStack: 3, description: '路跑道具：丟在路上，附近的跑者踩到會滑倒、慢下來。' },
  mysteryDrink: { name: '神秘飲料', icon: '❓', maxStack: 3, description: '路跑道具：不知道是什麼……可能衝很快，也可能肚子痛跑不動。' },
  heavyShoes: { name: '鐵鞋', icon: '🥾', maxStack: 3, description: '路跑道具：穿上去好重……6 秒減速，但一路穩穩的不會被香蕉皮滑倒（開玩笑的，就是變慢）。' },
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
  /** 員生餐廳 (猩猩複合式餐飲): brunch, coffee, drinks, snacks. */
  gorilla: [{ id: 'brunchSet', price: 75 }, { id: 'latte', price: 55 }, { id: 'bubbleTea', price: 50 }, { id: 'waffle', price: 45 }],
  /** 員生餐廳 (猴子食堂): fried rice / noodles, dumplings, noodle soup, soups, side dishes. */
  monkey: [{ id: 'friedRice', price: 70 }, { id: 'friedNoodles', price: 70 }, { id: 'dumplings', price: 60 }, { id: 'beefNoodles', price: 95 }, { id: 'wontonSoup', price: 40 }, { id: 'sideDish', price: 35 }],
  /** 萊爾富 (學生活動中心 1F). */
  /** Drinks vending machines (dorm lobbies). */
  vending: [{ id: 'mineralWater', price: 20 }, { id: 'greenTea', price: 25 }, { id: 'sportsDrink', price: 25 }, { id: 'cannedCoffee', price: 30 }],
  hilife: [{ id: 'onigiri', price: 35 }, { id: 'teaEgg', price: 13 }, { id: 'sportsDrink', price: 25 }, { id: 'cupNoodles', price: 39 }],
} as const satisfies Record<string, readonly { id: ItemId; price: number }[]>;

export type StallMenuId = keyof typeof STALL_MENUS;
