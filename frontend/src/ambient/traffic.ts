import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CircleGeometry, MeshBasicMaterial, SRGBColorSpace, TextureLoader } from 'three';
import type { CampusData, CampusRoad } from '../campus/campusTypes';
import type { ResourceTracker } from '../core/resources';
import { isLongtanMain } from '../campus/longtanConst';

/**
 * Ambient campus life: students walking the footpaths and campus lanes, students cycling the campus
 * roads, scooters and cars only on 大學路 and 龍潭路 beside the main gate (no motor traffic on campus). Purely visual (no colliders, like parked bikes and trees),
 * kept to a ring around the player: agents that drift beyond the fog are moved to a fresh spot
 * inside it, so the cost stays fixed wherever the player goes.
 *
 * Everything is instanced: one draw call per body part / vehicle part. Agents follow the road graph
 * built from campus.json (polylines joined where their vertices meet), turn at random at junctions,
 * keep to the right-hand side of the road, and stop for the player standing in their way.
 */
export interface Traffic {
  setEnabled(kind: 'people' | 'vehicles', on: boolean): void;
  /** Headlights and tail lights glow after dark (0 day … 1 night). */
  setNight(night: number): void;
  /** A cyclist within `r` of (x, z) (you could take their bike). */
  cyclistNear(x: number, z: number, r: number): boolean;
  /**
   * Takes the bike of the nearest cyclist within `r`: they end up on foot beside it (knocked down,
   * then walking off) and their bike leaves traffic. Returns where the bike was standing.
   */
  robCyclist(x: number, z: number, r: number): { x: number; z: number; yaw: number } | null;
  /** A walker within `r` of (x, z) is knocked over; true when someone was hit. */
  hit(x: number, z: number, r: number): boolean;
  update(dt: number, px: number, pz: number): void;
  dispose(): void;
}

type Net = 'walk' | 'bike' | 'motor' | 'car';

interface Edge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  a: number;
  b: number;
  /** Lateral room from the centre line (m). */
  half: number;
  /** Divided road: centre offset of each carriageway. */
  lane: number;
}

interface Graph {
  edges: Edge[];
  /** Edge indices meeting at each node. */
  at: number[][];
  /** Cumulative edge lengths for length-weighted sampling. */
  cum: Float64Array;
}

type Kind = 'walker' | 'cyclist' | 'scooter' | 'car';

interface Agent {
  kind: Kind;
  net: Graph;
  edge: number;
  /** Travelling from edge.a to edge.b. */
  forward: boolean;
  /** Distance along the edge in the direction of travel. */
  s: number;
  speed: number;
  /** Right-hand offset from the edge centre line (walkers: either side). */
  side: number;
  phase: number;
  x: number;
  z: number;
  yaw: number;
  /** Person instance index (walkers, cyclists, scooter riders), or -1. */
  person: number;
  /** Vehicle instance index within its kind, or -1. */
  vehicle: number;
  cur: number;
  /** Instances currently collapsed to nothing (kind switched off). */
  hidden: boolean;
  /** Seconds left lying on the ground after being hit by a bike (walkers). */
  fall: number;
  /** Respawn beyond the fog next time (a robbed cyclist must not reappear in view). */
  far?: boolean;
}

const RANGE = 175; // m: fog is opaque from 190 m
const RESPAWN_MIN = 120;
const COUNTS: Record<Kind, number> = { walker: 70, cyclist: 16, scooter: 22, car: 12 };
const SPEED: Record<Kind, [number, number]> = { walker: [1.0, 1.5], cyclist: [3.2, 4.8], scooter: [7, 10], car: [7, 11] };

