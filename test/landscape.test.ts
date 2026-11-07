// @ts-nocheck -- tests poke at untyped internals
import { test } from 'node:test';
import assert from 'node:assert';
import { Mountain, Hill, Cliff, CaveEntrance, Pond, Waterfall, Crystal, IceSpire } from '../src/models/Landscape.ts';

const all = [Mountain, Hill, Cliff, CaveEntrance, Pond, Waterfall, Crystal, IceSpire];
const sig = (m) => JSON.stringify(m.getColliders());
const look = (m) => JSON.stringify(m.children.map((c) => [c.position.toArray(), c.quaternion.toArray(), c.scale.toArray(),
  c.geometry.attributes.position.array.reduce((a, v) => a + v, 0)]));

for (const M of all) {
  test(`${M.name}: builds, has finite colliders, deterministic per seed`, () => {
    const a = new M({ seed: 3 }), b = new M({ seed: 3 }), c = new M({ seed: 4 });
    assert.ok(a.children.length > 0);
    assert.ok(a.getColliders().length > 0);
    const bd = a.getBounds();
    assert.ok(bd.max.every(Number.isFinite) && bd.min.every(Number.isFinite));
    assert.strictEqual(sig(a), sig(b));
    assert.strictEqual(look(a), look(b));
    assert.notStrictEqual(look(a), look(c));
    a.dispose();
  });
}

test('Mountain peaks option sets collider count; size scales', () => {
  assert.strictEqual(new Mountain({ peaks: 4 }).getColliders().length, 4);
  assert.strictEqual(new Mountain({ peaks: 99 }).getColliders().length, 5);
  assert.strictEqual(new Mountain({ height: 20 }).getColliders()[0].height, 20);
  assert.strictEqual(new Mountain({ height: 20, size: 2 }).getColliders()[0].height, 40);
});

test('CaveEntrance leaves the opening free', () => {
  const c = new CaveEntrance({ width: 3, height: 2.5 });
  const tags = c.getColliderTags();
  assert.deepStrictEqual(tags.filter((t) => t === 'wall').length, 2);
  const lintel = c.getColliders()[tags.indexOf('lintel')];
  assert.ok(lintel.position[1] - lintel.size[1] / 2 >= 2.5 - 1e-6);
});

test('Crystal and IceSpire counts, Pond/Waterfall water colliders', () => {
  assert.strictEqual(new IceSpire({ spikes: 3 }).getColliders().length, 3);
  assert.strictEqual(new Crystal({ count: 7, color: 0xff0000 }).crystals.length, 7);
  assert.ok(new Pond().getColliderTags().includes('water'));
  assert.ok(new Waterfall().getColliderTags().includes('water'));
  assert.strictEqual(new Hill().getColliders()[0].type, 'convex');
  assert.strictEqual(new Cliff({ width: 8 }).getColliders()[0].size[0], 8);
});
