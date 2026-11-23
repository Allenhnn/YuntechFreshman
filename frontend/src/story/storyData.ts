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
  | 'stayAwake' | 'wardrobe' | 'rollcallOk';

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
  /** The quiz (with the option to peek). */
  | { t: 'quiz' };

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
  /** A phone message when the step begins. */
  msg?: { from: string; text: string };
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
  { who: '教授', text: '好，我們開始上課。今天講「管理的四大功能」。' },
  { who: '教授', text: '規劃、組織、領導、控制——這四個字期末一定考。' },
  { who: '同學', text: '（小聲）欸，你剛剛是不是差點遲到…' },
  { who: '教授', text: '規劃就是先想清楚目標，再決定要怎麼做。' },
  { who: '教授', text: '就像你們早上設三個鬧鐘，結果還是睡過頭，這就是規劃失敗。' },
  { who: '同學', text: '（全班笑）' },
  { who: '教授', text: '組織，是把人和資源放在對的位置上。' },
  { who: '教授', text: '這一頁的圖大家抄一下，下週小考會出。' },
  { who: '同學', text: '（小聲）好想睡…' },
  { who: '教授', text: '領導呢，不只是下命令，而是讓大家願意跟著你走。' },
];
export const COURSE = '管理學概論';

export const ROOMMATE = '室友阿凱';
export const FRIEND = '同學小芳';
/** Fine for missing a roll call (NT$). */
export const ABSENT_FINE = 50;

export const DAYS: Day[] = [
  {
    title: '遲到危機與翹課日常',
    steps: [
      { id: '1-1', text: '睡過頭了！快下床', place: DORM, cond: { t: 'getUp' }, at: hm(7, 52), wake: true, quietMsg: true, msg: { from: ROOMMATE, text: '老師正準備點名！你人咧？？快來管一！' } },
      { id: '1-T', text: '新手教學：學會基本操作', place: DORM, cond: { t: 'tutorial' } },
      { id: '1-2', text: '衝去管理一館 2F 的 MA214 教室，找空位坐下，被點到時舉手', place: CLASS1, room: 'MA214', cond: { t: 'class' } },
      { id: '1-3', text: '教授開始上課…撐住別睡著！', place: CLASS1, room: 'MA214', cond: { t: 'scene', scene: 'stayAwake' } },
      { id: '1-4', text: '下課了，去學生餐廳買午餐', place: CAFETERIA, cond: { t: 'buy', shop: 'cafeteria' }, at: hm(12, 0) },
      { id: '1-5', text: '把午餐吃掉（背包或快捷欄使用）', place: CAFETERIA, cond: { t: 'eat' } },
      { id: '1-6', text: '下午的課翹掉！用手機問點名碼，在「點名系統」簽到', place: CAFETERIA, cond: { t: 'phoneRollcall' }, at: hm(13, 10), msg: { from: FRIEND, text: '下午那堂改數位點名喔，要輸 4 位數的點名碼～' } },
      { id: '1-7', text: '翹課成功，去籃球場打球打到天黑', place: '籃球場', cond: { t: 'sport', kind: 'basketball' }, doneAt: hm(19, 0) },
      { id: '1-8', text: '天黑了，回宿舍睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '夜生活與聯誼準備',
    steps: [
      { id: '2-1', text: '睡到晚上才醒…下床準備出門', place: DORM, cond: { t: 'getUp' }, at: hm(18, 30), wake: true, msg: { from: ROOMMATE, text: '今晚聯誼別忘了！穿帥一點啊 😎' } },
      { id: '2-2', text: '打開宿舍衣櫃，換一套帥氣穿搭', place: DORM, cond: { t: 'outfit' } },
      { id: '2-3', text: '到學生活動中心參加聯誼，把好感度聊滿', place: ACTIVITY, cond: { t: 'talk', prompt: '按 E 加入聯誼', scene: 'mixer' } },
      { id: '2-4', text: '聯誼結束，回宿舍睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '校園路跑',
    steps: [
      { id: '3-1', text: '早起！今天是雲科路跑，下床', place: DORM, cond: { t: 'getUp' }, at: hm(7, 0), wake: true, give: 'raceBib', msg: { from: ROOMMATE, text: '號碼布幫你領了，在你桌上！起點在游泳館旁邊' } },
      { id: '3-2', text: '到路跑起點（游泳館旁）報到', place: '路跑起點', cond: { t: 'enter' } },
      { id: '3-3', text: '跑完全程：依路線通過所有檢查點（不能騎車）', place: '路跑起點', cond: { t: 'run' } },
      { id: '3-4', text: '累死了，回宿舍睡一整天', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '體育課與運動競賽',
    steps: [
      { id: '4-1', text: '起床，今天有體育課', place: DORM, cond: { t: 'getUp' }, at: hm(8, 0), wake: true, msg: { from: ROOMMATE, text: '體育課在操場集合，今天要比賽喔！' } },
      { id: '4-2', text: '足球：PK 大賽，贏過阿凱', place: '足球場', cond: { t: 'sport', kind: 'soccer' } },
      { id: '4-3', text: '排球：墊球比賽，比阿凱多', place: '排球場', cond: { t: 'sport', kind: 'volleyball' } },
      { id: '4-4', text: '跑操場：逆時針一圈計時賽', place: '操場', cond: { t: 'sport', kind: 'track' } },
      { id: '4-5', text: '回宿舍，和室友聊聊這一週', place: DORM, cond: { t: 'talk', prompt: '按 E 回顧這一週', scene: 'summary' } },
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
export const STALL_IDS = ['buffet', 'noodles', 'bento', 'drinks'];

export const SIDE_QUESTS: SideQuest[] = [
  { id: 'lostFound', title: '失物招領', text: '把撿到的學生證送到行政大樓或警衛室', total: 1, reward: { coins: 50 } },
  { id: 'bikeReturn', title: '腳踏車歸還', text: '把腳踏車騎到「{target}」並下車', total: 1, reward: { coins: 30 } },
  { id: 'tour', title: '校園導覽員', text: '走訪導覽景點 {n}/{total}：{target}', total: TOUR_STOPS.length, reward: { title: '導覽達人' } },
  { id: 'photo', title: '拍照打卡', text: '用手機在打卡點拍照 {n}/{total}：{target}', total: PHOTO_SPOTS.length, reward: { coins: 40 } },
  { id: 'athlete', title: '運動健將', text: '墊球 10 下、PK 進 3 球、跑完田徑計時賽（{n}/{total}）', total: 3, reward: { coins: 60 } },
  { id: 'foodie', title: '學餐美食家', text: '在學餐 4 個攤位各買一次（{n}/{total}）', total: STALL_IDS.length, reward: { coins: 30 } },
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
  { id: 'graduateWeek', title: '第一週畢業', icon: '🎓', desc: '完成第一週的主線' },
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
