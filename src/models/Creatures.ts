import { Group, Mesh, BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry } from 'three';
import { WorldModel, shared, material } from '../WorldModel.ts';

/**
 * Low-poly stylized characters and creatures built from primitives. They stand
 * on y = 0, face +Z, and are made of flat-shaded coloured parts.
 *
 * Animation hooks (shared by every creature):
 *  - `creature.limbs`: named pivot Groups (e.g. `armL`, `legR`, `head`, `tail`).
 *    Rotate them directly. Names are listed in each class doc.
 *  - `pose` option / `setPose(pose)`: a preset name (see `creature.poses`, always
 *    includes `idle` and `walk`) or `{limbName: [rx, ry, rz]}` (radians, absolute).
 *    A limb value may also be `{rotation: [rx, ry, rz], scale: [sx, sy, sz]}`.
 *    Unlisted limbs return to rest. Unknown names fall back to `idle`.
 *  - `animate(time, speed = 1, amount = 1)`: procedural walk/idle cycle driven by
 *    a clock in seconds; call each frame. Colliders stay put (they are static).
 * Colours are fixed per class, `tint` (hex) recolours the main body/cloth part.
 * Each creature has `seed` for small proportion variation and at least one collider.
 */

const box = () => shared('cr:box', () => new BoxGeometry(1, 1, 1));
const ball = () => shared('cr:ball', () => new SphereGeometry(1, 8, 6));
const cyl = () => shared('cr:cyl', () => new CylinderGeometry(1, 1, 1, 8));
const cone = () => shared('cr:cone', () => new ConeGeometry(1, 1, 8));
const GEOS = { box, ball, cyl, cone };

type Vec = [number, number, number];

export class Creature extends WorldModel {
  declare limbs: Record<string, Group>;
  declare poses: Record<string, any>;
  declare gait: Array<[string, number, number]>; // [limb, phase (cycles), swing amplitude (rad, X axis)]
  declare _rest: Record<string, any>;
  declare currentPose: string | object;

  constructor(name, options: any = {}) {
    super(name, options);
    this.limbs = {};
    this.poses = { idle: {}, walk: {} };
    this.gait = [];
    this._rest = {};
    this.currentPose = 'idle';
  }

