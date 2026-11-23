import type { BuildingSource, Opening, Space } from './buildingTypes';
import type { CampusData } from '../campus/campusTypes';
import { DORM_C, DORM_C_BALCONY } from '../campus/customFacades';

/**
 * 學生宿舍C 的一戶寢室（使用者手繪平面＋浴室／曬衣間／寢室照片，2026-11-23），用手工建築的管線生成牆、門、地板天花板；
 * 裡面的東西全照照片在 dormCUnitDecor.ts 手工建模。
 *
 * 位置（使用者標註）：北棟中段 2 樓、C3 門口正上方那層的東半邊——曬衣間就是正面那個 2 樓花磚陽台（dormCFacade.ts 的
 * laundryRoom），雜物間南牆一個門洞走出去；整戶在中段的空殼裡面。
 * 中段只有約 13 m 深，寢室放進來會把寢室和交誼廳都壓小（使用者：寢室可以挪到 C3 任何一處，靠近房門按 E 直接傳送到寢室內）：
 *  - 2 樓這戶（`source`）只有公共的部分，照手繪平面的排法：浴室、走廊（北牆三扇、南牆一扇寢室門，畫在牆上）、雜物間、
 *    交誼廳（加大，佔陽台右邊那扇窗到退縮的戶廳窗，跟走廊打通，東牆關著的大門）；
 *  - 四間寢室（`rooms`）照放大後的尺寸 4.2 × 8.0 m 另外蓋在地底 `DORM_C_ROOMS_FLOOR`（看不到），四間一樣，
 *    門畫在牆上，按 E 傳送進出（`roomDoors`）。
 *
 * 平面座標＝立面的座標：原點在中段正面（edge 5）的西端（vertex 6），+x 沿正面往東，+y 朝外（南）再加 `FRONT_Y`
 * ——正面牆線在 y = FRONT_Y，室內在它北邊。寢室那棟用同一個轉換，放在 y ≥ 20（正面外的地底）。
 * 進出（main.ts）：一樓門廳（C3 大門）前按 E「進入宿舍」到 2 樓交誼廳門口；交誼廳出入口按 E「離開宿舍」回門廳前。
 */

type Rect = [number, number, number, number];
/** Floor level of the flat (m): the middle block's 2F. */
export const DORM_C_UNIT_FLOOR = DORM_C_BALCONY.floors[0];
const HEIGHT = 3.6;
const CEILING = 3.0;
/** Plan y of the middle block's front wall line (OSM edge 5). */
export const FRONT_Y = 14;

/** Plan rects (m) of the 2F flat, fitted inside the middle block (back wall at y ≈ 0.9, east end at x ≈ 22.45). */
export const DORM_C_UNIT_PLAN = {
  bath: [7.0, 1.05, 10.6, 5.0],
  corridor: [8.6, 5.0, 22.3, 7.0],
  other: [10.0, 7.0, 12.2, 13.45], // its south wall stops just behind the balcony's back wall
  living: [14.0, 7.0, 16.4, 13.85],
  livingEast: [16.4, 7.0, 22.3, 11.2], // behind the recessed hall window
} satisfies Record<string, Rect>;
const R = DORM_C_UNIT_PLAN;
/** Floor level of the bedrooms (m): below ground, out of sight, above the fall-out-of-world net at −40. */
export const DORM_C_ROOMS_FLOOR = -20;
/** The four bedrooms (plan, same transform as the flat): 4.2 × 8.0 m side by side, window wall north, door wall south. */
export const DORM_C_ROOMS: readonly Rect[] = [0, 1, 2, 3].map((k) => [k * 4.2, 20, (k + 1) * 4.2, 28] as Rect);
/** A room's door: this far along its door wall from the room's west side. */
export const DORM_C_ROOM_DOOR = [1.6, 2.6] as const;
const doorMid = (DORM_C_ROOM_DOOR[0] + DORM_C_ROOM_DOOR[1]) / 2;
/** The bedroom doors drawn on the flat's corridor walls: centre (plan) and the unit normal into the corridor. */
const FLAT_DOORS: { name: string; at: [number, number]; out: [number, number] }[] = [
  { name: '寢室 1', at: [13.1, R.corridor[3]], out: [0, -1] },
  { name: '寢室 2', at: [12.3, R.corridor[1]], out: [0, 1] },
  { name: '寢室 3', at: [16.1, R.corridor[1]], out: [0, 1] },
  { name: '寢室 4', at: [19.9, R.corridor[1]], out: [0, 1] },
];

const door = (ax: number, ay: number, bx: number, by: number, kind: Opening['kind'] = 'door'): Opening => ({ kind, a: [ax, ay], b: [bx, by] });

export interface DormCUnit {
  source: BuildingSource;
  /** Where 「進入宿舍」 puts you (plan point and facing, in the living room by its front door). */
  arrive: { at: [number, number]; facing: [number, number] };
  /** The 「離開宿舍」 spot in the living room (plan). */
  leave: [number, number];
  /** The bedrooms, a building of their own (underground); same plan transform as the flat. */
  rooms: BuildingSource;
  /**
   * Bedroom doors: on the flat's corridor wall (`at`, `out` into the corridor) and, inside the bedroom, the middle of its
   * door wall (`inside`, the room is toward −y).
   */
  roomDoors: { name: string; at: [number, number]; out: [number, number]; inside: [number, number] }[];
  /** The 2F balcony (the laundry) in plan: x0..x1 between its end walls, y from its back wall to its parapet. */
  balcony: Rect;
  /** The doorway from the store room onto the balcony (plan x range, in the balcony's back wall). */
  balconyDoor: [number, number];
}

