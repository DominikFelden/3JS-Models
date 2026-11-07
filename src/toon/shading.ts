import { Color, ShaderChunk, ShaderLib } from 'three';

/**
 * Global cel ("toon") shading for every MeshStandardMaterial and
 * MeshPhysicalMaterial, including the ones that patch themselves with
 * `onBeforeCompile` (leaf cards, impostors, canopy).
 *
 * three.js builds all standard materials from the same shader chunks, so the
 * chunks are patched once instead of swapping materials:
 *  - direct light is banded (`steps` hard-edged tones) instead of a smooth
 *    Lambert falloff, and shadow edges are sharpened;
 *  - ambient (hemisphere) light in the shade is tinted (`shadeTint`), so
 *    shadows look painted and cool instead of grey;
 *  - a rim light brightens the silhouettes.
 *
 * Every setting is a uniform shared by all materials: change it at any time,
 * nothing recompiles. Only the patch itself must come first: call
 * `setToonShading()` before the first frame is rendered, because shaders
 * compiled earlier keep the plain lighting.
 */

export interface ToonOptions {
  /** Toon lighting on (default) or the plain three.js lighting. */
  enabled?: boolean;
  /** Lit tones beyond the shadow, 1..4 (1 = lit / shadow only). Default 2. */
  steps?: number;
  /** Light-facing (N·L) where the shadow ends, 0..0.9. Default 0.08. */
  threshold?: number;
  /** Width of the band edges in N·L, 0 (hard) .. 0.3. Default 0.025. */
  softness?: number;
  /** Share of the smooth light falloff kept inside the lit bands, so faces still differ, 0..1. Default 0.5. */
  gradient?: number;
  /** Width of cast-shadow edges, 0 (hard) .. 0.5 (as soft as the shadow map). Default 0.12. */
  shadowSoftness?: number;
  /** Rim light strength, 0 (off) .. 2. Default 0.35. */
  rimStrength?: number;
  /** How far the rim reaches in from the silhouette, 0..1. Default 0.28. */
  rimWidth?: number;
  /** Rim light colour. Default warm white. */
  rimColor?: number | string | Color;
  /** Multiplier for ambient light where the sun does not reach. Default a cool violet-blue. */
  shadeTint?: number | string | Color;
}

/** The live uniform values (shared by reference with every compiled material). */
const settings = {
  enabled: 1,
  steps: 2,
  threshold: 0.08,
  softness: 0.025,
  gradient: 0.5,
  shadowSoftness: 0.12,
  rimStrength: 0.35,
  rimWidth: 0.28,
  rimColor: new Color(0xfff4e0),
  shadeTint: new Color(0.78, 0.82, 1.05),
};

const DEFAULTS = { ...settings, rimColor: settings.rimColor.clone(), shadeTint: settings.shadeTint.clone() };

/**
 * Uniform to merge into a custom ShaderMaterial that includes the physical
 * lighting chunks (`lights_physical_pars_fragment`), once toon shading is on.
 */
export const TOON_UNIFORMS = { toon: { value: settings } };

const PARS = /* glsl */`
#define TOON_LIGHTING
struct ToonSettings {
	float enabled;
	float steps;
	float threshold;
	float softness;
	float gradient;
	float shadowSoftness;
	float rimStrength;
	float rimWidth;
	vec3 rimColor;
	vec3 shadeTint;
};
uniform ToonSettings toon;
float toonLit = 0.0;
float toonShadowLast = 1.0;

// Banded N·L: \`steps\` equal tones from the shadow edge (threshold) to full light.
float toonRamp( const in float x ) {
	float steps = clamp( toon.steps, 1.0, 4.0 );
	float span = ( 1.0 - toon.threshold ) / steps;
	float r = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		if ( float( k ) >= steps ) break;
		float e = toon.threshold + float( k ) * span;
		r += smoothstep( e - toon.softness, e + toon.softness + 1e-4, x );
	}
	r /= steps;
	// Keep part of the smooth falloff inside the lit bands, so faces at different angles still read.
	return r * mix( 1.0, saturate( x ) * 0.6 + 0.4, toon.gradient );
}

// Sharpen a shadow-map lookup; \`intensity\` is the light's shadowIntensity.
float toonShadow( const in float s, const in float intensity ) {
	if ( toon.enabled < 0.5 ) return s;
	float amount = ( 1.0 - s ) / max( intensity, 1e-3 );
	float hard = smoothstep( 0.5 - toon.shadowSoftness, 0.5 + toon.shadowSoftness + 1e-4, amount );
	toonShadowLast = 1.0 - hard;
	return 1.0 - intensity * hard;
}
#define TOON_SHADOW( s, i ) toonShadow( s, i )
`;