  /** Add a primitive mesh ('box' | 'ball' | 'cyl' | 'cone') of `color` to `parent`. */
  part(parent, shape, color, position: Vec, scale: Vec, rotation: Vec | null = null) {
    const m = new Mesh(GEOS[shape](), material(color, true));
    m.position.set(...position);
    m.scale.set(...scale);
    if (rotation) m.rotation.set(...rotation);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Create a named pivot Group at `position` inside `parent` (the model by default). */
  limb(name, position: Vec, parent: Group = this) {
    const g = new Group();
    g.name = name;
    g.position.set(...position);
    parent.add(g);
    this.limbs[name] = g;
    this._rest[name] = { rotation: [0, 0, 0], scale: [1, 1, 1] };
    return g;
  }

  /** Record current limb transforms as the rest pose. Called by subclasses once built. */
  protected finish() {
    for (const [n, g] of Object.entries(this.limbs)) {
      this._rest[n] = { rotation: [g.rotation.x, g.rotation.y, g.rotation.z], scale: g.scale.toArray() };
    }
    this.setPose(this.options.pose ?? 'idle');
  }

  setPose(pose: string | object = 'idle') {
    const def = typeof pose === 'string' ? (this.poses[pose] ?? (pose = 'idle', this.poses.idle)) : pose;
    this.currentPose = pose;
    for (const [n, g] of Object.entries(this.limbs)) {
      const r = this._rest[n], o = def[n];
      const rot = Array.isArray(o) ? o : o?.rotation;
      const sc = Array.isArray(o) ? null : o?.scale;
      g.rotation.set(...((rot ?? r.rotation) as Vec));
      g.scale.set(...((sc ?? r.scale) as Vec));
    }
    return this;
  }

  animate(time = 0, speed = 1, amount = 1) {
    const t = time * speed * Math.PI * 2;
    for (const [n, phase, amp] of this.gait) {
      const g = this.limbs[n];
      if (g) g.rotation.x = this._rest[n].rotation[0] + Math.sin(t + phase * Math.PI * 2) * amp * amount;
    }
    return this;
  }
}

interface HumanoidStyle {
  skin: number; torso: number; legs: number; boots?: number; hair?: number | null; height?: number; bulk?: number;
}

/** Builds head, torso, arms and legs. Limbs: head, armL, armR, legL, legR. Returns torso-top y. */
function humanoid(c: Creature, s: HumanoidStyle) {
  const h = s.height ?? 1, w = s.bulk ?? 1;
  const legLen = 0.5 * h, torsoH = 0.55 * h, armLen = 0.5 * h;
  const hipY = legLen, shoulderY = legLen + torsoH;
  c.part(c, 'box', s.torso, [0, hipY + torsoH / 2, 0], [0.42 * w, torsoH, 0.24 * w]);
  for (const [n, x] of [['legL', -0.11 * w], ['legR', 0.11 * w]] as const) {
    const l = c.limb(n, [x, hipY, 0]);
    c.part(l, 'box', s.legs, [0, -legLen * 0.55, 0], [0.16 * w, legLen * 1.1, 0.18 * w]);
    c.part(l, 'box', s.boots ?? s.legs, [0, -legLen + 0.04, 0.04], [0.18 * w, 0.1, 0.26 * w]);
  }
  for (const [n, x] of [['armL', -0.28 * w], ['armR', 0.28 * w]] as const) {
    const a = c.limb(n, [x, shoulderY - 0.06, 0]);
    c.part(a, 'box', s.torso, [0, -armLen * 0.35, 0], [0.12 * w, armLen * 0.7, 0.14 * w]);
    c.part(a, 'box', s.skin, [0, -armLen * 0.85, 0], [0.1 * w, armLen * 0.3, 0.12 * w]);
  }
  const head = c.limb('head', [0, shoulderY, 0]);
  c.part(head, 'box', s.skin, [0, 0.14 * h, 0], [0.24, 0.26 * h, 0.24]);
  if (s.hair != null) c.part(head, 'box', s.hair, [0, 0.25 * h, -0.02], [0.26, 0.1 * h, 0.27]);
  c.part(head, 'box', 0x1a1a1a, [-0.05, 0.16 * h, 0.125], [0.03, 0.03, 0.01]);
  c.part(head, 'box', 0x1a1a1a, [0.05, 0.16 * h, 0.125], [0.03, 0.03, 0.01]);
  c.gait = [['legL', 0, 0.7], ['legR', 0.5, 0.7], ['armL', 0.5, 0.6], ['armR', 0, 0.6]];
  c.poses = {
    idle: {},
    walk: { legL: [0.5, 0, 0], legR: [-0.5, 0, 0], armL: [-0.4, 0, 0], armR: [0.4, 0, 0] },
    attack: { armR: [-2.4, 0, -0.1], armL: [-0.3, 0, 0.2], head: [0.1, 0, 0] },
    cheer: { armL: [-3, 0, 0.3], armR: [-3, 0, -0.3] },
    sit: { legL: [-1.5, 0, 0], legR: [-1.5, 0, 0], armL: [-0.6, 0, 0], armR: [-0.6, 0, 0] },
  };
  return { height: shoulderY + 0.3 * h, w };
}

function humanoidCollider(c: Creature, height: number, w = 1) {
  c.addShape('cylinder', { radius: 0.28 * w, height }, [0, height / 2, 0], null, 'body');
}

/**
 * Villager: plain commoner. Options: `seed`, `tint` (hex tunic colour, default
 * seeded earthy), `hat` (straw hat, default seeded), `pose`. Limbs: head, armL,
 * armR, legL, legR. Poses: idle, walk, attack, cheer, sit. Collider: cylinder.
 */
export class Villager extends Creature {
  constructor(options: any = {}) {
    super('Villager', options);
    const tunics = [0x8a6a3a, 0x5a7a4a, 0x7a4a3a, 0x4a6a8a, 0xa08a5a];
    const tunic = options.tint ?? tunics[Math.floor(this.rand(0, tunics.length))];
    const skin = [0xe8bf9a, 0xc68a62, 0x8d5a3b][Math.floor(this.rand(0, 3))];
    const hair = [0x3a2a1a, 0x7a4a22, 0xc9a24a, 0x222222][Math.floor(this.rand(0, 4))];
    const hat = options.hat ?? this.random() < 0.5;
    const height = this.rand(0.92, 1.08);
    const { height: H } = humanoid(this, { skin, torso: tunic, legs: 0x5a4a3a, boots: 0x3a2a1a, hair, height, bulk: this.rand(0.95, 1.1) });
    if (hat) {
      const head = this.limbs.head;
      this.part(head, 'cyl', 0xd9bb64, [0, 0.27 * height, 0], [0.22, 0.02, 0.22]);
      this.part(head, 'cyl', 0xd9bb64, [0, 0.31 * height, 0], [0.12, 0.07, 0.12]);
    }
    humanoidCollider(this, H);
    this.finish();
  }
}

/**
 * Knight: armoured warrior with helmet, plume, sword and shield. Options:
 * `seed`, `tint` (hex plume/shield colour), `pose`. Limbs: head, armL, armR
 * (sword hand), legL, legR. Poses: idle, walk, attack, cheer, sit.
 * Collider: cylinder.
 */
export class Knight extends Creature {
  constructor(options: any = {}) {
    super('Knight', options);
    const crest = options.tint ?? [0xb02a2a, 0x2a4ab0, 0x2a8a3a][Math.floor(this.rand(0, 3))];
    const steel = 0x9aa3ad;
    const { height: H } = humanoid(this, { skin: steel, torso: steel, legs: 0x7d858f, boots: 0x555b63, height: 1.05, bulk: 1.15 });
    const head = this.limbs.head;
    this.part(head, 'box', steel, [0, 0.16, 0], [0.28, 0.32, 0.28]);
    this.part(head, 'box', 0x1a1a1a, [0, 0.17, 0.145], [0.18, 0.04, 0.01]);
    this.part(head, 'box', crest, [0, 0.36, -0.02], [0.05, 0.14, 0.2]);
    const sword = this.limbs.armR;
    this.part(sword, 'box', 0xdfe6ee, [0, -0.5, 0.25], [0.04, 0.06, 0.7]);
    this.part(sword, 'box', 0x6a4a2a, [0, -0.5, -0.05], [0.18, 0.04, 0.05]);
    const shield = this.limbs.armL;
    this.part(shield, 'box', crest, [-0.1, -0.3, 0.05], [0.05, 0.4, 0.3]);
    this.part(shield, 'box', 0xe0c050, [-0.13, -0.3, 0.05], [0.02, 0.1, 0.1]);
    humanoidCollider(this, H, 1.15);
    this.finish();
  }
}

/**
 * Wizard: robed caster with a pointed hat, beard and staff. Options: `seed`,
 * `tint` (hex robe colour, default blue/purple), `pose`. Limbs: head, armL,
 * armR (staff hand), legL, legR. Poses: idle, walk, attack, cheer, sit.
 * Collider: cylinder.
 */
export class Wizard extends Creature {
  constructor(options: any = {}) {
    super('Wizard', options);
    const robe = options.tint ?? [0x3a3a9a, 0x6a2a8a, 0x2a5a8a][Math.floor(this.rand(0, 3))];
    const { height: H } = humanoid(this, { skin: 0xe0b894, torso: robe, legs: robe, boots: 0x3a2a1a, hair: 0xe8e8e8, height: 1.05 });
    this.part(this, 'cone', robe, [0, 0.28, 0], [0.3, 0.56, 0.3]);
    const head = this.limbs.head;
    this.part(head, 'cyl', robe, [0, 0.27, 0], [0.26, 0.02, 0.26]);
    this.part(head, 'cone', robe, [0, 0.5, 0], [0.17, 0.5, 0.17]);
    this.part(head, 'box', 0xeeeeee, [0, 0.04, 0.1], [0.18, 0.2, 0.08]);
    const staff = this.limbs.armR;
    this.part(staff, 'cyl', 0x6a4a2a, [0, -0.3, 0.15], [0.025, 1.4, 0.025]);
    this.part(staff, 'ball', 0x66ddff, [0, 0.42, 0.15], [0.08, 0.08, 0.08]);
    humanoidCollider(this, H + 0.45, 1.1);
    this.finish();
  }
}

interface QuadStyle {
  body: number; belly?: number; length: number; height: number; legLen: number; width: number;
}

/** Builds a four-legged body. Limbs: head, neck, tail, legFL, legFR, legBL, legBR. Faces +Z. */
function quadruped(c: Creature, s: QuadStyle) {
  const { length: L, width: W, legLen } = s;
  const bodyY = legLen + s.height / 2;
  c.part(c, 'box', s.body, [0, bodyY, 0], [W, s.height, L]);
  if (s.belly != null) c.part(c, 'box', s.belly, [0, bodyY - s.height * 0.4, 0], [W * 0.8, s.height * 0.3, L * 0.9]);
  const legs: Array<[string, number, number]> = [['legFL', -1, 1], ['legFR', 1, 1], ['legBL', -1, -1], ['legBR', 1, -1]];
  for (const [n, sx, sz] of legs) {
    const l = c.limb(n, [sx * W * 0.32, legLen, sz * L * 0.38]);
    c.part(l, 'box', s.body, [0, -legLen / 2, 0], [W * 0.26, legLen, W * 0.26]);
    c.part(l, 'box', 0x2a2a2a, [0, -legLen + 0.03, 0.01], [W * 0.28, 0.06, W * 0.3]);
  }
  c.gait = [['legFL', 0, 0.6], ['legBR', 0, 0.6], ['legFR', 0.5, 0.6], ['legBL', 0.5, 0.6], ['tail', 0.25, 0.15]];
  c.poses = {
    idle: {},
    walk: { legFL: [0.5, 0, 0], legBR: [0.5, 0, 0], legFR: [-0.5, 0, 0], legBL: [-0.5, 0, 0] },
    rear: { legFL: [-1.2, 0, 0], legFR: [-1.2, 0, 0], neck: [-0.4, 0, 0], head: [-0.3, 0, 0] },
    rest: { legFL: [-1.3, 0, 0], legFR: [-1.3, 0, 0], head: [0.5, 0, 0] },
  };
  return { bodyY, topY: bodyY + s.height / 2 };
}

/**
 * Horse: Options: `seed`, `tint` (hex coat; default seeded brown/black/white/chestnut),
 * `saddle` (default false), `pose`. Limbs: head, neck, tail, legFL, legFR,
 * legBL, legBR. Poses: idle, walk, rear, rest. Colliders: body box + head sphere
 * (tag 'head').
 */
export class Horse extends Creature {
  constructor(options: any = {}) {
    super('Horse', options);
    const coat = options.tint ?? [0x7a4a2a, 0x2a2420, 0xe8e4da, 0xa8622a][Math.floor(this.rand(0, 4))];
    const mane = coat === 0x2a2420 ? 0x111111 : 0x2a1a10;
    const L = this.rand(1.3, 1.5), legLen = 0.8;
    const { bodyY, topY } = quadruped(this, { body: coat, length: L, width: 0.5, height: 0.55, legLen });
    const neck = this.limb('neck', [0, topY - 0.1, L * 0.4]);
    neck.rotation.x = 0.5;
    this.part(neck, 'box', coat, [0, 0.28, 0], [0.22, 0.6, 0.26]);
    this.part(neck, 'box', mane, [0, 0.3, -0.15], [0.06, 0.55, 0.1]);
    const head = this.limb('head', [0, 0.58, 0.02], neck);
    head.rotation.x = 0.55;
    this.part(head, 'box', coat, [0, 0.1, 0.12], [0.2, 0.22, 0.4]);
    this.part(head, 'box', 0x222222, [0, 0.02, 0.33], [0.17, 0.12, 0.06]);
    for (const x of [-0.07, 0.07]) this.part(head, 'cone', coat, [x, 0.27, -0.02], [0.05, 0.12, 0.05]);
    const tail = this.limb('tail', [0, bodyY + 0.2, -L / 2]);
    tail.rotation.x = 0.4;
    this.part(tail, 'box', mane, [0, -0.3, 0], [0.1, 0.65, 0.1]);
    if (options.saddle) {
      this.part(this, 'box', 0x6a3a1a, [0, topY + 0.04, -0.05], [0.56, 0.08, 0.4]);
      this.part(this, 'box', 0xb02a2a, [0, topY + 0.1, -0.05], [0.4, 0.05, 0.3]);
    }
    this.addShape('box', { size: [0.55, topY, L] }, [0, topY / 2, 0], null, 'body');
    this.addShape('sphere', { radius: 0.25 }, [0, topY + 0.5, L * 0.55], null, 'head');
    this.finish();
  }
}

/**
 * Wolf: grey (or `tint`) predator with pointed ears, snout and bushy tail.
 * Options: `seed`, `tint` (hex fur), `pose`. Limbs: head, neck, tail, jaw,
 * legFL, legFR, legBL, legBR. Poses: idle, walk, rear, rest, howl, snarl.
 * Collider: box body.
 */
export class Wolf extends Creature {
  constructor(options: any = {}) {
    super('Wolf', options);
    const fur = options.tint ?? [0x7a7a80, 0x55555a, 0x9a8a78][Math.floor(this.rand(0, 3))];
    const L = this.rand(0.85, 1);
    const { topY } = quadruped(this, { body: fur, belly: 0xc8c4bc, length: L, width: 0.3, height: 0.32, legLen: 0.36 });
    const neck = this.limb('neck', [0, topY - 0.08, L * 0.42]);
    this.part(neck, 'box', fur, [0, 0.04, 0.06], [0.22, 0.22, 0.22]);
    const head = this.limb('head', [0, 0.06, 0.12], neck);
    this.part(head, 'box', fur, [0, 0.02, 0.1], [0.2, 0.2, 0.2]);
    this.part(head, 'box', 0xc8c4bc, [0, -0.02, 0.26], [0.12, 0.1, 0.18]);
    this.part(head, 'box', 0x111111, [0, 0.01, 0.36], [0.05, 0.05, 0.03]);
    for (const x of [-0.07, 0.07]) this.part(head, 'cone', fur, [x, 0.17, 0.04], [0.05, 0.12, 0.05]);
    for (const x of [-0.06, 0.06]) this.part(head, 'box', 0xffd24a, [x, 0.07, 0.2], [0.03, 0.03, 0.01]);
    const jaw = this.limb('jaw', [0, -0.07, 0.17], head);
    this.part(jaw, 'box', 0xc8c4bc, [0, -0.01, 0.08], [0.1, 0.04, 0.16]);
    const tail = this.limb('tail', [0, topY - 0.06, -L / 2]);
    tail.rotation.x = -0.9;
    this.part(tail, 'cone', fur, [0, -0.22, 0], [0.09, 0.45, 0.09], [Math.PI, 0, 0]);
    this.poses.howl = { neck: [-0.7, 0, 0], head: [-0.6, 0, 0], jaw: [0.6, 0, 0] };
    this.poses.snarl = { head: [0.15, 0, 0], jaw: [0.4, 0, 0], neck: [0.2, 0, 0] };
    this.addShape('box', { size: [0.35, topY, L + 0.5] }, [0, topY / 2, 0.1], null, 'body');
    this.finish();
  }
}

/**
 * Dragon: winged quadruped with horned head, spiked back and long tail.
 * Options: `seed`, `tint` (hex scales; default seeded red/green/blue),
 * `wings` (default true), `pose`. Limbs: head, jaw, neck, tail, wingL, wingR,
 * legFL, legFR, legBL, legBR. Poses: idle, walk, fly (wings up), glide,
 * roar, rest. `animate` flaps the wings. Colliders: body box, head sphere
 * (tag 'head'), tail box (tag 'tail').
 */
export class Dragon extends Creature {
  constructor(options: any = {}) {
    super('Dragon', options);
    const scales = options.tint ?? [0xa83228, 0x3a8a4a, 0x3a5aa8][Math.floor(this.rand(0, 3))];
    const belly = 0xe0c070, horn = 0xe8e0c8;
    const L = this.rand(2.2, 2.6), legLen = 0.55;
    const { bodyY, topY } = quadruped(this, { body: scales, belly, length: L, width: 0.9, height: 0.85, legLen });
    for (let i = 0; i < 5; i++) {
      this.part(this, 'cone', horn, [0, topY + 0.08, L * 0.38 - i * (L * 0.18)], [0.08, 0.2 - i * 0.02, 0.08]);
    }
    const neck = this.limb('neck', [0, topY - 0.15, L * 0.42]);
    neck.rotation.x = 0.7;
    this.part(neck, 'box', scales, [0, 0.4, 0], [0.34, 0.9, 0.34]);
    const head = this.limb('head', [0, 0.85, 0], neck);
    head.rotation.x = 0.8;
    this.part(head, 'box', scales, [0, 0.1, 0.15], [0.4, 0.3, 0.5]);
    for (const x of [-0.12, 0.12]) {
      this.part(head, 'cone', horn, [x, 0.3, -0.05], [0.06, 0.3, 0.06], [-0.6, 0, 0]);
      this.part(head, 'box', 0xffd23a, [x * 1.4, 0.18, 0.3], [0.05, 0.05, 0.02]);
    }
    const jaw = this.limb('jaw', [0, -0.03, 0.1], head);
    this.part(jaw, 'box', belly, [0, -0.04, 0.2], [0.32, 0.08, 0.45]);
    const tail = this.limb('tail', [0, bodyY, -L / 2]);
    this.part(tail, 'cone', scales, [0, 0, -0.8], [0.32, 1.7, 0.32], [-Math.PI / 2, 0, 0]);
    tail.rotation.x = 0.15;
    if (options.wings ?? true) {
      for (const [n, sx] of [['wingL', -1], ['wingR', 1]] as const) {
        const w = this.limb(n, [sx * 0.4, topY - 0.05, L * 0.15]);
        w.rotation.z = sx * 0.9;
        this.part(w, 'box', scales, [sx * 0.7, 0, 0], [1.4, 0.07, 0.1]);
        this.part(w, 'box', 0x7a2a22, [sx * 0.7, 0, -0.35], [1.3, 0.02, 0.7]);
      }
    }
    this.gait.push(['wingL', 0, 0], ['wingR', 0, 0]);
    this.poses.fly = { wingL: [0, 0, -0.4], wingR: [0, 0, 0.4], legFL: [0.6, 0, 0], legFR: [0.6, 0, 0], legBL: [0.6, 0, 0], legBR: [0.6, 0, 0] };
    this.poses.glide = { wingL: [0, 0, 0.1], wingR: [0, 0, -0.1] };
    this.poses.roar = { neck: [-0.2, 0, 0], head: [-0.4, 0, 0], jaw: [0.7, 0, 0] };
    this.poses.rest = { head: [0.6, 0, 0], wingL: [0, 0, 1.4], wingR: [0, 0, -1.4], legFL: [-1.2, 0, 0], legFR: [-1.2, 0, 0] };
    this.addShape('box', { size: [0.95, topY, L] }, [0, topY / 2, 0], null, 'body');
    this.addShape('sphere', { radius: 0.35 }, [0, topY + 0.9, L * 0.62], null, 'head');
    this.addShape('box', { size: [0.4, 0.4, 1.4] }, [0, bodyY, -L / 2 - 0.7], null, 'tail');
    this.finish();
    this.limbs.wingL && (this._rest.wingL.rotation = [0, 0, -0.9]);
    this.limbs.wingR && (this._rest.wingR.rotation = [0, 0, 0.9]);
    this.setPose(options.pose ?? 'idle');
  }

