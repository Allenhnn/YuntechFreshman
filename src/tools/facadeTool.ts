/**
 * Facade tool (dev only, /tools/facade.html): turns your own building photos into
 *  A) rectified wall images: click the four corners of a wall section, enter which part of the wall
 *     it is (m), and the section is warped onto the wall at its real size; "Save wall" stores it
 *     and rebuilds the photo atlases;
 *  C) a procedural style: sample wall / trim / glass colours with the eyedropper and tune the window grid.
 * Walls are OSM outer-ring edges. "Left" means the left end as seen standing outside the wall,
 * which is the edge's end vertex (i + 1).
 */
import type { CampusBuilding, CampusData } from '../campus/campusTypes';
import type { FacadeSource, FacadeStyle, PhotoIndex, PhotoIndexEntry, PhotoSection, WindowPattern } from '../campus/facadeTypes';
import { DEFAULT_CAMPUS_STYLE } from '../campus/facadeTypes';
import { applyHomography, sampleBilinear, solveHomography } from './homography';

/** Rectified texel density (px per metre), capped so one wall stays under MAX_PX per side. */
const PX_PER_M = 40;
const MAX_PX = 4096;
const CORNER_NAMES = ['TL', 'TR', 'BR', 'BL'] as const;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
const num = (id: string): number => Number.parseFloat($<HTMLInputElement>(id).value);
const setNum = (id: string, v: number): void => {
  $<HTMLInputElement>(id).value = String(Math.round(v * 100) / 100);
};
const log = (msg: string): void => {
  const el = $('log');
  el.textContent = `${msg}\n${el.textContent ?? ''}`.slice(0, 6000);
};

interface Wall {
  edge: number;
  length: number;
  canvas: HTMLCanvasElement;
  pxPerM: number;
  sources: PhotoSection['sources'];
}

const state = {
  campus: null as CampusData | null,
  index: {} as PhotoIndex,
  source: null as FacadeSource | null,
  folder: '',
  building: null as CampusBuilding | null,
  photo: null as PhotoIndexEntry | null,
  image: null as HTMLImageElement | null,
  pixels: null as ImageData | null,
  corners: [] as [number, number][],
  wall: null as Wall | null,
  pick: null as null | 'wall' | 'trim' | 'glass',
  view: { scale: 1, x: 0, y: 0 },
};

// --- Data ------------------------------------------------------------------------------------

async function loadState(): Promise<void> {
  const [campus, s] = await Promise.all([
    fetch('/data/campus.json').then((r) => r.json() as Promise<CampusData>),
    fetch('/__facade/state').then((r) => r.json() as Promise<{ index: PhotoIndex; source: FacadeSource }>),
  ]);
  state.campus = campus;
  state.index = s.index;
  state.source = s.source;
  const sel = $<HTMLSelectElement>('folder');
  const folders = Object.keys(state.index);
  sel.innerHTML = folders.length
    ? folders.map((f) => `<option>${f}</option>`).join('')
    : '<option value="">(no photos yet: put them in assets-src/photos/&lt;name&gt;/originals/ and press Rescan)</option>';
  if (folders.length) selectFolder(state.folder && folders.includes(state.folder) ? state.folder : folders[0]!);
}

function selectFolder(folder: string): void {
  state.folder = folder;
  $<HTMLSelectElement>('folder').value = folder;
  const entry = state.index[folder];
  const campus = state.campus;
  state.building = campus?.buildings.find((b) => b.id === entry?.buildingId) ?? campus?.buildings.find((b) => b.name === folder) ?? null;
  $('bInfo').textContent = state.building ? `${state.building.levels}F · ${state.building.height} m` : 'not in campus.json';
  $('photos').innerHTML = '';
  for (const p of entry?.photos ?? []) {
    const img = document.createElement('img');
    img.src = photoUrl(p.file);
    img.title = `${p.file}${p.edge !== undefined ? ` → edge ${p.edge} (${Math.round((p.confidence ?? 0) * 100)}%)` : ''}`;
    img.onclick = () => void selectPhoto(p, img);
    $('photos').append(img);
  }
  loadStyle();
  state.wall = null;
  const first = entry?.photos.find((p) => p.edge !== undefined);
  selectEdge(first?.edge ?? longestEdge());
  drawFootprint();
}

const photoUrl = (file: string): string => `/assets-src/photos/${encodeURIComponent(state.folder)}/originals/${encodeURIComponent(file)}`;

