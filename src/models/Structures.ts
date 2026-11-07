import { Quaternion, Vector3, BoxGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, SphereGeometry } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

const boxG = () => shared('struct:box', () => new BoxGeometry(1, 1, 1));
const cylG = () => shared('struct:cyl', () => new CylinderGeometry(1, 1, 1, 10));
const coneG = () => shared('struct:cone', () => new ConeGeometry(1, 1, 10));
const pyrG = () => shared('struct:pyr', () => {
  const g = new ConeGeometry(1, 1, 4, 1);
  g.rotateY(Math.PI / 4); // square base, half-side 0.707
  return g;
});
const sphG = () => shared('struct:sphere', () => new SphereGeometry(1, 8, 6));
const torusG = () => shared('struct:torus', () => new TorusGeometry(1, 0.12, 6, 20));

/**
 * Wizard tower: a tall, slightly tapering stone tower with a ring of balconies,
 * lit windows and a crooked pointed hat roof topped by a glowing orb.
 *
 * Options: seed, height (default 9, 5..16), radius (default 1.6), glow (orb, default true).
 * Colliders: 'tower' cylinder, 'roof' cone.
 */
export class WizardTower extends WorldModel {
  declare height: any;
  declare radius: any;
  constructor(options: any = {}) {
    super('WizardTower', options);
    const { height = 9, radius = 1.6, glow = true } = options;
    this.height = Math.min(16, Math.max(5, height));
    this.radius = radius;
    const H = this.height, R = radius;
    const stone = this.surface('stone');
    this.skip(1);
    const roofMat = this.surface('shingle', 0x4a3a8a);
    const lamp = this.ownSurface('plaster', 0xffd27a, { glow: 0.9 });
    const b = new MergeBuilder();
    const lean = this.rand(-0.12, 0.12);
    b.add(cylG(), stone, { position: [0, H / 2, 0], scale: [R, H, R], grime: true, tint: this.rand(0.9, 1.05) });
    b.add(cylG(), stone, { position: [0, 0.25, 0], scale: [R * 1.2, 0.5, R * 1.2], tint: 0.9 });
    const floors = Math.max(2, Math.floor(H / 3));
    for (let i = 1; i <= floors; i++) {
      const y = (H * i) / (floors + 1);
      const a = this.rand(0, Math.PI * 2);
      b.add(boxG(), lamp, { position: [Math.cos(a) * R * 0.98, y, Math.sin(a) * R * 0.98], scale: [0.3, 0.55, 0.3], yaw: -a });
      b.add(cylG(), stone, { position: [0, y + 1.2, 0], scale: [R * 1.1, 0.15, R * 1.1], tint: 0.85 });
    }
    b.add(cylG(), stone, { position: [0, H + 0.1, 0], scale: [R * 1.35, 0.3, R * 1.35] });
    const roofH = H * 0.45;
    b.add(coneG(), roofMat, { position: [lean * 2, H + 0.25 + roofH / 2, 0], scale: [R * 1.3, roofH, R * 1.3] });
    b.add(boxG(), stone, { position: [R * 0.6, 0.8, R * 0.98], scale: [0.7, 1.6, 0.3], tint: 0.7 });
    if (glow) b.add(sphG(), lamp, { position: [lean * 2, H + 0.25 + roofH + 0.15, 0], scale: [0.22, 0.22, 0.22] });
    b.build(this);
    this.addShape('cylinder', { radius: R, height: H }, [0, H / 2, 0], null, 'tower');
    this.addShape('cone', { radius: R * 1.3, height: roofH }, [0, H + 0.25 + roofH / 2, 0], null, 'roof');
  }
}

/**
 * Greek-style temple: stepped base, a ring of columns on the long sides and
 * front/back, a solid cella and a flat entablature with a pediment.
 *
 * Options: seed, columns (per long side, default 6, 3..10), width (default 6), depth (default 9).
 * Colliders: 'base' box, 'column' cylinders, 'cella' box, 'roof' box.
 */
