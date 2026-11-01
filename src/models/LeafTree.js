import { CylinderGeometry, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared, barkMaterial } from '../WorldModel.js';
import { growBranch, branchLevels, treeStyle, MAX_TREE_COMPLEXITY } from './branching.js';
import { TriangleLeaf, LEAF_TYPES, leafMaterial } from './Leaf.js';

const LEAF_COLOURS = [[0.35, 0.65, 0.22], [0.3, 0.58, 0.2], [0.45, 0.7, 0.2], [0.25, 0.5, 0.25], [0.7, 0.55, 0.15], [0.75, 0.35, 0.15]];
const BARKS = [0x7a5230, 0x5e4a3a, 0x8a7a66, 0x4a3a2a];
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

/**
 * Leaf-Tree: a detailed tree. Trunk -> limbs -> branches -> twigs -> ... ->
 * leaves. Every generation forks into thinner, shorter twigs; the finest twigs
 * (and the forks near them) carry `Leaf` objects (flat ovals or triangles,
 * chosen per tree by the seed) that hang down and face outward/up like on a real tree.
 *
 * complexity 0..20 (default 4): number of branching generations
 * (limbs fork `complexity + 1` times up to complexity 5; beyond that extra
 * complexity adds slower generations, more limbs and more leaves per twig).
 *
 * Options: trunkHeight, trunkThickness, leafSize (factors, 1 = seed default),
 * leafType (key of `LEAF_TYPES`, default random), trunkColor, leafColor (any
 * three.js colour). Unset options stay seed-driven.
 *
 * Colliders: [trunk cylinder, crown sphere, ...branch cylinders].
 * Tags: 'trunk', 'crown', 'branch'. The leaf class used is in `this.leafClass`.
 */
export class LeafTree extends WorldModel {
  constructor(options = {}) {
    super('LeafTree', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_TREE_COMPLEXITY, 4);
    const rnd = this.random;
    const st = treeStyle(options);
    const randomBark = pick(rnd, BARKS);
    const bark = barkMaterial(st.trunkColor ?? randomBark);
    const th = this.rand(0.8, 1.4) * (st.trunkHeight ?? 1), tw = this.rand(0.8, 1.2) * (st.trunkThickness ?? 1), cs = this.rand(0.9, 1.3);
    const types = Object.keys(LEAF_TYPES);
    const randomType = types[Math.floor(rnd() * types.length)];
    this.leafClass = LEAF_TYPES[options.leafType] ?? LEAF_TYPES[randomType];
    const rgb = st.leafColor === undefined ? null : new Color(st.leafColor);
    const randomColour = pick(rnd, LEAF_COLOURS);
    const colour = rgb ? [rgb.r, rgb.g, rgb.b] : randomColour;

    const builder = new MergeBuilder();
    builder.add(shared('leaftree:trunk', () => new CylinderGeometry(0.2, 0.34, 1, 7)), bark, { position: [0, th, 0], scale: [tw, 2 * th, tw] });
    builder.add(shared('leaftree:flare', () => new CylinderGeometry(0.3, 0.55, 0.5, 7)), bark, { position: [0, 0.25, 0], scale: [tw, 1, tw] });
    this.addShape('cylinder', { radius: 0.34 * tw, height: 2 * th }, [0, th, 0], null, 'trunk');

    const tips = [];
    const joints = [];
    const levels = branchLevels(this.complexity) + 1;
    const count = 4 + (this.complexity >= 3 ? 1 : 0) + Math.floor(Math.max(0, this.complexity - 5) / 5);
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = a0 + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const dir = new Vector3(Math.cos(a) * 0.75, 0.9, Math.sin(a) * 0.75).normalize();
      growBranch(this, builder, bark, rnd, {
        pos: new Vector3(0, this.rand(1.5, 2.1) * th, 0), dir, length: this.rand(1, 1.3) * cs, radius: 0.14 * tw,
      }, levels, { spread: 0.7, shrink: 0.72, thin: 0.62, upward: 0.1, joints }, tips);
    }

    // Leaves: clusters on every twig tip, single leaves on the last forks.
    const mat = leafMaterial();
    const Kind = this.leafClass;
    const size = this.rand(0.8, 1.2) * (st.leafSize ?? 1);
    const spots = [...tips.map((p) => [p, 4]), ...joints.slice(-Math.ceil(joints.length / 2)).map((p) => [p, 2])];
    this.leaves = [];
    spots.forEach(([p, n]) => {
      for (let i = 0; i < n; i++) {
        // Outward = away from the trunk, with some scatter; low branches hang more.
        const spread = rnd() * 2 * Math.PI;
        const outward = new Vector3(p.x + Math.cos(spread) * 0.5, 0, p.z + Math.sin(spread) * 0.5);
        if (outward.lengthSq() < 1e-6) outward.set(Math.cos(spread), 0, Math.sin(spread));
        const k = 1.1 + this.rand(-0.25, 0.35);
        const leaf = new Kind(p.clone().add(new Vector3(this.rand(-0.06, 0.06), this.rand(-0.04, 0.04), this.rand(-0.06, 0.06))), outward, {
          length: this.rand(0.3, 0.45) * size,
          width: this.rand(0.18, 0.28) * size * (Kind === TriangleLeaf ? 1.1 : 1),
          droop: this.rand(0.4, 1.1),
          roll: this.rand(-0.5, 0.5),
          tint: [k * colour[0] * this.rand(0.9, 1.1), k * colour[1], k * colour[2]],
        });
        leaf.place(builder, mat);
        this.leaves.push(leaf);
      }
    });
    builder.build(this);

    const all = [...tips, ...joints];
    const c = new Vector3();
    all.forEach((p) => c.add(p));
    c.divideScalar(all.length);
    const r = all.reduce((m, p) => Math.max(m, p.distanceTo(c)), 0) + 0.4;
    this.addShape('sphere', { radius: r }, c.toArray(), null, 'crown');
    this._shapes.splice(1, 0, this._shapes.pop());
  }
}
