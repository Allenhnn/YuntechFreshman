import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';

/**
 * Quest beacons: a soft column of light with a floating, bobbing icon badge over each quest target,
 * so objectives read from across campus (the column clears the fog-free 190 m range above the trees).
 * Reconciled by key each update; fades out as the player arrives.
 */
export interface Beacon {
  key: string;
  x: number;
  z: number;
  icon: string;
  color: number;
  /** Main objective: taller, brighter. */
  main?: boolean;
}

export interface Beacons {
  set(list: readonly Beacon[]): void;
  update(time: number, px: number, pz: number): void;
  dispose(): void;
}

export function createBeacons(scene: Scene, tracker: ResourceTracker): Beacons {
  const beamGeo = tracker.geometry(new CylinderGeometry(0.9, 1.4, 40, 16, 1, true).translate(0, 20, 0));
  const ringGeo = tracker.geometry(new RingGeometry(1.6, 2.2, 32).rotateX(-Math.PI / 2));
  const textures = new Map<string, CanvasTexture>();
  const badge = (icon: string, color: number): CanvasTexture => {
    const k = `${icon}|${color}`;
    let t = textures.get(k);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = `#${new Color(color).getHexString()}`;
      g.beginPath();
      g.arc(64, 58, 50, 0, Math.PI * 2);
      g.fill();
      g.beginPath(); // pointer under the bubble
      g.moveTo(48, 100); g.lineTo(80, 100); g.lineTo(64, 124); g.closePath();
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.arc(64, 58, 46, 0, Math.PI * 2);
      g.stroke();
      g.font = '56px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(icon, 64, 62);
    }
    t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    textures.set(k, t);
    return t;
  };

  interface Live { group: Group; beam: Mesh; ring: Mesh; sprite: Sprite; b: Beacon; seed: number }
  const live = new Map<string, Live>();

  const make = (b: Beacon): Live => {
    const group = new Group();
    const beamMat = tracker.material(new MeshBasicMaterial({ color: b.color, transparent: true, opacity: b.main ? 0.28 : 0.2, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    const beam = new Mesh(beamGeo, beamMat);
    beam.scale.set(b.main ? 1.2 : 0.8, b.main ? 1.3 : 1, b.main ? 1.2 : 0.8);
    const ringMat = tracker.material(new MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.6, depthWrite: false }));
    const ring = new Mesh(ringGeo, ringMat);
    ring.position.y = 0.06;
    const sprite = new Sprite(tracker.material(new SpriteMaterial({ map: badge(b.icon, b.color), depthTest: false, transparent: true })));
    sprite.renderOrder = 10;
    group.add(beam, ring, sprite);
    group.position.set(b.x, 0, b.z);
    scene.add(group);
    return { group, beam, ring, sprite, b, seed: Math.random() * 10 };
  };

  return {
    set(list) {
      const keep = new Set(list.map((b) => b.key));
      for (const [k, l] of live) {
        if (!keep.has(k)) { scene.remove(l.group); live.delete(k); }
      }
      for (const b of list) {
        const cur = live.get(b.key);
        if (cur && (cur.b.icon !== b.icon || cur.b.color !== b.color || cur.b.main !== b.main)) { scene.remove(cur.group); live.delete(b.key); }
        const l = live.get(b.key);
        if (l) { l.group.position.set(b.x, 0, b.z); l.b = b; } else live.set(b.key, make(b));
      }
    },
    update(time, px, pz) {
      for (const l of live.values()) {
        const d = Math.hypot(l.b.x - px, l.b.z - pz);
        // Shrink the badge up close (it would fill the view), fade the beam as you arrive.
        const near = Math.min(1, Math.max(0, (d - 6) / 30));
        const size = 2.2 + near * 2.6;
        l.sprite.scale.set(size, size, 1);
        l.sprite.position.y = 5 + near * 6 + Math.sin(time * 2 + l.seed) * 0.4;
        (l.beam.material as MeshBasicMaterial).opacity = (l.b.main ? 0.3 : 0.2) * (0.25 + 0.75 * near);
        l.ring.scale.setScalar(1 + ((time * 0.8 + l.seed) % 1) * 0.6);
        (l.ring.material as MeshBasicMaterial).opacity = 0.6 * (1 - ((time * 0.8 + l.seed) % 1));
        l.group.visible = d < 260;
      }
    },
    dispose() {
      for (const l of live.values()) scene.remove(l.group);
      live.clear();
    },
  };
}
