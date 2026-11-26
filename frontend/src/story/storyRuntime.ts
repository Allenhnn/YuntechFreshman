import { BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, SphereGeometry, SRGBColorSpace, type Object3D, type Scene } from 'three';
import { playerName, studentId } from '../state/playerName';
import type { CampusData } from '../campus/campusTypes';
import type { ResourceTracker } from '../core/resources';
import { ITEMS, type ItemId } from '../state/items';
import { actions, gameStore } from '../state/store';
import { achievementById, sideById, storyActions, storyStore, type StoryProgress, type StoryScene } from '../state/story';
import {
  ABSENT_FINE, ACTIVITY, LECTURE, RACE_ROUTE, TUTORIAL, CAFETERIA, DAYS, DIALOGS, DORM, FRIEND, PHOTO_SPOTS, ROOMMATE, STALL_IDS, TOUR_FACTS, TOUR_STOPS,
  type SceneId, type SportKind, type Step, WAKE_VN, TUTORIAL_DONE_VN, BIKE_VN, type VnLine, MY_ROOM, PROFESSOR, COURSE, ROOMMATE2, LUNCH_EACH, MYSTERY, PROMO_LINES, MIXER, MIXER_GOAL } from './storyData';
import { createCritters, type CritterSpec } from './critters';
import { CONTACTS, TOPICS, resolveAnswer, type ChatCtx, type ChatOption } from './chatData';
import { createBeacons, type Beacon } from './beacons';
import { createNpcs, type NpcSpec } from './npcs';
import { insidePoint as insidePointOf } from '../campus/insidePoint';
import { FX, successFx } from '../ui/fx';

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
  sound(name: 'coin' | 'open' | 'close' | 'click' | 'bell' | 'buzz'): void;
  /** Gets the player off a seat or out of bed (where they would step off). */
  standUp(): void;
  /** Code of the room the player stands in ('MA214'), or null. */
  roomAt(x: number, y: number, z: number): string | null;
  /** Sits the player on a free chair in `room` of `building` (false when none). */
  seatIn(building: string, room: string): boolean;
  /** Fades and puts the player outside the dorm's front door (then `after`). */
  goOutsideDorm(after: () => void): void;
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
  /** Moves the player sideways by (dx, dz) (the race keeps you on its route). */
  shove(dx: number, dz: number): void;
  /** Pops the phone up on a chat thread (a message the story wants you to read now). */
  openPhone(from: string): void;
  /** Puts the player at (x, z) on the ground (the race start). */
  teleportTo(x: number, z: number): void;
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
  /** Building and room of the bed you lie in ('學生宿舍C 寢室', '寢室 4'), or null. */
  bed: { building: string; room: string } | null;
}

export type SceneResult =
  | { kind: 'dialog' }
  | { kind: 'rollcall'; ok: boolean }
  | { kind: 'quiz'; score: number; cheated: boolean; caught: boolean }
  | { kind: 'mixer'; who: number; aff: number }
  | { kind: 'wake'; ok: boolean }
  | { kind: 'clubFair' }
  | { kind: 'summary' }
  | { kind: 'stayAwake'; ok: boolean }
  | { kind: 'vn'; id: string }
  /** 撐住別睡著 abandoned to sneak out of class (翹課). */
  | { kind: 'sneakOut' }
  | { kind: 'wardrobe' }
  /** Lunch: who pays; whether you appealed and won the appeal. */
  | { kind: 'lunch'; payer: 'me' | 'kai' | 'fat'; appealWon: boolean }
  /** Drums: levels cleared. */
  | { kind: 'drums'; level: number }
  /** Dance: points and how many rounds were all Perfect. */
  | { kind: 'dance'; score: number; perfect: number };

