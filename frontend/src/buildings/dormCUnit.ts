import type { BuildingSource, Opening, Space } from './buildingTypes';
import type { CampusData } from '../campus/campusTypes';
import { DORM_C } from '../campus/customFacades';

/**
 * 學生宿舍C 東翼的一戶寢室（使用者手繪平面＋浴室／曬衣間／寢室照片，2026-11-23），用手工建築的管線生成牆、門與家具：
 *  - 北排：浴室（廁所隔間、洗手台與鏡子，另加小便斗）、寢室 2、3、4（各四張上床下桌、衣櫃、書桌椅）；
 *  - 中間一條走廊；
 *  - 南排：雜物間（other）在走廊西端，往南是曬衣間（cloth，比北排更往西凸出），寢室 1，
 *    交誼廳（Living，跟走廊打通，東牆一樘關著的出入口門）。
 * 尺寸：手繪平面等比例放大（使用者，2026-11-23）：一間寢室 4.2 × 8.0 m；四間寢室一模一樣（寢室 1 轉 180°）。
 * 這裡只出牆、門與地板天花板，裡面的東西（上床下桌、廁所隔間、曬衣間、交誼廳）全照照片在 dormCUnitDecor.ts 手工建模。
 * 這個大小放不進東翼的外殼，又只能用 E 進出，所以整戶放在東翼正下方地底 `DORM_C_UNIT_FLOOR`（地圖、故事的「宿舍」位置
 * 都還在 C 棟），從地面上看不到。窗外是天空色。
 *
 * 平面座標：+x 沿東翼南端牆往東、+y 往南（北排在 y 小的那邊）；曬衣間西南角對齊東翼西南角。邊線都在家具規劃器的 0.1 m 格上
 * （邊線落在格子中間會被當成牆，廁所隔間就擺不進去）。
 * 進出（main.ts）：北棟一樓門廳（C3 大門）前按 E「進入宿舍」到交誼廳（戶廳）門口；交誼廳出入口按 E「離開宿舍」回門廳前。
 */

type Rect = [number, number, number, number];
/** Floor level of the flat (m): below ground, out of sight, above the fall-out-of-world net at −40. */
export const DORM_C_UNIT_FLOOR = -20;
const HEIGHT = 3.6;
const CEILING = 3.0;

/**
 * Plan rects (m): the sketch scaled up uniformly at 0.042 m per sketch pixel (使用者：等比例放大平面圖), snapped to 0.1 m —
 * one room 4.2 × 8.0 m, all four alike (room 1 is the same room turned round: window south, door north).
 */
export const DORM_C_UNIT_PLAN = {
  bath: [6.3, 0, 9.8, 8.0],
  room2: [9.8, 0, 14.0, 8.0],
  room3: [14.0, 0, 18.2, 8.0],
  room4: [18.2, 0, 22.4, 8.0],
  corridor: [8.6, 8.0, 22.4, 10.7],
  corridorNook: [8.6, 10.7, 9.8, 12.2],
  other: [6.3, 8.0, 8.6, 12.2],
  cloth: [0, 12.2, 9.8, 18.7],
  room1: [9.8, 10.7, 14.0, 18.7],
  living: [14.0, 10.7, 22.4, 17.4],
} satisfies Record<string, Rect>;
/** A room's door: this far along its door wall from the room's west side (rooms 2–4; room 1 turned round). */
export const DORM_C_ROOM_DOOR = [1.6, 2.6] as const;
const R = DORM_C_UNIT_PLAN;

const door = (ax: number, ay: number, bx: number, by: number, kind: Opening['kind'] = 'door'): Opening => ({ kind, a: [ax, ay], b: [bx, by] });

export interface DormCUnit {
  source: BuildingSource;
  /** Where 「進入宿舍」 puts you (plan point and facing, in the living room by its front door). */
  arrive: { at: [number, number]; facing: [number, number] };
  /** The 「離開宿舍」 spot in the living room (plan). */
  leave: [number, number];
}

export function dormCUnit(campus: CampusData): DormCUnit | null {
  const wing = campus.buildings.find((b) => b.id === DORM_C.eastWing);
  if (!wing || wing.outer.length < 14) return null;
  // Line the flat up with the east wing above it: its south end runs 7s → 8s (ring points 4 → 5), 8s its south-west corner.
  const r = wing.outer, ex = r[8]! - r[10]!, ez = r[9]! - r[11]!;
  const angleDeg = (Math.atan2(ez, ex) * 180) / Math.PI;

  const space = (id: string, name: string, kind: Space['kind'], rects: Rect[]): Space => ({
    id: `dormC-unit-${id}`, name, kind, ceiling: CEILING, rects,
  });
  // No generated furniture: everything inside is modelled from the photos in dormCUnitDecor.ts.
  const spaces: Space[] = [
    space('bath', '浴室', 'toilet', [R.bath]),
    space('room2', '寢室 2', 'room', [R.room2]),
    space('room3', '寢室 3', 'room', [R.room3]),
    space('room4', '寢室 4', 'room', [R.room4]),
    space('corridor', '走廊', 'corridor', [R.corridor, R.corridorNook]),
    space('other', '雜物間', 'room', [R.other]),
    space('cloth', '曬衣間', 'room', [R.cloth]),
    space('room1', '寢室 1', 'room', [R.room1]),
    space('living', '交誼廳', 'lobby', [R.living]),
  ];
  const [d0, d1] = DORM_C_ROOM_DOOR;
  const openings: Opening[] = [
    // North row: doors in their south walls onto the corridor (where the sketch draws the swings).
    door(8.7, 8.0, 9.6, 8.0),
    ...[R.room2, R.room3, R.room4].map((r) => door(r[0] + d0, 8.0, r[0] + d1, 8.0)),
    // Room 1, turned round: its door in its north wall, the same place in the room.
    door(R.room1[2] - d1, R.room1[1], R.room1[2] - d0, R.room1[1]),
    // Other: off the corridor (its east wall), and on to the laundry (its south wall).
    door(8.6, 9.2, 8.6, 10.2),
    door(7.4, 12.2, 8.4, 12.2),
    // The living room open to the corridor; the flat's own front door, shut.
    door(14.1, 10.7, 22.3, 10.7, 'open'),
    door(22.4, 12.6, 22.4, 13.6, 'closed'),
    // The laundry is a balcony: its west end and south side open (parapet, sink counter and breeze-block screen in the decor).
    door(0, 12.4, 0, 18.4, 'open'),
    door(0.3, 18.7, 9.5, 18.7, 'open'),
  ];
  const source: BuildingSource = {
    id: 'dormC-unit',
    name: '學生宿舍C 東翼寢室',
    osmReplaces: [],
    transform: { angleDeg, planCentroid: [0, R.cloth[3]], worldCentroid: [r[10]!, r[11]!] },
    floorHeight: HEIGHT,
    style: { windows: false }, // windows are modelled (with an outside view) in the decor
    levels: [{ id: '1F', elevation: DORM_C_UNIT_FLOOR, built: true }],
    shell: {},
    floors: { '1F': { bandTop: HEIGHT, spaces, openings, signs: [] } },
    stairs: [],
    landings: [],
    directory: [{ level: '1F', items: ['寢室', '浴室', '交誼廳'] }],
  };
  return {
    source,
    // In the living room (使用者：進入宿舍是進入戶廳), just inside its front door, facing into the flat.
    arrive: { at: [21.0, 14.6], facing: [-1, 0] }, // by the front door, clear of the 「離開宿舍」 spot (1 m) and the furniture
    leave: [21.6, 13.1],
  };
}
