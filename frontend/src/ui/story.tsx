import { WARDROBE_YAW_LIMIT, wardrobeView } from '../character/wardrobePreview';
import { randomName, usePlayerName } from '../state/playerName';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useGame } from '../state/store';
import { storyActions, useStory, type StoryProgress } from '../state/story';
import { COURSE, LECTURE, TUTORIAL, ACHIEVEMENTS, CLUBS, DAYS, MIXER, MIXER_GOAL, MIXER_START, QUIZ, SIDE_QUESTS, PHOTO_SPOTS, TOUR_STOPS, MY_ROOM, PROFESSOR, type Step, type VnLine } from '../story/storyData';
import { OUTFIT_ITEMS, OUTFIT_PARTS } from '../character/outfit';
import { storyEvents } from '../story/storyRuntime';
import { dispatch } from '../state/commands';
import { useApi } from './api';
import { Icon, Rich } from './icons';
import { Dance, Drums, Exam, Lunch } from './storyGames';

/** Hints for side quests not started yet. */
const SIDE_HINTS: Record<string, string> = {
  lostFound: '走在人行道上，留意地上發亮的東西',
  bikeReturn: '到腳踏車站騎一台腳踏車看看',
  tour: '從大學路的校門口開始',
  photo: '用手機相機（P → 相機）拍一張照片',
  athlete: '先到籃球場玩一次投籃挑戰',
  foodie: '到學生餐廳的攤位買點東西',
  promo: '人科一館和龍潭路的轉角好像有人在發東西',
  mystery: '聽說校園裡住著三位神秘人物……',
  dance: '管理二館一樓的大鏡子前常有人在練舞',
};

function sideText(id: string, p: StoryProgress): string {
  const q = SIDE_QUESTS.find((s) => s.id === id)!;
  const s = p.side[id]!;
  const list = id === 'tour' ? TOUR_STOPS : id === 'photo' ? PHOTO_SPOTS : null;
  const next = list?.find((x) => !s.done.includes(x)) ?? '';
  return q.text.replace('{n}', String(s.done.length)).replace('{total}', String(q.total)).replace('{target}', s.target ?? next);
}

const STEP_ICON: Record<string, string> = { pickup: '💾', talk: '💬', buy: '🛒', eat: '🍱', sport: '🏀', class: '📚', sleep: '🛏️', run: '🏁', quiz: '📝', enter: '📍', scene: '📚', getUp: '⏰', phoneRollcall: '📱', outfit: '👕', tutorial: '🎮' };
const WHO: Record<string, string> = {
  wakeD1: '書桌', nurse: '健康中心護理師', roommateD2: '室友阿凱', bibD3: '室友阿凱', summary: '室友阿凱', mixer: '聯誼的同學',
  assembly: '週會座位', clubFair: '社團攤位', study: '圖書館的座位', lunch: '學餐餐桌的室友', returnUsb: '室友阿凱', drums: '熱音社攤位',
};

/** A plain instruction for the step: where to go and what to press. */
function howTo(step: Step): string {
  const c = step.cond;
  switch (c.t) {
    case 'talk': return `走到${step.place}，靠近${WHO[c.scene] ?? '對方'}按 E`;
    case 'buy': return c.shop === 'hilife' ? `走進${step.place}，按 E 打開萊爾富買一樣東西` : `走到${step.place}的攤位前，按 E 點餐`;
    case 'eat': return c.item === 'cupNoodles' ? '打開背包（Tab）點泡麵，或按快捷鍵使用' : '打開背包（Tab）點食物，或按快捷鍵 1–5 使用';
    case 'sport': return c.kind === 'basketball' ? '走到籃球場的籃框下，按 E 開始投籃（第一人稱：滑鼠瞄準、Space 蓄力）'
      : c.kind === 'soccer' ? '走到足球場罰球點，按 E 開始 PK 大賽' : c.kind === 'volleyball' ? '走進排球場，按 E 開始墊球比賽' : '走到跑道起點，按 E 開始逆時針計時賽';
    case 'class': return `跟著導航到${step.place}，在時間內走到教室空位按 E 坐下（遲到扣錢）`;
    case 'scene': return `在${step.place}的座位坐好（按 E 坐下），上課就開始了`;
    case 'tutorial': return '照著畫面下方的提示操作';
    case 'getUp': return '按 E 或任一移動鍵下床';
    case 'phoneRollcall': return '按 P 打開手機 →「聊天室」問小芳點名碼 →「點名系統」輸入';
    case 'outfit': return `進宿舍到${MY_ROOM.number}（${MY_ROOM.label}），在衣櫃前按 E，至少穿上 3 件再出門`;
    case 'sleep': return `進宿舍到${MY_ROOM.number}（${MY_ROOM.label}），爬上自己的床躺下就會睡著`;
    case 'run': return '跟著箭頭依序穿過拱門；Shift 衝刺會消耗體力';
    case 'quiz': return `走進${step.place}${step.room ? ` 的 ${step.room}` : ''}，按 E 入座考試；考試中按左/右 Shift 可以偷看隔壁（小心教授）`;
    case 'pickup': return `走進${step.place}${step.room ? ` 的 ${step.room}` : ''}，走到發亮的東西旁邊就會撿起來`;
    case 'enter': return `走到${step.place}`;
  }
}

