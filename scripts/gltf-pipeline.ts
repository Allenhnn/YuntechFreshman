/**
 * Shared glTF optimisation pipeline (Node): geometry → Draco, textures → KTX2 / Basis Universal.
 *
 * Texture rules (by material slot and texture name):
 *   baseColor / emissive            → ETC1S, sRGB    (small, good for painted colour)
 *   baseColor / emissive named *_hq → UASTC, sRGB    (faces, UI decals: no block artefacts)
 *   normal                          → UASTC, linear, normal-map mode
 *   occlusion / metallicRoughness   → UASTC, linear
 */
import { Document, NodeIO, type Transform } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, getBounds, prune, resample, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { CLIP_NAMES } from '../src/character/clipNames';

export async function createIO(): Promise<NodeIO> {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
}

const imageDecoder = async (buffer: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

export interface OptimizeOptions {
  /** Longest texture edge after resize. */
  maxTextureSize: number;
}

export async function optimizeDocument(doc: Document, options: OptimizeOptions): Promise<void> {
  const notHQ = /^(?!.*_hq).*$/i;
  const HQ = /_hq/i;
  const colorSlots = /^(baseColorTexture|emissiveTexture)$/;
  const common = { generateMipmap: true, enableDebug: false, imageDecoder };
  // UASTC is large on its own; Zstd supercompression typically halves it (KTX2Loader decodes it in-worker).
  const uastc = { ...common, isUASTC: true, needSupercompression: true };
  const steps: Transform[] = [
    dedup(),
    prune(),
    weld(),
    resample(), // lossless keyframe reduction (static clips collapse to two keys)
    textureCompress({ encoder: sharp, resize: [options.maxTextureSize, options.maxTextureSize] }),
    ktx2({ ...common, slots: colorSlots, pattern: notHQ, isUASTC: false, qualityLevel: 160, isPerceptual: true, isSetKTX2SRGBTransferFunc: true }),
    ktx2({ ...uastc, slots: colorSlots, pattern: HQ, uastcLDRQualityLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true }),
    ktx2({ ...uastc, slots: /^normalTexture$/, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }),
    ktx2({ ...uastc, slots: /^(occlusionTexture|metallicRoughnessTexture)$/, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }),
    draco({ method: 'edgebreaker', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  ];
  await doc.transform(...steps);
}

/** Prints a summary and warns about spec violations (clip names, scale, pivot). */
export function inspect(doc: Document, label: string): string[] {
  const warnings: string[] = [];
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const clips = root.listAnimations().map((a) => a.getName());
  const missing = Object.values(CLIP_NAMES).filter((n) => !clips.includes(n));
  if (missing.length) warnings.push(`missing clips: ${missing.join(', ')}`);
  if (scene) {
    const { min, max } = getBounds(scene);
    const height = (max[1] ?? 0) - (min[1] ?? 0);
    if (height < 0.8 || height > 2.5) warnings.push(`height ${height.toFixed(2)} m is outside 0.8–2.5 m (export in metres?)`);
    if (Math.abs(min[1] ?? 0) > 0.05) warnings.push(`lowest point is y=${(min[1] ?? 0).toFixed(3)}; the origin should be at the feet`);
    console.log(`[${label}] height ${height.toFixed(2)} m, bounds y ${(min[1] ?? 0).toFixed(2)}..${(max[1] ?? 0).toFixed(2)}`);
  }
  const textures = root.listTextures().map((t) => `${t.getName() || '(unnamed)'}:${t.getMimeType()}`);
  console.log(`[${label}] meshes ${root.listMeshes().length}, materials ${root.listMaterials().length}, textures [${textures.join(', ')}]`);
  console.log(`[${label}] clips [${clips.join(', ')}]`);
  for (const w of warnings) console.warn(`[${label}] WARNING: ${w}`);
  return warnings;
}
