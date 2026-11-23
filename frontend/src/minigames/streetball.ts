import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import { gameStore } from '../state/store';
import { RIM_H, RIM_R, type Hoop } from './sportsCourts';

/**
 * 3v3 鬥牛 on one basket, third person. You (blue) and two teammates against three (red); first
 * to 11 points (2 or 3 a basket) or the most when the clock runs out.
 *  Offence: K passes to the teammate you face (or asks a teammate with the ball for it),
 *           hold J to charge and release in the green to shoot.
 *  Defence: K near the ball handler tries a steal (a chance, not a sure thing);
 *           J while an opponent is shooting next to you blocks it (蓋火鍋).
 * A guided tutorial (pass, shoot, steal, block) runs before the game; Y skips it.
 */
export interface StreetballHud {
  you: number;
  them: number;
  info: string;
  charge: number | null;
  sweet: [number, number];
  message: string;
  hint: string;
}

export interface Streetball {
  start(hoop: Hoop): { x: number; z: number; facing: number };
  /** Per frame; true when the game is over. */
  update(dt: number, time: number, px: number, py: number, pz: number, viewYaw: number): boolean;
  hud(): StreetballHud;
  readonly you: number;
  readonly them: number;
  stop(): void;
  dispose(): void;
}

const G = 9.8;
const WIN = 11;
const GAME_TIME = 180;
const SWEET: [number, number] = [0.62, 0.82];
const NPC_SPEED = 4.3;
const THREE = 6.75;
/** Court spots (a: out from the baseline under the rim, b: across): top, left wing, right wing. */
const SPOTS: [number, number][] = [[7.4, 0], [5.2, -4.6], [5.2, 4.6]];
const TUTORIAL = [
  '教學 1/4・進攻：面向隊友按 K 傳球',
  '教學 2/4・按住 J 蓄力，指針在綠色區時放開投籃',
  '教學 3/4・防守：靠近拿球的紅隊，按 K 抄球',
  '教學 4/4・紅隊要投籃了！貼近他，出手瞬間按 J 蓋火鍋',
] as const;

type V = { x: number; z: number };
interface Body extends V {
  team: 0 | 1;
  vx: number;
  vz: number;
  g: Group | null;
  legs: Mesh[];
  phase: number;
}

type BallState =
  | { s: 'held'; by: number }
  | { s: 'pass'; from: number; to: number; t: number; T: number; p0: Vector3 }
  | { s: 'shot'; by: number; t: number; T: number; p0: Vector3; v: Vector3; make: boolean; pts: number; resolved: boolean }
  | { s: 'loose'; p: Vector3; v: Vector3; t: number }
  | { s: 'dead'; t: number; next: 0 | 1 };

