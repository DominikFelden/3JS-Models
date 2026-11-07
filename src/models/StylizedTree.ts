import { CylinderGeometry, IcosahedronGeometry, Mesh, Quaternion, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared, mulberry32 } from '../WorldModel.ts';
import { treeStyle, lsystem, runTurtle } from './branching.ts';
import { pooledMaterial, textureMean } from '../textures/pool.ts';
import { leafCardMaterial, leafCardDepthMaterial, leafCardGeometry } from './leafCards.ts';

/** Highest StylizedTree complexity. */
export const MAX_STYLIZED_COMPLEXITY = 10;

/**
 * Leaf cards of the single crown per complexity 0..4 (lower complexities keep the first cards of
 * higher ones, same seed; fewer cards are bigger, so they still hide the core). From 5 on every
 * branch clump gets as many cards as it needs to hide its core.
 */
export const STYLIZED_CARDS = [0, 20, 34, 50, 70];

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
 * complexity 0..10 (default 2):
 *   0..4  one crown on three limbs, with `STYLIZED_CARDS` leaf cards
 *         (0 = full-size blobs only, for far away). Same crown for every
 *         complexity of a seed.
 *   5     first-level branching: the trunk splits (bark knot at the fork) into
 *         3-4 limbs, each ending in its own leaf clump.
 *   6..10 each limb forks into twigs by an L-system (Lindenmayer system):
 *         6 = two twigs per limb, every further level splits each twig tip
 *         into one or two finer twigs (stochastic rule), so 10 has 5 twig
 *         generations. Every twig ends in its own leaf clump (dozens at 10):
 *         leaves grow from the twigs, wherever they reach.
 *   From 5 on every clump gets as many cards as it needs to hide its core.
 *   All complexities of a seed share the same crown envelope (`crown`), so
 *   detail levels blend into each other.
 * Cost: ~650 triangles at 2, ~850 at 5, ~1200 at 6, ~3000 at 8, ~7000 at 10;
 * always 3 draw calls (bark, blobs, cards).
 *
 * lowPoly: true gives a cheap version of the same tree for mid distances:
 * 20-sided blobs, capless branches and about half the cards (bigger, so they
 * still hide the blobs); ~2x fewer triangles.
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
    const crowns = [];
    const cards0 = STYLIZED_CARDS[Math.min(this.complexity, 4)];
    const deep = cards0 > 0 || branched ? CORE : 1; // complexity 0 (no cards) keeps full-size blobs
    const clump = (center, r, hy, yaw, card) => {
      addBlob(center, r.clone().multiplyScalar(CORE), this._tint(0.3 + 0.3 * hy, 0.6), yaw);
      crowns.push({ center, radii: r, ...card });
    };
    if (!branched) {
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
        const dir = new Vector3(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
        b.add(limb, bark, { position: [0, H * this.rand(0.8, 0.95), 0], quaternion: new Quaternion().setFromUnitVectors(Y, dir), scale: [0.09 * tw, radii.y * 0.95, 0.09 * tw] });
      }
      // Core: one big blob and a ring of smaller ones, darker inside the crown.
      addBlob(C, radii.clone().multiplyScalar(0.72 * deep), this._tint(0.45, deep < 1 ? 0.6 : 0.8));
      const blobs = 5 + (rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < blobs; i++) {
        const a = a0 + (i / blobs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const h = this.rand(-0.35, 0.55);
        const d = new Vector3(Math.cos(a) * Math.sqrt(1 - h * h), h, Math.sin(a) * Math.sqrt(1 - h * h));
        const s = this.rand(0.42, 0.55);
        addBlob(C.clone().add(d.clone().multiply(radii).multiplyScalar(0.45 * deep)), radii.clone().multiplyScalar(s * deep), this._tint(0.5 + 0.5 * h, deep < 1 ? 0.65 : 0.85), a);
      }
      crowns.push({ center: C, radii, n: Math.round(cards0 * (this.lowPoly ? 0.5 : 1)) });
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
          clump(L.tip, r, L.h, L.a, { size: 0.9 * cs });
        } else {
          const fork = L.start.clone().lerp(L.tip, this.rand(0.5, 0.65));
          branch(L.start, fork, 0.13 * tw);
          knot(fork, 0.085 * tw);
          this._growTwigs(fork, L, G, radii, C, tw, branch, (c, r, hy, yaw, size) => clump(c, r, hy, yaw, { size: size * cs }));
        }
      }
      this._subCrowns = crowns.slice();
      // Inner foliage in the middle, so the crown isn't hollow between the branch clumps.
      clump(C.clone().add(new Vector3(0, 0.05 * radii.y, 0)), radii.clone().multiplyScalar(twigs ? 0.6 : 0.7), 0, a0, { size: 0.9 * cs });
    }
    b.build(this);
    this.children.forEach((m: any) => { if (m.material === core) this._crownNormals(m.geometry, 0.7); });

    // Leaf cards fill a shell all round each clump (outer 40% of its radius): a golden-angle spiral
    // with van der Corput heights spreads any count evenly. A clump gets enough cards to cover its
    // core from every side (`COVER`): the single crown gets `STYLIZED_CARDS` cards sized to cover it,
    // branch clumps get as many cards of their size as they need. Every clump has its own PRNG, so
    // its first cards never move when more are added (complexity, lowPoly).
    this._clumps = crowns;
    const cards = [];
    const seeds = crowns.map(() => (rnd() * 0x100000000) >>> 0);
    crowns.forEach((cr, k) => {
      const r = mulberry32(seeds[k]);
      const rand = (lo, hi) => lo + r() * (hi - lo);
      const shell = SHELL * (cr.radii.x + cr.radii.y + cr.radii.z) / 3;
      let { n, size } = cr;
      if (n === undefined) {
        size *= this.lowPoly ? 1.4 : 1;
        n = Math.max(8, Math.ceil(COVER * (shell / size) ** 2));
      } else if (n > 0) size = shell * Math.sqrt(COVER / n);
      for (let i = 0; i < n; i++) {
        const h = -0.97 + 1.94 * vdc(i + 1);
        const ring = Math.sqrt(1 - h * h);
        const a = a0 + i * 2.39996 + (r() - 0.5) * 0.5;
        const depth = rand(0.6, 1);
        const center = cr.center.clone().add(new Vector3(Math.cos(a) * ring, h, Math.sin(a) * ring).multiply(cr.radii).multiplyScalar(depth));
        const hy = (center.y - C.y) / radii.y;
        const tint = this._tint(0.5 + 0.5 * hy, 0.8 + 0.2 * (depth - 0.6) / 0.4, rand);
        cards.push({
          center, size: rand(0.85, 1.15) * size * ls, angle: r() * Math.PI * 2, clump: Math.floor(r() * 4),
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
   * Grows the twigs of one limb with an L-system and calls `crown(center, radii, hy, yaw, size)`
   * at every outermost twig tip. Rules (G = twig generations):
   *   A(g) -> F(g) E            if g == G
   *   A(g) -> F(g) C C?         otherwise: two children (one is kept with probability 0.45 from g = 2)
   *   C(g) -> [ T B A(g+1) ]    splits off at the parent's tip, bends sideways and up
   * Generation 1 is always the two twigs reaching to the limb's crown, one on each side.
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
          { c: 'B', fn: (d) => d.clone().addScaledVector(side, sd * lat).add(jit).add(new Vector3(0, 0.3, 0)) },
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
        .add(new Vector3(0, radii.y * this.rand(-0.05, 0.25), 0));
      const d = tip.clone().sub(fork);
      axiom.push({ c: '[' }, { c: 'B', fn: () => d.clone() }, { c: 'A', len: d.length() / reach, rad: 0.075 * tw, g: 1 }, { c: ']' });
    }
    // Leaves grow where the twigs end: every outermost twig tip carries its own clump.
    const ends = [];
    runTurtle(lsystem(axiom, rules, 4 * G), fork, L.tip.clone().sub(L.start), (b) => branch(b.pos, b.end, b.rad), (sym, p) => {
      if (sym.c === 'E') ends.push(p);
    });
    for (const p of ends) {
      const r = new Vector3(radii.x * 0.33, radii.y * 0.36, radii.z * 0.33).multiplyScalar(shrink * this.rand(0.85, 1.15));
      crown(p, r, (p.y - C.y) / radii.y, L.a + p.x, 0.9 * shrink);
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
