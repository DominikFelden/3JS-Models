import { CylinderGeometry, Vector3, Quaternion, Color } from 'three';
import { shared } from '../WorldModel.js';

const Y = new Vector3(0, 1, 0);

/** Highest supported tree complexity (keeps vertex counts reasonable). */
export const MAX_TREE_COMPLEXITY = 20;

/** Only the first generations of branches get colliders; finer twigs are visual only. */
export const COLLIDER_GENERATIONS = 3;

/**
 * Branching generations for a tree complexity. Branches double per generation,
 * so beyond 5 extra complexity adds generations slowly (20 -> 8) and the rest
 * of the detail (more limbs, denser foliage) comes from the tree itself.
 */
export function branchLevels(complexity) {
  return complexity <= 5 ? complexity : 5 + Math.round((complexity - 5) / 5);
}

const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const hex = (v) => { try { return v === undefined || v === null ? undefined : new Color(v).getHex(); } catch { return undefined; } };

/**
 * User-controllable tree style from constructor options. Each value is
 * undefined when not given (the tree then keeps its seed-driven default; the
 * colours stay those of the picked pooled textures).
 * Factors multiply the seed-driven size: trunkHeight, trunkThickness, leafSize.
 */
export function treeStyle(o = {}) {
  return {
    trunkHeight: num(o.trunkHeight, 0.3, 3), trunkThickness: num(o.trunkThickness, 0.3, 3), leafSize: num(o.leafSize, 0.3, 4),
    trunkColor: hex(o.trunkColor), leafColor: hex(o.leafColor),
  };
}

/**
 * Unit branch: base radius 1, top radius 0.7, height 1, base at the origin and
 * growing along +Y. Scaled per branch to (radius, length, radius). Only 5 sides
 * because branches are thin.
 */
function branchGeometry(thin = false) {
  return shared(thin ? 'branch:unit:thin' : 'branch:unit', () => {
    const g = new CylinderGeometry(0.7, 1, 1, thin ? 3 : 5, 1);
    g.translate(0, 0.5, 0);
    return g;
  });
}

/** Random unit-ish perturbation of `dir`, `spread` ~ how far it may bend. */
function bend(dir, spread, rnd) {
  const v = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2 * spread);
  return dir.clone().add(v).normalize();
}

/**
 * Recursively grows branches and sub-branches.
 *
 * Every branch is added as visual (via `builder`); the first
 * COLLIDER_GENERATIONS generations also get a cylinder collider (via
 * `model.addShape`, tag 'branch'). Returns the branch tips, used by the caller to place leaves.
 *
 * Level semantics: `levels` = number of branching generations. levels = 1 is a
 * single set of branches, levels = 3 means branches with sub-branches with
 * sub-sub-branches. Each branch spawns 2 children (sometimes 3).
 *
 * @param {WorldModel} model   receives the colliders
 * @param {MergeBuilder} builder  receives the visual geometry
 * @param {Material} mat       bark material
 * @param {Function} rnd       PRNG function
 * @param {object} root        {pos:Vector3, dir:Vector3, length, radius} first branch
 * @param {number} levels      remaining generations (including this one)
 * @param {object} opts        {spread, shrink, thin, upward, joints?}. If `joints`
 *                             (an array) is given, the end point of every branch
 *                             that forks further is pushed to it (foliage spots
 *                             along the twigs, not only on the tips).
 * @returns {Vector3[]} tips of the outermost branches
 */
export function growBranch(model, builder, mat, rnd, root, levels, opts, tips = []) {
  const { pos, dir, length, radius, depth = 0 } = root;
  const end = pos.clone().addScaledVector(dir, length);

  // Visual: unit branch rotated from +Y onto `dir`, scaled to size.
  const quat = new Quaternion().setFromUnitVectors(Y, dir);
  // Twigs this thin are sub-pixel at normal view distances, so 3 sides look identical.
  builder.add(branchGeometry(radius < 0.03), mat, { position: pos.toArray(), quaternion: quat, scale: [radius, length, radius] });

  // Collider: cylinder centred half way along the branch (thick generations only).
  if (depth < COLLIDER_GENERATIONS) {
    const centre = pos.clone().addScaledVector(dir, length / 2);
    model.addShape('cylinder', { radius: radius * 0.85, height: length }, centre.toArray(), quat.clone(), 'branch');
  }

  if (levels <= 1) {
    tips.push(end);
    return tips;
  }
  opts.joints?.push(end);
  const children = rnd() < 0.15 ? 3 : 2;
  for (let i = 0; i < children; i++) {
    // Fork somewhere on the outer 30% of the parent so branches look staggered.
    const start = pos.clone().addScaledVector(dir, length * (0.7 + rnd() * 0.3));
    const childDir = bend(dir, opts.spread, rnd);
    childDir.y += opts.upward; // branches reach a bit for the light
    childDir.normalize();
    growBranch(model, builder, mat, rnd, {
      pos: start,
      dir: childDir,
      length: length * (opts.shrink - 0.08 + rnd() * 0.16),
      radius: Math.max(0.015, radius * opts.thin),
      depth: depth + 1,
    }, levels - 1, opts, tips);
  }
  return tips;
}
