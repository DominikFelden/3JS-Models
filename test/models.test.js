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
  const plain = new Castle({ seed: 5 });
  const turned = new Castle({ seed: 5, rotation: Math.PI / 2 });
  const towers = (c) => c.getColliders().filter((_, i) => c.getColliderTags()[i] === 'tower');
  const a = towers(plain), b = towers(turned);
  assert.strictEqual(a.length, 4);
  // A 90deg turn about Y maps (x, z) to (z, -x).
  a.forEach((t, i) => assert.ok(near(b[i].position[0], t.position[2]) && near(b[i].position[2], -t.position[0])));
});

test('Rock exposes convex hull and is deterministic per seed', () => {
  const a = new Rock({ seed: 1 }), b = new Rock({ seed: 1 }), c = new Rock({ seed: 2 });
  assert.strictEqual(a.children[0].geometry, b.children[0].geometry);
  assert.notStrictEqual(a.children[0].geometry, c.children[0].geometry);
  assert.strictEqual(a.getColliders()[0].type, 'convex');
  assert.ok(a.getColliders()[0].points.length >= 4);
});

test('bounds are finite for all models', () => {
  const c = new Castle();
  const b = c.getBounds();
  assert.ok(b.max.every(Number.isFinite) && b.min.every(Number.isFinite));
  assert.ok([new PineTree(), new Bush()].every((m) => m.getColliders().length > 0));
});

import { Quaternion, Vector3 } from 'three';
import { House, HOUSE_TYPES, MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY } from '../src/index.js';

const count = (m, tag) => m.getColliderTags().filter((t) => t === tag).length;
const sig = (m) => JSON.stringify(m.getColliders());

for (const Tree of [PineTree, OakTree]) {
  test(`${Tree.name}: complexity 0 has no branches, higher complexity has more`, () => {
    assert.strictEqual(count(new Tree({ complexity: 0 }), 'branch'), 0);
    let prev = 0;
    for (let c = 1; c <= 3; c++) {
      const n = count(new Tree({ complexity: c, seed: 1 }), 'branch');
      assert.ok(n > 0, `complexity ${c} has branches`);
      assert.ok(n >= prev, 'branch count never decreases with complexity');
      prev = n;
    }
    // Sub-branches: at complexity 3 there are many more branches than the first generation.
    assert.ok(count(new Tree({ complexity: 3, seed: 1 }), 'branch') > count(new Tree({ complexity: 1, seed: 1 }), 'branch') * 2);
  });

  test(`${Tree.name}: two trees with complexity 5 differ, same seed is identical`, () => {
    assert.notStrictEqual(sig(new Tree({ complexity: 5 })), sig(new Tree({ complexity: 5 })));
    assert.strictEqual(sig(new Tree({ complexity: 5, seed: 42 })), sig(new Tree({ complexity: 5, seed: 42 })));
    assert.notStrictEqual(sig(new Tree({ complexity: 5, seed: 1 })), sig(new Tree({ complexity: 5, seed: 2 })));
  });

  test(`${Tree.name}: branched trees use few draw calls and clamp complexity`, () => {
    const t = new Tree({ complexity: 99 });
    assert.strictEqual(t.complexity, MAX_TREE_COMPLEXITY);
    assert.ok(t.children.length <= 4, 'merged into a few meshes');
    assert.strictEqual(new Tree({ complexity: -3 }).complexity, 0);
    assert.strictEqual(new Tree({ complexity: 'x' }).complexity, 0);
  });
}

test('branch colliders are cylinders in world space and follow size/position', () => {
  const t = new OakTree({ complexity: 2, seed: 5, position: [10, 0, 0], size: 2 });
  const tags = t.getColliderTags();
  const cols = t.getColliders();
  assert.strictEqual(tags.length, cols.length);
  cols.forEach((c, i) => {
    if (tags[i] !== 'branch') return;
    assert.strictEqual(c.type, 'cylinder');
    assert.ok(c.radius > 0 && c.height > 0);
    assert.ok(c.position[0] > 5 && c.position[0] < 15);
    assert.strictEqual(c.quaternion.length, 4);
  });
});

test('Castle complexity increases towers and walls; 0 is keep only', () => {
  const kinds = (c) => { const m = new Castle({ complexity: c, seed: 3 }); return { t: count(m, 'tower'), w: count(m, 'wall'), m }; };
  const r = [0, 1, 2, 3, 5].map(kinds);
  assert.strictEqual(r[0].t, 0);
  assert.strictEqual(r[0].w, 0);
  assert.strictEqual(r[1].t, 4);
  for (let i = 2; i < r.length; i++) {
    assert.ok(r[i].t > r[i - 1].t, `towers grow at step ${i}`);
    assert.ok(r[i].w > r[i - 1].w, `walls grow at step ${i}`);
  }
  assert.ok(count(r[4].m, 'hall') > 0);
});

