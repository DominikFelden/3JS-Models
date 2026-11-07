import { CylinderGeometry, IcosahedronGeometry, Mesh, Quaternion, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared, mulberry32 } from '../WorldModel.ts';
import { treeStyle, lsystem, runTurtle } from './branching.ts';
import { pooledMaterial, textureMean } from '../textures/pool.ts';
import { leafCardMaterial, leafCardDepthMaterial, leafCardGeometry } from './leafCards.ts';

/** Highest StylizedTree complexity. */
export const MAX_STYLIZED_COMPLEXITY = 10;

/**
 * Leaf cards per complexity. Up to 4 they sit on one crown and lower complexities keep the first
 * cards of higher ones (same seed); 5 to 10 share them out over the branch crowns.
 */
export const STYLIZED_CARDS = [0, 14, 24, 36, 50, 72, 96, 120, 150, 185, 225];

const Y = new Vector3(0, 1, 0);
const vdc = (i) => { let v = 0, f = 0.5; for (; i > 0; i >>= 1, f /= 2) if (i & 1) v += f; return v; };
const ellipsoidNormal = (p, c, r, out) => out.set((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();

/**
 * Stylized tree for big forests and mobile: the illusion of leaves instead of
 * leaves. Solid, smooth foliage blobs fill the crown (no see-through overdraw)
 * and camera-facing leaf cards (hand-inked clumps cut out by alpha test) break
 * up its outline. Blobs and cards share the normals of the crown's ellipsoid,
 * so the crown is lit as one soft volume.
 *
 * complexity 0..10 (default 2):
 *   0..4  one crown on three limbs, with `STYLIZED_CARDS` leaf cards
 *         (0 = blobs only). Same crown for every complexity of a seed.
 *   5     first-level branching: 3-4 limbs, each carrying its own crown of
 *         blobs and cards (clumped, more painterly silhouette).
 *   6..10 each limb forks into twigs by an L-system (Lindenmayer system):
 *         6 = two twigs per limb, every further level rewrites each twig tip
 *         into one or two finer twigs (stochastic rule), so 10 has 5 twig
 *         generations and dozens of small crowns.
 *   All complexities of a seed fill the same crown envelope (`crown`), so
 *   detail levels blend into each other.
 * Cost: ~700 triangles at 2, ~900 at 5, ~1650 at 6, a few thousand at 10; always 3 draw calls
 * (bark, blobs, cards).
 *
 * lowPoly: true gives a cheap version of the same tree for mid distances:
 * 20-sided blobs and half the cards (~2.5x fewer triangles).
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
    const trunkTop = branched ? H : H + radii.y * 0.5;
    b.add(shared('stylized:trunk', () => new CylinderGeometry(0.16, 0.26, 1, 7)), bark, { position: [0, trunkTop / 2, 0], scale: [tw, trunkTop, tw] });
    b.add(shared('stylized:flare', () => new CylinderGeometry(0.24, 0.42, 0.4, 7)), bark, { position: [0, 0.2, 0], scale: [tw, 1, tw] });
    const limb = shared('stylized:limb', () => { const g = new CylinderGeometry(0.6, 1, 1, 5); g.translate(0, 0.5, 0); return g; });
    const branch = (from, to, r) => {
      const d = to.clone().sub(from);
      b.add(limb, bark, { position: from.toArray(), quaternion: new Quaternion().setFromUnitVectors(Y, d.clone().normalize()), scale: [r, d.length(), r] });
    };
    const blob = this.lowPoly
      ? shared('stylized:blob0', () => new IcosahedronGeometry(1, 0))
      : shared('stylized:blob', () => new IcosahedronGeometry(1, 1));
    const addBlob = (center, r, tint, yaw = 0) => b.add(blob, core, { position: center.toArray(), scale: r.toArray(), yaw, tint });
    const a0 = rnd() * Math.PI * 2;
    this.addShape('cylinder', { radius: 0.26 * tw, height: H }, [0, H / 2, 0], null, 'trunk');

    // Crowns that carry leaf cards: { center, radii, share of the cards, card size }.
    const crowns = [];
    if (!branched) {
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
        const dir = new Vector3(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
        b.add(limb, bark, { position: [0, H * this.rand(0.8, 0.95), 0], quaternion: new Quaternion().setFromUnitVectors(Y, dir), scale: [0.09 * tw, radii.y * 0.95, 0.09 * tw] });
      }
      // Core: one big blob and a ring of smaller ones, darker inside the crown.
      addBlob(C, radii.clone().multiplyScalar(0.72), this._tint(0.45, 0.8));
      const blobs = 5 + (rnd() < 0.5 ? 1 : 0);
      for (let i = 0; i < blobs; i++) {
        const a = a0 + (i / blobs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const h = this.rand(-0.35, 0.55);
        const d = new Vector3(Math.cos(a) * Math.sqrt(1 - h * h), h, Math.sin(a) * Math.sqrt(1 - h * h));
        const s = this.rand(0.42, 0.55);
        addBlob(C.clone().add(d.clone().multiply(radii).multiplyScalar(0.45)), radii.clone().multiplyScalar(s), this._tint(0.5 + 0.5 * h, 0.85), a);
      }
      crowns.push({ center: C, radii, share: 1, size: 1 });
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
        limbs.push({ a, h, tip, start: new Vector3(0, H * this.rand(0.72, 0.95), 0) });
      }
      // Dark filler in the middle: no holes between the branch crowns.
      addBlob(C.clone().add(new Vector3(0, 0.05 * radii.y, 0)), radii.clone().multiplyScalar(this.complexity >= 6 ? 0.36 : 0.42), this._tint(0.3, 0.7));
      const twigs = this.complexity >= 6;
      const G = this.complexity - 5; // twig generations (L-system iterations) per limb
      for (const L of limbs) {
        if (!twigs) {
          branch(L.start, L.tip, 0.1 * tw);
          const r = new Vector3(radii.x * 0.46, radii.y * 0.48, radii.z * 0.46).multiplyScalar(this.rand(0.9, 1.1));
          addBlob(L.tip, r.clone().multiplyScalar(0.92), this._tint(0.5 + 0.5 * L.h, 0.85), L.a);
          const up = L.tip.clone().add(new Vector3(Math.cos(L.a) * 0.25 * r.x, 0.45 * r.y, Math.sin(L.a) * 0.25 * r.z));
          addBlob(up, r.clone().multiplyScalar(this.rand(0.6, 0.72)), this._tint(0.8 + 0.2 * L.h, 0.9), L.a + 1);
          crowns.push({ center: L.tip, radii: r, share: 1 / n1, size: 0.9 });
        } else {
          const fork = L.start.clone().lerp(L.tip, this.rand(0.5, 0.65));
          branch(L.start, fork, 0.1 * tw);
          this._growTwigs(fork, L, G, radii, C, tw, branch, (c, r, hy, yaw, size) => {
            addBlob(c, r.clone().multiplyScalar(0.92), this._tint(0.5 + 0.5 * hy, 0.85), yaw);
            if (G < 3) {
              const top = c.clone().add(new Vector3(0, 0.45 * r.y, 0));
              addBlob(top, r.clone().multiplyScalar(this.rand(0.58, 0.7)), this._tint(0.8 + 0.2 * hy, 0.9), yaw + 1);
            }
            crowns.push({ center: c, radii: r, share: 0, size });
          });
        }
      }
      if (twigs) crowns.forEach((cr) => { cr.share = 1 / crowns.length; });
      this._subCrowns = crowns;
    }
    b.build(this);
    this.children.forEach((m: any) => { if (m.material === core) this._crownNormals(m.geometry, 0.7); });

    // Leaf cards on each crown's surface: a golden-angle spiral with van der Corput heights covers
    // it evenly for any count. Every crown has its own PRNG, so its first cards never move when
    // more are added (complexity, lowPoly).
    const total = Math.round(STYLIZED_CARDS[this.complexity] * (this.lowPoly ? 0.5 : 1));
    const cards = [];
    const seeds = crowns.map(() => (rnd() * 0x100000000) >>> 0);
    crowns.forEach((cr, k) => {
      const r = mulberry32(seeds[k]);
      const rand = (lo, hi) => lo + r() * (hi - lo);
      const n = Math.round(total * cr.share);
      const size = (this.lowPoly ? 1.15 : 1) * cr.size * cs * ls;
      for (let i = 0; i < n; i++) {
        const h = -0.4 + 1.38 * vdc(i + 1);
        const ring = Math.sqrt(Math.max(0, 1 - Math.min(1, h) ** 2));
        const a = a0 + i * 2.39996 + (r() - 0.5) * 0.5;
        const dir = new Vector3(Math.cos(a) * ring, Math.min(1, h), Math.sin(a) * ring);
        const center = cr.center.clone().add(dir.multiply(cr.radii).multiplyScalar(rand(0.8, 0.95)));
        const hy = (center.y - C.y) / radii.y;
        cards.push({
          center, size: rand(1.05, 1.4) * size, angle: r() * Math.PI * 2, clump: Math.floor(r() * 4),
          normal: this._crownNormal(center, null, 0), tint: this._tint(0.5 + 0.5 * hy, 1, rand),
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
   *   C(g) -> [ T B A(g+1) ]    forks from the outer part of the parent, bends sideways and up
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
        const t = 0.6 + 0.3 * rnd();
        const sd = n === 1 ? (rnd() < 0.5 ? -1 : 1) : s;
        const lat = 0.55 + 0.3 * rnd(), jit = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.3);
        return [
          { c: '[' }, { c: 'T', t },
          { c: 'B', fn: (d) => d.clone().addScaledVector(side, sd * lat).add(jit).add(new Vector3(0, 0.3, 0)) },
          { c: 'A', len: len * (0.68 + 0.14 * rnd()), rad: rad * 0.72, g },
          { c: ']' },
        ];
      },
    };
    const axiom: any[] = [];
    for (const s of [-1, 1]) {
      const tip = L.tip.clone()
        .addScaledVector(side, s * radii.x * this.rand(0.3, 0.42))
        .add(new Vector3(0, radii.y * this.rand(-0.05, 0.25), 0));
      const d = tip.clone().sub(fork);
      axiom.push({ c: '[' }, { c: 'B', fn: () => d.clone() }, { c: 'A', len: d.length(), rad: 0.065 * tw, g: 1 }, { c: ']' });
    }
    const ends = [];
    runTurtle(lsystem(axiom, rules, 4 * G), fork, L.tip.clone().sub(L.start), (b) => branch(b.pos, b.end, b.rad), (sym, p) => {
      if (sym.c === 'E') ends.push(p);
    });
    for (const p of ends) {
      // Keep the crown inside the shared crown envelope.
      const q = Math.sqrt(((p.x - C.x) / radii.x) ** 2 + ((p.y - C.y) / radii.y) ** 2 + ((p.z - C.z) / radii.z) ** 2);
      if (q > 0.95) p.sub(C).multiplyScalar(0.95 / q).add(C);
      const r = new Vector3(radii.x * 0.33, radii.y * 0.36, radii.z * 0.33).multiplyScalar(shrink * this.rand(0.85, 1.15));
      crown(p, r, (p.y - C.y) / radii.y, L.a + p.x, 0.75 * shrink);
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
