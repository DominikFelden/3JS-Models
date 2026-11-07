import {
  ConeGeometry, CylinderGeometry, CircleGeometry, BoxGeometry,
  MeshStandardMaterial, Euler, Color, Quaternion, Vector3,
} from 'three';
import { WorldModel, MergeBuilder, shared, material } from '../WorldModel.ts';
import { pooledMaterial } from '../textures/pool.ts';
import {
  fbm3, noise3, hash3, noiseSeed, gridTriangles, trianglesGeometry, centroid, upness, rockBlob, shardGeometry, BLOB_VARIANTS,
} from './terrain.ts';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const sat = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const cone = () => shared('land:cone', () => new ConeGeometry(1, 1, 6, 1));
const cyl = () => shared('land:cyl', () => new CylinderGeometry(1, 1, 1, 6, 1));
const boxG = () => shared('land:box', () => new BoxGeometry(1, 1, 1));
const lilyPad = () => shared('land:lily', () => new CircleGeometry(1, 10, 0.4, TAU - 0.55).rotateX(-Math.PI / 2));
const petal = () => shared('land:petal', () => new ConeGeometry(1, 1, 5, 1));

const snowMat = (m) => m.surface('plaster', 0xf4f8fc);
const foamMat = () => material(0xf2fbff, true, true);
const waterMat = (m, opacity = 0.82) => pooledMaterial('water', m.variant('water'), {
  vertexColors: true, flatShading: false, roughness: 0.2, metalness: 0.05, opacity,
});
const ice = () => shared('land:ice', () => new MeshStandardMaterial({
  color: 0xb4e6f7, emissive: new Color(0x2a6a8a), emissiveIntensity: 0.25,
  transparent: true, opacity: 0.86, roughness: 0.08, metalness: 0.15, flatShading: true,
}));
const crystalMat = (color) => shared(`land:crystal:${color}`, () => new MeshStandardMaterial({
  color: new Color(color).lerp(new Color(0xffffff), 0.15), emissive: new Color(color), emissiveIntensity: 0.55,
  roughness: 0.18, metalness: 0.25, flatShading: true, vertexColors: true,
}));

/** Crystal shard with a vertex colour ramp: deep at the root, bright at the tip. */
const crystalShard = () => shared('land:crystal:shard', () => {
  const g = shardGeometry(6, 0.3, 0.86).clone();
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    const k = 0.55 + 0.75 * t * t;
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = Math.min(1.4, k * 1.05);
  }
  g.setAttribute('color', new (p.constructor as any)(col, 3));
  return g;
});

/** Orient every triangle so its normal points along `dir(centroid)`. */
function orient(tris, dir) {
  return tris.map((t) => {
    const [a, b, c] = t;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const d = dir(centroid(t));
    return n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0 ? [a, c, b] : t;
  });
}

/** Add the triangles to `b` (if any), one geometry per call. */
function addTris(b, tris, mat, opts: any = {}) {
  if (!tris.length) return;
  const g = trianglesGeometry(tris);
  b.add(g, mat, opts);
  g.dispose();
}

/** Disc grid (rings x segments) of radius `rOf(angle)`, heights from `yOf(x, z, ringT)`. */
function discTriangles(rings, segs, r0, rOf, yOf) {
  return gridTriangles(rings, segs, (i, j) => {
    const a = (j / segs) * TAU, t = r0 + (1 - r0) * (i / rings), r = rOf(a) * t;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    return [x, yOf(x, z, t), z];
  });
}

/** Scatter `n` shore rocks along a closed outline. */
function shoreRocks(m, b, rock, n, rOf, y = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + m.rand(-0.15, 0.15), d = rOf(a) * m.rand(0.98, 1.12), s = m.rand(0.15, 0.35);
    b.add(rockBlob(Math.floor(m.rand(0, BLOB_VARIANTS)), 1), rock, {
      position: [Math.cos(a) * d, y + s * 0.15, Math.sin(a) * d], scale: [s, s * 0.7, s * m.rand(0.8, 1.2)],
      yaw: m.rand(0, TAU), tint: m.rand(0.8, 1.1), detail: 3,
    });
  }
}

/** Reed clump: thin green stalks, some with brown cattail heads. */
function reeds(m, b, x, z, n = 7, h = 1) {
  const stalk = material(0x6f9a3e, true, true), head = material(0x6a4426, true, true);
  for (let i = 0; i < n; i++) {
    const a = m.rand(0, TAU), d = m.rand(0, 0.18), hh = h * m.rand(0.6, 1.1);
    const lean = new Quaternion().setFromEuler(new Euler(m.rand(-0.15, 0.15), 0, m.rand(-0.15, 0.15)));
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const up = new Vector3(0, 1, 0).applyQuaternion(lean);
    b.add(cone(), stalk, { position: [px + up.x * hh / 2, hh / 2, pz + up.z * hh / 2], scale: [0.025, hh, 0.025], quaternion: lean, tint: m.rand(0.85, 1.1) });
    if (i % 2 === 0) {
      const t = hh * 0.78;
      b.add(cyl(), head, { position: [px + up.x * t, t, pz + up.z * t], scale: [0.035, 0.16 * h, 0.035], quaternion: lean });
    }
  }
}

