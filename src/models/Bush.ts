import { IcosahedronGeometry, Mesh, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared, material, mulberry32 } from '../WorldModel.ts';
import { treeStyle } from './branching.ts';
import { pooledMaterial, textureMean } from '../textures/pool.ts';
import { leafCardMaterial, leafCardGeometry, CARD_GRID } from './leafCards.ts';

/** Mean size of a leaf card of a bush (world units, times `leafSize`): smaller than a tree's, a bush is small. */
const BUSH_CARD_SIZE = 0.3;
/** Core blobs fill this share of their clump's radius; the leaf cards sit around them. */
const CORE = 0.6;
/** Mean radius (share of the clump's) of the card shell. */
const SHELL = 0.85;
/** Cards per (shell radius / card size)^2: enough clumped cards to hide the core from every side. */
const COVER = 36;
/** `lowPoly` bushes (seen from afar) have leaf cards this much bigger ... */
const LOW_POLY_CARD_SIZE = 1.6;
/** ... and this share of the cards it takes to hide the core with them. */
const LOW_POLY_COVER = 0.75;

/** Van der Corput sequence: spreads any number of cards evenly over the heights of a clump. */
const vdc = (i) => { let v = 0, f = 0.5; for (; i > 0; i >>= 1, f /= 2) if (i & 1) v += f; return v; };

/**
 * Bush: 3-6 overlapping leaf clumps made like the crown of a `StylizedTree`: every clump is a
 * small, dark foliage blob deep inside a shell of camera-facing, hand-inked leaf cards (alpha
 * cut), with enough cards to hide the blob from every side. Blobs and cards share the normals
 * of the whole bush's ellipsoid, so it is lit as one soft volume. The seed picks the leaf shape
 * (oval, slender, round, pointed), the foliage texture (`textures: {foliage}` pins one), the
 * size, the number and spread of the clumps and whether it carries berries; with `leafSize` and
 * `leafColor` (as for trees) you tweak the leaves. ~500-2100 triangles (about 1150 on average,
 * mostly leaf cards), 2 draw calls (blobs, cards) or 3 with berries. Collider: one sphere around
 * the whole bush.
 *
 * lowPoly: true gives a cheap copy of the same bush (same seed, same clumps, berries and collider)
 * for distances where single leaves are a few pixels (forests cross-fade to it around 25 m): 20-sided
 * blobs and berries, leaf cards 1.6x as big and 30% as many (each at the spot of one of the full
 * bush's cards); ~150-600 triangles, 3.5-3.8x fewer.
 */
