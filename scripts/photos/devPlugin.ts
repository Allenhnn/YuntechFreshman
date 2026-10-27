/**
 * Dev-server endpoints for the facade tool (/tools/facade.html). Only active under `vite` (serve),
 * never in a production build. Writes go to assets-src/ and then re-run the facade build so the
 * game picks the change up on reload.
 *
 *   GET  /__facade/state                 photo index + facade source
 *   POST /__facade/ingest                re-run photo ingest, returns the new index
 *   POST /__facade/wall   {…, png}       save a rectified wall, register it, rebuild
 *   POST /__facade/style  {name, style}  save a building's sampled style, rebuild
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { FacadeSource, FacadeStyle, PhotoSection } from '../../src/campus/facadeTypes.ts';

const SOURCE = 'assets-src/campus/facades.json';
const PHOTOS = 'assets-src/photos';
const INDEX = `${PHOTOS}/index.json`;

/** Pretty JSON that keeps flat objects and number arrays on one line, matching the hand-written source. */
export function compactJson(value: unknown, indent = ''): string {
  const flat = (v: unknown): boolean => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null));
  if (flat(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + compactJson(v, inner)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return '{}';
  if (entries.every(([, v]) => flat(v))) return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, inner)}`).join(',\n')}\n${indent}}`;
}

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function run(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('npx', ['tsx', script], { maxBuffer: 1 << 22 }, (err, stdout, stderr) => resolve(`${stdout}${stderr}${err ? `\n${err.message}` : ''}`));
  });
}

/** Folder / file names come from the browser: keep them inside assets-src/photos. */
const safe = (s: string): string => {
  if (!s || /[\\/]|\.\./.test(s)) throw new Error(`bad name: ${s}`);
  return s;
};

const send = (res: ServerResponse, status: number, data: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

interface WallRequest {
  buildingId: number;
  name: string;
  edge: number;
  width: number;
  height: number;
  sources: PhotoSection['sources'];
  /** PNG as a data URL. */
  png: string;
}

export function facadeToolPlugin(): Plugin {
  return {
    name: 'facade-tool',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__facade', (req, res) => {
        void (async () => {
          try {
            const route = req.url?.split('?')[0] ?? '';
            if (req.method === 'GET' && route === '/state') {
              send(res, 200, { index: readJson(INDEX, {}), source: readJson<FacadeSource | null>(SOURCE, null) });
            } else if (req.method === 'POST' && route === '/ingest') {
              const log = await run('scripts/photos/ingest.ts');
              send(res, 200, { log, index: readJson(INDEX, {}) });
            } else if (req.method === 'POST' && route === '/wall') {
              const w = JSON.parse(await body(req)) as WallRequest;
              const name = safe(w.name);
              const file = `edge-${Math.trunc(w.edge)}.png`;
              mkdirSync(`${PHOTOS}/${name}/rectified`, { recursive: true });
              writeFileSync(`${PHOTOS}/${name}/rectified/${file}`, Buffer.from(w.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
              const src = readJson<FacadeSource>(SOURCE, { presets: {}, rules: [], buildings: {}, photos: {} });
              const entry = (src.photos[String(w.buildingId)] ??= { name, edges: [] });
              entry.edges = entry.edges.filter((e) => e.edge !== w.edge);
              entry.edges.push({ edge: w.edge, file, width: Math.round(w.width * 100) / 100, height: w.height, sources: w.sources });
              entry.edges.sort((a, b) => a.edge - b.edge);
              writeFileSync(SOURCE, `${compactJson(src)}\n`);
              send(res, 200, { log: await run('scripts/build-facades.ts') });
            } else if (req.method === 'POST' && route === '/style') {
              const { name, style } = JSON.parse(await body(req)) as { name: string; style: Partial<FacadeStyle> };
              const src = readJson<FacadeSource>(SOURCE, { presets: {}, rules: [], buildings: {}, photos: {} });
              src.buildings[safe(name)] = { ...src.buildings[name], style };
              writeFileSync(SOURCE, `${compactJson(src)}\n`);
              send(res, 200, { log: await run('scripts/build-facades.ts') });
            } else {
              send(res, 404, { error: 'not found' });
            }
          } catch (err) {
            send(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    },
  };
}
