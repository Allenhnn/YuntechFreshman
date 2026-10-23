import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Mesh,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { CHARACTER } from '../config';
import { clamp, damp } from '../core/math';
import { AnimId, type AnimIdValue } from '../ecs/components';
import { CLIP_NAMES } from './clipNames';
import { BLINK_OFFSET_U } from './faceAtlas';
import { JOINT_NAMES, findMascotJoints } from './mascot';
import { POSE_KEYS, applyPose, computePose, createPose, gaitFrequency } from './pose';

/**
 * Plays locomotion states on a character model. The ECS animation system decides *which*
 * state is active; a driver only decides *how* it looks. Swapping the placeholder for the
 * final rigged GLB swaps the driver, not the state logic.
 */
export interface AnimationDriver {
  readonly kind: 'clips' | 'procedural';
  update(dt: number, state: AnimIdValue, speed: number, gait: number, clock: number): void;
  dispose(): void;
}

interface StateClip {
  clip: string;
  loop: boolean;
  /** Cross-fade duration *into* this state (s). */
  fadeIn: number;
}

const STATE_CLIPS: Readonly<Record<AnimIdValue, StateClip>> = {
  [AnimId.Idle]: { clip: CLIP_NAMES.idle, loop: true, fadeIn: 0.25 },
  [AnimId.Walk]: { clip: CLIP_NAMES.walk, loop: true, fadeIn: 0.18 },
  [AnimId.Run]: { clip: CLIP_NAMES.run, loop: true, fadeIn: 0.18 },
  [AnimId.JumpRise]: { clip: CLIP_NAMES.jumpStart, loop: false, fadeIn: 0.1 },
  [AnimId.Fall]: { clip: CLIP_NAMES.jumpLoop, loop: true, fadeIn: 0.2 },
  [AnimId.Land]: { clip: CLIP_NAMES.jumpLand, loop: false, fadeIn: 0.06 },
};

const isLocomotion = (s: AnimIdValue): boolean => s === AnimId.Walk || s === AnimId.Run;

// --- Blink ---------------------------------------------------------------------------------

interface Blinker {
  update(dt: number): void;
}

/** Randomised blinking by shifting the face atlas U offset; ~20% of blinks are doubles. */
function createBlinker(root: Object3D): Blinker | null {
  const face = root.getObjectByName(JOINT_NAMES.face);
  if (!(face instanceof Mesh)) return null;
  const mat: Material = Array.isArray(face.material) ? face.material[0] : face.material;
  const map = (mat as Material & { map?: Texture | null }).map;
  if (!map) return null;
  let wait = 1.5 + Math.random() * 2;
  let closed = 0;
  let pendingDouble = false;
  return {
    update(dt) {
      if (closed > 0) {
        closed -= dt;
        if (closed <= 0) {
          map.offset.x = 0;
          if (pendingDouble) {
            pendingDouble = false;
            wait = 0.12;
          }
        }
        return;
      }
      wait -= dt;
      if (wait <= 0) {
        map.offset.x = BLINK_OFFSET_U;
        closed = 0.11;
        pendingDouble = Math.random() < 0.2;
        wait = 2 + Math.random() * 3.5;
      }
    },
  };
}

// --- Clip driver (rigged GLB) ---------------------------------------------------------------

export function createClipDriver(root: Object3D, clips: readonly AnimationClip[]): AnimationDriver {
  const mixer = new AnimationMixer(root);
  const actions = new Map<string, AnimationAction>();
  for (const clip of clips) actions.set(clip.name, mixer.clipAction(clip));
  const missing = Object.values(CLIP_NAMES).filter((n) => !actions.has(n));
  if (missing.length) console.warn(`[anim] model is missing clips: ${missing.join(', ')}`);

  const blinker = createBlinker(root);
  let currentState: AnimIdValue | -1 = -1;
  let current: AnimationAction | undefined;

  const enter = (state: AnimIdValue): void => {
    const spec = STATE_CLIPS[state];
    const next = actions.get(spec.clip);
    const prevState = currentState;
    currentState = state;
    if (!next || next === current) return; // keep the previous clip if this one is missing

    next.reset();
    next.setLoop(spec.loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !spec.loop;
    // Walk <-> Run: start at the same normalised gait phase so the feet don't skip.
    if (current && prevState !== -1 && isLocomotion(prevState) && isLocomotion(state)) {
      next.time = (current.time / current.getClip().duration) * next.getClip().duration;
    }
    next.play();
    if (current) current.crossFadeTo(next, spec.fadeIn, false);
    else next.fadeIn(spec.fadeIn);
    current = next;
  };

  return {
    kind: 'clips',
    update(dt, state, speed) {
      if (state !== currentState) enter(state);
      // Match cadence to ground speed (clips are authored at walk / sprint speed).
      if (current && state === AnimId.Walk) current.timeScale = clamp(gaitFrequency(speed) / gaitFrequency(CHARACTER.walkSpeed), 0.6, 1.5);
      else if (current && state === AnimId.Run) current.timeScale = clamp(gaitFrequency(speed) / gaitFrequency(CHARACTER.sprintSpeed), 0.7, 1.3);
      else if (current) current.timeScale = 1;
      mixer.update(dt);
      blinker?.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}

// --- Procedural driver (fallback) -----------------------------------------------------------

/** How fast joints blend toward the active state's pose; acts as the cross-fade (~0.15 s). */
const BLEND = 16;

export function createProceduralDriver(root: Object3D): AnimationDriver {
  const joints = findMascotJoints(root);
  if (!joints) throw new Error('procedural driver: mascot joints not found');
  const target = createPose();
  const smoothed = createPose();
  const blinker = createBlinker(root);
  return {
    kind: 'procedural',
    update(dt, state, speed, gait, clock) {
      computePose(state, gait, clock, speed, target);
      const k = state === AnimId.Land ? BLEND * 2 : BLEND;
      for (const key of POSE_KEYS) smoothed[key] = damp(smoothed[key], target[key], k, dt);
      applyPose(joints, smoothed);
      blinker?.update(dt);
    },
    dispose() {},
  };
}