/**
 * Mountain: a craggy massif of `peaks` summits (tallest in the middle) built
 * as one displaced height field: ridges and gullies run down the slopes, grass
 * covers the gentle foothills, bare rock the steep faces and, optionally,
 * snow with a ragged edge the summits. Options: height (12), radius (8),
 * peaks (1-5, default 3), snow (true). Colliders: one cone per peak ('peak').
 */
export class Mountain extends WorldModel {
  constructor(options: any = {}) {
    super('Mountain', options);
    const height = clamp(options.height, 1, 200, 12);
    const radius = clamp(options.radius, 1, 200, 8);
    const peaks = WorldModel.clampInt(options.peaks, 1, 5, 3);
    const snow = (options.snow ?? true) && height > 3;
    const ns = noiseSeed(this);
    const rock = this.surface('rock'), grass = this.surface('grass'), snowM = snowMat(this);
    const P = [];
    let reach = radius;
    for (let i = 0; i < peaks; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.35, 0.6) * radius;
      const r = radius * (main ? 1 : this.rand(0.45, 0.7));
      const h = height * (main ? 1 : this.rand(0.5, 0.8));
      const x = Math.cos(a) * d, z = Math.sin(a) * d, ridges = 4 + Math.floor(this.rand(0, 4));
      P.push({ x, z, r, h, ridges, i });
      reach = Math.max(reach, d + r);
      this.addShape('cone', { radius: r, height: h }, [x, h / 2, z], null, 'peak');
    }
    const R = reach * 1.04;
    const f = 1 / Math.max(1, radius * 0.35);
    const heightAt = (x, z) => {
      let H = 0;
      for (const p of P) {
        const dx = x - p.x, dz = z - p.z, ang = Math.atan2(dz, dx);
        const wob = 1 + 0.6 * (fbm3(Math.cos(ang) * 1.8 + p.i * 5, Math.sin(ang) * 1.8, 0, ns, 2) - 0.5);
        const t = Math.hypot(dx, dz) / (p.r * wob);
        if (t >= 1) continue;
        const prof = (1 - t) ** (p.i ? 1.5 : 1.9) * (1 + 0.6 * t * (1 - t));
        const ridge = 0.5 + 0.5 * Math.cos(ang * p.ridges + 2.5 * fbm3(x * f, z * f, p.i, ns + 3, 2));
        const h = p.h * prof * (1 - 0.32 * ridge * Math.min(1, t * 2.5) * (1 - t) ** 0.7);
        const k = height * 0.06; // smooth union, so the summits grow into one massif
        H = H > 0 ? Math.max(H, h) + Math.max(0, k - Math.abs(H - h)) ** 2 / (4 * k) : h;
      }
      const bumps = (fbm3(x * f * 2, 0, z * f * 2, ns + 7, 3) - 0.5) * height * 0.08;
      return H > 0 ? Math.max(0, H + bumps * sstep(0, height * 0.1, H)) : 0;
    };
    const rings = 18, segs = 56;
    let tris = gridTriangles(rings, segs, (i, j) => {
      const t = i / rings, a = (j / segs) * TAU + (i % 2) * (0.5 / segs) * TAU;
      const jr = i === 0 || i === rings ? 0 : (hash3(i, j, 1, ns) - 0.5) * 0.35 * (R / rings);
      const r = t * R + jr, x = Math.cos(a) * r, z = Math.sin(a) * r;
      return [x, i === rings ? -0.05 : heightAt(x, z), z];
    });
    tris = orient(tris, () => [0, 1, 0]);
    const buckets = { rock: [], grass: [], snow: [] };
    for (const t of tris) {
      const c = centroid(t), u = upness(t), n = fbm3(c[0] * f * 1.5, c[1] * f, c[2] * f * 1.5, ns + 11, 2);
      const snowLine = height * (0.58 + 0.22 * (n - 0.5)) - (u - 0.5) * 0.12 * height;
      const grassLine = height * (0.1 + 0.2 * n) + (u - 0.6) * 0.15 * height;
      if (snow && c[1] > snowLine) buckets.snow.push(t);
      else if (c[1] < grassLine && u > 0.35) buckets.grass.push(t);
      else buckets.rock.push(t);
    }
    const b = new MergeBuilder();
    const rockTint = (x, y, z) => {
      const band = 0.06 * Math.sin(y * 2.2 / Math.max(1, height * 0.1) + 3 * noise3(x * f, y * f, z * f, ns + 5));
      const k = 0.78 + 0.28 * sat(y / height) + band;
      return [k, k * 0.98, k * 0.96];
    };
    addTris(b, buckets.rock, rock, { tint: rockTint, detail: 1.3 / Math.max(1.3, height * 0.22) });
    addTris(b, buckets.grass, grass, { tint: (x, y) => 0.85 + 0.25 * sat(1 - y / (height * 0.3)), detail: 2.2 / Math.max(2.2, height * 0.3) });
    addTris(b, buckets.snow, snowM, { tint: (x, y) => 0.92 + 0.1 * sat(y / height), detail: 2.5 / Math.max(2.5, height * 0.25) });
    // Fallen boulders around the foot.
    const nb = 3 + Math.floor(this.rand(0, 4));
    for (let i = 0; i < nb; i++) {
      const a = this.rand(0, TAU), d = R * this.rand(0.75, 1.0), s = Math.max(0.3, height * this.rand(0.03, 0.07));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(rockBlob(i, 1), rock, { position: [x, heightAt(x, z) + s * 0.15, z], scale: [s, s * 0.75, s], yaw: this.rand(0, TAU), tint: this.rand(0.8, 1.05), detail: 1.5 });
    }
    b.build(this);
  }
}

