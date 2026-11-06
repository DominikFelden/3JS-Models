// @ts-nocheck -- tests poke at untyped internals and three.js object subtypes
import { test } from 'node:test';
import assert from 'node:assert';
import { BufferAttribute, BufferGeometry, BoxGeometry, CylinderGeometry, DataTexture, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import {
  TEXTURE_KINDS, TEXTURE_VARIANTS, pickVariant, getTexture, pooledMaterial, preloadTextures, disposeTextures,
  PineTree, OakTree, LeafTree, Bush, Rock, House, Castle, Wall, Roof, Column, SimpleTree,
} from '../src/index.ts';
import { WorldModel, MergeBuilder, mulberry32 } from '../src/WorldModel.ts';
import { projectUV } from '../src/textures/uv.ts';
import { RECIPES, MAPPING, fallbackColor } from '../src/textures/recipes.ts';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('every texture kind has 5 variants, a mapping and a plain fallback colour', () => {
  assert.strictEqual(TEXTURE_VARIANTS, 5);
  assert.ok(TEXTURE_KINDS.length >= 10);
  assert.deepStrictEqual([...TEXTURE_KINDS].sort(), Object.keys(RECIPES).sort());
  for (const kind of TEXTURE_KINDS) {
    const recipe = RECIPES[kind];
    assert.strictEqual(recipe.variants.length, TEXTURE_VARIANTS, kind);
    if (recipe.weights) assert.strictEqual(recipe.weights.length, TEXTURE_VARIANTS, kind);
    recipe.variants.forEach((v) => assert.strictEqual(v.colors.length, 4, kind));
    assert.ok(MAPPING[kind].tile > 0, kind);
    for (let i = 0; i < TEXTURE_VARIANTS; i++) assert.ok(fallbackColor(kind, i).isColor, kind);
  }
});

test('pickVariant is reproducible, stays in range, honours weights and allowed lists', () => {
  const sequence = (seed) => {
    const random = mulberry32(seed);
    return Array.from({ length: 50 }, () => pickVariant('bark', random));
  };
  assert.deepStrictEqual(sequence(5), sequence(5));
  assert.notDeepStrictEqual(sequence(5), sequence(6));

  for (const kind of TEXTURE_KINDS) {
    const random = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(kind, random);
      assert.ok(Number.isInteger(v) && v >= 0 && v < TEXTURE_VARIANTS, `${kind}: ${v}`);
    }
  }

  const count = new Array(TEXTURE_VARIANTS).fill(0);
  const random = mulberry32(2);
  for (let i = 0; i < 4000; i++) count[pickVariant('foliage', random)]++;
  assert.ok(count.every((c) => c > 0), 'every variant can be picked');
  assert.ok(count[3] < count[0] * 0.75, 'autumn foliage is rarer than green');

  const source = mulberry32(3);
  let calls = 0;
  const counting = () => { calls++; return source(); };
  const allowed = [0, 1, 2, 4];
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(pickVariant('bark', counting, allowed));
  assert.deepStrictEqual([...seen].sort(), allowed);
  assert.strictEqual(calls, 300, 'a limited pick still draws exactly one random number');

  assert.throws(() => pickVariant('nope'), /Unknown texture kind/);
  assert.throws(() => pickVariant('bark', Math.random, [TEXTURE_VARIANTS]), /variant/);
});

test('pooled materials are shared; without WebGL (Node) they are plain colours', () => {
  const a = pooledMaterial('bark', 2);
  assert.strictEqual(pooledMaterial('bark', 2), a);
  assert.notStrictEqual(pooledMaterial('bark', 3), a);
  assert.notStrictEqual(pooledMaterial('bark', 2, { vertexColors: true }), a);
  assert.strictEqual(a.map, null);
  assert.strictEqual(getTexture('bark', 2), null);
  assert.ok(a.userData.mapping.tile > 0);
  assert.strictEqual(a.side, FrontSide);
  assert.strictEqual(pooledMaterial('leaf', 0).side, DoubleSide);

  const red = pooledMaterial('bark', 2, { color: 0xff0000 });
  assert.notStrictEqual(red, a);
  assert.strictEqual(red.color.getHex(), 0xff0000);
  assert.strictEqual(pooledMaterial('bark', 2, { color: 0xff0000 }), red);

  assert.throws(() => pooledMaterial('nope', 0), /Unknown texture kind/);
  assert.throws(() => pooledMaterial('bark', 5), /variant/);
  assert.throws(() => getTexture('bark', -1), /variant/);
});

