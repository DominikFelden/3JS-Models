import {
  BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, LatheGeometry, PlaneGeometry, RingGeometry, BufferGeometry,
  Float32BufferAttribute, CatmullRomCurve3, Quaternion, Euler, Vector2, Vector3,
} from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';
import { gridTriangles, trianglesGeometry, withBackFaces, rockBlob, noise3, noiseSeed } from './terrain.ts';

/**
 * Plants, wood and boats. Every model sits on y = 0 (boats: waterline at y = 0),
 * is centred on x/z and takes `seed`, `size`, `position`, `rotation` plus the
 * options listed per class. Bark and foliage textures come from the shared pool.
 */

const box = () => shared('flora:box', () => new BoxGeometry(1, 1, 1));
const ball = () => shared('flora:ball', () => new SphereGeometry(1, 8, 6));
const tube = () => shared('flora:tube', () => { const c = new CylinderGeometry(1, 1, 1, 8); c.translate(0, 0.5, 0); return c; });
const cone = () => shared('flora:cone', () => { const c = new ConeGeometry(1, 1, 6); c.translate(0, 0.5, 0); return c; });
const blade = () => shared('flora:blade', () => { const c = new ConeGeometry(0.5, 1, 3); c.translate(0, 0.5, 0); return c; });
const disc = () => shared('flora:disc', () => new RingGeometry(0, 1, 12, 5).rotateX(-Math.PI / 2));
const NO_BIRCH = [0, 1, 2, 4];
const iron = () => material(0x3a3a40, true, true);

const euler = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z));
const UP = new Vector3(0, 1, 0);
/** Quaternion turning +Y onto `dir`. */
const towards = (dir: Vector3) => new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());

/**
 * Tube swept along the points `path` (model space). `radius(t)` gives the radius
 * at share t (0..1) of the length; a radius of 0 closes that end. `ribs` > 0
 * fluts the surface (cactus ribs). UVs: u around, v along, both in ~1.2 unit repeats
 * (use `uv: 'native'`).
 */
