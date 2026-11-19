import type { WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Single GLTFLoader configured for the project's asset formats:
 *  - Draco geometry (decoded in DRACOLoader's worker pool)
 *  - KTX2 / Basis Universal textures (transcoded in workers to the GPU's native format)
 *  - Meshopt (accepted for future animation-heavy assets)
 * Decoder binaries are not configured here: since r18x the loaders resolve them with
 * `new URL(..., import.meta.url)`, so Vite bundles them with content hashes automatically.
 */
export interface AssetLoader {
  loadGLTF(url: string, onProgress?: (fraction: number) => void): Promise<GLTF>;
  /** Terminates decoder workers. Call on full teardown only. */
  dispose(): void;
}

export function createAssetLoader(renderer: WebGLRenderer): AssetLoader {
  const draco = new DRACOLoader();
  draco.preload();
  const ktx2 = new KTX2Loader().detectSupport(renderer);
  const gltf = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

  return {
    loadGLTF(url, onProgress) {
      return gltf.loadAsync(url, (e) => {
        if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      });
    },
    dispose() {
      draco.dispose();
      ktx2.dispose();
    },
  };
}