/** HUD top-left: the main objective (what, how, where) and the active side quests. */
export function QuestTracker(): ReactNode {
  const enabled = useStory((s) => s.enabled);
  const p = useStory((s) => s.progress);
  const live = useStory((s) => s.live);
  const nav = useGame((s) => s.nav);
  if (!enabled) return null;
  const day = DAYS[p.day - 1];
  const step = day?.steps[p.step];
  return (
    <div className="qt">
      <section className="qt-main">
        <header>
          <span className="qt-tag">主線</span>
          {day ? <><b className="qt-day">DAY {p.day}</b><span className="qt-title">{day.title}</span></> : <span className="qt-title">第一週完成・自由探索</span>}
        </header>
        {day && step ? (
          <>
            <div className="qt-steps">{day.steps.map((st, i) => <i key={st.id} className={i < p.step ? 'done' : i === p.step ? 'now' : ''} />)}</div>
            <div className="qt-objective">
              <span className="qt-icon"><Rich t={STEP_ICON[step.cond.t] ?? '📍'} /></span>
              <div>
                <b>{step.text}</b>
                <small>{howTo(step)}</small>
              </div>
            </div>
            <div className="qt-chips">
              {live.distance === 0 ? <span className="chip-here"><Icon name="pin" /> 就在這裡</span>
                : live.distance !== null && <span className="chip-dist"><i style={{ transform: `rotate(${(live.bearing ?? 0) * 45}deg)` }}>↑</i>{live.place ?? step.place}・{live.distance} m</span>}
              {live.timer && <span className="chip-timer">{live.timer}</span>}
              {live.distance !== 0 && (nav ? <span className="chip-nav on"><Icon name="compass" /> 導航中</span> : <span className="chip-nav"><kbd>G</kbd> 導航</span>)}
            </div>
            {live.stamina !== null && <div className="qt-stamina" title="體力"><i style={{ width: `${live.stamina * 100}%` }} className={live.note ? 'tired' : ''} /></div>}
            {live.note && <div className="qt-note">{live.note}</div>}
          </>
        ) : (
          <div className="qt-objective"><span className="qt-icon"><Icon name="grad" size={26} /></span><div><b>主線全部完成！</b><small>繼續完成支線和成就，或在校園裡自由探索</small></div></div>
        )}
      </section>
      <footer><kbd>J</kbd> 任務・<kbd>G</kbd> 導航</footer>
    </div>
  );
}

/** 新手教學: the current task with its keys, a checklist of all four, centred low on screen. */
export function TutorialCard(): ReactNode {
  const tut = useStory((s) => s.live.tutorial);
  if (!tut) return null;
  const cur = TUTORIAL[tut.i];
  if (!cur) return null;
  return (
    <div className={`tutorial${tut.done ? ' done' : ''}`} key={tut.i}>
      <div className="tut-head"><b>新手教學</b><span>{tut.i + 1} / {TUTORIAL.length}</span></div>
      <div className="tut-keys">{cur.key.map((k) => <kbd key={k} className={k.length > 1 ? 'wide' : ''}>{k}</kbd>)}</div>
      <p>{tut.done ? '✓ 很好！' : cur.text}</p>
      <ol>{TUTORIAL.map((t, i) => <li key={i} className={i < tut.i || (i === tut.i && tut.done) ? 'ok' : i === tut.i ? 'now' : ''}>{t.key.join(' ')}</li>)}</ol>
    </div>
  );
}

/** 上課中: the course banner with the lesson's progress, and the professor's words as subtitles. */
export function LectureOverlay(): ReactNode {
  const lec = useStory((s) => s.live.lecture);
  const scene = useStory((s) => s.scene);
  if (!lec) return null;
  const line = LECTURE[lec.line]!;
  return (
    <>
      <div className="lecture-banner">
        <span className="lecture-live">● 上課中</span>
        <b>{COURSE}</b><small>MA214・教授講課</small>
        <span className="lecture-bar"><i style={{ width: `${Math.min(100, (lec.t / Math.max(1, lec.total)) * 100)}%` }} /></span>
      </div>
      {!scene && (
        <div className={`lecture-sub${line.who === '同學' ? ' whisper' : ''}`} key={lec.line}>
          <em>{line.who}</em>{line.text}
        </div>
      )}
    </>
  );
}

/** Top-centre countdown (the roll call): label, mm:ss, a shrinking bar that turns red, and where to. */
/** 翹課: while sneaking out of class, how close the professor is to noticing. */
export function SneakMeter(): ReactNode {
  const sneak = useStory((s) => s.live.sneak);
  if (!sneak) return null;
  const pct = Math.round(sneak.risk * 100);
  return (
    <div className={`sneak-meter${pct > 60 ? ' hot' : ''}`}>
      <div className="sneak-title">🤫 偷偷溜出教室・蹲著走到門外</div>
      <div className="sneak-bar"><i style={{ width: `${pct}%` }} /></div>
      <small>被發現風險 {pct}%・走動會增加，停下來比較安全</small>
    </div>
  );
}

export function TopCountdown(): ReactNode {
  const cd = useStory((s) => s.live.countdown);
  const modal = useGame((s) => s.modal);
  if (!cd || modal === 'story') return null;
  const mm = String(Math.floor(cd.left / 60)).padStart(2, '0'), ss = String(cd.left % 60).padStart(2, '0');
  const frac = cd.total ? Math.max(0, Math.min(1, cd.left / cd.total)) : 0;
  const urgent = cd.left <= 30 || frac < 0.2;
  return (
    <div className={`top-cd${urgent ? ' urgent' : ''}`} role="timer" aria-label={`${cd.label} ${cd.left} 秒`}>
      <div className="top-cd-icon"><Icon name="clock" size={26} /></div>
      <div className="top-cd-body">
        <div className="top-cd-label">{cd.label}<small>{cd.where}</small></div>
        <div className="top-cd-time">{mm}<i>:</i>{ss}</div>
        <div className="top-cd-bar"><i style={{ width: `${frac * 100}%` }} /></div>
      </div>
    </div>
  );
}

/** Big 3-2-1 / 開始！ in the middle of the screen before a mini-game (store.countdown; the track
 * time trial's own countdown shows here too). */
