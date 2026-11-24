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
  /** 學生宿舍C C1（OSM 296668595，宿舍服務中心那棟）：使用者照片 4 層、不做內部（sealed）。 */
  c1: 296668595,
  c1Levels: 4,
  /** 學生宿舍C C2（OSM 296668592）：使用者照片 5 層（OSM 一樣），外觀由 dormCFacade.ts 做，不做內部（sealed）。 */
  c2: 296668592,
  /** New ids for the 3-storey wings (not in OSM). */
  westWing: 2966685961,
  eastWing: 2966685962,
  middleLevels: 4,
  wingLevels: 3,
  /**
   * 使用者標註（2026-11-23）：凸出段＝每層「房間＋洗衣陽台」，西側退縮處一間戶廳；凸出段比 OSM 往西多一間房寬
   * （原 vertex 14、15 沿正面往西移這麼多 m）。東側照使用者的地圖維持 OSM：東翼原寬、內側有凹口（凹口當戶廳）。
   */
  roomWidth: 3.4,
  /** The east wing moves this far east (m) so the east hall shows as wide as the west one (使用者). */
  eastShift: 1.6,
} as const;

/**
 * 學生宿舍D（使用者 2026-11-24：整個 C 區的配置複製到 D 區，只要外觀、不做室內、門進不去；D 入口雨遮那塊不動）。
 * D 區大致是 C 區南北翻過來再轉一點：`dormCToD` 把 C 的座標鏡射到 D（OSM 三棟對過去最多差約 4.5 m，旋轉取三棟一起擬合的、
 * 平移讓 C1 宿服中心那道小斜牆的中點落在 D 入口斜牆的中點上）。campusFixes.ts `copyDormCToD` 把 D 三棟的外環換成 C 對應那棟
 * 鏡射過來的外環（反轉頂點順序維持逆時針）：C1 → 東棟、C2 → 西棟、C3 北棟三塊 → 南棟三塊（中段沿用 OSM id，兩翼新 id）。
 */
export const DORM_D = {
  c1: 296668594,
  c2: 296668593,
  middle: 296668604,
  westWing: 2966686041,
  eastWing: 2966686042,
} as const;
const D_XF = { c: 0.9445172090572551, s: -0.32846193355500647, tx: 119.97941868175644, tz: 709.7399158420217 };
/** C 區 → D 區（鏡射：行列式 −1）。 */
export function dormCToD(x: number, z: number): [number, number] {
  return [D_XF.c * x + D_XF.s * z + D_XF.tx, D_XF.s * x - D_XF.c * z + D_XF.tz];
}
/** The 4×4 (column-major, three.js `Matrix4.fromArray`) of `dormCToD` on the ground plane, y kept. */
export const DORM_C_TO_D_MATRIX: readonly number[] = [D_XF.c, 0, D_XF.s, 0, 0, 1, 0, 0, D_XF.s, 0, -D_XF.c, 0, D_XF.tx, 0, D_XF.tz, 1];
/** C building id → its D copy. */
export const DORM_C_TO_D_IDS: readonly (readonly [number, number])[] = [
  [DORM_C.c1, DORM_D.c1], [DORM_C.c2, DORM_D.c2], [DORM_C.middle, DORM_D.middle], [DORM_C.westWing, DORM_D.westWing], [DORM_C.eastWing, DORM_D.eastWing],
];
/** Edge i of a C ring (n vertices) is this edge of its reversed D copy. */
export const dormDEdge = (i: number, n: number): number => (((n - 2 - i) % n) + n) % n;

/**
 * Each piece's ring (CCW): numbers are the OSM ring's vertices, names are points splitDormC makes —
 * p14 / p15: the west return slid a room further west; 4s … 11s: the east wing's vertices moved `eastShift`
 * east; Q: on the north face (3 → 4) straight up the east wing's inner face from 11s; B: on the north face (1 → 2)
 * straight up the west wing's inner face from vertex 16 (so the west party wall is square, not diagonal from 2 to 16).
 * Edge k of a piece runs from its k-th to its (k+1)-th point.
 */
export const DORM_C_PIECES = {
  middle: [2, 3, 'Q', '11s', 12, 13, 'p14', 'p15', 16, 'B'],
  eastWing: ['Q', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s'],
  westWing: [16, 17, 18, 19, 0, 1, 'B'],
} as const;

/**
 * Shared walls between the pieces: (building id, edge) → height the wall starts at. Below it the
 * neighbour's interior continues through (no wall, no collider); a value ≥ the building's height drops
 * the wall entirely. Only used while one traced plan spans the pieces (FLOORPLAN_INTERIORS); with
 * generated interiors (one per piece) every piece keeps its full walls.
 */
export const PARTY_WALLS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  [DORM_C.middle]: { 2: DORM_C.wingLevels * 3.6, 8: DORM_C.wingLevels * 3.6 }, // Q→11s (east wing side), 16→B (west wing side)
  [DORM_C.eastWing]: { 8: 99 }, // 11s→Q
  [DORM_C.westWing]: { 6: 99 }, // B→16
};

/** Facade style by building id for the split pieces (facades.json only knows the OSM id). */
export const STYLE_ALIAS: Readonly<Record<number, number>> = { [DORM_C.westWing]: DORM_C.middle, [DORM_C.eastWing]: DORM_C.middle, [DORM_D.westWing]: DORM_D.middle, [DORM_D.eastWing]: DORM_D.middle };

