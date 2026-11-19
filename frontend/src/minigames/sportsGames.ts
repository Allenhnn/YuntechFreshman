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
  Vector3,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import { actions, gameStore, type SportHud } from '../state/store';
import { RIM_H, RIM_R, type Courts, type Hoop, type VolleyCourt } from './sportsCourts';

/**
 * Ball games:
 *  - 籃球 60 秒投籃挑戰: walk anywhere on the court, hold Space to charge (the meter swings),
 *    release to shoot at the hoop you started from; rim / backboard / floor bounces; 2 or 3 points.
 *  - 排球墊球: the ball comes over the net, a ring marks where it will come down; be there and press
 *    Space as it drops to bump it back. Count consecutive bumps; it ends when the ball lands.
 *  - 足球 PK: five penalties; aim with the camera, hold Space for power (too much flies over the
 *    bar), the keeper guesses a side and dives.
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
  /** The player must stand still (penalty kick). */
  readonly frozen: boolean;
  cancel(): void;
  /** Per frame; returns coins earned. `viewYaw` is the camera yaw (view direction = −(sin, cos)). */
  update(dt: number, time: number, px: number, py: number, pz: number, viewYaw: number): number;
  dispose(): void;
}

/** Told when a ball game ends (story quests, achievements). */
export const sportFinished = new Set<(kind: 'basketball' | 'volleyball' | 'soccer', score: number) => void>();

const G = 9.8;
const BALL_R = 0.12;
const BEST_KEY = 'yfm.sportBest.v1';
const TITLES = { basketball: '🏀 投籃挑戰', volleyball: '🏐 排球墊球', soccer: '⚽ PK 射門' } as const;
type Kind = keyof typeof TITLES;

