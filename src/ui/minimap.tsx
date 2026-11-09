import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CampusData, Ring } from '../campus/campusTypes';
import { telemetry } from '../state/telemetry';
import { actions, useGame } from '../state/store';
import { useApi } from './api';

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
    g.restore();

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
    g.font = `bold ${Math.round(size * 0.07)}px system-ui`;
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 14;
/** Pointer travel (CSS px) below which a press counts as a click rather than a pan. */
const CLICK_SLOP = 5;

interface MapView {
  zoom: number;
  /** World point at the canvas centre. */
  cx: number;
  cz: number;
}

interface MapMenu {
  /** Position in the frame (CSS px) and the world point it refers to. */
  left: number;
  top: number;
  x: number;
  z: number;
}

function centroidOf(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

/** Nearest named building within `radius` m, for naming a clicked spot. */
function placeName(data: CampusData, x: number, z: number, radius = 40): string | null {
  let best: string | null = null;
  let bestD = radius;
  for (const b of data.buildings) {
    if (!b.name) continue;
    const [cx, cz] = centroidOf(b.outer);
    const d = Math.hypot(cx - x, cz - z);
    if (d < bestD) { bestD = d; best = b.name; }
  }
  return best;
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
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
  g.font = `bold ${Math.round(s * 0.9)}px system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, x, y - s * 1.2);
}

export function FullMap(): ReactNode {
  const api = useApi();
  const base = useBaseMap();
  const data = useGame((st) => st.mapData);
  const waypoints = useGame((st) => st.waypoints);
  const customSpawn = useGame((st) => st.customSpawn);
  const bikeStations = useGame((st) => st.bikeStations);
  const view = useRef<MapView | null>(null);
  const [menu, setMenu] = useState<MapMenu | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  // Map metres → canvas pixels for the current view (canvas is w × h device px).
  const project = (w: number, h: number): ((x: number, z: number) => [number, number]) | null => {
    if (!base || !data) return null;
    const v = (view.current ??= { zoom: 1, cx: (data.bounds.minX + data.bounds.maxX) / 2, cz: (data.bounds.minZ + data.bounds.maxZ) / 2 });
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
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#b9c9a8';
    g.fillRect(0, 0, w, h);
    // Blit the base map through the same transform.
    const k = Math.min(w / base.canvas.width, h / base.canvas.height) * v.zoom;
    const [ox, oy] = base.toPx(v.cx, v.cz);
    g.drawImage(base.canvas, w / 2 - ox * k, h / 2 - oy * k, base.canvas.width * k, base.canvas.height * k);

    const dpr = w / (g.canvas.clientWidth || w);
    // Building labels (campus only); more appear as you zoom in.
    g.font = `600 ${Math.round(12 * dpr)}px system-ui, 'PingFang TC', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const seen = new Set<string>();
    const placed: [number, number, number][] = [];
    for (const b of data.buildings) {
      if (!b.name || !b.inCampus) continue;
      if (v.zoom < 2.5 && seen.has(b.name)) continue; // one label per name when zoomed out
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

    // Respawn point and saved waypoints.
    const sp = customSpawn ?? data.spawn;
    drawPin(g, ...screen(sp.x, sp.z), 11 * dpr, '#1f8f4a', '⌂');
    for (const w of waypoints) {
      const [x, y] = screen(w.x, w.z);
      drawPin(g, x, y, 10 * dpr, '#2f6fd0', '★');
      g.font = `700 ${Math.round(11 * dpr)}px system-ui, 'PingFang TC', sans-serif`;
      g.lineWidth = 3 * dpr;
      g.strokeStyle = '#fff';
      g.strokeText(w.name, x, y + 9 * dpr);
      g.fillStyle = '#1d3a6b';
      g.fillText(w.name, x, y + 9 * dpr);
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
    setMenu(null);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved >= CLICK_SLOP) return;
    const at = locate(e);
    const frame = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!at || !frame) return;
    // Beside the click, kept inside the map so it never covers the side panel or gets cut off.
    const left = Math.min(e.clientX - frame.left + 12, frame.width - 192);
    const top = Math.max(8, Math.min(e.clientY - frame.top - 90, frame.height - 208));
    setMenu({ left, top, x: at.x, z: at.z });
  };

  const centreOnMe = (): void => {
    const v = view.current;
    if (!v) return;
    v.cx = telemetry.x;
    v.cz = telemetry.z;
    v.zoom = Math.max(v.zoom, 4);
  };

  const menuName = menu && data ? (placeName(data, menu.x, menu.z) ?? '自訂地點') : '';

  return (
    <div className="fullmap interactive">
      <div className="frame">
        <header className="map-head">
          <h2>校園地圖</h2>
          <p>滾輪縮放、拖曳移動，點選地點可傳送。</p>
          <span className="map-keys"><kbd>M</kbd> 關閉</span>
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
            onContextMenu={(e) => e.preventDefault()}
          />
          {menu && data && !pointInRing(menu.x, menu.z, data.boundary) && (
            <div className="map-menu" style={{ left: menu.left, top: menu.top }}>
              <div className="title">🚧 校外區域</div>
              <div className="note">校外禁止進入，無法傳送或設定傳送點。</div>
              <button className="ghost" onClick={() => setMenu(null)}>關閉</button>
            </div>
          )}
          {menu && data && pointInRing(menu.x, menu.z, data.boundary) && (
            <div className="map-menu" style={{ left: menu.left, top: menu.top }}>
              <div className="title">{menuName}</div>
              <button onClick={() => { api.teleportTo(menu.x, menu.z, menuName); setMenu(null); }}>🚀 傳送到這裡</button>
              <button onClick={() => { actions.addWaypoint(menuName, menu.x, menu.z); setMenu(null); }}>★ 設為傳送點</button>
              <button onClick={() => { actions.setCustomSpawn({ x: menu.x, z: menu.z, facing: telemetry.facing }); actions.toast(`重生點已設在 ${menuName}`); setMenu(null); }}>⌂ 設為重生點</button>
              <button className="ghost" onClick={() => setMenu(null)}>取消</button>
            </div>
          )}
          <div className="map-tools">
            <button title="放大" onClick={() => { if (view.current) view.current.zoom = Math.min(MAX_ZOOM, view.current.zoom * 1.5); }}>＋</button>
            <button title="縮小" onClick={() => { if (view.current) view.current.zoom = Math.max(MIN_ZOOM, view.current.zoom / 1.5); }}>－</button>
            <button title="回到我的位置" onClick={centreOnMe}>◎</button>
          </div>
        </div>
        <aside className="map-side">
          <h3>傳送點</h3>
          {waypoints.length === 0 && <p className="hint">尚未設定</p>}
          <ul>
            {waypoints.map((w) => (
              <li key={w.id}>
                {editing === w.id ? (
                  <input
                    autoFocus
                    defaultValue={w.name}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                    onBlur={(e) => { actions.renameWaypoint(w.id, e.currentTarget.value.trim() || w.name); setEditing(null); }}
                  />
                ) : (
                  <button className="wp" onClick={() => api.teleportTo(w.x, w.z, w.name)} title="傳送">★ {w.name}</button>
                )}
                <button className="icon" title="重新命名" onClick={() => setEditing(w.id)}>✎</button>
                <button className="icon" title="刪除" onClick={() => actions.removeWaypoint(w.id)}>✕</button>
              </li>
            ))}
          </ul>
          <h3>重生點</h3>
          <p className="hint">{customSpawn ? (data ? (placeName(data, customSpawn.x, customSpawn.z) ?? '自訂地點') : '') : (data?.spawn.label ?? '')}</p>
          {customSpawn && <button className="ghost" onClick={() => actions.setCustomSpawn(null)}>恢復預設</button>}
          <div className="map-legend">
            <span><i style={{ background: '#1f8f4a' }} />重生點</span>
            <span><i style={{ background: '#2f6fd0' }} />傳送點</span>
            <span><i style={{ background: '#0f8a8a' }} />腳踏車站</span>
          </div>
        </aside>
        </div>
        <p className="map-credit">{data?.attribution}</p>
      </div>
    </div>
  );
}