  /** Walk cycle plus slow wing flaps (`amount` scales both). */
  animate(time = 0, speed = 1, amount = 1) {
    super.animate(time, speed, amount);
    const flap = Math.sin(time * speed * Math.PI * 2) * 0.5 * amount;
    if (this.limbs.wingL) this.limbs.wingL.rotation.z = this._rest.wingL.rotation[2] + flap;
    if (this.limbs.wingR) this.limbs.wingR.rotation.z = this._rest.wingR.rotation[2] - flap;
    return this;
  }
}

/**
 * Slime: translucent blob with eyes. Options: `seed`, `tint` (hex; default
 * seeded green/blue/pink), `pose`. Limb: `body` (squash & stretch target,
 * eyes ride on it). Poses: idle, squash, stretch, walk (small squash), jump.
 * `animate` bobs the body. Collider: sphere.
 */
export class Slime extends Creature {
  constructor(options: any = {}) {
    super('Slime', options);
    const tint = options.tint ?? [0x5acb5a, 0x4aa8e0, 0xe06ab0][Math.floor(this.rand(0, 3))];
    const r = this.rand(0.38, 0.46);
    const body = this.limb('body', [0, 0, 0]);
    const blob = this.part(body, 'ball', tint, [0, r * 0.7, 0], [r, r * 0.8, r]);
    blob.material = shared(`cr:slime:${tint}`, () => {
      const m = material(tint, true).clone();
      m.transparent = true;
      m.opacity = 0.8;
      return m;
    });
    this.part(body, 'ball', 0xffffff, [r * 0.3, r * 0.85, r * 0.8], [0.07, 0.09, 0.05]);
    this.part(body, 'ball', 0xffffff, [-r * 0.3, r * 0.85, r * 0.8], [0.07, 0.09, 0.05]);
    this.part(body, 'ball', 0x111111, [r * 0.3, r * 0.85, r * 0.8 + 0.03], [0.03, 0.04, 0.03]);
    this.part(body, 'ball', 0x111111, [-r * 0.3, r * 0.85, r * 0.8 + 0.03], [0.03, 0.04, 0.03]);
    this.poses = {
      idle: {},
      squash: { body: { rotation: [0, 0, 0], scale: [1.25, 0.7, 1.25] } },
      stretch: { body: { rotation: [0, 0, 0], scale: [0.8, 1.35, 0.8] } },
      walk: { body: { rotation: [0, 0, 0], scale: [1.1, 0.88, 1.1] } },
      jump: { body: { rotation: [0, 0, 0], scale: [0.85, 1.25, 0.85] } },
    };
    this.addShape('sphere', { radius: r * 0.9 }, [0, r * 0.7, 0], null, 'body');
    this.finish();
  }

