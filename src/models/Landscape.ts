import {
  ConeGeometry, CylinderGeometry, IcosahedronGeometry, BoxGeometry, SphereGeometry, 
  MeshStandardMaterial, Euler, Color,
} from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);

const cone = () => shared('land:cone', () => new ConeGeometry(1, 1, 7, 1));
const rubble = () => shared('land:ico', () => new IcosahedronGeometry(1, 0));
const box = () => shared('land:box', () => new BoxGeometry(1, 1, 1));
const cyl = () => shared('land:cyl', () => new CylinderGeometry(1, 1, 1, 10, 1));
const dome = () => shared('land:dome', () => new SphereGeometry(1, 8, 5));

const water = () => shared('land:water', () => new MeshStandardMaterial({
  color: 0x3f8fc4, transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0.1,
}));
const snowMat = () => material(0xf2f6fa, true, true);
const ice = () => shared('land:ice', () => new MeshStandardMaterial({
  color: 0xaee3f5, transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.2, flatShading: true,
}));
const crystalMat = (color) => shared(`land:crystal:${color}`, () => new MeshStandardMaterial({
  color, emissive: new Color(color), emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.3, flatShading: true,
}));

/**
 * Mountain: `peaks` overlapping rocky cones, tallest in the middle, optionally
 * with snow caps. Options: height (12), radius (8), peaks (1-5, default 3),
 * snow (true). Colliders: one cone per peak ('peak').
 */
export class Mountain extends WorldModel {
  constructor(options: any = {}) {
    super('Mountain', options);
    const height = clamp(options.height, 1, 200, 12);
    const radius = clamp(options.radius, 1, 200, 8);
    const peaks = WorldModel.clampInt(options.peaks, 1, 5, 3);
    const snow = options.snow ?? true;
    const rock = this.surface('rock');
    const b = new MergeBuilder();
    for (let i = 0; i < peaks; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.35, 0.6) * radius;
      const r = radius * (main ? 1 : this.rand(0.45, 0.7));
      const h = height * (main ? 1 : this.rand(0.5, 0.8));
      const x = Math.cos(a) * d, z = Math.sin(a) * d, yaw = this.rand(0, TAU), k = this.rand(0.8, 1);
      b.add(cone(), rock, { position: [x, h / 2, z], scale: [r, h, r], yaw, tint: k, detail: 4 });
      if (snow && h > 3) {
        const sh = h * 0.35, sr = r * 0.35;
        b.add(cone(), snowMat(), { position: [x, h - sh / 2 + 0.02, z], scale: [sr * 1.02, sh, sr * 1.02], yaw });
      }
      this.addShape('cone', { radius: r, height: h }, [x, h / 2, z], null, 'peak');
    }
    b.build(this);
  }
}

/**
 * Hill: a wide, low grassy mound. Options: radius (4), height (1.5).
 * Collider: convex hull of the upper half-ellipsoid ('hill').
 */
export class Hill extends WorldModel {
  constructor(options: any = {}) {
    super('Hill', options);
    const radius = clamp(options.radius, 0.5, 200, 4);
    const height = clamp(options.height, 0.2, 100, 1.5);
    const grass = this.surface('foliage');
    const b = new MergeBuilder();
    b.add(dome(), grass, { scale: [radius, height, radius], yaw: this.rand(0, TAU), tint: [0.8, 1, 0.7], detail: 3 });
    for (let i = 0; i < 2; i++) { // lumps break the silhouette
      const a = this.rand(0, TAU), d = this.rand(0.3, 0.5) * radius, s = this.rand(0.35, 0.55);
      b.add(dome(), grass, {
        position: [Math.cos(a) * d, 0, Math.sin(a) * d], scale: [radius * s, height * s * 1.1, radius * s], tint: [0.85, 1, 0.75], detail: 3,
      });
    }
    b.build(this);
    const pts = [[0, height, 0]];
    for (const ring of [[0.5, 0.87], [1, 0]]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        pts.push([Math.cos(a) * radius * ring[1], height * ring[0] * (ring[1] ? 1 : 0), Math.sin(a) * radius * ring[1]]);
      }
    }
    this.addShape('convex', { points: pts }, [0, 0, 0], null, 'hill');
  }
}

