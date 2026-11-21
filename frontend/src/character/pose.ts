import { CHARACTER } from '../config';
import { AnimId, type AnimIdValue } from '../ecs/components';

/**
 * Locomotion poses for the placeholder mascot as plain numbers. Used both at runtime
 * (procedural fallback driver) and offline (baked into the placeholder GLB's AnimationClips),
 * so the two paths can never drift apart.
 */
export const POSE_KEYS = [
  'legL', 'legR', 'armLX', 'armRX', 'armSpread',
  'bob', 'lean', 'squash', 'headTilt',
  'leaf0', 'leaf1', 'leaf2',
] as const;
export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;

/** Rest height of the hip pivot above the feet. */
export const BODY_REST_Y = 0.32;
/** Base sideways tilt of the green / blue / yellow sprouts. */
export const LEAF_TILTS: readonly [number, number, number] = [0.5, 0.05, -0.45];
/** Angular rate of the idle "clock" (rad/s). All clock-driven terms use integer multiples so baked loops are seamless. */
export const CLOCK_RATE = 1.1;

export function createPose(): Pose {
  return {
    legL: 0, legR: 0, armLX: 0, armRX: 0, armSpread: 0.35,
    bob: 0, lean: 0, squash: 1, headTilt: 0,
    leaf0: 0, leaf1: 0, leaf2: 0,
  };
}

/** Gait cycles per second at a given ground speed: ~1.85 Hz walking, ~2.8 Hz sprinting. */
export function gaitFrequency(speed: number): number {
  return 0.9 + speed * 0.27;
}

/**
 * @param gait  gait cycle phase (radians), drives walk / run
 * @param clock idle clock (radians), drives breathing, sway and flailing
 */
export function computePose(state: AnimIdValue, gait: number, clock: number, speed: number, out: Pose): Pose {
  const p = out;
  p.legL = 0; p.legR = 0; p.armLX = 0; p.armRX = 0; p.armSpread = 0.35;
  p.bob = 0; p.lean = 0; p.squash = 1; p.headTilt = 0;
  let leafBase = 0;
  let leafWave = 0;
  let leafRate = 3;
  let leafPhase = clock;

  switch (state) {
    case AnimId.Idle: {
      const breathe = Math.sin(clock * 2);
      p.armSpread = 0.38 + breathe * 0.04;
      p.squash = 1 + breathe * 0.015;
      p.headTilt = Math.sin(clock) * 0.04;
      leafWave = 0.06;
      break;
    }
    case AnimId.Walk:
    case AnimId.Run: {
      const run = state === AnimId.Run;
      const s = Math.sin(gait);
      const amp = run ? 0.95 : 0.6;
      p.legL = s * amp;
      p.legR = -s * amp;
      p.armLX = -s * amp * 0.8;
      p.armRX = s * amp * 0.8;
      p.armSpread = run ? 0.3 : 0.32;
      p.bob = Math.abs(s) * (run ? 0.07 : 0.035);
      p.lean = Math.min(speed / CHARACTER.sprintSpeed, 1) * 0.24;
      p.headTilt = -p.lean * 0.4;
      // Sprouts trail behind and bounce twice per gait cycle (once per footfall).
      leafBase = -Math.min(speed / CHARACTER.sprintSpeed, 1) * 0.35;
      leafWave = run ? 0.1 : 0.07;
      leafRate = 2;
      leafPhase = gait;
      break;
    }
    case AnimId.JumpRise:
      p.legL = -0.7;
      p.legR = 0.3;
      p.armSpread = 1.5;
      p.squash = 1.06;
      leafBase = -0.25;
      break;
    case AnimId.Fall:
      p.legL = -0.2;
      p.legR = 0.2;
      p.armSpread = 1.1 + Math.sin(clock * 12) * 0.1;
      leafBase = 0.15;
      leafWave = 0.08;
      leafRate = 12;
      break;
    case AnimId.Land:
      p.legL = -0.35;
      p.legR = -0.35;
      p.armSpread = 0.7;
      p.squash = 0.82;
      leafBase = 0.35;
      break;
  }

  p.leaf0 = leafBase + Math.sin(leafPhase * leafRate) * leafWave;
  p.leaf1 = leafBase + Math.sin(leafPhase * leafRate + 1.7) * leafWave;
  p.leaf2 = leafBase + Math.sin(leafPhase * leafRate + 3.4) * leafWave;
  return p;
}

/** Minimal joint shape so this module stays independent of three.js object types. */
export interface PoseJoint {
  position: { y: number };
  rotation: { x: number; z: number };
  scale: { set(x: number, y: number, z: number): unknown };
}

export interface PoseJoints {
  body: PoseJoint;
  head: PoseJoint;
  armL: PoseJoint;
  armR: PoseJoint;
  legL: PoseJoint;
  legR: PoseJoint;
  leaves: readonly [PoseJoint, PoseJoint, PoseJoint];
}

