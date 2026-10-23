// Procedural campus ground splatting: grass / hills / paths / plaza tiles / running track.
// Layout constants must match src/scene/layout.ts.
varying vec3 vGroundWorld;

const vec3 GRASS_A = vec3(0.32, 0.62, 0.27);
const vec3 GRASS_B = vec3(0.44, 0.72, 0.31);
const vec3 HILL = vec3(0.47, 0.60, 0.33);
const vec3 PATH = vec3(0.86, 0.80, 0.66);
const vec3 PLAZA_A = vec3(0.90, 0.88, 0.83);
const vec3 PLAZA_B = vec3(0.84, 0.82, 0.77);
const vec3 PLAZA_LINE = vec3(0.68, 0.66, 0.62);
const vec3 PLAZA_RING = vec3(0.80, 0.42, 0.24);
const vec3 TRACK = vec3(0.74, 0.33, 0.24);
const vec3 TRACK_LINE = vec3(0.97, 0.95, 0.92);

const vec2 TRACK_A = vec2(-18.0, -36.0);
const vec2 TRACK_B = vec2(18.0, -36.0);
const float TRACK_RADIUS = 10.0;
const float TRACK_HALF_WIDTH = 2.5;
const float PLAZA_RADIUS = 16.0;

float gHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float gFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    sum += amp * gNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Anti-aliased "inside" mask for a signed distance (negative = inside).
float fill(float d) {
  float w = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(-w, w, d);
}

vec3 groundAlbedo(vec3 wp) {
  vec2 p = wp.xz;

  float n = gFbm(p * 0.12);
  vec3 col = mix(GRASS_A, GRASS_B, smoothstep(0.35, 0.75, n));
  col = mix(col, HILL, smoothstep(0.8, 5.0, wp.y));

  // Track: stadium ring around a mowed infield.
  float dCenter = sdSegment(p, TRACK_A, TRACK_B) - TRACK_RADIUS;
  float infield = fill(dCenter + TRACK_HALF_WIDTH);
  float stripes = step(0.5, fract(p.x / 4.0));
  col = mix(col, mix(GRASS_A, GRASS_B, stripes), infield);

  float onTrack = fill(abs(dCenter) - TRACK_HALF_WIDTH);
  float laneCoord = (dCenter + TRACK_HALF_WIDTH) / 1.2;
  float laneDist = abs(fract(laneCoord + 0.5) - 0.5) * 1.2;
  float laneLine = fill(laneDist - 0.04);
  col = mix(col, mix(TRACK, TRACK_LINE, laneLine), onTrack);

  // Paths linking the plaza to the track and the two test zones.
  float dPath = min(sdSegment(p, vec2(0.0, -12.0), vec2(0.0, -23.5)),
                min(sdSegment(p, vec2(12.0, 0.0), vec2(40.0, 4.0)),
                    sdSegment(p, vec2(-12.0, 0.0), vec2(-40.0, 4.0)))) - 1.6;
  dPath = min(dPath, sdSegment(p, vec2(0.0, 12.0), vec2(0.0, 30.0)) - 2.2);
  col = mix(col, PATH, fill(dPath));

  // Plaza: tiled disc with a decorative ring.
  float r = length(p);
  vec2 cell = floor(p / 1.5);
  vec3 tile = mix(PLAZA_A, PLAZA_B, mod(cell.x + cell.y, 2.0));
  vec2 g = abs(fract(p / 1.5) - 0.5);
  tile = mix(tile, PLAZA_LINE, fill((0.5 - max(g.x, g.y)) - 0.03));
  tile = mix(tile, PLAZA_RING, fill(abs(r - 9.0) - 0.35));
  tile = mix(tile, PLAZA_RING, fill(abs(r - PLAZA_RADIUS + 0.4) - 0.25));
  col = mix(col, tile, fill(r - PLAZA_RADIUS));

  return col;
}
