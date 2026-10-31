import { IcosahedronGeometry } from 'three';
import { WorldModel, shared, material } from '../WorldModel.js';

/** Small deterministic PRNG so the same seed always gives the same rock. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rock: icosahedron with randomly displaced vertices (flat shaded).
 * Option `seed` (integer) selects one of the shape variants; geometry is
 * cached per seed so equal seeds share buffers.
 * Collider: 'convex' hull = the displaced vertices (a rock is convex enough).
 */
export class Rock extends WorldModel {
  constructor(options = {}) {
    super('Rock', options);
    const seed = options.seed ?? 0;
    const g = shared(`rock:${seed}`, () => {
      const geo = new IcosahedronGeometry(0.8, 0); // 12 vertices before subdivision
      const rnd = mulberry32(seed);
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
