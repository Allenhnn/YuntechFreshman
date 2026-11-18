// Replaces <color_fragment> for the campus facade material.
{
  vec2 fuv = vFacadeUv;
  vec2 cell = fract(fuv);
  float level = floor(fuv.y);
  vec2 aa = max(fwidth(fuv), vec2(1e-4));
  float winW = vFacadeParams.x;
  float winH = vFacadeParams.y;
  float sill = vFacadeParams.z;
  float code = floor(vFacadeParams.w + 0.5);
  float pattern = mod(code, 4.0);
  bool groundGlass = mod(code, 8.0) >= 4.0 && level < 0.5;
  bool brick = code >= 8.0;

  // Window opening (glass) and its frame, per floor cell.
  float glass = 0.0;
  float frame = 0.0;
  float spandrel = 0.0;
  if (fuv.y > 0.0) {
    if (groundGlass) {
      glass = fBox(cell, vec2(-1.0, 0.05), vec2(2.0, 0.84), aa);
      frame = fLines(cell.x, aa.x, 0.02) * glass;
    } else if (pattern < 0.5) {
      vec2 lo = vec2(0.5 - winW * 0.5, sill), hi = vec2(0.5 + winW * 0.5, sill + winH);
      glass = fBox(cell, lo, hi, aa);
      frame = clamp(fBox(cell, lo - 0.035, hi + vec2(0.035, 0.02), aa) - glass, 0.0, 1.0);
      frame = max(frame, (1.0 - smoothstep(0.012 - aa.x, 0.012 + aa.x, abs(cell.x - 0.5))) * glass);
    } else if (pattern < 1.5) {
      glass = fBox(cell, vec2(-1.0, sill), vec2(2.0, sill + winH), aa);
      spandrel = 1.0 - glass;
      frame = max(clamp(fBox(cell, vec2(-1.0, sill - 0.03), vec2(2.0, sill + winH + 0.03), aa) - glass, 0.0, 1.0),
                  fLines(fract(cell.x * 1.5), aa.x * 1.5, 0.02) * glass);
    } else if (pattern < 2.5) {
      glass = fBox(cell, vec2(-1.0, 0.1), vec2(2.0, 0.97), aa);
      frame = max(fLines(cell.x, aa.x, 0.015) * glass, (1.0 - smoothstep(0.01 - aa.y, 0.01 + aa.y, abs(cell.y - 0.62))) * glass);
      spandrel = 1.0 - glass;
    }
  }

  // Slab band at each floor line and a darker plinth at grade.
  float slab = 1.0 - smoothstep(0.05 - aa.y, 0.05 + aa.y, cell.y);
  float plinth = 1.0 - smoothstep(0.06 - aa.y, 0.06 + aa.y, fuv.y);

  // Wall: grain texture in world metres (4 m per tile) × style colour.
  float grain = texture2D(uWallGrain, vec2(vFacadeWorld.x + vFacadeWorld.z, vFacadeWorld.y) * 0.25).r;
  vec3 wall = vColor.rgb * mix(0.86, 1.04, grain);
  vec3 frameCol = vFacadeTrim * 0.6;
  if (brick) {
    // Stretcher-bond brick (24 × 7.5 cm courses) in the spandrels; frame and slab stay exposed concrete.
    vec2 bw = vec2((vFacadeWorld.x + vFacadeWorld.z) / 0.24, vFacadeWorld.y / 0.075);
    float row = floor(bw.y);
    float bx = bw.x + 0.5 * mod(row, 2.0);
    vec2 baa = max(fwidth(bw), vec2(1e-4));
    float mortar = max(1.0 - smoothstep(0.08 - baa.y, 0.08 + baa.y, fract(bw.y)), 1.0 - smoothstep(0.04 - baa.x, 0.04 + baa.x, fract(bx)));
    mortar *= 1.0 - smoothstep(0.25, 0.6, max(baa.x, baa.y)); // fade before the courses alias
    vec3 b = vFacadeTrim * mix(0.82, 1.12, fHash(vec2(floor(bx), row)));
    b = mix(b, vec3(0.7, 0.68, 0.64), mortar * 0.85);
    // Exposed concrete frame: a column at every bay line, the beam above the windows. Glass and
    // brick sit inside the frame; brick only fills the spandrel below the sill.
    if (fuv.y > 0.0 && !groundGlass) {
      const float COL = 0.07;
      glass = fBox(cell, vec2(COL, sill), vec2(1.0 - COL, sill + winH), aa);
      frame = max(clamp(fBox(cell, vec2(COL - 0.012, sill - 0.025), vec2(1.0 - COL + 0.012, sill + winH + 0.025), aa) - glass, 0.0, 1.0),
                  fLines(fract(cell.x * 2.0), aa.x * 2.0, 0.025) * glass);
      spandrel = fBox(cell, vec2(COL, 0.1), vec2(1.0 - COL, sill - 0.03), aa);
    }
    wall = mix(wall, b, spandrel);
    wall = mix(wall, vColor.rgb * 0.82, slab * 0.85);
    wall = mix(wall, vColor.rgb * 0.6, plinth);
    frameCol = vec3(0.13, 0.14, 0.15);
  } else {
    wall = mix(wall, vFacadeTrim, max(slab * 0.85, spandrel * 0.55));
    wall = mix(wall, vFacadeTrim * 0.55, plinth);
  }

  // Glass: per-window brightness, the odd drawn blind, lighter toward the top (sky reflection).
  vec2 win = vec2(floor(fuv.x * (pattern > 0.5 ? 2.0 : 1.0)), level);
  float h = fHash(win);
  float t = clamp((cell.y - sill) / max(winH, 0.05), 0.0, 1.0);
  vec3 g = vFacadeGlass * mix(0.7, 1.25, h);
  g = mix(g, vec3(0.62, 0.66, 0.68), step(0.86, h) * 0.75);
  g = mix(g * 0.75, g * 1.25 + vec3(0.05, 0.07, 0.09), t);

  vec3 col = mix(wall, g, glass);
  col = mix(col, frameCol, frame);

  // Far away the grid is sub-pixel: fade to its average so it doesn't shimmer.
  float avgGlass = pattern < 0.5 ? winW * winH : (pattern < 1.5 ? winH : (pattern < 2.5 ? 0.87 : 0.0));
  vec3 avgCol = mix(mix(vColor.rgb, vFacadeTrim, brick ? 0.45 : 0.15), vFacadeGlass, avgGlass);
  float far = smoothstep(0.2, 0.5, max(aa.x, aa.y));
  col = mix(col, avgCol, far);
  fGlass = glass * (1.0 - frame) * (1.0 - far);

  diffuseColor.rgb *= col;
}
