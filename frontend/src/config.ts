/** Central tuning table. Every gameplay "feel" number lives here so it can be tweaked in one place. */

export const MAX_ENTITIES = 1024;

export const PHYSICS_HZ = 60;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Upper bound of fixed steps per rendered frame; prevents the spiral of death after a stall. */
export const MAX_SUBSTEPS = 5;

export const CHARACTER = {
  /** Capsule total height = 2 * (halfHeight + radius) = 1.3 m. */
  capsuleHalfHeight: 0.3,
  capsuleRadius: 0.35,
  skinOffset: 0.02,

  walkSpeed: 3.5,
  sprintSpeed: 7,
  /** Seconds to reach target speed from rest / to stop from sprint speed. */
  accelTime: 0.12,
  decelTime: 0.08,
  airControl: 0.45,

  jumpHeight: 1.4,
  timeToApex: 0.38,
  fallGravityMul: 2,
  /** Extra gravity while rising with the jump key released (variable jump height). */
  lowJumpGravityMul: 2.5,
  terminalVelocity: 30,
  coyoteTime: 0.1,
  jumpBufferTime: 0.1,
  /** Exponential damping rate for facing the move direction (~0.1 s to settle). */
  turnSharpness: 25,

  maxSlopeClimbDeg: 45,
  minSlopeSlideDeg: 35,
  autostepHeight: 0.35,
  autostepMinWidth: 0.2,
  snapToGround: 0.3,

  /** Landing speed (m/s, downward) above which the Land pose and camera dip trigger. */
  hardLandingSpeed: 6,
} as const;

export const CAMERA = {
  distance: 4.5,
  /** Closest the spring arm may pull in (narrow corridors and offices); the character hides below HIDE_BELOW. */
  minDistance: 0.3,
  hideCharacterBelow: 1.1,
  /** Orbit pivot height above the character's feet. */
  pivotHeight: 1.1,
  /** Must cover the near plane's corners (~0.11 m at near 0.1) or walls are seen through at an angle. */
  probeRadius: 0.32,
  sensitivity: 0.0022,
  defaultPitch: 0.3,
  pitchMin: -0.35,
  pitchMax: 1.25,

  rotationSharpness: 25,
  followSharpnessXZ: 14,
  followSharpnessY: 8,
  /** Distance recovery after an obstruction clears (pull-in is instant). */
  recoverSharpness: 4,

  baseFov: 60,
  sprintFov: 72,
  fovSharpness: 6,

  landingDipPerMs: 0.025,
  landingDipMax: 0.2,
  landingDipRecovery: 9,

  /** 0.1 m near plane: close enough for 0.3 m camera clearance indoors, still usable depth precision to 1.6 km. */
  near: 0.1,
  far: 1600,
} as const;

export const WORLD = {
  size: 128,
  segments: 64,
  /** Invisible boundary walls sit just inside the terrain edge. */
  boundary: 62,
  spawn: { x: 0, y: 0, z: 9 },
} as const;

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Half-extent of the sun's orthographic shadow frustum, centred on the player. */
  shadowExtent: 30,
} as const;

/**
 * Use the interiors traced from the 總務處 floor plans (data/buildings/traced.json). Off for now:
 * every building except the library gets a generated interior; the traced data stays in the repo.
 */
export const FLOORPLAN_INTERIORS = false;
/** Traced interiors used even while FLOORPLAN_INTERIORS is off (hand-checked against newer plans). */
export const FLOORPLAN_INTERIOR_IDS: readonly string[] = ['plan-234786942']; // 雲泰表演廳

export const BIKE = {
  /** Cruising and sprinting speed (m/s); walking is 3.5 and running 7. */
  speed: 12,
  sprintSpeed: 16,
  accelTime: 0.8,
  decelTime: 0.55,
  /** How quickly the heading swings toward the steering direction. */
  turnSharpness: 5,
  /** Mount / dismount reach (m). */
  reach: 2.2,
} as const;
