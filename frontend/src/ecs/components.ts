import { MAX_ENTITIES } from '../config';

const f32 = (): Float32Array => new Float32Array(MAX_ENTITIES);
const u8 = (): Uint8Array => new Uint8Array(MAX_ENTITIES);
const u16 = (): Uint16Array => new Uint16Array(MAX_ENTITIES);

/** Feet position + yaw. `prev*` holds the last fixed step so rendering can interpolate. */
export const Transform = {
  x: f32(), y: f32(), z: f32(), rotY: f32(),
  prevX: f32(), prevY: f32(), prevZ: f32(), prevRotY: f32(),
};

export const Velocity = { x: f32(), y: f32(), z: f32() };

export const CharacterMotor = {
  grounded: u8(),
  sprinting: u8(),
  coyote: f32(),
  jumpBuffer: f32(),
  /** Downward speed at the last landing and a counter so per-frame consumers can detect new landings. */
  landingSpeed: f32(),
  landingSeq: u16(),
  /** Increments on every jump take-off (audio / VFX consumers diff against their last seen value). */
  jumpSeq: u16(),
};

export const AnimId = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  JumpRise: 3,
  Fall: 4,
  Land: 5,
} as const;
export type AnimIdValue = (typeof AnimId)[keyof typeof AnimId];
export const ANIM_NAMES: readonly string[] = ['Idle', 'Walk', 'Run', 'JumpRise', 'Fall', 'Land'];

export const AnimState = {
  current: u8(),
  stateTime: f32(),
  /** Gait cycle phase in radians, advanced proportionally to ground speed. */
  phase: f32(),
  lastLandingSeq: u16(),
};

/** Pick-up that disappears on contact and respawns later. Position lives in Transform. */
export const Collectible = {
  active: u8(),
  respawnAt: f32(),
  /** Index into the shared InstancedMesh. */
  instance: u16(),
  value: u8(),
};

/** Tags. Physics handles and Three.js objects live in the side tables in `registry.ts`. */
export const Player = {};
export const PhysicsBody = {};
export const Renderable = {};
