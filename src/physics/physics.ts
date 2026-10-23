import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from '../config';

export { RAPIER };

export async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  return world;
}
