import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
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

type Shape = 'card' | 'sheet' | 'book' | 'bottle' | 'can' | 'cup' | 'carton' | 'bowl' | 'bun' | 'box' | 'rice' | 'egg';

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
};

const COLOR: Partial<Record<ItemId, string>> = {
  studentCard: '#2c6fd6', lostCard: '#8a5bd6', healthForm: '#ffffff', raceBib: '#ffffff', campusMap: '#e9f3e1', notebook: '#d8553a',
  waterBottle: '#4fc3f7', mineralWater: '#b3e5fc', sportsDrink: '#29b6f6', greenTea: '#7cb342', cannedCoffee: '#5d4037',
  bubbleTea: '#d7b899', soyMilk: '#fff8e1', beefNoodles: '#f5f5f0', plainNoodles: '#f5f5f0', cupNoodles: '#e53935',
  bread: '#e8a94e', bento: '#c62828', buffet: '#2e7d32', onigiri: '#fafafa', teaEgg: '#6d4c41',
};

function label(id: ItemId, extra: string | undefined, bg: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const def = ITEMS[id];
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  if (SHAPE[id] === 'card') {
    // Student card face: blue band with the school name, a photo box, name and number.
    g.fillStyle = '#ffffff'; g.fillRect(0, 70, 256, 186);
    g.fillStyle = '#fff'; g.font = "bold 22px 'PingFang TC', sans-serif"; g.textAlign = 'center';
    g.fillText('國立雲林科技大學', 128, 34);
    g.font = "16px 'PingFang TC', sans-serif"; g.fillText(id === 'lostCard' ? '學生證（撿到的）' : '學生證 STUDENT ID', 128, 58);
    g.fillStyle = '#cfd8dc'; g.fillRect(18, 88, 70, 90);
    g.fillStyle = '#90a4ae'; g.beginPath(); g.arc(53, 120, 18, 0, Math.PI * 2); g.fill(); g.fillRect(30, 145, 46, 33);
    g.fillStyle = '#1d3326'; g.textAlign = 'left'; g.font = "bold 22px 'PingFang TC', sans-serif";
    g.fillText(id === 'lostCard' ? '王小明' : '新鮮人', 104, 118);
    g.font = "16px 'PingFang TC', sans-serif"; g.fillText(extra ?? '學號 B114xxxxx', 104, 150);
    g.fillText('管理學院', 104, 176);
    g.fillStyle = '#1d3326'; for (let i = 0; i < 26; i++) g.fillRect(20 + i * 8, 212, i % 3 ? 3 : 5, 28);
  } else {
    g.textAlign = 'center';
    g.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textBaseline = 'middle';
    g.fillText(def.icon, 128, 104);
    g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(0, 186, 256, 58);
    g.fillStyle = '#1d3326'; g.font = "bold 30px 'PingFang TC', sans-serif";
    g.fillText(def.name, 128, 216, 240);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createItemModel(id: ItemId, extra?: string): ItemModel {
  const owned: (BufferGeometry | Material | CanvasTexture)[] = [];
  const group = new Group();
  const bg = COLOR[id] ?? '#ffffff';
  const tex = label(id, extra, bg);
  owned.push(tex);
  const mat = (color: string | number, map?: CanvasTexture): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color: map ? 0xffffff : color, map: map ?? null, roughness: 0.55 });
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
    case 'card': labelled(1, 0.63, 0.025); break;
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
      add(new SphereGeometry(0.42, 24, 16), [face], 0, 0, 0).scale.set(1, 0.62, 1);
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
