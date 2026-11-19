import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGame } from '../state/store';
import { storyActions, useStory, type StoryProgress } from '../state/story';
import { ACHIEVEMENTS, CLUBS, DAYS, MIXER, QUIZ, SIDE_QUESTS, PHOTO_SPOTS, TOUR_STOPS } from '../story/storyData';
import { storyEvents } from '../story/storyRuntime';
import { dispatch } from '../state/commands';
import { useApi } from './api';

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
/** Hints for side quests not started yet. */
const SIDE_HINTS: Record<string, string> = {
  lostFound: '走在人行道上，留意地上發亮的東西',
  bikeReturn: '到腳踏車站騎一台腳踏車看看',
  tour: '從大學路的校門口開始',
  photo: '用手機相機（P → 相機）拍一張照片',
  athlete: '先到籃球場玩一次投籃挑戰',
  foodie: '到學生餐廳的攤位買點東西',
};

function sideText(id: string, p: StoryProgress): string {
  const q = SIDE_QUESTS.find((s) => s.id === id)!;
  const s = p.side[id]!;
  const list = id === 'tour' ? TOUR_STOPS : id === 'photo' ? PHOTO_SPOTS : null;
  const next = list?.find((x) => !s.done.includes(x)) ?? '';
  return q.text.replace('{n}', String(s.done.length)).replace('{total}', String(q.total)).replace('{target}', s.target ?? next);
}

