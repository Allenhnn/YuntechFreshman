import type { ItemId } from '../state/items';

/**
 * The first week (docs/story-design.md): five days of main story, side quests and achievements.
 * Pure data; the runtime (story/storyRuntime.ts) evaluates the conditions.
 *
 * Places are what the area detector reports: a building name from campus.json, or '操場' / '大門'.
 * '籃球場' and '路跑起點' are resolved by the runtime (court and track positions).
 */
export const DORM = '學生宿舍C';
export const HEALTH = '學生活動中心';
export const CAFETERIA = '學生餐廳';
export const CLASS1 = '管理一館';
export const CLASS2 = '管理二館';
export const HALL = '國際會議廳';
export const LIBRARY = '圖書館';
export const ACTIVITY = '學生活動中心';

export type SceneId =
  | 'wakeD1' | 'nurse' | 'roommateD2' | 'mixer' | 'bibD3' | 'assembly' | 'office'
  | 'clubFair' | 'summary' | 'lostFound' | 'rollcall' | 'quiz' | 'sleep' | 'study' | 'hilife'
  | 'stayAwake' | 'wardrobe' | 'rollcallOk'
  /** Day 1 lunch with the roommates (猜拳輸的請客), Day 2 the USB stick handed back, Day 4 熱音社. */
  | 'lunch' | 'returnUsb' | 'drums';

export type SportKind = 'basketball' | 'soccer' | 'volleyball' | 'track';

export type Cond =
  /** Walk into the place. */
  | { t: 'enter' }
  /** Press E in the place to play a scene; done when the scene ends. */
  | { t: 'talk'; prompt: string; scene: SceneId }
  /** A scene that opens by itself once you are there (the class's stay-awake game). */
  | { t: 'scene'; scene: SceneId }
  /** Buy anything at the cafeteria stalls or 萊爾富. */
  | { t: 'buy'; shop: 'cafeteria' | 'hilife' }
  /** Eat any food / a given item. */
  | { t: 'eat'; item?: ItemId }
  /** Finish a ball game / the track time trial. */
  | { t: 'sport'; kind: SportKind }
  /** Roll call: sit down on a free chair in the classroom before the time runs out. */
  | { t: 'class' }
  /** Get out of bed (you wake up lying in it). */
  | { t: 'getUp' }
  /** Ask a friend for the code in the chat app, then sign in with the 點名系統 app. */
  | { t: 'phoneRollcall' }
  /** Press E in the dorm to change clothes at the wardrobe. */
  | { t: 'outfit' }
  /** First-time controls: move, jump, open the phone, open the bag. */
  | { t: 'tutorial' }
  /** Press E in the dorm to sleep until `until` (minutes of the day) or the next morning. */
  | { t: 'sleep'; until: number | 'nextDay' }
  /** The road race (checkpoints). */
  | { t: 'run' }
  /** The exam (in `room`; peeking at the neighbours with Shift while the professor walks the rows). */
  | { t: 'quiz' }
  /** Walk over an item lying in the place (in `room` if set) to pick it up. */
  | { t: 'pickup'; item: ItemId };

export interface Step {
  id: string;
  text: string;
  /** Where the objective is (nav pin, distance); also where `talk` / `class` / `sleep` happen. */
  place: string;
  cond: Cond;
  /** Clock (minutes of the day) when the step begins, if the story moves time on. */
  at?: number;
  /** Clock (minutes of the day) when the step is done (the basketball game runs until dark). */
  doneAt?: number;
  /** Item handed over when the step begins. */
  give?: ItemId;
  /** Toast when the step begins. */
  say?: string;
  /** The exact room (space code) the step happens in, e.g. 管理一館 2F MA214. */
  room?: string;
  /** The step begins with you lying in your dorm bed. */
  wake?: boolean;
  /** A phone message when the step begins, with what you can answer (each gets its own reply). */
  msg?: { from: string; text: string; replies?: { text: string; answer: string }[] };
  /** Show the message as a notification instead of popping the phone open (the tutorial asks for P). */
  quietMsg?: boolean;
}

export interface Day {
  title: string;
  steps: Step[];
}

const hm = (h: number, m = 0): number => h * 60 + m;

