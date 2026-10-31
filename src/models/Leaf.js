import { BufferGeometry, Float32BufferAttribute, DoubleSide, MeshStandardMaterial, Vector3, Matrix4, Quaternion } from 'three';
import { shared } from '../WorldModel.js';

const UP = new Vector3(0, 1, 0);

/** Double-sided, vertex-coloured leaf material (flat leaves must be visible from below). */
export function leafMaterial() {
  return shared('leaf:mat', () => new MeshStandardMaterial({ roughness: 0.9, vertexColors: true, side: DoubleSide }));
}

function flatGeometry(points) {
  // Fan around the base-centre point; blade lies in the XZ plane (stem at origin, tip along +Z, normal +Y).
  const pos = [];
  const idx = [];
  points.forEach(([x, z]) => pos.push(x, 0, z));
  for (let i = 1; i < points.length - 1; i++) idx.push(0, i + 1, i);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(points.flatMap(() => [0, 1, 0]), 3));
  g.setIndex(idx);
  return g;
}

/**
 * A single flat leaf. The blade lies in the local XZ plane: stem at the origin,
 * tip along +Z, upper face towards +Y, unit length and unit width.
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
