import { Mesh, Vector3, Color } from 'three';
import { WorldModel } from '../WorldModel.ts';
import { treeStyle } from './branching.ts';
import { textureMean } from '../textures/pool.ts';
import { PLANT_PICTURES, frondGeometry, plantMaterial, plantDepthMaterial, type Frond } from './plantCards.ts';

/**
 * Ground plants for forest floors and meadows, drawn with the same hand-inked, alpha-cut
 * cards as the leaves of the stylized tree: a plant is a rosette of arching fronds (one
 * quad strip each) in ONE mesh and ONE draw call, ~20-70 triangles. Every model sits on y = 0,
 * is centred on x/z and takes `seed`, `size`, `position`, `rotation`, `leafSize` and
 * `leafColor` (as trees do). The seed changes the number, length, width, lean and bend of the
 * fronds, the colour (picked from the foliage texture pool: `textures: {foliage}` pins one,
 * and each plant adds its own tint) and mirrors the fronds at random.
 * Collider: one cylinder around the plant (tag 'plant').
 */

/** What makes one kind of plant: its picture, frond counts and proportions (ranges: [min, max]). */
type PlantStyle = {
  name: string,
  picture: number,
  fronds: [number, number],
  length: [number, number],      // frond length (model units)
  aspect: [number, number],      // frond width / length
  pitch: [number, number],       // start angle of a frond from straight up (radians) of the outer fronds
  droop: [number, number],       // further bend of a frond over its length (radians)
  tint: [number, number, number], // colour multiplier of this plant kind
  height: number,                // collider height share of the longest frond
};

/** Base of ferns, bracken, grass and broadleaf plants: they differ only in their `PlantStyle`. */
class FrondPlant extends WorldModel {
  declare random: any;
  declare frondCount: number;
  declare radius: number;
  declare plantHeight: number;
  constructor(style: PlantStyle, options: any = {}) {
    super(style.name, options);
    const look = treeStyle(options);
    const foliage = this.variant('foliage');
    const leafColor = look.leafColor !== undefined ? new Color(look.leafColor) : textureMean('foliage', foliage);
    const size = look.leafSize ?? 1;
    const count = Math.round(this.rand(style.fronds[0], style.fronds[1] + 1 - 1e-6));
    const base = this.rand(style.length[0], style.length[1]) * size;
    const yaw0 = this.rand(0, Math.PI * 2);
    const fronds: Frond[] = [];
    let reach = 0, top = 0;
    for (let i = 0; i < count; i++) {
      // Golden-angle spiral: fronds spread evenly; the later (outer) ones lean further out and are longer.
      const outer = count > 1 ? (i + this.rand(0, 0.8)) / count : 0;
      const length = base * this.rand(0.75, 1.15) * (0.7 + 0.3 * outer);
      const pitch = style.pitch[0] + (style.pitch[1] - style.pitch[0]) * outer + this.rand(-0.12, 0.12);
      const droop = this.rand(style.droop[0], style.droop[1]);
      const k = this.rand(0.88, 1.1);
      const yaw = yaw0 + i * 2.39996 + this.rand(-0.25, 0.25);
      const origin = new Vector3(Math.cos(yaw) * 0.015 * length, 0, Math.sin(yaw) * 0.015 * length);
      fronds.push({
        base: origin, yaw, pitch, droop, length, width: length * this.rand(style.aspect[0], style.aspect[1]), picture: style.picture,
        tint: [k * style.tint[0] * this.rand(0.95, 1.05), k * style.tint[1], k * style.tint[2] * this.rand(0.92, 1.05)], flip: this.random() < 0.5,
      });
      // Horizontal reach and height of the frond tip (sampled along its arch).
      let x = 0, y = 0;
      for (let s = 0; s < 8; s++) {
        const a = pitch + droop * (s / 8) ** 2;
        x += Math.sin(a) * length / 8; y += Math.cos(a) * length / 8;
        reach = Math.max(reach, x + length * 0.2);
        top = Math.max(top, y);
      }
    }
    this.frondCount = count;
    this.radius = Math.max(0.1, reach * 0.8);
    this.plantHeight = Math.max(0.1, top * style.height);
    const geo = frondGeometry(fronds);
    this._ownedGeometries.push(geo);
    const mesh = new Mesh(geo, plantMaterial(leafColor));
    mesh.customDepthMaterial = plantDepthMaterial();
    mesh.castShadow = mesh.receiveShadow = true;
    this.add(mesh);
    this.addShape('cylinder', { radius: this.radius, height: this.plantHeight }, [0, this.plantHeight / 2, 0], null, 'plant');
  }
}

/** Fern: 8-14 finely divided fronds arching out of a crown, the outer ones drooping. About 70 triangles. */
export class Fern extends FrondPlant {
  constructor(options: any = {}) {
    super({ name: 'Fern', picture: PLANT_PICTURES.fern, fronds: [10, 16], length: [0.55, 0.95], aspect: [0.75, 1], pitch: [0.3, 1.2], droop: [0.5, 1.1], tint: [0.95, 1.05, 0.85], height: 0.7 }, options);
  }
}

/** Bracken: 4-7 tall, broad, triangular fronds on long stalks; taller and more upright than a fern. About 40 triangles. */
export class Bracken extends FrondPlant {
  constructor(options: any = {}) {
    super({ name: 'Bracken', picture: PLANT_PICTURES.bracken, fronds: [4, 7], length: [0.9, 1.5], aspect: [0.8, 1.05], pitch: [0.15, 0.7], droop: [0.4, 0.9], tint: [0.9, 1, 0.8], height: 0.85 }, options);
  }
}

/** Tall grass: 5-9 long, slender blades fanning out of a tuft, bending over at the tips. About 40 triangles. */
export class TallGrass extends FrondPlant {
  constructor(options: any = {}) {
    super({ name: 'TallGrass', picture: PLANT_PICTURES.grass, fronds: [5, 9], length: [0.5, 0.9], aspect: [0.55, 0.85], pitch: [0.1, 0.55], droop: [0.5, 1], tint: [1.08, 1.06, 0.8], height: 0.8 }, options);
  }
}

/** Broadleaf plant (hosta-like): 5-8 big ribbed oval leaves in a low, wide rosette. About 40 triangles. */
export class Hosta extends FrondPlant {
  constructor(options: any = {}) {
    super({ name: 'Hosta', picture: PLANT_PICTURES.broadleaf, fronds: [5, 8], length: [0.4, 0.65], aspect: [0.9, 1.2], pitch: [0.55, 1.2], droop: [0.3, 0.8], tint: [0.85, 1, 0.9], height: 0.6 }, options);
  }
}
