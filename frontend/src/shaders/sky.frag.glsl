uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
/** 0 = day, 1 = full night: stars and the moon come out. */
uniform float uNight;
uniform vec3 uMoonDir;

varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, up));
  col = mix(col, uGround, smoothstep(0.0, -0.15, up));
  // Soft cartoon sun disc + halo (fades out below the horizon).
  float sunUp = smoothstep(-0.08, 0.05, normalize(uSunDir).y);
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.9, 0.7) * (smoothstep(0.9975, 0.999, s) * 0.9 + pow(s, 64.0) * 0.25) * sunUp;
  if (uNight > 0.01 && up > 0.0) {
    // Stars: a sparse hash grid on the sky dome, twinkle-free.
    vec3 cell = floor(d * 140.0);
    float h = hash(cell);
    float star = step(0.988, h) * smoothstep(0.0, 0.25, up);
    vec3 c = (cell + 0.5) / 140.0;
    float core = smoothstep(0.0032, 0.0, length(d - normalize(c)));
    col += vec3(0.85, 0.9, 1.0) * star * core * uNight * (0.6 + 0.4 * h);
    // Moon disc and glow.
    float m = max(dot(d, normalize(uMoonDir)), 0.0);
    col += vec3(0.95, 0.95, 0.85) * (smoothstep(0.9988, 0.9993, m) + pow(m, 120.0) * 0.18) * uNight;
  }
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
}
