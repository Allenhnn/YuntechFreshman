/**
 * Usage: npm run buildings:build
 * Validates every assets-src/floorplans/<name>/*.source.json and writes public/data/buildings/<id>.json.
 *  - every opening must lie on a wall segment of its floor
 *  - traced room areas are compared with the official space table (legendArea)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { BuildingSource, TracedIndex } from '../src/buildings/buildingTypes';
import type { CampusData } from '../src/campus/campusTypes';
import { createPlanTransform } from '../src/buildings/planTransform';
import { CELL, OUTSIDE, applyOpenings, areaOf, boundarySegments, rasterize } from '../src/buildings/floorGrid';
import { buildBuildingMeshes } from '../src/buildings/buildingMesh';
import { applyBuildingFixes } from '../src/campus/campusFixes';

const SRC = 'assets-src/floorplans';
const OUT = 'public/data/buildings';

let problems = 0;
mkdirSync(OUT, { recursive: true });
const campus = JSON.parse(readFileSync('public/data/campus.json', 'utf8')) as CampusData;
applyBuildingFixes(campus); // redrawn outlines, so shell doors land on the walls the game builds
const traced: TracedIndex = { buildings: [], entrances: {} };

/**
 * Plan exits on the ground floor → door gaps in the OSM shells. Each exit snaps to the nearest
 * outer-ring edge within 2.5 m. Gaps in the drawn outer wall are also windows, so per shell only
 * the (up to) 3 exits closest to a road or path are kept, at least 8 m apart.
 */
const MAX_SHELL_DOORS = 3;
function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const r of campus.roads) {
    for (let k = 0; k + 3 < r.points.length; k += 2) {
      const ax = r.points[k]!, az = r.points[k + 1]!, sx = r.points[k + 2]! - ax, sz = r.points[k + 3]! - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1)));
      best = Math.min(best, Math.hypot(ax + sx * t - x, az + sz * t - z) - r.width / 2);
    }
  }
  return best;
}

