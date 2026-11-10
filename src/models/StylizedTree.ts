import { CylinderGeometry, IcosahedronGeometry, Mesh, Quaternion, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared, mulberry32 } from '../WorldModel.ts';
import { treeStyle, lsystem, runTurtle } from './branching.ts';
import { pooledMaterial, textureMean } from '../textures/pool.ts';
import { leafCardMaterial, leafCardDepthMaterial, leafCardGeometry, CARD_GRID } from './leafCards.ts';

/** Highest StylizedTree complexity. */
export const MAX_STYLIZED_COMPLEXITY = 10;

/**
 * Share of the cards needed to hide the core that the single crown gets per complexity 0..4
 * (lower complexities keep the first cards of higher ones, same seed). Cards keep their size
 * (`CARD_SIZE`): fewer cards leave gaps that show the dark core, never bigger leaves. From 5 on
 * every branch clump gets all the cards it needs.
 */
export const STYLIZED_COVER = [0, 0.5, 0.65, 0.8, 0.9];
/** Share of the needed cards of `lowPoly` trees. */
const LOW_POLY_COVER = 0.6;

/** Mean leaf-card size (world units, times `leafSize`): the same at every complexity and LOD. */
export const CARD_SIZE = 0.9;

/** Core blobs fill this share of their clump's radius; the leaf cards sit around them. */
const CORE = 0.55;
/** Mean radius (share of the clump's) of the card shell, as seen from outside. */
const SHELL = 0.85;
/**
 * Cards per (shell radius / card size)^2 of a clump: enough clumped cards (about 40% of a card is
 * leaves) to cover the core from every side, so no blob shows through.
 */
const COVER = 40;

