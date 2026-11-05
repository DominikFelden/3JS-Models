import { test } from 'node:test';
import assert from 'node:assert';
import { rangeUniform, setRange, inRange, FAR } from '../src/forest/fade.js';
import { coverageMipmaps, ALPHA_CUT, atlasLayout } from '../src/forest/impostors.js';

test('fade ranges of neighbouring tiers overlap only in the dither band', () => {
  const a = rangeUniform(), b = rangeUniform();
  setRange(a, null, 100, 0.1);
  setRange(b, 100, Infinity, 0.1);
  assert.deepStrictEqual(a.value.toArray(), [-1, 0, 100, 10]);
  assert.deepStrictEqual(b.value.toArray(), [100, 10, FAR, 0]);
  for (const d of [0, 50, 94.9, 95, 100, 104.9, 105, 1e6]) {
    assert.ok(inRange(a, d) || inRange(b, d), `distance ${d} drawn by a tier`);
    assert.strictEqual(inRange(a, d) && inRange(b, d), d >= 95 && d < 105, `distance ${d} in both only in the band`);
  }
});

test('impostor mipmaps keep the silhouette of sparse crowns', () => {
  const S = 64, W = 128, H = 64;
  const data = new Uint8Array(W * H * 4);
  // Frame 0: a round crown with one pixel in four set (like small leaves); frame 1 stays empty.
  // Plain averaging would leave every mip below the alpha cut-off: the tree would vanish.
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if ((x - 32) ** 2 + (y - 32) ** 2 < 24 ** 2 && x % 2 === 0 && y % 2 === 0) data[(y * W + x) * 4 + 3] = 255;
  }
  const levels = coverageMipmaps(data, W, H, S);
  assert.strictEqual(levels.length, 8);
  assert.deepStrictEqual(levels.map((l) => [l.width, l.height]).slice(0, 3), [[128, 64], [64, 32], [32, 16]]);
  const coverage = (l, f, x0) => {
    let n = 0;
    for (let y = 0; y < f; y++) for (let x = x0; x < x0 + f; x++) if (l.data[(y * l.width + x) * 4 + 3] >= ALPHA_CUT * 255) n++;
    return n / (f * f);
  };
  const target = coverage(levels[0], S, 0);
  for (let i = 1; i <= 4; i++) {
    const f = S >> i;
    const c = coverage(levels[i], f, 0);
    assert.ok(c >= target && c <= Math.PI * 24 ** 2 / S ** 2 + 0.1, `level ${i} keeps the crown, no bigger than its outline (${c})`);
    assert.strictEqual(coverage(levels[i], f, f), 0, `level ${i} keeps the empty frame empty`);
  }
});

test('impostor atlas layout fits all frames', () => {
  const L = atlasLayout(5, 128);
  assert.ok(L.cols * L.rows >= 5 * 32);
  assert.ok(L.width <= 4096 && L.height <= 4096);
});
