import { CylinderGeometry, IcosahedronGeometry, Mesh, Quaternion, Vector3, Color } from 'three';
import { WorldModel, MergeBuilder, shared } from '../WorldModel.ts';
import { treeStyle } from './branching.ts';
import { pooledMaterial, textureMean } from '../textures/pool.ts';
import { leafCardMaterial, leafCardDepthMaterial, leafCardGeometry } from './leafCards.ts';

/** Highest StylizedTree complexity. */
export const MAX_STYLIZED_COMPLEXITY = 4;

/** Leaf cards per complexity. Lower complexities keep the first cards of higher ones (same seed). */
export const STYLIZED_CARDS = [0, 14, 24, 36, 50];

const Y = new Vector3(0, 1, 0);
const vdc = (i) => { let v = 0, f = 0.5; for (; i > 0; i >>= 1, f /= 2) if (i & 1) v += f; return v; };

/**
 * Stylized tree for big forests and mobile: the illusion of leaves instead of
 * leaves. A solid core of a few smooth foliage blobs fills the crown (no
 * see-through overdraw) and camera-facing leaf cards (hand-inked clumps cut
 * out by alpha test) break up its outline. Cards and blobs share the normals
 * of the crown's ellipsoid, so the crown is lit as one soft volume.
 *
 * complexity 0..4 (default 2): number of leaf cards (`STYLIZED_CARDS`).
 *   0 = blobs only (cheapest, e.g. a far level). The crown shape is the same
 *   for every complexity of a seed, so detail levels blend into each other.
 * Cost at complexity 2: ~800 triangles, 3 draw calls (bark, core, cards).
 *
 * The seed picks the bark and foliage textures (`textures: {bark, foliage}`
 * pins them) and the shape. Options as the other trees: trunkHeight,
 * trunkThickness, leafSize (card size factor), trunkColor, leafColor.
 *
 * Colliders: [trunk cylinder, crown sphere] (tags 'trunk', 'crown'), enough
 * for physics; `crown` holds the crown ellipsoid { center, radii }.
 */
export class StylizedTree extends WorldModel {
  declare complexity: any;
  declare crown: any;
  declare cardCount: any;
  declare random: any;
  constructor(options: any = {}) {
    super('StylizedTree', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_STYLIZED_COMPLEXITY, 2);
    const rnd = this.random;
    const st = treeStyle(options);
    const bark = this.surface('bark', st.trunkColor, false);
    const foliage = this.variant('foliage');
    const core = pooledMaterial('foliage', foliage, { color: st.leafColor ?? null, flatShading: false, vertexColors: true, roughness: 1 });
    const leafColor = st.leafColor !== undefined ? new Color(st.leafColor) : textureMean('foliage', foliage);

    const th = this.rand(0.85, 1.3) * (st.trunkHeight ?? 1);
    const tw = this.rand(0.85, 1.2) * (st.trunkThickness ?? 1);
    const cs = this.rand(0.85, 1.25);
    const ls = st.leafSize ?? 1;
    const H = 2.1 * th;
    const radii = new Vector3(1.9 * cs, 1.55 * cs * this.rand(0.85, 1.2), 1.9 * cs * this.rand(0.85, 1.1));
    const C = new Vector3(0, H + radii.y * 0.6, 0);
    this.crown = { center: C.clone(), radii: radii.clone() };

    const b = new MergeBuilder();
    b.add(shared('stylized:trunk', () => new CylinderGeometry(0.16, 0.26, 1, 7)), bark, { position: [0, (H + radii.y * 0.5) / 2, 0], scale: [tw, H + radii.y * 0.5, tw] });
    b.add(shared('stylized:flare', () => new CylinderGeometry(0.24, 0.42, 0.4, 7)), bark, { position: [0, 0.2, 0], scale: [tw, 1, tw] });
    const limb = shared('stylized:limb', () => { const g = new CylinderGeometry(0.6, 1, 1, 5); g.translate(0, 0.5, 0); return g; });
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const dir = new Vector3(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize();
      b.add(limb, bark, { position: [0, H * this.rand(0.8, 0.95), 0], quaternion: new Quaternion().setFromUnitVectors(Y, dir), scale: [0.09 * tw, radii.y * 0.95, 0.09 * tw] });
    }
    this.addShape('cylinder', { radius: 0.26 * tw, height: H }, [0, H / 2, 0], null, 'trunk');

    // Core: one big blob and a ring of smaller ones, darker inside the crown.
    const blob = shared('stylized:blob', () => new IcosahedronGeometry(1, 1));
    b.add(blob, core, { position: C.toArray(), scale: radii.clone().multiplyScalar(0.72).toArray(), tint: this._tint(0.45, 0.8) });
    const blobs = 5 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < blobs; i++) {
      const a = a0 + (i / blobs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
      const h = this.rand(-0.35, 0.55);
      const d = new Vector3(Math.cos(a) * Math.sqrt(1 - h * h), h, Math.sin(a) * Math.sqrt(1 - h * h));
      const s = this.rand(0.42, 0.55);
      b.add(blob, core, {
        position: C.clone().add(d.clone().multiply(radii).multiplyScalar(0.45)).toArray(),
        scale: radii.clone().multiplyScalar(s).toArray(), yaw: a, tint: this._tint(0.5 + 0.5 * h, 0.85),
      });
    }
    b.build(this);
    this.children.forEach((m: any) => { if (m.material === core) this._crownNormals(m.geometry, 0.7); });

    // Leaf cards on the crown surface: a golden-angle spiral with van der Corput heights covers it
    // evenly for any count, and the first cards never move when more are added.
    const cards = [];
    this.cardCount = STYLIZED_CARDS[this.complexity];
    for (let i = 0; i < this.cardCount; i++) {
      const h = -0.4 + 1.38 * vdc(i + 1);
      const ring = Math.sqrt(Math.max(0, 1 - Math.min(1, h) ** 2));
      const a = a0 + i * 2.39996 + (rnd() - 0.5) * 0.5;
      const dir = new Vector3(Math.cos(a) * ring, Math.min(1, h), Math.sin(a) * ring);
      const center = C.clone().add(dir.clone().multiply(radii).multiplyScalar(this.rand(0.8, 0.95)));
      const size = this.rand(1.05, 1.4) * cs * ls;
      const angle = rnd() * Math.PI * 2;
      const clump = Math.floor(rnd() * 4);
      cards.push({ center, size, angle, clump, normal: this._crownNormal(center, null, 0), tint: this._tint(0.5 + 0.5 * dir.y, 1) });
    }
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

  /** Brightness tint: lit on top (`height01` = 1), darker below; `k` darkens the core. */
  _tint(height01, k) {
    const v = k * (0.85 + 0.25 * Math.min(1, Math.max(0, height01)) + this.rand(-0.06, 0.06));
    return [v * this.rand(0.96, 1.06), v, v * this.rand(0.9, 1)];
  }

  /** Normal of the crown ellipsoid at `p`, mixed with `own` (weight 1 - `w`). */
  _crownNormal(p, own, w) {
    const { center: c, radii: r } = this.crown;
    const n = new Vector3((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();
    n.y += 0.45; // lean towards the sky: soft, painted shading instead of a black underside
    n.normalize();
    if (own && w < 1) n.multiplyScalar(w).addScaledVector(own, 1 - w).normalize();
    return n;
  }

  /** Bend a geometry's normals towards the crown ellipsoid (weight `w`). */
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
