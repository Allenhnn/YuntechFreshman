/**
 * Compact campus dataset (public/data/campus.json), generated offline from OpenStreetMap by
 * scripts/fetch-campus.ts. Coordinates are local metres: origin at the campus centre,
 * +X = east, +Z = south (so north is -Z, matching the minimap's "north up").
 */
export type Ring = number[]; // flat [x0, z0, x1, z1, ...], not closed (last != first)

export interface CampusBuilding {
  id: number;
  name?: string;
  /** Outer ring CCW (positive signed area in x/z), holes CW. */
  outer: Ring;
  holes: Ring[];
  height: number;
  levels: number;
  inCampus: boolean;
  /** Set when a hand-built building (src/buildings) replaces this OSM extrusion. */
  replacedBy?: string;
}

export type RoadKind = 'major' | 'minor' | 'service' | 'walkway';

export interface CampusRoad {
  kind: RoadKind;
  width: number;
  points: number[]; // flat polyline [x0, z0, x1, z1, ...]
  name?: string;
}

export type FieldKind = 'soccer' | 'court' | 'track' | 'park';

export interface CampusField {
  kind: FieldKind;
  outer: Ring;
}

export interface CampusData {
  /** Attribution that must be shown wherever this data is displayed. */
  attribution: string;
  generatedAt: string;
  origin: { lat: number; lon: number };
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  boundary: Ring;
  spawn: { x: number; z: number; facing: number; label: string };
  buildings: CampusBuilding[];
  roads: CampusRoad[];
  fields: CampusField[];
  trees: number[]; // flat [x, z, ...] from natural=tree nodes
  /** Scooter parks (added at load time, campus/scooterLots.ts) for the map. */
  parking?: { name: string; ring: Ring }[];
}

/** Chunk size for streaming (m). The campus + margin is roughly 6 x 6 chunks. */
export const CHUNK_SIZE = 256;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;
export const chunkOf = (v: number): number => Math.floor(v / CHUNK_SIZE);

/** Geometry ready to upload: one interleaving-free set of attribute arrays per material. */
export interface MeshBuffers {
  position: Float32Array<ArrayBuffer>;
  normal: Float32Array<ArrayBuffer>;
  uv: Float32Array<ArrayBuffer>;
  color: Float32Array<ArrayBuffer> | null;
  index: Uint32Array<ArrayBuffer>;
  /** Extra per-vertex attributes (facade style). */
  extra?: { name: string; size: number; array: Float32Array<ArrayBuffer> }[];
}

export interface ChunkBuild {
  cx: number;
  cz: number;
  facade: MeshBuffers | null;
  /** Walls covered by rectified photos, one mesh per photographed building (uv into its atlas). */
  photoWalls: { building: number; atlas: string; mesh: MeshBuffers }[];
  roof: MeshBuffers | null;
  /** Balconies, sunshades, pilasters, canopies, parapets, rooftop clutter (visual only). */
  details: MeshBuffers | null;
  roads: MeshBuffers | null;
  walkways: MeshBuffers | null;
  fields: MeshBuffers | null;
  /** Classroom window panes cut into teaching-building walls (transparent; solid for collision). */
  glass: MeshBuffers | null;
  /** Tree instances: [x, z, scale, rotation, colourShift] per tree. */
  trees: Float32Array<ArrayBuffer>;
  /** Static collision for building walls + roofs (B2: trees, cars and kerbs are not collidable). */
  collider: { vertices: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer> } | null;
}