/**
 * 2020 路跑 route (the event map): start by the swimming pool, south past the 檢終 arch to the
 * dorms, west along the dorm road, north up the road east of 荷花池 to 龍潭路, west to 管理學院,
 * north to the first 檢查 point, east along the north road to the second, south to 龍潭路, west,
 * south along the courts back past the start to finish at 檢終. World points from the map (fitted
 * to building centres, ±15 m); the runtime snaps each leg to the walkway graph.
 */
export const RACE_ROUTE: readonly { x: number; z: number; name: string }[] = [
  { x: 209.8, z: 101.9, name: '起點' },
  { x: 227.4, z: 208.6, name: '檢終（第一次通過）' },
  { x: 239.4, z: 309.5, name: '宿舍區轉角' },
  { x: 23.3, z: 338.2, name: '宿舍 C 轉角' },
  { x: -49.4, z: -130.2, name: '龍潭路口' },
  { x: -237.8, z: -117.3, name: '管理學院轉角' },
  { x: -246.6, z: -281.7, name: '檢查點（西北）' },
  { x: 297.5, z: -353.8, name: '檢查點（東北）' },
  { x: 345.3, z: -178.5, name: '工程學院轉角' },
  { x: 170.2, z: -151.2, name: '龍潭路轉角' },
  { x: 209.8, z: 101.9, name: '回到起點' },
  { x: 227.4, z: 208.6, name: '檢終・終點' },
];

/** 新手教學 tasks, in order. */
export const TUTORIAL: readonly { key: string[]; text: string }[] = [
  { key: ['W', 'A', 'S', 'D'], text: '用 W A S D 前後左右走動' },
  { key: ['Space'], text: '按空白鍵跳一下' },
  { key: ['P'], text: '按 P 打開手機，看看室友傳了什麼' },
  { key: ['Tab'], text: '按 Tab 打開背包看看帶了什麼' },
];

/** 上課中: what the professor says while you sit in class (one line every few seconds). */
export const LECTURE: readonly { who: string; text: string }[] = [
  { who: '郭教授', text: '好，我們開始上課。今天講物件導向的三大特性。' },
  { who: '郭教授', text: '封裝、繼承、多型——這三個詞期末一定考。' },
  { who: '同學', text: '（小聲）欸，你剛剛是不是差點遲到…' },
  { who: '郭教授', text: '封裝，就是把資料和操作資料的方法包在一起，外面只看得到介面。' },
  { who: '郭教授', text: '就像你的鬧鐘，你只要按按鈕，不用知道裡面怎麼響——結果你還是睡過頭。' },
  { who: '同學', text: '（全班笑）' },
  { who: '郭教授', text: '繼承，是子類別把父類別的屬性和方法拿來用，再加上自己的。' },
  { who: '郭教授', text: '這張 UML 類別圖大家抄一下，下週小考會出。' },
  { who: '同學', text: '（小聲）好想睡…' },
  { who: '郭教授', text: '多型呢，同一個方法呼叫，不同的物件會有不同的行為。' },
];
export const COURSE = '物件導向軟體工程';
/** The professor of the MA214 class. */
export const PROFESSOR = '郭姝妤';

/** A line of a visual-novel scene: a speaker (empty = narration), the text, and how it is shown. */
export interface VnLine {
  who: string;
  text: string;
  /** Shown as a chat bubble on a phone (a message that just came in). */
  phone?: boolean;
  /** The screen shakes (a shock). */
  shake?: boolean;
  /** The phone buzzes as the line appears. */
  buzz?: boolean;
}

export const ROOMMATE = '室友阿凱';
/** The other roommate (Day 1 lunch). */
export const ROOMMATE2 = '室友小胖';
/** What each of the three pays for lunch when one treats (NT$). */
export const LUNCH_EACH = 60;
/** Your room in 學生宿舍C (寢室 4 of the flat, where a new game starts): you sleep in its bed, its wardrobe is yours. */
export const MY_ROOM = { label: '寢室 4', number: 'C214' } as const;
export const FRIEND = '同學小芳';
/** Fine for missing a roll call (NT$). */
export const ABSENT_FINE = 50;

