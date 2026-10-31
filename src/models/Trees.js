import { CylinderGeometry, SphereGeometry, ConeGeometry, Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.js';
import { growBranch, MAX_TREE_COMPLEXITY } from './branching.js';

/** Bounding sphere {centre, radius} around points, for a single crown collider. */
function boundingSphere(points, extra) {
  const c = new Vector3();
  points.forEach((p) => c.add(p));
  c.divideScalar(points.length);
  let r = 0;
  points.forEach((p) => { r = Math.max(r, p.distanceTo(c)); });
  return { centre: c, radius: r + extra };
}

/**
 * Register the crown bounding sphere right after the trunk (index 1), even
 * though it can only be computed after the branches (and thus tips) exist.
 * This keeps the documented collider order [trunk, crown, ...branches].
 */
function addCrownAfterTrunk(model, tips, extra) {
  const { centre, radius } = boundingSphere(tips, extra);
  model.addShape('sphere', { radius }, centre.toArray(), null, 'crown');
  model._shapes.splice(1, 0, model._shapes.pop());
}

/**
 * Pine tree. Base at y = 0, height about 4 * size.
 *
 * complexity 0: trunk + three stacked cones (no branches).
 * complexity 1..5: trunk + a ring of branches at several heights, each branch
 *   forking into sub-branches `complexity` times. Branch tips carry small
 *   cone needles. Every instance is different (random `seed` by default).
 *
 * Colliders: [trunk cylinder, crown cone or sphere, ...branch cylinders].
 * Tags: 'trunk', 'crown', 'branch'.
 */
export class PineTree extends WorldModel {
  constructor(options = {}) {
    super('PineTree', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_TREE_COMPLEXITY, 0);
    const trunkG = shared('pine:trunk', () => new CylinderGeometry(0.15, 0.22, 1.2, 6));
    const coneG = shared('pine:cone', () => new ConeGeometry(1, 1.6, 8));
    const green = material(0x1f6b3a, true);
    const bark = material(0x6b4423);

    this.addMesh(trunkG, bark, [0, 0.6, 0]);
    this.addShape('cylinder', { radius: 0.22, height: 1.2 }, [0, 0.6, 0], null, 'trunk');

    if (this.complexity === 0) {
      // Three cones, each smaller than the one below.
      this.addMesh(coneG, green, [0, 1.6, 0], [1, 1, 1]);
      this.addMesh(coneG, green, [0, 2.4, 0], [0.75, 0.9, 0.75]);
      this.addMesh(coneG, green, [0, 3.1, 0], [0.5, 0.8, 0.5]);
      this.addShape('cone', { radius: 1, height: 3.4 }, [0, 2.3, 0], null, 'crown');
      return;
    }

    this._buildBranched(coneG, bark, green);
  }

  _buildBranched(coneG, bark, green) {
    const rnd = this.random;
    const c = this.complexity;
    const builder = new MergeBuilder();
    const tips = [];
    // Central leader reaches the top of the tree.
    builder.add(shared('pine:leader', () => new CylinderGeometry(0.1, 0.18, 3.4, 5)), bark, { position: [0, 2.4, 0] });
    tips.push(new Vector3(0, 4.1, 0));
    // Whorls of branches: more whorls and more branches per whorl with complexity.
    const whorls = 2 + Math.min(c, 3);
    const perWhorl = c >= 3 ? 4 : 3;
    for (let w = 0; w < whorls; w++) {
      const t = w / (whorls - 1);                     // 0 = lowest whorl, 1 = highest
      const y = 1.1 + t * 2.4;
      const length = (1.1 - t * 0.6) * this.rand(0.85, 1.15); // upper branches are shorter
      const a0 = rnd() * Math.PI * 2;
      for (let i = 0; i < perWhorl; i++) {
        const a = a0 + (i / perWhorl) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        // Pine branches droop slightly outward.
        const dir = new Vector3(Math.cos(a), 0.25 + rnd() * 0.15, Math.sin(a)).normalize();
        growBranch(this, builder, bark, rnd, {
          pos: new Vector3(0, y, 0), dir, length, radius: 0.07,
        }, Math.min(Math.max(1, c - 1), 3), { spread: 0.45, shrink: 0.6, thin: 0.6, upward: -0.05 }, tips);
      }
    }
    // Needles: a small cone on every tip.
    const needle = shared('pine:needle', () => new ConeGeometry(0.3, 0.6, 6));
    tips.forEach((tip) => {
      const s = this.rand(0.7, 1.3);
      builder.add(needle, green, { position: [tip.x, tip.y + 0.15, tip.z], scale: [s, s, s] });
    });
    builder.build(this);
    addCrownAfterTrunk(this, tips, 0.3);
  }
}

/**
 * Oak tree. Base at y = 0, height about 4.5 * size.
 *
 * complexity 0: thick trunk + a cluster of 3 low-poly spheres (no branches).
 * complexity 1..5: trunk splits into spreading branches which fork into
 *   sub-branches `complexity` times; leaf blobs sit on the branch tips.
 *
 * Colliders: [trunk cylinder, crown sphere, ...branch cylinders].
 * Tags: 'trunk', 'crown', 'branch'. The crown sphere bounds all leaves.
 */
export class OakTree extends WorldModel {
  constructor(options = {}) {
    super('OakTree', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_TREE_COMPLEXITY, 0);
    const trunkG = shared('oak:trunk', () => new CylinderGeometry(0.25, 0.4, 2, 7));
    const crownG = shared('oak:crown', () => new SphereGeometry(1, 8, 6));
    const blobG = shared('oak:blob', () => new SphereGeometry(1, 6, 4)); // cheap leaf blob
    const leaf = material(0x3f8f3a, true);
    const bark = material(0x7a5230);

    this.addMesh(trunkG, bark, [0, 1, 0]);
    this.addShape('cylinder', { radius: 0.4, height: 2 }, [0, 1, 0], null, 'trunk');

    if (this.complexity === 0) {
      this.addMesh(crownG, leaf, [0, 3, 0], [1.5, 1.2, 1.5]);
      this.addMesh(crownG, leaf, [0.8, 2.6, 0.3], [0.9, 0.8, 0.9]);
      this.addMesh(crownG, leaf, [-0.7, 2.7, -0.4], [0.9, 0.8, 0.9]);
      this.addShape('sphere', { radius: 1.5 }, [0, 3, 0], null, 'crown'); // bounding sphere of the crown
      return;
    }

    this._buildBranched(blobG, bark, leaf);
  }

  _buildBranched(blobG, bark, leaf) {
    const rnd = this.random;
    const c = this.complexity;
    const builder = new MergeBuilder();
    const tips = [];
    const count = c >= 3 ? 4 : 3; // main limbs leaving the trunk
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = a0 + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
      const dir = new Vector3(Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.8).normalize();
      growBranch(this, builder, bark, rnd, {
        pos: new Vector3(0, this.rand(1.3, 2), 0),
        dir,
        length: this.rand(0.9, 1.3),
        radius: 0.16,
      }, c, { spread: 0.7, shrink: 0.72, thin: 0.62, upward: 0.12 }, tips);
    }
    // A leader straight up so the crown is not hollow in the middle.
    growBranch(this, builder, bark, rnd, {
      pos: new Vector3(0, 1.9, 0), dir: new Vector3(0, 1, 0), length: 1.1, radius: 0.15,
    }, Math.max(1, c - 1), { spread: 0.7, shrink: 0.72, thin: 0.62, upward: 0.12 }, tips);

    // Leaf blobs: bigger blobs at low complexity (few tips), smaller at high.
    const blob = Math.max(0.3, 0.6 - c * 0.06);
    tips.forEach((tip) => {
      const s = blob * this.rand(0.8, 1.25);
      builder.add(blobG, leaf, { position: tip.toArray(), scale: [s, s * 0.85, s], yaw: rnd() * Math.PI });
    });
    builder.build(this);
    addCrownAfterTrunk(this, tips, blob);
  }
}
