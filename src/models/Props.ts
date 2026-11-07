import {
  BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, TorusGeometry, LatheGeometry, ExtrudeGeometry, PlaneGeometry,
  Shape, Vector2, Vector3, MeshStandardMaterial, Quaternion, Euler,
} from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';
import { rockBlob, flameGeometry, withBackFaces, BLOB_VARIANTS } from './terrain.ts';

/**
 * Small props: campfire, torch, lantern, chest, barrel, crate, banner, cart,
 * anvil, table, chair and bed. Each sits on y = 0, centred on x/z, with `seed`
 * picking textures and small variations. All options are optional.
 */

const box = () => shared('prop:box', () => new BoxGeometry(1, 1, 1));
const cyl = () => shared('prop:cyl', () => new CylinderGeometry(1, 1, 1, 10));
const tube = () => shared('prop:tube', () => new CylinderGeometry(1, 1, 1, 16, 1, true));
const cone = () => shared('prop:cone', () => new ConeGeometry(1, 1, 6));
const ball = () => shared('prop:ball', () => new SphereGeometry(1, 8, 6));
const ring = () => shared('prop:ring', () => new TorusGeometry(1, 0.08, 4, 12));
const rim = () => shared('prop:rim', () => new TorusGeometry(1, 0.09, 4, 18));
const halfCyl = () => shared('prop:halfcyl', () => new CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2));
const halfBand = () => shared('prop:halfband', () => new CylinderGeometry(1, 1, 1, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2));
const iron = () => material(0x3a3a40, true, true);
const brass = () => material(0xb08a3a, true, true);
const flame = () => shared('prop:flame', () => new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0xff4a00, emissiveIntensity: 0.9, flatShading: true, roughness: 1 }));
const glow = () => shared('prop:glow', () => new MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 1, flatShading: true, roughness: 1 }));
const core = () => shared('prop:core', () => new MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe080, emissiveIntensity: 1.4, flatShading: true, roughness: 1 }));
const flat = (q: Quaternion, x: number, y: number, z: number) => q.setFromEuler(new Euler(x, y, z));
const NO_BIRCH = [0, 1, 2, 4];

/** Layered painted flame (orange body, yellow core, small licking tongues) standing at (x, y, z). */
function addFlame(b: MergeBuilder, x: number, y: number, z: number, s: number, tongues = 3) {
  const f = flameGeometry();
  // Painted gradient: golden at the base, deep orange-red at the tips.
  const tint = (_x: number, py: number): [number, number, number] => {
    const t = Math.min(1, Math.max(0, (py - y) / s));
    return [1, 0.82 - 0.5 * t, 0.32 - 0.24 * t];
  };
  b.add(f, flame(), { position: [x, y, z], scale: [s * 0.42, s, s * 0.42], tint });
  b.add(f, core(), { position: [x, y, z], scale: [s * 0.24, s * 0.6, s * 0.24], yaw: 1.3 });
  for (let i = 0; i < tongues; i++) {
    const a = (i / tongues) * Math.PI * 2 + 0.4, d = s * 0.2;
    b.add(f, flame(), { position: [x + Math.cos(a) * d, y, z + Math.sin(a) * d], scale: [s * 0.2, s * (0.5 + 0.12 * i), s * 0.2], yaw: a, tint });
  }
}

/** Barrel profile: radius at height share t (0..1) of a stave barrel with a bulge. */
const bulge = (t: number) => 0.86 + 0.14 * Math.sin(Math.PI * t);
const barrelBody = () => shared('prop:barrel', () => {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(new Vector2(bulge(i / 8), i / 8 - 0.5));
  return new LatheGeometry(pts, 16);
});