function loadBest(): Record<Kind, number> {
  try {
    return { basketball: 0, volleyball: 0, soccer: 0, ...(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Partial<Record<Kind, number>>) };
  } catch {
    return { basketball: 0, volleyball: 0, soccer: 0 };
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
  const bballs = [0, 1, 2].map(() => makeBall(basketTex, BALL_R));
  const vball = makeBall(volleyTex, 0.105);
  const sball = makeBall(soccerTex, 0.11);
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

  // --- State -------------------------------------------------------------------------------------
  let kind: Kind | null = null;
  let score = 0;
  let timeLeft = 0;
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

  // Basketball.
  let hoop: Hoop | null = null;
  interface Shot { mesh: Mesh; p: Vector3; v: Vector3; scored: boolean; age: number; points: number; settled: boolean }
  const shots: Shot[] = [];
  let cooldown = 0;
  // Volleyball.
  let court: VolleyCourt | null = null;
  const vp = new Vector3(), vv = new Vector3();
  let vIncoming = false; // true: coming to the player; false: going away
  let vTarget = new Vector3();
  let vWait = 0;
  // Soccer.
  let shotsLeft = 0;
  let kick: { p: Vector3; v: Vector3; t: number; T: number; b: number; h: number; keeperB: number; keeperGo: number; done: boolean } | null = null;
  let kickPause = 0;
  let keeperB = 0;

  const hud = (charge: number | null = null, sweet: [number, number] | null = null): void => {
    if (!kind) { actions.setSport(null); return; }
    const info = kind === 'basketball' ? `剩餘 ${Math.ceil(timeLeft)} 秒` : kind === 'soccer' ? `剩 ${shotsLeft} 球` : '連續墊球';
    const h: SportHud = {
      title: TITLES[kind], score, info, best: best[kind], charge, sweet,
      message: nowT < messageUntil ? message : '',
      hint: kind === 'basketball' ? '按住 Space 蓄力，放開投籃 · Q 結束' : kind === 'volleyball' ? '跑到黃色圈圈，球落下時按 Space · Q 結束' : '轉動視角瞄準，按住 Space 蓄力射門 · Q 結束',
    };
    actions.setSport(h);
  };

  const finish = (): number => {
    if (!kind) return 0;
    const k = kind;
    const coins = k === 'basketball' ? score : k === 'volleyball' ? score * 2 : score * 10;
    const record = score > best[k];
    if (record) { best[k] = score; saveBest(best); }
    for (const fn of sportFinished) fn(k, score);
    actions.toast(`${TITLES[k]} 結束：${k === 'soccer' ? `進 ${score} 球` : `${score} 分`}${record ? '（新紀錄！）' : ''}　+NT$ ${coins}`);
    cleanup();
    return coins;
  };
  const cleanup = (): void => {
    kind = null;
    for (const s of shots) s.mesh.visible = false;
    shots.length = 0;
    vball.visible = sball.visible = ring.visible = aim.visible = keeper.visible = false;
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

  const serveToPlayer = (from: Vector3): void => {
    const c = court!;
    const reach = Math.min(1, score / 25);
    vTarget = cw(c, -(2 + Math.random() * (5 + reach)), (Math.random() - 0.5) * (5 + reach * 2.5), BALL_R, new Vector3());
    vp.copy(from);
    launch(vp, vTarget, Math.max(1.05, 1.7 - score * 0.03), vv);
    vIncoming = true;
    ring.position.set(vTarget.x, 0.06, vTarget.z);
    ring.visible = true;
  };

  return {
    get active() { return kind !== null; },
    get frozen() { return kind === 'soccer'; },
    prompt(x, y, z) {
      if (kind || y > 1) return null;
      if (nearestHoop(x, z)) return '按 E 開始 60 秒投籃挑戰';
      if (volleyAt(x, z)) return '按 E 開始排球墊球';
      if (atSpot(x, z)) return '按 E 開始 PK 射門（5 球）';
      return null;
    },
    start(x, _y, z) {
      if (kind) return null;
      spacePressed = spaceReleased = false;
      charging = null;
      score = 0;
      message = '';
      const h = nearestHoop(x, z);
      if (h) {
        kind = 'basketball';
        hoop = h;
        timeLeft = 60;
        cooldown = 0;
        say('開始！', 1.2);
        // Free-throw line, facing the hoop.
        const fx = h.x + h.nx * 4.6, fz = h.z + h.nz * 4.6;
        return { x: fx, z: fz, facing: Math.atan2(-h.nx, -h.nz) };
      }
      const c = volleyAt(x, z);
      if (c) {
        kind = 'volleyball';
        court = c;
        vWait = 0;
        vball.visible = true;
        serveToPlayer(cw(c, 6, 0, 2.6, new Vector3()));
        say('準備接球！', 1.2);
        const p = cw(c, -5, 0, 0, new Vector3());
        return { x: p.x, z: p.z, facing: Math.atan2(c.ux, c.uz) };
      }
      if (pitch && spot && atSpot(x, z)) {
        kind = 'soccer';
        shotsLeft = 5;
        kick = null;
        kickPause = 0;
        keeperB = 0;
        sball.visible = keeper.visible = aim.visible = true;
        const [gx, gz] = pitch.toWorld(pitch.halfLength - 0.6, 0);
        keeper.position.set(gx, 0, gz);
        const [ax0, az0] = pitch.toWorld(1, 0), [ox0, oz0] = pitch.toWorld(0, 0);
        keeper.rotation.y = Math.atan2(ox0 - ax0, oz0 - az0);
        sball.position.set(spot[0], 0.11, spot[1]);
        const [px, pz] = pitch.toWorld(pitch.halfLength - 12.6, 0);
        return { x: px, z: pz, facing: Math.atan2(ax0 - ox0, az0 - oz0) };
      }
      return null;
    },
    cancel() {
      if (kind) cleanup();
    },
    update(dt, time, px, py, pz, viewYaw) {
      nowT = time;
      if (!kind) return 0;
      const pressed = spacePressed, released = spaceReleased;
      spacePressed = spaceReleased = false;
      let earned = 0;

      if (kind === 'basketball' && hoop) {
        timeLeft -= dt;
        cooldown -= dt;
        const dist = Math.hypot(hoop.x - px, hoop.z - pz);
        if (pressed && cooldown <= 0 && shots.length < 3) charging = time;
        const c = charging !== null ? swing(time - charging, 0.85) : null;
        if (released && charging !== null && c !== null) {
          charging = null;
          cooldown = 0.35;
          const mesh = bballs.find((b) => !shots.some((s) => s.mesh === b))!;
          const p = new Vector3(px, py + 1.55, pz);
          const dx = hoop.x - px, dz = hoop.z - pz, d = Math.hypot(dx, dz) || 1;
          p.x += (dx / d) * 0.3; p.z += (dz / d) * 0.3;
          const theta = (58 * Math.PI) / 180, dh = RIM_H - p.y, dd = d - 0.3;
          const ideal = Math.sqrt((G * dd * dd) / (2 * Math.cos(theta) ** 2 * Math.max(0.3, dd * Math.tan(theta) - dh)));
          const speed = ideal * (0.86 + 0.28 * c);
          const err = (Math.abs(c - 0.5) * 0.12 + 0.012) * (Math.random() - 0.5) * 2;
          const yaw = Math.atan2(dx, dz) + err;
          const v = new Vector3(Math.sin(yaw) * Math.cos(theta) * speed, Math.sin(theta) * speed, Math.cos(yaw) * Math.cos(theta) * speed);
          mesh.position.copy(p);
          mesh.visible = true;
          shots.push({ mesh, p, v, scored: false, age: 0, points: dist > 6.75 ? 3 : 2, settled: false });
        }
        // Physics: rim, backboard, floor.
        const board = new Vector3(hoop.x - hoop.nx * 0.375, 0, hoop.z - hoop.nz * 0.375);
        const tx = -hoop.nz, tz = hoop.nx; // along the board
        for (const s of shots) {
          s.age += dt;
          const steps = 6, h = dt / steps;
          for (let i = 0; i < steps; i++) {
            const prevY = s.p.y;
            s.v.y -= G * h;
            s.p.addScaledVector(s.v, h);
            // Rim: nearest point on the ring.
            const rx = s.p.x - hoop.x, rz = s.p.z - hoop.z, rl = Math.hypot(rx, rz) || 1e-6;
            const qx = hoop.x + (rx / rl) * RIM_R, qz = hoop.z + (rz / rl) * RIM_R;
            const nx = s.p.x - qx, ny = s.p.y - RIM_H, nz = s.p.z - qz, nl = Math.hypot(nx, ny, nz);
            if (nl < BALL_R + 0.012 && nl > 1e-6) {
              const ux = nx / nl, uy = ny / nl, uz = nz / nl, vn = s.v.x * ux + s.v.y * uy + s.v.z * uz;
              if (vn < 0) { s.v.x -= 1.55 * vn * ux; s.v.y -= 1.55 * vn * uy; s.v.z -= 1.55 * vn * uz; }
              const push = BALL_R + 0.012 - nl;
              s.p.x += ux * push; s.p.y += uy * push; s.p.z += uz * push;
            }
            // Backboard plane.
            const bd = (s.p.x - board.x) * hoop.nx + (s.p.z - board.z) * hoop.nz;
            const along = (s.p.x - board.x) * tx + (s.p.z - board.z) * tz;
            if (bd < BALL_R && bd > -0.3 && Math.abs(along) < 0.9 && s.p.y > 2.9 && s.p.y < 3.95) {
              const vn = s.v.x * hoop.nx + s.v.z * hoop.nz;
              if (vn < 0) { s.v.x -= 1.6 * vn * hoop.nx; s.v.z -= 1.6 * vn * hoop.nz; }
              s.p.x += (BALL_R - bd) * hoop.nx; s.p.z += (BALL_R - bd) * hoop.nz;
            }
            // Through the hoop (downward, inside the ring).
            if (!s.scored && prevY >= RIM_H && s.p.y < RIM_H && Math.hypot(s.p.x - hoop.x, s.p.z - hoop.z) < RIM_R - 0.02) {
              s.scored = true;
              score += s.points;
              say(s.points === 3 ? '三分球！+3' : '進球！+2');
              s.v.multiplyScalar(0.35); // the net slows it
            }
            if (s.p.y < BALL_R) {
              s.p.y = BALL_R;
              s.v.y = Math.abs(s.v.y) * 0.62;
              s.v.x *= 0.8; s.v.z *= 0.8;
              if (s.v.y < 0.4) s.settled = true;
            }
          }
          s.mesh.position.copy(s.p);
          s.mesh.rotation.x += dt * 6;
        }
        for (let i = shots.length - 1; i >= 0; i--) {
          const s = shots[i]!;
          if (s.age > 4 || (s.settled && s.age > 1.5)) { s.mesh.visible = false; shots.splice(i, 1); }
        }
        hud(c, [0.42, 0.58]);
        if (timeLeft <= 0) earned = finish();
        return earned;
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
              launch(vp, back, 1.45, vv);
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

      if (kind === 'soccer' && pitch && spot) {
        const [ba, bb] = pitch.toLocal(sball.position.x, sball.position.z);
        // Aim: where the view line from the ball crosses the goal line.
        const dxw = -Math.sin(viewYaw), dzw = -Math.cos(viewYaw);
        const [a1, b1] = pitch.toLocal(sball.position.x + dxw, sball.position.z + dzw);
        const da = a1 - ba, db = b1 - bb;
        const t = da > 0.05 ? (pitch.halfLength - ba) / da : 40;
        const aimB = Math.max(-5, Math.min(5, bb + db * t));
        const c = charging !== null ? swing(time - charging, 0.9) : null;
        const aimH = 0.25 + 2.55 * (c ?? 0.35);
        const [mx, mz] = pitch.toWorld(pitch.halfLength - 0.05, aimB);
        aim.position.set(mx, aimH, mz);
        const [gx0, gz0] = pitch.toWorld(pitch.halfLength, -1), [gx1, gz1] = pitch.toWorld(pitch.halfLength, 1);
        aim.rotation.y = Math.atan2(gx1 - gx0, gz1 - gz0) + Math.PI / 2;
        aim.visible = !kick;
        if (kickPause > 0) {
          kickPause -= dt;
          if (kickPause <= 0) {
            if (shotsLeft <= 0) { earned = finish(); return earned; }
            kick = null;
            sball.position.set(spot[0], 0.11, spot[1]);
            keeperB = 0;
          }
        } else if (!kick) {
          if (pressed) charging = time;
          if (released && charging !== null && c !== null) {
            charging = null;
            const speed = 17 + 10 * c, dist = pitch.halfLength - ba;
            const T = dist / speed;
            const [tx2, tz2] = pitch.toWorld(pitch.halfLength, aimB);
            const p = sball.position.clone();
            const v = launch(p, new Vector3(tx2, aimH, tz2), T, new Vector3());
            // Keeper guesses: half the time the right side.
            const guess = Math.random() < 0.5 ? Math.sign(aimB || 1) : Math.random() < 0.5 ? -1 : 1;
            const goB = Math.random() < 0.18 ? 0 : guess * (1.2 + Math.random() * 2);
            kick = { p, v, t: 0, T, b: aimB, h: aimH, keeperB: 0, keeperGo: goB, done: false };
            shotsLeft--;
          }
        }
        if (kick && !kick.done) {
          kick.t += dt;
          kick.v.y -= G * dt;
          kick.p.addScaledVector(kick.v, dt);
          sball.position.copy(kick.p);
          sball.rotation.x += dt * 12;
          if (kick.t > 0.18) keeperB += Math.sign(kick.keeperGo - keeperB) * Math.min(Math.abs(kick.keeperGo - keeperB), 7 * dt);
          if (kick.t >= kick.T) {
            kick.done = true;
            const [, kb2] = pitch.toLocal(kick.p.x, kick.p.z);
            const h = kick.p.y;
            if (Math.abs(kb2) > 3.66) say('射偏了！', 1.4);
            else if (h > 2.44) say('太高了！', 1.4);
            else if (Math.abs(kb2 - keeperB) < 0.95 && h < 2.25) say('被守門員撲出！', 1.4);
            else { score++; say('GOAL！進球！', 1.4); }
            kickPause = 1.6;
          }
        }
        const [kx, kz] = pitch.toWorld(pitch.halfLength - 0.6, keeperB);
        keeper.position.set(kx, 0, kz);
        keeper.rotation.z = kick && !kick.done ? -Math.sign(keeperB) * Math.min(1.1, Math.abs(keeperB) * 0.5) : 0;
        hud(c, null);
        return earned;
      }
      return 0;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      for (const m of [...bballs, vball, sball, ring, aim, keeper]) m.removeFromParent();
    },
  };
}