export function BigCountdown(): ReactNode {
  const api = useApi();
  const cd = useGame((s) => s.countdown);
  const race = useGame((s) => s.race);
  const raceText = race?.phase === 'countdown' ? String(Math.max(1, Math.ceil(race.countdown))) : null;
  const text = cd?.text ?? raceText;
  const key = cd ? cd.id : raceText;
  useEffect(() => { if (text) api.click(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!text) return null;
  return <div className="big-countdown"><b key={key ?? ''} className={/\d/.test(text) ? '' : 'go'}>{text}</b></div>;
}

/** Achievement unlocked: a gold card under the toast for a few seconds. */
export function AchievementPopup(): ReactNode {
  const queue = useStory((s) => s.unlockQueue);
  const shown = queue[0];
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => storyActions.popUnlock(), 3500);
    return () => window.clearTimeout(t);
  }, [shown, queue.length]);
  const a = ACHIEVEMENTS.find((x) => x.id === shown);
  if (!a) return null;
  return (
    <div className="ach-popup" key={`${shown}-${queue.length}`}>
      <i><Rich t={a.icon} /></i>
      <div><small><Icon name="trophy" /> 成就解鎖</small><b>{a.title}</b><span>{a.desc}</span></div>
    </div>
  );
}

const CONFETTI = ['#f2c230', '#1f8f4a', '#2c6fd6', '#d8553a', '#f48fb1', '#8a5bd6', '#4cc27a'];
/** Side quest done / day over: confetti rain and a card. */
export function Celebration(): ReactNode {
  const c = useStory((s) => s.celebration);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!c || Date.now() - c.at > 3000) return;
    setShown(c.at);
    const t = window.setTimeout(() => setShown(null), 3600);
    return () => window.clearTimeout(t);
  }, [c]);
  const bits = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.6, dur: 1.8 + Math.random() * 1.4,
    color: CONFETTI[i % CONFETTI.length], rot: Math.random() * 360, w: 6 + Math.random() * 6,
  })), [shown]);
  if (!c || shown !== c.at) return null;
  return (
    <div className="celebrate" key={c.at}>
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.color, width: b.w, height: b.w * 1.6, transform: `rotate(${b.rot}deg)` }} />
      ))}
      <div className="celebrate-card">
        <b><Icon name="party" /> {c.title}</b>
        {c.sub && <span>{c.sub}</span>}
      </div>
    </div>
  );
}

/** Stamp card for list-type side quests (tour stops, photo spots, stalls, sports). */
function Stamps({ id, p }: { id: string; p: StoryProgress }): ReactNode {
  const s = p.side[id];
  const list: [string, string][] | null =
    id === 'tour' ? TOUR_STOPS.map((n) => [n, '🚩'])
      : id === 'photo' ? PHOTO_SPOTS.map((n) => [n, '📸'])
        : id === 'foodie' ? [['buffet', '🍛 自助餐'], ['noodles', '🍜 麵食'], ['bento', '🍱 便當'], ['drinks', '🧋 飲料']]
          : id === 'athlete' ? [['volleyball', '🏐 墊球 10 下'], ['soccer', '⚽ PK 進 3 球'], ['track', '🏃 田徑計時賽']] : null;
  if (!s || !list) return null;
  return (
    <div className="stamps">
      {list.map(([k, label]) => (
        <span key={k} className={`stamp${s.done.includes(k) ? ' got' : ''}`}><Rich t={id === 'tour' || id === 'photo' ? `${label} ${k}` : label} /></span>
      ))}
    </div>
  );
}