function sweep(path: Vector3[], radius: (t: number) => number, { radial = 8, steps = 12, ribs = 0, rib = 0.1 } = {}) {
  const curve = new CatmullRomCurve3(path);
  const frames = curve.computeFrenetFrames(steps, false);
  const len = curve.getLength(), r0 = Math.max(radius(0.3), 0.01);
  const n = Math.max(1, Math.round((2 * Math.PI * r0) / 1.2));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, c = curve.getPointAt(t), r = radius(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const rr = r * (1 + (ribs ? rib * Math.cos(a * ribs) : 0));
      const cx = Math.cos(a) * rr, sy = Math.sin(a) * rr;
      pos.push(c.x + N.x * cx + B.x * sy, c.y + N.y * cx + B.y * sy, c.z + N.z * cx + B.z * sy);
      uv.push((j / radial) * n, (t * len * n) / (2 * Math.PI * r0));
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Radius profile with rounded (hemispherical) ends over the outer `cap` share. */
const capsule = (r: number, cap = 0.12, start = false) => (t: number) => {
  const e = t > 1 - cap ? (t - (1 - cap)) / cap : start && t < cap ? (cap - t) / cap : 0;
  return r * Math.sqrt(Math.max(0, 1 - e * e));
};

/** Mushroom cap lathe: gill underside from the stem out to the rim, curling over into a dome of height `dome`. */
function capGeometry(dome: number, segs = 14) {
  const pts = [new Vector2(0.12, 0.02), new Vector2(0.6, -0.04), new Vector2(0.93, -0.1), new Vector2(1, -0.06)];
  for (let i = 1; i <= 7; i++) {
    const e = (i / 7) * Math.PI / 2;
    pts.push(new Vector2(Math.max(0.001, Math.cos(e) * 1.02), -0.04 + Math.sin(e) * dome));
  }
  return new LatheGeometry(pts, segs);
}
/** Point and normal on the cap dome at elevation e (0 rim .. pi/2 top), azimuth a. */
function capPoint(e: number, a: number, dome: number): [Vector3, Vector3] {
  const p = new Vector3(Math.cos(e) * 1.02 * Math.cos(a), -0.04 + Math.sin(e) * dome, Math.cos(e) * 1.02 * Math.sin(a));
  const n = new Vector3(Math.cos(e) / 1.02 * Math.cos(a), Math.sin(e) / dome, Math.cos(e) / 1.02 * Math.sin(a)).normalize();
  return [p, n];
}
/** Gill shading: cream underside with fine radial lines, cap colour on top. */
const gillTint = (cx: number, cy: number, cz: number, y0: number, rr: number) => (x: number, y: number, z: number) => {
  if (y > y0 + rr * 0.02) return 1;
  const a = Math.atan2(z - cz, x - cx);
  return 0.75 + 0.25 * Math.abs(Math.sin(a * 13));
};

/** Mushroom: bulbous stalk and a curled cap, usually spotted. `capColor`, `spots`. Collider: cylinder. */
export class Mushroom extends WorldModel {
  constructor({ capColor = 0xc23b32, spots = true, ...o }: any = {}) {
    super('Mushroom', o);
    const b = new MergeBuilder();
    const h = this.rand(0.18, 0.3), r = this.rand(0.12, 0.2);
    const stem = shared('flora:stem', () => new LatheGeometry([[0, 0], [1.05, 0], [1.15, 0.12], [0.95, 0.35], [0.8, 0.65], [0.78, 0.9], [0.8, 1], [0, 1]].map(([x, y]) => new Vector2(Math.max(0.001, x), y)), 10));
    b.add(stem, material(0xeee4cc, true, true), { scale: [r * 0.32, h, r * 0.32], tint: this.rand(0.9, 1.05) });
    const dome = 0.75;
    b.add(capGeometry(dome), material(capColor, true, true), { position: [0, h * 0.92, 0], scale: [r, r, r] });
    const under = shared('flora:gills', () => new LatheGeometry([new Vector2(0.12, 0.021), new Vector2(0.6, -0.039), new Vector2(0.93, -0.099)].reverse(), 14));
    b.add(under, material(0xf0e2c4, true, true), { position: [0, h * 0.92, 0], scale: [r, r, r], tint: gillTint(0, 0, 0, h * 0.92, r) });
    if (spots) {
      const spot = material(0xfaf4e4, true);
      const n = 4 + Math.floor(this.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = this.rand(0, Math.PI * 2), e = this.rand(0.3, 1.0);
        const [p, nn] = capPoint(e, a, dome);
        const s = r * this.rand(0.12, 0.18);
        b.add(ball(), spot, { position: [p.x * r, h * 0.92 + p.y * r, p.z * r], scale: [s, s * 0.3, s], quaternion: towards(nn) });
      }
    }
    b.build(this);
    this.addShape('cylinder', { radius: r, height: h + r * 0.5 }, [0, (h + r * 0.5) / 2, 0]);
  }
}

/** GiantMushroom: a tall, tree-sized mushroom with a creamy curved stalk, a skirt ring, gills and a spotted cap. `capColor`, `height`. Colliders: stalk cylinder, cap cylinder. */
export class GiantMushroom extends WorldModel {
  constructor({ capColor = 0xb8452f, height = 3, ...o }: any = {}) {
    super('GiantMushroom', o);
    const b = new MergeBuilder();
    const sw = this.rand(0.28, 0.38), cr = this.rand(1.1, 1.5) * (height / 3);
    const lx = this.rand(-0.15, 0.15) * height, lz = this.rand(-0.15, 0.15) * height;
    const path = [0, 0.3, 0.6, 0.9].map((t) => new Vector3(lx * Math.sin(t * Math.PI * 0.9) * 0.6, t * height, lz * Math.sin(t * Math.PI * 0.9) * 0.6));
    const top = path[3];
    const stalk = sweep(path, (t) => sw * (1.25 - 0.45 * t + 0.35 * Math.max(0, 0.15 - t) / 0.15), { radial: 12, steps: 10 });
    const cream = material(0xf4e8cc, true, true);
    b.add(stalk, cream, { tint: (_x, y) => [0.86 + 0.16 * Math.min(1, y / (height * 0.5)), 0.84 + 0.16 * Math.min(1, y / (height * 0.5)), 0.8 + 0.14 * Math.min(1, y / (height * 0.5))] });
    stalk.dispose();
    // Skirt (annulus) hanging below the cap.
    const skirt = shared('flora:skirt', () => new LatheGeometry([new Vector2(1.6, -0.5), new Vector2(1.35, -0.2), new Vector2(1, 0)], 12));
    b.add(withBackFaces(skirt), cream, { position: [top.x, height * 0.72, top.z], scale: [sw * 0.75, sw * 0.6, sw * 0.75], tint: 0.92 });
    const dome = 0.62;
    const capY = height * 0.88;
    b.add(capGeometry(dome, 18), material(capColor, true, true), { position: [top.x, capY, top.z], scale: [cr, cr, cr], tint: (x, y, z) => (1.12 - 0.25 * Math.min(1, Math.hypot(x - top.x, z - top.z) / cr)) * (y < capY ? 0.85 : 1) });
    const gills = shared('flora:giantgills', () => new LatheGeometry([new Vector2(0.12, 0.021), new Vector2(0.6, -0.039), new Vector2(0.93, -0.099)].reverse(), 36));
    b.add(gills, material(0xe9d6b0, true, true), { position: [top.x, capY, top.z], scale: [cr, cr, cr], tint: gillTint(top.x, capY, top.z, capY, cr) });
    const spot = material(0xf8f0dc, true);
    for (let i = 0; i < 7; i++) {
      const a = this.rand(0, Math.PI * 2), e = this.rand(0.35, 1.1);
      const [p, nn] = capPoint(e, a, dome);
      const s = cr * this.rand(0.09, 0.14);
      b.add(ball(), spot, { position: [top.x + p.x * cr, capY + p.y * cr, top.z + p.z * cr], scale: [s, s * 0.3, s], quaternion: towards(nn) });
    }
    // A couple of small mushrooms and moss at the foot.
    const small = material(capColor, true, true);
    for (let i = 0; i < 3; i++) {
      const a = this.rand(0, Math.PI * 2), d = sw * this.rand(1.5, 2.2), sh = this.rand(0.12, 0.25) * (height / 3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(tube(), cream, { position: [x, 0, z], scale: [sh * 0.18, sh, sh * 0.18] });
      b.add(capGeometry(0.7, 10), small, { position: [x, sh * 0.95, z], scale: [sh * 0.55, sh * 0.55, sh * 0.55], tint: this.rand(0.9, 1.1) });
    }
    b.add(rockBlob(2, 0), material(0x6a9a40, true, true), { position: [0, 0, 0], scale: [sw * 2.2, sw * 0.35, sw * 2.2], tint: (x, _y, z) => 0.85 + 0.2 * Math.sin(x * 9 + z * 7) });
    b.build(this);
    this.addShape('cylinder', { radius: sw, height }, [0, height / 2, 0], null, 'stalk');
    this.addShape('cylinder', { radius: cr, height: cr * 0.4 }, [top.x, height * 0.9 + cr * 0.15, top.z], null, 'cap');
  }
}

/** Cactus: ribbed saguaro with `arms` curved, upturned arms (0-4) and the odd blossom. Colliders: trunk, one per arm. */
export class Cactus extends WorldModel {
  constructor({ arms = 2, height = 2.2, ...o }: any = {}) {
    super('Cactus', o);
    const n = WorldModel.clampInt(arms, 0, 4, 2);
    const b = new MergeBuilder();
    const green = material(0x4f9a4a, true, true);
    const r = 0.18;
    // Ribs catch light and shadow: lighter ridges, darker grooves.
    const ribTint = (cx: number, cz: number, k: number) => (x: number, _y: number, z: number) => k * (0.85 + 0.2 * Math.cos(Math.atan2(z - cz, x - cx) * 8));
    const trunk = sweep([new Vector3(0, 0, 0), new Vector3(0, height * 0.5, 0), new Vector3(0, height, 0)], (t) => capsule(r, 0.08)(t) * (1.08 - 0.12 * t), { radial: 16, steps: 30, ribs: 8, rib: 0.09 });
    b.add(trunk, green, { tint: ribTint(0, 0, this.rand(0.9, 1.1)), uv: 'native' });
    trunk.dispose();
    this.addShape('cylinder', { radius: r, height }, [0, height / 2, 0], null, 'trunk');
    const bloom = material(0xf06ea0, true, true);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(0, 1), ar = 0.11, reach = this.rand(0.4, 0.55);
      const y = height * this.rand(0.35, 0.65), up = this.rand(0.4, 0.8);
      const dx = Math.cos(a), dz = Math.sin(a), t = this.rand(0.9, 1.1);
      const ex = dx * (r * 0.5 + reach), ez = dz * (r * 0.5 + reach);
      const path = [
        new Vector3(dx * r * 0.2, y - ar * 0.3, dz * r * 0.2),
        new Vector3(dx * (r + reach * 0.45), y - ar * 0.2, dz * (r + reach * 0.45)),
        new Vector3(ex, y + ar * 0.8, ez),
        new Vector3(ex, y + up * 0.55, ez),
        new Vector3(ex, y + up, ez),
      ];
      const arm = sweep(path, (s) => capsule(ar, 0.1)(s), { radial: 12, steps: 24, ribs: 6, rib: 0.1 });
      b.add(arm, green, { tint: ribTint(ex, ez, t), uv: 'native' });
      arm.dispose();
      if (i % 2 === 0) b.add(ball(), bloom, { position: [ex, y + up - ar * 0.05, ez], scale: [ar * 0.6, ar * 0.4, ar * 0.6] });
      this.addShape('cylinder', { radius: ar, height: up }, [ex, y + up / 2, ez], null, 'arm');
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      b.add(ball(), bloom, { position: [Math.cos(a) * r * 0.4, height - r * 0.25, Math.sin(a) * r * 0.4], scale: [0.07, 0.05, 0.07], tint: 0.95 + i * 0.05 });
    }
    b.add(ball(), material(0xfff0a0, true, true), { position: [0, height - 0.02, 0], scale: [0.045, 0.035, 0.045] });
    b.build(this);
  }
}

/** One palm frond: arching midrib with saw-toothed leaflets either side, double-sided. Grows along +X from the origin. */
function frondGeometry(len: number, droop: number) {
  const steps = 14, tris: number[][][] = [];
  const at = (t: number) => [t * len, len * (0.35 * t - droop * t * t), 0];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const p0 = at(t0), p1 = at(t1);
    // Leaflets: each step a long thin blade swept back towards the tip, alternating length.
    const w = len * 0.28 * Math.sin(Math.PI * Math.min(1, t1 * 1.1)) * (i % 2 ? 0.75 : 1);
    for (const side of [-1, 1]) {
      const tip = [p1[0] + w * 0.35, p1[1] - w * 0.45, side * w];
      tris.push([p0, p1, tip]);
    }
  }
  const g = trianglesGeometry(tris);
  const out = withBackFaces(g);
  g.dispose();
  return out;
}

/** PalmTree: curved, ringed trunk and a crown of arching, saw-leaved fronds. `height`, `fronds` (4-12), `coconuts`. Collider: trunk cylinder. */
export class PalmTree extends WorldModel {
  constructor({ height = 4.5, fronds = 8, coconuts = true, ...o }: any = {}) {
    super('PalmTree', o);
    const n = WorldModel.clampInt(fronds, 4, 12, 8);
    const b = new MergeBuilder();
    const bark = material(0xa08460, true, true);
    const lean = this.rand(-0.25, 0.25), lean2 = this.rand(-0.25, 0.25);
    const off = (f: number) => [lean * f * f * height * 0.5, lean2 * f * f * height * 0.5];
    const path = [0, 0.25, 0.5, 0.75, 1].map((f) => new Vector3(off(f)[0], f * height, off(f)[1]));
    const top = [path[4].x, height, path[4].z];
    const trunk = sweep(path, (t) => 0.21 - t * 0.08 + (t < 0.08 ? (0.08 - t) * 1.2 : 0), { radial: 9, steps: 18 });
    // Ringed bark: bands every ~0.25 units, darker in the grooves.
    b.add(trunk, bark, { tint: (_x, y) => 0.78 + 0.27 * Math.pow(Math.abs(Math.sin(y * Math.PI * 4)), 0.5), uv: 'native' });
    trunk.dispose();
    b.add(ball(), bark, { position: top, scale: [0.2, 0.16, 0.2], tint: 0.8 });
    const leaf = material(0x4a9a3a, true, true);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand(-0.15, 0.15), len = this.rand(1.7, 2.3);
      const tilt = this.rand(-0.1, 0.25);
      const fg = frondGeometry(len, this.rand(0.75, 1.05));
      b.add(fg, leaf, {
        position: top, quaternion: euler(0, -a, tilt + (i % 2 ? 0.2 : 0)),
        tint: (x, y, z) => { const d = Math.hypot(x - top[0], z - top[2]) / len; return [0.75 + 0.35 * d, 0.85 + 0.25 * d, 0.7 + 0.1 * d]; },
      });
      fg.dispose();
    }
    if (coconuts) {
      const nut = material(0x5a3d22, true, true);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        b.add(ball(), nut, { position: [top[0] + Math.cos(a) * 0.15, top[1] - 0.14 - (i % 2) * 0.06, top[2] + Math.sin(a) * 0.15], scale: [0.11, 0.12, 0.11], tint: 0.9 + 0.1 * (i % 2) });
      }
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.17, height }, [top[0] / 2, height / 2, top[2] / 2], null, 'trunk');
  }
}

