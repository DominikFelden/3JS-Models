import { Vector3, Vector4 } from 'three';
import { Abstract } from 'lamina/vanilla';
import { VERT, UNIFORMS, HELPERS } from './glsl.ts';
import { BODIES } from './kinds.ts';

const DEFAULTS = {
  u_seed: 0,
  u_alpha: 1,
  u_colorA: new Vector3(0.2, 0.2, 0.2),
  u_colorB: new Vector3(0.4, 0.4, 0.4),
  u_colorC: new Vector3(0.6, 0.6, 0.6),
  u_colorD: new Vector3(0.8, 0.8, 0.8),
  u_ink: new Vector3(0.1, 0.08, 0.06),
  u_extra: new Vector3(0.5, 0.5, 0.5),
  u_param: new Vector4(0, 0, 0, 0),
};

const NOISE_FN = {
  perlin: 'lamina_noise_perlin',
  simplex: 'lamina_noise_simplex',
  cell: 'lamina_noise_worley',
  curl: 'lamina_noise_swirl',
};

/**
 * Builds a lamina layer class from GLSL. lamina only renames `u_`, `v_` and
 * `f_` identifiers per layer, so the shared helpers use an `HD_` placeholder
 * that is swapped for a name unique to each layer instance.
 */
function makeLayer(name, glsl, uniforms: any = {}) {
  class Layer extends (Abstract as any) {
    declare seed: any;
    constructor(props) {
      super(Layer, { name, type: 'simplex', ...props }, (e) => {
        const unique = `hd${e.uuid}_`;
        const fix = (s) => s.replace(/HD_NOISE/g, NOISE_FN[e.type] || NOISE_FN.simplex).replace(/HD_/g, unique);
        e.fragmentVariables = fix(e.fragmentVariables);
        e.fragmentShader = fix(e.fragmentShader);
      });
    }
  }
  Object.assign(Layer, DEFAULTS, uniforms, { vertexShader: VERT, fragmentShader: UNIFORMS + HELPERS + glsl });
  return Layer;
}

const TILED = /* glsl */ `
uniform float u_scale;

// lamina noise made seamless: four samples one tile apart, cross-faded with
// smooth weights (so the seam is continuous) and re-contrasted in the middle.
float HD_tiled(vec2 uv) {
  vec2 w = uv * uv * (3.0 - 2.0 * uv);
  vec3 o = vec3(u_seed * 13.7, u_seed * 7.1, u_seed * 3.3);
  float s = u_scale;
  float a = HD_NOISE(vec3(uv * s, 0.0) + o);
  float b = HD_NOISE(vec3((uv - vec2(1.0, 0.0)) * s, 0.0) + o);
  float c = HD_NOISE(vec3((uv - vec2(0.0, 1.0)) * s, 0.0) + o);
  float d = HD_NOISE(vec3((uv - vec2(1.0, 1.0)) * s, 0.0) + o);
  float m = mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  vec2 q = (1.0 - w) * (1.0 - w) + w * w;
  return clamp(0.5 + (m - 0.5) / sqrt(q.x * q.y), 0.0, 1.0);
}

void main() {
  float f_n = HD_tiled(v_uv);
  vec3 f_col = HD_ramp(f_n);
  return vec4(f_col, u_alpha);
}
`;

/**
 * Seamless version of lamina's Noise layer: watercolour wash. Same options
 * (`type`, `scale`, `colorA..D`, `alpha`, `mode`), but tiles perfectly.
 */
export const TiledNoise = makeLayer('TiledNoise', TILED, { u_scale: 4 });

const kindLayers = {};
for (const [kind, body] of Object.entries(BODIES)) kindLayers[kind] = makeLayer(`Draw_${kind}`, body);

/** Drawing layer (ink, pigment, hatching) of a surface kind. */
export const drawLayer = (kind) => kindLayers[kind];
