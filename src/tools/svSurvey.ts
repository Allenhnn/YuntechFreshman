import type { CampusData } from '../campus/campusTypes';
import { loadMaps } from './streetView';
import { followStreetView, tiltStreetView } from './streetViewSync';

/**
 * Dev-only console helpers for the Street View campus remodel (docs/campus-remodel.md), on
 * `window.__sv` once /streetview has been opened:
 *   await __sv.hits(id)      panoramas (Google car or people's 360° photos) facing each wall of building `id`
 *   await __sv.view(id, k)   stand on the k-th of those panoramas, facing that wall (the panel follows)
 *   __sv.tilt(pitch, turn)  look up / turn the panorama only
 *   __sv.big(true|false)     panel full screen / back to the corner;  __sv.hide(true|false)
 * Display only: nothing from the imagery is saved.
 */
const R = 6378137;
const KEY: string | undefined = import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAPS_KEY : undefined;

interface Hit { edge: number; src: 'google' | 'outdoor'; x: number; z: number; dist: number; date: string; wall: [number, number] }

export function installSurvey(campus: CampusData, game: { teleport(x: number, y: number, z: number): void; look(yaw: number): void }): void {
  if (!import.meta.env.DEV || !KEY) return;
  const o = campus.origin;
  const ll = (x: number, z: number): { lat: number; lng: number } => ({
    lat: o.lat - ((z / R) * 180) / Math.PI,
    lng: o.lon + ((x / (R * Math.cos((o.lat * Math.PI) / 180))) * 180) / Math.PI,
  });
  const local = (lat: number, lng: number): { x: number; z: number } => ({
    x: (((lng - o.lon) * Math.PI) / 180) * R * Math.cos((o.lat * Math.PI) / 180),
    z: -(((lat - o.lat) * Math.PI) / 180) * R,
  });
  const inside = (x: number, z: number, r: number[]): boolean => {
    let hit = false;
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  /** A point in front of each wall ≥ 8 m long, outside every building. */
  const spots = (id: number): { edge: number; x: number; z: number; mx: number; mz: number }[] => {
    const b = campus.buildings.find((q) => q.id === id);
    if (!b) return [];
    const r = b.outer, n = r.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += r[i * 2]! * r[j * 2 + 1]! - r[j * 2]! * r[i * 2 + 1]!; }
    const s = area > 0 ? 1 : -1, out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = r[i * 2]!, z0 = r[i * 2 + 1]!, x1 = r[j * 2]!, z1 = r[j * 2 + 1]!;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 8) continue;
      const nx = ((z1 - z0) / len) * s, nz = (-(x1 - x0) / len) * s, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      for (const d of [14, 22, 30]) {
        const x = mx + nx * d, z = mz + nz * d;
        if (campus.buildings.some((q) => inside(x, z, q.outer))) continue;
        out.push({ edge: i, x, z, mx, mz });
        break;
      }
    }
    return out;
  };
  const cache = new Map<number, Hit[]>();
  const hits = async (id: number): Promise<Hit[]> => {
    const known = cache.get(id);
    if (known) return known;
    const maps = await loadMaps(KEY);
    const svc = new maps.StreetViewService();
    const out: Hit[] = [];
    for (const s of spots(id)) {
      for (const src of [maps.StreetViewSource.GOOGLE, maps.StreetViewSource.OUTDOOR]) {
        const d = await svc.getPanorama({ location: ll(s.x, s.z), radius: 35, preference: maps.StreetViewPreference.NEAREST, sources: [src] })
          .then((r) => r.data).catch(() => null);
        const at = d?.location?.latLng;
        if (!at) continue;
        const p = local(at.lat(), at.lng());
        out.push({ edge: s.edge, src: src === maps.StreetViewSource.GOOGLE ? 'google' : 'outdoor', x: +p.x.toFixed(1), z: +p.z.toFixed(1), dist: Math.round(Math.hypot(p.x - s.mx, p.z - s.mz)), date: d?.imageDate ?? '', wall: [s.mx, s.mz] });
        break;
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    cache.set(id, out);
    return out;
  };
  const panel = (): HTMLElement | null => document.querySelector('.sv-sync');
  const style = document.createElement('style');
  style.textContent = '.sv-sync.big{left:0!important;top:0!important;right:0!important;bottom:0!important;width:auto!important;height:auto!important;border-radius:0!important}';
  document.head.append(style);
  /** Nearest Google car and people's 360° panoramas around campus point (x, z): position, distance, date. */
  const near = async (x: number, z: number, radius = 25): Promise<Record<string, { x: number; z: number; dist: number; date: string; heading: number } | null>> => {
    const maps = await loadMaps(KEY);
    const svc = new maps.StreetViewService();
    const out: Record<string, { x: number; z: number; dist: number; date: string; heading: number } | null> = {};
    for (const [name, src] of [['google', maps.StreetViewSource.GOOGLE], ['outdoor', maps.StreetViewSource.OUTDOOR]] as const) {
      const d = await svc.getPanorama({ location: ll(x, z), radius, preference: maps.StreetViewPreference.NEAREST, sources: [src] })
        .then((r) => r.data).catch(() => null);
      const at = d?.location?.latLng;
      if (!at) { out[name] = null; continue; }
      const p = local(at.lat(), at.lng());
      out[name] = { x: +p.x.toFixed(1), z: +p.z.toFixed(1), dist: Math.round(Math.hypot(p.x - x, p.z - z)), date: d?.imageDate ?? '', heading: 0 };
    }
    return out;
  };
  /** Stand on the panorama nearest (x, z) and face (tx, tz); the panel follows. */
  const stand = async (x: number, z: number, tx: number, tz: number, src: 'google' | 'outdoor' = 'google'): Promise<unknown> => {
    const h = (await near(x, z, 40))[src];
    if (!h) return 'no panorama';
    followStreetView();
    game.teleport(h.x, 0.3, h.z);
    game.look(Math.atan2(-(tx - h.x), -(tz - h.z)));
    await new Promise((r) => setTimeout(r, 3000));
    return h;
  };
  (window as unknown as { __sv: unknown }).__sv = {
    spots,
    hits,
    near,
    stand,
    async view(id: number, k = 0) {
      const h = (await hits(id))[k];
      if (!h) return 'no panorama';
      followStreetView();
      game.teleport(h.x, 0.3, h.z);
      game.look(Math.atan2(-(h.wall[0] - h.x), -(h.wall[1] - h.z)));
      await new Promise((r) => setTimeout(r, 3000));
      return h;
    },
    /** Look up (degrees) and / or turn the panorama without moving the game camera. */
    tilt(pitch: number, turn = 0) {
      tiltStreetView(pitch, turn);
    },
    big(v: boolean) {
      panel()?.classList.toggle('big', v);
      window.dispatchEvent(new Event('resize'));
    },
    hide(v: boolean) {
      const p = panel();
      if (p) p.style.visibility = v ? 'hidden' : '';
    },
  };
}
