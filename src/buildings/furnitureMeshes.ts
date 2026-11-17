import {
  BoxGeometry,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';
import type { ResourceTracker } from '../core/resources';
import type { FurnitureItem, FurnitureKind } from './furniture';

/** Shared unit geometries (bottom at y = 0) and materials for instanced library furniture. */
export interface FurnitureKit {
  geometry: Record<FurnitureKind, BufferGeometry>;
  material: Record<FurnitureKind, Material | Material[]>;
  /** Hanging-sign face for a text (cached per text). */
  signMaterial(label: string): Material;
}

function bookSpines(): CanvasTexture {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rand = mulberry32(42);
  const colors = ['#8c2f2f', '#2f4f8c', '#2f6b45', '#b3863a', '#5a3d6e', '#c9c1ad', '#3d3d3d', '#a6533a', '#2d6f7a', '#d6cfbd'];
  if (g) {
    g.fillStyle = '#6b4d33';
    g.fillRect(0, 0, W, H);
    const shelves = 5;
    const rowH = H / shelves;
    for (let s = 0; s < shelves; s++) {
      const top = s * rowH;
      g.fillStyle = '#4a3423';
      g.fillRect(0, top + rowH - 10, W, 10); // shelf board
      let x = 4;
      while (x < W - 8) {
        const w = 8 + rand() * 14;
        const h = rowH * (0.62 + rand() * 0.28);
        g.fillStyle = colors[Math.floor(rand() * colors.length)]!;
        g.fillRect(x, top + rowH - 10 - h, w - 1.5, h);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x + 2, top + rowH - 10 - h * 0.7, w - 6, 3);
        x += w;
        if (rand() < 0.04) x += 10; // a gap here and there
      }
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Box with its base at y = 0. */
function unitBox(w: number, h: number, d: number, x = 0, y = 0, z = 0): BoxGeometry {
  return new BoxGeometry(w, h, d).translate(x, y + h / 2, z) as BoxGeometry;
}

export function createFurnitureKit(tracker: ResourceTracker): FurnitureKit {
  const wood = tracker.material(new MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 }));
  const books = tracker.material(new MeshStandardMaterial({ map: tracker.texture(bookSpines()), roughness: 0.85 }));
  const laminate = tracker.material(new MeshStandardMaterial({ color: 0xd9cfbd, roughness: 0.55 }));
  const fabric = tracker.material(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
  const plinth = tracker.material(new MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6 }));
  const screen = tracker.material(new MeshStandardMaterial({ color: 0xf8f8f8, emissive: new Color(0xd8e4ff), emissiveIntensity: 0.6, roughness: 0.4 }));

  // Shelf: 1 x 1 x 1 unit; book faces on ±Z (BoxGeometry group order: +x, -x, +y, -y, +z, -z).
  const shelf = tracker.geometry(unitBox(1, 1, 1));
  const table = tracker.geometry(
    mergeGeometries([
      unitBox(1, 0.05, 1, 0, 0.95),
      unitBox(0.05, 0.95, 0.05, -0.45, 0, -0.42),
      unitBox(0.05, 0.95, 0.05, 0.45, 0, -0.42),
      unitBox(0.05, 0.95, 0.05, -0.45, 0, 0.42),
      unitBox(0.05, 0.95, 0.05, 0.45, 0, 0.42),
    ]) ?? unitBox(1, 1, 1),
  );
  const chair = tracker.geometry(
    mergeGeometries([
      unitBox(0.45, 0.06, 0.45, 0, 0.44),
      unitBox(0.45, 0.45, 0.05, 0, 0.5, 0.2), // backrest on +Z; yaw 0 faces −Z
      unitBox(0.04, 0.44, 0.04, -0.19, 0, -0.19),
      unitBox(0.04, 0.44, 0.04, 0.19, 0, -0.19),
      unitBox(0.04, 0.44, 0.04, -0.19, 0, 0.19),
      unitBox(0.04, 0.44, 0.04, 0.19, 0, 0.19),
    ]) ?? unitBox(0.45, 0.9, 0.45),
  );
  // Bed: unit footprint 1 × 1 (scaled to 0.95 × 2.0), frame + mattress + pillow at the +Z (head) end.
  const linen = tracker.material(new MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.95 }));
  const bed = tracker.geometry(
    mergeGeometries([unitBox(1, 0.3, 1), unitBox(0.94, 0.16, 0.97, 0, 0.3), unitBox(0.7, 0.1, 0.16, 0, 0.46, 0.38)], true) ?? unitBox(1, 0.5, 1),
  );
  const merge = (parts: BoxGeometry[]): BufferGeometry => mergeGeometries(parts) ?? unitBox(1, 1, 1);
  const groups = (parts: BufferGeometry[]): BufferGeometry => tracker.geometry(mergeGeometries(parts, true) ?? unitBox(1, 1, 1));

  // Whiteboard: 1 × 1 × 1 unit (scaled to width × height × thickness); aluminium frame and marker tray.
  const alu = tracker.material(new MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.6 }));
  const boardFace = tracker.material(new MeshStandardMaterial({ color: 0xfbfbf8, roughness: 0.25, emissive: new Color(0xffffff), emissiveIntensity: 0.08 }));
  const whiteboard = groups([
    merge([unitBox(1, 1, 1), unitBox(0.9, 0.03, 1.8, 0, -0.01, 0.9)]),
    unitBox(0.97, 0.93, 1, 0, 0.035, 0.35),
  ]);

  // Bunk bed: unit footprint (scaled to 0.95 × 2.0), absolute height; head at +Z, ladder at the foot.
  const bunkFrame = merge([
    ...[[-0.47, -0.485], [0.47, -0.485], [-0.47, 0.485], [0.47, 0.485]].map(([x, z]) => unitBox(0.06, 1.85, 0.03, x, 0, z)),
    unitBox(1, 0.1, 1, 0, 0.2), unitBox(1, 0.1, 1, 0, 1.2),
    unitBox(0.04, 0.25, 0.7, 0.48, 1.45, 0.1), // upper guard rail
    unitBox(0.04, 1.45, 0.02, -0.4, 0.05, -0.5), unitBox(0.04, 1.45, 0.02, -0.12, 0.05, -0.5),
    ...[0.5, 0.85, 1.2, 1.5].map((y) => unitBox(0.28, 0.03, 0.02, -0.26, y, -0.5)),
  ]);
  const bunkLinen = merge([
    unitBox(0.92, 0.14, 0.96, 0, 0.3), unitBox(0.92, 0.14, 0.96, 0, 1.3),
    unitBox(0.7, 0.1, 0.08, 0, 0.44, 0.4), unitBox(0.7, 0.1, 0.08, 0, 1.44, 0.4),
  ]);
  const bunk = groups([bunkFrame, bunkLinen]);

  // Restroom: toilet and sink unit (absolute sizes, front on −Z), mirror and partition panels.
  const ceramic = tracker.material(new MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.2 }));
  const counter = tracker.material(new MeshStandardMaterial({ color: 0x8e9696, roughness: 0.4 }));
  const chrome = tracker.material(new MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.15, metalness: 0.9 }));
  const toilet = tracker.geometry(merge([unitBox(0.3, 0.38, 0.42, 0, 0, -0.05), unitBox(0.4, 0.06, 0.5, 0, 0.38, -0.1), unitBox(0.42, 0.42, 0.18, 0, 0.38, 0.17)]));
  const sink = groups([
    merge([unitBox(0.6, 0.08, 0.55, 0, 0.8), unitBox(0.6, 0.35, 0.04, 0, 0.45, -0.255)]),
    unitBox(0.42, 0.02, 0.34, 0, 0.88, -0.02),
    merge([unitBox(0.04, 0.16, 0.04, 0, 0.88, 0.2), unitBox(0.04, 0.03, 0.14, 0, 1.02, 0.14)]),
  ]);
  const mirror = tracker.material(new MeshStandardMaterial({ color: 0xcfdbe3, roughness: 0.05, metalness: 0.95, emissive: new Color(0x9fb4c4), emissiveIntensity: 0.25 }));
  const panel = tracker.material(new MeshStandardMaterial({ color: 0xc9d6dc, roughness: 0.55 }));
  const unit = tracker.geometry(unitBox(1, 1, 1));

  // Fire-hose cabinet: 0.75 × 1.6 × 0.25 m, front (−Z) with the label; BoxGeometry face order +x −x +y −y +z −z.
  const label = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) paint(g);
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  const red = tracker.material(new MeshStandardMaterial({ color: 0xc8251f, roughness: 0.45, metalness: 0.2 }));
  const cabinetFront = tracker.material(new MeshStandardMaterial({
    roughness: 0.4,
    map: label(128, 256, (g) => {
      g.fillStyle = '#c8251f';
      g.fillRect(0, 0, 128, 256);
      g.strokeStyle = '#8f1813';
      g.lineWidth = 6;
      g.strokeRect(6, 6, 116, 244);
      g.fillStyle = '#fff4e0';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = "900 34px system-ui, 'PingFang TC', sans-serif";
      ['消', '防', '栓'].forEach((ch, i) => g.fillText(ch, 64, 58 + i * 42));
      g.font = '700 14px system-ui, sans-serif';
      g.fillText('FIRE HOSE', 64, 196);
      g.fillStyle = '#e8e2d6';
      g.fillRect(96, 116, 10, 30); // handle
    }),
  }));
  const hydrant = tracker.geometry(new BoxGeometry(0.75, 1.6, 0.25).translate(0, 0.8, 0));
  // Sorting bins: grey (general), blue (recycling), green (paper), front on −Z.
  const binColor = (c: number): MeshStandardMaterial => tracker.material(new MeshStandardMaterial({ color: c, roughness: 0.6 }));
  const bins = tracker.geometry(mergeGeometries([-0.4, 0, 0.4].map((x) => mergeGeometries([unitBox(0.37, 0.72, 0.44, x, 0, 0), unitBox(0.39, 0.06, 0.46, x, 0.72, 0)]) ?? unitBox(0.37, 0.78, 0.44, x)), true) ?? unitBox(1.2, 0.78, 0.44));
  const signGeo = tracker.geometry(new PlaneGeometry(1, 1));
  const signCache = new Map<string, Material>();
  const signMaterial = (text: string): Material => {
    let m = signCache.get(text);
    if (m) return m;
    const tex = label(512, 116, (g) => {
      g.fillStyle = '#1f6b45';
      g.fillRect(0, 0, 512, 116);
      g.strokeStyle = '#f4f1ea';
      g.lineWidth = 4;
      g.strokeRect(6, 6, 500, 104);
      g.fillStyle = '#ffffff';
      g.font = "800 50px system-ui, 'PingFang TC', sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 60, 480);
    });
    m = tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
    signCache.set(text, m);
    return m;
  };

  return {
    signMaterial,
    geometry: { shelf, table, chair, plinth: unit, screen: tracker.geometry(unitBox(1, 1, 1)), bed, whiteboard, bunk, toilet, sink, mirror: tracker.geometry(unitBox(1, 1, 1)), partition: tracker.geometry(unitBox(1, 1, 1)), hydrant, bins, sign: signGeo },
    material: {
      shelf: [wood, wood, wood, wood, books, books], table: laminate, chair: fabric, plinth, screen, bed: [wood, linen, linen],
      whiteboard: [alu, boardFace], bunk: [wood, linen], toilet: ceramic, sink: [counter, ceramic, chrome], mirror, partition: panel,
      hydrant: [red, red, red, red, red, cabinetFront], bins: [binColor(0x6e7275), binColor(0x2c6fd6), binColor(0x2f8f4a)], sign: panel,
    },
  };
}

const CHAIR_TINTS = [new Color(0x2f5d50), new Color(0x8c3b2f), new Color(0x35507a), new Color(0x5c5c5c)];

/** One InstancedMesh per furniture kind present in `items`. */
export function instanceFurniture(items: readonly FurnitureItem[], kit: FurnitureKit): InstancedMesh[] {
  // Signs group by their text (one material each); everything else by kind.
  const byKind = new Map<string, FurnitureItem[]>();
  for (const it of items) {
    const key = it.kind === 'sign' ? `sign:${it.label ?? ''}` : it.kind;
    const list = byKind.get(key);
    if (list) list.push(it);
    else byKind.set(key, [it]);
  }
  const out: InstancedMesh[] = [];
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  for (const [key, list] of byKind) {
    const kind = list[0]!.kind;
    const mesh = new InstancedMesh(kit.geometry[kind], kind === 'sign' ? kit.signMaterial(key.slice(5)) : kit.material[kind], list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.ry);
      m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, m);
      if (kind === 'chair') mesh.setColorAt(i, CHAIR_TINTS[Math.floor(it.tint * CHAIR_TINTS.length) % CHAIR_TINTS.length]!);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}
