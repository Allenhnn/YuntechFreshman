import { loadMaps, type MapsApi, type Panorama, type PanoData } from './streetView';

/**
 * 街景比對 (dev only): a live Google Street View panel beside the game, following the player.
 * It finds the panorama nearest the character and turns it the way the game camera faces, so the
 * model and the real place can be compared side by side and fixed by eye.
 *
 * Display only, like the facade tool's reference tab: the official Maps JavaScript API renders the
 * panorama, and nothing is downloaded, cached, sampled or built from it (Google Maps Platform terms).
 * The key is read only in dev builds, so it never ends up in a production bundle.
 */
const KEY: string | undefined = import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAPS_KEY : undefined;
/** Look for a new panorama after moving this far (m) … */
const REQUERY_M = 6;
/** … but not more often than this (ms). */
const REQUERY_MS = 800;
const R = 6378137;

interface Origin { lat: number; lon: number }
interface Hooks {
  origin: Origin;
  /** Move the player to campus metres (x, z). */
  teleport(x: number, z: number, label: string): void;
}

let hooks: Hooks | null = null;
let on = false;
let root: HTMLDivElement | null = null;
let info: HTMLDivElement | null = null;
let follow: HTMLInputElement | null = null;
let maps: MapsApi | null = null;
let pano: Panorama | null = null;
let panoId = '';
let panoAt: { x: number; z: number } | null = null;
let panoDate = '';
let askedAt: { x: number; z: number } | null = null;
let askedTime = 0;
let busy = false;
let lastPov = { heading: NaN, pitch: NaN };
let player = { x: 0, z: 0 };
let infoTime = 0;

const toLatLng = (o: Origin, x: number, z: number): { lat: number; lng: number } => ({
  lat: o.lat - ((z / R) * 180) / Math.PI,
  lng: o.lon + ((x / (R * Math.cos((o.lat * Math.PI) / 180))) * 180) / Math.PI,
});
const toLocal = (o: Origin, lat: number, lng: number): { x: number; z: number } => ({
  x: (((lng - o.lon) * Math.PI) / 180) * R * Math.cos((o.lat * Math.PI) / 180),
  z: -(((lat - o.lat) * Math.PI) / 180) * R,
});

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'sv-sync';
  el.innerHTML = `
    <div class="sv-sync-bar">
      <b>Google 街景比對</b>
      <label><input type="checkbox" checked> 跟隨遊戲視角</label>
      <button type="button" data-act="go">傳送到街景位置</button>
      <button type="button" data-act="close">✕</button>
    </div>
    <div class="sv-sync-pano"></div>
    <div class="sv-sync-info">搜尋最近的街景…</div>`;
  const style = document.createElement('style');
  style.textContent = `
    .sv-sync { position: fixed; right: 14px; bottom: 14px; width: min(46vw, 680px); height: min(52vh, 520px);
      display: flex; flex-direction: column; background: #111; border: 2px solid #fff; border-radius: 10px;
      overflow: hidden; z-index: 50; font: 13px/1.4 system-ui, sans-serif; color: #fff; box-shadow: 0 6px 24px #0008; }
    .sv-sync-bar { display: flex; gap: 10px; align-items: center; padding: 6px 10px; background: #222; }
    .sv-sync-bar b { margin-right: auto; }
    .sv-sync-bar button { background: #3a3a3a; color: #fff; border: 1px solid #666; border-radius: 6px; padding: 2px 8px; cursor: pointer; }
    .sv-sync-bar button:hover { background: #555; }
    .sv-sync-pano { flex: 1; min-height: 0; }
    .sv-sync-info { padding: 4px 10px; background: #222; color: #ccc; font-size: 12px; }`;
  el.append(style);
  follow = el.querySelector('input');
  info = el.querySelector('.sv-sync-info');
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === 'close') setStreetView(false);
    if (act === 'go' && panoAt && hooks) hooks.teleport(panoAt.x, panoAt.z, '街景位置');
  });
  // Keys typed while the panel has focus (arrow keys move the panorama) stay out of the game.
  el.addEventListener('keydown', (e) => e.stopPropagation());
  // Dragging the panorama by hand pauses following until it is ticked again.
  el.querySelector('.sv-sync-pano')?.addEventListener('pointerdown', () => {
    if (follow) follow.checked = false;
  });
  follow?.addEventListener('change', () => {
    lastPov = { heading: NaN, pitch: NaN };
  });
  return el;
}

