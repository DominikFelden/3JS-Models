import { SphereGeometry } from 'three';
import { WorldModel, shared, material } from '../WorldModel.js';

/** Bush: three overlapping squashed spheres. Collider: one sphere (radius 0.7). */
export class Bush extends WorldModel {
  constructor(options) {
    super('Bush', options);
    const g = shared('bush:sphere', () => new SphereGeometry(1, 8, 6));
    const m = material(0x4a9a3c, true);
    this.addMesh(g, m, [0, 0.4, 0], [0.7, 0.55, 0.7]);
    this.addMesh(g, m, [0.45, 0.3, 0.1], [0.5, 0.4, 0.5]);
    this.addMesh(g, m, [-0.4, 0.3, -0.2], [0.5, 0.4, 0.5]);
    this.addShape('sphere', { radius: 0.7 }, [0, 0.4, 0]);
  }
}