/**
 * Hill: a wide, low, lumpy grassy mound with a few rocks breaking through.
 * Options: radius (4), height (1.5).
 * Collider: convex hull of the upper half-ellipsoid ('hill').
 */
export class Hill extends WorldModel {
  constructor(options: any = {}) {
    super('Hill', options);
    const radius = clamp(options.radius, 0.5, 200, 4);
    const height = clamp(options.height, 0.2, 100, 1.5);
    const grass = this.surface('grass'), rock = this.surface('rock');
    const ns = noiseSeed(this);
    const yaw = this.rand(0, TAU);
    const lumps = [];
    for (let i = 0; i < 2; i++) {
      const a = this.rand(0, TAU), d = this.rand(0.3, 0.5) * radius, s = this.rand(0.35, 0.55);
      lumps.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: radius * s, h: height * s * 1.1 });
    }
    const bell = (t) => (t >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t));
    const rOf = (a) => radius * (1 + 0.12 * (fbm3(Math.cos(a + yaw) * 1.3, Math.sin(a + yaw) * 1.3, 0, ns, 2) - 0.5) * 2);
    const yOf = (x, z) => {
      const a = Math.atan2(z, x), t = Math.hypot(x, z) / rOf(a);
      let h = height * bell(t) ** 0.85;
      for (const l of lumps) h = Math.max(h, l.h * bell(Math.hypot(x - l.x, z - l.z) / l.r) * 0.9 + h * 0.35);
      const f = 2.5 / radius;
      return Math.min(height, h) * (0.92 + 0.16 * fbm3(x * f, 0, z * f, ns + 1, 2));
    };
    const b = new MergeBuilder();
    const tris = orient(discTriangles(10, 40, 0, (a) => rOf(a) * 1.02, (x, z, t) => (t >= 1 ? -0.03 : yOf(x, z))), () => [0, 1, 0]);
    addTris(b, tris, grass, { tint: (x, y) => 0.88 + 0.2 * sat(y / height), detail: 1 });
    const nr = 2 + Math.floor(this.rand(0, 3));
    for (let i = 0; i < nr; i++) {
      const a = this.rand(0, TAU), d = radius * this.rand(0.2, 0.75), s = Math.min(height * 0.5, radius * 0.12) * this.rand(0.7, 1.3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(rockBlob(Math.floor(this.rand(0, BLOB_VARIANTS)), 1), rock, {
        position: [x, yOf(x, z) - s * 0.15, z], scale: [s, s * 0.7, s * 1.2], yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.05), detail: 2,
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
 * Displaced rock slab of (w, h, d) standing on y = 0: strata ledges on the
 * front (+Z), noisy edges, grass on the flat tops and ledges. `carve(x, y, z)`
 * may return [dx, dy, dz] to cut extra features (a waterfall channel).
 */
function rockSlab(m, b, w, h, d, ns, carve = null) {
  const rock = m.surface('rock'), grass = m.surface('grass');
  const g = new BoxGeometry(w, h, d, Math.max(4, Math.round(w / 0.5)), Math.max(4, Math.round(h / 0.4)), Math.max(2, Math.round(d / 0.6))).toNonIndexed();
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const layers = Math.max(2, Math.round(h / 1.3)), L = h / layers;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = (k) => fbm3(x * 0.45, y * 0.45, z * 0.45, ns + k, 3) - 0.5;
    const lt = y / L + 0.6 * n(1), layer = Math.floor(lt), fr = lt - layer;
    const ledge = (0.25 + 0.35 * hash3(layer, 0, 0, ns)) * (0.35 + 0.65 * sstep(0, 0.4, fr)) * Math.min(0.45, d * 0.25);
    const ex = (2 * x) / w, ez = (2 * z) / d;
    const out = y > 0.01 && y < h - 0.01 ? 1 : 0.4;
    let dx = n(2) * 0.6 + ex * ledge * 0.6 * out, dy = y > 0.01 ? n(3) * Math.min(0.6, h * 0.12) : 0, dz = n(4) * d * 0.35 + Math.max(0, ez) * ledge * out;
    if (carve) { const c = carve(x, y, z); dx += c[0]; dy += c[1]; dz += c[2]; }
    p.setXYZ(i, x + dx, y + dy, z + dz);
  }
  const tris = [];
  for (let i = 0; i < p.count; i += 3) tris.push([0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]));
  g.dispose();
  const rockT = [], grassT = [];
  for (const t of tris) {
    const u = upness(t), c = centroid(t);
    if (u < -0.5 && c[1] < 0.2) continue; // bottom face, never seen
    (u > 0.62 && c[1] > Math.min(0.5, h * 0.2) ? grassT : rockT).push(t);
  }
  const strata = (x, y, z) => {
    const k = 0.82 + 0.2 * hash3(Math.floor(y / L + 0.6 * (fbm3(x * 0.45, y * 0.45, z * 0.45, ns + 1, 3) - 0.5)), 3, 0, ns) + 0.08 * sat(y / h);
    return [k, k * 0.97, k * 0.93];
  };
  addTris(b, rockT, rock, { tint: strata, detail: 0.8 });
  addTris(b, grassT, grass, { tint: 1.05, detail: 1 });
}

/**
 * Cliff: a layered rock wall facing +Z with overhanging strata ledges, grass
 * on top and on the ledges and boulders at its foot. Options: width (6),
 * height (5), depth (2). Collider: one box ('cliff').
 */
export class Cliff extends WorldModel {
  constructor(options: any = {}) {
    super('Cliff', options);
    const width = clamp(options.width, 1, 100, 6);
    const height = clamp(options.height, 1, 100, 5);
    const depth = clamp(options.depth, 0.5, 50, 2);
    const rock = this.surface('rock');
    const b = new MergeBuilder();
    rockSlab(this, b, width, height, depth, noiseSeed(this));
    const n = Math.max(3, Math.round(width / 1.2));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * width * 0.95;
      const s = this.rand(0.5, 0.9) * Math.min(1.2, (width / n) * 0.8, height * 0.25), z = depth * this.rand(0.5, 0.75);
      b.add(rockBlob(i, 1), rock, {
        position: [x, s * 0.2, z], scale: [s, s * this.rand(0.6, 0.9), s * 0.8], yaw: this.rand(0, TAU), tint: this.rand(0.8, 1.05), detail: 2,
      });
    }
    b.build(this);
    this.addShape('box', { size: [width, height, depth] }, [0, height / 2, 0], null, 'cliff');
  }
}

