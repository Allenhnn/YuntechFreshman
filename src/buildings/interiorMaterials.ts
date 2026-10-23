import { CanvasTexture, Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture, type WebGLRenderer } from 'three';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';

export interface InteriorMaterials {
  floor: MeshStandardMaterial;
  paint: MeshStandardMaterial;
  ceiling: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  door: MeshStandardMaterial;
  elevatorDoor: MeshStandardMaterial;
}

type Painter = (g: CanvasRenderingContext2D, s: number, rand: () => number) => void;

function canvasTexture(size: number, seed: number, painter: Painter, renderer: WebGLRenderer, tracker: ResourceTracker): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) painter(g, size, mulberry32(seed));
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tracker.texture(t);
}

function speckle(g: CanvasRenderingContext2D, s: number, rand: () => number, n: number, colors: readonly string[], r: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    g.globalAlpha = 0.06 + rand() * 0.14;
    g.beginPath();
    g.arc(rand() * s, rand() * s, 0.4 + rand() * r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** 60 cm polished terrazzo tiles (one tile per texture repeat). */
const terrazzo: Painter = (g, s, rand) => {
  g.fillStyle = '#d9d4ca';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 900, ['#9a948a', '#f4f1ea', '#b9a98f', '#6f6a62'], 1.6);
  g.strokeStyle = 'rgba(120,112,100,0.45)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
};

const paint: Painter = (g, s, rand) => {
  g.fillStyle = '#efece6';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 500, ['#d9d4cb', '#ffffff'], 2.5);
  // Skirting board along the bottom (v = 0 is floor level, canvas bottom).
  g.fillStyle = '#8c8379';
  g.fillRect(0, s * 0.95, s, s * 0.05);
};

/** 60 x 60 cm acoustic ceiling grid with one light panel per 1.2 m. */
const ceilingPanels: Painter = (g, s) => {
  g.fillStyle = '#f3f2ee';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#c9c6bf';
  g.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    g.beginPath(); g.moveTo((i * s) / 2, 0); g.lineTo((i * s) / 2, s); g.stroke();
    g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.fillRect(s * 0.06, s * 0.06, s * 0.38, s * 0.38);
};

const ceilingGlow: Painter = (g, s) => {
  g.fillStyle = '#000000';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#fffbf0';
  g.fillRect(s * 0.06, s * 0.06, s * 0.38, s * 0.38);
};

const woodDoor: Painter = (g, s, rand) => {
  g.fillStyle = '#9b7653';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = rand() > 0.5 ? 'rgba(70,45,25,0.25)' : 'rgba(190,150,110,0.2)';
    const x = rand() * s;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rand() - 0.5) * 10, s); g.stroke();
  }
  g.fillStyle = '#d8d0c4';
  g.fillRect(s * 0.78, s * 0.48, s * 0.12, s * 0.04); // handle
};

const steelDoor: Painter = (g, s, rand) => {
  const grad = g.createLinearGradient(0, 0, s, 0);
  grad.addColorStop(0, '#a9adb1');
  grad.addColorStop(0.5, '#d6d9dc');
  grad.addColorStop(1, '#a3a7ab');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.08})`;
    g.fillRect(rand() * s, rand() * s, 1, 6 + rand() * 20);
  }
  g.fillStyle = '#6f7378';
  g.fillRect(s / 2 - 2, 0, 4, s); // centre split
};

export function createInteriorMaterials(renderer: WebGLRenderer, tracker: ResourceTracker): InteriorMaterials {
  const tex = (size: number, seed: number, p: Painter): Texture => canvasTexture(size, seed, p, renderer, tracker);
  const m = (mat: MeshStandardMaterial): MeshStandardMaterial => tracker.material(mat);
  return {
    floor: m(new MeshStandardMaterial({ map: tex(256, 11, terrazzo), roughness: 0.35, metalness: 0 })),
    paint: m(new MeshStandardMaterial({ map: tex(256, 12, paint), roughness: 0.9 })),
    ceiling: m(
      new MeshStandardMaterial({
        map: tex(256, 13, ceilingPanels),
        emissiveMap: tex(128, 14, ceilingGlow),
        emissive: new Color(0xfff6e0),
        emissiveIntensity: 0.9,
        roughness: 0.95,
      }),
    ),
    glass: m(new MeshStandardMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, side: DoubleSide, depthWrite: false })),
    door: m(new MeshStandardMaterial({ map: tex(256, 15, woodDoor), roughness: 0.7 })),
    elevatorDoor: m(new MeshStandardMaterial({ map: tex(256, 16, steelDoor), roughness: 0.35, metalness: 0.6 })),
  };
}
