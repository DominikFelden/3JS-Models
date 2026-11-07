import { BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, Color, Group, Quaternion, Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';
import { trianglesGeometry, gridTriangles, withBackFaces, rockBlob, BLOB_VARIANTS, hash3 } from './terrain.ts';

const boxG = () => shared('settlement:box', () => new BoxGeometry(1, 1, 1));
const cylG = () => shared('settlement:cyl', () => new CylinderGeometry(1, 1, 1, 8, 1));
const coneG = () => shared('settlement:cone', () => new ConeGeometry(1, 1, 8, 1));
const pyramidG = () => shared('settlement:pyramid', () => {
  const g = new ConeGeometry(1, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
});

const ROPE = 0x8a7550;
const CLOTH = [0xa83a32, 0x3a5f9a, 0xc9a23a, 0x4a8a4a, 0xd8d0b8, 0x8a4a8a];
const pickOf = (m, arr) => arr[Math.floor(m.random() * arr.length)];
const clamp = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);

/** Box between two points (a beam / strut). */
function beam(b, mat, a, c, thick, opts: any = {}) {
  const A = new Vector3(...a), C = new Vector3(...c);
  const dir = C.clone().sub(A);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  b.add(boxG(), mat, { position: A.add(C).multiplyScalar(0.5).toArray(), scale: [thick, len, thick], quaternion: q, ...opts });
}

/**
 * Stone well with a timber roof. Base at y = 0, centred on the origin.
 * Options: `radius` (curb radius, 0.5..2, default 0.9), `roofed` (default true).
 * Colliders: 'curb' cylinder, plus 'post' boxes when roofed.
 */
export class Well extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('Well', options);
    const r = clamp(options.radius, 0.5, 2, 0.9) * this.rand(0.9, 1.1);
    const roofed = options.roofed !== false;
    const stone = this.surface('stone'), wood = this.surface('planks'), roof = this.surface('shingle');
    const b = new MergeBuilder();
    const h = 0.8;
    b.add(cylG(), stone, { position: [0, h / 2, 0], scale: [r, h, r], grime: true, tint: this.rand(0.9, 1.05) });
    b.add(cylG(), material(0x1b3a4a, true), { position: [0, h + 0.005, 0], scale: [r * 0.75, 0.01, r * 0.75] });
    this.addShape('cylinder', { radius: r, height: h }, [0, h / 2, 0], null, 'curb');
    if (roofed) {
      const ph = 1.9;
      for (const s of [-1, 1]) {
        b.add(boxG(), wood, { position: [s * (r - 0.05), h + ph / 2, 0], scale: [0.12, ph, 0.12] });
        this.addShape('box', { size: [0.12, ph, 0.12] }, [s * (r - 0.05), h + ph / 2, 0], null, 'post');
      }
      b.add(cylG(), wood, { position: [0, h + ph - 0.35, 0], scale: [0.07, 2 * r, 0.07], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2) }); // windlass
      b.add(cylG(), material(ROPE, true), { position: [0, h + ph - 0.7, 0], scale: [0.02, 0.7, 0.02] });
      b.add(cylG(), wood, { position: [0, h + ph - 1.1, 0], scale: [0.14, 0.2, 0.14] }); // bucket
      const rh = 0.8;
      b.add(pyramidG(), roof, { position: [0, h + ph + rh / 2, 0], scale: [(r + 0.35) / 0.7071, rh, 0.6 / 0.7071 * 1.0] });
    }
    b.build(this);
  }
}

/**
 * Tower windmill. Base at y = 0, sails on the +Z side.
 * Options: `sails` (2..8 blades, default 4), `height` (4..12, default 7).
 * The sails live in the sub-group `this.sails`; `setSailAngle(a)` sets its
 * rotation (radians) and `animate(dt, speed = 1)` advances it by dt seconds.
 * Colliders: 'tower' cone, 'cap' sphere-less box; sails are not colliders.
 */
