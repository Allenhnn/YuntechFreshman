import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  SRGBColorSpace,
  type AnimationClip,
  type Material,
  type Object3D,
  type ShaderMaterial,
  type Texture,
} from 'three';
import type { AssetLoader } from '../assets/loader';
import type { ResourceTracker } from '../core/resources';
import { addOutlines, type ToonPalette } from '../render/toon';
import { type AnimationDriver, createClipDriver, createProceduralDriver } from './animationDriver';
import { paintFaceAtlas } from './faceAtlas';
import { createMascot } from './mascot';

export interface CharacterModel {
  root: Object3D;
  clips: readonly AnimationClip[];
  source: 'glb' | 'procedural';
  createDriver(): AnimationDriver;
}

/**
 * Loads a character GLB and converts it to the game's look:
 *  - PBR materials → toon materials (colour-only ones come from the shared palette cache)
 *  - outline hulls for nodes flagged with `extras.outline`
 *  - geometry, textures and per-model materials registered on `tracker` for disposal
 * Shared palette materials are deliberately *not* tracked here; the scene owns them.
 */
export async function loadCharacterModel(
  loader: AssetLoader,
  url: string,
  palette: ToonPalette,
  outline: ShaderMaterial,
  tracker: ResourceTracker,
  onProgress?: (fraction: number) => void,
): Promise<CharacterModel> {
  const gltf = await loader.loadGLTF(url, onProgress);
  const root = gltf.scene;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    tracker.geometry(node.geometry);
    const src: Material = Array.isArray(node.material) ? node.material[0] : node.material;
    node.material = toonify(src, palette, tracker);
    if (src !== node.material) src.dispose();
    node.castShadow = !node.material.transparent;
    node.receiveShadow = false;
  });
  addOutlines(root, outline);
  return {
    root,
    clips: gltf.animations,
    source: 'glb',
    createDriver: () => createClipDriver(root, gltf.animations),
  };
}

function toonify(src: Material, palette: ToonPalette, tracker: ResourceTracker): Material {
  if (!(src instanceof MeshStandardMaterial)) return tracker.material(src);
  if (!src.map && !src.transparent) return palette.get(src.color);
  const mat = new MeshToonMaterial({
    name: src.name,
    color: src.color,
    map: src.map,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    depthWrite: src.depthWrite,
    side: src.side,
    gradientMap: palette.ramp,
  });
  return tracker.material(mat);
}

/** Runtime fallback: the same mascot, built procedurally with a face atlas painted on the CPU. */
export function buildProceduralCharacter(palette: ToonPalette, outline: ShaderMaterial, tracker: ResourceTracker): CharacterModel {
  const faceMap = createFaceTexture(tracker);
  const faceMat = tracker.material(
    new MeshToonMaterial({ name: 'face', map: faceMap, transparent: true, depthWrite: false, gradientMap: palette.ramp }),
  );
  const root = createMascot({ color: (hex) => palette.get(hex), face: () => faceMat }, tracker);
  addOutlines(root, outline);
  return {
    root,
    clips: [],
    source: 'procedural',
    createDriver: () => createProceduralDriver(root),
  };
}

function createFaceTexture(tracker: ResourceTracker): Texture {
  const { data, width, height } = paintFaceAtlas();
  // Painter rows are top-first; DataTexture rows start at v = 0 (bottom).
  const flipped = new Uint8Array(data.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  const tex = new DataTexture(flipped, width, height);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tracker.texture(tex);
}
