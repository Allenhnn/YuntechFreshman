import type { BuildingSource } from './buildingTypes';

/** Plan → world transform helpers without needing the meshes (used before the campus is built). */
export function createPlanTransform(src: BuildingSource): {
  toWorld(x: number, y: number): [number, number];
  toPlan(x: number, z: number): [number, number];
  rotY: number;
} {
  const t = src.transform;
  const a = (t.angleDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return {
    toWorld(x, y) {
      const qx = x - t.planCentroid[0], qy = y - t.planCentroid[1];
      return [qx * c - qy * s + t.worldCentroid[0], qx * s + qy * c + t.worldCentroid[1]];
    },
    toPlan(x, z) {
      const qx = x - t.worldCentroid[0], qz = z - t.worldCentroid[1];
      return [qx * c + qz * s + t.planCentroid[0], -qx * s + qz * c + t.planCentroid[1]];
    },
    // Object3D.rotation.y = φ maps (x, z) → (x cosφ + z sinφ, −x sinφ + z cosφ); we need R(+a) → φ = −a.
    rotY: -a,
  };
}

