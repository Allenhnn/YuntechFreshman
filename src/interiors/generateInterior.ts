import type { CampusBuilding } from '../campus/campusTypes';
import type { Entrance } from '../campus/entrances';
import type { BuildingSource, FloorPlan, FurnishKind, Opening, Rect, Space, Stair, Stall } from '../buildings/buildingTypes';

/**
 * Procedural interior for an OSM building, in the same BuildingSource format as the hand-traced
 * library, so the hand-built pipeline (walls, doors, plates, stairs, furniture, level visibility)
 * renders it. The OSM extrusion stays as the shell: generated plans carry no exterior walls of
 * their own (createHandBuiltBuilding with `interiorOnly`).
 *
 * Plan frame: +x along the building's longest wall, +y across it; metres, 0.5 m cells.
 * Layout per floor: a 2.5 m corridor along the long axis where the footprint is deep enough,
 * rooms on both sides cut every `roomWidth` metres (each with a door onto the corridor), a
 * switchback stair core and an elevator next to it. Shallow footprints are one open hall.
 */
export type BuildingKind = 'dorm' | 'teaching' | 'office' | 'dining' | 'hall' | 'utility';

const C = 0.5;
/** Thickness of the building shell's outer wall (m); interiors stay clear of it. */
export const SHELL_WALL = 0.4;
/** How far partitions reach past the plan edge to meet the shell wall's inner face (m). */
const WALL_REACH = 0.7;
const CORRIDOR_CELLS = 5; // 2.5 m
const MIN_CORRIDOR_DEPTH = 10; // m of footprint depth needed for corridor + rooms
const CORE_W = 4.3; // two 2.1 m flights + 0.1 m gap
const FLIGHT_W = 2.1;
const LANDING = 1.3;
const LIFT = 2.2;
const DOOR = 1.0;

export function buildingKind(name: string | undefined): BuildingKind {
  const n = name ?? '';
  if (/宿舍/.test(n)) return 'dorm';
  if (/餐廳/.test(n)) return 'dining';
  if (/活動中心|表演廳|會議廳|司令台|體育/.test(n)) return 'hall';
  if (/行政|資訊中心|警衛/.test(n)) return 'office';
  if (/實驗室|檢測|工坊|園區/.test(n)) return 'utility';
  return 'teaching';
}

interface KindSpec {
  roomWidth: number;
  room: (area: number) => { name: string; furnish?: FurnishKind };
  hall?: FurnishKind;
}

const KINDS: Readonly<Record<BuildingKind, KindSpec>> = {
  dorm: { roomWidth: 3.6, room: () => ({ name: '寢室', furnish: 'dorm' }) },
  teaching: { roomWidth: 7.5, room: (a) => (a >= 40 ? { name: '教室', furnish: 'classroom' } : { name: '研究室', furnish: 'office' }) },
  office: { roomWidth: 5, room: (a) => (a >= 30 ? { name: '辦公室', furnish: 'office' } : { name: '會議室', furnish: 'discussion' }) },
  utility: { roomWidth: 7, room: () => ({ name: '實驗室', furnish: 'office' }) },
  dining: { roomWidth: 7, room: () => ({ name: '餐廳', furnish: 'reading' }), hall: 'reading' },
  hall: { roomWidth: 8, room: () => ({ name: '活動室', furnish: 'discussion' }), hall: 'discussion' },
};

/** Cell regions on one floor. */
const OUT = -1;
const CORRIDOR = -2;
const HALL = -3;
const STAIR = -4;
const LIFT_CELL = -5;

export interface GeneratedInterior {
  source: BuildingSource;
  /** World centroid of the footprint (streaming distance). */
  centre: [number, number];
  radius: number;
}

