#include <common>
#include <skinning_pars_vertex>

uniform float uThickness;

// Inverted hull, extruded in view space so the outline keeps a constant world thickness
// even on non-uniformly scaled parts. Skinning chunks make it follow rigged (SkinnedMesh) models.
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>

  vec4 viewPos = modelViewMatrix * vec4(transformed, 1.0);
  vec3 viewNormal = normalize(normalMatrix * objectNormal);
  viewPos.xyz += viewNormal * uThickness;
  gl_Position = projectionMatrix * viewPos;
}
