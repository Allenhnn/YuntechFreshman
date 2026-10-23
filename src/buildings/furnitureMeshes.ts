import {
  BoxGeometry,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
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
  return {
    geometry: { shelf, table, chair, plinth: tracker.geometry(unitBox(1, 1, 1)), screen: tracker.geometry(unitBox(1, 1, 1)) },
    material: { shelf: [wood, wood, wood, wood, books, books], table: laminate, chair: fabric, plinth, screen },
  };
}

const CHAIR_TINTS = [new Color(0x2f5d50), new Color(0x8c3b2f), new Color(0x35507a), new Color(0x5c5c5c)];

/** One InstancedMesh per furniture kind present in `items`. */
export function instanceFurniture(items: readonly FurnitureItem[], kit: FurnitureKit): InstancedMesh[] {
  const byKind = new Map<FurnitureKind, FurnitureItem[]>();
  for (const it of items) {
    const list = byKind.get(it.kind);
    if (list) list.push(it);
    else byKind.set(it.kind, [it]);
  }
  const out: InstancedMesh[] = [];
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  for (const [kind, list] of byKind) {
    const mesh = new InstancedMesh(kit.geometry[kind], kit.material[kind], list.length);
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