/** J: main story, side quests and achievements. */
export function QuestLog(): ReactNode {
  const api = useApi();
  const p = useStory((s) => s.progress);
  const [tab, setTab] = useState<'main' | 'side' | 'ach'>('main');
  const got = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
  return (
    <div className="screen" onClick={api.closeModal}>
      <div className="card wide quest-log" onClick={(e) => e.stopPropagation()}>
        <h2>任務與成就</h2>
        <div className="segmented">
          <button className={tab === 'main' ? 'on' : ''} onClick={() => setTab('main')}>主線</button>
          <button className={tab === 'side' ? 'on' : ''} onClick={() => setTab('side')}>支線</button>
          <button className={tab === 'ach' ? 'on' : ''} onClick={() => setTab('ach')}>成就 {got}/{ACHIEVEMENTS.length}</button>
        </div>
        <div className="ql-body">
          {tab === 'main' && DAYS.map((d, di) => (
            <div key={di} className={`ql-day${di + 1 === p.day ? ' now' : ''}`}>
              <h3>Day {di + 1}・{d.title}</h3>
              {(di + 1 < p.day || di + 1 === p.day) && d.steps.map((s, si) => {
                const done = di + 1 < p.day || si < p.step;
                const now = di + 1 === p.day && si === p.step;
                return <div key={s.id} className={`ql-step${done ? ' done' : ''}${now ? ' now' : ''}`}><Rich t={done ? '✓' : now ? '▶' : '・'} /> {s.text}</div>;
              })}
              {di + 1 > p.day && <div className="ql-step locked"><Icon name="lock" /> 尚未開始</div>}
            </div>
          ))}
          {tab === 'side' && SIDE_QUESTS.map((q) => {
            const s = p.side[q.id];
            return (
              <div key={q.id} className={`ql-side ${s?.state ?? 'locked'}`}>
                <b><Rich t={s?.state === 'done' ? '✓ ' : s ? '📌 ' : '🔒 '} />{q.title}</b>
                <span>{s ? (s.state === 'done' ? '已完成' : sideText(q.id, p)) : SIDE_HINTS[q.id] ?? '還沒觸發，到處逛逛看'}</span>
                <Stamps id={q.id} p={p} />
              </div>
            );
          })}
          {tab === 'ach' && (
            <div className="ql-ach">
              {ACHIEVEMENTS.map((a) => {
                const at = p.achievements[a.id];
                return (
                  <div key={a.id} className={`ach${at ? ' got' : ''}`}>
                    <i><Rich t={at || !a.secret ? a.icon : '❔'} /></i>
                    <b>{at || !a.secret ? a.title : '？？？'}</b>
                    <span>{a.unavailable ? `（${a.unavailable}）` : at || !a.secret ? a.desc : '隱藏成就'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn back" onClick={api.closeModal}>關閉</button>
      </div>
    </div>
  );
}

// ---------- Story modal: dialogs and mini-games ----------
export function StoryModal(): ReactNode {
  const scene = useStory((s) => s.scene);
  if (!scene) return null;
  if (scene.kind === 'wardrobe') return <Wardrobe />;
  if (scene.kind === 'vn') return <VisualNovel key={scene.id} id={scene.id} lines={scene.lines} />;
  return (
    <div className="screen story-screen">
      <div className="card story-card">
        {scene.kind === 'dialog' && <Dialog lines={scene.lines} />}
        {scene.kind === 'rollcall' && <RollCall />}
        {scene.kind === 'quiz' && <Quiz />}
        {scene.kind === 'mixer' && <Mixer />}

        {scene.kind === 'clubFair' && <ClubFair />}
        {scene.kind === 'summary' && <Summary />}
        {scene.kind === 'stayAwake' && <StayAwake />}
        {scene.kind === 'lunch' && <Lunch />}
        {scene.kind === 'drums' && <Drums />}
        {scene.kind === 'exam' && <Exam />}
        {scene.kind === 'dance' && <Dance />}
      </div>
    </div>
  );
}

/**
 * Visual-novel scene: the game dimmed behind, a name plate and a text box at the bottom with the
 * line typing itself out; a message line shows on a phone. Click, Space or Enter: finish the
 * line, then the next one. 略過 jumps to the end.
 */
function VisualNovel({ id, lines }: { id: string; lines: VnLine[] }): ReactNode {
  const api = useApi();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const line = lines[i]!;
  const full = shown >= line.text.length;
  useEffect(() => {
    setShown(0);
    const t = window.setInterval(() => setShown((n) => (n >= line.text.length ? n : n + 1)), 38);
    return () => window.clearInterval(t);
  }, [i, line.text.length]);
  const finish = (): void => storyEvents.finishScene({ kind: 'vn', id });
  const next = (): void => {
    if (!full) { setShown(line.text.length); return; }
    api.click();
    if (i + 1 < lines.length) setI(i + 1);
    else finish();
  };
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.repeat || (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter')) return;
      e.preventDefault();
      nextRef.current();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const text = line.text.slice(0, shown);
  return (
    <div className={`vn${line.shake ? ' shake' : ''}`} onClick={next}>
      <div className="vn-shade" />
      {line.buzz && <div className="vn-buzz" key={`b${i}`}><Icon name="phone" size={54} /><span>嗡——</span></div>}
      {line.phone && (
        <div className="vn-phone">
          <div className="vn-phone-bar"><b>{line.who}</b><small>剛剛</small></div>
          <div className="vn-bubble">{text}</div>
        </div>
      )}
      <div className="vn-box">
        {(line.phone ? '手機' : line.who) && <div className={`vn-name${line.who === '你' ? ' me' : ''}`}>{line.phone ? '手機' : line.who}</div>}
        <p className={`vn-text${line.who ? '' : ' narration'}`}>{line.phone ? `「${line.who}」傳來一則訊息。` : text}<span className={`vn-caret${full ? ' done' : ''}`} /></p>
        <div className="vn-hint">{full ? (i + 1 < lines.length ? '點擊或按 Space 繼續 ▼' : '點擊或按 Space 開始 ▶') : ''}</div>
      </div>
      <button className="vn-skip" onClick={(e) => { e.stopPropagation(); api.click(); finish(); }}>略過 ≫</button>
    </div>
  );
}

function Dialog({ lines }: { lines: { who: string; text: string }[] }): ReactNode {
  const api = useApi();
  const [i, setI] = useState(0);
  const next = (): void => {
    api.click();
    if (i + 1 < lines.length) setI(i + 1);
    else storyEvents.finishScene({ kind: 'dialog' });
  };
  useEnterKey(next);
  const line = lines[i]!;
  return (
    <>
      <div className="speaker"><Rich t={line.who} /></div>
      <p className="story-text"><Rich t={line.text} /></p>
      <button className="btn primary" onClick={next}>{i + 1 < lines.length ? '繼續 ▸' : '好'}</button>
    </>
  );
}

function useEnterKey(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); ref.current(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}

/**
 * 點名 (in MA214, seated): the professor reads out student numbers one by one; when it is yours,
 * press Space to raise your hand and answer 「有」 before the 3.5 s window closes. Raising it early
 * (before your number) only earns a glare. The seated character lifts an arm.
 */
const HAND_WINDOW = 3.5;
function RollCall(): ReactNode {
  const api = useApi();
  const me = usePlayerName();
  const list = useMemo(() => {
    const others = new Set<string>();
    while (others.size < 5) { const n = randomName(); if (n !== me) others.add(n); }
    const arr = [...others];
    arr.splice(3, 0, me); // you are fourth
    return arr;
  }, [me]);
  const mine = 3;
  const [idx, setIdx] = useState(-1); // the number being read, -1 = about to start
  const [left, setLeft] = useState(HAND_WINDOW);
  const [done, setDone] = useState<'ok' | 'late' | null>(null);
  const [early, setEarly] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;
  const raise = (): void => {
    if (doneRef.current) return;
    if (idx !== mine) { setEarly(true); window.setTimeout(() => setEarly(false), 900); return; }
    api.click();
    setDone('ok');
    storyActions.setHand(true);
  };
  const raiseRef = useRef(raise);
  raiseRef.current = raise;
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); raiseRef.current(); }
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); storyActions.setHand(false); };
  }, []);
  // Reading the numbers, one every 1.4 s; yours waits for the hand.
  useEffect(() => {
    if (done) return;
    if (idx === mine) {
      setLeft(HAND_WINDOW);
      const t = window.setInterval(() => setLeft((l) => {
        if (l <= 0.1) { window.clearInterval(t); setDone('late'); return 0; }
        return l - 0.1;
      }), 100);
      return () => window.clearInterval(t);
    }
    const t = window.setTimeout(() => setIdx((n) => n + 1), idx < 0 ? 900 : 1400);
    return () => window.clearTimeout(t);
  }, [idx, done, mine]);
  const finish = (ok: boolean): void => storyEvents.finishScene({ kind: 'rollcall', ok });
  const calling = idx >= 0 && idx < list.length ? list[idx] : null;
  return (
    <div className="rollcall">
      <div className="speaker"><Icon name="book" /> 教授・MA214 點名</div>
      <div className="rc-board">
        {list.map((n, i) => (
          <span key={i} className={`rc-no${i === idx ? ' now' : ''}${i < idx ? ' past' : ''}${i === mine ? ' me' : ''}`}>
            <b>{n}</b><small>{i === mine ? '你' : i < idx ? '有' : ''}</small>
          </span>
        ))}
      </div>
      {!done && (
        <p className="story-text">
          {idx < 0 ? '教授翻開點名簿…' : <>教授：「<b className="rc-call">{calling}</b>？」{idx !== mine && i18nOther(idx)}</>}
        </p>
      )}
      {!done && idx === mine && (
        <div className="rc-hand">
          <div className="rc-hand-msg"><Icon name="bolt" /> 輪到你了！按 <kbd>Space</kbd> 舉手說「有」</div>
          <div className="countdown"><i style={{ width: `${(left / HAND_WINDOW) * 100}%` }} /></div>
        </div>
      )}
      {!done && idx !== mine && <div className={`rc-wait${early ? ' early' : ''}`}>{early ? '還沒叫到你！' : '等教授叫到你的名字…'}</div>}
      {done === 'ok' && <IdentityCheck me={me} onDone={finish} />}
      {done === 'late' && (
        <>
          <p className="story-text">教授：「{me} 沒來嗎？……記缺席。」（你忘了舉手）</p>
          <button className="btn primary" onClick={() => finish(false)}>糟了</button>
        </>
      )}
      {!done && <button className="btn" onClick={raise}>舉手（Space）</button>}
    </div>
  );
}
/**
 * 確認身份: after your hand goes up the professor is suspicious and asks three questions about
 * this class (物件導向軟體工程); two right and you are marked present, otherwise it was a stand-in (absent).
 */
function IdentityCheck({ me, onDone }: { me: string; onDone: (ok: boolean) => void }): ReactNode {
  const api = useApi();
  const qs = useMemo(() => {
    // Easy ones about this class and yourself (使用者：簡單一點).
    const pool: { q: string; a: string; wrong: string[] }[] = [
      { q: '這堂課叫什麼名字？', a: COURSE, wrong: ['資料結構', '計算機概論', '會計學'] },
      { q: '這堂課的教授叫什麼名字？', a: `${PROFESSOR}`, wrong: ['王大明', '林志豪', '張雅婷'] },
      { q: '我們現在在哪間教室上課？', a: 'MA214', wrong: ['MA213', 'MA221', 'MB101'] },
      { q: '這間教室在管理一館的幾樓？', a: '2 樓', wrong: ['1 樓', '3 樓', '4 樓'] },
      { q: '你是哪一系的學生？', a: '資訊管理系', wrong: ['企業管理系', '財務金融系', '會計系'] },
      { q: '我們學校的全名是？', a: '國立雲林科技大學', wrong: ['國立成功大學', '國立中正大學', '國立臺灣科技大學'] },
    ];
    return pool
      .map((q) => ({ q, k: Math.random() }))
      .sort((p, q) => p.k - q.k)
      .slice(0, 3)
      .map(({ q }) => ({ q: q.q, a: q.a, options: [q.a, ...q.wrong].map((o) => ({ o, k: Math.random() })).sort((p, q) => p.k - q.k).map(({ o }) => o) }));
  }, []);
  const [stage, setStage] = useState<'doubt' | number | 'pass' | 'fail'>('doubt');
  const [right, setRight] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const answer = (o: string): void => {
    if (typeof stage !== 'number' || picked) return;
    api.click();
    setPicked(o);
    const ok = o === qs[stage]!.a;
    const total = right + (ok ? 1 : 0);
    window.setTimeout(() => {
      setPicked(null);
      setRight(total);
      if (stage + 1 < qs.length) setStage(stage + 1);
      else setStage(total >= 2 ? 'pass' : 'fail');
    }, 900);
  };
  if (stage === 'doubt') {
    return (
      <>
        <p className="story-text">你舉起手：「有！」<br />教授推了推眼鏡：「嗯？你確定你是 <b>{me}</b> 嗎？最近代點名的很多……那我問你幾個簡單的問題。」</p>
        <button className="btn primary" onClick={() => { api.click(); setStage(0); }}>好，請問（答對 2 題就算到）</button>
      </>
    );
  }
  if (stage === 'pass' || stage === 'fail') {
    return (
      <>
        <p className="story-text">
          答對 {right} / {qs.length} 題。<br />
          {stage === 'pass' ? '教授：「好，看來真的是你本人，記你到。」' : `教授：「連這都答不出來？你根本不是 ${me} 吧！代點名，記缺席！」`}
        </p>
        <button className="btn primary" onClick={() => onDone(stage === 'pass')}>{stage === 'pass' ? '放下手' : '糟了…'}</button>
      </>
    );
  }
  const q = qs[stage]!;
  return (
    <>
      <div className="speaker">確認身份・第 {stage + 1}/{qs.length} 題</div>
      <p className="story-text">教授：「{q.q}」</p>
      <div className="quiz-options">
        {q.options.map((o) => (
          <button key={o} className={`btn${picked ? (o === q.a ? ' right' : o === picked ? ' wrong' : '') : ''}`} onClick={() => answer(o)}>{o}</button>
        ))}
      </div>
    </>
  );
}

const i18nOther = (i: number): string => (i % 2 ? '「有。」' : '「到。」');

function Quiz(): ReactNode {
  const api = useApi();
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [cheated, setCheated] = useState(false);
  const [peek, setPeek] = useState<number | null>(null);
  const [caught, setCaught] = useState(false);
  const q = QUIZ[i]!;
  const answer = (k: number): void => {
    api.click();
    const s = score + (k === q.answer ? 1 : 0);
    if (i + 1 < QUIZ.length) { setScore(s); setI(i + 1); setPeek(null); }
    else storyEvents.finishScene({ kind: 'quiz', score: s, cheated, caught });
  };
  const doPeek = (): void => {
    setCheated(true);
    if (Math.random() < 0.5) {
      setCaught(true);
      storyEvents.finishScene({ kind: 'quiz', score: 0, cheated: true, caught: true });
      return;
    }
    setPeek(q.answer);
  };
  return (
    <>
      <div className="speaker">小考 第 {i + 1}/{QUIZ.length} 題</div>
      <p className="story-text">{q.q}</p>
      <div className="quiz-options">
        {q.options.map((o, k) => <button key={k} className={`btn${peek === k ? ' peeked' : ''}`} onClick={() => answer(k)}>{o}</button>)}
      </div>
      <button className="btn link" onClick={doPeek} disabled={peek !== null}><Icon name="eyes" /> 偷看隔壁的答案（可能被抓）</button>
    </>
  );
}

/** Fisher–Yates on a copy (answer order changes every question). */
function shuffled<T>(a: readonly T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

const MIXER_TIME = 9;

/**
 * 聯誼: chat with three people, two questions each. Every answer moves that person's 好感度;
 * silence (the timer runs out) is awkward and costs too. Hearts float up or break, the card glows
 * or shakes. The night is a success for everyone at 60 or more.
 */
function Mixer(): ReactNode {
  const api = useApi();
  const [aff, setAff] = useState<number[]>(() => MIXER.map(() => MIXER_START));
  const [turn, setTurn] = useState(0); // person * 2 + question
  const [reply, setReply] = useState<{ text: string; delta: number } | null>(null);
  const [left, setLeft] = useState(MIXER_TIME);
  const [fx, setFx] = useState(0);
  const total = MIXER.length * 2;
  const pi = Math.floor(turn / 2), m = MIXER[pi], q = m?.qs[turn % 2];
  const options = useMemo(() => (q ? shuffled(q.options) : []), [q]);
  const answer = (delta: number, text: string): void => {
    setAff((a) => a.map((v, i) => (i === pi ? Math.max(0, Math.min(100, v + delta)) : v)));
    setReply({ text, delta });
    setFx((n) => n + 1);
    if (delta >= 0) api.click(); else actions.toast(delta <= -15 ? '💔 好感度大跌！' : '💧 有點尷尬…');
  };
  useEffect(() => {
    if (reply || turn >= total) return;
    setLeft(MIXER_TIME);
    const t = window.setInterval(() => setLeft((l) => {
      if (l <= 0.1) { window.clearInterval(t); answer(-10, '（你沉默太久，氣氛有點冷…）'); return 0; }
      return l - 0.1;
    }), 100);
    return () => window.clearInterval(t);
  }, [turn, reply]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = (): void => {
    api.click();
    setReply(null);
    setTurn((t) => t + 1);
  };
  const bars = (
    <div className="mixer-people">
      {MIXER.map((p, i) => (
        <div key={p.who} className={`mixer-person${i === pi && turn < total ? ' now' : ''}${aff[i]! >= MIXER_GOAL ? ' good' : ''}`}>
          <i><Rich t={p.look} /></i>
          <b>{p.who.split('（')[0]}</b>
          <span className="aff"><em style={{ width: `${aff[i]}%` }} /><s style={{ left: `${MIXER_GOAL}%` }} /></span>
          <small><Icon name="heart" /> {aff[i]}</small>
        </div>
      ))}
    </div>
  );
  if (turn >= total || !m || !q) {
    const won = aff.filter((v) => v >= MIXER_GOAL).length;
    return (
      <div className="mixer">
        <div className="speaker">聯誼結束</div>
        {bars}
        <p className="story-text">{won === MIXER.length ? '大成功！三個人都想跟你交換 IG' : won > 0 ? `和 ${won} 個人聊得不錯，交換了聯絡方式！` : '今晚好像沒什麼火花…下次再加油。'}</p>
        <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'mixer', score: won })}>回宿舍</button>
      </div>
    );
  }
  return (
    <div className={`mixer${reply ? (reply.delta >= 0 ? ' glow' : ' shake') : ''}`} key={fx}>
      <div className="speaker">聯誼・{m.who}　<small>第 {turn + 1}/{total} 題</small></div>
      {bars}
      {reply ? (
        <>
          <div className={`mixer-float ${reply.delta >= 0 ? 'up' : 'down'}`}>{reply.delta >= 0 ? <>+{reply.delta} <Icon name="heart" /></> : <>{reply.delta} <Icon name="heartBreak" /></>}</div>
          <p className="story-text">{m.who.split('（')[0]}：「<Rich t={reply.text} />」</p>
          <button className="btn primary" onClick={next}>{turn + 1 < total ? (turn % 2 === 1 ? '換下一位聊天 ▸' : '繼續聊 ▸') : '看看結果'}</button>
        </>
      ) : (
        <>
          <p className="story-text">「{q.ask}」</p>
          <div className="mixer-timer"><i style={{ width: `${(left / MIXER_TIME) * 100}%` }} /></div>
          <div className="quiz-options">{options.map((o) => <button key={o.text} className="btn" onClick={() => answer(o.delta, o.reply)}>{o.text}</button>)}</div>
        </>
      )}
    </div>
  );
}

const AWAKE_TIME = 25;
const SAFE: [number, number] = [0.38, 0.72];

/**
 * 防睡挑戰: the 精神 marker sinks on its own (faster while yawning); hold Space or the button to
 * push it up. Keep it inside the green zone: outside it for 2.5 s, or at the bottom, you fall
 * asleep and the professor catches you. States: 清醒 → 打哈欠 (random, stronger pull) → 睡著.
 */
function StayAwake(): ReactNode {
  const [v, setV] = useState(0.55);
  const [left, setLeft] = useState(AWAKE_TIME);
  const [drowsy, setDrowsy] = useState(0); // seconds outside the zone
  const [yawn, setYawn] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  const [started, setStarted] = useState(false);
  const hold = useRef(false);
  useEffect(() => { actions.startCountdown(() => setStarted(true)); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      hold.current = e.type === 'keydown';
    };
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', k);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k); };
  }, []);
  useEffect(() => {
    if (!started || done !== null) return;
    let val = 0.55, vel = 0, out = 0, t = AWAKE_TIME, yawnT = 3 + Math.random() * 3, yawning = 0, last = performance.now(), raf = 0;
    const step = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t -= dt;
      yawnT -= dt;
      if (yawnT <= 0) { yawning = 1.6; yawnT = 3.5 + Math.random() * 3; }
      yawning = Math.max(0, yawning - dt);
      const pull = yawning > 0 ? 0.62 : 0.32 + (1 - t / AWAKE_TIME) * 0.22;
      vel += (hold.current ? 0.95 : -pull) * dt;
      if (yawning > 0) vel += (Math.random() - 0.5) * 0.9 * dt;
      vel *= Math.pow(0.35, dt);
      val += vel * dt;
      if (val >= 1) { val = 1; vel = 0; }
      out = val < SAFE[0] || val > SAFE[1] ? out + dt : Math.max(0, out - dt * 1.5);
      setV(val); setLeft(t); setDrowsy(out); setYawn(yawning > 0);
      if (val <= 0 || out >= 2.5) { setDone(false); return; }
      if (t <= 0) { setDone(true); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [started, done]);
  const lid = done === false ? 50 : Math.min(48, (drowsy / 2.5) * 40 + (v < SAFE[0] ? (SAFE[0] - v) * 40 : 0));
  const state = done === false ? '睡著' : yawn ? '打哈欠' : drowsy > 0.3 ? '昏昏欲睡' : '清醒';
  return (
    <div className="awake">
      <div className="awake-lids" style={{ ['--lid' as string]: `${lid}%` }} />
      <div className="speaker">課堂・教授講課中　<small>剩 {Math.max(0, Math.ceil(left))} 秒</small></div>
      {done === null ? (
        <>
          <p className="story-text">「…所以這個 UML 類別圖非常重要，期末一定會考…」{yawn ? <b className="yawn">哈～～欠～</b> : null}</p>
          <div className={`awake-state s-${state}`}>狀態：{state}</div>
          <div className={`awake-bar${yawn ? ' yawning' : ''}`}>
            <span className="zone" style={{ left: `${SAFE[0] * 100}%`, width: `${(SAFE[1] - SAFE[0]) * 100}%` }} />
            <span className="danger lo">睡著</span><span className="danger hi">太亢奮</span>
            <i style={{ left: `${v * 100}%` }} />
          </div>
          <div className="awake-drowsy"><i style={{ width: `${(drowsy / 2.5) * 100}%` }} /></div>
          <button className="btn" onPointerDown={() => { hold.current = true; }} onPointerUp={() => { hold.current = false; }} onPointerLeave={() => { hold.current = false; }}>
            按住提神（或按住 Space）
          </button>
          <small className="awake-hint">把指針維持在綠色安全區：按住往右、放開往左；離開安全區太久或掉到最左邊就會睡著</small>
          <button className="btn link awake-skip" onClick={() => storyEvents.finishScene({ kind: 'sneakOut' })}>🤫 撐不住了…偷偷溜出教室（翹課，可能被郭教授發現）</button>
        </>
      ) : done ? (
        <>
          <p className="story-text">鐘聲響了，撐過一整堂課！</p>
          <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'stayAwake', ok: true })}>下課</button>
        </>
      ) : (
        <>
          <p className="story-text">Zzz…「這位同學！上課睡覺？」（被教授抓包）</p>
          <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'stayAwake', ok: false })}>重新挑戰這堂課</button>
          <button className="btn link awake-skip" onClick={() => storyEvents.finishScene({ kind: 'sneakOut' })}>🤫 不上了，偷偷溜出教室（翹課）</button>
        </>
      )}
    </div>
  );
}

