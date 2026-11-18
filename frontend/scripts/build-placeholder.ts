/**
 * Usage: npm run assets:placeholder
 *
 * Bakes the procedural mascot into a real asset that follows the same spec as the final model:
 *   assets-src/mascot_placeholder.glb  raw export (PNG texture, uncompressed geometry)
 *   public/models/mascot.glb           game asset (Draco + KTX2), loaded at runtime
 * Node hierarchy = joints, AnimationClips = the six locomotion states sampled from pose.ts,
 * face = 2-frame atlas texture (`face_atlas_hq`, blink by UV offset).
 * When the rigged model arrives it simply replaces public/models/mascot.glb via assets:optimize.
 */
import { statSync } from 'node:fs';
import {
  Document,
  type Accessor,
  type Animation,
  type Buffer as GBuffer,
  type Material as GMaterial,
  type Mesh as GMesh,
  type Node as GNode,
  type Texture as GTexture,
} from '@gltf-transform/core';
import sharp from 'sharp';
import { BufferGeometry, Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three';
import { CHARACTER } from '../src/config';
import { AnimId, type AnimIdValue } from '../src/ecs/components';
import { CLIP_NAMES } from '../src/character/clipNames';
import { paintFaceAtlas } from '../src/character/faceAtlas';
import { createMascot, findMascotJoints } from '../src/character/mascot';
import { CLOCK_RATE, applyPose, computePose, createPose, gaitFrequency } from '../src/character/pose';
import { createIO, inspect, optimizeDocument } from './gltf-pipeline';

const RAW_OUT = 'assets-src/mascot_placeholder.glb';
const GAME_OUT = 'public/models/mascot.glb';

interface ClipSpec {
  name: string;
  state: AnimIdValue;
  duration: number;
  fps: number;
  speed: number;
  /** Which phase input sweeps one full cycle over the clip (static clips use neither). */
  drive: 'gait' | 'clock' | 'static';
}

const CLIPS: readonly ClipSpec[] = [
  { name: CLIP_NAMES.idle, state: AnimId.Idle, duration: (Math.PI * 2) / CLOCK_RATE, fps: 30, speed: 0, drive: 'clock' },
  { name: CLIP_NAMES.walk, state: AnimId.Walk, duration: 1 / gaitFrequency(CHARACTER.walkSpeed), fps: 60, speed: CHARACTER.walkSpeed, drive: 'gait' },
  { name: CLIP_NAMES.run, state: AnimId.Run, duration: 1 / gaitFrequency(CHARACTER.sprintSpeed), fps: 60, speed: CHARACTER.sprintSpeed, drive: 'gait' },
  { name: CLIP_NAMES.jumpStart, state: AnimId.JumpRise, duration: 0.4, fps: 30, speed: 0, drive: 'static' },
  { name: CLIP_NAMES.jumpLoop, state: AnimId.Fall, duration: (Math.PI * 2) / CLOCK_RATE, fps: 30, speed: 0, drive: 'clock' },
  { name: CLIP_NAMES.jumpLand, state: AnimId.Land, duration: 0.4, fps: 30, speed: 0, drive: 'static' },
];

async function main(): Promise<void> {
  // 1. Build the mascot with tagged stand-in materials.
  const colorMats = new Map<number, MeshBasicMaterial>();
  const faceMat = new MeshBasicMaterial({ name: 'face', transparent: true });
  const root = createMascot(
    {
      color(hex) {
        let m = colorMats.get(hex);
        if (!m) {
          m = new MeshBasicMaterial({ name: `toon_${hex.toString(16).padStart(6, '0')}`, color: hex });
          colorMats.set(hex, m);
        }
        return m;
      },
      face: () => faceMat,
    },
    { geometry: (g) => g },
  );

  // 2. Convert the hierarchy into a glTF document.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const face = paintFaceAtlas();
  const png = await sharp(Buffer.from(face.data.buffer), { raw: { width: face.width, height: face.height, channels: 4 } }).png().toBuffer();
  const faceTex = doc.createTexture('face_atlas_hq').setImage(new Uint8Array(png)).setMimeType('image/png').setURI('face_atlas_hq.png');

  const converter = createConverter(doc, buffer, faceMat, faceTex);
  const nodes = new Map<Object3D, GNode>();
  const convert = (obj: Object3D): GNode => {
    const node = doc
      .createNode(obj.name)
      .setTranslation([obj.position.x, obj.position.y, obj.position.z])
      .setRotation([obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w])
      .setScale([obj.scale.x, obj.scale.y, obj.scale.z]);
    if (obj instanceof Mesh) node.setMesh(converter.mesh(obj.geometry, obj.material as Material));
    if (obj.userData.outline === true) node.setExtras({ outline: true });
    nodes.set(obj, node);
    for (const child of obj.children) node.addChild(convert(child));
    return node;
  };
  const scene = doc.createScene('mascot').addChild(convert(root));
  doc.getRoot().setDefaultScene(scene);

  // 3. Bake the locomotion clips by sampling pose.ts.
  const joints = findMascotJoints(root);
  if (!joints) throw new Error('mascot joints missing');
  const nodeOf = (o: unknown): GNode => {
    const n = nodes.get(o as Object3D);
    if (!n) throw new Error('joint has no glTF node');
    return n;
  };
  const body = joints.body as Object3D;
  const rotated: Object3D[] = [joints.head, joints.armL, joints.armR, joints.legL, joints.legR, ...joints.leaves].map((j) => j as Object3D);
  const pose = createPose();

  for (const spec of CLIPS) {
    const count = Math.max(2, Math.round(spec.duration * spec.fps) + 1);
    const times = new Float32Array(count);
    const rot = new Map<Object3D, Float32Array<ArrayBuffer>>([[body, new Float32Array(count * 4)], ...rotated.map((j): [Object3D, Float32Array<ArrayBuffer>] => [j, new Float32Array(count * 4)])]);
    const bodyT = new Float32Array(count * 3);
    const bodyS = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      times[i] = u * spec.duration;
      const cycle = Math.PI * 2 * u;
      computePose(spec.state, spec.drive === 'gait' ? cycle : 0, spec.drive === 'clock' ? cycle : 0, spec.speed, pose);
      applyPose(joints, pose);
      for (const [j, arr] of rot) j.quaternion.toArray(arr, i * 4);
      body.position.toArray(bodyT, i * 3);
      body.scale.toArray(bodyS, i * 3);
    }
    const anim = doc.createAnimation(spec.name);
    const input = converter.accessor(times, 'SCALAR');
    for (const [j, arr] of rot) channel(doc, anim, input, converter.accessor(arr, 'VEC4'), nodeOf(j), 'rotation');
    channel(doc, anim, input, converter.accessor(bodyT, 'VEC3'), nodeOf(body), 'translation');
    channel(doc, anim, input, converter.accessor(bodyS, 'VEC3'), nodeOf(body), 'scale');
  }

  // 4. Write the raw export, then the optimised game asset.
  const io = await createIO();
  await io.write(RAW_OUT, doc);
  inspect(doc, 'raw');
  await optimizeDocument(doc, { maxTextureSize: 1024 });
  await io.write(GAME_OUT, doc);
  inspect(doc, 'game');
  const kb = (p: string): string => `${(statSync(p).size / 1024).toFixed(1)} KB`;
  console.log(`[placeholder] ${RAW_OUT} (${kb(RAW_OUT)}) → ${GAME_OUT} (${kb(GAME_OUT)})`);
}

