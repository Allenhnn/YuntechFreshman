import type { Scene, WebGLRenderer } from 'three';
import * as Comlink from 'comlink';
import type { RAPIER } from '../physics/physics';
import type { ResourceTracker } from '../core/resources';
import type { CampusMaterials } from '../campus/campusMaterials';
import type { CampusBuilding, CampusData } from '../campus/campusTypes';
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
  b: CampusBuilding;
  cx: number;
  cz: number;
  radius: number;
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
): InteriorManager {
  const candidates: Candidate[] = campus.buildings.filter(hasInterior).map((b) => {
    let cx = 0, cz = 0;
    const n = b.outer.length / 2;
    for (let i = 0; i < n; i++) { cx += b.outer[i * 2]!; cz += b.outer[i * 2 + 1]!; }
    cx /= n; cz /= n;
    let radius = 0;
    for (let i = 0; i < n; i++) radius = Math.max(radius, Math.hypot(b.outer[i * 2]! - cx, b.outer[i * 2 + 1]! - cz));
    return { b, cx, cz, radius };
  });
  const shared = { imats: createInteriorMaterials(renderer, sceneTracker), kit: createFurnitureKit(sceneTracker) };
  const worker = new Worker(new URL('./interiorWorker.ts', import.meta.url), { type: 'module' });
  const remote = Comlink.wrap<InteriorWorkerApi>(worker);
  const ready = remote.init(campus, facades ?? null);

  const loaded = new Map<number, HandBuiltBuilding>();
  const active: HandBuiltBuilding[] = [];
  let inFlight: number | null = null;
  let lastPoll = -Infinity;
  let disposed = false;

  const syncActive = (): void => {
    active.length = 0;
    active.push(...loaded.values());
  };

  const request = (c: Candidate): void => {
    inFlight = c.b.id;
    void ready
      .then(() => remote.build(c.b.id))
      .then((built) => {
        inFlight = null;
        if (disposed || !built) return;
        const building = createHandBuiltBuilding(built.source, scene, physics, renderer, campusMats, sceneTracker, {
          interiorOnly: true,
          meshes: built.meshes,
          shared,
          footprint: c.b.outer,
        });
        loaded.set(c.b.id, building);
        syncActive();
      })
      .catch((err: unknown) => {
        inFlight = null;
        console.warn(`[interiors] ${c.b.name ?? c.b.id} failed`, err);
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
        const have = loaded.get(c.b.id);
        if (have && d > UNLOAD) {
          have.dispose();
          loaded.delete(c.b.id);
          syncActive();
        } else if (!have && inFlight !== c.b.id && d < LOAD && d < nextD) {
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