/**
 * Cliff: a vertical rock wall of stacked blocks facing +Z. Options:
 * width (6), height (5), depth (2). Collider: one box ('cliff').
 */
export class Cliff extends WorldModel {
  constructor(options: any = {}) {
    super('Cliff', options);
    const width = clamp(options.width, 1, 100, 6);
    const height = clamp(options.height, 1, 100, 5);
    const depth = clamp(options.depth, 0.5, 50, 2);
    const rock = this.surface('rock');
    const b = new MergeBuilder();
    b.add(box(), rock, { position: [0, height / 2, 0], scale: [width, height, depth], tint: 0.9, detail: 2 });
    const n = Math.max(3, Math.round(width / 1.2));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * width * 0.95, h = height * this.rand(0.7, 1.05);
      const s = this.rand(0.5, 0.9) * (width / n) * 1.3, z = depth * this.rand(0.35, 0.5);
      b.add(rubble(), rock, {
        position: [x, h * 0.45, z], scale: [s, h * 0.55, s * 0.7], yaw: this.rand(0, TAU), tint: this.rand(0.8, 1.1), detail: 2,
      });
    }
    b.build(this);
    this.addShape('box', { size: [width, height, depth] }, [0, height / 2, 0], null, 'cliff');
  }
}

/**
 * CaveEntrance: a rock face with a dark opening facing +Z. Options:
 * width (3, opening width), height (2.5, opening height). Colliders: two side
 * walls, a lintel above the opening and a back wall, so the opening is walkable.
 */
export class CaveEntrance extends WorldModel {
  constructor(options: any = {}) {
    super('CaveEntrance', options);
    const width = clamp(options.width, 1, 30, 3);
    const height = clamp(options.height, 1, 30, 2.5);
    const rock = this.surface('rock');
    const side = width * 0.8, top = height * 0.6, depth = Math.max(3, width * 1.2), total = height + top;
    const b = new MergeBuilder();
    for (const s of [-1, 1]) {
      b.add(box(), rock, { position: [s * (width / 2 + side / 2), total / 2, 0], scale: [side, total, depth], tint: 0.9, detail: 2 });
      b.add(rubble(), rock, {
        position: [s * (width / 2 + side * 0.3), total * 0.6, depth * 0.35], scale: [side * 0.7, total * 0.5, depth * 0.3],
        yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.1), detail: 2,
      });
    }
    b.add(box(), rock, { position: [0, height + top / 2, 0], scale: [width + 0.01, top, depth], tint: 0.85, detail: 2 });
    b.add(box(), material(0x050505, true), { position: [0, height / 2, -depth / 2 + 0.05], scale: [width, height, 0.1] });
    b.add(box(), material(0x0b0b0b, true), { position: [0, 0.01, 0], scale: [width, 0.02, depth] });
    b.build(this);
    for (const s of [-1, 1]) this.addShape('box', { size: [side, total, depth] }, [s * (width / 2 + side / 2), total / 2, 0], null, 'wall');
    this.addShape('box', { size: [width, top, depth] }, [0, height + top / 2, 0], null, 'lintel');
    this.addShape('box', { size: [width, height, 0.2] }, [0, height / 2, -depth / 2 + 0.1], null, 'back');
  }
}

/**
 * Pond: a flat disc of water ringed with rocks. Options: radius (3),
 * rocks (8, number of shore rocks, 0-24). Collider: thin cylinder ('water'),
 * shore rocks are not colliders.
 */
export class Pond extends WorldModel {
  constructor(options: any = {}) {
    super('Pond', options);
    const radius = clamp(options.radius, 0.5, 100, 3);
    const rocks = WorldModel.clampInt(options.rocks, 0, 24, 8);
    const rock = this.surface('rock');
    this.addMesh(cyl(), water(), [0, 0.04, 0], [radius, 0.08, radius]);
    const b = new MergeBuilder();
    b.add(cyl(), material(0x4a3a2a, true, true), { position: [0, 0.01, 0], scale: [radius * 1.12, 0.02, radius * 1.12], tint: 0.8 });
    for (let i = 0; i < rocks; i++) {
      const a = (i / rocks) * TAU + this.rand(-0.15, 0.15), d = radius * this.rand(1.0, 1.15), s = this.rand(0.15, 0.35);
      b.add(rubble(), rock, {
        position: [Math.cos(a) * d, s * 0.3, Math.sin(a) * d], scale: [s, s * 0.7, s], yaw: this.rand(0, TAU), tint: this.rand(0.8, 1.1), detail: 3,
      });
    }
    b.build(this);
    this.addShape('cylinder', { radius, height: 0.08 }, [0, 0.04, 0], null, 'water');
  }
}

