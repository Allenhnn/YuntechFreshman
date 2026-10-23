// Procedural facade: UV = (bays, floors); params = (window width, window height, sill, pattern + 4·groundGlass).
// Patterns: 0 punched windows, 1 ribbon windows, 2 curtain wall, 3 blank.
uniform sampler2D uWallGrain;

varying vec2 vFacadeUv;
varying vec3 vFacadeTrim;
varying vec3 vFacadeGlass;
varying vec4 vFacadeParams;
varying vec3 vFacadeWorld;

// Glass coverage of this fragment, read by the roughness / metalness overrides.
float fGlass = 0.0;

float fHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Anti-aliased box mask in cell space.
float fBox(vec2 p, vec2 lo, vec2 hi, vec2 aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
  return a.x * a.y;
}

// Thin vertical lines at the given cell-x positions (mullions).
float fLines(float x, float aa, float w) {
  float d = min(min(abs(x), abs(x - 1.0)), abs(x - 0.5));
  return 1.0 - smoothstep(w - aa, w + aa, d);
}