async function selectPhoto(p: PhotoIndexEntry, thumb: HTMLImageElement): Promise<void> {
  document.querySelectorAll('#photos img').forEach((el) => el.classList.toggle('sel', el === thumb));
  state.photo = p;
  state.corners = [];
  const img = new Image();
  img.src = photoUrl(p.file);
  await img.decode();
  state.image = img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.drawImage(img, 0, 0);
  state.pixels = g.getImageData(0, 0, c.width, c.height);
  if (p.edge !== undefined && p.edge !== state.wall?.edge) selectEdge(p.edge);
  fitView();
  drawView();
}

// --- Walls -----------------------------------------------------------------------------------

function edgeEnds(b: CampusBuilding, i: number): [number, number, number, number] {
  const n = b.outer.length / 2;
  const j = (i + 1) % n;
  return [b.outer[i * 2]!, b.outer[i * 2 + 1]!, b.outer[j * 2]!, b.outer[j * 2 + 1]!];
}

function longestEdge(): number {
  const b = state.building;
  if (!b) return 0;
  let best = 0, len = 0;
  for (let i = 0; i < b.outer.length / 2; i++) {
    const [px, pz, qx, qz] = edgeEnds(b, i);
    const l = Math.hypot(qx - px, qz - pz);
    if (l > len) { len = l; best = i; }
  }
  return best;
}

function selectEdge(edge: number): void {
  const b = state.building;
  if (!b) return;
  const [px, pz, qx, qz] = edgeEnds(b, edge);
  const length = Math.hypot(qx - px, qz - pz);
  const pxPerM = Math.min(PX_PER_M, MAX_PX / length, MAX_PX / b.height);
  if (state.wall?.edge !== edge) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.round(length * pxPerM));
    canvas.height = Math.max(8, Math.round(b.height * pxPerM));
    state.wall = { edge, length, canvas, pxPerM, sources: [] };
  }
  setNum('a0', 0); setNum('a1', length); setNum('h0', 0); setNum('h1', b.height);
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(qz - pz, qx - px) * 180) / Math.PI + 360) % 360 / 45) % 8];
  $('edgeInfo').textContent = `edge ${edge}: ${length.toFixed(1)} m × ${b.height} m, faces ${compass}`;
  drawFootprint();
  drawWall();
}

function drawFootprint(): void {
  const c = $<HTMLCanvasElement>('footprint');
  const g = c.getContext('2d');
  const b = state.building;
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  if (!b) return;
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < b.outer.length; i += 2) { xs.push(b.outer[i]!); zs.push(b.outer[i + 1]!); }
  for (const p of state.index[state.folder]?.photos ?? []) if (p.x !== undefined && p.z !== undefined) { xs.push(p.x); zs.push(p.z); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const s = Math.min((c.width - 60) / (maxX - minX || 1), (c.height - 60) / (maxZ - minZ || 1));
  const ox = (c.width - (maxX - minX) * s) / 2, oz = (c.height - (maxZ - minZ) * s) / 2;
  const P = (x: number, z: number): [number, number] => [ox + (x - minX) * s, oz + (z - minZ) * s];
  footprintMap = { P, s };
  g.fillStyle = '#2c3338';
  g.beginPath();
  for (let i = 0; i < b.outer.length; i += 2) g.lineTo(...P(b.outer[i]!, b.outer[i + 1]!));
  g.fill();
  const done = new Set(state.source?.photos[String(b.id)]?.edges.map((e) => e.edge));
  for (let i = 0; i < b.outer.length / 2; i++) {
    const [px, pz, qx, qz] = edgeEnds(b, i);
    g.strokeStyle = i === state.wall?.edge ? '#3fb07a' : done.has(i) ? '#4f8fd0' : '#7a848c';
    g.lineWidth = i === state.wall?.edge ? 5 : 2;
    g.beginPath(); g.moveTo(...P(px, pz)); g.lineTo(...P(qx, qz)); g.stroke();
    if (i === state.wall?.edge) {
      g.fillStyle = '#e6e8ea';
      g.font = 'bold 18px system-ui';
      const [lx, lz] = P(qx, qz), [rx, rz] = P(px, pz);
      g.fillText('L', lx + 4, lz - 4);
      g.fillText('R', rx + 4, rz - 4);
    }
  }
  for (const p of state.index[state.folder]?.photos ?? []) {
    if (p.x === undefined || p.z === undefined) continue;
    const [x, z] = P(p.x, p.z);
    g.fillStyle = p === state.photo ? '#3fb07a' : '#e0a040';
    g.beginPath(); g.arc(x, z, 5, 0, Math.PI * 2); g.fill();
    if (p.heading !== undefined) {
      const a = (p.heading * Math.PI) / 180;
      g.strokeStyle = g.fillStyle;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, z); g.lineTo(x + Math.sin(a) * 22, z - Math.cos(a) * 22); g.stroke();
    }
  }
}
let footprintMap: { P: (x: number, z: number) => [number, number]; s: number } | null = null;

