import { BoxGeometry, CylinderGeometry, ConeGeometry } from 'three';
import { WorldModel, shared, material } from '../WorldModel.js';

/**
 * Castle: square courtyard with four round corner towers, four walls (the
 * front wall has a gate gap) and a central keep. Footprint is 12 x 12, base
 * at y = 0, centred on the model origin; the gate faces +Z.
 *
 * Complex structures are exposed as MANY simple primitives instead of one
 * big shape, so the gate stays passable for collision code:
 *  - towers: cylinders (position, radius, height)
 *  - roofs:  cones
 *  - walls:  boxes (oriented via quaternion)
 *  - keep:   box
 * Tags (`tower`,`roof`,`wall`,`keep`) are available via getColliderTags(),
 * in the same order as getColliders().
 */
export class Castle extends WorldModel {
  constructor(options) {
    super('Castle', options);
    this._tags = [];
    const stone = material(0x9a9690, true);
    const roof = material(0x8b2f2f, true);
    const H = 6; // half footprint
    const wallH = 2.4, wallT = 0.6, towerR = 1, towerH = 4;
    const gate = 2; // gate width

    const towerG = shared('castle:tower', () => new CylinderGeometry(towerR, towerR, towerH, 12));
    const roofG = shared('castle:roof', () => new ConeGeometry(towerR * 1.2, 1.5, 12));
    const wallG = shared('castle:wall', () => new BoxGeometry(1, 1, 1)); // scaled per wall

    // Corner towers + roofs
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * H, z = sz * H;
      this.addMesh(towerG, stone, [x, towerH / 2, z]);
      this.addMesh(roofG, roof, [x, towerH + 0.75, z]);
      this.addShape('cylinder', { radius: towerR, height: towerH }, [x, towerH / 2, z]);
      this._tags.push('tower');
      this.addShape('cone', { radius: towerR * 1.2, height: 1.5 }, [x, towerH + 0.75, z]);
      this._tags.push('roof');
    }

    // Wall segment helper: box centred at (x,z) with size (w along X, d along Z).
    const wall = (x, z, w, d) => {
      this.addMesh(wallG, stone, [x, wallH / 2, z], [w, wallH, d]);
      this.addShape('box', { size: [w, wallH, d] }, [x, wallH / 2, z]);
      this._tags.push('wall');
    };
    const len = 2 * H - 2 * towerR; // wall length between towers
    wall(0, -H, len, wallT);          // back
    wall(-H, 0, wallT, len);          // left
    wall(H, 0, wallT, len);           // right
    const seg = (len - gate) / 2;     // front wall in two parts leaving a gate
    wall(-(gate / 2 + seg / 2), H, seg, wallT);
    wall(gate / 2 + seg / 2, H, seg, wallT);

    // Central keep with a pyramid-ish roof
    this.addMesh(wallG, stone, [0, 2, 0], [3, 4, 3]);
    this.addShape('box', { size: [3, 4, 3] }, [0, 2, 0]);
    this._tags.push('keep');
  }

  /** Tags matching the order of getColliders(). */
  getColliderTags() {
    return [...this._tags];
  }
}
