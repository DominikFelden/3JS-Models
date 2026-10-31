import { CylinderGeometry, SphereGeometry, ConeGeometry } from 'three';
import { WorldModel, shared, material } from '../WorldModel.js';

/**
 * Pine tree: trunk + three stacked cones. Base at y = 0, height 4 * size.
 * Colliders: trunk cylinder only (foliage is passable by default) plus
 * one cone for the whole crown, tagged by order: [trunk, crown].
 */
export class PineTree extends WorldModel {
  constructor(options) {
    super('PineTree', options);
    const trunkG = shared('pine:trunk', () => new CylinderGeometry(0.15, 0.22, 1.2, 6));
    const coneG = shared('pine:cone', () => new ConeGeometry(1, 1.6, 8));
    const green = material(0x1f6b3a, true);
    this.addMesh(trunkG, material(0x6b4423), [0, 0.6, 0]);
    // Three cones, each smaller than the one below.
    this.addMesh(coneG, green, [0, 1.6, 0], [1, 1, 1]);
    this.addMesh(coneG, green, [0, 2.4, 0], [0.75, 0.9, 0.75]);
    this.addMesh(coneG, green, [0, 3.1, 0], [0.5, 0.8, 0.5]);
    this.addShape('cylinder', { radius: 0.22, height: 1.2 }, [0, 0.6, 0]);
    this.addShape('cone', { radius: 1, height: 3.4 }, [0, 2.3, 0]);
  }
}

/**
 * Oak tree: thick trunk with a cluster of low-poly spheres as the crown.
 * Base at y = 0, height ~4.2 * size. Colliders: [trunk cylinder, crown sphere].
 */
export class OakTree extends WorldModel {
  constructor(options) {
    super('OakTree', options);
    const trunkG = shared('oak:trunk', () => new CylinderGeometry(0.25, 0.4, 2, 7));
    const crownG = shared('oak:crown', () => new SphereGeometry(1, 8, 6));
    const leaf = material(0x3f8f3a, true);
    this.addMesh(trunkG, material(0x7a5230), [0, 1, 0]);
    this.addMesh(crownG, leaf, [0, 3, 0], [1.5, 1.2, 1.5]);
    this.addMesh(crownG, leaf, [0.8, 2.6, 0.3], [0.9, 0.8, 0.9]);
    this.addMesh(crownG, leaf, [-0.7, 2.7, -0.4], [0.9, 0.8, 0.9]);
    this.addShape('cylinder', { radius: 0.4, height: 2 }, [0, 1, 0]);
    this.addShape('sphere', { radius: 1.5 }, [0, 3, 0]); // bounding sphere of the crown
  }
}