/**
 * CaveEntrance: a rocky, grass-topped mound with a ragged arched opening
 * facing +Z; the tunnel fades to black. Options: width (3, opening width),
 * height (2.5, opening height). Colliders: two side walls, a lintel above the
 * opening and a back wall, so the opening is walkable.
 */
export class CaveEntrance extends WorldModel {
  constructor(options: any = {}) {
    super('CaveEntrance', options);
    const width = clamp(options.width, 1, 30, 3);
    const height = clamp(options.height, 1, 30, 2.5);
    const rock = this.surface('rock'), grass = this.surface('grass');
    const side = width * 0.8, top = height * 0.6, depth = Math.max(3, width * 1.2), total = height + top;
    const ns = noiseSeed(this);
    const Wo = width / 2 + side, Ho = total, zf = depth / 2, zb = -depth * 0.05, back = depth * 0.75;
    const amp = Math.min(width, height) * 0.12;
    const disp = ([x, y, z], k = 1) => {
      const f = 1.2 / Math.min(width, height);
      const n = (s) => (fbm3(x * f, y * f, z * f, ns + s, 3) - 0.5) * 2 * amp * k;
      return [x + n(1), y > 0.01 ? Math.max(0, y + n(2)) : 0, z + n(3)];
    };
    // Arch outline: squared-off ellipse.
    const inner = (a, s = 1) => [(width / 2) * Math.cos(a) * s, height * Math.sin(a) ** 0.55 * s, zf];
    const K = 7, S = 28, T = 5;
    const front = gridTriangles(K, S, (k, j) => {
      const a = (j / S) * Math.PI, s = k / K, i0 = inner(a);
      const o = [Wo * Math.cos(a), Ho * Math.sin(a), zb];
      const e = s ** 1.3;
      return disp([i0[0] + (o[0] - i0[0]) * e, i0[1] + (o[1] - i0[1]) * e + Math.sin(a) * Math.sin(Math.PI * s) * top * 0.25, zf + (zb - zf) * s ** 1.8], 0.5 + 0.5 * s);
    });
    const dome = gridTriangles(T, S, (k, j) => {
      const a = (j / S) * Math.PI, bt = (k / T) * Math.PI / 2;
      return disp([Wo * Math.cos(a) * Math.cos(bt), Ho * Math.sin(a) * Math.cos(bt), zb - back * Math.sin(bt)]);
    });
    const shell = [
      ...orient(front, (c) => [c[0], c[1] - height * 0.3, c[2] + depth]),
      ...orient(dome, (c) => [c[0], c[1], c[2] - zb]),
    ];
    const rockT = [], grassT = [];
    for (const t of shell) (upness(t) > 0.55 && centroid(t)[1] > total * 0.5 ? grassT : rockT).push(t);
    const b = new MergeBuilder();
    addTris(b, rockT, rock, { tint: (x, y, z) => 0.8 + 0.25 * sat(y / total) + 0.05 * Math.sin(y * 3), detail: 1.2 });
    addTris(b, grassT, grass, { tint: 1.05 });
    // Tunnel: the arch outline swept backwards, fading into darkness.
    const zEnd = -depth / 2 + 0.2, D = 4;
    const tunnel = gridTriangles(D, S, (k, j) => {
      const a = (j / S) * Math.PI, s = k / D, i0 = inner(a, 1 - 0.25 * s);
      return disp([i0[0], i0[1], zf + (zEnd - zf) * s], 0.5 * (1 - s));
    });
    const dark = (x, y, z) => 0.06 + 0.8 * sstep(zEnd, zf, z) ** 2;
    addTris(b, orient(tunnel, (c) => [-c[0], height * 0.4 - c[1], 0]), rock, { tint: dark, detail: 1.2 });
    const floor = gridTriangles(D, 1, (k, j) => [(j ? 1 : -1) * (width / 2) * (1 - 0.25 * k / D), 0.01, zf + (zEnd - zf) * (k / D)]);
    addTris(b, orient(floor, () => [0, 1, 0]), rock, { tint: (x, y, z) => dark(x, y, z) * 0.8, detail: 1.2 });
    b.add(boxG(), material(0x050505, true), { position: [0, height * 0.4, zEnd], scale: [width, height, 0.05] });
    // Stalactites hanging from the arch, boulders flanking the mouth.
    for (let i = 0; i < 4; i++) {
      const x = (i / 3 - 0.5) * width * 0.55 + this.rand(-0.1, 0.1), l = height * this.rand(0.08, 0.18);
      const y = height * Math.sin(Math.acos(Math.min(0.99, Math.abs(x) / (width / 2)))) ** 0.55;
      b.add(cone(), rock, { position: [x, y - l / 2 + 0.05, zf - 0.25], scale: [l * 0.25, l, l * 0.25], quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI), tint: 0.7 });
    }
    for (const s of [-1, 1]) {
      const sz = Math.min(width, height) * this.rand(0.25, 0.4);
      b.add(rockBlob(s > 0 ? 1 : 4, 1), rock, {
        position: [s * (width / 2 + sz * 0.6), sz * 0.25, zf + sz * 0.3], scale: [sz, sz * 0.8, sz], yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.05), detail: 2,
      });
    }
    b.build(this);
    for (const s of [-1, 1]) this.addShape('box', { size: [side, total, depth] }, [s * (width / 2 + side / 2), total / 2, 0], null, 'wall');
    this.addShape('box', { size: [width, top, depth] }, [0, height + top / 2, 0], null, 'lintel');
    this.addShape('box', { size: [width, height, 0.2] }, [0, height / 2, -depth / 2 + 0.1], null, 'back');
  }
}

