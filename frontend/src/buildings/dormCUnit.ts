import type { BuildingSource, Opening, Space } from './buildingTypes';
import type { CampusData } from '../campus/campusTypes';
import { DORM_C } from '../campus/customFacades';

/**
 * 學生宿舍C 東翼一樓的一戶寢室（使用者手繪平面＋浴室／曬衣間／寢室照片，2026-11-23），用手工建築的管線生成牆、門與家具：
 *  - 北排（東翼較窄的北段）：浴室（廁所隔間、小便斗、洗手台與鏡子）、寢室 2、3、4（各四張上床下桌、衣櫃、書桌椅）；
 *  - 中間一條走廊；
 *  - 南排：雜物間（other）在走廊西端下方，再往南是曬衣間（cloth，東翼西南角，比北排更往西凸出），寢室 1，
 *    交誼廳（Living，跟走廊打通，東牆一樘關著的出入口門）。
 * 平面座標：原點在東翼西南角（往內縮一點），+x 沿南端牆往東、+y 往南（北排在 y 小的那邊）。
 * 東翼移動或外形變了就沿用新的轉角：位置由執行時的東翼外形算出（campusFixes.ts splitDormC）。
 *
 * 進出：不從外面走進來——在北棟一樓門廳（C3 大門）前按 E「進入宿舍」直接到寢室 1 門口，
 * 在交誼廳出入口按 E「離開宿舍」回到門廳前（main.ts）。
 */

type Rect = [number, number, number, number];
/** Inset from the east wing's outer walls (its walls and the facade skin stand outside this). */
const INSET = 0.5;
/** Plan rects (m), plan origin = the wing's south-west corner moved INSET in from both walls; y up to 0 is the south wall. */
const R = {
  // Edges on the furniture planner's 0.1 m cells (an edge mid-cell reads as wall there). North rooms
  // 5.4 m deep: four lofts with the door at the corridor end.
  bath: [2.3, -14.7, 4.5, -9.3],
  room2: [4.5, -14.7, 7.2, -9.3],
  room3: [7.2, -14.7, 9.9, -9.3],
  room4: [9.9, -14.7, 12.5, -9.3],
  corridor: [2.3, -9.3, 12.5, -7.5],
  other: [2.3, -7.5, 4.5, -5.0],
  cloth: [0, -5.0, 4.5, 0],
  room1: [4.5, -7.5, 7.2, 0],
  living: [7.2, -7.5, 12.5, 0],
} satisfies Record<string, Rect>;
const HEIGHT = 3.6;
const CEILING = 3.0;

/** Plan y is stored shifted by +SHIFT so every coordinate is positive. */
const SHIFT = 16;
const sh = (r: Rect): Rect => [r[0], r[1] + SHIFT, r[2], r[3] + SHIFT];
const door = (ax: number, ay: number, bx: number, by: number, kind: Opening['kind'] = 'door'): Opening => ({ kind, a: [ax, ay + SHIFT], b: [bx, by + SHIFT] });

export interface DormCUnit {
  source: BuildingSource;
  /** Where 「進入宿舍」 puts you (plan point and facing, inside 寢室 1 by its door). */
  arrive: { at: [number, number]; facing: [number, number] };
  /** The 「離開宿舍」 spot in the living room (plan). */
  leave: [number, number];
}

export function dormCUnit(campus: CampusData): DormCUnit | null {
  const wing = campus.buildings.find((b) => b.id === DORM_C.eastWing);
  if (!wing || wing.outer.length < 14) return null;
  // The wing's south end runs 7s → 8s (ring points 4 → 5): 8s is the south-west corner.
  const r = wing.outer, ex = r[8]! - r[10]!, ez = r[9]! - r[11]!, el = Math.hypot(ex, ez);
  const e: [number, number] = [ex / el, ez / el]; // east along the south end
  const s: [number, number] = [-e[1], e[0]]; // south (out of the south end)
  const corner: [number, number] = [r[10]! + e[0] * INSET - s[0] * INSET, r[11]! + e[1] * INSET - s[1] * INSET];
  const angleDeg = (Math.atan2(e[1], e[0]) * 180) / Math.PI;

  const space = (id: string, name: string, kind: Space['kind'], rect: Rect, furnish?: Space['furnish']): Space => ({
    id: `dormC-unit-${id}`, name, kind, ceiling: CEILING, rects: [sh(rect)], ...(furnish ? { furnish } : {}),
  });
  const spaces: Space[] = [
    space('bath', '浴室', 'toilet', R.bath, 'restroom'),
    space('room2', '寢室 2', 'room', R.room2, 'dormLoft'),
    space('room3', '寢室 3', 'room', R.room3, 'dormLoft'),
    space('room4', '寢室 4', 'room', R.room4, 'dormLoft'),
    space('corridor', '走廊', 'corridor', R.corridor),
    space('other', '雜物間', 'room', R.other),
    space('cloth', '曬衣間', 'room', R.cloth),
    space('room1', '寢室 1', 'room', R.room1, 'dormLoft'),
    space('living', '交誼廳', 'lobby', R.living, 'discussion'),
  ];
  const y = (r: Rect, side: 'n' | 's'): number => (side === 'n' ? r[1] : r[3]);
  const openings: Opening[] = [
    // North row: doors in their south walls, onto the corridor.
    door(3.0, y(R.bath, 's'), 4.0, y(R.bath, 's')),
    door(5.2, y(R.room2, 's'), 6.2, y(R.room2, 's')),
    door(7.9, y(R.room3, 's'), 8.9, y(R.room3, 's')),
    door(10.6, y(R.room4, 's'), 11.6, y(R.room4, 's')),
    // Other: off the corridor, and on to the laundry.
    door(2.9, y(R.other, 'n'), 3.9, y(R.other, 'n')),
    door(2.9, y(R.other, 's'), 3.9, y(R.other, 's')),
    // Room 1 off the corridor; the living room open to it; the flat's own front door, shut.
    door(5.2, y(R.room1, 'n'), 6.2, y(R.room1, 'n')),
    door(7.4, y(R.living, 'n'), 12.3, y(R.living, 'n'), 'open'),
    door(12.5, -4.5, 12.5, -3.5, 'closed'),
  ];
  const source: BuildingSource = {
    id: 'dormC-unit',
    name: '學生宿舍C 東翼寢室',
    osmReplaces: [],
    transform: { angleDeg, planCentroid: [0, SHIFT], worldCentroid: corner },
    floorHeight: HEIGHT,
    style: { windows: true },
    levels: [{ id: '1F', elevation: 0, built: true }],
    shell: {},
    floors: { '1F': { bandTop: HEIGHT, spaces, openings, signs: [] } },
    stairs: [],
    landings: [],
    directory: [{ level: '1F', items: ['寢室', '浴室', '交誼廳'] }],
  };
  return {
    source,
    // Inside 寢室 1, between the lofts, facing its door (the camera then sits in the room behind you).
    arrive: { at: [5.85, -2.2 + SHIFT], facing: [0, -1] },
    leave: [11.7, -4.0 + SHIFT],
  };
}