/** Ringed wood end grain: pale core, darker growth rings and a bark rim. */
const endGrain = (cx: number, cy: number, cz: number, r: number, axis: 'y' | 'x') => (x: number, y: number, z: number) => {
  const d = (axis === 'y' ? Math.hypot(x - cx, z - cz) : Math.hypot(y - cy, z - cz)) / r;
  if (d > 0.9) return 0.55;
  return 0.9 + 0.12 * Math.cos(d * 22) - 0.1 * d;
};

/** Stump: a cut trunk with growth rings on top and knobbly roots running into the ground. `radius`, `height`. Collider: cylinder. */
export class Stump extends WorldModel {
  constructor({ radius = 0.4, height = 0.5, ...o }: any = {}) {
    super('Stump', o);
    const b = new MergeBuilder();
    const bark = this.surface('bark', null, true, NO_BIRCH);
    const ns = noiseSeed(this, 3);
    const body = shared('flora:stumpbody', () => new CylinderGeometry(1, 1.15, 1, 12, 3, true).translate(0, 0.5, 0));
    b.add(body, bark, { scale: [radius, height, radius], tint: this.rand(0.9, 1.05), uv: 'cyl' });
    b.add(disc(), material(0xd2b07c, true, true), { position: [0, height, 0], scale: [radius, 1, radius], tint: endGrain(0, height, 0, radius, 'y') });
    const roots = 3 + Math.floor(this.random() * 3);
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + this.rand(-0.3, 0.3), reach = radius * this.rand(0.7, 1.1);
      const dx = Math.cos(a), dz = Math.sin(a);
      const pts = [0, 0.33, 0.66, 1].map((t) => {
        const d = radius * 0.7 + reach * t;
        return new Vector3(dx * d + noise3(i, t * 3, 0, ns) * 0.05, height * 0.5 * (1 - t) * (1 - t) - 0.03 * t, dz * d + noise3(t * 3, i, 1, ns) * 0.05);
      });
      const rg = sweep(pts, (t) => radius * (0.36 - 0.26 * Math.sqrt(t)), { radial: 8, steps: 10 });
      b.add(rg, bark, { tint: 0.9, uv: 'native' });
      rg.dispose();
    }
    if (this.random() < 0.6) b.add(rockBlob(1, 0), this.surface('foliage', 0x5f8a3a), { position: [-radius * 0.3, height * 0.2, radius * 0.85], scale: [radius * 0.45, radius * 0.25, radius * 0.25], detail: 3 });
    b.build(this);
    this.addShape('cylinder', { radius, height }, [0, height / 2, 0]);
  }
}

