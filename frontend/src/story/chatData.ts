import type { StoryProgress } from '../state/story';
import { DAYS, FRIEND, ROOMMATE, ROOMMATE2 } from './storyData';

/** What a chat answer can look at: the story's progress, the clock, the wallet. */
export interface ChatCtx {
  p: StoryProgress;
  /** Minute of the day (0–1439). */
  minute: number;
  coins: number;
  /** The current main-line objective, if the week is still running. */
  objective: string | null;
}

type Answer = string | string[] | ((c: ChatCtx) => string | string[]);
/** One thing you can say; `next` replaces the options after the answer (a short back-and-forth). */
export interface ChatOption {
  text: string;
  answer: Answer;
  next?: ChatOption[];
  /** Offered only while this holds. */
  when?: (c: ChatCtx) => boolean;
}

/** Picks the answer: a list means one at random. */
export function resolveAnswer(a: Answer, c: ChatCtx): string {
  const v = typeof a === 'function' ? a(c) : a;
  return Array.isArray(v) ? v[Math.floor(Math.random() * v.length)]! : v;
}

const hour = (c: ChatCtx): number => Math.floor(c.minute / 60);
const day = (c: ChatCtx): number => c.p.day;
const weekOver = (c: ChatCtx): boolean => c.p.day > DAYS.length;
const sideDone = (c: ChatCtx, id: string): boolean => c.p.side[id]?.state === 'done';

/** Contacts in the chat app, in list order (people from the 聯誼 join after them: StoryProgress.flags.friends). */
export const CONTACTS = [ROOMMATE, ROOMMATE2, FRIEND] as const;
/** Avatars of the 聯誼 contacts. */
export const FRIEND_AVATAR: Record<string, string> = { 小美: '🎨', 阿哲: '💻', 小安: '💃' };

