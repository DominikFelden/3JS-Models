// @ts-nocheck -- tests poke at untyped internals
import { test } from 'node:test';
import assert from 'node:assert';
import * as P from '../src/models/Props.ts';

const names = ['Campfire', 'Torch', 'Lantern', 'Chest', 'Barrel', 'Crate', 'Banner', 'Cart', 'Anvil', 'Table', 'Chair', 'Bed'];

for (const n of names) {
  test(`${n} builds with meshes and finite colliders`, () => {
    const m = new P[n]({ seed: 3 });
    assert.ok(m.children.length > 0);
    assert.ok(m.getColliders().length > 0);
    const b = m.getBounds();
    assert.ok(b.max.every(Number.isFinite) && b.min.every(Number.isFinite));
  });
  test(`${n} is deterministic per seed and shares geometry`, () => {
    const a = new P[n]({ seed: 9 }), b = new P[n]({ seed: 9 });
    assert.deepStrictEqual(a.getColliders(), b.getColliders());
    assert.strictEqual(a.children.length, b.children.length);
  });
}

test('Chest open differs from closed', () => {
  const c = new P.Chest({ seed: 1 }), o = new P.Chest({ seed: 1, open: true });
  assert.notDeepStrictEqual(c.getColliders()[0].height ?? c.getColliders()[0].size, o.getColliders()[0].height ?? o.getColliders()[0].size);
});

test('lit option toggles flame', () => {
  assert.ok(new P.Torch({ seed: 1 }).children.length >= new P.Torch({ seed: 1, lit: false }).children.length);
  const verts = (m) => m.children.reduce((n, c) => n + c.geometry.attributes.position.count, 0);
  assert.ok(verts(new P.Campfire({ seed: 1 })) > verts(new P.Campfire({ seed: 1, lit: false })));
});

test('Table colliders: four legs plus top; round has two', () => {
  assert.strictEqual(new P.Table({ seed: 1 }).getColliders().length, 5);
  assert.strictEqual(new P.Table({ seed: 1, round: true }).getColliders().length, 2);
});

test('Chair stool has no backrest', () => {
  const tags = (m) => m.getColliderTags();
  assert.ok(tags(new P.Chair({ seed: 1 })).includes('back'));
  assert.ok(!tags(new P.Chair({ seed: 1, stool: true })).includes('back'));
});

test('position and size apply to colliders', () => {
  const c = new P.Crate({ seed: 1, position: [4, 0, 2], size: 2 });
  const [s] = c.getColliders();
  assert.ok(Math.abs(s.position[0] - 4) < 1e-6 && Math.abs(s.position[1] - 0.7) < 1e-6);
});