/** Log: a fallen trunk lying along X with ringed end grain, a broken branch stub and moss. `length`, `radius`. Collider: cylinder lying along X. */
export class Log extends WorldModel {
  constructor({ length = 2, radius = 0.25, ...o }: any = {}) {
    super('Log', o);
    const b = new MergeBuilder();
    const bark = this.surface('bark', null, true, NO_BIRCH);
    const q = euler(0, 0, Math.PI / 2);
    const ns = noiseSeed(this, 5);
    const body = sweep([new Vector3(length / 2, radius, 0), new Vector3(0, radius, 0), new Vector3(-length / 2, radius, 0)], (t) => radius * (1 + 0.08 * noise3(t * 4, 0, 0, ns)), { radial: 10, steps: 10 });
    b.add(body, bark, { tint: this.rand(0.9, 1.05), uv: 'native' });
    body.dispose();
    const grain = material(0xc9a574, true, true);
    for (const s of [-1, 1]) {
      const rr = radius * (1 + 0.08 * noise3(s < 0 ? 4 : 0, 0, 0, ns)) * 0.99;
      b.add(disc(), grain, { position: [s * length / 2, radius, 0], scale: [rr, 1, rr], quaternion: euler(0, 0, -s * Math.PI / 2), tint: endGrain(s * length / 2, radius, 0, rr, 'x') });
    }
    if (this.random() < 0.5) {
      const x = this.rand(-0.3, 0.3) * length;
      b.add(tube(), bark, { position: [x, radius * 1.7, 0.05], scale: [radius * 0.3, radius * 0.6, radius * 0.3], quaternion: euler(0.5, 0, -0.3), tint: 0.9, uv: 'cyl' });
      const end = new Vector3(0, radius * 0.6, 0).applyQuaternion(euler(0.5, 0, -0.3)).add(new Vector3(x, radius * 1.7, 0.05));
      b.add(disc(), grain, { position: end.toArray(), scale: [radius * 0.3, 1, radius * 0.3], quaternion: euler(0.5, 0, -0.3), tint: 0.85 });
    }
    if (this.random() < 0.6) {
      b.add(rockBlob(3, 0), this.surface('foliage', 0x4f7a3a), { position: [this.rand(-0.2, 0.2), radius * 1.75, this.rand(-0.1, 0.1)], scale: [length * 0.18, radius * 0.25, radius * 0.7], detail: 2 });
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

/**
 * Round-bilged hull surface from stern (x = -L/2, flat transom) to bow (x = +L/2, sharp stem),
 * keel at `keel`, gunwale at `gun` rising by `sheer` towards both ends. Returns the double-sided
 * shell plus a transom panel, and `edge(u, side)` giving gunwale points for rails and oarlocks.
 */
function hull(L: number, W: number, keel: number, gun: number, sheer: number, stern = 0.62) {
  const p = 0.55, a0 = Math.asin(Math.pow(stern, 1 / p)) / Math.PI;
  const half = (u: number) => (W / 2) * Math.pow(Math.max(0, Math.sin(Math.PI * (a0 + (1 - a0) * u))), p);
  const top = (u: number) => gun + sheer * (2 * u - 1) * (2 * u - 1) + sheer * 0.4 * u * u;
  const bottom = (u: number) => keel + (top(u) - keel) * 0.8 * Math.pow(u, 5);
  const at = (u: number, v: number) => {
    const phi = v * Math.PI / 2, s = Math.sin(phi), c = Math.cos(phi);
    return [-L / 2 + u * L, bottom(u) + (top(u) - bottom(u)) * Math.pow(1 - c, 0.75), half(u) * Math.sign(s) * Math.pow(Math.abs(s), 0.6)];
  };
  const NU = 16, NV = 10;
  const shellTris = gridTriangles(NU, NV, (i, j) => at(i / NU, (j / NV) * 2 - 1));
  const shell = trianglesGeometry(shellTris);
  const geo = withBackFaces(shell);
  shell.dispose();
  const ring = []; for (let j = 0; j <= NV; j++) ring.push(at(0, (j / NV) * 2 - 1));
  const tris = []; for (let j = 0; j < NV; j++) tris.push([ring[0], ring[j], ring[j + 1]], [ring[0], ring[j + 1], ring[j]]);
  const transom = trianglesGeometry(tris);
  const edge = (u: number, side: number) => new Vector3(-L / 2 + u * L, top(u), side * half(u));
  return { geo, transom, edge, half, top };
}
/** Painted strakes: horizontal plank bands, with a coloured band below the gunwale. */
const strakes = (keel: number, gun: number, band: number[] | null) => (_x: number, y: number) => {
  const t = (y - keel) / (gun - keel), k = 0.86 + 0.14 * (Math.floor(t * 7) % 2);
  if (band && t > 0.72 && t < 0.88) return [band[0] * k, band[1] * k, band[2] * k];
  return k * (t < 0.15 ? 0.8 : 1);
};
/** Rail along the gunwale from u0 to u1 on one side. */
function rail(b: MergeBuilder, mat: any, edge: (u: number, s: number) => Vector3, side: number, r: number, u0 = 0, u1 = 1, lift = 0) {
  const pts = []; for (let i = 0; i <= 6; i++) pts.push(edge(u0 + (u1 - u0) * (i / 6), side).add(new Vector3(0, lift, 0)));
  const g = sweep(pts, () => r, { radial: 5, steps: 16 });
  b.add(g, mat, { uv: 'native' });
  g.dispose();
}

/** Rowboat: round-bilged plank hull with ribs, thwarts and two oars resting in their oarlocks. `length`, `oars`. Colliders: hull box, bow and stern boxes. */
export class Rowboat extends WorldModel {
  constructor({ length = 3, oars = true, ...o }: any = {}) {
    super('Rowboat', o);
    const b = new MergeBuilder();
    const planks = this.surface('planks');
    const w = length * 0.36, hh = 0.4, keel = -0.12;
    const colours = [[0.55, 0.75, 0.95], [0.95, 0.55, 0.45], [0.95, 0.9, 0.7], [0.6, 0.85, 0.6]];
    const band = colours[Math.floor(this.random() * colours.length)];
    const h = hull(length, w, keel, hh, 0.07, 0.5);
    b.add(h.geo, planks, { tint: strakes(keel, hh, band), uv: 'world' });
    b.add(h.transom, planks, { tint: 0.85, uv: 'world' });
    h.geo.dispose(); h.transom.dispose();
    const dark = material(0x5a3d22, true, true);
    for (const s of [-1, 1]) rail(b, dark, h.edge, s, 0.03);
    // Floorboards and ribs.
    b.add(box(), planks, { position: [-0.05 * length, keel + 0.1, 0], scale: [length * 0.6, 0.03, w * 0.35], tint: 0.75 });
    for (let i = 1; i < 6; i++) {
      const u = i / 6, e = h.edge(u, 1), hw = h.half(u);
      b.add(box(), dark, { position: [e.x, (keel + e.y) / 2 + 0.03, 0], scale: [0.04, 0.03, hw * 1.5], tint: 0.9 });
    }
    for (const x of [-0.2, 0.18]) {
      const hw = h.half(x + 0.5);
      b.add(box(), planks, { position: [x * length, hh * 0.62, 0], scale: [0.2, 0.04, hw * 1.85], tint: 1.1 });
    }
    b.add(box(), planks, { position: [-length * 0.42, hh * 0.62, 0], scale: [length * 0.12, 0.04, h.half(0.08) * 1.7], tint: 1.05 });
    if (oars) {
      const wood = material(0x9a7448, true, true);
      for (const s of [-1, 1]) {
        const lock = h.edge(0.52, s);
        b.add(tube(), iron(), { position: lock.toArray(), scale: [0.015, 0.06, 0.015] });
        // Oar: handle inside the boat, shaft through the oarlock, blade down at the waterline.
        const inner = new Vector3(lock.x - 0.25, hh * 0.75, -s * w * 0.05), blade = new Vector3(lock.x + 0.35, 0.02, s * (w * 0.5 + 1.0));
        const dir = blade.clone().sub(inner), len = dir.length();
        b.add(tube(), wood, { position: inner.toArray(), scale: [0.022, len, 0.022], quaternion: towards(dir) });
        b.add(box(), wood, { position: blade.clone().addScaledVector(dir.clone().normalize(), -0.15).toArray(), scale: [0.14, 0.35, 0.025], quaternion: towards(dir), tint: 0.9 });
      }
    }
    b.build(this);
    this.addShape('box', { size: [length * 0.85, hh, w * 0.9] }, [0, hh / 2, 0], null, 'hull');
    this.addShape('box', { size: [length * 0.2, hh, w * 0.5] }, [length * 0.5, hh / 2, 0], null, 'bow');
    this.addShape('box', { size: [length * 0.1, hh, w * 0.6] }, [-length * 0.5, hh / 2, 0], null, 'stern');
  }
}
/** Square sail bellying forward (+X), spanning `w` across Z and hanging `h` down from its yard at the origin. */
function sailGeometry(w: number, h: number, belly: number, foot = 1.1) {
  const g = new PlaneGeometry(1, 1, 6, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i) + 0.5; // v: 1 at the yard, 0 at the foot
    const t = 1 - v, span = w * (1 + (foot - 1) * t);
    p.setXYZ(i, belly * Math.cos(u * Math.PI) * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.1)), -t * h, u * span);
  }
  g.computeVertexNormals();
  const out = withBackFaces(g);
  g.dispose();
  return out;
}

