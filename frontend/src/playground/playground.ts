import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from '../campus/campusTypes';
import { GeoBuilder } from '../campus/chunkBuilder';
import { toGeometry } from '../campus/campusWorld';
import { actions, gameStore } from '../state/store';

/**
 * The sports ground east of 司令台: pitch, running track, grandstand steps, flagpole, and the
 * track time-trial mini-game. Everything is laid out in a local frame on the OSM field:
 * +a along the long axis, +b across it, away from 司令台; the home straight is at b = -R.
 */
const MARGIN = 1;
const LANE_WIDTH = 5;
const LANES = 4;
const COUNTDOWN = 3;
const GATES = 4;
const GATE_REACH = 4.5;
const START_REACH = 3.5;
/** Beyond the track edge by this much (m) for this long (s) ends the run. */
const OFF_TRACK_MARGIN = 3;
const OFF_TRACK_TIME = 1.5;
const FINISH_REWARD = 20;
const RECORD_REWARD = 30;
const CHECK_HEIGHT = 4.4;

export interface Playground {
  /** Player stands at the start line and no run is in progress. */
  canStart(x: number, z: number): boolean;
  /** The start line, where the map teleport lands. */
  readonly startSpot: { x: number; z: number };
  /** Begins the countdown; returns where to place the player. */
  start(testing: boolean): { x: number; z: number; facing: number };
  /** Abandons any run (respawn, teleport). */
  cancel(): void;
  readonly racing: boolean;
  /** Pitch frame (goal at a = +halfLength) for the penalty game. */
  readonly pitch: { toWorld(a: number, b: number): [number, number]; toLocal(x: number, z: number): [number, number]; halfLength: number };
  /** The countdown holds the runner on the line. */
  readonly frozen: boolean;
  /** Returns the coins awarded this frame. */
  update(dt: number, time: number, x: number, z: number): number;
  dispose(): void;
}

function quad(g: GeoBuilder, a0: number, b0: number, a1: number, b1: number, y: number): void {
  const v = (a: number, b: number): number => g.vertex(a, y, b, 0, 1, 0, a / 4, b / 4);
  const p = v(a0, b0), q = v(a1, b0), r = v(a1, b1), s = v(a0, b1);
  g.triUp(p, q, r);
  g.triUp(p, r, s);
}

/** Closed stadium outline at radius r around the two curve centres. */
function outline(S: number, r: number, perCurve = 40): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= perCurve; i++) {
    const t = (i / perCurve) * Math.PI;
    pts.push([S / 2 + r * Math.sin(t), -r * Math.cos(t)]);
  }
  for (let i = 0; i <= perCurve; i++) {
    const t = (i / perCurve) * Math.PI;
    pts.push([-S / 2 - r * Math.sin(t), r * Math.cos(t)]);
  }
  return pts;
}

function ribbon(g: GeoBuilder, S: number, r0: number, r1: number, y: number): void {
  const inner = outline(S, r0), outer = outline(S, r1);
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const v = ([a, b]: [number, number]): number => g.vertex(a, y, b, 0, 1, 0, a / 4, b / 4);
    const p = v(inner[i]!), q = v(outer[i]!), r = v(outer[j]!), s = v(inner[j]!);
    g.triUp(p, q, r);
    g.triUp(p, r, s);
  }
}

function fan(g: GeoBuilder, S: number, r: number, y: number): void {
  const pts = outline(S, r);
  const c = g.vertex(0, y, 0, 0, 1, 0, 0, 0);
  const ids = pts.map(([a, b]) => g.vertex(a, y, b, 0, 1, 0, a / 4, b / 4));
  ids.forEach((id, i) => g.triUp(c, id, ids[(i + 1) % ids.length]!));
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
}

function banner(text: string, sub: string, bg: string, tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fffdf6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "800 58px system-ui, 'PingFang TC', sans-serif";
    g.fillText(text, 256, 52);
    g.font = "700 24px system-ui, 'PingFang TC', sans-serif";
    g.fillText(sub, 256, 106);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return tracker.texture(t);
}

