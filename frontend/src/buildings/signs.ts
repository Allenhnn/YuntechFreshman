import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import type { BuildingSource } from './buildingTypes';
import type { PlateSpot } from './buildingMesh';

const FONT = "'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', system-ui, sans-serif";
const PLATE_W = 0.62, PLATE_H = 0.16;
const CELL_W = 512, CELL_H = 128, COLS = 4;

/**
 * All door plates of a building share one canvas atlas and one merged mesh (1 draw call),
 * so dozens of name plates cost the same as one.
 */
export function buildPlates(spots: readonly PlateSpot[], tracker: ResourceTracker): Mesh | null {
  if (!spots.length) return null;
  const rows = Math.ceil(spots.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * rows;
  const g = canvas.getContext('2d');
  if (!g) return null;
  spots.forEach((s, i) => {
    const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
    g.fillStyle = '#20332b';
    g.fillRect(x, y, CELL_W, CELL_H);
    g.fillStyle = '#c9a75c';
    g.fillRect(x, y + CELL_H - 8, CELL_W, 8);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    if (s.code) {
      g.font = `600 30px ${FONT}`;
      g.fillStyle = '#c9e3d4';
      g.fillText(s.code, x + 24, y + 36);
      g.fillStyle = '#ffffff';
      g.font = `700 48px ${FONT}`;
      fitText(g, s.text, x + 24, y + 84, CELL_W - 48);
    } else {
      g.font = `700 52px ${FONT}`;
      fitText(g, s.text, x + 24, y + CELL_H / 2, CELL_W - 48);
    }
  });
  const tex = tracker.texture(new CanvasTexture(canvas));
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  spots.forEach((s, i) => {
    const [px, py, pz] = s.p;
    const [nx, nz] = s.n;
    // Right vector as seen by someone facing the plate (looking along -n), so text is not mirrored.
    const rx = nz, rz = -nx;
    const hw = PLATE_W / 2, hh = PLATE_H / 2;
    const u0 = (i % COLS) / COLS, u1 = u0 + 1 / COLS;
    const v1 = 1 - Math.floor(i / COLS) / rows, v0 = v1 - 1 / rows;
    const base = pos.length / 3;
    const corners: [number, number, number, number][] = [
      [-hw, -hh, u0, v0], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1],
    ];
    for (const [a, b, u, v] of corners) {
      pos.push(px + rx * a, py + b, pz + rz * a);
      nrm.push(nx, 0, nz);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = tracker.geometry(new BufferGeometry());
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
  return new Mesh(geo, mat);
}

function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
  const w = g.measureText(text).width;
  if (w <= maxW) {
    g.fillText(text, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(maxW / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** Floor directory board (樓層導覽) for a given current level. */
export function paintDirectory(src: BuildingSource, current: string, tracker: ResourceTracker): Texture {
  const W = 768, H = 1280;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f8f4a';
    g.fillRect(0, 0, W, 170);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.font = `800 52px ${FONT}`;
    g.fillText('樓層導覽', 40, 62);
    g.font = `600 30px ${FONT}`;
    fitText(g, src.name, 40, 122, W - 80);
    const rowH = (H - 210) / src.directory.length;
    src.directory.forEach((row, i) => {
      const y = 190 + i * rowH;
      const here = row.level === current;
      if (here) {
        g.fillStyle = '#fff1d6';
        g.fillRect(0, y, W, rowH);
      }
      g.fillStyle = here ? '#f08a24' : '#20332b';
      g.fillRect(30, y + 14, 120, rowH - 28);
      g.fillStyle = '#ffffff';
      g.font = `800 44px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(row.level, 90, y + rowH / 2);
      g.textAlign = 'left';
      g.fillStyle = '#20332b';
      g.font = `600 30px ${FONT}`;
      const text = row.items.join('、');
      fitText(g, text, 175, y + rowH / 2 - (here ? 14 : 0), W - 210);
      if (here) {
        g.fillStyle = '#c0562b';
        g.font = `700 24px ${FONT}`;
        g.fillText('● 您在這裡 YOU ARE HERE', 175, y + rowH / 2 + 26);
      }
      g.strokeStyle = '#e1ddd3';
      g.beginPath(); g.moveTo(30, y + rowH); g.lineTo(W - 30, y + rowH); g.stroke();
    });
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function paintEntranceSign(name: string, tracker: ResourceTracker): Texture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#2b2f2c';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#f2e6c9';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 120px ${FONT}`;
    g.fillText(`國立雲林科技大學 ${name}`, c.width / 2, 110);
    g.font = `600 44px ${FONT}`;
    g.fillText('NATIONAL YUNLIN UNIVERSITY OF SCIENCE AND TECHNOLOGY · LIBRARY', c.width / 2, 210);
  }
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