function setInfo(text: string): void {
  if (info) info.textContent = text;
}

async function query(x: number, z: number): Promise<void> {
  if (!hooks || !maps || !root) return;
  busy = true;
  askedAt = { x, z };
  askedTime = performance.now();
  try {
    const service = new maps.StreetViewService();
    const location = toLatLng(hooks.origin, x, z);
    const find = (sources: string[]): Promise<{ data: PanoData } | null> =>
      service.getPanorama({ location, radius: 50, preference: maps!.StreetViewPreference.NEAREST, sources }).catch(() => null);
    const found = (await find([maps.StreetViewSource.GOOGLE])) ?? (await find([maps.StreetViewSource.OUTDOOR]));
    const id = found?.data.location?.pano, at = found?.data.location?.latLng;
    if (!on) return;
    if (!id || !at) {
      panoAt = null;
      setInfo('這附近 50 m 內沒有街景');
      return;
    }
    if (id !== panoId) {
      panoId = id;
      panoAt = toLocal(hooks.origin, at.lat(), at.lng());
      panoDate = found.data.imageDate ?? '';
      const el = root.querySelector<HTMLElement>('.sv-sync-pano')!;
      pano ??= new maps.StreetViewPanorama(el, {
        addressControl: false, fullscreenControl: false, motionTracking: false, showRoadLabels: false, linksControl: true,
      });
      pano.setPano(id);
      pano.setVisible(true);
      lastPov = { heading: NaN, pitch: NaN };
    }
  } finally {
    busy = false;
  }
}

/** Main loop: the character's position and the game camera's compass heading / pitch (degrees). */
export function updateStreetView(x: number, z: number, heading: number, pitch: number): void {
  if (!on || !maps) return;
  player = { x, z };
  const now = performance.now();
  if (!busy && now - askedTime > REQUERY_MS && (!askedAt || Math.hypot(x - askedAt.x, z - askedAt.z) > REQUERY_M)) void query(x, z);
  if (pano && follow?.checked && !(Math.abs(heading - lastPov.heading) <= 0.5 && Math.abs(pitch - lastPov.pitch) <= 0.5)) {
    lastPov = { heading, pitch };
    pano.setPov({ heading: (heading + 360) % 360, pitch });
  }
  if (panoAt && now - infoTime > 400) {
    infoTime = now;
    const d = Math.hypot(panoAt.x - player.x, panoAt.z - player.z);
    setInfo(`街景點距離你 ${d.toFixed(0)} m（遊戲座標 ${panoAt.x.toFixed(1)}, ${panoAt.z.toFixed(1)}）${panoDate ? `・拍攝 ${panoDate}` : ''}`);
  }
}

export function bindStreetView(h: Hooks): void {
  hooks = h;
}

export const streetViewOn = (): boolean => on;

/** Opens / closes the panel; returns a message for the chat log. */
export function setStreetView(v: boolean): { ok: boolean; message: string } {
  if (!import.meta.env.DEV) return { ok: false, message: '街景比對只在開發模式（npm run dev）可用' };
  if (!KEY) return { ok: false, message: '沒有 Maps 金鑰：在 .env.local 加上 VITE_GOOGLE_MAPS_KEY 後重新啟動 npm run dev' };
  if (!hooks) return { ok: false, message: '遊戲還沒載入完成' };
  on = v;
  if (!v) {
    root?.remove();
    return { ok: true, message: '街景比對：關閉' };
  }
  if (!root) root = buildPanel();
  document.body.append(root);
  askedAt = null;
  askedTime = 0;
  loadMaps(KEY).then((m) => {
    maps = m;
  }, (err: unknown) => {
    setInfo(`無法載入 Google Maps：${String(err)}`);
  });
  return { ok: true, message: '街景比對：開啟（右下角跟著你的位置與視角；拖曳全景會暫停跟隨）' };
}
