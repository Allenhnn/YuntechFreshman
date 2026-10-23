import type RAPIER from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import type { AnimationDriver } from '../character/animationDriver';

/**
 * Side tables indexed by entity id for handles that cannot live in TypedArrays.
 * Cleared on despawn together with the ECS components.
 */
export const bodies: (RAPIER.RigidBody | undefined)[] = [];
export const colliders: (RAPIER.Collider | undefined)[] = [];
export const objects: (Object3D | undefined)[] = [];
export const animDrivers: (AnimationDriver | undefined)[] = [];

export function clearEntitySlots(eid: number): void {
  bodies[eid] = undefined;
  colliders[eid] = undefined;
  objects[eid] = undefined;
  animDrivers[eid] = undefined;
}
