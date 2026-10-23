/**
 * Usage: npm run buildings:build
 * Validates every assets-src/floorplans/<name>/*.source.json and writes public/data/buildings/<id>.json.
 *  - every opening must lie on a wall segment of its floor
 *  - traced room areas are compared with the official space table (legendArea)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { BuildingSource } from '../src/buildings/buildingTypes';
import { applyOpenings, areaOf, boundarySegments, rasterize } from '../src/buildings/floorGrid';
import { buildBuildingMeshes } from '../src/buildings/buildingMesh';

const SRC = 'assets-src/floorplans';
const OUT = 'public/data/buildings';

let problems = 0;
mkdirSync(OUT, { recursive: true });
for (const dir of readdirSync(SRC)) {
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
    writeFileSync(`${OUT}/${b.id}.json`, JSON.stringify(b));
    console.log(`  → ${OUT}/${b.id}.json`);
  }
}
if (problems) console.warn(`\n${problems} item(s) to review`);
