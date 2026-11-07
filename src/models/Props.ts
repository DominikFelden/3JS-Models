import { BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, TorusGeometry, MeshStandardMaterial, Quaternion, Euler } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

/**
 * Small props: campfire, torch, lantern, chest, barrel, crate, banner, cart,
 * anvil, table, chair and bed. Each sits on y = 0, centred on x/z, with `seed`
 * picking textures and small variations. All options are optional.
 */

const box = () => shared('prop:box', () => new BoxGeometry(1, 1, 1));
const cyl = () => shared('prop:cyl', () => new CylinderGeometry(1, 1, 1, 10));
const cone = () => shared('prop:cone', () => new ConeGeometry(1, 1, 6));
const ball = () => shared('prop:ball', () => new SphereGeometry(1, 8, 6));
const ring = () => shared('prop:ring', () => new TorusGeometry(1, 0.08, 4, 12));
const iron = () => material(0x3a3a40, true, true);
const flame = () => shared('prop:flame', () => new MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff5a00, emissiveIntensity: 1.2, flatShading: true, roughness: 1 }));
const glow = () => shared('prop:glow', () => new MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 1, flatShading: true, roughness: 1 }));
const flat = (q: Quaternion, x: number, y: number, z: number) => q.setFromEuler(new Euler(x, y, z));
const hoop = (b: MergeBuilder, y: number, r: number) => b.add(ring(), iron(), { position: [0, y, 0], scale: [r, r, r * 3], quaternion: flat(new Quaternion(), Math.PI / 2, 0, 0) });

/** Ring of stones around crossed logs and a flame. `lit` toggles the fire; `logs` is the log count (3-8). */
export class Campfire extends WorldModel {
  constructor({ radius = 0.6, logs = 5, lit = true, ...o }: any = {}) {
    super('Campfire', o);
    const n = WorldModel.clampInt(logs, 3, 8, 5);
    const b = new MergeBuilder();
    const rock = this.surface('rock');
    const wood = this.surface('bark');
    const stones = 8;
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + this.rand(-0.1, 0.1), s = this.rand(0.12, 0.17);
      b.add(ball(), rock, { position: [Math.cos(a) * radius, s * 0.6, Math.sin(a) * radius], scale: [s, s * 0.8, s], tint: this.rand(0.85, 1.05) });
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(-0.15, 0.15);
      const q = new Quaternion().setFromEuler(new Euler(Math.PI / 2 - 0.35, 0, 0)).premultiply(new Quaternion().setFromEuler(new Euler(0, a, 0)));
      b.add(cyl(), wood, { position: [Math.cos(a) * radius * 0.25, 0.14, -Math.sin(a) * radius * 0.25], scale: [0.07, radius * 1.1, 0.07], quaternion: q, uv: 'cyl' });
    }
    if (lit) {
      b.add(cone(), flame(), { position: [0, 0.3, 0], scale: [0.22, 0.55, 0.22] });
      b.add(cone(), glow(), { position: [0, 0.25, 0], scale: [0.12, 0.35, 0.12] });
    }
    b.build(this);
    this.addShape('cylinder', { radius: radius + 0.15, height: 0.3 }, [0, 0.15, 0], null, 'fire');
  }
}

/** Wooden torch with a wrapped head. `lit` toggles the flame. */
export class Torch extends WorldModel {
  constructor({ height = 1.2, lit = true, ...o }: any = {}) {
    super('Torch', o);
    const b = new MergeBuilder();
    b.add(cyl(), this.surface('bark'), { position: [0, height / 2, 0], scale: [0.04, height, 0.04], uv: 'cyl' });
    b.add(cyl(), iron(), { position: [0, height - 0.05, 0], scale: [0.07, 0.14, 0.07] });
    if (lit) {
      b.add(cone(), flame(), { position: [0, height + 0.15, 0], scale: [0.1, 0.3, 0.1] });
      b.add(cone(), glow(), { position: [0, height + 0.1, 0], scale: [0.06, 0.18, 0.06] });
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.06, height }, [0, height / 2, 0], null, 'torch');
  }
}

/** Iron lantern with glowing glass. `hanging` adds a handle ring on top. */
export class Lantern extends WorldModel {
  constructor({ height = 0.35, hanging = false, lit = true, ...o }: any = {}) {
    super('Lantern', o);
    const b = new MergeBuilder();
    const w = height * 0.5;
    b.add(box(), iron(), { position: [0, 0.03, 0], scale: [w, 0.06, w] });
    b.add(box(), lit ? glow() : material(0xb9c6c8, true, true), { position: [0, 0.06 + height / 2, 0], scale: [w * 0.8, height, w * 0.8] });
    b.add(cone(), iron(), { position: [0, 0.06 + height + 0.05, 0], scale: [w * 0.85, 0.1, w * 0.85] });
    if (hanging) b.add(ring(), iron(), { position: [0, 0.06 + height + 0.16, 0], scale: [0.07, 0.07, 0.07] });
    b.build(this);
    const h = height + 0.2 + (hanging ? 0.1 : 0);
    this.addShape('box', { size: [w, h, w] }, [0, h / 2, 0], null, 'lantern');
  }
}

