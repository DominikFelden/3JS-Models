// @ts-nocheck -- tests poke at untyped internals
import { test } from 'node:test';
import assert from 'node:assert';
import {
  Mushroom, GiantMushroom, Cactus, PalmTree, Stump, Log, Reeds, Pumpkin, Rowboat, Ship,
} from '../src/models/Flora.ts';

const all = [Mushroom, GiantMushroom, Cactus, PalmTree, Stump, Log, Reeds, Pumpkin, Rowboat, Ship];

test('flora models build, have colliders and finite bounds', () => {
  for (const C of all) {
    const m = new C({ seed: 3 });
    assert.ok(m.children.length > 0, C.name);
    assert.ok(m.getColliders().length > 0, C.name);
    const b = m.getBounds();
    assert.ok(b.max.every(Number.isFinite) && b.min.every(Number.isFinite), C.name);
    assert.ok(m.getColliders().every((c) => Object.values(c).flat().every((v) => typeof v !== 'number' || Number.isFinite(v))), C.name);
    m.dispose();
  }
});

test('flora models are deterministic per seed', () => {
  for (const C of all) {
    const a = new C({ seed: 9 }), b = new C({ seed: 9 });
    assert.deepStrictEqual(a.getColliders(), b.getColliders(), C.name);
    assert.strictEqual(a.children.length, b.children.length, C.name);
  }
});

test('Cactus arms option adds arm colliders', () => {
  const tags = (n) => new Cactus({ seed: 1, arms: n }).getColliderTags().filter((t) => t === 'arm').length;
  assert.strictEqual(tags(0), 0);
  assert.strictEqual(tags(3), 3);
  assert.strictEqual(tags(99), 4);
});

test('Ship masts option and size scaling', () => {
  const tags = (n) => new Ship({ seed: 1, masts: n }).getColliderTags().filter((t) => t === 'mast').length;
  assert.strictEqual(tags(1), 1);
  assert.strictEqual(tags(3), 3);
  const s = new Ship({ seed: 1, size: 2, length: 10 });
  assert.ok(Math.abs(s.getColliders()[0].size[0] - 14) < 1e-6);
});

test('Log lies along X and is centred; Stump and GiantMushroom respect options', () => {
  const l = new Log({ seed: 1, length: 3, radius: 0.3 }).getBounds();
  assert.ok(Math.abs(l.min[0] + 1.5) < 0.1 && Math.abs(l.max[0] - 1.5) < 0.1);
  assert.strictEqual(new Stump({ seed: 1, radius: 0.6 }).getColliders()[0].radius, 0.6);
  assert.strictEqual(new GiantMushroom({ seed: 1, height: 5 }).getColliders()[0].height, 5);
  assert.strictEqual(new GiantMushroom({ seed: 1 }).getColliderTags().join(), 'stalk,cap');
});
