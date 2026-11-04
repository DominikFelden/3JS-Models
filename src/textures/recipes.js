import { Color } from 'three';
import { LayerMaterial, Noise } from 'lamina/vanilla';
import { TiledNoise, drawLayer } from './layers.js';

/** Number of ready-made textures per surface kind. */
export const TEXTURE_VARIANTS = 5;

/**
 * One entry per surface kind. `variants` are the 5 shared colourways/patterns;
 * every colour is a display (sRGB) hex value:
 *  - colors: pigment ramp, dark to light
 *  - ink:    pen colour for outlines and hatching
 *  - extra:  mortar / moss / secondary colour
 *  - param:  whole-number pattern settings, see kinds.js
 * `weights` (optional) makes some variants rarer when picked at random.
 * `repeat: false` marks a picture that is laid on a shape once instead of tiling.
 */
const v = (seed, colors, ink, extra, param) => ({ seed, colors, ink, extra: extra ?? ink, param });

export const RECIPES = {
  bark: {
    size: 256,
    wash: { scale: 3, tint: 0.8, strength: 0.55 },
    grain: 0.9,
    variants: [
      v(1, [0x3b2a1d, 0x5a412c, 0x7a5c3e, 0x9a7a55], 0x241a12, 0, [7, 0, 0, 0]),
      v(2, [0x4a443c, 0x6b645a, 0x8b8579, 0xaaa497], 0x2a2622, 0, [6, 0, 0, 0]),
      v(3, [0x3a2219, 0x5e3524, 0x7d4a32, 0xa0653f], 0x22130d, 0, [9, 0, 0, 0]),
      v(4, [0xb3ad9f, 0xd2cdbf, 0xe6e2d5, 0xf3f0e6], 0x35302a, 0, [5, 0, 1, 0]), // white birch
      v(5, [0x5c4527, 0x7f6338, 0xa38449, 0xc4a465], 0x2f2314, 0, [7, 0, 0, 0]),
    ],
  },
  foliage: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.45 },
    grain: 0.92,
    weights: [1, 1, 1, 0.5, 0.35],
    variants: [
      v(1, [0x2f5d2a, 0x4a8a37, 0x6fb04a, 0xa2d468], 0x1d3a1c, 0, [5, 0, 0, 0]),
      v(2, [0x1f3f2b, 0x2f5e3b, 0x43804a, 0x6aa862], 0x12261a, 0, [5, 0, 0, 0]),
      v(3, [0x4b5a22, 0x72822f, 0x9aab3e, 0xc9d160], 0x2c3512, 0, [6, 0, 0, 0]),
      v(4, [0x7a2f1a, 0xb5502a, 0xdd8a35, 0xf0c25a], 0x4a1a0e, 0, [5, 0, 0, 0]),
      v(5, [0x1f4a4a, 0x2f7068, 0x4a9a82, 0x82c4a4], 0x10302e, 0, [6, 0, 0, 0]),
    ],
  },
  needles: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    weights: [1, 1, 1, 1, 0.5],
    variants: [
      v(1, [0x1b3a2c, 0x2a5a40, 0x3f7a52, 0x6aa070], 0x0f241a, 0, [8, 0.9, 0, 0]),
      v(2, [0x1d3a38, 0x2c5a58, 0x437a74, 0x6ea29a], 0x102524, 0, [8, 0.9, 0, 0]),
      v(3, [0x2a3d1f, 0x41602e, 0x5f8540, 0x8cad5c], 0x18260f, 0, [9, 1.0, 0, 0]),
      v(4, [0x25352a, 0x3b5240, 0x587258, 0x85a083], 0x151f18, 0, [8, 0.8, 0, 0]),
      v(5, [0x3a3a1c, 0x5b5a2c, 0x807f40, 0xaaa65e], 0x222210, 0, [9, 0.9, 0, 0]),
    ],
  },
  rock: {
    size: 256,
    wash: { scale: 3, tint: 0.8, strength: 0.5 },
    grain: 0.9,
    variants: [
      v(1, [0x5a5855, 0x7a7773, 0x9a9690, 0xbdb9b0], 0x25231f, 0, []),
      v(2, [0x86704f, 0xa68c68, 0xc4aa84, 0xdcc9a2], 0x40301f, 0, []),
      v(3, [0x4a5461, 0x667483, 0x8493a1, 0xa9b4be], 0x1c222a, 0, []),
      v(4, [0x45434a, 0x5f5d66, 0x7c7a85, 0x9e9ca8], 0x1a191d, 0, []),
      v(5, [0x58604f, 0x76806a, 0x959f84, 0xb4bc9f], 0x262a20, 0, []),
    ],
  },
  brick: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x7e3a2b, 0xa24a35, 0xbf6045, 0xd88260], 0x3a1d16, 0xcfc6b2, [4, 8, 0.007, 0]),
      v(2, [0x8a4a2a, 0xb0683a, 0xcf8a50, 0xe6ae72], 0x472614, 0xd8cfba, [4, 8, 0.007, 0]),
      v(3, [0x5e3030, 0x7c4040, 0x9a5a52, 0xb47a6c], 0x301818, 0xbdb3a6, [4, 8, 0.007, 0]),
      v(4, [0x9a7a45, 0xbd9a5a, 0xd6b777, 0xe8d29a], 0x4a3a1e, 0xe4dcc8, [4, 8, 0.007, 0]),
      v(5, [0x8c5a50, 0xaa7466, 0xc59384, 0xdcb3a2], 0x45281f, 0xd9d0c2, [4, 8, 0.007, 0]),
    ],
  },
  stone: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x77736c, 0x948f87, 0xaba59b, 0xc4beb0], 0x2e2a25, 0, [3, 4, 0, 0.5]),
      v(2, [0x6f6c66, 0x8a8780, 0xa19d94, 0xb9b4a8], 0x2a2723, 0, [3, 4, 0, 0.5]),
      v(3, [0x857b69, 0xa39a84, 0xbbb299, 0xd3cab0], 0x33291c, 0, [3, 4, 0, 0.5]),
      v(4, [0x6a6e70, 0x888c8d, 0xa0a4a3, 0xbdc0bc], 0x25282a, 0, [3, 4, 0, 0.5]),
      v(5, [0x7d6f60, 0x9b8b79, 0xb4a38f, 0xcdbda6], 0x35291e, 0, [3, 4, 0, 0.5]),
    ],
  },
  cobble: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x6e6a63, 0x8b8780, 0xa5a095, 0xc0b9ab], 0x2a2723, 0x4a4540, [5, 0.12, 0, 0]),
      v(2, [0x66625b, 0x827e75, 0x9c978b, 0xb5afa0], 0x25221e, 0x433f3a, [5, 0.12, 0, 0]),
      v(3, [0x76695a, 0x948572, 0xae9e87, 0xc8b79e], 0x30261b, 0x4d4337, [5, 0.14, 0, 0]),
      v(4, [0x5f6468, 0x7c8286, 0x969da0, 0xb0b6b6], 0x1f2326, 0x3d4144, [5, 0.12, 0, 0]),
      v(5, [0x72665a, 0x8f8272, 0xa99a86, 0xc3b49d], 0x2e241a, 0x4a4036, [5, 0.14, 0, 0]),
    ],
  },
  plaster: {
    size: 256,
    wash: { scale: 3, tint: 0.88, strength: 0.4 },
    grain: 0.94,
    variants: [
      v(1, [0xc7b693, 0xd9c8a9, 0xe6d9bf, 0xf2e8d2], 0x5a4c38, 0, []),
      v(2, [0xb5a285, 0xc9b79c, 0xdbcab0, 0xeadcc4], 0x54452f, 0, []),
      v(3, [0xd3c8b3, 0xe6dccb, 0xf0e8d9, 0xf9f4ea], 0x5c5446, 0, []),
      v(4, [0xa38a67, 0xb89f7d, 0xcdb792, 0xe0cdab], 0x4c3b25, 0, []),
      v(5, [0xb5bab0, 0xcfd2c8, 0xe0e3da, 0xf0f2ea], 0x484c42, 0, []),
    ],
  },
  planks: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x8f6a40, 0xb08a5a, 0xc9a577, 0xdebe94], 0x3a2814, 0, [6, 0, 0, 0]),
      v(2, [0x6a4a2c, 0x8a6a42, 0xa5835a, 0xbf9d74], 0x2c1c0e, 0, [6, 0, 0, 0]),
      v(3, [0x8a6f50, 0xa88c6a, 0xc4a885, 0xdac19f], 0x3a2c1b, 0, [5, 0, 0, 0]),
      v(4, [0x55473a, 0x6f5a45, 0x887058, 0xa28a70], 0x241b12, 0, [6, 0, 0, 0]),
      v(5, [0x65736f, 0x7d8a8f, 0x97a3a6, 0xb2bcbc], 0x2a3033, 0, [6, 0, 0, 0]),
    ],
  },
  mossy: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x77736c, 0x948f87, 0xaba59b, 0xc4beb0], 0x24261f, 0x5a7440, [3, 4, 0, 0.5]),
      v(2, [0x6f7266, 0x8a8d7c, 0xa1a590, 0xb9bca5], 0x23261d, 0x64803f, [3, 4, 0, 0.5]),
      v(3, [0x7a7566, 0x978f7a, 0xafa78f, 0xc8bfa4], 0x2b261a, 0x4e6a38, [3, 4, 0, 0.5]),
      v(4, [0x646a68, 0x80878a, 0x989fa0, 0xb2b8b4], 0x1f2623, 0x477052, [3, 4, 0, 0.5]),
      v(5, [0x706c60, 0x8d887a, 0xa6a08f, 0xbfb8a3], 0x27271c, 0x6a8140, [3, 4, 0, 0.5]),
    ],
  },
  shingle: {
    size: 256,
    wash: { scale: 3, tint: 0.85, strength: 0.4 },
    grain: 0.92,
    variants: [
      v(1, [0x6a2424, 0x8b2f2f, 0xa84a3d, 0xc56b55], 0x2e1212, 0, [4, 8, 0.3, 0]),
      v(2, [0x36465a, 0x4a5d6b, 0x65798a, 0x8497a6], 0x161e28, 0, [4, 8, 0.0, 0]),
      v(3, [0x4a3322, 0x6b4a2f, 0x8a6542, 0xa5835c], 0x261a10, 0, [4, 8, 0.12, 0]),
      v(4, [0x2c4430, 0x3f5a3a, 0x58794f, 0x7c9a6c], 0x14241a, 0, [4, 8, 0.3, 0]),
      v(5, [0x80502a, 0xa0683c, 0xbd8650, 0xd8a672], 0x3a2212, 0, [4, 8, 0.3, 0]),
    ],
  },
  glass: {
    size: 256,
    wash: { scale: 3, tint: 0.92, strength: 0.3 },
    grain: 0.96,
    variants: [
      v(1, [0x1f3a52, 0x2f5a78, 0x4a7f9e, 0x9cc4d8], 0x0e1d2b, 0, [3, 5, 0, 0]),
      v(2, [0x1d3f3f, 0x2d6360, 0x4a8c86, 0xa0d0c8], 0x0d2424, 0, [3, 6, 0, 0]),
      v(3, [0x2a3346, 0x3f4d66, 0x5f6f8a, 0xaebdd2], 0x141a28, 0, [4, 5, 0, 0]),
      v(4, [0x2b3d2c, 0x41603f, 0x62865a, 0xb2d0a2], 0x14221a, 0, [3, 4, 0, 0]),
      v(5, [0x30264a, 0x4a3d72, 0x6c5e9a, 0xbab0dc], 0x181230, 0, [4, 6, 0, 0]),
    ],
  },
  lamp: {
    size: 256,
    wash: { scale: 3, tint: 0.92, strength: 0.25 },
    grain: 0.96,
    variants: [
      v(1, [0xa8641e, 0xd08a2c, 0xf0b44a, 0xfbe39a], 0x5a3510, 0, [3, 0, 0, 0]),
      v(2, [0xb27a22, 0xd9a43a, 0xf2c85e, 0xfdf0b0], 0x5c4210, 0, [3, 0, 0, 0]),
      v(3, [0xa84a1c, 0xd4702a, 0xf0984a, 0xfbd098], 0x5a2410, 0, [4, 0, 0, 0]),
      v(4, [0x9a6a2a, 0xc4924a, 0xe3b870, 0xf8e0b4], 0x4c3416, 0, [3, 0, 0, 0]),
      v(5, [0xa8421e, 0xd0622e, 0xee8a50, 0xfac28e], 0x581e10, 0, [4, 0, 0, 0]),
    ],
  },
  leaf: {
    size: 256,
    repeat: false,
    wash: { scale: 3, tint: 0.9, strength: 0.35 },
    grain: 0.95,
    weights: [1, 1, 1, 0.5, 0.35],
    variants: [
      v(1, [0x2f5d2a, 0x4a8a37, 0x6fb04a, 0xa2d468], 0x1d3a1c, 0, [6, 0, 0, 0]),
      v(2, [0x1f3f2b, 0x2f5e3b, 0x43804a, 0x6aa862], 0x12261a, 0, [6, 0, 0, 0]),
      v(3, [0x4b5a22, 0x72822f, 0x9aab3e, 0xc9d160], 0x2c3512, 0, [5, 0, 0, 0]),
      v(4, [0x7a2f1a, 0xb5502a, 0xdd8a35, 0xf0c25a], 0x4a1a0e, 0, [6, 0, 0, 0]),
      v(5, [0x1f4a4a, 0x2f7068, 0x4a9a82, 0x82c4a4], 0x10302e, 0, [5, 0, 0, 0]),
    ],
  },
};

