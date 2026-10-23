/**
 * Usage: npm run facades:build
 * assets-src/campus/facades.json (+ rectified photo walls from the facade tool)
 *   → public/data/facades.json        per-building procedural style indices + photo atlas UVs
 *   → public/data/facades/<id>.ktx2   one atlas per photographed building (ETC1S, sRGB, mipmapped)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import sharp, { type OverlayOptions } from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import type { CampusData } from '../src/campus/campusTypes';
import type { BuildingPhotos, FacadeData, FacadeSource, FacadeStyle, PhotoEdge } from '../src/campus/facadeTypes';

const SRC = 'assets-src/campus/facades.json';
const PHOTOS = 'assets-src/photos';
const OUT = 'public/data/facades.json';
const ATLAS_DIR = 'public/data/facades';
/** Target texel density before the atlas is scaled to fit. */
const PX_PER_M = 24;
const ATLAS_W = 2048;
const ATLAS_MAX_H = 2048;
/** Edge-extended border around each wall so mipmaps don't bleed neighbours in. */
const GUTTER = 8;

const src = JSON.parse(readFileSync(SRC, 'utf8')) as FacadeSource;
const campus = JSON.parse(readFileSync('public/data/campus.json', 'utf8')) as CampusData;

const preset = (name: string): FacadeStyle => {
  const p = src.presets[name];
  if (!p) throw new Error(`unknown facade preset "${name}"`);
  return p;
};

// --- Procedural styles ------------------------------------------------------------------------
const styles: FacadeStyle[] = [preset('campus'), preset('town')];
const styleKeys = new Map(styles.map((s, i) => [JSON.stringify(s), i]));
const styleIndex = (s: FacadeStyle): number => {
  const key = JSON.stringify(s);
  let i = styleKeys.get(key);
  if (i === undefined) {
    i = styles.push(s) - 1;
    styleKeys.set(key, i);
  }
  return i;
};

const building: Record<string, number> = {};
const counts = new Map<string, number>();
for (const b of campus.buildings) {
  if (!b.name) continue;
  const entry = src.buildings[b.name];
  const rule = src.rules.find((r) => b.name!.includes(r.match));
  const presetName = entry?.preset ?? rule?.preset;
  if (!presetName && !entry?.style) continue;
  const style: FacadeStyle = { ...preset(presetName ?? (b.inCampus ? 'campus' : 'town')), ...entry?.style };
  building[String(b.id)] = styleIndex(style);
  counts.set(presetName ?? 'custom', (counts.get(presetName ?? 'custom') ?? 0) + 1);
}

// --- Photo atlases ----------------------------------------------------------------------------
rmSync(ATLAS_DIR, { recursive: true, force: true });
mkdirSync(ATLAS_DIR, { recursive: true });
const photos: Record<string, BuildingPhotos> = {};

for (const [id, entry] of Object.entries(src.photos)) {
  const walls = entry.edges.filter((e) => {
    const ok = existsSync(`${PHOTOS}/${entry.name}/rectified/${e.file}`);
    if (!ok) console.warn(`  ${entry.name} edge ${e.edge}: missing rectified/${e.file}, skipped`);
    return ok;
  });
  if (!walls.length) continue;

  // Shelf-pack at the target density, then scale the whole layout down if it is too tall.
  const pack = (scale: number): { x: number; y: number; w: number; h: number }[] & { height: number } => {
    let x = 0, y = 0, shelf = 0;
    const out = walls.map((e) => {
      const w = Math.max(16, Math.round(e.width * PX_PER_M * scale));
      const h = Math.max(16, Math.round(e.height * PX_PER_M * scale));
      if (x + w + GUTTER * 2 > ATLAS_W) { x = 0; y += shelf; shelf = 0; }
      const r = { x: x + GUTTER, y: y + GUTTER, w: Math.min(w, ATLAS_W - GUTTER * 2), h };
      x += r.w + GUTTER * 2;
      shelf = Math.max(shelf, h + GUTTER * 2);
      return r;
    });
    return Object.assign(out, { height: y + shelf });
  };
  let scale = 1;
  let layout = pack(scale);
  while (layout.height > ATLAS_MAX_H) {
    scale *= 0.9;
    layout = pack(scale);
  }
  const H = Math.ceil(layout.height / 4) * 4;

  const composites: OverlayOptions[] = [];
  for (let i = 0; i < walls.length; i++) {
    const r = layout[i]!;
    const input = await sharp(`${PHOTOS}/${entry.name}/rectified/${walls[i]!.file}`)
      .resize(r.w, r.h, { fit: 'fill' })
      .extend({ top: GUTTER, bottom: GUTTER, left: GUTTER, right: GUTTER, extendWith: 'copy' })
      .png()
      .toBuffer();
    composites.push({ input, left: r.x - GUTTER, top: r.y - GUTTER });
  }
  const png = await sharp({ create: { width: ATLAS_W, height: H, channels: 4, background: '#808080ff' } }).composite(composites).png().toBuffer();
  const ktx2 = await encodeToKTX2(new Uint8Array(png), {
    isUASTC: false, qualityLevel: 200, generateMipmap: true, isPerceptual: true, isSetKTX2SRGBTransferFunc: true,
  } as Parameters<typeof encodeToKTX2>[1]);
  writeFileSync(`${ATLAS_DIR}/${id}.ktx2`, ktx2);

  const edges: PhotoEdge[] = walls.map((e, i) => {
    const r = layout[i]!;
    // KTX2 textures are not flipped on upload: image row 0 is v = 0, so the wall's bottom is the larger v.
    return { edge: e.edge, uv: [r.x / ATLAS_W, (r.y + r.h) / H, (r.x + r.w) / ATLAS_W, r.y / H] };
  });
  photos[id] = { atlas: `data/facades/${id}.ktx2`, edges };
  console.log(`  ${entry.name} (${id}): ${walls.length} photo walls → ${ATLAS_W}×${H} atlas, ${(ktx2.byteLength / 1024).toFixed(0)} KB${scale < 1 ? ` (scaled ${(scale * 100).toFixed(0)}%)` : ''}`);
}

const out: FacadeData = { styles, building, photos };
writeFileSync(OUT, JSON.stringify(out));
console.log(`${Object.keys(building).length} styled buildings (${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}), ${styles.length} styles, ${Object.keys(photos).length} photo atlases → ${OUT}`);