$('footprint').addEventListener('click', (e) => {
  const b = state.building;
  if (!b || !footprintMap) return;
  const c = e.currentTarget as HTMLCanvasElement;
  const r = c.getBoundingClientRect();
  const mx = ((e.clientX - r.left) / r.width) * c.width, my = ((e.clientY - r.top) / r.height) * c.height;
  let best = -1, bestD = 20;
  for (let i = 0; i < b.outer.length / 2; i++) {
    const [px, pz, qx, qz] = edgeEnds(b, i);
    const [ax, ay] = footprintMap.P(px, pz), [bx, by] = footprintMap.P(qx, qz);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(mx - (ax + dx * t), my - (ay + dy * t));
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) selectEdge(best);
});

// --- Photo view: corners, zoom, eyedropper ---------------------------------------------------

const view = $<HTMLCanvasElement>('view');

function fitView(): void {
  const img = state.image;
  if (!img) return;
  const s = Math.min(view.width / img.naturalWidth, view.height / img.naturalHeight) * 0.95;
  state.view = { scale: s, x: (view.width - img.naturalWidth * s) / 2, y: (view.height - img.naturalHeight * s) / 2 };
}

const toImage = (cx: number, cy: number): [number, number] => [(cx - state.view.x) / state.view.scale, (cy - state.view.y) / state.view.scale];
const toCanvas = (ix: number, iy: number): [number, number] => [ix * state.view.scale + state.view.x, iy * state.view.scale + state.view.y];

function drawView(): void {
  const g = view.getContext('2d');
  if (!g) return;
  g.fillStyle = '#111416';
  g.fillRect(0, 0, view.width, view.height);
  const img = state.image;
  const hint = $('hint');
  if (!img) {
    hint.textContent = 'Pick a photo on the left.';
    return;
  }
  g.drawImage(img, state.view.x, state.view.y, img.naturalWidth * state.view.scale, img.naturalHeight * state.view.scale);
  const pts = state.corners.map(([x, y]) => toCanvas(x, y));
  if (pts.length) {
    g.strokeStyle = '#3fb07a';
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach((p) => g.lineTo(...p));
    if (pts.length === 4) g.closePath();
    g.stroke();
  }
  pts.forEach(([x, y], i) => {
    g.fillStyle = '#3fb07a';
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 13px system-ui';
    g.fillText(CORNER_NAMES[i]!, x + 8, y - 8);
  });
  hint.textContent = state.pick
    ? `Click the photo to sample the ${state.pick} colour.`
    : state.corners.length < 4
      ? `Click corner ${CORNER_NAMES[state.corners.length]} of the wall section (top-left → top-right → bottom-right → bottom-left). Wheel = zoom, shift-drag = pan.`
      : 'Drag corners to adjust, set the section range on the right, then "Rectify section".';
}

let drag: { corner: number } | { pan: [number, number] } | null = null;
view.addEventListener('mousedown', (e) => {
  if (!state.image) return;
  if (e.shiftKey) {
    drag = { pan: [e.offsetX, e.offsetY] };
    return;
  }
  const [ix, iy] = toImage(e.offsetX, e.offsetY);
  if (state.pick) {
    sampleColour(ix, iy, state.pick);
    state.pick = null;
    document.querySelectorAll('[data-pick]').forEach((b) => b.classList.remove('on'));
    drawView();
    return;
  }
  const hit = state.corners.findIndex(([x, y]) => Math.hypot(...toCanvas(x, y).map((v, k) => v - [e.offsetX, e.offsetY][k]!) as [number, number]) < 10);
  if (hit >= 0) drag = { corner: hit };
  else if (state.corners.length < 4) state.corners.push([ix, iy]);
  drawView();
});
view.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if ('pan' in drag) {
    state.view.x += e.offsetX - drag.pan[0];
    state.view.y += e.offsetY - drag.pan[1];
    drag.pan = [e.offsetX, e.offsetY];
  } else {
    state.corners[drag.corner] = toImage(e.offsetX, e.offsetY);
  }
  drawView();
});
addEventListener('mouseup', () => { drag = null; });
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [ix, iy] = toImage(e.offsetX, e.offsetY);
  state.view.scale *= Math.exp(-e.deltaY * 0.0015);
  state.view.x = e.offsetX - ix * state.view.scale;
  state.view.y = e.offsetY - iy * state.view.scale;
  drawView();
}, { passive: false });

function resizeView(): void {
  const r = view.parentElement!.getBoundingClientRect();
  view.width = r.width;
  view.height = r.height;
  fitView();
  drawView();
}
addEventListener('resize', resizeView);

