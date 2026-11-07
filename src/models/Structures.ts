import {
  Quaternion, Vector3, Euler, BoxGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, SphereGeometry, ExtrudeGeometry, Shape,
  RingGeometry, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, AdditiveBlending, DoubleSide,
} from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';
import { trianglesGeometry, rockBlob, BLOB_VARIANTS, noise3, noiseSeed } from './terrain.ts';

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
/** Fluted column shaft (16 flutes' worth of ridges, slight entasis), height 1 centred on the origin. */
const flutedG = () => shared('struct:fluted', () => {
  const g = new CylinderGeometry(0.88, 1, 1, 16, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r < 0.01) continue;
    const k = 1 - 0.07 * (1 - Math.cos(8 * Math.atan2(z, x))) / 2;
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
});
/** Extruded shape (XY outline, depth along Z centred on z = 0) with a small bevel. */
const extrude = (key: string, shape: () => Shape, depth = 1, bevel = 0) => shared(`struct:ex:${key}`, () =>
  new ExtrudeGeometry(shape(), { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 }).translate(0, 0, -depth / 2));
/** Triangular prism: base width 1 on y = 0, apex at (0, 1), depth 1 along Z. */
const prismG = () => extrude('prism', () => { const t = new Shape(); t.moveTo(-0.5, 0); t.lineTo(0.5, 0); t.lineTo(0, 1); t.lineTo(-0.5, 0); return t; });
const yawQ = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a);

/**
 * East-Asian hip roof with concave slopes and upturned corners, `w` x `d` at the
 * eaves (y = 0) rising `h`. Returns the shingled top and the wooden underside.
 */