/** Day 1 morning, in bed: the phone, the roommate's message, the panic. */
export const WAKE_VN: VnLine[] = [
  { who: '', text: '嗡——嗡——嗡——', buzz: true },
  { who: '你', text: '（手機怎麼一直震……好吵喔……）', buzz: true },
  { who: '', text: '迷迷糊糊地摸到手機，螢幕上是室友傳來的訊息——' },
  { who: ROOMMATE, text: '老師在點名了！你人咧？？快來管一！', phone: true },
  { who: '你', text: '……點名？現在幾點……七點五十二？！' },
  { who: '你', text: '糟糕！睡過頭了！趕快起床！', shake: true },
];
/** Out of the dorm on Day 1: the bikes outside (the clock stops while it is read). */
export const BIKE_VN: VnLine[] = [
  { who: '', text: '衝出宿舍大門——門口停了一整排腳踏車。' },
  { who: '你', text: '用走的一定來不及……騎腳踏車去！' },
  { who: '教學', text: '走到腳踏車旁邊按 E 就能騎上去，W A S D 控制方向，再按一次 E 下車。' },
  { who: '教學', text: '騎車比走路快很多，但小心別撞到路人！要進建築物前先下車。' },
];
/** After the tutorial: back to the emergency. */
export const TUTORIAL_DONE_VN: VnLine[] = [
  { who: '你', text: '走路、跳、手機、背包……好，都會了。' },
  { who: '你', text: '……等等，不對！現在不是新手教學的時候了！', shake: true },
  { who: '你', text: '趕快去上課！管理一館 2 樓，MA214！' },
];