// --- Rectification ---------------------------------------------------------------------------

function rectifySection(): void {
  const wall = state.wall, img = state.pixels, b = state.building, photo = state.photo;
  if (!wall || !img || !b || !photo) return log('Select a building, wall and photo first.');
  if (state.corners.length !== 4) return log('Place all four corners first.');
  const a0 = num('a0'), a1 = num('a1'), h0 = num('h0'), h1 = num('h1');
  if (!(a1 > a0 && h1 > h0)) return log('Section range is empty.');
  // Wall metres (a from the left end, h up from the ground) → photo pixels.
  let H;
  try {
    H = solveHomography([[a0, h1], [a1, h1], [a1, h0], [a0, h0]], state.corners);
  } catch (err) {
    return log(String(err));
  }
  const k = wall.pxPerM;
  const X0 = Math.max(0, Math.floor(a0 * k)), X1 = Math.min(wall.canvas.width, Math.ceil(a1 * k));
  const Y0 = Math.max(0, Math.floor((b.height - h1) * k)), Y1 = Math.min(wall.canvas.height, Math.ceil((b.height - h0) * k));
  const g = wall.canvas.getContext('2d');
  if (!g || X1 <= X0 || Y1 <= Y0) return;
  const out = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0);
  let missed = 0;
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const [px, py] = applyHomography(H, (x + 0.5) / k, b.height - (y + 0.5) / k);
      if (!sampleBilinear(img, px, py, out.data, ((y - Y0) * out.width + (x - X0)) * 4)) missed++;
    }
  }
  g.putImageData(out, X0, Y0);
  wall.sources.push({ photo: photo.file, corners: state.corners.map(([x, y]) => [Math.round(x), Math.round(y)]), along: [a0, a1], vertical: [h0, h1] });
  const total = (X1 - X0) * (Y1 - Y0);
  log(`Rectified ${photo.file} → edge ${wall.edge} [${a0}–${a1} m × ${h0}–${h1} m]${missed / total > 0.02 ? ` (${Math.round((missed / total) * 100)}% outside the photo, left as is)` : ''}`);
  state.corners = [];
  drawView();
  drawWall();
}

function drawWall(): void {
  const c = $<HTMLCanvasElement>('edgeOut');
  const g = c.getContext('2d');
  const wall = state.wall;
  if (!g) return;
  g.fillStyle = '#15181a';
  g.fillRect(0, 0, c.width, c.height);
  if (!wall) return;
  const s = Math.min(c.width / wall.canvas.width, c.height / wall.canvas.height);
  const w = wall.canvas.width * s, h = wall.canvas.height * s;
  g.strokeStyle = '#3a4147';
  g.strokeRect((c.width - w) / 2 - 0.5, (c.height - h) / 2 - 0.5, w + 1, h + 1);
  g.drawImage(wall.canvas, (c.width - w) / 2, (c.height - h) / 2, w, h);
}

async function saveWall(): Promise<void> {
  const wall = state.wall, b = state.building;
  if (!wall || !b || !wall.sources.length) return log('Nothing rectified on this wall yet.');
  log(`Saving edge ${wall.edge}…`);
  const res = await fetch('/__facade/wall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buildingId: b.id, name: state.folder, edge: wall.edge, width: wall.length, height: b.height,
      sources: wall.sources, png: wall.canvas.toDataURL('image/png'),
    }),
  });
  const out = (await res.json()) as { log?: string; error?: string };
  log(out.error ?? out.log ?? '');
  await refreshSource();
}

async function refreshSource(): Promise<void> {
  const s = (await fetch('/__facade/state').then((r) => r.json())) as { source: FacadeSource };
  state.source = s.source;
  drawFootprint();
}

// --- Procedural style ------------------------------------------------------------------------

function currentStyle(): FacadeStyle {
  return {
    wall: $<HTMLInputElement>('cWall').value,
    trim: $<HTMLInputElement>('cTrim').value,
    glass: $<HTMLInputElement>('cGlass').value,
    bay: num('bay'),
    floor: state.building ? state.building.height / Math.max(1, state.building.levels) : 3.6,
    win: [num('winW'), num('winH')],
    sill: num('sill'),
    pattern: $<HTMLSelectElement>('pattern').value as WindowPattern,
    groundGlass: $<HTMLInputElement>('groundGlass').checked,
  };
}