/** Ship: sailing ship with a curved plank hull, deck, stern castle, `masts` (1-3) with billowing sails, rigging, a crow's nest and a bowsprit. `length`, `sailColor`. Colliders: hull, cabin, one per mast. */
export class Ship extends WorldModel {
  constructor({ length = 10, masts = 2, sailColor = 0xf1ead6, ...o }: any = {}) {
    super('Ship', o);
    const n = WorldModel.clampInt(masts, 1, 3, 2);
    const b = new MergeBuilder();
    const planks = this.surface('planks', 0x8a5a33);
    const wood = this.surface('planks', 0xb08455);
    const w = length * 0.3, hh = length * 0.18, deckY = hh * 0.55;
    const keel = -hh * 0.35, gun = deckY + hh * 0.2;
    const h = hull(length * 0.92, w, keel, gun, hh * 0.12, 0.7);
    b.add(h.geo, planks, { tint: strakes(keel, gun, [0.45, 0.6, 0.85]), uv: 'world' });
    b.add(h.transom, planks, { tint: 0.8, uv: 'world' });
    h.geo.dispose(); h.transom.dispose();
    const dark = material(0x4a3220, true, true);
    for (const s of [-1, 1]) rail(b, dark, h.edge, s, length * 0.008, 0, 1, 0.02);
    // Deck: plank floor following the hull's width.
    const deck = new PlaneGeometry(1, 1, 12, 1).rotateX(-Math.PI / 2);
    const dp = deck.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const u = dp.getX(i) + 0.5;
      dp.setXYZ(i, -length * 0.46 + u * length * 0.9, deckY + 0.05, Math.sign(dp.getZ(i)) * h.half(Math.min(0.99, u * 0.98 + 0.01)) * 0.97);
    }
    deck.computeVertexNormals();
    b.add(deck, wood, { tint: 1.1, uv: 'world' });
    deck.dispose();
    // Stern castle with windows and a rail on top.
    const cx = -length * 0.36, cw = w * 0.8, ch = hh * 0.9;
    b.add(box(), wood, { position: [cx, deckY + ch / 2, 0], scale: [length * 0.2, ch, cw], tint: 1 });
    b.add(box(), dark, { position: [cx, deckY + ch + 0.03 * length / 10, 0], scale: [length * 0.22, 0.06 * length / 10, cw + 0.08], tint: 0.9 });
    const glass = material(0xf5d27a, true, true);
    for (const z of [-0.25, 0.25]) b.add(box(), glass, { position: [cx + length * 0.1 + 0.01, deckY + ch * 0.55, z * cw], scale: [0.03, ch * 0.3, cw * 0.18] });
    b.add(box(), dark, { position: [cx + length * 0.1 + 0.02, deckY + ch * 0.25, 0], scale: [0.03, ch * 0.5, cw * 0.22] });
    for (const z of [-1, 1]) for (let i = 0; i <= 4; i++) b.add(box(), dark, { position: [cx - length * 0.1 + i * length * 0.05, deckY + ch + 0.15 * length / 10, z * (cw / 2)], scale: [0.04, 0.3 * length / 10, 0.04] });
    for (const z of [-1, 1]) b.add(box(), dark, { position: [cx, deckY + ch + 0.3 * length / 10, z * (cw / 2)], scale: [length * 0.21, 0.04, 0.05] });
    const sail = this.surface('cloth', sailColor, true, [0]), mast = material(0x5a3d22, true, true), rope = material(0x3a2a1a, true, true);
    const mh = length * 0.7;
    this.addShape('box', { size: [length * 0.7, hh, w] }, [0, deckY / 2 - 0.1 * hh, 0], null, 'hull');
    this.addShape('box', { size: [length * 0.2, hh * 0.9, w * 0.8] }, [-length * 0.36, deckY + hh * 0.5, 0], null, 'cabin');
    const mw = 0.07 * (length / 10);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? length * 0.05 : length * (0.22 - (0.5 * i) / (n - 1));
      const k = i === 0 || n === 1 ? 1 : 0.9;
      b.add(tube(), mast, { position: [x, deckY, 0], scale: [mw, mh * k, mw], uv: 'cyl' });
      for (const [fy, fw] of [[0.45, 0.8], [0.8, 0.6]]) {
        const yardY = deckY + mh * k * (fy + 0.18), sw = w * 1.3 * fw, sh = mh * k * 0.3;
        b.add(tube(), mast, { position: [x, yardY, -sw * 0.55], scale: [mw * 0.6, sw * 1.1, mw * 0.6], quaternion: euler(Math.PI / 2, 0, 0) });
        const sg = sailGeometry(sw, sh, sw * 0.12, 1.08);
        b.add(sg, sail, { position: [x + mw * 1.2, yardY - mw * 0.5, 0], tint: this.rand(0.95, 1.05), uv: 'face' });
        sg.dispose();
      }
      // Crow's nest on the first mast, a pennant on top of every mast.
      if (i === 0) {
        const ny = deckY + mh * k * 0.88;
        b.add(shared('flora:nest', () => new CylinderGeometry(1, 0.8, 1, 10, 1, true)), wood, { position: [x, ny, 0], scale: [mw * 4, mw * 3, mw * 4], uv: 'cyl' });
        b.add(tube(), wood, { position: [x, ny - mw * 1.5, 0], scale: [mw * 3.6, mw * 0.4, mw * 3.6] });
      }
      const flag = sailGeometry(mw * 4, mw * 10, mw * 0.8, 0.2);
      b.add(flag, material(0xb03030, true, true), { position: [x, deckY + mh * k + mw * 4, 0], quaternion: euler(Math.PI / 2, 0, -Math.PI / 2) });
      flag.dispose();
      // Shrouds: rope ladders from the masthead down to both rails.
      for (const s of [-1, 1]) for (const dx of [-0.6, 0, 0.6]) {
        const foot = new Vector3(x + dx * mw * 6, gun + 0.02, s * h.half(Math.min(0.99, (x + dx * mw * 6) / (length * 0.92) + 0.5)) * 0.98);
        const head = new Vector3(x, deckY + mh * k * 0.86, 0);
        const d = head.clone().sub(foot);
        b.add(tube(), rope, { position: foot.toArray(), scale: [mw * 0.12, d.length(), mw * 0.12], quaternion: towards(d) });
      }
      this.addShape('cylinder', { radius: mw, height: mh }, [x, deckY + mh / 2, 0], null, 'mast');
    }
    // Bowsprit with a stay to the foremast.
    const bowTip = h.edge(1, 0);
    b.add(tube(), mast, { position: [bowTip.x - length * 0.04, bowTip.y - hh * 0.1, 0], scale: [mw * 0.7, length * 0.22, mw * 0.7], quaternion: euler(0, 0, -Math.PI / 2 + 0.3) });
    const sprit = new Vector3(bowTip.x - length * 0.04, bowTip.y - hh * 0.1, 0).add(new Vector3(length * 0.22, 0, 0).applyAxisAngle(new Vector3(0, 0, 1), 0.3));
    const foreX = n === 1 ? length * 0.05 : length * 0.22;
    const stay = new Vector3(foreX, deckY + mh * 0.9, 0).sub(sprit);
    b.add(tube(), rope, { position: sprit.toArray(), scale: [mw * 0.12, stay.length(), mw * 0.12], quaternion: towards(stay) });
    b.build(this);
  }
}
