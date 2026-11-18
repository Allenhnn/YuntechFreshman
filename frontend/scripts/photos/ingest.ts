/**
 * Usage: npm run photos:ingest
 * Scans assets-src/photos/<building name>/originals/*.jpg, reads EXIF GPS + compass heading and
 * guesses which wall (outer-ring edge of the OSM footprint) each photo shows. Writes
 * assets-src/photos/index.json, which the facade tool (/tools/facade.html) uses to pre-select walls.
 * The folder name must match the building's OSM name in public/data/campus.json.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { CampusBuilding, CampusData } from '../../src/campus/campusTypes';
import type { PhotoIndex, PhotoIndexEntry } from '../../src/campus/facadeTypes';
import { readExif } from './exif';

const ROOT = 'assets-src/photos';
const OUT = `${ROOT}/index.json`;

const campus = JSON.parse(readFileSync('public/data/campus.json', 'utf8')) as CampusData;
const R = 6378137;
const rad = (d: number): number => (d * Math.PI) / 180;
const project = (lat: number, lon: number): [number, number] => [
  rad(lon - campus.origin.lon) * R * Math.cos(rad(campus.origin.lat)),
  -rad(lat - campus.origin.lat) * R,
];

function centroid(b: CampusBuilding): [number, number] {
  let x = 0, z = 0;
  const n = b.outer.length / 2;
  for (let i = 0; i < n; i++) { x += b.outer[i * 2]!; z += b.outer[i * 2 + 1]!; }
  return [x / n, z / n];
}

/** Picks the wall the camera most plausibly looks at: in front of it, facing it, close by. */
function guessEdge(b: CampusBuilding, cx: number, cz: number, heading?: number): { edge: number; confidence: number; distance: number } | null {
  const r = b.outer;
  const n = r.length / 2;
  const look = heading === undefined ? null : [Math.sin(rad(heading)), -Math.cos(rad(heading))] as const;
  let best: { edge: number; confidence: number; distance: number; score: number } | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!, qx = r[j * 2]!, qz = r[j * 2 + 1]!;
    const dx = qx - px, dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const nx = dz / len, nz = -dx / len; // outward (outer ring is CCW)
    const front = (cx - px) * nx + (cz - pz) * nz;
    if (front <= 0.5) continue; // camera is behind this wall
    const t = ((cx - px) * dx + (cz - pz) * dz) / (len * len);
    const along = Math.max(0, -t, t - 1) * len; // how far past the wall's ends the camera stands
    const distance = Math.hypot(front, along);
    const facing = look ? -(look[0] * nx + look[1] * nz) : 0.5; // 1 = looking straight at it
    if (look && facing < 0.2) continue;
    const score = facing * 2 + len / 40 - distance / 60 - along / 20;
    if (!best || score > best.score) best = { edge: i, distance, score, confidence: Math.max(0, Math.min(1, facing * (1 - along / (len + 1)))) };
  }
  return best && { edge: best.edge, confidence: Math.round(best.confidence * 100) / 100, distance: Math.round(best.distance * 10) / 10 };
}

const index: PhotoIndex = {};
if (!existsSync(ROOT)) {
  console.log(`${ROOT} does not exist yet: create ${ROOT}/<building name>/originals/ and drop photos in.`);
  process.exit(0);
}
for (const folder of readdirSync(ROOT)) {
  const dir = `${ROOT}/${folder}/originals`;
  if (!statSync(`${ROOT}/${folder}`).isDirectory() || !existsSync(dir)) continue;
  const candidates = campus.buildings.filter((b) => b.name === folder);
  if (!candidates.length) console.warn(`! ${folder}: no OSM building with this name (check public/data/campus.json names)`);
  const photos: PhotoIndexEntry[] = [];
  let buildingId: number | null = candidates[0]?.id ?? null;
  for (const file of readdirSync(dir).sort()) {
    if (/\.(heic|heif)$/i.test(file)) {
      console.warn(`! ${folder}/${file}: HEIC is not supported; export as JPG (iPhone: Settings → Camera → Formats → Most Compatible)`);
      continue;
    }
    if (!/\.(jpe?g)$/i.test(file)) continue;
    const exif = readExif(new Uint8Array(readFileSync(`${dir}/${file}`)));
    const entry: PhotoIndexEntry = { file, width: exif.width, height: exif.height, heading: exif.heading };
    if (exif.lat !== undefined && exif.lon !== undefined) {
      const [x, z] = project(exif.lat, exif.lon);
      entry.x = Math.round(x * 10) / 10;
      entry.z = Math.round(z * 10) / 10;
      // Several OSM buildings can share a name: take the one nearest the camera.
      const b = candidates.slice().sort((a, c) => Math.hypot(...centroid(a).map((v, k) => v - [x, z][k]!) as [number, number]) - Math.hypot(...centroid(c).map((v, k) => v - [x, z][k]!) as [number, number]))[0];
      if (b) {
        buildingId = b.id;
        Object.assign(entry, guessEdge(b, x, z, exif.heading) ?? {});
      }
    }
    photos.push(entry);
  }
  index[folder] = { buildingId, photos };
  const located = photos.filter((p) => p.edge !== undefined).length;
  console.log(`${folder}: ${photos.length} photos, ${located} matched to a wall${photos.length - located ? ` (${photos.length - located} without GPS/heading: pick the wall in the tool)` : ''}`);
}
writeFileSync(OUT, JSON.stringify(index, null, 2));
console.log(`→ ${OUT}`);
