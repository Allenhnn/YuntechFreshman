import type { WebGLRenderer } from 'three';

export interface DebugSample {
  x: number;
  y: number;
  z: number;
  speed: number;
  grounded: boolean;
  anim: string;
  chunks: number;
  colliders: number;
}

/** Text-only stats panel written straight to the DOM a few times per second (no framework re-render). */
export function createDebugHud(el: HTMLElement, renderer: WebGLRenderer): (dt: number, sample: DebugSample) => void {
  let frames = 0;
  let elapsed = 0;
  return (dt, s) => {
    frames++;
    elapsed += dt;
    if (elapsed < 0.25) return;
    const fps = frames / elapsed;
    frames = 0;
    elapsed = 0;
    const info = renderer.info;
    el.textContent =
      `FPS   ${fps.toFixed(0)}\n` +
      `Draw  ${info.render.calls}   Tris ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `GPU   geo ${info.memory.geometries}  tex ${info.memory.textures}\n` +
      `Pos   ${s.x.toFixed(1)}, ${s.y.toFixed(2)}, ${s.z.toFixed(1)}\n` +
      `Speed ${s.speed.toFixed(2)} m/s  ${s.grounded ? 'grounded' : 'airborne'}\n` +
      `Anim  ${s.anim}\n` +
      `World ${s.chunks} chunks  ${s.colliders} colliders`;
  };
}