export function generateInterior(b: CampusBuilding, entrance: Entrance | null, id = `osm-${b.id}`): GeneratedInterior | null {
  const r = b.outer;
  const n = r.length / 2;
  // Dominant axis: the longest wall.
  let dx = 1, dz = 0, best = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = r[j * 2]! - r[i * 2]!, ez = r[j * 2 + 1]! - r[i * 2 + 1]!;
    const len = Math.hypot(ex, ez);
    if (len > best) { best = len; dx = ex / len; dz = ez / len; }
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += r[i * 2]!; cz += r[i * 2 + 1]!; }
  cx /= n; cz /= n;
  // Local frame: u along (dx, dz), v along (-dz, dx); world = R(angle)·(u, v) + centroid.
  const toLocal = (x: number, z: number): [number, number] => [(x - cx) * dx + (z - cz) * dz, -(x - cx) * dz + (z - cz) * dx];
  const local: [number, number][] = [];
  for (let i = 0; i < n; i++) local.push(toLocal(r[i * 2]!, r[i * 2 + 1]!));
  const holes = b.holes.map((h) => Array.from({ length: h.length / 2 }, (_, i) => toLocal(h[i * 2]!, h[i * 2 + 1]!)));
  const U0 = Math.min(...local.map((p) => p[0])), U1 = Math.max(...local.map((p) => p[0]));
  const V0 = Math.min(...local.map((p) => p[1])), V1 = Math.max(...local.map((p) => p[1]));
  const W = Math.ceil((U1 - U0) / C), H = Math.ceil((V1 - V0) / C);
  if (W < 4 || H < 4) return null;

  const inPoly = (pts: readonly [number, number][], x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // The shell wall is SHELL_WALL thick (campus/chunkBuilder.ts): keep plan cells clear of it.
  const rings = [local, ...holes];
  const edgeClear = (x: number, y: number): boolean => {
    for (const pts of rings) {
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [ax, ay] = pts[j]!, [bx, by] = pts[i]!;
        const ex = bx - ax, ey = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
        if (Math.hypot(x - ax - ex * t, y - ay - ey * t) < SHELL_WALL + 0.05) return false;
      }
    }
    return true;
  };
  // Plan coordinates start at 0: plan x = u − U0, plan y = v − V0.
  const footprint = new Int8Array(W * H);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const u = U0 + (col + 0.5) * C, v = V0 + (row + 0.5) * C;
      footprint[row * W + col] = inPoly(local, u, v) && !holes.some((h) => inPoly(h, u, v)) && edgeClear(u, v) ? 1 : 0;
    }
  }
  const at = (col: number, row: number): boolean => col >= 0 && row >= 0 && col < W && row < H && footprint[row * W + col] === 1;

  const levels = Math.max(1, b.levels || Math.round(b.height / 3.6));
  const fh = b.height / levels;
  const kind = buildingKind(b.name);
  const spec = KINDS[kind];

  // --- Corridor row band (same on every floor) ----------------------------------------------
  let corridorRow = -1;
  if ((V1 - V0) >= MIN_CORRIDOR_DEPTH && kind !== 'dining' && kind !== 'hall') {
    let bestCount = 0;
    const mid = (H - CORRIDOR_CELLS) / 2;
    for (let row = 2; row + CORRIDOR_CELLS <= H - 2; row++) {
      let count = 0;
      for (let col = 0; col < W; col++) {
        let ok = true;
        for (let k = 0; k < CORRIDOR_CELLS && ok; k++) ok = at(col, row + k);
        if (ok) count++;
      }
      // Prefer the band through the middle when counts tie.
      const score = count - Math.abs(row - mid) * 0.01;
      if (score > bestCount) { bestCount = score; corridorRow = row; }
    }
    if (bestCount < 8) corridorRow = -1; // not even 4 m of corridor: treat as a hall
  }
  const isCorridorCol = (col: number): boolean => {
    if (corridorRow < 0) return false;
    for (let k = 0; k < CORRIDOR_CELLS; k++) if (!at(col, corridorRow + k)) return false;
    return true;
  };

  // --- Base regions: corridor, rooms (side, index), hall ------------------------------------
  const roomCols = Math.max(2, Math.round(spec.roomWidth / C));
  const base = new Int32Array(W * H).fill(OUT);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      if (!at(col, row)) continue;
      if (corridorRow < 0) { base[row * W + col] = HALL; continue; }
      const inBand = row >= corridorRow && row < corridorRow + CORRIDOR_CELLS;
      if (inBand) { base[row * W + col] = isCorridorCol(col) ? CORRIDOR : HALL; continue; }
      // A room cell must reach the corridor straight across without leaving the footprint.
      const side = row < corridorRow ? 0 : 1;
      let reaches = isCorridorCol(col);
      for (let k = side === 0 ? row + 1 : row - 1; reaches && (side === 0 ? k < corridorRow : k >= corridorRow + CORRIDOR_CELLS); k += side === 0 ? 1 : -1) reaches = at(col, k);
      base[row * W + col] = reaches ? side * 10000 + Math.floor(col / roomCols) : HALL;
    }
  }

  // --- Stair core and elevator (fixed position, all floors) ---------------------------------
  const run = Math.max(2.8, fh / 2 / Math.tan((33 * Math.PI) / 180));
  const coreLen = run + LANDING * 2;
  const coreW = Math.ceil(CORE_W / C), coreH = Math.ceil(coreLen / C), liftN = Math.ceil(LIFT / C);
  type Core = { col: number; row: number; side: 0 | 1; liftCol: number | null };
  let core: Core | null = null;
  const free = (c0: number, r0: number, w: number, h: number): boolean => {
    for (let row = r0; row < r0 + h; row++) for (let col = c0; col < c0 + w; col++) {
      const v = col >= 0 && row >= 0 && col < W && row < H ? base[row * W + col]! : OUT;
      if (v === OUT || v === CORRIDOR) return false;
    }
    return true;
  };
  if (levels > 1) {
    // Against the corridor (landing end touching it), else anywhere with the landing end facing +y.
    const tries: { row: number; side: 0 | 1 }[] = corridorRow >= 0
      ? [{ row: corridorRow - coreH, side: 0 }, { row: corridorRow + CORRIDOR_CELLS, side: 1 }]
      : Array.from({ length: Math.max(0, H - coreH + 1) }, (_, row) => ({ row, side: 0 as const }));
    for (const t of tries) {
      for (let col = 0; col + coreW <= W && !core; col++) {
        if (!free(col, t.row, coreW, coreH)) continue;
        // Without a corridor, the landing end needs open floor in front of it.
        if (corridorRow < 0 && !free(col, t.row + coreH, coreW, 3)) continue;
        // Elevator beside the core, on its landing end.
        const lr = t.side === 0 ? t.row + coreH - liftN : t.row;
        const liftCol = free(col + coreW, lr, liftN, liftN) ? col + coreW : free(col - liftN, lr, liftN, liftN) ? col - liftN : null;
        core = { col, row: t.row, side: t.side, liftCol };
      }
      if (core) break;
    }
  }

  // No room for a stair core: an elevator alone still reaches every floor.
  let liftOnly: { col: number; row: number } | null = null;
  if (levels > 1 && !core) {
    for (let row = 0; row + liftN + 3 <= H && !liftOnly; row++) {
      for (let col = 0; col + liftN <= W && !liftOnly; col++) {
        if (free(col, row, liftN, liftN) && free(col, row + liftN, liftN, 3)) liftOnly = { col, row };
      }
    }
  }

  // --- Entrance in plan coordinates -------------------------------------------------------------
  let doorCell: [number, number] | null = null;
  if (entrance) {
    const j = (entrance.edge + 1) % n;
    const [pu, pv] = local[entrance.edge]!, [qu, qv] = local[j]!;
    const len = Math.hypot(qu - pu, qv - pv) || 1;
    const t = entrance.along / len;
    // A point 0.6 m inside the wall at the door centre.
    const nu = (qv - pv) / len, nv = -(qu - pu) / len; // outward in the local frame (same handedness as world)
    const u = pu + (qu - pu) * t - nu * 0.6, v = pv + (qv - pv) * t - nv * 0.6;
    doorCell = [Math.floor((u - U0) / C), Math.floor((v - V0) / C)];
  }

  // --- Floors -------------------------------------------------------------------------------------
  const ceiling = Math.max(2.6, fh - 0.3);
  const floors: Record<string, FloorPlan> = {};
  const levelIds = Array.from({ length: levels }, (_, k) => `${k + 1}F`);
  const directory: BuildingSource['directory'] = [];

  levelIds.forEach((levelId, k) => {
    const cells = Int32Array.from(base);
    if (core) {
      for (let row = core.row; row < core.row + coreH; row++) for (let col = core.col; col < core.col + coreW; col++) cells[row * W + col] = STAIR;
      if (core.liftCol !== null) {
        const lr = core.side === 0 ? core.row + coreH - liftN : core.row;
        for (let row = lr; row < lr + liftN; row++) for (let col = core.liftCol; col < core.liftCol + liftN; col++) cells[row * W + col] = LIFT_CELL;
      }
    }
    if (liftOnly) for (let row = liftOnly.row; row < liftOnly.row + liftN; row++) for (let col = liftOnly.col; col < liftOnly.col + liftN; col++) cells[row * W + col] = LIFT_CELL;
    // Ground-floor lobby: rooms around the entrance open up into the hall.
    if (k === 0 && doorCell) {
      const id = cells[doorCell[1] * W + doorCell[0]];
      if (id !== undefined && id >= 0) {
        const lobbyCols = Math.ceil(2.5 / C);
        for (let i = 0; i < cells.length; i++) {
          const v = cells[i]!;
          if (v >= 0 && Math.floor(v / 10000) === Math.floor(id / 10000) && Math.abs((i % W) - doorCell[0]) <= lobbyCols + roomCols) cells[i] = HALL;
        }
      }
    }

    tidyRooms(cells, W, H, roomCols);

    // Region → space index.
    const spaces: Space[] = [];
    const openings: Opening[] = [];
    const spaceOf = new Map<number, number>();
    const rectsOf = (id: number): Rect[] => mergeCells(cells, W, H, id).map(([c0, r0, c1, r1]) => [c0 * C, r0 * C, c1 * C, r1 * C]);
    const ids = [...new Set(cells)].filter((v) => v !== OUT).sort((a, b) => a - b);
    let roomNo = 0;
    const roomNames = new Set<string>();
    for (const id of ids) {
      const rects = rectsOf(id);
      if (!rects.length) continue;
      const area = rects.reduce((a, [x0, y0, x1, y1]) => a + (x1 - x0) * (y1 - y0), 0);
      let space: Space;
      if (id === CORRIDOR) space = { id: `${levelId}-corridor`, name: '走廊', kind: 'corridor', ceiling, group: 'circ', rects };
      else if (id === HALL) {
        const name = k === 0 ? '大廳' : corridorRow < 0 ? (spec.hall ? spec.room(area).name : '大廳') : '走廊';
        space = { id: `${levelId}-hall`, name, kind: 'lobby', ceiling, group: 'circ', rects, ...(spec.hall && corridorRow < 0 ? { furnish: spec.hall } : {}) };
      } else if (id === STAIR) space = { id: `${levelId}-stair`, name: '樓梯', kind: 'stair', ceiling, rects, ...(k < levels - 1 ? { noCeiling: true } : {}) };
      else if (id === LIFT_CELL) space = { id: `${levelId}-lift`, name: '電梯', kind: 'elevator', ceiling, rects };
      else {
        if (area < 4) { // slivers become part of the circulation
          for (let i = 0; i < cells.length; i++) if (cells[i] === id) cells[i] = HALL;
          continue;
        }
        roomNo++;
        const { name, furnish } = spec.room(area);
        roomNames.add(name);
        const code = `${k + 1}${String(roomNo).padStart(2, '0')}`;
        space = { id: `${levelId}-${code}`, code, name, kind: 'room', ceiling, rects, furnishMain: true, ...(furnish ? { furnish } : {}) };
      }
      spaceOf.set(id, spaces.length);
      spaces.push(space);
    }
    // Slivers merged into the hall after its rects were collected: rebuild the hall's rects.
    const hallIndex = spaceOf.get(HALL);
    if (hallIndex !== undefined) spaces[hallIndex]!.rects = rectsOf(HALL);
    else if (cells.includes(HALL)) {
      spaceOf.set(HALL, spaces.length);
      spaces.push({ id: `${levelId}-hall`, name: '走廊', kind: 'lobby', ceiling, group: 'circ', rects: rectsOf(HALL) });
    }

    // Dorms: the room nearest the stairs on every floor is the shared restroom.
    if (kind === 'dorm') {
      const [hx, hy] = core ? [(core.col + coreW / 2) * C, (core.row + coreH / 2) * C]
        : liftOnly ? [(liftOnly.col + liftN / 2) * C, (liftOnly.row + liftN / 2) * C]
        : doorCell ? [doorCell[0] * C, doorCell[1] * C] : [0, 0];
      // Nearest room big enough for stalls and sinks (else the biggest one).
      let pick: Space | null = null;
      let pickScore = Infinity;
      for (const sp of spaces) {
        if (sp.kind !== 'room') continue;
        let area = 0, cx = 0, cy = 0;
        for (const [x0, y0, x1, y1] of sp.rects) {
          const a = (x1 - x0) * (y1 - y0);
          area += a;
          cx += ((x0 + x1) / 2) * a;
          cy += ((y0 + y1) / 2) * a;
        }
        const score = area >= 18 ? Math.hypot(cx / area - hx, cy / area - hy) : 1e6 - area;
        if (score < pickScore) { pickScore = score; pick = sp; }
      }
      if (pick) {
        pick.name = '共用廁所';
        pick.kind = 'toilet';
        pick.furnish = 'restroom';
        roomNames.add('共用廁所');
      }
    }

    // Doors: each room gets one 1 m door on its longest run of boundary with the circulation.
    for (const [id] of spaceOf) {
      if (id < 0) continue;
      const door = doorOnto(cells, W, H, id, (v) => v === CORRIDOR || v === HALL);
      if (door) openings.push({ kind: 'door', a: door[0], b: door[1] });
    }
    // Stair landing opens onto the corridor / hall; the elevator gets its sliding door.
    let elevator: FloorPlan['elevator'];
    if (core) {
      const edgeRow = core.side === 0 ? core.row + coreH : core.row;
      const y = edgeRow * C;
      const x0 = core.col * C, x1 = (core.col + coreW) * C;
      if (circulationAlong(cells, W, H, core.col, core.col + coreW, core.side === 0 ? edgeRow : edgeRow - 1)) {
        openings.push({ kind: 'open', a: [x0 + 0.3, y], b: [x1 - 0.3, y] });
      }
      if (core.liftCol !== null) {
        const lx0 = core.liftCol * C, lx1 = (core.liftCol + liftN) * C;
        const lr = core.side === 0 ? core.row + coreH - liftN : core.row;
        const ly = core.side === 0 ? (lr + liftN) * C : lr * C;
        const dir = core.side === 0 ? 1 : -1;
        openings.push({ kind: 'elevator', a: [lx0 + 0.3, ly], b: [lx1 - 0.3, ly], label: '電梯' });
        elevator = { landing: [(lx0 + lx1) / 2, ly + dir * 1.3], facing: [0, -dir] };
      }
    }
    if (liftOnly) {
      const x0 = liftOnly.col * C, x1 = (liftOnly.col + liftN) * C, y = (liftOnly.row + liftN) * C;
      openings.push({ kind: 'elevator', a: [x0 + 0.3, y], b: [x1 - 0.3, y], label: '電梯' });
      elevator = { landing: [(x0 + x1) / 2, y + 1.3], facing: [0, -1] };
    }
    const stalls = k === 0 && kind === 'dining' ? placeStalls(cells, W, H, doorCell) : [];
    floors[levelId] = { bandTop: fh, spaces, openings, signs: [], ...(elevator ? { elevator } : {}), ...(stalls.length ? { stalls } : {}) };
    directory.push({ level: levelId, items: [...roomNames].slice(0, 3) });
  });

  // --- Stairs: two flights per storey, floor landing at the corridor end ------------------------------
  const stairs: Stair[] = [];
  const landings: NonNullable<BuildingSource['landings']> = [];
  if (core) {
    const x0 = core.col * C;
    const yNear = core.side === 0 ? (core.row + coreH) * C : core.row * C; // corridor end
    const sgn = core.side === 0 ? -1 : 1; // direction from the corridor end into the core
    const yFar = yNear + sgn * coreLen;
    const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
    for (let k = 0; k < levels; k++) {
      const low = k * fh;
      const [fl0, fl1] = span(yNear, yNear + sgn * LANDING);
      landings.push({ rect: [x0, fl0, x0 + CORE_W, fl1], elevation: low });
      if (k === levels - 1) break;
      const [r0, r1] = span(yNear + sgn * LANDING, yFar - sgn * LANDING);
      const [ml0, ml1] = span(yFar - sgn * LANDING, yFar);
      const away = sgn > 0 ? '+' : '-', back = sgn > 0 ? '-' : '+';
      stairs.push({ id: `${id}-s${k}a`, name: '樓梯', rect: [x0, r0, x0 + FLIGHT_W, r1], axis: 'y', up: away, low, high: low + fh / 2 });
      landings.push({ rect: [x0, ml0, x0 + CORE_W, ml1], elevation: low + fh / 2 });
      stairs.push({ id: `${id}-s${k}b`, name: '樓梯', rect: [x0 + CORE_W - FLIGHT_W, r0, x0 + CORE_W, r1], axis: 'y', up: back, low: low + fh / 2, high: low + fh });
    }
  }

  const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
  const radius = Math.hypot(U1 - U0, V1 - V0) / 2;
  return {
    centre: [cx, cz],
    radius,
    source: {
      id,
      name: b.name ?? '建築',
      osmReplaces: [],
      transform: { angleDeg, planCentroid: [-U0, -V0], worldCentroid: [cx, cz] },
      floorHeight: fh,
      wallReach: WALL_REACH,
      levels: levelIds.map((lid, k) => ({ id: lid, elevation: k * fh, built: true, elevator: core?.liftCol != null || liftOnly !== null })),
      shell: {},
      floors,
      stairs,
      landings,
      directory,
    },
  };
}

