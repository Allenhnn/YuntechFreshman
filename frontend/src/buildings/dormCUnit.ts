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
 *  - 2 樓這戶（`source`）只有走廊、雜物間、交誼廳，照手繪平面排：陽台右邊那扇窗＝寢室 1（這裡只有牆上的門）、
 *    退縮的戶廳窗＝交誼廳（東牆關著的大門）；寢室門畫在牆上；浴室入口是走廊西端一片黑幕；
 *  - 四間寢室（4.2 × 8.0 m，四間一樣）和浴室（使用者：廁所也跟寢室一樣挪到別處，黑幕對黑幕按 E 傳送）另外蓋在地底
 *    `DORM_C_ROOMS_FLOOR`（`rooms`，看不到），按 E 傳送進出（`roomDoors`）。
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

/**
 * Plan rects (m) of the 2F flat: the user's sketch scaled to fit the building. Across, the living room exactly fills the
 * recessed hall bay (使用者標註：紅框＝戶廳的範圍，對齊、不要延伸到旁邊): x = 16.55 + 0.02875·(px − 397), so room 1 lands
 * behind the window right of the balcony (藍框); down, 0.045 m per pixel with the living room's front on the hall window,
 * y = 11.2 − 0.045·(522 − py). Only what you walk through is built — corridor, store room, living room; rooms 1–4 and the
 * bath are elsewhere (teleport), their doors drawn where the sketch's quarter circles are. Then, per the user's marked
 * screenshots: the living room's west wall stops short (the corridor runs on south to y 6.5), and the store room
 * (工作室) is entered from the corridor's south wall by its west end and reaches down to the balcony's doorway.
 */
