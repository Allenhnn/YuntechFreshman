import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, type Scene } from 'three';
import { playerName, studentId } from '../state/playerName';
import type { CampusData } from '../campus/campusTypes';
import type { ResourceTracker } from '../core/resources';
import { ITEMS, type ItemId } from '../state/items';
import { actions, gameStore } from '../state/store';
import { achievementById, sideById, storyActions, storyStore, type StoryProgress, type StoryScene } from '../state/story';
import {
  ABSENT_FINE, ACTIVITY, LECTURE, RACE_ROUTE, TUTORIAL, CAFETERIA, DAYS, DIALOGS, DORM, FRIEND, PHOTO_SPOTS, ROOMMATE, STALL_IDS, TOUR_FACTS, TOUR_STOPS,
  type SceneId, type SportKind, type Step,
} from './storyData';
import { createBeacons, type Beacon } from './beacons';
import { createNpcs, type NpcSpec } from './npcs';
import { insidePoint as insidePointOf } from '../campus/insidePoint';

/**
 * Runs the first week: checks the current step's condition against what the player does, starts
 * the scenes (dialogs and mini-games in the story modal), keeps side quests and achievements, and
 * publishes the objective for the HUD tracker. Plain logic plus a few markers in the scene (race
 * checkpoints, the lost student card); everything else goes through the store and callbacks.
 */
export interface StoryDeps {
  scene: Scene;
  tracker: ResourceTracker;
  campus: CampusData;
  /** Where a named place is (building centre, court, start line), or null. */
  placeOf(name: string): { x: number; z: number } | null;
  /** Walking route between two points (flat x, z list). */
  route(ax: number, az: number, bx: number, bz: number): number[];
  /** Sets the game clock (absolute minutes since day 1 00:00). */
  setClock(minutes: number): void;
  /** Fade to black, run `mid`, fade back. */
  fade(mid: () => void): void;
  /** Starts navigation without the usual 開始導航 toast when `quiet`. */
  navigate(x: number, z: number, name: string, quiet?: boolean): void;
  openStoryModal(): void;
  closeStoryModal(): void;
  sound(name: 'coin' | 'open' | 'close' | 'click' | 'bell'): void;
  bikeStations: readonly { name: string; x: number; z: number }[];
  /** Walkable surface height at (x, z) (raised plazas, steps). */
  groundAt(x: number, z: number): number;
  /** Places nothing should be put (sunken courtyards). */
  blocked(x: number, z: number): boolean;
  /** 萊爾富 in 學生活動中心: where customers stand and where the clerk stands. */
  hilife: { counter: { x: number; z: number }; clerk: { x: number; z: number } } | null;
  /** Puts the player lying in a bed of `place`; false while its interior is not loaded. */
  putInBed(place: string): boolean;
  /** Walking speed (m/s) for the roll-call time limit. */
  walkSpeed: number;
  /** Nearest point on a campus road or walkway. */
  snapToRoad(x: number, z: number): { x: number; z: number };
  /** Pops the phone up on a chat thread (a message the story wants you to read now). */
  openPhone(from: string): void;
}

export interface StoryFrame {
  x: number;
  /** Height of the feet (floor level inside buildings). */
  y: number;
  z: number;
  /** Area title (building name, 操場, 大門) or null outdoors. */
  area: string | null;
  minutes: number;
  riding: boolean;
  sprinting: boolean;
  playing: boolean;
  /** Camera yaw (view direction = −(sin, cos)) for the tracker arrow. */
  viewYaw: number;
  /** Building whose chair you sit on, or null. */
  seatedIn: string | null;
  /** Jumps so far (the tutorial counts one). */
  jumps: number;
  /** Open window ('none', 'phone', 'inventory', …). */
  modal: string;
  lying: boolean;
  /** Code of the room whose chair you sit on (MA214), or null. */
  seatedRoom: string | null;
}

export type SceneResult =
  | { kind: 'dialog' }
  | { kind: 'rollcall'; ok: boolean }
  | { kind: 'quiz'; score: number; cheated: boolean; caught: boolean }
  | { kind: 'mixer'; score: number }
  | { kind: 'wake'; ok: boolean }
  | { kind: 'clubFair' }
  | { kind: 'summary' }
  | { kind: 'stayAwake'; ok: boolean }
  | { kind: 'wardrobe' };

export interface StoryRuntime {
  update(dt: number, f: StoryFrame): void;
  /** The E prompt the story offers here, or null. */
  prompt(f: StoryFrame): string | null;
  /** Handles E: 'done' when the story used it, 'hilife' to open the 萊爾富 shop, null when not. */
  interact(f: StoryFrame): 'done' | 'hilife' | null;
  /** Refusal for opening a door into `room` of `building` right now (Day 1: only the class's room), or null. */
  roomGate(building: string, room: string | undefined): string | null;
  /** Movement speed multiplier (race stamina). */
  readonly speedFactor: number;
  /** Navigate to the current objective. */
  guide(): void;
  /** New game: fresh story from Day 1. */
  restart(): void;
  // Admin (管理員模式).
  jump(day: number, step: number): void;
  completeStep(): void;
  dispose(): void;
}

/** Game events reported from elsewhere (session, main loop, UI). No-ops until the runtime exists. */
export const storyEvents = {
  buy: (_menu: string | undefined): void => undefined,
  eat: (_item: ItemId): void => undefined,
  steal: (_item: ItemId): void => undefined,
  photo: (_area: string | null): void => undefined,
  bikeHit: (): void => undefined,
  /** Took a cyclist's bike. */
  robBike: (): void => undefined,
  /** Went into a pond (by name). */
  lake: (_name: string): void => undefined,
  bikeMoved: (_metres: number): void => undefined,
  mount: (): void => undefined,
  dismount: (_x: number, _z: number): void => undefined,
  sport: (_kind: string, _score: number): void => undefined,
  /** Sat down on a chair / lay down on a bed (building name), and got up again. */
  sit: (_kind: 'chair' | 'bed', _building: string): void => undefined,
  stand: (_kind: 'chair' | 'bed'): void => undefined,
  /** Tapped a quick reply in the chat app. */
  chat: (_to: string, _reply: string): void => undefined,
  /** Entered a code in the 點名系統 app; true when it signs you in. */
  rollcallCode: (_code: string): boolean => false,
  track: (_seconds: number): void => undefined,
  /** The story modal reports how a scene ended. */
  finishScene: (_r: SceneResult): void => undefined,
};

const dayStart = (day: number, minuteOfDay: number): number => (day - 1) * 1440 + minuteOfDay;
/** Seconds of lecture before the stay-awake game starts. */
const LECTURE_INTRO = 14;

