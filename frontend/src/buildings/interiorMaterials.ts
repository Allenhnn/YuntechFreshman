import { CanvasTexture, ClampToEdgeWrapping, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture, type WebGLRenderer } from 'three';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';

export interface InteriorMaterials {
  floor: MeshStandardMaterial;
  paint: MeshStandardMaterial;
  ceiling: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  /** Black stair curtain (unlit). */
  curtain: MeshBasicMaterial;
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

/** 60 cm dark grey porcelain tiles with a faint cloud (the 管理學院 corridors). */
const darkTile: Painter = (g, s, rand) => {
  g.fillStyle = '#6b6c6b';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 700, ['#585958', '#7d7e7c', '#8b8c89', '#4f504f'], 3);
  g.strokeStyle = 'rgba(40,40,40,0.5)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
};

/**
 * One 2 m storey-relative wall repeat: grey glass-mosaic dado to 1.2 m, a dark cap strip, cream
 * paint above. The texture clamps vertically, so everything above 2 m stays cream.
 */
const mosaicDado: Painter = (g, s, rand) => {
  g.fillStyle = '#ece6d8';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 300, ['#ddd6c6', '#f6f1e6'], 2.5);
  const dadoTop = s * (1 - 1.2 / 2); // canvas y of 1.2 m (v = 0 is the canvas bottom)
  const tile = s / 80; // 2.5 cm mosaic
  for (let y = dadoTop; y < s; y += tile) {
    for (let x = 0; x < s; x += tile) {
      const k = rand();
      g.fillStyle = k < 0.15 ? '#5f625f' : k < 0.45 ? '#868985' : k < 0.8 ? '#a3a6a1' : '#c2c4bf';
      g.fillRect(x + 0.6, y + 0.6, tile - 1.2, tile - 1.2);
    }
  }
  g.fillStyle = '#4b4d4c';
  g.fillRect(0, dadoTop - s * 0.012, s, s * 0.018); // cap strip
  g.fillStyle = '#3e403f';
  g.fillRect(0, s * 0.975, s, s * 0.025); // skirting
};

/** Light wood-veneer door in a dark frame. */
const framedDoor: Painter = (g, s, rand) => {
  woodDoor(g, s, rand);
  g.strokeStyle = '#2b2a28';
  g.lineWidth = s * 0.07;
  g.strokeRect(0, 0, s, s);
  g.fillStyle = 'rgba(40,30,20,0.35)';
  g.fillRect(s * 0.12, s * 0.42, s * 0.76, s * 0.012); // groove
};

export function createInteriorMaterials(renderer: WebGLRenderer, tracker: ResourceTracker, variant: 'default' | 'mosaic' = 'default'): InteriorMaterials {
  const tex = (size: number, seed: number, p: Painter): Texture => canvasTexture(size, seed, p, renderer, tracker);
  const m = (mat: MeshStandardMaterial): MeshStandardMaterial => tracker.material(mat);
  const mosaic = variant === 'mosaic';
  const wallTex = mosaic ? tex(512, 17, mosaicDado) : tex(256, 12, paint);
  if (mosaic) wallTex.wrapT = ClampToEdgeWrapping;
  return {
    floor: m(new MeshStandardMaterial({ map: mosaic ? tex(256, 18, darkTile) : tex(256, 11, terrazzo), roughness: mosaic ? 0.28 : 0.35, metalness: 0 })),
    paint: m(new MeshStandardMaterial({ map: wallTex, roughness: 0.9 })),
    ceiling: m(
      new MeshStandardMaterial({
        map: tex(256, 13, ceilingPanels),
        emissiveMap: tex(128, 14, ceilingGlow),
        emissive: new Color(0xfff6e0),
        emissiveIntensity: 0.9,
        roughness: 0.95,
      }),
    ),
    curtain: tracker.material(new MeshBasicMaterial({ color: 0x040405, side: DoubleSide })),
    glass: m(new MeshStandardMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, side: DoubleSide, depthWrite: false })),
    door: m(new MeshStandardMaterial({ map: mosaic ? tex(256, 19, framedDoor) : tex(256, 15, woodDoor), roughness: 0.7 })),
    elevatorDoor: m(new MeshStandardMaterial({ map: tex(256, 16, steelDoor), roughness: 0.35, metalness: 0.6 })),
  };
}