/**
 * OSM walls whose outside is drawn by a hand-built facade module instead of the procedural style
 * details (sunshade fins, balconies, columns): building id → outer-ring edge indices. The extruded
 * wall itself is still drawn (the module's skin stands just outside it); only the details that
 * would poke through the skin are skipped. Party walls are listed too.
 */
export const CUSTOM_FACADE_EDGES: Readonly<Record<number, readonly number[]>> = {
  // buildings/dormCFacade.ts
  // C1 (使用者照片 2026-11-24): every wall, so neither procedural details nor a shut door land on it.
  [DORM_C.c1]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // 12 edges once sealBuildings fills the north-east notch
  [DORM_C.c2]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  // The back faces too (使用者背面照): middle 0, 1, 9; east wing 0, 1, 2; west wing 3, 4, 5 — so no shut door lands on them.
  [DORM_C.middle]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [DORM_C.eastWing]: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [DORM_C.westWing]: [0, 1, 2, 3, 4, 5, 6],
  // 學生宿舍D（C 區的鏡射，dormCFacade.ts 同一套外觀）：每面都是；東棟入口雨遮那三面（C1 edge 7、8、9 → D edge 3、2、1）也是（使用者：色調一樣的風格）。
  [DORM_D.c1]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [DORM_D.c2]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [DORM_D.middle]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [DORM_D.eastWing]: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  [DORM_D.westWing]: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * 學生宿舍C 北棟中段的洗衣陽台（使用者室內照與正面照，2026-11-22）：2F–4F 每層一間長條陽台，佔整個中段凸出部分
 * （兩端柱之間）：正面中間一大片紅色鏤空花磚、兩端各一段開口。
 * `a0` / `a1`：沿中段正面（edge 5）從頂點 i（OSM vertex 13）量起的範圍（陽台段左右各留 1 m 端柱）；每層從樓板 `y` 開到上一層樓板下緣
 * `y + height`；`depth`：從外牆面往室內挖多深——只挖外牆厚度（生成的室內房間緊貼外牆內面），陽台的深度靠中段外框往外凸出。
 */
export const DORM_C_BALCONY_SPAN = [1.0, 12.2] as const; // along the OSM front from vertex 13
export const DORM_C_BALCONY = {
  building: DORM_C.middle, edge: 5, // 13 → p14
  // 使用者（2026-11-23）：陽台右邊也要一間房，曬衣間縮小——東端讓出一間房寬。
  a0: DORM_C.roomWidth + DORM_C_BALCONY_SPAN[0], a1: DORM_C_BALCONY_SPAN[1],
  floors: [3.6, 7.2, 10.8], height: 3.35, depth: 0.4,
} as const;

/**
 * 學生宿舍C 北棟一樓門廳（使用者正面照，2026-11-23）：陽台正下方、兩根粗柱之間（同一段 a0–a1）。
 * 外牆從地面開到 `top`，往室內做一間 `depth` m 深的門廳（地板與門前平台同高 `floor`），從玻璃門看得到、右邊那樘開著的門走得進去。
 */
export const DORM_C_LOBBY = { edge: DORM_C_BALCONY.edge, a0: DORM_C_BALCONY.a0, a1: DORM_C_BALCONY.a1, top: 3.2, depth: 4.2, floor: 0.56 } as const;

/** Wall openings with nothing in them (no glass, no frames): the hand-built module fills them. */
export interface FacadeOpening {
  edge: number; a0: number; a1: number; y0: number; y1: number;
  /** a0 / a1 measured from the edge's end (vertex i + 1) instead of its start: a C opening on a mirrored D copy. */
  fromEnd?: boolean;
}
/**
 * 2F hall window on the middle's east flank (edge 3, 11s → vertex 4): the dorm flat's living room is behind it and looks
 * out through it (使用者：戶廳的窗戶可以看到外面). a0/a1 from vertex 11s; the facade module draws it in clear glass.
 */
// 使用者（2026-11-24：戶廳窗造型怪怪的）：窗原本在凹口牆的正中，東半邊正對東翼的牆；往西移 1.1 m，整扇落在凹口開口的正中間。
export const DORM_C_HALL_2F = { edge: 3, a0: 2.53, a1: 4.93, y0: 4.2, y1: 6.4 } as const;
export const CUSTOM_FACADE_OPENINGS: Readonly<Record<number, readonly FacadeOpening[]>> = {
  [DORM_C_BALCONY.building]: [
    ...DORM_C_BALCONY.floors.map((y) => ({ edge: DORM_C_BALCONY.edge, a0: DORM_C_BALCONY.a0, a1: DORM_C_BALCONY.a1, y0: y, y1: y + DORM_C_BALCONY.height })),
    { edge: DORM_C_LOBBY.edge, a0: DORM_C_LOBBY.a0, a1: DORM_C_LOBBY.a1, y0: 0, y1: DORM_C_LOBBY.top },
    DORM_C_HALL_2F,
  ],
  // 學生宿舍D 南棟中段（C 北棟中段的鏡射）：陽台與門廳的開口一樣（edge 5 → 3，從另一端量）；戶廳窗不開（D 沒有室內）。
  [DORM_D.middle]: [
    ...DORM_C_BALCONY.floors.map((y) => ({ edge: dormDEdge(DORM_C_BALCONY.edge, 10), a0: DORM_C_BALCONY.a0, a1: DORM_C_BALCONY.a1, y0: y, y1: y + DORM_C_BALCONY.height, fromEnd: true })),
    { edge: dormDEdge(DORM_C_LOBBY.edge, 10), a0: DORM_C_LOBBY.a0, a1: DORM_C_LOBBY.a1, y0: 0, y1: DORM_C_LOBBY.top, fromEnd: true },
  ],
};
