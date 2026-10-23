import { useEffect, useRef, type ReactNode } from 'react';
import type { CampusData, Ring } from '../campus/campusTypes';
import { telemetry } from '../state/telemetry';
import { useGame } from '../state/store';

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
function useCanvasLoop(draw: (g: CanvasRenderingContext2D, size: number) => void): React.RefObject<HTMLCanvasElement | null> {
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
      const size = Math.round(canvas.clientWidth * dpr);
      if (canvas.width !== size) canvas.width = canvas.height = size;
      drawRef.current(g, size);
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

export function FullMap(): ReactNode {
  const base = useBaseMap();
  const data = useGame((st) => st.mapData);
  const canvasRef = useCanvasLoop((g, size) => {
    if (!base || !data) return;
    g.clearRect(0, 0, size, size);
    g.fillStyle = '#b9c9a8';
    g.fillRect(0, 0, size, size);
    // Fit the whole map, centred.
    const k = Math.min(size / base.canvas.width, size / base.canvas.height);
    const offX = (size - base.canvas.width * k) / 2;
    const offY = (size - base.canvas.height * k) / 2;
    g.drawImage(base.canvas, offX, offY, base.canvas.width * k, base.canvas.height * k);
    const screen = (x: number, z: number): [number, number] => {
      const [bx, by] = base.toPx(x, z);
      return [offX + bx * k, offY + by * k];
    };

    // Building labels (campus only), drawn unrotated on top.
    g.font = `600 ${Math.max(10, Math.round(size * 0.015))}px system-ui, 'PingFang TC', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of data.buildings) {
      if (!b.name || !b.inCampus) continue;
      let cx = 0, cz = 0;
      const n = b.outer.length / 2;
      for (let i = 0; i < n; i++) { cx += b.outer[i * 2]!; cz += b.outer[i * 2 + 1]!; }
      const [x, y] = screen(cx / n, cz / n);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.strokeText(b.name, x, y);
      g.fillStyle = '#3b2a20';
      g.fillText(b.name, x, y);
    }

    const [sx, sy] = screen(telemetry.x, telemetry.z);
    const camForward = -telemetry.cameraYaw; // forward = (-sin yaw, -cos yaw) → screen angle -yaw
    drawPlayer(g, sx, sy, Math.atan2(Math.sin(telemetry.facing), -Math.cos(telemetry.facing)), size * 0.016, camForward);
  });

  return (
    <div className="fullmap">
      <div className="frame">
        <canvas ref={canvasRef} aria-label="校園地圖" />
        <div className="legend">
          <span><i style={{ background: '#d9c4a3', outline: '1px solid #9b6a4f' }} />校內建築</span>
          <span><i style={{ background: '#d9a58f' }} />人行步道</span>
          <span><i style={{ background: '#6faa55' }} />球場</span>
          <span><i style={{ background: 'transparent', outline: '2px dashed #1f8f4a' }} />校園範圍</span>
          <span style={{ marginLeft: 'auto' }}>{data?.attribution} · <kbd>M</kbd> 關閉</span>
        </div>
      </div>
    </div>
  );
}
