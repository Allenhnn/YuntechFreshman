uniform vec3 uColor;

void main() {
  // linearToOutputTexel is injected by three.js into every ShaderMaterial prefix.
  gl_FragColor = linearToOutputTexel(vec4(uColor, 1.0));
}