export const DAYS: Day[] = [
  {
    title: '遲到危機與學餐猜拳',
    steps: [
      { id: '1-1', text: '睡過頭了！快下床', place: DORM, cond: { t: 'getUp' }, at: hm(7, 52), wake: true, quietMsg: true, msg: { from: ROOMMATE, text: '老師正準備點名！你人咧？？快來管一！', replies: [{ text: '馬上到！', answer: '快點啦！老師已經點到一半了 😱' }, { text: '我睡過頭了啦…', answer: '我就知道 😂 我先幫你拖一下，快騎車過來！' }, { text: '幫我喊一下「有」🙏', answer: '老師在看我這邊啦 😰 你自己快來！MA214！' }] } },
      { id: '1-T', text: '新手教學：學會基本操作', place: DORM, cond: { t: 'tutorial' } },
      { id: '1-2', text: '衝去管理一館 2F 的 MA214 教室，找空位坐下，被點到時舉手', place: CLASS1, room: 'MA214', cond: { t: 'class' } },
      { id: '1-3', text: '教授開始上課…撐住別睡著！', place: CLASS1, room: 'MA214', cond: { t: 'scene', scene: 'stayAwake' } },
      { id: '1-4', text: '下課了，到學生餐廳和室友同一桌吃飯：猜拳輸的人請客！', place: CAFETERIA, cond: { t: 'talk', prompt: '按 E 和室友一起吃飯（猜拳）', scene: 'lunch' }, at: hm(12, 0), msg: { from: ROOMMATE, text: '我跟小胖在學餐佔好位子了，快來！今天老規矩，猜拳輸的請客 ✊✌️🖐', replies: [{ text: '馬上到！', answer: '快喔，飯要冷了 🍛' }, { text: '今天換我贏 ✊', answer: '哈哈你上次連輸三把耶，等著請客吧 😏' }, { text: '可以不要猜拳嗎…', answer: '不行！老規矩就是老規矩 🤣 不過輸了可以上訴一次' }] } },
      { id: '1-5', text: '吃飽了，回宿舍 C214 寢室的床上睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '聯誼與跑腿',
    steps: [
      { id: '2-1', text: '起床！今天早上有聯誼', place: DORM, cond: { t: 'getUp' }, at: hm(8, 30), wake: true, msg: { from: ROOMMATE, text: '早上十點活動中心聯誼別忘了！穿帥一點啊 😎', replies: [{ text: '收到，我會穿帥一點', answer: '回寢室打開衣櫃挑一套！別穿拖鞋去 🩴❌' }, { text: '聯誼要幹嘛？', answer: '就聊天玩遊戲啊，記得多找人聊幾句 😉' }, { text: '不太想去…', answer: '去啦！說不定就脫單了 💘' }] } },
      { id: '2-2', text: '回 C214 寢室打開衣櫃，換一套帥氣穿搭', place: DORM, cond: { t: 'outfit' } },
      { id: '2-3', text: '到學生活動中心參加聯誼，把好感度聊滿', place: ACTIVITY, cond: { t: 'talk', prompt: '按 E 加入聯誼', scene: 'mixer' }, at: hm(10, 0) },
      { id: '2-4', text: '阿凱的隨身碟忘在管理二館 MB109，去幫他拿', place: CLASS2, room: 'MB109', cond: { t: 'pickup', item: 'usbDrive' }, msg: { from: ROOMMATE, text: '救命！我的隨身碟忘在管二 MB109 的桌上了，報告檔案全在裡面 😭 可以幫我拿回宿舍嗎？會給你跑腿費！', replies: [{ text: '好，我去拿', answer: '你是我的救命恩人 🙏 拿到直接回宿舍找我' }, { text: '跑腿費多少？', answer: 'NT$100！夠你吃一頓了吧 💰' }, { text: '你自己去啦', answer: '拜託～我在趕報告走不開 😭 跑腿費 NT$100，好不好？' }] } },
      { id: '2-5', text: '把隨身碟拿回宿舍交給阿凱', place: DORM, cond: { t: 'talk', prompt: '按 E 把隨身碟交給阿凱', scene: 'returnUsb' } },
      { id: '2-6', text: '回 C214 寢室的床上睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '校園路跑',
    steps: [
      { id: '3-1', text: '早起！今天是雲科路跑，下床', place: DORM, cond: { t: 'getUp' }, at: hm(7, 0), wake: true, give: 'raceBib', msg: { from: ROOMMATE, text: '號碼布幫你領了，在你桌上！七點半操場集合', replies: [{ text: '謝啦！', answer: '不客氣～號碼布記得別在胸前 🏃' }, { text: '可以不要跑嗎…', answer: '報名了就要跑完啦！跑完請你喝飲料 🧋' }, { text: '要跑多遠？', answer: '繞校園一大圈，有好幾個檢查點，照路線跑就對了。不能騎車喔！' }] } },
      { id: '3-2', text: '到操場集合', place: '操場', cond: { t: 'enter' } },
      { id: '3-3', text: '跑完全程：依路線通過所有檢查點（不能騎車）', place: '路跑起點', cond: { t: 'run' } },
      { id: '3-4', text: '累死了，回 C214 寢室的床上睡一整天', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '社團博覽會：熱音社',
    steps: [
      { id: '4-1', text: '起床，今天活動中心有社團博覽會', place: DORM, cond: { t: 'getUp' }, at: hm(9, 30), wake: true, msg: { from: ROOMMATE, text: '活動中心今天有社團擺攤！聽說熱音社在找鼓手 🥁 去試試看？', replies: [{ text: '好啊，我去看看', answer: '加油！聽說打得好有獎金 🥁' }, { text: '我不會打鼓欸', answer: '照著社長打的節奏敲就好，D F J K 四個鼓，很簡單啦' }, { text: '熱音社在哪？', answer: '學生活動中心裡面，有一套鼓的那一攤' }] } },
      { id: '4-2', text: '到學生活動中心的熱音社攤位，挑戰打鼓', place: ACTIVITY, cond: { t: 'talk', prompt: '按 E 挑戰熱音社打鼓', scene: 'drums' } },
      { id: '4-3', text: '玩夠了，回 C214 寢室的床上睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '期中小考',
    steps: [
      { id: '5-1', text: '起床！今天 MB109 小考', place: DORM, cond: { t: 'getUp' }, at: hm(8, 0), wake: true, msg: { from: ROOMMATE, text: '今天八點四十 MB109 小考！物件導向的筆記借你看 📒', replies: [{ text: '謝啦，救星！', answer: '考好請我吃飯 😎' }, { text: '考什麼範圍？', answer: '類別、繼承、多型、UML 那些。多型一定會考！' }, { text: '我可以偷看你的嗎', answer: '我坐你右邊…但我也在亂猜 😅 而且教授會巡堂喔！' }] } },
      { id: '5-2', text: '到管理二館 MB109 考試（10 題）', place: CLASS2, room: 'MB109', cond: { t: 'quiz' }, at: hm(8, 40) },
      { id: '5-3', text: '回宿舍，和室友聊聊這一週', place: DORM, cond: { t: 'talk', prompt: '按 E 回顧這一週', scene: 'summary' } },
    ],
  },
];

// ---------- Side quests ----------
export interface SideQuest {
  id: string;
  title: string;
  /** Objective shown in the tracker; `{n}` / `{total}` / `{target}` are filled in. */
  text: string;
  total: number;
  reward: { coins?: number; title?: string };
}

export const TOUR_STOPS = ['圖書館', '行政大樓', '雲泰表演廳', '觀雲閣', '設計學院'];
export const PHOTO_SPOTS = ['圖書館', '行政大樓', '雲泰表演廳', '大門', '操場'];
export const STALL_IDS = ['gorilla', 'monkey'];
/** 三位神秘人物 (side quest): who, where (a place the runtime resolves), what they say. */
export const MYSTERY: readonly { id: 'cat' | 'bird' | 'dog'; name: string; place: string; lines: string[] }[] = [
  { id: 'cat', name: '管院貓咪', place: '管院貓咪', lines: ['喵。', '（牠盯著你看了很久，好像知道你翹過課。）', '……喵嗚。（尾巴指向操場的方向）'] },
  { id: 'dog', name: '操場黑狗', place: '操場黑狗', lines: ['汪！', '（黑狗在跑道上跟著你跑了半圈，又跑回來聞了聞你的手。）', '汪汪！（牠朝宿舍的方向叫了兩聲）'] },
  { id: 'bird', name: '宿舍大笨鳥', place: '宿舍大笨鳥', lines: ['嘎——！', '（大笨鳥在宿舍門口原地繞了三圈，差點跌倒。）', '嘎嘎！（牠用嘴叼來一包東西放在你腳邊）'] },
];
/** 街宣活動 at the corner of 人科一館 and 龍潭路. */
export const PROMO_LINES: Line[] = [
  { who: '街宣學長', text: '同學同學！雲科校慶活動宣傳中～' },
  { who: '街宣學長', text: '拿出手機（P → 相機）在我們攤位前拍照打卡，就送你一個小禮物！' },
];

export const SIDE_QUESTS: SideQuest[] = [
  { id: 'lostFound', title: '失物招領', text: '把撿到的學生證送到行政大樓或警衛室', total: 1, reward: { coins: 50 } },
  { id: 'bikeReturn', title: '腳踏車歸還', text: '把腳踏車騎到「{target}」並下車', total: 1, reward: { coins: 30 } },
  { id: 'tour', title: '校園導覽員', text: '走訪導覽景點 {n}/{total}：{target}', total: TOUR_STOPS.length, reward: { title: '導覽達人' } },
  { id: 'photo', title: '拍照打卡', text: '用手機在打卡點拍照 {n}/{total}：{target}', total: PHOTO_SPOTS.length, reward: { coins: 40 } },
  { id: 'athlete', title: '運動健將', text: '墊球 10 下、PK 進 3 球、跑完田徑計時賽（{n}/{total}）', total: 3, reward: { coins: 60 } },
  { id: 'foodie', title: '學餐美食家', text: '在學生餐廳的猩猩複合式餐飲、猴子食堂各買一次（{n}/{total}）', total: STALL_IDS.length, reward: { coins: 30 } },
  { id: 'promo', title: '街宣打卡', text: '在人科一館和龍潭路轉角的街宣攤位前，用手機拍照打卡', total: 1, reward: {} },
  { id: 'mystery', title: '三位神秘人物', text: '找到管院貓咪、操場黑狗、宿舍大笨鳥，和牠們說話（{n}/{total}）', total: 3, reward: {} },
  { id: 'dance', title: '熱舞社', text: '在管理二館的鏡子前跟熱舞社跳一首，拿到 2000 分', total: 1, reward: { coins: 50 } },
];

// ---------- Achievements ----------
export interface Achievement {
  id: string;
  title: string;
  icon: string;
  /** Shown when unlocked; also the hint while locked unless `secret`. */
  desc: string;
  secret?: boolean;
  /** Not reachable yet (e.g. a place the map does not have). */
  unavailable?: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'lake', title: '跳雲夢湖', icon: '🌊', desc: '跳進學生活動中心前的雲夢湖' },
  { id: 'run2020', title: '2020跑完', icon: '🏃', desc: '跑完雲科路跑全程' },
  { id: 'skip', title: '翹課', icon: '🚪', desc: '上課途中溜出教室', secret: true },
  { id: 'cheat', title: '作弊', icon: '👀', desc: '小考時偷看隔壁', secret: true },
  { id: 'bikeHit', title: '騎腳踏車撞別人', icon: '🚲', desc: '騎腳踏車撞到路人', secret: true },
  { id: 'robBike', title: '搶腳踏車', icon: '🦹', desc: '把路人騎的腳踏車搶來騎', secret: true },
  { id: 'steal', title: '偷竊', icon: '🫣', desc: '在萊爾富沒付錢就拿走商品', secret: true },
  { id: 'perfectAttendance', title: '全勤寶寶', icon: '📅', desc: '一週所有點名都成功' },
  { id: 'earlyBird', title: '早起的鳥兒', icon: '🐦', desc: '08:30 前完成當天第二個目標' },
  { id: 'runGod', title: '路跑之神', icon: '⚡', desc: '路跑在目標時間內完賽' },
  { id: 'sharpShooter', title: '三分神射', icon: '🏀', desc: '一次投籃挑戰拿到 15 分以上' },
  { id: 'safeRider', title: '交通安全模範生', icon: '🦺', desc: '騎腳踏車累計 1 公里都沒撞到人' },
  { id: 'explorer', title: '校園探險家', icon: '🧭', desc: '走進 15 棟不同的建築' },
  { id: 'mixerStar', title: '聯誼之星', icon: '💫', desc: '聯誼時三個話題都選到最佳回答' },
  { id: 'selfie', title: '自拍一張', icon: '🤳', desc: '用手機相機的自拍模式拍一張照' },
  { id: 'graduateWeek', title: '第一週畢業', icon: '🎓', desc: '完成第一週的主線' },
  { id: 'treated', title: '被請客', icon: '🍱', desc: '午餐猜拳贏了，室友請客' },
  { id: 'appeal', title: '上訴成功', icon: '⚖️', desc: '猜拳輸了上訴，結果翻盤' },
  { id: 'drummer', title: '鼓手', icon: '🥁', desc: '熱音社打鼓挑戰過 5 關' },
  { id: 'dancer', title: '舞王', icon: '🕺', desc: '熱舞社的方向鍵舞拿到全部 Perfect 的一輪 ×5' },
  { id: 'catFood', title: '吃貓飼料', icon: '🐟', desc: '把神秘人物給的貓飼料吃掉', secret: true },
];

// ---------- Scene content ----------
export interface Line {
  who: string;
  text: string;
}

export const DIALOGS: Partial<Record<SceneId, Line[]>> = {
  wakeD1: [
    { who: '你', text: '（鬧鐘響了…今天是大學第一天！）' },
    { who: '你', text: '書桌上放著「新生健康資料表」，要先交到健康中心。' },
  ],
  nurse: [
    { who: '護理師', text: '新生嗎？資料表給我就好。' },
    { who: '護理師', text: '這是你的學生證，進圖書館和宿舍都要用，別弄丟囉。' },
    { who: '護理師', text: '還沒吃早餐吧？學生餐廳就在附近。' },
  ],
  roommateD2: [
    { who: '室友', text: '欸，起床啦！今天天氣好，去籃球場鬥牛？' },
    { who: '你', text: '好啊，打完再去萊爾富買吃的。' },
  ],
  bibD3: [
    { who: '室友', text: '今天雲科路跑！號碼布我幫你領了。' },
    { who: '室友', text: '起跑點在操場，記得不能騎腳踏車喔，會被抓。' },
  ],
  study: [
    { who: '你', text: '（找了個靠窗的位子，翻開筆記本…）' },
    { who: '你', text: '（三十分鐘後）好，應該準備好了！' },
  ],
  office: [
    { who: '老師', text: '同學，考試的時候眼睛要看自己的考卷。' },
    { who: '老師', text: '這次就算了，下次再被我看到就直接零分。' },
  ],
  returnUsb: [
    { who: '室友阿凱', text: '我的隨身碟！！你是我的救命恩人 😭' },
    { who: '室友阿凱', text: '報告明天就要交，沒有它我就完了。' },
    { who: '室友阿凱', text: '這是跑腿費，拿去買飲料！' },
  ],
  lostFound: [
    { who: '服務人員', text: '撿到學生證？謝謝你！我們會通知失主。' },
    { who: '服務人員', text: '這是一點謝禮，請收下。' },
  ],
};

/**
 * 聯誼: three people, two rounds each. Every answer moves that person's 好感度 (affinity, 0–100,
 * starting at 40); the night goes well when everyone ends at 60 or more. Wrong answers hurt more
 * than right ones help, and the second round of each person is pickier.
 */
export interface MixerQ { ask: string; options: { text: string; delta: number; reply: string }[] }
export const MIXER: { who: string; look: string; qs: MixerQ[] }[] = [
  {
    who: '小美（設計系）', look: '🎨',
    qs: [
      { ask: '你平常假日都在做什麼？', options: [
        { text: '去古坑爬山、騎腳踏車', delta: 18, reply: '哇！我也超愛戶外，下次一起去！' },
        { text: '睡覺打電動', delta: -12, reply: '喔…這樣啊。' },
        { text: '在宿舍追劇', delta: 4, reply: '追劇也不錯啦，最近在看什麼？' },
        { text: '研究怎麼省錢吃學餐', delta: -6, reply: '…好務實喔。' },
      ] },
      { ask: '你覺得我這件外套好看嗎？', options: [
        { text: '顏色很襯你，有設計感', delta: 16, reply: '你眼光不錯嘛 😊' },
        { text: '還好吧', delta: -18, reply: '……（表情僵住）' },
        { text: '多少錢買的？', delta: -10, reply: '問這個幹嘛啦。' },
        { text: '跟你很搭，是自己改的嗎？', delta: 22, reply: '對！你居然看得出來！' },
      ] },
    ],
  },
  {
    who: '阿哲（資工系）', look: '💻',
    qs: [
      { ask: '學校哪裡最好吃？', options: [
        { text: '學餐自助餐，便宜大碗', delta: 16, reply: '懂吃！CP 值之王。' },
        { text: '不知道，我都吃泡麵', delta: -8, reply: '兄弟你要吃好一點…' },
        { text: '萊爾富的茶葉蛋', delta: 6, reply: '哈哈，宵夜首選。' },
        { text: '我只吃外送', delta: -12, reply: '有錢人喔。' },
      ] },
      { ask: '期末專題要不要跟我同組？', options: [
        { text: '好啊！我負責簡報和美術', delta: 20, reply: '太好了，我正缺會做簡報的！' },
        { text: '你寫程式我掛名就好', delta: -22, reply: '……我考慮一下。' },
        { text: '看狀況吧', delta: -5, reply: '嗯，好喔。' },
        { text: '可以，但我只想做輕鬆的部分', delta: -10, reply: '大家都想啊…' },
      ] },
    ],
  },
  {
    who: '小安（企管系）', look: '📊',
    qs: [
      { ask: '要不要一起參加社團？', options: [
        { text: '好啊！哪個社團？', delta: 15, reply: '熱舞社！一起來！' },
        { text: '再說吧', delta: -6, reply: '喔…好吧。' },
        { text: '社團好麻煩', delta: -16, reply: '…………' },
        { text: '你參加的我都參加', delta: 8, reply: '哈哈，好會講話。' },
      ] },
      { ask: '你覺得大學最重要的是什麼？', options: [
        { text: '認識很多朋友、多嘗試', delta: 20, reply: '我也這麼覺得！' },
        { text: '成績', delta: 2, reply: '嗯，也是很重要啦。' },
        { text: '睡飽', delta: -10, reply: '…你是認真的嗎？' },
        { text: '翹課不被抓', delta: -20, reply: '欸你這樣不行啦。' },
      ] },
    ],
  },
];
export const MIXER_START = 40;
export const MIXER_GOAL = 60;

/** Day 5 MB109 小考 (物件導向軟體工程): 5 easy, 3 medium, 2 hard; points by difficulty (total 100). */
export interface ExamQ { q: string; options: string[]; answer: number; level: 'easy' | 'mid' | 'hard' }
export const EXAM_POINTS = { easy: 8, mid: 10, hard: 15 } as const;
export const EXAM: ExamQ[] = [
  { level: 'easy', q: '物件導向的三大特性「不包含」哪一個？', options: ['封裝', '繼承', '多型', '編譯'], answer: 3 },
  { level: 'easy', q: '「物件」和「類別」的關係是？', options: ['物件是類別的實例', '類別是物件的實例', '兩者完全無關', '物件是類別的註解'], answer: 0 },
  { level: 'easy', q: 'UML 的全名是？', options: ['Universal Machine Language', 'Unified Modeling Language', 'User Menu Layout', 'Unique Method List'], answer: 1 },
  { level: 'easy', q: '把資料和操作資料的方法包在一起、外面只看得到介面，叫做？', options: ['多型', '繼承', '封裝', '遞迴'], answer: 2 },
  { level: 'easy', q: '子類別直接沿用父類別的屬性和方法，叫做？', options: ['繼承', '封裝', '多載', '例外'], answer: 0 },
  { level: 'mid', q: '同一個方法呼叫，不同的物件有不同的行為，叫做？', options: ['封裝', '多型', '抽象', '序列化'], answer: 1 },
  { level: 'mid', q: 'UML 類別圖中，空心三角形箭頭的線表示？', options: ['組合', '相依', '一般化（繼承）', '關聯'], answer: 2 },
  { level: 'mid', q: '「建構子」（constructor）的主要用途是？', options: ['刪除物件', '建立物件時初始化它', '比較兩個物件', '把物件印出來'], answer: 1 },
  { level: 'hard', q: 'SOLID 原則中的「O」代表什麼？', options: ['單一職責原則', '開放封閉原則', '介面隔離原則', '依賴反轉原則'], answer: 1 },
  { level: 'hard', q: '確保一個類別只有一個實例的設計模式是？', options: ['Observer', 'Factory Method', 'Singleton', 'Adapter'], answer: 2 },
];

/** Day 5 quiz: campus questions whose answers the week has shown. */
export const QUIZ: { q: string; options: string[]; answer: number }[] = [
  { q: '萊爾富在哪一棟建築的一樓？', options: ['圖書館', '學生活動中心', '行政大樓', '管理一館'], answer: 1 },
  { q: '新生健康資料表要交到哪裡？', options: ['教務處', '健康中心', '圖書館', '警衛室'], answer: 1 },
  { q: '雲科路跑的起跑點在哪？', options: ['大門', '操場', '學生宿舍', '雲泰表演廳'], answer: 1 },
  { q: '週會在哪裡舉行？', options: ['國際會議廳', '學生餐廳', '體育館', '管理二館'], answer: 0 },
  { q: '學校的公共腳踏車要怎麼歸還？', options: ['隨便停', '騎到任一腳踏車站下車', '交給警衛', '不用還'], answer: 1 },
];

/** 導覽小雲's lines at each tour stop (light-hearted, not official facts). */
export const TOUR_FACTS: Record<string, string[]> = {
  圖書館: ['這裡是圖書館！期末考前一週，位子比學餐的排骨便當還難搶。', '小提醒：館內要安靜，手機記得轉靜音喔。'],
  行政大樓: ['行政大樓到了，註冊、繳費、辦證件都在這裡。', '找不到單位的話，一樓服務台的人超親切。'],
  雲泰表演廳: ['雲泰表演廳！演唱會、畢業典禮、迎新晚會都在這裡。', '聽說這裡的音響好到在後排打瞌睡也會被吵醒。'],
  觀雲閣: ['觀雲閣到了，天氣好的時候抬頭就是一整片雲。', '雲科的「雲」，說不定就是從這裡看出去的那片。'],
  設計學院: ['設計學院！半夜十二點燈還亮著，是在趕作品不是在鬧鬼。（目前不開放參觀，在外面看看就好）', '恭喜你走完導覽路線，你現在是正式的「導覽達人」了！'],
};

export const CLUBS = ['🎸 吉他社：「新生來試彈看看！」', '📷 攝影社：「校園打卡點我們最熟！」', '🏀 籃球社：「看你投籃姿勢不錯喔！」'];
