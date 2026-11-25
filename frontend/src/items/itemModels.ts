import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape as Outline,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from 'three';
import { ITEMS, type ItemId } from '../state/items';

/**
 * Small 3D models of the inventory items for the inspect view (held up in front of the camera and
 * in the character's hand). Simple shapes per kind of thing (card, sheet, book, bottle, can, cup,
 * carton, bowl, bun, lunch box, rice ball, egg) with a painted label: the item's icon and name, or
 * the student card's face. Each model is centred and about 1 unit across; dispose() frees it.
 */
export interface ItemModel {
  group: Group;
  dispose(): void;
}

type Shape = 'broom' | 'mop' | 'card' | 'sheet' | 'book' | 'bottle' | 'can' | 'cup' | 'carton' | 'bowl' | 'bun' | 'box' | 'rice' | 'egg';

const SHAPE: Record<ItemId, Shape> = {
  studentCard: 'card', lostCard: 'card',
  healthForm: 'sheet', raceBib: 'sheet', campusMap: 'sheet',
  notebook: 'book',
  waterBottle: 'bottle', mineralWater: 'bottle', sportsDrink: 'bottle', greenTea: 'bottle',
  cannedCoffee: 'can',
  bubbleTea: 'cup',
  soyMilk: 'carton',
  beefNoodles: 'bowl', plainNoodles: 'bowl', cupNoodles: 'cup',
  bread: 'bun',
  bento: 'box', buffet: 'box',
  onigiri: 'rice',
  teaEgg: 'egg',
  broom: 'broom', mop: 'mop',
};

const COLOR: Partial<Record<ItemId, string>> = {
  studentCard: '#2c6fd6', lostCard: '#8a5bd6', healthForm: '#ffffff', raceBib: '#ffffff', campusMap: '#e9f3e1', notebook: '#d8553a',
  waterBottle: '#4fc3f7', mineralWater: '#b3e5fc', sportsDrink: '#29b6f6', greenTea: '#7cb342', cannedCoffee: '#5d4037',
  bubbleTea: '#d7b899', soyMilk: '#fff8e1', beefNoodles: '#f5f5f0', plainNoodles: '#f5f5f0', cupNoodles: '#e53935',
  bread: '#e8a94e', bento: '#c62828', buffet: '#2e7d32', onigiri: '#fafafa', teaEgg: '#6d4c41',
};

/** Who the card belongs to (the player's name and full student number). */
export interface CardInfo {
  name: string;
  id: string;
}

const KAI = "'BiauKai','Kaiti TC','DFKai-SB','STKaiti',serif";
const SANS = "'PingFang TC','Noto Sans TC',sans-serif";

