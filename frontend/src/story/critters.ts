import {
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';

/**
 * 三位神秘人物 (管院貓咪, 操場黑狗, 宿舍大笨鳥) and the 熱音社 drum kit: small low-poly figures
 * with a name tag ("?" while you have not talked to them). The animals idle (breathing, the cat's
 * tail, the bird's head bob, the dog's wagging) and turn to look at you when you come close.
 */
export interface CritterSpec {
  key: string;
  kind: 'cat' | 'bird' | 'dog' | 'drumkit';
  name: string;
  x: number;
  y: number;
  z: number;
  /** Shows the "?" bubble. */
  talk?: boolean;
}

export interface Critters {
  set(list: readonly CritterSpec[]): void;
  update(dt: number, time: number, px: number, pz: number): void;
  dispose(): void;
}

export function createCritters(scene: Scene, tracker: ResourceTracker): Critters {
  const mats = new Map<number, MeshStandardMaterial>();
  const mat = (c: number, rough = 0.8, metal = 0): MeshStandardMaterial => {
    const k = c * 10 + Math.round(metal * 9);
    let m = mats.get(k);
    if (!m) { m = tracker.material(new MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })); mats.set(k, m); }
    return m;
  };
  const geo = <T extends BufferGeometry>(g: T): T => tracker.geometry(g);
  const part = (g: BufferGeometry, color: number, x: number, y: number, z: number, parent: Group, rough = 0.8, metal = 0): Mesh => {
    const m = new Mesh(g, mat(color, rough, metal));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const label = (text: string, bubble: boolean): Sprite => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      g.font = '30px "Cubic 11", system-ui, "PingFang TC", sans-serif';
      const w = Math.min(240, g.measureText(text).width + 28);
      g.fillStyle = 'rgba(52, 28, 72, 0.85)';
      g.beginPath(); g.roundRect(128 - w / 2, 78, w, 42, 21); g.fill();
      g.fillStyle = '#fffdf6'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 128, 100);
      if (bubble) {
        g.fillStyle = '#b388ff'; g.beginPath(); g.arc(128, 36, 30, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText('?', 128, 38);
      }
    }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    const s = new Sprite(tracker.material(new SpriteMaterial({ map: t, depthTest: false, transparent: true })));
    s.scale.set(1.6, 0.8, 1);
    s.renderOrder = 9;
    return s;
  };

  interface Live { root: Group; body: Group; spec: CritterSpec; wiggle: Mesh | null; head: Mesh | null; tag: Sprite | null; yaw: number; seed: number }
  const live = new Map<string, Live>();

  const make = (s: CritterSpec): Live => {
    const root = new Group();
    const body = new Group();
    root.add(body);
    let wiggle: Mesh | null = null, head: Mesh | null = null;
    let tagY = 1;
    if (s.kind === 'cat') {
      // Orange tabby sitting upright: body, head, ears, tail curled round.
      part(geo(new SphereGeometry(0.2, 14, 10).scale(1, 1.15, 1.2)), 0xf0a040, 0, 0.22, 0, body);
      head = part(geo(new SphereGeometry(0.15, 14, 10)), 0xf0a040, 0, 0.5, 0.1, body);
      for (const sx of [-1, 1]) {
        const ear = part(geo(new ConeGeometry(0.055, 0.12, 4)), 0xe08a2a, sx * 0.08, 0.13, 0, new Group(), 0.8);
        head.add(ear);
        ear.position.set(sx * 0.08, 0.13, -0.01);
        part(geo(new SphereGeometry(0.022, 8, 6)), 0x1d2a1d, sx * 0.055, 0.03, 0.135, head as unknown as Group);
      }
      part(geo(new SphereGeometry(0.05, 10, 8)), 0xfff3e0, 0, -0.03, 0.13, head as unknown as Group);
      wiggle = part(geo(new CylinderGeometry(0.03, 0.04, 0.42, 8).translate(0, 0.21, 0)), 0xe08a2a, 0, 0.08, -0.22, body);
      wiggle.rotation.x = -0.9;
      tagY = 0.95;
    } else if (s.kind === 'dog') {
      // Black dog standing: long body, four legs, head with floppy ears, tail up.
      part(geo(new CapsuleLike(0.16, 0.5)), 0x1b1b1d, 0, 0.42, 0, body, 0.6);
      for (const [lx, lz] of [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]] as const) {
        part(geo(new CylinderGeometry(0.045, 0.04, 0.34, 8).translate(0, -0.17, 0)), 0x1b1b1d, lx, 0.36, lz, body, 0.6);
      }
      head = part(geo(new SphereGeometry(0.14, 14, 10)), 0x1b1b1d, 0, 0.62, 0.36, body, 0.6);
      part(geo(new CylinderGeometry(0.06, 0.07, 0.14, 10).rotateX(Math.PI / 2)), 0x2a2a2c, 0, -0.03, 0.15, head as unknown as Group, 0.6);
      part(geo(new SphereGeometry(0.03, 8, 6)), 0x050505, 0, -0.02, 0.23, head as unknown as Group);
      for (const sx of [-1, 1]) {
        part(geo(new SphereGeometry(0.05, 8, 6).scale(0.6, 1.4, 0.4)), 0x111113, sx * 0.12, 0.02, -0.02, head as unknown as Group);
        part(geo(new SphereGeometry(0.02, 8, 6)), 0xf5e6c8, sx * 0.055, 0.04, 0.12, head as unknown as Group);
      }
      wiggle = part(geo(new CylinderGeometry(0.025, 0.035, 0.3, 8).translate(0, 0.15, 0)), 0x1b1b1d, 0, 0.5, -0.3, body, 0.6);
      wiggle.rotation.x = -0.6;
      // A red collar.
      part(geo(new TorusGeometry(0.1, 0.02, 6, 16).rotateX(Math.PI / 2)), 0xd32f2f, 0, 0.52, 0.28, body);
      tagY = 1.15;
    } else if (s.kind === 'bird') {
      // 大笨鳥: a big, round, slightly silly bird — white body, long neck, orange beak and legs.
      part(geo(new SphereGeometry(0.4, 16, 12).scale(1, 0.85, 1.25)), 0xf4f1ea, 0, 0.9, 0, body, 0.9);
      for (const sx of [-1, 1]) {
        part(geo(new SphereGeometry(0.2, 10, 8).scale(0.35, 0.8, 1.3)), 0xd9d4c8, sx * 0.38, 0.95, -0.05, body, 0.9);
        part(geo(new CylinderGeometry(0.03, 0.03, 0.55, 6).translate(0, -0.27, 0)), 0xff8f00, sx * 0.13, 0.62, 0, body);
        part(geo(new ConeGeometry(0.09, 0.05, 3).rotateX(Math.PI / 2)), 0xff8f00, sx * 0.13, 0.05, 0.07, body);
      }
      const neck = part(geo(new CylinderGeometry(0.08, 0.11, 0.55, 10).translate(0, 0.27, 0)), 0xf4f1ea, 0, 1.15, 0.32, body, 0.9);
      neck.rotation.x = 0.25;
      head = part(geo(new SphereGeometry(0.16, 14, 10)), 0xf4f1ea, 0, 1.78, 0.46, body, 0.9);
      part(geo(new ConeGeometry(0.07, 0.3, 8).rotateX(Math.PI / 2)), 0xff8f00, 0, -0.03, 0.2, head as unknown as Group);
      for (const sx of [-1, 1]) {
        part(geo(new SphereGeometry(0.045, 10, 8)), 0xffffff, sx * 0.08, 0.05, 0.11, head as unknown as Group);
        part(geo(new SphereGeometry(0.022, 8, 6)), 0x111111, sx * 0.09 + (sx > 0 ? -0.01 : 0.015), 0.05, 0.15, head as unknown as Group); // a little cross-eyed
      }
      part(geo(new ConeGeometry(0.05, 0.14, 5)), 0x5d4037, 0.02, 0.16, -0.02, head as unknown as Group); // a tuft
      tagY = 2.3;
    } else {
      // 熱音社 drum kit: bass drum, snare, two toms, floor tom, hi-hat and a crash cymbal, a stool.
      const shell = 0x8e1b2c, chrome = 0xcfd3d6, brass = 0xd4a640;
      const drum = (r: number, h: number, x: number, y: number, z: number, tilt = 0): void => {
        const m = part(geo(new CylinderGeometry(r, r, h, 20)), shell, x, y, z, body, 0.35, 0.2);
        m.rotation.x = tilt;
        const skin = part(geo(new CylinderGeometry(r * 0.98, r * 0.98, 0.01, 20)), 0xf5f2e8, 0, h / 2 + 0.005, 0, m as unknown as Group, 0.6);
        void skin;
      };
      const bass = part(geo(new CylinderGeometry(0.28, 0.28, 0.4, 22).rotateX(Math.PI / 2)), shell, 0, 0.3, 0, body, 0.35, 0.2);
      part(geo(new CylinderGeometry(0.27, 0.27, 0.01, 22).rotateX(Math.PI / 2)), 0xf5f2e8, 0, 0, 0.205, bass as unknown as Group);
      drum(0.17, 0.14, -0.42, 0.62, 0.3, 0.2); // snare
      drum(0.12, 0.16, -0.15, 0.75, 0.05, 0.4); // tom 1
      drum(0.13, 0.17, 0.17, 0.75, 0.05, 0.4); // tom 2
      drum(0.2, 0.36, 0.48, 0.42, 0.32); // floor tom
      for (const [x, y, z, r, c] of [[-0.62, 0.95, 0.15, 0.17, brass], [0.42, 1.35, -0.05, 0.25, brass]] as const) {
        part(geo(new CylinderGeometry(0.012, 0.012, y, 6).translate(0, -y / 2, 0)), chrome, x, y, z, body, 0.3, 0.8);
        const cym = part(geo(new CylinderGeometry(r, r * 0.2, 0.025, 20)), c, x, y, z, body, 0.3, 0.7);
        cym.rotation.z = 0.12;
      }
      part(geo(new CylinderGeometry(0.17, 0.17, 0.08, 16)), 0x1f1f24, 0, 0.52, -0.55, body); // stool
      part(geo(new CylinderGeometry(0.03, 0.03, 0.48, 6).translate(0, -0.24, 0)), chrome, 0, 0.5, -0.55, body, 0.3, 0.8);
    }
    if (s.kind !== 'drumkit') {
      const tag = label(s.name, !!s.talk);
      tag.position.y = tagY;
      root.add(tag);
      root.position.set(s.x, s.y + 0.02, s.z);
      scene.add(root);
      return { root, body, spec: s, wiggle, head, tag, yaw: Math.random() * Math.PI * 2, seed: Math.random() * 10 };
    }
    root.position.set(s.x, s.y + 0.02, s.z);
    scene.add(root);
    return { root, body, spec: s, wiggle, head, tag: null, yaw: Math.PI, seed: 0 };
  };

  return {
    set(list) {
      const keep = new Map(list.map((s) => [s.key, s]));
      for (const [k, l] of live) {
        const s = keep.get(k);
        if (!s || s.talk !== l.spec.talk) { scene.remove(l.root); live.delete(k); }
      }
      for (const s of list) {
        const l = live.get(s.key);
        if (l) l.root.position.set(s.x, s.y + 0.02, s.z);
        else live.set(s.key, make(s));
      }
    },
    update(dt, time, px, pz) {
      for (const l of live.values()) {
        const dx = px - l.root.position.x, dz = pz - l.root.position.z;
        const d = Math.hypot(dx, dz);
        l.root.visible = d < 120;
        if (!l.root.visible) continue;
        if (l.spec.kind === 'drumkit') { l.root.rotation.y = l.yaw; continue; }
        if (d < 10) {
          let dy = Math.atan2(dx, dz) - l.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          l.yaw += dy * Math.min(1, dt * 3);
        } else {
          l.yaw += Math.sin(time * 0.3 + l.seed) * dt * 0.4; // looks about
        }
        l.root.rotation.y = l.yaw;
        l.body.scale.y = 1 + Math.sin(time * 2.2 + l.seed) * 0.015;
        const k = l.spec.kind;
        if (l.wiggle) l.wiggle.rotation.z = Math.sin(time * (k === 'dog' ? (d < 6 ? 14 : 5) : 1.6) + l.seed) * (k === 'dog' ? 0.5 : 0.35);
        if (l.head && k === 'bird') l.head.position.z = 0.46 + Math.sin(time * 3 + l.seed) * 0.06; // head bob
        if (l.tag) l.tag.position.y = (k === 'bird' ? 2.3 : k === 'dog' ? 1.15 : 0.95) + (l.spec.talk ? Math.abs(Math.sin(time * 3 + l.seed)) * 0.1 : 0);
      }
    },
    dispose() {
      for (const l of live.values()) scene.remove(l.root);
      live.clear();
    },
  };
}

/** A capsule lying along z (the dog's body). */
class CapsuleLike extends CylinderGeometry {
  constructor(r: number, len: number) {
    super(r, r * 0.92, len, 14, 1);
    this.rotateX(Math.PI / 2);
  }
}
