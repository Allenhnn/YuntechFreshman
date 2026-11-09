import { query, type World } from 'bitecs';
import { RAPIER } from '../../physics/physics';
import { BIKE, CHARACTER } from '../../config';
import { DEG2RAD, dampAngle } from '../../core/math';
import { Action, type Input } from '../../input/input';
import { CharacterMotor, PhysicsBody, Player, Transform, Velocity } from '../components';
import { bodies, colliders } from '../registry';

const C = CHARACTER;
/** Derived from jump height and time-to-apex: g = 2h/t², v0 = 2h/t. */
const GRAVITY = (2 * C.jumpHeight) / (C.timeToApex * C.timeToApex);
const JUMP_VELOCITY = (2 * C.jumpHeight) / C.timeToApex;
/** Capsule centre sits this far above the feet. */
export const CAPSULE_CENTER_OFFSET = C.capsuleHalfHeight + C.capsuleRadius;

/** Tester-mode movement modifiers (dev builds). */
export interface MoveModifiers {
  /** No gravity: Space rises, C descends. */
  fly: boolean;
  /** Ignore all collision (only meaningful while flying). */
  noclip: boolean;
  /** Multiplies walk / sprint / fly speed. */
  speed: number;
  /** Riding a bike: faster, steers along its heading, cannot jump. */
  bike?: boolean;
  /** Footprints the bike may not enter (door gaps would otherwise let it indoors). */
  blocked?: ((x: number, z: number) => boolean) | null;
}

const NORMAL: MoveModifiers = { fly: false, noclip: false, speed: 1 };
/** Base flying speed (m/s) before sprint and the tester multiplier. */
const FLY_SPEED = 8;

export interface CharacterControllerSystem {
  /**
   * `pressed` are the action bits pressed since the previous fixed step. `filter` can exclude
   * colliders per call (e.g. the campus ground while the player is over a basement).
   */
  update(world: World, dt: number, pressed: number, cameraYaw: number, filter?: (collider: RAPIER.Collider) => boolean, mods?: MoveModifiers): void;
  dispose(): void;
}

