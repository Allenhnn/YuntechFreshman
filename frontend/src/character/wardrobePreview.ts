import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';

/**
 * 衣櫃 preview: a copy of the character (with what it wears) standing alone in a small lit scene,
 * drawn into the box the wardrobe UI leaves on the left of the screen (`.wd-preview`). The dorm
 * room is too cramped to frame the character with the game camera. Dragging the box turns the
 * character, half a turn either way (`wardrobeView.yaw`, −π/2 … π/2).
 */
export const wardrobeView = { yaw: 0 };
export const WARDROBE_YAW_LIMIT = Math.PI / 2;

export interface WardrobePreview {
  /** Re-copy the character next frame (after the outfit changed). */
  invalidate(): void;
  /** Draws over the frame just rendered, inside the element's box (CSS pixels). */
  render(box: DOMRect): void;
  dispose(): void;
}

export function createWardrobePreview(renderer: WebGLRenderer, source: Object3D): WardrobePreview {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xc8d8cc, 2.4));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 5);
  scene.add(key);
  const cam = new PerspectiveCamera(26, 1, 0.05, 50);
  let copy: Object3D | null = null;
  const centre = new Vector3();
  const size = new Vector3();
  let shown = 0; // smoothed yaw
  const clear = { color: new Color(), alpha: 1 };

  const rebuild = (): void => {
    if (copy) scene.remove(copy);
    copy = cloneSkinned(source); // skinned meshes get their own skeleton (a plain clone keeps the original's)
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.copy(source.scale);
    copy.visible = true;
    copy.updateMatrixWorld(true);
    const bb = new Box3().setFromObject(copy, true); // posed vertices, not the bind pose
    bb.getCenter(centre);
    bb.getSize(size);
    scene.add(copy);
  };

  return {
    invalidate() {
      if (copy) scene.remove(copy);
      copy = null;
    },
    render(box) {
      if (box.width < 10 || box.height < 10) return;
      if (!copy) rebuild();
      shown += (wardrobeView.yaw - shown) * 0.25;
      copy!.rotation.y = shown;
      const aspect = box.width / box.height;
      cam.aspect = aspect;
      // Fit the whole character (its height, and its width on narrow boxes) with a little margin.
      const half = (Math.PI / 180) * cam.fov * 0.5;
      const fitH = (size.y * 0.62) / Math.tan(half);
      const fitW = (Math.max(size.x, size.z) * 0.75) / (Math.tan(half) * aspect);
      const dist = Math.max(fitH, fitW, 1);
      cam.position.set(centre.x, centre.y + size.y * 0.04, centre.z + dist);
      cam.lookAt(centre.x, centre.y, centre.z);
      cam.updateProjectionMatrix();

      const canvas = renderer.domElement;
      const cr = canvas.getBoundingClientRect();
      const x = box.left - cr.left, y = cr.bottom - box.bottom;
      renderer.getClearColor(clear.color);
      clear.alpha = renderer.getClearAlpha();
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, box.width, box.height);
      renderer.setViewport(x, y, box.width, box.height);
      renderer.setClearColor(0xeef5ef, 1);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cr.width, cr.height);
      renderer.setClearColor(clear.color, clear.alpha);
    },
    dispose() {
      if (copy) scene.remove(copy);
      copy = null;
    },
  };
}