/** Wooden chest with iron bands. `open` raises the lid; `locked` adds a lock plate. */
export class Chest extends WorldModel {
  constructor({ width = 0.9, depth = 0.55, height = 0.5, open = false, locked = true, ...o }: any = {}) {
    super('Chest', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const lidH = 0.2;
    b.add(box(), wood, { position: [0, height / 2, 0], scale: [width, height, depth], tint: this.rand(0.9, 1.05) });
    for (const x of [-0.3, 0.3]) b.add(box(), iron(), { position: [x * width, height / 2, 0], scale: [0.06, height + 0.02, depth + 0.02] });
    if (open) {
      const q = new Quaternion().setFromEuler(new Euler(-1.9, 0, 0));
      b.add(box(), wood, { position: [0, height + 0.02, -depth / 2 - 0.05], scale: [width, lidH, depth], quaternion: q });
      b.add(box(), glow(), { position: [0, height - 0.02, 0], scale: [width * 0.85, 0.05, depth * 0.8] });
    } else {
      b.add(box(), wood, { position: [0, height + lidH / 2, 0], scale: [width + 0.02, lidH, depth + 0.02] });
      for (const x of [-0.3, 0.3]) b.add(box(), iron(), { position: [x * width, height + lidH / 2, 0], scale: [0.06, lidH + 0.02, depth + 0.04] });
      if (locked) b.add(box(), iron(), { position: [0, height, depth / 2 + 0.02], scale: [0.1, 0.12, 0.04] });
    }
    b.build(this);
    this.addShape('box', { size: [width, height + (open ? 0.1 : lidH), depth] }, [0, (height + (open ? 0.1 : lidH)) / 2, 0], null, 'chest');
  }
}

/** Wooden barrel with iron hoops. */
export class Barrel extends WorldModel {
  constructor({ radius = 0.35, height = 0.9, ...o }: any = {}) {
    super('Barrel', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    b.add(cyl(), wood, { position: [0, height / 2, 0], scale: [radius, height, radius], tint: this.rand(0.9, 1.05), uv: 'cyl' });
    b.add(cyl(), wood, { position: [0, height / 2, 0], scale: [radius * 1.08, height * 0.5, radius * 1.08], uv: 'cyl' });
    for (const y of [0.18, 0.5, 0.82]) hoop(b, y * height, radius * 1.09);
    b.build(this);
    this.addShape('cylinder', { radius: radius * 1.08, height }, [0, height / 2, 0], null, 'barrel');
  }
}

/** Wooden crate with corner battens. */
export class Crate extends WorldModel {
  constructor({ edge: s = 0.7, ...o }: any = {}) {
    super('Crate', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    b.add(box(), wood, { position: [0, s / 2, 0], scale: [s, s, s], tint: this.rand(0.9, 1.05) });
    const d = s / 2, t = 0.06;
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(box(), wood, { position: [x * d, s / 2, z * d], scale: [t, s + 0.02, t], tint: 0.8 });
    for (const y of [0.03, s - 0.03]) b.add(box(), wood, { position: [0, y, 0], scale: [s + 0.04, 0.06, s + 0.04], tint: 0.85 });
    b.build(this);
    this.addShape('box', { size: [s, s, s] }, [0, s / 2, 0], null, 'crate');
  }
}

const BANNER_COLOURS = [0xa02828, 0x2a4f9a, 0x2f7a3a, 0x7a3a8a, 0xc8a02a];

/** Cloth banner hanging from a crossbar on a pole. `color` overrides the seeded cloth colour. */
export class Banner extends WorldModel {
  constructor({ height = 2.6, width = 0.9, length = 1.6, color = null, ...o }: any = {}) {
    super('Banner', o);
    const b = new MergeBuilder();
    const wood = this.surface('bark');
    const cloth = material(color ?? BANNER_COLOURS[Math.floor(this.random() * BANNER_COLOURS.length)], true, true);
    b.add(cyl(), wood, { position: [0, height / 2, 0], scale: [0.04, height, 0.04], uv: 'cyl' });
    b.add(cyl(), wood, { position: [0, height - 0.1, 0], scale: [0.03, width + 0.2, 0.03], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)) });
    b.add(ball(), iron(), { position: [0, height + 0.02, 0], scale: [0.07, 0.07, 0.07] });
    b.add(box(), cloth, { position: [0, height - 0.15 - length / 2, 0.02], scale: [width, length, 0.02] });
    b.add(cone(), cloth, { position: [0, height - 0.15 - length - 0.1, 0.02], scale: [width / 2, 0.2, 0.02], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI)) });
    b.add(cyl(), wood, { position: [0, 0.04, 0], scale: [0.2, 0.08, 0.2] });
    b.build(this);
    this.addShape('cylinder', { radius: 0.1, height }, [0, height / 2, 0], null, 'pole');
  }
}