export function createCharacterControllerSystem(physics: RAPIER.World, input: Input): CharacterControllerSystem {
  const kcc = physics.createCharacterController(C.skinOffset);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.setMaxSlopeClimbAngle(C.maxSlopeClimbDeg * DEG2RAD);
  kcc.setMinSlopeSlideAngle(C.minSlopeSlideDeg * DEG2RAD);
  kcc.enableAutostep(C.autostepHeight, C.autostepMinWidth, false);
  kcc.enableSnapToGround(C.snapToGround);
  kcc.setSlideEnabled(true);
  kcc.setApplyImpulsesToDynamicBodies(true);

  const desired = { x: 0, y: 0, z: 0 };
  const next = { x: 0, y: 0, z: 0 };

  return {
    update(world, dt, pressed, cameraYaw, filter, mods = NORMAL) {
      const held = input.held();
      for (const eid of query(world, [Player, Transform, Velocity, CharacterMotor, PhysicsBody])) {
        const body = bodies[eid];
        const collider = colliders[eid];
        if (!body || !collider) continue;

        Transform.prevX[eid] = Transform.x[eid]!;
        Transform.prevY[eid] = Transform.y[eid]!;
        Transform.prevZ[eid] = Transform.z[eid]!;
        Transform.prevRotY[eid] = Transform.rotY[eid]!;

        // Camera-relative move direction. Camera forward on XZ = (-sin yaw, -cos yaw).
        let ix = ((held & Action.Right) ? 1 : 0) - ((held & Action.Left) ? 1 : 0);
        let iz = ((held & Action.Forward) ? 1 : 0) - ((held & Action.Back) ? 1 : 0);
        const inputLen = Math.hypot(ix, iz);
        let dirX = 0;
        let dirZ = 0;
        if (inputLen > 0) {
          ix /= inputLen;
          iz /= inputLen;
          const sin = Math.sin(cameraYaw);
          const cos = Math.cos(cameraYaw);
          dirX = ix * cos - iz * sin;
          dirZ = -ix * sin - iz * cos;
        }

        // A bike rolls along its heading, which swings toward the steering direction.
        if (mods.bike && inputLen > 0) {
          const heading = dampAngle(Transform.rotY[eid]!, Math.atan2(dirX, dirZ), BIKE.turnSharpness, dt);
          Transform.rotY[eid] = heading;
          dirX = Math.sin(heading);
          dirZ = Math.cos(heading);
        }

        const grounded = CharacterMotor.grounded[eid] === 1;
        const sprinting = inputLen > 0 && (held & Action.Sprint) !== 0;
        CharacterMotor.sprinting[eid] = sprinting ? 1 : 0;

        // Horizontal: move toward target velocity with separate accel / decel rates.
        const speed = (mods.bike ? (sprinting ? BIKE.sprintSpeed : BIKE.speed) : mods.fly ? FLY_SPEED * (sprinting ? 2 : 1) : sprinting ? C.sprintSpeed : C.walkSpeed) * mods.speed;
        const targetVX = dirX * speed;
        const targetVZ = dirZ * speed;
        let rate = mods.bike
          ? speed / (inputLen > 0 ? BIKE.accelTime : BIKE.decelTime)
          : inputLen > 0 ? speed / C.accelTime : Math.max(speed, C.sprintSpeed) / C.decelTime;
        if (!grounded && !mods.fly) rate *= C.airControl;
        let vx = Velocity.x[eid]!;
        let vz = Velocity.z[eid]!;
        const ddx = targetVX - vx;
        const ddz = targetVZ - vz;
        const gap = Math.hypot(ddx, ddz);
        const maxStep = rate * dt;
        if (gap <= maxStep) {
          vx = targetVX;
          vz = targetVZ;
        } else {
          vx += (ddx / gap) * maxStep;
          vz += (ddz / gap) * maxStep;
        }

        // Vertical: coyote time, jump buffer, asymmetric gravity, variable jump height.
        let coyote = grounded ? C.coyoteTime : Math.max(0, CharacterMotor.coyote[eid]! - dt);
        let jumpBuffer = (pressed & Action.Jump) && !mods.bike ? C.jumpBufferTime : Math.max(0, CharacterMotor.jumpBuffer[eid]! - dt);
        let vy = Velocity.y[eid]!;
        if (mods.fly) {
          vy = (((held & Action.Jump) ? 1 : 0) - ((held & Action.Down) ? 1 : 0)) * FLY_SPEED * mods.speed * (sprinting ? 2 : 1);
          jumpBuffer = 0;
          coyote = C.coyoteTime; // the animation system then shows walk / run instead of a fall
        } else if (jumpBuffer > 0 && coyote > 0) {
          vy = JUMP_VELOCITY;
          jumpBuffer = 0;
          coyote = 0;
          CharacterMotor.jumpSeq[eid] = (CharacterMotor.jumpSeq[eid]! + 1) & 0xffff;
        } else if (grounded && vy <= 0) {
          vy = -1; // keep a slight downward bias so ground contact stays continuous
        } else {
          const mul = vy < 0 ? C.fallGravityMul : (held & Action.Jump) ? 1 : C.lowJumpGravityMul;
          vy = Math.max(vy - GRAVITY * mul * dt, -C.terminalVelocity);
        }

        desired.x = vx * dt;
        desired.y = vy * dt;
        desired.z = vz * dt;
        const cur = body.translation();
        let moved = desired;
        let nowGrounded = false;
        if (!mods.noclip) {
          // Auto-step only from the ground; mid-air it would silently add 0.35 m to the jump height.
          if (grounded && !mods.fly) kcc.enableAutostep(C.autostepHeight, C.autostepMinWidth, false);
          else kcc.disableAutostep();
          // Snapping would pull a hovering flyer back down onto the floor.
          if (mods.fly) kcc.disableSnapToGround();
          else kcc.enableSnapToGround(C.snapToGround);
          kcc.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, filter);
          moved = kcc.computedMovement();
          nowGrounded = kcc.computedGrounded();
        }
        next.x = cur.x + moved.x;
        next.y = cur.y + moved.y;
        next.z = cur.z + moved.z;
        if (mods.blocked?.(next.x, next.z) && !mods.blocked(cur.x, cur.z)) {
          next.x = cur.x;
          next.z = cur.z;
          vx = 0;
          vz = 0;
        }
        body.setNextKinematicTranslation(next);

        // Head bonk: upward motion blocked.
        if (vy > 0 && moved.y < desired.y - 1e-4) vy = 0;
        if (mods.fly) nowGrounded = false;
        if (nowGrounded && !grounded && vy < 0) {
          CharacterMotor.landingSpeed[eid] = -Velocity.y[eid]!;
          CharacterMotor.landingSeq[eid] = (CharacterMotor.landingSeq[eid]! + 1) & 0xffff;
        }

        Velocity.x[eid] = vx;
        Velocity.y[eid] = vy;
        Velocity.z[eid] = vz;
        CharacterMotor.grounded[eid] = nowGrounded ? 1 : 0;
        CharacterMotor.coyote[eid] = coyote;
        CharacterMotor.jumpBuffer[eid] = jumpBuffer;

        Transform.x[eid] = next.x;
        Transform.y[eid] = next.y - CAPSULE_CENTER_OFFSET;
        Transform.z[eid] = next.z;
        if (inputLen > 0) {
          Transform.rotY[eid] = dampAngle(Transform.rotY[eid]!, Math.atan2(dirX, dirZ), C.turnSharpness, dt);
        }
      }
    },
    dispose() {
      physics.removeCharacterController(kcc);
    },
  };
}
