/**
 * Face decal for the mascot: eyes, highlights, cheeks and mouth painted into a 2-frame atlas
 * (frame 0 = eyes open, frame 1 = blink). Blinking is a UV offset, not a mesh swap.
 *
 * The decal is a spherical patch just outside the skull; each texel is mapped back onto the
 * sphere and features are tested in head-local (x, y), so the result matches a front view
 * without distortion. Shared by the offline GLB bake and the runtime fallback.
 */

/** Patch parameters, matching three.js SphereGeometry(phiStart, phiLength, thetaStart, thetaLength). */
export const FACE_PATCH = {
  radius: 0.343,
  phiStart: Math.PI / 2 - 1.0,
  phiLength: 2.0,
  thetaStart: 1.1,
  thetaLength: 1.0,
} as const;

export const FACE_ATLAS = { frameSize: 256, frames: 2 } as const;
/** Horizontal UV offset that shows the blink frame. */
export const BLINK_OFFSET_U = 1 / FACE_ATLAS.frames;

type RGBA = readonly [number, number, number, number];
const EYE: RGBA = [58, 29, 18, 255];
const SHINE: RGBA = [255, 255, 255, 255];
const CHEEK: RGBA = [255, 143, 143, 215];
const MOUTH: RGBA = [58, 29, 18, 255];

const SKULL_RADIUS = 0.34;
const SUPERSAMPLE = 3;

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Colour of the face at head-local (x, y) for the given frame, or null if transparent. */
function sample(x: number, y: number, blink: boolean): RGBA | null {
  for (const side of [1, -1]) {
    const ex = 0.11 * side;
    const ey = 0.03;
    if (blink) {
      // Closed eye: a gentle downward arc.
      const t = (x - ex) / 0.065;
      if (Math.abs(t) <= 1) {
        const curve = ey - 0.012 - 0.022 * (1 - t * t);
        if (Math.abs(y - curve) < 0.009) return EYE;
      }
    } else {
      if (ellipse(x, y, ex + 0.022, ey + 0.028, 0.021, 0.021)) return SHINE;
      if (ellipse(x, y, ex, ey, 0.062, 0.078)) return EYE;
    }
  }
  // Smile: lower half of a ring.
  const my = -0.09;
  const r = Math.hypot(x, y - my);
  if (y < my && Math.abs(r - 0.035) < 0.008) return MOUTH;
  for (const side of [1, -1]) {
    if (ellipse(x, y, 0.2 * side, -0.08, 0.05, 0.03)) return CHEEK;
  }
  return null;
}

/** RGBA8 sRGB pixels, rows top-to-bottom, width = frameSize * frames. */
export function paintFaceAtlas(): { data: Uint8ClampedArray; width: number; height: number } {
  const size = FACE_ATLAS.frameSize;
  const width = size * FACE_ATLAS.frames;
  const height = size;
  const data = new Uint8ClampedArray(width * height * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  const { phiStart, phiLength, thetaStart, thetaLength } = FACE_PATCH;

  for (let frame = 0; frame < FACE_ATLAS.frames; frame++) {
    const blink = frame === 1;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const u = (px + (sx + 0.5) / SUPERSAMPLE) / size;
            const v = (py + (sy + 0.5) / SUPERSAMPLE) / size;
            const phi = phiStart + u * phiLength;
            const theta = thetaStart + v * thetaLength;
            const x = -SKULL_RADIUS * Math.cos(phi) * Math.sin(theta);
            const y = SKULL_RADIUS * Math.cos(theta);
            const c = sample(x, y, blink);
            if (c) {
              const ca = c[3] / 255;
              r += c[0] * ca; g += c[1] * ca; b += c[2] * ca; a += ca;
            }
          }
        }
        const i = (py * width + frame * size + px) * 4;
        // Transparent texels carry the skin colour so bilinear filtering doesn't pull dark fringes in.
        data[i] = 251;
        data[i + 1] = 251;
        data[i + 2] = 248;
        if (a > 0) {
          // Un-premultiply so edge texels keep their colour instead of darkening toward black.
          data[i] = r / a;
          data[i + 1] = g / a;
          data[i + 2] = b / a;
          data[i + 3] = (a / n) * 255;
        }
      }
    }
  }
  return { data, width, height };
}
