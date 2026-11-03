import { BufferGeometry, Float32BufferAttribute, Vector3, Matrix4, Quaternion } from 'three';
import { shared } from '../WorldModel.js';

const UP = new Vector3(0, 1, 0);

/** Planar UVs: the whole 'leaf' texture (stem at v = 0, tip at v = 1, midrib at u = 0.5) spans the blade. */
const leafUV = ([x, z]) => [Math.min(1, Math.max(0, x + 0.5)), Math.min(1, Math.max(0, z))];

function flatGeometry(points) {
  // Fan around the base-centre point; blade lies in the XZ plane (stem at origin, tip along +Z, normal +Y).
  const pos = [];
  const idx = [];
  points.forEach(([x, z]) => pos.push(x, 0, z));
  for (let i = 1; i < points.length - 1; i++) idx.push(0, i + 1, i);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(points.flatMap(() => [0, 1, 0]), 3));
  g.setAttribute('uv', new Float32BufferAttribute(points.flatMap(leafUV), 2));
  g.setIndex(idx);
  return g;
}

/**
 * A single flat leaf. The blade lies in the local XZ plane: stem at the origin,
 * tip along +Z, upper face towards +Y, unit length and unit width. Its UVs
 * map the pooled 'leaf' texture (midrib, veins) onto the blade once.
 *
 * `place(builder, material, ...)` orients it like a real leaf: it grows
 * outward from the twig, hangs down under its own weight (`droop`), and its
 * upper face turns towards the sky (a hanging leaf's face looks outward).
 * Subclasses only supply `geometry()`.
 */
export class Leaf {
  /** Flat blade geometry, shared by all instances of the subclass. */
  static geometry() { throw new Error('Leaf subclasses must implement geometry()'); }

  /**
   * @param {Vector3} position twig point the leaf is attached to
   * @param {Vector3} outward  horizontal direction away from the tree (need not be normalised)
   * @param {object} o         {length, width, droop (rad below horizontal), roll (rad), tint}
   */
  constructor(position, outward, { length = 0.4, width = 0.25, droop = 0.7, roll = 0, tint = 1 } = {}) {
    this.position = position;
    this.length = length;
    this.width = width;
    this.tint = tint;
    const h = new Vector3(outward.x, 0, outward.z).normalize();
    // Blade direction: outward, tilted down by `droop`.
    const d = h.multiplyScalar(Math.cos(droop)).addScaledVector(UP, -Math.sin(droop)).normalize();
    // Upper face: as close to the sky as the blade direction allows, then rolled a bit about the blade axis.
    const n = UP.clone().addScaledVector(d, -UP.dot(d)).normalize().applyAxisAngle(d, roll);
    const x = new Vector3().crossVectors(n, d);
    this.quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, n, d));
    this.direction = d;
  }

  place(builder, mat) {
    builder.add(this.constructor.geometry(), mat, {
      position: this.position.toArray(),
      quaternion: this.quaternion,
      scale: [this.width, 1, this.length],
      tint: this.tint,
    });
  }
}

/** Flat oval (elliptical) leaf, widest at the middle. */
export class OvalLeaf extends Leaf {
  static geometry() {
    return shared('leaf:oval', () => {
      const pts = [[0, 0]];
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([0.5 * Math.sin(t), 0.5 - 0.5 * Math.cos(t)]);
      }
      return flatGeometry(pts);
    });
  }
}

/** Flat triangular leaf, broad at the stem and pointed at the tip. */
export class TriangleLeaf extends Leaf {
  static geometry() {
    return shared('leaf:triangle', () => flatGeometry([[-0.5, 0], [0.5, 0], [0, 1]]));
  }
}

/** Triangles (each [[x,z],[x,z],[x,z]]) approximating an ellipse centred at (cx, cz), rotated by `rot` about its centre. */
function ellipse(cx, cz, rx, rz, rot = 0, n = 10) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(t), z = rz * Math.sin(t);
    ring.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return ring.map((p, i) => [[cx, cz], ring[(i + 1) % n], p]);
}

