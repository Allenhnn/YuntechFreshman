import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import { actions, gameStore, type SportHud } from '../state/store';
import { TN, type Courts, type Hoop, type TennisCourt, type VolleyCourt } from './sportsCourts';
import { createStreetball } from './streetball';

/**
 * Ball games, all third person:
 *  - 籃球 3v3 鬥牛 (streetball.ts): a tutorial, then you and two teammates against three; K passes /
 *    steals, J shoots (hold to charge) / blocks.
 *  - 排球墊球比賽: the ball comes over the net, a ring marks where it will come down; be there and
 *    press Space as it drops. The ball comes faster the longer the rally lasts. Against 阿凱's score.
 *  - 足球射門大賽 (60 s): run to the ball, aim with the mouse, hold Space for power
 *    and shoot past the keeper; the ball reappears somewhere else. You run faster as time goes on.
 *    Against 阿凱's goals.
 *  - 網球對打 (網球場): 阿凱 serves from across the net; a ring marks where the ball bounces. Get to
 *    it and press Space as it comes by (after one bounce, or on the volley); the camera's direction
 *    sends it back left or right. Wide shots are hard for 阿凱 but may go out. First to 5 points.
 */
export interface Pitch {
  /** Pitch frame: a along the long axis (goal at a = +halfLength), b across. */
  toWorld(a: number, b: number): [number, number];
  toLocal(x: number, z: number): [number, number];
  halfLength: number;
}

export interface SportsGames {
  /** Prompt for starting a game here, or null. */
  prompt(x: number, y: number, z: number): string | null;
  /** Starts the game offered here; returns where to put the player (and facing), or null. */
  start(x: number, y: number, z: number): { x: number; z: number; facing: number } | null;
  readonly active: boolean;
  /** The player must stand still. */
  readonly frozen: boolean;
  /** The game is played in first person. */
  readonly firstPerson: boolean;
  /** Movement speed multiplier (the soccer game speeds you up over time). */
  readonly speedFactor: number;
  cancel(): void;
  /** Per frame; returns coins earned. `viewYaw` / `viewPitch` are the camera's (view = −dir). */
  update(dt: number, time: number, px: number, py: number, pz: number, viewYaw: number, viewPitch?: number): number;
  dispose(): void;
}

/** Told when a ball game ends (story quests, achievements). */
export const sportFinished = new Set<(kind: 'basketball' | 'volleyball' | 'soccer' | 'tennis', score: number) => void>();

const G = 9.8;
const BALL_R = 0.12;
/** Drawn ball sizes (bigger than real so they read at game scale); physics keeps BALL_R. */
const BASKET_DRAW = 0.2, VOLLEY_DRAW = 0.18, SOCCER_DRAW = 0.21, TENNIS_DRAW = 0.11;
/** Tennis: points to win, ball bounce (vertical restitution, horizontal keep). */
const TENNIS_WIN = 5, BOUNCE_Y = 0.68, BOUNCE_H = 0.82;
const RIVAL = '阿凱';
const BEST_KEY = 'yfm.sportBest.v1';
const TITLES = { basketball: '🏀 3v3 鬥牛', volleyball: '🏐 排球墊球比賽', soccer: '⚽ 射門大賽', tennis: '🎾 網球對打' } as const;
type Kind = keyof typeof TITLES;

function loadBest(): Record<Kind, number> {
  try {
    return { basketball: 0, volleyball: 0, soccer: 0, tennis: 0, ...(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Partial<Record<Kind, number>>) };
  } catch {
    return { basketball: 0, volleyball: 0, soccer: 0, tennis: 0 };
  }
}
function saveBest(b: Record<Kind, number>): void {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* private mode */ }
}

/** Triangle wave 0 → 1 → 0 over `period` seconds of holding. */
const swing = (t: number, period: number): number => {
  const u = (t / period) % 2;
  return u < 1 ? u : 2 - u;
};

