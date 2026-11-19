import { test } from 'node:test';
import assert from 'node:assert';
import { BoxGeometry, MeshBasicMaterial, Matrix4, Quaternion, Vector3 } from 'three';
import { rangeUniform, setRange, inRange, FAR } from '../src/forest/fade.ts';
import { coverageMipmaps, ALPHA_CUT, atlasLayout } from '../src/forest/impostors.ts';
import { InstanceBuffer } from '../src/forest/instances.ts';
import { Undergrowth } from '../src/forest/undergrowth.ts';
import { Bush } from '../src/models/Bush.ts';
import { TallGrass, Bracken } from '../src/models/Plants.ts';

test('instance buffers: one buffer for all meshes of a variant, grown on demand, only the used part uploaded', () => {
  const buffer = new InstanceBuffer(2);
  const geo = new BoxGeometry(), mat = new MeshBasicMaterial();
  const bark = buffer.addMesh(geo, mat), leaves = buffer.addMesh(geo, mat, { castShadow: true });
  let freed = 0;
  bark.addEventListener('dispose', () => freed++); // three.js frees the GPU copy of the outgrown buffer on this
  buffer.reset();
  for (let i = 0; i < 5; i++) buffer.push(i * 10, 0, 0, i, 1 + i / 10, 2, 1 + i / 10);
  assert.strictEqual(buffer.commit(), 2, 'one draw call per mesh');
  assert.strictEqual(buffer.capacity, 8, 'grew from 2 to 8');
  assert.strictEqual(freed, 2);
  for (const mesh of [bark, leaves]) {
    assert.strictEqual(mesh.instanceMatrix, buffer.attribute, 'shared by all meshes');
    assert.ok(mesh.visible && mesh.count === 5);
  }
  assert.deepStrictEqual(buffer.attribute.updateRanges, [{ start: 0, count: 5 * 16 }], 'upload only the used part');
  const expected = new Matrix4().compose(new Vector3(30, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 3), new Vector3(1.3, 1.3, 1.3));
  const first = new Matrix4().compose(new Vector3(), new Quaternion(), new Vector3(1, 1, 1));
  const at = (i) => new Matrix4().fromArray(buffer.attribute.array, i * 16);
  assert.ok(at(3).elements.every((e, i) => Math.abs(e - expected.elements[i]) < 1e-6), 'turn and scale as compose()');
  assert.ok(at(0).elements.every((e, i) => Math.abs(e - first.elements[i]) < 1e-6), 'growing keeps the instances');
  for (let i = 0; i < 5; i++) {
    const r = 1 + i / 10;
    assert.ok(buffer.sphere.center.distanceTo(new Vector3(i * 10, 2, 0)) + r <= buffer.sphere.radius + 1e-9, 'culling sphere holds every instance');
  }
  buffer.reset();
  assert.strictEqual(buffer.commit(), 0);
  assert.ok(!bark.visible && bark.count === 0);
});

test('shadow-only meshes are drawn into shadow maps but not on screen', () => {
  const buffer = new InstanceBuffer();
  const geo = new BoxGeometry(), mat = new MeshBasicMaterial();
  buffer.addMesh(geo, mat);
  const caster = buffer.addMesh(geo, mat, { castShadow: true, shadowOnly: true });
  buffer.reset();
  buffer.push(0, 0, 0, 0, 1, 0.5, 1);
  assert.strictEqual(buffer.commit(), 1, 'not counted as a draw call');
  assert.ok(caster.castShadow && caster.visible && caster.count === 1, 'the shadow pass draws it');
  (caster as any).onBeforeRender();
  assert.strictEqual(caster.count, 0, 'the colour pass draws no instance (three.js skips the call)');
  (caster as any).onAfterRender();
  assert.strictEqual(caster.count, 1);
});

test('undergrowth: bushes cross-fade to a low-poly copy at lodDistance, low plants end sooner, casters only with shadows', () => {
  const everything = { intersectsBox: () => true, intersectsSphere: () => true };
  const camera = new Vector3(0, 1.5, 0);
  const fade = 0.15;
  // A level drawn from `near` to `far` also draws the dither band around both ends (as `setRange` and `rangeBand` compute it).
  const from = (near) => near - near * fade / 2, to = (far) => far + far * fade / 2;
  for (const shadows of [false, true]) {
    const ug = new Undergrowth({ count: 4000, area: 160, seed: 3, variants: 2, fade, shadows });
    ug.update(camera, 1, everything);
    // Brute force: every plant must be in exactly the levels whose distance band holds it.
    const expected = ug._variants.map((v) => v.levels.map(() => new Set<string>()));
    let visible = 0, grassBeyondEnd = 0, brackenBeyondGrass = 0;
    for (const t of ug._plants) {
      const v = ug._variants[t.variant];
      const end = 60 * v.kind.config.distance;
      const dx = t.x - camera.x, dy = t.y - camera.y, dz = t.z - camera.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const bands = v.levels.length === 2 ? [[-1, to(25)], [from(25), to(end)]] : [[-1, to(end)]];
      let drawn = false;
      bands.forEach(([lo, hi], l) => { if (d >= lo && d < hi) { expected[t.variant][l].add(`${t.x},${t.z}`); drawn = true; } });
      if (drawn) visible++;
      if (d > 46 && d < 60) {
        if (v.kind.config.Plant === TallGrass) grassBeyondEnd++;
        if (v.kind.config.Plant === Bracken) brackenBeyondGrass++;
      }
    }
    ug._variants.forEach((v, i) => v.levels.forEach((lv, l) => {
      const got = new Set();
      for (let n = 0; n < lv.buffer.count; n++) got.add(`${lv.buffer.attribute.array[n * 16 + 12]},${lv.buffer.attribute.array[n * 16 + 14]}`);
      const want = [...expected[i][l]].map((s) => s.split(',').map((x) => Math.fround(Number(x))).join(','));
      assert.strictEqual(lv.buffer.count, expected[i][l].size, `variant ${i} level ${l}: every plant once`);
      assert.deepStrictEqual([...got].sort(), want.sort(), `variant ${i} level ${l}`);
    }));
    assert.strictEqual(ug.stats.visible, visible);
    assert.ok(grassBeyondEnd > 0 && brackenBeyondGrass > 0, 'the test covers grass past its end (42 m) and bracken still drawn there');
    const bushes = ug._variants.filter((v) => v.levels.length === 2);
    assert.ok(bushes.length === 2 && bushes.every((v) => v.levels[1].buffer.count > 0 && v.levels[1].triangles * 3 < v.levels[0].triangles), 'far bushes are drawn, ~3.5x cheaper');
    assert.ok(ug._variants.every((v) => v.levels.length === (v.kind.config.Plant === Bush ? 2 : 1)), 'only bushes have a far copy');
    const meshes = ug._variants.flatMap((v) => v.levels.flatMap((lv) => lv.buffer.meshes));
    const casters = meshes.filter((m) => m.userData.shadowOnly);
    assert.strictEqual(casters.length, shadows ? 8 : 0, 'one invisible caster per frond plant variant, none without shadows');
    assert.ok(casters.every((m) => m.castShadow));
    assert.strictEqual(meshes.some((m) => m.castShadow), shadows);
    assert.ok(bushes.every((v) => v.levels[1].buffer.meshes.every((m) => !m.castShadow)), 'far bushes cast no shadow');
    ug.dispose();
  }
});

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
