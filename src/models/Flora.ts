import { BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, Quaternion, Euler, Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

/**
 * Plants, wood and boats. Every model sits on y = 0 (boats: waterline at y = 0),
 * is centred on x/z and takes `seed`, `size`, `position`, `rotation` plus the
 * options listed per class. Bark and foliage textures come from the shared pool.
 */

const box = () => shared('flora:box', () => new BoxGeometry(1, 1, 1));
const ball = () => shared('flora:ball', () => new SphereGeometry(1, 8, 6));
const dome = () => shared('flora:dome', () => new SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
const tube = () => shared('flora:tube', () => { const c = new CylinderGeometry(1, 1, 1, 8); c.translate(0, 0.5, 0); return c; });
const cone = () => shared('flora:cone', () => { const c = new ConeGeometry(1, 1, 6); c.translate(0, 0.5, 0); return c; });
const blade = () => shared('flora:blade', () => { const c = new ConeGeometry(0.5, 1, 3); c.translate(0, 0.5, 0); return c; });

const euler = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z));

/** Mushroom: stalk and domed cap, usually spotted. `capColor`, `spots`. Collider: cylinder. */
export class Mushroom extends WorldModel {
  constructor({ capColor = 0xc23b32, spots = true, ...o }: any = {}) {
    super('Mushroom', o);
    const b = new MergeBuilder();
    const h = this.rand(0.18, 0.3), r = this.rand(0.12, 0.2);
    b.add(tube(), material(0xe8e0cc, true, true), { scale: [r * 0.35, h, r * 0.35], tint: this.rand(0.9, 1.05) });
    b.add(dome(), material(capColor, true, true), { position: [0, h * 0.9, 0], scale: [r, r * 0.8, r] });
    if (spots) {
      const spot = material(0xf5f0e0, true);
      const n = 4 + Math.floor(this.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = this.rand(0, Math.PI * 2), e = this.rand(0.3, 1.0), rr = r * 0.95 * Math.cos(e);
        b.add(ball(), spot, { position: [Math.cos(a) * rr, h * 0.9 + r * 0.8 * Math.sin(e), Math.sin(a) * rr], scale: [r * 0.14, r * 0.05, r * 0.14] });
      }
    }
    b.build(this);
    this.addShape('cylinder', { radius: r, height: h + r * 0.5 }, [0, (h + r * 0.5) / 2, 0]);
  }
}

/** GiantMushroom: a tall, tree-sized mushroom. `capColor`, `height`. Colliders: stalk cylinder, cap cylinder. */
export class GiantMushroom extends WorldModel {
  constructor({ capColor = 0xb8452f, height = 3, ...o }: any = {}) {
    super('GiantMushroom', o);
    const b = new MergeBuilder();
    const bark = this.surface('bark');
    const sw = this.rand(0.28, 0.38), cr = this.rand(1.1, 1.5) * (height / 3);
    b.add(tube(), bark, { scale: [sw, height, sw], tint: [1.4, 1.35, 1.2], uv: 'cyl' });
    b.add(dome(), material(capColor, true, true), { position: [0, height * 0.9, 0], scale: [cr, cr * 0.6, cr], tint: this.rand(0.9, 1.1) });
    const spot = material(0xf3ead2, true);
    for (let i = 0; i < 7; i++) {
      const a = this.rand(0, Math.PI * 2), e = this.rand(0.35, 1.1), rr = cr * 0.97 * Math.cos(e);
      b.add(ball(), spot, { position: [Math.cos(a) * rr, height * 0.9 + cr * 0.6 * Math.sin(e), Math.sin(a) * rr], scale: [cr * 0.12, cr * 0.04, cr * 0.12] });
    }
    b.build(this);
    this.addShape('cylinder', { radius: sw, height }, [0, height / 2, 0], null, 'stalk');
    this.addShape('cylinder', { radius: cr, height: cr * 0.4 }, [0, height * 0.9 + cr * 0.15, 0], null, 'cap');
  }
}