export function dormCUnit(campus: CampusData): DormCUnit | null {
  const mid = campus.buildings.find((b) => b.id === DORM_C.middle);
  if (!mid || mid.outer.length < 14) return null;
  // The front (edge 5) runs vertex 5 → vertex 6 (east → west); the plan's x runs the other way, from vertex 6.
  const r = mid.outer, x5 = r[10]!, z5 = r[11]!, x6 = r[12]!, z6 = r[13]!;
  const L = Math.hypot(x5 - x6, z5 - z6);
  const angleDeg = (Math.atan2(z5 - z6, x5 - x6) * 180) / Math.PI;
  // The balcony as the facade draws it (dormCFacade laundryRoom): between x = L − a1 and L − a0, back wall `depth` in.
  const bx0 = L - DORM_C_BALCONY.a1, bx1 = L - DORM_C_BALCONY.a0;
  const balcony: Rect = [bx0, FRONT_Y - DORM_C_BALCONY.depth - 0.02, bx1, FRONT_Y + 1.3];
  const balconyDoor: [number, number] = [bx1 - 1.6, bx1 - 0.7]; // its east door (laundryRoom: 0.7–1.6 m in from the end)

  const space = (id: string, name: string, kind: Space['kind'], rects: Rect[]): Space => ({
    id: `dormC-unit-${id}`, name, kind, ceiling: CEILING, rects,
  });
  // No generated furniture: everything inside is modelled from the photos in dormCUnitDecor.ts.
  const spaces: Space[] = [
    space('bath', '浴室', 'toilet', [R.bath]),
    space('corridor', '走廊', 'corridor', [R.corridor]),
    space('other', '雜物間', 'corridor', [R.other]), // not a 'room': its doorways stay plain gaps, no door leaves
    space('living', '交誼廳', 'lobby', [R.living, R.livingEast]),
  ];
  const openings: Opening[] = [
    // The bedroom doors are not openings (使用者：靠近房門按 E 直接傳送到寢室內): drawn on the corridor walls in the decor.
    door(9.5, R.bath[3], 10.4, R.bath[3]),
    // Store room: off the corridor, and out through the balcony's back wall onto the laundry balcony.
    door(10.5, R.other[1], 11.4, R.other[1]),
    door(balconyDoor[0], R.other[3], balconyDoor[1], R.other[3]),
    // The living room open to the corridor along its whole width; the flat's own front door, shut.
    door(R.living[0] + 0.1, R.corridor[3], R.livingEast[2] - 0.1, R.corridor[3], 'open'),
    door(R.livingEast[2], 8.0, R.livingEast[2], 9.0, 'closed'),
  ];
  const roomSpaces: Space[] = DORM_C_ROOMS.map((q, k) => space(`room${k + 1}`, `寢室 ${k + 1}`, 'room', [q]));
  const rooms: BuildingSource = {
    id: 'dormC-rooms',
    name: '學生宿舍C 寢室',
    osmReplaces: [],
    transform: { angleDeg, planCentroid: [0, FRONT_Y], worldCentroid: [x6, z6] },
    floorHeight: HEIGHT,
    style: { windows: false },
    levels: [{ id: 'B', elevation: DORM_C_ROOMS_FLOOR, built: true }],
    shell: {},
    floors: { B: { bandTop: HEIGHT, spaces: roomSpaces, openings: [], signs: [] } },
    stairs: [],
    landings: [],
    directory: [{ level: 'B', items: ['寢室'] }],
  };
  const source: BuildingSource = {
    id: 'dormC-unit',
    name: '學生宿舍C 寢室',
    osmReplaces: [],
    transform: { angleDeg, planCentroid: [0, FRONT_Y], worldCentroid: [x6, z6] },
    floorHeight: HEIGHT,
    style: { windows: false }, // windows are modelled (with an outside view) in the decor
    levels: [{ id: '2F', elevation: DORM_C_UNIT_FLOOR, built: true }],
    shell: {},
    floors: { '2F': { bandTop: HEIGHT, spaces, openings, signs: [] } },
    stairs: [],
    landings: [],
    directory: [{ level: '2F', items: ['寢室', '浴室', '交誼廳'] }],
  };
  return {
    source,
    // In the living room (使用者：進入宿舍是進入戶廳), just inside its front door, facing into the flat.
    arrive: { at: [21.0, 9.8], facing: [-1, 0] }, // clear of the 「離開宿舍」 spot (1 m) and the furniture
    leave: [21.7, 8.5],
    rooms,
    roomDoors: FLAT_DOORS.map((d) => {
      const q = DORM_C_ROOMS[Number(d.name.slice(-1)) - 1]!;
      return { ...d, inside: [q[0] + doorMid, q[3]] as [number, number] };
    }),
    balcony,
    balconyDoor,
  };
}