/** Flat geometry from triangles in the XZ plane; every triangle is wound so its face looks up (+Y). */
function trianglesGeometry(tris) {
  const pos = [];
  const uv = [];
  tris.forEach(([a, b, c]) => {
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const t = cross > 0 ? [a, c, b] : [a, b, c];
    t.forEach((p) => { pos.push(p[0], 0, p[1]); uv.push(...leafUV(p)); });
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** Oak leaf: a long central oval with three pairs of smaller, angled oval lobes. */
export class OakLeaf extends Leaf {
  static geometry() {
    return shared('leaf:oak', () => {
      const t = ellipse(0, 0.5, 0.17, 0.5, 0, 10);
      [[0.22, 0.22, 0.2, 0.9], [0.45, 0.2, 0.18, 0.9], [0.68, 0.14, 0.15, 0.8]].forEach(([z, off, r, ang]) => {
        t.push(...ellipse(off + r * 0.6, z, r, r * 0.65, -ang + 0.3, 8), ...ellipse(-off - r * 0.6, z, r, r * 0.65, ang - 0.3, 8));
      });
      return trianglesGeometry(t);
    });
  }
}

/** Maple (Ahorn) leaf: five pointed lobes, each a triangle, fanning out from the stem. */
export class MapleLeaf extends Leaf {
  static geometry() {
    return shared('leaf:maple', () => {
      const base = [0, 0.18];
      const lobe = (ang, len, w) => {
        const tip = [Math.sin(ang) * len, base[1] + Math.cos(ang) * len];
        const nx = Math.cos(ang) * w, nz = -Math.sin(ang) * w;
        return [[base[0] + nx, base[1] + nz], tip, [base[0] - nx, base[1] - nz]];
      };
      return trianglesGeometry([
        lobe(0, 0.82, 0.14), lobe(0.75, 0.5, 0.13), lobe(-0.75, 0.5, 0.13),
        lobe(1.5, 0.4, 0.1), lobe(-1.5, 0.4, 0.1),
        [[-0.1, 0], [0.1, 0], [0, 0.3]],
      ]);
    });
  }
}

/** Birch leaf: a rhombus with a small second triangle pair for the serrated edge. */
export class BirchLeaf extends Leaf {
  static geometry() {
    return shared('leaf:birch', () => trianglesGeometry([
      [[0, 0], [-0.5, 0.4], [0.5, 0.4]],
      [[-0.5, 0.4], [0.5, 0.4], [0, 1]],
      [[-0.5, 0.4], [-0.32, 0.18], [-0.2, 0.4]],
      [[0.5, 0.4], [0.32, 0.18], [0.2, 0.4]],
    ]));
  }
}

/** Willow leaf: a long, very narrow lance made of two slim ovals. */
export class WillowLeaf extends Leaf {
  static geometry() {
    return shared('leaf:willow', () => trianglesGeometry([
      ...ellipse(0, 0.3, 0.3, 0.3, 0, 8), ...ellipse(0, 0.7, 0.28, 0.3, 0, 8),
    ].map((t) => t.map(([x, z]) => [x * 0.9, z]))));
  }
}

/** Ginkgo leaf: a fan-shaped blade split by a notch into two halves. */
export class GinkgoLeaf extends Leaf {
  static geometry() {
    return shared('leaf:ginkgo', () => {
      const tris = [];
      const n = 7;
      const edge = (i) => {
        const a = -1.2 + (i / n) * 2.4;
        const r = Math.abs(a) < 0.12 ? 0.6 : 1;
        return [Math.sin(a) * 0.5 * r, 0.12 + Math.cos(a) * 0.88 * r];
      };
      for (let i = 0; i < n; i++) tris.push([[0, 0], edge(i), edge(i + 1)]);
      return trianglesGeometry(tris);
    });
  }
}

/** Clover leaf: three round leaflets around the stem tip. */
export class CloverLeaf extends Leaf {
  static geometry() {
    return shared('leaf:clover', () => trianglesGeometry([
      ...ellipse(0, 0.7, 0.3, 0.3, 0, 10),
      ...ellipse(-0.3, 0.38, 0.28, 0.28, 0, 10),
      ...ellipse(0.3, 0.38, 0.28, 0.28, 0, 10),
      [[0, 0], [-0.1, 0.4], [0.1, 0.4]],
    ]));
  }
}

/** Ash leaf: pinnate - a stalk with pairs of small ovals and one at the tip. */
export class AshLeaf extends Leaf {
  static geometry() {
    return shared('leaf:ash', () => {
      const t = ellipse(0, 0.9, 0.12, 0.13, 0, 8);
      [0.15, 0.4, 0.65].forEach((z, i) => {
        const r = 0.17 - i * 0.02;
        t.push(...ellipse(0.2, z + 0.06, r, r * 0.5, -0.5, 8), ...ellipse(-0.2, z + 0.06, r, r * 0.5, 0.5, 8));
      });
      t.push([[-0.015, 0], [0.015, 0], [0, 0.9]]);
      return trianglesGeometry(t);
    });
  }
}

/** Leaf types selectable by name (e.g. in the viewer drop-down). */
export const LEAF_TYPES = {
  oak: OakLeaf, maple: MapleLeaf, birch: BirchLeaf,
  willow: WillowLeaf, ginkgo: GinkgoLeaf, clover: CloverLeaf, ash: AshLeaf,
};
