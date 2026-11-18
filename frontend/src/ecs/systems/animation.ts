import { query, type World } from 'bitecs';
import { CHARACTER } from '../../config';
import { CLOCK_RATE, gaitFrequency } from '../../character/pose';
import { AnimId, AnimState, CharacterMotor, Renderable, Velocity, type AnimIdValue } from '../components';
import { animDrivers } from '../registry';

/** Minimum time the Land state is held before locomotion can take over. */
const LAND_DURATION = 0.14;

/**
 * Locomotion state machine. Picks the state from motor data and hands it to the entity's
 * AnimationDriver (AnimationMixer clips for GLB models, procedural poses for the fallback).
 *
 *   Idle ⇄ Walk ⇄ Run          (ground speed thresholds)
 *   any ground → JumpRise → Fall (leaving the ground; coyote time suppresses flicker)
 *   Fall → Land (hard landing only) → ground state
 */
export function animationSystem(world: World, dt: number, time: number): void {
  const clock = time * CLOCK_RATE;
  for (const eid of query(world, [CharacterMotor, AnimState, Velocity, Renderable])) {
    const driver = animDrivers[eid];
    if (!driver) continue;

    const speed = Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!);
    const grounded = CharacterMotor.grounded[eid] === 1 || CharacterMotor.coyote[eid]! > 0.05;
    const vy = Velocity.y[eid]!;

    let next: AnimIdValue;
    if (CharacterMotor.landingSeq[eid] !== AnimState.lastLandingSeq[eid]) {
      AnimState.lastLandingSeq[eid] = CharacterMotor.landingSeq[eid]!;
      next = CharacterMotor.landingSpeed[eid]! > CHARACTER.hardLandingSpeed ? AnimId.Land : groundState(speed);
    } else if (!grounded || vy > 0.5) {
      next = vy > 0 ? AnimId.JumpRise : AnimId.Fall;
    } else if (AnimState.current[eid] === AnimId.Land && AnimState.stateTime[eid]! < LAND_DURATION) {
      next = AnimId.Land;
    } else {
      next = groundState(speed);
    }

    if (next !== AnimState.current[eid]) {
      AnimState.current[eid] = next;
      AnimState.stateTime[eid] = 0;
    } else {
      AnimState.stateTime[eid] = AnimState.stateTime[eid]! + dt;
    }

    AnimState.phase[eid] = (AnimState.phase[eid]! + dt * gaitFrequency(speed) * Math.PI * 2) % (Math.PI * 2);
    driver.update(dt, next, speed, AnimState.phase[eid]!, clock);
  }
}

function groundState(speed: number): AnimIdValue {
  if (speed > CHARACTER.walkSpeed + 0.8) return AnimId.Run;
  if (speed > 0.2) return AnimId.Walk;
  return AnimId.Idle;
}