/**
 * Waterfall: a rock wall facing +Z with a sheet of water falling into a pool.
 * Options: height (5), width (1.5, width of the water sheet).
 * Colliders: the wall ('cliff') and the pool ('water').
 */
export class Waterfall extends WorldModel {
  constructor(options: any = {}) {
    super('Waterfall', options);
    const height = clamp(options.height, 1, 100, 5);
    const width = clamp(options.width, 0.3, 30, 1.5);
    const rock = this.surface('rock');
    const wallW = width + 3, wallD = 2, pool = Math.max(1.2, width * 1.1);
    const b = new MergeBuilder();
    b.add(box(), rock, { position: [0, height / 2, 0], scale: [wallW, height, wallD], tint: 0.85, detail: 2 });
    for (const s of [-1, 1]) {
      const h = height * this.rand(0.85, 1.1);
      b.add(rubble(), rock, {
        position: [s * (width / 2 + 0.5), h * 0.5, wallD * 0.4], scale: [0.9, h * 0.5, 0.8], yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.1), detail: 2,
      });
    }
    b.build(this);
    this.addMesh(box(), water(), [0, height / 2, wallD / 2 + 0.05], [width, height, 0.1]);
    this.addMesh(cyl(), water(), [0, 0.04, wallD / 2 + pool * 0.8], [pool, 0.08, pool]);
    this.addShape('box', { size: [wallW, height, wallD] }, [0, height / 2, 0], null, 'cliff');
    this.addShape('cylinder', { radius: pool, height: 0.08 }, [0, 0.04, wallD / 2 + pool * 0.8], null, 'water');
  }
}

/**
 * Crystal: a glowing cluster of hexagonal crystals. Options: height (2),
 * count (5, crystals 1-12), color (0x7a5cff). Collider: one cylinder
 * around the cluster ('cluster').
 */
export class Crystal extends WorldModel {
  constructor(options: any = {}) {
    super('Crystal', options);
    const height = clamp(options.height, 0.2, 50, 2);
    const count = WorldModel.clampInt(options.count, 1, 12, 5);
    const color = options.color ?? 0x7a5cff;
    const g = shared('land:crystal', () => {
      const geo = new ConeGeometry(1, 1, 6, 1);
      return geo;
    });
    const mat = crystalMat(color);
    let reach = 0;
    for (let i = 0; i < count; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.1, 0.35) * height, h = height * (main ? 1 : this.rand(0.35, 0.8));
      const r = h * this.rand(0.12, 0.2), lean = main ? 0 : this.rand(0.1, 0.4);
      const m = this.addMesh(g, mat, [Math.cos(a) * d, h / 2 * 0.9, Math.sin(a) * d], [r, h, r]);
      m.quaternion.setFromEuler(new Euler(Math.sin(a) * lean, 0, -Math.cos(a) * lean));
      reach = Math.max(reach, d + r);
    }
    this.addShape('cylinder', { radius: Math.max(0.2, reach), height }, [0, height / 2, 0], null, 'cluster');
  }
}

/**
 * IceSpire: jagged translucent ice spikes with a tall centre one.
 * Options: height (4), spikes (4, total 1-8). Colliders: one cone per
 * spike ('spike').
 */
export class IceSpire extends WorldModel {
  constructor(options: any = {}) {
    super('IceSpire', options);
    const height = clamp(options.height, 0.5, 100, 4);
    const spikes = WorldModel.clampInt(options.spikes, 1, 8, 4);
    const g = shared('land:spire', () => new ConeGeometry(1, 1, 5, 1));
    for (let i = 0; i < spikes; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.1, 0.3) * height;
      const h = height * (main ? 1 : this.rand(0.35, 0.75)), r = h * this.rand(0.1, 0.16);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const m = this.addMesh(g, ice(), [x, h / 2, z], [r, h, r]);
      m.rotation.y = this.rand(0, TAU);
      this.addShape('cone', { radius: r, height: h }, [x, h / 2, z], null, 'spike');
    }
  }
}
