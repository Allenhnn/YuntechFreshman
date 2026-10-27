import type { Scene, WebGLRenderer } from 'three';
import * as Comlink from 'comlink';
import type { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusMaterials } from '../campus/campusMaterials';
import type { CampusBuilding, CampusData, Ring } from '../campus/campusTypes';
import type { TracedIndex } from '../buildings/buildingTypes';
import { hasInterior } from '../campus/entrances';
import type { FacadeData } from '../campus/facadeTypes';
import { createHandBuiltBuilding, type HandBuiltBuilding } from '../buildings/buildingWorld';
import { createInteriorMaterials } from '../buildings/interiorMaterials';
import { createFurnitureKit } from '../buildings/furnitureMeshes';
import type { InteriorWorkerApi } from './interiorWorker';

/**
 * Streams generated interiors for every enterable campus building: requested from the interior
 * worker when the player comes within LOAD m of a building's outline, disposed beyond UNLOAD m.
 * One build in flight at a time, nearest first.
 */
const LOAD = 45;
const UNLOAD = 110;
const POLL_MS = 250;

interface Candidate {
  /** Worker key: traced building id, or the OSM id of a generated interior. */
  key: string;
  name: string;
  rings: Ring[];
  cx: number;
  cz: number;
  radius: number;
}

function candidate(key: string, name: string, buildings: readonly CampusBuilding[]): Candidate {
  const pts = buildings.flatMap((b) => Array.from({ length: b.outer.length / 2 }, (_, i) => [b.outer[i * 2]!, b.outer[i * 2 + 1]!] as const));
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
  return { key, name, rings: buildings.map((b) => b.outer), cx, cz, radius };
}

export interface InteriorManager {
  /** Generated buildings currently loaded (for interactions, camera filters, level visibility). */
  readonly active: readonly HandBuiltBuilding[];
  update(px: number, py: number, pz: number): void;
  dispose(): void;
}

export function createInteriorManager(
  scene: Scene,
  physics: RAPIER.World,
  renderer: WebGLRenderer,
  campusMats: CampusMaterials,
  campus: CampusData,
  facades: FacadeData | undefined,
  sceneTracker: ResourceTracker,
  traced: TracedIndex | undefined,
): InteriorManager {
  // Plan-traced buildings first (one candidate per traced building, however many OSM shells it
  // spans), then a generated interior for every other enterable campus building.
  const byId = new Map(campus.buildings.map((b) => [b.id, b]));
  const covered = new Set<number>();
  const candidates: Candidate[] = [];
  for (const t of traced?.buildings ?? []) {
    const shells = t.osmIds.map((id) => byId.get(id)).filter((b): b is CampusBuilding => !!b);
    if (!shells.length) continue;
    t.osmIds.forEach((id) => covered.add(id));
    candidates.push(candidate(t.id, t.name, shells));
  }
  for (const b of campus.buildings) if (hasInterior(b) && !covered.has(b.id)) candidates.push(candidate(String(b.id), b.name ?? String(b.id), [b]));
  const shared = { imats: createInteriorMaterials(renderer, sceneTracker), kit: createFurnitureKit(sceneTracker) };
  const worker = new Worker(new URL('./interiorWorker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<InteriorWorkerApi>(worker);
  const ready = remote.init(campus, facades ?? null, traced ?? null, new URL(import.meta.env.BASE_URL, location.href).href);

  const loaded = new Map<string, HandBuiltBuilding>();
  const active: HandBuiltBuilding[] = [];
  let inFlight: string | null = null;
  let lastPoll = -Infinity;
  let disposed = false;

  const syncActive = (): void => {
    active.length = 0;
    active.push(...loaded.values());
  };

  const request = (c: Candidate): void => {
    inFlight = c.key;
    void ready
      .then(() => remote.build(c.key))
      .then((built) => {
        inFlight = null;
        if (disposed || !built) return;
        const building = createHandBuiltBuilding(built.source, scene, physics, renderer, campusMats, sceneTracker, {
          interiorOnly: true,
          meshes: built.meshes,
          shared,
          footprints: c.rings,
        });
        loaded.set(c.key, building);
        syncActive();
      })
      .catch((err: unknown) => {
        inFlight = null;
        console.warn(`[interiors] ${c.name} failed`, err);
      });
  };

  return {
    active,
    update(px, py, pz) {
      for (const b of active) b.update(px, py, pz);
      const now = performance.now();
      if (now - lastPoll < POLL_MS) return;
      lastPoll = now;
      // Distance to the outline, approximated by centroid distance minus the building's radius.
      let next: Candidate | null = null;
      let nextD = Infinity;
      for (const c of candidates) {
        const d = Math.max(0, Math.hypot(px - c.cx, pz - c.cz) - c.radius);
        const have = loaded.get(c.key);
        if (have && d > UNLOAD) {
          have.dispose();
          loaded.delete(c.key);
          syncActive();
        } else if (!have && inFlight !== c.key && d < LOAD && d < nextD) {
          next = c;
          nextD = d;
        }
      }
      if (next && inFlight === null) request(next);
    },
    dispose() {
      disposed = true;
      for (const b of loaded.values()) b.dispose();
      loaded.clear();
      syncActive();
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}