const Y = new Vector3(0, 1, 0);
const vdc = (i) => { let v = 0, f = 0.5; for (; i > 0; i >>= 1, f /= 2) if (i & 1) v += f; return v; };
const ellipsoidNormal = (p, c, r, out) => out.set((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();

/**
 * Stylized tree for big forests and mobile: the illusion of leaves instead of
 * leaves. Every leaf clump is a small, dark foliage blob (no see-through
 * overdraw) deep inside a shell of camera-facing leaf cards (hand-inked clumps
 * cut out by alpha test). The shell has enough cards to hide the blob from every
 * side, also from below and above, so flying or walking players only ever see
 * leaves. Blobs and cards share the normals of the crown's ellipsoid, so the
 * crown is lit as one soft volume; the cards have no specular sheen (it would
 * wash them out from below).
 *
 * Leaves keep their size: every card is `CARD_SIZE` x `leafSize` (±15%) at
 * every complexity and in `lowPoly`; complexity only changes how many there
 * are. Each tree has one leaf shape (oval, slender, round or pointed, from its
 * seed); each card shows one of four arrangements of it (rosette, spray along
 * a twig, hanging fan, loose cluster), stretched and mirrored at random.
 *
 * complexity 0..10 (default 2):
 *   0..4  one crown on three limbs, with the `STYLIZED_COVER` share of the
 *         cards it needs to hide its core (0 = full-size blobs only, for far
 *         away). Same crown for every complexity of a seed.
 *   5     first-level branching: the trunk splits (bark knot at the fork) into
 *         3-4 limbs, each ending in its own leaf clump.
 *   6..10 each limb forks into twigs by an L-system (Lindenmayer system):
 *         6 = two twigs per limb, every further level splits each twig tip
 *         into one or two finer twigs (stochastic rule), so 10 has 5 twig
 *         generations. Every twig ends in its own leaf clump (dozens at 10):
 *         leaves grow from the twigs, wherever they reach. The twigs are
 *         scaled so the outermost clumps reach as far as at 5: more
 *         generations never shrink the crown.
 *   From 5 on every clump gets as many cards as it needs to hide its core.
 *   All complexities of a seed share the same crown envelope (`crown`), so
 *   detail levels blend into each other.
 * Cost: ~730 triangles at 2, ~850 at 5, ~1300 at 6, ~3000 at 8, ~6500 at 10;
 * always 3 draw calls (bark, blobs, cards).
 *
 * lowPoly: true gives a cheap version of the same tree for mid distances:
 * 20-sided blobs, capless branches and 60% of the cards (same size, the dark
 * core shows in the gaps); ~2x fewer triangles.
 *
 * The seed picks the bark and foliage textures (`textures: {bark, foliage}`
 * pins them), the shape and the size: trunk height and thickness vary a lot
 * between seeds (taller trees get thicker trunks); `stature` (0 = short and
 * stout .. 1 = tall, -0.25..1.25) sets it instead of the seed. Options as the other trees:
 * trunkHeight, trunkThickness, leafSize (card size factor), trunkColor, leafColor.
 *
 * Colliders: [trunk cylinder, crown sphere] (tags 'trunk', 'crown'), enough
 * for physics; `crown` holds the crown ellipsoid { center, radii }.
 */
export class StylizedTree extends WorldModel {
  declare complexity: any;
  declare lowPoly: any;
  declare crown: any;
  declare cardCount: any;
  declare random: any;
  declare _subCrowns: any;
  declare _clumps: any;
  constructor(options: any = {}) {
    super('StylizedTree', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_STYLIZED_COMPLEXITY, 2);
    this.lowPoly = !!options.lowPoly;
    const rnd = this.random;
    const st = treeStyle(options);
    const bark = this.surface('bark', st.trunkColor, false);
    const foliage = this.variant('foliage');
    const core = pooledMaterial('foliage', foliage, { color: st.leafColor ?? null, flatShading: false, vertexColors: true, roughness: 1 });
    const leafColor = st.leafColor !== undefined ? new Color(st.leafColor) : textureMean('foliage', foliage);

    // Size: tall trees get thicker trunks and slightly bigger crowns.
    const seedTall = this.rand(0.7, 1.5); // always drawn, so `stature` changes nothing else
    const stature = Number(options.stature);
    const tall = Number.isFinite(stature) ? 0.7 + 0.8 * Math.min(1.25, Math.max(-0.25, stature)) : seedTall;
    const th = tall * (st.trunkHeight ?? 1);
    const tw = this.rand(0.75, 1.3) * (0.7 + 0.3 * tall) * (st.trunkThickness ?? 1);
    const cs = this.rand(0.8, 1.25) * (0.85 + 0.15 * tall);
    const ls = st.leafSize ?? 1;
    const cardSize = CARD_SIZE * ls;
    // Leaf shape (atlas row) of this tree, from its own stream so the shapes drawn by `rnd` stay put.
    const leafShape = Math.floor(mulberry32(this.seed ^ 0x1eaf5)() * CARD_GRID);
    const H = 2.1 * th;
    const radii = new Vector3(1.9 * cs, 1.55 * cs * this.rand(0.85, 1.2), 1.9 * cs * this.rand(0.85, 1.1));
    const C = new Vector3(0, H + radii.y * 0.6, 0);
    this.crown = { center: C.clone(), radii: radii.clone() };
    const branched = this.complexity >= 5;

    const b = new MergeBuilder();
    // Branched trees split at the trunk top (`forkY`): every limb grows out of it.
    const forkY = H * 0.9;
    const trunkTop = branched ? forkY : H + radii.y * 0.5;
    b.add(shared('stylized:trunk', () => new CylinderGeometry(0.16, 0.26, 1, 7)), bark, { position: [0, trunkTop / 2, 0], scale: [tw, trunkTop, tw] });
    b.add(shared('stylized:flare', () => new CylinderGeometry(0.24, 0.42, 0.4, 7)), bark, { position: [0, 0.2, 0], scale: [tw, 1, tw] });
    // lowPoly limbs drop the end caps: bases sit inside the parent, tips end in a knot or a clump.
    const limb = shared(this.lowPoly ? 'stylized:limbOpen' : 'stylized:limb', () => { const g = new CylinderGeometry(0.6, 1, 1, 5, 1, this.lowPoly); g.translate(0, 0.5, 0); return g; });
    const branch = (from, to, r) => {
      const d = to.clone().sub(from);
      if (d.lengthSq() < 1e-8) return;
      b.add(limb, bark, { position: from.toArray(), quaternion: new Quaternion().setFromUnitVectors(Y, d.clone().normalize()), scale: [r, d.length(), r] });
    };
    const blob1 = shared('stylized:blob', () => new IcosahedronGeometry(1, 1));
    const blob0 = shared('stylized:blob0', () => new IcosahedronGeometry(1, 0));
    const blob = this.lowPoly ? blob0 : blob1;
    // Rounded bark knot that hides the flat cut of a branch where it splits.
    const knot = (at, r, smooth = false) => b.add(smooth && !this.lowPoly ? blob1 : blob0, bark, { position: at.toArray(), scale: [r, r * 0.9, r] });
    const addBlob = (center, r, tint, yaw = 0) => b.add(blob, core, { position: center.toArray(), scale: r.toArray(), yaw, tint });
    const a0 = rnd() * Math.PI * 2;
    this.addShape('cylinder', { radius: 0.26 * tw, height: H }, [0, H / 2, 0], null, 'trunk');

    // Leaf clumps: { center, radii, n (cards) or size (card size) }. Each has a small dark core blob
    // deep inside a shell of leaf cards, so from every side (also from below and above) only leaves show.
    // A clump needs `needed` cards of `cardSize` to hide its core; with fewer (`cover` < 1) its core
    // grows a little, so the gaps between the leaves show dark foliage deep inside.
    const crowns = [];
    const needed = (r) => COVER * (SHELL * (r.x + r.y + r.z) / 3 / cardSize) ** 2;
    const coreScale = (cover) => (cover > 0 ? CORE + (1 - CORE) * 0.4 * (1 - Math.min(1, cover)) : 1);
    const clump = (center, r, hy, yaw) => {
      const need = needed(r);
      const n = Math.max(8, Math.ceil(need * (this.lowPoly ? LOW_POLY_COVER : 1)));
      addBlob(center, r.clone().multiplyScalar(coreScale(n / need)), this._tint(0.3 + 0.3 * hy, 0.6), yaw);
      crowns.push({ center, radii: r, n });
    };
    if (!branched) {
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
        const dir = new Vector3(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
        b.add(limb, bark, { position: [0, H * this.rand(0.8, 0.95), 0], quaternion: new Quaternion().setFromUnitVectors(Y, dir), scale: [0.09 * tw, radii.y * 0.95, 0.09 * tw] });
      }
      const n = Math.ceil(needed(radii) * STYLIZED_COVER[Math.min(this.complexity, 4)] * (this.lowPoly ? LOW_POLY_COVER : 1));
      const deep = coreScale(STYLIZED_COVER[Math.min(this.complexity, 4)]), dark = n > 0 ? 0.2 : 0;
      // Core: one big blob and a ring of smaller ones, darker inside the crown.
      addBlob(C, radii.clone().multiplyScalar(0.72 * deep), this._tint(0.45, 0.8 - dark));
      const blobs = 5 + (rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < blobs; i++) {
        const a = a0 + (i / blobs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const h = this.rand(-0.35, 0.55);
        const d = new Vector3(Math.cos(a) * Math.sqrt(1 - h * h), h, Math.sin(a) * Math.sqrt(1 - h * h));
        const s = this.rand(0.42, 0.55);
        addBlob(C.clone().add(d.clone().multiply(radii).multiplyScalar(0.45 * deep)), radii.clone().multiplyScalar(s * deep), this._tint(0.5 + 0.5 * h, 0.85 - dark), a);
      }
      crowns.push({ center: C, radii, n });
      this._subCrowns = null;
    } else {
      // Limbs are drawn first, so complexity 6 forks the same limbs as complexity 5.
      const n1 = rnd() < 0.5 ? 3 : 4;
      const limbs = [];
      for (let i = 0; i < n1; i++) {
        const a = a0 + (i / n1) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
        const h = this.rand(-0.2, 0.45);
        const ring = Math.sqrt(1 - h * h);
        const tip = C.clone().add(new Vector3(Math.cos(a) * ring, h, Math.sin(a) * ring).multiply(radii).multiplyScalar(this.rand(0.55, 0.68)));
        // Limbs sprout from the rim of the trunk top, slightly staggered in height.
        const drop = (0.95 - this.rand(0.72, 0.95)) * 0.5 * tw;
        const start = new Vector3(Math.cos(a) * 0.05 * tw, forkY - drop, Math.sin(a) * 0.05 * tw);
        limbs.push({ a, h, tip, start });
      }
      knot(new Vector3(0, forkY, 0), 0.18 * tw, true);
      const twigs = this.complexity >= 6;
      const G = this.complexity - 5; // twig generations (L-system iterations) per limb
      for (const L of limbs) {
        if (!twigs) {
          branch(L.start, L.tip, 0.13 * tw);
          const r = new Vector3(radii.x * 0.5, radii.y * 0.52, radii.z * 0.5).multiplyScalar(this.rand(0.9, 1.1));
          this.skip(1); // was the size of a second blob
          clump(L.tip, r, L.h, L.a);
        } else {
          const fork = L.start.clone().lerp(L.tip, this.rand(0.5, 0.65));
          branch(L.start, fork, 0.13 * tw);
          knot(fork, 0.085 * tw);
          this._growTwigs(fork, L, G, radii, C, tw, branch, clump);
        }
      }
      this._subCrowns = crowns.slice();
      // Inner foliage on a leader from the fork, so the crown is neither hollow between the branch
      // clumps nor lower on top than the single crown.
      const top = C.clone().add(new Vector3(0, 0.25 * radii.y, 0));
      branch(new Vector3(0, forkY - 0.05 * tw, 0), top, 0.1 * tw);
      clump(top, radii.clone().multiplyScalar(0.65), 0.25, a0);
    }
    b.build(this);
    this.children.forEach((m: any) => { if (m.material === core) this._crownNormals(m.geometry, 0.7); });

    // Leaf cards fill a shell all round each clump (outer 40% of its radius): a golden-angle spiral
    // with van der Corput heights spreads any count evenly. All cards share one size (`CARD_SIZE`
    // times `leafSize`, ±15%), whatever the complexity: the single crown gets its `STYLIZED_COVER`
    // share of the cards it needs to cover its core from every side (`COVER`), branch clumps all. Every
    // clump has its own PRNG, so its first cards never move when more are added (complexity,
    // lowPoly). Each card picks one of the arrangements of the tree's leaf shape, stretched and
    // mirrored at random, so no two neighbours look alike.
    this._clumps = crowns;
    const cards = [];
    const seeds = crowns.map(() => (rnd() * 0x100000000) >>> 0);
    crowns.forEach((cr, k) => {
      const r = mulberry32(seeds[k]);
      const rand = (lo, hi) => lo + r() * (hi - lo);
      for (let i = 0; i < cr.n; i++) {
        const h = -0.97 + 1.94 * vdc(i + 1);
        const ring = Math.sqrt(1 - h * h);
        const a = a0 + i * 2.39996 + (r() - 0.5) * 0.5;
        const depth = rand(0.6, 1);
        const center = cr.center.clone().add(new Vector3(Math.cos(a) * ring, h, Math.sin(a) * ring).multiply(cr.radii).multiplyScalar(depth));
        const hy = (center.y - C.y) / radii.y;
        const tint = this._tint(0.5 + 0.5 * hy, 0.8 + 0.2 * (depth - 0.6) / 0.4, rand);
        cards.push({
          center, size: rand(0.85, 1.15) * cardSize, angle: r() * Math.PI * 2,
          clump: leafShape * CARD_GRID + Math.floor(r() * CARD_GRID), aspect: rand(0.8, 1.25), flip: r() < 0.5,
          normal: this._crownNormal(center, null, 0), tint,
        });
      }
    });
    this.cardCount = cards.length;
    if (cards.length) {
      const geo = leafCardGeometry(cards);
      this._ownedGeometries.push(geo);
      const mesh = new Mesh(geo, leafCardMaterial(leafColor));
      mesh.customDepthMaterial = leafCardDepthMaterial();
      mesh.castShadow = mesh.receiveShadow = true;
      this.add(mesh);
    }
    this.addShape('sphere', { radius: Math.max(radii.x, radii.y, radii.z) }, C.toArray(), null, 'crown');
  }

  /**
   * Grows the twigs of one limb with an L-system and calls `crown(center, radii, hy, yaw)`
   * at every outermost twig tip. Rules (G = twig generations):
   *   A(g) -> F(g) E            if g == G
   *   A(g) -> F(g) C C?         otherwise: two children (one is kept with probability 0.45 from g = 2)
   *   C(g) -> [ T B A(g+1) ]    splits off at the parent's tip, bends sideways and up
   * Generation 1 is always the two twigs reaching to the limb's crown, one on each side.
   * Afterwards all twigs are scaled so the outermost clump reaches as far out of the crown as the
   * limb's single clump at complexity 5: more generations never shrink the crown.
   */
  _growTwigs(fork, L, G, radii, C, tw, branch, crown) {
    const side = new Vector3(-Math.sin(L.a), 0, Math.cos(L.a));
    const rnd = () => this.random();
    const shrink = 0.86 ** (G - 1);
    const rules = {
      A: ({ len, rad, g }) => {
        const out: any[] = [{ c: 'F', len, rad }];
        if (g >= G) return [...out, { c: 'E', g }];
        const n = g < 2 || rnd() > 0.45 ? 2 : 1;
        for (let i = 0; i < n; i++) out.push({ c: 'C', len, rad, g: g + 1, s: i === 0 ? 1 : -1, n });
        return out;
      },
      C: ({ len, rad, g, s, n }) => {
        const t = 0.94 + 0.06 * rnd(); // split at the parent's tip, no stub left beyond the fork
        const sd = n === 1 ? (rnd() < 0.5 ? -1 : 1) : s;
        const lat = 0.55 + 0.3 * rnd(), jit = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.3);
        return [
          { c: '[' }, { c: 'T', t },
          { c: 'B', fn: (d) => d.clone().addScaledVector(side, sd * lat).add(jit).add(new Vector3(0, 0.3 / g, 0)) },
          { c: 'A', len: len * (0.6 + 0.14 * rnd()), rad: rad * 0.72, g },
          { c: ']' },
        ];
      },
    };
    const axiom: any[] = [];
    // Each generation is ~0.67 as long as its parent: scale the first twigs so the whole series
    // (not just the first twig) reaches the limb's crown, however many generations follow.
    const reach = (1 - 0.67 ** G) / (1 - 0.67);
    for (const s of [-1, 1]) {
      const tip = L.tip.clone()
        .addScaledVector(side, s * radii.x * this.rand(0.3, 0.42))
        .add(new Vector3(0, radii.y * this.rand(-0.15, 0.2), 0));
      const d = tip.clone().sub(fork);
      axiom.push({ c: '[' }, { c: 'B', fn: () => d.clone() }, { c: 'A', len: d.length() / reach, rad: 0.075 * tw, g: 1 }, { c: ']' });
    }
    // Leaves grow where the twigs end: every outermost twig tip carries its own clump.
    const symbols = lsystem(axiom, rules, 4 * G);
    const dir = L.tip.clone().sub(L.start);
    const ends = [];
    runTurtle(symbols, fork, dir, () => {}, (sym, p) => { if (sym.c === 'E') ends.push(p.sub(fork)); });
    // Reach (in crown radii) of the clumps if all twigs are `k` times as long; complexity 5 reaches
    // `goal`: its clump (half the crown radii) round the limb tip.
    const e = new Vector3();
    const outer = (k) => Math.max(...ends.map((o) => e.copy(o).multiplyScalar(k).add(fork).sub(C).divide(radii).length())) + 0.34 * shrink;
    const goal = e.copy(L.tip).sub(C).divide(radii).length() + 0.5;
    let lo = 0.7, hi = 1.8;
    for (let i = 0; i < 16; i++) { const k = (lo + hi) / 2; if (outer(k) < goal) lo = k; else hi = k; }
    const k = (lo + hi) / 2;
    runTurtle(symbols.map((sym) => (sym.c === 'F' ? { ...sym, len: sym.len * k } : sym)), fork, dir, (b) => branch(b.pos, b.end, b.rad));
    for (const o of ends) {
      const p = o.multiplyScalar(k).add(fork);
      const r = new Vector3(radii.x * 0.33, radii.y * 0.36, radii.z * 0.33).multiplyScalar(shrink * this.rand(0.85, 1.15));
      crown(p, r, (p.y - C.y) / radii.y, L.a + p.x);
    }
  }

  /** Brightness tint: lit on top (`height01` = 1), darker below; `k` darkens the core. */
  _tint(height01, k, rand = (lo, hi) => this.rand(lo, hi)) {
    const v = k * (0.85 + 0.25 * Math.min(1, Math.max(0, height01)) + rand(-0.06, 0.06));
    return [v * rand(0.96, 1.06), v, v * rand(0.9, 1)];
  }

  /**
   * Normal at `p`: the crown ellipsoid's, mixed with the nearest branch crown's (complexity 5+, so
   * every clump gets its own lit top), then with `own` (weight 1 - `w`).
   */
  _crownNormal(p, own, w) {
    const { center: c, radii: r } = this.crown;
    const n = ellipsoidNormal(p, c, r, new Vector3());
    if (this._subCrowns) {
      let best = null, bd = Infinity;
      for (const s of this._subCrowns) {
        const d = ((p.x - s.center.x) / s.radii.x) ** 2 + ((p.y - s.center.y) / s.radii.y) ** 2 + ((p.z - s.center.z) / s.radii.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      n.multiplyScalar(0.55).addScaledVector(ellipsoidNormal(p, best.center, best.radii, new Vector3()), 0.45).normalize();
    }
    n.y += 0.45; // lean towards the sky: soft, painted shading instead of a black underside
    n.normalize();
    if (own && w < 1) n.multiplyScalar(w).addScaledVector(own, 1 - w).normalize();
    return n;
  }

  /** Bend a geometry's normals towards the crown (weight `w`). */
  _crownNormals(g, w) {
    const pos = g.attributes.position, nor = g.attributes.normal;
    const p = new Vector3(), own = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const n = this._crownNormal(p.fromBufferAttribute(pos, i), own.fromBufferAttribute(nor, i), w);
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }
}
