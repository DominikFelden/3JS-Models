import { BoxGeometry, ConeGeometry, Shape, ExtrudeGeometry } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.js';

/** Available house types (value of the `type` option). */
export const HOUSE_TYPES = ['cottage', 'longhouse', 'towerhouse'];

// Palettes: colours are picked per instance from these, so houses vary.
const WALLS = [0xd9c8a9, 0xc9b79c, 0xe6dccb, 0xb89f7d, 0xcfd2c8];
const ROOFS = [0x8b2f2f, 0x6b4a2f, 0x4a5d6b, 0x7a3b2b];

/** Unit box, scaled per use. */
const boxG = () => shared('house:box', () => new BoxGeometry(1, 1, 1));

/**
 * Pyramid roof: a 4-sided cone pre-rotated 45 degrees so its base is an
 * axis-aligned square with half-side 0.707 (radius 1). Scale x/z to fit.
 */
const pyramidG = () => shared('house:pyramid', () => {
  const g = new ConeGeometry(1, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
});

/**
 * Gable roof: triangular prism, base 2 wide (x) and 1 high (y), ridge along Z,
 * depth 1 (z) centred on the origin. Scale to fit.
 */
const gableG = () => shared('house:gable', () => {
  const tri = new Shape();
  tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1); tri.closePath();
  const g = new ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
});

/** Per-type base dimensions: w (x), d (z), h wall height, roof height, roof shape. */
const SPECS = {
  cottage:    { w: 3.5, d: 3.0, h: 2.2, roofH: 1.4, roof: 'pyramid' },
  longhouse:  { w: 2.8, d: 6.0, h: 2.0, roofH: 1.5, roof: 'gable' },
  towerhouse: { w: 2.4, d: 2.4, h: 5.0, roofH: 2.0, roof: 'pyramid' },
};

/**
 * House with windows and a door. Base at y = 0, centred on the origin, door on
 * the +Z side.
 *
 * Options (besides the WorldModel ones):
 *  - type: 'cottage' | 'longhouse' | 'towerhouse' (default 'cottage')
 *
 * Wall colour, roof colour, exact proportions and window layout vary per
 * instance (random `seed` by default).
 *
 * Colliders: [body box, roof convex hull]. Tags: 'body', 'roof'.
 * Windows: see `getWindows()`; they are not colliders.
 */
export class House extends WorldModel {
  constructor(options = {}) {
    super('House', options);
    this.type = HOUSE_TYPES.includes(options.type) ? options.type : 'cottage';
    const spec = SPECS[this.type];
    const rnd = this.random;

    // Slight random proportions so no two houses are identical.
    const w = spec.w * this.rand(0.9, 1.15);
    const d = spec.d * this.rand(0.9, 1.15);
    const h = spec.h * this.rand(0.9, 1.1);
    const roofH = spec.roofH * this.rand(0.9, 1.15);
    const wallMat = material(WALLS[Math.floor(rnd() * WALLS.length)], true);
    const roofMat = material(ROOFS[Math.floor(rnd() * ROOFS.length)], true);
    const doorMat = material(0x4a3322);

    const b = new MergeBuilder();
    b.add(boxG(), wallMat, { position: [0, h / 2, 0], scale: [w, h, d] });
    this.addShape('box', { size: [w, h, d] }, [0, h / 2, 0], null, 'body');

    // Roof with a small overhang (x1.1).
    const ow = w * 1.1, od = d * 1.1;
    if (spec.roof === 'pyramid') {
      // Square cone base has half-side 0.707 -> scale = half-extent / 0.707.
      b.add(pyramidG(), roofMat, { position: [0, h + roofH / 2, 0], scale: [ow / 1.4142, roofH, od / 1.4142] });
      this.addShape('convex', { points: [
        [-ow / 2, h, -od / 2], [ow / 2, h, -od / 2], [ow / 2, h, od / 2], [-ow / 2, h, od / 2],
        [0, h + roofH, 0],
      ] }, [0, 0, 0], null, 'roof');
    } else {
      b.add(gableG(), roofMat, { position: [0, h, 0], scale: [ow / 2, roofH, od] });
      this.addShape('convex', { points: [
        [-ow / 2, h, -od / 2], [ow / 2, h, -od / 2], [ow / 2, h, od / 2], [-ow / 2, h, od / 2],
        [0, h + roofH, -od / 2], [0, h + roofH, od / 2],
      ] }, [0, 0, 0], null, 'roof');
    }

    // Door on +Z, slightly protruding.
    const doorW = 0.7, doorH = 1.3;
    const doorX = this._pick([-0.25, 0, 0.25]) * w * 0.5;
    b.add(boxG(), doorMat, { position: [doorX, doorH / 2, d / 2 + 0.03], scale: [doorW, doorH, 0.08] });

    // Windows: columns spread along each wall, one row per ~2 units of height.
    const rows = Math.max(1, Math.floor(h / 2.2));
    const faces = [
      { yaw: 0, len: w, at: (u, y) => [u, y, d / 2] },            // +Z (front)
      { yaw: Math.PI, len: w, at: (u, y) => [-u, y, -d / 2] },    // -Z (back)
      { yaw: Math.PI / 2, len: d, at: (u, y) => [w / 2, y, -u] }, // +X
      { yaw: -Math.PI / 2, len: d, at: (u, y) => [-w / 2, y, u] },// -X
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor(f.len / 1.6));
      for (let r = 0; r < rows; r++) {
        const y = (h / rows) * (r + 0.55);
        for (let c = 0; c < cols; c++) {
          let u = (c + 0.5) / cols * f.len - f.len / 2;
          // Keep the front-ground-floor windows clear of the door.
          if (f.yaw === 0 && r === 0 && Math.abs(u - doorX) < 0.75) continue;
          if (rnd() < 0.12) continue; // occasional gap = variety
          this.addWindow(b, f.at(u, y), f.yaw, 0.55, 0.75);
        }
      }
    }
    b.build(this);
  }

  /** Pick one element using the model PRNG. */
  _pick(arr) {
    return arr[Math.floor(this.random() * arr.length)];
  }
}
