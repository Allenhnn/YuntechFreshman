// Procedural facade inputs (see FacadeBuilder in src/campus/chunkBuilder.ts).
attribute vec3 facadeTrim;
attribute vec3 facadeGlass;
attribute vec4 facadeParams;

varying vec2 vFacadeUv;
varying vec3 vFacadeTrim;
varying vec3 vFacadeGlass;
varying vec4 vFacadeParams;
varying vec3 vFacadeWorld;

void facadeVertex(vec3 p) {
  vFacadeUv = uv;
  vFacadeTrim = facadeTrim;
  vFacadeGlass = facadeGlass;
  vFacadeParams = facadeParams;
  vFacadeWorld = (modelMatrix * vec4(p, 1.0)).xyz;
}
