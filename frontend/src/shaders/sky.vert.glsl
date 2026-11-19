varying vec3 vDir;

void main() {
  vDir = normalize(position);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Push to the far plane so the dome never occludes or clips the scene.
  gl_Position = clip.xyww;
}
