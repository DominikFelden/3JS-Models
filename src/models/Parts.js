import { BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, ExtrudeGeometry, Shape, Vector2 } from 'three';
import { Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.js';

/**
 * Small building / plant parts. Each is a standalone WorldModel (so it can be
 * inspected in the viewer) that sits on y = 0, centred on x/z, and can also be
 * used as a building block of bigger models. All options are optional.
 * Stone, brick, plaster, planks and shingles wear pooled hand-drawn textures that
 * the seed picks (`textures: {kind: 0..4}` pins one).
 */

/** Texture kinds a `Wall` can be made of. */
const WALL_SURFACES = ['stone', 'brick', 'cobble', 'plaster', 'planks', 'mossy'];

const box = () => shared('part:box', () => new BoxGeometry(1, 1, 1));
const cyl = () => shared('part:cyl', () => new CylinderGeometry(1, 1, 1, 12));
const cone = () => shared('part:cone', () => new ConeGeometry(1, 1, 8));
const ball = () => shared('part:ball', () => new SphereGeometry(1, 8, 6));
/** Triangular prism along Z (gable roof): base width 1, apex height 1, length 1, base on y = 0. */
const prism = () => shared('part:prism', () => {
  const g = new ExtrudeGeometry(new Shape([new Vector2(-0.5, 0), new Vector2(0.5, 0), new Vector2(0, 1)]), { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.computeVertexNormals();
  return g;
});

/** Straight stone/brick/plaster wall segment with a coping stone on top. `surface`: stone, brick, cobble, plaster, planks or mossy. */
export class Wall extends WorldModel {
  constructor({ width = 4, height = 2.5, depth = 0.4, surface = 'stone', ...o } = {}) {
    super('Wall', o);
    const b = new MergeBuilder();
    const m = this.surface(WALL_SURFACES.includes(surface) ? surface : 'stone');
    b.add(box(), m, { position: [0, height / 2, 0], scale: [width, height, depth], tint: this.rand(0.92, 1.05) });
    b.add(box(), this.surface('stone'), { position: [0, height + 0.05, 0], scale: [width + 0.1, 0.1, depth + 0.1] });
    b.build(this);
    this.addShape('box', { size: [width, height, depth] }, [0, height / 2, 0], null, 'wall');
  }
}

/** Planked door with iron straps, in a wall panel. */
export class Door extends WorldModel {
  constructor({ width = 0.9, height = 1.7, arched = false, ...o } = {}) {
    super('Door', o);
    const b = new MergeBuilder();
    const w = width + 1.2, h = height + 0.7;
    b.add(box(), this.surface('plaster'), { position: [0, h / 2, 0], scale: [w, h, 0.3] });
    this.addDoor(b, [0, 0, 0.15], 0, width, height, { arched });
    b.build(this);
    this.addShape('box', { size: [w, h, 0.3] }, [0, h / 2, 0], null, 'wall');
  }
}

/** Framed window with glass, sill and optional shutters, in a wall panel. */
export class Window extends WorldModel {
  constructor({ width = 0.8, height = 1.1, arched = false, shutters = true, ...o } = {}) {
    super('Window', o);
    const b = new MergeBuilder();
    const w = width + 1.2, h = height + 1.2;
    b.add(box(), this.surface('plaster'), { position: [0, h / 2, 0], scale: [w, h, 0.3] });
    this.addWindow(b, [0, h / 2, 0.15], 0, width, height, { arched, shutters: shutters ? 0x4f6b4a : null });
    b.build(this);
    this.addShape('box', { size: [w, h, 0.3] }, [0, h / 2, 0], null, 'wall');
  }
}

/** Round pillar with base, shaft and capital. */
export class Column extends WorldModel {
  constructor({ height = 3, radius = 0.3, ...o } = {}) {
    super('Column', o);
    const b = new MergeBuilder();
    const stone = this.surface('plaster');
    b.add(box(), stone, { position: [0, 0.1, 0], scale: [radius * 3, 0.2, radius * 3] });
    b.add(cyl(), stone, { position: [0, 0.2 + (height - 0.5) / 2, 0], scale: [radius, height - 0.5, radius], uv: 'cyl' });
    b.add(cyl(), stone, { position: [0, 0.25, 0], scale: [radius * 1.3, 0.1, radius * 1.3], uv: 'cyl' });
    b.add(box(), stone, { position: [0, height - 0.15, 0], scale: [radius * 3, 0.3, radius * 3] });
    b.build(this);
    this.addShape('cylinder', { radius, height }, [0, height / 2, 0], null, 'column');
  }
}

/** Roof. `type`: 'gable' | 'hip' (pyramid) | 'flat'. Sits on a footprint of width x depth. */
export class Roof extends WorldModel {
  constructor({ type = 'gable', width = 5, depth = 4, height = 1.8, ...o } = {}) {
    super('Roof', o);
    const b = new MergeBuilder();
    const tiles = this.surface('shingle');
    if (type === 'hip') {
      const g = shared('part:pyramid', () => { const c = new ConeGeometry(0.7071, 1, 4); c.rotateY(Math.PI / 4); return c; });
      b.add(g, tiles, { position: [0, height / 2, 0], scale: [width * 1.1, height, depth * 1.1] });
    } else if (type === 'flat') {
      b.add(box(), tiles, { position: [0, 0.15, 0], scale: [width, 0.3, depth] });
      for (const [sx, sz, w, d] of [[0, 1, width, 0.15], [0, -1, width, 0.15], [1, 0, 0.15, depth], [-1, 0, 0.15, depth]]) {
        b.add(box(), this.surface('stone'), { position: [sx * width / 2, 0.45, sz * depth / 2], scale: [w, 0.3, d] });
      }
    } else {
      b.add(prism(), tiles, { position: [0, 0, 0], scale: [width * 1.1, height, depth * 1.1] });
    }
    b.build(this);
    this.addShape('box', { size: [width, height, depth] }, [0, height / 2, 0], null, 'roof');
  }
}

/** Brick chimney with a cap and a flue opening. */
export class Chimney extends WorldModel {
  constructor({ height = 2.2, width = 0.7, ...o } = {}) {
    super('Chimney', o);
    const b = new MergeBuilder();
    b.add(box(), this.surface('brick'), { position: [0, height / 2, 0], scale: [width, height, width] });
    const stone = this.surface('stone');
    b.add(box(), stone, { position: [0, height + 0.06, 0], scale: [width + 0.2, 0.12, width + 0.2] });
    b.add(box(), material(0x1c1a19, true), { position: [0, height + 0.125, 0], scale: [width * 0.55, 0.02, width * 0.55] });
    b.build(this);
    this.addShape('box', { size: [width, height, width] }, [0, height / 2, 0], null, 'chimney');
  }
}

/** Straight flight of stone steps rising towards -Z; `steps` count, each `rise` high. */
export class Stairs extends WorldModel {
  constructor({ steps = 7, width = 1.4, rise = 0.2, run = 0.35, ...o } = {}) {
    super('Stairs', o);
    const b = new MergeBuilder();
    const stone = this.surface('stone');
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      b.add(box(), stone, { position: [0, h / 2, -i * run], scale: [width, h, run], tint: this.rand(0.93, 1.05) });
    }
    b.build(this);
    this.addShape('box', { size: [width, rise * steps, run * steps] }, [0, rise * steps / 2, -(steps - 1) * run / 2], null, 'stairs');
  }
}

/** Wooden railing along X with posts, a handrail and balusters. */
export class Railing extends WorldModel {
  constructor({ length = 3, height = 1, ...o } = {}) {
    super('Railing', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    for (const x of [-length / 2, length / 2]) b.add(box(), wood, { position: [x, height / 2, 0], scale: [0.12, height, 0.12] });
    b.add(box(), wood, { position: [0, height, 0], scale: [length + 0.12, 0.08, 0.14] });
    b.add(box(), wood, { position: [0, 0.12, 0], scale: [length, 0.06, 0.08] });
    const n = Math.max(1, Math.round(length / 0.2));
    for (let i = 1; i < n; i++) {
      b.add(box(), wood, { position: [-length / 2 + (i * length) / n, height / 2, 0], scale: [0.04, height - 0.1, 0.04], tint: this.rand(0.9, 1.05) });
    }
    b.build(this);
    this.addShape('box', { size: [length, height, 0.14] }, [0, height / 2, 0], null, 'railing');
  }
}

/** Balcony: a slab on corbels with a railing on three sides (open towards -Z, the wall side). */
export class Balcony extends WorldModel {
  constructor({ width = 2.4, depth = 1.2, height = 2, ...o } = {}) {
    super('Balcony', o);
    const b = new MergeBuilder();
    const stone = this.surface('stone');
    const wood = this.surface('planks');
    b.add(box(), stone, { position: [0, height, depth / 2], scale: [width, 0.15, depth] });
    for (const x of [-width * 0.35, width * 0.35]) {
      b.add(box(), stone, { position: [x, height - 0.3, depth * 0.35], scale: [0.2, 0.45, depth * 0.7] });
    }
    b.add(box(), this.surface('plaster'), { position: [0, height / 2 + 0.6, -0.1], scale: [width + 0.6, height + 1.2, 0.2] });
    const rail = (x, z, len, yaw) => {
      const h = 0.95, base = height + 0.075;
      b.add(box(), wood, { position: [x, base + h, z], scale: [len, 0.07, 0.1], yaw });
      const n = Math.round(len / 0.2);
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (i * len) / n;
        b.add(box(), wood, {
          position: [x + Math.cos(yaw) * t, base + h / 2, z - Math.sin(yaw) * t],
          scale: [i % 5 === 0 ? 0.1 : 0.04, h, i % 5 === 0 ? 0.1 : 0.04],
        });
      }
    };
    rail(0, depth - 0.05, width, 0);
    rail(-width / 2 + 0.05, depth / 2, depth, Math.PI / 2);
    rail(width / 2 - 0.05, depth / 2, depth, Math.PI / 2);
    b.build(this);
    this.addShape('box', { size: [width, 0.15, depth] }, [0, height, depth / 2], null, 'floor');
  }
}

/** A tuft of grass blades. `blades` count. */
export class Grass extends WorldModel {
  constructor({ blades = 14, ...o } = {}) {
    super('Grass', o);
    const b = new MergeBuilder();
    const g = shared('part:blade', () => { const c = new ConeGeometry(0.5, 1, 3); c.translate(0, 0.5, 0); return c; });
    const green = material(0x5fa34a, true, true);
    for (let i = 0; i < blades; i++) {
      const a = this.rand(0, Math.PI * 2), r = this.rand(0, 0.18), h = this.rand(0.25, 0.55);
      const k = this.rand(0.8, 1.2);
      b.add(g, green, { position: [Math.cos(a) * r, 0, Math.sin(a) * r], scale: [0.035, h, 0.012], yaw: a, tint: [k * 0.9, k, k * 0.8] });
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.2, height: 0.5 }, [0, 0.25, 0], null, 'grass');
  }
}

/** Bird's nest: a ring of twigs with eggs. `eggs` count. */
export class BirdsNest extends WorldModel {
  constructor({ eggs = 3, ...o } = {}) {
    super('BirdsNest', o);
    const b = new MergeBuilder();
    const twig = material(0x6e5233, true, true);
    for (let i = 0; i < 30; i++) {
      const a = this.rand(0, Math.PI * 2), r = this.rand(0.1, 0.17);
      b.add(box(), twig, {
        position: [Math.cos(a) * r, this.rand(0.02, 0.09), Math.sin(a) * r],
        scale: [0.22, 0.012, 0.012], yaw: a + Math.PI / 2 + this.rand(-0.5, 0.5), tint: this.rand(0.7, 1.2),
      });
    }
    const egg = material(0x9fd0d8, true);
    for (let i = 0; i < eggs; i++) {
      const a = (i / eggs) * Math.PI * 2;
      b.add(ball(), egg, { position: [Math.cos(a) * 0.05, 0.08, Math.sin(a) * 0.05], scale: [0.035, 0.045, 0.035] });
    }
    b.build(this);
    this.addShape('sphere', { radius: 0.18 }, [0, 0.08, 0], null, 'nest');
  }
}

/** Flower: stem, leaves and a ring of petals around a centre. `petals` count. */
export class Flower extends WorldModel {
  constructor({ petals = 8, height = 0.5, color = null, ...o } = {}) {
    super('Flower', o);
    const colour = color ?? [0xe8453c, 0xf2d13a, 0xd96bd0, 0xf5f5f0, 0x6b8cf0][this.seed % 5];
    const b = new MergeBuilder();
    const green = material(0x4c8f3a, true, true);
    b.add(cyl(), green, { position: [0, height / 2, 0], scale: [0.012, height, 0.012] });
    for (let i = 0; i < 2; i++) {
      b.add(ball(), green, { position: [Math.cos(i * Math.PI) * 0.06, height * 0.3, Math.sin(i * Math.PI) * 0.06], scale: [0.07, 0.012, 0.025], yaw: i * Math.PI });
    }
    const petal = material(colour, true);
    const r = 0.07;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      b.add(ball(), petal, { position: [Math.cos(a) * r, height, Math.sin(a) * r], scale: [0.06, 0.012, 0.025], yaw: -a });
    }
    b.add(ball(), material(0xe0a21b, true), { position: [0, height + 0.01, 0], scale: [0.04, 0.03, 0.04] });
    b.build(this);
    this.addShape('cylinder', { radius: 0.1, height }, [0, height / 2, 0], null, 'flower');
  }
}
