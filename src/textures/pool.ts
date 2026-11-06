import { Color, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { RECIPES, KINDS, MAPPING, TEXTURE_VARIANTS, fallbackColor } from './recipes.ts';
import { canBake, bakeKind } from './bake.ts';

export { KINDS as TEXTURE_KINDS, TEXTURE_VARIANTS };

const baked = new Map();     // kind -> [{texture, mean}] | null (null: nothing could be baked)
const materials = new Map();
let bakeFailed = false;

const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function check(kind, variant = 0) {
  if (!RECIPES[kind]) throw new Error(`Unknown texture kind "${kind}". Available: ${KINDS.join(', ')}`);
  if (!Number.isInteger(variant) || variant < 0 || variant >= TEXTURE_VARIANTS) {
    throw new Error(`Texture variant must be an integer from 0 to ${TEXTURE_VARIANTS - 1}, got ${variant}`);
  }
}

/** All variants of a kind, baked on first use. null when baking is not possible (Node, no WebGL). */
function slots(kind, renderer = null) {
  if (!baked.has(kind)) {
    let result = null;
    if (!bakeFailed && canBake()) {
      try {
        result = bakeKind(kind, renderer);
      } catch (err) {
        bakeFailed = true;
        console.warn('3JS-Models: baking textures failed, models fall back to plain colours.', err);
      }
    }
    baked.set(kind, result);
  }
  return baked.get(kind);
}

/**
 * Pick one of the ready-made variants of a kind. Pass a seeded random function
 * (e.g. `model.random`) to make the choice reproducible. Some kinds prefer
 * common variants (e.g. autumn foliage is rarer). `allowed` (a list of variant
 * numbers) limits the choice, e.g. to leave white birch bark off a pine; it
 * still consumes exactly one random number.
 */
export function pickVariant(kind, random = Math.random, allowed = null) {
  check(kind);
  const list = allowed?.length ? allowed : null;
  list?.forEach((v) => check(kind, v));
  const w = RECIPES[kind].weights;
  if (!w && !list) return Math.floor(random() * TEXTURE_VARIANTS) % TEXTURE_VARIANTS;
  const weights = Array.from({ length: TEXTURE_VARIANTS }, (_, i) => (list && !list.includes(i) ? 0 : (w?.[i] ?? 1)));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  let last = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    r -= weights[i];
    if (r < 0) return i;
  }
  return last;
}

/** The shared texture, or null where textures are unavailable (Node, no WebGL). */
export function getTexture(kind, variant) {
  check(kind, variant);
  return slots(kind)?.[variant].texture ?? null;
}

/**
 * Linear average colour of a variant as it shows on a model: the baked
 * texture's mean, or the plain fallback colour where nothing is baked (Node).
 */
export function textureMean(kind, variant) {
  check(kind, variant);
  const mean = slots(kind)?.[variant].mean;
  return mean ? new Color().setRGB(mean[0], mean[1], mean[2]) : fallbackColor(kind, variant);
}

/**
 * Shared material wearing a pooled texture. The same arguments always return
 * the same material instance, so any number of models share it.
 *  - color: optional target colour; the texture is recoloured so that its
 *           average matches (keeps the drawn structure). Omit it to keep the
 *           variant's own colourway.
 *  - vertexColors: set for geometry built by `MergeBuilder` (per-part tint).
 *  - glow: emissive intensity; the texture lights itself (window glass).
 * Without textures (Node) this is a plain material in the variant's colour.
 */
export function pooledMaterial(kind, variant, { color = null, flatShading = true, vertexColors = false, roughness = 1, metalness = 0, glow = 0 }: any = {}) {
  check(kind, variant);
  const target = color === null ? null : new Color(color);
  const key = `${kind}:${variant}:${target ? target.getHexString() : '-'}:${flatShading}:${vertexColors}:${roughness}:${metalness}:${glow}`;
  if (!materials.has(key)) {
    const slot = slots(kind)?.[variant];
    let tint;
    if (!slot) tint = target ?? fallbackColor(kind, variant);
    else if (!target) tint = new Color(1, 1, 1);
    else {
      const [r, g, b] = slot.mean.map((m) => Math.max(m, 0.03));
      tint = new Color(Math.min(3, target.r / r), Math.min(3, target.g / g), Math.min(3, target.b / b));
    }
    const mat = new MeshStandardMaterial({
      color: tint, map: slot?.texture ?? null, flatShading, vertexColors, roughness, metalness, side: MAPPING[kind].double ? DoubleSide : FrontSide,
    });
    if (glow) {
      // Self-lit (windows stay visible in shadow): the picture itself glows.
      if (slot) { mat.emissive.set(0xffffff); mat.emissiveMap = slot.texture; } else mat.emissive.copy(tint);
      mat.emissiveIntensity = glow;
    }
    mat.userData.mapping = { ...MAPPING[kind], hash: hashString(`${kind}:${variant}`) };
    materials.set(key, mat);
  }
  return materials.get(key);
}

/**
 * Bake the textures now instead of on first use, yielding to the browser
 * between kinds so a page stays responsive (and a progress bar can run).
 * Pass your own `renderer` to avoid a temporary second WebGL context.
 * Resolves to true when textures are available.
 */
export async function preloadTextures({ kinds = KINDS, renderer = null, onProgress = null }: any = {}) {
  let done = 0;
  for (const kind of kinds) {
    check(kind);
    await new Promise((resolve) => setTimeout(resolve, 0));
    slots(kind, renderer);
    onProgress?.(++done / kinds.length, kind);
  }
  return kinds.every((k) => baked.get(k));
}

/** Free the GPU memory of all pooled textures and materials (when a whole world is discarded). */
export function disposeTextures() {
  materials.forEach((m) => m.dispose());
  materials.clear();
  baked.forEach((list) => list?.forEach((s) => s.texture.dispose()));
  baked.clear();
  bakeFailed = false;
}
