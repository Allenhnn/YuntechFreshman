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
      { id: '2-1', text: '起床！今天早上有聯誼', place: DORM, cond: { t: 'getUp' }, at: hm(8, 30), wake: true, msg: { from: ROOMMATE, text: '早上十點活動中心旁邊廣場的聯誼別忘了！穿帥一點啊 😎', replies: [{ text: '收到，我會穿帥一點', answer: '回寢室打開衣櫃挑一套！別穿拖鞋去 🩴❌' }, { text: '聯誼要幹嘛？', answer: '就聊天玩遊戲啊，記得多找人聊幾句 😉' }, { text: '不太想去…', answer: '去啦！說不定就脫單了 💘' }] } },
      { id: '2-2', text: '回 C214 寢室打開衣櫃，換一套帥氣穿搭', place: DORM, cond: { t: 'outfit' } },
      { id: '2-3', text: '到活動中心和表演廳中間的廣場（36 週年布條下）參加聯誼，把好感度聊滿', place: '聯誼廣場', cond: { t: 'talk', prompt: '按 E 加入聯誼', scene: 'mixer' }, at: hm(10, 0) },
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
      { id: '4-1', text: '起床，今天活動中心有社團博覽會', place: DORM, cond: { t: 'getUp' }, at: hm(9, 30), wake: true, msg: { from: ROOMMATE, text: '活動中心旁邊的廣場今天有社團擺攤！聽說熱音社在找鼓手 🥁 去試試看？', replies: [{ text: '好啊，我去看看', answer: '加油！聽說打得好有獎金 🥁' }, { text: '我不會打鼓欸', answer: '照著社長打的節奏敲就好，D F J K 四個鼓，很簡單啦' }, { text: '熱音社在哪？', answer: '活動中心和表演廳中間的廣場，36 週年布條下面，有一套鼓的那一攤' }] } },
      { id: '4-2', text: '到活動中心和表演廳中間的廣場（36 週年布條下），在熱音社攤位挑戰打鼓', place: '聯誼廣場', cond: { t: 'talk', prompt: '按 E 挑戰熱音社打鼓', scene: 'drums' } },
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
  { id: 'mixerStar', title: '聯誼之星', icon: '💫', desc: '聯誼時和三個人都聊得來、互加 LINE' },
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
 * 聯誼, one on one (使用者 2026-11-26): walk up to one of the three and talk with that person alone,
 * six turns each. Every option is something a real person might say; what works is what works in a
 * real conversation — answer and ask back, show interest, listen (turn 5 checks whether you remember
 * what they told you), empathise instead of lecturing. One-upping, oversharing, unasked advice,
 * interrogating and coming on too strong cost. 好感度 starts at 30; 60 or more and you swap
 * contacts — the person shows up in the phone's chat app. Asking for a contact needs 55 first.
 */