/** Ring of stones around crossed, charred logs, a bed of embers and a flame. `lit` toggles the fire; `logs` is the log count (3-8). */
export class Campfire extends WorldModel {
  constructor({ radius = 0.6, logs = 5, lit = true, ...o }: any = {}) {
    super('Campfire', o);
    const n = WorldModel.clampInt(logs, 3, 8, 5);
    const b = new MergeBuilder();
    const rock = this.surface('rock');
    const wood = this.surface('bark', null, true, NO_BIRCH);
    const stones = Math.max(7, Math.round(radius * 14));
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + this.rand(-0.1, 0.1), s = this.rand(0.12, 0.17) * Math.max(1, radius / 0.6);
      b.add(rockBlob(i % BLOB_VARIANTS, 1), rock, { position: [Math.cos(a) * radius, s * 0.3, Math.sin(a) * radius], scale: [s, s * 0.75, s * 0.9], yaw: a, tint: this.rand(0.85, 1.05), detail: 4 });
    }
    b.add(shared('prop:ash', () => new CylinderGeometry(1, 1, 1, 9)), material(0x4a4440, true, true), { position: [0, 0.01, 0], scale: [radius * 0.7, 0.02, radius * 0.7], tint: (x, _y, z) => 0.55 + 0.6 * Math.min(1, Math.hypot(x, z) / (radius * 0.7)) });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(-0.15, 0.15);
      const q = new Quaternion().setFromEuler(new Euler(Math.PI / 2 - 0.35, 0, 0)).premultiply(new Quaternion().setFromEuler(new Euler(0, a, 0)));
      // Charred towards the fire: dark at the inner end.
      b.add(cyl(), wood, {
        position: [Math.cos(a) * radius * 0.25, 0.14, -Math.sin(a) * radius * 0.25], scale: [0.07, radius * 1.1, 0.07], quaternion: q, uv: 'cyl',
        tint: (x, y, z) => 0.25 + 0.75 * Math.min(1, Math.hypot(x, z) / (radius * 0.55)),
      });
    }
    if (lit) {
      const ember = glow();
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4, d = radius * 0.3 * ((i % 3) / 3 + 0.2);
        b.add(rockBlob(i, 0), ember, { position: [Math.cos(a) * d, 0.03, Math.sin(a) * d], scale: [0.06, 0.04, 0.06] });
      }
      addFlame(b, 0, 0.08, 0, Math.max(0.5, radius * 0.95), 4);
    }
    b.build(this);
    this.addShape('cylinder', { radius: radius + 0.15, height: 0.3 }, [0, 0.15, 0], null, 'fire');
  }
}

/** Wooden torch: tapered handle, iron collar and a cloth-wrapped head. `lit` toggles the flame. */
export class Torch extends WorldModel {
  constructor({ height = 1.2, lit = true, ...o }: any = {}) {
    super('Torch', o);
    const b = new MergeBuilder();
    const stick = shared('prop:torchstick', () => new CylinderGeometry(1, 0.7, 1, 7));
    b.add(stick, this.surface('bark', null, true, NO_BIRCH), { position: [0, height / 2, 0], scale: [0.045, height, 0.045], uv: 'cyl' });
    b.add(cyl(), iron(), { position: [0, height - 0.2, 0], scale: [0.055, 0.04, 0.055] });
    const wrap = material(0x6a5238, true, true);
    for (let i = 0; i < 3; i++) b.add(cyl(), wrap, { position: [0, height - 0.14 + i * 0.06, 0], scale: [0.065 - i * 0.004, 0.06, 0.065 - i * 0.004], yaw: i * 0.7, tint: 0.8 + i * 0.1 });
    b.add(ball(), material(0x2a221c, true, true), { position: [0, height + 0.03, 0], scale: [0.055, 0.035, 0.055] });
    if (lit) addFlame(b, 0, height + 0.02, 0, 0.32, 3);
    b.build(this);
    this.addShape('cylinder', { radius: 0.06, height }, [0, height / 2, 0], null, 'torch');
  }
}

