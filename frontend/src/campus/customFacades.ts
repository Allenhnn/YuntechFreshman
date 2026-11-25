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
 * 學生宿舍B（使用者 2026-11-25：照 B 區平面圖調整整體宿舍，外觀用 D 區那一套風格）。用一樓平面圖（三棟畫在同一張、相對位置就是
 * 實際分布；北朝下畫，1 px ≈ 8.5 cm，標註 B1 2720 × 2720、B2 5100 × 2210、B3 5440 × 1700）描三棟外框，三棟一起用同一個
 * 旋轉＋平移放到校園上（擬合三棟的中心，跟 OSM 差 0.5 m 內）；B1 是 L 形，兩翼之間的內凹轉角是入口（使用者街景照）。三棟都 4 層、不做室內（sealed）。外觀由 dormCFacade.ts
 * `site` 'B' 做：`entrance` 是朝中庭那個入口（紅花磚陽台、玻璃門廳、招牌、台階）所在牆面的大約中點。
 * 使用者：B 區的圍牆、大門先不要做（dormYard.ts 沒有 B 的門）。
 */
export const DORM_B = {
  b1: 234786934,
  b2: 234786935,
  b3: 234786936,
} as const;
export const DORM_B_RINGS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  [DORM_B.b1]: [[121.54, 331.66], [108.24, 334.18], [107.48, 330.2], [109.31, 329.85], [107.38, 319.7], [112.12, 318.8], [116.18, 313.34], [115.15, 307.91], [124.62, 306.11], [124.17, 303.75], [128.54, 302.92], [131.33, 317.6], [121.31, 319.5], [119.68, 321.87]],
  [DORM_B.b2]: [[90.85, 336.14], [56.2, 342.72], [54.49, 333.7], [47.8, 334.97], [45.11, 320.77], [58.22, 318.28], [60.12, 328.3], [83.59, 323.85], [82.64, 318.84], [97.42, 316.04], [99.96, 329.4], [89.93, 331.3]],
  [DORM_B.b3]: [[107.95, 299.94], [93.42, 302.69], [92.44, 297.52], [67.38, 302.27], [68.37, 307.45], [53.5, 310.27], [51.01, 297.15], [60.78, 295.3], [59.8, 290.12], [94.96, 283.45], [95.94, 288.63], [105.46, 286.83]],
};
export type XZ = readonly [number, number];
/**
 * `entrance`：紅花磚陽台入口所在牆面的大約中點。`corner`（B1，使用者街景照＋一樓平面圖紅框 2026-11-25）：入口在兩翼之間的
 * 內凹轉角（12.4 × 11.9 m，最裡面是一道斜牆）——`at` 那道斜牆的兩端；`canopy` 雨遮（平面圖雙線：靠門牆一小段直的、斜的正面、
 * 再一小段直的接回牆，只空出外角那塊三角；前三個邊是外緣，其餘貼著牆），正面掛「B」；`planter` 轉角裡的六角形花台（照片裡雨遮下那叢綠）；雨遮下平台、外緣台階；
 * 兩面牆一樓暗的入口、方墩，`doors` 是平面圖紅色標記的門（藍白鐵柵雙開門），其他格咖啡色格柵；`ramp` 無障礙坡道（平面圖藍框）。
 */
export const DORM_B_SPECS: readonly {
  id: number; sign: string; entrance?: XZ; edges: number;
  corner?: {
    at: readonly XZ[]; canopy: readonly XZ[]; platform: readonly (readonly XZ[])[]; planter: readonly XZ[];
    doors: readonly XZ[]; steps: readonly (readonly [XZ, XZ])[]; ramp: { wallHigh: XZ; wallLow: XZ; outerLow: XZ };
  };
}[] = [
  // B1：一樓平面圖左上（實際東南）是兩翼之間的方形內凹，入口就在這個轉角（街景照）；照片沒有紅花磚陽台。座標都照平面圖比例
  // （1 px ≈ 4.4 cm）量出來再用同一個平面圖→校園轉換。
  { id: DORM_B.b1, sign: 'B', edges: 14, corner: {
    // 使用者（平面圖紅框右下角）：內轉角是斜的——一道約 2.9 m 的斜牆，六角花台貼著它。
    at: [[119.68, 321.87], [121.31, 319.5]],
    // 雨遮：前三個邊是外緣（直段、斜的正面、直段），其餘貼著牆。
    canopy: [[121.45, 331.19], [125.82, 330.36], [131.36, 321.91], [130.57, 317.74], [121.31, 319.5], [119.68, 321.87]],
    // 雨遮下的平台，繞開坡道切成兩塊凸多邊形。
    platform: [
      [[121.45, 331.19], [125.82, 330.36], [128.61, 326.1], [127.15, 318.39], [121.31, 319.5], [119.68, 321.87]],
      [[128.61, 326.1], [131.36, 321.91], [130.79, 318.91], [127.37, 319.56]],
    ],
    planter: [[124.41, 318.91], [124.75, 320.73], [122.22, 324.29], [120.21, 324.67], [119.68, 321.87], [121.31, 319.5]],
    // 平面圖紅色標記的兩樘門（只做外觀，2.5 m 鐵柵雙開門）。
    doors: [[120.49, 326.14], [125.44, 318.72]],
    // 台階：平台的三段外緣（第三段到坡道外緣為止）。
    steps: [[[121.45, 331.19], [125.82, 330.36]], [[125.82, 330.36], [131.36, 321.91]], [[131.36, 321.91], [130.79, 318.91]]],
    // 無障礙坡道（平面圖藍框）：沿東邊那面牆，門旁邊（跟平台同高）往牆的外端降到地面，寬約 1.2 m，外緣藍色扶手。
    ramp: { wallHigh: [127.15, 318.39], wallLow: [130.78, 317.7], outerLow: [131.0, 318.87] },
  } },
  { id: DORM_B.b2, sign: 'B2', entrance: [71.9, 326.07], edges: 12 },
  { id: DORM_B.b3, sign: 'B3', entrance: [79.91, 299.89], edges: 12 },
];

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
  // 學生宿舍B（dormCFacade.ts site 'B'）：每面都是。
  ...Object.fromEntries(DORM_B_SPECS.map((b) => [b.id, Array.from({ length: b.edges }, (_, i) => i)])),
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