/** Irregular pond basin, water surface and grassy bank around (0, 0, cz). */
function pondParts(m, b, radius, ns, { cz = 0, bank = 0.35, water = null } = {}) {
  const rOf = (a) => radius * (1 + 0.14 * (fbm3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, cz, ns, 2) - 0.5) * 2);
  const shift = (tris) => tris.map((t) => t.map(([x, y, z]) => [x, y, z + cz]));
  const segs = Math.max(20, Math.min(48, Math.round(radius * 10)));
  const basin = orient(discTriangles(3, segs, 0, rOf, (x, z, t) => -0.35 * Math.min(1, radius) * (1 - t * t) + 0.02), () => [0, 1, 0]);
  addTris(b, shift(basin), material(0x2f4f42, true, true), { tint: (x, y) => 0.55 + 1.2 * sat(y + 0.35) });
  addTris(b, shift(orient(discTriangles(2, segs, 0, (a) => rOf(a) * 1.02, () => 0.06), () => [0, 1, 0])), water ?? waterMat(m), {
    tint: (x, y, z) => { const t = Math.hypot(x, z - cz) / radius; return 0.85 + 0.35 * sstep(0.7, 1.05, t); },
  });
  const ring = gridTriangles(2, segs, (i, j) => {
    const a = (j / segs) * TAU, r = rOf(a) * (0.97 + (bank + 0.03 * Math.sin(a * 3)) * (i / 2));
    const y = i === 0 ? 0.03 : i === 1 ? 0.1 : -0.02;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const mud = [], green = [];
  ring.forEach((t, k) => (k < 2 * segs ? mud : green).push(t));
  addTris(b, shift(orient(mud, () => [0, 1, 0])), m.surface('rock'), { tint: [1.05, 0.92, 0.75], detail: 3 });
  addTris(b, shift(orient(green, () => [0, 1, 0])), m.surface('grass'), { tint: 1 });
  return rOf;
}

/**
 * Pond: an irregular pool of water in a grassy bank, with shore rocks, lily
 * pads (some flowering) and a clump of reeds. Options: radius (3),
 * rocks (8, number of shore rocks, 0-24). Collider: thin cylinder ('water');
 * shore rocks are not colliders.
 */
export class Pond extends WorldModel {
  constructor(options: any = {}) {
    super('Pond', options);
    const radius = clamp(options.radius, 0.5, 100, 3);
    const rocks = WorldModel.clampInt(options.rocks, 0, 24, 8);
    const rock = this.surface('rock');
    const b = new MergeBuilder();
    const rOf = pondParts(this, b, radius, noiseSeed(this));
    shoreRocks(this, b, rock, rocks, rOf, 0.02);
    const pad = material(0x4f8f3a, true, true), bloom = material(0xf0a8c8, true, true);
    const pads = Math.max(1, Math.round(radius * 1.5));
    for (let i = 0; i < pads; i++) {
      const a = this.rand(0, TAU), d = rOf(a) * this.rand(0.3, 0.8), s = Math.min(0.35, radius * 0.1) * this.rand(0.6, 1.2);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.add(lilyPad(), pad, { position: [x, 0.075, z], scale: [s, 1, s], yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.15) });
      if (this.random() < 0.35) {
        for (let k = 0; k < 5; k++) {
          const q = new Quaternion().setFromEuler(new Euler(0.7, (k / 5) * TAU, 0, 'YXZ'));
          const o = new Vector3(0, 0.5, 0).applyQuaternion(q).multiplyScalar(s * 0.4);
          b.add(petal(), bloom, { position: [x + o.x, 0.09 + o.y, z + o.z], scale: [s * 0.14, s * 0.4, s * 0.06], quaternion: q });
        }
      }
    }
    const ra = this.rand(0, TAU), rr = rOf(ra) * 0.95;
    reeds(this, b, Math.cos(ra) * rr, Math.sin(ra) * rr, 9, Math.min(1.2, 0.5 + radius * 0.15));
    b.build(this);
    this.addShape('cylinder', { radius, height: 0.08 }, [0, 0.04, 0], null, 'water');
  }
}

