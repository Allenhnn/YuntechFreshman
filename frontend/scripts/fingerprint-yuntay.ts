/**
 * Usage: npx tsx scripts/fingerprint-yuntay.ts [--paint] [--module=<path to yuntayExterior.ts>]
 * Builds the 雲泰表演廳 exterior headless (no WebGL, no physics world) and prints a fingerprint of
 * everything it makes: each mesh's vertices, transform, shadow flags and material colour / roughness /
 * emissive / side / texture repeat, each collider's shape and pose, and the tree-free rings. Run before and after a refactor:
 * identical output means identical result.
 *
 * Without --paint the 2D canvas is missing (getContext() → null), so the texture painters are skipped;
 * with --paint a recording context is supplied and every drawing call is hashed too, which covers the
 * painted branch of canvasTexture.
 */
import { createHash } from 'node:crypto';
import { Mesh, Scene, type Material, type MeshStandardMaterial } from 'three';

const paint = process.argv.includes('--paint');
// --module lets the same script fingerprint an older copy of the module (e.g. `git show <rev>:…`).
const modulePath = process.argv.find((a) => a.startsWith('--module='))?.slice('--module='.length) ?? '../src/buildings/yuntayExterior';
const { createYuntayExterior, yuntayTreeFree } = (await import(modulePath)) as typeof import('../src/buildings/yuntayExterior');
const drawn: string[] = [];
const recorder = new Proxy({}, {
  get: (_t, name) => (name === 'canvas' ? {} : (...args: unknown[]) => void drawn.push(`${String(name)}(${args.join(',')})`)),
  set: (_t, name, value) => (drawn.push(`${String(name)}=${String(value)}`), true),
});
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => (paint ? recorder : null) }) };

const r = (v: number): string => (Math.abs(v) < 5e-5 ? '0' : v.toFixed(4));
const colliders: string[] = [];
const physics = {
  createCollider(desc: { shape: { halfExtents: { x: number; y: number; z: number } }; translation: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }) {
    const { shape: { halfExtents: h }, translation: t, rotation: q } = desc;
    colliders.push([h.x, h.y, h.z, t.x, t.y, t.z, q.x, q.y, q.z, q.w].map(r).join(' '));
    return {};
  },
  removeCollider() {},
};
const tracker = { collider: <T>(c: T) => c, geometry: <T>(g: T) => g, material: <T>(m: T) => m, texture: <T>(t: T) => t };

const scene = new Scene();
createYuntayExterior(scene, physics as never, tracker as never);
const meshes: string[] = [];
const kinds = new Map<string, number>();
scene.traverse((o) => {
  if (!(o instanceof Mesh)) return;
  kinds.set(o.geometry.type, (kinds.get(o.geometry.type) ?? 0) + 1);
  const pos = o.geometry.getAttribute('position').array as ArrayLike<number>;
  const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
  const look = mats.map((m) => {
    const s = m as MeshStandardMaterial;
    return `${s.color.getHexString()} rough ${r(s.roughness)} emis ${s.emissive.getHexString()}*${r(s.emissiveIntensity)} side ${s.side}${s.map ? ` map@${r(s.map.repeat.x)}x${r(s.map.repeat.y)}` : ''}`;
  }).join(',');
  meshes.push(`${pos.length / 3} ${Array.from(pos, r).join(' ')} | ${[...o.position.toArray(), o.rotation.y].map(r).join(' ')} | shadow ${+o.castShadow}${+o.receiveShadow} | ${look}`);
});
const hash = (lines: string[]): string => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
const free = yuntayTreeFree().map((ring) => ring.map(r).join(' '));
console.log(`mode ${paint ? 'paint' : 'headless'}`);
console.log(`meshes ${meshes.length}  vertices ${meshes.reduce((s, m) => s + Number(m.split(' ')[0]), 0)}  hash ${hash(meshes)}`);
console.log(`by geometry ${[...kinds].sort().map(([k, n]) => `${k}:${n}`).join(' ')}`);
console.log(`colliders ${colliders.length}  hash ${hash(colliders)}`);
console.log(`tree-free rings ${free.length} (${yuntayTreeFree().map((q) => q.length / 2).join('/')} pts)  hash ${hash(free)}`);
if (paint) console.log(`canvas calls ${drawn.length}  hash ${hash(drawn)}`);
