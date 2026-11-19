/**
 * Usage: npx tsx scripts/verify-yuntay-branches.ts [--module=<path to yuntayExterior.ts>]
 * Exercises each conditional of the 雲泰 exterior builder on its own and prints what it produced, so
 * a refactor can be shown to take the same branch with the same result:
 *   A  lamp condition  `i % 3 !== 1`   → per pier: skipped (no lamp) or entered (lamp built)
 *   B  shadow flag     `cast = false`  → meshes that do not cast shadows vs those that do
 *   C  last riser      `next tier ?? 0`→ riser height ranges: with a tier below vs down to the ground
 *   D  canvas present  `if (g) paint`  → texture painters skipped (no 2D context) vs run
 *   E  resources the build registers with the tracker (a count, not a branch)
 */
import { BufferGeometry, Mesh, Scene } from 'three';

const modulePath = process.argv.find((a) => a.startsWith('--module='))?.slice('--module='.length) ?? '../src/buildings/yuntayExterior';
const { createYuntayExterior } = (await import(modulePath)) as typeof import('../src/buildings/yuntayExterior');

let painted = 0;
const recorder = new Proxy({}, { get: (_t, name) => (name === 'canvas' ? {} : () => void painted++), set: () => true });
let hasContext = false;
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => (hasContext ? recorder : null) }) };
const physics = { createCollider: () => ({}), removeCollider() {} };
const made = { geometry: new Set<unknown>(), material: new Set<unknown>(), texture: new Set<unknown>() };
const tracker = {
  collider: <T>(c: T) => c,
  geometry: <T>(g: T) => (made.geometry.add(g), g),
  material: <T>(m: T) => (made.material.add(m), m),
  texture: <T>(t: T) => (made.texture.add(t), t),
};

function build(): Mesh[] {
  const scene = new Scene();
  createYuntayExterior(scene, physics as never, tracker as never);
  const out: Mesh[] = [];
  scene.traverse((o) => { if (o instanceof Mesh) out.push(o); });
  return out;
}
const params = (m: Mesh): Record<string, number> => (m.geometry as BufferGeometry & { parameters?: Record<string, number> }).parameters ?? {};
const yRange = (m: Mesh): [number, number] => {
  const a = m.geometry.getAttribute('position');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.count; i++) { lo = Math.min(lo, a.getY(i)); hi = Math.max(hi, a.getY(i)); }
  return [lo, hi];
};
const f = (v: number): string => v.toFixed(2);

const meshes = build();
console.log(`module ${modulePath.split('/').pop()}`);

console.log('\nA  lamp condition (i % 3 !== 1 → skip the lamp)');
const piers = meshes.map((m, k) => ({ m, k })).filter(({ m }) => m.geometry.type === 'BoxGeometry' && params(m).width === 0.7);
piers.forEach(({ k }, i) => {
  const next = meshes[k + 1];
  const lamp = next?.geometry.type === 'BoxGeometry' && params(next).width === 0.6;
  console.log(`  pier ${String(i).padStart(2)}: ${lamp ? 'lamp built (base+pole+globe)' : 'no lamp'}`);
});
console.log(`  piers ${piers.length}, lamp globes ${meshes.filter((m) => m.geometry.type === 'SphereGeometry').length}`);

console.log('\nB  shadow flag');
const cast = meshes.filter((m) => m.castShadow).length;
console.log(`  casts shadows ${cast}, does not cast ${meshes.length - cast}; of those: receive ${meshes.filter((m) => m.receiveShadow).length}`);

console.log('\nC  risers: each runs down to the next tier\'s surface; the last has no tier below and runs to the ground');
// The three risers come first, then the two end caps of the walk (also 0 → walk height).
meshes.filter((m) => m.geometry.type === 'BufferGeometry' && yRange(m)[1] <= 0.46 && yRange(m)[0] !== yRange(m)[1])
  .forEach((m, k) => { const [lo, hi] = yRange(m); console.log(`  ${k < 3 ? `riser ${k + 1}` : 'end cap'}: y ${f(lo)} → ${f(hi)}${k === 2 ? '   <- no tier below: down to the ground' : ''}`); });

console.log('\nD  canvas present?');
console.log(`  no 2D context : painter calls ${painted}`);
hasContext = true;
painted = 0;
build();
console.log(`  with 2D context: painter calls ${painted}`);

console.log('\nE  resources registered with the tracker (one build)');
for (const s of Object.values(made)) s.clear();
hasContext = false;
build();
console.log(`  geometries ${made.geometry.size}, materials ${made.material.size}, textures ${made.texture.size}`);
