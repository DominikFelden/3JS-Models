/**
 * GLSL toolkit shared by all lamina texture layers.
 *
 * Everything that depends on the position inside the tile is EXACTLY periodic
 * (cell hashes wrap with `mod`), so the baked textures repeat without seams.
 * Colours are display (sRGB) values: they are baked 1:1 into the 8-bit
 * texture, which is then flagged as sRGB.
 *
 * `HD_` is a placeholder that `layers.js` replaces by a name unique to every
 * layer instance, so several layers can carry their own copy of these helpers
 * inside one lamina material.
 */

export const VERT = /* glsl */ `
varying vec2 v_uv;

void main() {
  v_uv = uv;
}
`;

export const UNIFORMS = /* glsl */ `
uniform float u_seed;
uniform float u_alpha;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;
uniform vec3 u_colorD;
uniform vec3 u_ink;
uniform vec3 u_extra;
uniform vec4 u_param;
varying vec2 v_uv;
`;

export const HELPERS = /* glsl */ `
float HD_h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 HD_h22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise on a lattice that wraps every 'per' cells (integer period).
float HD_vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 o = vec2(u_seed * 17.31, u_seed * 9.17);
  float a = HD_h12(mod(i, per) + o);
  float b = HD_h12(mod(i + vec2(1.0, 0.0), per) + o);
  float c = HD_h12(mod(i + vec2(0.0, 1.0), per) + o);
  float d = HD_h12(mod(i + vec2(1.0, 1.0), per) + o);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// Tile-periodic noise with 'cells' lattice cells across the tile.
float HD_noise(vec2 uv, vec2 cells) {
  return HD_vnoise(uv * cells, cells);
}

float HD_fbm(vec2 uv, vec2 cells) {
  float s = 0.0;
  float a = 0.5;
  vec2 c = cells;
  vec2 p = uv * cells;
  for (int k = 0; k < 4; k++) {
    s += a * HD_vnoise(p, c);
    p *= 2.0;
    c *= 2.0;
    a *= 0.5;
  }
  return s / 0.9375;
}

// Hand wobble: displaces the coordinate by a smooth periodic field.
vec2 HD_warp(vec2 uv, float cells, float amp) {
  vec2 c = vec2(cells);
  float a = HD_vnoise(uv * c + 11.3, c);
  float b = HD_vnoise(uv * c + 37.7, c);
  return uv + (vec2(a, b) - 0.5) * amp;
}

// Four-colour ramp, dark (A) to light (D).
vec3 HD_ramp(float t) {
  vec3 c = mix(u_colorA, u_colorB, smoothstep(0.0, 0.34, t));
  c = mix(c, u_colorC, smoothstep(0.34, 0.67, t));
  return mix(c, u_colorD, smoothstep(0.67, 1.0, t));
}

// Periodic Worley: (F1, F2, cell hash, 0).
vec4 HD_voro(vec2 p, vec2 per, float jit) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(ip + g, per);
      vec2 o = HD_h22(cell + u_seed * 3.7);
      vec2 r = g + 0.5 + (o - 0.5) * jit - fp;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = HD_h12(cell + u_seed * 5.1 + 0.3);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec4(sqrt(d1), sqrt(d2), id, 0.0);
}

// Vector from the pixel to the feature point of its Worley cell.
vec2 HD_voroDir(vec2 p, vec2 per, float jit) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d1 = 8.0;
  vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(ip + g, per);
      vec2 o = HD_h22(cell + u_seed * 3.7);
      vec2 r = g + 0.5 + (o - 0.5) * jit - fp;
      float d = dot(r, r);
      if (d < d1) {
        d1 = d;
        best = r;
      }
    }
  }
  return best;
}

// n random cuts of the unit circle: (distance to the cut on the left,
// distance to the cut on the right, hash of the left cut).
vec3 HD_cuts(float x, float n, float jit, float seed, float off) {
  float dl = 2.0;
  float dr = 2.0;
  float id = 0.0;
  for (int k = 0; k < 8; k++) {
    if (float(k) >= n) break;
    float c = fract(off + (float(k) + (HD_h12(vec2(float(k), seed) + u_seed) - 0.5) * jit) / n);
    float l = fract(x - c);
    float r = fract(c - x);
    if (l < dl) {
      dl = l;
      id = HD_h12(vec2(float(k) * 1.7 + 0.5, seed + 3.0) + u_seed);
    }
    dr = min(dr, r);
  }
  return vec3(dl, dr, id);
}

// Parallel pen strokes. (a, b) are whole numbers, so the lines tile.
float HD_hatch(vec2 uv, float a, float b, float w, float wob) {
  float s = a * uv.x + b * uv.y + (HD_noise(uv, vec2(7.0)) - 0.5) * wob;
  return 1.0 - smoothstep(w * 0.55, w, abs(fract(s) - 0.5));
}

// Soft line profile around zero distance.
float HD_line(float d, float w, float soft) {
  return 1.0 - smoothstep(w, w + soft, abs(d));
}

// Distance from the centre of a leaf clump (offset r, hash h) with a slightly oval,
// scalloped outline: the clump ends where this reaches its radius.
float HD_blob(vec2 r, vec3 h) {
  vec2 q = r * vec2(1.0 + 0.32 * (h.z - 0.5), 1.0 - 0.32 * (h.z - 0.5));
  float a = atan(r.y, r.x);
  return length(q) * (1.0 + 0.045 * sin(a * 3.0 + h.x * 40.0) + 0.035 * sin(a * 7.0 + h.z * 50.0));
}
`;