/** HUD top-left: today's objective, distance and direction; one active side quest underneath. */
export function QuestTracker(): ReactNode {
  const enabled = useStory((s) => s.enabled);
  const p = useStory((s) => s.progress);
  const live = useStory((s) => s.live);
  if (!enabled) return null;
  const day = DAYS[p.day - 1];
  const step = day?.steps[p.step];
  const sideId = Object.keys(p.side).find((k) => p.side[k]!.state === 'active');
  return (
    <div className="quest-tracker">
      {day && step ? (
        <>
          <div className="qt-head"><b>Day {p.day}</b>・{day.title}<span className="qt-step">{p.step + 1}/{day.steps.length}</span></div>
          <div className="qt-goal">{step.text}</div>
          <div className="qt-meta">
            {live.distance === 0 ? <span className="qt-here">📍 就在這裡</span>
              : live.distance !== null && <span>{ARROWS[live.bearing ?? 0]} {live.distance} m・{live.place ?? step.place}</span>}
            {live.timer && <span className="qt-timer">{live.timer}</span>}
          </div>
          {live.stamina !== null && (
            <div className="qt-stamina" title="體力"><i style={{ width: `${live.stamina * 100}%` }} className={live.note ? 'tired' : ''} /></div>
          )}
          {live.note && <div className="qt-note">{live.note}</div>}
        </>
      ) : (
        <div className="qt-head"><b>🎓 第一週完成</b>・自由探索</div>
      )}
      {sideId && <div className="qt-side">📌 {SIDE_QUESTS.find((q) => q.id === sideId)?.title}：{sideText(sideId, p)}</div>}
      <div className="qt-keys"><kbd>J</kbd> 任務・<kbd>G</kbd> 導航</div>
    </div>
  );
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
      <i>{a.icon}</i>
      <div><small>🏆 成就解鎖</small><b>{a.title}</b><span>{a.desc}</span></div>
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
        <b>🎉 {c.title}</b>
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
        <span key={k} className={`stamp${s.done.includes(k) ? ' got' : ''}`}>{id === 'tour' || id === 'photo' ? `${label} ${k}` : label}</span>
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
                return <div key={s.id} className={`ql-step${done ? ' done' : ''}${now ? ' now' : ''}`}>{done ? '✓' : now ? '▶' : '・'} {s.text}</div>;
              })}
              {di + 1 > p.day && <div className="ql-step locked">🔒 尚未開始</div>}
            </div>
          ))}
          {tab === 'side' && SIDE_QUESTS.map((q) => {
            const s = p.side[q.id];
            return (
              <div key={q.id} className={`ql-side ${s?.state ?? 'locked'}`}>
                <b>{s?.state === 'done' ? '✓ ' : s ? '📌 ' : '🔒 '}{q.title}</b>
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
                    <i>{at || !a.secret ? a.icon : '❔'}</i>
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
  return (
    <div className="screen story-screen">
      <div className="card story-card">
        {scene.kind === 'dialog' && <Dialog lines={scene.lines} />}
        {scene.kind === 'rollcall' && <RollCall advanced={scene.advanced} sudden={scene.sudden} />}
        {scene.kind === 'quiz' && <Quiz />}
        {scene.kind === 'mixer' && <Mixer />}
        {scene.kind === 'wake' && <Wake />}
        {scene.kind === 'clubFair' && <ClubFair />}
        {scene.kind === 'summary' && <Summary />}
      </div>
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
      <div className="speaker">{line.who}</div>
      <p className="story-text">{line.text}</p>
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
 * 點名: the teacher calls numbers; on your turn type your student number's last three digits
 * (basic) or the code flashed on the board (advanced) within the time limit. One retry.
 */
function RollCall({ advanced, sudden }: { advanced: boolean; sudden: boolean }): ReactNode {
  const api = useApi();
  const studentNo = useStory((s) => s.progress.studentNo);
  const others = useMemo(() => Array.from({ length: 3 }, () => String(100 + Math.floor(Math.random() * 900))), []);
  const [phase, setPhase] = useState<'calling' | 'flash' | 'answer' | 'result'>('calling');
  const [called, setCalled] = useState(0);
  const [code, setCode] = useState(() => String(1000 + Math.floor(Math.random() * 9000)));
  const [value, setValue] = useState('');
  const LIMIT = 8;
  const [left, setLeft] = useState(LIMIT);
  const [tries, setTries] = useState(0);
  const [ok, setOk] = useState(false);
  const want = advanced ? code : studentNo;

  useEffect(() => {
    if (phase !== 'calling') return;
    if (called >= others.length) { setPhase(advanced ? 'flash' : 'answer'); return; }
    const t = window.setTimeout(() => setCalled((c) => c + 1), 700);
    return () => window.clearTimeout(t);
  }, [phase, called, others.length, advanced]);
  useEffect(() => {
    if (phase !== 'flash') return;
    const t = window.setTimeout(() => setPhase('answer'), 1600);
    return () => window.clearTimeout(t);
  }, [phase]);
  const submit = (): void => {
    const good = value.trim() === want;
    if (good || tries >= 1) { setOk(good); setPhase('result'); api.click(); return; }
    setTries(1);
    setValue('');
    if (advanced) { setCode(String(1000 + Math.floor(Math.random() * 9000))); setPhase('flash'); }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (phase !== 'answer') return;
    let l = LIMIT;
    setLeft(l);
    const t = window.setInterval(() => {
      l -= 1;
      setLeft(l);
      if (l <= 0) { window.clearInterval(t); submitRef.current(); } // time is up
    }, 1000);
    return () => window.clearInterval(t);
  }, [phase, tries]);

  return (
    <>
      <div className="speaker">老師{sudden ? '（突然點名）' : ''}</div>
      {phase === 'calling' && <p className="story-text">點名囉！{others.slice(0, called).map((n) => `「末三碼 ${n}」「有！」`).join(' ')}</p>}
      {phase === 'flash' && <p className="story-text">今天改用隨堂驗證碼，記住黑板上的數字：<b className="flash-code">{code}</b></p>}
      {phase === 'answer' && (
        <>
          <p className="story-text">{advanced ? '輸入剛剛黑板上的驗證碼' : '輪到你了！輸入你的學號末三碼（學生證上有）'}{tries ? '（最後一次機會）' : ''}</p>
          <form className="rollcall-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input className="text-input big" value={value} onChange={(e) => setValue(e.currentTarget.value.replace(/\D/g, ''))} maxLength={advanced ? 4 : 3} autoFocus inputMode="numeric" />
            <button className="btn primary" type="submit">喊「有」</button>
          </form>
          <div className="countdown"><i style={{ width: `${(left / LIMIT) * 100}%` }} /></div>
        </>
      )}
      {phase === 'result' && (
        <>
          <p className="story-text">{ok ? '老師：好，有到。' : `老師：${want} 沒來嗎？記缺席。`}</p>
          <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'rollcall', ok })}>好</button>
        </>
      )}
    </>
  );
}

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
      <button className="btn link" onClick={doPeek} disabled={peek !== null}>👀 偷看隔壁的答案（可能被抓）</button>
    </>
  );
}

