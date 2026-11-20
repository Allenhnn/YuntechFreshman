import {
  CanvasTexture,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';

/**
 * Story characters standing where a scene happens (nurse, roommate, teacher, mixer friends, club
 * booths, the 萊爾富 clerk…): low-poly people in the same style as the ambient walkers, with a name
 * tag, a bouncing "!" when they have something for you, idle breathing, and they turn to face and
 * wave at the player who comes close.
 */
export interface NpcSpec {
  key: string;
  name: string;
  x: number;
  z: number;
  /** Ground height under the character. */
  y?: number;
  /** Shirt / pants / hair colours; `hat` adds a cap (nurse, staff). */
  look: { shirt: number; pants: number; hair: number; hat?: number };
  /** Shows the "!" bubble. */
  talk?: boolean;
}

export interface Npcs {
  set(list: readonly NpcSpec[]): void;
  update(dt: number, time: number, px: number, pz: number): void;
  dispose(): void;
}

const LEG = 0.8;

export function createNpcs(scene: Scene, tracker: ResourceTracker): Npcs {
  const torsoGeo = tracker.geometry(new CapsuleGeometry(0.17, 0.32, 3, 8).scale(1.1, 1, 0.7).translate(0, 0.3, 0));
  const headGeo = tracker.geometry(new SphereGeometry(0.12, 12, 10).translate(0, 0.74, 0));
  const hairGeo = tracker.geometry(new SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.76, -0.01));
  const hatGeo = tracker.geometry(new SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(0, 0.79, 0));
  const legGeo = tracker.geometry(new CapsuleGeometry(0.07, LEG - 0.14, 2, 6).translate(0, -LEG / 2, 0));
  const armGeo = tracker.geometry(new CapsuleGeometry(0.05, 0.5, 2, 6).translate(0, -0.3, 0));
  const skin = tracker.material(new MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.8 }));
  const mats = new Map<number, MeshStandardMaterial>();
  const mat = (c: number): MeshStandardMaterial => {
    let m = mats.get(c);
    if (!m) { m = tracker.material(new MeshStandardMaterial({ color: c, roughness: 0.85 })); mats.set(c, m); }
    return m;
  };
  const label = (text: string, bubble: boolean): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      g.font = '30px "Cubic 11", system-ui, "PingFang TC", sans-serif';
      const w = Math.min(240, g.measureText(text).width + 28);
      g.fillStyle = 'rgba(29, 51, 38, 0.82)';
      g.beginPath();
      g.roundRect(128 - w / 2, 78, w, 42, 21);
      g.fill();
      g.fillStyle = '#fffdf6';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 100);
      if (bubble) {
        g.fillStyle = '#f2c230';
        g.beginPath(); g.arc(128, 36, 30, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1d3326';
        g.font = 'bold 40px system-ui, sans-serif';
        g.fillText('!', 128, 38);
      }
    }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  };

  interface Live { root: Group; trunk: Group; armR: Mesh; armL: Mesh; tag: Sprite; spec: NpcSpec; yaw: number; seed: number }
  const live = new Map<string, Live>();

  const make = (s: NpcSpec): Live => {
    const root = new Group();
    const trunk = new Group();
    trunk.position.y = LEG + 0.02;
    const torso = new Mesh(torsoGeo, mat(s.look.shirt));
    const head = new Mesh(headGeo, skin);
    const hair = new Mesh(s.look.hat !== undefined ? hatGeo : hairGeo, mat(s.look.hat ?? s.look.hair));
    const armL = new Mesh(armGeo, mat(s.look.shirt));
    const armR = new Mesh(armGeo, mat(s.look.shirt));
    armL.position.set(-0.24, 0.55, 0);
    armR.position.set(0.24, 0.55, 0);
    trunk.add(torso, head, hair, armL, armR);
    for (const side of [-1, 1]) {
      const leg = new Mesh(legGeo, mat(s.look.pants));
      leg.position.set(side * 0.1, LEG + 0.02, 0);
      root.add(leg);
    }
    const tag = new Sprite(tracker.material(new SpriteMaterial({ map: label(s.name, !!s.talk), depthTest: false, transparent: true })));
    tag.scale.set(1.6, 0.8, 1);
    tag.position.y = 2.15;
    tag.renderOrder = 9;
    root.add(trunk, tag);
    for (const m of [torso, head, hair, armL, armR]) m.castShadow = true;
    root.position.set(s.x, (s.y ?? 0) + 0.02, s.z);
    scene.add(root);
    return { root, trunk, armR, armL, tag, spec: s, yaw: Math.random() * Math.PI * 2, seed: Math.random() * 10 };
  };

  return {
    set(list) {
      const keep = new Map(list.map((s) => [s.key, s]));
      for (const [k, l] of live) {
        const s = keep.get(k);
        if (!s || s.talk !== l.spec.talk || s.name !== l.spec.name) { scene.remove(l.root); live.delete(k); }
      }
      for (const s of list) {
        const l = live.get(s.key);
        if (l) l.root.position.set(s.x, (s.y ?? 0) + 0.02, s.z);
        else live.set(s.key, make(s));
      }
    },
    update(dt, time, px, pz) {
      for (const l of live.values()) {
        const dx = px - l.root.position.x, dz = pz - l.root.position.z;
        const d = Math.hypot(dx, dz);
        l.root.visible = d < 120;
        if (!l.root.visible) continue;
        // Face the player when near, otherwise idle in place.
        if (d < 12) {
          let dy = Math.atan2(dx, dz) - l.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          l.yaw += dy * Math.min(1, dt * 4);
        }
        l.root.rotation.y = l.yaw;
        const breathe = Math.sin(time * 2 + l.seed);
        l.trunk.scale.y = 1 + breathe * 0.012;
        // Wave when you come close.
        const wave = d < 6 ? Math.sin(time * 9 + l.seed) * 0.35 : 0;
        l.armR.rotation.z = d < 6 ? 2.5 + wave : 0.08;
        l.armL.rotation.z = -0.08;
        l.tag.position.y = 2.15 + (l.spec.talk ? Math.abs(Math.sin(time * 3 + l.seed)) * 0.12 : 0);
      }
    },
    dispose() {
      for (const l of live.values()) scene.remove(l.root);
      live.clear();
    },
  };
}
