import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from './campusTypes';

/**
 * The no-go zone around campus: grey ground outside the boundary, a red-and-white hatched band
 * just outside the line, an iron fence along it and red 「禁止進入」 signs every 40 m. Collision is
 * the existing invisible boundary wall; this is the visible half. `skip` leaves gaps (main gate).
 */
const FENCE_OFFSET = 0.25; // m outside the boundary line, clear of the invisible wall
const POST_STEP = 2.5;
const SIGN_STEP = 40;
const BAND_W = 3;

function texture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, tracker: ResourceTracker): CanvasTexture {
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

export function addBoundaryZone(scene: Scene, campus: CampusData, tracker: ResourceTracker, skip: (x: number, z: number) => boolean): void {
  const ring = campus.boundary;
  const n = ring.length / 2;

  // --- Grey ground everywhere outside the boundary.
  const span = 4000;
  const shape = new Shape();
  shape.moveTo(-span / 2, -span / 2).lineTo(span / 2, -span / 2).lineTo(span / 2, span / 2).lineTo(-span / 2, span / 2).closePath();
  const hole = new Path();
  for (let i = 0; i < n; i++) {
    if (i === 0) hole.moveTo(ring[0]!, -ring[1]!);
    else hole.lineTo(ring[i * 2]!, -ring[i * 2 + 1]!);
  }
  hole.closePath();
  shape.holes.push(hole);
  const outside = new Mesh(
    tracker.geometry(new ShapeGeometry(shape).rotateX(-Math.PI / 2)),
    tracker.material(new MeshStandardMaterial({ color: 0x9a9893, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
  );
  outside.position.y = 0.01;
  outside.receiveShadow = true;
  scene.add(outside);

  // --- Hatched warning band just outside the line (one quad per edge, UVs along the edge).
  const hatch = texture(128, 128, (g) => {
    g.fillStyle = '#f3f1ea';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#c8302a';
    for (let k = -128; k < 256; k += 64) {
      g.beginPath();
      g.moveTo(k, 128);
      g.lineTo(k + 32, 128);
      g.lineTo(k + 160, 0);
      g.lineTo(k + 128, 0);
      g.closePath();
      g.fill();
    }
  }, tracker);
  hatch.wrapS = hatch.wrapT = RepeatWrapping;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let along = 0;
  const edges: { ax: number; az: number; ux: number; uz: number; ox: number; oz: number; len: number; start: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2]!, az = ring[i * 2 + 1]!, bx = ring[j * 2]!, bz = ring[j * 2 + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const ox = uz, oz = -ux; // the ring is CCW in x/z: (dz, −dx) points out of campus
    edges.push({ ax, az, ux, uz, ox, oz, len, start: along });
    const v = pos.length / 3;
    pos.push(ax, 0.05, az, bx, 0.05, bz, bx + ox * BAND_W, 0.05, bz + oz * BAND_W, ax + ox * BAND_W, 0.05, az + oz * BAND_W);
    uv.push(along / BAND_W, 0, (along + len) / BAND_W, 0, (along + len) / BAND_W, 1, along / BAND_W, 1);
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    along += len;
  }
  const bandGeo = new BufferGeometry();
  bandGeo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  bandGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  bandGeo.setIndex(idx);
  bandGeo.computeVertexNormals();
  const band = new Mesh(tracker.geometry(bandGeo), tracker.material(new MeshStandardMaterial({ map: hatch, roughness: 0.9, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
  band.receiveShadow = true;
  scene.add(band);

  // --- Fence: posts every 2.5 m, two rails per run; signs every 40 m facing into campus.
  const posts: [number, number][] = [];
  const rails: BoxGeometry[] = [];
  const signs: { x: number; z: number; yaw: number }[] = [];
  let nextSign = SIGN_STEP / 2;
  for (const e of edges) {
    const at = (t: number): [number, number] => [e.ax + e.ux * t + e.ox * FENCE_OFFSET, e.az + e.uz * t + e.oz * FENCE_OFFSET];
    // Split the edge into runs that avoid the skipped areas.
    const steps = Math.max(1, Math.ceil(e.len / POST_STEP));
    let runStart: number | null = null;
    const flushRun = (t1: number): void => {
      if (runStart === null || t1 - runStart < 0.5) { runStart = null; return; }
      const [x0, z0] = at(runStart), [x1, z1] = at(t1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(-(z1 - z0), x1 - x0);
      for (const y of [0.45, 1.05]) {
        rails.push(new BoxGeometry(len, 0.06, 0.05).rotateY(yaw).translate((x0 + x1) / 2, y, (z0 + z1) / 2) as BoxGeometry);
      }
      runStart = null;
    };
    for (let k = 0; k <= steps; k++) {
      const t = (e.len * k) / steps;
      const [x, z] = at(t);
      if (skip(x, z)) {
        flushRun(Math.max(0, t - e.len / steps));
        continue;
      }
      if (runStart === null) runStart = t;
      if (k < steps || e === edges[edges.length - 1]) posts.push([x, z]);
    }
    flushRun(e.len);
    while (nextSign < e.start + e.len) {
      const t = nextSign - e.start;
      const [x, z] = at(t);
      // Board faces into campus (−outward); PlaneGeometry faces +Z, so yaw turns +Z to (−ox, −oz).
      if (!skip(x, z)) signs.push({ x: x - e.ox * 0.1, z: z - e.oz * 0.1, yaw: Math.atan2(-e.ox, -e.oz) });
      nextSign += SIGN_STEP;
    }
  }
  const iron = tracker.material(new MeshStandardMaterial({ color: 0x3c4146, roughness: 0.55, metalness: 0.5 }));
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(1, 1, 1), p = new Vector3(), up = new Vector3(0, 1, 0);
  const postMesh = new InstancedMesh(tracker.geometry(new BoxGeometry(0.07, 1.25, 0.07).translate(0, 0.625, 0)), iron, posts.length);
  posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, m.compose(p.set(x, 0, z), q.identity(), s)));
  postMesh.castShadow = true;
  postMesh.computeBoundingSphere();
  scene.add(postMesh);
  if (rails.length) {
    const railMesh = new Mesh(tracker.geometry(mergeGeometries(rails)!), iron);
    railMesh.castShadow = true;
    scene.add(railMesh);
  }
  for (const r of rails) r.dispose();

  const signTex = texture(256, 160, (g) => {
    g.fillStyle = '#c8302a';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 8;
    g.strokeRect(8, 8, 240, 144);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "900 58px system-ui, 'PingFang TC', sans-serif";
    g.fillText('禁止進入', 128, 66);
    g.font = "700 24px system-ui, 'PingFang TC', sans-serif";
    g.fillText('校外區域 NO ENTRY', 128, 120);
  }, tracker);
  const boardMat = tracker.material(new MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.12 }));
  const backMat = tracker.material(new MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.6 }));
  const boards = new InstancedMesh(tracker.geometry(new PlaneGeometry(1.1, 0.7)), boardMat, signs.length);
  const backs = new InstancedMesh(tracker.geometry(new PlaneGeometry(1.1, 0.7).rotateY(Math.PI)), backMat, signs.length);
  const signPosts = new InstancedMesh(tracker.geometry(new BoxGeometry(0.08, 1.5, 0.08).translate(0, 0.75, 0)), iron, signs.length);
  signs.forEach((sg, i) => {
    q.setFromAxisAngle(up, sg.yaw);
    boards.setMatrixAt(i, m.compose(p.set(sg.x, 1.6, sg.z), q, s));
    backs.setMatrixAt(i, m.compose(p.set(sg.x, 1.6, sg.z), q, s));
    signPosts.setMatrixAt(i, m.compose(p.set(sg.x, 0, sg.z), q, s));
  });
  for (const mesh of [boards, backs, signPosts]) {
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh === signPosts;
    scene.add(mesh);
  }
}