export class Bush extends WorldModel {
  declare random: any;
  declare cardCount: number;
  declare lowPoly: boolean;
  declare crown: { center: Vector3, radii: Vector3 };
  constructor(options: any = {}) {
    super('Bush', options);
    this.lowPoly = !!options.lowPoly;
    const style = treeStyle(options);
    const foliage = this.variant('foliage');
    const core = pooledMaterial('foliage', foliage, { color: style.leafColor ?? null, flatShading: false, vertexColors: true, roughness: 1 });
    const leafColor = style.leafColor !== undefined ? new Color(style.leafColor) : textureMean('foliage', foliage);
    const cardSize = BUSH_CARD_SIZE * (style.leafSize ?? 1) * (this.lowPoly ? LOW_POLY_CARD_SIZE : 1);
    const cover = COVER * (this.lowPoly ? LOW_POLY_COVER : 1);
    // Leaf shape (atlas row) from its own stream, so it never moves the shapes drawn by `this.random`.
    const leafShape = Math.floor(mulberry32(this.seed ^ 0xb05e)() * CARD_GRID);

    // Bush ellipsoid: wide and low; the clumps sit inside it.
    const width = this.rand(0.75, 1.15), height = this.rand(0.55, 0.85);
    const radii = new Vector3(width, height, width * this.rand(0.85, 1.1));
    const center = new Vector3(0, height * 0.85, 0);
    this.crown = { center: center.clone(), radii: radii.clone() };

    const clumps: { center: Vector3, radii: Vector3, n: number }[] = [];
    const count = 3 + Math.floor(this.random() * 4);
    const blob = this.lowPoly ? shared('bush:blob0', () => new IcosahedronGeometry(1, 0)) : shared('bush:blob', () => new IcosahedronGeometry(1, 1));
    const b = new MergeBuilder();
    for (let i = 0; i < count; i++) {
      const a = this.rand(0, Math.PI * 2), spread = i === 0 ? 0 : this.rand(0.35, 0.6);
      const size = i === 0 ? this.rand(0.62, 0.72) : this.rand(0.45, 0.6);
      const r = new Vector3(radii.x * size, radii.y * size * this.rand(0.85, 1.1), radii.z * size);
      const at = new Vector3(Math.cos(a) * spread * radii.x, this.rand(-0.25, 0.2) * radii.y, Math.sin(a) * spread * radii.z).add(center);
      // The central clump's centre sits exactly 0.4 radii above the ground, so its core (0.6 radii)
      // is partly buried and always touches the ground; the others are never lower than that.
      at.y = i === 0 ? r.y * 0.4 : Math.max(at.y, r.y * 0.4);
      const n = Math.max(8, Math.ceil(cover * (SHELL * (r.x + r.y + r.z) / 3 / cardSize) ** 2));
      const k = 0.55 + this.rand(0, 0.15) + 0.2 * (at.y / (radii.y * 2));
      b.add(blob, core, { position: at.toArray(), scale: r.clone().multiplyScalar(CORE).toArray(), yaw: a, tint: [k * this.rand(0.95, 1.08), k, k * this.rand(0.9, 1)] });
      clumps.push({ center: at, radii: r, n });
    }
    if (this.random() < 0.4) {
      const berry = material(0xb02a3a, true);
      for (let i = 0; i < 6; i++) {
        const a = this.rand(0, Math.PI * 2), h = this.rand(0.1, 0.7);
        const ring = Math.sqrt(1 - h * h);
        // Berries sit between a clump's core and its leaf cards, so the cards hide them instead of
        // leaving them floating outside the foliage.
        const clump = clumps[i % clumps.length];
        const p = clump.center.clone().add(new Vector3(Math.cos(a) * ring, h, Math.sin(a) * ring).multiply(clump.radii).multiplyScalar(0.7));
        p.y = Math.max(p.y, 0.1);
        b.add(blob, berry, { position: p.toArray(), scale: [0.045, 0.045, 0.045] });
      }
    }
    b.build(this);
    this.children.forEach((m: any) => { if (m.material === core) this._bushNormals(m.geometry, 0.6); });

    // Leaf cards: a golden-angle spiral all round each clump, each clump with its own PRNG stream.
    const cards = [];
    const seeds = clumps.map(() => (this.random() * 0x100000000) >>> 0);
    const a0 = this.rand(0, Math.PI * 2);
    clumps.forEach((cl, k) => {
      const r = mulberry32(seeds[k]);
      const rand = (lo, hi) => lo + r() * (hi - lo);
      for (let i = 0; i < cl.n; i++) {
        const h = -0.9 + 1.87 * vdc(i + 1);
        const ring = Math.sqrt(1 - h * h);
        const a = a0 + i * 2.39996 + (r() - 0.5) * 0.5;
        const depth = rand(0.65, 1);
        const at = cl.center.clone().add(new Vector3(Math.cos(a) * ring, h, Math.sin(a) * ring).multiply(cl.radii).multiplyScalar(depth));
        at.y = Math.max(at.y, r() * 0.05); // low cards rest on the ground, half buried, rather than floating
        const v = (0.8 + 0.25 * Math.min(1, at.y / (radii.y * 2))) * (0.85 + 0.15 * (depth - 0.65) / 0.35);
        cards.push({
          center: at, size: rand(0.85, 1.15) * cardSize, angle: r() * Math.PI * 2,
          clump: leafShape * CARD_GRID + Math.floor(r() * CARD_GRID), aspect: rand(0.8, 1.25), flip: r() < 0.5,
          normal: this._bushNormal(at, null, 0), tint: [v * rand(0.96, 1.06), v, v * rand(0.9, 1)],
        });
      }
    });
    this.cardCount = cards.length;
    const geo = leafCardGeometry(cards);
    this._ownedGeometries.push(geo);
    const mesh = new Mesh(geo, leafCardMaterial(leafColor));
    // Cards neither cast nor receive shadows: the opaque foliage cores cast the bush's shadow.
    mesh.castShadow = mesh.receiveShadow = false;
    this.add(mesh);
    this.addShape('sphere', { radius: Math.max(radii.x, radii.z) }, [0, center.y, 0]);
  }

  /** Normal at `p`: the bush ellipsoid's, leaning to the sky, mixed with `own` (weight 1 - `w`). */
  _bushNormal(p: Vector3, own: Vector3 | null, w: number) {
    const { center: c, radii: r } = this.crown;
    const n = new Vector3((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();
    n.y += 0.45;
    n.normalize();
    if (own && w < 1) n.multiplyScalar(w).addScaledVector(own, 1 - w).normalize();
    return n;
  }

  /** Bend a geometry's normals towards the bush (weight `w`). */
  _bushNormals(g, w: number) {
    const pos = g.attributes.position, nor = g.attributes.normal;
    const p = new Vector3(), own = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const n = this._bushNormal(p.fromBufferAttribute(pos, i), own.fromBufferAttribute(nor, i), w);
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }
}
