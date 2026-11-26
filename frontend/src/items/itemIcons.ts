import { AmbientLight, Box3, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { ITEMS, type ItemId } from '../state/items';
import { createItemModel } from './itemModels';

/**
 * Item pictures for the hotbar, bag and shop: each item's 3D model (itemModels.ts) photographed once
 * on a small offscreen renderer, three-quarter view, transparent background. Made the first time
 * they are asked for and kept as data URLs; null where WebGL is unavailable (the emoji icon stays).
 */
let cache: Map<ItemId, string> | null = null;

function render(): Map<ItemId, string> {
  const out = new Map<ItemId, string>();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  const SIZE = 128;
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const cam = new PerspectiveCamera(30, 1, 0.05, 20);
  const box = new Box3(), size = new Vector3(), centre = new Vector3();
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const model = createItemModel(id, { name: '新鮮人', id: 'B11412000' });
    const g = model.group;
    g.rotation.set(0.35, -0.6, 0);
    scene.add(g);
    g.updateMatrixWorld(true);
    box.setFromObject(g);
    box.getSize(size);
    box.getCenter(centre);
    const r = Math.max(size.x, size.y, size.z) * 0.62;
    cam.position.set(centre.x, centre.y, centre.z + r / Math.tan((cam.fov * Math.PI) / 360) + 0.1);
    cam.lookAt(centre);
    renderer.render(scene, cam);
    out.set(id, renderer.domElement.toDataURL('image/png'));
    model.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

export function itemIcon(id: ItemId): string | null {
  if (!cache) cache = render();
  return cache.get(id) ?? null;
}
