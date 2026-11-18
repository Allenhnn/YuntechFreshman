import {
  BackSide,
  Color,
  DataTexture,
  NearestFilter,
  RedFormat,
  Mesh,
  MeshToonMaterial,
  ShaderMaterial,
  SkinnedMesh,
  type ColorRepresentation,
  type Object3D,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import outlineVert from '../shaders/outline.vert.glsl';
import outlineFrag from '../shaders/outline.frag.glsl';

/** 3-band cel ramp: shadow / mid / lit. */
export function createToonRamp(tracker: ResourceTracker): DataTexture {
  const tex = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tracker.texture(tex);
}

/** Caches one MeshToonMaterial per colour so identical parts share a program and uniforms. */
export class ToonPalette {
  private readonly cache = new Map<string, MeshToonMaterial>();

  constructor(
    readonly ramp: DataTexture,
    private readonly tracker: ResourceTracker,
  ) {}

  get(color: ColorRepresentation): MeshToonMaterial {
    const key = new Color(color).getHexString();
    let mat = this.cache.get(key);
    if (!mat) {
      mat = this.tracker.material(new MeshToonMaterial({ color, gradientMap: this.ramp }));
      this.cache.set(key, mat);
    }
    return mat;
  }
}

/**
 * Adds an inverted-hull child to every mesh flagged `userData.outline` (glTF node extras).
 * Skinned meshes get a SkinnedMesh hull bound to the same skeleton so the outline deforms with it.
 */
export function addOutlines(root: Object3D, outline: ShaderMaterial): void {
  const targets: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh && node.userData.outline === true && node.material !== outline) targets.push(node);
  });
  for (const mesh of targets) {
    let hull: Mesh;
    if (mesh instanceof SkinnedMesh) {
      const skinned = new SkinnedMesh(mesh.geometry, outline);
      skinned.bind(mesh.skeleton, mesh.bindMatrix);
      hull = skinned;
    } else {
      hull = new Mesh(mesh.geometry, outline);
    }
    hull.name = `${mesh.name}_outline`;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.raycast = () => {};
    mesh.add(hull);
  }
}

/** Inverted-hull outline: back faces pushed out along the normal, drawn in a flat ink colour. */
export function createOutlineMaterial(tracker: ResourceTracker, thickness = 0.018, color: ColorRepresentation = 0x2a1d17): ShaderMaterial {
  return tracker.material(
    new ShaderMaterial({
      vertexShader: outlineVert,
      fragmentShader: outlineFrag,
      side: BackSide,
      uniforms: {
        uThickness: { value: thickness },
        uColor: { value: new Color(color) },
      },
    }),
  );
}