function Mixer(): ReactNode {
  const api = useApi();
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [reply, setReply] = useState<string | null>(null);
  const m = MIXER[i]!;
  const choose = (k: number): void => {
    api.click();
    const good = k === m.best;
    setScore((s) => s + (good ? 1 : 0));
    setReply(good ? `${m.who.split('（')[0]}：「哈哈，聊得來！」` : `${m.who.split('（')[0]}：「喔…這樣啊。」`);
  };
  const next = (): void => {
    setReply(null);
    if (i + 1 < MIXER.length) setI(i + 1);
    else storyEvents.finishScene({ kind: 'mixer', score });
  };
  return (
    <>
      <div className="speaker">聯誼・{m.who}</div>
      {reply ? (
        <>
          <p className="story-text">{reply}</p>
          <button className="btn primary" onClick={next}>{i + 1 < MIXER.length ? '換下一位聊天 ▸' : '聯誼結束'}</button>
        </>
      ) : (
        <>
          <p className="story-text">「{m.ask}」</p>
          <div className="quiz-options">{m.options.map((o, k) => <button key={k} className="btn" onClick={() => choose(k)}>{o}</button>)}</div>
        </>
      )}
    </>
  );
}

/** 週會: the drowsiness bar creeps up; tap Space to stay awake for 20 seconds. */
function Wake(): ReactNode {
  const [sleepy, setSleepy] = useState(0.2);
  const [left, setLeft] = useState(20);
  const [done, setDone] = useState<boolean | null>(null);
  const sleepyRef = useRef(sleepy);
  sleepyRef.current = sleepy;
  useEffect(() => {
    if (done !== null) return;
    const t = window.setInterval(() => {
      setSleepy((s) => Math.min(1, s + 0.035));
      setLeft((l) => l - 0.1);
    }, 100);
    return () => window.clearInterval(t);
  }, [done]);
  useEffect(() => {
    if (done !== null) return;
    if (sleepy >= 1) setDone(false);
    else if (left <= 0) setDone(true);
  }, [sleepy, left, done]);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.code === 'Space') { e.preventDefault(); setSleepy((s) => Math.max(0, s - 0.08)); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <>
      <div className="speaker">週會・校長致詞</div>
      {done === null ? (
        <>
          <p className="story-text">「各位同學，大學生活就是…（好想睡…）」連按 <kbd>Space</kbd> 保持清醒！剩 {Math.ceil(left)} 秒</p>
          <div className="sleepy"><i style={{ width: `${sleepy * 100}%` }} /></div>
          <button className="btn" onClick={() => setSleepy((s) => Math.max(0, s - 0.08))}>捏自己一下（或按 Space）</button>
        </>
      ) : (
        <>
          <p className="story-text">{done ? '撐到週會結束了！' : 'Zzz…（被旁邊的同學推醒）'}</p>
          <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'wake', ok: done })}>離開會場</button>
        </>
      )}
    </>
  );
}

function ClubFair(): ReactNode {
  const [i, setI] = useState(0);
  return (
    <>
      <div className="speaker">社團博覽會 {i + 1}/{CLUBS.length}</div>
      <p className="story-text">{CLUBS[i]}</p>
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
      <div className="speaker">🎓 第一週回顧</div>
      <div className="summary-grid">
        <span>點名</span><b>{p.rollcalls.ok}/{p.rollcalls.total}</b>
        <span>翹課</span><b>{f.skipped ?? 0} 次</b>
        <span>小考</span><b>{f.quizScore !== undefined ? `${f.caught ? 0 : f.quizScore * 20} 分` : '—'}</b>
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
            {a.icon} {a.title}
          </button>
        ))}
      </div>
    </div>
  );
}
