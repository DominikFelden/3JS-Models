import { CylinderGeometry, Vector3, Quaternion, Color } from 'three';
import { shared } from '../WorldModel.ts';

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
export function treeStyle(o: any = {}) {
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

/**
 * Parametric, stochastic L-system (Lindenmayer system). A symbol is an object
 * { c, ...params }; `rules` maps a symbol letter to a function returning its
 * replacement symbols (or undefined to keep it). All symbols are rewritten in
 * parallel, `iterations` times.
 *
 * Turtle alphabet understood by `runTurtle`:
 *   F {len, rad}  draw a branch forwards      [ / ]  push / pop the turtle state
 *   T {t}         move back to fraction t of the last branch (fork point)
 *   B {fn}        turn: dir = fn(dir)         E      mark a branch end (tip) / J joint
 */
export function lsystem(axiom, rules, iterations) {
  // Context-free rules, so rewriting each symbol to its fixed point depth-first gives the
  // same string as parallel rewriting, and draws random numbers in a stable, tree-walk order.
  const expand = (sym, left) => {
    const r = left > 0 ? rules[sym.c]?.(sym) : undefined;
    return r ? r.flatMap((x) => expand(x, left - 1)) : [sym];
  };
  return axiom.flatMap((sym) => expand(sym, iterations));
}

/**
 * Interprets L-system symbols with a 3D turtle. `onBranch({pos, dir, len, rad, depth, end})`
 * is called for every F (depth = bracket nesting); `onMark(sym, pos, depth)` for E and J.
 */
export function runTurtle(symbols, pos, dir, onBranch, onMark = (..._a: any[]) => {}) {
  const stack = [];
  let p = pos.clone(), d = dir.clone().normalize(), depth = 0;
  let last = { start: p.clone(), len: 0, dir: d.clone() };
  for (const s of symbols) {
    switch (s.c) {
      case '[': stack.push({ p: p.clone(), d: d.clone(), last: { ...last } }); depth++; break;
      case ']': { const t = stack.pop(); p = t.p; d = t.d; last = t.last; depth--; break; }
      case 'T': p = last.start.clone().addScaledVector(last.dir, last.len * s.t); break;
      case 'B': d = s.fn(d).normalize(); break;
      case 'F': {
        const end = p.clone().addScaledVector(d, s.len);
        onBranch({ pos: p.clone(), dir: d.clone(), len: s.len, rad: s.rad, depth, end });
        last = { start: p.clone(), len: s.len, dir: d.clone() };
        p = end;
        break;
      }
      case 'E': case 'J': onMark(s, p.clone(), depth); break;
    }
  }
}

/**
 * Recursively grows branches and sub-branches with an L-system.
 *
 * Rule: A(len, rad, lv) -> F(len, rad) J C C ... (2 children, sometimes 3), C -> [ T B A ],
 * and A at the last generation -> F E. Children fork from the outer 30% of
 * their parent and bend by `opts.spread`.
 *
 * Every branch is added as visual (via `builder`); the first
 * COLLIDER_GENERATIONS generations also get a cylinder collider (via
 * `model.addShape`, tag 'branch'). Returns the branch tips, used by the caller to place leaves.
 *
 * Level semantics: `levels` = number of branching generations. levels = 1 is a
 * single set of branches, levels = 3 means branches with sub-branches with
 * sub-sub-branches.
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
  const { pos, dir, length, radius } = root;
  const rules = {
    A: ({ len, rad, lv }) => {
      const out: any[] = [{ c: 'F', len, rad }];
      if (lv <= 1) return [...out, { c: 'E' }];
      out.push({ c: 'J' });
      const children = rnd() < 0.15 ? 3 : 2;
      for (let i = 0; i < children; i++) out.push({ c: 'C', len, rad, lv: lv - 1 });
      return out;
    },
    // A child branch draws its random numbers when expanded, so siblings interleave with their subtrees.
    C: ({ len, rad, lv }) => {
      const t = 0.7 + rnd() * 0.3;
      const v = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2 * opts.spread);
      return [
        { c: '[' }, { c: 'T', t },
        { c: 'B', fn: (d) => { const n = d.clone().add(v).normalize(); n.y += opts.upward; return n; } },
        { c: 'A', len: len * (opts.shrink - 0.08 + rnd() * 0.16), rad: Math.max(0.015, rad * opts.thin), lv },
        { c: ']' },
      ];
    },
  };
  const symbols = lsystem([{ c: 'A', len: length, rad: radius, lv: levels }], rules, levels * 2);
  runTurtle(symbols, pos, dir, ({ pos: p, dir: d, len, rad, depth }) => {
    const quat = new Quaternion().setFromUnitVectors(Y, d);
    // Twigs this thin are sub-pixel at normal view distances, so 3 sides look identical.
    builder.add(branchGeometry(rad < 0.03), mat, { position: p.toArray(), quaternion: quat, scale: [rad, len, rad] });
    // Collider: cylinder centred half way along the branch (thick generations only).
    if (depth < COLLIDER_GENERATIONS) {
      model.addShape('cylinder', { radius: rad * 0.85, height: len }, p.clone().addScaledVector(d, len / 2).toArray(), quat.clone(), 'branch');
    }
  }, (s, p) => { (s.c === 'E' ? tips : opts.joints)?.push(p); });
  return tips;
}