export class Temple extends WorldModel {
  declare columns: any;
  constructor(options: any = {}) {
    super('Temple', options);
    const { width = 6, depth = 9 } = options;
    const n = WorldModel.clampInt(options.columns, 3, 10, 6);
    this.columns = n;
    const marble = this.surface('stone', 0xe8e2d4);
    this.skip(1);
    const roofMat = this.surface('shingle', 0xb5651d);
    const b = new MergeBuilder();
    const colH = 3.2, colR = 0.28, baseH = 0.6;
    b.add(boxG(), marble, { position: [0, 0.15, 0], scale: [width + 1.2, 0.3, depth + 1.2], tint: 0.9 });
    b.add(boxG(), marble, { position: [0, 0.45, 0], scale: [width + 0.6, 0.3, depth + 0.6] });
    const pts: number[][] = [];
    const front = Math.max(3, Math.round(width / 1.6));
    for (let i = 0; i < n; i++) {
      const z = -depth / 2 + 0.3 + ((depth - 0.6) * i) / (n - 1);
      pts.push([-width / 2 + 0.3, z], [width / 2 - 0.3, z]);
    }
    for (let i = 1; i < front - 1; i++) {
      const x = -width / 2 + 0.3 + ((width - 0.6) * i) / (front - 1);
      pts.push([x, -depth / 2 + 0.3], [x, depth / 2 - 0.3]);
    }
    for (const [x, z] of pts) {
      b.add(cylG(), marble, { position: [x, baseH + colH / 2, z], scale: [colR, colH, colR], tint: this.rand(0.92, 1.05), uv: 'cyl' });
      this.addShape('cylinder', { radius: colR, height: colH }, [x, baseH + colH / 2, z], null, 'column');
    }
    const cw = width - 1.8, cd = depth - 1.8;
    b.add(boxG(), marble, { position: [0, baseH + colH / 2, -0.2], scale: [cw, colH, cd - 0.4], tint: 0.95 });
    const ey = baseH + colH + 0.2;
    b.add(boxG(), marble, { position: [0, ey, 0], scale: [width + 0.4, 0.4, depth + 0.4] });
    const pedH = 1.1;
    b.add(pyrG(), roofMat, { position: [0, ey + 0.2 + pedH / 2, 0], scale: [Math.max(width, depth) * 0.75, pedH, Math.max(width, depth) * 0.75] });
    b.build(this);
    this.addShape('box', { size: [width + 1.2, baseH, depth + 1.2] }, [0, baseH / 2, 0], null, 'base');
    this.addShape('box', { size: [cw, colH, cd - 0.4] }, [0, baseH + colH / 2, -0.2], null, 'cella');
    this.addShape('box', { size: [width + 0.4, 0.4 + pedH, depth + 0.4] }, [0, ey + (pedH - 0.4) / 2 + 0.2, 0], null, 'roof');
  }
}

/**
 * Obelisk: a tall four-sided tapering monolith on a stepped plinth with a
 * pyramidion tip, optionally with a glowing band.
 *
 * Options: seed, height (default 7), glow (glowing band, default false).
 * Colliders: 'plinth' box, 'shaft' box.
 */
