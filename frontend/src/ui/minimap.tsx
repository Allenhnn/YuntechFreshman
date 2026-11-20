import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CampusData, Ring } from '../campus/campusTypes';
import { telemetry } from '../state/telemetry';
import { actions, gameStore, useGame } from '../state/store';
import { gateSpot } from '../campus/mainGate';
import { outsideRing } from '../game/teleport';
import { UNLABELLED_NAMES } from '../campus/placeNames';
import { useApi } from './api';
import { storyStore } from '../state/story';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Base map resolution: world metres → base-canvas pixels. */
const PX_PER_M = 1.5;
/** World radius (m) visible in the circular minimap. */
const MINI_VIEW_RADIUS = 90;
const FRAME_INTERVAL = 1000 / 30;
const MARGIN = 60;

interface BaseMap {
  canvas: HTMLCanvasElement;
  /** World → base-canvas pixel. */
  toPx(x: number, z: number): [number, number];
}

const ROAD_STYLE: Readonly<Record<string, string>> = {
  major: '#f4f1ea',
  minor: '#f4f1ea',
  service: '#ece6da',
  walkway: '#d9a58f',
};

function ringPath(g: CanvasRenderingContext2D, r: Ring, toPx: BaseMap['toPx']): void {
  for (let i = 0; i < r.length; i += 2) {
    const [x, y] = toPx(r[i]!, r[i + 1]!);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** Draws the static campus layout once; minimap and full map both blit from it. */
function renderBaseMap(data: CampusData): BaseMap {
  const { minX, minZ, maxX, maxZ } = data.bounds;
  const ox = minX - MARGIN, oz = minZ - MARGIN;
  const toPx = (x: number, z: number): [number, number] => [(x - ox) * PX_PER_M, (z - oz) * PX_PER_M];
  const c = document.createElement('canvas');
  c.width = Math.ceil((maxX - minX + MARGIN * 2) * PX_PER_M);
  c.height = Math.ceil((maxZ - minZ + MARGIN * 2) * PX_PER_M);
  const g = c.getContext('2d');
  if (!g) return { canvas: c, toPx };

  g.fillStyle = '#b9c9a8';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#9fc584';
  g.beginPath();
  ringPath(g, data.boundary, toPx);
  g.fill();

  const fieldColors = { soccer: '#6faa55', court: '#4f8f84', track: '#c0664c', park: '#8fbf6e' } as const;
  for (const f of data.fields) {
    g.fillStyle = fieldColors[f.kind];
    g.beginPath();
    ringPath(g, f.outer, toPx);
    g.fill();
  }

  for (const lot of data.parking ?? []) {
    g.fillStyle = '#b4b2ab';
    g.beginPath();
    ringPath(g, lot.ring, toPx);
    g.fill();
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const kind of ['walkway', 'service', 'minor', 'major'] as const) {
    g.strokeStyle = ROAD_STYLE[kind] ?? '#fff';
    for (const r of data.roads) {
      if (r.kind !== kind) continue;
      g.lineWidth = Math.max(1.5, r.width * PX_PER_M);
      g.beginPath();
      for (let i = 0; i < r.points.length; i += 2) {
        const [x, y] = toPx(r.points[i]!, r.points[i + 1]!);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  for (const b of data.buildings) {
    if (!b.inCampus) continue; // off-campus buildings are not built
    g.fillStyle = b.inCampus ? '#d9c4a3' : '#cfcac2';
    g.strokeStyle = b.inCampus ? '#9b6a4f' : '#a19c94';
    g.lineWidth = 1.5;
    g.beginPath();
    ringPath(g, b.outer, toPx);
    for (const h of b.holes) ringPath(g, h, toPx);
    g.fill('evenodd');
    g.stroke();
  }

  g.strokeStyle = 'rgba(31, 143, 74, 0.8)';
  g.lineWidth = 3;
  g.setLineDash([10, 6]);
  g.beginPath();
  ringPath(g, data.boundary, toPx);
  g.stroke();
  g.setLineDash([]);
  return { canvas: c, toPx };
}

function useBaseMap(): BaseMap | null {
  const data = useGame((s) => s.mapData);
  const ref = useRef<BaseMap | null>(null);
  if (data && !ref.current) ref.current = renderBaseMap(data);
  return ref.current;
}

/** Player arrow pointing along `angle` (0 = up on screen, clockwise positive). */
function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, cone: number | null): void {
  if (cone !== null) {
    g.save();
    g.translate(x, y);
    g.rotate(cone);
    const fov = 0.6;
    const len = size * 5;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, len);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, len, -Math.PI / 2 - fov, -Math.PI / 2 + fov);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = '#f08a24';
  g.strokeStyle = '#fff';
  g.lineWidth = size * 0.28;
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.75, size * 0.8);
  g.lineTo(0, size * 0.35);
  g.lineTo(-size * 0.75, size * 0.8);
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
}

/** Runs `draw` at ~30 fps on a DPR-scaled canvas, reading telemetry (no React renders). */
function useCanvasLoop(draw: (g: CanvasRenderingContext2D, width: number, height: number) => void): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_INTERVAL) return;
      last = now;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      drawRef.current(g, width, height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return ref;
}

export function Minimap(): ReactNode {
  const base = useBaseMap();
  const canvasRef = useCanvasLoop((g, size) => {
    if (!base) return;
    const r = size / 2;
    const yaw = telemetry.cameraYaw;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#b9c9a8';
    g.fillRect(0, 0, size, size);
    // Heading-up: rotate the world so the camera's forward points to the top.
    g.translate(r, r);
    g.rotate(yaw);
    const scale = r / (MINI_VIEW_RADIUS * PX_PER_M);
    g.scale(scale, scale);
    const [px, py] = base.toPx(telemetry.x, telemetry.z);
    g.drawImage(base.canvas, -px, -py);
    const nav = gameStore.getState().nav;
    if (nav) {
      const pts = nav.path.map((v, i) => (i % 2 === 0 ? base.toPx(v, nav.path[i + 1]!)[0] - px : base.toPx(nav.path[i - 1]!, v)[1] - py));
      strokeRoute(g, pts, 1 / scale, size / 180);
      const [gx, gy] = base.toPx(nav.x, nav.z);
      g.fillStyle = '#2f6fd0';
      g.strokeStyle = '#fff';
      g.lineWidth = (2.5 * size) / 180 / scale;
      g.beginPath();
      g.arc(gx - px, gy - py, (6 * size) / 180 / scale, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();

    // Quest targets (main objective, side quests): pins, held on the rim when off the mini view.
    for (const pin of storyStore.getState().pins) {
      const [qx, qy] = base.toPx(pin.x, pin.z);
      const dx = (qx - px) * scale, dy = (qy - py) * scale;
      const rx = dx * Math.cos(yaw) - dy * Math.sin(yaw), ry = dx * Math.sin(yaw) + dy * Math.cos(yaw);
      const lim = r - size * 0.1, d = Math.hypot(rx, ry), k = d > lim ? lim / d : 1;
      drawPin(g, r + rx * k, r + ry * k + size * 0.05, size * (pin.main ? 0.06 : 0.045), hex(pin.color), pin.icon);
    }

    // Facing relative to the rotated map.
    const fx = Math.sin(telemetry.facing);
    const fz = Math.cos(telemetry.facing);
    const sx = fx * Math.cos(yaw) - fz * Math.sin(yaw);
    const sy = fx * Math.sin(yaw) + fz * Math.cos(yaw);
    drawPlayer(g, r, r, Math.atan2(sx, -sy), size * 0.055, 0);

    // North marker.
    const nx = r + Math.sin(yaw) * (r - size * 0.09);
    const ny = r - Math.cos(yaw) * (r - size * 0.09);
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.arc(nx, ny, size * 0.06, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(size * 0.07)}px 'Cubic 11', system-ui`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 1);
  });

  return (
    <div className="minimap-wrap">
      <canvas ref={canvasRef} aria-label="小地圖" />
      <kbd>M</kbd>
    </div>
  );
}

/** Buildings that stay in the world but get no name on the map. */
const UNLABELLED = UNLABELLED_NAMES;
/** Multi-block buildings that keep one label however far the map is zoomed in. */
const SINGLE_LABEL = new Set(['學生宿舍D']);
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
/** Pointer travel (CSS px) below which a press counts as a click rather than a pan. */
const CLICK_SLOP = 5;
/** Click distance (CSS px) that counts as hitting a pin. */
const PIN_HIT_PX = 16;
/** How far outside a building's wall a map teleport lands (m). */
const DOORSTEP_M = 2.5;
/** Zoom the full map opens at, centred on the player. */
const OPEN_ZOOM = 3.5;

interface MapView {
  zoom: number;
  /** World point at the canvas centre. */
  cx: number;
  cz: number;
}

/** A map destination; x/z is where the player lands. */
interface MapPlace {
  name: string;
  x: number;
  z: number;
  /** Search-result label: 建築 / 設施 / 腳踏車站. */
  kind: string;
  /** Footprint outline to highlight on hover (buildings). */
  ring?: Ring;
}

interface MapMenu {
  /** Position in the frame (CSS px) and the world point it refers to. */
  left: number;
  top: number;
  x: number;
  z: number;
  /** The building or facility under the click, if any. */
  place: MapPlace | null;
  /** The click hit the custom respawn pin. */
  onCustomSpawn: boolean;
}

function centroidOf(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

/** Where a scooter park's teleport / navigation lands: the clear strip along its first short side. */
function lotCentre(r: Ring): { x: number; z: number } {
  const mx = (r[0]! + r[6]!) / 2, mz = (r[1]! + r[7]!) / 2;
  const dx = r[2]! - r[0]!, dz = r[3]! - r[1]!, len = Math.hypot(dx, dz) || 1;
  return { x: mx + (dx / len) * 0.5, z: mz + (dz / len) * 0.5 };
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Route polyline (flat x, y in the current transform): white casing under a blue line. */
function strokeRoute(g: CanvasRenderingContext2D, pts: readonly number[], unit: number, s: number): void {
  if (pts.length < 4) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9 * s * unit;
  g.stroke();
  g.strokeStyle = '#2f6fd0';
  g.lineWidth = 5 * s * unit;
  g.stroke();
  g.restore();
}

function drawPin(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, glyph: string): void {
  g.fillStyle = color;
  g.strokeStyle = '#fff';
  g.lineWidth = s * 0.18;
  g.beginPath();
  g.arc(x, y - s * 1.2, s * 0.8, Math.PI * 0.8, Math.PI * 0.2);
  g.lineTo(x, y);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(s * 0.9)}px 'Cubic 11', system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, x, y - s * 1.2);
}

export function FullMap(): ReactNode {
  const api = useApi();
  const base = useBaseMap();
  const data = useGame((st) => st.mapData);
  const raceStart = useGame((st) => st.raceStart);
  const customSpawn = useGame((st) => st.customSpawn);
  const bikeStations = useGame((st) => st.bikeStations);
  const nav = useGame((st) => st.nav);
  const view = useRef<MapView | null>(null);
  /** Where the view is gliding to (search result, fit route); manual pan / zoom cancels it. */
  const glide = useRef<MapView | null>(null);
  const hover = useRef<{ place: MapPlace; sx: number; sy: number } | null>(null);
  const [menu, setMenu] = useState<MapMenu | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sel, setSel] = useState(0);

  // Every searchable place: one entry per building name (its largest block), facilities, bike stations.
  const places = useMemo((): MapPlace[] => {
    if (!data) return [];
    const byName = new Map<string, { b: (typeof data.buildings)[number]; area: number }>();
    for (const b of data.buildings) {
      if (!b.name || !b.inCampus || UNLABELLED.has(b.name)) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < b.outer.length; i += 2) {
        x0 = Math.min(x0, b.outer[i]!); x1 = Math.max(x1, b.outer[i]!);
        z0 = Math.min(z0, b.outer[i + 1]!); z1 = Math.max(z1, b.outer[i + 1]!);
      }
      const area = (x1 - x0) * (z1 - z0);
      if ((byName.get(b.name)?.area ?? -1) < area) byName.set(b.name, { b, area });
    }
    const out: MapPlace[] = [...byName.values()].map(({ b }) => {
      const [cx, cz] = centroidOf(b.outer);
      return { name: b.name!, kind: '建築', ring: b.outer, ...outsideRing(b.outer, cx, cz, DOORSTEP_M) };
    });
    if (raceStart) out.push({ name: '操場（跑道計時賽）', kind: '設施', ...raceStart });
    for (const lot of data.parking ?? []) out.push({ name: lot.name, kind: '停車場', ring: lot.ring, ...lotCentre(lot.ring) });
    out.push({ name: '大門', kind: '設施', ...gateSpot() });
    for (const st of bikeStations) out.push({ name: st.name, kind: '腳踏車站', x: st.x, z: st.z });
    return out;
  }, [data, raceStart, bikeStations]);
  const results = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    if (!q) return [];
    return places
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({ p, d: Math.hypot(p.x - telemetry.x, p.z - telemetry.z) }))
      .sort((a, b) => Number(!a.p.name.startsWith(query.trim())) - Number(!b.p.name.startsWith(query.trim())) || a.d - b.d)
      .slice(0, 8);
  }, [query, places]);

  // Map metres → canvas pixels for the current view (canvas is w × h device px).
  const project = (w: number, h: number): ((x: number, z: number) => [number, number]) | null => {
    if (!base || !data) return null;
    // Opens centred on the player, zoomed in enough to read the buildings around.
    const v = (view.current ??= { zoom: OPEN_ZOOM, cx: telemetry.x, cz: telemetry.z });
    const k = Math.min(w / base.canvas.width, h / base.canvas.height) * v.zoom;
    const [ox, oy] = base.toPx(v.cx, v.cz);
    return (x, z) => {
      const [bx, by] = base.toPx(x, z);
      return [(bx - ox) * k + w / 2, (by - oy) * k + h / 2];
    };
  };

  const canvasRef = useCanvasLoop((g, w, h) => {
    const screen = project(w, h);
    const v = view.current;
    if (!base || !data || !screen || !v) return;
    const t = glide.current;
    if (t) {
      v.cx += (t.cx - v.cx) * 0.2;
      v.cz += (t.cz - v.cz) * 0.2;
      v.zoom += (t.zoom - v.zoom) * 0.2;
      if (Math.hypot(t.cx - v.cx, t.cz - v.cz) < 0.3 && Math.abs(t.zoom - v.zoom) < 0.01) glide.current = null;
    }
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#b9c9a8';
    g.fillRect(0, 0, w, h);
    // Blit the base map through the same transform.
    const k = Math.min(w / base.canvas.width, h / base.canvas.height) * v.zoom;
    const [ox, oy] = base.toPx(v.cx, v.cz);
    g.drawImage(base.canvas, w / 2 - ox * k, h / 2 - oy * k, base.canvas.width * k, base.canvas.height * k);

    const dpr = w / (g.canvas.clientWidth || w);
    // Building labels (campus only); more appear as you zoom in.
    g.font = `600 ${Math.round(12 * dpr)}px 'Cubic 11', system-ui, 'PingFang TC', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const seen = new Set<string>();
    const placed: [number, number, number][] = [];
    for (const b of data.buildings) {
      if (!b.name || !b.inCampus || UNLABELLED.has(b.name)) continue;
      if ((v.zoom < 2.5 || SINGLE_LABEL.has(b.name)) && seen.has(b.name)) continue; // one label per name when zoomed out
      seen.add(b.name);
      const [x, y] = screen(...centroidOf(b.outer));
      if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
      // Labels that would overlap one already drawn wait until the map is zoomed in.
      const halfW = g.measureText(b.name).width / 2 + 3 * dpr, halfH = 8 * dpr;
      if (placed.some((p) => Math.abs(p[0] - x) < p[2] + halfW && Math.abs(p[1] - y) < halfH * 2)) continue;
      placed.push([x, y, halfW]);
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(b.name, x, y);
      g.fillStyle = '#3b2a20';
      g.fillText(b.name, x, y);
    }

    for (const st of bikeStations) drawPin(g, ...screen(st.x, st.z), 9 * dpr, '#0f8a8a', '車');

    if (raceStart) drawPin(g, ...screen(raceStart.x, raceStart.z), 10 * dpr, '#c0562b', '跑');

    const sp = customSpawn ?? data.spawn;
    drawPin(g, ...screen(sp.x, sp.z), 11 * dpr, '#1f8f4a', '⌂');
    // Route and goal.
    const route = gameStore.getState().nav;
    if (route) {
      const pts: number[] = [];
      for (let i = 0; i < route.path.length; i += 2) pts.push(...screen(route.path[i]!, route.path[i + 1]!));
      strokeRoute(g, pts, dpr, 1);
      drawPin(g, ...screen(route.x, route.z), 12 * dpr, '#2f6fd0', '🏁');
    }
    for (const pin of storyStore.getState().pins) drawPin(g, ...screen(pin.x, pin.z), (pin.main ? 13 : 10) * dpr, hex(pin.color), pin.icon);

    // Hovered place: outline (or ring round the pin) and a name tag by the cursor.
    const hv = hover.current;
    if (hv) {
      g.save();
      g.strokeStyle = '#f08a24';
      g.fillStyle = 'rgba(240, 138, 36, 0.18)';
      g.lineWidth = 3 * dpr;
      g.lineJoin = 'round';
      g.beginPath();
      if (hv.place.ring) {
        const r = hv.place.ring;
        for (let i = 0; i < r.length; i += 2) {
          const [x, y] = screen(r[i]!, r[i + 1]!);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
      } else {
        const [x, y] = screen(hv.place.x, hv.place.z);
        g.arc(x, y - 11 * dpr, 15 * dpr, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
      g.font = `700 ${Math.round(13 * dpr)}px 'Cubic 11', system-ui, 'PingFang TC', sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const label = hv.place.name;
      const tw = g.measureText(label).width + 16 * dpr, th = 24 * dpr;
      const tx = Math.min(hv.sx + 14 * dpr, w - tw - 4 * dpr), ty = Math.max(th / 2 + 4 * dpr, hv.sy - 18 * dpr);
      g.fillStyle = 'rgba(30, 40, 34, 0.88)';
      g.beginPath();
      g.roundRect(tx, ty - th / 2, tw, th, 7 * dpr);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(label, tx + 8 * dpr, ty + 1);
      g.restore();
    }

    if (menu) {
      drawPin(g, ...screen(menu.x, menu.z), 10 * dpr, '#f08a24', '•');
    }

    const [sx, sy] = screen(telemetry.x, telemetry.z);
    drawPlayer(g, sx, sy, Math.atan2(Math.sin(telemetry.facing), -Math.cos(telemetry.facing)), 11 * dpr, -telemetry.cameraYaw);
  });

  /** Event position → canvas device px and world metres. */
  const locate = (e: { clientX: number; clientY: number }): { x: number; z: number } | null => {
    const c = canvasRef.current;
    const v = view.current;
    if (!c || !base || !v) return null;
    const r = c.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.width, py = ((e.clientY - r.top) / r.height) * c.height;
    const k = Math.min(c.width / base.canvas.width, c.height / base.canvas.height) * v.zoom;
    // Inverse of project(): base px = (screen - size/2) / k + toPx(centre); 1 base px = 1 / PX_PER_M m.
    return { x: v.cx + (px - c.width / 2) / k / PX_PER_M, z: v.cz + (py - c.height / 2) / k / PX_PER_M };
  };

  /** Metres covered by one CSS pixel at the current zoom. */
  const metresPerCssPx = (c: HTMLCanvasElement): number =>
    1 / (Math.min(c.width / base!.canvas.width, c.height / base!.canvas.height) * view.current!.zoom * (c.getBoundingClientRect().width / c.width) * PX_PER_M);

  /** The facility or named building at a world point. Pins are hit-tested in screen space. */
  const placeAt = (x: number, z: number, reach: number): MapPlace | null => {
    if (!data) return null;
    const station = bikeStations.find((s) => Math.hypot(s.x - x, s.z - z) < reach);
    if (station) return { name: station.name, kind: '腳踏車站', x: station.x, z: station.z };
    const raceName = '操場（跑道計時賽）';
    if (raceStart && Math.hypot(raceStart.x - x, raceStart.z - z) < reach) return { name: raceName, kind: '設施', ...raceStart };
    for (const b of data.buildings) {
      if (!b.name || !b.inCampus || UNLABELLED.has(b.name) || !pointInRing(x, z, b.outer)) continue;
      const [cx, cz] = centroidOf(b.outer);
      return { name: b.name, kind: '建築', ring: b.outer, ...outsideRing(b.outer, cx, cz, DOORSTEP_M) };
    }
    const lot = data.parking?.find((l) => pointInRing(x, z, l.ring));
    if (lot) return { name: lot.name, kind: '停車場', ring: lot.ring, ...lotCentre(lot.ring) };
    const field = raceStart ? data.fields.find((f) => f.kind === 'soccer' && pointInRing(x, z, f.outer)) : undefined;
    if (raceStart && field) return { name: raceName, kind: '設施', ring: field.outer, ...raceStart };
    return null;
  };

  const onCustomSpawnPin = (x: number, z: number, reach: number): boolean =>
    !!customSpawn && Math.hypot(customSpawn.x - x, customSpawn.z - z) < reach;

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    const v = view.current;
    const at = locate(e);
    if (!v || !at) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0018)));
    // Keep the world point under the cursor fixed.
    const f = v.zoom / zoom;
    v.cx = at.x - (at.x - v.cx) * f;
    v.cz = at.z - (at.z - v.cz) * f;
    v.zoom = zoom;
    glide.current = null;
    setMenu(null);
  };

  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current, v = view.current, c = canvasRef.current;
    if (!d && c && base && v) {
      const at = locate(e);
      const reach = PIN_HIT_PX * metresPerCssPx(c);
      const place = at ? placeAt(at.x, at.z, reach) : null;
      const r = c.getBoundingClientRect();
      hover.current = place ? { place, sx: ((e.clientX - r.left) / r.width) * c.width, sy: ((e.clientY - r.top) / r.height) * c.height } : null;
      c.style.cursor = place || (at && onCustomSpawnPin(at.x, at.z, reach)) ? 'pointer' : '';
    }
    if (!d || !v || !c || !base) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.hypot(dx, dy);
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.moved < CLICK_SLOP) return;
    const r = c.getBoundingClientRect();
    const k = Math.min(c.width / base.canvas.width, c.height / base.canvas.height) * v.zoom * (r.width / c.width);
    v.cx -= dx / k / PX_PER_M;
    v.cz -= dy / k / PX_PER_M;
    glide.current = null;
    hover.current = null;
    setMenu(null);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved >= CLICK_SLOP) return;
    const at = locate(e);
    const frame = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!at || !frame) return;
    const reach = PIN_HIT_PX * metresPerCssPx(e.currentTarget);
    const place = placeAt(at.x, at.z, reach);
    const onCustomSpawn = onCustomSpawnPin(at.x, at.z, reach);
    if (!place && !onCustomSpawn) {
      setMenu(null); // empty ground: only named places open a menu
      return;
    }
    // Beside the click, kept inside the map so it never gets cut off.
    const left = Math.min(e.clientX - frame.left + 12, frame.width - 192);
    const top = Math.max(8, Math.min(e.clientY - frame.top - 90, frame.height - 208));
    setMenu({ left, top, x: at.x, z: at.z, place, onCustomSpawn });
  };

  const centreOnMe = (): void => {
    const v = view.current;
    if (!v) return;
    glide.current = { cx: telemetry.x, cz: telemetry.z, zoom: Math.max(v.zoom, OPEN_ZOOM) };
  };
  const zoomBy = (f: number): void => {
    const v = view.current;
    if (!v) return;
    glide.current = { cx: glide.current?.cx ?? v.cx, cz: glide.current?.cz ?? v.cz, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (glide.current?.zoom ?? v.zoom) * f)) };
    setMenu(null);
  };
  /** Zoom so the whole route (and the player) fits the view. */
  const fitRoute = (): void => {
    const c = canvasRef.current;
    if (!nav || !c || !base) return;
    let x0 = telemetry.x, x1 = telemetry.x, z0 = telemetry.z, z1 = telemetry.z;
    for (let i = 0; i < nav.path.length; i += 2) {
      x0 = Math.min(x0, nav.path[i]!); x1 = Math.max(x1, nav.path[i]!);
      z0 = Math.min(z0, nav.path[i + 1]!); z1 = Math.max(z1, nav.path[i + 1]!);
    }
    const fit = Math.min(c.width / ((x1 - x0 + 40) * PX_PER_M), c.height / ((z1 - z0 + 40) * PX_PER_M));
    const zoom = fit / Math.min(c.width / base.canvas.width, c.height / base.canvas.height);
    glide.current = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) };
    setMenu(null);
  };
  /** Search result chosen: glide there and open its menu at the centre of the map. */
  const choose = (p: MapPlace): void => {
    const c = canvasRef.current;
    const v = view.current;
    if (!c || !v) return;
    glide.current = { cx: p.x, cz: p.z, zoom: Math.max(v.zoom, 6) };
    const r = c.getBoundingClientRect();
    setMenu({ left: Math.min(r.width / 2 + 12, r.width - 192), top: Math.max(8, r.height / 2 - 90), x: p.x, z: p.z, place: p, onCustomSpawn: false });
    setQuery('');
    setSearchOpen(false);
    c.focus();
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const v = view.current;
    const at = locate(e);
    if (!v || !at) return;
    const zoom = Math.min(MAX_ZOOM, v.zoom * 2);
    const f = v.zoom / zoom;
    glide.current = { cx: at.x - (at.x - v.cx) * f, cz: at.z - (at.z - v.cz) * f, zoom };
    setMenu(null);
  };

  // Keyboard while the map is open (not while typing): +/- zoom, arrows pan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      const c = canvasRef.current, v = view.current;
      if (!c || !v || !base) return;
      const step = 80 * metresPerCssPx(c);
      const pan = (dx: number, dz: number): void => {
        e.preventDefault();
        const t = glide.current ?? { ...v };
        glide.current = { ...t, cx: t.cx + dx * step, cz: t.cz + dz * step };
        setMenu(null);
      };
      switch (e.code) {
        case 'Equal': case 'NumpadAdd': zoomBy(1.5); break;
        case 'Minus': case 'NumpadSubtract': zoomBy(1 / 1.5); break;
        case 'ArrowLeft': pan(-1, 0); break;
        case 'ArrowRight': pan(1, 0); break;
        case 'ArrowUp': pan(0, -1); break;
        case 'ArrowDown': pan(0, 1); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fullmap interactive">
      <div className="frame">
        <header className="map-head">
          <h2>校園地圖</h2>
          <div className="map-search">
            <input
              type="search"
              placeholder="🔍 搜尋建築或設施…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSel(0); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                e.stopPropagation(); // typed letters are not game hotkeys
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                else if (e.key === 'Enter' && results[sel]) choose(results[sel].p);
                else if (e.key === 'Escape') { if (query) setQuery(''); else e.currentTarget.blur(); }
              }}
            />
            {searchOpen && query && (
              <ul className="map-results">
                {results.length === 0 && <li className="empty">找不到「{query}」</li>}
                {results.map(({ p, d }, i) => (
                  <li key={`${p.kind}:${p.name}`} className={i === sel ? 'sel' : ''} onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setSel(i)}>
                    <span className="name">{p.name}</span>
                    <span className="kind">{p.kind}</span>
                    <span className="dist">{d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="map-legend">
            <span><i style={{ background: '#1f8f4a' }} />重生點</span>
            <span><i style={{ background: '#0f8a8a' }} />腳踏車站</span>
            <span><i style={{ background: '#c0562b' }} />計時賽起點</span>
            {nav && <span><i style={{ background: '#2f6fd0' }} />導航路線</span>}
            <span><i style={{ background: '#f08a24' }} />主線目標</span>
            <span><i style={{ background: '#1f8f4a' }} />支線目標</span>
          </div>
          <span className="map-keys"><kbd>＋</kbd><kbd>－</kbd> 縮放　<kbd>←↑→↓</kbd> 移動　<kbd>M</kbd> 關閉</span>
        </header>
        <div className="map-body">
        <div className="map-area">
          <canvas
            ref={canvasRef}
            aria-label="校園地圖"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { hover.current = null; }}
            onDoubleClick={onDoubleClick}
            tabIndex={-1}
            onContextMenu={(e) => e.preventDefault()}
          />
          {menu && (
            <div className="map-menu" style={{ left: menu.left, top: menu.top }}>
              <div className="title">{menu.place?.name ?? '自訂重生點'}</div>
              {menu.place && (nav?.name === menu.place.name
                ? <button onClick={() => { api.stopNav(); setMenu(null); }}>✕ 結束導航</button>
                : <button className="primary" onClick={() => { const p = menu.place!; api.navigateTo(p.x, p.z, p.name); setMenu(null); }}>🧭 導航到這裡</button>)}
              {menu.place && <button onClick={() => { const p = menu.place!; api.teleportTo(p.x, p.z, p.name); setMenu(null); }}>🚀 傳送到這裡</button>}
              {menu.place && <button onClick={() => { const p = menu.place!; actions.setCustomSpawn({ x: p.x, z: p.z, facing: telemetry.facing }); actions.toast(`重生點已設在 ${p.name}`); setMenu(null); }}>⌂ 設為重生點</button>}
              {menu.onCustomSpawn && <button onClick={() => { actions.setCustomSpawn(null); setMenu(null); }}>↺ 恢復預設重生點</button>}
              <button className="ghost" onClick={() => setMenu(null)}>取消</button>
            </div>
          )}
          <div className="map-tools">
            <button title="放大（＋）" onClick={() => zoomBy(1.5)}>＋</button>
            <button title="縮小（－）" onClick={() => zoomBy(1 / 1.5)}>－</button>
            <button title="回到我的位置" onClick={centreOnMe}>◎</button>
            {nav && <button title="顯示導航全程" onClick={fitRoute}>🧭</button>}
          </div>
        </div>
        </div>
        <p className="map-credit">{data?.attribution}</p>
      </div>
    </div>
  );
}
