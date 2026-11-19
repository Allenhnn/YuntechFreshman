/**
 * Per-frame data for canvas-based UI (minimap). Written by the game loop every frame and read
 * by the minimap's own draw loop; deliberately *not* in the Zustand store so it never triggers
 * React renders.
 */
export const telemetry = {
  x: 0,
  z: 0,
  /** Character facing (radians, 0 = +Z). */
  facing: 0,
  /** Camera yaw (radians); camera forward on XZ = (-sin yaw, -cos yaw). */
  cameraYaw: 0,
};