/**
 * Waterfall: a layered rock wall facing +Z; a stream runs in a groove over the
 * top, falls as a bulging sheet and churns into foam in an irregular pool.
 * Options: height (5), width (1.5, width of the water sheet).
 * Colliders: the wall ('cliff') and the pool ('water').
 */
export class Waterfall extends WorldModel {
  constructor(options: any = {}) {
    super('Waterfall', options);
    const height = clamp(options.height, 1, 100, 5);
    const width = clamp(options.width, 0.3, 30, 1.5);
    const rock = this.surface('rock');
    const wallW = width + 3, wallD = 2, pool = Math.max(1.2, width * 1.1), pz = wallD / 2 + pool * 0.8;
    const ns = noiseSeed(this);
    const b = new MergeBuilder();
    const hw = width / 2 + 0.15;
    // Groove for the water: pushed back on the front, notched on top.
    rockSlab(this, b, wallW, height, wallD, ns, (x, y, z) => {
      const inCh = 1 - sstep(hw * 0.7, hw + 0.25, Math.abs(x));
      return [0, y > height - 0.05 ? -0.35 * inCh : 0, z > wallD / 2 - 0.05 ? -0.45 * inCh : 0];
    });
    for (const s of [-1, 1]) {
      const h = height * this.rand(0.35, 0.55), sz = Math.min(1.1, wallW * 0.15);
      b.add(rockBlob(s > 0 ? 2 : 5, 1), rock, {
        position: [s * (width / 2 + 0.55), h * 0.35, wallD * 0.45], scale: [sz, h * 0.6, sz * 0.8], yaw: this.rand(0, TAU), tint: this.rand(0.85, 1.05), detail: 2,
      });
    }
    const water = waterMat(this, 0.86);
    // Stream on top and falling sheet: one strip, u runs along the flow so glints streak downwards.
    const top = height - 0.22, lip = wallD / 2 - 0.3;
    const path = [];
    for (let i = 0; i <= 3; i++) path.push([0, top, -wallD / 2 + 0.1 + (i / 3) * (lip + wallD / 2 - 0.1)]);
    const fallN = Math.max(6, Math.round(height / 0.5));
    for (let i = 1; i <= fallN; i++) {
      const t = i / fallN, y = top - t * (top - 0.05);
      path.push([0, y, lip + 0.35 * Math.sin(Math.min(1, t * 3) * Math.PI / 2) + 0.25 * t]);
    }
    const tris = gridTriangles(path.length - 1, 4, (i, j) => {
      const t = i / (path.length - 1), w = width * (1 + 0.15 * t);
      const x = (j / 4 - 0.5) * w, wave = 0.04 * Math.sin(j * 2.1 + i * 1.3);
      return [x, path[i][1] + (i <= 3 ? Math.abs(x) * 0.08 : 0), path[i][2] + wave];
    });
    const sheet = trianglesGeometry(orient(tris, (c) => (c[1] > top - 0.05 ? [0, 1, 0.2] : [0, 0, 1])));
    const sp = sheet.attributes.position, uv = new Float32Array(sp.count * 2);
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i), z = sp.getZ(i);
      uv[i * 2] = ((z < lip ? z + wallD / 2 : lip + wallD / 2 + (top - y)) / 3);
      uv[i * 2 + 1] = sp.getX(i) / 3;
    }
    sheet.setAttribute('uv', new (sp.constructor as any)(uv, 2));
    b.add(sheet, water, { uv: 'native', tint: (x, y) => 0.95 + 0.4 * sstep(height * 0.35, 0, y) + 0.3 * sstep(top - 0.6, top, y) });
    sheet.dispose();
    // Pool, foam where the water lands, spray at the lip.
    pondParts(this, b, pool, ns + 9, { cz: pz, bank: 0.3, water });
    const foam = foamMat();
    const nf = 5 + Math.round(width * 2);
    for (let i = 0; i < nf; i++) {
      const x = this.rand(-0.6, 0.6) * width, s = this.rand(0.18, 0.35) * Math.min(1.5, width);
      b.add(rockBlob(i, 1, false), foam, { position: [x, 0.08, lip + 0.6 + this.rand(-0.1, 0.4)], scale: [s, s * 0.55, s], yaw: this.rand(0, TAU), tint: this.rand(0.9, 1.05) });
    }
    for (let i = 0; i < 3; i++) {
      b.add(rockBlob(i + 2, 1, false), foam, { position: [(i - 1) * width * 0.3, top + 0.02, lip + 0.12], scale: [width * 0.18, 0.06, 0.15], tint: 1 });
    }
    shoreRocks(this, { add: (g, m, o) => { o.position[2] += pz; b.add(g, m, o); } }, rock, 6, (a) => pool * (1 + 0.14 * (fbm3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, pz, ns + 9, 2) - 0.5) * 2), 0.02);
    b.build(this);
    this.addShape('box', { size: [wallW, height, wallD] }, [0, height / 2, 0], null, 'cliff');
    this.addShape('cylinder', { radius: pool, height: 0.08 }, [0, 0.04, pz], null, 'water');
  }
}