/** Iron lantern: base, four corner posts, glowing glass panes, a peaked cap and a handle. `hanging` adds a hook ring on top. */
export class Lantern extends WorldModel {
  constructor({ height = 0.35, hanging = false, lit = true, ...o }: any = {}) {
    super('Lantern', o);
    const b = new MergeBuilder();
    const w = height * 0.5, base = 0.05, top = base + height;
    const pane = lit ? glow() : material(0xb9c6c8, true, true);
    b.add(box(), iron(), { position: [0, base / 2, 0], scale: [w * 1.1, base, w * 1.1] });
    b.add(box(), iron(), { position: [0, base + 0.01, 0], scale: [w * 0.9, 0.02, w * 0.9] });
    b.add(box(), pane, { position: [0, base + height / 2, 0], scale: [w * 0.82, height * 0.96, w * 0.82] });
    if (lit) addFlame(b, 0, base + height * 0.18, 0, height * 0.45, 0);
    const t = w * 0.12;
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(box(), iron(), { position: [x * w / 2, base + height / 2, z * w / 2], scale: [t, height, t] });
    for (const y of [base + height * 0.5]) {
      b.add(box(), iron(), { position: [0, y, w / 2], scale: [w, t * 0.6, t * 0.6] });
      b.add(box(), iron(), { position: [0, y, -w / 2], scale: [w, t * 0.6, t * 0.6] });
      b.add(box(), iron(), { position: [w / 2, y, 0], scale: [t * 0.6, t * 0.6, w] });
      b.add(box(), iron(), { position: [-w / 2, y, 0], scale: [t * 0.6, t * 0.6, w] });
    }
    b.add(box(), iron(), { position: [0, top, 0], scale: [w * 1.15, 0.025, w * 1.15] });
    const capQ = flat(new Quaternion(), 0, Math.PI / 4, 0);
    b.add(shared('prop:pyr', () => new ConeGeometry(1, 1, 4)), iron(), { position: [0, top + 0.06, 0], scale: [w * 0.82, 0.12, w * 0.82], quaternion: capQ });
    b.add(cyl(), iron(), { position: [0, top + 0.13, 0], scale: [w * 0.12, 0.04, w * 0.12] });
    b.add(ring(), iron(), { position: [0, top + 0.13 + (hanging ? 0.08 : 0.05), 0], scale: [hanging ? 0.07 : 0.05, hanging ? 0.07 : 0.05, 0.05] });
    b.build(this);
    const h = height + 0.2 + (hanging ? 0.1 : 0);
    this.addShape('box', { size: [w, h, w] }, [0, h / 2, 0], null, 'lantern');
  }
}

/** Wooden chest with a domed lid, iron bands and corner caps. `open` raises the lid; `locked` adds a lock plate. */
export class Chest extends WorldModel {
  constructor({ width = 0.9, depth = 0.55, height = 0.5, open = false, locked = true, ...o }: any = {}) {
    super('Chest', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const lidH = 0.2;
    b.add(box(), wood, { position: [0, height / 2, 0], scale: [width, height, depth], tint: this.rand(0.9, 1.05) });
    for (const x of [-0.3, 0.3]) b.add(box(), iron(), { position: [x * width, height / 2, 0], scale: [0.06, height + 0.02, depth + 0.02] });
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      b.add(box(), iron(), { position: [x * (width / 2 - 0.03), 0.06, z * (depth / 2 - 0.03)], scale: [0.08, 0.12, 0.08] });
    }
    b.add(box(), iron(), { position: [0, height - 0.02, 0], scale: [width + 0.02, 0.04, depth + 0.02] });
    // Domed lid: half cylinder along X (radius = half the depth, flattened to lidH), hinged at the back.
    const lid = (q, at) => {
      b.add(halfCyl(), wood, { position: at(0), scale: [width + 0.02, lidH, depth / 2 + 0.01], quaternion: q });
      for (const x of [-0.3, 0.3]) b.add(halfBand(), iron(), { position: at(x * width), scale: [0.07, lidH + 0.015, depth / 2 + 0.025], quaternion: q });
      for (const x of [-1, 1]) b.add(halfBand(), iron(), { position: at(x * (width / 2 - 0.02)), scale: [0.05, lidH + 0.012, depth / 2 + 0.02], quaternion: q });
    };
    if (open) {
      const a = -1.9, q = new Quaternion().setFromEuler(new Euler(a, 0, 0));
      // The lid centre sits depth/2 in front of the hinge (back top edge); swing that offset with the lid.
      lid(q, (x) => [x, height - Math.sin(a) * depth / 2, -depth / 2 + Math.cos(a) * depth / 2]);
      b.add(box(), material(0x2a1c12, true, true), { position: [0, height - 0.03, 0], scale: [width - 0.06, 0.02, depth - 0.06] });
      for (let i = 0; i < 9; i++) {
        const s = 0.07 + 0.03 * Math.sin(i * 1.7);
        b.add(ball(), glow(), { position: [((i % 3) - 1) * width * 0.28 + 0.03 * Math.sin(i), height - 0.02, (Math.floor(i / 3) - 1) * depth * 0.25], scale: [s * 1.6, s, s * 1.4], yaw: i });
      }
    } else {
      lid(new Quaternion(), (x) => [x, height, 0]);
      if (locked) {
        b.add(box(), brass(), { position: [0, height, depth / 2 + 0.02], scale: [0.11, 0.14, 0.03] });
        b.add(box(), material(0x151515, true, true), { position: [0, height - 0.01, depth / 2 + 0.036], scale: [0.02, 0.05, 0.005] });
      }
    }
    b.build(this);
    this.addShape('box', { size: [width, height + (open ? 0.1 : lidH), depth] }, [0, (height + (open ? 0.1 : lidH)) / 2, 0], null, 'chest');
  }
}