/** 雲科大學生證 front: cream card, sepia rotunda, YunTech mark, the holder's lines, photo, bottom band. */
function paintCardFront(g: CanvasRenderingContext2D, W: number, H: number, who: CardInfo, dept: string): void {
  // Cream ground, whiter toward the top right.
  const bg = g.createLinearGradient(0, H, W, 0);
  bg.addColorStop(0, '#ecd98f');
  bg.addColorStop(0.55, '#f7edc4');
  bg.addColorStop(1, '#fffdf4');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Sepia rotunda (the campus landmark) across the left two thirds.
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#d6bd68';
  g.beginPath();
  g.moveTo(30, H - 70);
  g.lineTo(30, 330);
  g.quadraticCurveTo(360, 170, 760, 300);
  g.lineTo(780, H - 70);
  g.closePath();
  g.fill();
  g.fillStyle = '#b99a45';
  g.beginPath();
  g.moveTo(30, 330);
  g.quadraticCurveTo(360, 170, 760, 300);
  g.lineTo(760, 330);
  g.quadraticCurveTo(360, 205, 30, 360);
  g.closePath();
  g.fill();
  // Colonnade: columns and dark bays under the eave.
  for (let i = 0; i < 12; i++) {
    const x = 60 + i * 60, top = 345 - Math.sin((i / 11) * Math.PI) * 60 + i * 4;
    g.fillStyle = '#a88a3c';
    g.fillRect(x, top, 34, H - 70 - top);
    g.fillStyle = '#eadb9f';
    g.fillRect(x + 34, top + 10, 26, H - 80 - top);
  }
  g.restore();
  // Trees on the right, washed out.
  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = '#e2c75a';
  for (const [x, y, r] of [[930, 200, 90], [1000, 120, 80], [860, 120, 60], [980, 300, 70]] as const) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // Header band: the mark, YunTech, the school's names.
  g.fillStyle = 'rgba(255,253,244,0.82)';
  g.fillRect(0, 26, W, 120);
  const mark = (cx: number, cy: number, r: number): void => {
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = '#1f7a6a';
    g.lineWidth = r * 0.16;
    for (let k = 0; k < 6; k++) {
      g.rotate(Math.PI / 3);
      g.beginPath();
      g.moveTo(0, r * 0.18);
      g.lineTo(r * 0.36, r * 0.55);
      g.lineTo(0, r * 0.95);
      g.lineTo(-r * 0.36, r * 0.55);
      g.closePath();
      g.stroke();
    }
    g.restore();
  };
  mark(170, 86, 52);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.font = "bold 50px Georgia, 'Times New Roman', serif";
  g.fillStyle = '#e8892b';
  g.fillText('Yun', 236, 104);
  const yw = g.measureText('Yun').width;
  g.fillStyle = '#1f6f68';
  g.fillText('Tech', 236 + yw, 104);
  const tw = g.measureText('Tech').width;
  g.fillStyle = '#2a2a2a';
  g.font = `bold 50px ${KAI}`;
  g.fillText('國立雲林科技大學', 236 + yw + tw + 18, 104);
  g.font = "26px Georgia, 'Times New Roman', serif";
  g.fillStyle = '#3a3a3a';
  g.fillText('National Yunlin University of Science & Technology', 236, 138);
  // 學生證 and the photo.
  g.fillStyle = '#2a2a2a';
  g.font = `bold 44px ${KAI}`;
  g.textAlign = 'center';
  g.fillText('學　生　證', 860, 226);
  g.fillStyle = '#ffffff';
  g.fillRect(745, 250, 230, 300);
  g.strokeStyle = '#cdbb7a';
  g.lineWidth = 3;
  g.strokeRect(745, 250, 230, 300);
  // The photo: 雲寶寶 in a green tank top.
  g.fillStyle = '#dfeee3';
  g.fillRect(748, 253, 224, 294);
  g.fillStyle = '#2e9e3e';
  g.beginPath(); g.ellipse(860, 560, 95, 80, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 4;
  g.beginPath(); g.arc(860, 395, 82, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#2a2a2a';
  for (const dx of [-28, 28]) { g.beginPath(); g.arc(860 + dx, 395, 12, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#f4a8a8';
  for (const dx of [-50, 50]) { g.beginPath(); g.ellipse(860 + dx, 420, 13, 8, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 3;
  g.beginPath(); g.arc(860, 418, 12, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  for (const [c, a] of [['#2e9e3e', -0.45], ['#2c6fd6', 0], ['#f2c230', 0.45]] as const) {
    g.save(); g.translate(860, 318); g.rotate(a); g.fillStyle = c;
    g.beginPath(); g.ellipse(0, -26, 9, 28, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // The holder's lines.
  g.textAlign = 'left';
  g.fillStyle = '#1e1e1e';
  const lines: [string, string][] = [['學號', who.id], ['姓名', who.name], ['學制', '四年制'], ['系所', dept]];
  lines.forEach(([k, v], i) => {
    const y = 300 + i * 66;
    g.font = `bold 42px ${KAI}`;
    g.fillText(`${k}：`, 120, y);
    g.font = i === 0 ? "bold 42px 'Times New Roman', serif" : `bold 42px ${KAI}`;
    g.fillText(v, 250, y, 470);
  });
  // Bottom band: orange then teal.
  g.fillStyle = '#f0a63a';
  g.fillRect(0, H - 62, 250, 62);
  g.fillStyle = '#1f7a6a';
  g.fillRect(250, H - 62, W - 250, 62);
}

function paintCardBack(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = '#f8f6ee';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#26262b';
  g.fillRect(0, 70, W, 110); // magnetic stripe
  g.fillStyle = '#4a4a4a';
  g.font = `bold 34px ${SANS}`;
  g.textAlign = 'left';
  g.fillText('使用須知', 70, 260);
  g.font = `28px ${SANS}`;
  ['1. 本證限本人使用，不得轉借他人。', '2. 進出圖書館、宿舍與借用設備時請出示本證。', '3. 遺失請儘速至註冊組辦理補發。', '4. 拾獲者請送交國立雲林科技大學警衛室。'].forEach((t, i) => g.fillText(t, 70, 320 + i * 52));
  g.fillStyle = '#1f7a6a';
  g.fillRect(0, H - 40, W, 40);
}

function cardTexture(paint: (g: CanvasRenderingContext2D, W: number, H: number) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 646;
  const g = c.getContext('2d')!;
  paint(g, c.width, c.height);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function label(id: ItemId, bg: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const def = ITEMS[id];
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  g.textAlign = 'center';
  g.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textBaseline = 'middle';
  g.fillText(def.icon, 128, 104);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(0, 186, 256, 58);
  g.fillStyle = '#1d3326'; g.font = "bold 30px 'PingFang TC', sans-serif";
  g.fillText(def.name, 128, 216, 240);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Rounded-corner card 1 × 0.63, 0.02 thick, front face toward +Z. */
function roundedCard(w: number, h: number, r: number): Outline {
  const s = new Outline();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Maps shape-space UVs (x, y in metres around the centre) onto a w × h texture. */
function fitUv(g: BufferGeometry, w: number, h: number, flipX = false): void {
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    const u = pos.getX(i) / w + 0.5;
    uv.setXY(i, flipX ? 1 - u : u, pos.getY(i) / h + 0.5);
  }
  uv.needsUpdate = true;
}

export function createItemModel(id: ItemId, who?: CardInfo): ItemModel {
  const owned: (BufferGeometry | Material | CanvasTexture)[] = [];
  const group = new Group();
  const bg = COLOR[id] ?? '#ffffff';
  const tex = label(id, bg);
  owned.push(tex);
  const mat = (color: string | number, map?: CanvasTexture): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color: map ? 0xffffff : color, map: map ?? null, roughness: 0.55 });
    // Printed faces glow a little so the label stays readable under dim interior lights.
    if (map) { m.emissive.set(0xffffff); m.emissiveMap = map; m.emissiveIntensity = 0.45; }
    owned.push(m);
    return m;
  };
  const add = (g: BufferGeometry, m: Material | Material[], x = 0, y = 0, z = 0): Mesh => {
    owned.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const plain = mat(bg);
  const face = mat(bg, tex);
  /** Box with the label on its front (+Z) face. */
  const labelled = (w: number, h: number, d: number, y = 0): Mesh => add(new BoxGeometry(w, h, d), [plain, plain, plain, plain, face, plain], 0, y, 0);

  switch (SHAPE[id]) {
    case 'card': {
      const W = 1, H = 0.63, T = 0.02;
      const holder = id === 'lostCard' ? { name: '王小明', id: 'B11307418' } : who ?? { name: '新鮮人', id: 'B11412000' };
      const front = cardTexture((g, w, h) => paintCardFront(g, w, h, holder, id === 'lostCard' ? '企業管理系' : '資訊管理系'));
      const back = cardTexture(paintCardBack);
      owned.push(front, back);
      const body = new ExtrudeGeometry(roundedCard(W, H, 0.045), { depth: T, bevelEnabled: false, curveSegments: 6 });
      body.translate(0, 0, -T / 2);
      add(body, [mat('#f4eed6'), mat('#e9e1c2')]);
      const faceGeo = new ShapeGeometry(roundedCard(W, H, 0.045), 6);
      fitUv(faceGeo, W, H);
      add(faceGeo, mat('#ffffff', front), 0, 0, T / 2 + 0.0008);
      const backGeo = new ShapeGeometry(roundedCard(W, H, 0.045), 6);
      fitUv(backGeo, W, H, true);
      add(backGeo, mat('#ffffff', back), 0, 0, -T / 2 - 0.0008).rotation.y = Math.PI;
      break;
    }
    case 'sheet': labelled(0.72, 1, 0.012); break;
    case 'book':
      labelled(0.7, 0.95, 0.12);
      add(new BoxGeometry(0.66, 0.91, 0.1), mat('#faf6ea'), 0.03, 0, 0);
      break;
    case 'bottle': {
      const glass = mat(bg);
      glass.transparent = true; glass.opacity = 0.55; glass.roughness = 0.1;
      add(new CylinderGeometry(0.17, 0.17, 0.78, 24), glass);
      add(new CylinderGeometry(0.175, 0.175, 0.34, 24, 1, true), face, 0, -0.05, 0);
      add(new CylinderGeometry(0.06, 0.17, 0.16, 20), mat(bg), 0, 0.47, 0);
      add(new CylinderGeometry(0.07, 0.07, 0.1, 16), mat('#ffffff'), 0, 0.6, 0);
      break;
    }
    case 'can':
      add(new CylinderGeometry(0.2, 0.2, 0.62, 28), [face, mat('#c0c4c8'), mat('#c0c4c8')], 0, 0, 0);
      break;
    case 'cup':
      add(new CylinderGeometry(0.24, 0.18, 0.64, 24), [face, mat('#ffffff'), mat(bg)], 0, 0, 0);
      if (id === 'bubbleTea') {
        add(new CylinderGeometry(0.025, 0.025, 0.5, 8), mat('#e53935'), 0.06, 0.45, 0).rotation.z = 0.15;
        for (let i = 0; i < 7; i++) add(new SphereGeometry(0.04, 8, 6), mat('#3e2723'), Math.cos(i) * 0.12, -0.26, Math.sin(i * 1.7) * 0.1);
      } else add(new CylinderGeometry(0.25, 0.25, 0.03, 24), mat('#f2f2f2'), 0, 0.33, 0);
      break;
    case 'carton':
      labelled(0.34, 0.6, 0.34);
      add(new CylinderGeometry(0, 0.24, 0.16, 4, 1), mat('#ffffff'), 0, 0.38, 0).rotation.y = Math.PI / 4;
      break;
    case 'bowl': {
      const china = mat('#f7f7f2');
      china.side = 2; china.roughness = 0.3;
      add(new SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), china, 0, 0.14, 0);
      add(new CylinderGeometry(0.39, 0.39, 0.02, 24), mat(id === 'beefNoodles' ? '#8d4a2a' : '#e8d29a'), 0, 0.06, 0);
      if (id === 'beefNoodles') for (let i = 0; i < 3; i++) add(new BoxGeometry(0.14, 0.05, 0.1), mat('#5d2f1b'), Math.cos(i * 2) * 0.18, 0.09, Math.sin(i * 2) * 0.18);
      add(new BoxGeometry(0.03, 0.03, 0.8), mat('#c8a36a'), 0.1, 0.2, 0).rotation.x = 0.4; // chopsticks
      break;
    }
    case 'bun':
      add(new SphereGeometry(0.42, 24, 16), face, 0, 0, 0).scale.set(1, 0.62, 1);
      break;
    case 'box':
      add(new BoxGeometry(0.9, 0.22, 0.62), mat('#212121'), 0, -0.04, 0);
      add(new BoxGeometry(0.92, 0.06, 0.64), [plain, plain, face, plain, plain, plain], 0, 0.1, 0);
      break;
    case 'rice': {
      const tri = add(new CylinderGeometry(0.48, 0.48, 0.22, 3), mat('#fafafa'), 0, 0, 0);
      tri.rotation.x = Math.PI / 2;
      add(new BoxGeometry(0.34, 0.36, 0.24), mat('#1b3a2b'), 0, -0.2, 0);
      break;
    }
    case 'broom':
    case 'mop': {
      // Long stick (scaled to fit the view), head at the bottom.
      add(new CylinderGeometry(0.025, 0.025, 1.1, 8), mat('#c9a46a'), 0, 0.15, 0);
      if (SHAPE[id] === 'broom') add(new CylinderGeometry(0.05, 0.22, 0.32, 10).scale(1, 1, 0.45), mat('#d9b84a'), 0, -0.55, 0);
      else add(new CylinderGeometry(0.16, 0.22, 0.28, 12), mat('#e8e6df'), 0, -0.55, 0);
      break;
    }
    case 'egg':
      add(new SphereGeometry(0.3, 20, 14), mat('#6d4c41'), 0, 0, 0).scale.set(1, 1.3, 1);
      break;
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const o of owned) o.dispose();
    },
  };
}