export class Windmill extends WorldModel {
  declare random: any;
  declare sails: any;
  declare sailCount: any;
  constructor(options: any = {}) {
    super('Windmill', options);
    const n = WorldModel.clampInt(options.sails, 2, 8, 4);
    const h = clamp(options.height, 4, 12, 7) * this.rand(0.9, 1.1);
    const rb = h * 0.3, rt = rb * 0.65;
    this.sailCount = n;
    const wall = this.surface('plaster'), roof = this.surface('shingle'), wood = this.surface('planks');
    const b = new MergeBuilder();
    const tower = shared(`windmill:tower`, () => new CylinderGeometry(rt / rb, 1, 1, 10, 1));
    // Taper is baked per ratio, so keep the ratio fixed and scale only.
    b.add(tower, wall, { position: [0, h / 2, 0], scale: [rb, h, rb], grime: true, tint: this.rand(0.95, 1.05) });
    b.add(coneG(), roof, { position: [0, h + rb * 0.45, 0], scale: [rt * 1.25, rb * 0.9, rt * 1.25] });
    this.addDoor(b, [0, 0, rb - 0.02], 0, 0.8, 1.4, {});
    b.add(tower, this.surface('stone'), { position: [0, 0.2, 0], scale: [rb * 1.04, 0.4, rb * 1.04], grime: true });
    b.add(boxG(), wood, { position: [0, 1.5, rb - 0.02], scale: [1.1, 0.1, 0.1] });
    for (const [a, y] of [[Math.PI * 0.75, h * 0.4], [-Math.PI * 0.6, h * 0.62]]) {
      const rr = rb + (rt - rb) * (y / h) - 0.03;
      this.addWindow(b, [Math.sin(a) * rr, y, Math.cos(a) * rr], a, 0.45, 0.6, {});
    }
    this.addShape('cylinder', { radius: rb, height: h }, [0, h / 2, 0], null, 'tower');
    this.addShape('cone', { radius: rt * 1.25, height: rb * 0.9 }, [0, h + rb * 0.45, 0], null, 'cap');
    b.build(this);

    // Sails: hub on the +Z side of the cap, blades radiate in the XY plane.
    const hubZ = rt * 1.2, hubY = h + rb * 0.2, len = h * 0.62;
    this.sails = new Group();
    this.sails.position.set(0, hubY, hubZ);
    const sb = new MergeBuilder();
    const cloth = material(0xe6dcc0, true);
    sb.add(cylG(), wood, {
      position: [0, 0, 0.1], scale: [0.25, 0.4, 0.25],
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    });
    for (let i = 0; i < n; i++) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (i / n) * Math.PI * 2);
      const at = (y, z = 0) => new Vector3(0, y, z).applyQuaternion(q).toArray();
      const local = (x, y, z) => new Vector3(x, y, z).applyQuaternion(q).toArray();
      sb.add(boxG(), wood, { position: at(len / 2), scale: [0.12, len, 0.1], quaternion: q });
      // Lattice frame: two rails and cross bars, with the canvas furled partly behind.
      const y0 = len * 0.22, y1 = len * 0.98, sw = 0.68;
      sb.add(boxG(), wood, { position: local(sw, (y0 + y1) / 2, 0.04), scale: [0.05, y1 - y0, 0.05], quaternion: q });
      const bars = 7;
      for (let k = 0; k <= bars; k++) {
        const y = y0 + (k / bars) * (y1 - y0);
        sb.add(boxG(), wood, { position: local(sw / 2, y, 0.04), scale: [sw + 0.05, 0.04, 0.04], quaternion: q });
      }
      sb.add(boxG(), cloth, { position: local(sw / 2, y0 + (y1 - y0) * 0.55, -0.01), scale: [sw - 0.02, (y1 - y0) * 0.9, 0.02], quaternion: q });
    }
    const before = this.children.length;
    sb.build(this);
    for (const m of this.children.slice(before)) this.sails.add(m);
    this.add(this.sails);
  }

  /** Set the sail rotation (radians, around the axle). */
  setSailAngle(angle) {
    this.sails.rotation.z = angle;
  }

  /** Advance the sails by `dt` seconds at `speed` radians per second. */
  animate(dt, speed = 1) {
    this.sails.rotation.z += dt * speed;
  }
}

/**
 * Wooden or stone watchtower: four legs, braces, platform with railing and a roof.
 * Options: `height` (3..12, default 6), `stone` (solid stone shaft instead of timber legs, default false).
 * Colliders: 'leg' boxes (or one 'shaft' box when stone), 'platform' box, 'roof' convex.
 */
export class Watchtower extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('Watchtower', options);
    const h = clamp(options.height, 3, 12, 6) * this.rand(0.9, 1.1);
    const stoneMode = options.stone === true;
    const w = this.rand(1.8, 2.4);
    const wood = this.surface('planks'), roof = this.surface('shingle'), stone = this.surface('stone');
    const b = new MergeBuilder();
    const px = w / 2;
    if (stoneMode) {
      b.add(boxG(), stone, { position: [0, h / 2, 0], scale: [w, h, w], grime: true });
      this.addShape('box', { size: [w, h, w] }, [0, h / 2, 0], null, 'shaft');
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.add(boxG(), wood, { position: [sx * px, h / 2, sz * px], scale: [0.22, h, 0.22], grime: true });
        this.addShape('box', { size: [0.22, h, 0.22] }, [sx * px, h / 2, sz * px], null, 'leg');
      }
      const levels = Math.max(1, Math.floor(h / 3));
      for (let i = 0; i < levels; i++) {
        const y0 = (i / levels) * h, y1 = ((i + 1) / levels) * h;
        for (const s of [-1, 1]) {
          beam(b, wood, [s * px, y0, px], [-s * px, y1, px], 0.08);
          beam(b, wood, [s * px, y0, -px], [-s * px, y1, -px], 0.08);
        }
        b.add(boxG(), wood, { position: [0, y1, 0], scale: [w, 0.08, w] });
      }
    }
    const pw = w + 0.8;
    b.add(boxG(), wood, { position: [0, h, 0], scale: [pw, 0.15, pw] });
    this.addShape('box', { size: [pw, 0.15, pw] }, [0, h, 0], null, 'platform');
    const cabin = 1.3;
    // Railing on the platform, posts at the corners and a rail per side.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(boxG(), wood, { position: [sx * (pw / 2 - 0.05), h + cabin / 2, sz * (pw / 2 - 0.05)], scale: [0.1, cabin, 0.1] });
    }
    for (const s of [-1, 1]) {
      b.add(boxG(), wood, { position: [0, h + 0.55, s * (pw / 2 - 0.05)], scale: [pw, 0.08, 0.06] });
      b.add(boxG(), wood, { position: [s * (pw / 2 - 0.05), h + 0.55, 0], scale: [0.06, 0.08, pw] });
    }
    const rh = 1.2, ro = pw / 2 + 0.3, ry = h + cabin;
    b.add(pyramidG(), roof, { position: [0, ry + rh / 2, 0], scale: [ro / 0.7071, rh, ro / 0.7071] });
    this.addShape('convex', { points: [
      [-ro, ry, -ro], [ro, ry, -ro], [ro, ry, ro], [-ro, ry, ro], [0, ry + rh, 0],
    ] }, [0, 0, 0], null, 'roof');
    // Ladder on +Z
    const lz = px + 0.15;
    for (const s of [-1, 1]) b.add(boxG(), wood, { position: [s * 0.2, h / 2, lz], scale: [0.06, h, 0.06] });
    for (let y = 0.4; y < h; y += 0.4) b.add(boxG(), wood, { position: [0, y, lz], scale: [0.4, 0.04, 0.05] });
    b.build(this);
  }
}