/** Two-wheeled handcart with side rails and shafts. `loaded` adds sacks. */
export class Cart extends WorldModel {
  constructor({ length = 1.8, width = 1, loaded = true, ...o }: any = {}) {
    super('Cart', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const dark = this.surface('bark');
    const r = 0.45, floor = r;
    b.add(box(), wood, { position: [0, floor, 0], scale: [length, 0.08, width] });
    for (const z of [-1, 1]) b.add(box(), wood, { position: [0, floor + 0.2, z * (width / 2 - 0.03)], scale: [length, 0.3, 0.05], tint: 0.9 });
    b.add(box(), wood, { position: [-length / 2 + 0.03, floor + 0.2, 0], scale: [0.05, 0.3, width] });
    b.add(cyl(), dark, { position: [0, r, 0], scale: [0.04, width + 0.3, 0.04], quaternion: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)) });
    const wq = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
    for (const z of [-1, 1]) {
      b.add(cyl(), wood, { position: [0, r, z * (width / 2 + 0.12)], scale: [r, 0.06, r], quaternion: wq, uv: 'cyl' });
      b.add(cyl(), dark, { position: [0, r, z * (width / 2 + 0.16)], scale: [0.08, 0.06, 0.08], quaternion: wq });
      b.add(cyl(), dark, { position: [length / 2 + 0.4, floor - 0.12, z * (width / 2 - 0.1)], scale: [0.025, length * 0.45 + 0.7, 0.025], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2 - 0.15)) });
    }
    if (loaded) {
      const sack = material(0xb59a6a, true, true);
      for (let i = 0; i < 3; i++) {
        const s = this.rand(0.22, 0.3);
        b.add(ball(), sack, { position: [-length * 0.25 + i * 0.4, floor + 0.04 + s * 0.7, this.rand(-0.15, 0.15)], scale: [s, s * 0.8, s], tint: this.rand(0.85, 1.05) });
      }
    }
    b.build(this);
    this.addShape('box', { size: [length, 0.4, width] }, [0, floor + 0.15, 0], null, 'bed');
    for (const z of [-1, 1]) this.addShape('cylinder', { radius: r, height: 0.1 }, [0, r, z * (width / 2 + 0.12)], new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)), 'wheel');
  }
}

/** Blacksmith anvil on an optional wooden stump. */
export class Anvil extends WorldModel {
  constructor({ stump = true, ...o }: any = {}) {
    super('Anvil', o);
    const b = new MergeBuilder();
    const base = stump ? 0.5 : 0;
    if (stump) b.add(cyl(), this.surface('bark'), { position: [0, base / 2, 0], scale: [0.3, base, 0.3], uv: 'cyl' });
    const steel = material(0x55585f, true, true);
    b.add(box(), steel, { position: [0, base + 0.05, 0], scale: [0.4, 0.1, 0.25] });
    b.add(box(), steel, { position: [0, base + 0.18, 0], scale: [0.2, 0.16, 0.16] });
    b.add(box(), steel, { position: [0, base + 0.31, 0], scale: [0.55, 0.1, 0.22], tint: 1.1 });
    b.add(cone(), steel, { position: [0.38, base + 0.31, 0], scale: [0.17, 0.2, 0.17], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, -Math.PI / 2)) });
    b.build(this);
    this.addShape('cylinder', { radius: 0.28, height: base || 0.01 }, [0, base / 2, 0], null, 'stump');
    this.addShape('box', { size: [0.8, 0.36, 0.25] }, [0.05, base + 0.18, 0], null, 'anvil');
  }
}