export function createSportsGames(scene: Scene, tracker: ResourceTracker, courts: Courts, pitch: Pitch | null): SportsGames {
  const best = loadBest();
  // --- Balls ----------------------------------------------------------------------------------
  const ballTex = (paint: (g: CanvasRenderingContext2D) => void): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    if (g) paint(g);
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  const basketTex = ballTex((g) => {
    g.fillStyle = '#e06a1f'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4;
    for (const x of [64, 128, 192]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
  });
  const volleyTex = ballTex((g) => {
    const cols = ['#f5f3ea', '#f2c21b', '#2d5fb5'];
    for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 3]!; g.fillRect(0, i * 22, 256, 22); }
  });
  const soccerTex = ballTex((g) => {
    g.fillStyle = '#f5f5f2'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1b1b1b';
    for (let i = 0; i < 10; i++) { g.beginPath(); g.arc((i * 53) % 256, 20 + ((i * 37) % 90), 11, 0, Math.PI * 2); g.fill(); }
  });
  const sphere = tracker.geometry(new SphereGeometry(1, 20, 14));
  const makeBall = (tex: CanvasTexture, r: number): Mesh => {
    const m = new Mesh(sphere, tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6 })));
    m.scale.setScalar(r);
    m.castShadow = true;
    m.visible = false;
    scene.add(m);
    return m;
  };
  const bballs = [0, 1, 2].map(() => makeBall(basketTex, BASKET_DRAW));
  const vball = makeBall(volleyTex, VOLLEY_DRAW);
  const sball = makeBall(soccerTex, SOCCER_DRAW);
  const tennisTex = ballTex((g) => {
    g.fillStyle = '#d7e83a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#f7f7ee'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(0, 30); g.bezierCurveTo(64, 30, 64, 98, 128, 98); g.bezierCurveTo(192, 98, 192, 30, 256, 30); g.stroke();
  });
  const tball = makeBall(tennisTex, TENNIS_DRAW);
  const streetball = createStreetball(scene, tracker, bballs[0]!, BASKET_DRAW);
  // Landing ring for volleyball.
  const ring = new Mesh(tracker.geometry(new RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2)), tracker.material(new MeshBasicMaterial({ color: 0xffd31a, transparent: true, opacity: 0.85 })));
  ring.visible = false;
  scene.add(ring);
  // Penalty aim marker and keeper.
  const aim = new Mesh(tracker.geometry(new RingGeometry(0.22, 0.32, 24)), tracker.material(new MeshBasicMaterial({ color: 0xff3b30, side: 2 })));
  aim.visible = false;
  scene.add(aim);
  const keeper = new Group();
  const kit = tracker.material(new MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.6 }));
  const skin = tracker.material(new MeshStandardMaterial({ color: 0xf1d2b0, roughness: 0.7 }));
  const dark = tracker.material(new MeshStandardMaterial({ color: 0x222428, roughness: 0.7 }));
  const kb = new Mesh(tracker.geometry(new BoxGeometry(0.45, 0.7, 0.28)), kit); kb.position.y = 1.15;
  const kh = new Mesh(tracker.geometry(new SphereGeometry(0.16, 12, 10)), skin); kh.position.y = 1.65;
  const kl = new Mesh(tracker.geometry(new BoxGeometry(0.4, 0.8, 0.24)), dark); kl.position.y = 0.4;
  const ka = new Mesh(tracker.geometry(new BoxGeometry(1.5, 0.14, 0.14)), kit); ka.position.y = 1.4;
  const kg = new Mesh(tracker.geometry(new CylinderGeometry(0.08, 0.08, 0.14, 8)), tracker.material(new MeshStandardMaterial({ color: 0x3fbf5a })));
  kg.position.set(0.8, 1.4, 0);
  keeper.add(kb, kh, kl, ka, kg);
  for (const m of [kb, kh, kl, ka]) m.castShadow = true;
  keeper.visible = false;
  scene.add(keeper);
  const opp = new Group();
  {
    const shirt = tracker.material(new MeshStandardMaterial({ color: 0x2b78c9, roughness: 0.6 }));
    const racketMat = tracker.material(new MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.4 }));
    const ob = new Mesh(tracker.geometry(new BoxGeometry(0.45, 0.7, 0.28)), shirt); ob.position.y = 1.15;
    const oh = new Mesh(tracker.geometry(new SphereGeometry(0.16, 12, 10)), skin); oh.position.y = 1.65;
    const ol = new Mesh(tracker.geometry(new BoxGeometry(0.4, 0.8, 0.24)), dark); ol.position.y = 0.4;
    const oa = new Mesh(tracker.geometry(new BoxGeometry(0.12, 0.12, 0.55)), skin); oa.position.set(0.3, 1.25, 0.2);
    const head = new Mesh(tracker.geometry(new TorusGeometry(0.16, 0.025, 6, 16)), racketMat); head.position.set(0.3, 1.3, 0.72); head.rotation.x = Math.PI / 2;
    const handle = new Mesh(tracker.geometry(new CylinderGeometry(0.02, 0.02, 0.3, 6).rotateX(Math.PI / 2)), dark); handle.position.set(0.3, 1.27, 0.45);
    opp.add(ob, oh, ol, oa, head, handle);
    for (const m of [ob, oh, ol, oa]) m.castShadow = true;
  }
  opp.visible = false;
  scene.add(opp);

  // --- State -------------------------------------------------------------------------------------
  let kind: Kind | null = null;
  let score = 0;
  let rival = 0;
  let elapsed = 0;
  let message = '';
  let messageUntil = 0;
  let charging: number | null = null; // time Space went down
  let spacePressed = false, spaceReleased = false;
  let nowT = 0;
  const onKey = (e: KeyboardEvent): void => {
    if (!kind || e.code !== 'Space' || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (gameStore.getState().modal !== 'none') return;
    e.preventDefault();
    if (e.type === 'keydown') spacePressed = true;
    else spaceReleased = true;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const say = (m: string, secs = 1.6): void => { message = m; messageUntil = nowT + secs; };

  // Volleyball.
  let court: VolleyCourt | null = null;
  const vp = new Vector3(), vv = new Vector3();
  let vIncoming = false; // true: coming to the player; false: going away
  let vTarget = new Vector3();
  let vWait = 0;
  // Soccer.
  let kick: { p: Vector3; v: Vector3; t: number; T: number; b: number; h: number; keeperB: number; keeperGo: number; done: boolean } | null = null;
  let kickPause = 0;
  let keeperB = 0;
  let soccerTime = 0;
  // Tennis: the court; ball position / velocity; who hit it last (+1 阿凱 → you, −1 you → 阿凱);
  // bounces since that hit; 阿凱 will return it (decided when it lands on his side) after `tReturn`.
  let tcourt: TennisCourt | null = null;
  const tp = new Vector3(), tv = new Vector3();
  let tDir = 1, tBounces = 0, tPause = 0, tRally = 0, tServeSide = 1, tReturn = -1, tWillMiss = false, tLive = false;
  const oppAt = { a: 11.5, b: 0 };

  const hud = (charge: number | null = null, sweet: [number, number] | null = null): void => {
    if (!kind) { actions.setSport(null); return; }
    if (kind === 'basketball') {
      const s = streetball.hud();
      actions.setSport({ title: TITLES.basketball, score: s.you, info: s.info, best: best.basketball, charge: s.charge, sweet: s.charge !== null ? s.sweet : null, message: s.message, hint: s.hint, vs: { name: '紅隊', you: String(s.you), them: String(s.them) }, fp: false });
      return;
    }
    const info = kind === 'soccer' ? `剩餘 ${Math.ceil(soccerTime)} 秒・跑速 ×${(1 + Math.min(1.2, elapsed / 50)).toFixed(1)}`
      : kind === 'tennis' ? `先拿 ${TENNIS_WIN} 分獲勝・來回 ${tRally} 拍` : `連續墊球・球速 ×${(1.7 / volleyT()).toFixed(1)}`;
    const h: SportHud = {
      title: TITLES[kind], score, info, best: best[kind], charge, sweet,
      message: nowT < messageUntil ? message : '',
      hint: kind === 'volleyball' ? '跑到黃色圈圈，球落下時按 Space · Q 結束'
        : kind === 'tennis' ? '跑到黃色圈圈，球彈起來經過身邊時按 Space 揮拍；鏡頭朝哪邊就往哪邊回球 · Q 結束'
        : '跑到球旁邊，滑鼠瞄準，按住 Space 蓄力射門 · Q 結束',
      vs: { name: RIVAL, you: String(score), them: String(rival) },
      fp: false,
    };
    actions.setSport(h);
  };

  const finish = (): number => {
    if (!kind) return 0;
    const k = kind;
    const coins = k === 'basketball' ? score + (score > rival ? 30 : 0) : k === 'volleyball' ? score * 2 : k === 'tennis' ? score * 4 + (score > rival ? 20 : 0) : score * 10;
    const record = score > best[k];
    if (record) { best[k] = score; saveBest(best); }
    for (const fn of sportFinished) fn(k, score);
    const who = k === 'basketball' ? '紅隊' : RIVAL;
    const vs = score > rival ? `　🏆 贏了${who}（${score}:${rival}）` : score === rival ? `　🤝 和${who}平手` : `　😣 輸給${who}（${score}:${rival}）`;
    actions.toast(`${TITLES[k]} 結束：${k === 'soccer' ? `進 ${score} 球` : `${score} 分`}${record ? '（新紀錄！）' : ''}${vs}　+NT$ ${coins}`);
    cleanup();
    return coins;
  };
  const cleanup = (): void => {
    if (kind === 'basketball') streetball.stop();
    kind = null;
    vball.visible = sball.visible = ring.visible = aim.visible = keeper.visible = tball.visible = opp.visible = false;
    tcourt = null;
    kick = null;
    charging = null;
    actions.setSport(null);
  };

  // --- Helpers -------------------------------------------------------------------------------------
  const nearestHoop = (x: number, z: number): Hoop | null => {
    let bestH: Hoop | null = null, d = 7;
    for (const h of courts.hoops) {
      const dd = Math.hypot(h.x + h.nx * 3 - x, h.z + h.nz * 3 - z);
      if (dd < d) { d = dd; bestH = h; }
    }
    return bestH;
  };
  const volleyAt = (x: number, z: number): VolleyCourt | null => {
    for (const c of courts.volley) {
      const a = (x - c.x) * c.ux + (z - c.z) * c.uz, b = (x - c.x) * c.vx + (z - c.z) * c.vz;
      if (Math.abs(a) < 11 && Math.abs(b) < 6.5) return c;
    }
    return null;
  };
  const spot = pitch ? pitch.toWorld(pitch.halfLength - 11, 0) : null;
  const atSpot = (x: number, z: number): boolean => !!spot && Math.hypot(spot[0] - x, spot[1] - z) < 4;
  const cw = (c: VolleyCourt, a: number, b: number, y: number, out: Vector3): Vector3 => out.set(c.x + c.ux * a + c.vx * b, y, c.z + c.uz * a + c.vz * b);
  /** Launch from p to land at q (height qy) in T seconds. */
  const launch = (p: Vector3, q: Vector3, T: number, out: Vector3): Vector3 => out.set((q.x - p.x) / T, (q.y - p.y + 0.5 * G * T * T) / T, (q.z - p.z) / T);

  const tennisAt = (x: number, z: number): TennisCourt | null => {
    for (const c of courts.tennis) {
      const a = (x - c.x) * c.ux + (z - c.z) * c.uz, b = (x - c.x) * c.vx + (z - c.z) * c.vz;
      if (Math.abs(a) < 16.5 && Math.abs(b) < 8) return c;
    }
    return null;
  };
  /** Court frame of a world point: a along the court (you at −a), b across. */
  const tLocal = (c: TennisCourt, x: number, z: number): [number, number] => [(x - c.x) * c.ux + (z - c.z) * c.uz, (x - c.x) * c.vx + (z - c.z) * c.vz];
  /** Flight time of a tennis shot: quicker as the rally and the match go on. */
  const tennisT = (): number => Math.max(0.78, 1.25 - tRally * 0.03 - (score + rival) * 0.015);
  /** 阿凱 hits from where the ball is to a spot on your side. */
  const tennisHitToPlayer = (serve: boolean): void => {
    const c = tcourt!;
    const hl = TN.L / 2, sw = TN.SW / 2;
    // Mostly in, now and then long or wide (your point).
    const out = !serve && Math.random() < 0.08;
    const a = serve ? -(1.8 + Math.random() * (TN.service - 2.6)) : out ? -(hl + 0.6 + Math.random()) : -(4 + Math.random() * (hl - 5));
    const b = serve ? tServeSide * (0.8 + Math.random() * (sw - 1.6)) : (Math.random() - 0.5) * 2 * (sw - 0.5) * (out && Math.random() < 0.5 ? 1.4 : 1);
    const q = cw(c, a, b, TENNIS_DRAW, new Vector3());
    if (serve) tp.copy(cw(c, hl + 0.3, -tServeSide * 2, 2.5, new Vector3()));
    else tp.y = Math.max(tp.y, 1.0);
    launch(tp, q, tennisT() * (serve ? 1.1 : 1), tv);
    tDir = 1;
    tBounces = 0;
    tLive = true;
    ring.position.set(q.x, 0.06, q.z);
    ring.visible = true;
  };
  const tennisPoint = (you: boolean, why: string): void => {
    if (you) score++;
    else rival++;
    say(`${why}　${score} : ${rival}`, 1.5);
    tLive = false;
    ring.visible = false;
    tPause = 1.6;
    tRally = 0;
    tReturn = -1;
    tServeSide = -tServeSide;
  };

  /** Flight time of the volleyball: shorter (faster) the longer the game has run. */
  const volleyT = (): number => Math.max(0.72, 1.7 - elapsed * 0.028);
  const serveToPlayer = (from: Vector3): void => {
    const c = court!;
    const reach = Math.min(1, score / 25);
    vTarget = cw(c, -(2 + Math.random() * (5 + reach)), (Math.random() - 0.5) * (5 + reach * 2.5), BALL_R, new Vector3());
    vp.copy(from);
    launch(vp, vTarget, volleyT(), vv);
    vIncoming = true;
    ring.position.set(vTarget.x, 0.06, vTarget.z);
    ring.visible = true;
  };

  return {
    get active() { return kind !== null; },
    get frozen() { return false; },
    get firstPerson() { return false; },
    get speedFactor() { return kind === 'soccer' ? 1 + Math.min(1.2, elapsed / 50) : kind === 'tennis' ? 1.3 : 1; },
    prompt(x, y, z) {
      if (kind || y > 1) return null;
      if (nearestHoop(x, z)) return '按 E 開始 3v3 鬥牛';
      if (volleyAt(x, z)) return '按 E 開始排球墊球';
      if (tennisAt(x, z)) return '按 E 和阿凱網球對打';
      if (atSpot(x, z)) return '按 E 開始射門大賽（60 秒）';
      return null;
    },
    start(x, _y, z) {
      if (kind) return null;
      spacePressed = spaceReleased = false;
      charging = null;
      score = 0;
      elapsed = 0;
      message = '';
      const h = nearestHoop(x, z);
      if (h) {
        kind = 'basketball';
        rival = 0;
        return streetball.start(h);
      }
      const c = volleyAt(x, z);
      if (c) {
        kind = 'volleyball';
        court = c;
        rival = 9 + Math.floor(Math.random() * 9);
        vWait = 0;
        vball.visible = true;
        serveToPlayer(cw(c, 6, 0, 2.6, new Vector3()));
        say('準備接球！', 1.2);
        const p = cw(c, -5, 0, 0, new Vector3());
        return { x: p.x, z: p.z, facing: Math.atan2(c.ux, c.uz) };
      }
      const tc = tennisAt(x, z);
      if (tc) {
        kind = 'tennis';
        tcourt = tc;
        rival = 0;
        tRally = 0;
        tServeSide = 1;
        tPause = 1.2;
        tLive = false;
        tReturn = -1;
        oppAt.a = TN.L / 2 + 0.5;
        oppAt.b = 0;
        tball.visible = opp.visible = true;
        say('阿凱要發球了！', 1.2);
        const p = cw(tc, -(TN.L / 2 + 0.3), 0, 0, new Vector3());
        return { x: p.x, z: p.z, facing: Math.atan2(tc.ux, tc.uz) };
      }
      if (pitch && spot && atSpot(x, z)) {
        kind = 'soccer';
        soccerTime = 60;
        rival = 4 + Math.floor(Math.random() * 4);
        kick = null;
        kickPause = 0;
        keeperB = 0;
        sball.visible = keeper.visible = aim.visible = true;
        const [gx, gz] = pitch.toWorld(pitch.halfLength - 0.6, 0);
        keeper.position.set(gx, 0, gz);
        const [ax0, az0] = pitch.toWorld(1, 0), [ox0, oz0] = pitch.toWorld(0, 0);
        keeper.rotation.y = Math.atan2(ox0 - ax0, oz0 - az0);
        sball.position.set(spot[0], SOCCER_DRAW, spot[1]);
        const [px, pz] = pitch.toWorld(pitch.halfLength - 12.6, 0);
        return { x: px, z: pz, facing: Math.atan2(ax0 - ox0, az0 - oz0) };
      }
      return null;
    },
    cancel() {
      if (kind) cleanup();
    },
    update(dt, time, px, py, pz, viewYaw, viewPitch = 0) {
      nowT = time;
      if (!kind) return 0;
      elapsed += dt;
      const pressed = spacePressed, released = spaceReleased;
      spacePressed = spaceReleased = false;
      let earned = 0;

      if (kind === 'basketball') {
        const over = streetball.update(dt, time, px, py, pz, viewYaw);
        score = streetball.you;
        rival = streetball.them;
        hud();
        return over ? finish() : 0;
      }

      if (kind === 'volleyball' && court) {
        const c = court;
        if (vWait > 0) {
          vWait -= dt;
          if (vWait <= 0) serveToPlayer(vp.clone().setY(2.6));
        } else {
          vv.y -= G * dt;
          vp.addScaledVector(vv, dt);
          if (vIncoming && pressed) {
            const near = Math.hypot(vp.x - px, vp.z - pz) < 1.45 && vp.y < 2.3 && vp.y > 0.25 && vv.y < 0;
            if (near) {
              score++;
              say(`好球！${score}`, 0.9);
              const back = cw(c, 2 + Math.random() * 6, (Math.random() - 0.5) * 7, BALL_R, new Vector3());
              vp.set(px, py + 1.0, pz);
              launch(vp, back, Math.max(0.9, volleyT() * 0.85), vv);
              vIncoming = false;
              ring.visible = false;
            } else {
              say('太遠了！', 0.6);
            }
          }
          if (vp.y <= 0.105) {
            vp.y = 0.105;
            if (vIncoming) {
              say('球落地了', 1.5);
              vball.position.copy(vp);
              earned = finish();
              return earned;
            }
            vWait = 0.5; // the other side plays it back
          }
        }
        vball.position.copy(vp);
        vball.rotation.x += dt * 5;
        hud();
        return earned;
      }

      if (kind === 'tennis' && tcourt) {
        const c = tcourt;
        const hl = TN.L / 2, sw = TN.SW / 2;
        if (tPause > 0) {
          tPause -= dt;
          // Back to the baseline, ball in 阿凱's hand.
          oppAt.a += (hl + 0.5 - oppAt.a) * Math.min(1, dt * 3);
          oppAt.b += (-tServeSide * 2 - oppAt.b) * Math.min(1, dt * 3);
          tp.copy(cw(c, oppAt.a - 0.3, oppAt.b, 1.2, new Vector3()));
          if (tPause <= 0) {
            if (score >= TENNIS_WIN || rival >= TENNIS_WIN) return finish();
            tennisHitToPlayer(true);
          }
        } else if (tLive) {
          const prevY = tp.y;
          tv.y -= G * dt;
          tp.addScaledVector(tv, dt);
          const [ba, bb] = tLocal(c, tp.x, tp.z);
          // Into the net: the ball crosses a = 0 below the tape.
          const [pa] = tLocal(c, tp.x - tv.x * dt, tp.z - tv.z * dt);
          if (Math.sign(pa) !== Math.sign(ba) && tp.y < TN.netH + 0.02 && Math.abs(bb) < TN.postB) {
            tennisPoint(tDir > 0, tDir > 0 ? '阿凱掛網！' : '掛網了…');
          } else if (tp.y <= TENNIS_DRAW && prevY > TENNIS_DRAW) {
            tp.y = TENNIS_DRAW;
            tv.y = Math.abs(tv.y) * BOUNCE_Y;
            tv.x *= BOUNCE_H;
            tv.z *= BOUNCE_H;
            tBounces++;
            const inCourt = Math.abs(bb) <= sw + 0.05 && Math.abs(ba) <= hl + 0.05;
            const right = tDir > 0 ? ba < 0 : ba > 0; // landed on the receiver's side
            if (tBounces === 1 && (!inCourt || !right)) {
              tennisPoint(tDir > 0, tDir > 0 ? '阿凱出界！' : '出界了…');
            } else if (tBounces >= 2) {
              tennisPoint(tDir < 0, tDir < 0 ? '阿凱沒接到！' : '沒接到…');
            } else if (tDir < 0) {
              // On 阿凱's side: harder the wider and deeper it is, and the longer the rally.
              const hard = Math.max(0, Math.abs(bb) - 2.6) * 0.16 + Math.max(0, ba - 8) * 0.05 + tRally * 0.012;
              tWillMiss = Math.random() < 0.1 + hard;
              tReturn = 0.32;
            } else {
              ring.visible = false;
            }
          }
          if (tLive) {
            // 阿凱 runs toward the ball.
            const [ga, gb] = tDir < 0 ? tLocal(c, tp.x + tv.x * 0.3, tp.z + tv.z * 0.3) : [hl - 0.5, bb * 0.5];
            const speed = 6.5 * dt;
            oppAt.a += Math.max(-speed, Math.min(speed, Math.max(1.5, ga + 0.4) - oppAt.a));
            oppAt.b += Math.max(-speed, Math.min(speed, gb - oppAt.b));
            if (tReturn >= 0) {
              tReturn -= dt;
              if (tReturn < 0) {
                if (tWillMiss) say('阿凱撲空了！', 0.8);
                else { tRally++; tennisHitToPlayer(false); }
              }
            }
            // You: Space swings; in reach (and on the way to you) the ball goes back.
            if (pressed && tDir > 0) {
              const near = Math.hypot(tp.x - px, tp.z - pz) < 1.7 && tp.y < 2.4 && tBounces <= 1;
              if (near) {
                tRally++;
                // Aim: where the camera's line from you crosses 阿凱's half (clamped a little past the lines).
                const dxw = -Math.sin(viewYaw), dzw = -Math.cos(viewYaw);
                const [pa0, pb0] = tLocal(c, px, pz);
                const da = dxw * c.ux + dzw * c.uz, db = dxw * c.vx + dzw * c.vz;
                const ta = 5 + Math.random() * (hl - 6.5);
                const aimB = Math.max(-sw - 1.2, Math.min(sw + 1.2, pb0 + (da > 0.1 ? (db / da) * (ta - pa0) : 0) + (Math.random() - 0.5) * 1.2));
                const q = cw(c, ta, aimB, TENNIS_DRAW, new Vector3());
                tp.y = Math.max(tp.y, 0.9);
                launch(tp, q, tennisT(), tv);
                tDir = -1;
                tBounces = 0;
                tReturn = -1;
                ring.visible = false;
                say(Math.abs(aimB) > sw - 0.6 ? '刁鑽的角度！' : '好球！', 0.7);
              } else {
                say('太遠了！', 0.5);
              }
            }
            // Past you without a swing.
            if (tDir > 0 && ba < -(hl + 4)) tennisPoint(false, '沒接到…');
          }
        }
        tball.position.copy(tp);
        tball.rotation.x += dt * 9;
        const [ox, oz] = [c.x + c.ux * oppAt.a + c.vx * oppAt.b, c.z + c.uz * oppAt.a + c.vz * oppAt.b];
        opp.position.set(ox, 0, oz);
        opp.rotation.y = Math.atan2(-c.ux, -c.uz);
        hud();
        return earned;
      }

      if (kind === 'soccer' && pitch && spot) {
        soccerTime -= dt;
        const [ba, bb] = pitch.toLocal(sball.position.x, sball.position.z);
        // Aim: where the view line from the ball crosses the goal line.
        const dxw = -Math.sin(viewYaw), dzw = -Math.cos(viewYaw);
        const [a1, b1] = pitch.toLocal(sball.position.x + dxw, sball.position.z + dzw);
        const da = a1 - ba, db = b1 - bb;
        const t = da > 0.05 ? (pitch.halfLength - ba) / da : 40;
        const aimB = Math.max(-6, Math.min(6, bb + db * t));
        const c = charging !== null ? swing(time - charging, 0.9) : null;
        const aimH = 0.25 + 2.55 * (c ?? 0.35) + Math.max(-0.3, Math.min(0.6, -viewPitch * 0.8));
        const [mx, mz] = pitch.toWorld(pitch.halfLength - 0.05, aimB);
        aim.position.set(mx, aimH, mz);
        const [gx0, gz0] = pitch.toWorld(pitch.halfLength, -1), [gx1, gz1] = pitch.toWorld(pitch.halfLength, 1);
        aim.rotation.y = Math.atan2(gx1 - gx0, gz1 - gz0) + Math.PI / 2;
        const near = Math.hypot(sball.position.x - px, sball.position.z - pz) < 1.9;
        aim.visible = !kick && near;
        if (kickPause > 0) {
          kickPause -= dt;
          if (kickPause <= 0) {
            kick = null;
            // The next ball, somewhere else in front of the goal.
            const [nx, nz] = pitch.toWorld(pitch.halfLength - 9 - Math.random() * 13, (Math.random() - 0.5) * 22);
            sball.position.set(nx, SOCCER_DRAW, nz);
            keeperB = 0;
          }
        } else if (!kick) {
          if (pressed && near) charging = time;
          if (pressed && !near) say('先跑到球旁邊！', 0.8);
          if (released && charging !== null && c !== null) {
            charging = null;
            const speed = 17 + 10 * c, dist = pitch.halfLength - ba;
            const T = dist / speed;
            const [tx2, tz2] = pitch.toWorld(pitch.halfLength, aimB);
            const p = sball.position.clone();
            const v = launch(p, new Vector3(tx2, aimH, tz2), T, new Vector3());
            // Keeper guesses: half the time the right side; quicker as the game goes on.
            const guess = Math.random() < 0.5 ? Math.sign(aimB || 1) : Math.random() < 0.5 ? -1 : 1;
            const goB = Math.random() < 0.18 ? 0 : guess * (1.2 + Math.random() * 2);
            kick = { p, v, t: 0, T, b: aimB, h: aimH, keeperB: 0, keeperGo: goB, done: false };
          }
        }
        if (kick && !kick.done) {
          kick.t += dt;
          kick.v.y -= G * dt;
          kick.p.addScaledVector(kick.v, dt);
          sball.position.copy(kick.p);
          sball.rotation.x += dt * 12;
          if (kick.t > 0.18) keeperB += Math.sign(kick.keeperGo - keeperB) * Math.min(Math.abs(kick.keeperGo - keeperB), (7 + elapsed * 0.05) * dt);
          if (kick.t >= kick.T) {
            kick.done = true;
            const [, kb2] = pitch.toLocal(kick.p.x, kick.p.z);
            const h = kick.p.y;
            if (Math.abs(kb2) > 3.66) say('射偏了！', 1.2);
            else if (h > 2.44) say('太高了！', 1.2);
            else if (Math.abs(kb2 - keeperB) < 0.95 && h < 2.25) say('被守門員撲出！', 1.2);
            else { score++; say('GOAL！進球！', 1.2); }
            kickPause = 1.1;
          }
        }
        const [kx, kz] = pitch.toWorld(pitch.halfLength - 0.6, keeperB);
        keeper.position.set(kx, 0, kz);
        keeper.rotation.z = kick && !kick.done ? -Math.sign(keeperB) * Math.min(1.1, Math.abs(keeperB) * 0.5) : 0;
        hud(c, null);
        if (soccerTime <= 0 && (!kick || kick.done)) return finish();
        return earned;
      }
      return 0;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      streetball.dispose();
      for (const m of [...bballs, vball, sball, tball, ring, aim, keeper, opp]) m.removeFromParent();
    },
  };
}