// Matched loosely: three's builds differ in blank lines.
const DIRECT_FROM = /(float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;)/;
const DIRECT_TO = /* glsl */`$1
	if ( toon.enabled > 0.5 ) {
		float tone = toonRamp( dot( geometryNormal, directLight.direction ) );
		irradiance = tone * directLight.color;
		float strength = saturate( dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		toonLit = max( toonLit, tone * toonShadowLast * strength );
	}
	toonShadowLast = 1.0;`;

const BEGIN_HEADER = /* glsl */`
#ifndef TOON_SHADOW
#define TOON_SHADOW( s, i ) ( s )
#endif
`;

const END_FOOTER = /* glsl */`
#ifdef TOON_LIGHTING
	if ( toon.enabled > 0.5 ) {
		reflectedLight.indirectDiffuse *= mix( toon.shadeTint, vec3( 1.0 ), toonLit );
		float facing = saturate( dot( geometryNormal, geometryViewDir ) );
		float rimEdge = 1.0 - toon.rimWidth;
		float rim = smoothstep( rimEdge - 0.06, rimEdge + 0.06, 1.0 - facing );
		reflectedLight.directDiffuse += rim * toon.rimStrength * ( 0.35 + 0.65 * toonLit ) * toon.rimColor * material.diffuseColor;
	}
#endif
`;

const MARK = '/* toon */';
let installed = false;

function patch(name, fn) {
  const before = ShaderChunk[name];
  const after = fn(before);
  if (after === before) throw new Error(`toon shading: could not patch ShaderChunk.${name} (unsupported three.js version?)`);
  ShaderChunk[name] = after;
}

/** Patch the three.js shader chunks (once). */
function install() {
  if (installed) return;
  if (!ShaderChunk.lights_physical_pars_fragment.includes(MARK)) {
    patch('lights_physical_pars_fragment', (s) => (DIRECT_FROM.test(s) ? MARK + PARS + s.replace(DIRECT_FROM, DIRECT_TO) : s));
    // Every shadow lookup (directional, spot, point) goes through TOON_SHADOW with its light's intensity.
    patch('lights_fragment_begin', (s) => {
      const out = s.replace(
        /\? (get(?:Point)?Shadow\( [^;]*?(\w+)\.shadowIntensity[^;]*\)) : 1\.0;/g,
        (_, call, light) => `? TOON_SHADOW( ${call}, ${light}.shadowIntensity ) : 1.0;`,
      );
      return out === s ? s : BEGIN_HEADER + out;
    });
    patch('lights_fragment_end', (s) => s + END_FOOTER);
  }
  for (const lib of [ShaderLib.standard, ShaderLib.physical]) lib.uniforms.toon = { value: settings };
  installed = true;
}

/**
 * Turn on (or tune) the global toon shading. The first call patches three.js,
 * so make it before the first render. Returns a copy of the settings.
 */
export function setToonShading(options: ToonOptions = {}) {
  install();
  if (options.enabled !== undefined) settings.enabled = options.enabled ? 1 : 0;
  const ranges = [['steps', 1, 4], ['threshold', 0, 0.9], ['softness', 0, 0.3], ['gradient', 0, 1], ['shadowSoftness', 0, 0.5], ['rimStrength', 0, 2], ['rimWidth', 0, 1]] as const;
  for (const [key, lo, hi] of ranges) {
    const v = options[key];
    if (Number.isFinite(v)) settings[key] = Math.min(hi, Math.max(lo, key === 'steps' ? Math.round(v) : v));
  }
  if (options.rimColor !== undefined) settings.rimColor.set(options.rimColor);
  if (options.shadeTint !== undefined) settings.shadeTint.set(options.shadeTint);
  return toonSettings();
}

/** Back to the default toon look (installs it if needed). */
export function resetToonShading() {
  install();
  const { rimColor, shadeTint, ...rest } = DEFAULTS;
  Object.assign(settings, rest);
  settings.rimColor.copy(rimColor);
  settings.shadeTint.copy(shadeTint);
  return toonSettings();
}

/** A copy of the current settings, plus whether three.js is patched. */
export function toonSettings() {
  return {
    installed,
    enabled: installed && settings.enabled > 0.5,
    steps: settings.steps, threshold: settings.threshold, softness: settings.softness, gradient: settings.gradient, shadowSoftness: settings.shadowSoftness,
    rimStrength: settings.rimStrength, rimWidth: settings.rimWidth,
    rimColor: settings.rimColor.clone(), shadeTint: settings.shadeTint.clone(),
  };
}