  animate(time = 0, speed = 1, amount = 1) {
    const k = Math.sin(time * speed * Math.PI * 2) * 0.12 * amount;
    this.limbs.body.scale.set(1 + k, 1 - k, 1 + k);
    return this;
  }
}

/**
 * Skeleton: bony undead with ribcage, skull and a rusty sword. Options: `seed`,
 * `tint` (hex bone colour), `armed` (default true), `pose`. Limbs: head, armL,
 * armR, legL, legR. Poses: idle, walk, attack, cheer, sit. Collider: cylinder.
 */
export class Skeleton extends Creature {
  constructor(options: any = {}) {
    super('Skeleton', options);
    const bone = options.tint ?? 0xe4dfcc;
    const { height: H } = humanoid(this, { skin: bone, torso: bone, legs: bone, boots: bone, height: this.rand(0.98, 1.08), bulk: 0.7 });
    const torsoY = 0.5 + 0.275;
    for (let i = 0; i < 3; i++) this.part(this, 'box', 0x8a8574, [0, torsoY - 0.12 + i * 0.12, 0.1], [0.3, 0.04, 0.05]);
    this.part(this, 'box', 0x222222, [0, torsoY, 0], [0.1, 0.5, 0.1]);
    const head = this.limbs.head;
    this.part(head, 'box', 0x111111, [-0.055, 0.16, 0.125], [0.06, 0.06, 0.02]);
    this.part(head, 'box', 0x111111, [0.055, 0.16, 0.125], [0.06, 0.06, 0.02]);
    this.part(head, 'box', bone, [0, 0.03, 0.08], [0.16, 0.05, 0.1]);
    if (options.armed ?? true) {
      const a = this.limbs.armR;
      this.part(a, 'box', 0x9a6a4a, [0, -0.5, 0.25], [0.04, 0.06, 0.7]);
    }
    humanoidCollider(this, H, 0.8);
    this.finish();
  }
}
