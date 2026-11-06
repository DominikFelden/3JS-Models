import { Vector4 } from 'three';

/**
 * Dithered cross-fades between the tiers of a `Forest` (detail levels,
 * impostors, canopy). Every tier draws only the trees whose distance lies in
 * its range `[near, far)`. Near a boundary the two neighbouring tiers both
 * draw the tree, and a screen-space dither pattern decides per pixel which
 * one shows. The tests are exactly complementary, so a pixel is never shown
 * twice or dropped: the tree dissolves into its other form instead of
 * popping.
 *
 * The range is a uniform `vec4(nearBoundary, nearWidth, farBoundary, farWidth)`.
 * The fragment shader reads the distance from `vForestDist`.
 */

/** Distances are kept below this in uniforms (no Infinity in GLSL). */
export const FAR = 1e9;

export const DITHER_GLSL = /* glsl */ `
float forestDither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

export const FADE_PARS = /* glsl */ `
uniform vec4 uForestRange;
varying float vForestDist;
${DITHER_GLSL}
`;

export const FADE_TEST = /* glsl */ `
{
  float forestH = forestDither(gl_FragCoord.xy) - 0.5;
  if (vForestDist < uForestRange.x + uForestRange.y * forestH || vForestDist >= uForestRange.z + uForestRange.w * forestH) discard;
}
`;

/** A range uniform `{ value: Vector4 }`; set it with `setRange`. */
export const rangeUniform = () => ({ value: new Vector4(-1, 0, FAR, 0) });

/**
 * Set a range uniform. `near` / `far` are boundaries (null: none), `fade`
 * the width of the dither band as a fraction of the boundary distance.
 */
export function setRange(uniform, near, far, fade) {
  const n = near ?? -1;
  const f = far === null || far === undefined || !Number.isFinite(far) ? FAR : far;
  uniform.value.set(n, n > 0 ? n * fade : 0, f, f < FAR ? f * fade : 0);
}

/**
 * Is a tree at `distance` drawn by the tier with this range? True in the
 * whole dither band on both sides of a boundary (both tiers draw it there).
 */
export function inRange(range, distance) {
  const { x, y, z, w } = range.value;
  return distance >= x - y / 2 && distance < z + w / 2;
}

/** Inject the fade test into a material's fragment shader (`vForestDist` must be set by the vertex shader). */
export function injectFadeFragment(shader, range) {
  shader.uniforms.uForestRange = range;
  shader.fragmentShader = FADE_PARS + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `${FADE_TEST}\n#include <clipping_planes_fragment>`);
}

/**
 * Copy of a (pooled) tree material for an `InstancedMesh` of the forest that
 * fades by the distance of each instance's origin (the tree's base). The copy
 * shares the texture of the original; `range` is shared by all copies of one
 * detail level so changing it moves the level.
 */
export function fadeMaterial(source, range) {
  const mat = source.clone();
  const base = source.onBeforeCompile;
  const baseKey = source.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(source, shader, renderer); // e.g. billboarded leaf cards
    shader.vertexShader = `varying float vForestDist;\n${shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
  vForestDist = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
#else
  vForestDist = distance((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
#endif`)}`;
    injectFadeFragment(shader, range);
  };
  mat.customProgramCacheKey = () => `forest-fade:${baseKey}`;
  return mat;
}
