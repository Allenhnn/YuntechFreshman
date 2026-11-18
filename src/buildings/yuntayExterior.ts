import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { BuildingSource } from './buildingTypes';
import { createPlanTransform } from './planTransform';
import frame from './yuntayFrame.json';

/**
 * 雲泰表演廳 outside, from photos of the building (the campus extrusion only gives a 7.2 m box):
 *  - the curved east front: a colonnade of square piers under a dark grey canopy band, standing on a
 *    raised walk with steps down to the plaza, globe lamp posts along the steps;
 *  - the auditorium drum rising above the 2-storey wings in light grey panels with a dark cornice,
 *    and the stage fly tower behind it;
 *  - the A門 portal on the south: a deep grey frame with 「雲泰表演廳 Yun Tay Performance Hall」;
 *  - the dark grey sign pylon by the south walk.
 * Laid out in the plan frame of the traced interior (scripts/floorplan/handbuilt/yuntay.py writes
 * yuntayFrame.json), so it stays in register with the rooms inside.
 */
const SHELL = frame.shellHeight;
const DRUM_TOP = 11.6;
const FLY_TOP = 15.5;
const [CX, CY, R] = frame.outer as [number, number, number];
const th = (x: number): number => Math.asin((x - CX) / R);
const TH0 = th(frame.arcX[0]!), TH1 = th(frame.arcX[1]!);
/** Point on the facade circle grown by `d` metres, at angle `t` (plan x, plan y). */
const onArc = (t: number, d = 0): [number, number] => [CX + (R + d) * Math.sin(t), CY - (R + d) * Math.cos(t)];

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, tracker: ResourceTracker): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = tracker.texture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Vertical ribbon along a polyline (plan x, plan y) from y0 to y1; u runs in metres. */
function ribbon(pts: [number, number][], y0: number, y1: number, uScale = 1, vScale = 1): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let u = 0;
  pts.forEach(([x, z], i) => {
    if (i > 0) u += Math.hypot(x - pts[i - 1]![0], z - pts[i - 1]![1]);
    pos.push(x, y0, z, x, y1, z);
    uv.push(u / uScale, 0, u / uScale, (y1 - y0) / vScale);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Horizontal strip between the facade circle grown by d0 and by d1, at height y. */
function annulus(t0: number, t1: number, d0: number, d1: number, y: number, n: number): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const [ax, az] = onArc(t, d0), [bx, bz] = onArc(t, d1);
    pos.push(ax, y, az, bx, y, bz);
    uv.push(ax / 2, az / 2, bx / 2, bz / 2);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const arcPts = (t0: number, t1: number, d: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => onArc(t0 + ((t1 - t0) * i) / n, d));

/** World rings kept free of campus trees: the colonnade walk and steps, the portal and the pylon. */
export function yuntayTreeFree(): number[][] {
  const xf = createPlanTransform({ transform: frame.transform } as unknown as BuildingSource);
  const band = [...arcPts(TH0, TH1, -0.5, 48), ...arcPts(TH0, TH1, 7, 48).reverse()];
  const [x0, y0, x1, y1] = frame.portal as [number, number, number, number];
  const [px, py] = frame.pylon as [number, number];
  const rect = (a: number, b: number, c: number, d: number): [number, number][] => [[a, b], [c, b], [c, d], [a, d]];
  return [band, rect(x0 - 3, y0, x1 + 3, y1 + 4), rect(px - 2.5, py - 2.5, px + 2.5, py + 2.5)].map((r) => r.flatMap(([x, y]) => xf.toWorld(x, y)));
}

export function createYuntayExterior(scene: Scene, physics: RAPIER.World, tracker: ResourceTracker): { dispose(): void } {
  const xf = createPlanTransform({ transform: frame.transform } as unknown as BuildingSource);
  const [ox, oz] = xf.toWorld(0, 0), [px, pz] = xf.toWorld(1, 0);
  const groupYaw = -Math.atan2(pz - oz, px - ox);
  const g = new Group();
  g.name = '雲泰表演廳 exterior';
  g.position.set(ox, 0, oz);
  g.rotation.y = groupYaw; // local +x = plan X, local +z = plan Y
  scene.add(g);

  const colliders: RAPIER.Collider[] = [];
  /** Box collider: plan centre, height centre, half extents along / across `yaw` (local frame). */
  const solid = (x: number, y: number, z: number, hw: number, hh: number, hd: number, yaw = 0): void => {
    const [wx, wz] = xf.toWorld(x, z);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), groupYaw + yaw);
    colliders.push(tracker.collider(physics.createCollider(
      RAPIER.ColliderDesc.cuboid(hw, hh, hd).setTranslation(wx, y, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )));
  };
  const add = (geo: BufferGeometry, mat: Material | Material[], shadow = true): Mesh => {
    const m = new Mesh(tracker.geometry(geo), mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const mat = (color: number, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}): MeshStandardMaterial =>
    tracker.material(new MeshStandardMaterial({ color, roughness: 0.85, side: DoubleSide, ...extra }));

  const darkBand = mat(0x5e6265);
  const pier = mat(0xc9cbca);
  const paving = mat(0xb8b5ae, { roughness: 0.95 });
  // Light grey cladding panels (1.2 m wide, 0.9 m courses) for the drum and the fly tower.
  const panels = canvasTexture(128, 96, (c) => {
    c.fillStyle = '#b4b7b8';
    c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#979a9b';
    c.fillRect(0, 0, 128, 3);
    c.fillRect(0, 0, 2, 96);
  }, tracker);
  const cladding = (w: number, h: number): MeshStandardMaterial => {
    const t = panels.clone();
    t.needsUpdate = true;
    tracker.texture(t);
    t.repeat.set(w / 1.2, h / 0.9);
    return mat(0xffffff, { map: t });
  };

  // --- Drum over the auditorium side: curved front, straight back walls, roof, cornice. ------------
  const N = 72;
  const front = arcPts(TH0, TH1, 0.02, N);
  const [ax0, ay0] = front[0]!, [ax1, ay1] = front[N]!;
  const back: [number, number][] = [[ax1, ay1], [ax1, 120.5], [ax0, 120.5], [ax0, ay0]];
  const panelMat = cladding(1, 1);
  panelMat.map!.repeat.set(1 / 1.2, 1 / 0.9);
  add(ribbon(front, SHELL, DRUM_TOP), panelMat);
  add(ribbon(back, SHELL, DRUM_TOP), panelMat);
  const outline = [...front, ...back.slice(1, 3)];
  const roofShape = new Shape();
  outline.forEach(([x, z], i) => (i ? roofShape.lineTo(x, -z) : roofShape.moveTo(x, -z)));
  add(new ShapeGeometry(roofShape).rotateX(-Math.PI / 2).translate(0, DRUM_TOP, 0), mat(0xa9aaa6, { roughness: 0.95 }), false);
  // Dark cornice band and a dark reveal where the drum meets the wings' roof.
  add(ribbon(arcPts(TH0, TH1, 0.15, N), DRUM_TOP - 0.7, DRUM_TOP + 0.3), darkBand);
  add(ribbon(arcPts(TH0, TH1, -0.1, N), SHELL, SHELL + 0.6), darkBand);

  // --- Fly tower over the stage. -------------------------------------------------------------------
  {
    const [x0, y0, x1, y1] = frame.flyTower as [number, number, number, number];
    const w = x1 - x0, d = y1 - y0, h = FLY_TOP - SHELL;
    const side = cladding(w, h), end = cladding(d, h);
    const top = mat(0xa9aaa6, { roughness: 0.95 });
    const box = add(new BoxGeometry(w, h, d), [end, end, top, top, side, side]);
    box.position.set((x0 + x1) / 2, SHELL + h / 2, (y0 + y1) / 2);
    const cap = add(new BoxGeometry(w + 0.3, 0.5, d + 0.3), darkBand);
    cap.position.set((x0 + x1) / 2, FLY_TOP + 0.05, (y0 + y1) / 2);
  }

  // --- Colonnade, raised walk and steps along the curved front. ------------------------------------
  const t0 = TH0 + 0.012, t1 = TH1 - 0.012;
  const WALK = 3.0, STEP = 0.4, FLOOR = 0.45, CANOPY0 = 4.6, CANOPY1 = 5.4;
  const n = 96;
  add(annulus(t0, t1, 0, WALK, FLOOR, n), paving, false);
  add(annulus(t0, t1, WALK, WALK + STEP, FLOOR - 0.15, n), paving, false);
  add(annulus(t0, t1, WALK + STEP, WALK + 2 * STEP, FLOOR - 0.3, n), paving, false);
  add(ribbon(arcPts(t0, t1, WALK, n), FLOOR - 0.15, FLOOR), paving, false);
  add(ribbon(arcPts(t0, t1, WALK + STEP, n), FLOOR - 0.3, FLOOR - 0.15), paving, false);
  add(ribbon(arcPts(t0, t1, WALK + 2 * STEP, n), 0, FLOOR - 0.3), paving, false);
  for (const t of [t0, t1]) {
    const [a, b] = [onArc(t, 0), onArc(t, WALK + 2 * STEP)];
    add(ribbon([a, b], 0, FLOOR), paving, false);
  }
  // Canopy band: underside, top and the dark fascia.
  add(annulus(t0, t1, 0, WALK, CANOPY0, n), mat(0x7a7e81), false);
  add(annulus(t0, t1, 0, WALK, CANOPY1, n), darkBand, false);
  add(ribbon(arcPts(t0, t1, WALK, n), CANOPY0, CANOPY1), darkBand);
  // Collision for the walk and steps: tangent boxes along the arc.
  const segs = 64;
  for (let i = 0; i < segs; i++) {
    const t = t0 + ((t1 - t0) * (i + 0.5)) / segs;
    const len = ((t1 - t0) / segs) * (R + WALK);
    for (const [d0, d1, top] of [[0, WALK, FLOOR], [WALK, WALK + STEP, FLOOR - 0.15], [WALK + STEP, WALK + 2 * STEP, FLOOR - 0.3]] as const) {
      const [x, z] = onArc(t, (d0 + d1) / 2);
      solid(x, top / 2, z, len / 2 + 0.03, top / 2, (d1 - d0) / 2, -t);
    }
  }
  // Square piers every ~4.4 m, and a globe lamp on a pedestal in front of every third.
  const pierGeo = tracker.geometry(new BoxGeometry(0.7, CANOPY0 - FLOOR, 0.7));
  const poleGeo = tracker.geometry(new CylinderGeometry(0.09, 0.12, 3.6, 10));
  const globeGeo = tracker.geometry(new SphereGeometry(0.24, 16, 12));
  const baseGeo = tracker.geometry(new BoxGeometry(0.6, 0.45, 0.6));
  const glow = mat(0xffffff, { emissive: 0xfff6e0, emissiveIntensity: 0.6, roughness: 0.3 });
  const count = Math.floor(((t1 - t0) * (R + 2.3)) / 4.4);
  for (let i = 0; i <= count; i++) {
    const t = t0 + 0.006 + ((t1 - t0 - 0.012) * i) / count;
    const [x, z] = onArc(t, 2.3);
    const p = new Mesh(pierGeo, pier);
    p.position.set(x, FLOOR + (CANOPY0 - FLOOR) / 2, z);
    p.rotation.y = -t;
    p.castShadow = p.receiveShadow = true;
    g.add(p);
    solid(x, FLOOR + (CANOPY0 - FLOOR) / 2, z, 0.35, (CANOPY0 - FLOOR) / 2, 0.35, -t);
    if (i % 3 !== 1) continue;
    const [lx, lz] = onArc(t, WALK + 2 * STEP + 0.8);
    const base = new Mesh(baseGeo, pier);
    base.position.set(lx, 0.225, lz);
    const pole = new Mesh(poleGeo, pier);
    pole.position.set(lx, 0.45 + 1.8, lz);
    const globe = new Mesh(globeGeo, glow);
    globe.position.set(lx, 0.45 + 3.6 + 0.22, lz);
    for (const m of [base, pole, globe]) {
      m.castShadow = true;
      g.add(m);
    }
    solid(lx, 2.2, lz, 0.3, 2.2, 0.3);
  }

  // --- A門 portal with the name. ------------------------------------------------------------------
  {
    const [x0, y0, x1, y1] = frame.portal as [number, number, number, number];
    const PW = 0.8, out = 0.9, top = 6.8, lintel0 = 5.0;
    const frameMat = mat(0x6b6f72);
    const depth = y1 - y0 + out;
    const cy = y0 + depth / 2;
    for (const x of [x0 - PW / 2, x1 + PW / 2]) {
      const m = add(new BoxGeometry(PW, top, depth), frameMat);
      m.position.set(x, top / 2, cy);
      solid(x, top / 2, cy, PW / 2, top / 2, depth / 2);
    }
    const W = x1 - x0 + 2 * PW;
    const name = canvasTexture(2048, 320, (c) => {
      c.fillStyle = '#6b6f72';
      c.fillRect(0, 0, 2048, 320);
      c.fillStyle = '#3b3f43';
      c.textBaseline = 'middle';
      c.font = '700 150px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
      c.textAlign = 'right';
      c.fillText('雲 泰 表 演 廳', 1250, 165);
      c.textAlign = 'left';
      c.font = '700 66px system-ui, sans-serif';
      c.fillText('Yun Tay', 1320, 120);
      c.fillText('Performance Hall', 1320, 205);
    }, tracker);
    const nameMat = tracker.material(new MeshStandardMaterial({ map: name, roughness: 0.8 }));
    const lintel = add(new BoxGeometry(W, top - lintel0, depth), [frameMat, frameMat, frameMat, frameMat, nameMat, frameMat]);
    lintel.position.set((x0 + x1) / 2, (top + lintel0) / 2, cy);
  }

  // --- Sign pylon by the south walk. ---------------------------------------------------------------
  {
    const [x, z] = frame.pylon as [number, number];
    const face = canvasTexture(256, 1024, (c) => {
      c.fillStyle = '#5a5754';
      c.fillRect(0, 0, 256, 1024);
      c.fillStyle = '#d9dadb';
      c.textAlign = 'center';
      c.font = '700 120px "Noto Sans TC", "PingFang TC", sans-serif';
      '雲泰表演廳'.split('').forEach((ch, i) => c.fillText(ch, 165, 175 + i * 150));
      c.save();
      c.translate(70, 120);
      c.rotate(Math.PI / 2);
      c.font = '600 46px system-ui, sans-serif';
      c.fillText('Yun Tay Performance Hall', 330, 0);
      c.restore();
      c.fillStyle = '#4a4744';
      for (let i = 0; i < 3; i++) c.fillRect(100 + i * 24, 900, 12, 90);
    }, tracker);
    const faceMat = tracker.material(new MeshStandardMaterial({ map: face, roughness: 0.7 }));
    const body = mat(0x5a5754);
    const m = add(new BoxGeometry(1.1, 4.6, 0.45), [body, body, body, body, faceMat, faceMat]);
    m.position.set(x, 2.3, z);
    solid(x, 2.3, z, 0.55, 2.3, 0.23);
  }

  return {
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      g.removeFromParent();
    },
  };
}