export const DORM_C_UNIT_PLAN = {
  // North wall in line with the living room's (使用者：包含走廊也縮小); south wall where the living room's west wall ends (使用者紅線);
  // its west end (x 10.8–12.2) is the short passage of the user's cloth/work/bath sketch: the bath's curtain on its north
  // side, the work room's door on its south side.
  corridor: [10.8, 3.6, 16.55, 6.5],
  // The cloth/work/bath sketch (sketch turned round: its top is the front, its left is east), ≈ 0.0125 m per pixel across,
  // 0.0141 down. 工作室 (work): L-shaped — a wide part south of the passage, and a narrower part on north beside it.
  other: [7.8, 6.5, 12.2, 9.6],
  otherNorth: [7.8, 3.6, 10.8, 6.5],
  // 曬衣間 (cloth): exactly as wide as the balcony's opening (使用者：曬衣間的範圍跟窗戶一樣), going back behind it to the
  // work room — the balcony (whose back wall is gone on this floor) is its front; furnished from the user's photos.
  cloth: [4.24, 9.6, 12.24, 13.4],
  living: [16.55, 3.6, 22.3, 11.2], // the recessed hall bay, 7.6 m in from its window (使用者：戶廳太寬，縮小一點)
} satisfies Record<string, Rect>;
const R = DORM_C_UNIT_PLAN;
/** The work room's window into the laundry: plan x range in their shared wall. */
export const DORM_C_WORK_WINDOW = [8.0, 9.2] as const;
/** Floor level of the bedrooms and the bathroom (m): below ground, out of sight, above the fall-out-of-world net at −40. */
export const DORM_C_ROOMS_FLOOR = -20;
/** The four bedrooms (plan, same transform as the flat): 4.2 × 8.0 m side by side, window wall north, door wall south. */
export const DORM_C_ROOMS: readonly Rect[] = [0, 1, 2, 3].map((k) => [k * 4.2, 20, (k + 1) * 4.2, 28] as Rect);
/** The bathroom, beside them: its curtained doorway in the middle of the south wall. */
export const DORM_C_BATH: Rect = [17.6, 23.0, 21.2, 28.0]; // edges on the 0.1 m grid (the wall generator snaps to it)
/** A room's door: this far along its door wall from the room's west side. */
export const DORM_C_ROOM_DOOR = [1.6, 2.6] as const;
const doorMid = (DORM_C_ROOM_DOOR[0] + DORM_C_ROOM_DOOR[1]) / 2;
/** Where the bath's curtain hangs on its south wall (plan x centre). */
export const DORM_C_BATH_CURTAIN = (DORM_C_BATH[0] + DORM_C_BATH[2]) / 2 + 0.3; // in the aisle between the stalls and the urinals
/** The doors drawn on the flat's walls: centre (plan) and the unit normal into the flat. The bath's is a black curtain. */
const FLAT_DOORS: { name: string; at: [number, number]; out: [number, number]; room: number }[] = [
  { name: '寢室 1', at: [15.9, R.corridor[3]], out: [0, -1], room: 0 },
  { name: '寢室 2', at: [15.13, R.corridor[1]], out: [0, 1], room: 1 },
  { name: '寢室 3', at: [18.0, R.living[1]], out: [0, 1], room: 2 },
  { name: '寢室 4', at: [20.73, R.living[1]], out: [0, 1], room: 3 },
  { name: '浴室', at: [11.5, R.corridor[1]], out: [0, 1], room: -1 },
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
  roomDoors: { name: string; at: [number, number]; out: [number, number]; inside: [number, number]; curtain: boolean }[];
  /** The 2F balcony (the laundry) in plan: x0..x1 between its end walls, y from its back wall to its parapet. */
  balcony: Rect;
  /** Where the laundry room opens onto the balcony (plan x range along its south wall). */
  clothOpen: [number, number];
  /** The laundry's east door, into the work room (plan x range in their shared wall). */
  clothDoor: [number, number];
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
  const clothOpen: [number, number] = [bx0 + 0.1, bx1 - 0.1]; // between the balcony's end walls
  const clothDoor: [number, number] = [9.95, 11.35]; // the laundry's east door (the sketch's wide blue line), into the work room

  const space = (id: string, name: string, kind: Space['kind'], rects: Rect[]): Space => ({
    id: `dormC-unit-${id}`, name, kind, ceiling: CEILING, rects,
  });
  // No generated furniture: everything inside is modelled from the photos in dormCUnitDecor.ts.
  const spaces: Space[] = [
    space('corridor', '走廊', 'corridor', [R.corridor]),
    // Not a 'room' (its doorways stay plain gaps, no door leaves); two rects, each under 6 m, so the generator doesn't hang
    // a corridor fire-hose cabinet in it.
    space('other', '工作室', 'corridor', [R.other, R.otherNorth]),
    // Two rects (each under 6 m) so the generator doesn't hang a corridor fire-hose cabinet in it.
    space('cloth', '曬衣間', 'corridor', [0, 1].map((k): Rect => [R.cloth[0] + (k * (R.cloth[2] - R.cloth[0])) / 2, R.cloth[1], R.cloth[0] + ((k + 1) * (R.cloth[2] - R.cloth[0])) / 2, R.cloth[3]])),
    space('living', '交誼廳', 'lobby', [R.living]),
  ];
  const openings: Opening[] = [
    // The bedroom doors and the bath's curtain are not openings (使用者：靠近房門按 E 直接傳送): drawn on the walls in the decor.
    // 工作室: off the passage at the corridor's west end (使用者草圖的藍線).
    door(R.corridor[0] + 0.05, R.other[1], R.other[2] - 0.05, R.other[1]),
    // Work room → laundry (the sketch's wide blue line, near the east end), and the laundry open onto the balcony.
    door(clothDoor[0], R.other[3], clothDoor[1], R.other[3]),
    // The work room's window into the laundry, at the west corner (使用者照片): a gap in the wall, the decor builds the sill,
    // the glass and the frame in it.
    door(DORM_C_WORK_WINDOW[0], R.other[3], DORM_C_WORK_WINDOW[1], R.other[3], 'open'),
    door(clothOpen[0], R.cloth[3], clothOpen[1], R.cloth[3], 'open'),
    // The corridor carries on into the living room; the flat's own front door, shut, in the living room's east wall.
    door(R.living[0], R.living[1], R.living[0], R.corridor[3], 'open'),
    door(R.living[2], 6.2, R.living[2], 7.2, 'closed'),
  ];
  const roomSpaces: Space[] = [...DORM_C_ROOMS.map((q, k) => space(`room${k + 1}`, `寢室 ${k + 1}`, 'room', [q])), space('bath', '浴室', 'toilet', [DORM_C_BATH])];
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
    directory: [{ level: 'B', items: ['寢室', '浴室'] }],
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
    arrive: { at: [20.6, 6.0], facing: [-1, 0] }, // clear of the 「離開宿舍」 spot (1 m) and the furniture
    leave: [21.7, 6.7],
    rooms,
    roomDoors: FLAT_DOORS.map(({ room, ...d }) => {
      const inside: [number, number] = room < 0 ? [DORM_C_BATH_CURTAIN, DORM_C_BATH[3]] : [DORM_C_ROOMS[room]![0] + doorMid, DORM_C_ROOMS[room]![3]];
      return { ...d, inside, curtain: room < 0 };
    }),
    balcony,
    clothOpen,
    clothDoor,
  };
}
