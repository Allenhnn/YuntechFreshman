/** Paver lanes stop short of the asphalt road they join (half its 8 m width plus a little). */
export const PAVED_TRIM = 4.4;

/** A polyline with `a` metres cut off its start and `b` off its end (kept whole if too short). */
export function trimEnds(pts: number[], a: number, b: number): number[] {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!);
  if (len < a + b + 2) return pts;
  const cut = (p: number[], d: number): number[] => {
    if (d <= 0) return p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const l = Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!);
      if (d < l) { const t = d / l; return [p[i]! + (p[i + 2]! - p[i]!) * t, p[i + 1]! + (p[i + 3]! - p[i + 1]!) * t, ...p.slice(i + 2)]; }
      d -= l;
    }
    return p;
  };
  const rev = (p: number[]): number[] => { const o: number[] = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i]!, p[i + 1]!); return o; };
  return rev(cut(rev(cut(pts, a)), b));
}

