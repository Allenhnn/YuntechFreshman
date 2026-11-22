/**
 * OSM walls whose outside is drawn by a hand-built facade module instead of the procedural style
 * details (sunshade fins, balconies, columns): building id → outer-ring edge indices. The extruded
 * wall itself is still drawn (the module's skin stands just outside it); only the details that
 * would poke through the skin are skipped. Kept free of three.js so the chunk worker can import it.
 */
export const CUSTOM_FACADE_EDGES: Readonly<Record<number, readonly number[]>> = {
  // 學生宿舍C 北棟中段南面（面向 C 中庭）：buildings/dormCFacade.ts
  296668596: [11, 12, 13, 14, 15],
};

/**
 * 學生宿舍C 北棟中段的洗衣陽台（使用者室內照，2026-11-22）：2F–5F 每層一間，在中段兩片紅色花磚格柵後面。
 * `a0` / `a1`：沿 edge 13 從頂點 i 量起的範圍（中段左右對稱，等於 dormCFacade 的端柱＋窗列＋柱 = 3.2 m 起、
 * 到另一端同樣 3.2 m 止）；每層從樓板 `y` 開到上一層樓板下緣 `y + height`；`depth`：從外牆面往室內挖多深
 * （描圖平面在約 1.5 m 之後才有寢室，連牆厚留 0.05 m）。
 */
export const DORM_C_BALCONY = { building: 296668596, edge: 13, a0: 3.2, a1: 10.0, floors: [3.6, 7.2, 10.8, 14.4], height: 3.35, depth: 1.3 } as const;

/** Wall openings with nothing in them (no glass, no frames): the hand-built module fills them. */
export interface FacadeOpening { edge: number; a0: number; a1: number; y0: number; y1: number }
export const CUSTOM_FACADE_OPENINGS: Readonly<Record<number, readonly FacadeOpening[]>> = {
  [DORM_C_BALCONY.building]: DORM_C_BALCONY.floors.map((y) => ({ edge: DORM_C_BALCONY.edge, a0: DORM_C_BALCONY.a0, a1: DORM_C_BALCONY.a1, y0: y, y1: y + DORM_C_BALCONY.height })),
};
