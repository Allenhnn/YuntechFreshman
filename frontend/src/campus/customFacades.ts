/**
 * Hand-built facades and storey splits that the chunk worker must know about. Kept free of three.js
 * so the worker can import it.
 *
 * 學生宿舍C 北棟（OSM 296668596，U 形）依使用者實拍（2026-11-22）：中段 4 層、左右兩翼 3 層。OSM 只有一個 18 m 的多邊形，
 * 載入時切成三塊（campusFixes.ts `splitDormC`）：中段沿用原 id，兩翼用下面的新 id。
 */
export const DORM_C = {
  /** OSM id kept by the 4-storey middle. */
  middle: 296668596,
  /** New ids for the 3-storey wings (not in OSM). */
  westWing: 2966685961,
  eastWing: 2966685962,
  middleLevels: 4,
  wingLevels: 3,
  /**
   * 使用者標註（2026-11-23）：凸出段＝每層一間房間（西側）＋洗衣陽台，所以凸出段比 OSM 往西多一間房寬：
   * 中段的轉角短牆（原 vertex 14、15）沿正面往西移這麼多 m，西側退縮的戶廳牆段跟著變短。
   */
  roomWidth: 3.4,
} as const;

/**
 * The original ring's vertex numbers for each piece (CCW, as in OSM), and the split vertex S added on
 * the north face (vertex 3 → 4) straight up the east wing's inner face from vertex 12.
 * Edge k of a piece runs from its k-th to its (k+1)-th point.
 */
export const DORM_C_PIECES = {
  middle: [2, 3, 'S', 12, 13, 14, 15, 16],
  eastWing: ['S', 4, 5, 6, 7, 8, 9, 10, 11, 12],
  westWing: [16, 17, 18, 19, 0, 1, 2],
} as const;

/**
 * Shared walls between the pieces: (building id, edge) → height the wall starts at. Below it the
 * neighbour's interior continues through (no wall, no collider); a value ≥ the building's height drops
 * the wall entirely. Only used while one traced plan spans the pieces (FLOORPLAN_INTERIORS); with
 * generated interiors (one per piece) every piece keeps its full walls.
 */
export const PARTY_WALLS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  [DORM_C.middle]: { 2: DORM_C.wingLevels * 3.6, 7: DORM_C.wingLevels * 3.6 }, // S→12 (east wing side), 16→2 (west wing side)
  [DORM_C.eastWing]: { 9: 99 }, // 12→S
  [DORM_C.westWing]: { 6: 99 }, // 2→16
};

/** Facade style by building id for the split pieces (facades.json only knows the OSM id). */
export const STYLE_ALIAS: Readonly<Record<number, number>> = { [DORM_C.westWing]: DORM_C.middle, [DORM_C.eastWing]: DORM_C.middle };

/**
 * OSM walls whose outside is drawn by a hand-built facade module instead of the procedural style
 * details (sunshade fins, balconies, columns): building id → outer-ring edge indices. The extruded
 * wall itself is still drawn (the module's skin stands just outside it); only the details that
 * would poke through the skin are skipped. Party walls are listed too.
 */
export const CUSTOM_FACADE_EDGES: Readonly<Record<number, readonly number[]>> = {
  // buildings/dormCFacade.ts
  [DORM_C.middle]: [2, 3, 4, 5, 6, 7],
  [DORM_C.eastWing]: [3, 4, 5, 8, 9],
  [DORM_C.westWing]: [0, 1, 2, 6],
};

/**
 * 學生宿舍C 北棟中段的洗衣陽台（使用者室內照與正面照，2026-11-22）：2F–4F 每層一間長條陽台，佔整個中段凸出部分
 * （兩端柱之間）：正面中間一大片紅色鏤空花磚、兩端各一段開口。
 * `a0` / `a1`：沿中段 edge 4 從頂點 i 量起的範圍（左右各留 1 m 端柱）；每層從樓板 `y` 開到上一層樓板下緣
 * `y + height`；`depth`：從外牆面往室內挖多深——只挖外牆厚度（生成的室內房間緊貼外牆內面），陽台的深度靠中段外框往外凸出。
 */
export const DORM_C_BALCONY = { building: DORM_C.middle, edge: 4, a0: 1.0, a1: 12.2, floors: [3.6, 7.2, 10.8], height: 3.35, depth: 0.4 } as const;

/** Wall openings with nothing in them (no glass, no frames): the hand-built module fills them. */
export interface FacadeOpening { edge: number; a0: number; a1: number; y0: number; y1: number }
export const CUSTOM_FACADE_OPENINGS: Readonly<Record<number, readonly FacadeOpening[]>> = {
  [DORM_C_BALCONY.building]: DORM_C_BALCONY.floors.map((y) => ({ edge: DORM_C_BALCONY.edge, a0: DORM_C_BALCONY.a0, a1: DORM_C_BALCONY.a1, y0: y, y1: y + DORM_C_BALCONY.height })),
};
