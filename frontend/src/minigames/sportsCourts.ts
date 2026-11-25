import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusData } from '../campus/campusTypes';

/**
 * The outdoor courts west of 司令台 (the three OSM `court` areas): the north and south areas are
 * basketball (2 × 2 full courts each), the middle one volleyball (2 × 2 courts with nets).
 * The long court area east of the road by 雲夢湖（東池）is the tennis centre: 4 × 2 hard courts with
 * nets inside a green chain-link fence (gates in the middle of each side).
 * Each area has its own local frame: +a along its long side, +b across it.
 */
export const RIM_H = 3.05;
export const RIM_R = 0.23;
export const NET_H = 2.43;

export interface Hoop {
  /** Rim centre (world). */
  x: number;
  z: number;
  /** Unit vector from the backboard toward the court (world, horizontal). */
  nx: number;
  nz: number;
}

export interface VolleyCourt {
  /** Court centre (world), unit along its length (across the net), unit across. */
  x: number;
  z: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
}

/** A tennis court: centre, unit along its length (across the net), unit across (world). */
export type TennisCourt = VolleyCourt;

export interface Courts {
  hoops: Hoop[];
  volley: VolleyCourt[];
  tennis: TennisCourt[];
  dispose(): void;
}

const BB = { L: 28, W: 15, key: 4.9, keyD: 5.8, three: 6.75, threeSide: 0.9, rimFromBase: 1.575, boardFromBase: 1.2 };
const VB = { L: 18, W: 9 };
/** Tennis: doubles court, singles width, service line from the net, net post height / spacing. */
export const TN = { L: 23.77, W: 10.97, SW: 8.23, service: 6.4, netH: 0.914, postH: 1.07, postB: 6.4 };
/** Tennis centre layout: court blocks (a, b) and the fence (half sizes in the area frame). */
const TENNIS_BLOCKS: [number, number][] = [-51.75, -17.25, 17.25, 51.75].flatMap((a) => [[a, -8.75], [a, 8.75]] as [number, number][]);
const FENCE = { a: 70.5, b: 18, h: 3.6, gate: 2.4 };

