/**
 * Building facades (public/data/facades.json, built by scripts/build-facades.ts from
 * assets-src/campus/facades.json). Two layers per building:
 *  - a procedural style (wall / trim / glass colours, window grid) sampled from photos (option C);
 *  - optional rectified photo walls packed into one atlas per building (option A), keyed by the
 *    index of the outer-ring edge they cover (edge i runs from vertex i to vertex i + 1).
 */
import type { CampusData } from './campusTypes';

export type WindowPattern = 'punched' | 'ribbon' | 'curtain' | 'blank';

export interface FacadeStyle {
  /** sRGB hex colours, e.g. "#e3dccf". */
  wall: string;
  trim: string;
  glass: string;
  /** Structural bay width and floor-to-floor height (m). */
  bay: number;
  floor: number;
  /** Window width as a fraction of the bay, height as a fraction of the floor. */
  win: [number, number];
  /** Window sill height as a fraction of the floor. */
  sill: number;
  pattern: WindowPattern;
  /** Ground floor is a glazed storefront / lobby band. */
  groundGlass: boolean;
}

/** One photo wall inside a building's atlas: uv rect [u0, vBottom, u1, vTop], covering the whole edge from ground to roof. */
export interface PhotoEdge {
  edge: number;
  uv: [number, number, number, number];
}

export interface BuildingPhotos {
  /** URL of the KTX2 atlas, relative to the site root. */
  atlas: string;
  edges: PhotoEdge[];
}

export interface FacadeData {
  styles: FacadeStyle[];
  /** OSM building id → index into `styles`; buildings not listed use `styles[0]` (campus) or `styles[1]` (town). */
  building: Record<string, number>;
  photos: Record<string, BuildingPhotos>;
}

/** Authoring format (assets-src/campus/facades.json). */
export interface FacadeSource {
  presets: Record<string, FacadeStyle>;
  /** First match wins: building name contains `match` → preset. */
  rules: { match: string; preset: string }[];
  /** Per building name: a preset and/or overrides (usually picked from photos in the facade tool). */
  buildings: Record<string, { preset?: string; style?: Partial<FacadeStyle> }>;
  /** Rectified photo walls per OSM building id, written by the facade tool. */
  photos: Record<string, { name: string; edges: PhotoSection[] }>;
}

/** How a rectified edge image was made (kept so the result can be audited / redone). */
export interface PhotoSection {
  edge: number;
  /** Rectified image saved by the tool: assets-src/photos/<name>/rectified/<file>. */
  file: string;
  /** Wall size the image covers (m): edge length × building height. */
  width: number;
  height: number;
  /** Source photos and the clicked corners, per section along the wall. */
  sources: { photo: string; corners: [number, number][]; along: [number, number]; vertical: [number, number] }[];
}

/** The style the campus would give the OSM building called `name` (used for hand-built replacements). */
export function facadeStyleOf(facades: FacadeData | undefined, campus: CampusData, name: string): FacadeStyle {
  const b = campus.buildings.find((x) => x.name === name);
  const i = b && facades ? facades.building[String(b.id)] : undefined;
  return (i !== undefined ? facades?.styles[i] : undefined) ?? DEFAULT_CAMPUS_STYLE;
}

export const PATTERN_ID: Readonly<Record<WindowPattern, number>> = { punched: 0, ribbon: 1, curtain: 2, blank: 3 };

export const DEFAULT_CAMPUS_STYLE: FacadeStyle = {
  wall: '#e3dccf', trim: '#c9c1b3', glass: '#3e5566', bay: 3.6, floor: 3.6, win: [0.72, 0.5], sill: 0.25, pattern: 'punched', groundGlass: false,
};
export const DEFAULT_TOWN_STYLE: FacadeStyle = {
  wall: '#e8e2d6', trim: '#bdb6aa', glass: '#465a66', bay: 4, floor: 3.2, win: [0.55, 0.45], sill: 0.3, pattern: 'punched', groundGlass: true,
};