test('Castle: two castles with complexity 5 differ, same seed identical', () => {
  assert.notStrictEqual(sig(new Castle({ complexity: 5 })), sig(new Castle({ complexity: 5 })));
  assert.strictEqual(sig(new Castle({ complexity: 5, seed: 9 })), sig(new Castle({ complexity: 5, seed: 9 })));
  assert.strictEqual(new Castle({ complexity: 50 }).complexity, MAX_CASTLE_COMPLEXITY);
});

test('Castle and houses have windows facing outwards', () => {
  const objs = [new Castle({ complexity: 3 }), ...HOUSE_TYPES.map((type) => new House({ type }))];
  for (const m of objs) {
    const w = m.getWindows();
    assert.ok(w.length > 0, `${m.name} has windows`);
    for (const win of w) {
      assert.ok(Math.abs(Math.hypot(...win.normal) - 1) < 1e-6);
      assert.ok(win.width > 0 && win.height > 0);
    }
  }
  // Window normals rotate with the model (yaw 90deg turns +Z into +X).
  const front = new House({ seed: 1 }).getWindows().find((w) => near(w.normal[2], 1));
  const turned = new House({ seed: 1, rotation: Math.PI / 2 }).getWindows().find((w) => near(w.normal[0], 1) && near(w.position[1], front.position[1]));
  assert.ok(front && turned);
});

test('Houses: each type has body + roof colliders; unknown type falls back', () => {
  for (const type of HOUSE_TYPES) {
    const h = new House({ type, size: 2 });
    assert.deepStrictEqual(h.getColliderTags(), ['body', 'roof']);
    assert.strictEqual(h.type, type);
    assert.ok(h.getColliders()[1].points.length >= 5);
  }
  assert.strictEqual(new House({ type: 'nope' }).type, 'cottage');
  assert.notStrictEqual(sig(new House()), sig(new House()));
});

test('dispose frees owned (merged) geometries only', () => {
  const t = new OakTree({ complexity: 2 });
  let disposed = 0;
  t._ownedGeometries.forEach((g) => g.addEventListener('dispose', () => disposed++));
  const n = t._ownedGeometries.length;
  assert.ok(n >= 1);
  t.dispose();
  assert.strictEqual(disposed, n);
  assert.strictEqual(t._ownedGeometries.length, 0);
});

test('Rock: default rocks vary, shapes are bounded and shared, seed reproduces', () => {
  const geos = new Set();
  const shapes = new Set();
  for (let i = 0; i < 300; i++) {
    const r = new Rock();
    geos.add(r.children[0].geometry);
    shapes.add(sig(r));
  }
  assert.ok(shapes.size > 10, 'default rocks differ');
  assert.ok(geos.size <= 64, 'geometry cache is bounded');
  const a = new Rock();
  assert.strictEqual(sig(new Rock({ seed: a.seed })), sig(a));
});

test('Castle halls never overlap towers or the keep and keep the gate path free', () => {
  // Boxes are axis-aligned here (no rotation), so a simple interval test is exact.
  const rect = (c) => ({ top: c.position[1] + c.size[1] / 2, x0: c.position[0] - c.size[0] / 2, x1: c.position[0] + c.size[0] / 2, z0: c.position[2] - c.size[2] / 2, z1: c.position[2] + c.size[2] / 2 });
  for (let n = 0; n < 150; n++) {
    const m = new Castle({ complexity: 5 });
    const cols = m.getColliders(), tags = m.getColliderTags();
    const halls = cols.filter((_, i) => tags[i] === 'hall').map(rect);
    const keep = rect(cols[tags.indexOf('keep')]);
    const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
    assert.strictEqual(halls.length, 4);
    for (const h of halls) {
      assert.ok(!overlap(h, keep), 'hall touches keep');
      assert.ok(h.x0 > 1 || h.x1 < -1, 'hall blocks the gate path');
      cols.forEach((c, i) => {
        if (tags[i] !== 'tower') return;
        if (c.position[1] - c.height / 2 >= h.top) return; // keep turrets stand far above the halls
        const r = c.radius;
        const nx = Math.max(h.x0, Math.min(c.position[0], h.x1)), nz = Math.max(h.z0, Math.min(c.position[2], h.z1));
        assert.ok(Math.hypot(nx - c.position[0], nz - c.position[2]) > r, 'hall touches a tower');
      });
    }
  }
});