/**
 * Plank bridge along the Z axis, centred on the origin (deck top at `y = 0.4`).
 * Options: `length` (3..30, default 8), `width` (1..5, default 2), `arch` (deck rise at the middle, 0..2, default 0.4),
 * `rails` (default true).
 * Colliders: deck as segment boxes tagged 'deck' (rotated to follow the arch) and 'rail' boxes.
 */
export class Bridge extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('Bridge', options);
    const L = clamp(options.length, 3, 30, 8), W = clamp(options.width, 1, 5, 2);
    const arch = clamp(options.arch, 0, 2, 0.4);
    const rails = options.rails !== false;
    const wood = this.surface('planks'), stone = this.surface('stone');
    const b = new MergeBuilder();
    const segs = Math.max(2, Math.round(L / 1.5));
    const yAt = (t) => 0.4 + arch * (1 - (2 * t - 1) ** 2); // t in 0..1
    const zAt = (t) => (t - 0.5) * L;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const a = [0, yAt(t0) - 0.08, zAt(t0)], c = [0, yAt(t1) - 0.08, zAt(t1)];
      const dz = c[2] - a[2], dy = c[1] - a[1], len = Math.hypot(dz, dy);
      const ang = Math.atan2(dy, dz);
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -ang);
      const mid = [0, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      b.add(boxG(), wood, { position: mid, scale: [W, 0.16, len + 0.02], quaternion: q, tint: this.rand(0.9, 1.08) });
      this.addShape('box', { size: [W, 0.16, len] }, mid, q, 'deck');
      for (const s of [-1, 1]) if (rails) {
        const rx = s * (W / 2 - 0.06);
        const rm = [rx, mid[1] + 0.35, mid[2]];
        b.add(boxG(), wood, { position: [rx, mid[1] + 0.45, mid[2]], scale: [0.07, 0.07, len], quaternion: q });
        b.add(boxG(), wood, { position: [rx, mid[1] + 0.2, mid[2]], scale: [0.04, 0.04, len], quaternion: q });
        b.add(boxG(), wood, { position: [rx, mid[1] + 0.22, zAt(t0)], scale: [0.08, 0.5, 0.08] });
        this.addShape('box', { size: [0.1, 0.5, len] }, rm, q, 'rail');
      }
    }
    if (rails) for (const s of [-1, 1]) b.add(boxG(), wood, { position: [s * (W / 2 - 0.06), yAt(1) + 0.22 - 0.4 + 0.4, zAt(1)], scale: [0.08, 0.5, 0.08] });
    // Stone abutments at both ends.
    for (const s of [-1, 1]) b.add(boxG(), stone, { position: [0, 0.15, s * (L / 2 + 0.2)], scale: [W + 0.4, 0.3, 0.6], grime: true });
    b.build(this);
  }
}

/**
 * Fence along the X axis, centred on the origin.
 * Options: `length` (1..30, default 6), `style` ('picket' | 'rail' | 'stone', default 'picket'),
 * `height` (0.6..2, default 1).
 * Colliders: one 'fence' box spanning the whole length.
 */
export const FENCE_STYLES = ['picket', 'rail', 'stone'];
export class Fence extends WorldModel {
  declare random: any;
  declare style: any;
  constructor(options: any = {}) {
    super('Fence', options);
    const L = clamp(options.length, 1, 30, 6), H = clamp(options.height, 0.6, 2, 1);
    this.style = FENCE_STYLES.includes(options.style) ? options.style : 'picket';
    const wood = this.surface('planks'), stone = this.surface('stone');
    const b = new MergeBuilder();
    const posts = Math.max(2, Math.round(L / 2) + 1);
    if (this.style === 'stone') {
      b.add(boxG(), stone, { position: [0, H / 2, 0], scale: [L, H, 0.35], grime: true });
    } else {
      for (let i = 0; i < posts; i++) {
        const x = -L / 2 + (i / (posts - 1)) * L;
        b.add(boxG(), wood, { position: [x, H / 2, 0], scale: [0.12, H * 1.05, 0.12], tint: this.rand(0.9, 1.05) });
      }
      if (this.style === 'rail') {
        for (const y of [0.35, 0.7]) b.add(boxG(), wood, { position: [0, y * H, 0.03], scale: [L, 0.08, 0.05] });
      } else {
        const n = Math.max(2, Math.floor(L / 0.2));
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + 0.1 + (i + 0.5) / n * (L - 0.2);
          const hh = H * 0.9 * this.rand(0.95, 1.05);
          b.add(boxG(), wood, { position: [x, hh / 2, 0.07], scale: [0.1, hh, 0.03], tint: this.rand(0.92, 1.06) });
        }
        for (const y of [0.25, 0.65]) b.add(boxG(), wood, { position: [0, y * H, 0.03], scale: [L, 0.07, 0.04] });
      }
    }
    b.build(this);
    const d = this.style === 'stone' ? 0.35 : 0.14;
    this.addShape('box', { size: [L, H, d] }, [0, H / 2, 0], null, 'fence');
  }
}