/**
 * Crystal: a glowing cluster of pointed hexagonal crystals growing out of a
 * rock, with small shards around it. Options: height (2), count (5, crystals
 * 1-12), color (0x7a5cff). Every crystal is its own mesh (`model.crystals`,
 * e.g. to pulse or pick them); the rock base is merged.
 * Collider: one cylinder around the cluster ('cluster').
 */
export class Crystal extends WorldModel {
  declare crystals: any;
  constructor(options: any = {}) {
    super('Crystal', options);
    const height = clamp(options.height, 0.2, 50, 2);
    const count = WorldModel.clampInt(options.count, 1, 12, 5);
    const color = options.color ?? 0x7a5cff;
    const mat = crystalMat(color);
    const g = crystalShard();
    this.crystals = [];
    let reach = 0;
    for (let i = 0; i < count; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.1, 0.35) * height, h = height * (main ? 1 : this.rand(0.35, 0.8));
      const r = h * this.rand(0.12, 0.2), lean = main ? 0.05 : this.rand(0.2, 0.55);
      const m = this.addMesh(g, mat, [Math.cos(a) * d * 0.8, -h * 0.06, Math.sin(a) * d * 0.8], [r, h, r]);
      m.quaternion.setFromEuler(new Euler(Math.sin(a) * lean, this.rand(0, TAU), -Math.cos(a) * lean, 'YXZ'));
      this.crystals.push(m);
      reach = Math.max(reach, d + r);
    }
    const b = new MergeBuilder();
    const rock = this.surface('rock');
    const base = Math.max(0.15, height * 0.22);
    b.add(rockBlob(this.seed % BLOB_VARIANTS, 1), rock, { position: [0, base * 0.1, 0], scale: [base * 1.6, base * 0.7, base * 1.4], yaw: this.rand(0, TAU), tint: 0.75, detail: 3 });
    for (let i = 0; i < 4; i++) {
      const a = this.rand(0, TAU), d = base * this.rand(1.2, 1.9), s = base * this.rand(0.25, 0.45);
      b.add(rockBlob(i + 1, 1), rock, { position: [Math.cos(a) * d, s * 0.1, Math.sin(a) * d], scale: [s, s * 0.7, s], yaw: this.rand(0, TAU), tint: 0.8, detail: 3 });
    }
    const n = 3 + Math.floor(this.rand(0, 4));
    for (let i = 0; i < n; i++) {
      const a = this.rand(0, TAU), d = base * this.rand(1.0, 2.0), h = height * this.rand(0.08, 0.2);
      const q = new Quaternion().setFromEuler(new Euler(Math.sin(a) * 0.6, this.rand(0, TAU), -Math.cos(a) * 0.6, 'YXZ'));
      b.add(crystalShard(), mat, {
        position: [Math.cos(a) * d, -h * 0.1, Math.sin(a) * d], scale: [h * 0.2, h, h * 0.2], quaternion: q,
        tint: (x, y) => 0.55 + 0.75 * sat(y / h) ** 2,
      });
    }
    b.build(this);
    this.addShape('cylinder', { radius: Math.max(0.2, reach, base * 1.8), height }, [0, height / 2, 0], null, 'cluster');
  }
}

