import {
  Group, Mesh, Vector3, Quaternion, Euler, Matrix4, BoxGeometry, CylinderGeometry, MeshStandardMaterial,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, Float32BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _pq = new Quaternion();
const _yAxis = new Vector3(0, 1, 0);

/**
 * Small deterministic PRNG (mulberry32). Returns a function giving floats in
 * [0, 1). The same seed always yields the same sequence.
 */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cache of shared geometries/materials. `factory` runs once per key, so every
 * instance of a model reuses the same GPU buffers (important for web games).
 */
const cache = new Map();
export function shared(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/**
 * Flat-shaded material cache keyed by colour. With `vertexColors` the
 * MergeBuilder bakes per-part colour variation and ground grime into the mesh
 * (pass `tint` / `grime` to `MergeBuilder.add`).
 */
export function material(color, flatShading = false, vertexColors = false) {
  return shared(`mat:${color}:${flatShading}:${vertexColors}`, () => new MeshStandardMaterial({ color, flatShading, roughness: 1, vertexColors }));
}

/** Size in world units of one stone texture tile (4 courses of blocks). */
export const STONE_TILE = 2.5;

/** Surface patterns available to `surfaceMaterial` (procedural canvas textures). */
export const SURFACES = ['stone', 'brick', 'cobble', 'plaster', 'planks', 'mossy', 'shingle'];

/** Draw one pattern tile (grey-scale-ish; the material colour tints it). */
function drawPattern(ctx, kind, S, rnd) {
  const noise = (n, a) => {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(rnd() * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
      ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
  };
  // Rows of blocks with random cut points; `gap` = mortar width.
  const courses = (rows, minN, maxN, gap, lo, hi, mortar, tintFn) => {
    const rh = S / rows;
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) {
      const n = minN + Math.floor(rnd() * (maxN - minN + 1));
      const cuts = [];
      let x = rnd() * S;
      for (let i = 0; i < n; i++) { cuts.push(x); x += (S / n) * (0.7 + rnd() * 0.6); }
      cuts.sort((p, q) => p - q);
      cuts.forEach((c0, i) => {
        const c1 = i + 1 < n ? cuts[i + 1] : cuts[0] + S;
        const v = lo + Math.floor(rnd() * (hi - lo));
        ctx.fillStyle = tintFn(v, rnd);
        for (const o of [0, -S]) ctx.fillRect(c0 + o + gap, r * rh + gap, c1 - c0 - gap * 2, rh - gap * 2);
      });
    }
  };
  const grey = (v) => `rgb(${v},${v - 2},${v - 6})`;
  if (kind === 'brick') {
    courses(8, 4, 4, 1.5, 175, 245, '#8a8a8a', (v) => `rgb(${v},${v - 6},${v - 8})`);
    noise(3000, 0.1);
  } else if (kind === 'cobble') {
    courses(6, 5, 7, 2.5, 140, 225, '#4a4845', grey);
    noise(3500, 0.1);
  } else if (kind === 'plaster') {
    ctx.fillStyle = '#e9e6e0';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const v = 200 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v - 6},0.25)`;
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, 8 + rnd() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(4000, 0.07);
  } else if (kind === 'planks') {
    const n = 8, w = S / n;
    for (let i = 0; i < n; i++) {
      const v = 170 + Math.floor(rnd() * 70);
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      ctx.fillRect(i * w, 0, w, S);
      for (let g = 0; g < 14; g++) {
        const gv = Math.floor(rnd() * 120);
        ctx.fillStyle = `rgba(${gv},${gv},${gv},0.1)`;
        ctx.fillRect(i * w + rnd() * w, 0, 1 + rnd() * 1.5, S);
      }
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(i * w, 0, 2, S);
    }
  } else if (kind === 'shingle') {
    const rows = 8, rh = S / rows, cols = 8, cw = S / cols;
    ctx.fillStyle = '#555';
    ctx.fillRect(0, 0, S, S);
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
      const v = 160 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      const x = c * cw + (r % 2 ? cw / 2 : 0) - cw / 2;
      ctx.beginPath();
      ctx.roundRect(x + 1, r * rh + 1, cw - 2, rh * 1.4, [0, 0, cw / 2, cw / 2]);
      ctx.fill();
    }
    noise(1500, 0.08);
  } else {
    courses(4, 3, 4, 2, 150, 220, '#5c5a56', grey);
    if (kind === 'mossy') {
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(${40 + rnd() * 30},${110 + rnd() * 50},${30 + rnd() * 30},${0.2 + rnd() * 0.3})`;
        ctx.beginPath();
        ctx.arc(rnd() * S, rnd() * S, 3 + rnd() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    noise(2500, 0.08);
  }
}

/**
 * Procedural texture of the given pattern, drawn once on a canvas. Only
 * available in a browser (returns null elsewhere, e.g. under Node tests);
 * models then fall back to plain colour.
 */
function patternTexture(kind) {
  return shared(`tex:${kind}`, () => {
    if (typeof document === 'undefined') return null;
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    drawPattern(cv.getContext('2d'), kind, S, mulberry32(1234 + SURFACES.indexOf(kind)));
    const t = new CanvasTexture(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

/**
 * Vertex-coloured material with a procedural surface pattern (one of
 * SURFACES), where canvases exist. Use with `uv: 'box' | 'cyl'` in MergeBuilder.
 */
export function surfaceMaterial(kind, color) {
  return shared(`mat:${kind}:${color}`, () => new MeshStandardMaterial({
    color, flatShading: true, roughness: 0.95, vertexColors: true, map: patternTexture(kind),
  }));
}

/** Weathered stone: vertex-coloured, with a masonry texture where canvases exist. */
export function stoneMaterial(color, kind = 'stone') {
  return surfaceMaterial(kind, color);
}

/** Bark: plain material with a wood-grain texture where canvases exist. */
export function barkMaterial(color) {
  return shared(`mat:bark:${color}`, () => new MeshStandardMaterial({
    color, flatShading: true, roughness: 1,
    map: shared('tex:bark', () => {
      if (typeof document === 'undefined') return null;
      const W = 64, H = 128, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), rnd = mulberry32(77);
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        const v = 90 + Math.floor(rnd() * 110);
        ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
        ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 10 + rnd() * 50);
      }
      const t = new CanvasTexture(cv);
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = SRGBColorSpace;
      return t;
    }),
  }));
}

/** Window glass: slightly emissive so windows stay visible in shadow. */
export function glassMaterial(lit = false) {
  return shared(lit ? 'mat:glass:lit' : 'mat:glass', () => new MeshStandardMaterial(lit
    ? { color: 0x6b5a3a, emissive: 0xb07a2a, emissiveIntensity: 0.7, roughness: 0.4 }
    : { color: 0x2a3f55, emissive: 0x1a2a3a, roughness: 0.15, metalness: 0.3 }));
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Collects many transformed copies of (shared) geometries and merges them into
 * ONE mesh per material. A tree with 300 branches therefore costs only 2 draw
 * calls (bark + leaves). The merged geometry is owned by the model and freed
 * by `WorldModel.dispose()`.
 */
export class MergeBuilder {
  constructor() {
    this._parts = new Map(); // material -> [BufferGeometry]
    this._m = new Matrix4();
  }

  /**
   * Add a transformed copy of `geometry`.
   * opts: position [x,y,z], scale [x,y,z], yaw (radians around Y) or
   * quaternion (THREE.Quaternion). If both are given, quaternion wins.
   * Extras for textured / vertex-coloured materials:
   *  - tint:  brightness number or [r,g,b] multiplier baked into vertex colours
   *  - grime: darken (and slightly green) the lowest ~2.5 units, like dirt and moss
   *  - uv:    'box' | 'cyl' rescales UVs so textures keep a constant world size
   */
  add(geometry, mat, { position = [0, 0, 0], scale = [1, 1, 1], yaw = 0, quaternion = null, tint = 1, grime = false, uv = null } = {}) {
    const q = quaternion ?? _q.setFromAxisAngle(_yAxis, yaw);
    this._m.compose(_p.set(...position), q, _s.set(...scale));
    const g = geometry.clone();
    if (uv && g.attributes.uv && mat.map) this._scaleUV(g, uv, scale);
    g.applyMatrix4(this._m);
    if (mat.vertexColors) this._colour(g, tint, grime);
    if (!this._parts.has(mat)) this._parts.set(mat, []);
    this._parts.get(mat).push(g);
  }

  _scaleUV(g, kind, [sx, sy, sz]) {
    const uv = g.attributes.uv, T = STONE_TILE;
    if (kind === 'box') {
      // BoxGeometry: 4 vertices per face in the order +x, -x, +y, -y, +z, -z.
      const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      for (let i = 0; i < uv.count; i++) {
        const [du, dv] = dims[Math.min(5, i >> 2)];
        uv.setXY(i, uv.getX(i) * du / T, uv.getY(i) * dv / T);
      }
    } else {
      const circ = 2 * Math.PI * sx;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / T, uv.getY(i) * sy / T);
    }
  }

  _colour(g, tint, grime) {
    const t = typeof tint === 'number' ? [tint, tint, tint] : tint;
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = grime ? 0.7 + 0.3 * smooth(0, 2.5, pos.getY(i)) : 1;
      const low = 1 - k;
      col[i * 3] = t[0] * k;
      col[i * 3 + 1] = t[1] * (k + low * 0.3);
      col[i * 3 + 2] = t[2] * k * (1 - low * 0.3);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
  }

  /** Merge each material group and add the resulting meshes to `model`. */
  build(model) {
    for (const [mat, geoms] of this._parts) {
      // mergeGeometries needs all-indexed or all-non-indexed input.
      const mixed = geoms.some((g) => !g.index) && geoms.some((g) => g.index);
      const list = mixed ? geoms.map((g) => (g.index ? g.toNonIndexed() : g)) : geoms;
      const merged = mergeGeometries(list, false);
      geoms.forEach((g) => g.dispose());
      if (!merged) continue;
      model._ownedGeometries.push(merged);
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      model.add(mesh);
    }
    this._parts.clear();
  }
}

/**
 * Base class of all world models (trees, rocks, bushes, houses, castles).
 *
 * Options (all optional):
 *  - position: {x,y,z} or [x,y,z]   world position of the model's base centre
 *  - rotation: number (yaw in radians around Y) or {x,y,z} Euler angles (radians)
 *  - size:     uniform scale factor (1 = default size). Uniform only, so that
 *              cylinders stay cylinders and spheres stay spheres.
 *  - seed:     integer. Drives all randomness of the model. Same seed + same
 *              options = identical model. Default: a fresh random seed, so
 *              two models never look exactly the same. Read it back from
 *              `model.seed` to rebuild the same model later.
 *  - complexity: integer >= 0 (only used by models that support it: trees,
 *              castles). 0 = simplest form. Clamped per model.
 *
 * Geometry exposure: each model registers simple analytic shapes via
 * `addShape()`. `getColliders()` returns them in WORLD space, so physics /
 * collision code can use them without knowing anything about the model.
 * No physics is implemented here.
 */
export class WorldModel extends Group {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.options = options;
    this.seed = (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
    this.random = mulberry32(this.seed); // per-instance PRNG, call as this.random()
    this._shapes = [];            // collision shapes in model-local space
    this._windows = [];           // window descriptions in model-local space
    this._doors = [];             // door descriptions in model-local space
    this._ownedGeometries = [];   // non-shared geometries, freed by dispose()
    const { position, rotation, size = 1 } = options;
    if (position) Array.isArray(position) ? this.position.set(...position) : this.position.copy(position);
    if (typeof rotation === 'number') this.rotation.y = rotation;
    else if (rotation) this.rotation.copy(rotation.isEuler ? rotation : new Euler(rotation.x || 0, rotation.y || 0, rotation.z || 0));
    this.scale.setScalar(size);
  }

  /** Random float in [min, max) from this model's PRNG. */
  rand(min = 0, max = 1) {
    return min + (max - min) * this.random();
  }

  /** Clamp an integer option into [min, max]; non-numbers give `fallback`. */
  static clampInt(value, min, max, fallback) {
    const v = Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(max, Math.max(min, v));
  }

  /** Add a visual mesh using shared geometry and material. */
  addMesh(geometry, mat, position = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new Mesh(geometry, mat);
    m.position.set(...position);
    m.scale.set(...scale);
    m.castShadow = m.receiveShadow = true;
    this.add(m);
    return m;
  }

  /**
   * Register a collision shape in local space (before the model's own
   * transform). `rotation` is an optional Quaternion relative to the model.
   * `tag` is a free label (e.g. 'trunk', 'branch', 'wall') returned by
   * `getColliderTags()`; it defaults to the shape type.
   *  - cylinder: {radius, height}   (axis = local Y, centred)
   *  - box:      {size:[x,y,z]}     (full extents, centred)
   *  - sphere:   {radius}
   *  - cone:     {radius, height}   (axis = local Y, centred)
   *  - convex:   {points:[[x,y,z],...]} (convex hull vertices; position/rotation unused)
   */
  addShape(type, data, position = [0, 0, 0], rotation = null, tag = type) {
    this._shapes.push({ type, data, position, rotation, tag });
  }

  /**
   * Geometric info in world space. Each entry:
   * { type, position:[x,y,z], quaternion:[x,y,z,w], ...dimensions }
   * Dimensions are already multiplied by `size`. Convex shapes return
   * world-space `points` and an identity quaternion.
   */
  getColliders() {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_p, _pq, _s);
    const k = _s.x; // uniform scale
    return this._shapes.map(({ type, data, position, rotation }) => {
      if (type === 'convex') {
        const points = data.points.map((pt) => new Vector3(...pt).applyMatrix4(this.matrixWorld).toArray());
        return { type, position: this.getWorldPosition(new Vector3()).toArray(), quaternion: [0, 0, 0, 1], points };
      }
      const pos = new Vector3(...position).applyMatrix4(this.matrixWorld);
      const q = _pq.clone();
      if (rotation) q.multiply(rotation);
      const out = { type, position: pos.toArray(), quaternion: q.toArray() };
      if (data.radius !== undefined) out.radius = data.radius * k;
      if (data.height !== undefined) out.height = data.height * k;
      if (data.size) out.size = data.size.map((v) => v * k);
      return out;
    });
  }

  /** Labels matching the order of getColliders(). */
  getColliderTags() {
    return this._shapes.map((s) => s.tag);
  }

  /**
   * Place a box in the local frame of a wall face. `u` runs along the wall,
   * `n` is the offset along the outward normal (box centre), `y` is world
   * height. `yaw` is the face direction (see addWindow).
   */
  _facePart(builder, geo, mat, origin, yaw, [u, y, n], scale) {
    const px = origin[0] + Math.cos(yaw) * u + Math.sin(yaw) * n;
    const pz = origin[2] - Math.sin(yaw) * u + Math.cos(yaw) * n;
    builder.add(geo, mat, { position: [px, y, pz], scale, yaw });
  }

  /**
   * Register a window (visual + exposed data): recessed glass in a wooden
   * frame with mullions and a sill. `yaw` is the direction the window faces:
   * the outward normal is (sin yaw, 0, cos yaw), so yaw 0 faces +Z.
   * `position` is the centre of the window on the wall surface.
   * opts: arched (round top, for castles), shutters (colour), sill (colour).
   * About a quarter of the windows are lit warmly (random per window).
   */
  addWindow(builder, position, yaw, width = 0.6, height = 0.8, opts = {}) {
    const { arched = false, shutters = null } = opts;
    const box = shared('window:box', () => new BoxGeometry(1, 1, 1));
    const disc = shared('window:disc', () => {
      const g = new CylinderGeometry(1, 1, 1, 10);
      g.rotateX(Math.PI / 2); // axis along Z
      return g;
    });
    const wood = material(0x4a3322, true);
    const sill = material(opts.sill ?? 0xa9a49a, true);
    const glass = glassMaterial(this.random() < 0.25);
    const r = width / 2, fw = 0.08;
    // Rectangular part; the arch (if any) replaces the top `r` of the height.
    const rh = arched ? height - r : height;
    const yc = position[1] - (arched ? r / 2 : 0);
    const F = (g, m, u, y, n, sx, sy, sz) => this._facePart(builder, g, m, position, yaw, [u, y, n], [sx, sy, sz]);

    F(box, wood, 0, yc, 0.06, width + fw * 2, rh + fw * 2, 0.12);          // frame, front at 0.12
    F(box, glass, 0, yc, 0.06, width, rh, 0.1);                            // glass, front at 0.11
    if (arched) {
      const ya = position[1] + height / 2 - r;
      F(disc, wood, 0, ya, 0.06, r + fw, r + fw, 0.12);
      F(disc, glass, 0, ya, 0.06, r, r, 0.1);
    }
    F(box, wood, 0, position[1], 0.065, 0.035, height, 0.13);             // vertical mullion
    F(box, wood, 0, position[1] - height * 0.1, 0.065, width, 0.035, 0.13); // transom
    F(box, sill, 0, position[1] - height / 2 - 0.05, 0.1, width + 0.3, 0.07, 0.2);
    if (shutters) {
      const sm = material(shutters, true), sw = width * 0.5;
      for (const side of [-1, 1]) F(box, sm, side * (width / 2 + fw + sw / 2), yc, 0.05, sw, rh + fw * 2, 0.08);
    }
    this._windows.push({ position: [...position], yaw, width, height });
  }

  /**
   * Door (visual only) on a wall face, `position` = centre of the door foot on
   * the wall surface. Planked leaf with iron straps and a handle, a framing
   * surround, a stone step, and an optional round top.
   */
  addDoor(builder, position, yaw, width = 0.8, height = 1.5, opts = {}) {
    const { arched = false, frame = 0x8a857b, wood = 0x5a3b22 } = opts;
    const box = shared('window:box', () => new BoxGeometry(1, 1, 1));
    const disc = shared('window:disc', () => {
      const g = new CylinderGeometry(1, 1, 1, 10);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const leaf = material(wood, true), dark = material(0x25211e, true), surround = material(frame, true);
    const r = width / 2, fw = 0.12;
    const rh = arched ? height - r : height;
    const y0 = position[1];
    const F = (g, m, u, y, n, sx, sy, sz) => this._facePart(builder, g, m, position, yaw, [u, y, n], [sx, sy, sz]);

    F(box, surround, 0, y0 + rh / 2, 0.07, width + fw * 2, rh + fw, 0.14);
    F(box, leaf, 0, y0 + rh / 2, 0.06, width, rh, 0.1);
    if (arched) {
      const ya = y0 + height - r;
      F(disc, surround, 0, ya, 0.07, r + fw, r + fw, 0.14);
      F(disc, leaf, 0, ya, 0.06, r, r, 0.1);
    }
    for (let i = -1; i <= 1; i += 2) F(box, dark, i * width * 0.17, y0 + rh / 2, 0.062, 0.02, rh, 0.105); // plank gaps
    for (const f of [0.2, 0.75]) F(box, dark, 0, y0 + rh * f, 0.12, width, 0.07, 0.04); // iron straps
    F(box, dark, width * 0.32, y0 + height * 0.45, 0.13, 0.07, 0.07, 0.06);           // handle
    F(box, surround, 0, y0 + 0.04, 0.2, width + 0.5, 0.08, 0.4);                        // step
    this._doors.push({ position: [...position], yaw, width, height });
  }

  /**
   * Windows in world space: [{ position:[x,y,z], normal:[x,y,z], width, height }].
   * `normal` points out of the wall. Useful e.g. for lighting or AI.
   */
  getWindows() {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_p, _pq, _s);
    const k = _s.x;
    return this._windows.map((w) => ({
      position: new Vector3(...w.position).applyMatrix4(this.matrixWorld).toArray(),
      normal: new Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw)).applyQuaternion(_pq).toArray(),
      width: w.width * k,
      height: w.height * k,
    }));
  }

  /** Free GPU memory of this model's own (merged) geometries. Shared ones stay. */
  dispose() {
    this._ownedGeometries.forEach((g) => g.dispose());
    this._ownedGeometries.length = 0;
  }

  /** Axis-aligned world bounding box of all shapes, as {min:[x,y,z], max:[x,y,z]}. */
  getBounds() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of this.getColliders()) {
      let pts;
      if (c.type === 'convex') pts = c.points;
      else {
        // Conservative: use bounding sphere of the shape's extents.
        const r = c.radius !== undefined
          ? Math.hypot(c.radius, (c.height || 0) / 2)
          : Math.hypot(...c.size) / 2;
        pts = [[c.position[0] - r, c.position[1] - r, c.position[2] - r],
               [c.position[0] + r, c.position[1] + r, c.position[2] + r]];
      }
      for (const pt of pts) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], pt[i]); max[i] = Math.max(max[i], pt[i]);
      }
    }
    return { min, max };
  }
}
