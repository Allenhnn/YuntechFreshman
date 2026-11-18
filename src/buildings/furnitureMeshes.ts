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
  // Raised stage blocks: dark stained boards.
  const stageFloor = tracker.material(new MeshStandardMaterial({ color: 0x3b2e26, roughness: 0.55 }));
  // Auditorium rake tiers: dark grey carpet.
  const tierFloor = tracker.material(new MeshStandardMaterial({ color: 0x4d4a4c, roughness: 0.95 }));

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
  const mountBlack = tracker.material(new MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.4 }));
  const signCache = new Map<string, Material>();
  // Signs after the campus's own: silver hanging bars with dark end caps and an arrow box, and
  // black square pictogram signs for the toilets.
  const EN: Record<string, string> = { 出口: 'Exit', 樓梯: 'Stairs', 廁所: 'Restroom', 空橋: 'Sky Bridge', 上樓: 'Upstairs', 下樓: 'Downstairs' };
  const round = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  /** Standing figure centred on cx with its feet at `foot`; `skirt` draws the dress. */
  const person = (g: CanvasRenderingContext2D, cx: number, foot: number, h: number, skirt: boolean, color: string): void => {
    const u = h / 10;
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, foot - h + u * 1.05, u * 1.05, 0, Math.PI * 2);
    g.fill();
    if (skirt) {
      g.beginPath();
      g.moveTo(cx - u * 1.1, foot - h + u * 2.5);
      g.lineTo(cx + u * 1.1, foot - h + u * 2.5);
      g.lineTo(cx + u * 2.3, foot - u * 3.2);
      g.lineTo(cx - u * 2.3, foot - u * 3.2);
      g.closePath();
      g.fill();
      g.fillRect(cx - u * 0.95, foot - u * 3.3, u * 0.8, u * 3.3);
      g.fillRect(cx + u * 0.15, foot - u * 3.3, u * 0.8, u * 3.3);
      for (const sd of [-1, 1]) { // arms
        g.beginPath();
        g.moveTo(cx + sd * u * 1.1, foot - h + u * 2.5);
        g.lineTo(cx + sd * u * 2.4, foot - h + u * 5.6);
        g.lineTo(cx + sd * u * 1.85, foot - h + u * 5.8);
        g.lineTo(cx + sd * u * 0.7, foot - h + u * 3.2);
        g.closePath();
        g.fill();
      }
    } else {
      round(g, cx - u * 1.9, foot - h + u * 2.4, u * 3.8, u * 3.6, u * 0.6);
      g.fill();
      g.fillRect(cx - u * 1.9, foot - h + u * 3, u * 0.75, u * 3.4); // arms
      g.fillRect(cx + u * 1.15, foot - h + u * 3, u * 0.75, u * 3.4);
      g.fillStyle = '#17171a';
      g.fillRect(cx - u * 1.05, foot - h + u * 3.2, u * 0.16, u * 3); // arm gaps
      g.fillRect(cx + u * 0.89, foot - h + u * 3.2, u * 0.16, u * 3);
      g.fillStyle = color;
      g.fillRect(cx - u * 1.0, foot - u * 4.2, u * 0.9, u * 4.2);
      g.fillRect(cx + u * 0.1, foot - u * 4.2, u * 0.9, u * 4.2);
    }
  };
  const wcSign = (kind: string): CanvasTexture => label(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#17171a';
    round(g, 3, 3, 250, 250, 26);
    g.fill();
    const PINK = '#e89a94', TEAL = '#6fb5b8';
    if (kind === 'wc:pray') {
      // Two kneeling figures facing right, praying: a veiled woman | a man, a white line between.
      g.fillStyle = '#ffffff';
      g.fillRect(126, 52, 5, 156);
      const kneel = (cx: number, veil: boolean): void => {
        g.fillStyle = '#ffffff';
        if (veil) { // head and shoulders under one rounded veil
          g.beginPath();
          g.moveTo(cx - 14, 72);
          g.quadraticCurveTo(cx - 4, 52, cx + 10, 62);
          g.quadraticCurveTo(cx + 18, 92, cx + 6, 120);
          g.lineTo(cx - 34, 150);
          g.quadraticCurveTo(cx - 40, 120, cx - 14, 72);
          g.closePath();
          g.fill();
        } else {
          g.beginPath();
          g.arc(cx - 2, 70, 15, 0, Math.PI * 2);
          g.fill();
          g.beginPath(); // torso
          g.moveTo(cx - 16, 92);
          g.quadraticCurveTo(cx + 10, 88, cx + 8, 110);
          g.lineTo(cx + 2, 150);
          g.lineTo(cx - 30, 150);
          g.quadraticCurveTo(cx - 32, 110, cx - 16, 92);
          g.closePath();
          g.fill();
        }
        g.beginPath(); // forearm raised in front, hands together
        g.moveTo(cx + 2, 108);
        g.lineTo(cx + 30, 116);
        g.lineTo(cx + 44, 94);
        g.lineTo(cx + 52, 100);
        g.lineTo(cx + 34, 130);
        g.lineTo(cx - 2, 124);
        g.closePath();
        g.fill();
        // Kneeling: thighs forward to the knee, shins back along the floor, a rounded seat on the heels.
        round(g, cx - 34, 146, 56, 28, 12);
        g.fill();
        round(g, cx - 40, 168, 70, 22, 8);
        g.fill();
      };
      kneel(70, true);
      kneel(182, false);
    } else if (kind === 'wc:acc') {
      g.fillStyle = '#ffffff';
      g.font = "700 40px system-ui, sans-serif";
      g.textAlign = 'right';
      g.fillText('WC', 232, 58);
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.arc(96, 62, 15, 0, Math.PI * 2); // head
      g.fill();
      g.lineWidth = 17;
      g.beginPath(); // back, seat, leg
      g.moveTo(96, 88);
      g.lineTo(96, 150);
      g.lineTo(158, 150);
      g.lineTo(186, 200);
      g.lineTo(206, 192);
      g.stroke();
      g.beginPath();
      g.moveTo(98, 114);
      g.lineTo(146, 114); // arm
      g.stroke();
      g.lineWidth = 14;
      g.beginPath();
      g.arc(106, 170, 48, Math.PI * 0.08, Math.PI * 1.42); // wheel
      g.stroke();
      g.lineWidth = 5;
      g.beginPath(); // arrow under the chair
      g.moveTo(232, 232);
      g.lineTo(34, 232);
      g.lineTo(56, 218);
      g.stroke();
    } else if (kind === 'wc:m') person(g, 128, 214, 170, false, TEAL);
    else if (kind === 'wc:f') person(g, 128, 214, 170, true, PINK);
    else {
      person(g, 76, 206, 150, true, PINK);
      person(g, 180, 206, 150, false, TEAL);
      g.fillStyle = '#ffffff';
      g.fillRect(126, 50, 4, 160);
    }
  });
  // Drinks vending machine front: lit display of cans and bottles, price buttons, coin panel, pickup slot.
  const vendingFront = label(256, 512, (g) => {
    g.fillStyle = '#c8272d';
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#ffffff';
    g.font = "900 26px system-ui, 'PingFang TC', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('COLD DRINKS', 128, 26);
    // Display window (left 74 %), lit from inside.
    const W = 184, X = 12, Y = 48, H = 300;
    const glow = g.createLinearGradient(0, Y, 0, Y + H);
    glow.addColorStop(0, '#fbfdff');
    glow.addColorStop(1, '#dfe9f2');
    g.fillStyle = glow;
    g.fillRect(X, Y, W, H);
    const colors = ['#e8332a', '#1e64c8', '#f2b705', '#2b9a48', '#f07c1b', '#7b3fb5', '#111', '#e8e8e8', '#11a4c7'];
    let k = 0;
    for (let row = 0; row < 4; row++) {
      const ry = Y + 10 + row * 73;
      g.fillStyle = '#b9c3cc';
      g.fillRect(X, ry + 52, W, 4); // shelf
      for (let i = 0; i < 6; i++) {
        const cx = X + 16 + i * 30, c = colors[(k++ * 5 + row) % colors.length]!;
        const bottle = (row + i) % 3 === 0;
        g.fillStyle = c;
        if (bottle) {
          g.fillRect(cx - 7, ry + 14, 14, 38);
          g.fillRect(cx - 3, ry + 4, 6, 12);
        } else {
          g.fillRect(cx - 9, ry + 22, 18, 30);
        }
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.fillRect(cx - 5, ry + (bottle ? 18 : 26), 3, 22);
        // Price button under each item.
        g.fillStyle = '#ffffff';
        g.fillRect(cx - 9, ry + 58, 18, 8);
        g.fillStyle = '#0a7a2f';
        g.fillRect(cx - 7, ry + 60, 14, 4);
      }
    }
    g.strokeStyle = '#7d1418';
    g.lineWidth = 4;
    g.strokeRect(X, Y, W, H);
    // Coin / card panel on the right.
    g.fillStyle = '#2b2b2e';
    g.fillRect(204, 60, 42, 200);
    g.fillStyle = '#7ef08a';
    g.fillRect(210, 72, 30, 18); // price display
    g.fillStyle = '#c9c9c9';
    g.fillRect(219, 104, 12, 26); // coin slot
    g.fillRect(210, 146, 30, 6); // note slot
    g.fillStyle = '#3d7cff';
    g.fillRect(210, 170, 30, 30); // card reader
    g.fillStyle = '#9a9a9a';
    g.fillRect(214, 228, 22, 18); // change cup
    // Pickup slot.
    g.fillStyle = '#1a1a1c';
    g.fillRect(28, 392, 150, 64);
    g.fillStyle = '#3a3a3e';
    g.fillRect(34, 398, 138, 18);
    g.fillStyle = '#ffffff';
    g.font = "700 16px system-ui, 'PingFang TC', sans-serif";
    g.fillText('取物口 PUSH', 103, 436);
    g.fillStyle = '#9f1d22';
    g.fillRect(0, 488, 256, 24);
  });
  const vendingBody = tracker.material(new MeshStandardMaterial({ color: 0xb8232a, roughness: 0.45, metalness: 0.15 }));
  const vendingTop = tracker.material(new MeshStandardMaterial({ color: 0x8f8f92, roughness: 0.6 }));
  const vendingFace = tracker.material(new MeshStandardMaterial({ map: vendingFront, emissive: 0xffffff, emissiveMap: vendingFront, emissiveIntensity: 0.35, roughness: 0.3 }));

  const hangingSign = (text: string): CanvasTexture => label(512, 116, (g) => {
    const metal = g.createLinearGradient(0, 0, 0, 116);
    metal.addColorStop(0, '#eeede9');
    metal.addColorStop(0.5, '#dddcd7');
    metal.addColorStop(1, '#c9c8c3');
    g.fillStyle = metal;
    g.fillRect(0, 0, 512, 116);
    g.fillStyle = '#4b3b34'; // end caps
    g.fillRect(0, 0, 14, 116);
    g.fillRect(498, 0, 14, 116);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 112, 512, 4);
    const m = /^([↑▲▼])\s*(.*)$/.exec(text);
    const arrow = m?.[1], words = (m?.[2] ?? text).split('　').filter(Boolean);
    let right = 490;
    if (arrow) { // dark arrow box at the end, as on the real bars
      right = 404;
      g.fillStyle = '#3a2e29';
      round(g, 414, 20, 76, 76, 8);
      g.fill();
      g.fillStyle = '#ffffff';
      g.translate(452, 58);
      if (arrow === '▼') g.rotate(Math.PI);
      g.beginPath();
      g.moveTo(0, -26);
      g.lineTo(24, 2);
      g.lineTo(9, 2);
      g.lineTo(9, 26);
      g.lineTo(-9, 26);
      g.lineTo(-9, 2);
      g.lineTo(-24, 2);
      g.closePath();
      g.fill();
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    const col = (right - 28) / Math.max(1, words.length);
    words.forEach((w, i) => {
      const cx = 28 + col * (i + 0.5);
      const [zh = w, rest] = w.split(' ');
      const en = EN[zh];
      g.fillStyle = '#1d1b1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = "800 44px system-ui, 'PingFang TC', sans-serif";
      g.fillText(rest ? `${zh} ${rest}` : zh, cx, en ? 46 : 60, col - 12);
      if (en) {
        g.font = "600 21px system-ui, sans-serif";
        g.fillStyle = '#3c3936';
        g.fillText(en, cx, 88, col - 12);
      }
    });
  });
  const signMaterial = (text: string): Material => {
    let m = signCache.get(text);
    if (m) return m;
    const wc = text.startsWith('wc:');
    const tex = wc ? wcSign(text) : hangingSign(text);
    m = tracker.material(new MeshStandardMaterial({ map: tex, roughness: wc ? 0.45 : 0.35, metalness: wc ? 0 : 0.25, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: wc ? 0.3 : 0.22, ...(wc ? { alphaTest: 0.5 } : {}) }));
    signCache.set(text, m);
    return m;
  };

  return {
    signMaterial,
    geometry: { shelf, table, chair, plinth: unit, stage: unit, riser: unit, screen: tracker.geometry(unitBox(1, 1, 1)), bed, whiteboard, bunk, toilet, sink, mirror: tracker.geometry(unitBox(1, 1, 1)), partition: tracker.geometry(unitBox(1, 1, 1)), hydrant, bins, sign: signGeo, bracket: unit, vending: unit },
    material: {
      shelf: [wood, wood, wood, wood, books, books], table: laminate, chair: fabric, plinth, stage: stageFloor, riser: tierFloor, screen, bed: [wood, linen, linen],
      whiteboard: [alu, boardFace], bunk: [wood, linen], toilet: ceramic, sink: [counter, ceramic, chrome], mirror, partition: panel,
      hydrant: [red, red, red, red, red, cabinetFront], bins: [binColor(0x6e7275), binColor(0x2c6fd6), binColor(0x2f8f4a)], sign: panel, bracket: mountBlack,
      vending: [vendingBody, vendingBody, vendingTop, vendingTop, vendingBody, vendingFace], // front on −Z
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