function curvedRoof(w: number, d: number, h: number, lift: number) {
  const n = 8;
  const at = (i: number, j: number, under: boolean) => {
    const u = (i / n) * 2 - 1, v = (j / n) * 2 - 1;
    // Hip roof: height falls off with the larger of the two (aspect-corrected) distances.
    const e = Math.min(w / 2 - Math.abs(u * w / 2), d / 2 - Math.abs(v * d / 2));
    const ridge = 1 - Math.min(1, e / (Math.min(w, d) / 2));
    const y = h * Math.pow(1 - ridge, 1.7) + lift * Math.pow(Math.abs(u * v), 3) - (under ? 0.06 + 0.1 * (1 - ridge) : 0);
    return [u * w / 2, y, v * d / 2];
  };
  const tris = (under: boolean) => {
    const out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = at(i, j, under), b = at(i + 1, j, under), c = at(i + 1, j + 1, under), e = at(i, j + 1, under);
      // Split each cell along the hip diagonal running through it.
      if ((i < n / 2) === (j < n / 2)) out.push([a, e, c], [a, c, b]); else out.push([a, e, b], [b, e, c]);
    }
    return out;
  };
  return { top: trianglesGeometry(tris(false)), under: trianglesGeometry(tris(true), true) };
}

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
 * Greek-style temple: three-stepped base, fluted columns with capitals on all
 * sides, a solid cella with a door, an entablature with triglyphs and a gabled
 * tiled roof with pediments front and back.
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
    for (let i = 0; i < 3; i++) {
      const g = 1.2 - i * 0.4;
      b.add(boxG(), marble, { position: [0, 0.1 + i * 0.2, 0], scale: [width + g, 0.2, depth + g], tint: 0.86 + i * 0.05, grime: i === 0 });
    }
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
      const t = this.rand(0.92, 1.05);
      b.add(flutedG(), marble, { position: [x, baseH + 0.12 + (colH - 0.34) / 2, z], scale: [colR, colH - 0.34, colR], tint: t, uv: 'cyl' });
      b.add(cylG(), marble, { position: [x, baseH + 0.06, z], scale: [colR * 1.3, 0.12, colR * 1.3], tint: t * 0.95 });
      b.add(coneG(), marble, { position: [x, baseH + colH - 0.17, z], scale: [colR * 1.25, -0.14, colR * 1.25], tint: t });
      b.add(boxG(), marble, { position: [x, baseH + colH - 0.05, z], scale: [colR * 2.5, 0.1, colR * 2.5], tint: t * 1.03 });
      this.addShape('cylinder', { radius: colR, height: colH }, [x, baseH + colH / 2, z], null, 'column');
    }
    const cw = width - 1.8, cd = depth - 1.8;
    b.add(boxG(), marble, { position: [0, baseH + colH / 2, -0.2], scale: [cw, colH, cd - 0.4], tint: 0.95 });
    const door = material(0x2a2018, true, true);
    b.add(boxG(), door, { position: [0, baseH + 1.1, -0.2 + (cd - 0.4) / 2 + 0.01], scale: [1.1, 2.2, 0.04] });
    b.add(boxG(), marble, { position: [0, baseH + 2.3, -0.2 + (cd - 0.4) / 2 + 0.04], scale: [1.5, 0.2, 0.08], tint: 1.05 });
    // Entablature: architrave, frieze with triglyphs, cornice.
    const ey = baseH + colH;
    b.add(boxG(), marble, { position: [0, ey + 0.15, 0], scale: [width, 0.3, depth], tint: 1.02 });
    b.add(boxG(), marble, { position: [0, ey + 0.45, 0], scale: [width - 0.04, 0.3, depth - 0.04], tint: 0.92 });
    const tri = material(0x8a8a90, true, true);
    for (const sz of [-1, 1]) for (let i = 0; i <= front * 2 - 2; i++) {
      const x = -width / 2 + 0.3 + ((width - 0.6) * i) / (front * 2 - 2);
      b.add(boxG(), tri, { position: [x, ey + 0.45, sz * (depth / 2 - 0.01)], scale: [0.16, 0.26, 0.04] });
    }
    for (const sx of [-1, 1]) for (let i = 0; i <= n * 2 - 2; i++) {
      const z = -depth / 2 + 0.3 + ((depth - 0.6) * i) / (n * 2 - 2);
      b.add(boxG(), tri, { position: [sx * (width / 2 - 0.01), ey + 0.45, z], scale: [0.04, 0.26, 0.16] });
    }
    b.add(boxG(), marble, { position: [0, ey + 0.66, 0], scale: [width + 0.4, 0.12, depth + 0.4], tint: 1.08 });
    // Gable roof: pediment prism (marble, recessed tympanum) and two tiled slopes along Z.
    const pedH = 1.1, ry = ey + 0.72, W = width + 0.4, half = W / 2;
    b.add(prismG(), marble, { position: [0, ry, 0], scale: [W - 0.1, pedH, depth + 0.3], tint: 1.04 });
    for (const sz of [-1, 1]) {
      b.add(prismG(), material(0xc8c0b0, true, true), { position: [0, ry + 0.12, sz * (depth / 2 + 0.16)], scale: [W - 0.9, pedH - 0.32, 0.04] });
      b.add(cylG(), material(0xc9a24a, true, true), { position: [0, ry + pedH * 0.4, sz * (depth / 2 + 0.19)], scale: [0.25, 0.04, 0.25], quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) });
      b.add(boxG(), marble, { position: [0, ry + pedH + 0.12, sz * (depth / 2 + 0.2)], scale: [0.25, 0.3, 0.1] });
    }
    const slope = Math.atan2(pedH, half), len = Math.hypot(pedH, half) + 0.25;
    for (const sx of [-1, 1]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -sx * slope);
      b.add(boxG(), roofMat, { position: [sx * (half / 2 + 0.08), ry + pedH / 2 + 0.08, 0], scale: [len, 0.12, depth + 0.7], quaternion: q });
    }
    b.add(cylG(), roofMat, { position: [0, ry + pedH + 0.06, 0], scale: [0.12, depth + 0.7, 0.12], quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), tint: 0.8 });
    b.build(this);
    this.addShape('box', { size: [width + 1.2, baseH, depth + 1.2] }, [0, baseH / 2, 0], null, 'base');
    this.addShape('box', { size: [cw, colH, cd - 0.4] }, [0, baseH + colH / 2, -0.2], null, 'cella');
    this.addShape('box', { size: [width + 0.4, 0.72 + pedH, depth + 0.4] }, [0, ey + (0.72 + pedH) / 2, 0], null, 'roof');
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
 * Portal: an arch of carved stone voussoirs with glowing runes and a keystone
 * gem, standing on a stepped dais between two pillars, filled with a swirling
 * translucent energy disc. The opening faces +Z.
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
    b.add(boxG(), stone, { position: [0, 0.12, 0], scale: [radius * 2.9, 0.24, 1.4], grime: true, tint: 0.85 });
    b.add(boxG(), stone, { position: [0, 0.32, 0], scale: [radius * 2.6, 0.16, 1.0], tint: 0.92 });
    b.add(boxG(), stone, { position: [0, 0.08, 0.95], scale: [radius * 1.4, 0.16, 0.5], tint: 0.88 });
    const rune = shared(`struct:portal:rune:${color}`, () => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3, flatShading: true, roughness: 1 }));
    for (const s of [-1, 1]) {
      const h = radius * 1.4 + this.rand(0, 0.5), x = s * (radius + 0.45);
      b.add(boxG(), stone, { position: [x, 0.4 + h / 2, 0], scale: [0.5, h, 0.5], tint: this.rand(0.9, 1.05) });
      b.add(boxG(), stone, { position: [x, 0.4 + h + 0.08, 0], scale: [0.62, 0.16, 0.62], tint: 1.05 });
      b.add(boxG(), stone, { position: [x, 0.48, 0], scale: [0.62, 0.16, 0.62], tint: 0.85 });
      b.add(pyrG(), stone, { position: [x, 0.4 + h + 0.3, 0], scale: [0.35, 0.3, 0.35], tint: 0.95 });
      for (let k = 0; k < 3; k++) b.add(boxG(), rune, { position: [x, 0.8 + k * h * 0.28, 0.255], scale: [0.12, 0.05 + 0.04 * (k % 2), 0.02], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), k * 0.6) });
      this.addShape('box', { size: [0.5, h, 0.5] }, [x, 0.4 + h / 2, 0], null, 'pillar');
    }
    // Arch of wedge-shaped stones around the opening; every other stone carries a rune.
    const blocks = 14, ri = radius * 1.0, ro = radius * 1.32;
    const wedge = shared('struct:portal:wedge', () => {
      const a = Math.PI / blocks * 0.92, sh = new Shape();
      sh.moveTo(Math.cos(-a) * 1, Math.sin(-a) * 1); sh.lineTo(Math.cos(-a) * 1.32, Math.sin(-a) * 1.32);
      sh.lineTo(Math.cos(a) * 1.32, Math.sin(a) * 1.32); sh.lineTo(Math.cos(a) * 1, Math.sin(a) * 1);
      return new ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }).translate(0, 0, -0.25);
    });
    for (let i = 0; i < blocks; i++) {
      const a = (i / blocks) * Math.PI * 2 + Math.PI / 2;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      const key = i === 0;
      b.add(wedge, stone, { position: [0, y0, 0], scale: [radius * (key ? 1.06 : 1), radius * (key ? 1.06 : 1), key ? 1.3 : 1], quaternion: q, tint: (i % 2 ? 0.88 : 1) * this.rand(0.95, 1.05) });
      if (i % 2 === 1) {
        const rm = (ri + ro) / 2;
        b.add(boxG(), rune, { position: [Math.cos(a) * rm, y0 + Math.sin(a) * rm, 0.27], scale: [0.14, 0.05, 0.02], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a + (i % 4 === 1 ? 0.5 : -0.5)) });
        b.add(boxG(), rune, { position: [Math.cos(a) * rm, y0 + Math.sin(a) * rm, -0.27], scale: [0.14, 0.05, 0.02], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a) });
      }
    }
    b.add(shared('struct:gem', () => new SphereGeometry(1, 4, 2)), rune, { position: [0, y0 + ro + 0.12, 0.34], scale: [0.16, 0.24, 0.1] });
    b.build(this);
    // Energy: a translucent disc, a brighter additive swirl and a glowing inner rim.
    const ringMat = shared(`struct:portal:ring:${color}`, () => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 1 }));
    const ring = this.addMesh(torusG(), ringMat, [0, y0, 0], [radius * 1.0, radius * 1.0, 0.6]);
    ring.userData.portalRing = true;
    ring.castShadow = false;
    const discMat = shared(`struct:portal:disc:${color}`, () => {
      const m = material(color, false).clone();
      m.emissive.set(color);
      m.emissiveIntensity = 0.9;
      m.transparent = true;
      m.opacity = 0.45;
      m.depthWrite = false;
      m.side = DoubleSide;
      return m;
    });
    const disc = shared('struct:portal:discGeo', () => {
      const g = new CylinderGeometry(1, 1, 0.04, 24);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const d = this.addMesh(disc, discMat, [0, y0, 0], [radius * 0.98, radius * 0.98, 1]);
    d.castShadow = false;
    const swirlMat = shared(`struct:portal:swirl:${color}`, () => new MeshStandardMaterial({
      color: 0xffffff, emissive: color, emissiveIntensity: 1.2, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, roughness: 1,
    }));
    const swirl = shared('struct:portal:swirlGeo', () => {
      // Three spiral arms winding into the centre.
      const pos: number[] = [];
      for (let arm = 0; arm < 3; arm++) {
        for (let k = 0; k < 24; k++) {
          const t0 = k / 24, t1 = (k + 1) / 24;
          const p = (t: number, w: number) => {
            const a = arm * (Math.PI * 2 / 3) + t * Math.PI * 2.2, r = 0.95 * (1 - t) + 0.04;
            const rr = r + w * 0.12 * (1 - t);
            return [Math.cos(a) * rr, Math.sin(a) * rr, 0.03];
          };
          const a0 = p(t0, -1), a1 = p(t0, 1), b0 = p(t1, -1), b1 = p(t1, 1);
          pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    });
    const sw = this.addMesh(swirl, swirlMat, [0, y0, 0], [radius, radius, 1]);
    sw.castShadow = false;
    sw.userData.portalSwirl = true;
    this.addShape('box', { size: [radius * 2.6, 0.4, 1.0] }, [0, 0.2, 0], null, 'base');
  }
}

/**
 * Ruins: crumbling walls with broken, mossy tops, stumps of fluted columns
 * (with fallen drums and capitals beside them), and half-buried rubble and
 * grass scattered around the origin.
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
    const rock = this.surface('rock', 0x9a9890);
    const b = new MergeBuilder();
    const ns = noiseSeed(this, 7);
    // Moss creeps over the top of every block and darkens the foot.
    const mossy = (top: number, k: number) => (x: number, y: number, z: number) => {
      const m = Math.max(0, Math.min(1, (y - (top - 0.18)) / 0.18)) * (0.6 + 0.4 * noise3(x * 2, y * 2, z * 2, ns));
      return [k * (1 - 0.35 * m), k * (1 - 0.05 * m), k * (1 - 0.45 * m)];
    };
    const walls = 1 + c * 2, cols = c * 2, rubble = 3 + c * 4;
    for (let i = 0; i < walls; i++) {
      const a = (i / walls) * Math.PI * 2 + this.rand(-0.3, 0.3);
      const d = R * this.rand(0.4, 0.9);
      const len = this.rand(1.6, 3.2), h = this.rand(0.7, 2.6), t = 0.4;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, yaw = -a + Math.PI / 2 + this.rand(-0.2, 0.2);
      const mat = i % 2 ? brick : stone, tint = this.rand(0.8, 1);
      // The wall is a row of columns of masonry broken off at falling heights.
      const k = Math.max(3, Math.round(len / 0.45)), seg = len / k, dir = [Math.cos(yaw), -Math.sin(yaw)];
      const high = this.random() < 0.5 ? 1 : -1;
      for (let j = 0; j < k; j++) {
        const f = (j + 0.5) / k, side = high > 0 ? f : 1 - f;
        const sh = h * Math.max(0.25, 1 - 0.75 * Math.pow(side, 1.3) + 0.15 * noise3(i * 3.1, j * 0.9, 0, ns));
        const off = (f - 0.5) * len;
        b.add(boxG(), mat, { position: [x + dir[0] * off, sh / 2, z + dir[1] * off], scale: [seg + 0.01, sh, t], yaw, grime: true, tint: mossy(sh, tint) });
        if (sh > h * 0.5 && j % 2 === 0) b.add(boxG(), mat, { position: [x + dir[0] * off, sh + 0.06, z + dir[1] * off], scale: [seg * 0.7, 0.12, t * 0.8], yaw: yaw + 0.1 * noise3(j, i, 2, ns), tint: mossy(sh + 0.12, tint * 0.95) });
      }
      // Coping stone and fallen blocks at the wall's foot.
      b.add(boxG(), mat, { position: [x + dir[0] * len * 0.55 * high + Math.sin(yaw) * 0.5, 0.12, z + dir[1] * len * 0.55 * high + Math.cos(yaw) * 0.5], scale: [0.45, 0.24, 0.35], yaw: yaw + 0.6, tint: mossy(0.24, tint * 0.9) });
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      this.addShape('box', { size: [len, h, t] }, [x, h / 2, z], q, 'wall');
    }
    for (let i = 0; i < cols; i++) {
      const a = this.rand(0, Math.PI * 2), d = R * this.rand(0.2, 1);
      const h = this.rand(0.5, 2.4), r = this.rand(0.25, 0.35);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, tint = this.rand(0.85, 1);
      b.add(cylG(), stone, { position: [x, 0.08, z], scale: [r * 1.35, 0.16, r * 1.35], grime: true, tint: tint * 0.9 });
      b.add(flutedG(), stone, { position: [x, 0.16 + (h - 0.16) / 2, z], scale: [r, h - 0.16, r], grime: true, tint: mossy(h, tint), uv: 'cyl' });
      // A fallen drum (or the capital) lying beside it.
      const fa = a + 1.3, fd = r * 2.6;
      if (i % 2 === 0) {
        b.add(flutedG(), stone, { position: [x + Math.cos(fa) * fd, r * 0.95, z + Math.sin(fa) * fd], scale: [r * 0.95, 0.9, r * 0.95], quaternion: new Quaternion().setFromEuler(new Euler(Math.PI / 2, fa, 0, 'YXZ')), tint: mossy(r * 1.9, tint * 0.95) });
      } else {
        b.add(boxG(), stone, { position: [x + Math.cos(fa) * fd, 0.08, z + Math.sin(fa) * fd], scale: [r * 2.4, 0.16, r * 2.4], yaw: fa, tint: mossy(0.16, tint) });
      }
      this.addShape('cylinder', { radius: r, height: h }, [x, h / 2, z], null, 'column');
    }
    for (let i = 0; i < rubble; i++) {
      const a = this.rand(0, Math.PI * 2), d = R * this.rand(0, 1.1);
      const s = this.rand(0.15, 0.45);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      // Half-sunk: the rubble rests on (and a little in) the ground.
      b.add(rockBlob(i % BLOB_VARIANTS, 1), rock, { position: [x, s * 0.2, z], scale: [s * 0.6, s * 0.5, s * 0.7], yaw: this.rand(0, 3), tint: mossy(s * 0.6, this.rand(0.7, 0.95)), detail: 3 });
      if (i < 4) this.addShape('box', { size: [s, s * 0.8, s * 1.2] }, [x, s / 2, z], null, 'rubble');
    }
    // Grass tufts growing between the stones.
    const grass = material(0x6f9a3c, true, true);
    for (let i = 0; i < 4 + c * 3; i++) {
      const a = i * 2.39996, d = R * (0.3 + 0.7 * ((i * 0.618) % 1));
      for (let k = 0; k < 5; k++) {
        b.add(coneG(), grass, { position: [Math.cos(a) * d + 0.08 * Math.cos(k * 1.3), 0.13, Math.sin(a) * d + 0.08 * Math.sin(k * 1.3)], scale: [0.03, 0.26 + 0.06 * (k % 3), 0.03], quaternion: new Quaternion().setFromEuler(new Euler(0.3 * Math.cos(k * 2), 0, 0.3 * Math.sin(k * 2))), tint: 0.85 + 0.05 * k });
      }
    }
    b.build(this);
  }
}

/**
 * Gravestone: an upright bevelled headstone (round-topped, cross or slab)
 * with a carved inscription, on a grassy grave mound with flowers, leaning
 * a little with age.
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
    const turf = this.surface('grass', 0x7aa04a);
    const b = new MergeBuilder();
    const ns = noiseSeed(this, 2);
    // Mound: a low grassy hump in front of the stone, with a few flowers.
    b.add(rockBlob(0, 1), turf, { position: [0, -0.03, 0.55], scale: [0.36, 0.12, 0.62], tint: (x, y, z) => 0.9 + 0.15 * noise3(x * 4, y * 4, z * 4, ns) });
    const petals = [0xf2f2f2, 0xe8c040, 0xd06080];
    for (let i = 0; i < 3; i++) {
      const fx = -0.22 + i * 0.2, fz = 0.45 + 0.3 * ((i * 0.618) % 1);
      b.add(cylG(), material(0x4a7a2a, true, true), { position: [fx, 0.15, fz], scale: [0.008, 0.14, 0.008] });
      b.add(sphG(), material(petals[i], true, true), { position: [fx, 0.23, fz], scale: [0.035, 0.02, 0.035] });
    }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), lean).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), lean * 0.6));
    const moss = (x: number, y: number, z: number) => {
      const m = Math.max(0, 1 - y / 0.25) * (0.6 + 0.4 * noise3(x * 6, y * 6, z * 6, ns));
      return [tint * (1 - 0.3 * m), tint * (1 - 0.05 * m), tint * (1 - 0.4 * m)];
    };
    const opt = { quaternion: q, tint: moss, grime: true, uv: 'world' };
    const carve = material(0x3a3a3a, true, true);
    const place = (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(q).toArray();
    let h = 0.9;
    if (this.style === 'cross') {
      const g = extrude('cross', () => {
        const c = new Shape();
        c.moveTo(-0.08, 0); c.lineTo(0.08, 0); c.lineTo(0.08, 0.58); c.lineTo(0.25, 0.58); c.lineTo(0.25, 0.72); c.lineTo(0.08, 0.72);
        c.lineTo(0.08, 0.9); c.lineTo(-0.08, 0.9); c.lineTo(-0.08, 0.72); c.lineTo(-0.25, 0.72); c.lineTo(-0.25, 0.58); c.lineTo(-0.08, 0.58); c.lineTo(-0.08, 0);
        return c;
      }, 0.1, 0.015);
      b.add(g, stone, opt);
      b.add(boxG(), stone, { position: [0, 0.06, 0], scale: [0.36, 0.12, 0.24], quaternion: q, tint: moss });
      b.add(torusG(), stone, { position: place(0, 0.65, 0), scale: [0.13, 0.13, 0.5], quaternion: q, tint: moss });
    } else if (this.style === 'round') {
      h = 0.85;
      const g = extrude('round', () => {
        const c = new Shape();
        c.moveTo(-0.3, 0); c.lineTo(0.3, 0); c.lineTo(0.3, 0.55); c.absarc(0, 0.55, 0.3, 0, Math.PI, false); c.lineTo(-0.3, 0);
        return c;
      }, 0.1, 0.02);
      b.add(g, stone, opt);
      b.add(sphG(), carve, { position: place(0, 0.62, 0.065), scale: [0.07, 0.07, 0.01], quaternion: q });
      for (let i = 0; i < 3; i++) b.add(boxG(), carve, { position: place(0, 0.45 - i * 0.09, 0.064), scale: [0.36 - i * 0.08, 0.025, 0.01], quaternion: q });
    } else {
      const g = extrude('slab', () => {
        const c = new Shape();
        c.moveTo(-0.3, 0); c.lineTo(0.3, 0); c.lineTo(0.3, 0.68); c.lineTo(0.18, 0.8); c.lineTo(-0.18, 0.8); c.lineTo(-0.3, 0.68); c.lineTo(-0.3, 0);
        return c;
      }, 0.12, 0.02);
      b.add(g, stone, opt);
      b.add(boxG(), carve, { position: place(0, 0.62, 0.074), scale: [0.08, 0.2, 0.01], quaternion: q });
      b.add(boxG(), carve, { position: place(0, 0.65, 0.074), scale: [0.18, 0.05, 0.01], quaternion: q });
      for (let i = 0; i < 2; i++) b.add(boxG(), carve, { position: place(0, 0.38 - i * 0.1, 0.074), scale: [0.34 - i * 0.1, 0.025, 0.01], quaternion: q });
    }
    b.build(this);
    this.addShape('box', { size: [0.6, h, 0.14] }, [0, h / 2, 0], null, 'stone');
  }
}

/**
 * Shrine: a small vermilion wooden shrine on a stone platform with front
 * steps: four posts on stone footings, tie beams, an altar with offerings and a
 * sacred rope, under a curved hip roof with upturned corners; two stone
 * lanterns flank the steps.
 *
 * Options: seed, lit (glowing lanterns, default true).
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
    b.add(boxG(), stone, { position: [0, 0.32, 0], scale: [2.7, 0.04, 2.7], tint: 1.05 });
    for (let i = 0; i < 2; i++) b.add(boxG(), stone, { position: [0, 0.05 + i * 0.1, 1.6 + 0.25 - i * 0.18], scale: [1.4, 0.1 + i * 0.1, 0.5 - i * 0.14], tint: 0.85 + i * 0.05 });
    const red = material(0xb8322a, true, true), dark = material(0x2a2220, true, true);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.add(cylG(), stone, { position: [x * 0.9, 0.4, z * 0.9], scale: [0.18, 0.16, 0.18], tint: 0.95 });
      b.add(cylG(), wood, { position: [x * 0.9, 1.3, z * 0.9], scale: [0.12, 2, 0.12], uv: 'cyl' });
      this.addShape('cylinder', { radius: 0.12, height: 2 }, [x * 0.9, 1.3, z * 0.9], null, 'post');
    }
    // Tie beams (nuki) and the head beam.
    for (const z of [-0.9, 0.9]) {
      b.add(boxG(), red, { position: [0, 2.05, z], scale: [2.1, 0.14, 0.1] });
      b.add(boxG(), red, { position: [0, 1.75, z], scale: [1.9, 0.08, 0.07], tint: 0.9 });
    }
    for (const x of [-0.9, 0.9]) b.add(boxG(), red, { position: [x, 2.05, 0], scale: [0.1, 0.14, 2.1] });
    b.add(boxG(), wood, { position: [0, 2.2, 0], scale: [2.3, 0.12, 2.3], tint: 0.85 });
    // Sacred rope across the front with paper streamers.
    const rope = material(0xd8c08a, true, true);
    for (let i = 0; i < 6; i++) {
      const t = i / 5, x = -0.8 + t * 1.6, y = 1.95 - 0.12 * Math.sin(Math.PI * t);
      b.add(sphG(), rope, { position: [x, y, 0.97], scale: [0.18, 0.06, 0.06], yaw: 0, tint: 0.95 + 0.05 * (i % 2) });
      if (i > 0 && i < 5) b.add(boxG(), material(0xf6f2ea, true, true), { position: [x, y - 0.15, 0.98], scale: [0.06, 0.2, 0.01], quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.15 * (i % 2 ? 1 : -1)) });
    }
    // Altar: plinth, offering box with a gold trim, a bowl, a glowing orb.
    b.add(boxG(), stone, { position: [0, 0.45, -0.55], scale: [1.3, 0.3, 0.8], tint: 0.95 });
    b.add(boxG(), wood, { position: [0, 0.85, -0.55], scale: [1.1, 0.5, 0.6], tint: 0.9 });
    b.add(boxG(), material(0xc9a24a, true, true), { position: [0, 1.11, -0.55], scale: [1.16, 0.04, 0.66] });
    b.add(boxG(), dark, { position: [0, 0.85, -0.24], scale: [0.6, 0.3, 0.02] });
    b.add(cylG(), material(0xd8d2c4, true, true), { position: [-0.3, 1.17, -0.5], scale: [0.12, 0.08, 0.12] });
    const lamp = lit ? this.ownSurface('plaster', 0xffc060, { glow: 0.9 }) : stone;
    b.add(sphG(), lamp, { position: [0.25, 1.24, -0.55], scale: [0.13, 0.13, 0.13] });
    // Roof: curved hip roof with a ridge and finial.
    const roof = curvedRoof(3.2, 3.2, 1.1 * this.rand(0.95, 1.1), 0.35);
    b.add(roof.top, roofMat, { position: [0, 2.28, 0], uv: 'world' });
    b.add(roof.under, wood, { position: [0, 2.28, 0], tint: 0.7, uv: 'world' });
    roof.top.dispose(); roof.under.dispose();
    b.add(cylG(), dark, { position: [0, 2.28 + 1.05, 0], scale: [0.1, 0.25, 0.1] });
    b.add(sphG(), material(0xc9a24a, true, true), { position: [0, 2.28 + 1.25, 0], scale: [0.09, 0.12, 0.09] });
    // Stone lanterns (toro) on either side of the steps.
    const glow = lit ? this.ownSurface('plaster', 0xffc060, { glow: 0.9 }) : stone;
    for (const s of [-1, 1]) {
      const x = s * 1.15, z = 2.0;
      b.add(boxG(), stone, { position: [x, 0.06, z], scale: [0.38, 0.12, 0.38], tint: 0.85, grime: true });
      b.add(cylG(), stone, { position: [x, 0.35, z], scale: [0.07, 0.5, 0.07], uv: 'cyl' });
      b.add(boxG(), stone, { position: [x, 0.63, z], scale: [0.3, 0.06, 0.3] });
      b.add(boxG(), glow, { position: [x, 0.77, z], scale: [0.2, 0.22, 0.2] });
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.add(boxG(), stone, { position: [x + cx * 0.1, 0.77, z + cz * 0.1], scale: [0.04, 0.22, 0.04] });
      b.add(pyrG(), stone, { position: [x, 0.98, z], scale: [0.32, 0.2, 0.32] });
      b.add(sphG(), stone, { position: [x, 1.1, z], scale: [0.05, 0.06, 0.05] });
    }
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