const SKIN = [0xf1c9a5, 0xe0ac85, 0xc98f68, 0xf5d6bc].map((c) => new Color(c));
const HAIR = [0x1c1a19, 0x2b211b, 0x3d2b20, 0x4a3a2a, 0x151515].map((c) => new Color(c));
const SHIRT = [0xffffff, 0x2c6fd6, 0x1f8f4a, 0xf2c230, 0xd8553a, 0x8a5bd6, 0x37474f, 0xf48fb1, 0x90a4ae, 0x26a69a].map((c) => new Color(c));
const PANTS = [0x2d3a5c, 0x1f1f24, 0x6d6d73, 0x9a8a6c, 0x34495e].map((c) => new Color(c));
const HELMET = [0xffffff, 0xd8553a, 0x2c6fd6, 0x1f1f24, 0xf2c230].map((c) => new Color(c));
const CAR = [0xf4f4f4, 0x1f1f24, 0x9ea4aa, 0xb3262e, 0x2b4c7e, 0x6d6d73, 0xe8e2d0].map((c) => new Color(c));
const SCOOTER = [0xf4f4f4, 0x1f1f24, 0x9ea4aa, 0x2c6fd6, 0xd8553a, 0x88b04b].map((c) => new Color(c));

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function inRing(x: number, z: number, r: number[]): boolean {
  let hit = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function buildGraph(roads: readonly CampusRoad[], keep: (r: CampusRoad) => boolean, inside: ((x: number, z: number) => boolean) | null, blocked?: (x: number, z: number) => boolean): Graph {
  const nodes = new Map<string, number>();
  const node = (x: number, z: number): number => {
    const k = `${Math.round(x)},${Math.round(z)}`;
    let id = nodes.get(k);
    if (id === undefined) { id = nodes.size; nodes.set(k, id); }
    return id;
  };
  const edges: Edge[] = [];
  for (const r of roads) {
    if (!keep(r)) continue;
    const p = r.points;
    const median = r.median ?? 0;
    const lane = median > 0 ? median / 2 + (r.width - median) / 4 : 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!, az = p[i + 1]!, bx = p[i + 2]!, bz = p[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      if (inside && !(inside(ax, az) && inside(bx, bz))) continue;
      if (blocked && (blocked(ax, az) || blocked(bx, bz) || blocked((ax + bx) / 2, (az + bz) / 2))) continue;
      edges.push({ ax, az, bx, bz, len, a: node(ax, az), b: node(bx, bz), half: Math.max(0.3, r.width / 2), lane });
    }
  }
  const at: number[][] = Array.from({ length: nodes.size }, () => []);
  edges.forEach((e, i) => { at[e.a]!.push(i); at[e.b]!.push(i); });
  const cum = new Float64Array(edges.length);
  let t = 0;
  edges.forEach((e, i) => { t += e.len; cum[i] = t; });
  return { edges, at, cum };
}

/** A random edge, weighted by length, whose midpoint is between rMin and rMax of (px, pz). */
function sampleEdge(g: Graph, px: number, pz: number, rMin: number, rMax: number): number {
  const total = g.cum[g.cum.length - 1] ?? 0;
  for (let tries = 0; tries < 40; tries++) {
    const v = Math.random() * total;
    let lo = 0, hi = g.cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (g.cum[mid]! < v) lo = mid + 1; else hi = mid; }
    const e = g.edges[lo]!;
    const d = Math.hypot((e.ax + e.bx) / 2 - px, (e.az + e.bz) / 2 - pz);
    if (d >= rMin && d <= rMax) return lo;
  }
  return -1;
}

// ---------- Geometry (local frame: forward = +Z, ground y = 0) ----------
function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  if (!g) throw new Error('traffic geometry merge failed');
  return g;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
