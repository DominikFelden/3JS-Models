// @ts-nocheck -- tests poke at untyped internals and three.js object subtypes
import { test } from 'node:test';
import assert from 'node:assert';
import { SimpleTree } from '../src/index.ts';

test('SimpleTree instances share geometries and materials', () => {
  const a = new SimpleTree();
  const b = new SimpleTree();
  assert.strictEqual(a.children.length, 2);
  assert.strictEqual(a.children[0].material, b.children[0].material);
  assert.strictEqual(a.children[1].geometry, b.children[1].geometry);
});

import { PineTree, OakTree, Bush, Rock, Castle } from '../src/index.ts';

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('position, size and rotation are applied to colliders', () => {
  const t = new OakTree({ position: [10, 0, 5], size: 2 });
  const [trunk] = t.getColliders();
  assert.ok(near(trunk.position[0], 10) && near(trunk.position[1], 2 * t.th) && near(trunk.position[2], 5));
  assert.ok(near(trunk.radius, 0.8 * t.tw) && near(trunk.height, 4 * t.th));
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
import { House, HOUSE_TYPES, MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY } from '../src/index.ts';

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

test('Seeds change models substantially: tree height, castle layout, house walls', () => {
  const heights = new Set(), layouts = new Set(), walls = new Set(), balconies = new Set();
  for (let seed = 0; seed < 40; seed++) {
    heights.add(new PineTree({ seed, complexity: 2 }).getBounds().max[1].toFixed(1));
    heights.add(new OakTree({ seed }).getBounds().max[1].toFixed(1));
    const cb = new Castle({ seed, complexity: 3 }).getBounds();
    layouts.add(`${cb.min[0].toFixed(0)}:${cb.max[1].toFixed(0)}`);
    const h = new House({ seed, type: 'towerhouse' });
    walls.add(h.children[0].material);
    balconies.add(h.children.length);
  }
  assert.ok(heights.size > 20, 'tree heights vary');
  assert.ok(layouts.size > 8, 'castle layouts vary');
  assert.ok(walls.size > 8, 'wall textures vary');
});

import { LeafTree, LEAF_TYPES } from '../src/index.ts';

test('LeafTree builds leaves that hang and face up/outward', () => {
  const t = new LeafTree({ seed: 3 });
  assert.ok(t.leaves.length > 100);
  assert.ok(Object.values(LEAF_TYPES).includes(t.leafClass));
  assert.strictEqual(t.getColliderTags()[1], 'crown');
  t.leaves.forEach((l) => {
    assert.ok(l.direction.y < 0);
    const n = new Vector3(0, 1, 0).applyQuaternion(l.quaternion);
    assert.ok(n.y > -0.2); // upper face stays turned to the sky
  });
  const a = new LeafTree({ seed: 3 });
  assert.strictEqual(a.leaves.length, t.leaves.length);
});

import { models } from '../src/registry.ts';

test('registry is sorted alphabetically and every model builds with a collider and finite bounds', () => {
  const names = models.map((m) => m.name);
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })));
  for (const m of models.filter((x) => x.name !== 'SimpleTree')) {
    const model = m.create({ complexity: 1 });
    assert.ok(model.getColliders().length > 0, m.name);
    const { min, max } = model.getBounds();
    assert.ok([...min, ...max].every(Number.isFinite), m.name);
  }
});

test('Tree options: trunk size, leaf size, leaf type, colours and complexity 20', async () => {
  assert.strictEqual(MAX_TREE_COMPLEXITY, 20);
  assert.ok(Object.keys(LEAF_TYPES).length >= 5);
  for (const Tree of [PineTree, OakTree, LeafTree]) {
    const base = new Tree({ seed: 9, complexity: 2 }).getBounds().max[1];
    const tall = new Tree({ seed: 9, complexity: 2, trunkHeight: 2 }).getBounds().max[1];
    assert.ok(tall > base, `${Tree.name} trunkHeight`);
    const thick = new Tree({ seed: 9, complexity: 2, trunkThickness: 2 }).getColliders()[0];
    assert.ok(thick.radius > new Tree({ seed: 9, complexity: 2 }).getColliders()[0].radius * 1.5, `${Tree.name} thickness`);
    const t = new Tree({ complexity: 20 });
    assert.strictEqual(t.complexity, 20);
    const colliders = t.getColliders().length;
    assert.ok(colliders > 10 && colliders < 400, `${Tree.name} colliders capped to first generations`);
  }
  const a = new LeafTree({ seed: 4, leafType: 'maple', leafColor: '#ff0000', trunkColor: 0x112233, leafSize: 2 });
  assert.strictEqual(a.leafClass, LEAF_TYPES.maple);
  for (const [k, Kind] of Object.entries(LEAF_TYPES)) {
    const g = Kind.geometry();
    assert.ok(g.attributes.position.count >= 3, k);
  }
  assert.ok(new LeafTree({ seed: 4, leafSize: 2 }).leaves[0].length > new LeafTree({ seed: 4 }).leaves[0].length * 1.5);
});

import { Forest } from '../src/index.ts';
import { PerspectiveCamera } from 'three';

