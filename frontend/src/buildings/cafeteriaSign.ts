import { CanvasTexture, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Scene } from 'three';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from '../campus/campusTypes';
import { buildingEntrance } from '../campus/entrances';

/** The name board over the 學生餐廳 entrance, above its canopy. */
export function addCafeteriaSign(scene: Scene, campus: CampusData, tracker: ResourceTracker): void {
  const b = campus.buildings.find((x) => x.name === '學生餐廳');
  const e = b && buildingEntrance(b, campus.roads);
  if (!b || !e) return;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#1f8f4a';
    g.fillRect(0, 0, 1024, 192);
    g.fillStyle = '#fffdf6';
    g.font = "800 120px system-ui, 'PingFang TC', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('學生餐廳', 512, 100);
  }
  const tex = tracker.texture(new CanvasTexture(c));
  tex.colorSpace = SRGBColorSpace;
  const r = b.outer, n = r.length / 2, j = (e.edge + 1) % n;
  const dx = r[j * 2]! - r[e.edge * 2]!, dz = r[j * 2 + 1]! - r[e.edge * 2 + 1]!, len = Math.hypot(dx, dz);
  const nx = dz / len, nz = -dx / len; // outward
  const sign = new Mesh(tracker.geometry(new PlaneGeometry(9, 1.7)), tracker.material(new MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));
  sign.position.set(r[e.edge * 2]! + (dx / len) * e.along + nx * 0.18, 5, r[e.edge * 2 + 1]! + (dz / len) * e.along + nz * 0.18);
  sign.rotation.y = Math.atan2(nx, nz);
  scene.add(sign);
}