export const KINDS = Object.keys(RECIPES);

/**
 * How a kind is laid onto geometry (read by `MergeBuilder`):
 *  - uv:    'face' | 'world' (projected from the triangles), 'cyl' | 'cone' |
 *           'sphere' | 'box' (native UVs of the primitive, rescaled) or
 *           'native' (the geometry's own UVs, untouched)
 *  - tile:  world size of one texture repeat
 *  - shift: per-model random offset in tiles (u, v), so two models sharing a
 *           variant do not show the same part of the picture. v stays 0 for
 *           patterns with courses (bricks) so walls start with a full course.
 *  - double: visible from both sides (flat leaves)
 */
export const MAPPING = {
  bark: { uv: 'cyl', tile: 1.6, shift: [1, 1] },
  foliage: { uv: 'sphere', tile: 1.4, shift: [1, 1] },
  needles: { uv: 'cone', tile: 1.2, shift: [1, 1] },
  rock: { uv: 'world', tile: 1.3, shift: [1, 1] },
  brick: { uv: 'face', tile: 2.5, shift: [1, 0] },
  stone: { uv: 'face', tile: 2.5, shift: [1, 0] },
  cobble: { uv: 'face', tile: 2.5, shift: [1, 0] },
  plaster: { uv: 'face', tile: 2.5, shift: [1, 1] },
  planks: { uv: 'face', tile: 2.5, shift: [1, 1] },
  mossy: { uv: 'face', tile: 2.5, shift: [1, 0] },
  shingle: { uv: 'face', tile: 1.6, shift: [1, 0] },
  glass: { uv: 'face', tile: 1.2, shift: [1, 1] },
  lamp: { uv: 'face', tile: 1.2, shift: [1, 1] },
  leaf: { uv: 'native', tile: 1, shift: [0, 0], double: true },
};

