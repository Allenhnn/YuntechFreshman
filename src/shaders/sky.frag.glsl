uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;

varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, up));
  col = mix(col, uGround, smoothstep(0.0, -0.15, up));
  // Soft cartoon sun disc + halo.
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.93, 0.75) * (smoothstep(0.9975, 0.999, s) * 0.9 + pow(s, 64.0) * 0.25);
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
}