test('Castle gates stay open: nothing blocks the corridor through both gates', () => {
  // Sample points along the gate corridor (x in [-0.9, 0.9]) at the ring lines z = 6 and z = 10.
  const inside = (c, tag, px, pz) => {
    const dx = px - c.position[0], dz = pz - c.position[2];
    if (tag === 'tower') return Math.hypot(dx, dz) < c.radius;
    // Boxes are only rotated about Y: recover the yaw from the quaternion and undo it.
    const yaw = 2 * Math.atan2(c.quaternion[1], c.quaternion[3]);
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) < c.size[0] / 2 && Math.abs(lz) < c.size[2] / 2;
  };
  for (let n = 0; n < 100; n++) {
    const complexity = 1 + (n % 5);
    const m = new Castle({ complexity });
    const cols = m.getColliders(), tags = m.getColliderTags();
    const zs = complexity >= 3 ? [6, 10] : [6];
    for (const z of zs) for (const x of [-0.9, -0.4, 0, 0.4, 0.9]) {
      cols.forEach((c, i) => {
        if (!['wall', 'tower', 'hall', 'keep'].includes(tags[i])) return;
        assert.ok(!inside(c, tags[i], x, z), `complexity ${complexity}: ${tags[i]} blocks gate at (${x}, ${z})`);
      });
    }
    // The yaw recovery must agree with the wall box: a point on a wall centre is inside it.
    const wi = tags.indexOf('wall');
    assert.ok(inside(cols[wi], 'wall', cols[wi].position[0], cols[wi].position[2]));
  }
});

test('Branched trees keep the documented collider order: trunk, crown, branches', () => {
  for (const Tree of [PineTree, OakTree]) {
    for (const c of [0, 1, 4]) {
      const tags = new Tree({ complexity: c }).getColliderTags();
      assert.deepStrictEqual(tags.slice(0, 2), ['trunk', 'crown']);
      assert.ok(tags.slice(2).every((t) => t === 'branch'));
    }
  }
});

test('Every window sits on a wall surface, with its normal pointing away from the solid', () => {
  // Point-in-collider test for boxes and cylinders (any orientation).
  const contains = (c, p) => {
    const d = new Vector3(...p).sub(new Vector3(...c.position));
    d.applyQuaternion(new Quaternion(...c.quaternion).invert());
    if (c.type === 'cylinder') return Math.hypot(d.x, d.z) < c.radius && Math.abs(d.y) < c.height / 2;
    return Math.abs(d.x) < c.size[0] / 2 && Math.abs(d.y) < c.size[1] / 2 && Math.abs(d.z) < c.size[2] / 2;
  };
  const solid = (m) => {
    const cols = m.getColliders(), tags = m.getColliderTags();
    return cols.filter((_, i) => ['body', 'keep', 'hall', 'tower'].includes(tags[i]));
  };
  const models = [];
  for (const type of HOUSE_TYPES) models.push(new House({ type, size: 1.5, rotation: 0.7, position: [3, 0, -2] }));
  for (const c of [0, 2, 5]) models.push(new Castle({ complexity: c, size: 1.5, rotation: -1.1 }));
  for (const m of models) {
    const walls = solid(m);
    for (const w of m.getWindows()) {
      const at = (k) => w.position.map((v, i) => v + w.normal[i] * k);
      assert.ok(walls.some((c) => contains(c, at(-0.02))), `${m.name}: window not on a wall`);
      assert.ok(!walls.some((c) => contains(c, at(0.05))), `${m.name}: window normal points into a wall`);
    }
  }
});

test('Castle ground-level towers never overlap each other', () => {
  for (let n = 0; n < 200; n++) {
    const m = new Castle({ complexity: n % 6 });
    const cols = m.getColliders(), tags = m.getColliderTags();
    // Ground-level towers only: keep turrets stand on the keep roof level.
    const towers = cols.filter((c, i) => tags[i] === 'tower' && c.position[1] - c.height / 2 < 0.01);
    for (let i = 0; i < towers.length; i++) for (let j = i + 1; j < towers.length; j++) {
      const d = Math.hypot(towers[i].position[0] - towers[j].position[0], towers[i].position[2] - towers[j].position[2]);
      assert.ok(d >= towers[i].radius + towers[j].radius, `towers overlap (complexity ${n % 6})`);
    }
  }
});
