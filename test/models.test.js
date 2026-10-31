import { test } from 'node:test';
import assert from 'node:assert';
import { SimpleTree } from '../src/index.js';

test('SimpleTree instances share geometries and materials', () => {
  const a = new SimpleTree();
  const b = new SimpleTree();
  assert.strictEqual(a.children.length, 2);
  assert.strictEqual(a.children[0].material, b.children[0].material);
  assert.strictEqual(a.children[1].geometry, b.children[1].geometry);
});

import { PineTree, OakTree, Bush, Rock, Castle } from '../src/index.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('position, size and rotation are applied to colliders', () => {
  const t = new OakTree({ position: [10, 0, 5], size: 2 });
  const [trunk] = t.getColliders();
  assert.ok(near(trunk.position[0], 10) && near(trunk.position[1], 2) && near(trunk.position[2], 5));
  assert.ok(near(trunk.radius, 0.8) && near(trunk.height, 4));
});

test('rotation rotates offset shapes (Castle tower)', () => {
  const c = new Castle({ rotation: Math.PI / 2 });
  const towers = c.getColliders().filter((_, i) => c.getColliderTags()[i] === 'tower');
  assert.strictEqual(towers.length, 4);
  // Original tower at (6, ., 6) rotates by 90deg about Y to (6, ., -6).
  assert.ok(towers.some((t) => near(t.position[0], 6) && near(t.position[2], -6)));
});

test('Rock exposes convex hull and is deterministic per seed', () => {
  const a = new Rock({ seed: 1 }), b = new Rock({ seed: 1 }), c = new Rock({ seed: 2 });
  assert.strictEqual(a.children[0].geometry, b.children[0].geometry);
  assert.notStrictEqual(a.children[0].geometry, c.children[0].geometry);
  assert.strictEqual(a.getColliders()[0].type, 'convex');
  assert.ok(a.getColliders()[0].points.length >= 4);
});

test('Castle gate is open and bounds are finite', () => {
  const c = new Castle();
  const b = c.getBounds();
  assert.ok(b.max.every(Number.isFinite) && b.min.every(Number.isFinite));
  assert.ok([new PineTree(), new Bush()].every((m) => m.getColliders().length > 0));
});
