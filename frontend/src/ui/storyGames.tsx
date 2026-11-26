import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EXAM, EXAM_POINTS, PROFESSOR, ROOMMATE, ROOMMATE2, LUNCH_EACH } from '../story/storyData';
import { storyEvents } from '../story/storyRuntime';
import { useApi } from './api';
import { FX, successFx } from './fx';

/**
 * Story mini-games shown in the story modal:
 *  - 學餐猜拳 (Day 1 lunch): you and the two roommates; rounds until one loser is left, who treats.
 *    Lose and you may appeal once: one more round against the roommate who beat you.
 *  - 熱音社打鼓 (Day 4): listen to a pattern on four drums, then play it back with the same pads
 *    and rhythm (D F J K). Each level is longer and faster; three lives.
 *  - MB109 小考 (Day 5): ten questions; tap left / right Shift to peek at a neighbour's paper while
 *    the professor walks the rows — peek while he is looking your way and you are caught.
 *  - 熱舞社 (MB mirror): type the arrow sequence, then Space on the fourth beat.
 */

// ---------- Sound (Web Audio, made on the first click) ----------
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
function noise(c: AudioContext, secs: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}
/** 0 snare, 1 tom, 2 floor tom (kick-ish), 3 cymbal, 4 tick. */
function drum(k: number): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const out = c.createGain();
  out.connect(c.destination);
  if (k === 3 || k === 4) {
    const n = noise(c, k === 3 ? 1.2 : 0.06);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = k === 3 ? 5000 : 8000;
    n.connect(hp).connect(out);
    out.gain.setValueAtTime(k === 3 ? 0.35 : 0.15, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + (k === 3 ? 1.1 : 0.05));
    n.start(t);
    return;
  }
  const o = c.createOscillator();
  o.type = 'sine';
  const f0 = k === 0 ? 220 : k === 1 ? 160 : 90;
  o.frequency.setValueAtTime(f0 * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
  o.connect(out);
  out.gain.setValueAtTime(0.6, t);
  out.gain.exponentialRampToValueAtTime(0.001, t + (k === 2 ? 0.45 : 0.25));
  o.start(t);
  o.stop(t + 0.5);
  if (k === 0) {
    const n = noise(c, 0.2);
    const g = c.createGain();
    n.connect(g).connect(c.destination);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.start(t);
  }
}

/** Keyboard listener bound to the latest handler. */
function useKeys(fn: (e: KeyboardEvent) => void, up?: (e: KeyboardEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  const upRef = useRef(up);
  upRef.current = up;
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (!e.repeat) ref.current(e); };
    const u = (e: KeyboardEvent): void => { upRef.current?.(e); };
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', u);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', u); };
  }, []);
}

// ---------- 學餐猜拳 ----------
type Hand = 0 | 1 | 2;
const HAND = ['✊', '✌️', '🖐'] as const;
const HAND_NAME = ['石頭', '剪刀', '布'] as const;
const beats = (a: Hand, b: Hand): boolean => (a === 0 && b === 1) || (a === 1 && b === 2) || (a === 2 && b === 0);
type Who = 'me' | 'kai' | 'fat';
const WHO_NAME: Record<Who, string> = { me: '你', kai: ROOMMATE, fat: ROOMMATE2 };
const randHand = (): Hand => Math.floor(Math.random() * 3) as Hand;

