import * as Comlink from 'comlink';
import type { CampusData, MeshBuffers } from '../campus/campusTypes';
import { buildingEntrance } from '../campus/entrances';
import type { FacadeData } from '../campus/facadeTypes';
import type { BuildingSource } from '../buildings/buildingTypes';
import { buildBuildingMeshes, type BuildingMeshes, type BuildingPart } from '../buildings/buildingMesh';
import { generateInterior } from './generateInterior';

/**
 * Off-main-thread interior generation: plan layout + the hand-built mesh pipeline take up to
 * ~0.5 s for the largest buildings. Mesh buffers come back as transferables (no copies).
 */
let campus: CampusData | null = null;
let photoEdges = new Map<number, Set<number>>();

export interface InteriorBuild {
  source: BuildingSource;
  meshes: BuildingMeshes;
}

function partBuffers(p: BuildingPart): MeshBuffers[] {
  return [p.facade, p.paint, p.roof, p.floor, p.ceiling, p.glass].filter((m): m is MeshBuffers => m !== null);
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
  init(data: CampusData, facades: FacadeData | null): void {
    campus = data;
    photoEdges = new Map(Object.entries(facades?.photos ?? {}).map(([id, p]) => [Number(id), new Set(p.edges.map((e) => e.edge))]));
  },
  build(buildingId: number): InteriorBuild | null {
    const b = campus?.buildings.find((x) => x.id === buildingId);
    if (!campus || !b) return null;
    const generated = generateInterior(b, buildingEntrance(b, campus.roads, photoEdges.get(b.id)));
    if (!generated) return null;
    const meshes = buildBuildingMeshes(generated.source);
    // The campus extrusion is the shell: drop the generated exterior before transfer.
    meshes.exterior = { facade: null, paint: null, roof: null, floor: null, ceiling: null, glass: null, colliders: [] };
    const result: InteriorBuild = { source: generated.source, meshes };
    return Comlink.transfer(result, transferables(meshes));
  },
};

export type InteriorWorkerApi = typeof api;
Comlink.expose(api);
