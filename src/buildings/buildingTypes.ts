/**
 * Hand-built building data (assets-src/floorplans/<name>/*.source.json → public/data/buildings/<id>.json).
 * Plan coordinates: metres, origin at the top-left of the drawing's dimension extents, +X right,
 * +Y down (as drawn). `transform` maps plan → world: world = R(angle) · (P − planCentroid) + worldCentroid.
 */
export type Rect = [number, number, number, number]; // [x0, y0, x1, y1]
export type Vec2 = [number, number];

export type SpaceKind = 'room' | 'lobby' | 'corridor' | 'toilet' | 'stair' | 'elevator' | 'void';
export type OpeningKind = 'door' | 'open' | 'exit' | 'closed' | 'elevator';
export type FurnishKind =
  | 'stacks'
  | 'periodicals'
  | 'picturebooks'
  | 'reading'
  | 'office'
  | 'discussion'
  | 'carrel'
  | 'theater'
  | 'classroom'
  | 'exhibit';

export interface Space {
  id: string;
  code?: string;
  name: string;
  kind: SpaceKind;
  /** Ceiling height above the floor (m). */
  ceiling: number;
  /** Area from the official space table (m²), used to validate the trace. */
  legendArea?: number;
  /** Open to the floor above (stair halls under a void): no ceiling quad or ceiling collider. */
  noCeiling?: boolean;
  /** Spaces sharing a group are one room split only to vary the ceiling (no wall between them). */
  group?: string;
  /** Furniture layout to generate inside this space. */
  furnish?: FurnishKind;
  rects: Rect[];
}

export interface Opening {
  kind: OpeningKind;
  a: Vec2;
  b: Vec2;
  label?: string;
}

export interface Sign {
  kind: 'directory' | 'entrance';
  at: Vec2;
  /** Direction the sign face points to (plan axes). */
  facing: Vec2;
}

export interface FloorPlan {
  /** Height of this floor's exterior band (covers double-height halls and mezzanines). */
  bandTop: number;
  spaces: Space[];
  openings: Opening[];
  signs: Sign[];
  elevator?: { landing: Vec2; facing: Vec2 };
}

export interface Level {
  id: string;
  elevation: number;
  /** Interior modelled and walkable. */
  built: boolean;
  /** Served by the elevator. */
  elevator?: boolean;
}

/** A straight flight of stairs. `low`/`high` are elevations; `up` is the direction the flight rises along `axis`. */
export interface Stair {
  id: string;
  name: string;
  rect: Rect;
  axis: 'x' | 'y';
  up: '+' | '-';
  low: number;
  high: number;
}

export interface BuildingSource {
  id: string;
  name: string;
  osmReplaces: string[];
  transform: { angleDeg: number; planCentroid: Vec2; worldCentroid: Vec2 };
  floorHeight: number;
  levels: Level[];
  /** Exterior massing of floors without a modelled interior: rect unions per level id. */
  shell: Record<string, Rect[]>;
  floors: Record<string, FloorPlan>;
  stairs?: Stair[];
  /** Stair landings (walkable slabs inside stair cores). */
  landings?: { rect: Rect; elevation: number }[];
  /** Level whose footprint replaces the campus ground collider (so stairs can lead below grade). */
  undergroundLevel?: string;
  /** Plan rects where the campus ground plane is cut open (looking down into a basement). */
  groundOpenings?: Rect[];
  directory: { level: string; items: string[] }[];
}