/** Bulging stave barrel with iron hoops and an inset lid. */
export class Barrel extends WorldModel {
  constructor({ radius = 0.35, height = 0.9, ...o }: any = {}) {
    super('Barrel', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    b.add(barrelBody(), wood, { position: [0, height / 2, 0], scale: [radius, height, radius], tint: this.rand(0.9, 1.05), uv: 'cyl' });
    const end = radius * bulge(0);
    for (const y of [0.04, height - 0.04]) b.add(cyl(), wood, { position: [0, y, 0], scale: [end * 0.97, 0.06, end * 0.97], tint: 0.8 });
    b.add(cyl(), material(0x2a1f16, true, true), { position: [0, height - 0.02, 0], scale: [end * 0.12, 0.012, end * 0.12] });
    for (const t of [0.06, 0.24, 0.76, 0.94]) {
      const r = radius * bulge(t) + 0.006;
      b.add(tube(), iron(), { position: [0, t * height, 0], scale: [r, 0.045, r] });
    }
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

/** Hanging cloth sheet `w` x `l` (top edge at y = 0, hanging down -Y) with soft folds and a swallowtail notch, double-sided. */
function clothSheet(w: number, l: number, notch: number, folds: number, seed: number) {
  const g = new PlaneGeometry(w, l, 8, 12).translate(0, -l / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = -p.getY(i) / l, u = x / w;
    // The bottom edge is cut into a swallowtail; rows are squeezed so the notch stays clean.
    const bottom = l - notch * (1 - Math.abs(u) * 2);
    const y = -t * bottom;
    const z = 0.035 * w * Math.sin(u * Math.PI * 2 * folds + seed) * (0.3 + t) + 0.05 * w * t * t;
    p.setXYZ(i, x * (1 - 0.06 * t), y, z);
  }
  g.computeVertexNormals();
  return withBackFaces(g);
}

/** Cloth banner hanging from a crossbar on a pole, with gold trim, an emblem and a spear finial. `color` overrides the seeded cloth colour. */
export class Banner extends WorldModel {
  constructor({ height = 2.6, width = 0.9, length = 1.6, color = null, ...o }: any = {}) {
    super('Banner', o);
    const b = new MergeBuilder();
    const wood = this.surface('bark', null, true, NO_BIRCH);
    const colour = color ?? BANNER_COLOURS[Math.floor(this.random() * BANNER_COLOURS.length)];
    const cloth = this.surface('cloth', colour, true, [0, 3]);
    const gold = brass();
    const barY = height - 0.12;
    b.add(cyl(), wood, { position: [0, height / 2, 0], scale: [0.04, height, 0.04], uv: 'cyl' });
    b.add(cyl(), wood, { position: [0, barY, 0.05], scale: [0.025, width + 0.16, 0.025], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)), uv: 'cyl' });
    for (const x of [-1, 1]) b.add(ball(), gold, { position: [x * (width / 2 + 0.09), barY, 0.05], scale: [0.035, 0.035, 0.035] });
    // Spear finial and collar.
    b.add(cyl(), gold, { position: [0, height + 0.01, 0], scale: [0.05, 0.04, 0.05] });
    b.add(shared('prop:spear', () => new ConeGeometry(1, 1, 4)), gold, { position: [0, height + 0.13, 0], scale: [0.045, 0.2, 0.02] });
    const notch = Math.min(length * 0.25, width * 0.4);
    const sheet = clothSheet(width, length, notch, 1.5, this.rand(0, 6));
    b.add(sheet, cloth, { position: [0, barY - 0.02, 0.07], uv: 'face' });
    sheet.dispose();
    // Gold trim along the top and a diamond emblem in the middle.
    b.add(box(), gold, { position: [0, barY - 0.06, 0.075], scale: [width * 0.98, 0.05, 0.015] });
    const em = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 4));
    const ey = barY - length * 0.4;
    b.add(box(), gold, { position: [0, ey, 0.095], scale: [width * 0.3, width * 0.3, 0.015], quaternion: em });
    b.add(box(), material(0xf0e6c8, true, true), { position: [0, ey, 0.105], scale: [width * 0.17, width * 0.17, 0.012], quaternion: em });
    // Weighted foot.
    b.add(cyl(), wood, { position: [0, 0.05, 0], scale: [0.2, 0.1, 0.2], tint: 0.8 });
    b.add(cyl(), iron(), { position: [0, 0.12, 0], scale: [0.06, 0.06, 0.06] });
    b.build(this);
    this.addShape('cylinder', { radius: 0.1, height }, [0, height / 2, 0], null, 'pole');
  }
}

