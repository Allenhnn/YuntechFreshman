import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData, Ring } from './campusTypes';

/**
 * 學生宿舍E.F 施工中（使用者 2026-11-26：把 E、F 棟外圍圍起來、寫施工中）：一圈 2.4 m 高的鐵皮施工圍籬，沿兩棟合起來的
 * 凸包往外 3 m（兩翼之間那兩道圍牆和門都圍在裡面）。白色浪板、底下一條藍色帶、上緣黃黑警示帶，每 2.5 m 一根灰色立柱；
 * 外側每隔約 16 m 掛一塊黃底「施工中」告示牌。整圈都擋住（碰撞），導航也繞開。
 */
const SITE_IDS = [292500724, 296668591] as const; // 學生宿舍E, 學生宿舍F
const OFFSET = 3;
const H = 2.4;
const T = 0.08;
const POST = 2.5;
const SIGN_EVERY = 16;
const SIGN_W = 2.2;
const SIGN_H = 1.3;

type Pt = [number, number];

function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]; // CCW in x/z (positive signed area), like building rings
}

/** The fence line: E and F's convex hull pushed out OFFSET metres (mitred corners). Empty if the buildings are missing. */
export function constructionRing(campus: CampusData): Pt[] {
  const pts: Pt[] = [];
  for (const id of SITE_IDS) {
    const r = campus.buildings.find((b) => b.id === id)?.outer;
    if (!r) return [];
    for (let i = 0; i < r.length; i += 2) pts.push([r[i]!, r[i + 1]!]);
  }
  const h = hull(pts), n = h.length;
  // Outward normal of edge i (CCW): (dz, −dx).
  const normal = (i: number): Pt => {
    const a = h[i]!, b = h[(i + 1) % n]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  };
  return h.map((p, i) => {
    const n0 = normal((i - 1 + n) % n), n1 = normal(i);
    const mx = n0[0] + n1[0], mz = n0[1] + n1[1], dot = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    const k = OFFSET / Math.max(dot, 0.3); // mitre: OFFSET / cos(half angle), as a multiple of (n0 + n1)
    return [Math.round((p[0] + mx * k) * 100) / 100, Math.round((p[1] + mz * k) * 100) / 100];
  });
}

/** The fenced area (flat ring) — a navigation obstacle with no door. */
export function constructionSite(campus: CampusData): Ring | null {
  const r = constructionRing(campus);
  return r.length ? r.flatMap((p) => p) : null;
}

/** Keep the street-tree scatter off the fence line (a band either side of each run). */
export function constructionTreeFree(campus: CampusData): Ring[] {
  const r = constructionRing(campus), out: Ring[] = [];
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i]!, [bx, bz] = r[(i + 1) % r.length]!;
    const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * 1.6, nz = (bx - ax) / l * 1.6;
    out.push([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
  }
  return out;
}

function canvas(tracker: ResourceTracker, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface ConstructionFence {
  dispose(): void;
}

export function createConstructionFence(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): ConstructionFence {
  const ring = constructionRing(campus);
  const root = new Group();
  root.name = '學生宿舍E.F 施工圍籬';
  scene.add(root);
  const colliders: RAPIER.Collider[] = [];
  if (ring.length < 3) return { dispose() { root.removeFromParent(); } };

  const font = "'Cubic 11', 'PingFang TC', 'Noto Sans TC', system-ui, sans-serif";
  // One 2.5 m bay of corrugated sheet: white with a blue foot band and a yellow/black hazard strip along the top.
  const sheet = canvas(tracker, 256, 256, (g) => {
    g.fillStyle = '#eef0ee'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(x, 0, 5, 256); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x + 8, 0, 3, 256); }
    g.fillStyle = '#1f5fa8'; g.fillRect(0, 200, 256, 56);
    g.save(); g.beginPath(); g.rect(0, 0, 256, 26); g.clip();
    g.fillStyle = '#f2c200'; g.fillRect(0, 0, 256, 26);
    g.fillStyle = '#1b1b1b';
    for (let x = -40; x < 300; x += 32) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x + 16, 26); g.lineTo(x + 42, 0); g.lineTo(x + 26, 0); g.fill(); }
    g.restore();
  });
  sheet.wrapS = RepeatWrapping;
  const sign = canvas(tracker, 512, 304, (g) => {
    g.fillStyle = '#f5c400'; g.fillRect(0, 0, 512, 304);
    g.strokeStyle = '#141414'; g.lineWidth = 14; g.strokeRect(10, 10, 492, 284);
    g.fillStyle = '#d11d1d'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 120px ${font}`; g.fillText('施工中', 256, 120, 470);
    g.fillStyle = '#141414'; g.font = `700 46px ${font}`; g.fillText('閒人勿進・注意安全', 256, 232, 460);
  });

  const sheetMat = tracker.material(new MeshStandardMaterial({ map: sheet, roughness: 0.6, metalness: 0.2 }));
  const postMat = tracker.material(new MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.4 }));
  const signMat = tracker.material(new MeshStandardMaterial({ map: sign, roughness: 0.7 }));
  const posts: BufferGeometry[] = [];
  const q = new Quaternion(), up = new Vector3(0, 1, 0);

  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, yaw = Math.atan2(-uz, ux);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    // Sheet: a thin box, its faces mapped one bay per POST metres.
    const geo = new BoxGeometry(len, H, T);
    const uv = geo.attributes.uv!.array as Float32Array;
    for (let k = 0; k < uv.length; k += 2) uv[k] = uv[k]! * (len / POST);
    const wall = new Mesh(tracker.geometry(geo), sheetMat);
    wall.position.set(cx, H / 2, cz);
    wall.rotation.y = yaw;
    wall.castShadow = wall.receiveShadow = true;
    root.add(wall);
    // Posts on the inside face, every POST metres (and at both ends).
    const nIn: Pt = [-uz, ux]; // inward for a CCW ring is (−dz, dx)
    const steps = Math.max(1, Math.round(len / POST));
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * len, px = ax + ux * t + nIn[0] * 0.07, pz = az + uz * t + nIn[1] * 0.07;
      posts.push(new BoxGeometry(0.08, H + 0.1, 0.08).translate(px, (H + 0.1) / 2, pz));
    }
    // 施工中 signs on the outside face.
    const nSigns = len >= 8 ? Math.max(1, Math.round(len / SIGN_EVERY)) : 0;
    for (let s = 0; s < nSigns; s++) {
      const t = ((s + 0.5) / nSigns) * len;
      const m = new Mesh(tracker.geometry(new PlaneGeometry(SIGN_W, SIGN_H)), signMat);
      m.position.set(ax + ux * t - nIn[0] * (T / 2 + 0.02), 1.45, az + uz * t - nIn[1] * (T / 2 + 0.02));
      m.rotation.y = yaw + Math.PI; // face outward
      root.add(m);
    }
    q.setFromAxisAngle(up, yaw);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, H / 2, 0.15).setTranslation(cx, H / 2, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  }
  if (posts.length) {
    const g = mergeGeometries(posts.map((p) => p.toNonIndexed()));
    if (g) {
      const m = new Mesh(tracker.geometry(g), postMat);
      m.castShadow = true;
      root.add(m);
    }
  }
  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      root.removeFromParent();
    },
  };
}