export interface MixerOpt { text: string; delta: number; reply: string; mood?: 'happy' | 'meh' | 'awkward'; need?: number; fail?: { delta: number; reply: string } }
export interface MixerTurn { say: string; options: MixerOpt[] }
export interface MixerPerson { key: string; who: string; name: string; dept: string; look: { shirt: number; pants: number; hair: number }; long?: boolean; turns: MixerTurn[]; added: string }
export const MIXER: MixerPerson[] = [
  {
    key: 'mx1', who: '小美（設計系）', name: '小美', dept: '設計系', look: { shirt: 0xf48fb1, pants: 0x9a8a6c, hair: 0x3d2b20 }, long: true,
    added: '嗨～我是聯誼的小美！下次一起去古坑拍照 📷',
    turns: [
      { say: '嗨～你也是被朋友拖來的嗎？我是設計系的小美。', options: [
        { text: '對啊被室友硬拉來的，不過來了好像也不錯 😆', delta: 10, reply: '哈哈同病相憐！我是被學姊騙來的。' },
        { text: '我是自己來的，想多認識一些人', delta: 6, reply: '喔～好主動！' },
        { text: '嗯。', delta: -10, reply: '……（有點冷場）', mood: 'awkward' },
        { text: '設計系喔？那你一定很會畫，幫我畫一張！', delta: -6, reply: '呃…很多人都這樣說欸 😅', mood: 'meh' },
      ] },
      { say: '我最近週末都拿底片相機到處拍，上週去古坑的綠色隧道拍了一整天。', options: [
        { text: '底片相機！拍完要等沖洗那種嗎？好有感覺', delta: 12, reply: '對！等待的過程超期待的～' },
        { text: '用手機拍不是比較方便嗎？', delta: -8, reply: '……方便是方便啦。', mood: 'meh' },
        { text: '我上週也去古坑！還去了劍湖山，我跟你說那個雲霄飛車…', delta: -8, reply: '喔…（話題一直繞回你身上）', mood: 'meh' },
        { text: '綠色隧道哪個時間最好拍？我也想去看看', delta: 10, reply: '早上！光線從樹葉縫灑下來超美。' },
      ] },
      { say: '那你呢？什麼系的？平常都在幹嘛？', options: [
        { text: '資管系，平常打打球，偶爾也會亂拍照，不過都用手機哈哈', delta: 12, reply: '那下次可以一起去拍！' },
        { text: '就…上課啊，沒什麼特別的', delta: -6, reply: '這樣啊…', mood: 'meh' },
        { text: '我從國小開始說起好了…（講了五分鐘自己的人生）', delta: -12, reply: '……（她偷偷看了一下手機）', mood: 'awkward' },
        { text: '你猜猜看 😏', delta: -4, reply: '我不太會猜欸…', mood: 'meh' },
      ] },
      { say: '唉，期中作品被老師說「沒有靈魂」，有點沮喪 😞', options: [
        { text: '被這樣說一定很難受…你自己喜歡那件作品嗎？', delta: 14, reply: '嗯…其實我很喜歡。謝謝你問 🥹' },
        { text: '老師就那樣啦，不要想太多！', delta: 2, reply: '嗯…也是啦。', mood: 'meh' },
        { text: '那你下次多參考一些作品，構圖要先…', delta: -10, reply: '我沒有要你教我啦…', mood: 'awkward' },
        { text: '哈哈「沒有靈魂」，好好笑', delta: -16, reply: '……（臉色一沉）', mood: 'awkward' },
      ] },
      { say: '欸，你剛剛有在聽嗎？我上週去哪裡拍照？😏', options: [
        { text: '古坑的綠色隧道！', delta: 12, reply: '哇你真的有在聽！' },
        { text: '阿里山？', delta: -10, reply: '…不是啦 😑', mood: 'awkward' },
        { text: '日月潭吧', delta: -10, reply: '…你根本沒在聽。', mood: 'awkward' },
        { text: '呃…劍湖山？', delta: -12, reply: '那是你說的地方吧 😑', mood: 'awkward' },
      ] },
      { say: '時間差不多了～今天聊得蠻開心的！', options: [
        { text: '我也是！可以加個 LINE 嗎？下次一起去拍照', delta: 10, reply: '好呀！我掃你 📱', need: 55, fail: { delta: -8, reply: '呃…我們再看看吧 😅' } },
        { text: '嗯嗯，掰掰', delta: -4, reply: '掰～', mood: 'meh' },
        { text: '可以給我你的 LINE、IG 跟電話嗎？', delta: -12, reply: '…一個就夠了吧 😳', mood: 'awkward' },
        { text: '謝謝你陪我聊天，作品加油！你的作品一定有靈魂', delta: 8, reply: '哈哈謝謝！你也是 😊' },
      ] },
    ],
  },
  {
    key: 'mx2', who: '阿哲（資工系）', name: '阿哲', dept: '資工系', look: { shirt: 0x37474f, pants: 0x2d3a5c, hair: 0x151515 },
    added: '嘿！我阿哲。App 測試版出來再找你 🍓',
    turns: [
      { say: '欸你好，我阿哲，資工的。這裡的飲料是不是只有紅茶啊…', options: [
        { text: '對啊，我剛剛也在找奶茶 😂', delta: 10, reply: '哈哈奶茶黨握手 🤝' },
        { text: '你好！紅茶還不錯啦', delta: 6, reply: '還行啦～' },
        { text: '你們資工是不是都不太出門？', delta: -12, reply: '…這是刻板印象欸。', mood: 'awkward' },
        { text: '（點點頭，繼續滑手機）', delta: -14, reply: '……喔。', mood: 'awkward' },
      ] },
      { say: '我最近在玩一款農場遊戲，每天晚上都在種草莓 😂', options: [
        { text: '療癒系那種嗎？種草莓聽起來好紓壓', delta: 12, reply: '對！睡前種一下超放鬆' },
        { text: '那種遊戲很無聊吧，要玩就玩 FPS', delta: -10, reply: '…每個人喜好不一樣啦。', mood: 'meh' },
        { text: '我也有玩！你第幾年了？', delta: 10, reply: '第三年秋天了！你呢？' },
        { text: '你都不用念書喔？', delta: -8, reply: '期中考完了好嗎…', mood: 'meh' },
      ] },
      { say: '說到念書，我們專題在做 App，我負責後端，壓力有點大。', options: [
        { text: '後端聽起來很硬欸，你們在做什麼 App？', delta: 12, reply: '學餐排隊預測！幾點去人最少。' },
        { text: '加油啦，資工本來就要寫 code', delta: -2, reply: '…嗯。', mood: 'meh' },
        { text: '我之前寫過一個更厲害的專案，我跟你說…', delta: -12, reply: '喔是喔（敷衍）', mood: 'awkward' },
        { text: '需要人幫忙測試的話可以找我', delta: 10, reply: '真的嗎！我記下來了 📝' },
      ] },
      { say: '你覺得…學餐排隊預測這種東西，真的會有人用嗎？', options: [
        { text: '會吧！中午那個隊伍真的很誇張，知道幾點人少超有用', delta: 12, reply: '對吧！你懂我！' },
        { text: '應該不會，大家都直接去排', delta: -8, reply: '…你好直接 😅', mood: 'meh' },
        { text: '可以再加個今日推薦菜色，應該更多人用', delta: 10, reply: '好點子！我筆記一下' },
        { text: '這學校的人應該都懶得下載', delta: -6, reply: '也是有可能啦…', mood: 'meh' },
      ] },
      { say: '考你一下，我剛剛說我在遊戲裡種什麼？', options: [
        { text: '草莓！', delta: 12, reply: '你記得欸！🍓' },
        { text: '西瓜？', delta: -10, reply: '…是草莓啦。', mood: 'awkward' },
        { text: '玉米吧', delta: -10, reply: '你剛剛在放空吧 😑', mood: 'awkward' },
        { text: '奶茶？', delta: -12, reply: '那是飲料啦哈哈…', mood: 'awkward' },
      ] },
      { say: '那個…我好像要去幫忙收場了。', options: [
        { text: '可以加個 LINE 嗎？之後幫你測 App', delta: 10, reply: '好啊！測試版出來第一個找你', need: 55, fail: { delta: -6, reply: '呃…我再跟你說好了' } },
        { text: '好喔掰', delta: -4, reply: '掰。', mood: 'meh' },
        { text: '專題加油！草莓記得收成 🍓', delta: 8, reply: '哈哈你記得欸！謝啦' },
        { text: '等一下，我再跟你說我高中的事…', delta: -10, reply: '呃…我真的要走了', mood: 'awkward' },
      ] },
    ],
  },
  {
    key: 'mx3', who: '小安（企管系）', name: '小安', dept: '企管系', look: { shirt: 0xf2c230, pants: 0x2d3a5c, hair: 0x2b211b }, long: true,
    added: '嗨嗨～我小安！成發下個月，記得來看 💃',
    turns: [
      { say: '嗨嗨！我小安，企管系～你看起來好像有點緊張？😆', options: [
        { text: '被你發現了，第一次參加聯誼 😅', delta: 12, reply: '哈哈沒關係，我第一次也超緊張！' },
        { text: '沒有啊，我超自在的', delta: -4, reply: '是喔～（笑）', mood: 'meh' },
        { text: '有一點！你看起來很習慣這種場合欸', delta: 8, reply: '我臉皮比較厚啦哈哈' },
        { text: '還好，我只是被拉來湊人數的', delta: -8, reply: '喔…這樣啊。', mood: 'meh' },
      ] },
      { say: '我在熱舞社，最近準備成發，每天練到十點 💃', options: [
        { text: '每天練到十點！你們成發什麼時候？', delta: 12, reply: '下個月！你要來看嗎？' },
        { text: '跳舞喔，我四肢超不協調', delta: 2, reply: '大家一開始都這樣啦～', mood: 'meh' },
        { text: '練那麼晚，功課怎麼辦？', delta: -8, reply: '…你很像我媽欸 😂', mood: 'meh' },
        { text: '拍影片給我看好不好', delta: 2, reply: '成發再說啦～', mood: 'meh' },
      ] },
      { say: '而且我週末還在飲料店打工，有時候覺得有點累…', options: [
        { text: '又練舞又打工也太拚了，累的時候都怎麼放鬆？', delta: 14, reply: '去吃一頓好的！我最愛火鍋 🍲' },
        { text: '累就辭職啊', delta: -10, reply: '…沒那麼簡單啦。', mood: 'awkward' },
        { text: '我也好累，昨天報告熬夜到三點…', delta: -6, reply: '嗯嗯（話題被你搶走了）', mood: 'meh' },
        { text: '打工能賺錢很好啊', delta: 2, reply: '是沒錯啦～', mood: 'meh' },
      ] },
      { say: '欸，你覺得大學一定要談戀愛嗎？🤔', options: [
        { text: '不一定吧，遇到對的人自然就會，不用急', delta: 12, reply: '我也這麼覺得！' },
        { text: '一定要！不然大學白念了', delta: -6, reply: '壓力好大喔哈哈…', mood: 'meh' },
        { text: '你是在暗示什麼嗎 😏', delta: -10, reply: '…想太多了啦 😑', mood: 'awkward' },
        { text: '看人吧，你自己怎麼想？', delta: 10, reply: '先把自己顧好比較重要～' },
      ] },
      { say: '考考你～我剛剛說我週末在哪裡打工？', options: [
        { text: '飲料店！', delta: 12, reply: '答對！下次來找我買 🧋' },
        { text: '便利商店', delta: -10, reply: '不是啦～', mood: 'awkward' },
        { text: '火鍋店？', delta: -10, reply: '火鍋是我愛吃的啦 😂', mood: 'awkward' },
        { text: '補習班', delta: -10, reply: '…你沒在聽吧。', mood: 'awkward' },
      ] },
      { say: '我要去找朋友了～今天很開心！', options: [
        { text: '成發我會去看！可以加你 LINE 嗎？', delta: 10, reply: '好啊～到時候傳時間給你！', need: 55, fail: { delta: -6, reply: '呃…有緣再說吧 😅' } },
        { text: '掰掰～', delta: -4, reply: '掰掰！', mood: 'meh' },
        { text: '練舞別太累，記得去吃火鍋 🍲', delta: 8, reply: '哈哈你有記住！' },
        { text: '可以再陪我聊一下嗎？拜託', delta: -10, reply: '呃…我朋友在等我了', mood: 'awkward' },
      ] },
    ],
  },
];
export const MIXER_START = 30;
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
