import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, PlaneGeometry, Mesh, DataTexture,
  RGBAFormat, UnsignedByteType, RepeatWrapping, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter,
  NearestFilter, SRGBColorSpace, NoToneMapping,
} from 'three';
import { RECIPES, TEXTURE_VARIANTS, createRecipe } from './recipes.js';

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Baking needs a canvas (browser or worker). Under Node models use plain colours. */
export function canBake() {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

function createRenderer() {
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
  const renderer = new WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power',
  });
  renderer.setSize(1, 1, false);
  return renderer;
}

function toTexture(data, size, repeat) {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Average colour of the pixels in linear space; used to recolour a texture to a target colour. */
function meanLinear(data) {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += SRGB_TO_LINEAR[data[i]];
    g += SRGB_TO_LINEAR[data[i + 1]];
    b += SRGB_TO_LINEAR[data[i + 2]];
  }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
}

function render(renderer, kind) {
  const { size } = RECIPES[kind];
  const { material, apply } = createRecipe(kind);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const target = new WebGLRenderTarget(size, size, {
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter,
  });

  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = NoToneMapping;
  const out = [];
  try {
    for (let i = 0; i < TEXTURE_VARIANTS; i++) {
      apply(i);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const data = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, data);
      out.push({ texture: toTexture(data, size, RECIPES[kind].repeat !== false), mean: meanLinear(data) });
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    target.dispose();
    quad.geometry.dispose();
    material.dispose();
  }
  return out;
}

let priv = null;
let releaseTimer = 0;

function release() {
  if (!priv) return;
  priv.dispose();
  priv.forceContextLoss();
  priv = null;
}

/**
 * Run `fn(renderer)` with `renderer` when given (the host's own WebGLRenderer;
 * `fn` must restore its state), otherwise with a private offscreen renderer
 * that is kept for a moment (bakes usually come in a row) and then released.
 * Results must be read back to the CPU: the private context goes away.
 */
export function withBakeRenderer(renderer, fn) {
  if (renderer) return fn(renderer);
  clearTimeout(releaseTimer);
  priv ??= createRenderer();
  try {
    return fn(priv);
  } finally {
    releaseTimer = setTimeout(release, 1500);
  }
}

/**
 * Bake all variants of a surface kind (see `withBakeRenderer` for `renderer`).
 * @returns {{texture: DataTexture, mean: number[]}[]}
 */
export function bakeKind(kind, renderer = null) {
  return withBakeRenderer(renderer, (r) => render(r, kind));
}