/** Seated on a bike: raised to the saddle, leaning to the bars, legs following the pedals. */
export function computeRidePose(pedal: number, clock: number, out: Pose): Pose {
  out.legL = -0.95 + Math.sin(pedal) * 0.42;
  out.legR = -0.95 - Math.sin(pedal) * 0.42;
  out.armLX = -1.3;
  out.armRX = -1.3;
  out.armSpread = 0.1;
  out.bob = 0.42;
  out.lean = 0.2;
  out.squash = 1;
  out.headTilt = -0.12;
  out.leaf0 = Math.sin(clock * 3) * 0.14 - 0.25;
  out.leaf1 = Math.sin(clock * 3 + 1) * 0.14 - 0.25;
  out.leaf2 = Math.sin(clock * 3 + 2) * 0.14 - 0.25;
  return out;
}

/**
 * In deep water. Moving: front crawl — body flat on the water (tilted ~77° forward about the hips),
 * arms windmilling in turn, legs flutter-kicking, head lifted to look ahead. Still: treading water —
 * upright, arms sculling at the sides, slow kicks. `float` raises the hips to the water line (the body
 * really stands on the pond bottom).
 * @param stroke stroke phase (radians)
 */
export function computeSwimPose(stroke: number, clock: number, moving: boolean, float: number, out: Pose): Pose {
  if (moving) {
    const s = Math.sin(stroke);
    out.lean = 1.35;
    out.armLX = -1.7 + s * 1.9;
    out.armRX = -1.7 - s * 1.9;
    out.armSpread = 0.22;
    out.legL = 0.12 + Math.sin(stroke * 3) * 0.32;
    out.legR = 0.12 - Math.sin(stroke * 3) * 0.32;
    out.headTilt = -0.95;
    out.bob = float;
    out.squash = 1;
    out.leaf0 = -0.9 + Math.sin(stroke * 2) * 0.12;
    out.leaf1 = -0.9 + Math.sin(stroke * 2 + 1) * 0.12;
    out.leaf2 = -0.9 + Math.sin(stroke * 2 + 2) * 0.12;
  } else {
    const t = Math.sin(clock * 4);
    out.lean = 0.12;
    out.armLX = -0.3 + t * 0.15;
    out.armRX = -0.3 - t * 0.15;
    out.armSpread = 1.0 + t * 0.25;
    out.legL = Math.sin(clock * 3) * 0.3;
    out.legR = -Math.sin(clock * 3) * 0.3;
    out.headTilt = 0;
    out.bob = float;
    out.squash = 1 + t * 0.01;
    out.leaf0 = Math.sin(clock * 2) * 0.1;
    out.leaf1 = Math.sin(clock * 2 + 1) * 0.1;
    out.leaf2 = Math.sin(clock * 2 + 2) * 0.1;
  }
  return out;
}

/** Sitting on a chair (feet at the floor under it, seat top 0.42 m): thighs forward, hands on the desk. */
export function computeSitPose(clock: number, out: Pose): Pose {
  const b = Math.sin(clock * 1.6);
  out.lean = 0.06;
  out.legL = out.legR = -1.45;
  out.armLX = out.armRX = -0.75;
  out.armSpread = 0.22;
  out.bob = 0.16;
  out.squash = 1 + b * 0.008;
  out.headTilt = 0.04 + b * 0.02;
  out.leaf0 = b * 0.06; out.leaf1 = b * 0.06 + 0.02; out.leaf2 = b * 0.06 - 0.02;
  return out;
}

/** Lying on the back (root on the mattress): body tipped back, head toward local −Z, slow breathing. */
export function computeLiePose(clock: number, out: Pose): Pose {
  const b = Math.sin(clock * 1.1);
  out.lean = -Math.PI / 2;
  out.legL = 0.05; out.legR = -0.05;
  out.armLX = out.armRX = 0.1;
  out.armSpread = 0.28;
  out.bob = -0.15;
  out.squash = 1 + b * 0.012;
  out.headTilt = 0;
  out.leaf0 = -0.3; out.leaf1 = -0.25; out.leaf2 = -0.35;
  return out;
}

export function applyPose(j: PoseJoints, p: Pose): void {
  j.legL.rotation.x = p.legL;
  j.legR.rotation.x = p.legR;
  j.armL.rotation.x = p.armLX;
  j.armR.rotation.x = p.armRX;
  j.armL.rotation.z = p.armSpread;
  j.armR.rotation.z = -p.armSpread;
  j.body.position.y = BODY_REST_Y + p.bob;
  j.body.rotation.x = p.lean;
  const sxz = 1 / Math.sqrt(p.squash); // volume-preserving squash & stretch
  j.body.scale.set(sxz, p.squash, sxz);
  j.head.rotation.x = p.headTilt;
  j.leaves[0].rotation.x = p.leaf0;
  j.leaves[1].rotation.x = p.leaf1;
  j.leaves[2].rotation.x = p.leaf2;
}
