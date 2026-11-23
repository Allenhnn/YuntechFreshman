/**
 * Hand-built building data (assets-src/floorplans/<name>/*.source.json → public/data/buildings/<id>.json).
 * Plan coordinates: metres, origin at the top-left of the drawing's dimension extents, +X right,
 * +Y down (as drawn). `transform` maps plan → world: world = R(angle) · (P − planCentroid) + worldCentroid.
 */
export type Rect = [number, number, number, number]; // [x0, y0, x1, y1]
export type Vec2 = [number, number];

export type SpaceKind = 'room' | 'lobby' | 'corridor' | 'toilet' | 'stair' | 'elevator' | 'void';
/** rail: a waist-high glass railing with a full-height invisible barrier (looking into a stairwell). */
export type OpeningKind = 'door' | 'open' | 'exit' | 'closed' | 'elevator' | 'rail';
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
  | 'exhibit'
  | 'dorm'
  | 'dormLoft'
  | 'restroom';

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
  /** Void only: its edges get no generated railing (a hand-built parapet stands there); rooms beside it get walls. */
  customEdge?: boolean;
  /** Lay furniture out in the largest rect only (generated rooms whose edges follow a raster). */
  furnishMain?: boolean;
  /** Furniture layout to generate inside this space. */
  furnish?: FurnishKind;
  rects: Rect[];
}

export interface Opening {
  kind: OpeningKind;
  a: Vec2;
  b: Vec2;
  label?: string;
  /** Exit only: black-framed sliding leaves instead of aluminium. */
  frame?: 'dark';
}

export interface Sign {
  kind: 'directory' | 'entrance';
  at: Vec2;
  /** Direction the sign face points to (plan axes). */
  facing: Vec2;
}

/** A cafeteria stall: back against a wall, serving toward `facing`. */
export interface Stall {
  name: string;
  /** Centre of the stall's footprint (plan). */
  at: Vec2;
  facing: Vec2;
  width: number;
  /** Key into STALL_MENUS; absent for non-shop counters (tray return). */
  menu?: 'buffet' | 'noodles' | 'bento' | 'drinks';
}

/** A hand-placed wall fitting: `at` is on the wall line, `facing` points into the room / corridor. */
export interface Fixture {
  kind: 'vending' | 'mirror';
  at: Vec2;
  facing: Vec2;
  /** Along the wall (m). */
  width: number;
}

export interface FloorPlan {
  /** Height of this floor's exterior band (covers double-height halls and mezzanines). */
  bandTop: number;
  spaces: Space[];
  openings: Opening[];
  signs: Sign[];
  elevator?: { landing: Vec2; facing: Vec2 };
  stalls?: Stall[];
  fixtures?: Fixture[];
  /** Wall stretches [a, b] that stay solid (no window band) even where the style glazes exterior walls. */
  blankWalls?: { a: Vec2; b: Vec2 }[];
  /** Wall stretches [a, b] glazed floor to ceiling in black frames (shopfront / entrance screens). */
  glassWalls?: { a: Vec2; b: Vec2 }[];
  /**
   * Hand-placed furniture and solids laid out by the source script (curved auditorium seating, a raised
   * stage): plan x / z, `y` above this floor's base. Colliders are axis-aligned boxes (centre, half size).
   */
  extras?: {
    items: { kind: 'chair' | 'stage' | 'riser'; x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number; tint: number }[];
    colliders: { c: [number, number, number]; h: [number, number, number] }[];
  };
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
  /** Traced from the 總務處 plans: OSM building ids whose shells hold this interior. */
  osmIds?: number[];
  transform: { angleDeg: number; planCentroid: Vec2; worldCentroid: Vec2 };
  floorHeight: number;
  /** Interior finish and details (hand-traced buildings matched to photos). */
  style?: {
    /** Material set: 'default' (terrazzo, plain paint) or 'mosaic' (dark grey tile floor, grey mosaic dado, dark door frames). */
    interior?: 'default' | 'mosaic';
    /** High glazed strip (2.3–2.9 m) in walls between rooms and corridors. */
    clerestory?: boolean;
    /** Real glass in the exterior walls of rooms and corridors, at the facade's window band. */
    windows?: boolean;
  };
  /** Generated interiors: partitions that end at the plan edge reach this far further, to the shell wall (m). */
  wallReach?: number;
  levels: Level[];
  /** Exterior massing of floors without a modelled interior: rect unions per level id. */
  shell: Record<string, Rect[]>;
  floors: Record<string, FloorPlan>;
  stairs?: Stair[];
  /** Stair landings (walkable slabs inside stair cores). */
  landings?: { rect: Rect; elevation: number }[];
  /**
   * Hand-placed stair doorways in addition to the flight ends (e.g. at a railing beside the stairs):
   * plan x / elevation / plan y, as StairPortal.
   */
  stairDoors?: { at: [number, number, number]; to: [number, number, number]; facing: Vec2; up: boolean; level: string }[];
  /** Plan rects whose flight-end doorways are dropped (the landing is closed off, e.g. by an elevator). */
  hidePortals?: Rect[];
  /** Level whose footprint replaces the campus ground collider (so stairs can lead below grade). */
  undergroundLevel?: string;
  /** Plan rects where the campus ground plane is cut open (looking down into a basement). */
  groundOpenings?: Rect[];
  directory: { level: string; items: string[] }[];
}

/** public/data/buildings/traced.json: plan-traced interiors and where their shells get door gaps. */
export interface TracedIndex {
  buildings: { id: string; name: string; osmIds: number[]; file: string }[];
  /** OSM building id → entrances (outer-ring edge, metres along it) taken from the plans' exits. */
  entrances: Record<string, { edge: number; along: number }[]>;
}