const STALL_LINEUP: readonly Pick<Stall, 'name' | 'menu'>[] = [
  { name: '自助餐', menu: 'buffet' }, { name: '麵食', menu: 'noodles' }, { name: '便當', menu: 'bento' }, { name: '飲料', menu: 'drinks' }, { name: '回收區' },
];
const STALL_CELLS = 11; // 5.5 m each
const STALL_DEPTH = 6; // 3 m

/**
 * Lines the stalls up along the first open band of hall on the side away from the entrance, with
 * their backs to that side. Uses the widest row that fits; fewer stalls if the hall is broken up.
 */
function placeStalls(cells: Int32Array, W: number, H: number, door: [number, number] | null): Stall[] {
  const fromTop = !door || door[1] >= H / 2;
  const rows = Array.from({ length: H - STALL_DEPTH + 1 }, (_, r) => (fromTop ? r : H - STALL_DEPTH - r));
  for (let count = STALL_LINEUP.length; count >= 3; count--) {
    const need = count * STALL_CELLS;
    for (const r of rows) {
      let run = 0;
      for (let c = 0; c <= W; c++) {
        let free = c < W;
        for (let y = r; free && y < r + STALL_DEPTH; y++) free = cells[y * W + c] === HALL;
        // Room to queue in front of the counters.
        const front = fromTop ? r + STALL_DEPTH + 3 : r - 4;
        free = free && front >= 0 && front < H && cells[front * W + c] === HALL;
        if (free) { run++; continue; }
        if (run >= need) {
          const c0 = c - run + Math.floor((run - need) / 2);
          const lineup = count === STALL_LINEUP.length ? STALL_LINEUP : [...STALL_LINEUP.slice(0, count - 1), STALL_LINEUP[STALL_LINEUP.length - 1]!];
          return lineup.map((s, i) => ({
            ...s,
            at: [(c0 + (i + 0.5) * STALL_CELLS) * C, (r + STALL_DEPTH / 2) * C] as [number, number],
            facing: [0, fromTop ? 1 : -1] as [number, number],
            width: STALL_CELLS * C - 0.3,
          }));
        }
        run = 0;
      }
    }
  }
  return [];
}