/** Cactus: saguaro with `arms` upturned arms (0-4). Colliders: trunk, one per arm. */
export class Cactus extends WorldModel {
  constructor({ arms = 2, height = 2.2, ...o }: any = {}) {
    super('Cactus', o);
    const n = WorldModel.clampInt(arms, 0, 4, 2);
    const b = new MergeBuilder();
    const green = this.surface('foliage', 0x3f7a45);
    const r = 0.18;
    b.add(tube(), green, { scale: [r, height, r], tint: this.rand(0.9, 1.1) });
    b.add(ball(), green, { position: [0, height, 0], scale: [r, r, r] });
    this.addShape('cylinder', { radius: r, height }, [0, height / 2, 0], null, 'trunk');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(0, 1), ar = 0.11, reach = this.rand(0.4, 0.55);
      const y = height * this.rand(0.35, 0.65), up = this.rand(0.4, 0.8);
      const dx = Math.cos(a), dz = Math.sin(a), t = this.rand(0.9, 1.1);
      b.add(tube(), green, { position: [dx * r * 0.5, y, dz * r * 0.5], scale: [ar, reach, ar], quaternion: euler(dz * Math.PI / 2, 0, -dx * Math.PI / 2), tint: t });
      const ex = dx * (r * 0.5 + reach), ez = dz * (r * 0.5 + reach);
      b.add(tube(), green, { position: [ex, y - ar * 0.5, ez], scale: [ar, up, ar], tint: t });
      b.add(ball(), green, { position: [ex, y + up - ar * 0.5, ez], scale: [ar, ar, ar], tint: t });
      this.addShape('cylinder', { radius: ar, height: up }, [ex, y + up / 2, ez], null, 'arm');
    }
    b.build(this);
  }
}

/** PalmTree: curved trunk of rings and a crown of drooping fronds. `height`, `fronds` (4-12), `coconuts`. Collider: trunk cylinder. */
export class PalmTree extends WorldModel {
  constructor({ height = 4.5, fronds = 8, coconuts = true, ...o }: any = {}) {
    super('PalmTree', o);
    const n = WorldModel.clampInt(fronds, 4, 12, 8);
    const b = new MergeBuilder();
    const bark = this.surface('bark', 0xb79a6a);
    const lean = this.rand(-0.25, 0.25), lean2 = this.rand(-0.25, 0.25);
    const segs = 6, sh = height / segs;
    let top: number[] = [0, 0, 0];
    for (let i = 0; i < segs; i++) {
      const f = i / segs, x = lean * f * f * height * 0.5, z = lean2 * f * f * height * 0.5;
      const w = 0.2 - f * 0.07;
      b.add(tube(), bark, { position: [x, i * sh, z], scale: [w, sh * 1.05, w], tint: i % 2 ? 0.85 : 1.05 });
      top = [x, (i + 1) * sh, z];
    }
    const leaf = material(0x3f8a3a, true, true);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(-0.15, 0.15), len = this.rand(1.3, 1.7);
      const q = new Quaternion().setFromAxisAngle(new Vector3(Math.sin(a), 0, -Math.cos(a)), 1.25 + this.rand(0, 0.2));
      b.add(blade(), leaf, {
        position: [top[0], top[1], top[2]], scale: [len * 0.22, len, 0.03], quaternion: q, tint: this.rand(0.85, 1.15),
      });
    }
    if (coconuts) {
      const nut = material(0x5a3d22, true);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(ball(), nut, { position: [top[0] + Math.cos(a) * 0.15, top[1] - 0.15, top[2] + Math.sin(a) * 0.15], scale: [0.1, 0.1, 0.1] });
      }
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.17, height }, [top[0] / 2, height / 2, top[2] / 2], null, 'trunk');
  }
}

/** Stump: a cut trunk with a flat top and root flare. `radius`, `height`. Collider: cylinder. */
export class Stump extends WorldModel {
  constructor({ radius = 0.4, height = 0.5, ...o }: any = {}) {
    super('Stump', o);
    const b = new MergeBuilder();
    const bark = this.surface('bark');
    b.add(tube(), bark, { scale: [radius, height, radius], tint: this.rand(0.9, 1.05) });
    const rings = material(0xc9a574, true, true);
    b.add(tube(), rings, { position: [0, height, 0], scale: [radius * 0.97, 0.01, radius * 0.97], tint: this.rand(0.95, 1.1) });
    const roots = 3 + Math.floor(this.random() * 3);
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + this.rand(-0.3, 0.3);
      b.add(cone(), bark, {
        position: [Math.cos(a) * radius * 0.9, height * 0.35, Math.sin(a) * radius * 0.9],
        scale: [radius * 0.25, height * 0.35, radius * 0.25], quaternion: euler(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1), tint: 0.85,
      });
    }
    b.build(this);
    this.addShape('cylinder', { radius, height }, [0, height / 2, 0]);
  }
}

