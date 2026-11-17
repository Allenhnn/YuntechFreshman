import { Vector3, type PerspectiveCamera } from 'three';
import { RAPIER } from '../physics/physics';
import { CAMERA, CHARACTER } from '../config';
import { clamp, damp, dampAngle } from '../core/math';

export interface CameraFocus {
  x: number;
  y: number;
  z: number;
  sprinting: boolean;
  /** Increments on every landing; a change triggers the dip. */
  landingSeq: number;
  landingSpeed: number;
}

export interface ThirdPersonCamera {
  /** Smoothed yaw; the character controller moves relative to this. */
  readonly yaw: number;
  /** Current spring-arm length (m); short when a wall is close behind the character. */
  readonly distance: number;
  rotate(dxPixels: number, dyPixels: number): void;
  update(dt: number, focus: CameraFocus, ignore: RAPIER.Collider | undefined, filter?: (collider: RAPIER.Collider) => boolean): void;
  /** Jump straight to the target state (spawn / teleport), optionally with a new yaw. */
  snap(focus: CameraFocus, yaw?: number): void;
}

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Orbit camera on a spring arm: mouse sets target yaw/pitch, the rig damps toward them,
 * a sphere cast pulls the camera in front of walls instantly and eases it back out.
 */
export function createThirdPersonCamera(camera: PerspectiveCamera, physics: RAPIER.World): ThirdPersonCamera {
  let targetYaw = 0;
  let targetPitch: number = CAMERA.defaultPitch;
  let yaw = 0;
  let pitch: number = CAMERA.defaultPitch;
  let distance: number = CAMERA.distance;
  let fov: number = CAMERA.baseFov;
  let dip = 0;
  let lastLandingSeq = 0;
  const pivot = new Vector3();
  const probe = new RAPIER.Ball(CAMERA.probeRadius);
  const dir = { x: 0, y: 0, z: 0 };

  const place = (): void => {
    const cp = Math.cos(pitch);
    dir.x = Math.sin(yaw) * cp;
    dir.y = Math.sin(pitch);
    dir.z = Math.cos(yaw) * cp;
    camera.position.set(pivot.x + dir.x * distance, pivot.y + dir.y * distance, pivot.z + dir.z * distance);
    camera.lookAt(pivot);
  };

  return {
    get yaw() {
      return yaw;
    },
    get distance() {
      return distance;
    },
    rotate(dx, dy) {
      targetYaw -= dx * CAMERA.sensitivity;
      targetPitch = clamp(targetPitch + dy * CAMERA.sensitivity, CAMERA.pitchMin, CAMERA.pitchMax);
    },
    snap(focus, newYaw) {
      if (newYaw !== undefined) targetYaw = newYaw;
      yaw = targetYaw;
      pitch = targetPitch;
      pivot.set(focus.x, focus.y + CAMERA.pivotHeight, focus.z);
      lastLandingSeq = focus.landingSeq;
      place();
    },
    update(dt, focus, ignore, filter) {
      yaw = dampAngle(yaw, targetYaw, CAMERA.rotationSharpness, dt);
      pitch = damp(pitch, targetPitch, CAMERA.rotationSharpness, dt);

      if (focus.landingSeq !== lastLandingSeq) {
        lastLandingSeq = focus.landingSeq;
        if (focus.landingSpeed > CHARACTER.hardLandingSpeed) {
          dip = -Math.min(CAMERA.landingDipMax, (focus.landingSpeed - CHARACTER.hardLandingSpeed) * CAMERA.landingDipPerMs + 0.05);
        }
      }
      dip = damp(dip, 0, CAMERA.landingDipRecovery, dt);

      pivot.x = damp(pivot.x, focus.x, CAMERA.followSharpnessXZ, dt);
      pivot.z = damp(pivot.z, focus.z, CAMERA.followSharpnessXZ, dt);
      pivot.y = damp(pivot.y, focus.y + CAMERA.pivotHeight, CAMERA.followSharpnessY, dt);
      const pivotY = pivot.y;
      pivot.y += dip;

      // Spring arm collision.
      const cp = Math.cos(pitch);
      dir.x = Math.sin(yaw) * cp;
      dir.y = Math.sin(pitch);
      dir.z = Math.cos(yaw) * cp;
      const hit = physics.castShape(
        pivot, IDENTITY_ROT, dir, probe, 0, CAMERA.distance, false,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, ignore, undefined, filter,
      );
      const allowed = hit ? Math.max(CAMERA.minDistance, hit.time_of_impact) : CAMERA.distance;
      distance = allowed < distance ? allowed : damp(distance, allowed, CAMERA.recoverSharpness, dt);

      place();
      pivot.y = pivotY;

      const targetFov = focus.sprinting ? CAMERA.sprintFov : CAMERA.baseFov;
      fov = damp(fov, targetFov, CAMERA.fovSharpness, dt);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
  };
}
