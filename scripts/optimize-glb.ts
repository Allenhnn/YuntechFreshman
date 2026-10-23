/**
 * Usage: npm run assets:optimize -- <input.glb|.gltf> <output.glb> [--max-texture 1024]
 * Optimises an exported model for the game (Draco + KTX2) and checks it against the asset spec.
 */
import { statSync } from 'node:fs';
import { createIO, inspect, optimizeDocument } from './gltf-pipeline';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--max-texture');
  const maxTextureSize = flag >= 0 ? Number(args[flag + 1]) : 1024;
  const [input, output] = args.filter((_, i) => i !== flag && i !== flag + 1);
  if (!input || !output || !Number.isFinite(maxTextureSize)) {
    console.error('usage: npm run assets:optimize -- <input.glb> <output.glb> [--max-texture 1024]');
    process.exit(1);
  }

  const io = await createIO();
  const doc = await io.read(input);
  inspect(doc, 'source');
  await optimizeDocument(doc, { maxTextureSize });
  await io.write(output, doc);
  inspect(doc, 'output');
  const kb = (p: string): string => `${(statSync(p).size / 1024).toFixed(1)} KB`;
  console.log(`[optimize] ${input} (${kb(input)}) → ${output} (${kb(output)})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