/** Log: a fallen trunk lying along X, sometimes with a branch stub and moss. `length`, `radius`. Collider: cylinder lying along X. */
export class Log extends WorldModel {
  constructor({ length = 2, radius = 0.25, ...o }: any = {}) {
    super('Log', o);
    const b = new MergeBuilder();
    const bark = this.surface('bark');
    const q = euler(0, 0, Math.PI / 2);
    b.add(tube(), bark, { position: [length / 2, radius, 0], scale: [radius, length, radius], quaternion: q, tint: this.rand(0.9, 1.05) });
    if (this.random() < 0.5) {
      const x = this.rand(-0.3, 0.3) * length;
      b.add(cone(), bark, { position: [x, radius * 1.8, 0], scale: [radius * 0.3, radius * 0.9, radius * 0.3], tint: 0.9 });
    }
    if (this.random() < 0.6) {
      b.add(ball(), this.surface('foliage', 0x4f7a3a), { position: [this.rand(-0.2, 0.2), radius * 1.85, this.rand(-0.1, 0.1)], scale: [length * 0.15, radius * 0.25, radius * 0.5], detail: 2 });
    }
    b.build(this);
    this.addShape('cylinder', { radius, height: length }, [0, radius, 0], q);
  }
}

/** Reeds: a clump of tall grass blades with brown cattail heads. `stalks`, `height`. Collider: cylinder. */
export class Reeds extends WorldModel {
  constructor({ stalks = 14, height = 1.2, ...o }: any = {}) {
    super('Reeds', o);
    const n = WorldModel.clampInt(stalks, 3, 60, 14);
    const b = new MergeBuilder();
    const green = material(0x7aa046, true, true), brown = material(0x6b4a2a, true);
    for (let i = 0; i < n; i++) {
      const a = this.rand(0, Math.PI * 2), r = this.rand(0, 0.3), h = height * this.rand(0.6, 1.1), k = this.rand(0.85, 1.15);
      const tilt = this.rand(-0.15, 0.15), ta = this.rand(0, Math.PI * 2);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const q = euler(Math.cos(ta) * tilt, 0, Math.sin(ta) * tilt);
      b.add(blade(), green, { position: [x, 0, z], scale: [0.04, h, 0.02], quaternion: q, yaw: 0, tint: [k * 0.95, k, k * 0.8] });
      if (this.random() < 0.3) {
        b.add(tube(), brown, { position: [x + Math.sin(tilt) * h * 0.75 * Math.sin(ta + 1.57), h * 0.7, z], scale: [0.035, 0.18, 0.035] });
      }
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.3, height }, [0, height / 2, 0], null, 'reeds');
  }
}

/** Pumpkin: ribbed squashed orange body with a stem. `color`. Collider: sphere. */
export class Pumpkin extends WorldModel {
  constructor({ color = 0xe2731c, ...o }: any = {}) {
    super('Pumpkin', o);
    const b = new MergeBuilder();
    const skin = material(color, true, true);
    const r = 0.3 * this.rand(0.9, 1.15), ribs = 7;
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI;
      b.add(ball(), skin, { position: [0, r * 0.75, 0], scale: [r * 0.55, r * 0.75, r * 0.95], yaw: a, tint: i % 2 ? 0.95 : 1.05 });
    }
    b.add(tube(), material(0x4f6b2a, true, true), { position: [0, r * 1.45, 0], scale: [0.035, 0.12, 0.035], tint: this.rand(0.9, 1.1) });
    b.build(this);
    this.addShape('sphere', { radius: r * 0.95 }, [0, r * 0.75, 0]);
  }
}

