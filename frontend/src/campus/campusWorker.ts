import * as Comlink from 'comlink';
import type { CampusData, ChunkBuild, Ring } from './campusTypes';
import type { FacadeData } from './facadeTypes';
import type { Entrance } from './entrances';
import { ChunkBuilder, transferablesOf } from './chunkBuilder';

/**
 * Off-main-thread chunk geometry generation. The main thread only uploads the returned buffers
 * (ownership transferred, no copies) and creates the Rapier colliders.
 */
let builder: ChunkBuilder | null = null;

const api = {
  init(data: CampusData, exclusions: Ring[], facades: FacadeData, entrances: Record<string, Entrance[]> = {}): void {
    builder = new ChunkBuilder(data, exclusions, facades, entrances);
  },
  build(cx: number, cz: number): ChunkBuild {
    if (!builder) throw new Error('campus worker not initialised');
    const result = builder.build(cx, cz);
    return Comlink.transfer(result, transferablesOf(result));
  },
};

export type CampusWorkerApi = typeof api;
Comlink.expose(api);