/**
 * Signpost: a post with 1..4 pointer boards at random angles.
 * Options: `boards` (1..4, default 2), `height` (1.5..4, default 2.4).
 * Colliders: 'post' cylinder.
 */
export class Signpost extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('Signpost', options);
    const n = WorldModel.clampInt(options.boards, 1, 4, 2);
    const H = clamp(options.height, 1.5, 4, 2.4);
    const wood = this.surface('planks');
    const b = new MergeBuilder();
    b.add(boxG(), wood, { position: [0, H / 2, 0], scale: [0.14, H, 0.14], grime: true });
    b.add(pyramidG(), wood, { position: [0, H + 0.06, 0], scale: [0.12, 0.12, 0.12] });
    for (let i = 0; i < n; i++) {
      const y = H - 0.3 - i * 0.36;
      const yaw = this.rand(-0.6, 0.6) + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0);
      const len = this.rand(0.9, 1.3);
      b.add(boxG(), wood, { position: [Math.sin(yaw + Math.PI / 2) * len / 2 * 0 + Math.cos(yaw) * len / 2, y, -Math.sin(yaw) * len / 2], scale: [len, 0.26, 0.04], yaw, tint: this.rand(0.9, 1.1) });
      b.add(coneG(), wood, { position: [Math.cos(yaw) * (len + 0.1), y, -Math.sin(yaw) * (len + 0.1)], scale: [0.13, 0.2, 0.13], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)) });
    }
    b.build(this);
    this.addShape('cylinder', { radius: 0.1, height: H }, [0, H / 2, 0], null, 'post');
  }
}

/** Linear RGB multiplier of a hex colour, for striping a white cloth material with tints. */
const rgb = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
const CREAM = [1, 0.95, 0.84];
/** Double-sided cloth sheet from a (rows x cols) grid of points. */
const sheet = (rows, cols, at) => withBackFaces(trianglesGeometry(gridTriangles(rows, cols, at)));
const fruitG = () => shared('settlement:fruit', () => new SphereGeometry(1, 7, 5));
/** Add a temporary geometry and dispose it (MergeBuilder clones). */
function once(b, g, mat, opts: any = {}) {
  b.add(g, mat, opts);
  g.dispose();
}
/** Thin rope between two points. */
const rope = (b, a, c, t = 0.018) => beam(b, material(ROPE, true), a, c, t);

/**
 * Market stall: counter, four poles, striped cloth awning and crates of goods, open on +Z.
 * Options: `width` (1.5..5, default 2.5), `awningColor` (hex; default random from seed).
 * Colliders: 'counter' box, 'awning' box (the canopy).
 */