function tube(a: [number, number, number], b: [number, number, number], r: number): BufferGeometry {
  const from = new Vector3(...a), to = new Vector3(...b), dir = to.clone().sub(from);
  const g = new CylinderGeometry(r, r, dir.length(), 6, 1);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

const LEG = 0.8;
const ARM = 0.6;

/** 大學路 (二段 / 三段) and 龍潭路, the public streets beside the main gate. */
const streetByGate = (r: CampusRoad): boolean => r.kind !== 'walkway' && !!r.name && (r.name.startsWith('大學路') || isLongtanMain(r));

/** `blocked`: places people must not walk over (sunken courtyards cut into the ground). */
export function createTraffic(scene: Scene, campus: CampusData, tracker: ResourceTracker, blocked?: (x: number, z: number) => boolean): Traffic {
  const inside = (x: number, z: number): boolean => inRing(x, z, campus.boundary);
  const nets: Record<Net, Graph> = {
    walk: buildGraph(campus.roads, (r) => r.kind === 'walkway' || r.kind === 'service', null, blocked),
    bike: buildGraph(campus.roads, (r) => r.kind === 'service' || r.kind === 'minor', inside, blocked),
    // Scooters and cars stay off campus: only the streets by the main gate (大學路, 龍潭路).
    motor: buildGraph(campus.roads, streetByGate, null),
    car: buildGraph(campus.roads, streetByGate, null),
  };
  const netOf: Record<Kind, Graph> = { walker: nets.walk, cyclist: nets.bike, scooter: nets.motor, car: nets.car };

  // --- Meshes --------------------------------------------------------------------------------
  const mat = (color = 0xffffff, rough = 0.85): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ color, roughness: rough }));
  const white = mat();
  const dark = mat(0x1d1d20, 0.6);
  const glass = mat(0x22303a, 0.25);
  const people = COUNTS.walker + COUNTS.cyclist + COUNTS.scooter;
  const inst = (geo: BufferGeometry, m: MeshStandardMaterial, n: number): InstancedMesh => {
    const mesh = new InstancedMesh(tracker.geometry(geo), m, n);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole ring around the player
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const torsoM = inst(new CapsuleGeometry(0.17, 0.32, 3, 8).scale(1.1, 1, 0.7).translate(0, 0.3, 0), white, people);
  const headM = inst(new SphereGeometry(0.12, 10, 8).translate(0, 0.74, 0), white, people);
  const hairM = inst(new SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.76, -0.01), white, people);
  const legM = inst(new CapsuleGeometry(0.07, LEG - 0.14, 2, 6).translate(0, -LEG / 2, 0), white, people * 2);
  const armM = inst(new CapsuleGeometry(0.05, ARM - 0.1, 2, 6).translate(0, -ARM / 2, 0), white, people * 2);

  const bikeFrame = merged([
    tube([0, 0.3, -0.46], [0, 0.62, -0.18], 0.025), tube([0, 0.62, -0.18], [0, 0.66, 0.28], 0.025),
    tube([0, 0.3, -0.06], [0, 0.66, 0.28], 0.025), tube([0, 0.3, -0.06], [0, 0.3, -0.46], 0.02),
    tube([0, 0.62, -0.18], [0, 0.3, -0.06], 0.025), tube([0, 0.66, 0.28], [0, 0.3, 0.46], 0.022),
    box(0.5, 0.03, 0.03, 0, 0.82, 0.3), tube([0, 0.66, 0.28], [0, 0.82, 0.3], 0.02), box(0.12, 0.04, 0.22, 0, 0.66, -0.2),
  ]);
  const bikeM = inst(bikeFrame, white, COUNTS.cyclist);
  const bikeWheelM = inst(new TorusGeometry(0.3, 0.025, 6, 16).rotateY(Math.PI / 2).translate(0, 0.3, 0), dark, COUNTS.cyclist * 2);

  const scooterBody = merged([
    box(0.3, 0.12, 1.0, 0, 0.32, -0.05), box(0.36, 0.34, 0.55, 0, 0.55, -0.4), box(0.3, 0.12, 0.55, 0, 0.78, -0.38),
    box(0.34, 0.62, 0.14, 0, 0.62, 0.42), box(0.6, 0.05, 0.05, 0, 1.0, 0.45), box(0.18, 0.12, 0.08, 0, 0.9, 0.52),
  ]);
  const scooterM = inst(scooterBody, white, COUNTS.scooter);
  const scooterWheelM = inst(new CylinderGeometry(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2).translate(0, 0.22, 0), dark, COUNTS.scooter * 2);

  const carBody = merged([box(1.76, 0.62, 4.3, 0, 0.62, 0), box(1.7, 0.18, 4.36, 0, 0.36, 0)]);
  const carM = inst(carBody, white, COUNTS.car);
  const cabinM = inst(merged([box(1.56, 0.55, 2.2, 0, 1.2, -0.25)]), glass, COUNTS.car);
  const roofM = inst(box(1.5, 0.06, 1.9, 0, 1.5, -0.3), white, COUNTS.car);
  const carWheelM = inst(new CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2).translate(0, 0.33, 0), dark, COUNTS.car * 4);
  const lights = merged([box(0.3, 0.12, 0.04, -0.6, 0.7, 2.16), box(0.3, 0.12, 0.04, 0.6, 0.7, 2.16)]);
  const tail = merged([box(0.3, 0.1, 0.04, -0.62, 0.72, -2.16), box(0.3, 0.1, 0.04, 0.62, 0.72, -2.16)]);
  const headMat = mat(0xfff6d8, 0.3);
  const tailMat = mat(0xc4212b, 0.4);
  headMat.emissive.setHex(0xfff2c8);
  tailMat.emissive.setHex(0xff2a2a);
  headMat.emissiveIntensity = tailMat.emissiveIntensity = 0;
  const headLightM = inst(lights, headMat, COUNTS.car);
  const tailLightM = inst(tail, tailMat, COUNTS.car);

  // Faces: the user's four photos (public/textures/faces/, local only), one instanced disc per photo on
  // the front of the head. Missing files (a fresh clone) just leave the plain heads.
  const FACE_FILES = ['face1', 'face2', 'face3', 'face4'];
  const faceGeo = tracker.geometry(new CircleGeometry(0.105, 20).translate(0, 0.74, 0.128));
  const loader = new TextureLoader();
  const faceMeshes = FACE_FILES.map((f) => {
    const mat = tracker.material(new MeshBasicMaterial({ transparent: true, alphaTest: 0.2 }));
    const mesh = new InstancedMesh(faceGeo, mat, people);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = false;
    loader.load(`/textures/faces/${f}.png`, (t) => {
      t.colorSpace = SRGBColorSpace;
      mat.map = tracker.texture(t);
      mat.needsUpdate = true;
      mesh.visible = true;
    }, undefined, () => { mesh.visible = false; });
    scene.add(mesh);
    return mesh;
  });
  /** Person → [face mesh, slot in it]. */
  const faceOf: [number, number][] = [];
  const faceCount = FACE_FILES.map(() => 0);
  for (let i = 0; i < people; i++) { const f = i % FACE_FILES.length; faceOf.push([f, faceCount[f]!++]); }
  const peopleMeshes = [torsoM, headM, hairM, legM, armM, bikeM, bikeWheelM];
  const vehicleMeshes = [scooterM, scooterWheelM, carM, cabinM, roofM, carWheelM, headLightM, tailLightM];

  // --- Agents --------------------------------------------------------------------------------
  const agents: Agent[] = [];
  let personNext = 0;
  const vehicleNext: Record<Kind, number> = { walker: 0, cyclist: 0, scooter: 0, car: 0 };
  for (const kind of ['walker', 'cyclist', 'scooter', 'car'] as Kind[]) {
    if (!netOf[kind].edges.length) continue;
    for (let i = 0; i < COUNTS[kind]; i++) {
      const person = kind === 'car' ? -1 : personNext++;
      const vehicle = kind === 'walker' ? -1 : vehicleNext[kind]++;
      agents.push({ kind, net: netOf[kind], edge: -1, forward: true, s: 0, speed: 0, side: 0, phase: Math.random() * 10, x: 0, z: 0, yaw: 0, person, vehicle, cur: 0, hidden: false, fall: 0 });
      if (person >= 0) {
        const shirt = kind === 'scooter' && Math.random() < 0.4 ? new Color(0x2a2f35) : pick(SHIRT);
        torsoM.setColorAt(person, shirt);
        armM.setColorAt(person * 2, shirt);
        armM.setColorAt(person * 2 + 1, shirt);
        headM.setColorAt(person, pick(SKIN));
        hairM.setColorAt(person, kind === 'scooter' ? pick(HELMET) : pick(HAIR));
        const pants = pick(PANTS);
        legM.setColorAt(person * 2, pants);
        legM.setColorAt(person * 2 + 1, pants);
      }
      if (kind === 'cyclist') bikeM.setColorAt(vehicle, pick([0x1f8f4a, 0x2c6fd6, 0xf2c230, 0xd8553a, 0x1d1d20].map((c) => new Color(c))));
      if (kind === 'scooter') scooterM.setColorAt(vehicle, pick(SCOOTER));
      if (kind === 'car') { const c = pick(CAR); carM.setColorAt(vehicle, c); roofM.setColorAt(vehicle, c); }
    }
  }
  for (const m of [...peopleMeshes, ...vehicleMeshes]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  const place = (a: Agent, px: number, pz: number, initial: boolean): boolean => {
    const e = sampleEdge(a.net, px, pz, initial ? 8 : RESPAWN_MIN, RANGE);
    if (e < 0) return false;
    const edge = a.net.edges[e]!;
    a.edge = e;
    a.forward = Math.random() < 0.5;
    a.s = Math.random() * edge.len;
    const [lo, hi] = SPEED[a.kind];
    a.speed = rand(lo, hi);
    a.cur = a.speed;
    a.side = a.kind === 'walker' ? rand(-1, 1) : rand(0.55, 0.85);
    return true;
  };

  /** Move on to the next edge at the node just reached. */
  const turn = (a: Agent): void => {
    const e = a.net.edges[a.edge]!;
    const nodeId = a.forward ? e.b : e.a;
    const options = a.net.at[nodeId]!.filter((i) => i !== a.edge);
    if (!options.length) { // dead end: turn back
      a.forward = !a.forward;
      a.s = 0;
      return;
    }
    const next = pick(options);
    const n = a.net.edges[next]!;
    a.edge = next;
    a.forward = n.a === nodeId;
    a.s = 0;
  };

  let enabled = { people: true, vehicles: true };
  let lastPx = NaN, lastPz = NaN;
  const m4 = new Matrix4(), base = new Matrix4(), tmp = new Matrix4(), part = new Matrix4();
  const one = new Vector3(1, 1, 1), pos = new Vector3(), q = new Quaternion(), yAxis = new Vector3(0, 1, 0);

  const armMat = new Matrix4(), legMat = new Matrix4(), lean = new Matrix4();
  const zero = new Matrix4().makeScale(0, 0, 0);
  /** Collapse an agent's instances (its kind is switched off). */
  const hide = (a: Agent): void => {
    if (a.person >= 0) {
      for (const m of [torsoM, headM, hairM]) m.setMatrixAt(a.person, zero);
      { const [f, slot] = faceOf[a.person]!; faceMeshes[f]!.setMatrixAt(slot, zero); }
      for (const m of [legM, armM]) { m.setMatrixAt(a.person * 2, zero); m.setMatrixAt(a.person * 2 + 1, zero); }
    }
    const v = a.vehicle;
    if (a.kind === 'cyclist') { bikeM.setMatrixAt(v, zero); bikeWheelM.setMatrixAt(v * 2, zero); bikeWheelM.setMatrixAt(v * 2 + 1, zero); }
    if (a.kind === 'scooter') { scooterM.setMatrixAt(v, zero); scooterWheelM.setMatrixAt(v * 2, zero); scooterWheelM.setMatrixAt(v * 2 + 1, zero); }
    if (a.kind === 'car') {
      for (const m of [carM, cabinM, roofM, headLightM, tailLightM]) m.setMatrixAt(v, zero);
      for (let w = 0; w < 4; w++) carWheelM.setMatrixAt(v * 4 + w, zero);
    }
    a.hidden = true;
  };

  /** body: hip height, torso pitch, leg/arm angles (+ swings back). */
  const drawPerson = (i: number, b: Matrix4, hip: number, pitch: number, legL: number, legR: number, armL: number, armR: number): void => {
    const trunk = tmp.copy(b).multiply(part.makeTranslation(0, hip, 0)).multiply(m4.makeRotationX(pitch));
    torsoM.setMatrixAt(i, trunk);
    headM.setMatrixAt(i, trunk);
    hairM.setMatrixAt(i, trunk);
    { const [f, slot] = faceOf[i]!; faceMeshes[f]!.setMatrixAt(slot, trunk); }
    for (const [k, side, ang] of [[0, -1, armL], [1, 1, armR]] as const) {
      const arm = armMat.copy(trunk).multiply(part.makeTranslation(side * 0.24, 0.55, 0)).multiply(m4.makeRotationX(ang)).multiply(part.makeRotationZ(side * 0.08));
      armM.setMatrixAt(i * 2 + k, arm);
    }
    for (const [k, side, ang] of [[0, -1, legL], [1, 1, legR]] as const) {
      const leg = legMat.copy(b).multiply(part.makeTranslation(side * 0.1, hip, 0)).multiply(m4.makeRotationX(ang));
      legM.setMatrixAt(i * 2 + k, leg);
    }
  };

  if (import.meta.env.DEV) {
    (window as unknown as { __traffic: unknown }).__traffic = {
      walkers: () => agents.filter((a) => a.kind === 'walker' && !a.hidden && a.edge >= 0).map((a) => ({ x: a.x, z: a.z, yaw: a.yaw, fall: a.fall })),
      cyclists: () => agents.filter((a) => a.kind === 'cyclist' && !a.hidden && a.edge >= 0).map((a) => ({ x: a.x, z: a.z, yaw: a.yaw })),
      vehicles: () => agents.filter((a) => (a.kind === 'car' || a.kind === 'scooter') && !a.hidden && a.edge >= 0).map((a) => ({ kind: a.kind, x: a.x, z: a.z })),
      inCampus: (x: number, z: number) => inRing(x, z, campus.boundary),
    };
  }
  return {
    setEnabled(kind, on) {
      enabled = { ...enabled, [kind]: on };
    },
    setNight(night) {
      headMat.emissiveIntensity = night * 3;
      tailMat.emissiveIntensity = night * 1.5;
    },
    cyclistNear(x, z, r) {
      if (!enabled.people) return false;
      return agents.some((a) => a.kind === 'cyclist' && !a.hidden && a.edge >= 0 && Math.hypot(a.x - x, a.z - z) < r);
    },
    robCyclist(x, z, r) {
      if (!enabled.people) return null;
      let best: Agent | null = null, bestD = r;
      for (const a of agents) {
        if (a.kind !== 'cyclist' || a.hidden || a.edge < 0) continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d < bestD) { best = a; bestD = d; }
      }
      if (!best) return null;
      const pose = { x: best.x, z: best.z, yaw: best.yaw };
      best.edge = -1; // leaves traffic; comes back as someone else, far away
      best.far = true;
      // The rider, now on foot: a walker put on the nearest footpath, knocked down first.
      const g = nets.walk;
      let edge = -1, ed = Infinity, et = 0;
      g.edges.forEach((e, i) => {
        const dx = e.bx - e.ax, dz = e.bz - e.az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((pose.x - e.ax) * dx + (pose.z - e.az) * dz) / l2));
        const d = Math.hypot(e.ax + dx * t - pose.x, e.az + dz * t - pose.z);
        if (d < ed) { ed = d; edge = i; et = t; }
      });
      const walker = agents
        .filter((a) => a.kind === 'walker' && !a.hidden && a.fall <= 0)
        .sort((m, n) => Math.hypot(n.x - x, n.z - z) - Math.hypot(m.x - x, m.z - z))[0];
      if (walker && edge >= 0 && ed < 25) {
        const e = g.edges[edge]!;
        walker.edge = edge;
        walker.forward = Math.random() < 0.5;
        walker.s = (walker.forward ? et : 1 - et) * e.len;
        walker.x = NaN;
        walker.fall = 2.2;
        walker.speed = 1.6; // hurries off afterwards
      }
      return pose;
    },
    hit(x, z, r) {
      if (!enabled.people) return false;
      for (const a of agents) {
        if (a.kind !== 'walker' || a.hidden || a.edge < 0 || a.fall > 0) continue;
        if (Math.hypot(a.x - x, a.z - z) < r) {
          a.fall = 2.2;
          return true;
        }
      }
      return false;
    },
    update(dt, px, pz) {
      const jumped = !(Math.hypot(px - lastPx, pz - lastPz) < 60); // first frame or a teleport
      lastPx = px;
      lastPz = pz;
      for (const a of agents) {
        const vehicleKind = a.kind === 'scooter' || a.kind === 'car';
        if (vehicleKind ? !enabled.vehicles : !enabled.people) {
          if (!a.hidden) hide(a);
          continue;
        }
        if (a.hidden) { a.hidden = false; a.edge = -1; }
        if (a.edge < 0 || jumped || Math.hypot(a.x - px, a.z - pz) > RANGE + 15) {
          const initial = (a.edge < 0 || jumped) && !a.far;
          a.far = false;
          if (!place(a, px, pz, initial)) { hide(a); continue; }
          a.x = NaN;
        }
        let e = a.net.edges[a.edge]!;
        // Direction of travel and the point on the edge.
        let dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
        if (!a.forward) { dx = -dx; dz = -dz; }
        // Stop for the player standing in the way.
        const ox = px - a.x, oz = pz - a.z;
        const ahead = ox * dx + oz * dz, across = Math.abs(ox * dz - oz * dx);
        const look = a.kind === 'car' ? 7 : a.kind === 'scooter' ? 5 : 2;
        const want = a.fall > 0 || (ahead > 0 && ahead < look && across < (a.kind === 'car' ? 1.6 : 0.9)) ? 0 : a.speed;
        a.cur += (want - a.cur) * Math.min(1, dt * (want < a.cur ? 6 : 1.5));
        a.s += a.cur * dt;
        let guard = 0;
        while (a.s > e.len && guard++ < 8) {
          const over = a.s - e.len;
          turn(a);
          a.s += over;
          e = a.net.edges[a.edge]!;
        }
        dx = (e.bx - e.ax) / e.len; dz = (e.bz - e.az) / e.len;
        let sx = e.ax + dx * a.s, sz = e.az + dz * a.s;
        if (!a.forward) { sx = e.bx - dx * a.s; sz = e.bz - dz * a.s; dx = -dx; dz = -dz; }
        // Keep right (x east, z south: right of heading (dx, dz) is (-dz, dx)); walkers use either side.
        const lateral = a.kind === 'walker' ? a.side * Math.max(0, e.half - 0.5) : e.lane + a.side * Math.max(0.4, e.half - e.lane - (a.kind === 'car' ? 1.4 : 0.6)) * (e.lane ? 0.5 : 1);
        const tx = sx - dz * lateral, tz = sz + dx * lateral;
        const targetYaw = Math.atan2(dx, dz);
        if (Number.isNaN(a.x)) { a.x = tx; a.z = tz; a.yaw = targetYaw; }
        const k = Math.min(1, dt * 6);
        a.x += (tx - a.x) * k;
        a.z += (tz - a.z) * k;
        let dy = targetYaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 5);

        base.compose(pos.set(a.x, 0, a.z), q.setFromAxisAngle(yAxis, a.yaw), one);
        a.phase += a.cur * dt;
        if (a.kind === 'walker' && a.fall > 0) {
          // Knocked over: tip backwards, lie there, get up.
          a.fall -= dt;
          const t = 2.2 - a.fall;
          const tilt = t < 0.3 ? (t / 0.3) * 1.45 : a.fall < 0.4 ? (a.fall / 0.4) * 1.45 : 1.45;
          base.multiply(part.makeRotationX(-tilt));
          drawPerson(a.person, base, LEG + 0.02, 0, 0.3, -0.2, -1.2, -1.0);
        } else if (a.kind === 'walker') {
          const w = a.phase * 4.2, swing = Math.sin(w) * 0.5 * Math.min(1, a.cur);
          base.multiply(part.makeTranslation(0, Math.abs(Math.cos(w)) * 0.03, 0));
          drawPerson(a.person, base, LEG + 0.02, 0.04, swing, -swing, -swing * 0.8, swing * 0.8);
        } else if (a.kind === 'cyclist') {
          const crank = a.phase * 2.2;
          drawPerson(a.person, base, 0.95, 0.42, -1.05 + Math.sin(crank) * 0.45, -1.05 - Math.sin(crank) * 0.45, -1.15, -1.15);
          const v = a.vehicle;
          bikeM.setMatrixAt(v, base);
          bikeWheelM.setMatrixAt(v * 2, tmp.copy(base).multiply(part.makeTranslation(0, 0, 0.46)));
          bikeWheelM.setMatrixAt(v * 2 + 1, tmp.copy(base).multiply(part.makeTranslation(0, 0, -0.46)));

        } else if (a.kind === 'scooter') {
          lean.copy(base).multiply(part.makeTranslation(0, 0, -0.35));
          drawPerson(a.person, lean, 0.82, 0.12, -1.35, -1.35, -0.95, -0.95);
          const v = a.vehicle;
          scooterM.setMatrixAt(v, base);
          scooterWheelM.setMatrixAt(v * 2, tmp.copy(base).multiply(part.makeTranslation(0, 0, 0.5)));
          scooterWheelM.setMatrixAt(v * 2 + 1, tmp.copy(base).multiply(part.makeTranslation(0, 0, -0.55)));

        } else {
          const v = a.vehicle;
          carM.setMatrixAt(v, base);
          cabinM.setMatrixAt(v, base);
          roofM.setMatrixAt(v, base);
          headLightM.setMatrixAt(v, base);
          tailLightM.setMatrixAt(v, base);
          for (const [w, x, z] of [[0, -0.8, 1.35], [1, 0.8, 1.35], [2, -0.8, -1.35], [3, 0.8, -1.35]] as const) {
            carWheelM.setMatrixAt(v * 4 + w, tmp.copy(base).multiply(part.makeTranslation(x, 0, z)));
          }
        }
      }
      // Instances are written at fixed indices per agent: draw up to the highest index in use.
      for (const m of [torsoM, headM, hairM]) { m.count = personNext; m.instanceMatrix.needsUpdate = true; }
      faceMeshes.forEach((m, f) => { m.count = faceCount[f]!; m.instanceMatrix.needsUpdate = true; });
      for (const m of [legM, armM]) { m.count = personNext * 2; m.instanceMatrix.needsUpdate = true; }
      bikeM.count = vehicleNext.cyclist; bikeWheelM.count = vehicleNext.cyclist * 2;
      scooterM.count = vehicleNext.scooter; scooterWheelM.count = vehicleNext.scooter * 2;
      for (const m of [carM, cabinM, roofM, headLightM, tailLightM]) m.count = vehicleNext.car;
      carWheelM.count = vehicleNext.car * 4;
      for (const m of [bikeM, bikeWheelM, scooterM, scooterWheelM, carM, cabinM, roofM, carWheelM, headLightM, tailLightM]) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const m of [...peopleMeshes, ...vehicleMeshes, ...faceMeshes]) {
        scene.remove(m);
        m.dispose();
      }
    },
  };
}
