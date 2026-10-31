import { IcosahedronGeometry } from 'three';
import { WorldModel, shared, material, mulberry32 } from '../WorldModel.js';

/** Number of distinct rock shapes (bounds the shared geometry cache). */
export const ROCK_VARIANTS = 64;

/**
 * Rock: icosahedron with randomly displaced vertices (flat shaded).
 * The model's `seed` (random by default, see WorldModel) selects one of
 * ROCK_VARIANTS shapes (seed % ROCK_VARIANTS). Geometry is cached per variant,
 * so any number of rocks share at most ROCK_VARIANTS sets of GPU buffers, and
 * the same seed always gives the same rock.
 * Collider: 'convex' hull = the displaced vertices (a rock is convex enough).
 */
export class Rock extends WorldModel {
  constructor(options = {}) {
    super('Rock', options);
    const variant = this.seed % ROCK_VARIANTS;
    const g = shared(`rock:${variant}`, () => {
      const geo = new IcosahedronGeometry(0.8, 0); // 12 vertices before subdivision
      const rnd = mulberry32(variant);
      const pos = geo.attributes.position;
      const moved = new Map(); // same displacement for coincident vertices, avoids cracks
      for (let i = 0; i < pos.count; i++) {
        const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(4)).join();
        if (!moved.has(key)) moved.set(key, 0.75 + rnd() * 0.5);
        const f = moved.get(key);
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.7, pos.getZ(i) * f);
      }
      geo.computeVertexNormals();
      // Unique vertex positions, for the exposed convex hull.
      const pts = new Map();
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        pts.set(p.map((v) => v.toFixed(4)).join(), p);
      }
      geo.userData.hull = [...pts.values()];
      return geo;
    });
    this.addMesh(g, material(0x8a8a8a, true), [0, 0.3, 0]);
    // Shift hull up so the rock sits roughly on y = 0.
    this.addShape('convex', { points: g.userData.hull.map(([x, y, z]) => [x, y + 0.3, z]) });
  }
}