test('preloadTextures reports progress and resolves false when nothing can be baked', async () => {
  const seen = [];
  const ready = await preloadTextures({ kinds: ['bark', 'rock'], onProgress: (p, kind) => seen.push([p, kind]) });
  assert.strictEqual(ready, false);
  assert.deepStrictEqual(seen, [[0.5, 'bark'], [1, 'rock']]);
  await assert.rejects(() => preloadTextures({ kinds: ['nope'] }), /Unknown texture kind/);
});

test('models pick their textures from the pool by seed', () => {
  const t = new OakTree({ seed: 5 });
  const picked = t.textureVariants();
  assert.deepStrictEqual(Object.keys(picked).sort(), ['bark', 'foliage']);
  Object.values(picked).forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v < TEXTURE_VARIANTS));
  assert.deepStrictEqual(new OakTree({ seed: 5 }).textureVariants(), picked);

  const bark = new Set(), foliage = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const v = new OakTree({ seed }).textureVariants();
    bark.add(v.bark);
    foliage.add(v.foliage);
  }
  assert.strictEqual(bark.size, TEXTURE_VARIANTS);
  assert.strictEqual(foliage.size, TEXTURE_VARIANTS);

  // trees share the pooled materials instead of creating their own
  const materials = new Set();
  for (let seed = 0; seed < 60; seed++) new OakTree({ seed }).children.forEach((c) => materials.add(c.material));
  assert.ok(materials.size <= 2 * TEXTURE_VARIANTS);
});

test('options.textures pins variants and never changes the shape', () => {
  const base = new PineTree({ seed: 31, complexity: 2 });
  for (const bark of [0, 2, 4]) {
    const t = new PineTree({ seed: 31, complexity: 2, textures: { bark, needles: 1 } });
    assert.deepStrictEqual(t.textureVariants(), { needles: 1, bark });
    assert.deepStrictEqual(t.getBounds(), base.getBounds());
    assert.strictEqual(t.getColliders().length, base.getColliders().length);
  }
  const pinnedBark = new PineTree({ seed: 31, complexity: 2, textures: { bark: 0 } }).textureVariants();
  assert.strictEqual(pinnedBark.needles, base.textureVariants().needles, 'other kinds keep their random pick');

  const bad = new PineTree({ seed: 31, complexity: 2, textures: { bark: 9, needles: 'x' } });
  assert.deepStrictEqual(bad.textureVariants(), base.textureVariants(), 'invalid pins are ignored');
});

test('a pine never gets the white birch bark unless it is pinned', () => {
  const bark = new Set();
  for (let seed = 0; seed < 300; seed++) bark.add(new PineTree({ seed }).textureVariants().bark);
  assert.deepStrictEqual([...bark].sort(), [0, 1, 2, 4]);
  assert.strictEqual(new PineTree({ seed: 1, textures: { bark: 3 } }).textureVariants().bark, 3);
});

