import { ShapeUtils, Vector2 } from 'three';
import { mulberry32 } from '../core/math';
import {
  CHUNK_SIZE,
  chunkOf,
  type CampusBuilding,
  type CampusData,
  type CampusField,
  type CampusRoad,
  type ChunkBuild,
  type MeshBuffers,
  type Ring,
} from './campusTypes';

/** Facade texture covers one structural bay (m) by one floor (m). */
export const BAY_WIDTH = 3.6;
export const FLOOR_HEIGHT = 3.6;

/** Layer heights above the ground plane; polygon offset on the materials resolves the rest. */
const Y_FIELD = 0.02;
const Y_ROAD = 0.04;
const Y_WALK = 0.06;
const WALL_BASE = -0.3;

/** Growable geometry accumulator (worker-side, so plain arrays are fine). */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c?: readonly [number, number, number]): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (c) this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Adds a triangle on a horizontal plane, flipping the winding so it faces +Y. */
  triUp(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3]!, az = p[a * 3 + 2]!;
    const cy = (p[b * 3 + 2]! - az) * (p[c * 3]! - ax) - (p[b * 3]! - ax) * (p[c * 3 + 2]! - az);
    if (cy >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): MeshBuffers | null {
    if (this.empty) return null;
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      color: this.col.length ? new Float32Array(this.col) : null,
      index: new Uint32Array(this.idx),
    };
  }
}

// --- Geometry helpers ------------------------------------------------------------------------

function ringBounds(r: Ring): [number, number, number, number] {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]!); maxX = Math.max(maxX, r[i]!);
    minZ = Math.min(minZ, r[i + 1]!); maxZ = Math.max(maxZ, r[i + 1]!);
  }
  return [minX, minZ, maxX, maxZ];
}

function ringCentroid(r: Ring): [number, number] {
  let x = 0, z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { x += r[i * 2]!; z += r[i * 2 + 1]!; }
  return [x / n, z / n];
}

function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2]!, zi = r[i * 2 + 1]!, xj = r[j * 2]!, zj = r[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function distToRingEdge(px: number, pz: number, r: Ring): number {
  let d = Infinity;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    d = Math.min(d, distToSegment(px, pz, r[i * 2]!, r[i * 2 + 1]!, r[j * 2]!, r[j * 2 + 1]!));
  }
  return d;
}

/** Triangulates a polygon with holes at height y, appending upward-facing triangles. */
function addPolygon(g: GeoBuilder, outer: Ring, holes: readonly Ring[], y: number, uvScale: number, color?: readonly [number, number, number]): void {
  const toVec = (r: Ring): Vector2[] => {
    const out: Vector2[] = [];
    for (let i = 0; i < r.length; i += 2) out.push(new Vector2(r[i]!, r[i + 1]!));
    return out;
  };
  const contour = toVec(outer);
  const holeVecs = holes.map(toVec);
  const faces = ShapeUtils.triangulateShape(contour, holeVecs);
  const all = contour.concat(...holeVecs);
  const base = g.pos.length / 3;
  for (const p of all) g.vertex(p.x, y, p.y, 0, 1, 0, p.x / uvScale, p.y / uvScale, color);
  for (const [a, b, c] of faces) g.triUp(base + a, base + b, base + c);
}

/** Extruded walls for one ring. Outer rings are CCW and holes CW, so (dz, -dx) always points away from the mass. */
function addWalls(g: GeoBuilder, r: Ring, height: number, color: readonly [number, number, number]): void {
  const n = r.length / 2;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const px = r[i * 2]!, pz = r[i * 2 + 1]!, qx = r[j * 2]!, qz = r[j * 2 + 1]!;
    const dx = qx - px, dz = qz - pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    // Snap the bay count per wall so windows never get cut at corners.
    const bays = Math.max(1, Math.round(len / BAY_WIDTH));
    const u1 = u + bays;
    const v1 = height / FLOOR_HEIGHT;
    // Walls start below the ground plane so the wall/ground seam never forms a collision crease.
    const p0 = g.vertex(px, WALL_BASE, pz, nx, 0, nz, u, WALL_BASE / FLOOR_HEIGHT, color);
    const q0 = g.vertex(qx, WALL_BASE, qz, nx, 0, nz, u1, WALL_BASE / FLOOR_HEIGHT, color);
    const q1 = g.vertex(qx, height, qz, nx, 0, nz, u1, v1, color);
    const p1 = g.vertex(px, height, pz, nx, 0, nz, u, v1, color);
    g.tri(p0, q1, q0);
    g.tri(p0, p1, q1);
    u = u1;
  }
}