test('Forest instances few variants, picks levels by distance and culls', () => {
  const f = new Forest({ seed: 5, count: 800, area: 200, variants: 4 });
  assert.strictEqual(f.getPlacements().length, 800);
  assert.deepStrictEqual(new Forest({ seed: 5, count: 800, area: 200, variants: 4 }).getPlacements(), f.getPlacements());
  const cam = new PerspectiveCamera(50, 1.5, 0.1, 1000);
  cam.position.set(0, 5, 20);
  cam.lookAt(0, 3, 0);
  f.update(cam);
  const { visible, levels, drawCalls, triangles, impostors } = f.stats;
  assert.ok(visible > 0 && visible < 800, 'frustum culling');
  const drawn = levels.reduce((a, b) => a + b, 0);
  assert.ok(drawn >= visible && drawn < visible * 1.5, 'a tree is in two levels only inside a fade band');
  assert.ok(levels.every((n) => n > 0), 'all levels used');
  assert.ok(impostors > 0, 'farther trees are impostors');
  assert.ok(drawCalls <= 4 * 3 * 2 + 2);
  f.lod = false;
  f.invalidate();
  f.update(cam);
  assert.strictEqual(f.stats.visible, visible);
  assert.ok(f.stats.triangles > triangles, 'LOD saves triangles');
  assert.ok(f.getColliders().length === 1);
  f.dispose();
});

test('Forest tiers: 3D levels, impostors, canopy, maxDistance', () => {
  const f = new Forest({ seed: 2, count: 600, area: 300, variants: 3 });
  const R = f.ranges();
  assert.deepStrictEqual(R.levels, [[null, 12], [12, 25]]);
  assert.deepStrictEqual(R.impostors, [25, 600]);
  assert.deepStrictEqual(R.canopy, [600, Infinity]);
  const cam = new PerspectiveCamera(50, 1.5, 0.1, 5000);

  // Every tree in the view is drawn by the tier its distance falls in (a brute-force check).
  cam.position.set(-20, 8, 140);
  cam.lookAt(0, 0, 0);
  f.update(cam);
  const all = f.getPlacements().map((t) => Math.hypot(t.x - cam.position.x, t.y - cam.position.y, t.z - cam.position.z));
  const band = (d, lo, hi) => d >= lo * (1 - f.fade / 2) && d < hi * (1 + f.fade / 2);
  assert.ok(f.stats.impostors > 0 && f.stats.visible > 0);
  assert.ok(f.stats.impostors <= all.filter((d) => band(d, 25, 600)).length);
  assert.ok(f.stats.visible <= all.filter((d) => d < 25 * (1 + f.fade / 2)).length);
  assert.strictEqual(f.impostorMesh.geometry.instanceCount ?? f.impostorMesh.geometry.attributes.iPos.count, 600);

  // High above: everything is far, so only the canopy is drawn (one draw call).
  cam.position.set(0, 1000, 0);
  cam.lookAt(0, 0, -50);
  f.update(cam);
  assert.strictEqual(f.stats.visible, 0);
  assert.strictEqual(f.stats.impostors, 0);
  assert.strictEqual(f.stats.canopy, true);
  assert.strictEqual(f.stats.drawCalls, 1);

  // Without impostors the 3D trees reach the canopy; without the canopy nothing is drawn beyond maxDistance.
  const g = new Forest({ seed: 2, count: 600, area: 300, variants: 3, impostors: false, canopy: false, maxDistance: 120 });
  assert.deepStrictEqual(g.ranges().levels.at(-1), [12, 120]);
  assert.strictEqual(g.ranges().canopy, null);
  cam.position.set(0, 5, 1000);
  cam.lookAt(0, 0, 0);
  g.update(cam);
  assert.strictEqual(g.stats.visible + g.stats.impostors, 0, 'beyond maxDistance');
  assert.strictEqual(g.stats.canopy, false);
  f.dispose();
  g.dispose();
});

test('Forest detail scales the near tiers and adapts to the frame rate', () => {
  const f = new Forest({ seed: 3, count: 100, area: 60, variants: 2 });
  f.detail = 0.5;
  assert.deepStrictEqual(f.ranges().levels, [[null, 6], [6, 12.5]]);
  assert.deepStrictEqual(f.ranges().impostors, [12.5, 600]);
  f.detail = 0;
  assert.strictEqual(f.detail, 0.2, 'clamped');
  f.detail = 1;
  for (let i = 0; i < 5; i++) f.adaptDetail(20);
  assert.ok(f.detail < 0.6);
  const low = f.detail;
  for (let i = 0; i < 5; i++) f.adaptDetail(60);
  assert.ok(f.detail > low && f.detail <= 1);
  f.adaptDetail(50);
  assert.ok(f.detail > low, 'steady near the target');
  f.dispose();
});

test('Forest canopy covers the trees at crown height and offers a canopy texture', () => {
  const f = new Forest({ seed: 4, count: 400, area: 120, variants: 2 });
  const pos = f.canopyMesh.geometry.attributes.position;
  let top = -Infinity, low = Infinity;
  for (let i = 0; i < pos.count; i++) { top = Math.max(top, pos.getY(i)); low = Math.min(low, pos.getY(i)); }
  const tallest = Math.max(...f.getPlacements().map((t) => t.scale)) * Math.max(...f._treeVariants.map((v) => v.top));
  assert.ok(top > tallest * 0.6 && top <= tallest + 1e-6, 'canopy reaches the crowns');
  assert.ok(low < 0.5, 'and drops to the ground in clearings / at the edge');
  const tv = f.textureVariants();
  assert.ok(Number.isInteger(tv.canopy) && Number.isInteger(tv.leaf) && Number.isInteger(tv.bark));
  const pinned = new Forest({ seed: 4, count: 50, area: 60, textures: { canopy: 3 } });
  assert.strictEqual(pinned.textureVariants().canopy, 3);
  f.dispose();
  pinned.dispose();
});