export class MarketStall extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('MarketStall', options);
    const w = clamp(options.width, 1.5, 5, 2.5), d = 1.4, H = 2.3;
    const col = Number.isFinite(options.awningColor) ? options.awningColor : pickOf(this, CLOTH);
    const wood = this.surface('planks');
    const cloth = this.surface('cloth', 0xffffff, true, [0]);
    const stripe = rgb(col);
    const b = new MergeBuilder();
    // Poles (taller at the back so the awning sheds rain to the front) and beams.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const hh = sz < 0 ? H + 0.4 : H;
      b.add(boxG(), wood, { position: [sx * (w / 2 - 0.05), hh / 2, sz * (d / 2 - 0.05)], scale: [0.1, hh, 0.1], grime: true });
      b.add(boxG(), wood, { position: [sx * (w / 2 - 0.05), 0.03, sz * (d / 2 - 0.05)], scale: [0.18, 0.06, 0.18] });
    }
    for (const sz of [-1, 1]) {
      const y = sz < 0 ? H + 0.33 : H - 0.07;
      b.add(boxG(), wood, { position: [0, y, sz * (d / 2 - 0.05)], scale: [w + 0.1, 0.08, 0.08] });
    }
    for (const sx of [-1, 1]) beam(b, wood, [sx * (w / 2 - 0.05), H + 0.33, -d / 2 + 0.05], [sx * (w / 2 - 0.05), H - 0.07, d / 2 - 0.05], 0.07);
    // Counter: framed plank front with an overhanging top board and a cloth runner.
    const cz = d / 2 - 0.2;
    b.add(boxG(), wood, { position: [0, 0.42, cz], scale: [w - 0.1, 0.84, 0.46], tint: this.rand(0.85, 1) });
    b.add(boxG(), wood, { position: [0, 0.87, cz + 0.02], scale: [w + 0.06, 0.06, 0.56], tint: 1.1 });
    for (const sx of [-1, 0, 1]) b.add(boxG(), wood, { position: [sx * (w / 2 - 0.12), 0.42, cz + 0.24], scale: [0.09, 0.84, 0.04], tint: 0.7 });
    b.add(boxG(), wood, { position: [0, 0.08, cz + 0.24], scale: [w - 0.1, 0.1, 0.04], tint: 0.7 });
    once(b, sheet(3, 1, (i, j) => {
      const y = 0.905 - (i < 2 ? 0 : 0.02), z = i === 0 ? cz - 0.2 : i === 1 ? cz + 0.3 : cz + 0.31;
      const yy = i === 3 ? 0.62 : i === 2 ? 0.88 : y;
      return [(j - 0.5) * w * 0.45, yy, i === 3 ? cz + 0.31 : z];
    }), cloth, { tint: stripe.map((v) => v * 0.8) });
    this.addShape('box', { size: [w, 0.9, 0.5] }, [0, 0.45, cz], null, 'counter');
    // Awning: one sagging sheet per stripe so stripe edges stay crisp.
    const stripes = Math.max(4, Math.round(w / 0.32)) | 1;
    const sw = (w + 0.2) / stripes;
    const awn = (x, v) => {
      const sag = 0.07 * Math.sin(Math.PI * v) * (0.6 + 0.4 * Math.cos(Math.PI * x / (w + 0.2) * 2) ** 2);
      return [x, H + 0.42 - 0.5 * v - sag, -d / 2 - 0.05 + v * (d + 0.4)];
    };
    for (let k = 0; k < stripes; k++) {
      const x0 = -(w + 0.2) / 2 + k * sw;
      once(b, sheet(4, 1, (i, j) => awn(x0 + j * sw, i / 4)), cloth, { tint: k % 2 ? CREAM : stripe });
      // Scalloped valance hanging from the front edge.
      const [, fy, fz] = awn(x0 + sw / 2, 1);
      once(b, sheet(1, 4, (i, j) => [x0 + (j / 4) * sw, fy - (1 - i) * (0.2 + 0.07 * Math.sin(Math.PI * j / 4)), fz]), cloth, { tint: k % 2 ? stripe : CREAM });
    }
    this.addShape('box', { size: [w, 0.1, d + 0.4] }, [0, H + 0.1, 0], null, 'awning');
    // Crates of produce on the counter.
    const GOODS = [[0xc0392b, 0.07], [0xe8902a, 0.075], [0xe8d040, 0.06], [0x6aa040, 0.11], [0x7a3a8a, 0.05]];
    const n = Math.max(2, Math.floor(w / 0.62));
    const crate = this.surface('planks');
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n), cw = Math.min(0.5, w / n - 0.08), cd = 0.36;
      const [fc, fr] = pickOf(this, GOODS);
      const yaw = this.rand(-0.12, 0.12);
      const y0 = 0.9, ch = 0.16;
      const at = (px, py, pz) => [x + px * Math.cos(yaw) + pz * Math.sin(yaw), py, cz + pz * Math.cos(yaw) - px * Math.sin(yaw)];
      b.add(boxG(), crate, { position: at(0, y0 + 0.015, 0), scale: [cw, 0.03, cd], yaw });
      for (const s of [-1, 1]) {
        b.add(boxG(), crate, { position: at(0, y0 + ch / 2, s * cd / 2), scale: [cw, ch, 0.025], yaw, tint: 0.9 });
        b.add(boxG(), crate, { position: at(s * cw / 2, y0 + ch / 2, 0), scale: [0.025, ch, cd], yaw, tint: 0.8 });
      }
      const fm = material(fc, true);
      const cols = Math.max(2, Math.floor(cw / (fr * 2.1))), rows = Math.max(2, Math.floor(cd / (fr * 2.1)));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const px = (c - (cols - 1) / 2) * fr * 2.05, pz = (r - (rows - 1) / 2) * fr * 2.05;
        const hump = 1 - 0.5 * (Math.abs(px) / cw + Math.abs(pz) / cd);
        b.add(fruitG(), fm, { position: at(px, y0 + ch * 0.55 + fr * hump * 1.4, pz), scale: [fr, fr * 0.92, fr], tint: 0.85 + 0.25 * hash3(i, r, c) });
      }
    }
    // Back table with jars and a basket, and strings of onions on the front beam.
    b.add(boxG(), wood, { position: [0, 0.7, -d / 2 + 0.2], scale: [w - 0.2, 0.05, 0.32] });
    for (const sx of [-1, 1]) b.add(boxG(), wood, { position: [sx * (w / 2 - 0.2), 0.35, -d / 2 + 0.2], scale: [0.06, 0.7, 0.28], tint: 0.8 });
    const jar = shared('settlement:jar', () => new CylinderGeometry(0.75, 1, 1, 8, 1));
    const clay = material(0xb0643a, true);
    for (let x = -w / 2 + 0.35; x < w / 2 - 0.3; x += 0.32) {
      const jh = this.rand(0.16, 0.26);
      b.add(jar, clay, { position: [x, 0.725 + jh / 2, -d / 2 + 0.2], scale: [0.08, jh, 0.08], tint: this.rand(0.8, 1.1) });
    }
    const onion = material(0xd8a868, true);
    for (let k = 0; k < Math.floor(w / 0.6); k++) {
      const x = -w / 2 + 0.3 + k * 0.6, len = this.rand(0.35, 0.55);
      rope(b, [x, H - 0.11, d / 2 - 0.05], [x, H - 0.11 - len, d / 2 - 0.05], 0.012);
      for (let j = 0; j < 4; j++) b.add(fruitG(), onion, { position: [x + (j % 2 ? 0.03 : -0.03), H - 0.2 - (j / 4) * len, d / 2 - 0.05], scale: [0.045, 0.04, 0.045] });
    }
    b.build(this);
  }
}

/**
 * Canvas tent. Base at y = 0, entrance on +Z.
 * Options: `style` ('ridge' | 'round', default random), `color` (hex cloth colour, default random).
 * Colliders: 'tent' convex hull of the canvas.
 */