const channel = (hex, shift) => ((hex >> shift) & 255) / 255;
const rgb = (hex) => [channel(hex, 16), channel(hex, 8), channel(hex, 0)];

/** Plain colour of a variant (average of its ramp), used when nothing can be baked. */
export function fallbackColor(kind, variant) {
  const { colors } = RECIPES[kind].variants[variant];
  const avg = [0, 0, 0];
  for (const c of colors) rgb(c).forEach((x, i) => { avg[i] += x / colors.length; });
  return new Color().setRGB(...avg).convertSRGBToLinear();
}

/**
 * The lamina material of a kind: drawing layer (ink, pigment, hatching), a
 * seamless watercolour wash and paper grain. One shader serves all variants;
 * `apply(i)` only swaps uniforms.
 */
export function createRecipe(kind) {
  const recipe = RECIPES[kind];
  const draw = new (drawLayer(kind))();
  const { scale, tint, strength } = recipe.wash;
  const wash = new TiledNoise({
    type: 'simplex', scale, mode: 'multiply', alpha: strength,
    colorA: [tint, tint * 0.97, tint * 0.9], colorB: [tint + (1 - tint) * 0.4, tint + (1 - tint) * 0.37, tint + (1 - tint) * 0.3],
    colorC: [1, 1, 1], colorD: [1, 1, 1],
  });
  const g = recipe.grain;
  const grain = new Noise({
    type: 'white', mapping: 'uv', scale: recipe.size, mode: 'multiply',
    colorA: `#${[g, g, g * 0.97].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`,
    colorB: '#ffffff', colorC: '#ffffff', colorD: '#ffffff',
  });
  const material = new LayerMaterial({ color: new Color().setRGB(0.5, 0.5, 0.5), lighting: 'basic', layers: [draw, wash, grain] });
  material.toneMapped = false;

  const apply = (i) => {
    const s = recipe.variants[i];
    draw.seed = s.seed;
    wash.seed = s.seed * 1.7;
    ['colorA', 'colorB', 'colorC', 'colorD'].forEach((k, n) => draw[k].set(...rgb(s.colors[n])));
    draw.ink.set(...rgb(s.ink));
    draw.extra.set(...rgb(s.extra));
    draw.param.set(s.param[0] ?? 0, s.param[1] ?? 0, s.param[2] ?? 0, s.param[3] ?? 0);
  };
  return { material, apply };
}