/** Greedy merge of the cells with `id` into rects [col0, row0, col1, row1). */
/**
 * Regularises the room cells of one floor:
 *  1. each run of room columns along a corridor side is cut into equal-width rooms (no leftover
 *     strips at the ends of a wing or beside the stair core);
 *  2. rooms that are too small, too narrow or cut off from the circulation are merged into the
 *     neighbouring room they share the most wall with (or into the hall when they have none).
 */
function tidyRooms(cells: Int32Array, W: number, H: number, roomCols: number): void {
  for (const side of [0, 1]) {
    const has = new Uint8Array(W);
    for (let i = 0; i < cells.length; i++) if (cells[i]! >= 0 && Math.floor(cells[i]! / 10000) === side) has[i % W] = 1;
    let run = 0;
    for (let c0 = 0; c0 < W; c0++) {
      if (!has[c0]) continue;
      let c1 = c0;
      while (c1 < W && has[c1]) c1++;
      const len = c1 - c0, parts = Math.max(1, Math.round(len / roomCols));
      for (let row = 0; row < H; row++) {
        for (let col = c0; col < c1; col++) {
          const v = cells[row * W + col]!;
          if (v >= 0 && Math.floor(v / 10000) === side) cells[row * W + col] = side * 10000 + run * 100 + Math.min(parts - 1, Math.floor(((col - c0) * parts) / len));
        }
      }
      run++;
      c0 = c1;
    }
  }
  const MIN_AREA = 9 / (C * C), MIN_SPAN = 2.4 / C;
  for (let pass = 0; pass < 6; pass++) {
    const stat = new Map<number, { n: number; c0: number; c1: number; r0: number; r1: number; circ: number; nb: Map<number, number> }>();
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const v = cells[row * W + col]!;
        if (v < 0) continue;
        const s = stat.get(v) ?? stat.set(v, { n: 0, c0: col, c1: col, r0: row, r1: row, circ: 0, nb: new Map() }).get(v)!;
        s.n++;
        s.c0 = Math.min(s.c0, col); s.c1 = Math.max(s.c1, col);
        s.r0 = Math.min(s.r0, row); s.r1 = Math.max(s.r1, row);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const c = col + dc, r = row + dr;
          if (c < 0 || r < 0 || c >= W || r >= H) continue;
          const o = cells[r * W + c]!;
          if (o === CORRIDOR || o === HALL) s.circ++;
          else if (o >= 0 && o !== v) s.nb.set(o, (s.nb.get(o) ?? 0) + 1);
        }
      }
    }
    let changed = false;
    // Smallest first, one merge per room per pass, so a chain of slivers folds up cleanly.
    const merged = new Set<number>();
    for (const [id, s] of [...stat].sort((a, b) => a[1].n - b[1].n)) {
      if (merged.has(id)) continue;
      const bad = s.n < MIN_AREA || Math.min(s.c1 - s.c0 + 1, s.r1 - s.r0 + 1) < MIN_SPAN || s.circ < 2;
      if (!bad) continue;
      let into = HALL, most = 0;
      for (const [o, k] of s.nb) if (!merged.has(o) && k > most) { most = k; into = o; }
      // An isolated pocket with no room beside it and no way in is not floor space at all.
      if (into === HALL && s.circ === 0) into = OUT;
      for (let i = 0; i < cells.length; i++) if (cells[i] === id) cells[i] = into;
      merged.add(id);
      if (into >= 0) merged.add(into);
      changed = true;
    }
    if (!changed) break;
  }
}

