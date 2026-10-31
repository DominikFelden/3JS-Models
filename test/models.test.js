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
