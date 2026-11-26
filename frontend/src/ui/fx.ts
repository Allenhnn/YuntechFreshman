/**
 * Success effect for every mini-game (使用者：得分、進球、達成目的都要有成功特效): a colour flash from
 * the edges, a big word that pops, confetti bursting from the centre, a short screen shake and a
 * buzz on phones. Plain DOM in a fixed layer above everything, so the 3D games and the React games
 * call the same function.
 */
export interface FxOptions {
  /** Flash and text colour. */
  color?: string;
  /** Bigger text, more confetti, a harder shake (goals, wins, records). */
  big?: boolean;
  /** Skip the shake (small, frequent successes). */
  calm?: boolean;
}

export const FX = {
  score: '#2ecc71',
  goal: '#ffc21a',
  perfect: '#ff4fa3',
  boost: '#29b6f6',
} as const;

const CONFETTI = ['#ff4fa3', '#ffc21a', '#2ecc71', '#29b6f6', '#ff7a1a', '#b388ff', '#ffffff'];
let layer: HTMLDivElement | null = null;
let shakeTimer = 0;
let lastAt = 0;

function getLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'fx-layer';
  document.body.appendChild(layer);
  return layer;
}

export function successFx(text = '', opts: FxOptions = {}): void {
  if (typeof document === 'undefined') return;
  const now = performance.now();
  const color = opts.color ?? FX.score;
  const big = !!opts.big;
  const root = getLayer();
  const burst = document.createElement('div');
  burst.className = `fx-burst${big ? ' big' : ''}`;
  burst.style.setProperty('--fx', color);
  // Edge flash.
  const flash = document.createElement('div');
  flash.className = 'fx-flash';
  burst.appendChild(flash);
  // The word.
  if (text) {
    const word = document.createElement('div');
    word.className = 'fx-word';
    word.textContent = text;
    burst.appendChild(word);
  }
  // Confetti (fewer when effects come thick and fast).
  const n = now - lastAt < 300 ? 8 : big ? 46 : 22;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const a = Math.random() * Math.PI * 2, r = (big ? 260 : 170) * (0.45 + Math.random() * 0.75);
    p.style.setProperty('--dx', `${Math.cos(a) * r}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * r - 60}px`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.background = CONFETTI[i % CONFETTI.length]!;
    p.style.animationDelay = `${Math.random() * 60}ms`;
    burst.appendChild(p);
  }
  root.appendChild(burst);
  window.setTimeout(() => burst.remove(), big ? 1500 : 1100);
  lastAt = now;
  // Shake the whole page (the 3D view and the UI with it).
  if (!opts.calm) {
    const body = document.body;
    body.classList.remove('fx-shake', 'fx-shake-big');
    void body.offsetWidth; // restart the animation
    body.classList.add(big ? 'fx-shake-big' : 'fx-shake');
    window.clearTimeout(shakeTimer);
    shakeTimer = window.setTimeout(() => body.classList.remove('fx-shake', 'fx-shake-big'), big ? 520 : 360);
  }
  try { navigator.vibrate?.(big ? [40, 40, 70] : 30); } catch { /* not supported */ }
}