/** Spoked cart wheel in the XY plane (axle along Z) at `at`. */
function addWheel(b: MergeBuilder, wood: any, dark: any, at: number[], r: number, spokes = 8) {
  b.add(rim(), wood, { position: at, scale: [r, r, r * 0.9] });
  b.add(rim(), iron(), { position: at, scale: [r * 1.03, r * 1.03, r * 0.5] });
  b.add(cyl(), dark, { position: at, scale: [r * 0.17, 0.12, r * 0.17], quaternion: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)) });
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    b.add(cyl(), wood, { position: [at[0] + Math.cos(a) * r * 0.5, at[1] + Math.sin(a) * r * 0.5, at[2]], scale: [r * 0.05, r * 0.9, r * 0.05], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, a - Math.PI / 2)) });
  }
}

/** Grain sack: a squat, slightly pear-shaped lump with a cinched neck at the top. */
const sackBody = () => shared('prop:sack', () => {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, r = Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1.05 - 0.45 * t * t) + (t > 0.9 ? 0.15 : 0);
    pts.push(new Vector2(Math.max(0.001, r), t * 1.6 - 0.75));
  }
  return new LatheGeometry(pts, 9);
});

/** Two-wheeled handcart with spoked wheels, plank sides and shafts. `loaded` adds tied sacks and a barrel. */
export class Cart extends WorldModel {
  constructor({ length = 1.8, width = 1, loaded = true, ...o }: any = {}) {
    super('Cart', o);
    const b = new MergeBuilder();
    const wood = this.surface('planks');
    const dark = this.surface('bark', null, true, NO_BIRCH);
    const r = 0.45, floor = r;
    b.add(box(), wood, { position: [0, floor, 0], scale: [length, 0.08, width] });
    for (const z of [-1, 1]) {
      for (const y of [0.13, 0.3]) b.add(box(), wood, { position: [0, floor + y, z * (width / 2 - 0.03)], scale: [length, 0.12, 0.05], tint: y > 0.2 ? 0.95 : 0.85 });
      for (const x of [-0.48, 0, 0.48]) b.add(box(), dark, { position: [x * length, floor + 0.2, z * (width / 2 + 0.005)], scale: [0.06, 0.4, 0.05] });
    }
    for (const y of [0.13, 0.3]) b.add(box(), wood, { position: [-length / 2 + 0.03, floor + y, 0], scale: [0.05, 0.12, width], tint: 0.9 });
    b.add(cyl(), dark, { position: [0, r, 0], scale: [0.04, width + 0.36, 0.04], quaternion: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)) });
    for (const z of [-1, 1]) {
      addWheel(b, wood, dark, [0, r, z * (width / 2 + 0.12)], r);
      b.add(cyl(), dark, { position: [length / 2 + 0.4, floor - 0.12, z * (width / 2 - 0.1)], scale: [0.03, length * 0.45 + 0.7, 0.03], quaternion: new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2 - 0.15)), uv: 'cyl' });
    }
    // Crossbar between the shaft tips and a prop stick so the cart rests level.
    const tipX = length / 2 + 0.4 + (length * 0.45 + 0.7) / 2 * Math.cos(0.15) - 0.05;
    const tipY = floor - 0.12 - (length * 0.45 + 0.7) / 2 * Math.sin(0.15);
    b.add(cyl(), dark, { position: [tipX, tipY, 0], scale: [0.025, width - 0.2, 0.025], quaternion: new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)) });
    b.add(cyl(), dark, { position: [tipX - 0.05, tipY / 2, 0], scale: [0.025, tipY, 0.025] });
    if (loaded) {
      const sack = this.surface('cloth', 0xc8b088, true, [0]);
      const rope = material(0x6a5432, true, true);
      for (let i = 0; i < 3; i++) {
        const s = this.rand(0.22, 0.3);
        const p = [-length * 0.25 + i * 0.4, floor + 0.04 + s * 0.7, this.rand(-0.15, 0.15)];
        const lean = new Quaternion().setFromEuler(new Euler(0.25 * (i - 1), i * 1.3, -0.3));
        const up = new Vector3(0, 1, 0).applyQuaternion(lean);
        b.add(sackBody(), sack, { position: p, scale: [s, s * 0.85, s * 0.9], quaternion: lean, tint: this.rand(0.85, 1.05), uv: 'sphere' });
        const at = (h: number) => [p[0] + up.x * s * h, p[1] + up.y * s * h, p[2] + up.z * s * h];
        b.add(cyl(), rope, { position: at(0.8), scale: [s * 0.16, 0.05, s * 0.16], quaternion: lean });
        b.add(shared('prop:tuft', () => new ConeGeometry(1, 1, 6, 1, true).rotateX(Math.PI)), sack, { position: at(0.95), scale: [s * 0.3, s * 0.25, s * 0.3], quaternion: lean });
      }
      b.add(barrelBody(), wood, { position: [length * 0.32, floor + 0.04 + 0.25, -width * 0.18], scale: [0.2, 0.5, 0.2], uv: 'cyl', tint: 0.9 });
      for (const t of [0.15, 0.85]) b.add(tube(), iron(), { position: [length * 0.32, floor + 0.04 + t * 0.5, -width * 0.18], scale: [0.2 * bulge(t) + 0.005, 0.03, 0.2 * bulge(t) + 0.005] });
    }
    b.build(this);
    this.addShape('box', { size: [length, 0.4, width] }, [0, floor + 0.15, 0], null, 'bed');
    for (const z of [-1, 1]) this.addShape('cylinder', { radius: r, height: 0.1 }, [0, r, z * (width / 2 + 0.12)], new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)), 'wheel');
  }
}

