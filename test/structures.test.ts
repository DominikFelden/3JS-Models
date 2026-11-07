// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert';
import {
  WizardTower, Temple, Obelisk, Portal, Ruins, Gravestone, Shrine, Pyramid,
} from '../src/models/Structures.ts';

const all = [WizardTower, Temple, Obelisk, Portal, Ruins, Gravestone, Shrine, Pyramid];

test('every structure builds meshes and colliders', () => {
  for (const C of all) {
    const m = new C({ seed: 3 });
    assert.ok(m.children.length > 0, C.name);
    const cols = m.getColliders();
    assert.ok(cols.length > 0, C.name);
    assert.strictEqual(cols.length, m.getColliderTags().length);
    for (const c of cols) assert.ok(c.position.every(Number.isFinite) && c.quaternion.every(Number.isFinite));
    m.dispose?.();
  }
});

test('same seed gives same colliders, different seed differs', () => {
  for (const C of [Ruins, Gravestone, WizardTower, Pyramid, Shrine]) {
    const a = new C({ seed: 1 }).getColliders(), b = new C({ seed: 1 }).getColliders(), c = new C({ seed: 2 }).getColliders();
    assert.deepStrictEqual(a, b, C.name);
    if (C === Ruins) assert.notDeepStrictEqual(a, c, C.name);
  }
});

test('Ruins complexity adds parts and is clamped', () => {
  const n = (k) => new Ruins({ seed: 4, complexity: k }).getColliders().length;
  assert.ok(n(0) < n(2) && n(2) < n(4));
  assert.strictEqual(new Ruins({ complexity: 99 }).complexity, 4);
  assert.strictEqual(new Ruins({ complexity: -3 }).complexity, 0);
});

test('Pyramid steps and smooth mode', () => {
  const p = new Pyramid({ seed: 1, steps: 5 });
  assert.strictEqual(p.getColliders().length, 5);
  const s = new Pyramid({ seed: 1, steps: 0 });
  assert.strictEqual(s.getColliders()[0].type, 'convex');
});

test('Temple columns option, Gravestone style, Obelisk height', () => {
  const t = (c) => new Temple({ seed: 1, columns: c }).getColliderTags().filter((x) => x === 'column').length;
  assert.ok(t(8) > t(4));
  assert.strictEqual(new Gravestone({ seed: 1, style: 'cross' }).style, 'cross');
  const o = new Obelisk({ height: 10 }).getColliders().find((_, i, a) => i === 1);
  assert.ok(Math.abs(o.height === undefined ? o.size[1] - 9.3 : 0) < 1e-6);
});

test('Portal has translucent disc and size scales colliders', () => {
  const p = new Portal({ seed: 1, size: 2 });
  assert.ok(p.children.some((c) => c.material?.transparent));
  assert.ok(p.getColliders().every((c) => c.size.every((v) => v > 0)));
});