export const TENT_STYLES = ['ridge', 'round'];
export class Tent extends WorldModel {
  declare random: any;
  declare style: any;
  constructor(options: any = {}) {
    super('Tent', options);
    const styleRoll = this.random();
    this.style = TENT_STYLES.includes(options.style) ? options.style : TENT_STYLES[Math.floor(styleRoll * 2)];
    const col = Number.isFinite(options.color) ? options.color : pickOf(this, CLOTH);
    const cloth = this.surface('cloth', 0xffffff, true, [0]);
    const tc = rgb(col), trim = tc.map((v) => v * 0.6);
    const dark = material(0x1c1510, true), wood = this.surface('bark');
    const b = new MergeBuilder();
    const peg = (p) => b.add(boxG(), wood, { position: [p[0], 0.06, p[2]], scale: [0.04, 0.16, 0.04] });
    const hem = (y) => (y < 0.14 ? 0.72 : 1);
    if (this.style === 'round') {
      const r = this.rand(1.5, 2.2), wallH = r * 0.62, h = r * 1.35, seg = 16;
      // Wall and roof as alternating stripe sets, so each set gets a flat tint.
      const roofAt = (a, t) => {
        const rr = r * 1.12 * (1 - t), y = wallH + 0.05 + (h - wallH) * (1 - (1 - t) ** 1.25);
        return [Math.cos(a) * rr, y, Math.sin(a) * rr];
      };
      const wallAt = (a, t) => {
        const rr = r * (1 + 0.03 * Math.sin(Math.PI * t));
        return [Math.cos(a) * rr, wallH * t, Math.sin(a) * rr];
      };
      const door = Math.PI / 2, dHalf = 0.32;
      for (const odd of [0, 1]) {
        const roof = [], wall = [], val = [];
        for (let k = odd; k < seg; k += 2) {
          const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
          roof.push(...gridTriangles(4, 1, (i, j) => roofAt(j ? a0 : a1, i / 4)));
          const mid = (a0 + a1) / 2;
          if (Math.abs(Math.atan2(Math.sin(mid - door), Math.cos(mid - door))) > dHalf) wall.push(...gridTriangles(2, 1, (i, j) => wallAt(j ? a0 : a1, i / 2)));
          val.push(...gridTriangles(1, 2, (i, j) => {
            const a = a1 + (a0 - a1) * (j / 2), p = roofAt(a, 0);
            return [p[0], p[1] - (1 - i) * (0.18 - (j === 1 ? 0.08 : 0)), p[2]];
          }));
        }
        once(b, withBackFaces(trianglesGeometry(roof)), cloth, { tint: odd ? CREAM : tc });
        once(b, withBackFaces(trianglesGeometry(wall)), cloth, { tint: (x, y) => (odd ? CREAM : tc).map((v) => v * hem(y)) });
        once(b, withBackFaces(trianglesGeometry(val)), cloth, { tint: odd ? tc : trim });
      }
      // Doorway: dark interior and two flaps tied back.
      const dz = Math.sin(door) * r;
      b.add(boxG(), dark, { position: [0, wallH / 2, dz - 0.5], scale: [0.7, wallH, 0.04] });
      b.add(cylG(), dark, { position: [0, 0.01, 0], scale: [r * 0.98, 0.02, r * 0.98] });
      for (const s of [-1, 1]) {
        const ax = Math.cos(door + s * dHalf) * r, az = Math.sin(door + s * dHalf) * r;
        once(b, withBackFaces(trianglesGeometry([[[ax, 0, az], [ax, wallH, az], [ax + s * 0.12, wallH * 0.45, az + 0.12]]])), cloth, { tint: trim });
      }
      // Centre pole, finial and pennant.
      b.add(cylG(), wood, { position: [0, h / 2 + 0.2, 0], scale: [0.05, h + 0.4, 0.05] });
      b.add(fruitG(), material(0xc9a23a, true), { position: [0, h + 0.42, 0], scale: [0.07, 0.07, 0.07] });
      once(b, withBackFaces(trianglesGeometry([[[0, h + 0.36, 0], [0, h + 0.14, 0], [0.5, h + 0.22, 0.05]]])), cloth, { tint: tc });
      // Guy ropes and pegs.
      for (let k = 0; k < 6; k++) {
        const a = door + Math.PI / 6 + (k / 6) * Math.PI * 2;
        const top = roofAt(a, 0), pg = [Math.cos(a) * (r + 1.1), 0, Math.sin(a) * (r + 1.1)];
        rope(b, top, [pg[0], 0.12, pg[2]]);
        peg(pg);
      }
      this.addShape('convex', { points: [
        ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [[Math.cos(i * Math.PI / 4) * r, 0, Math.sin(i * Math.PI / 4) * r], [Math.cos(i * Math.PI / 4) * r, wallH, Math.sin(i * Math.PI / 4) * r]]),
        [0, h, 0],
      ] }, [0, 0, 0], null, 'tent');
    } else {
      const w = this.rand(1.8, 2.6), d = this.rand(2.2, 3.4), h = w * 0.75;
      const bays = 3;
      // Canvas side panels sag between the ridge and the eaves, and between the poles.
      for (const s of [-1, 1]) {
        once(b, sheet(4, bays * 3, (i, j) => {
          const u = i / 4, v = j / (bays * 3);
          const sag = 0.07 * Math.sin(Math.PI * u) * (0.4 + 0.6 * Math.abs(Math.sin(Math.PI * v * bays)));
          const flare = u > 0.85 ? (u - 0.85) * 0.6 : 0;
          return [s * ((w / 2) * u + flare - sag * 0.8), h * (1 - u) - sag * 0.5, (v - 0.5) * (d + 0.2)];
        }), cloth, { tint: (x, y) => tc.map((c) => c * hem(y)) });
      }
      // Back gable, front flaps tied open, dark interior and groundsheet.
      const bz = -d / 2 + 0.02, fz = d / 2;
      once(b, withBackFaces(trianglesGeometry([[[-w / 2, 0, bz], [w / 2, 0, bz], [0, h, bz]]])), cloth, { tint: trim });
      b.add(boxG(), dark, { position: [0, 0.01, 0], scale: [w * 0.95, 0.02, d] });
      once(b, trianglesGeometry([[[-w / 2 + 0.02, 0, bz + 0.03], [w / 2 - 0.02, 0, bz + 0.03], [0, h - 0.02, bz + 0.03]]]), dark);
      for (const s of [-1, 1]) {
        once(b, withBackFaces(trianglesGeometry([
          [[0, h, fz + 0.1], [s * w / 2, 0, fz + 0.1], [s * w * 0.36, h * 0.3, fz + 0.24]],
          [[0, h, fz + 0.1], [s * w * 0.36, h * 0.3, fz + 0.24], [s * w * 0.16, h * 0.42, fz + 0.12]],
        ])), cloth, { tint: trim });
        rope(b, [s * w * 0.3, h * 0.33, fz + 0.2], [s * w * 0.42, h * 0.2, fz + 0.12], 0.02);
      }
      // Poles, ridge pole, guy ropes and pegs.
      b.add(cylG(), wood, { position: [0, h, 0], scale: [0.035, d + 0.6, 0.035], quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) });
      for (const s of [-1, 1]) {
        const z = s * (d / 2 + 0.12);
        b.add(cylG(), wood, { position: [0, (h + 0.12) / 2, z], scale: [0.04, h + 0.12, 0.04] });
        const pg = [0, 0, s * (d / 2 + 1.1)];
        rope(b, [0, h + 0.05, z], [0, 0.12, pg[2]]);
        peg(pg);
        for (const t of [-1, 0, 1]) {
          const z2 = t * (d / 2 - 0.2), ex = s * (w / 2 + 0.08);
          rope(b, [ex, 0.05, z2], [ex + s * 0.4, 0.1, z2]);
          peg([ex + s * 0.42, 0, z2]);
        }
      }
      this.addShape('convex', { points: [
        [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2],
        [0, h, -d / 2], [0, h, d / 2],
      ] }, [0, 0, 0], null, 'tent');
    }
    b.build(this);
  }
}