/** 衣櫃: six parts, each worn or taken off on its own; the character on screen is the preview. */
/**
 * 衣櫃: the character on the left (a preview drawn by the game into `.wd-preview`, drag or the
 * arrows to turn it half a turn either way), the parts and clothes on the right. In the story's
 * outfit step you need three things on to go; otherwise the wardrobe just closes.
 */
function Wardrobe(): ReactNode {
  const api = useApi();
  const saved = useStory((s) => s.progress.outfit);
  const outfitStep = useStory((s) => DAYS[s.progress.day - 1]?.steps[s.progress.step]?.cond.t === 'outfit');
  const outfit = saved ?? {};
  const [part, setPart] = useState<(typeof OUTFIT_PARTS)[number]['id']>('hat');
  const [yaw, setYaw] = useState(0);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const worn = OUTFIT_PARTS.filter((p) => outfit[p.id]).length;
  const turn = (v: number): void => {
    const y = Math.max(-WARDROBE_YAW_LIMIT, Math.min(WARDROBE_YAW_LIMIT, v));
    wardrobeView.yaw = y;
    setYaw(y);
  };
  const wear = (id: string | null): void => {
    api.click();
    storyActions.update((p) => {
      const o = { ...(p.outfit ?? {}) };
      if (id) o[part] = id; else delete o[part];
      return { ...p, outfit: o };
    });
  };
  const deg = Math.round((yaw * 180) / Math.PI);
  return (
    <>
      <div
        className="wd-preview"
        onPointerDown={(e) => { drag.current = { x: e.clientX, yaw }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) turn(drag.current.yaw + (e.clientX - drag.current.x) * 0.012); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <div className="wd-preview-bar">
          <button onClick={() => { api.click(); turn(yaw - Math.PI / 4); }} aria-label="向左轉"><svg viewBox="0 0 10 10" width="12" height="12"><path d="M7 1 2 5l5 4z" fill="currentColor" /></svg></button>
          <span>{deg === 0 ? '正面' : `${deg > 0 ? '右' : '左'}轉 ${Math.abs(deg)}°`}・拖曳旋轉</span>
          <button onClick={() => { api.click(); turn(yaw + Math.PI / 4); }} aria-label="向右轉"><svg viewBox="0 0 10 10" width="12" height="12"><path d="M3 1l5 4-5 4z" fill="currentColor" /></svg></button>
        </div>
      </div>
      <div className="wardrobe">
        <h2><Icon name="shirt" /> 衣櫃</h2>
        <div className="wd-parts">
          {OUTFIT_PARTS.map((p) => (
            <button key={p.id} className={`${p.id === part ? 'on' : ''}${outfit[p.id] ? ' worn' : ''}`} onClick={() => { api.click(); setPart(p.id); }}>
              <i><Rich t={p.icon} /></i>{p.label}
            </button>
          ))}
        </div>
        <div className="wd-items">
          <button className={`wd-item${!outfit[part] ? ' on' : ''}`} onClick={() => wear(null)}><span className="sw none"><Icon name="close" size={14} /></span>脫下</button>
          {OUTFIT_ITEMS.filter((it) => it.part === part).map((it) => (
            <button key={it.id} className={`wd-item${outfit[part] === it.id ? ' on' : ''}`} onClick={() => wear(it.id)}>
              <span className="sw" style={{ background: `#${it.color.toString(16).padStart(6, '0')}` }} />{it.name}{it.trend && <em className="wd-trend">潮</em>}
            </button>
          ))}
        </div>
        <p className="wd-note">已穿 {worn}/6 件{outfitStep ? (worn < 3 ? '・至少穿 3 件才夠帥' : '・帥！') : ''}</p>
        {outfitStep
          ? <button className="btn primary" disabled={worn < 3} onClick={() => storyEvents.finishScene({ kind: 'wardrobe' })}>完成造型，出門！</button>
          : <button className="btn primary" onClick={() => { api.click(); storyEvents.finishScene({ kind: 'wardrobe' }); }}>穿好了，關上衣櫃</button>}
      </div>
    </>
  );
}

function ClubFair(): ReactNode {
  const [i, setI] = useState(0);
  return (
    <>
      <div className="speaker">社團博覽會 {i + 1}/{CLUBS.length}</div>
      <p className="story-text"><Rich t={CLUBS[i]!} /></p>
      <button className="btn primary" onClick={() => (i + 1 < CLUBS.length ? setI(i + 1) : storyEvents.finishScene({ kind: 'clubFair' }))}>
        {i + 1 < CLUBS.length ? '下一攤 ▸' : '逛完了'}
      </button>
    </>
  );
}

function Summary(): ReactNode {
  const p = useStory((s) => s.progress);
  const coins = useGame((s) => s.coins);
  const got = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
  const f = p.flags;
  const remark = (f.badRecord ?? 0) > 0 ? '有幾次小小的「不良紀錄」，下週要乖一點喔。'
    : (f.absent ?? 0) > 0 ? '偶爾缺課，下週記得準時。' : '模範新生！老師對你印象很好。';
  return (
    <>
      <div className="speaker"><Icon name="grad" /> 第一週回顧</div>
      <div className="summary-grid">
        <span>點名</span><b>{p.rollcalls.ok}/{p.rollcalls.total}</b>
        <span>翹課</span><b>{f.skipped ?? 0} 次</b>
        <span>小考</span><b>{f.quizScore !== undefined ? `${f.caught ? 0 : f.quizScore} 分` : '—'}</b>
        <span>路跑</span><b>{f.runTime ? `${Math.floor(f.runTime / 60)} 分 ${f.runTime % 60} 秒` : '未完賽'}</b>
        <span>成就</span><b>{got}/{ACHIEVEMENTS.length}</b>
        <span>零用錢</span><b>NT$ {coins}</b>
      </div>
      <p className="story-text">{remark}</p>
      <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'summary' })}>開始自由探索</button>
    </>
  );
}