export function Lunch(): ReactNode {
  const api = useApi();
  const [phase, setPhase] = useState<'intro' | 'pick' | 'reveal' | 'appealAsk' | 'appeal' | 'appealReveal' | 'done'>('intro');
  const [alive, setAlive] = useState<Who[]>(['me', 'kai', 'fat']);
  const [throws, setThrows] = useState<Partial<Record<Who, Hand>>>({});
  const [msg, setMsg] = useState('');
  const [payer, setPayer] = useState<Who | null>(null);
  const [rival, setRival] = useState<Who>('kai');
  const [appealWon, setAppealWon] = useState(false);
  const [round, setRound] = useState(1);

  /** Throws for everyone still in; the round's outcome. */
  const play = (mine: Hand | null): void => {
    const t: Partial<Record<Who, Hand>> = {};
    for (const w of alive) t[w] = w === 'me' && mine !== null ? mine : randHand();
    setThrows(t);
    setPhase('reveal');
    const hands = new Set(alive.map((w) => t[w]!));
    window.setTimeout(() => {
      if (hands.size !== 2) { setMsg(hands.size === 1 ? '大家出一樣的，平手！再來' : '三種都有，平手！再來'); setRound((r) => r + 1); setPhase('pick'); return; }
      const [a, b] = [...hands] as Hand[];
      const win = beats(a!, b!) ? a! : b!;
      const safe = alive.filter((w) => t[w] === win);
      const left = alive.filter((w) => t[w] !== win);
      setMsg(`${safe.map((w) => WHO_NAME[w]).join('、')} 出${HAND_NAME[win]}贏了，安全！`);
      if (safe.includes('me')) successFx('安全！', { color: FX.score });
      setRound((r) => r + 1);
      if (left.length === 1) {
        const p = left[0]!;
        setPayer(p);
        setRival(safe.includes('kai') ? 'kai' : 'fat');
        setAlive(left);
        setPhase(p === 'me' ? 'appealAsk' : 'done');
        api.click();
        return;
      }
      setAlive(left);
      setPhase('pick');
    }, 1500);
  };
  // You are already safe: the other two play on by themselves.
  useEffect(() => {
    if (phase === 'pick' && !alive.includes('me')) {
      const t = window.setTimeout(() => play(null), 900);
      return () => window.clearTimeout(t);
    }
    return undefined;
  });
  const appeal = (mine: Hand): void => {
    const other = randHand();
    setThrows({ me: mine, [rival]: other });
    setPhase('appealReveal');
    window.setTimeout(() => {
      if (mine === other) { setMsg('平手！上訴庭要求再猜一次'); setPhase('appeal'); return; }
      const won = beats(mine, other);
      setAppealWon(won);
      if (won) successFx('上訴成功！', { color: FX.goal, big: true });
      setPayer(won ? rival : 'me');
      setMsg(won ? `上訴成功！改判 ${WHO_NAME[rival]} 請客 ⚖️` : '上訴駁回……還是你請 😭');
      setPhase('done');
    }, 1500);
  };
  const pick = (h: Hand): void => {
    api.click();
    if (phase === 'pick' && alive.includes('me')) play(h);
    else if (phase === 'appeal') appeal(h);
  };
  useKeys((e) => {
    const k = e.code === 'Digit1' ? 0 : e.code === 'Digit2' ? 1 : e.code === 'Digit3' ? 2 : -1;
    if (k >= 0) pick(k as Hand);
  });
  const shown: Who[] = phase === 'appeal' || phase === 'appealReveal' ? ['me', rival] : ['me', 'kai', 'fat'];
  return (
    <div className="rps">
      <div className="speaker">🍱 學生餐廳・猜拳輸的人請客{phase !== 'intro' && phase !== 'done' ? `　第 ${round} 輪` : ''}</div>
      {phase === 'intro' ? (
        <>
          <p className="story-text">{ROOMMATE}：「位子佔好了！老規矩，猜拳輸的人請客，三個人一人 NT$ {LUNCH_EACH}。」<br />{ROOMMATE2}：「輸了可以上訴一次喔，公平吧？」</p>
          <button className="btn primary" onClick={() => { api.click(); setPhase('pick'); }}>剪刀、石頭——</button>
        </>
      ) : (
        <>
          <div className="rps-table">
            {shown.map((w) => (
              <div key={w} className={`rps-seat${w === 'me' ? ' me' : ''}${alive.includes(w) || phase === 'appeal' || phase === 'appealReveal' ? '' : ' safe'}${payer === w && phase === 'done' ? ' payer' : ''}`}>
                <b>{WHO_NAME[w]}</b>
                <span className={`rps-hand${phase === 'reveal' || phase === 'appealReveal' ? ' show' : ''}`}>
                  {(phase === 'reveal' || phase === 'appealReveal') && throws[w] !== undefined ? HAND[throws[w]!] : (alive.includes(w) || phase === 'appeal') ? '❔' : '😌'}
                </span>
                <small>{payer === w && phase === 'done' ? '請客！' : alive.includes(w) || phase === 'appeal' || phase === 'appealReveal' ? '' : '安全'}</small>
              </div>
            ))}
          </div>
          <p className="story-text rps-msg">{phase === 'reveal' || phase === 'appealReveal' ? '布——！' : msg || '出拳！'}</p>
          {(phase === 'pick' && alive.includes('me')) || phase === 'appeal' ? (
            <div className="rps-picks">
              {([0, 1, 2] as Hand[]).map((h) => (
                <button key={h} className="btn rps-pick" onClick={() => pick(h)}><span>{HAND[h]}</span>{HAND_NAME[h]}<kbd>{h + 1}</kbd></button>
              ))}
            </div>
          ) : null}
          {phase === 'pick' && !alive.includes('me') && <p className="rps-note">你已經安全了，看他們兩個猜…</p>}
          {phase === 'appealAsk' && (
            <>
              <p className="story-text">你輸了……要請大家吃午餐（NT$ {LUNCH_EACH * 3}）。</p>
              <div className="rps-picks">
                <button className="btn primary" onClick={() => { api.click(); setMsg(`上訴！和 ${WHO_NAME[rival]} 單挑一局，贏了就改判他請`); setPhase('appeal'); }}>⚖️ 上訴！（再猜一局）</button>
                <button className="btn" onClick={() => { api.click(); setPhase('done'); }}>認了，我請</button>
              </div>
            </>
          )}
          {phase === 'done' && payer && (
            <>
              <p className="story-text">{payer === 'me' ? `結果：你請客，付 NT$ ${LUNCH_EACH * 3}。` : `結果：${WHO_NAME[payer]} 請客！你這餐免費 🎉`}</p>
              <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'lunch', payer, appealWon })}>開動！</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- 熱音社打鼓 ----------
const PADS = [
  { name: '小鼓', key: 'KeyD', label: 'D', color: '#e53935' },
  { name: '中鼓', key: 'KeyF', label: 'F', color: '#fb8c00' },
  { name: '落地鼓', key: 'KeyJ', label: 'J', color: '#1e88e5' },
  { name: '銅鈸', key: 'KeyK', label: 'K', color: '#fdd835' },
];
const DRUM_LEVELS = 6;
interface Note { pad: number; t: number }
function makePattern(level: number): { notes: Note[]; unit: number; len: number } {
  const count = 3 + level;
  const pads = Math.min(4, 1 + level);
  const bpm = 80 + level * 12;
  const unit = 60 / bpm / 2; // eighth note (s)
  const notes: Note[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    let pad = Math.floor(Math.random() * pads);
    if (i > 0 && pad === notes[i - 1]!.pad && Math.random() < 0.5) pad = (pad + 1) % pads;
    notes.push({ pad, t });
    const gaps = level < 2 ? [2] : level < 4 ? [1, 2, 2] : [1, 1, 2, 3];
    t += gaps[Math.floor(Math.random() * gaps.length)]!;
  }
  return { notes, unit, len: notes[notes.length - 1]!.t + 1 };
}

export function Drums(): ReactNode {
  const api = useApi();
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [pat, setPat] = useState(() => makePattern(1));
  const [phase, setPhase] = useState<'ready' | 'demo' | 'play' | 'pass' | 'fail' | 'over'>('ready');
  const [lit, setLit] = useState<number | null>(null);
  const [head, setHead] = useState(-1); // demo playhead (eighths)
  const [hits, setHits] = useState<{ pad: number; t: number; ok: boolean }[]>([]);
  const [why, setWhy] = useState('');
  const t0 = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  const cleared = level - 1;
  const clear = (): void => { for (const t of timers.current) window.clearTimeout(t); timers.current = []; };
  useEffect(() => clear, []);
  const flash = (pad: number): void => {
    setLit(pad);
    timers.current.push(window.setTimeout(() => setLit((l) => (l === pad ? null : l)), 140));
  };
  const tol = 0.17 - level * 0.014;
  const demo = (): void => {
    api.click();
    clear();
    setHits([]);
    setPhase('demo');
    const start = 0.6;
    for (let k = 0; k < 4; k++) timers.current.push(window.setTimeout(() => drum(4), (start - 0.6 + k * 0.15) * 1000)); // count-in ticks
    for (const n of pat.notes) {
      timers.current.push(window.setTimeout(() => { drum(n.pad); flash(n.pad); setHead(n.t); }, (start + n.t * pat.unit) * 1000));
    }
    timers.current.push(window.setTimeout(() => { setHead(-1); t0.current = null; setPhase('play'); }, (start + pat.len * pat.unit + 0.3) * 1000));
  };
  const fail = (reason: string): void => {
    clear();
    setWhy(reason);
    const l = lives - 1;
    setLives(l);
    setPhase(l <= 0 ? 'over' : 'fail');
  };
  // Silence for too long after the last hit (or never starting) ends the attempt.
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const i = hits.length;
    const n = pat.notes[i];
    if (!n) return undefined;
    const wait = t0.current === null ? 6000 : (t0.current + n.t * pat.unit + tol + 0.6) * 1000 - performance.now();
    const t = window.setTimeout(() => fail(t0.current === null ? '太久沒開始打' : '節奏斷掉了'), Math.max(200, wait));
    return () => window.clearTimeout(t);
  });
  const hit = (pad: number): void => {
    drum(pad);
    flash(pad);
    if (phase !== 'play') return;
    const now = performance.now() / 1000;
    const i = hits.length;
    const n = pat.notes[i]!;
    if (t0.current === null) t0.current = now - n.t * pat.unit;
    const dt = now - (t0.current + n.t * pat.unit);
    const ok = pad === n.pad && Math.abs(dt) <= tol;
    const list = [...hits, { pad, t: (now - t0.current) / pat.unit, ok }];
    setHits(list);
    if (!ok) { fail(pad !== n.pad ? `第 ${i + 1} 下打錯鼓了（應該是${PADS[n.pad]!.name}）` : dt < 0 ? `第 ${i + 1} 下太快了` : `第 ${i + 1} 下太慢了`); return; }
    if (list.length === pat.notes.length) {
      clear();
      if (level >= DRUM_LEVELS) { setLevel(level + 1); setPhase('over'); setWhy('全部過關！'); successFx('全部過關！', { color: FX.goal, big: true }); }
      else { setPhase('pass'); successFx(`第 ${level} 關過關！`, { color: FX.score }); }
    }
  };
  useKeys((e) => {
    const k = PADS.findIndex((p) => p.key === e.code);
    if (k >= 0) { e.preventDefault(); hit(k); }
  });
  const next = (): void => {
    const l = level + 1;
    setLevel(l);
    setPat(makePattern(l));
    setHits([]);
    setPhase('ready');
  };
  const done = phase === 'over';
  return (
    <div className="drums">
      <div className="speaker">🥁 熱音社・打鼓挑戰　第 {Math.min(level, DRUM_LEVELS)}/{DRUM_LEVELS} 關　{'❤️'.repeat(Math.max(0, lives))}{'🤍'.repeat(3 - Math.max(0, lives))}</div>
      <p className="story-text">
        {phase === 'ready' ? '社長：「我先打一段，你仔細聽節奏和位置，然後照著打一次！」'
          : phase === 'demo' ? '🎧 仔細聽……'
          : phase === 'play' ? `換你了！照著節奏打（${hits.length}/${pat.notes.length}）`
          : phase === 'pass' ? '社長：「不錯喔！下一段會更快、更長。」'
          : phase === 'fail' ? `${why}……再聽一次！`
          : level > DRUM_LEVELS ? '社長：「全部過關！你就是我們缺的鼓手！」' : `${why}。社長：「過了 ${cleared} 關，有潛力！」`}
      </p>
      <div className="drum-sheet" style={{ ['--cols' as string]: pat.len }}>
        {PADS.map((p, r) => (
          <div key={r} className="drum-lane">
            <span className="drum-lane-name" style={{ color: p.color }}>{p.label}</span>
            <div className="drum-lane-track">
              {pat.notes.filter((n) => n.pad === r).map((n, i) => (
                <i key={i} className={`drum-note${head === n.t ? ' now' : ''}`} style={{ left: `${(n.t / pat.len) * 100}%`, background: p.color }} />
              ))}
              {hits.filter((h) => h.pad === r).map((h, i) => (
                <b key={`h${i}`} className={`drum-hit${h.ok ? ' ok' : ' bad'}`} style={{ left: `${Math.max(0, Math.min(1, h.t / pat.len)) * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="drum-pads">
        {PADS.map((p, k) => (
          <button key={k} className={`drum-pad${lit === k ? ' lit' : ''}`} style={{ ['--pad' as string]: p.color }} onPointerDown={() => hit(k)}>
            <span>{p.name}</span><kbd>{p.label}</kbd>
          </button>
        ))}
      </div>
      {phase === 'ready' && <button className="btn primary" onClick={demo}>▶ 聽題目</button>}
      {phase === 'fail' && <button className="btn primary" onClick={demo}>▶ 再聽一次</button>}
      {phase === 'pass' && <button className="btn primary" onClick={() => { api.click(); next(); }}>下一關 ▸</button>}
      {done && <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'drums', level: Math.min(DRUM_LEVELS, cleared) })}>謝謝社長</button>}
      <small className="awake-hint">用 D F J K（或點鼓）打擊；先聽一遍，再用一樣的節奏、一樣的鼓打回去。越後面越快、越長。</small>
    </div>
  );
}

// ---------- MB109 小考 ----------
const EXAM_TIME = 180;
const GLANCE = 0.9;

export function Exam(): ReactNode {
  const api = useApi();
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [cheated, setCheated] = useState(false);
  const [caught, setCaught] = useState(false);
  const [left, setLeft] = useState(EXAM_TIME);
  const [prof, setProf] = useState({ p: 0.1, face: 1, watching: false });
  const [glance, setGlance] = useState<{ side: -1 | 1; until: number } | null>(null);
  const [ended, setEnded] = useState(false);
  // What the neighbours wrote: the left one is a top student, the right one guesses a lot.
  const neighbours = useMemo(() => EXAM.map((q) => {
    const wrong = (): number => { let k; do k = Math.floor(Math.random() * q.options.length); while (k === q.answer); return k; };
    return { l: Math.random() < 0.85 ? q.answer : wrong(), r: Math.random() < 0.45 ? q.answer : wrong() };
  }), []);
  const st = useRef({ p: 0.1, v: 0.12, face: 1, pause: 0, turn: 3 + Math.random() * 3, glance: null as { side: -1 | 1; until: number } | null, over: false });
  useEffect(() => {
    let raf = 0, last = performance.now(), t = EXAM_TIME;
    const step = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = st.current;
      if (s.over) return;
      t -= dt;
      // The professor walks the front, stops now and then, and sometimes turns round to look.
      s.turn -= dt;
      if (s.pause > 0) s.pause -= dt;
      else {
        s.p += s.v * s.face * dt;
        if (s.p > 0.95 || s.p < 0.05) { s.face = -s.face; s.p = Math.max(0.05, Math.min(0.95, s.p)); }
        if (Math.random() < dt * 0.25) s.pause = 1 + Math.random() * 2;
      }
      if (s.turn <= 0) { s.face = -s.face; s.turn = 2.5 + Math.random() * 4; }
      const toMe = Math.sign(0.5 - s.p) || 1;
      const watching = Math.abs(s.p - 0.5) < 0.12 || (s.face === toMe && Math.abs(s.p - 0.5) < 0.42 && s.pause <= 0) || (s.pause > 0 && Math.abs(s.p - 0.5) < 0.3);
      setProf({ p: s.p, face: s.face, watching });
      setLeft(t);
      if (s.glance && now / 1000 > s.glance.until) { s.glance = null; setGlance(null); }
      if (s.glance && watching) { s.over = true; setCaught(true); setEnded(true); return; }
      if (t <= 0) { s.over = true; setEnded(true); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const peek = (side: -1 | 1): void => {
    if (ended || st.current.over) return;
    const g = { side, until: performance.now() / 1000 + GLANCE };
    st.current.glance = g;
    setGlance(g);
    setCheated(true);
  };
  useKeys((e) => {
    if (e.code === 'ShiftLeft') { e.preventDefault(); peek(-1); }
    if (e.code === 'ShiftRight') { e.preventDefault(); peek(1); }
    const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (k >= 0) answer(k);
  });
  const q = EXAM[i];
  const answer = (k: number): void => {
    if (ended || !q) return;
    api.click();
    const s = score + (k === q.answer ? EXAM_POINTS[q.level] : 0);
    setScore(s);
    if (i + 1 < EXAM.length) { setI(i + 1); st.current.glance = null; setGlance(null); }
    else { st.current.over = true; setEnded(true); if (!caught && s >= 60) successFx(s >= 90 ? `${s} 分！太強了` : `${s} 分 及格！`, { color: FX.goal, big: s >= 90 }); }
  };
  const nb = neighbours[i];
  const lvl = q ? ({ easy: '簡單', mid: '適中', hard: '困難' } as const)[q.level] : '';
  if (ended) {
    return (
      <div className="exam">
        <div className="speaker">📝 MB109 小考・{caught ? '被抓到了' : '交卷'}</div>
        <p className="story-text">
          {caught ? `${PROFESSOR}教授：「你在看哪裡？考卷收過來，下課到辦公室找我。」` : left <= 0 ? '時間到！教授收走了考卷。' : '寫完了，交卷！'}
          {!caught && <><br />（成績會在交卷後公布）</>}
        </p>
        <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'quiz', score: caught ? 0 : score, cheated, caught })}>{caught ? '完了…' : '交卷'}</button>
      </div>
    );
  }
  if (!q || !nb) return null;
  return (
    <div className="exam">
      <div className="speaker">📝 MB109 小考　第 {i + 1}/{EXAM.length} 題（{lvl}・{EXAM_POINTS[q.level]} 分）<small>剩 {Math.ceil(left)} 秒</small></div>
      <div className="exam-room">
        <div className="exam-front">
          <span className={`exam-prof${prof.watching ? ' watching' : ''}`} style={{ left: `${prof.p * 100}%` }}>
            <i>{prof.face > 0 ? '▶' : '◀'}</i>👨‍🏫{prof.watching && <em>👀</em>}
          </span>
        </div>
        <div className="exam-desks">
          <span className={`exam-desk${glance?.side === -1 ? ' look' : ''}`}>左邊同學<small>（學霸）</small></span>
          <span className="exam-desk me">你</span>
          <span className={`exam-desk${glance?.side === 1 ? ' look' : ''}`}>右邊同學<small>（常常用猜的）</small></span>
        </div>
        <div className={`exam-alert${prof.watching ? ' on' : ''}`}>{prof.watching ? '⚠️ 教授在看這邊！' : '教授沒在看你'}</div>
      </div>
      <p className="story-text">{q.q}</p>
      <div className="quiz-options">
        {q.options.map((o, k) => {
          const peekL = glance?.side === -1 && nb.l === k, peekR = glance?.side === 1 && nb.r === k;
          return (
            <button key={k} className={`btn${peekL || peekR ? ' peeked' : ''}`} onClick={() => answer(k)}>
              <kbd>{k + 1}</kbd> {o}{peekL ? '　👈 左邊選這個' : ''}{peekR ? '　👉 右邊選這個' : ''}
            </button>
          );
        })}
      </div>
      <div className="exam-peek">
        <button className="btn link" onClick={() => peek(-1)}>👈 偷看左邊（左 Shift）</button>
        <button className="btn link" onClick={() => peek(1)}>偷看右邊（右 Shift）👉</button>
      </div>
    </div>
  );
}

// ---------- 熱舞社 ----------
const ARROWS = [
  { code: 'ArrowUp', ch: '↑' },
  { code: 'ArrowDown', ch: '↓' },
  { code: 'ArrowLeft', ch: '←' },
  { code: 'ArrowRight', ch: '→' },
];
const DANCE_ROUNDS = 10;
const MARK = 0.8;

export function Dance(): ReactNode {
  const api = useApi();
  const [round, setRound] = useState(-1); // -1 = before the start
  const [seq, setSeq] = useState<number[]>([]);
  const [typed, setTyped] = useState(0);
  const [shake, setShake] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [judge, setJudge] = useState<{ text: string; cls: string } | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [perfect, setPerfect] = useState(0);
  const [over, setOver] = useState(false);
  const live = useRef({ start: 0, measure: 2, hit: false, typed: 0, seq: [] as number[], combo: 0, beat: -1 });
  const begin = (r: number): void => {
    const n = Math.min(10, 3 + Math.floor(r * 0.75));
    const s = Array.from({ length: n }, () => Math.floor(Math.random() * 4));
    const bpm = 92 + r * 6;
    live.current = { ...live.current, start: performance.now() / 1000, measure: (4 * 60) / bpm * 2, hit: false, typed: 0, seq: s, beat: -1 };
    setSeq(s);
    setTyped(0);
    setRound(r);
  };
  useEffect(() => {
    if (round < 0 || over) return undefined;
    let raf = 0;
    const step = (): void => {
      const L = live.current;
      const t = performance.now() / 1000 - L.start;
      const u = t / L.measure;
      const beat = Math.floor(u * 8);
      if (beat !== L.beat) { L.beat = beat; if (beat < 8) drum(beat % 2 === 0 ? 4 : 4); }
      setCursor(Math.min(1, u));
      if (u >= 1) {
        if (!L.hit) { setJudge({ text: 'MISS', cls: 'miss' }); L.combo = 0; setCombo(0); }
        if (round + 1 >= DANCE_ROUNDS) { setOver(true); return; }
        begin(round + 1);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [round, over]);
  useKeys((e) => {
    if (round < 0 || over) return;
    const L = live.current;
    const a = ARROWS.findIndex((x) => x.code === e.code);
    if (a >= 0) {
      e.preventDefault();
      if (L.hit || L.typed >= L.seq.length) return;
      if (L.seq[L.typed] === a) { L.typed++; setTyped(L.typed); }
      else { L.typed = 0; setTyped(0); setShake((s) => s + 1); }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (L.hit) return;
      L.hit = true;
      const t = performance.now() / 1000 - L.start;
      const off = Math.abs(t - MARK * L.measure);
      const ready = L.typed >= L.seq.length;
      if (ready && off <= 0.08) {
        L.combo++;
        setScore((s) => s + Math.round(100 * L.seq.length / 4 * (1 + L.combo * 0.1)));
        setPerfect((p) => p + 1);
        setJudge({ text: 'PERFECT', cls: 'perfect' });
        successFx('PERFECT', { color: FX.perfect });
        drum(3);
      } else if (ready && off <= 0.18) {
        L.combo++;
        setScore((s) => s + Math.round(60 * L.seq.length / 4 * (1 + L.combo * 0.1)));
        setJudge({ text: 'GREAT', cls: 'great' });
        successFx('GREAT', { color: FX.score, calm: true });
        drum(0);
      } else {
        L.combo = 0;
        setJudge({ text: ready ? 'MISS（時機不對）' : 'MISS（方向鍵沒打完）', cls: 'miss' });
      }
      setCombo(L.combo);
    }
  });
  if (round < 0) {
    return (
      <div className="dance">
        <div className="speaker">💃 熱舞社・鏡子前的方向鍵舞</div>
        <p className="story-text">社員：「來跳一首！畫面上出現方向鍵就照著按，按完後在節拍跑到<b>黃色標記</b>時按 Space。按錯方向會從頭來喔！」</p>
        <button className="btn primary" onClick={() => { api.click(); audio(); begin(0); }}>開始跳舞 ▶</button>
      </div>
    );
  }
  if (over) {
    return (
      <div className="dance">
        <div className="speaker">💃 熱舞社・結算</div>
        <p className="story-text">分數 <b>{score}</b>　全對 Perfect {perfect}/{DANCE_ROUNDS} 輪<br />{score >= 2000 ? '社員：「跳得超好！要不要直接入社？」' : '社員：「多練幾次就會了，鏡子隨時都在！」'}</p>
        <button className="btn primary" onClick={() => storyEvents.finishScene({ kind: 'dance', score, perfect })}>謝謝</button>
      </div>
    );
  }
  return (
    <div className="dance">
      <div className="speaker">💃 第 {round + 1}/{DANCE_ROUNDS} 段　分數 {score}　{combo > 1 ? `${combo} COMBO` : ''}</div>
      <div key={shake} className={`dance-seq${shake ? ' shake' : ''}`}>
        {seq.map((a, k) => <span key={k} className={k < typed ? 'done' : ''}>{ARROWS[a]!.ch}</span>)}
      </div>
      <div className="dance-bar">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((b) => <i key={b} className="tick" style={{ left: `${(b / 8) * 100}%` }} />)}
        <i className="mark" style={{ left: `${MARK * 100}%` }} />
        <i className="cursor" style={{ left: `${cursor * 100}%` }} />
      </div>
      <div className={`dance-judge ${judge?.cls ?? ''}`} key={`${round}-${judge?.text ?? ''}`}>{judge?.text ?? ''}</div>
      <small className="awake-hint">方向鍵照著按（按錯會重來），再在游標碰到黃色標記時按 Space。</small>
    </div>
  );
}