/**
 * Mine entrance cut into a rocky hillside, opening on +Z, with a timber frame,
 * a dark tunnel, rails and an ore cart. Base at y = 0.
 * Options: `width` (1.6..4, default 2.2), `rails` (default true).
 * Colliders: 'rock' box (the hill, left and right), 'lintel' box, 'frame' post boxes.
 */
export class Mine extends WorldModel {
  declare random: any;
  constructor(options: any = {}) {
    super('Mine', options);
    const w = clamp(options.width, 1.6, 4, 2.2), h = w * 0.95;
    const rails = options.rails !== false;
    const rock = this.surface('rock'), wood = this.surface('planks'), stone = this.surface('stone');
    const b = new MergeBuilder();
    const hw = w / 2 + 1.4, hd = 3, hh = h + 1.4, sw = hw - w / 2;
    const v0 = Math.floor(this.random() * BLOB_VARIANTS);
    const moss = (top) => (x, y) => {
      const t = Math.min(1, Math.max(0, (y - top * 0.55) / (top * 0.35)));
      return [0.85 - 0.25 * t, 0.85 + 0.1 * t, 0.8 - 0.35 * t];
    };
    // Hillside: a big mass behind, shoulders either side and a cap over the lintel.
    b.add(rockBlob(v0, 2), rock, { position: [0, -0.3, -hd * 0.85], scale: [hw * 1.7, hh * 1.0, hd * 0.95], yaw: this.rand(-0.3, 0.3), uv: 'world', tint: moss(hh * 1.2) });
    for (const s of [-1, 1]) {
      b.add(rockBlob(v0 + 2 + s, 2), rock, { position: [s * (w / 2 + sw * 0.6), -0.2, 0.1], scale: [sw * 0.85, hh * 0.75, hd * 0.6], yaw: this.rand(-0.4, 0.4), uv: 'world', tint: moss(hh * 0.85) });
      this.addShape('box', { size: [sw, hh, hd] }, [s * (w / 2 + sw / 2), hh / 2, 0], null, 'rock');
    }
    b.add(rockBlob(v0 + 4, 1, false), rock, { position: [0, h + 0.75, 0.1], scale: [w * 0.75, 0.7, hd * 0.42], uv: 'world', tint: moss(h + 1.4) });
    // Tunnel: open box seen from inside, darkening with depth.
    const tw = w * 0.5 - 0.05, z0 = hd / 2 + 0.1, z1 = -0.6;
    const tunnel = [
      ...gridTriangles(1, 3, (i, j) => [-tw + 2 * tw * i, 0.02, z0 + (z1 - z0) * j / 3]),
      ...gridTriangles(1, 3, (i, j) => [tw - 2 * tw * i, h, z0 + (z1 - z0) * j / 3]),
      ...gridTriangles(1, 3, (i, j) => [-tw, h * i, z0 + (z1 - z0) * j / 3]),
      ...gridTriangles(1, 3, (i, j) => [tw, h * i, z0 + (z1 - z0) * j / 3]),
      ...gridTriangles(1, 1, (i, j) => [-tw + 2 * tw * j, h * i, z1]),
    ];
    once(b, withBackFaces(trianglesGeometry(tunnel)), rock, { uv: "world", tint: (x, y, z) => 0.03 + 0.8 * Math.max(0, (z - z1) / (z0 - z1)) ** 2 });
    // Timber frame at the entrance: posts, lintel, knee braces, inner sets.
    const z = hd / 2 + 0.05;
    for (const s of [-1, 1]) {
      b.add(boxG(), wood, { position: [s * (w / 2 - 0.1), h / 2, z], scale: [0.22, h, 0.22], grime: true, tint: 0.8 });
      this.addShape('box', { size: [0.22, h, 0.22] }, [s * (w / 2 - 0.1), h / 2, z], null, 'frame');
      for (const zz of [z - 0.9, z - 1.7]) b.add(boxG(), wood, { position: [s * (tw - 0.08), h / 2, zz], scale: [0.14, h, 0.14], tint: 0.35 });
    }
    for (const zz of [z - 0.9, z - 1.7]) b.add(boxG(), wood, { position: [0, h - 0.08, zz], scale: [2 * tw, 0.14, 0.14], tint: 0.35 });
    b.add(boxG(), wood, { position: [0, h + 0.05, z], scale: [w + 0.3, 0.26, 0.26], tint: 0.85 });
    this.addShape('box', { size: [w + 0.3, 0.26, 0.26] }, [0, h + 0.05, z], null, 'lintel');
    for (const s of [-1, 1]) beam(b, wood, [s * (w / 2 - 0.1), h * 0.65, z], [s * (w / 2 - 0.5), h, z], 0.12);
    // Plank sign and a hanging lantern.
    b.add(boxG(), wood, { position: [0, h + 0.38, z + 0.08], scale: [w * 0.4, 0.3, 0.05], tint: 1.15, yaw: 0, quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.rand(-0.06, 0.06)) });
    const lx = w / 2 - 0.45;
    rope(b, [lx, h - 0.08, z + 0.14], [lx, h - 0.3, z + 0.14], 0.012);
    b.add(boxG(), material(0x2a2a2a, true), { position: [lx, h - 0.33, z + 0.14], scale: [0.14, 0.03, 0.14] });
    b.add(boxG(), material(0xffc860, false), { position: [lx, h - 0.42, z + 0.14], scale: [0.1, 0.16, 0.1] });
    b.add(boxG(), material(0x2a2a2a, true), { position: [lx, h - 0.51, z + 0.14], scale: [0.14, 0.03, 0.14] });
    // Rails and sleepers running out of the tunnel, and an ore cart.
    const ext = hd / 2 + 2.4;
    if (rails) {
      const steel = material(0x555a60, true);
      for (const s of [-1, 1]) b.add(boxG(), steel, { position: [s * 0.35, 0.07, (z1 + ext) / 2], scale: [0.05, 0.06, ext - z1] });
      for (let zz = z1 + 0.2; zz < ext; zz += 0.45) b.add(boxG(), wood, { position: [0, 0.02, zz], scale: [1, 0.05, 0.14], yaw: this.rand(-0.05, 0.05), tint: this.rand(0.7, 1) });
      const cz = hd / 2 + 1.5, cy = 0.22;
      const tub = shared('settlement:tub', () => {
        const g = new CylinderGeometry(0.7071, 0.55, 1, 4, 1);
        g.rotateY(Math.PI / 4);
        return g;
      });
      b.add(tub, wood, { position: [0, cy + 0.27, cz], scale: [0.65, 0.42, 0.9], grime: true, tint: 0.85 });
      b.add(boxG(), steel, { position: [0, cy + 0.49, cz], scale: [0.95, 0.04, 1.3] });
      const wheel = shared('settlement:wheel', () => new CylinderGeometry(1, 1, 1, 10, 1).rotateZ(Math.PI / 2));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(wheel, steel, { position: [sx * 0.35, 0.16, cz + sz * 0.35], scale: [0.04, 0.13, 0.13] });
      const ore = material(0x4a4440, true), gem = material(0x40d0c0, false);
      for (let k = 0; k < 7; k++) {
        const px = this.rand(-0.3, 0.3), pz = this.rand(-0.45, 0.45), sz = this.rand(0.1, 0.17);
        b.add(rockBlob(k, 0, false), k % 3 ? ore : gem, { position: [px, cy + 0.5 + sz * 0.3, cz + pz], scale: [sz, sz * 0.8, sz], yaw: k });
      }
    }
    // Stone apron and scattered rubble.
    b.add(boxG(), stone, { position: [0, 0.03, hd / 2 + 0.6], scale: [w + 0.6, 0.06, 1.2], grime: true });
    for (let k = 0; k < 6; k++) {
      const s = k % 2 ? 1 : -1, sz = this.rand(0.12, 0.35);
      b.add(rockBlob(k + v0, 1), rock, { position: [s * this.rand(w / 2 + 0.4, hw + 0.5), 0, this.rand(hd / 2 - 0.2, hd / 2 + 2)], scale: [sz, sz * 0.8, sz], yaw: this.rand(0, 6), uv: 'world' });
    }
    b.build(this);
  }
}