export interface StoryRuntime {
  update(dt: number, f: StoryFrame): void;
  /** The E prompt the story offers here, or null. */
  prompt(f: StoryFrame): string | null;
  /** Handles E: 'done' when the story used it, 'hilife' to open the 萊爾富 shop, null when not. */
  interact(f: StoryFrame): 'done' | 'hilife' | null;
  /** Your room's wardrobe (E at it): the story's outfit scene, or just changing clothes. */
  openWardrobe(): void;
  /** Refusal for opening a door into `room` of `building` right now (Day 1: only the class's room), or null. */
  roomGate(building: string, room: string | undefined): string | null;
  /**
   * Why you may not get up right now, or null: the lecture holds you in your seat; on Day 1 you stay
   * in bed until the wake-up scene has been read ('' = no message). A story scene on screen too.
   */
  seatLock(): string | null;
  /** The race step is on (the campus clears its traffic, the runners take the course). */
  readonly racing: boolean;
  /** Sneaking out of class: the player can only crouch-walk. */
  readonly forceCrouch: boolean;
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
  photo: (_area: string | null, _selfie?: boolean): void => undefined,
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
  /** Things you can bring up with a contact when the story has nothing waiting for an answer. */
  chatTopics: (_to: string): { id: string; text: string }[] => [],
  /** The contact is typing an answer. */
  chatTyping: (_to: string): boolean => false,
  /** Entered a code in the 點名系統 app; true when it signs you in. */
  rollcallCode: (_code: string): boolean => false,
  track: (_seconds: number): void => undefined,
  /** The story modal reports how a scene ended. */
  finishScene: (_r: SceneResult): void => undefined,
  /** Used a 路跑道具; false when it does nothing right now (kept). */
  raceItem: (_item: ItemId): boolean => false,
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
    for (const c of CONTACTS) storyActions.setReplies(c, []); // answers to the last step's message are stale
    if (step.msg) {
      const m = step.msg;
      const send = (): void => {
        if (st().scene) { window.setTimeout(send, 600); return; } // after the scene on screen
        storyActions.message(m.from, m.text, !!step.quietMsg); // quiet: a notification only (the tutorial asks for P)
        d.sound('open');
        if (m.replies?.length) offerChat(m.from, m.replies);
        if (!step.quietMsg) d.openPhone(m.from); // the phone pops up on the chat, not a message over the game
      };
      window.setTimeout(send, step.wake ? 1500 : 400);
    }
  };
  /**
   * Next step. Every finished step is marked with a short visual-novel scene (what was done, what comes
   * next, or the end of the day) unless `quiet` (the step already ended in a scene of its own).
   */
  const advance = (quiet = false): void => {
    const p = prog();
    const step = currentStep();
    if (!step) return;
    // 早起的鳥兒: the day's second objective done before 08:30.
    if (p.step === 1 && gameStore.getState().gameMinutes % 1440 < 8 * 60 + 30) unlock('earlyBird');
    const day = DAYS[p.day - 1]!;
    const last = p.step + 1 >= day.steps.length;
    storyActions.update((q) => ({ ...q, day: last ? q.day + 1 : q.day, step: last ? 0 : q.step + 1 }));
    d.sound('coin');
    if (last && p.day < DAYS.length && quiet) {
      storyActions.celebrate(`Day ${p.day} 完成！`, `「${day.title}」・明天是 Day ${p.day + 1}「${DAYS[p.day]!.title}」`);
    }
    if (!quiet && on()) {
      const next = last ? undefined : day.steps[p.step + 1];
      const lines: VnLine[] = [{ who: '', text: `「${step.text}」——完成！` }];
      if (last) {
        lines.push({ who: '', text: `Day ${p.day}「${day.title}」結束了。` });
        if (p.day < DAYS.length) lines.push({ who: '你', text: `明天是 Day ${p.day + 1}「${DAYS[p.day]!.title}」。` });
      } else if (next) lines.push({ who: '你', text: `接下來……${next.text}。` });
      // After the step's own effects (begin) so a message it sends waits for the scene.
      window.setTimeout(() => { if (!st().scene) open({ kind: 'vn', id: 'stepVn', lines }); }, 250);
    }
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
  /** Seconds lying in your own bed during a sleep step; the night is passing; told it's not your bed. */
  let sleepT = 0;
  /** 翹課: crouch-walking out of the lecture; `risk` 0–1 of the professor noticing. */
  let sneak: { risk: number; x: number; z: number; caught: boolean } | null = null;
  /** Seated in the class's room during the lecture (last frame). */
  let wasInClass = false;
  let sleeping = false;
  let bedNag = false;
  /** Day 1: told once that the class is upstairs, on entering 管理一館 on the ground floor. */
  let floorHint = false;
  /** Day 1 wake-up visual novel: seconds lying in bed before it opens, and whether it has run. */
  let wakeVnT = 0;
  let wakeVnDone = false;
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
  let run: {
    points: { x: number; z: number }[];
    next: number;
    t: number;
    started: boolean;
    /** The whole course along the walkways (start, then every checkpoint): you may not leave it. */
    path: { x: number; z: number }[];
    /** Speed pads: where, which way, and the seconds until each works again. */
    pads: { x: number; z: number; cool: number }[];
    /** Seconds of boost left. */
    boost: number;
    outWarned: number;
    /** Barricades across one side of the course (centre, along-course unit, half depth / half width). */
    blocks: { x: number; z: number; ux: number; uz: number; hd: number; hw: number }[];
    /** The other runners: distance along the course, offset across it, pace, their figure. */
    runners: { s: number; off: number; pace: number; phase: number; g: Group; legs: Mesh[]; slow: number }[];
    /** ? boxes on the course: where, the spinning box, seconds until it is back. */
    boxes: { x: number; z: number; m: Object3D; cool: number }[];
    /** Course sampler: point and direction at a distance along it, and its length. */
    at: (s: number) => { x: number; z: number; ux: number; uz: number };
    length: number;
  } | null = null;
  let speedFactor = 1;
  /** A speed item's effect (×f for t more seconds), on top of the race pace. */
  let effect = { t: 0, f: 1, label: '' };
  let pendingScene: SceneId | null = null;
  /** The item to pick up (step `pickup`): where it lies. */
  let pickupAt: { x: number; y: number; z: number } | null = null;
  const resetTransient = (): void => {
    cls = { phase: 'idle', t: 0, limit: 0 };
    wakeFor = 0;
    wrongRoomToast = false;
    floorHint = false;
    wakeVnT = 0;
    wakeVnDone = false;
    sneak = null;
    wasInClass = false;
    storyActions.setLive({ sneak: null });
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
    effect = { t: 0, f: 1, label: '' };
    pickupAt = null;
    pickupMesh.removeFromParent();
  };
  const pickupMesh = new Mesh(new BoxGeometry(0.34, 0.1, 0.12), new MeshStandardMaterial({ color: 0x37474f, emissive: 0x4fc3f7, emissiveIntensity: 0.6 }));
  {
    const halo = new Mesh(new CylinderGeometry(0.7, 0.7, 0.02, 24), new MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.35 }));
    halo.position.y = -0.25;
    pickupMesh.add(halo);
  }

  // --- Race checkpoints -----------------------------------------------------------------------
  const ringMat = d.tracker.material(new MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.85 }));
  const nextMat = d.tracker.material(new MeshBasicMaterial({ color: 0x1f8f4a, transparent: true, opacity: 0.9 }));
  /**
   * Checkpoint gate (使用者：記錄點不要垂直對著人): two posts and a banner across the course, square to the
   * way you run in, so you run through it; green for the next one, yellow for the rest.
   */
  const GATE_W = 7.2;
  const gatePostGeo = d.tracker.geometry(new CylinderGeometry(0.16, 0.2, 3.6, 12).translate(0, 1.8, 0));
  const gateBannerGeo = d.tracker.geometry(new BoxGeometry(GATE_W + 0.5, 0.95, 0.12).translate(0, 3.45, 0));
  const gateLineGeo = d.tracker.geometry(new PlaneGeometry(GATE_W, 0.5).rotateX(-Math.PI / 2).translate(0, 0.05, 0));
  const gateLineMat = d.tracker.material(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 }));
  const bannerMat = (n: number, name: string, next: boolean): MeshStandardMaterial => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = next ? '#1f8f4a' : '#e0a800'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 34px "PingFang TC","Noto Sans TC",sans-serif';
    g.fillText(`檢查點 ${n}　${name.replace(/（.*）/, '')}`, 256, 34);
    const t = d.tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return d.tracker.material(new MeshStandardMaterial({ map: t, roughness: 0.7 }));
  };
  const markers: Group[] = [];
  /**
   * Shows the gates still to come, except one standing where an earlier one still waits (the course
   * passes 檢終 twice: the finish gate appears once the first pass is done).
   */
  const gateVisibility = (next: number): void => {
    markers.forEach((g, i) => {
      g.visible = i >= next && !markers.some((o, j) => j >= next && j < i && Math.hypot(o.position.x - g.position.x, o.position.z - g.position.z) < 12);
    });
  };
  /** Recolours a gate as the next one to reach. */
  const markNext = (i: number): void => {
    gateVisibility(i);
    const g = markers[i];
    if (!g) return;
    for (const c of g.children) {
      const m = c as Mesh;
      if (m.userData.post) m.material = nextMat;
      if (m.userData.banner) m.material = bannerMat(i + 1, RACE_ROUTE[i + 1]?.name ?? '', true);
    }
  };
  /** Cones along the course edge and the speed pads (scene objects of this run). */
  const courseProps: Object3D[] = [];
  const clearRun = (): void => {
    for (const m of markers) d.scene.remove(m);
    markers.length = 0;
    for (const o of courseProps) d.scene.remove(o);
    courseProps.length = 0;
    run = null;
  };
  /** How far from the course centre line you may run (m). */
  const COURSE_HALF = 10;
  // Barricade: a red-and-white striped plank on two legs, 1 m wide per unit of x scale.
  // Hurdles (跨欄): low enough to jump over (使用者：跨欄可以跳過去).
  const blockGeo = d.tracker.geometry(new BoxGeometry(1, 0.24, 0.1).translate(0, 0.58, 0));
  const blockMat = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 32;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e53935'; g.beginPath(); g.moveTo(i * 16 - 8, 32); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 24, 0); g.lineTo(i * 16 + 8, 32); g.fill(); }
    const t = d.tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.repeat.set(3, 1);
    return d.tracker.material(new MeshStandardMaterial({ map: t, roughness: 0.6 }));
  })();
  const postGeo = d.tracker.geometry(new BoxGeometry(0.07, 0.7, 0.07).translate(0, 0.35, 0));
  const postMat = d.tracker.material(new MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7 }));
  /** The other runners in the race (the campus walkers and drivers are taken off for it). */
  const RUNNERS = 36;
  const runnerTorso = d.tracker.geometry(new CylinderGeometry(0.19, 0.22, 0.6, 10));
  const runnerHead = d.tracker.geometry(new SphereGeometry(0.17, 12, 10));
  const runnerLeg = d.tracker.geometry(new CylinderGeometry(0.07, 0.065, 0.8, 8).translate(0, -0.4, 0));
  const runnerBib = d.tracker.geometry(new PlaneGeometry(0.22, 0.18));
  const bibMat = d.tracker.material(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  const runnerSkin = d.tracker.material(new MeshStandardMaterial({ color: 0xf1d2b0, roughness: 0.7 }));
  const runnerShirts = [0x2c6fd6, 0xd8353a, 0x2e9e3e, 0xf2c230, 0x7e57c2, 0xff7a1a, 0x26a69a, 0xf48fb1].map((c) => d.tracker.material(new MeshStandardMaterial({ color: c, roughness: 0.6 })));
  /** Puts every runner at its place on the course (legs swinging while running). */
  const placeRunners = (dt: number): void => {
    if (!run) return;
    for (const r of run.runners) {
      const moving = run.started && r.s < run.length - 3;
      r.slow = Math.max(0, r.slow - dt);
      if (moving) r.s += r.pace * (r.slow > 0 ? 0.35 : 1) * dt;
      const p = run.at(Math.max(0, r.s));
      const back = r.s < 0 ? -r.s : 0; // lined up behind the start
      const x = p.x - p.uz * r.off - p.ux * back, z = p.z + p.ux * r.off - p.uz * back;
      r.g.position.set(x, d.groundAt(x, z), z);
      r.g.rotation.y = Math.atan2(p.ux, p.uz);
      r.phase += dt * (moving ? r.pace * 2.2 : 0);
      const sw = moving ? Math.sin(r.phase) * 0.7 : 0;
      r.legs[0]!.rotation.x = sw;
      r.legs[1]!.rotation.x = -sw;
    }
  };
  const coneGeo = d.tracker.geometry(new ConeGeometry(0.22, 0.7, 10));
  coneGeo.translate(0, 0.35, 0);
  const coneMat = d.tracker.material(new MeshStandardMaterial({ color: 0xff6d00, roughness: 0.6 }));
  const padGeo = d.tracker.geometry(new PlaneGeometry(2.6, 3.4));
  padGeo.rotateX(-Math.PI / 2);
  const padMat = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 168;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(20, 30, 25, 0.75)'; g.fillRect(0, 0, 128, 168);
    g.strokeStyle = '#ffeb3b'; g.lineWidth = 16; g.lineJoin = 'round';
    for (const y of [36, 84, 132]) { g.beginPath(); g.moveTo(22, y + 26); g.lineTo(64, y - 10); g.lineTo(106, y + 26); g.stroke(); }
    const t = d.tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return d.tracker.material(new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  })();
  // ? box (道具箱): a glowing cube with a question mark on every face.
  const itemBoxGeo = d.tracker.geometry(new BoxGeometry(0.7, 0.7, 0.7));
  const itemBoxMat = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 64, 64);
    grd.addColorStop(0, '#ffb300'); grd.addColorStop(1, '#ff6f00');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#fff3c4'; g.lineWidth = 4; g.strokeRect(3, 3, 58, 58);
    g.fillStyle = '#ffffff'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', 32, 35);
    const t = d.tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return d.tracker.material(new MeshStandardMaterial({ map: t, emissive: 0xff8f00, emissiveIntensity: 0.35, roughness: 0.4 }));
  })();
  /** Nearest point of the course to (x, z) and how far it is. */
  const nearestOnCourse = (path: { x: number; z: number }[], x: number, z: number): { x: number; z: number; d: number } => {
    let best = { x: path[0]!.x, z: path[0]!.z, d: Infinity };
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!, b = path[i + 1]!;
      const sx = b.x - a.x, sz = b.z - a.z, len2 = sx * sx + sz * sz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / len2));
      const px = a.x + sx * t, pz = a.z + sz * t, dd = Math.hypot(x - px, z - pz);
      if (dd < best.d) best = { x: px, z: pz, d: dd };
    }
    return best;
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
    // The course: walkway routes from the start through every checkpoint.
    const path: { x: number; z: number }[] = [{ x: start.x, z: start.z }];
    let prev = { x: start.x, z: start.z };
    for (const p of points) {
      const r = d.route(prev.x, prev.z, p.x, p.z);
      for (let k = 2; k + 1 < r.length; k += 2) path.push({ x: r[k]!, z: r[k + 1]! });
      path.push(p);
      prev = p;
    }
    // Cones every 5 m on both edges, except where the other edge of the course (it crosses and
    // doubles back on itself) runs through them.
    const cones: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!, b = path[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.5) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      for (let s = 0; s < len; s += 5) {
        for (const side of [-1, 1]) {
          const x = a.x + ux * s - uz * COURSE_HALF * side, z = a.z + uz * s + ux * COURSE_HALF * side;
          if (nearestOnCourse(path, x, z).d < COURSE_HALF - 0.8) continue;
          cones.push({ x, z });
        }
      }
    }
    const coneMesh = new InstancedMesh(coneGeo, coneMat, Math.max(1, cones.length));
    const mtx = new Matrix4();
    cones.forEach((c, i) => coneMesh.setMatrixAt(i, mtx.makeTranslation(c.x, d.groundAt(c.x, c.z), c.z)));
    coneMesh.count = cones.length;
    coneMesh.instanceMatrix.needsUpdate = true;
    coneMesh.frustumCulled = false;
    d.scene.add(coneMesh);
    courseProps.push(coneMesh);
    // Distance along the course.
    let total = 0;
    const segs: { a: { x: number; z: number }; b: { x: number; z: number }; at: number; len: number }[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const len = Math.hypot(path[i + 1]!.x - path[i]!.x, path[i + 1]!.z - path[i]!.z);
      if (len < 0.01) continue;
      segs.push({ a: path[i]!, b: path[i + 1]!, at: total, len });
      total += len;
    }
    const at = (sAt: number): { x: number; z: number; ux: number; uz: number } => {
      const q = Math.max(0, Math.min(total, sAt));
      const sg = segs.find((g) => q >= g.at && q <= g.at + g.len) ?? segs[segs.length - 1]!;
      const t = (q - sg.at) / sg.len;
      return { x: sg.a.x + (sg.b.x - sg.a.x) * t, z: sg.a.z + (sg.b.z - sg.a.z) * t, ux: (sg.b.x - sg.a.x) / sg.len, uz: (sg.b.z - sg.a.z) / sg.len };
    };
    // Barricades (路障) every ~45 m, alternately closing the left or the right of the course: the middle lane stays open.
    const blocks: { x: number; z: number; ux: number; uz: number; hd: number; hw: number }[] = [];
    const blockAt: number[] = [];
    for (let sB = 70, k = 0; sB < total - 40; sB += 38 + Math.random() * 18, k++) {
      const p = at(sB);
      const side = k % 2 ? 1 : -1;
      const inner = 1.6, outer = COURSE_HALF - 0.3;
      const mid = side * (inner + outer) / 2, hw = (outer - inner) / 2;
      const x = p.x - p.uz * mid, z = p.z + p.ux * mid;
      blocks.push({ x, z, ux: p.ux, uz: p.uz, hd: 0.3, hw });
      blockAt.push(sB);
      const m = new Mesh(blockGeo, blockMat);
      m.scale.set(hw * 2, 1, 1);
      m.position.set(x, d.groundAt(x, z), z);
      m.rotation.y = Math.atan2(-p.ux, -p.uz); // local x (its width) across the course
      d.scene.add(m);
      courseProps.push(m);
      for (const e of [-1, 1]) {
        const px = x - p.uz * e * (hw - 0.15), pz = z + p.ux * e * (hw - 0.15);
        const post = new Mesh(postGeo, postMat);
        post.position.set(px, d.groundAt(px, pz), pz);
        d.scene.add(post);
        courseProps.push(post);
      }
    }
    // Speed pads (more, and stronger than before), in the open middle lane, clear of the barricades.
    const pads: { x: number; z: number; cool: number }[] = [];
    const count = Math.max(26, Math.round(total / 50)); // 使用者：新增更多加速帶
    for (let k = 0; k < count; k++) {
      let sP = 40 + ((k + 0.2 + Math.random() * 0.6) / count) * (total - 70);
      if (blockAt.some((q) => Math.abs(q - sP) < 7)) sP += 9;
      const p = at(sP);
      const off = (Math.random() - 0.5) * 2.2;
      const x = p.x - p.uz * off, z = p.z + p.ux * off;
      const m = new Mesh(padGeo, padMat);
      m.position.set(x, d.groundAt(x, z) + 0.04, z);
      m.rotation.y = Math.atan2(p.ux, p.uz) + Math.PI;
      d.scene.add(m);
      courseProps.push(m);
      pads.push({ x, z, cool: 0 });
    }
    // The field: everyone on the campus runs it, in the middle lane, at their own pace.
    const runners: { s: number; off: number; pace: number; phase: number; g: Group; legs: Mesh[]; slow: number }[] = [];
    for (let k = 0; k < RUNNERS; k++) {
      const g = new Group();
      const shirt = runnerShirts[k % runnerShirts.length]!;
      const torso = new Mesh(runnerTorso, shirt); torso.position.y = 1.15; g.add(torso);
      const bib = new Mesh(runnerBib, bibMat); bib.position.set(0, 1.15, 0.2); g.add(bib);
      const head = new Mesh(runnerHead, runnerSkin); head.position.y = 1.62; g.add(head);
      const legs = [-0.1, 0.1].map((lx) => { const l = new Mesh(runnerLeg, runnerSkin); l.position.set(lx, 0.82, 0); g.add(l); return l; });
      for (const c of g.children) c.castShadow = true;
      d.scene.add(g);
      courseProps.push(g);
      runners.push({ s: -2 - (k % 6) * 1.1 - Math.floor(k / 6) * 1.3, off: ((k % 6) - 2.5) * 0.45, pace: 3.6 + Math.random() * 2.2, phase: Math.random() * 6, g, legs, slow: 0 });
    }
    // ? boxes (道具箱) every ~120 m in the middle lane: run through one for a random 路跑道具.
    const boxes: { x: number; z: number; m: Object3D; cool: number }[] = [];
    for (let sQ = 90; sQ < total - 30; sQ += 100 + Math.random() * 40) {
      if (blockAt.some((q) => Math.abs(q - sQ) < 6)) sQ += 8;
      const p = at(sQ);
      for (const off of [-1.6, 1.6]) {
        const x = p.x - p.uz * off, z = p.z + p.ux * off;
        const m = new Mesh(itemBoxGeo, itemBoxMat);
        m.position.set(x, d.groundAt(x, z) + 1.0, z);
        m.castShadow = true;
        d.scene.add(m);
        courseProps.push(m);
        boxes.push({ x, z, m, cool: 0 });
      }
    }
    run = { points, next: 0, t: 0, started: false, path, pads, boost: 0, outWarned: 0, blocks, runners, at, length: total, boxes };
    placeRunners(0);
    // Gates: square to the way the course arrives at each checkpoint.
    let pi = 0;
    points.forEach((p, i) => {
      let j = path.indexOf(p, pi);
      if (j < 0) j = pi;
      pi = j;
      const prevP = path[Math.max(0, j - 1)] ?? start;
      let ux = p.x - prevP.x, uz = p.z - prevP.z;
      const L = Math.hypot(ux, uz);
      if (L < 0.5) { const nx = points[i + 1] ?? start; ux = nx.x - p.x; uz = nx.z - p.z; }
      const g = new Group();
      g.position.set(p.x, d.groundAt(p.x, p.z), p.z);
      g.rotation.y = Math.atan2(ux, uz); // local +z along the course: the banner (local x) spans across it
      for (const e of [-1, 1]) {
        const post = new Mesh(gatePostGeo, i === 0 ? nextMat : ringMat);
        post.position.x = e * GATE_W / 2;
        post.userData.post = true;
        post.castShadow = true;
        g.add(post);
      }
      for (const face of [0, Math.PI]) {
        const banner = new Mesh(gateBannerGeo, bannerMat(i + 1, RACE_ROUTE[i + 1]?.name ?? '', i === 0));
        banner.rotation.y = face;
        banner.userData.banner = true;
        g.add(banner);
      }
      g.add(new Mesh(gateLineGeo, gateLineMat));
      d.scene.add(g);
      markers.push(g);
    });
    gateVisibility(0);
    run.started = false;
    const r = run;
    actions.startCountdown(() => {
      r.started = true;
      toast('🏁 開跑！依序穿過檢查點（綠色是下一個）・跨欄按 Space 跳過・撞 ? 箱拿道具');
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
    if (scene === 'roommateD2' || scene === 'bibD3' || scene === 'summary' || scene === 'returnUsb') add('roommate', '室友阿凱', dormYard, LOOKS.roommate, true);
    if (scene === 'lunch') {
      const t = d.placeOf('學餐餐桌');
      add('roommate', ROOMMATE, t, LOOKS.roommate, true);
      add('roommate2', ROOMMATE2, near(t, 1.3, 0.3), { shirt: 0xf08a24, pants: 0x34495e, hair: 0x1c1a19 }, true);
    }
    if (scene === 'drums') {
      const c = d.placeOf('聯誼廣場'); // 使用者：熱音社移到和聯誼一樣的位置（36 週年布條下的廣場）
      add('band', '🥁 熱音社', near(c, 0, 3), { shirt: 0x1f1f24, pants: 0x1f1f24, hair: 0x8a2be2 }, true);
      add('band2', '🎸 熱音社', near(c, 1.6, 3.4), { shirt: 0xd8353a, pants: 0x1f1f24, hair: 0x151515 });
    }
    add('dance', '💃 熱舞社', d.placeOf('熱舞社'), { shirt: 0xff4fa3, pants: 0x1f1f24, hair: 0x151515 }, side('dance')?.state !== 'done');
    add('dance2', '🕺 熱舞社', near(d.placeOf('熱舞社'), 0.4, 1.4), { shirt: 0x00b8d4, pants: 0x34495e, hair: 0x2b211b });
    add('promo', '📣 街宣學長', d.placeOf('街宣'), { shirt: 0xf2c230, pants: 0x2d3a5c, hair: 0x1c1a19, hat: 0xd8353a }, side('promo')?.state !== 'done');
    if (scene === 'assembly') add('principal', '校長', insidePoint('國際會議廳'), LOOKS.principal, true);
    if (scene === 'mixer') {
      const c = d.placeOf('聯誼廣場'); // 使用者：聯誼移到活動中心和表演廳中間（36 週年校慶布條下）
      const done = prog().flags.mixerAff ?? {};
      // Spread out so you walk up to one at a time (使用者：一對一，不要一次對三個人).
      MIXER.forEach((m, i) => add(m.key, m.who, near(c, (i - 1) * 4.5, i === 1 ? 3 : 1), m.look, done[m.key] === undefined));
    }
    if (scene === 'clubFair') {
      const c = insidePoint(ACTIVITY);
      add('cl1', '🎸 吉他社', near(c, -3, 3), { shirt: 0x8a5bd6, pants: 0x1f1f24, hair: 0x151515 }, true);
      add('cl2', '📷 攝影社', near(c, 0, 4), { shirt: 0x26a69a, pants: 0x34495e, hair: 0x2b211b }, true);
      add('cl3', '🏀 籃球社', near(c, 3, 3), { shirt: 0xf08a24, pants: 0x1f1f24, hair: 0x1c1a19 }, true);
    }
    if (step && step.cond.t === 'quiz') add('teacher', `${PROFESSOR}教授`, near(step.room ? d.placeOf(step.room) : insidePoint(step.place), 0, 0), LOOKS.teacher);
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
    lunch: ['roommate', 'roommate2'], returnUsb: ['roommate'], drums: ['band'],
  };
  // 三位神秘人物 (and the 熱音社 drum kit while its step is on): animals and props.
  const critters = createCritters(d.scene, d.tracker);
  const critterSpecs = (): CritterSpec[] => {
    const out: CritterSpec[] = [];
    const myst = side('mystery');
    for (const m of MYSTERY) {
      const p = d.placeOf(m.place);
      if (p) out.push({ key: m.id, kind: m.id, name: m.name, x: p.x, z: p.z, y: d.groundAt(p.x, p.z), talk: !myst?.done.includes(m.id) });
    }
    const step = on() ? currentStep() : null;
    if (step?.cond.t === 'talk' && step.cond.scene === 'drums') {
      const c = near(d.placeOf('聯誼廣場'), -1.4, 3.6);
      if (c) out.push({ key: 'drumkit', kind: 'drumkit', name: '', x: c.x, z: c.z, y: d.groundAt(c.x, c.z) });
    }
    return out;
  };
  let lastCritters: CritterSpec[] = [];
  /** Who you can talk to here outside the main story: the animals, 熱舞社, 街宣. */
  const freeSpot = (f: StoryFrame): { id: string; prompt: string } | null => {
    for (const c of lastCritters) {
      if (c.kind === 'drumkit' || Math.hypot(c.x - f.x, c.z - f.z) > 3 || Math.abs(c.y - f.y) > 1.5) continue;
      return { id: `mystery:${c.key}`, prompt: `按 E 和${c.name}說話` };
    }
    for (const n of lastNpcs) {
      if (Math.hypot(n.x - f.x, n.z - f.z) > TALK_R || Math.abs((n.y ?? 0) - f.y) > 1.5) continue;
      if (n.key === 'dance') return { id: 'dance', prompt: '按 E 跟熱舞社一起跳舞（方向鍵＋Space）' };
      if (n.key === 'promo') return { id: 'promo', prompt: '按 E 和街宣學長聊聊' };
    }
    return null;
  };
  const playFree = (id: string): void => {
    if (id === 'dance') { pendingScene = 'dance' as SceneId; open({ kind: 'dance' }); return; }
    if (id === 'promo') { pendingScene = 'promo' as SceneId; open({ kind: 'dialog', id: 'promo', lines: PROMO_LINES }); return; }
    const m = MYSTERY.find((x) => `mystery:${x.id}` === id);
    if (m) { pendingScene = id as SceneId; open({ kind: 'dialog', id, lines: m.lines.map((text) => ({ who: m.name, text })) }); }
  };
  const TALK_R = 2.6;
  let lastNpcs: NpcSpec[] = [];
  const npcsFor = (scene: SceneId): NpcSpec[] => lastNpcs.filter((n) => SCENE_NPCS[scene]?.includes(n.key));
  /** 聯誼: the person you are standing next to (index into MIXER), if you have not talked yet. */
  const mixerPartner = (f: StoryFrame | null = lastFrame): number | null => {
    if (!f) return null;
    const done = prog().flags.mixerAff ?? {};
    let best: number | null = null, bd = TALK_R;
    for (const n of npcsFor('mixer')) {
      const i = MIXER.findIndex((m) => m.key === n.key), dd = Math.hypot(n.x - f.x, n.z - f.z);
      if (i >= 0 && done[n.key] === undefined && dd < bd) { best = i; bd = dd; }
    }
    return best;
  };
  /** Whether you are close enough to start `scene` (always, for scenes without a character). */
  const closeTo = (scene: SceneId, f: StoryFrame): boolean => {
    if (!SCENE_NPCS[scene]) return true;
    if (scene === 'mixer') return mixerPartner(f) !== null;
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
  const ICON: Record<string, string> = { pickup: '💾', talk: '💬', buy: '🛒', eat: '🍱', sport: '🏀', class: '📚', sleep: '🛏️', run: '🏁', quiz: '📝', enter: '📍', scene: '📚', getUp: '⏰', phoneRollcall: '📱', outfit: '👕' };
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
    const promo = side('promo');
    if (promo?.state === 'active') add('promo', d.placeOf('街宣'), '📣', 0xf2c230);
    const myst = side('mystery');
    if (myst?.state === 'active') for (const m of MYSTERY) if (!myst.done.includes(m.id)) add(`myst:${m.id}`, d.placeOf(m.place), '❓', 0x8a5bd6);
    if (side('dance')?.state === 'active') add('dance', d.placeOf('熱舞社'), '💃', 0xff4fa3);
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
    if (id === 'lunch') return open({ kind: 'lunch' });
    if (id === 'drums') return open({ kind: 'drums' });
    if (id === 'rollcall') return; // opened by the class flow
    if (id === 'mixer') {
      const who = mixerPartner();
      if (who === null) { pendingScene = null; return; }
      return open({ kind: 'mixer', who });
    }
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
        toast(`📝 小考成績：${r.score} 分${r.cheated ? '（偷看了隔壁…）' : ''}`);
        return;
      }
      case 'lunch': {
        setFlags({ lunchPayer: r.payer });
        if (r.appealWon) unlock('appeal');
        if (r.payer === 'me') {
          const pay = Math.min(LUNCH_EACH * 3, gameStore.getState().coins);
          actions.addCoins(-pay);
          toast(`💸 猜拳輸了，你請客！付了 NT$ ${pay}`);
        } else {
          unlock('treated');
          toast(`🎉 ${r.payer === 'kai' ? ROOMMATE : ROOMMATE2} 請客！這餐免費`);
        }
        d.sound('coin');
        window.setTimeout(() => open({ kind: 'vn', id: 'lunchVn', lines: [
          { who: '', text: '三個人擠在學餐的小桌子，一邊吃一邊聊早上的課。' },
          { who: ROOMMATE2, text: r.payer === 'me' ? '謝啦～下次換我請（大概）。' : r.payer === 'fat' ? '可惡……我的零用錢……' : '阿凱破費了！' },
          { who: ROOMMATE, text: '吃飽了，下午沒課，回宿舍睡個覺吧。' },
        ] }), 300);
        return;
      }
      case 'drums': {
        setFlags({ drumLevel: Math.max(r.level, prog().flags.drumLevel ?? 0) });
        const coins = r.level * 15;
        if (coins) actions.addCoins(coins);
        if (r.level >= 5) unlock('drummer');
        toast(`🥁 打鼓挑戰：過了 ${r.level} 關${coins ? `　+NT$ ${coins}` : ''}`);
        if (step?.cond.t === 'talk' && step.cond.scene === 'drums') advance();
        return;
      }
      case 'dance': {
        setFlags({ danceBest: Math.max(r.score, prog().flags.danceBest ?? 0) });
        const coins = Math.floor(r.score / 100);
        if (coins) actions.addCoins(coins);
        if (r.perfect >= 5) unlock('dancer');
        startSide('dance');
        if (r.score >= 2000) sideProgress('dance', 'cleared');
        toast(`🕺 熱舞社：${r.score} 分${coins ? `　+NT$ ${coins}` : ''}`);
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
      case 'sneakOut':
        // Off the chair, crouched: the sneak starts next frame (seated last frame, not now).
        wasInClass = true;
        d.standUp();
        return;
      case 'vn':
        if (r.id === 'wakeVn' && step?.cond.t === 'getUp') { d.standUp(); advance(true); }
        if (r.id === 'tutorialDoneVn' && step?.cond.t === 'tutorial') {
          // Out the front door, and how to ride a bike (the clock waits).
          d.goOutsideDorm(() => window.setTimeout(() => open({ kind: 'vn', id: 'bikeVn', lines: BIKE_VN }), 500));
        }
        if (r.id === 'bikeVn' && step?.cond.t === 'tutorial') advance(true);
        if (r.id === 'lunchVn' && step?.cond.t === 'talk' && step.cond.scene === 'lunch') {
          d.setClock(gameStore.getState().gameMinutes + 50);
          advance();
        }
        if (r.id === 'skipVn' && step?.cond.t === 'scene') advance(true);
        if (r.id === 'caughtVn' && step?.room) {
          sneak = null;
          storyActions.setLive({ sneak: null });
          if (!d.seatIn(step.place, step.room)) toast(`回到 ${step.room} 坐好`);
        }
        return;
      case 'wardrobe':
        if (step?.cond.t === 'outfit') { advance(); toast('😎 帥！出發去聯誼'); }
        return;
      case 'mixer': {
        const m = MIXER[r.who]!;
        const aff = { ...(prog().flags.mixerAff ?? {}), [m.key]: r.aff };
        const friends = prog().flags.friends ?? [];
        const matched = r.aff >= MIXER_GOAL;
        setFlags({ mixerAff: aff, ...(matched && !friends.includes(m.name) ? { friends: [...friends, m.name] } : {}) });
        if (matched) {
          window.setTimeout(() => { storyActions.message(m.name, m.added); d.sound('open'); }, 1500);
          toast(`📱 和${m.name}交換了 LINE！之後可以在手機聊天室找${m.name}聊天`);
        }
        const left = MIXER.filter((x) => aff[x.key] === undefined).length;
        if (left) { toast(`還有 ${left} 位可以聊聊`); return; }
        const won = MIXER.filter((x) => (aff[x.key] ?? 0) >= MIXER_GOAL).length;
        setFlags({ mixer: won });
        if (won >= MIXER.length) unlock('mixerStar');
        advance();
        return;
      }
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
    if (id === 'returnUsb') {
      actions.takeItem('usbDrive');
      actions.addCoins(100);
      toast('💰 阿凱給了跑腿費 +NT$ 100');
      d.sound('coin');
    }
    const sid = id as string | null;
    if (sid === 'promo') startSide('promo');
    if (sid?.startsWith('mystery:')) {
      const who = sid.slice(8);
      startSide('mystery');
      const before = side('mystery')?.state;
      sideProgress('mystery', who);
      if (before === 'active' && side('mystery')?.state === 'done') {
        actions.giveItem('catFood');
        window.setTimeout(() => toast('🐟 三位神秘人物都見過了……拿到「貓飼料」（可以吃，但沒什麼用）'), 1500);
      }
      return;
    }
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
    if (item === 'catFood') unlock('catFood');
  };
  storyEvents.steal = (item) => {
    if (!actions.giveItem(item)) { toast('背包滿了'); return; }
    unlock('steal');
    setFlags({ badRecord: (prog().flags.badRecord ?? 0) + 1 });
    toast(`🫣 偷偷拿走了 ${ITEMS[item].name}…店員：「同學！你還沒結帳！」`);
    d.sound('close');
  };
  storyEvents.photo = (area, selfie) => {
    if (selfie) unlock('selfie');
    // 街宣打卡: a photo in front of the promo stand.
    const stand = d.placeOf('街宣');
    if (stand && Math.hypot(stand.x - lastX, stand.z - lastZ) < 12 && side('promo')?.state !== 'done') {
      startSide('promo');
      if (actions.giveItem('keychain')) toast('📣 街宣學長：「打卡成功！這個鑰匙圈送你～」');
      sideProgress('promo', 'photo');
    }
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
  // --- Chat app: answers to the story's messages, follow-ups, and free topics -----------------------
  const chatOpts = new Map<string, ChatOption>();
  let chatSeq = 0;
  const typing = new Set<string>();
  const offerChat = (to: string, opts: readonly ChatOption[]): void => {
    storyActions.setReplies(to, opts.map((o) => {
      const id = `c${++chatSeq}`;
      chatOpts.set(id, o);
      return { id, text: o.text };
    }));
  };
  const chatCtx = (): ChatCtx => {
    const g = gameStore.getState();
    return { p: prog(), minute: g.gameMinutes % 1440, coins: g.coins, objective: on() ? currentStep()?.text ?? null : null };
  };
  storyEvents.chatTyping = (to) => typing.has(to);
  storyEvents.chatTopics = (to) => {
    if (typing.has(to)) return [];
    const c = chatCtx();
    return (TOPICS[to] ?? []).flatMap((o, i) => (!o.when || o.when(c) ? [{ id: `t${i}`, text: o.text }] : []));
  };
  storyEvents.chat = (to, reply) => {
    if (typing.has(to)) return;
    if (reply === 'askCode') {
      storyActions.sent(to, '下午點名碼多少？拜託 🙏');
      storyActions.setReplies(to, []);
      if (rcCode) window.setTimeout(() => { storyActions.message(to, `點名碼是 ${rcCode}，快去「點名系統」輸入！`); d.sound('open'); }, 1300);
      return;
    }
    const opt = reply.startsWith('t') ? TOPICS[to]?.[Number(reply.slice(1))] : chatOpts.get(reply);
    if (!opt) return;
    storyActions.sent(to, opt.text);
    storyActions.setReplies(to, []);
    chatOpts.clear();
    const text = resolveAnswer(opt.answer, chatCtx());
    typing.add(to);
    window.setTimeout(() => {
      typing.delete(to);
      storyActions.message(to, text);
      d.sound('open');
      if (opt.next) offerChat(to, opt.next);
    }, Math.min(2400, 800 + text.length * 30));
  };
  storyEvents.raceItem = (item) => {
    const boost = (f: number, t: number, label: string, msg: string): boolean => {
      effect = { t, f, label };
      d.sound(f >= 1 ? 'coin' : 'close');
      toast(msg);
      return true;
    };
    if (item === 'energyDrink') return boost(2.0, 5, '⚡ 能量飲料', '⚡ 咕嚕咕嚕！能量飲料讓你衝刺 5 秒！');
    if (item === 'energyGel') return boost(1.45, 9, '🟢 能量果膠', '🟢 能量果膠吸收中，9 秒小幅加速');
    if (item === 'heavyShoes') return boost(0.6, 6, '🥾 鐵鞋', '🥾 穿上鐵鞋……好重，6 秒跑不快');
    if (item === 'mysteryDrink') {
      return Math.random() < 0.55
        ? boost(2.4, 4, '❓ 神秘飲料', '❓ 神秘飲料……竟然是超級能量！爆衝 4 秒！')
        : boost(0.55, 5, '❓ 神秘飲料', '❓ 神秘飲料……肚子痛！跑不動 5 秒 😣');
    }
    if (item === 'bananaPeel') {
      if (!run || !run.started) { toast('🍌 香蕉皮要在路跑時丟才有用'); return false; }
      let n = 0;
      for (const r of run.runners) {
        const dx = r.g.position.x - (lastX ?? 0), dz = r.g.position.z - (lastZ ?? 0);
        if (Math.hypot(dx, dz) < 22) { r.slow = 6; n++; }
      }
      d.sound('close');
      toast(n ? `🍌 丟出香蕉皮！附近 ${n} 位跑者滑倒，慢了下來` : '🍌 丟出香蕉皮……但附近沒有人');
      return true;
    }
    return false;
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
    critters.update(dt, now, f.x, f.z);
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
      lastCritters = critterSpecs();
      critters.set(lastCritters);
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
      // Day 1 opens as a visual novel once you are lying in bed; it gets you up when it ends.
      if (step.id === '1-1' && !wakeVnDone) {
        if (f.lying && !st().scene) {
          wakeVnT += dt;
          if (wakeVnT > 1.2) { wakeVnDone = true; d.sound('buzz'); open({ kind: 'vn', id: 'wakeVn', lines: WAKE_VN }); }
        }
      } else if (f.lying) wasLying = true;
      else if (wasLying && wakeFor <= 0) { wasLying = false; advance(); }
    }
    // Sleep: only lying in your own bed (C214) — a moment after you lie down, the night passes.
    if (step?.cond.t === 'sleep' && !st().scene) {
      const mine = f.bed && f.bed.room === MY_ROOM.label && f.bed.building.startsWith(DORM);
      if (mine) {
        sleepT += dt;
        if (sleepT > 1.2 && !sleeping) {
          sleeping = true;
          const until = step.cond.until;
          const p = prog();
          toast('😴 Zzz…');
          d.fade(() => {
            if (until !== 'nextDay') d.setClock(dayStart(p.day, until));
            sleeping = false;
            advance();
          });
        }
      } else {
        if (f.bed && !bedNag) { bedNag = true; toast(`這不是你的床！你的寢室是 ${MY_ROOM.number}（${MY_ROOM.label}）`); }
        if (!f.bed) bedNag = false;
        sleepT = 0;
      }
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
    }
    if (step?.cond.t === 'tutorial' && tut && tut.i >= 0) {
      tut.walked += Math.min(1, Math.hypot(f.x - tut.x, f.z - tut.z)); // distance walked, any direction
      tut.x = f.x; tut.z = f.z;
      if (tut.hold > 0) {
        tut.hold -= dt;
        if (tut.hold <= 0) {
          tut.i++;
          if (tut.i >= TUTORIAL.length) {
            storyActions.setLive({ tutorial: null });
            toast('🎉 新手教學完成！');
            tut.i = -1; // finished: the visual novel ends the step
            open({ kind: 'vn', id: 'tutorialDoneVn', lines: TUTORIAL_DONE_VN });
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
    // 翹課: getting up during the lecture starts sneaking out (crouched). Moving fills the professor's
    // attention; out of the room unseen = skipped (the lecture step is over); seen = back to the seat.
    if (step?.cond.t === 'scene' && step.room && !st().scene) {
      const seated = f.seatedIn === step.place && f.seatedRoom === step.room;
      if (wasInClass && !seated && !sneak) {
        sneak = { risk: 0, x: f.x, z: f.z, caught: false };
        toast('🤫 偷偷溜出教室…只能蹲著走，別被郭教授發現！');
      }
      wasInClass = seated;
      if (sneak && seated) { sneak = null; storyActions.setLive({ sneak: null }); }
      if (sneak && !sneak.caught) {
        const moved = Math.hypot(f.x - sneak.x, f.z - sneak.z);
        sneak.x = f.x; sneak.z = f.z;
        const inRoom = d.roomAt(f.x, f.y, f.z) === step.room;
        if (!inRoom) {
          // Out the door unseen.
          sneak = null;
          storyActions.setLive({ sneak: null, lecture: null });
          unlock('skip');
          setFlags({ skipped: (prog().flags.skipped ?? 0) + 1 });
          open({ kind: 'vn', id: 'skipVn', lines: [
            { who: '你', text: '（呼……成功溜出來了！）' },
            { who: '', text: `就這樣翹掉了${PROFESSOR}教授的${COURSE}。` },
            { who: '你', text: '下次點名會不會被抓到啊……算了，先去吃飯！' },
          ] });
        } else {
          // Each second moving: a chance the professor looks up. Standing still in the aisle is safer.
          sneak.risk = Math.min(1, sneak.risk + dt * (moved > 0.005 ? 0.11 : 0.025));
          if (Math.random() < dt * sneak.risk * 0.9) {
            sneak.caught = true;
            setFlags({ badRecord: (prog().flags.badRecord ?? 0) + 1 });
            open({ kind: 'vn', id: 'caughtVn', lines: [
              { who: `${PROFESSOR}教授`, text: '那位蹲在走道上的同學，你要去哪裡？', shake: true },
              { who: '你', text: '呃……我、我在找我的筆……' },
              { who: `${PROFESSOR}教授`, text: '回座位坐好。上課不要亂跑。' },
            ] });
          }
          storyActions.setLive({ sneak: { risk: sneak.risk } });
        }
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
    // Pick up: the item lies in the room (or place); walk over it.
    if (step?.cond.t === 'pickup') {
      if (!pickupAt) {
        const p = d.placeOf(step.room ?? step.place);
        if (p) {
          const y = d.groundAt(p.x, p.z);
          pickupAt = { x: p.x, y, z: p.z };
          pickupMesh.position.set(p.x, y + 0.35, p.z);
          d.scene.add(pickupMesh);
        }
      }
      if (pickupAt) {
        pickupMesh.rotation.y += dt * 2;
        pickupMesh.position.y = pickupAt.y + 0.35 + Math.sin(performance.now() / 300) * 0.05;
        if (Math.hypot(pickupAt.x - f.x, pickupAt.z - f.z) < 1.4 && Math.abs(pickupAt.y - f.y) < 1.5) {
          const item = step.cond.item;
          if (actions.giveItem(item)) {
            pickupMesh.removeFromParent();
            pickupAt = null;
            toast(`拿到了「${ITEMS[item].name}」！`);
            advance();
          } else if (tick % 120 === 0) toast('背包滿了，先整理一下');
        }
      }
    }
    // Race.
    if (step?.cond.t === 'run') {
      if (!run) {
        // From the 操場 assembly to the start line.
        const s0 = d.placeOf('路跑起點');
        if (s0 && Math.hypot(s0.x - f.x, s0.z - f.z) > 12 && !f.riding) {
          toast('🏃 集合完畢！大家移動到起跑線（游泳館旁）');
          d.fade(() => d.teleportTo(s0.x, s0.z));
        }
        startRun();
      }
      if (run && run.started) {
        run.t += dt;
        // Speed pads: run over one for a few seconds of boost.
        run.boost = Math.max(0, run.boost - dt);
        for (const p of run.pads) {
          p.cool = Math.max(0, p.cool - dt);
          if (p.cool <= 0 && Math.hypot(p.x - f.x, p.z - f.z) < 1.8) {
            p.cool = 6;
            run.boost = 3.5;
            d.sound('coin');
            successFx('加速！', { color: FX.boost, calm: true });
            toast('⚡ 加速帶！衝啊！');
          }
        }
        // ? boxes: a random 路跑道具 into your bag.
        for (const b of run.boxes) {
          b.cool = Math.max(0, b.cool - dt);
          b.m.visible = b.cool <= 0;
          b.m.rotation.y += dt * 1.8;
          if (b.cool <= 0 && Math.hypot(b.x - f.x, b.z - f.z) < 1.4) {
            b.cool = 12;
            const r = Math.random();
            const item: ItemId = r < 0.3 ? 'energyDrink' : r < 0.52 ? 'energyGel' : r < 0.72 ? 'bananaPeel' : r < 0.9 ? 'mysteryDrink' : 'heavyShoes';
            if (actions.giveItem(item)) { d.sound('coin'); successFx(`${ITEMS[item].icon} ${ITEMS[item].name}`, { color: FX.goal, calm: true }); toast(`🎁 拿到${ITEMS[item].icon} ${ITEMS[item].name}！選到快捷欄按滑鼠左鍵使用`); }
            else toast('🎒 背包滿了，裝不下道具');
          }
        }
        // Race day: everyone runs faster (×1.3), a speed pad doubles it.
        speedFactor = run.boost > 0 ? 2.1 : 1.3;
        // Barricades: you cannot run through them.
        const lift = f.y - d.groundAt(f.x, f.z);
        for (const bl of run.blocks) {
          if (lift > 0.45) break; // in the air: over the hurdle
          const dx = f.x - bl.x, dz = f.z - bl.z;
          const a = dx * bl.ux + dz * bl.uz, b = -dx * bl.uz + dz * bl.ux;
          const r = 0.45;
          if (Math.abs(a) < bl.hd + r && Math.abs(b) < bl.hw + r) {
            const pushA = (Math.sign(a) || -1) * (bl.hd + r) - a, pushB = (Math.sign(b) || 1) * (bl.hw + r) - b;
            if (Math.abs(pushA) <= Math.abs(pushB)) d.shove(bl.ux * pushA, bl.uz * pushA);
            else d.shove(-bl.uz * pushB, bl.ux * pushB);
          }
        }
        placeRunners(dt);
        // The course is fenced off: step past the cones and you are put back on it.
        const near = nearestOnCourse(run.path, f.x, f.z);
        if (near.d > COURSE_HALF) {
          const k = (near.d - COURSE_HALF + 0.3) / near.d;
          d.shove((near.x - f.x) * k, (near.z - f.z) * k);
          run.outWarned -= dt;
          if (run.outWarned <= 0) { run.outWarned = 3; toast('🚧 路跑路線外禁止進入！沿著三角錐內跑'); }
        }
        const p = run.points[run.next];
        if (p && Math.hypot(p.x - f.x, p.z - f.z) < 9) {
          if (f.riding) {
            if (tick % 40 === 0) toast('🚩 工作人員：騎腳踏車不算喔！下車用跑的');
          } else {
            markers[run.next]?.removeFromParent();
            run.next++;
            const n = run.points[run.next];
            if (n) {
              markNext(run.next);
              successFx(`檢查點 ${run.next}/${run.points.length}`, { color: FX.score });
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
              successFx('完賽！', { color: FX.goal, big: true });
              advance();
              toast(`🏅 完賽！時間 ${Math.floor(t / 60)} 分 ${Math.round(t % 60)} 秒（目標 ${Math.floor(target / 60)} 分 ${Math.round(target % 60)} 秒）`);
            }
          }
        }
      }
    }
    // Speed items: ×effect on top of whatever pace the race gives (or walking pace).
    if (effect.t > 0) effect.t = Math.max(0, effect.t - dt);
    speedFactor = (run && run.started ? (run.boost > 0 ? 2.1 : 1.3) : 1) * (effect.t > 0 ? effect.f : 1);
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
        stamina: null,
        note: effect.t > 0 ? `${effect.label} ${Math.ceil(effect.t)}s` : run && run.boost > 0 ? '⚡ 加速中！' : null,
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
      if (step.cond.t === 'talk' && step.cond.scene === 'mixer' && closeTo('mixer', f)) return `按 E 和${MIXER[mixerPartner(f)!]!.name}一對一聊天`;
      if (step.cond.t === 'talk' && closeTo(step.cond.scene, f)) return step.cond.prompt;

      if (step.cond.t === 'quiz') return step.room && d.roomAt(f.x, f.y, f.z) !== step.room ? `考場在 ${step.room}，進教室再按 E` : '按 E 入座開始小考';
    }
    const free = freeSpot(f);
    if (free) return free.prompt;
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
      if (step.cond.t === 'quiz' && (!step.room || d.roomAt(f.x, f.y, f.z) === step.room)) { pendingScene = 'quiz'; open({ kind: 'exam' }); return 'done'; }

    }
    const free = freeSpot(f);
    if (free) { playFree(free.id); return 'done'; }
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
    openWardrobe() {
      if (on() && prog().day < 2) { toast('衣櫃裡還空空的…（Day 2 開放換裝）'); return; }
      if (st().scene) return;
      if (currentStep()?.cond.t === 'outfit') playScene('wardrobe');
      else open({ kind: 'wardrobe' });
    },
    seatLock() {
      if (st().scene) return '';
      const step = on() ? currentStep() : null;
      const f = lastFrame;
      if (!step || !f) return null;
      if (step.id === '1-1' && !wakeVnDone) return '';
      return null;
    },
    get forceCrouch() { return sneak !== null; },
    get racing() { return on() && currentStep()?.cond.t === 'run'; },
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
      critters.dispose();
      pickupMesh.removeFromParent();
      clearRun();
      d.scene.remove(cardMesh);
      for (const k of Object.keys(storyEvents) as (keyof typeof storyEvents)[]) (storyEvents as Record<string, unknown>)[k] = () => undefined;
    },
  };
}