/** Admin (管理員模式): story switches, jump, complete, reset, achievements. */
export function StoryAdmin({ onJump, onComplete, onReset }: { onJump: (day: number, step: number) => void; onComplete: () => void; onReset: () => void }): ReactNode {
  const p = useStory((s) => s.progress);
  const [day, setDay] = useState(Math.min(p.day, DAYS.length));
  const [step, setStep] = useState(0);
  const steps = DAYS[day - 1]?.steps ?? [];
  return (
    <div className="story-admin">
      <div className="setting">
        <span>跳到</span>
        <span className="admin-row">
          <select value={day} onChange={(e) => { setDay(Number(e.currentTarget.value)); setStep(0); }}>
            {DAYS.map((_, i) => <option key={i} value={i + 1}>Day {i + 1}</option>)}
          </select>
          <select value={step} onChange={(e) => setStep(Number(e.currentTarget.value))}>
            {steps.map((s, i) => <option key={s.id} value={i}>{s.id} {s.text.slice(0, 10)}</option>)}
          </select>
          <button className="btn small" onClick={() => onJump(day, step)}>跳</button>
        </span>
        <span />
      </div>
      <div className="admin-row">
        <span className="admin-label">時間</span>
        {[['清晨', 6 * 60], ['中午', 12 * 60], ['黃昏', 17 * 60 + 50], ['晚上', 20 * 60], ['深夜', 23 * 60 + 30]].map(([l, m]) => (
          <button key={l} className="btn small" onClick={() => dispatch({ type: 'setClock', minuteOfDay: m as number })}>{l}</button>
        ))}
      </div>
      <div className="admin-row">
        <button className="btn small" onClick={onComplete}>完成目前步驟</button>
        <button className="btn small" onClick={onReset}>重設劇情</button>
      </div>
      <div className="admin-ach">
        {ACHIEVEMENTS.map((a) => (
          <button key={a.id} className={`chip${p.achievements[a.id] ? ' on' : ''}`} title="點一下解鎖 / 重設"
            onClick={() => storyActions.update((q) => {
              const achievements = { ...q.achievements };
              if (achievements[a.id]) delete achievements[a.id]; else achievements[a.id] = Date.now();
              return { ...q, achievements };
            })}>
            <Rich t={a.icon} /> {a.title}
          </button>
        ))}
      </div>
    </div>
  );
}
