import * as Comlink from 'comlink';
import type { CampusData, MeshBuffers } from '../campus/campusTypes';
import { buildingEntrance } from '../campus/entrances';
import type { FacadeData } from '../campus/facadeTypes';
import type { BuildingSource, TracedIndex } from '../buildings/buildingTypes';
import { buildBuildingMeshes, type BuildingMeshes, type BuildingPart } from '../buildings/buildingMesh';
import { dormVendingPart, generateInterior } from './generateInterior';

/**
 * Off-main-thread interior generation: plan layout + the hand-built mesh pipeline take up to
 * ~0.5 s for the largest buildings. Mesh buffers come back as transferables (no copies).
 */
let campus: CampusData | null = null;
let photoEdges = new Map<number, Set<number>>();
let traced: TracedIndex = { buildings: [], entrances: {} };
let baseUrl = '';

export interface InteriorBuild {
  source: BuildingSource;
  meshes: BuildingMeshes;
}

function partBuffers(p: BuildingPart): MeshBuffers[] {
  return [p.facade, p.paint, p.roof, p.floor, p.ceiling, p.glass, p.curtain].filter((m): m is MeshBuffers => m !== null);
}

function transferables(m: BuildingMeshes): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const buf of [...partBuffers(m.stairs), ...m.levels.flatMap((l) => partBuffers(l.part))]) {
    out.push(buf.position.buffer, buf.normal.buffer, buf.uv.buffer, buf.index.buffer);
    if (buf.color) out.push(buf.color.buffer);
  }
  return out;
}

const api = {
  init(data: CampusData, facades: FacadeData | null, tracedIndex: TracedIndex | null, base: string): void {
    campus = data;
    traced = tracedIndex ?? { buildings: [], entrances: {} };
    baseUrl = base;
    photoEdges = new Map(Object.entries(facades?.photos ?? {}).map(([id, p]) => [Number(id), new Set(p.edges.map((e) => e.edge))]));
  },
  /** `key`: a traced building id ("plan-…") or an OSM building id for a generated interior. */
  async build(key: string): Promise<InteriorBuild | null> {
    let source: BuildingSource | null = null;
    const plan = traced.buildings.find((t) => t.id === key);
    if (plan) {
      const res = await fetch(new URL(plan.file, baseUrl));
      if (!res.ok) throw new Error(`${plan.file}: HTTP ${res.status}`);
      source = (await res.json()) as BuildingSource;
    } else {
      const b = campus?.buildings.find((x) => String(x.id) === key);
      if (!campus || !b) return null;
      source = generateInterior(b, buildingEntrance(b, campus.roads, photoEdges.get(b.id)), undefined, dormVendingPart(b, campus.buildings))?.source ?? null;
    }
    if (!source) return null;
    const meshes = buildBuildingMeshes(source);
    // The campus extrusion is the shell: drop the generated exterior before transfer.
    meshes.exterior = { facade: null, paint: null, roof: null, floor: null, ceiling: null, glass: null, curtain: null, colliders: [] };
    const result: InteriorBuild = { source, meshes };
    return Comlink.transfer(result, transferables(meshes));
  },
};

export type InteriorWorkerApi = typeof api;
Comlink.expose(api);
