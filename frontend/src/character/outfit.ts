import {
  CapsuleGeometry,
  CylinderGeometry,
  Mesh,
  MeshToonMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { OutfitPart } from '../state/story';

/**
 * Wardrobe clothes on the mascot: six parts worn or taken off on their own. Hats, jackets, long
 * trouser legs, socks and shoes are extra meshes on the mascot's joints (so they move with the
 * pose); shirts and trousers also recolour the mascot's own top and shorts. Nothing worn on a part
 * = the mascot's own look (green tank top, black shorts, bare feet).
 */
export const OUTFIT_PARTS = [
  { id: 'hat', label: '帽子', icon: '🧢' },
  { id: 'shirt', label: '衣服', icon: '👕' },
  { id: 'jacket', label: '外套', icon: '🧥' },
  { id: 'pants', label: '褲子', icon: '👖' },
  { id: 'socks', label: '襪子', icon: '🧦' },
  { id: 'shoes', label: '鞋子', icon: '👟' },
] as const satisfies readonly { id: OutfitPart; label: string; icon: string }[];

export interface OutfitItem {
  id: string;
  part: OutfitPart;
  name: string;
  color: number;
  style?: 'cap' | 'beanie' | 'bucket' | 'long' | 'short';
  /** 潮流單品: tagged in the wardrobe. */
  trend?: boolean;
}

export const OUTFIT_ITEMS: readonly OutfitItem[] = [
  { id: 'capRed', part: 'hat', name: '紅色棒球帽', color: 0xd8353a, style: 'cap' },
  { id: 'capNavy', part: 'hat', name: '深藍棒球帽', color: 0x1f2f5c, style: 'cap' },
  { id: 'beanie', part: 'hat', name: '黃色毛帽', color: 0xf2c230, style: 'beanie' },
  { id: 'bucket', part: 'hat', name: '白色漁夫帽', color: 0xf1efe6, style: 'bucket' },
  { id: 'bucketBlack', part: 'hat', name: '黑色漁夫帽', color: 0x1e1e22, style: 'bucket', trend: true },
  { id: 'capGreen', part: 'hat', name: '雲科綠棒球帽', color: 0x1f8f4a, style: 'cap' },
  { id: 'beanieGrey', part: 'hat', name: '灰色針織毛帽', color: 0x8e9199, style: 'beanie', trend: true },
  { id: 'teeWhite', part: 'shirt', name: '白 T', color: 0xf4f4f0 },
  { id: 'teeBlack', part: 'shirt', name: '黑 T', color: 0x26262b },
  { id: 'shirtPink', part: 'shirt', name: '粉色襯衫', color: 0xf3a6bf },
  { id: 'poloBlue', part: 'shirt', name: '藍色 POLO', color: 0x2c6fd6 },
  { id: 'teeOversize', part: 'shirt', name: '卡其 oversize T', color: 0xc9b48f, trend: true },
  { id: 'teeMint', part: 'shirt', name: '薄荷綠 T', color: 0x9fe0c3, trend: true },
  { id: 'teeDept', part: 'shirt', name: '資管系系 T', color: 0x1d3f7a },
  { id: 'denim', part: 'jacket', name: '丹寧外套', color: 0x4a6fa5 },
  { id: 'bomber', part: 'jacket', name: '黑色飛行外套', color: 0x23252b },
  { id: 'varsity', part: 'jacket', name: '綠色棒球外套', color: 0x1f8f4a },
  { id: 'hoodie', part: 'jacket', name: '灰色帽 T', color: 0x9a9ca3 },
  { id: 'cargo', part: 'jacket', name: '軍綠工裝外套', color: 0x55613a, trend: true },
  { id: 'windbreaker', part: 'jacket', name: '螢光橘風衣', color: 0xff7a1a, trend: true },
  { id: 'plaid', part: 'jacket', name: '紅色格紋襯衫', color: 0xa8323a },
  { id: 'jeans', part: 'pants', name: '牛仔長褲', color: 0x35517f, style: 'long' },
  { id: 'khaki', part: 'pants', name: '卡其長褲', color: 0xc8b48a, style: 'long' },
  { id: 'shortsBlack', part: 'pants', name: '黑色短褲', color: 0x1d1d22, style: 'short' },
  { id: 'shortsRed', part: 'pants', name: '紅色運動褲', color: 0xc9363c, style: 'short' },
  { id: 'cargoPants', part: 'pants', name: '軍綠工裝褲', color: 0x5b6a3c, style: 'long', trend: true },
  { id: 'wideBeige', part: 'pants', name: '米色寬褲', color: 0xe3d5b8, style: 'long', trend: true },
  { id: 'shortsGrey', part: 'pants', name: '灰色運動短褲', color: 0x8a8d93, style: 'short' },
  { id: 'sockWhite', part: 'socks', name: '白襪', color: 0xf7f7f3 },
  { id: 'sockBlack', part: 'socks', name: '黑襪', color: 0x2a2a2e },
  { id: 'sockYellow', part: 'socks', name: '黃色長襪', color: 0xf2c230, style: 'long' },
  { id: 'sockPink', part: 'socks', name: '粉紅短襪', color: 0xf48fb1 },
  { id: 'sockGreen', part: 'socks', name: '綠色長襪', color: 0x2e9e3e, style: 'long', trend: true },
  { id: 'sneakWhite', part: 'shoes', name: '小白鞋', color: 0xf5f5f2 },
  { id: 'sneakRed', part: 'shoes', name: '紅色球鞋', color: 0xd8353a },
  { id: 'leather', part: 'shoes', name: '黑皮鞋', color: 0x1a1718 },
  { id: 'dadShoes', part: 'shoes', name: '米白老爹鞋', color: 0xeee4d0, trend: true },
  { id: 'highTop', part: 'shoes', name: '黑色高筒帆布鞋', color: 0x222226, trend: true },
  { id: 'blueWhite', part: 'shoes', name: '藍白拖', color: 0x2f6fd6 },
];

export interface Outfitter {
  apply(outfit: Partial<Record<OutfitPart, string>>): void;
  dispose(): void;
}

export function createOutfitter(root: Object3D): Outfitter {
  const get = (n: string): Object3D | undefined => root.getObjectByName(n);
  const head = get('head'), body = get('body'), armL = get('armL'), armR = get('armR'), legL = get('legL'), legR = get('legR');
  const torso = get('torso') as Mesh | undefined, shorts = get('shorts') as Mesh | undefined;
  const original = new Map<Mesh, Material | Material[]>();
  for (const m of [torso, shorts]) if (m) original.set(m, m.material);
  const added: Mesh[] = [];
  const owned: (BufferGeometry | Material)[] = [];

  const mat = (color: number): Material => {
    const m = new MeshToonMaterial({ color });
    owned.push(m);
    return m;
  };
  const add = (parent: Object3D | undefined, g: BufferGeometry, m: Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void => {
    if (!parent) return;
    owned.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    parent.add(mesh);
    added.push(mesh);
  };
  const recolor = (mesh: Mesh | undefined, color: number | null): void => {
    if (!mesh) return;
    const base = original.get(mesh);
    if (!base) return;
    if (color === null) { mesh.material = base; return; }
    mesh.material = mat(color);
  };

  const clear = (): void => {
    for (const m of added) m.removeFromParent();
    added.length = 0;
    for (const o of owned) o.dispose();
    owned.length = 0;
  };

  return {
    apply(outfit) {
      clear();
      const item = (part: OutfitPart): OutfitItem | undefined => OUTFIT_ITEMS.find((i) => i.id === outfit[part]);
      const hat = item('hat');
      if (hat) {
        const m = mat(hat.color);
        if (hat.style === 'bucket') {
          add(head, new CylinderGeometry(0.27, 0.33, 0.17, 24), m, 0, 0.56, 0);
          add(head, new CylinderGeometry(0.46, 0.46, 0.02, 28), m, 0, 0.49, 0);
        } else {
          // A crown over the top of the head only (the face stays clear), brim out front for caps.
          add(head, new SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.1), m, 0, 0.34, 0, 1, hat.style === 'beanie' ? 1.15 : 1, 1);
          if (hat.style === 'cap') add(head, new CylinderGeometry(0.2, 0.2, 0.025, 20, 1, false, -Math.PI / 2, Math.PI), m, 0, 0.53, 0.2, 1, 1, 1.2);
          if (hat.style === 'beanie') add(head, new SphereGeometry(0.06, 10, 8), m, 0, 0.72, 0);
        }
      }
      const shirt = item('shirt');
      recolor(torso, shirt ? shirt.color : null);
      const jacket = item('jacket');
      if (jacket) {
        const m = mat(jacket.color);
        add(body, new CylinderGeometry(0.19, 0.225, 0.29, 22, 1, true), m, 0, 0.235, 0);
        for (const arm of [armL, armR]) add(arm, new CapsuleGeometry(0.072, 0.15, 4, 10), m, 0, -0.12, 0);
      }
      const pants = item('pants');
      recolor(shorts, pants ? pants.color : null);
      if (pants?.style === 'long') {
        const m = mat(pants.color);
        for (const leg of [legL, legR]) add(leg, new CapsuleGeometry(0.084, 0.12, 4, 10), m, 0, -0.14, 0);
      }
      const socks = item('socks');
      if (socks) {
        const m = mat(socks.color);
        for (const leg of [legL, legR]) add(leg, new CylinderGeometry(0.081, 0.081, socks.style === 'long' ? 0.12 : 0.07, 14), m, 0, socks.style === 'long' ? -0.25 : -0.27, 0);
      }
      const shoes = item('shoes');
      if (shoes) {
        const m = mat(shoes.color);
        for (const leg of [legL, legR]) add(leg, new SphereGeometry(1, 14, 10), m, 0, -0.305, 0.035, 0.092, 0.06, 0.135);
      }
    },
    dispose() {
      clear();
      for (const [mesh, m] of original) mesh.material = m;
    },
  };
}