export function createStoryRuntime(d: StoryDeps): StoryRuntime {
  const st = () => storyStore.getState();
  const prog = (): StoryProgress => st().progress;
  const on = (): boolean => st().enabled;
  const currentStep = (): Step | null => {
    const p = prog();
    return DAYS[p.day - 1]?.steps[p.step] ?? null;
  };
  const toast = (t: string): void => actions.toast(t);

  // --- Achievements ---------------------------------------------------------------------------
  const unlock = (id: string): void => {
    const a = achievementById.get(id);
    if (!a || a.unavailable || !st().achievementsOn || prog().achievements[id]) return;
    storyActions.update((p) => ({ ...p, achievements: { ...p.achievements, [id]: Date.now() } }));
    storyActions.unlocked(id);
    d.sound('coin');
  };
  const setFlags = (patch: StoryProgress['flags']): void => storyActions.update((p) => ({ ...p, flags: { ...p.flags, ...patch } }));

  // --- Steps ----------------------------------------------------------------------------------
  /** Effects when a step begins (clock, items, message); `quiet` on load. */
  const begin = (): void => {
    resetTransient();
    const p = prog();
    const step = currentStep();
    if (!step) return;
    if (step.at !== undefined) {
      const target = dayStart(p.day, step.at);
      if (gameStore.getState().gameMinutes < target || step.id.endsWith('-1')) d.setClock(target);
    }
    if (step.give && !actions.hasItem(step.give)) actions.giveItem(step.give);
    if (step.say) toast(step.say);
    if (step.wake) { wakeFor = 20; wakeTried = true; }
    if (step.msg) {
      const m = step.msg;
      window.setTimeout(() => {
        storyActions.message(m.from, m.text, !!step.quietMsg); // quiet: a notification only (the tutorial asks for P)
        d.sound('open');
        if (m.from === ROOMMATE) storyActions.setReplies(ROOMMATE, [{ id: 'otw', text: '馬上到！' }, { id: 'ok', text: '收到 👍' }]);
        if (!step.quietMsg) d.openPhone(m.from); // the phone pops up on the chat, not a message over the game
      }, step.wake ? 1500 : 400);
    }
  };
  const advance = (): void => {
    const p = prog();
    const step = currentStep();
    if (!step) return;
    // 早起的鳥兒: the day's second objective done before 08:30.
    if (p.step === 1 && gameStore.getState().gameMinutes % 1440 < 8 * 60 + 30) unlock('earlyBird');
    const day = DAYS[p.day - 1]!;
    const last = p.step + 1 >= day.steps.length;
    storyActions.update((q) => ({ ...q, day: last ? q.day + 1 : q.day, step: last ? 0 : q.step + 1 }));
    d.sound('coin');
    if (last && p.day < DAYS.length) {
      toast(`🌙 Day ${p.day}「${day.title}」結束`);
      storyActions.celebrate(`Day ${p.day} 完成！`, `「${day.title}」・明天是 Day ${p.day + 1}「${DAYS[p.day]!.title}」`);
    }
    else if (!last) toast(`✅ ${step.text}`);
    if (gameStore.getState().nav) actions.setNav(null);
    if (step.doneAt !== undefined) {
      d.setClock(dayStart(p.day, step.doneAt));
      toast('🌆 打到天都黑了…');
    }
    begin();
  };

  // --- Transient state (not saved: a reload restarts the step) --------------------------------
  /** Roll call: `timed` counts down until you sit in the classroom. */
  let cls: { phase: 'idle' | 'timed' | 'done'; t: number; limit: number } = { phase: 'idle', t: 0, limit: 0 };
  /** Seconds left to find the dorm bed to wake up in (it streams in), 0 when not waking. */
  let wakeFor = 0;
  let wasLying = false;
  let wakeTried = false;
  let wrongRoomToast = false;
  /** Day 1: told once that the class is upstairs, on entering 管理一館 on the ground floor. */
  let floorHint = false;
  /** The live countdown object, reused while it does not change (the store compares by identity). */
  let cdCache: { label: string; left: number; total: number; where: string } | null = null;
  const cdOf = (left: number, total: number, where: string): NonNullable<typeof cdCache> => {
    if (!cdCache || cdCache.left !== left || cdCache.total !== total || cdCache.where !== where) cdCache = { label: '點名倒數', left, total, where };
    return cdCache;
  };
  /** The digital roll call's code (in the chat), null when none is open. */
  let rcCode: string | null = null;
  /** The step the automatic navigation was started for. */
  let autoNavFor: string | null = null;
  /** 新手教學 progress: the task index and where it started. */
  let tut: { i: number; x: number; z: number; walked: number; jumps: number; hold: number } | null = null;
  /** Seconds of lecture heard in the classroom (the class gets going before drowsiness sets in). */
  let lectureT = 0;
  let bellRung = false;
  let run: { points: { x: number; z: number }[]; next: number; t: number; started: boolean; stamina: number; tired: boolean } | null = null;
  let speedFactor = 1;
  let pendingScene: SceneId | null = null;
  const resetTransient = (): void => {
    cls = { phase: 'idle', t: 0, limit: 0 };
    wakeFor = 0;
    wrongRoomToast = false;
    floorHint = false;
    tut = null;
    lectureT = 0;
    bellRung = false;
    storyActions.setLive({ tutorial: null, lecture: null });
    wakeTried = false;
    wasLying = false;
    rcCode = null;
    storyActions.setRollcall(null);
    clearRun();
    speedFactor = 1;
  };

  // --- Race checkpoints -----------------------------------------------------------------------
  const ringMat = d.tracker.material(new MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.85 }));
  const nextMat = d.tracker.material(new MeshBasicMaterial({ color: 0x1f8f4a, transparent: true, opacity: 0.9 }));
  const archGeo = d.tracker.geometry(new TorusGeometry(3.2, 0.18, 8, 32, Math.PI));
  const markers: Mesh[] = [];
  const clearRun = (): void => {
    for (const m of markers) d.scene.remove(m);
    markers.length = 0;
    run = null;
  };
  const startRun = (): void => {
    const start = d.placeOf('路跑起點');
    if (!start) return;
    // The fixed event route: an arch at every turn, each snapped onto the walkway graph.
    const points: { x: number; z: number }[] = [];
    let from = start;
    for (const s of RACE_ROUTE.slice(1)) {
      const end = d.snapToRoad(s.x, s.z);
      points.push(end);
      from = end;
    }
    void from;
    run = { points, next: 0, t: 0, started: false, stamina: 1, tired: false };
    points.forEach((p, i) => {
      const m = new Mesh(archGeo, i === 0 ? nextMat : ringMat);
      m.position.set(p.x, 0, p.z);
      const nx = points[i + 1] ?? start;
      m.rotation.y = Math.atan2(nx.x - p.x, nx.z - p.z) + Math.PI / 2;
      d.scene.add(m);
      markers.push(m);
    });
    run.started = false;
    const r = run;
    actions.startCountdown(() => {
      r.started = true;
      toast('🏁 開跑！依序通過拱門，綠色是下一個');
    });
    d.navigate(points[0]!.x, points[0]!.z, RACE_ROUTE[1]!.name, true);
  };
  /** Target time for 路跑之神: total route at a steady 5.5 m/s. */
  const runTarget = (): number => {
    if (!run) return Infinity;
    let len = 0, px = d.placeOf('路跑起點')?.x ?? 0, pz = d.placeOf('路跑起點')?.z ?? 0;
    for (const p of run.points) { len += Math.hypot(p.x - px, p.z - pz) * 1.25; px = p.x; pz = p.z; }
    return len / 5.5;
  };

  // --- Beacons and characters -----------------------------------------------------------------
  const beacons = createBeacons(d.scene, d.tracker);
  const npcs = createNpcs(d.scene, d.tracker);
  const insideCache = new Map<string, { x: number; z: number } | null>();
  const insidePoint = (name: string): { x: number; z: number } | null => {
    if (!insideCache.has(name)) insideCache.set(name, insidePointOf(d.campus, name) ?? d.placeOf(name));
    return insideCache.get(name)!;
  };
  const LOOKS = {
    nurse: { shirt: 0xffffff, pants: 0xf8bbd0, hair: 0x2b211b, hat: 0xffffff },
    roommate: { shirt: 0x2c6fd6, pants: 0x34495e, hair: 0x1c1a19 },
    teacher: { shirt: 0x6d6d73, pants: 0x1f1f24, hair: 0x4a3a2a },
    principal: { shirt: 0x1f1f24, pants: 0x1f1f24, hair: 0x9ea4aa },
    clerk: { shirt: 0xd8553a, pants: 0x1f1f24, hair: 0x1c1a19, hat: 0x2c6fd6 },
    staff: { shirt: 0x26a69a, pants: 0x34495e, hair: 0x2b211b },
    guard: { shirt: 0x37474f, pants: 0x1f1f24, hair: 0x1c1a19, hat: 0x263238 },
  };
  const near = (p: { x: number; z: number } | null, dx: number, dz: number): { x: number; z: number } | null => (p ? { x: p.x + dx, z: p.z + dz } : null);
  const npcSpecs = (): NpcSpec[] => {
    const out: NpcSpec[] = [];
    const add = (key: string, name: string, p: { x: number; z: number } | null, look: NpcSpec['look'], talk = false): void => {
      if (p && !d.blocked(p.x, p.z)) out.push({ key, name, x: p.x, z: p.z, y: d.groundAt(p.x, p.z), look, talk });
    };
    const step = on() ? currentStep() : null;
    const scene = step?.cond.t === 'talk' ? step.cond.scene : null;
    const dormYard = near(d.placeOf(DORM), 3, 2);
    if (scene === 'nurse') add('nurse', '健康中心護理師', near(insidePoint(ACTIVITY), -3, 0), LOOKS.nurse, true);
    if (scene === 'roommateD2' || scene === 'bibD3' || scene === 'summary') add('roommate', '室友阿凱', dormYard, LOOKS.roommate, true);
    if (scene === 'assembly') add('principal', '校長', insidePoint('國際會議廳'), LOOKS.principal, true);
    if (scene === 'mixer') {
      const c = insidePoint(ACTIVITY);
      add('mx1', '小美（設計系）', near(c, -2, 2), { shirt: 0xf48fb1, pants: 0x9a8a6c, hair: 0x3d2b20 }, true);
      add('mx2', '阿哲（資工系）', near(c, 0, 3), { shirt: 0x37474f, pants: 0x2d3a5c, hair: 0x151515 }, true);
      add('mx3', '小安（企管系）', near(c, 2, 2), { shirt: 0xf2c230, pants: 0x2d3a5c, hair: 0x2b211b }, true);
    }
    if (scene === 'clubFair') {
      const c = insidePoint(ACTIVITY);
      add('cl1', '🎸 吉他社', near(c, -3, 3), { shirt: 0x8a5bd6, pants: 0x1f1f24, hair: 0x151515 }, true);
      add('cl2', '📷 攝影社', near(c, 0, 4), { shirt: 0x26a69a, pants: 0x34495e, hair: 0x2b211b }, true);
      add('cl3', '🏀 籃球社', near(c, 3, 3), { shirt: 0xf08a24, pants: 0x1f1f24, hair: 0x1c1a19 }, true);
    }
    if (step && step.cond.t === 'quiz') add('teacher', '老師', insidePoint(step.place), LOOKS.teacher);
    if (d.hilife) add('clerk', '萊爾富店員', d.hilife.clerk, LOOKS.clerk);
    if (side('lostFound')?.state === 'active' && actions.hasItem('lostCard')) {
      add('desk', '服務台人員', insidePoint('行政大樓'), LOOKS.staff, true);
      add('guard', '警衛伯伯', insidePoint('警衛室'), LOOKS.guard, true);
    }
    return out;
  };
  /** Characters each conversation needs you to walk up to (scenes not listed happen at the place). */
  const SCENE_NPCS: Partial<Record<SceneId, string[]>> = {
    nurse: ['nurse'], roommateD2: ['roommate'], bibD3: ['roommate'], summary: ['roommate'], assembly: ['principal'],
    mixer: ['mx1', 'mx2', 'mx3'], clubFair: ['cl1', 'cl2', 'cl3'], lostFound: ['desk', 'guard'],
  };
  const TALK_R = 2.6;
  let lastNpcs: NpcSpec[] = [];
  const npcsFor = (scene: SceneId): NpcSpec[] => lastNpcs.filter((n) => SCENE_NPCS[scene]?.includes(n.key));
  /** Whether you are close enough to start `scene` (always, for scenes without a character). */
  const closeTo = (scene: SceneId, f: StoryFrame): boolean => {
    if (!SCENE_NPCS[scene]) return true;
    return npcsFor(scene).some((n) => Math.hypot(n.x - f.x, n.z - f.z) < TALK_R);
  };
  /** Where the step happens: the character to talk to if there is one, else the place. */
  const stepTarget = (step: Step): { x: number; z: number } | null => {
    if (step.cond.t === 'talk') {
      const n = npcsFor(step.cond.scene)[0];
      if (n) return { x: n.x, z: n.z };
    }
    if (step.room) { const r = d.placeOf(step.room); if (r) return r; }
    return d.placeOf(step.place);
  };
  const ICON: Record<string, string> = { talk: '💬', buy: '🛒', eat: '🍱', sport: '🏀', class: '📚', sleep: '🛏️', run: '🏁', quiz: '📝', enter: '📍', scene: '📚', getUp: '⏰', phoneRollcall: '📱', outfit: '👕' };
  const beaconList = (f: StoryFrame): Beacon[] => {
    const out: Beacon[] = [];
    const add = (key: string, p: { x: number; z: number } | null, icon: string, color: number, main = false): void => {
      if (p) out.push({ key, x: p.x, z: p.z, icon, color, main });
    };
    const step = on() ? currentStep() : null;
    const nav = gameStore.getState().nav;
    if (nav) add('nav', { x: nav.x, z: nav.z }, '🏁', 0x2f6fd0, true);
    const tgt = step ? stepTarget(step) : null;
    const there = step && (step.cond.t === 'talk' ? closeTo(step.cond.scene, f) && inPlace(f, step.place) : inPlace(f, step.place));
    if (step && tgt && step.cond.t !== 'run' && !there && !(nav && Math.hypot(nav.x - tgt.x, nav.z - tgt.z) < 20)) add('main', tgt, ICON[step.cond.t] ?? '📍', 0xf08a24, true);
    if (!on()) return out;
    if (cardAt) add('card', cardAt, '✨', 0x4fc3f7);
    const tour = side('tour');
    if (tour?.state === 'active') { const next = TOUR_STOPS.find((n) => !tour.done.includes(n)); if (next) add('tour', d.placeOf(next), '🚩', 0x1f8f4a); }
    const photo = side('photo');
    if (photo?.state === 'active') for (const n of PHOTO_SPOTS) if (!photo.done.includes(n)) add(`photo:${n}`, d.placeOf(n), '📸', 0x2c6fd6);
    if (side('lostFound')?.state === 'active' && actions.hasItem('lostCard')) {
      add('lost1', d.placeOf('行政大樓'), '🪪', 0x4fc3f7);
      add('lost2', d.placeOf('警衛室'), '🪪', 0x4fc3f7);
    }
    const bike = side('bikeReturn');
    if (bike?.state === 'active') { const t = d.bikeStations.find((b) => b.name === bike.target); if (t) add('bike', t, '🚲', 0xd8553a); }
    if (side('foodie')?.state === 'active') add('foodie', d.placeOf(CAFETERIA), '🍱', 0xf2c230);
    const ath = side('athlete');
    if (ath?.state === 'active') {
      if (!ath.done.includes('volleyball')) add('ath:v', d.placeOf('排球場'), '🏐', 0x8a5bd6);
      if (!ath.done.includes('soccer')) add('ath:s', d.placeOf('足球場'), '⚽', 0x8a5bd6);
      if (!ath.done.includes('track')) add('ath:t', d.placeOf('操場'), '🏃', 0x8a5bd6);
    }
    return out;
  };
  let visualsAt = -1;

  // --- Lost student card (side quest) ---------------------------------------------------------
  const cardMesh = new Mesh(d.tracker.geometry(new BoxGeometry(0.5, 0.04, 0.32)), d.tracker.material(new MeshStandardMaterial({ color: 0x4fc3f7, emissive: 0x1e88e5, emissiveIntensity: 0.9 })));
  const glow = new Mesh(d.tracker.geometry(new CylinderGeometry(1.0, 1.0, 0.02, 24)), d.tracker.material(new MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.35 })));
  cardMesh.add(glow);
  glow.position.y = -0.1;
  let cardAt: { x: number; z: number } | null = null;
  let cardY = 0;
  const walkPoints: number[] = [];
  for (const r of d.campus.roads) if (r.kind === 'walkway') for (let i = 0; i < r.points.length; i += 2) walkPoints.push(r.points[i]!, r.points[i + 1]!);
  const placeCard = (x: number, z: number): void => {
    for (let tries = 0; tries < 60; tries++) {
      const i = Math.floor(Math.random() * (walkPoints.length / 2));
      const cx = walkPoints[i * 2]!, cz = walkPoints[i * 2 + 1]!;
      const dd = Math.hypot(cx - x, cz - z);
      if (dd > 40 && dd < 140 && !d.blocked(cx, cz)) {
        cardAt = { x: cx, z: cz };
        cardY = d.groundAt(cx, cz);
        cardMesh.position.set(cx, cardY + 0.2, cz);
        d.scene.add(cardMesh);
        return;
      }
    }
  };

  // --- Side quests ----------------------------------------------------------------------------
  const side = (id: string) => prog().side[id];
  const startSide = (id: string, target?: string): void => {
    if (!on() || side(id)) return;
    storyActions.update((p) => ({ ...p, side: { ...p.side, [id]: { state: 'active', done: [], ...(target ? { target } : {}) } } }));
    toast(`📌 新支線：${sideById.get(id)?.title ?? id}`);
    d.sound('open');
  };
  const sideProgress = (id: string, item: string): void => {
    const s = side(id);
    const q = sideById.get(id);
    if (!on() || !s || s.state !== 'active' || !q || s.done.includes(item)) return;
    const done = [...s.done, item];
    const finished = done.length >= q.total;
    storyActions.update((p) => ({ ...p, side: { ...p.side, [id]: { ...s, done, state: finished ? 'done' : 'active' } } }));
    if (finished) {
      if (q.reward.coins) actions.addCoins(q.reward.coins);
      storyActions.celebrate(`支線完成：${q.title}`, [q.reward.coins ? `+NT$ ${q.reward.coins}` : '', q.reward.title ? `獲得稱號「${q.reward.title}」` : ''].filter(Boolean).join('　'));
      toast(`🎉 支線完成：${q.title}${q.reward.coins ? `　+NT$ ${q.reward.coins}` : ''}${q.reward.title ? `　獲得稱號「${q.reward.title}」` : ''}`);
      d.sound('coin');
    } else {
      toast(`📌 ${q.title}：${done.length}/${q.total}`);
    }
  };

  // --- Scenes ---------------------------------------------------------------------------------
  const open = (scene: StoryScene): void => {
    storyActions.openScene(scene);
    d.openStoryModal();
  };
  const playScene = (id: SceneId): void => {
    pendingScene = id;
    if (id === 'rollcall') return; // opened by the class flow
    if (id === 'mixer') return open({ kind: 'mixer' });
    if (id === 'assembly') return open({ kind: 'wake' });
    if (id === 'clubFair') return open({ kind: 'clubFair' });
    if (id === 'summary') return open({ kind: 'summary' });
    if (id === 'stayAwake') return open({ kind: 'stayAwake' });
    if (id === 'wardrobe') return open({ kind: 'wardrobe' });
    const lines = DIALOGS[id];
    if (lines) open({ kind: 'dialog', id, lines });
  };

  storyEvents.finishScene = (r) => {
    const id = pendingScene;
    pendingScene = null;
    storyActions.openScene(null);
    d.closeStoryModal();
    const step = currentStep();
    switch (r.kind) {
      case 'rollcall': {
        storyActions.update((p) => ({ ...p, rollcalls: { ok: p.rollcalls.ok + (r.ok ? 1 : 0), total: p.rollcalls.total + 1 }, flags: r.ok ? p.flags : { ...p.flags, absent: (p.flags.absent ?? 0) + 1 } }));
        if (step?.cond.t === 'class') advance();
        toast(r.ok ? '✅ 點名成功' : '❌ 點名失敗，記一次缺席');
        return;
      }
      case 'quiz': {
        setFlags({ quizScore: r.score, cheated: r.cheated || prog().flags.cheated, caught: r.caught });
        if (r.cheated) unlock('cheat');
        if (r.caught) {
          setFlags({ badRecord: (prog().flags.badRecord ?? 0) + 1 });
          window.setTimeout(() => playScene('office'), 300);
          return; // the office dialog ends the step
        }
        advance();
        toast(`📝 小考成績：${r.score * 20} 分`);
        return;
      }
      case 'stayAwake':
        if (r.ok) { advance(); toast('📚 撐過這堂課了！'); }
        else {
          toast('😴 睡著被教授抓包！重新挑戰這堂課');
          d.sound('close');
          window.setTimeout(() => { if (currentStep()?.cond.t === 'scene' && !st().scene) playScene('stayAwake'); }, 1400);
        }
        return;
      case 'wardrobe':
        if (step?.cond.t === 'outfit') { advance(); toast('😎 帥！出發去聯誼'); }
        return;
      case 'mixer':
        setFlags({ mixer: r.score });
        if (r.score >= 3) unlock('mixerStar');
        advance();
        return;
      case 'wake':
        advance();
        toast(r.ok ? '撐過週會了，好險沒睡著' : '還是睡著了…被教官叫醒');
        return;
      case 'summary':
        unlock('graduateWeek');
        if (prog().rollcalls.total >= 2 && prog().rollcalls.ok === prog().rollcalls.total) unlock('perfectAttendance');
        advance();
        toast('🎓 第一週結束！之後可以自由探索校園，繼續完成支線和成就');
        return;
      default:
        break;
    }
    // Dialog endings.
    if (id === 'lostFound') {
      actions.takeItem('lostCard');
      sideProgress('lostFound', 'returned');
      return;
    }
    if (id === 'nurse') {
      actions.takeItem('healthForm');
      if (!actions.hasItem('studentCard')) actions.giveItem('studentCard');
      const no = prog().studentNo;
      window.setTimeout(() => toast(`🪪 拿到學生證：${playerName()}・${studentId(no)}（背包裡可以拿出來看）`), 1800);
    }
    if (id === 'wakeD1') actions.giveItem('healthForm');
    if (id === 'study') d.setClock(gameStore.getState().gameMinutes + 30);
    if (id === 'office') { advance(); toast('📝 小考成績：0 分'); return; }
    if (id === 'rollcallOk') {
      cls.phase = 'done';
      storyActions.update((p) => ({ ...p, rollcalls: { ok: p.rollcalls.ok + 1, total: p.rollcalls.total + 1 } }));
      toast('✅ 點名成功');
      if (step?.cond.t === 'class') advance();
      return;
    }
    if (step?.cond.t === 'talk' && step.cond.scene === id) advance();
  };

  // --- Events ---------------------------------------------------------------------------------
  storyEvents.buy = (menu) => {
    const step = currentStep();
    if (on() && step?.cond.t === 'buy') {
      if ((step.cond.shop === 'hilife') === (menu === 'hilife')) advance();
    }
    if (menu && STALL_IDS.includes(menu)) {
      startSide('foodie');
      sideProgress('foodie', menu);
    }
  };
  storyEvents.eat = (item) => {
    const step = currentStep();
    if (on() && step?.cond.t === 'eat' && (!step.cond.item || step.cond.item === item)) advance();
  };
  storyEvents.steal = (item) => {
    if (!actions.giveItem(item)) { toast('背包滿了'); return; }
    unlock('steal');
    setFlags({ badRecord: (prog().flags.badRecord ?? 0) + 1 });
    toast(`🫣 偷偷拿走了 ${ITEMS[item].name}…店員：「同學！你還沒結帳！」`);
    d.sound('close');
  };
  storyEvents.photo = (area) => {
    if (!area) return;
    startSide('photo');
    if (PHOTO_SPOTS.includes(area)) sideProgress('photo', area);
  };
  storyEvents.bikeHit = () => {
    unlock('bikeHit');
    setFlags({ safeMetres: 0 });
    toast('💥 撞到人了！路人：「欸！看路啦！」');
    d.sound('close');
  };
  storyEvents.lake = (name) => {
    const lake = name.startsWith('雲夢湖');
    if (lake) unlock('lake');
    toast(lake ? '🌊 噗通！跳進雲夢湖了，全身濕透…' : '🪷 踩進荷花池了，小心別踩到荷花！');
  };
  storyEvents.robBike = () => {
    unlock('robBike');
    setFlags({ badRecord: (prog().flags.badRecord ?? 0) + 1 });
    const lines = ['騎士：「欸！我的車！」', '騎士：「搶劫啊！有人搶我腳踏車！」', '騎士：「那是我剛買的耶！」'];
    toast(`🦹 ${lines[Math.floor(Math.random() * lines.length)]}`);
  };
  storyEvents.bikeMoved = (metres) => {
    const m = (prog().flags.safeMetres ?? 0) + metres;
    if (Math.floor(m / 50) !== Math.floor((prog().flags.safeMetres ?? 0) / 50)) setFlags({ safeMetres: m });
    else storyStore.setState((s) => ({ progress: { ...s.progress, flags: { ...s.progress.flags, safeMetres: m } } }));
    if (m >= 1000) unlock('safeRider');
  };
  storyEvents.mount = () => {
    if (!on() || side('bikeReturn')) return;
    const me = { x: lastX, z: lastZ };
    const far = d.bikeStations.filter((s) => Math.hypot(s.x - me.x, s.z - me.z) > 150);
    const target = far[Math.floor(Math.random() * far.length)];
    if (target) startSide('bikeReturn', target.name);
  };
  storyEvents.dismount = (x, z) => {
    const s = side('bikeReturn');
    if (!s || s.state !== 'active') return;
    const target = d.bikeStations.find((b) => b.name === s.target);
    if (target && Math.hypot(target.x - x, target.z - z) < 10) sideProgress('bikeReturn', 'returned');
  };
  const sportDone = (kind: SportKind): void => {
    const step = currentStep();
    if (on() && step?.cond.t === 'sport' && step.cond.kind === kind) advance();
  };
  storyEvents.sport = (kind, score) => {
    if (kind === 'basketball') {
      if (score >= 15) unlock('sharpShooter');
      startSide('athlete');
    }
    if (kind === 'volleyball' && score >= 10) sideProgress('athlete', 'volleyball');
    if (kind === 'soccer' && score >= 3) sideProgress('athlete', 'soccer');
    sportDone(kind as SportKind);
  };
  storyEvents.track = () => { sideProgress('athlete', 'track'); sportDone('track'); };
  storyEvents.sit = () => undefined;
  storyEvents.stand = () => undefined;
  storyEvents.chat = (to, reply) => {
    const r = st().phone.replies[to]?.find((x) => x.id === reply);
    if (!r) return;
    storyActions.sent(to, r.text);
    storyActions.setReplies(to, []);
    const answer = (text: string): void => { window.setTimeout(() => { storyActions.message(to, text); d.sound('open'); }, 1300); };
    if (reply === 'askCode' && rcCode) answer(`點名碼是 ${rcCode}，快去「點名系統」輸入！`);
    else if (reply === 'otw') answer('快點啦！老師已經點到一半了 😱');
    else if (reply === 'ok') answer('👍');
  };
  storyEvents.rollcallCode = (code) => {
    const step = currentStep();
    if (!on() || step?.cond.t !== 'phoneRollcall' || !rcCode || code !== rcCode) return false;
    rcCode = null;
    storyActions.setRollcall(null);
    storyActions.update((p) => ({ ...p, rollcalls: { ok: p.rollcalls.ok + 1, total: p.rollcalls.total + 1 } }));
    unlock('skip');
    window.setTimeout(advance, 900);
    return true;
  };

  // --- Per frame ------------------------------------------------------------------------------
  let lastArea: string | null = null;
  let lastX = 0, lastZ = 0;
  let tick = 0;
  const buildingNames = new Set(d.campus.buildings.map((b) => b.name).filter((n): n is string => !!n));
  /** Places that also count from around the building (the dorm's courtyard is where you spawn). */
  const NEAR: Record<string, number> = { 學生宿舍C: 45 };
  /** Footprints by name: hand-built buildings (管理二館…) are not reported by the area detector. */
  const rings = new Map<string, number[][]>();
  for (const b of d.campus.buildings) if (b.name) rings.set(b.name, [...(rings.get(b.name) ?? []), b.outer]);
  const inRing = (x: number, z: number, r: number[]): boolean => {
    let hit = false;
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const sealed = new Set(d.campus.buildings.filter((b) => b.sealed && b.name).map((b) => b.name!));
  const nearWalls = (f: StoryFrame, place: string, within: number): boolean =>
    (rings.get(place) ?? []).some((r) => {
      for (let i = 0, n = r.length / 2; i < n; i++) {
        const j = (i + 1) % n, ax = r[i * 2]!, az = r[i * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((f.x - ax) * dx + (f.z - az) * dz) / l2));
        if (Math.hypot(ax + dx * t - f.x, az + dz * t - f.z) < within) return true;
      }
      return false;
    });
  const inPlace = (f: StoryFrame, place: string): boolean => {
    if (f.area === place) return true;
    if (NEAR[place]) { const c = d.placeOf(place); return !!c && Math.hypot(c.x - f.x, c.z - f.z) < NEAR[place]!; }
    if (rings.get(place)?.some((r) => inRing(f.x, f.z, r))) return true;
    if (buildingNames.has(place)) return false;
    const p = d.placeOf(place);
    return !!p && Math.hypot(p.x - f.x, p.z - f.z) < 12;
  };

  let lastFrame: StoryFrame | null = null;
  const update = (dt: number, f: StoryFrame): void => {
    lastX = f.x; lastZ = f.z;
    lastFrame = f;
    if (!f.area) for (const [name, rs] of rings) if (rs.some((r) => inRing(f.x, f.z, r))) { f = { ...f, area: name }; break; }
    const now = performance.now() / 1000;
    beacons.update(now, f.x, f.z);
    npcs.update(dt, now, f.x, f.z);
    if (now - visualsAt > 0.5) {
      visualsAt = now;
      // Tour stops: walking in, or up to a closed (sealed) building's walls, counts as a visit.
      const tour = side('tour');
      if (f.playing && on() && tour?.state === 'active' && !st().scene) {
        const stop = TOUR_STOPS.find((n) => !tour.done.includes(n) && (inPlace(f, n) || (sealed.has(n) && nearWalls(f, n, 10))));
        if (stop) {
          const lines = TOUR_FACTS[stop];
          sideProgress('tour', stop);
          if (lines) { pendingScene = 'tourFact' as SceneId; open({ kind: 'dialog', id: 'tourFact', lines: lines.map((text) => ({ who: '導覽小雲', text })) }); }
        }
      }
      lastNpcs = npcSpecs();
      // Story mode navigates by itself: once per step, toward its target (the race steers on its own).
      const cur = on() ? currentStep() : null;
      if (cur && f.playing && !st().scene && cur.id !== autoNavFor && cur.cond.t !== 'run' && cur.cond.t !== 'getUp' && cur.cond.t !== 'phoneRollcall' && !f.lying) {
        const tgt = stepTarget(cur);
        autoNavFor = cur.id;
        if (tgt && Math.hypot(tgt.x - f.x, tgt.z - f.z) > 15 && !inPlace(f, cur.place)) d.navigate(tgt.x, tgt.z, cur.place, true);
      }
      const list = beaconList(f);
      beacons.set(list);
      storyActions.setPins(list.filter((b) => b.key !== 'nav' && b.key !== 'card'));
      npcs.set(lastNpcs);
      const ph = side('photo');
      storyActions.setLive({ photoSpot: f.area && PHOTO_SPOTS.includes(f.area) && !(ph?.done.includes(f.area)) && ph?.state !== 'done' ? f.area : null });
    }
    if (!f.playing) return;
    // Area changes: explorer, tour, lost card delivery.
    if (f.area !== lastArea) {
      lastArea = f.area;
      if (f.area && buildingNames.has(f.area) && !prog().visited.includes(f.area)) {
        storyActions.update((p) => ({ ...p, visited: [...p.visited, f.area!] }));
        if (prog().visited.length >= 15) unlock('explorer');
      }
      if (f.area === '大門') startSide('tour');

    }
    // Lost card: appears once per session, picked up by walking over it.
    if (on() && !side('lostFound') && !cardAt && Math.random() < dt / 90) placeCard(f.x, f.z);
    if (cardAt) {
      cardMesh.rotation.y += dt * 2;
      cardMesh.position.y = cardY + 0.25 + Math.sin(performance.now() / 300) * 0.06;
      if (Math.hypot(cardAt.x - f.x, cardAt.z - f.z) < 1.6) {
        d.scene.remove(cardMesh);
        cardAt = null;
        if (actions.giveItem('lostCard')) startSide('lostFound');
      }
    }

    const step = on() ? currentStep() : null;
    // Waking up: lying in the dorm bed (once its interior has streamed in), then getting up.
    if (wakeFor > 0) {
      wakeFor -= dt;
      if (d.putInBed(DORM)) wakeFor = 0; // the next frame reports lying
      else if (wakeFor <= 0 && step?.cond.t === 'getUp') advance(); // no bed to wake up in: just carry on
    }
    if (step?.cond.t === 'getUp') {
      if (!wakeTried) { wakeTried = true; wakeFor = 20; } // loaded a save on this step: back into bed
      if (f.lying) wasLying = true;
      else if (wasLying && wakeFor <= 0) { wasLying = false; advance(); }
    }
    // Roll call: from where you are, the walk to the classroom (MA214) plus 5 seconds to sit down.
    if (step?.cond.t === 'class' && !st().scene) {
      if (cls.phase === 'idle') {
        const c = d.placeOf(step.room ?? step.place);
        const path = c ? d.route(f.x, f.z, c.x, c.z) : [];
        let len = 12; // the stairs up to 2F count as 12 m of walking
        for (let i = 2; i < path.length; i += 2) len += Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!);
        const limit = Math.ceil(len / d.walkSpeed + 5);
        cls = { phase: 'timed', t: limit, limit };
        toast(`老師在點名了！${limit} 秒內到 ${step.room ?? step.place} 坐下`);
      } else if (cls.phase === 'timed') {
        cls.t -= dt;
        if (!floorHint && step.room && inPlace(f, step.place) && f.y < 2) {
          floorHint = true;
          toast(`📍 上課教室是 ${step.room}，在 2 樓！搭電梯或走樓梯上 2F`);
        }
        const here = f.seatedIn === step.place;
        if (here && step.room && f.seatedRoom !== step.room) {
          if (!wrongRoomToast) { wrongRoomToast = true; toast(`這裡不是 ${step.room}！到管理一館 2F 的 ${step.room} 教室`); }
        } else if (here) {
          // In the right room: the professor calls the roll, raise your hand when it is your number.
          cls.phase = 'done';
          pendingScene = 'rollcall';
          open({ kind: 'rollcall', advanced: false, sudden: false });
        }
        if (cls.phase === 'timed' && cls.t <= 0) {
          cls.phase = 'done';
          actions.addCoins(-Math.min(ABSENT_FINE, gameStore.getState().coins));
          storyActions.update((p) => ({ ...p, rollcalls: { ok: p.rollcalls.ok, total: p.rollcalls.total + 1 }, flags: { ...p.flags, absent: (p.flags.absent ?? 0) + 1 } }));
          d.sound('close');
          toast(`點名結束，你缺席了！扣 NT$ ${ABSENT_FINE}`);
          advance();
        }
      }
    }
    // 新手教學: walk, jump, phone, bag — each checked off as you do it.
    if (step?.cond.t === 'tutorial') {
      if (!tut) tut = { i: 0, x: f.x, z: f.z, walked: 0, jumps: f.jumps, hold: 0 };
      tut.walked += Math.min(1, Math.hypot(f.x - tut.x, f.z - tut.z)); // distance walked, any direction
      tut.x = f.x; tut.z = f.z;
      if (tut.hold > 0) {
        tut.hold -= dt;
        if (tut.hold <= 0) {
          tut.i++;
          if (tut.i >= TUTORIAL.length) {
            storyActions.setLive({ tutorial: null });
            toast('🎉 新手教學完成！快去上課');
            advance();
          } else storyActions.setLive({ tutorial: { i: tut.i, done: false } });
        }
      } else {
        const done = tut.i === 0 ? tut.walked > 4
          : tut.i === 1 ? f.jumps > tut.jumps
          : tut.i === 2 ? f.modal === 'phone'
          : f.modal === 'inventory';
        if (done) { tut.hold = 0.9; d.sound('coin'); }
        storyActions.setLive({ tutorial: { i: tut.i, done } });
      }
    }
    // 上課中: seated in the classroom the lecture runs (subtitles, the bell); drowsiness comes later.
    const inClass = (step?.cond.t === 'scene' || step?.cond.t === 'class') && f.seatedIn === step.place && (!step.room || f.seatedRoom === step.room);
    if (inClass && step?.cond.t === 'scene') {
      if (!bellRung) { bellRung = true; d.sound('bell'); }
      lectureT += dt;
      storyActions.setLive({ lecture: { line: Math.floor(lectureT / 4.5) % LECTURE.length, t: Math.floor(lectureT), total: LECTURE_INTRO } });
    } else if (st().live.lecture && !st().scene) storyActions.setLive({ lecture: null });
    // A scene that starts by itself: the stay-awake game once the lecture has been going a while.
    if (step?.cond.t === 'scene' && !st().scene && inClass && lectureT >= LECTURE_INTRO) playScene(step.cond.scene);
    // Digital roll call: the code lives in the chat with your friend.
    if (step?.cond.t === 'phoneRollcall' && !rcCode) {
      rcCode = String(1000 + Math.floor(Math.random() * 9000));
      storyActions.setRollcall({ course: '下午的通識課' });
      storyActions.setReplies(FRIEND, [{ id: 'askCode', text: '下午點名碼多少？拜託 🙏' }]);
    }
    // Enter.
    if (step?.cond.t === 'enter' && inPlace(f, step.place)) advance();
    // Race.
    if (step?.cond.t === 'run') {
      if (!run) startRun();
      if (run && run.started) {
        run.t += dt;
        // Stamina: sprinting drains it; when empty you can only jog until it recovers.
        run.stamina = Math.max(0, Math.min(1, run.stamina + (f.sprinting && !run.tired ? -dt / 14 : dt / 20)));
        if (run.stamina <= 0) run.tired = true;
        if (run.tired && run.stamina > 0.35) run.tired = false;
        speedFactor = run.tired ? 0.6 : 1;
        const p = run.points[run.next];
        if (p && Math.hypot(p.x - f.x, p.z - f.z) < 9) {
          if (f.riding) {
            if (tick % 40 === 0) toast('🚩 工作人員：騎腳踏車不算喔！下車用跑的');
          } else {
            markers[run.next]?.removeFromParent();
            run.next++;
            const n = run.points[run.next];
            if (n) {
              if (markers[run.next]) markers[run.next]!.material = nextMat;
              toast(`🚩 ${RACE_ROUTE[run.next]?.name ?? '檢查點'}（${run.next}/${run.points.length}）`);
              d.sound('coin');
              d.navigate(n.x, n.z, RACE_ROUTE[run.next + 1]?.name ?? `檢查點 ${run.next + 1}`, true);
            } else {
              const t = run.t;
              const target = runTarget();
              setFlags({ runTime: Math.round(t) });
              unlock('run2020');
              if (t <= target) unlock('runGod');
              clearRun();
              speedFactor = 1;
              advance();
              toast(`🏅 完賽！時間 ${Math.floor(t / 60)} 分 ${Math.round(t % 60)} 秒（目標 ${Math.floor(target / 60)} 分 ${Math.round(target % 60)} 秒）`);
            }
          }
        }
      }
    }
    tick++;

    // Tracker: distance and direction to the objective.
    const target = step ? (run && step.cond.t === 'run' ? run.points[run.next] ?? null : stepTarget(step)) : null;
    if (target) {
      const dx = target.x - f.x, dz = target.z - f.z;
      const dist = Math.hypot(dx, dz);
      const view = Math.atan2(-Math.sin(f.viewYaw), -Math.cos(f.viewYaw));
      const rel = Math.atan2(dx, dz) - view;
      const idx = ((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8;
      const classTimer = cls.phase === 'timed' && step!.cond.t === 'class';
      const timer = run ? `⏱ ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')}` : null;
      storyActions.setLive({
        distance: step!.cond.t !== 'run' && inPlace(f, step!.place) && (step!.cond.t !== 'talk' || closeTo(step!.cond.scene, f)) ? 0 : Math.round(dist),
        bearing: idx,
        timer,
        countdown: classTimer ? cdOf(Math.max(0, Math.ceil(cls.t)), cls.limit, `${step!.place} ${step!.room ?? ''}`.trim()) : null,
        stamina: run ? Math.round(run.stamina * 20) / 20 : null,
        note: run?.tired ? '跑不動了…慢慢跑恢復體力' : null,
        place: run && step!.cond.t === 'run' ? `檢查點 ${run.next + 1}/${run.points.length}`
          : step!.cond.t === 'talk' && npcsFor(step!.cond.scene)[0] ? npcsFor(step!.cond.scene)[0]!.name : step!.place,
      });
    } else {
      storyActions.setLive({ distance: null, bearing: null, timer: null, countdown: null, stamina: null, note: null, place: null });
    }
  };

  /** At the 萊爾富 counter (in front of it, on the ground floor). */
  const atCounter = (f: StoryFrame): boolean => !!d.hilife && Math.hypot(d.hilife.counter.x - f.x, d.hilife.counter.z - f.z) < 2.2;
  const lostFoundReady = (f: StoryFrame): boolean =>
    side('lostFound')?.state === 'active' && actions.hasItem('lostCard') && closeTo('lostFound', f);
  const prompt = (f: StoryFrame): string | null => {
    const step = on() ? currentStep() : null;
    if (lostFoundReady(f)) return '按 E 把撿到的學生證交出去';
    if (step && inPlace(f, step.place)) {
      if (step.cond.t === 'talk' && closeTo(step.cond.scene, f)) return step.cond.prompt;
      if (step.cond.t === 'sleep') return step.cond.until === 'nextDay' ? '按 E 回房間睡覺（到隔天早上）' : '按 E 回房間補眠（睡到傍晚）';
      if (step.cond.t === 'quiz') return '按 E 入座開始小考';
      if (step.cond.t === 'outfit') return '按 E 打開衣櫃換裝';
    }
    if (atCounter(f)) return '按 E 逛萊爾富';
    return null;
  };

  const interact = (f: StoryFrame): 'done' | 'hilife' | null => {
    const step = on() ? currentStep() : null;
    if (lostFoundReady(f)) { playScene('lostFound'); return 'done'; }
    if (step && inPlace(f, step.place)) {
      if (step.cond.t === 'talk' && closeTo(step.cond.scene, f)) {
        playScene(step.cond.scene);
        return 'done';
      }
      if (step.cond.t === 'quiz') { pendingScene = 'quiz'; open({ kind: 'quiz' }); return 'done'; }
      if (step.cond.t === 'outfit') { playScene('wardrobe'); return 'done'; }
      if (step.cond.t === 'sleep') {
        const until = step.cond.until;
        const p = prog();
        d.fade(() => {
          if (until !== 'nextDay') d.setClock(dayStart(p.day, until));
          advance();
        });
        return 'done';
      }
    }
    if (atCounter(f)) return 'hilife';
    return null;
  };

  if (import.meta.env.DEV) (window as unknown as { __story: unknown }).__story = () => ({ cls, run, pendingScene, tut, lectureT, step: currentStep()?.id, frame: lastFrame && { ...lastFrame }, card: cardAt });
  if (import.meta.env.DEV) (window as unknown as { __spawnCard: unknown }).__spawnCard = () => { if (!cardAt) placeCard(lastX, lastZ); return cardAt; };
  return {
    update,
    prompt,
    interact,
    get speedFactor() { return speedFactor; },
    /**
     * Day 1 遲到危機: only the class's own room may be entered (its doors open); any other classroom
     * door in the 管理學院 stays shut with a reminder. Returns the refusal, or null when allowed.
     */
    roomGate(building: string, room: string | undefined): string | null {
      const step = currentStep();
      if (!st().enabled || prog().day !== 1 || !step?.room || (step.cond.t !== 'class' && step.cond.t !== 'scene')) return null;
      if (building !== 'ma' && building !== 'mb') return null;
      if (!room || room === step.room) return null;
      return `🚫 快遲到了，別亂跑！要上課的教室是 ${step.room}（管理一館 2 樓）`;
    },
    guide() {
      const step = currentStep();
      if (!step) { toast('目前沒有主線任務'); return; }
      const t = run && step.cond.t === 'run' ? run.points[run.next] : stepTarget(step);
      if (t) d.navigate(t.x, t.z, step.place);
    },
    restart() {
      storyActions.reset();
      storyActions.resetPhone();
      autoNavFor = null;
      resetTransient();
      if (cardAt) { d.scene.remove(cardMesh); cardAt = null; }
      begin();
    },
    jump(day, step) {
      autoNavFor = null;
      storyActions.update((p) => ({ ...p, day, step }));
      storyActions.openScene(null);
      begin();
    },
    completeStep() {
      const step = currentStep();
      if (!step) return;
      advance();
    },
    dispose() {
      beacons.dispose();
      npcs.dispose();
      clearRun();
      d.scene.remove(cardMesh);
      for (const k of Object.keys(storyEvents) as (keyof typeof storyEvents)[]) (storyEvents as Record<string, unknown>)[k] = () => undefined;
    },
  };
}