export function createCourts(scene: Scene, physics: RAPIER.World, campus: CampusData, tracker: ResourceTracker): Courts {
  const areas = campus.fields.filter((f) => f.kind === 'court' && f.outer.length === 8)
    .map((f) => {
      const o = f.outer;
      return { o, cz: (o[1]! + o[3]! + o[5]! + o[7]!) / 4 };
    })
    .sort((p, q) => p.cz - q.cz);
  const hoops: Hoop[] = [];
  const volley: VolleyCourt[] = [];
  const tennis: TennisCourt[] = [];
  const colliders: RAPIER.Collider[] = [];
  const groups: Group[] = [];

  const surfaceMat = (hex: number): Material => tracker.material(new MeshStandardMaterial({ color: hex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const lineMat = tracker.material(new MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const keyMat = surfaceMat(0xb5473a);
  const bbMat = surfaceMat(0x2f7d5b);
  const vbMat = surfaceMat(0x2f6fa8);
  const vbInMat = surfaceMat(0xd0874a);
  const steel = tracker.material(new MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.4, metalness: 0.5 }));
  const white = tracker.material(new MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4 }));
  const orange = tracker.material(new MeshStandardMaterial({ color: 0xe0561f, roughness: 0.4, metalness: 0.3 }));
  const netTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      g.strokeStyle = '#1d1f22';
      g.lineWidth = 7;
      for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
    }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.generateMipmaps = false;
    t.minFilter = LinearFilter;
    return t;
  })();

  const netMat = tracker.material(new MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.25, side: DoubleSide, color: 0xffffff, roughness: 0.8 }));
  // Tennis: green surround, blue playing area, a fine black net, green chain-link fence.
  const tnOutMat = surfaceMat(0x3d8a5c);
  const tnInMat = surfaceMat(0x2e62a3);
  const meshTex = (stroke: string, cell: number, lw: number, diamond: boolean): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      g.strokeStyle = stroke;
      g.lineWidth = lw;
      if (diamond) {
        for (let i = -64; i <= 128; i += cell) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
      } else {
        for (let i = 0; i <= 64; i += cell) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
      }
    }
    const t = tracker.texture(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.generateMipmaps = false;
    t.minFilter = LinearFilter;
    return t;
  };
  const tnNetMat = tracker.material(new MeshStandardMaterial({ map: meshTex('#16181a', 8, 3, false), transparent: true, alphaTest: 0.2, side: DoubleSide, roughness: 0.8 }));
  const fenceMat = tracker.material(new MeshStandardMaterial({ map: meshTex('#2f8a3e', 16, 4, true), transparent: true, alphaTest: 0.3, side: DoubleSide, roughness: 0.7 }));
  const fenceSteel = tracker.material(new MeshStandardMaterial({ color: 0x2c6e36, roughness: 0.5, metalness: 0.4 }));
  /** A plane whose texture tiles every `tile` metres (UVs scaled; the shared texture keeps repeat 1). */
  const tiled = (w: number, h: number, tile: number): PlaneGeometry => {
    const geo = new PlaneGeometry(w, h);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    return geo;
  };
  areas.forEach(({ o }, i) => {
    const cx = (o[0]! + o[2]! + o[4]! + o[6]!) / 4, cz = (o[1]! + o[3]! + o[5]! + o[7]!) / 4;
    const e0 = Math.hypot(o[2]! - o[0]!, o[3]! - o[1]!), e1 = Math.hypot(o[4]! - o[2]!, o[5]! - o[3]!);
    const [lx, lz] = e1 >= e0 ? [(o[4]! - o[2]!) / e1, (o[5]! - o[3]!) / e1] : [(o[2]! - o[0]!) / e0, (o[3]! - o[1]!) / e0];
    const theta = Math.atan2(-lz, lx);
    const bx = Math.sin(theta), bz = Math.cos(theta);
    const toWorld = (a: number, b: number): [number, number] => [cx + a * lx + b * bx, cz + a * lz + b * bz];
    const g = new Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = theta; // local +x = along (lx, lz), local +z = (bx, bz)
    scene.add(g);
    groups.push(g);
    const flats = new Map<Material, BufferGeometry[]>();
    const flat = (m: Material, geo: BufferGeometry, y: number): void => {
      geo.rotateX(-Math.PI / 2).translate(0, y, 0);
      const l = flats.get(m);
      if (l) l.push(geo);
      else flats.set(m, [geo]);
    };
    const rect = (m: Material, a0: number, b0: number, a1: number, b1: number, y: number): void =>
      flat(m, new PlaneGeometry(Math.abs(a1 - a0), Math.abs(b1 - b0)).translate((a0 + a1) / 2, -(b0 + b1) / 2, 0), y);
    /** A line strip of width w (outline rect). */
    const outline = (a0: number, b0: number, a1: number, b1: number, w = 0.06): void => {
      rect(lineMat, a0, b0, a1, b0 + w, 0.06); rect(lineMat, a0, b1 - w, a1, b1, 0.06);
      rect(lineMat, a0, b0, a0 + w, b1, 0.06); rect(lineMat, a1 - w, b0, a1, b1, 0.06);
    };
    const arc = (ca: number, cb: number, r: number, t0: number, t1: number): void => {
      const geo = new RingGeometry(r - 0.06, r, 48, 1, t0, t1 - t0).translate(ca, -cb, 0);
      flat(lineMat, geo, 0.06);
    };
    const solid = (a: number, b: number, hw: number, hh: number): void => {
      const [wx, wz] = toWorld(a, b);
      colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cylinder(hh, hw).setTranslation(wx, hh, wz))));
    };
    const meshes = new Map<Material, BufferGeometry[]>();
    const add = (m: Material, geo: BufferGeometry): void => {
      const l = meshes.get(m);
      if (l) l.push(geo);
      else meshes.set(m, [geo]);
    };
    const isVolley = i === 1;
    const isTennis = Math.max(e0, e1) > 100;
    const offsets: [number, number][] = isTennis ? TENNIS_BLOCKS : isVolley ? [[-15, -10], [15, -10], [-15, 10], [15, 10]] : [[-16, -9.5], [16, -9.5], [-16, 9.5], [16, 9.5]];
    if (isTennis) {
      rect(tnOutMat, -FENCE.a, -FENCE.b, FENCE.a, FENCE.b, 0.04);
      // Fence: chain-link panels between posts, gates (gaps) in the middle of every side.
      const fence = (a0: number, b0: number, a1: number, b1: number): void => {
        const len = Math.hypot(a1 - a0, b1 - b0);
        if (len < 0.2) return;
        const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2, yaw = Math.atan2(-(b1 - b0), a1 - a0);
        const panel = new Mesh(tracker.geometry(tiled(len, FENCE.h, 0.9).rotateY(yaw).translate(ma, FENCE.h / 2, mb)), fenceMat);
        g.add(panel);
        add(fenceSteel, new BoxGeometry(len, 0.07, 0.07).rotateY(-yaw).translate(ma, FENCE.h, -mb)); // top rail
        add(fenceSteel, new BoxGeometry(len, 0.05, 0.05).rotateY(-yaw).translate(ma, 0.12, -mb)); // bottom rail
        const posts = Math.max(1, Math.round(len / 3));
        for (let k = 0; k <= posts; k++) {
          const t = k / posts, pa = a0 + (a1 - a0) * t, pb = b0 + (b1 - b0) * t;
          add(fenceSteel, new CylinderGeometry(0.045, 0.045, FENCE.h + 0.1, 8).translate(pa, (FENCE.h + 0.1) / 2, -pb));
        }
        const [wx, wz] = toWorld(ma, mb);
        const [ux2, uz2] = [((a1 - a0) * lx + (b1 - b0) * bx) / len, ((a1 - a0) * lz + (b1 - b0) * bz) / len];
        const rot = Math.atan2(-uz2, ux2);
        colliders.push(tracker.collider(physics.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, FENCE.h / 2, 0.06)
          .setTranslation(wx, FENCE.h / 2, wz).setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) }))));
      };
      const A = FENCE.a, B = FENCE.b, gh = FENCE.gate / 2;
      for (const s of [-1, 1]) {
        fence(-A, s * B, -gh, s * B); fence(gh, s * B, A, s * B); // long sides
        fence(s * A, -B, s * A, -gh); fence(s * A, gh, s * A, B); // ends
      }
    }
    for (const [ca, cb] of offsets) {
      if (isTennis) {
        const hl = TN.L / 2, hw = TN.W / 2, sw = TN.SW / 2;
        rect(tnInMat, ca - hl - 1.2, cb - hw - 1.0, ca + hl + 1.2, cb + hw + 1.0, 0.05);
        outline(ca - hl, cb - hw, ca + hl, cb + hw, 0.05); // doubles
        for (const s of [-1, 1]) rect(lineMat, ca - hl, cb + s * sw - 0.025, ca + hl, cb + s * sw + 0.025, 0.06); // singles sidelines
        for (const s of [-1, 1]) rect(lineMat, ca + s * TN.service - 0.025, cb - sw, ca + s * TN.service + 0.025, cb + sw, 0.06); // service lines
        rect(lineMat, ca - TN.service, cb - 0.025, ca + TN.service, cb + 0.025, 0.06); // centre service line
        for (const s of [-1, 1]) rect(lineMat, ca + s * (hl - 0.15), cb - 0.025, ca + s * hl, cb + 0.025, 0.06); // centre marks
        // Net posts and the net across the court (along b) at a = ca.
        for (const s of [-1, 1]) {
          add(fenceSteel, new CylinderGeometry(0.04, 0.04, TN.postH, 10).translate(ca, TN.postH / 2, -(cb + s * TN.postB)));
          solid(ca, cb + s * TN.postB, 0.06, TN.postH / 2);
        }
        const nw = TN.postB * 2;
        g.add(new Mesh(tracker.geometry(tiled(nw, TN.netH - 0.05, 0.12).rotateY(Math.PI / 2).translate(ca, (TN.netH - 0.05) / 2 + 0.03, cb)), tnNetMat));
        add(white, new BoxGeometry(0.03, 0.07, nw).translate(ca, TN.netH - 0.03, -cb)); // headband
        add(white, new BoxGeometry(0.02, TN.netH, 0.05).translate(ca, TN.netH / 2, -cb)); // centre strap
        const [wx, wz] = toWorld(ca, cb);
        tennis.push({ x: wx, z: wz, ux: lx, uz: lz, vx: bx, vz: bz });
        continue;
      }
      if (isVolley) {
        const hl = VB.L / 2, hw = VB.W / 2;
        rect(vbMat, ca - hl - 3, cb - hw - 2.5, ca + hl + 3, cb + hw + 2.5, 0.045);
        rect(vbInMat, ca - hl, cb - hw, ca + hl, cb + hw, 0.05);
        outline(ca - hl, cb - hw, ca + hl, cb + hw, 0.05);
        rect(lineMat, ca - 0.025, cb - hw, ca + 0.025, cb + hw, 0.06); // centre line under the net
        for (const s of [-1, 1]) rect(lineMat, ca + s * 3 - 0.025, cb - hw, ca + s * 3 + 0.025, cb + hw, 0.06); // attack lines
        // Posts and net across the court (along b) at a = ca.
        for (const s of [-1, 1]) {
          add(steel, new CylinderGeometry(0.05, 0.05, NET_H + 0.1, 10).translate(ca, (NET_H + 0.1) / 2, -(cb + s * (hw + 0.5))).rotateX(0));
          solid(ca, cb + s * (hw + 0.5), 0.07, (NET_H + 0.1) / 2);
        }
        const net = new Mesh(tracker.geometry(new PlaneGeometry(VB.W + 1, 0.9).rotateY(Math.PI / 2).translate(ca, NET_H - 0.45, cb)), netMat);
        netTex.repeat.set((VB.W + 1) / 0.12, 0.9 / 0.12);
        g.add(net);
        add(white, new BoxGeometry(0.03, 0.08, VB.W + 1).translate(ca, NET_H - 0.04, -cb)); // top band
        add(white, new BoxGeometry(0.02, 0.05, VB.W + 1).translate(ca, NET_H - 0.88, -cb)); // bottom band
        const [wx, wz] = toWorld(ca, cb);
        volley.push({ x: wx, z: wz, ux: lx, uz: lz, vx: bx, vz: bz });
      } else {
        const hl = BB.L / 2, hw = BB.W / 2;
        rect(bbMat, ca - hl - 1.5, cb - hw - 1.5, ca + hl + 1.5, cb + hw + 1.5, 0.05);
        outline(ca - hl, cb - hw, ca + hl, cb + hw);
        rect(lineMat, ca - 0.03, cb - hw, ca + 0.03, cb + hw, 0.06);
        arc(ca, cb, 1.8, 0, Math.PI * 2);
        for (const s of [-1, 1]) {
          const base = ca + s * hl;
          // Key (painted) and free-throw circle.
          const k0 = base - s * BB.keyD;
          rect(keyMat, Math.min(base, k0), cb - BB.key / 2, Math.max(base, k0), cb + BB.key / 2, 0.055);
          outline(Math.min(base, k0), cb - BB.key / 2, Math.max(base, k0), cb + BB.key / 2);
          arc(k0, cb, 1.8, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
          // Three-point line: straight from the baseline, then the arc round the rim.
          const rimA = base - s * BB.rimFromBase;
          const sideB = hw - BB.threeSide;
          const reach = Math.sqrt(Math.max(0, BB.three ** 2 - sideB ** 2));
          for (const sb of [-1, 1]) rect(lineMat, Math.min(base, rimA - s * reach), cb + sb * sideB - 0.03, Math.max(base, rimA - s * reach), cb + sb * sideB + 0.03, 0.06);
          const tEdge = Math.asin(sideB / BB.three);
          // In the plane's (a, −b) coordinates the arc faces −s along a.
          const mid = s > 0 ? Math.PI : 0;
          arc(rimA, cb, BB.three, mid - tEdge, mid + tEdge);
          // Hoop: pole behind the baseline, arm, backboard, rim, net.
          const poleA = base + s * 1.0, boardA = base - s * BB.boardFromBase;
          add(steel, new CylinderGeometry(0.09, 0.11, 3.4, 12).translate(poleA, 1.7, -cb));
          add(steel, new BoxGeometry(Math.abs(poleA - boardA), 0.12, 0.12).translate((poleA + boardA) / 2, 3.35, -cb));
          add(white, new BoxGeometry(0.05, 1.05, 1.8).translate(boardA, 3.425, -cb));
          add(orange, new BoxGeometry(0.06, 0.45, 0.59).translate(boardA - s * 0.01, 3.25, -cb)); // shooter's square (thin)
          add(white, new BoxGeometry(0.07, 0.39, 0.53).translate(boardA - s * 0.015, 3.25, -cb));
          add(orange, new TorusGeometry(RIM_R, 0.012, 8, 24).rotateX(Math.PI / 2).translate(rimA, RIM_H, -cb));
          add(white, new CylinderGeometry(RIM_R, RIM_R * 0.6, 0.4, 12, 1, true).translate(rimA, RIM_H - 0.2, -cb));
          solid(poleA, cb, 0.12, 1.7);
          const [hx, hz] = toWorld(rimA, cb);
          hoops.push({ x: hx, z: hz, nx: -s * lx, nz: -s * lz });
        }
      }
    }
    for (const [m, list] of flats) {
      const mesh = new Mesh(tracker.geometry(mergeGeometries(list)!), m);
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    for (const [m, list] of meshes) {
      // These were built with b mirrored (−b) like the flats; flip back into local +z.
      const merged = mergeGeometries(list)!;
      merged.scale(1, 1, -1);
      const mesh = new Mesh(tracker.geometry(merged), m);
      mesh.castShadow = mesh.receiveShadow = true;
      if (m === white) (m as MeshStandardMaterial).side = DoubleSide;
      g.add(mesh);
    }
  });

  return {
    hoops,
    volley,
    tennis,
    dispose() {
      for (const c of colliders) physics.removeCollider(c, false);
      for (const g of groups) g.removeFromParent();
    },
  };
}
