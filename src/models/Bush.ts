import { SphereGeometry } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

/**
 * Bush: a dense clump of ~8 squashed, differently tinted spheres, sometimes
 * with berries. The foliage texture is picked from the shared pool
 * (`textures: {foliage}` pins one). Collider: one sphere (radius 0.7).
 */
export class Bush extends WorldModel {
  declare random: any;
  constructor(options) {
    super('Bush', options);
    const g = shared('bush:sphere', () => new SphereGeometry(1, 7, 5));
    const green = this.surface('foliage');
    const b = new MergeBuilder();
    for (let i = 0; i < 8; i++) {
      const a = this.rand(0, Math.PI * 2), r = i === 0 ? 0 : this.rand(0.2, 0.5);
      const s = i === 0 ? 0.65 : this.rand(0.3, 0.5);
      const y = 0.25 + (i === 0 ? 0.15 : this.rand(0, 0.25));
      const k = 0.75 + y * 0.6 + this.rand(-0.08, 0.08);
      b.add(g, green, {
        position: [Math.cos(a) * r, y, Math.sin(a) * r], scale: [s, s * 0.75, s], yaw: a, detail: 1.7,
        tint: [k * this.rand(0.95, 1.15), k, k * this.rand(0.8, 1)],
      });
    }
    if (this.random() < 0.4) {
      const berry = material(0xb02a3a, true);
      for (let i = 0; i < 6; i++) {
        const a = this.rand(0, Math.PI * 2), r = this.rand(0.35, 0.65);
        b.add(g, berry, { position: [Math.cos(a) * r, this.rand(0.3, 0.6), Math.sin(a) * r], scale: [0.05, 0.05, 0.05] });
      }
    }
    b.build(this);
    this.addShape('sphere', { radius: 0.7 }, [0, 0.4, 0]);
  }
}
