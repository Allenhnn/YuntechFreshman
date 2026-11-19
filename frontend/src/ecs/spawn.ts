import { addComponent, addEntity, removeEntity, type World } from 'bitecs';
import type { Scene } from 'three';
import { RAPIER } from '../physics/physics';
import { CHARACTER } from '../config';
import type { ResourceTracker } from '../core/resources';
import type { CharacterModel } from '../character/characterModel';
import { AnimState, CharacterMotor, PhysicsBody, Player, Renderable, Transform, Velocity } from './components';
import { CAPSULE_CENTER_OFFSET } from './systems/characterController';
import { animDrivers, bodies, clearEntitySlots, colliders, objects } from './registry';

export interface SpawnedEntity {
  eid: number;
  despawn(): void;
}

/**
 * @param tracker owns this entity's resources: it already holds the model's GPU resources
 *                and receives the physics body here, so disposing it on despawn releases everything.
 *                Shared palette/outline materials belong to the scene tracker and are not disposed.
 */
export function spawnPlayer(
  world: World,
  scene: Scene,
  physics: RAPIER.World,
  model: CharacterModel,
  tracker: ResourceTracker,
  at: { x: number; y: number; z: number },
  facing = Math.PI,
): SpawnedEntity {
  const eid = addEntity(world);
  for (const c of [Transform, Velocity, CharacterMotor, AnimState, PhysicsBody, Renderable, Player]) addComponent(world, eid, c);

  Transform.x[eid] = Transform.prevX[eid] = at.x;
  Transform.y[eid] = Transform.prevY[eid] = at.y;
  Transform.z[eid] = Transform.prevZ[eid] = at.z;
  Transform.rotY[eid] = Transform.prevRotY[eid] = facing;
  Velocity.x[eid] = Velocity.y[eid] = Velocity.z[eid] = 0;

  const body = tracker.body(
    physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y + CAPSULE_CENTER_OFFSET, at.z)),
  );
  const collider = tracker.collider(
    physics.createCollider(RAPIER.ColliderDesc.capsule(CHARACTER.capsuleHalfHeight, CHARACTER.capsuleRadius), body),
  );
  bodies[eid] = body;
  colliders[eid] = collider;

  scene.add(model.root);
  objects[eid] = model.root;
  const driver = model.createDriver();
  animDrivers[eid] = driver;

  return {
    eid,
    despawn() {
      driver.dispose();
      model.root.removeFromParent();
      tracker.dispose();
      clearEntitySlots(eid);
      removeEntity(world, eid);
    },
  };
}