/** Road ribbon: one quad per segment plus a disc at each joint to close the gaps at bends. */
function addRibbon(g: GeoBuilder, pts: readonly number[], width: number, y: number, uvScale: number): void {
  const hw = width / 2;
  const n = pts.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 2]!, az = pts[i * 2 + 1]!, bx = pts[i * 2 + 2]!, bz = pts[i * 2 + 3]!;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ox = (-dz / len) * hw, oz = (dx / len) * hw;
    const v = (x: number, z: number): number => g.vertex(x, y, z, 0, 1, 0, x / uvScale, z / uvScale);
    const a0 = v(ax + ox, az + oz), a1 = v(ax - ox, az - oz), b1 = v(bx - ox, bz - oz), b0 = v(bx + ox, bz + oz);
    g.triUp(a0, a1, b1);
    g.triUp(a0, b1, b0);
  }
  const SEG = 10;
  for (let i = 1; i + 1 < n; i++) {
    const cx = pts[i * 2]!, cz = pts[i * 2 + 1]!;
    const c = g.vertex(cx, y, cz, 0, 1, 0, cx / uvScale, cz / uvScale);
    let prev = -1;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = cx + Math.cos(a) * hw, z = cz + Math.sin(a) * hw;
      const cur = g.vertex(x, y, z, 0, 1, 0, x / uvScale, z / uvScale);
      if (prev >= 0) g.triUp(c, prev, cur);
      prev = cur;
    }
  }
}

// --- Colours ---------------------------------------------------------------------------------

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLinear = (hex: number): [number, number, number] => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
];

/** Facade tints (multiplied with the facade texture): campus tile tones, neighbourhood townhouses. */
const CAMPUS_TINTS = [0xd9c7ae, 0xcdb9a0, 0xe3dccf, 0xc9a58a, 0xd8d3c8].map(hexLinear);
const TOWN_TINTS = [0xe8e2d6, 0xd6d0c4, 0xcfc2b0, 0xe0d4bf, 0xbfc4c6].map(hexLinear);
const FIELD_COLORS: Readonly<Record<CampusField['kind'], [number, number, number]>> = {
  soccer: hexLinear(0x5f9a49),
  court: hexLinear(0x3f7d73),
  track: hexLinear(0xb05a43),
  park: hexLinear(0x79a85c),
};

// --- Builder ---------------------------------------------------------------------------------

interface Indexed<T> {
  item: T;
  bounds: [number, number, number, number];
}

/**
 * Turns campus data into per-chunk render + collision buffers. Pure and synchronous so it can
 * run in a Web Worker (see campusWorker.ts); items belong to the chunk containing their centroid
 * (roads: each segment by its midpoint), so every item is built exactly once.
 */
export class ChunkBuilder {
  private readonly buildings = new Map<string, CampusBuilding[]>();
  private readonly roadSegs = new Map<string, { road: CampusRoad; from: number; to: number }[]>();
  private readonly fields = new Map<string, CampusField[]>();
  private readonly allBuildings: Indexed<CampusBuilding>[];
  private readonly allFields: Indexed<CampusField>[];

  /** Extra no-tree zones (world rings), e.g. the footprints of hand-built buildings. */
  private readonly exclusions: Indexed<Ring>[];