function shellEntrances(b: BuildingSource): void {
  const xf = createPlanTransform(b);
  const ground = b.floors[b.levels.find((l) => l.elevation === 0)?.id ?? '1F'];
  const candidates: { id: number; edge: number; along: number; x: number; z: number; road: number }[] = [];
  for (const o of ground?.openings ?? []) {
    if (o.kind !== 'exit') continue;
    const [wx, wz] = xf.toWorld((o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2);
    let best: { id: number; edge: number; along: number; d: number } | null = null;
    for (const id of b.osmIds ?? []) {
      const r = campus.buildings.find((x) => x.id === id)?.outer;
      if (!r) continue;
      for (let i = 0, n = r.length / 2; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2]!, az = r[i * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az;
        const len = Math.hypot(dx, dz);
        if (len < 3.6) continue;
        // The door (2.4 m) must fit on the edge: exits projecting past an end belong to another wall.
        const t = ((wx - ax) * dx + (wz - az) * dz) / (len * len);
        if (t * len < 1.3 || (1 - t) * len < 1.3) continue;
        const d = Math.hypot(ax + dx * t - wx, az + dz * t - wz);
        if (d < 2.5 && (!best || d < best.d)) best = { id, edge: i, along: t * len, d };
      }
    }
    if (best) candidates.push({ ...best, x: wx, z: wz, road: roadDistance(wx, wz) });
  }
  candidates.sort((a, c) => a.road - c.road);
  for (const c of candidates) {
    const list = (traced.entrances[String(c.id)] ??= []);
    if (list.length >= MAX_SHELL_DOORS) continue;
    const r = campus.buildings.find((x) => x.id === c.id)!.outer;
    const pos = (e: { edge: number; along: number }): [number, number] => {
      const n = r.length / 2, j = (e.edge + 1) % n;
      const ax = r[e.edge * 2]!, az = r[e.edge * 2 + 1]!, dx = r[j * 2]! - ax, dz = r[j * 2 + 1]! - az, len = Math.hypot(dx, dz);
      return [ax + (dx / len) * e.along, az + (dz / len) * e.along];
    };
    const here = pos(c);
    if (list.some((e) => { const p = pos(e); return Math.hypot(p[0] - here[0], p[1] - here[1]) < 8; })) continue;
    list.push({ edge: c.edge, along: Math.round(c.along * 100) / 100 });
  }
}

/**
 * The traced plan sits a metre or two off the OSM shell, so the room behind a shell door can start
 * with a wall. Walk 4 m inward from every shell entrance on the ground floor and open each interior
 * boundary the path crosses (1.2 m wide), so every door in the shell leads somewhere.
 */
function clearEntrancePaths(b: BuildingSource): number {
  const xf = createPlanTransform(b);
  const groundId = b.levels.find((l) => l.elevation === 0)?.id ?? '1F';
  const floor = b.floors[groundId];
  if (!floor) return 0;
  const grid = rasterize(floor.spaces);
  const cellOf = (x: number, y: number): [number, number, number] => {
    const c = Math.floor((x - grid.x0) / CELL), r = Math.floor((y - grid.y0) / CELL);
    return [c, r, c < 0 || r < 0 || c >= grid.w || r >= grid.h ? OUTSIDE : grid.ids[r * grid.w + c]!];
  };
  let added = 0;
  for (const id of b.osmIds ?? []) {
    const ring = campus.buildings.find((x) => x.id === id)?.outer;
    for (const e of traced.entrances[String(id)] ?? []) {
      if (!ring) continue;
      const n = ring.length / 2, j = (e.edge + 1) % n;
      const ax = ring[e.edge * 2]!, az = ring[e.edge * 2 + 1]!, dx = ring[j * 2]! - ax, dz = ring[j * 2 + 1]! - az, len = Math.hypot(dx, dz);
      const wx = ax + (dx / len) * e.along, wz = az + (dz / len) * e.along;
      const nx = dz / len, nz = -dx / len; // outward
      let prev: [number, number, number] | null = null;
      for (let t = -0.5; t <= 4; t += 0.05) {
        const [px, py] = xf.toPlan(wx - nx * t, wz - nz * t);
        const cur = cellOf(px, py);
        if (prev && cur[2] !== prev[2] && cur[2] !== OUTSIDE && prev[2] !== OUTSIDE) {
          // Crossed a boundary between two spaces: vertical if the column changed, else horizontal.
          if (cur[0] !== prev[0]) {
            const x = grid.x0 + Math.max(cur[0], prev[0]) * CELL;
            floor.openings.push({ kind: 'open', a: [x, py - 0.6], b: [x, py + 0.6] });
          } else {
            const y = grid.y0 + Math.max(cur[1], prev[1]) * CELL;
            floor.openings.push({ kind: 'open', a: [px - 0.6, y], b: [px + 0.6, y] });
          }
          added++;
        }
        prev = cur;
      }
    }
  }
  return added;
}

for (const dir of readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  for (const file of readdirSync(`${SRC}/${dir}`).filter((f) => f.endsWith('.source.json'))) {
    const b = JSON.parse(readFileSync(`${SRC}/${dir}/${file}`, 'utf8')) as BuildingSource;
    console.log(`\n${b.name} (${b.id})`);
    for (const [floorId, floor] of Object.entries(b.floors)) {
      const grid = rasterize(floor.spaces);
      const { unmatched } = applyOpenings(boundarySegments(grid), floor.openings);
      for (const o of unmatched) {
        problems++;
        console.warn(`  [${floorId}] opening ${o.kind} (${o.a.join(',')})→(${o.b.join(',')}) is not on any wall`);
      }
      console.log(`  ${floorId}: ${floor.spaces.length} spaces, ${floor.openings.length} openings`);
      console.log('    code        name                traced   table   diff');
      // Spaces sharing a code (one room split for ceiling heights) are compared as one.
      const byCode = new Map<string, { name: string; traced: number; table?: number }>();
      floor.spaces.forEach((s, i) => {
        const key = s.code ?? `#${i}`;
        const e = byCode.get(key) ?? { name: s.name, traced: 0 };
        e.traced += areaOf(grid, i);
        if (s.legendArea) e.table = s.legendArea;
        byCode.set(key, e);
      });
      [...byCode].forEach(([code, s]) => {
        const traced = s.traced;
        const table = s.table;
        const diff = table ? (traced - table) / table : 0;
        const flag = table && Math.abs(diff) > 0.35 ? '  ⚠ check' : '';
        if (flag) problems++;
        console.log(`    ${(code.startsWith('#') ? '-' : code).padEnd(10)}  ${s.name.padEnd(10, '　')}  ${traced.toFixed(1).padStart(6)}  ${table ? table.toFixed(1).padStart(6) : '     -'}  ${table ? `${(diff * 100).toFixed(0).padStart(4)}%` : ''}${flag}`);
      });
    }
    const meshes = buildBuildingMeshes(b);
    for (const l of meshes.levels) {
      const count = (k: string): number => l.furniture.filter((f) => f.kind === k).length;
      console.log(`  ${l.id} furniture: ${count('shelf')} shelf units, ${count('table')} tables, ${count('chair')} chairs, ${count('plinth')} plinths, ${count('screen')} screens; ${l.part.colliders.length} + ${l.furnitureColliders.length} furniture colliders`);
    }
    if (b.osmIds?.length) {
      traced.buildings.push({ id: b.id, name: b.name, osmIds: b.osmIds, file: `data/buildings/${b.id}.json` });
      shellEntrances(b);
      const opened = clearEntrancePaths(b);
      if (opened) console.log(`  ${opened} wall(s) opened behind shell entrances`);
    }
    // Written after the entrance paths so the opened walls are part of the output.
    writeFileSync(`${OUT}/${b.id}.json`, JSON.stringify(b));
    console.log(`  → ${OUT}/${b.id}.json`);
  }
}
writeFileSync(`${OUT}/traced.json`, JSON.stringify(traced));
console.log(`\n${traced.buildings.length} traced buildings, ${Object.values(traced.entrances).flat().length} shell entrances → ${OUT}/traced.json`);
if (problems) console.warn(`\n${problems} item(s) to review`);