/**
 * IceSpire: jagged, faceted translucent ice shards (a tall centre one) on a
 * drift of snow with loose ice chunks. Options: height (4), spikes (4, total
 * 1-8). Colliders: one cone per spike ('spike').
 */
export class IceSpire extends WorldModel {
  constructor(options: any = {}) {
    super('IceSpire', options);
    const height = clamp(options.height, 0.5, 100, 4);
    const spikes = WorldModel.clampInt(options.spikes, 1, 8, 4);
    const tall = shardGeometry(5, 0.45, 0.62), stub = shardGeometry(4, 0.35, 0.75);
    const b = new MergeBuilder();
    let reach = 0;
    for (let i = 0; i < spikes; i++) {
      const main = i === 0;
      const a = this.rand(0, TAU), d = main ? 0 : this.rand(0.1, 0.3) * height;
      const h = height * (main ? 1 : this.rand(0.35, 0.75)), r = h * this.rand(0.1, 0.16);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const lean = main ? 0.04 : this.rand(0.12, 0.35);
      const q = new Quaternion().setFromEuler(new Euler(Math.sin(a) * lean, this.rand(0, TAU), -Math.cos(a) * lean, 'YXZ'));
      b.add(i % 3 === 2 ? stub : tall, ice(), { position: [x, -h * 0.05, z], scale: [r * 1.3, h, r * 1.3], quaternion: q });
      this.addShape('cone', { radius: r, height: h }, [x, h / 2, z], null, 'spike');
      reach = Math.max(reach, d + r * 1.3);
    }
    for (let i = 0; i < 5; i++) {
      const a = this.rand(0, TAU), d = reach * this.rand(0.9, 1.6) + 0.1, s = height * this.rand(0.04, 0.09);
      const q = new Quaternion().setFromEuler(new Euler(this.rand(-1, 1), this.rand(0, TAU), this.rand(-1, 1)));
      b.add(stub, ice(), { position: [Math.cos(a) * d, 0, Math.sin(a) * d], scale: [s, s * 2, s], quaternion: q });
    }
    b.build(this);
    const sb = new MergeBuilder();
    const drift = Math.max(0.4, reach * 1.6);
    sb.add(rockBlob(this.seed % BLOB_VARIANTS, 2), snowMat(this), {
      position: [0, -drift * 0.12, 0], scale: [drift, drift * 0.35, drift * 0.9], yaw: this.rand(0, TAU), tint: 1, detail: 2,
    });
    sb.build(this);
  }
}