export function createPlayground(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): Playground | null {
  const stand = campus.buildings.find((b) => b.name === '司令台');
  const standX = stand ? stand.outer.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / (stand.outer.length / 2) : 0;
  const field = campus.fields
    .filter((f) => f.kind === 'soccer')
    .sort((p, q) => Math.abs(p.outer[0]! - standX) - Math.abs(q.outer[0]! - standX))[0];
  if (!field || field.outer.length !== 8) return null;

  // --- Field frame ---------------------------------------------------------------------------
  const o = field.outer;
  const cx = (o[0]! + o[2]! + o[4]! + o[6]!) / 4, cz = (o[1]! + o[3]! + o[5]! + o[7]!) / 4;
  const edge = (i: number): [number, number, number] => {
    const j = (i + 1) % 4;
    const dx = o[j * 2]! - o[i * 2]!, dz = o[j * 2 + 1]! - o[i * 2 + 1]!;
    return [dx, dz, Math.hypot(dx, dz)];
  };
  const long = edge(0)[2] >= edge(1)[2] ? edge(0) : edge(1);
  const short = edge(0)[2] >= edge(1)[2] ? edge(1) : edge(0);
  let ax = long[0] / long[2], az = long[1] / long[2];
  let theta = Math.atan2(-az, ax);
  // Group rotation maps local +x to (ax, az) and local +z to (sin θ, cos θ); keep +b away from 司令台.
  if (stand && Math.sin(theta) * (standX - cx) > 0) {
    ax = -ax;
    az = -az;
    theta = Math.atan2(-az, ax);
  }
  const bx = Math.sin(theta), bz = Math.cos(theta);
  const toWorld = (a: number, b: number): [number, number] => [cx + a * ax + b * bx, cz + a * az + b * bz];
  const toLocal = (x: number, z: number): [number, number] => [(x - cx) * ax + (z - cz) * az, (x - cx) * bx + (z - cz) * bz];

  const outerR = short[2] / 2 - MARGIN;
  const S = Math.max(0, long[2] - 2 * outerR - 2 * MARGIN);
  const innerR = outerR - LANE_WIDTH;
  const R = outerR - LANE_WIDTH / 2; // the racing line
  const lap = 2 * S + 2 * Math.PI * R;

  const root = new Group();
  root.name = 'playground';
  root.position.set(cx, 0, cz);
  root.rotation.y = theta;
  scene.add(root);

  // --- Ground surfaces -------------------------------------------------------------------------
  const flat = (color: number, units: number): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.92, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -units, polygonOffsetUnits: -units * 2 }));
  const addFlat = (g: GeoBuilder, color: number, units: number): void => {
    const buf = g.build();
    if (!buf) return;
    const m = new Mesh(tracker.geometry(toGeometry(buf)), flat(color, units));
    m.receiveShadow = true;
    root.add(m);
  };
  const grass = new GeoBuilder();
  fan(grass, S, innerR, 0.05);
  for (let k = 0; k < 10; k++) {
    // Mown stripes across the pitch.
    if (k % 2) continue;
    const w = 75 / 10;
    quad(grass, -37.5 + k * w, -22, -37.5 + (k + 1) * w, 22, 0.055);
  }
  addFlat(grass, 0x4f8a3c, 5);

  const track = new GeoBuilder();
  ribbon(track, S, innerR, outerR, 0.06);
  addFlat(track, 0xb5503c, 6);

  const white = new GeoBuilder();
  const L = 0.07; // half line width
  for (let k = 0; k <= LANES; k++) {
    const r = innerR + (k * LANE_WIDTH) / LANES;
    ribbon(white, S, r - L, r + L, 0.07);
  }
  const rect = (a0: number, b0: number, a1: number, b1: number): void => {
    quad(white, a0 - L, b0 - L, a1 + L, b0 + L, 0.07);
    quad(white, a0 - L, b1 - L, a1 + L, b1 + L, 0.07);
    quad(white, a0 - L, b0 - L, a0 + L, b1 + L, 0.07);
    quad(white, a1 - L, b0 - L, a1 + L, b1 + L, 0.07);
  };
  const HL = 37.5, HW = 22;
  rect(-HL, -HW, HL, HW);
  quad(white, -L, -HW, L, HW, 0.07);
  for (const s of [-1, 1]) {
    rect(Math.min(s * HL, s * (HL - 14)), -14, Math.max(s * HL, s * (HL - 14)), 14);
    rect(Math.min(s * HL, s * (HL - 5)), -7, Math.max(s * HL, s * (HL - 5)), 7);
  }
  const CIRCLE = 48;
  for (let i = 0; i < CIRCLE; i++) {
    const t0 = (i / CIRCLE) * Math.PI * 2, t1 = ((i + 1) / CIRCLE) * Math.PI * 2;
    const v = (r: number, t: number): number => white.vertex(Math.cos(t) * r, 0.07, Math.sin(t) * r, 0, 1, 0, 0, 0);
    const p = v(6.8, t0), q = v(7, t0), r = v(7, t1), s = v(6.8, t1);
    white.triUp(p, q, r);
    white.triUp(p, r, s);
  }
  // Start / finish line across the home straight.
  quad(white, -0.2, -outerR, 0.2, -innerR, 0.072);
  addFlat(white, 0xf6f4ee, 7);

  // --- Goals, start gantry, moving checkpoint gate --------------------------------------------
  const paint = tracker.material(new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }));
  const P = 0.07;
  const goalParts = [-1, 1].flatMap((s) => {
    const x = s * HL;
    return [box(P, 2.44, P, x, 1.22, -3.66), box(P, 2.44, P, x, 1.22, 3.66), box(P, P, 7.4, x, 2.44, 0)];
  });
  const goals = new Mesh(tracker.geometry(mergeGeometries(goalParts)!), paint);
  goals.castShadow = true;
  root.add(goals);
  const net = new Mesh(tracker.geometry(mergeGeometries([-1, 1].map((s) => new PlaneGeometry(7.3, 2.4).rotateY(Math.PI / 2).translate(s * (HL + 1), 1.2, 0)))!), tracker.material(new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false })));
  root.add(net);

  const halfGate = LANE_WIDTH / 2 + 0.6;
  const archGeo = tracker.geometry(mergeGeometries([box(0.16, CHECK_HEIGHT, 0.16, 0, CHECK_HEIGHT / 2, -halfGate), box(0.16, CHECK_HEIGHT, 0.16, 0, CHECK_HEIGHT / 2, halfGate)])!);
  const gantry = new Group();
  gantry.position.set(0, 0, -R);
  const posts = new Mesh(archGeo, paint);
  posts.castShadow = true;
  const startBoard = new Mesh(
    tracker.geometry(new BoxGeometry(0.1, 1, halfGate * 2)),
    [paint, paint, paint, paint, paint, paint].map((m, i) => (i < 2 ? tracker.material(new MeshStandardMaterial({ map: banner('起跑線', '按 E 開始計時賽', '#1f8f4a', tracker), roughness: 0.6 })) : m)),
  );
  startBoard.position.y = CHECK_HEIGHT - 0.4;
  gantry.add(posts, startBoard);
  root.add(gantry);

  const glow = tracker.material(new MeshStandardMaterial({ color: 0xf2c230, emissive: 0xf2a020, emissiveIntensity: 0.8, roughness: 0.4 }));
  const gate = new Group();
  const gatePosts = new Mesh(archGeo, glow);
  const gateBar = new Mesh(tracker.geometry(new BoxGeometry(0.22, 0.5, halfGate * 2)), glow);
  gateBar.position.y = CHECK_HEIGHT - 0.3;
  gate.add(gatePosts, gateBar);
  gate.visible = false;
  root.add(gate);

  // --- Grandstand steps and flagpole, on 司令台's wall facing the ground ------------------------
  const colliders: RAPIER.Collider[] = [];
  let flag: Mesh | null = null;
  if (stand) {
    const r = stand.outer;
    const n = r.length / 2;
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = r[j * 2]! - r[i * 2]!, dz = r[j * 2 + 1]! - r[i * 2 + 1]!, len = Math.hypot(dx, dz);
      const nx = dz / len, nz = -dx / len;
      const score = len * (nx * (cx - r[i * 2]!) + nz * (cz - r[i * 2 + 1]!) > 0 ? 1 : -1);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    const j = (best + 1) % n;
    const dx = r[j * 2]! - r[best * 2]!, dz = r[j * 2 + 1]! - r[best * 2 + 1]!, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
    const mx = (r[best * 2]! + r[j * 2]!) / 2, mz = (r[best * 2 + 1]! + r[j * 2 + 1]!) / 2;
    const yaw = Math.atan2(nx, nz); // local +z points away from the wall
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const STEPS = 4, RISE = 0.3, TREAD = 0.75, WIDTH = Math.min(len - 6, 26);
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < STEPS; i++) {
      const depth = (STEPS - i) * TREAD, h = RISE;
      parts.push(box(WIDTH, h, depth, 0, RISE * i + h / 2, depth / 2));
      const wx = mx + nx * (depth / 2), wz = mz + nz * (depth / 2);
      colliders.push(tracker.collider(physics.createCollider(
        RAPIER.ColliderDesc.cuboid(WIDTH / 2, RISE * (i + 1) / 2, depth / 2).setTranslation(wx, RISE * (i + 1) / 2, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      )));
    }
    const steps = new Mesh(tracker.geometry(mergeGeometries(parts)!), tracker.material(new MeshStandardMaterial({ color: 0xc9c5ba, roughness: 0.9 })));
    steps.position.set(mx, 0, mz);
    steps.rotation.y = yaw;
    steps.castShadow = true;
    steps.receiveShadow = true;
    scene.add(steps);

    const pole = new Mesh(tracker.geometry(new BoxGeometry(0.12, 11, 0.12)), paint);
    const px = mx + nx * 6, pz = mz + nz * 6;
    pole.position.set(px, 5.5, pz);
    pole.castShadow = true;
    scene.add(pole);
    flag = new Mesh(tracker.geometry(new PlaneGeometry(2.1, 1.3).translate(1.05, 0, 0)), tracker.material(new MeshStandardMaterial({ map: banner('雲寶寶', '上學趣', '#2c6fd6', tracker), side: DoubleSide, roughness: 0.8 })));
    flag.position.set(px, 10.2, pz);
    scene.add(flag);
  }

  // --- Time trial ------------------------------------------------------------------------------
  /** Local point and travel direction at distance s along the racing line, from the start. */
  const pathAt = (s: number): { a: number; b: number; ha: number; hb: number } => {
    let d = ((s % lap) + lap) % lap;
    if (d < S / 2) return { a: d, b: -R, ha: 1, hb: 0 };
    d -= S / 2;
    const curve = Math.PI * R;
    if (d < curve) {
      const t = d / R;
      return { a: S / 2 + R * Math.sin(t), b: -R * Math.cos(t), ha: Math.cos(t), hb: Math.sin(t) };
    }
    d -= curve;
    if (d < S) return { a: S / 2 - d, b: R, ha: -1, hb: 0 };
    d -= S;
    if (d < curve) {
      const t = d / R;
      return { a: -S / 2 - R * Math.sin(t), b: R * Math.cos(t), ha: -Math.cos(t), hb: -Math.sin(t) };
    }
    d -= curve;
    return { a: -S / 2 + d, b: -R, ha: 1, hb: 0 };
  };
  const offLine = (a: number, b: number): number => {
    const ca = Math.max(-S / 2, Math.min(S / 2, a));
    return Math.abs(Math.hypot(a - ca, b) - R);
  };

  type Run = { phase: 'countdown' | 'running'; clock: number; next: number; off: number; testing: boolean; shownTenth: number; shownSec: number };
  let run: Run | null = null;

  const placeGate = (k: number): void => {
    const p = pathAt((lap * k) / GATES);
    gate.position.set(p.a, 0, p.b);
    gate.rotation.y = Math.atan2(-p.hb, p.ha);
    gate.visible = true;
  };
  const end = (message: string | null): void => {
    run = null;
    gate.visible = false;
    actions.setRace(null);
    if (message) actions.toast(message);
  };
  const publish = (r: Run): void => {
    actions.setRace({
      phase: r.phase,
      countdown: Math.ceil(COUNTDOWN - r.clock),
      time: r.phase === 'running' ? r.clock : 0,
      gate: r.next,
      gates: GATES,
      testing: r.testing,
    });
  };
  const startPoint = toWorld(0, -R);

  return {
    get racing() { return run !== null; },
    pitch: { toWorld, toLocal, halfLength: HL },
    get frozen() { return run?.phase === 'countdown'; },
    startSpot: { x: startPoint[0], z: startPoint[1] },
    canStart(x, z) {
      return run === null && Math.hypot(x - startPoint[0], z - startPoint[1]) < START_REACH;
    },
    start(testing) {
      run = { phase: 'countdown', clock: 0, next: 1, off: 0, testing, shownTenth: -1, shownSec: -1 };
      publish(run);
      return { x: startPoint[0], z: startPoint[1], facing: Math.atan2(ax, az) };
    },
    cancel() {
      if (run) end(null);
    },
    update(dt, time, x, z) {
      if (flag) flag.rotation.y = Math.sin(time * 1.7) * 0.22;
      if (!run) return 0;
      run.clock += dt;
      if (run.phase === 'countdown') {
        if (run.clock >= COUNTDOWN) {
          run.phase = 'running';
          run.clock = 0;
          placeGate(run.next);
          publish(run);
        } else if (Math.ceil(COUNTDOWN - run.clock) !== run.shownSec) {
          run.shownSec = Math.ceil(COUNTDOWN - run.clock);
          publish(run);
        }
        return 0;
      }
      const [a, b] = toLocal(x, z);
      run.off = offLine(a, b) > LANE_WIDTH / 2 + OFF_TRACK_MARGIN ? run.off + dt : 0;
      if (run.off > OFF_TRACK_TIME) {
        end('離開跑道，計時賽取消');
        return 0;
      }
      const target = pathAt((lap * run.next) / GATES);
      if (Math.hypot(a - target.a, b - target.b) < GATE_REACH) {
        if (run.next < GATES) {
          run.next++;
          placeGate(run.next);
          publish(run);
          return 0;
        }
        const t = run.clock, testing = run.testing;
        end(null);
        if (testing) {
          actions.toast(`完賽 ${t.toFixed(2)} 秒（測試員模式不計成績）`);
          return 0;
        }
        const best = gameStore.getState().raceBest;
        const record = best === null || t < best;
        if (record) actions.setRaceBest(t);
        actions.toast(record ? `🏅 新紀錄 ${t.toFixed(2)} 秒！獲得 NT$ ${FINISH_REWARD + RECORD_REWARD}` : `完賽 ${t.toFixed(2)} 秒，獲得 NT$ ${FINISH_REWARD}`);
        return FINISH_REWARD + (record ? RECORD_REWARD : 0);
      }
      const tenth = Math.floor(run.clock * 10);
      if (tenth !== run.shownTenth) {
        run.shownTenth = tenth;
        publish(run);
      }
      return 0;
    },
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
