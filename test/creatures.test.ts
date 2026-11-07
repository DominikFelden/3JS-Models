// @ts-nocheck -- tests poke at untyped internals
import { test } from 'node:test';
import assert from 'node:assert';
import { Villager, Knight, Wizard, Horse, Dragon, Slime, Skeleton, Wolf } from '../src/models/Creatures.ts';

const ALL = { Villager, Knight, Wizard, Horse, Dragon, Slime, Skeleton, Wolf };

for (const [name, C] of Object.entries(ALL)) {
  test(`${name}: builds with colliders and limbs`, () => {
    const c = new C({ seed: 3, position: [2, 0, 1], size: 2 });
    assert.strictEqual(c.name, name);
    assert.ok(c.getColliders().length >= 1);
    assert.ok(Object.keys(c.limbs).length >= 1);
    assert.ok(c.children.length < 80);
    for (const s of c.getColliders()) s.position.forEach((v) => assert.ok(Number.isFinite(v)));
  });

  test(`${name}: seed determinism`, () => {
    const a = new C({ seed: 9 }), b = new C({ seed: 9 });
    assert.deepStrictEqual(a.getColliders(), b.getColliders());
    assert.strictEqual(a.children.length, b.children.length);
  });

  test(`${name}: poses and animate`, () => {
    const c = new C({ seed: 1 });
    for (const p of Object.keys(c.poses)) c.setPose(p);
    c.setPose('nonsense');
    assert.strictEqual(c.currentPose, 'idle');
    c.animate(0.3);
    c.setPose('idle');
    const n = Object.keys(c.limbs)[0];
    const rest = c.limbs[n].rotation.toArray().slice(0, 3);
    c.animate(0.4, 1, 1);
    c.setPose('idle');
    assert.deepStrictEqual(c.limbs[n].rotation.toArray().slice(0, 3), rest);
  });
}

test('pose option and custom pose object', () => {
  const k = new Knight({ seed: 1, pose: 'attack' });
  assert.ok(k.limbs.armR.rotation.x < -2);
  k.setPose({ head: [0.5, 0, 0] });
  assert.strictEqual(k.limbs.head.rotation.x, 0.5);
  assert.strictEqual(k.limbs.armR.rotation.x, 0);
});

test('walk cycle swings legs', () => {
  const v = new Villager({ seed: 2 });
  v.animate(0.25);
  assert.ok(Math.abs(v.limbs.legL.rotation.x) > 0.1);
});

test('slime squash scales body; dragon wings flap; tint option', () => {
  const s = new Slime({ seed: 1, pose: 'squash' });
  assert.ok(s.limbs.body.scale.y < 1);
  const d = new Dragon({ seed: 1 });
  const z = d.limbs.wingL.rotation.z;
  d.animate(0.25);
  assert.notStrictEqual(d.limbs.wingL.rotation.z, z);
  assert.strictEqual(new Dragon({ wings: false }).limbs.wingL, undefined);
  assert.ok(new Horse({ tint: 0xff0000, saddle: true }).children.length > 0);
  assert.ok(new Skeleton({ armed: false }).getColliders().length === 1);
});

test('geometries are shared between instances', () => {
  const a = new Wolf({ seed: 1 }), b = new Wolf({ seed: 2 });
  const g = (m) => m.children.find((c) => c.isMesh).geometry;
  assert.strictEqual(g(a), g(b));
});
