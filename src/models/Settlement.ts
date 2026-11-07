import { BoxGeometry, CylinderGeometry, ConeGeometry, Group, Quaternion, Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';

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
      sb.add(boxG(), wood, { position: at(len / 2), scale: [0.12, len, 0.1], quaternion: q });
      sb.add(boxG(), cloth, { position: new Vector3(0.38, len * 0.62, 0.02).applyQuaternion(q).toArray(), scale: [0.6, len * 0.7, 0.03], quaternion: q });
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
    const cloth = material(col, true), cloth2 = material(0xe8e2d0, true);
    const goods = [0xc0392b, 0xe0a030, 0x5a9a3a];
    const b = new MergeBuilder();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const hh = sz < 0 ? H + 0.3 : H;
      b.add(boxG(), wood, { position: [sx * (w / 2 - 0.05), hh / 2, sz * (d / 2 - 0.05)], scale: [0.1, hh, 0.1] });
    }
    b.add(boxG(), wood, { position: [0, 0.45, d / 2 - 0.2], scale: [w, 0.9, 0.5], tint: this.rand(0.9, 1.05) });
    this.addShape('box', { size: [w, 0.9, 0.5] }, [0, 0.45, d / 2 - 0.2], null, 'counter');
    const stripes = Math.max(4, Math.round(w / 0.3));
    const slope = Math.atan2(0.3, d);
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), slope);
    for (let i = 0; i < stripes; i++) {
      const x = -w / 2 + (i + 0.5) * (w / stripes);
      b.add(boxG(), i % 2 ? cloth2 : cloth, { position: [x, H + 0.1, 0.05], scale: [w / stripes, 0.03, d + 0.4], quaternion: q });
    }
    b.add(boxG(), cloth, { position: [0, H - 0.12, d / 2 + 0.2], scale: [w, 0.25, 0.02] }); // front valance
    this.addShape('box', { size: [w, 0.1, d + 0.4] }, [0, H + 0.1, 0], null, 'awning');
    const n = Math.max(2, Math.floor(w / 0.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      b.add(boxG(), material(pickOf(this, goods), true), { position: [x, 0.97, d / 2 - 0.2], scale: [0.35, 0.14, 0.3] });
    }
    b.add(boxG(), wood, { position: [0, 0.9, -d / 2 + 0.05], scale: [w, 0.04, 0.02] }); // back shelf
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
    const cloth = material(col, true), dark = material(0x2a1f18, true), wood = this.surface('planks');
    const b = new MergeBuilder();
    if (this.style === 'round') {
      const r = this.rand(1.5, 2.2), h = r * 1.3;
      const wall = r * 0.9;
      b.add(shared('tent:round', () => new CylinderGeometry(1, 1, 1, 8, 1)), cloth, { position: [0, 0.5, 0], scale: [r, 1, r] });
      b.add(coneG(), cloth, { position: [0, 1 + (h - 1) / 2, 0], scale: [r * 1.05, h - 1, r * 1.05] });
      b.add(boxG(), dark, { position: [0, 0.6, r - 0.02], scale: [0.7, 1.2, 0.06] });
      b.add(cylG(), wood, { position: [0, h + 0.2, 0], scale: [0.03, 0.4, 0.03] });
      this.addShape('convex', { points: [
        ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [[Math.cos(i * Math.PI / 4) * r, 0, Math.sin(i * Math.PI / 4) * r], [Math.cos(i * Math.PI / 4) * r, 1, Math.sin(i * Math.PI / 4) * r]]),
        [0, h, 0],
      ] }, [0, 0, 0], null, 'tent');
      void wall;
    } else {
      const w = this.rand(1.8, 2.6), d = this.rand(2.2, 3.4), h = w * 0.75;
      const ang = Math.atan2(h, w / 2), sl = Math.hypot(w / 2, h);
      for (const s of [-1, 1]) {
        b.add(boxG(), cloth, {
          position: [s * w / 4, h / 2, 0], scale: [sl, 0.04, d],
          quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -s * ang),
          tint: this.rand(0.93, 1.05),
        });
      }
      b.add(boxG(), dark, { position: [0, h * 0.35, d / 2 - 0.01], scale: [w * 0.35, h * 0.7, 0.04] });
      b.add(boxG(), wood, { position: [0, h, d / 2 + 0.15], scale: [0.05, 0.06, 0.3] });
      for (const s of [-1, 1]) b.add(boxG(), wood, { position: [0, h / 2, s * (d / 2 + 0.1)], scale: [0.06, h, 0.06] });
      this.addShape('convex', { points: [
        [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2],
        [0, h, -d / 2], [0, h, d / 2],
      ] }, [0, 0, 0], null, 'tent');
    }
    b.build(this);
  }
}

/**
 * Mine entrance cut into a hillside, opening on +Z, with a timber frame,
 * a dark tunnel mouth and a few rails. Base at y = 0.
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
    const hw = w / 2 + 1.4, hd = 3, hh = h + 1.4;
    for (const s of [-1, 1]) {
      const cx = s * (w / 2 + 0.7 + (hw - w / 2 - 0.7) / 2 - 0.0);
      const sw = hw - w / 2;
      b.add(boxG(), rock, { position: [s * (w / 2 + sw / 2), hh / 2, 0], scale: [sw, hh, hd], grime: true, tint: this.rand(0.85, 1) });
      this.addShape('box', { size: [sw, hh, hd] }, [s * (w / 2 + sw / 2), hh / 2, 0], null, 'rock');
      void cx;
    }
    b.add(boxG(), rock, { position: [0, h + 0.7, 0], scale: [w, 1.4, hd], tint: 0.9 });
    b.add(boxG(), material(0x050505, true), { position: [0, h / 2, -hd / 2 + 0.2], scale: [w, h, 0.05] });
    // Timber frame at the entrance.
    const z = hd / 2 + 0.05;
    for (const s of [-1, 1]) {
      b.add(boxG(), wood, { position: [s * (w / 2 - 0.1), h / 2, z], scale: [0.22, h, 0.22], grime: true });
      this.addShape('box', { size: [0.22, h, 0.22] }, [s * (w / 2 - 0.1), h / 2, z], null, 'frame');
    }
    b.add(boxG(), wood, { position: [0, h + 0.05, z], scale: [w + 0.3, 0.26, 0.26] });
    this.addShape('box', { size: [w + 0.3, 0.26, 0.26] }, [0, h + 0.05, z], null, 'lintel');
    for (const s of [-1, 1]) beam(b, wood, [s * (w / 2 - 0.1), h * 0.65, z], [s * (w / 2 - 0.5), h, z], 0.12);
    // Rails and sleepers running out of the tunnel.
    if (rails) {
      const steel = material(0x555a60, true);
      for (const s of [-1, 1]) b.add(boxG(), steel, { position: [s * 0.35, 0.05, 0.6], scale: [0.05, 0.05, hd + 3.4] });
      for (let zz = -hd / 2 + 0.3; zz < hd / 2 + 2.2; zz += 0.5) b.add(boxG(), wood, { position: [0, 0.02, zz], scale: [1, 0.04, 0.12] });
    }
    b.add(boxG(), stone, { position: [0, 0.05, hd / 2 + 0.6], scale: [w + 0.6, 0.1, 1.2], grime: true });
    b.build(this);
  }
}