// Reference values from before textures existed: stored seeds must keep building the same shapes.
const SHAPES = {
  'PineTree 11 c0': [() => new PineTree({ seed: 11, complexity: 0 }), [-2.4276, -0.0391, -2.4276, 2.4276, 5.1475, 2.4276], 2],
  'PineTree 12 c3': [() => new PineTree({ seed: 12, complexity: 3 }), [-3.3386, -0.0866, -3.3764, 3.3091, 6.5611, 3.2714], 77],
  'OakTree 13 c2': [() => new OakTree({ seed: 13, complexity: 2 }), [-2.0791, -0.1857, -2.2126, 2.0602, 3.9536, 1.9267], 13],
  'OakTree 14 c0': [() => new OakTree({ seed: 14, complexity: 0 }), [-1.9505, -0.061, -1.9505, 1.9505, 4.8848, 1.9505], 2],
  'LeafTree 15 c2': [() => new LeafTree({ seed: 15, complexity: 2 }), [-1.8928, -0.05, -2.1455, 2.3322, 5.4443, 2.0795], 31],
  'Bush 16': [() => new Bush({ seed: 16 }), [-0.7, -0.3, -0.7, 0.7, 1.1, 0.7], 1],
  'Rock 17': [() => new Rock({ seed: 17 }), [-0.7693, -0.1299, -0.7429, 0.7814, 0.7838, 0.6963], 1],
  'House cottage 18': [() => new House({ seed: 18, type: 'cottage' }), [-2.6747, -1.63, -2.6747, 2.6747, 3.8709, 2.6747], 2],
  'House longhouse 19': [() => new House({ seed: 19, type: 'longhouse' }), [-3.3442, -2.255, -3.3442, 3.3442, 4.4334, 3.3442], 2],
  'House towerhouse 20': [() => new House({ seed: 20, type: 'towerhouse' }), [-3.1183, -0.6429, -3.1183, 3.1183, 7.0065, 3.1183], 2],
  'Castle 21 c2': [() => new Castle({ seed: 21, complexity: 2 }), [-13.9376, -3.2618, -11.7606, 14.1058, 7.6016, 8.8803], 34],
  'Wall 22': [() => new Wall({ seed: 22 }), [-2.367, -1.117, -2.367, 2.367, 3.617, 2.367], 1],
  'Roof 23': [() => new Roof({ seed: 23 }), [-3.3257, -2.4257, -3.3257, 3.3257, 4.2257, 3.3257], 1],
  'Column 24': [() => new Column({ seed: 24 }), [-1.5297, -0.0297, -1.5297, 1.5297, 3.0297, 1.5297], 1],
};

test('seeds keep building the same shapes as before textures existed', () => {
  for (const [name, [create, bounds, colliders]] of Object.entries(SHAPES)) {
    const model = create();
    const { min, max } = model.getBounds();
    [...min, ...max].forEach((v, i) => assert.ok(near(v, bounds[i], 2e-4), `${name} bounds[${i}]: ${v} vs ${bounds[i]}`));
    assert.strictEqual(model.getColliders().length, colliders, name);
  }
  const windows = (m) => m.getWindows().length;
  assert.strictEqual(windows(new House({ seed: 18, type: 'cottage' })), 6);
  assert.strictEqual(windows(new House({ seed: 19, type: 'longhouse' })), 6);
  assert.strictEqual(windows(new House({ seed: 20, type: 'towerhouse' })), 7);
  assert.strictEqual(windows(new Castle({ seed: 21, complexity: 2 })), 30);
  assert.strictEqual(new LeafTree({ seed: 15, complexity: 2 }).leaves.length, 80);
});

test('SimpleTree wears the first pooled bark and foliage', () => {
  const t = new SimpleTree();
  assert.strictEqual(t.children[0].material, pooledMaterial('bark', 0, { flatShading: false }));
  assert.strictEqual(t.children[1].material, pooledMaterial('foliage', 0, { flatShading: false }));
});

// A material shaped like a pooled one that has a real texture, as in the browser.
function mapped(uv, { tile = 2, shift = [0, 0] }: any = {}) {
  const mat = new MeshStandardMaterial({ map: new DataTexture(new Uint8Array(4), 1, 1) });
  mat.userData.mapping = { uv, tile, shift, hash: 7 };
  return mat;
}

function build(geometry, mat, opts, seed = 1) {
  const model = new WorldModel('Test', { seed });
  const b = new MergeBuilder();
  b.add(geometry, mat, opts);
  b.build(model);
  return model.children[0].geometry;
}

const range = (values) => Math.max(...values) - Math.min(...values);