/** Rowboat: open wooden hull with thwarts and two oars. `length`, `oars`. Colliders: hull box, bow and stern boxes. */
export class Rowboat extends WorldModel {
  constructor({ length = 3, oars = true, ...o }: any = {}) {
    super('Rowboat', o);
    const b = new MergeBuilder();
    const planks = this.surface('planks');
    const w = length * 0.36, hh = 0.4;
    b.add(box(), planks, { position: [0, 0.03, 0], scale: [length * 0.8, 0.06, w * 0.8], tint: 0.8 });
    for (const s of [-1, 1]) {
      b.add(box(), planks, { position: [0, hh / 2, s * w * 0.45], scale: [length * 0.85, hh, 0.05], quaternion: euler(s * 0.2, 0, 0), tint: 1 });
      b.add(box(), planks, { position: [s * length * 0.45, hh / 2, 0], scale: [0.05, hh, w * 0.7], tint: 0.95 });
      b.add(box(), planks, { position: [s * length * 0.5, hh * 0.55, 0], scale: [0.18, hh * 0.9, 0.05], quaternion: euler(0, 0, -s * 0.9), tint: 0.95, yaw: 0 });
    }
    for (const x of [-0.2, 0.25]) {
      b.add(box(), planks, { position: [x * length, hh * 0.65, 0], scale: [0.2, 0.04, w * 0.85], tint: 1.1 });
    }
    if (oars) {
      const wood = material(0x9a7448, true, true);
      for (const s of [-1, 1]) {
        const q = euler(0, 0, 0);
        b.add(tube(), wood, { position: [0.05, hh + 0.08, s * w * 0.5], scale: [0.025, 1.3, 0.025], quaternion: euler(s * (Math.PI / 2 - 0.15), 0, 0), tint: 1 });
        b.add(box(), wood, { position: [0.05, hh * 0.9, s * (w * 0.5 + 1.25)], scale: [0.15, 0.02, 0.28], tint: 0.9, quaternion: q });
      }
    }
    b.build(this);
    this.addShape('box', { size: [length * 0.85, hh, w * 0.9] }, [0, hh / 2, 0], null, 'hull');
    this.addShape('box', { size: [length * 0.2, hh, w * 0.5] }, [length * 0.5, hh / 2, 0], null, 'bow');
    this.addShape('box', { size: [length * 0.1, hh, w * 0.6] }, [-length * 0.5, hh / 2, 0], null, 'stern');
  }
}

/** Ship: sailing ship with hull, deck, cabin, `masts` (1-3) with sails and a bowsprit. `length`, `sailColor`. Colliders: hull, cabin, one per mast. */
export class Ship extends WorldModel {
  constructor({ length = 10, masts = 2, sailColor = 0xf1ead6, ...o }: any = {}) {
    super('Ship', o);
    const n = WorldModel.clampInt(masts, 1, 3, 2);
    const b = new MergeBuilder();
    const planks = this.surface('planks', 0x8a5a33);
    const wood = this.surface('planks', 0xb08455);
    const w = length * 0.3, hh = length * 0.18, deckY = hh * 0.55;
    b.add(box(), planks, { position: [0, deckY / 2 - 0.1 * hh, 0], scale: [length * 0.7, hh, w], tint: 0.85 });
    b.add(box(), planks, { position: [-length * 0.38, deckY / 2 + hh * 0.1, 0], scale: [length * 0.18, hh * 1.1, w * 0.9], tint: 0.95 });
    b.add(cone(), planks, { position: [length * 0.38, 0, 0], scale: [w * 0.5, w * 0.6, w * 0.5], quaternion: euler(0, 0, -Math.PI / 2), tint: 0.9 });
    b.add(box(), wood, { position: [0, deckY + 0.05, 0], scale: [length * 0.68, 0.1, w * 0.92], tint: 1.1 });
    b.add(box(), wood, { position: [-length * 0.36, deckY + hh * 0.5, 0], scale: [length * 0.2, hh * 0.9, w * 0.8], tint: 1 });
    const sail = material(sailColor, true, true), mast = material(0x5a3d22, true, true);
    const mh = length * 0.7;
    this.addShape('box', { size: [length * 0.7, hh, w] }, [0, deckY / 2 - 0.1 * hh, 0], null, 'hull');
    this.addShape('box', { size: [length * 0.2, hh * 0.9, w * 0.8] }, [-length * 0.36, deckY + hh * 0.5, 0], null, 'cabin');
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? length * 0.05 : length * (0.22 - (0.5 * i) / (n - 1));
      const mw = 0.07 * (length / 10);
      b.add(tube(), mast, { position: [x, deckY, 0], scale: [mw, mh, mw] });
      for (const [fy, fw] of [[0.45, 0.8], [0.8, 0.6]]) {
        const yy = deckY + mh * fy;
        b.add(tube(), mast, { position: [x, yy + mh * 0.18, 0], scale: [mw * 0.6, w * 1.4 * fw, mw * 0.6], quaternion: euler(Math.PI / 2, 0, 0) });
        b.add(box(), sail, { position: [x + 0.05, yy - mh * 0.08, 0], scale: [0.04, mh * 0.34, w * 1.3 * fw], tint: this.rand(0.95, 1.05) });
      }
      this.addShape('cylinder', { radius: mw, height: mh }, [x, deckY + mh / 2, 0], null, 'mast');
    }
    b.add(tube(), mast, { position: [length * 0.42, deckY, 0], scale: [0.05, length * 0.22, 0.05], quaternion: euler(0, 0, -Math.PI / 2 + 0.3) });
    b.build(this);
  }
}
