// @ts-nocheck -- tests poke at three.js internals
import { test } from 'node:test';
import assert from 'node:assert';
import { ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { setToonShading, resetToonShading, toonSettings, TOON_UNIFORMS, ToonOutlines } from '../src/index.ts';

test('toon shading patches the standard lighting chunks once', () => {
  const s = setToonShading();
  assert.strictEqual(s.installed, true);
  assert.strictEqual(s.enabled, true);
  const pars = ShaderChunk.lights_physical_pars_fragment;
  assert.ok(pars.includes('uniform ToonSettings toon;'));
  assert.ok(pars.includes('toonRamp( dot( geometryNormal, directLight.direction ) )'));
  // Every shadow lookup (directional, spot, point) is sharpened.
  assert.strictEqual((ShaderChunk.lights_fragment_begin.match(/TOON_SHADOW\( get/g) || []).length, 3);
  assert.ok(ShaderChunk.lights_fragment_end.includes('toon.shadeTint'));
  const before = [pars, ShaderChunk.lights_fragment_begin, ShaderChunk.lights_fragment_end];
  setToonShading({ steps: 3 });
  assert.deepStrictEqual([ShaderChunk.lights_physical_pars_fragment, ShaderChunk.lights_fragment_begin, ShaderChunk.lights_fragment_end], before);
  // Lambert/Phong share lights_fragment_begin but not the physical pars: they get the no-op macro.
  assert.ok(ShaderChunk.lights_fragment_begin.includes('#define TOON_SHADOW( s, i ) ( s )'));
  resetToonShading();
});

test('toon settings are one live uniform shared by every material', () => {
  const value = ShaderLib.standard.uniforms.toon.value;
  assert.strictEqual(ShaderLib.physical.uniforms.toon.value, value);
  assert.strictEqual(TOON_UNIFORMS.toon.value, value);
  // A material's program clones the ShaderLib uniforms; the plain settings object stays shared.
  const clone = UniformsUtils.clone(ShaderLib.standard.uniforms);
  setToonShading({ steps: 9, threshold: -1, rimStrength: 0.5, enabled: false, shadeTint: 0xff0000 });
  assert.strictEqual(clone.toon.value.steps, 4);
  assert.strictEqual(clone.toon.value.threshold, 0);
  assert.strictEqual(clone.toon.value.rimStrength, 0.5);
  assert.strictEqual(clone.toon.value.enabled, 0);
  assert.strictEqual(toonSettings().enabled, false);
  assert.strictEqual(toonSettings().shadeTint.getHex(), 0xff0000);
  const d = resetToonShading();
  assert.strictEqual(d.enabled, true);
  assert.strictEqual(d.steps, 2);
});

test('ToonOutlines clamps options and sizes to the drawing buffer', () => {
  const fake = { getDrawingBufferSize: (v) => v.set(300, 200), getPixelRatio: () => 1 };
  const o = new ToonOutlines(fake, { thickness: 9, darkness: 0.5, fade: [10, 5], samples: 0 });
  const u = o.material.uniforms;
  assert.strictEqual(o.target.width, 300);
  assert.strictEqual(u.thickness.value, 4);
  assert.ok(Math.abs(u.texel.value.x - 1 / 300) < 1e-12);
  assert.strictEqual(u.darkness.value, 0.5);
  assert.ok(u.fade.value.y > u.fade.value.x);
  o.set({ creases: 0 });
  assert.strictEqual(u.creases.value, 0);
  o.dispose();
});
