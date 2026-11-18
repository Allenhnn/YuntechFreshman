import { query, type World } from 'bitecs';
import { lerpAngle } from '../../core/math';
import { Renderable, Transform } from '../components';
import { objects } from '../registry';

/** Interpolates between the last two fixed steps so motion is smooth at any refresh rate. */
export function renderSyncSystem(world: World, alpha: number): void {
  for (const eid of query(world, [Transform, Renderable])) {
    const obj = objects[eid];
    if (!obj) continue;
    const px = Transform.prevX[eid]!;
    const py = Transform.prevY[eid]!;
    const pz = Transform.prevZ[eid]!;
    obj.position.set(
      px + (Transform.x[eid]! - px) * alpha,
      py + (Transform.y[eid]! - py) * alpha,
      pz + (Transform.z[eid]! - pz) * alpha,
    );
    obj.rotation.y = lerpAngle(Transform.prevRotY[eid]!, Transform.rotY[eid]!, alpha);
  }
}
