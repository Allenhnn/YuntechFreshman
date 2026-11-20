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
  | 'clubFair' | 'summary' | 'lostFound' | 'rollcall' | 'quiz' | 'sleep' | 'study' | 'hilife';

export type Cond =
  /** Walk into the place. */
  | { t: 'enter' }
  /** Press E in the place to play a scene; done when the scene ends. */
  | { t: 'talk'; prompt: string; scene: SceneId }
  /** Buy anything at the cafeteria stalls or 萊爾富. */
  | { t: 'buy'; shop: 'cafeteria' | 'hilife' }
  /** Eat any food / a given item. */
  | { t: 'eat'; item?: ItemId }
  /** Finish a basketball challenge. */
  | { t: 'sport' }
  /** A class with a roll call; leaving is skipping (sudden roll call). */
  | { t: 'class'; advanced: boolean }
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
  /** Item handed over when the step begins. */
  give?: ItemId;
  /** Toast when the step begins. */
  say?: string;
}

export interface Day {
  title: string;
  steps: Step[];
}

const hm = (h: number, m = 0): number => h * 60 + m;

export const DAYS: Day[] = [
  {
    title: '開學第一天',
    steps: [
      { id: '1-1', text: '回宿舍C 拿書桌上的健康資料表', place: DORM, cond: { t: 'talk', prompt: '按 E 拿起健康資料表', scene: 'wakeD1' }, at: hm(7, 30) },
      { id: '1-2', text: '到健康中心（學生活動中心）繳交健康資料表', place: HEALTH, cond: { t: 'talk', prompt: '按 E 和健康中心護理師說話', scene: 'nurse' } },
      { id: '1-3', text: '到學生餐廳買早午餐', place: CAFETERIA, cond: { t: 'buy', shop: 'cafeteria' } },
      { id: '1-4', text: '把剛買的食物吃掉（背包或快捷欄使用）', place: CAFETERIA, cond: { t: 'eat' } },
      { id: '1-5', text: '到管理一館上課，等老師點名', place: CLASS1, cond: { t: 'class', advanced: false } },
      { id: '1-6', text: '下課了，回宿舍休息', place: DORM, cond: { t: 'sleep', until: 'nextDay' }, at: hm(12, 0) },
    ],
  },
  {
    title: '運動與聯誼',
    steps: [
      { id: '2-1', text: '起床，室友約你去打籃球', place: DORM, cond: { t: 'talk', prompt: '按 E 和室友說話', scene: 'roommateD2' }, at: hm(7, 30) },
      { id: '2-2', text: '到籃球場完成一次投籃挑戰', place: '籃球場', cond: { t: 'sport' } },
      { id: '2-3', text: '到萊爾富（學生活動中心 1F）買東西吃', place: ACTIVITY, cond: { t: 'buy', shop: 'hilife' } },
      { id: '2-4', text: '回宿舍補眠（睡到傍晚）', place: DORM, cond: { t: 'sleep', until: hm(18, 0) } },
      { id: '2-5', text: '晚上到學生活動中心參加聯誼', place: ACTIVITY, cond: { t: 'talk', prompt: '按 E 加入聯誼', scene: 'mixer' } },
      { id: '2-6', text: '回宿舍睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '雲科路跑',
    steps: [
      { id: '3-1', text: '起床，今天是雲科路跑，領號碼布', place: DORM, cond: { t: 'talk', prompt: '按 E 拿號碼布', scene: 'bibD3' }, at: hm(7, 0) },
      { id: '3-2', text: '到操場起跑點報到', place: '路跑起點', cond: { t: 'enter' } },
      { id: '3-3', text: '跑完全程：依序通過所有檢查點（不能騎車）', place: '路跑起點', cond: { t: 'run' } },
      { id: '3-4', text: '累死了，回宿舍睡一整天', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '週會',
    steps: [
      { id: '4-1', text: '起床，今天早上有週會', place: DORM, cond: { t: 'enter' }, at: hm(7, 30) },
      { id: '4-2', text: '到國際會議廳聽週會，別睡著', place: HALL, cond: { t: 'talk', prompt: '按 E 入座聽週會', scene: 'assembly' } },
      { id: '4-3', text: '回宿舍吃泡麵', place: DORM, cond: { t: 'eat', item: 'cupNoodles' }, give: 'cupNoodles', say: '宿舍櫃子裡還有一包泡麵，已放進背包' },
      { id: '4-4', text: '到管理二館上課，這次點名比較難', place: CLASS2, cond: { t: 'class', advanced: true }, at: hm(13, 0) },
      { id: '4-5', text: '下課了，回宿舍睡覺', place: DORM, cond: { t: 'sleep', until: 'nextDay' } },
    ],
  },
  {
    title: '小考與社團博覽會',
    steps: [
      { id: '5-1', text: '起床，今天第一次小考', place: DORM, cond: { t: 'enter' }, at: hm(7, 30) },
      { id: '5-2', text: '到圖書館複習 30 分鐘', place: LIBRARY, cond: { t: 'talk', prompt: '按 E 坐下讀書', scene: 'study' } },
      { id: '5-3', text: '到管理一館參加小考', place: CLASS1, cond: { t: 'quiz' } },
      { id: '5-4', text: '到學生活動中心逛社團博覽會', place: ACTIVITY, cond: { t: 'talk', prompt: '按 E 逛社團攤位', scene: 'clubFair' } },
      { id: '5-5', text: '回宿舍，結束第一週', place: DORM, cond: { t: 'talk', prompt: '按 E 回顧這一週', scene: 'summary' } },
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
  { id: 'lake', title: '跳雲夢湖', icon: '🌊', desc: '跳進雲夢湖', unavailable: '雲夢湖尚未加入地圖' },
  { id: 'run2020', title: '2020跑完', icon: '🏃', desc: '跑完雲科路跑全程' },
  { id: 'skip', title: '翹課', icon: '🚪', desc: '上課途中溜出教室', secret: true },
  { id: 'cheat', title: '作弊', icon: '👀', desc: '小考時偷看隔壁', secret: true },
  { id: 'bikeHit', title: '騎腳踏車撞別人', icon: '🚲', desc: '騎腳踏車撞到路人', secret: true },
  { id: 'steal', title: '偷竊', icon: '🫣', desc: '在萊爾富沒付錢就拿走商品', secret: true },
  { id: 'perfectAttendance', title: '全勤寶寶', icon: '📅', desc: '一週所有點名都成功' },
  { id: 'earlyBird', title: '早起的鳥兒', icon: '🐦', desc: '08:30 前完成當天第二個目標' },
  { id: 'runGod', title: '路跑之神', icon: '⚡', desc: '路跑在目標時間內完賽' },
  { id: 'sharpShooter', title: '三分神射', icon: '🏀', desc: '一次投籃挑戰拿到 15 分以上' },
  { id: 'safeRider', title: '交通安全模範生', icon: '🦺', desc: '騎腳踏車累計 1 公里都沒撞到人' },
  { id: 'explorer', title: '校園探險家', icon: '🧭', desc: '走進 20 棟不同的建築' },
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
    { who: '護理師', text: '這是你的學生證，上面有學號，點名會用到喔。' },
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

/** 聯誼: three topics, each with one best answer (index). */
export const MIXER: { who: string; ask: string; options: string[]; best: number }[] = [
  { who: '小美（設計系）', ask: '你平常假日都在做什麼？', options: ['睡覺打電動', '去古坑爬山、騎腳踏車', '在宿舍追劇'], best: 1 },
  { who: '阿哲（資工系）', ask: '你覺得學校哪裡最好吃？', options: ['學餐自助餐，便宜大碗', '不知道，我都吃泡麵', '後門的雞排'], best: 0 },
  { who: '小安（企管系）', ask: '要不要一起參加社團？', options: ['好啊！哪個社團？', '再說吧', '社團好麻煩'], best: 0 },
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
  設計學院: ['設計學院！半夜十二點燈還亮著，是在趕作品不是在鬧鬼。', '恭喜你走完導覽路線，你現在是正式的「導覽達人」了！'],
};

export const CLUBS = ['🎸 吉他社：「新生來試彈看看！」', '📷 攝影社：「校園打卡點我們最熟！」', '🏀 籃球社：「看你投籃姿勢不錯喔！」'];
