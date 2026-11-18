/** Frame-rate independent exponential smoothing: moves `a` toward `b` with rate `k` (1/s). */
export function damp(a: number, b: number, k: number, dt: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}

/** Shortest signed difference b - a, wrapped to (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(a: number, b: number, k: number, dt: number): number {
  return a + angleDelta(a, b) * (1 - Math.exp(-k * dt));
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const DEG2RAD = Math.PI / 180;

/** Small deterministic PRNG so the test scene layout is identical every load. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
