// @ts-nocheck -- tests poke at untyped internals
import { test } from 'node:test';
import assert from 'node:assert';
import { Well, Windmill, Watchtower, Bridge, Fence, Signpost, MarketStall, Tent, Mine } from '../src/models/Settlement.ts';

const ALL = { Well, Windmill, Watchtower, Bridge, Fence, Signpost, MarketStall, Tent, Mine };
const sig = (m) => JSON.stringify(m.getColliders());

for (const [name, Cls] of Object.entries(ALL)) {
  test(`${name}: deterministic, seeded, has colliders and finite bounds`, () => {
    const a = new Cls({ seed: 7 }), b = new Cls({ seed: 7 });
    assert.strictEqual(a.seed, 7);
    assert.strictEqual(a.name, name);
    assert.strictEqual(sig(a), sig(b));
    assert.ok(a.getColliders().length > 0);
    assert.ok(a.children.length > 0);
    const bd = a.getBounds();
    assert.ok(bd.max.every(Number.isFinite) && bd.min.every(Number.isFinite));
    a.dispose(); b.dispose();
  });
  test(`${name}: seeds vary and position/size apply`, () => {
    const look = (m) => JSON.stringify(m.getColliders()) + m.children.map((c) => c.geometry?.attributes.color?.array.reduce((a, v) => a + v, 0)).join();
    const sigs = new Set([1, 2, 3, 4, 5].map((s) => look(new Cls({ seed: s }))));
    assert.ok(sigs.size > 1);
    const m = new Cls({ seed: 1, position: [10, 0, 5], size: 2 });
    assert.strictEqual(m.position.x, 10);
    assert.strictEqual(m.scale.x, 2);
  });
}

test('Windmill sails rotate via setSailAngle / animate', () => {
  const m = new Windmill({ seed: 3, sails: 6 });
  assert.strictEqual(m.sailCount, 6);
  assert.ok(m.sails.children.length > 0 && m.sails.parent === m);
  m.setSailAngle(1);
  assert.strictEqual(m.sails.rotation.z, 1);
  m.animate(0.5, 2);
  assert.ok(Math.abs(m.sails.rotation.z - 2) < 1e-9);
});

test('Bridge length, Fence styles, Well roof, Mine frame', () => {
  const br = new Bridge({ seed: 1, length: 12, width: 3 });
  assert.ok(br.getBounds().max[2] - br.getBounds().min[2] >= 12);
  assert.ok(br.getColliderTags().includes('deck'));
  for (const style of ['picket', 'rail', 'stone']) {
    const f = new Fence({ seed: 1, style, length: 4 });
    assert.strictEqual(f.style, style);
    assert.strictEqual(f.getColliderTags().filter((t) => t === 'fence').length, 1);
  }
  assert.ok(new Well({ seed: 1 }).getColliderTags().includes('post'));
  assert.ok(!new Well({ seed: 1, roofed: false }).getColliderTags().includes('post'));
  assert.ok(new Mine({ seed: 1 }).getColliderTags().includes('lintel'));
  assert.ok(new Watchtower({ seed: 1, stone: true }).getColliderTags().includes('shaft'));
});

test('Tent styles and options are honoured', () => {
  assert.strictEqual(new Tent({ seed: 1, style: 'round' }).style, 'round');
  assert.strictEqual(new Tent({ seed: 1, style: 'ridge' }).style, 'ridge');
  assert.strictEqual(new Signpost({ seed: 1, boards: 9 }).children.length > 0, true);
  assert.ok(new MarketStall({ seed: 1, awningColor: 0xff0000 }).getColliderTags().includes('awning'));
});