function mergeCells(cells: Int32Array, W: number, H: number, id: number): [number, number, number, number][] {
  const used = new Uint8Array(W * H);
  const out: [number, number, number, number][] = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      if (used[row * W + col] || cells[row * W + col] !== id) continue;
      let c1 = col;
      while (c1 < W && !used[row * W + c1] && cells[row * W + c1] === id) c1++;
      let r1 = row + 1;
      grow: while (r1 < H) {
        for (let c = col; c < c1; c++) if (used[r1 * W + c] || cells[r1 * W + c] !== id) break grow;
        r1++;
      }
      for (let r = row; r < r1; r++) for (let c = col; c < c1; c++) used[r * W + c] = 1;
      out.push([col, row, c1, r1]);
    }
  }
  return out;
}

/** True if any cell of row `row` in [c0, c1) is circulation (corridor or hall). */
function circulationAlong(cells: Int32Array, W: number, H: number, c0: number, c1: number, row: number): boolean {
  if (row < 0 || row >= H) return false;
  for (let c = Math.max(0, c0); c < Math.min(W, c1); c++) {
    const v = cells[row * W + c]!;
    if (v === CORRIDOR || v === HALL) return true;
  }
  return false;
}

/**
 * A door (two plan points, 1 m apart) on the room's boundary with cells matching `onto`, centred on
 * the longest straight run of that boundary.
 */