export function createStreetball(scene: Scene, tracker: ResourceTracker, ballMesh: Mesh, ballR: number): Streetball {
  // --- Players: 0 = you, 1–2 teammates (blue), 3–5 opponents (red) ---------------------------
  const skin = tracker.material(new MeshStandardMaterial({ color: 0xf1d2b0, roughness: 0.7 }));
  const shoe = tracker.material(new MeshStandardMaterial({ color: 0x222428, roughness: 0.7 }));
  const jersey = [0x2c6fd6, 0xd8353a].map((c) => tracker.material(new MeshStandardMaterial({ color: c, roughness: 0.6 })));
  const shorts = [0x1d3f7a, 0x7a1d22].map((c) => tracker.material(new MeshStandardMaterial({ color: c, roughness: 0.6 })));
  const torsoGeo = tracker.geometry(new CylinderGeometry(0.2, 0.24, 0.62, 12));
  const shortsGeo = tracker.geometry(new CylinderGeometry(0.24, 0.24, 0.26, 12));
  const legGeo = tracker.geometry(new CylinderGeometry(0.075, 0.07, 0.72, 8));
  legGeo.translate(0, -0.36, 0);
  const armGeo = tracker.geometry(new CylinderGeometry(0.06, 0.055, 0.6, 8));
  armGeo.translate(0, -0.3, 0);
  const headGeo = tracker.geometry(new SphereGeometry(0.17, 14, 10));
  const footGeo = tracker.geometry(new SphereGeometry(1, 10, 8));
  const part = (g: Group, geo: CylinderGeometry | SphereGeometry, m: Material, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const makeNpc = (team: 0 | 1): Body => {
    const g = new Group();
    part(g, torsoGeo, jersey[team]!, 0, 1.17, 0);
    part(g, shortsGeo, shorts[team]!, 0, 0.8, 0);
    part(g, headGeo, skin, 0, 1.65, 0);
    const legs = [-0.11, 0.11].map((x) => part(g, legGeo, skin, x, 0.74, 0));
    for (const l of legs) { const f = new Mesh(footGeo, shoe); f.scale.set(0.08, 0.05, 0.13); f.position.set(0, -0.72, 0.04); l.add(f); }
    const arms = [-0.27, 0.27].map((x) => part(g, armGeo, skin, x, 1.42, 0));
    arms[0]!.rotation.z = -0.12; arms[1]!.rotation.z = 0.12;
    g.visible = false;
    scene.add(g);
    return { team, x: 0, z: 0, vx: 0, vz: 0, g, legs, phase: Math.random() * 6 };
  };
  const you: Body = { team: 0, x: 0, z: 0, vx: 0, vz: 0, g: null, legs: [], phase: 0 };
  const bodies: Body[] = [you, makeNpc(0), makeNpc(0), makeNpc(1), makeNpc(1), makeNpc(1)];

  // --- State ---------------------------------------------------------------------------------
  let hoop: Hoop | null = null;
  let running = false;
  let tut = 0; // 0–3 tutorial step, 4 = playing
  let tutHold = 0;
  let score: [number, number] = [0, 0];
  let clock = GAME_TIME;
  let ball: BallState = { s: 'held', by: 0 };
  let decide = 0; // NPC ball handler's decision timer
  let charging: number | null = null;
  let nowT = 0;
  let message = '';
  let messageUntil = 0;
  let cool = 0; // your steal / block cooldown
  let callFor = false; // you asked a teammate for the ball
  let viewDir: V = { x: 0, z: 1 };
  let over = false;
  const keys = { k: false, jDown: false, jUp: false, y: false };
  const onKey = (e: KeyboardEvent): void => {
    if (!running || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (gameStore.getState().modal !== 'none') return;
    if (e.code === 'KeyK' && e.type === 'keydown') keys.k = true;
    else if (e.code === 'KeyJ') { if (e.type === 'keydown') keys.jDown = true; else keys.jUp = true; }
    else if (e.code === 'KeyY' && e.type === 'keydown') keys.y = true;
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const say = (m: string, secs = 1.6): void => { message = m; messageUntil = nowT + secs; };

  // --- Court frame -----------------------------------------------------------------------------
  const w = (a: number, b: number): V => ({ x: hoop!.x + hoop!.nx * a - hoop!.nz * b, z: hoop!.z + hoop!.nz * a + hoop!.nx * b });
  const local = (p: V): [number, number] => {
    const dx = p.x - hoop!.x, dz = p.z - hoop!.z;
    return [dx * hoop!.nx + dz * hoop!.nz, -dx * hoop!.nz + dz * hoop!.nx];
  };
  const hoopDist = (p: V): number => Math.hypot(p.x - hoop!.x, p.z - hoop!.z);
  const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.z - b.z);
  const teamOf = (i: number): 0 | 1 => (i < 3 ? 0 : 1);
  const holder = (): number => (ball.s === 'held' ? ball.by : -1);
  const offence = (): 0 | 1 | -1 => (ball.s === 'held' ? teamOf(ball.by) : ball.s === 'pass' ? teamOf(ball.from) : ball.s === 'shot' ? teamOf(ball.by) : -1);
  const hand = (i: number, out: Vector3): Vector3 => {
    const b = bodies[i]!;
    const face = i === 0 ? viewDir : facingOf(b);
    return out.set(b.x + face.x * 0.38 - face.z * 0.22, 1.25, b.z + face.z * 0.38 + face.x * 0.22);
  };
  const facingOf = (b: Body): V => {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.3) return { x: b.vx / sp, z: b.vz / sp };
    const dx = hoop!.x - b.x, dz = hoop!.z - b.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };

  const giveTo = (i: number): void => {
    ball = { s: 'held', by: i };
    decide = 1.2 + Math.random() * 1.4;
    callFor = false;
  };
  /** New possession for `team` from the top of the key (after a basket). */
  const checkBall = (team: 0 | 1): void => {
    if (team === 0) { giveTo(0); return; }
    const top = w(SPOTS[0]![0], SPOTS[0]![1]);
    const b = bodies[3]!;
    b.x = top.x; b.z = top.z;
    giveTo(3);
  };

  const pass = (from: number, to: number): void => {
    const p0 = hand(from, new Vector3());
    const T = Math.max(0.3, dist(bodies[from]!, bodies[to]!) / 14);
    ball = { s: 'pass', from, to, t: 0, T, p0 };
  };

  /** Chance a shot from `i` goes in: by distance, the defender next to the shooter and (yours) the meter. */
  const makeChance = (i: number, meter: number | null): number => {
    const d = hoopDist(bodies[i]!);
    let p = d < 2 ? 0.82 : d < 4.5 ? 0.6 : d < THREE ? 0.46 : 0.34;
    if (meter !== null) {
      const mid = (SWEET[0] + SWEET[1]) / 2;
      p *= meter >= SWEET[0] && meter <= SWEET[1] ? 1.15 : Math.max(0.12, 1 - Math.abs(meter - mid) * 2.4);
    }
    const guard = bodies.filter((b, k) => teamOf(k) !== teamOf(i) && dist(b, bodies[i]!) < 1.3).length;
    if (guard) p *= 0.7;
    return Math.min(0.95, p);
  };
  const shoot = (i: number, meter: number | null, force?: boolean): void => {
    const p0 = hand(i, new Vector3()).setY(i === 0 ? 1.9 : 2.0);
    const make = force ?? Math.random() < makeChance(i, meter);
    const ang = Math.random() * Math.PI * 2;
    // A make drops through the middle; a miss clips the rim on a random side.
    const target = make ? new Vector3(hoop!.x, RIM_H + 0.12, hoop!.z) : new Vector3(hoop!.x + Math.cos(ang) * (RIM_R + 0.06), RIM_H + 0.05, hoop!.z + Math.sin(ang) * (RIM_R + 0.06));
    const d = hoopDist(bodies[i]!);
    const T = 0.75 + d * 0.06 + (tut === 3 && i !== 0 ? 0.35 : 0);
    const v = new Vector3((target.x - p0.x) / T, (target.y - p0.y + 0.5 * G * T * T) / T, (target.z - p0.z) / T);
    ball = { s: 'shot', by: i, t: 0, T, p0, v, make, pts: d > THREE ? 3 : 2, resolved: false };
  };

  const steal = (by: number): void => {
    giveTo(by);
    say(by === 0 ? '抄截成功！' : teamOf(by) === 0 ? '隊友抄到球了！' : '球被抄走了！', 1.2);
  };

  // --- Movement -------------------------------------------------------------------------------
  const steer = (b: Body, target: V, speed: number, dt: number): void => {
    const [ta, tb] = local(target);
    const t = w(Math.max(0.4, Math.min(10.5, ta)), Math.max(-6.8, Math.min(6.8, tb)));
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    const want = d > 0.25 ? Math.min(speed, d * 2.2) : 0;
    const tvx = d > 1e-3 ? (dx / d) * want : 0, tvz = d > 1e-3 ? (dz / d) * want : 0;
    const k = Math.min(1, dt * 6);
    b.vx += (tvx - b.vx) * k;
    b.vz += (tvz - b.vz) * k;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
  };
  const between = (man: V, gap: number): V => {
    const dx = hoop!.x - man.x, dz = hoop!.z - man.z, l = Math.hypot(dx, dz) || 1;
    return { x: man.x + (dx / l) * gap, z: man.z + (dz / l) * gap };
  };

  const moveNpcs = (dt: number): void => {
    const off = offence();
    const h = holder();
    for (let i = 1; i < 6; i++) {
      const b = bodies[i]!;
      const mine = teamOf(i);
      let target: V;
      if (ball.s === 'loose') {
        target = { x: ball.p.x, z: ball.p.z }; // everyone crashes the boards
      } else if (tut < 4) {
        // Tutorial: everyone holds a spot (the red handler waits for you).
        const slot = i % 3;
        target = mine === 0 ? w(SPOTS[slot]![0], SPOTS[slot]![1]) : i === 3 && (tut === 2 || tut === 3) ? w(6.2, 0) : w(SPOTS[slot]![0] - 2.2, SPOTS[slot]![1] * 0.7);
      } else if (off === mine) {
        if (h === i) {
          // Ball handler: drive toward the basket, stop short to decide.
          target = hoopDist(b) > 4 ? w(...local(b).map((v, k) => (k === 0 ? Math.max(3.5, v - 2) : v * 0.85)) as [number, number]) : b;
        } else {
          const slot = i % 3;
          const cut = Math.sin(nowT * 0.7 + i) > 0.75; // now and then cut to the rim
          target = cut ? w(1.8, SPOTS[slot]![1] * 0.45) : w(SPOTS[slot]![0], SPOTS[slot]![1]);
        }
      } else {
        // Defence: mark the player in the same slot of the other team, closer on the ball.
        const man = bodies[mine === 0 ? i + 3 : i - 3]!;
        target = between(man, h >= 0 && bodies[h] === man ? 0.9 : 1.4);
      }
      steer(b, target, NPC_SPEED * (h === i ? 0.75 : 1), dt);
    }
    // Keep bodies from standing inside each other (you included, though you are not pushed).
    for (let i = 1; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (i === j) continue;
        const a = bodies[i]!, c = bodies[j]!;
        const dx = a.x - c.x, dz = a.z - c.z, d = Math.hypot(dx, dz);
        if (d < 0.62 && d > 1e-4) { const push = (0.62 - d) * (j === 0 ? 1 : 0.5); a.x += (dx / d) * push; a.z += (dz / d) * push; }
      }
    }
  };

  // --- NPC decisions -------------------------------------------------------------------------
  const npcBall = (dt: number): void => {
    const h = holder();
    if (h <= 0 || tut < 4) return;
    decide -= dt;
    const team = teamOf(h);
    const mates = [0, 1, 2, 3, 4, 5].filter((k) => k !== h && teamOf(k) === team);
    if (team === 0 && callFor && decide > 0.35) decide = 0.35;
    if (decide > 0) return;
    const d = hoopDist(bodies[h]!);
    if (team === 0) {
      // Teammates look for you first.
      if (callFor || Math.random() < 0.62) { pass(h, 0); return; }
      if (Math.random() < 0.45 || d < 3) { shoot(h, null); return; }
      pass(h, mates.find((k) => k !== 0) ?? 0);
      return;
    }
    if (d < 3.2 || Math.random() < 0.42) shoot(h, null);
    else pass(h, mates[Math.floor(Math.random() * mates.length)]!);
  };
  /** Pressure: a defender right on the ball handler sometimes pokes it away. */
  const pressure = (dt: number): void => {
    const h = holder();
    if (h < 0 || tut < 4) return;
    for (let i = 1; i < 6; i++) {
      if (teamOf(i) === teamOf(h) || dist(bodies[i]!, bodies[h]!) > 1.05) continue;
      const rate = h === 0 ? 0.14 : 0.06; // per second
      if (Math.random() < rate * dt) { steal(i); return; }
    }
  };

  // --- Your actions --------------------------------------------------------------------------
  const yourK = (): void => {
    const h = holder();
    if (h === 0) {
      // Pass to the teammate you are facing most.
      let bestK = 1, bestS = -Infinity;
      for (const k of [1, 2]) {
        const b = bodies[k]!, dx = b.x - you.x, dz = b.z - you.z, l = Math.hypot(dx, dz) || 1;
        const s = (dx * viewDir.x + dz * viewDir.z) / l;
        if (s > bestS) { bestS = s; bestK = k; }
      }
      pass(0, bestK);
      if (tut === 0) tutHold = 1.6;
      return;
    }
    if (h > 0 && teamOf(h) === 0) { callFor = true; say('「傳我！」', 0.9); return; }
    if (cool > 0) return;
    if (h >= 3 && dist(you, bodies[h]!) < 1.8) {
      cool = 0.9;
      if (tut === 2 || Math.random() < 0.38) { steal(0); if (tut === 2) tutHold = 1.2; }
      else say('沒抄到！', 0.9);
      return;
    }
    if (ball.s === 'pass' && teamOf(ball.from) === 1) {
      const p = ballPos(new Vector3());
      if (Math.hypot(p.x - you.x, p.z - you.z) < 1.6) { cool = 0.9; if (Math.random() < 0.55) steal(0); else say('差一點就抄到！', 0.9); return; }
    }
    if (h >= 3) say('離拿球的人太遠了', 0.8);
  };
  const yourJDown = (): void => {
    if (holder() === 0) { charging = nowT; return; }
    // Block: an opponent's shot just released, and you are on the shooter.
    if (ball.s === 'shot' && teamOf(ball.by) === 1 && !ball.resolved && cool <= 0) {
      const near = dist(you, bodies[ball.by]!) < (tut === 3 ? 2.8 : 2.2);
      const early = ball.t < (tut === 3 ? 0.75 : 0.5);
      cool = 1;
      if (near && early && (tut === 3 || Math.random() < 0.6)) {
        const p = ballPos(new Vector3());
        ball = { s: 'loose', p, v: new Vector3((you.x - hoop!.x) * 0.4 + (Math.random() - 0.5) * 3, 2.5, (you.z - hoop!.z) * 0.4 + (Math.random() - 0.5) * 3), t: 0 };
        say('🔥 蓋火鍋！', 1.4);
        if (tut === 3) tutHold = 1.4;
      } else say(near ? '慢了一步！' : '離投籃的人太遠了', 0.9);
    }
  };
  const yourJUp = (): void => {
    if (charging === null || holder() !== 0) { charging = null; return; }
    const meter = swing(nowT - charging, 1.1);
    charging = null;
    shoot(0, meter);
    if (tut === 1) tutHold = 2.2;
  };

  const swing = (t: number, period: number): number => {
    const u = (t / period) % 2;
    return u < 1 ? u : 2 - u;
  };

  const ballPos = (out: Vector3): Vector3 => {
    if (ball.s === 'held') {
      const p = hand(ball.by, out);
      // Dribble unless holding it up to shoot.
      if (!(ball.by === 0 && charging !== null)) p.y = ballR + Math.abs(Math.sin(nowT * 7 + ball.by)) * 0.85;
      else p.y = 1.7;
      return p;
    }
    if (ball.s === 'pass') {
      const u = Math.min(1, ball.t / ball.T);
      const to = hand(ball.to, new Vector3());
      return out.copy(ball.p0).lerp(to, u).setY(ball.p0.y + (to.y - ball.p0.y) * u + Math.sin(u * Math.PI) * 0.6);
    }
    if (ball.s === 'shot') return out.copy(ball.p0).addScaledVector(ball.v, ball.t).setY(ball.p0.y + ball.v.y * ball.t - 0.5 * G * ball.t * ball.t);
    if (ball.s === 'loose') return out.copy(ball.p);
    return out.set(hoop!.x, ballR, hoop!.z);
  };

  // --- Ball update ---------------------------------------------------------------------------
  const tmp = new Vector3();
  const stepBall = (dt: number): void => {
    if (ball.s === 'pass') {
      ball.t += dt;
      // A defender on the passing lane may pick it off.
      if (tut >= 4 && ball.t > ball.T * 0.3 && ball.t < ball.T * 0.8) {
        const p = ballPos(tmp);
        for (let i = 1; i < 6; i++) {
          if (teamOf(i) === teamOf(ball.from)) continue;
          if (Math.hypot(p.x - bodies[i]!.x, p.z - bodies[i]!.z) < 0.7 && Math.random() < 0.05) { steal(i); return; }
        }
      }
      if (ball.t >= ball.T) {
        const to = ball.to;
        giveTo(to);
        if (tut === 0 && to !== 0) decide = 1;
      }
      return;
    }
    if (ball.s === 'shot') {
      ball.t += dt;
      if (!ball.resolved && ball.t >= ball.T) {
        ball.resolved = true;
        const team = teamOf(ball.by);
        if (ball.make) {
          if (tut >= 4) score[team] += ball.pts;
          say(team === 0 ? (ball.by === 0 ? `${ball.pts === 3 ? '三分球' : '進了'}！+${ball.pts}` : `隊友得分 +${ball.pts}`) : `紅隊得分 +${ball.pts}`, 1.3);
          ball = { s: 'dead', t: 0, next: team === 0 ? 1 : 0 };
        } else {
          const p = ballPos(new Vector3());
          const out = new Vector3(p.x - hoop!.x, 0, p.z - hoop!.z).normalize();
          ball = { s: 'loose', p, v: new Vector3(out.x * (2 + Math.random() * 2) + hoop!.nx * 1.5, 2.8 + Math.random(), out.z * (2 + Math.random() * 2) + hoop!.nz * 1.5), t: 0 };
          say('沒進！搶籃板！', 1);
        }
      }
      return;
    }
    if (ball.s === 'loose') {
      ball.t += dt;
      ball.v.y -= G * dt;
      ball.p.addScaledVector(ball.v, dt);
      if (ball.p.y < ballR) { ball.p.y = ballR; ball.v.y = Math.abs(ball.v.y) * 0.55; ball.v.x *= 0.85; ball.v.z *= 0.85; }
      // Keep it on the half court.
      const [a, b] = local(ball.p);
      if (a < 0.3 || a > 11 || Math.abs(b) > 7.2) { const c = w(Math.max(0.3, Math.min(11, a)), Math.max(-7.2, Math.min(7.2, b))); ball.p.x = c.x; ball.p.z = c.z; ball.v.x *= -0.5; ball.v.z *= -0.5; }
      if (ball.t > 0.35 && ball.p.y < 1.6) {
        let got = -1, bd = 0.85;
        for (let i = 0; i < 6; i++) { const d = Math.hypot(ball.p.x - bodies[i]!.x, ball.p.z - bodies[i]!.z); if (d < bd) { bd = d; got = i; } }
        if (got >= 0) {
          giveTo(got);
          say(got === 0 ? '搶到籃板！' : teamOf(got) === 0 ? '隊友搶到籃板' : '紅隊搶到籃板', 1);
          if (tut === 3) tutHold = Math.max(tutHold, 0.8);
        }
      }
      return;
    }
    if (ball.s === 'dead') {
      ball.t += dt;
      if (ball.t > 1.1) checkBall(ball.next);
    }
  };

  // --- Tutorial ------------------------------------------------------------------------------
  const tutorialStep = (dt: number): void => {
    if (tut >= 4) return;
    if (tutHold > 0) {
      tutHold -= dt;
      if (tutHold > 0) return;
      tut++;
      if (tut === 1) giveTo(0);
      if (tut === 2 || tut === 3) giveTo(3);
      if (tut === 4) { startGame(); return; }
      say(TUTORIAL[tut]!, 99);
      return;
    }
    if (tut === 0 && holder() > 0 && holder() < 3 && decide <= 0.2) pass(holder(), 0); // the teammate gives it back
    if (tut === 0 && holder() > 0 && holder() < 3) decide -= dt;
    // The red handler shoots once you are close (tutorial step 4).
    if (tut === 3 && holder() === 3 && dist(you, bodies[3]!) < 2.4) shoot(3, null, false);
    // Tutorial step 2/3: the ball came back to someone else; hand it to the right person.
    if (tut === 1 && ball.s === 'held' && ball.by !== 0) giveTo(0);
    if ((tut === 2 || tut === 3) && ball.s === 'held' && ball.by !== 3 && ball.by !== 0) giveTo(3);
    if (tut === 3 && ball.s === 'held' && ball.by === 0 && tutHold <= 0) giveTo(3); // missed the block: again
  };
  const startGame = (): void => {
    tut = 4;
    score = [0, 0];
    clock = GAME_TIME;
    giveTo(0);
    say(`🏀 比賽開始！先拿 ${WIN} 分獲勝`, 2);
  };

  // --- Drawing ---------------------------------------------------------------------------------
  const draw = (dt: number): void => {
    for (let i = 1; i < 6; i++) {
      const b = bodies[i]!;
      if (!b.g) continue;
      b.g.position.set(b.x, 0, b.z);
      const f = facingOf(b);
      b.g.rotation.y = Math.atan2(f.x, f.z);
      const sp = Math.hypot(b.vx, b.vz);
      b.phase += dt * (4 + sp * 2.2);
      const sw = Math.sin(b.phase) * Math.min(0.7, sp * 0.18);
      b.legs[0]!.rotation.x = sw;
      b.legs[1]!.rotation.x = -sw;
      b.g.position.y = Math.abs(Math.sin(b.phase)) * Math.min(0.06, sp * 0.015);
    }
    ballPos(ball.s === 'loose' ? tmp : ballMesh.position);
    if (ball.s === 'loose') ballMesh.position.copy(ball.p);
    ballMesh.rotation.x += dt * 7;
  };

  if (import.meta.env.DEV) (window as unknown as { __streetball: unknown }).__streetball = () => ({ ball, tut, tutHold, score, decide, clock, bodies: bodies.map((b) => [+b.x.toFixed(1), +b.z.toFixed(1)]) });
  return {
    get you() { return score[0]; },
    get them() { return score[1]; },
    start(h) {
      hoop = h;
      running = true;
      over = false;
      tut = 0;
      tutHold = 0;
      score = [0, 0];
      clock = GAME_TIME;
      charging = null;
      cool = 0;
      keys.k = keys.jDown = keys.jUp = keys.y = false;
      const startAt = w(SPOTS[0]![0], 0);
      you.x = startAt.x; you.z = startAt.z;
      [1, 2].forEach((i) => { const p = w(SPOTS[i]![0], SPOTS[i]![1]); Object.assign(bodies[i]!, { x: p.x, z: p.z, vx: 0, vz: 0 }); });
      [3, 4, 5].forEach((i) => { const s = SPOTS[i - 3]!; const p = w(s[0] - 2.2, s[1] * 0.7); Object.assign(bodies[i]!, { x: p.x, z: p.z, vx: 0, vz: 0 }); });
      for (const b of bodies) if (b.g) b.g.visible = true;
      ballMesh.visible = true;
      giveTo(0);
      say(TUTORIAL[0], 99);
      return { x: startAt.x, z: startAt.z, facing: Math.atan2(-h.nx, -h.nz) };
    },
    update(dt, time, px, _py, pz, viewYaw) {
      if (!running || !hoop) return false;
      nowT = time;
      you.vx = (px - you.x) / Math.max(dt, 1e-3);
      you.vz = (pz - you.z) / Math.max(dt, 1e-3);
      you.x = px; you.z = pz;
      viewDir = { x: -Math.sin(viewYaw), z: -Math.cos(viewYaw) };
      cool = Math.max(0, cool - dt);
      if (keys.y && tut < 4) { say('跳過教學', 0.8); startGame(); }
      if (keys.k) yourK();
      if (keys.jDown) yourJDown();
      if (keys.jUp) yourJUp();
      keys.k = keys.jDown = keys.jUp = keys.y = false;
      tutorialStep(dt);
      moveNpcs(dt);
      npcBall(dt);
      pressure(dt);
      stepBall(dt);
      draw(dt);
      if (tut >= 4) {
        clock -= dt;
        if (!over && (score[0] >= WIN || score[1] >= WIN || (clock <= 0 && ball.s !== 'shot'))) {
          over = true;
          return true;
        }
      }
      return false;
    },
    hud() {
      const h = holder();
      const off = offence();
      const hint = tut < 4
        ? 'K 傳球 / 抄球・按住 J 投籃，放開出手・J 蓋火鍋・Y 跳過教學・Q 結束'
        : h === 0 ? 'K 傳球給面向的隊友・按住 J 蓄力，綠色區放開投籃・Q 結束'
          : off === 0 ? 'K 跟隊友要球・跑出空檔・Q 結束'
            : '靠近拿球的紅隊按 K 抄球・對手投籃時按 J 蓋火鍋・Q 結束';
      const mm = Math.floor(Math.max(0, clock) / 60), ss = String(Math.floor(Math.max(0, clock) % 60)).padStart(2, '0');
      return {
        you: score[0],
        them: score[1],
        info: tut < 4 ? `新手教學 ${tut + 1}/4` : `剩 ${mm}:${ss}・先到 ${WIN} 分`,
        charge: charging !== null ? swing(nowT - charging, 1.1) : null,
        sweet: SWEET,
        message: nowT < messageUntil ? message : '',
        hint,
      };
    },
    stop() {
      running = false;
      charging = null;
      for (const b of bodies) if (b.g) b.g.visible = false;
      ballMesh.visible = false;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      for (const b of bodies) b.g?.removeFromParent();
    },
  };
}