/** Wooden table with four legs. */
export class Table extends WorldModel {
  constructor({ width = 1.6, depth = 0.9, height = 0.8, round = false, ...o }: any = {}) {
    super('Table', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const t = 0.07;
    if (round) {
      b.add(cyl(), wood, { position: [0, height - t / 2, 0], scale: [width / 2, t, width / 2], uv: 'cyl' });
      b.add(cyl(), wood, { position: [0, (height - t) / 2, 0], scale: [0.1, height - t, 0.1], tint: 0.85, uv: 'cyl' });
      b.add(cyl(), wood, { position: [0, 0.03, 0], scale: [width * 0.25, 0.06, width * 0.25], tint: 0.85 });
    } else {
      b.add(box(), wood, { position: [0, height - t / 2, 0], scale: [width, t, depth] });
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        b.add(box(), wood, { position: [x * (width / 2 - 0.08), (height - t) / 2, z * (depth / 2 - 0.08)], scale: [0.08, height - t, 0.08], tint: 0.85 });
      }
    }
    b.build(this);
    if (round) {
      this.addShape('cylinder', { radius: width / 2, height: t }, [0, height - t / 2, 0], null, 'top');
      this.addShape('cylinder', { radius: 0.1, height: height - t }, [0, (height - t) / 2, 0], null, 'leg');
    } else {
      this.addShape('box', { size: [width, t, depth] }, [0, height - t / 2, 0], null, 'top');
      for (const x of [-1, 1]) for (const z of [-1, 1]) this.addShape('box', { size: [0.08, height - t, 0.08] }, [x * (width / 2 - 0.08), (height - t) / 2, z * (depth / 2 - 0.08)], null, 'leg');
    }
  }
}

/** Wooden chair facing +Z, with a backrest on the -Z side. `stool` drops the backrest. */
export class Chair extends WorldModel {
  constructor({ seatHeight = 0.48, edge: s = 0.45, stool = false, ...o }: any = {}) {
    super('Chair', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const backH = 0.5;
    b.add(box(), wood, { position: [0, seatHeight, 0], scale: [s, 0.05, s] });
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(box(), wood, { position: [x * (s / 2 - 0.03), seatHeight / 2, z * (s / 2 - 0.03)], scale: [0.05, seatHeight, 0.05], tint: 0.85 });
    if (!stool) {
      b.add(box(), wood, { position: [0, seatHeight + backH / 2, -s / 2 + 0.03], scale: [s, backH, 0.04], tint: 0.9 });
      b.add(box(), wood, { position: [0, seatHeight + backH - 0.1, -s / 2 + 0.03], scale: [s + 0.04, 0.1, 0.05] });
    }
    b.build(this);
    this.addShape('box', { size: [s, 0.05, s] }, [0, seatHeight, 0], null, 'seat');
    this.addShape('box', { size: [s, seatHeight, s] }, [0, seatHeight / 2, 0], null, 'legs');
    if (!stool) this.addShape('box', { size: [s, backH, 0.05] }, [0, seatHeight + backH / 2, -s / 2 + 0.03], null, 'back');
  }
}

const BLANKETS = [0x8a3a3a, 0x3a5a8a, 0x4a7a4a, 0x8a7a3a];

/** Bed with frame, mattress, pillow and blanket; the headboard is at -Z. `color` sets the blanket. */
export class Bed extends WorldModel {
  constructor({ width = 1, length = 2, color = null, ...o }: any = {}) {
    super('Bed', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const blanket = material(color ?? BLANKETS[Math.floor(this.random() * BLANKETS.length)], true, true);
    const linen = material(0xe8e2d0, true, true);
    const legH = 0.25, frameH = 0.1, matH = 0.18;
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(box(), wood, { position: [x * (width / 2 - 0.04), legH / 2, z * (length / 2 - 0.04)], scale: [0.08, legH, 0.08], tint: 0.85 });
    b.add(box(), wood, { position: [0, legH + frameH / 2, 0], scale: [width, frameH, length] });
    b.add(box(), wood, { position: [0, 0.45, -length / 2 + 0.03], scale: [width, 0.8, 0.06], tint: 0.9 });
    b.add(box(), wood, { position: [0, 0.3, length / 2 - 0.03], scale: [width, 0.5, 0.06], tint: 0.9 });
    const top = legH + frameH;
    b.add(box(), linen, { position: [0, top + matH / 2, 0], scale: [width - 0.1, matH, length - 0.1] });
    b.add(box(), linen, { position: [0, top + matH + 0.06, -length / 2 + 0.3], scale: [width * 0.7, 0.12, 0.4], tint: this.rand(0.95, 1.05) });
    b.add(box(), blanket, { position: [0, top + matH + 0.02, 0.25], scale: [width - 0.06, 0.05, length * 0.6] });
    b.build(this);
    this.addShape('box', { size: [width, top + matH, length] }, [0, (top + matH) / 2, 0], null, 'mattress');
    this.addShape('box', { size: [width, 0.8, 0.06] }, [0, 0.45, -length / 2 + 0.03], null, 'headboard');
  }
}