function loadStyle(): void {
  const src = state.source;
  const name = state.building?.name ?? state.folder;
  const entry = src?.buildings[name];
  const rule = src?.rules.find((r) => name.includes(r.match));
  const base = src?.presets[entry?.preset ?? rule?.preset ?? 'campus'] ?? DEFAULT_CAMPUS_STYLE;
  const s: FacadeStyle = { ...base, ...entry?.style };
  $<HTMLInputElement>('cWall').value = s.wall;
  $<HTMLInputElement>('cTrim').value = s.trim;
  $<HTMLInputElement>('cGlass').value = s.glass;
  setNum('bay', s.bay); setNum('winW', s.win[0]); setNum('winH', s.win[1]); setNum('sill', s.sill);
  $<HTMLSelectElement>('pattern').value = s.pattern;
  $<HTMLInputElement>('groundGlass').checked = s.groundGlass;
  drawStylePreview();
}

/** Average of a 9×9 patch, as #rrggbb. */
function sampleColour(ix: number, iy: number, slot: 'wall' | 'trim' | 'glass'): void {
  const img = state.pixels;
  if (!img) return;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.round(iy) - 4; y <= Math.round(iy) + 4; y++) {
    for (let x = Math.round(ix) - 4; x <= Math.round(ix) + 4; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4;
      r += img.data[o]!; g += img.data[o + 1]!; b += img.data[o + 2]!; n++;
    }
  }
  if (!n) return;
  const hex = `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`;
  $<HTMLInputElement>(slot === 'wall' ? 'cWall' : slot === 'trim' ? 'cTrim' : 'cGlass').value = hex;
  log(`Sampled ${slot} ${hex}`);
  drawStylePreview();
}

/** 2D sketch of 3 floors × 5 bays in the chosen style (the game shader adds grain and lighting). */
function drawStylePreview(): void {
  const c = $<HTMLCanvasElement>('stylePreview');
  const g = c.getContext('2d');
  if (!g) return;
  const s = currentStyle();
  const floors = 3, bays = 5;
  const fw = c.width / bays, fh = c.height / floors;
  g.fillStyle = s.wall;
  g.fillRect(0, 0, c.width, c.height);
  for (let f = 0; f < floors; f++) {
    const top = c.height - (f + 1) * fh;
    g.fillStyle = s.trim;
    g.fillRect(0, top + fh - fh * 0.05, c.width, fh * 0.05);
    g.fillStyle = s.glass;
    if (f === 0 && s.groundGlass) {
      g.fillRect(0, top + fh * 0.16, c.width, fh * 0.79);
      continue;
    }
    for (let b = 0; b < bays; b++) {
      const y0 = top + fh * (1 - s.sill - s.win[1]), h = fh * s.win[1];
      if (s.pattern === 'punched') g.fillRect(b * fw + fw * (0.5 - s.win[0] / 2), y0, fw * s.win[0], h);
      else if (s.pattern === 'ribbon') g.fillRect(b * fw, y0, fw, h);
      else if (s.pattern === 'curtain') g.fillRect(b * fw + 1, top + fh * 0.03, fw - 2, fh * 0.87);
    }
  }
}

async function saveStyle(): Promise<void> {
  const name = state.building?.name ?? state.folder;
  if (!name) return;
  const { floor: _floor, ...style } = currentStyle();
  const res = await fetch('/__facade/style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, style }) });
  const out = (await res.json()) as { log?: string; error?: string };
  log(out.error ?? out.log ?? '');
  await refreshSource();
}

// --- Wiring ----------------------------------------------------------------------------------

$<HTMLSelectElement>('folder').addEventListener('change', (e) => selectFolder((e.target as HTMLSelectElement).value));
$('ingest').addEventListener('click', () => {
  log('Scanning photos…');
  void fetch('/__facade/ingest', { method: 'POST' })
    .then((r) => r.json() as Promise<{ log: string }>)
    .then(async (r) => {
      log(r.log);
      await loadState();
    });
});
$('clearCorners').addEventListener('click', () => { state.corners = []; drawView(); });
$('addSection').addEventListener('click', rectifySection);
$('clearWall').addEventListener('click', () => {
  if (state.wall) { const e = state.wall.edge; state.wall = null; selectEdge(e); }
});
$('saveWall').addEventListener('click', () => void saveWall());
$('saveStyle').addEventListener('click', () => void saveStyle());
document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.pick = btn.dataset['pick'] as 'wall' | 'trim' | 'glass';
    document.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b === btn));
    drawView();
  });
});
for (const id of ['cWall', 'cTrim', 'cGlass', 'pattern', 'bay', 'winW', 'winH', 'sill', 'groundGlass']) $(id).addEventListener('input', drawStylePreview);

resizeView();
void loadState().catch((err: unknown) => log(`Failed to load: ${String(err)} (is this the Vite dev server?)`));
