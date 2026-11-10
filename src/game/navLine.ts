import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  type Scene,
} from 'three';
import type { ResourceTracker } from '../core/resources';

/** Ground guide for navigation: a flowing chevron ribbon along the route and a bobbing pin at the goal. */
export interface NavLine {
  /** Shows `path` (flat x, z) ending at the goal, or hides everything with null. */
  set(path: readonly number[] | null): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

const WIDTH = 0.9;
const Y = 0.11;
const TILE = 1.4; // m of ribbon per chevron

export function createNavLine(scene: Scene, tracker: ResourceTracker): NavLine {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(47, 111, 208, 0.82)';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(40, 12);
    g.lineTo(76, 32);
    g.lineTo(40, 52);
    g.stroke();
  }
  const tex = tracker.texture(new CanvasTexture(c));
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  const mat = tracker.material(new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  const ribbon = new Mesh(new BufferGeometry(), mat);
  ribbon.renderOrder = 2;
  ribbon.frustumCulled = false;
  ribbon.visible = false;
  scene.add(ribbon);

  const pin = new Group();
  const pinMat = tracker.material(new MeshBasicMaterial({ color: 0x2f6fd0 }));
  const cone = new Mesh(tracker.geometry(new ConeGeometry(0.55, 1.3, 20).rotateX(Math.PI)), pinMat);
  cone.position.y = 2.6;
  const ring = new Mesh(tracker.geometry(new TorusGeometry(1.1, 0.12, 8, 32).rotateX(Math.PI / 2)), tracker.material(new MeshBasicMaterial({ color: 0x2f6fd0, transparent: true, opacity: 0.85 })));
  ring.position.y = 0.15;
  pin.add(cone, ring);
  pin.visible = false;
  scene.add(pin);

  return {
    set(path) {
      if (!path || path.length < 4) {
        ribbon.visible = pin.visible = false;
        return;
      }
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let along = 0;
      for (let i = 0; i + 3 < path.length; i += 2) {
        const ax = path[i]!, az = path[i + 1]!, bx = path[i + 2]!, bz = path[i + 3]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const sx = (-(bz - az) / len) * (WIDTH / 2), sz = ((bx - ax) / len) * (WIDTH / 2);
        const v = pos.length / 3;
        pos.push(ax + sx, Y, az + sz, bx + sx, Y, bz + sz, bx - sx, Y, bz - sz, ax - sx, Y, az - sz);
        uv.push(along / TILE, 1, (along + len) / TILE, 1, (along + len) / TILE, 0, along / TILE, 0);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2, v, v + 1, v + 2, v, v + 2, v + 3); // both faces
        along += len;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      geo.setIndex(idx);
      ribbon.geometry.dispose();
      ribbon.geometry = geo;
      ribbon.visible = true;
      pin.position.set(path[path.length - 2]!, 0, path[path.length - 1]!);
      pin.visible = true;
    },
    update(dt, time) {
      if (!ribbon.visible) return;
      tex.offset.x -= dt * 1.2; // chevrons flow toward the goal
      cone.position.y = 2.6 + Math.sin(time * 3) * 0.25;
      cone.rotation.y = time * 1.5;
      ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    },
    dispose() {
      ribbon.geometry.dispose();
      ribbon.removeFromParent();
      pin.removeFromParent();
    },
  };
}