/** Things you can bring up any time, per contact (the story's own messages come first). */
export const TOPICS: Record<string, ChatOption[]> = {
  [ROOMMATE]: [
    {
      text: '在幹嘛？',
      answer: (c) => hour(c) < 9 ? ['剛起床在刷牙 🪥', '在搶早餐，今天蛋餅又賣完了 😩']
        : hour(c) < 14 ? ['在學餐排隊，人超多', '上課中…教授在講什麼我完全聽不懂 😵']
          : hour(c) < 19 ? ['在宿舍趕報告 💻', '剛打完球，全身都是汗 🏀']
            : ['在打電動 🎮 要不要一起？', '躺在床上滑手機，懶得動 📱'],
    },
    {
      text: '我現在該做什麼？',
      answer: (c) => c.objective ? `你不是要「${c.objective}」嗎？按 G 開導航啦 🗺️` : '這週的事都做完了吧？在校園裡亂晃也不錯啊',
    },
    {
      text: '附近有什麼好吃的？',
      answer: ['學餐的猩猩複合式，咖哩飯很讚 🍛', '猴子食堂的便當便宜又大份！', '晚上去龍潭路那邊吃宵夜啊 🍢', '超商的御飯糰，窮學生救星 🍙'],
      next: [
        { text: '要一起去嗎？', answer: ['好啊！學餐見 🙌', '我剛吃飽了…下次啦'] },
        { text: '謝啦', answer: '👍' },
      ],
    },
    {
      text: '借我錢 💸',
      answer: (c) => c.coins < 100 ? '你又月底了喔…我也沒錢啦 😂 去幫人跑腿賺一點？' : `你錢包明明還有 NT$${c.coins} 好嗎 🙄`,
      next: [
        { text: '拜託啦 🙏', answer: ['不要 😤', '……好啦，下次請我吃飯就好（並沒有給你錢）'] },
        { text: '開玩笑的啦', answer: '我就知道 😏' },
      ],
    },
    {
      text: '午餐謝謝招待 😋',
      when: (c) => c.p.flags.lunchPayer === 'kai',
      answer: ['下次我一定贏回來 😤', '我的錢包在哭泣…'],
    },
    {
      text: '下次猜拳換我贏',
      when: (c) => c.p.flags.lunchPayer === 'me',
      answer: ['你上次說過一樣的話 😂', '隨時奉陪！你出拳太好猜了'],
    },
    {
      text: '聽說校園裡有會講話的動物？',
      when: (c) => !sideDone(c, 'mystery'),
      answer: ['我聽學長說管理學院那邊有一隻很有個性的貓 🐱', '操場那邊好像常有一隻黑狗晃來晃去 🐕'],
    },
    {
      text: '打鼓好玩嗎？',
      when: (c) => (c.p.flags.drumLevel ?? 0) > 0,
      answer: (c) => `你打到第 ${c.p.flags.drumLevel} 關？${(c.p.flags.drumLevel ?? 0) >= 4 ? '太強了吧，熱音社一定搶著要你 🥁' : '還不錯啦，再練練'}`,
    },
    {
      text: '小考考得怎樣？',
      when: (c) => c.p.flags.quizScore !== undefined,
      answer: (c) => c.p.flags.caught ? '你作弊被抓了吧…全班都看到了 😂' : (c.p.flags.quizScore ?? 0) >= 80 ? '高分耶！借我筆記好不好 🙏' : '我也考很爛，沒差啦 🫠',
    },
    { text: '晚安 🌙', when: (c) => hour(c) >= 21 || hour(c) < 4, answer: ['晚安～明天別再睡過頭了 😴', '晚安！記得設鬧鐘 ⏰'] },
    { text: '這週辛苦了', when: weekOver, answer: '真的！下週見，一樣睡過頭的話我不幫你喊有了喔 😂' },
  ],
  [ROOMMATE2]: [
    {
      text: '在幹嘛？',
      answer: ['在吃東西 🍗', '在吃宵夜（現在幾點都算宵夜）', '剛睡醒…又餓了', '在排隊買雞排 🐔'],
    },
    {
      text: '推薦點吃的',
      answer: ['學餐猴子食堂的排骨飯！我一週吃五次', '肚子餓的時候什麼都好吃 🤤', '販賣機的泡麵也很棒喔'],
      next: [
        { text: '你也太會吃', answer: '這是天賦 😌' },
        { text: '幫我帶一份？', answer: '可以，但我會先吃一半 😋' },
      ],
    },
    {
      text: '要不要去打球？',
      answer: ['好啊！不過我只負責站在籃下 🏀', '網球場那邊新整理好了，去打網球吧 🎾', '太熱了…晚上再說'],
    },
    {
      text: '午餐謝啦 😋',
      when: (c) => c.p.flags.lunchPayer === 'fat',
      answer: '我的便當錢……下次我要出布 ✋',
    },
    {
      text: '你知道宿舍那隻大鳥嗎？',
      when: (c) => day(c) >= 2 && !sideDone(c, 'mystery'),
      answer: '你說那隻呆呆的大白鳥？牠常在宿舍附近發呆，跟我很像 🐦',
    },
    { text: '路跑累死了', when: (c) => day(c) >= 4 || (day(c) === 3 && hour(c) >= 10), answer: '我跑到一半就用走的了 😮‍💨 你真的跑完喔？' },
  ],
  [FRIEND]: [
    {
      text: '作業寫完了嗎？',
      answer: ['寫完了！你還沒開始對吧 😏', '還沒…一起去圖書館寫？', '哪個作業？我們有作業？😱'],
      next: [
        { text: '借我參考一下 🙏', answer: ['自己寫啦！不會的我可以教你 📚', '只能看不能抄喔 👀'] },
        { text: '一起寫吧', answer: '好啊，圖書館見！' },
      ],
    },
    {
      text: '小考範圍是什麼？',
      when: (c) => day(c) <= 5 && c.p.flags.quizScore === undefined,
      answer: '物件導向：類別、物件、封裝、繼承、多型，還有 UML 類別圖。多型最難 😵',
      next: [
        { text: '多型是什麼？', answer: '同一個方法，不同類別有不同做法。像動物都會「叫」，但狗是汪、貓是喵 🐶🐱' },
        { text: '謝啦！', answer: '加油！不要作弊喔 😉' },
      ],
    },
    {
      text: '熱舞社在哪練舞？',
      answer: '管理二館一樓的大鏡子前面！他們說誰都可以去跳一段 💃',
      when: (c) => !sideDone(c, 'dance'),
    },
    {
      text: '最近有什麼活動嗎？',
      answer: ['人科一館跟龍潭路的轉角有街宣攤位，拍照打卡送鑰匙圈 🔑', '活動中心常常有社團擺攤！', '雲夢湖那邊的橋很好拍，去拍照吧 📸'],
    },
    {
      text: '要不要一起吃飯？',
      answer: ['今天約滿了啦，下次吧 😝', '好啊！學餐見？', '我在減肥…好啦一起吃 🙃'],
    },
    {
      text: '聯誼好玩嗎？',
      when: (c) => c.p.flags.mixer !== undefined,
      answer: (c) => (c.p.flags.mixer ?? 0) >= 3 ? '聽說你很會聊天喔～ 😏' : '聽說你全程在發呆 😂',
    },
  ],
  小美: [
    { text: '最近有去拍照嗎？', answer: ['上週又去綠色隧道了！早上的光真的很美 📷', '底片用完了…在等新的寄來 😭', '昨天在雲夢湖拍了夕陽，等沖洗出來給你看！'],
      next: [{ text: '好想看！', answer: '沖好傳給你～' }, { text: '下次帶我去', answer: '好啊！要早起喔 ⏰' }] },
    { text: '作品還順利嗎？', answer: ['重做了一版，老師說「有進步」！謝謝你那天聽我抱怨 🥹', '還在改…設計系的期末是地獄 😵'] },
    { text: '要不要一起吃飯？', answer: ['好呀！學餐還是外面？', '這週趕作品…下週好嗎？'] },
    { text: '晚安 🌙', when: (c) => hour(c) >= 21 || hour(c) < 4, answer: '晚安～明天見 ✨' },
  ],
  阿哲: [
    { text: 'App 做得怎樣？', answer: ['後端終於串起來了！你要不要先測測看？', '昨天 debug 到三點，草莓都枯了 🥲', '我們加了你說的今日推薦！'],
      next: [{ text: '好啊我來測', answer: '太好了！有 bug 跟我說 🐛' }, { text: '加油，別熬夜', answer: '盡量 😂' }] },
    { text: '草莓收成了嗎？🍓', answer: ['收了一整車！賣了好多錢（遊戲幣）', '忘記澆水全死了…'] },
    { text: '一起去學餐？', answer: ['走！我請你奶茶（如果有的話）', '我剛吃完…晚餐約？'] },
  ],
  小安: [
    { text: '成發練得怎樣？', answer: ['今天終於整首順過一次了！💃', '腳好痠…但快成功了！', '下個月 15 號晚上，記得來喔！'],
      next: [{ text: '我一定去', answer: '說好了喔！我會在台上找你 👀' }, { text: '別太累', answer: '謝啦～練完就去吃火鍋 🍲' }] },
    { text: '週末還在打工嗎？', answer: ['對啊～來飲料店找我，給你多加珍珠 🧋', '這週休息！終於可以睡飽'] },
    { text: '要不要去吃火鍋？', answer: ['好啊！！我知道一家很讚的', '這週太忙了，下週約！'] },
  ],
};