function channel(doc: Document, anim: Animation, input: Accessor, output: Accessor, node: GNode, path: 'rotation' | 'translation' | 'scale'): void {
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
}

function createConverter(doc: Document, buffer: GBuffer, faceMat: Material, faceTex: GTexture) {
  const materials = new Map<Material, GMaterial>();
  const meshes = new Map<string, GMesh>();

  const accessor = (array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4'): Accessor =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const material = (m: Material): GMaterial => {
    let out = materials.get(m);
    if (out) return out;
    out = doc.createMaterial(m.name).setMetallicFactor(0).setRoughnessFactor(1);
    if (m instanceof MeshBasicMaterial) out.setBaseColorFactor([m.color.r, m.color.g, m.color.b, 1]); // linear, as glTF expects
    if (m === faceMat) out.setBaseColorTexture(faceTex).setAlphaMode('BLEND');
    materials.set(m, out);
    return out;
  };

  const mesh = (geo: BufferGeometry, mat: Material): GMesh => {
    const key = `${geo.uuid}|${mat.uuid}`;
    let out = meshes.get(key);
    if (out) return out;
    const prim = doc.createPrimitive().setMaterial(material(mat));
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    prim.setAttribute('POSITION', accessor(new Float32Array(pos.array), 'VEC3'));
    if (nrm) prim.setAttribute('NORMAL', accessor(new Float32Array(nrm.array), 'VEC3'));
    if (uv) {
      // three.js UV origin is bottom-left, glTF is top-left.
      const flipped = new Float32Array(uv.array);
      for (let i = 1; i < flipped.length; i += 2) flipped[i] = 1 - flipped[i]!;
      prim.setAttribute('TEXCOORD_0', accessor(flipped, 'VEC2'));
    }
    if (geo.index) {
      const idx = geo.index.array;
      prim.setIndices(accessor(pos.count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 'SCALAR'));
    }
    out = doc.createMesh(mat.name).addPrimitive(prim);
    meshes.set(key, out);
    return out;
  };

  return { accessor, mesh };
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