test('MergeBuilder projects UVs so a texture keeps its world size, whatever the part size', () => {
  const front = (g) => {
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const u = [], v = [];
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getZ(i) > 0.9) { u.push(uv.getX(i)); v.push(uv.getY(i)); }
    }
    return { u, v };
  };
  const wall = (scale, extra) => front(build(new BoxGeometry(1, 1, 1), mapped('face'), { position: [0, scale[1] / 2, 0], scale, ...extra }));

  const small = wall([4, 3, 0.2]);
  assert.ok(near(range(small.u), 2) && near(range(small.v), 1.5), 'tile 2: a 4 x 3 wall spans 2 x 1.5 repeats');
  const big = wall([8, 3, 0.2]);
  assert.ok(near(range(big.u), 4) && near(range(big.v), 1.5), 'a longer wall repeats more instead of stretching');
  const fine = wall([4, 3, 0.2], { detail: 2 });
  assert.ok(near(range(fine.u), 4) && near(range(fine.v), 3), 'detail 2 halves the pattern size');
});

test('MergeBuilder closes the seam of round parts with whole repeats, and leaves native UVs alone', () => {
  const cylinder = new CylinderGeometry(1, 1, 2, 12);
  const maxU = (g) => Math.max(...Array.from({ length: g.attributes.uv.count }, (_, i) => g.attributes.uv.getX(i)));
  const round = build(cylinder, mapped('cyl', { tile: 1.6 }));
  assert.ok(near(maxU(round), Math.round((2 * Math.PI) / 1.6)), 'whole number of repeats around');
  const native = build(cylinder, mapped('native'));
  assert.ok(near(maxU(native), 1), 'native UVs are untouched');
  const forced = build(cylinder, mapped('face'), { uv: 'cyl' });
  assert.ok(near(maxU(forced), maxU(build(cylinder, mapped('cyl')))), 'a part can override the mapping');
});

test('MergeBuilder drops UVs when there is no texture and shifts them per seed when there is', () => {
  const plain = new MeshStandardMaterial();
  plain.userData.mapping = { uv: 'face', tile: 2, shift: [1, 1], hash: 3 };
  assert.strictEqual(build(new BoxGeometry(1, 1, 1), plain).attributes.uv, undefined);

  const uvAt = (seed) => build(new BoxGeometry(1, 1, 1), mapped('face', { shift: [1, 1] }), {}, seed).attributes.uv.getX(0);
  assert.strictEqual(uvAt(4), uvAt(4), 'same seed, same part of the picture');
  assert.notStrictEqual(uvAt(4), uvAt(5), 'another seed shows another part');
});

test('projectUV keeps absolute world coordinates per triangle', () => {
  const triangle = (points) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(points.flat()), 3));
    return g;
  };
  const floor = projectUV(triangle([[0, 0, 0], [2, 0, 0], [0, 0, 2]]), 'world', 2).attributes.uv;
  assert.deepStrictEqual(Array.from(floor.array), [0, 0, 1, 0, 0, 1]);

  const wall = projectUV(triangle([[0, 0, 0], [4, 0, 0], [0, 3, 0]]), 'face', 2).attributes.uv;
  assert.deepStrictEqual(Array.from(wall.array), [0, 0, 2, 0, 0, 1.5]);
});

test('disposeTextures empties the pool', () => {
  const a = pooledMaterial('stone', 0);
  disposeTextures();
  assert.notStrictEqual(pooledMaterial('stone', 0), a);
});

test('doors and windows wear textures without moving the picks of other kinds', () => {
  const house = new House({ seed: 18, type: 'cottage' });
  const v = house.textureVariants();
  assert.ok('planks' in v && ('glass' in v || 'lamp' in v), JSON.stringify(v));
  const again = new House({ seed: 18, type: 'cottage' }).textureVariants();
  assert.deepStrictEqual(again, v);
  const pinned = new House({ seed: 18, type: 'cottage', textures: { glass: 2, lamp: 4 } }).textureVariants();
  assert.ok(pinned.glass === 2 || pinned.glass === undefined);
});