export class Obelisk extends WorldModel {
  declare height: any;
  constructor(options: any = {}) {
    super('Obelisk', options);
    const { height = 7, glow = false } = options;
    this.height = height;
    const stone = this.surface('stone');
    const b = new MergeBuilder();
    const w = height * 0.11, tip = w * 1.6;
    b.add(boxG(), stone, { position: [0, 0.2, 0], scale: [w * 3.2, 0.4, w * 3.2], tint: 0.85, grime: true });
    b.add(boxG(), stone, { position: [0, 0.55, 0], scale: [w * 2.4, 0.3, w * 2.4], tint: 0.9 });
    const sh = height - 0.7 - tip;
    const taper = shared('struct:obelisk', () => {
      const g = new CylinderGeometry(0.7, 1, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      return g;
    });
    b.add(taper, stone, { position: [0, 0.7 + sh / 2, 0], scale: [w * 0.9, sh, w * 0.9], tint: this.rand(0.95, 1.1), uv: 'cyl' });
    b.add(pyrG(), stone, { position: [0, 0.7 + sh + tip / 2, 0], scale: [w * 0.63, tip, w * 0.63], tint: 1.1 });
    if (glow) {
      const lamp = this.ownSurface('plaster', 0x7affd2, { glow: 1 });
      b.add(taper, lamp, { position: [0, 0.7 + sh * 0.6, 0], scale: [w * 0.82, 0.25, w * 0.82] });
    }
    b.build(this);
    this.addShape('box', { size: [w * 3.2, 0.7, w * 3.2] }, [0, 0.35, 0], null, 'plinth');
    this.addShape('box', { size: [w * 1.5, height - 0.7, w * 1.5] }, [0, 0.7 + (height - 0.7) / 2, 0], null, 'shaft');
  }
}

/**
 * Portal: a glowing ring held upright by two stone pillars, filled with a
 * translucent energy disc. The ring faces +Z.
 *
 * Options: seed, radius (inner ring radius, default 1.5), color (glow colour, default 0x6a5cff).
 * Colliders: 'pillar' boxes and a 'base' box (the opening stays passable).
 */
export class Portal extends WorldModel {
  declare radius: any;
  constructor(options: any = {}) {
    super('Portal', options);
    const { radius = 1.5, color = 0x6a5cff } = options;
    this.radius = radius;
    const stone = this.surface('stone');
    const b = new MergeBuilder();
    const y0 = radius + 0.4;
    b.add(boxG(), stone, { position: [0, 0.2, 0], scale: [radius * 2.6, 0.4, 1.0], grime: true, tint: 0.9 });
    for (const s of [-1, 1]) {
      const h = radius * 1.4 + this.rand(0, 0.5);
      b.add(boxG(), stone, { position: [s * (radius + 0.35), 0.4 + h / 2, 0], scale: [0.5, h, 0.5], tint: this.rand(0.9, 1.05) });
      this.addShape('box', { size: [0.5, h, 0.5] }, [s * (radius + 0.35), 0.4 + h / 2, 0], null, 'pillar');
    }
    b.build(this);
    const ringMat = shared(`struct:portal:ring:${color}`, () => material(color, true));
    const ring = this.addMesh(torusG(), ringMat, [0, y0, 0], [radius, radius, 1]);
    ring.userData.portalRing = true;
    const discMat = shared(`struct:portal:disc:${color}`, () => {
      const m = material(color, false).clone();
      m.emissive.set(color);
      m.emissiveIntensity = 0.9;
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
      return m;
    });
    const disc = shared('struct:portal:discGeo', () => {
      const g = new CylinderGeometry(1, 1, 0.04, 20);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const d = this.addMesh(disc, discMat, [0, y0, 0], [radius * 0.95, radius * 0.95, 1]);
    d.castShadow = false;
    this.addShape('box', { size: [radius * 2.6, 0.4, 1.0] }, [0, 0.2, 0], null, 'base');
  }
}

/**
 * Ruins: broken walls, stumps of columns and rubble scattered around the
 * origin.
 *
 * Options: seed, complexity (0..4, default 1; more walls, columns, rubble),
 * radius (default 4).
 * Colliders: 'wall' boxes (rotated), 'column' cylinders, 'rubble' boxes.
 */
export class Ruins extends WorldModel {
  declare complexity: any;
  constructor(options: any = {}) {
    super('Ruins', options);
    const c = WorldModel.clampInt(options.complexity, 0, 4, 1);
    this.complexity = c;
    const R = options.radius ?? 4;
    const stone = this.surface('stone');
    this.skip(1);
    const brick = this.surface('brick');
    const b = new MergeBuilder();
    const walls = 1 + c * 2, cols = c * 2, rubble = 3 + c * 4;
    for (let i = 0; i < walls; i++) {
      const a = (i / walls) * Math.PI * 2 + this.rand(-0.3, 0.3);
      const d = R * this.rand(0.4, 0.9);
      const len = this.rand(1.6, 3.2), h = this.rand(0.7, 2.6), t = 0.4;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, yaw = -a + Math.PI / 2 + this.rand(-0.2, 0.2);
      b.add(boxG(), i % 2 ? brick : stone, { position: [x, h / 2, z], scale: [len, h, t], yaw, grime: true, tint: this.rand(0.8, 1) });
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      this.addShape('box', { size: [len, h, t] }, [x, h / 2, z], q, 'wall');
    }
    for (let i = 0; i < cols; i++) {
      const a = this.rand(0, Math.PI * 2), d = R * this.rand(0.2, 1);
      const h = this.rand(0.5, 2.4), r = this.rand(0.25, 0.35);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(cylG(), stone, { position: [x, h / 2, z], scale: [r, h, r], grime: true, tint: this.rand(0.85, 1), uv: 'cyl' });
      this.addShape('cylinder', { radius: r, height: h }, [x, h / 2, z], null, 'column');
    }
    for (let i = 0; i < rubble; i++) {
      const a = this.rand(0, Math.PI * 2), d = R * this.rand(0, 1.1);
      const s = this.rand(0.15, 0.45);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(boxG(), stone, { position: [x, s / 2, z], scale: [s, s * 0.8, s * 1.2], yaw: this.rand(0, 3), tint: this.rand(0.7, 0.95), grime: true });
      if (i < 4) this.addShape('box', { size: [s, s * 0.8, s * 1.2] }, [x, s / 2, z], null, 'rubble');
    }
    b.build(this);
  }
}

/**
 * Gravestone: an upright slab (rounded, cross or plain) on a small mound,
 * leaning a little with age.
 *
 * Options: seed, style ('round' | 'cross' | 'slab', default random from seed).
 * Collider: 'stone' box.
 */
export class Gravestone extends WorldModel {
  declare style: any;
  constructor(options: any = {}) {
    super('Gravestone', options);
    const styles = ['round', 'cross', 'slab'];
    const pick = Math.floor(this.rand(0, 3));
    this.style = styles.includes(options.style) ? options.style : styles[pick];
    const lean = this.rand(-0.08, 0.08), tint = this.rand(0.75, 1);
    const stone = this.surface('stone', 0xb8b8b0);
    const dirt = this.surface('rock', 0x5a4632);
    const b = new MergeBuilder();
    b.add(sphG(), dirt, { position: [0, 0, 0.5], scale: [0.5, 0.15, 0.9], tint: 0.8 });
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), lean);
    const opt = { quaternion: q, tint, grime: true };
    let h = 0.9;
    if (this.style === 'cross') {
      b.add(boxG(), stone, { position: [0, 0.45, 0], scale: [0.16, 0.9, 0.12], ...opt });
      b.add(boxG(), stone, { position: [0, 0.65, 0], scale: [0.5, 0.14, 0.12], ...opt });
    } else if (this.style === 'round') {
      h = 0.85;
      b.add(boxG(), stone, { position: [0, 0.3, 0], scale: [0.6, 0.6, 0.12], ...opt });
      const cap = shared('struct:grave:cap', () => {
        const g = new CylinderGeometry(1, 1, 1, 10);
        g.rotateX(Math.PI / 2);
        return g;
      });
      b.add(cap, stone, { position: [0, 0.6, 0], scale: [0.3, 1, 0.12], ...opt });
    } else {
      b.add(boxG(), stone, { position: [0, 0.4, 0], scale: [0.6, 0.8, 0.14], ...opt });
    }
    b.build(this);
    this.addShape('box', { size: [0.6, h, 0.14] }, [0, h / 2, 0], null, 'stone');
  }
}

/**
 * Shrine: a small roofed wooden shrine on a stone platform with steps,
 * a lantern and an offering stone.
 *
 * Options: seed, lit (glowing lantern, default true).
 * Colliders: 'platform' box, 'post' cylinders, 'roof' box.
 */
export class Shrine extends WorldModel {
  constructor(options: any = {}) {
    super('Shrine', options);
    const { lit = true } = options;
    const stone = this.surface('stone');
    const wood = this.surface('planks', 0x8a2a24);
    this.skip(1);
    const roofMat = this.surface('shingle', 0x3a3a46);
    const b = new MergeBuilder();
    b.add(boxG(), stone, { position: [0, 0.15, 0], scale: [3, 0.3, 3], tint: 0.9, grime: true });
    b.add(boxG(), stone, { position: [0, 0.07, 1.8], scale: [1.4, 0.14, 0.6], tint: 0.85 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.add(cylG(), wood, { position: [x * 0.9, 1.3, z * 0.9], scale: [0.12, 2, 0.12], uv: 'cyl' });
      this.addShape('cylinder', { radius: 0.12, height: 2 }, [x * 0.9, 1.3, z * 0.9], null, 'post');
    }
    b.add(boxG(), wood, { position: [0, 0.8, -0.6], scale: [1.2, 0.9, 0.8], tint: 0.9 });
    b.add(boxG(), wood, { position: [0, 2.4, 0], scale: [2.6, 0.12, 2.6] });
    b.add(pyrG(), roofMat, { position: [0, 2.9, 0], scale: [2.1 * this.rand(0.95, 1.1), 0.9, 2.1] });
    const lantern = lit ? this.ownSurface('plaster', 0xffc060, { glow: 0.9 }) : stone;
    b.add(boxG(), stone, { position: [1.8, 0.3, 1.6], scale: [0.3, 0.6, 0.3] });
    b.add(boxG(), lantern, { position: [1.8, 0.75, 1.6], scale: [0.3, 0.3, 0.3] });
    b.add(pyrG(), stone, { position: [1.8, 1.0, 1.6], scale: [0.3, 0.2, 0.3] });
    b.build(this);
    this.addShape('box', { size: [3, 0.3, 3] }, [0, 0.15, 0], null, 'platform');
    this.addShape('box', { size: [2.6, 1.0, 2.6] }, [0, 2.7, 0], null, 'roof');
  }
}

/**
 * Pyramid: a stepped (or smooth) sandstone pyramid.
 *
 * Options: seed, size via `base` (side length, default 10), height (default 0.65 * base),
 * steps (0..12, default random 6..10; 0 = smooth sides).
 * Colliders: 'step' boxes (one per tier) or one 'pyramid' convex when smooth.
 */
export class Pyramid extends WorldModel {
  declare steps: any;
  constructor(options: any = {}) {
    super('Pyramid', options);
    const base = options.base ?? 10;
    const height = options.height ?? base * 0.65;
    const steps = WorldModel.clampInt(options.steps, 0, 12, 6 + Math.floor(this.rand(0, 5)));
    this.steps = steps;
    const sand = this.surface('stone', 0xd9b878);
    const b = new MergeBuilder();
    if (steps === 0) {
      b.add(pyrG(), sand, { position: [0, height / 2, 0], scale: [base / 1.4142, height, base / 1.4142], grime: true });
      b.build(this);
      const h = base / 2;
      this.addShape('convex', { points: [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h], [0, height, 0]] }, [0, 0, 0], null, 'pyramid');
      return;
    }
    const sh = height / steps;
    for (let i = 0; i < steps; i++) {
      const w = base * (1 - i / steps);
      b.add(boxG(), sand, { position: [0, sh * i + sh / 2, 0], scale: [w, sh, w], tint: this.rand(0.88, 1.05), grime: i === 0 });
      this.addShape('box', { size: [w, sh, w] }, [0, sh * i + sh / 2, 0], null, 'step');
    }
    b.build(this);
  }
}
