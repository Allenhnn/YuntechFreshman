/** 3×3 projective transform, row-major, h[8] = 1. */
export type Homography = Float64Array;

/** Solves the homography mapping each `from[i]` to `to[i]` (exactly four point pairs). */
export function solveHomography(from: readonly [number, number][], to: readonly [number, number][]): Homography {
  // 8 equations, 8 unknowns: Gaussian elimination with partial pivoting on [A | b].
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) throw new Error('degenerate corners (three points in a line?)');
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = A[i]![8]! / A[i]![i]!;
  h[8] = 1;
  return h;
}

export function applyHomography(h: Homography, x: number, y: number): [number, number] {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
}

/** Bilinear RGBA sample; returns false outside the image. */
export function sampleBilinear(img: ImageData, x: number, y: number, out: Uint8ClampedArray, o: number): boolean {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return false;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1), y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0, fy = y - y0;
  const d = img.data;
  const i00 = (y0 * img.width + x0) * 4, i10 = (y0 * img.width + x1) * 4;
  const i01 = (y1 * img.width + x0) * 4, i11 = (y1 * img.width + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c]! + (d[i10 + c]! - d[i00 + c]!) * fx;
    const bot = d[i01 + c]! + (d[i11 + c]! - d[i01 + c]!) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
  return true;
}
