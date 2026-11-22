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