function doorOnto(cells: Int32Array, W: number, H: number, id: number, onto: (v: number) => boolean): [[number, number], [number, number]] | null {
  const cellsNeeded = Math.round(DOOR / C);
  let best: { len: number; pts: [[number, number], [number, number]] } | null = null;
  // Horizontal boundaries (between row and row + 1), scanning runs along x.
  for (let row = 0; row + 1 < H; row++) {
    for (const [here, there] of [[row, row + 1], [row + 1, row]] as const) {
      let start = -1;
      for (let col = 0; col <= W; col++) {
        const ok = col < W && cells[here * W + col] === id && onto(cells[there * W + col]!);
        if (ok && start < 0) start = col;
        if (!ok && start >= 0) {
          const len = col - start;
          if (len >= cellsNeeded && (!best || len > best.len)) {
            const mid = Math.floor((start + col - cellsNeeded) / 2);
            const y = (row + 1) * C;
            best = { len, pts: [[mid * C, y], [(mid + cellsNeeded) * C, y]] };
          }
          start = -1;
        }
      }
    }
  }
  // Vertical boundaries (between col and col + 1), scanning runs along y.
  for (let col = 0; col + 1 < W; col++) {
    for (const [here, there] of [[col, col + 1], [col + 1, col]] as const) {
      let start = -1;
      for (let row = 0; row <= H; row++) {
        const ok = row < H && cells[row * W + here] === id && onto(cells[row * W + there]!);
        if (ok && start < 0) start = row;
        if (!ok && start >= 0) {
          const len = row - start;
          if (len >= cellsNeeded && (!best || len > best.len)) {
            const mid = Math.floor((start + row - cellsNeeded) / 2);
            const x = (col + 1) * C;
            best = { len, pts: [[x, mid * C], [x, (mid + cellsNeeded) * C]] };
          }
          start = -1;
        }
      }
    }
  }
  return best?.pts ?? null;
}