/** Anvil side profile (x along the face, y up), extruded along Z. */
const anvilBody = () => shared('prop:anvil', () => {
  const s = new Shape();
  s.moveTo(-0.22, 0); s.lineTo(0.22, 0); s.lineTo(0.2, 0.05);
  s.quadraticCurveTo(0.09, 0.08, 0.08, 0.2); s.lineTo(0.18, 0.24); s.lineTo(0.26, 0.26); s.lineTo(0.26, 0.34);
  s.lineTo(-0.24, 0.34); s.lineTo(-0.24, 0.27); s.lineTo(-0.1, 0.24);
  s.quadraticCurveTo(-0.08, 0.1, -0.2, 0.05); s.lineTo(-0.22, 0);
  return new ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 4 }).translate(0, 0, -0.1);
});

/** Blacksmith anvil with a horn, a hammer resting on the face and an optional banded wooden stump. */
export class Anvil extends WorldModel {
  constructor({ stump = true, ...o }: any = {}) {
    super('Anvil', o);
    const b = new MergeBuilder();
    const base = stump ? 0.5 : 0;
    const bark = this.surface('bark', null, true, NO_BIRCH);
    if (stump) {
      b.add(shared('prop:stump', () => new CylinderGeometry(1, 1.12, 1, 10)), bark, { position: [0, base / 2, 0], scale: [0.3, base, 0.3], uv: 'cyl' });
      b.add(cyl(), material(0xb08a5a, true, true), { position: [0, base - 0.005, 0], scale: [0.29, 0.012, 0.29] });
      b.add(tube(), iron(), { position: [0, base * 0.75, 0], scale: [0.305, 0.04, 0.305] });
    }
    const steel = material(0x55585f, true, true);
    b.add(anvilBody(), steel, { position: [0, base, 0] });
    b.add(box(), material(0x7a7e86, true, true), { position: [-0.01, base + 0.346, 0], scale: [0.5, 0.012, 0.2] });
    b.add(shared('prop:horn', () => new ConeGeometry(1, 1, 8).rotateZ(-Math.PI / 2)), steel, { position: [0.36, base + 0.3, 0], scale: [0.2, 0.06, 0.07] });
    // Hammer lying across the face.
    const wood = this.surface('planks');
    const hq = new Quaternion().setFromEuler(new Euler(0, 0.5, Math.PI / 2));
    b.add(cyl(), wood, { position: [-0.05, base + 0.37, 0.05], scale: [0.018, 0.34, 0.018], quaternion: hq });
    b.add(box(), iron(), { position: [-0.19, base + 0.38, -0.03], scale: [0.06, 0.06, 0.13], yaw: 0.5 });
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
    const blanket = this.surface('cloth', color ?? BLANKETS[Math.floor(this.random() * BLANKETS.length)], true, [0, 3]);
    const linen = material(0xe8e2d0, true, true);
    const legH = 0.25, frameH = 0.1, matH = 0.18;
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(box(), wood, { position: [x * (width / 2 - 0.04), legH / 2, z * (length / 2 - 0.04)], scale: [0.08, legH, 0.08], tint: 0.85 });
    b.add(box(), wood, { position: [0, legH + frameH / 2, 0], scale: [width, frameH, length] });
    b.add(box(), wood, { position: [0, 0.45, -length / 2 + 0.03], scale: [width, 0.8, 0.06], tint: 0.9 });
    b.add(box(), wood, { position: [0, 0.3, length / 2 - 0.03], scale: [width, 0.5, 0.06], tint: 0.9 });
    const top = legH + frameH;
    b.add(shared('prop:mattress', () => new BoxGeometry(1, 1, 1, 2, 1, 3)), linen, { position: [0, top + matH / 2, 0], scale: [width - 0.1, matH, length - 0.1] });
    const pillow = shared('prop:pillow', () => new SphereGeometry(1, 10, 6));
    b.add(pillow, linen, { position: [0, top + matH + 0.06, -length / 2 + 0.3], scale: [width * 0.36, 0.08, 0.2], tint: this.rand(0.95, 1.05) });
    // Blanket: a draped sheet covering the foot two thirds, flaps hanging over the sides, top edge folded back.
    const bw = width - 0.04, bl = length * 0.62, z0 = length / 2 - 0.05 - bl, y0 = top + matH + 0.015;
    const g = new PlaneGeometry(1, 1, 10, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      // Lateral 0..1 maps across the top then down over the side edges.
      const w = (u - 0.5) * (bw + 0.36), half = bw / 2;
      const over = Math.max(0, Math.abs(w) - half);
      const x = Math.sign(w) * Math.min(Math.abs(w), half + 0.02);
      const y = y0 - over * 1.1 + 0.012 * Math.sin(v * 9 + u * 3);
      p.setXYZ(i, x, y, z0 + v * bl);
    }
    // The plane was wound to face +Z; after bending it into XZ flip the winding so it faces up.
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
    g.computeVertexNormals();
    const sheet = withBackFaces(g);
    b.add(sheet, blanket, { uv: 'box' });
    sheet.dispose(); g.dispose();
    b.add(halfCyl(), blanket, { position: [0, y0, z0 + 0.04], scale: [bw + 0.02, 0.035, 0.07], tint: 1.15 });
    b.add(box(), linen, { position: [0, y0 + 0.004, z0 - 0.06], scale: [width - 0.12, 0.012, 0.14], tint: 0.98 });
    b.build(this);
    this.addShape('box', { size: [width, top + matH, length] }, [0, (top + matH) / 2, 0], null, 'mattress');
    this.addShape('box', { size: [width, 0.8, 0.06] }, [0, 0.45, -length / 2 + 0.03], null, 'headboard');
  }
}
