import {
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ResourceTracker } from '../core/resources';
import { mulberry32 } from '../core/math';
import facadeParsVert from '../shaders/facade/facade_pars.vert.glsl';
import facadeParsFrag from '../shaders/facade/facade_pars.frag.glsl';
import facadeColorFrag from '../shaders/facade/facade_color.frag.glsl';

/**
 * Realistic (A1) campus materials. Textures are painted procedurally on canvases at startup:
 * no downloaded assets, nothing to license, and every surface tiles in world units.
 */
export interface CampusMaterials {
  facade: MeshStandardMaterial;
  /** Facade details (balconies, sunshades, parapets…): colour per vertex from the facade style. */
  details: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  road: MeshStandardMaterial;
  walkway: MeshStandardMaterial;
  field: MeshStandardMaterial;
  ground: MeshStandardMaterial;
  trunk: MeshStandardMaterial;
  canopy: MeshStandardMaterial;
}

type Painter = (g: CanvasRenderingContext2D, size: number, rand: () => number) => void;

function paint(size: number, seed: number, painter: Painter, renderer: WebGLRenderer, tracker: ResourceTracker): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) painter(g, size, mulberry32(seed));
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tracker.texture(tex);
}

/** Speckle noise: many small translucent dots, cheap stand-in for photographic grain. */
function speckle(g: CanvasRenderingContext2D, size: number, rand: () => number, count: number, colors: readonly string[], maxR: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    g.globalAlpha = 0.08 + rand() * 0.18;
    g.beginPath();
    g.arc(rand() * size, rand() * size, 0.5 + rand() * maxR, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Neutral wall grain: small facade tiles (二丁掛) plus speckle; colour comes from the facade style. */
const wallGrainPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(90, 80, 70, 0.16)';
  g.lineWidth = 1;
  for (let y = 0; y < s; y += 8) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
    for (let x = (y / 8) % 2 ? 0 : 12; x < s; x += 24) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); }
  }
  speckle(g, s, rand, 900, ['#8a7a66', '#ffffff', '#b0a898'], 1.2);
};

const roofPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#9a9a96';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 1400, ['#6e6e6a', '#b8b8b2', '#7d7a70'], 2);
  g.strokeStyle = 'rgba(60,60,60,0.25)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
};

const asphaltPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#56575a';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 3000, ['#3b3c3e', '#7a7b7e', '#6a6560'], 1.4);
};

/** Red brick paving (紅磚道), common on Taiwanese campuses. */
const paverPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#8f8a82';
  g.fillRect(0, 0, s, s);
  const bw = s / 4, bh = s / 8;
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      const shade = 0.85 + rand() * 0.2;
      g.fillStyle = `rgb(${Math.round(170 * shade)}, ${Math.round(88 * shade)}, ${Math.round(68 * shade)})`;
      g.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }
  speckle(g, s, rand, 500, ['#5a3b30', '#d9a08a'], 1.2);
};

const grassPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#5f8a43';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 5000, ['#4a7334', '#76a052', '#86a85a', '#58703a'], 2.2);
  for (let i = 0; i < 1200; i++) {
    g.strokeStyle = rand() > 0.5 ? 'rgba(40,70,25,0.25)' : 'rgba(150,190,100,0.22)';
    const x = rand() * s, y = rand() * s;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4); g.stroke();
  }
};

/** Neutral grain for fields; colour comes from per-vertex field colours. */
const fieldPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 2500, ['#c8c8c8', '#ffffff', '#b0b0b0'], 1.6);
};

const barkPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#6b5240';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = rand() > 0.5 ? 'rgba(40,28,20,0.5)' : 'rgba(140,115,90,0.35)';
    g.lineWidth = 1 + rand() * 2;
    const x = rand() * s;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rand() - 0.5) * 8, s); g.stroke();
  }
};

const leafPainter: Painter = (g, s, rand) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  speckle(g, s, rand, 1800, ['#a0a0a0', '#ffffff', '#707070'], 3);
};

/** Layered decals: negative polygon offset pulls them toward the camera to avoid z-fighting at distance. */
function layer(m: MeshStandardMaterial, units: number): MeshStandardMaterial {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -units;
  m.polygonOffsetUnits = -units * 2;
  return m;
}

export function createCampusMaterials(renderer: WebGLRenderer, tracker: ResourceTracker): CampusMaterials {
  const tex = (size: number, seed: number, p: Painter): Texture => paint(size, seed, p, renderer, tracker);
  const mat = (m: MeshStandardMaterial): MeshStandardMaterial => tracker.material(m);
  return {
    facade: mat(createFacadeMaterial(tex(256, 1, wallGrainPainter))),
    details: mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })),
    roof: mat(new MeshStandardMaterial({ map: tex(128, 2, roofPainter), color: new Color(0xcfcac2), roughness: 0.95 })),
    road: mat(layer(new MeshStandardMaterial({ map: tex(256, 3, asphaltPainter), roughness: 0.92 }), 2)),
    walkway: mat(layer(new MeshStandardMaterial({ map: tex(256, 4, paverPainter), roughness: 0.9 }), 3)),
    field: mat(layer(new MeshStandardMaterial({ map: tex(128, 5, fieldPainter), vertexColors: true, roughness: 0.95 }), 1)),
    ground: mat(new MeshStandardMaterial({ map: tex(256, 6, grassPainter), roughness: 1 })),
    trunk: mat(new MeshStandardMaterial({ map: tex(64, 7, barkPainter), roughness: 0.95 })),
    canopy: mat(new MeshStandardMaterial({ map: tex(128, 8, leafPainter), color: new Color(0xffffff), roughness: 0.9 })),
  };
}

/**
 * Procedural facade (option C): wall grain × style colour, with windows, slab bands and a glazed
 * ground floor generated from the per-vertex style (see FacadeBuilder). UV = (bays, floors).
 */
function createFacadeMaterial(grain: Texture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uWallGrain'] = { value: grain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${facadeParsVert}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nfacadeVertex(position);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${facadeParsFrag}`)
      .replace('#include <color_fragment>', facadeColorFrag)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, fGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, fGlass);');
  };
  m.customProgramCacheKey = () => 'campus-facade-v1';
  return m;
}