  constructor(
    private readonly data: CampusData,
    exclusions: readonly Ring[] = [],
  ) {
    this.exclusions = exclusions.map((r) => ({ item: r, bounds: ringBounds(r) }));
    const key = (x: number, z: number): string => `${chunkOf(x)},${chunkOf(z)}`;
    const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const b of data.buildings) push(this.buildings, key(...ringCentroid(b.outer)), b);
    for (const f of data.fields) push(this.fields, key(...ringCentroid(f.outer)), f);
    for (const road of data.roads) {
      // Group consecutive segments that fall in the same chunk into one polyline run.
      const n = road.points.length / 2;
      let runStart = 0;
      let runKey = '';
      for (let i = 0; i + 1 < n; i++) {
        const mx = (road.points[i * 2]! + road.points[i * 2 + 2]!) / 2;
        const mz = (road.points[i * 2 + 1]! + road.points[i * 2 + 3]!) / 2;
        const k = key(mx, mz);
        if (i === 0) runKey = k;
        if (k !== runKey) {
          push(this.roadSegs, runKey, { road, from: runStart, to: i });
          runStart = i;
          runKey = k;
        }
      }
      if (n >= 2) push(this.roadSegs, runKey, { road, from: runStart, to: n - 1 });
    }
    this.allBuildings = data.buildings.map((b) => ({ item: b, bounds: ringBounds(b.outer) }));
    this.allFields = data.fields.filter((f) => f.kind !== 'park').map((f) => ({ item: f, bounds: ringBounds(f.outer) }));
  }

  build(cx: number, cz: number): ChunkBuild {
    const k = `${cx},${cz}`;
    const facade = new GeoBuilder();
    const roof = new GeoBuilder();
    const roads = new GeoBuilder();
    const walks = new GeoBuilder();
    const fields = new GeoBuilder();

    for (const b of this.buildings.get(k) ?? []) {
      if (b.replacedBy) continue; // drawn and collided by its hand-built model instead
      const tints = b.inCampus ? CAMPUS_TINTS : TOWN_TINTS;
      const tint = tints[Math.abs(b.id) % tints.length]!;
      addWalls(facade, b.outer, b.height, tint);
      for (const h of b.holes) addWalls(facade, h, b.height, tint);
      addPolygon(roof, b.outer, b.holes, b.height, 4);
    }
    for (const f of this.fields.get(k) ?? []) addPolygon(fields, f.outer, [], Y_FIELD, 6, FIELD_COLORS[f.kind]);
    for (const { road, from, to } of this.roadSegs.get(k) ?? []) {
      const pts = road.points.slice(from * 2, to * 2 + 2);
      if (road.kind === 'walkway') addRibbon(walks, pts, road.width, Y_WALK, 2);
      else addRibbon(roads, pts, road.width, Y_ROAD, 6);
    }

    // Collision = building walls + roofs only (B2: simplified, trees / cars / kerbs are walk-through).
    let collider: ChunkBuild['collider'] = null;
    if (!facade.empty) {
      const vertices = new Float32Array(facade.pos.length + roof.pos.length);
      vertices.set(facade.pos);
      vertices.set(roof.pos, facade.pos.length);
      const offset = facade.pos.length / 3;
      const indices = new Uint32Array(facade.idx.length + roof.idx.length);
      indices.set(facade.idx);
      for (let i = 0; i < roof.idx.length; i++) indices[facade.idx.length + i] = roof.idx[i]! + offset;
      collider = { vertices, indices };
    }

    return {
      cx, cz,
      facade: facade.build(),
      roof: roof.build(),
      roads: roads.build(),
      walkways: walks.build(),
      fields: fields.build(),
      trees: this.scatterTrees(cx, cz),
      collider,
    };
  }

  /** Deterministic tree scatter on open ground (OSM has no tree nodes here). */
  private scatterTrees(cx: number, cz: number): Float32Array<ArrayBuffer> {
    const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const pad = 12;
    const near = <T>(list: Indexed<T>[]): Indexed<T>[] =>
      list.filter(({ bounds: [a, b, c, d] }) => c > x0 - pad && a < x0 + CHUNK_SIZE + pad && d > z0 - pad && b < z0 + CHUNK_SIZE + pad);
    const buildings = near(this.allBuildings);
    const fields = near(this.allFields);
    const roads: { road: CampusRoad; from: number; to: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roads.push(...(this.roadSegs.get(`${cx + dx},${cz + dz}`) ?? []));
    const { bounds, boundary } = this.data;

    const out: number[] = [];
    const STEP = 9;
    for (let gx = x0; gx < x0 + CHUNK_SIZE; gx += STEP) {
      for (let gz = z0; gz < z0 + CHUNK_SIZE; gz += STEP) {
        const x = gx + rand() * STEP;
        const z = gz + rand() * STEP;
        const r = rand();
        if (x < bounds.minX - 60 || x > bounds.maxX + 60 || z < bounds.minZ - 60 || z > bounds.maxZ + 60) continue;
        const campus = pointInRing(x, z, boundary);
        if (r > (campus ? 0.32 : 0.1)) continue;
        if (buildings.some(({ item, bounds: [a, b, c, d] }) => x > a - 4 && x < c + 4 && z > b - 4 && z < d + 4 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 4))) continue;
        if (this.exclusions.some(({ item, bounds: [a, b, c, d] }) => x > a - 4 && x < c + 4 && z > b - 4 && z < d + 4 && (pointInRing(x, z, item) || distToRingEdge(x, z, item) < 4))) continue;
        if (fields.some(({ item, bounds: [a, b, c, d] }) => x > a - 2 && x < c + 2 && z > b - 2 && z < d + 2 && (pointInRing(x, z, item.outer) || distToRingEdge(x, z, item.outer) < 2))) continue;
        let onRoad = false;
        for (const { road, from, to } of roads) {
          const p = road.points;
          for (let i = from; i < to && !onRoad; i++) {
            if (distToSegment(x, z, p[i * 2]!, p[i * 2 + 1]!, p[i * 2 + 2]!, p[i * 2 + 3]!) < road.width / 2 + 2) onRoad = true;
          }
          if (onRoad) break;
        }
        if (onRoad) continue;
        out.push(x, z, 0.8 + rand() * 0.6, rand() * Math.PI * 2, rand());
      }
    }
    return new Float32Array(out);
  }
}

/** All transferable buffers of a build, for zero-copy postMessage. */
export function transferablesOf(b: ChunkBuild): ArrayBuffer[] {
  const out: ArrayBuffer[] = [b.trees.buffer];
  for (const m of [b.facade, b.roof, b.roads, b.walkways, b.fields]) {
    if (!m) continue;
    out.push(m.position.buffer, m.normal.buffer, m.uv.buffer, m.index.buffer);
    if (m.color) out.push(m.color.buffer);
  }
  if (b.collider) out.push(b.collider.vertices.buffer, b.collider.indices.buffer);
  return out;
}
