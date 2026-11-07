import {
  Group, Mesh, Vector3, Quaternion, Euler, Matrix4, BoxGeometry, CylinderGeometry, MeshStandardMaterial,
  Float32BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pooledMaterial, pickVariant, TEXTURE_VARIANTS } from './textures/pool.ts';
import { projectUV, offsetUV } from './textures/uv.ts';

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

/**
 * Material wearing one of the pooled, hand-drawn textures (see `src/textures`).
 * `kind` is a texture kind ('bark', 'brick', ...), `variant` one of its
 * TEXTURE_VARIANTS ready-made textures (use `pickVariant` / `WorldModel.variant`).
 * Pass `color` only to recolour; omit it to keep the variant's own colourway.
 * Vertex colours carry the per-part tint of `MergeBuilder`. The same arguments
 * always return the same shared material.
 */
export function surfaceMaterial(kind, variant, color = null, vertexColors = true) {
  return pooledMaterial(kind, variant, { color, flatShading: true, vertexColors, roughness: 0.95 });
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
  declare _m: any;
  declare _parts: any;
  constructor() {
    this._parts = new Map(); // material -> [BufferGeometry]
    this._m = new Matrix4();
  }

  /**
   * Add a transformed copy of `geometry`.
   * opts: position [x,y,z], scale [x,y,z], yaw (radians around Y) or
   * quaternion (THREE.Quaternion). If both are given, quaternion wins.
   * Extras for textured / vertex-coloured materials:
   *  - tint:  brightness number or [r,g,b] multiplier baked into vertex colours,
   *           or a function (x, y, z) => number | [r,g,b] of the model-space
   *           vertex position (strata, darker tunnel depths, ...)
   *  - grime: darken (and slightly green) the lowest ~2.5 units, like dirt and moss
   *  - uv:    how a pooled texture is laid on this part so it keeps a constant
   *           world size: 'face' | 'world' (projected from the triangles) or
   *           'box' | 'cyl' | 'cone' | 'sphere' (native UVs of that primitive,
   *           rescaled) or 'native' (the geometry's own UVs). Default: the
   *           mapping of the texture kind.
   *  - detail: pattern density factor, 2 draws the texture at half the size
   *           (for small models such as a bush). Default 1.
   */
  add(geometry, mat, { position = [0, 0, 0], scale = [1, 1, 1], yaw = 0, quaternion = null, tint = 1, grime = false, uv = null, detail = 1 }: any = {}) {
    const q = quaternion ?? _q.setFromAxisAngle(_yAxis, yaw);
    this._m.compose(_p.set(...(position as [number, number, number])), q, _s.set(...(scale as [number, number, number])));
    let g = geometry.clone();
    const map = mat.userData.mapping;
    const mode = map && mat.map ? (uv ?? map.uv) : null;
    const projected = mode === 'face' || mode === 'world';
    const tile = map ? map.tile / detail : 1;
    if (map && !mode) g.deleteAttribute('uv'); // no texture available (Node): UVs would only cost memory
    else if (mode && mode !== 'native' && !projected && g.attributes.uv) this._scaleUV(g, geometry, mode, scale, tile);
    g.applyMatrix4(this._m);
    if (mode && (projected || !g.attributes.uv)) g = projectUV(g, mode === 'face' ? 'face' : 'world', tile);
    if (mat.vertexColors) this._colour(g, tint, grime);
    if (!this._parts.has(mat)) this._parts.set(mat, []);
    this._parts.get(mat).push(g);
  }

  /** Rescale the native UVs of a primitive so one texture repeat is `T` world units wide. */
  _scaleUV(g, source, mode, [sx, sy, sz], T) {
    const uv = g.attributes.uv;
    if (mode === 'box') {
      // BoxGeometry: 4 vertices per face in the order +x, -x, +y, -y, +z, -z.
      const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      for (let i = 0; i < uv.count; i++) {
        const [du, dv] = dims[Math.min(5, i >> 2)];
        uv.setXY(i, uv.getX(i) * du / T, uv.getY(i) * dv / T);
      }
      return;
    }
    // Cylinder / cone / sphere: u runs around, v along. Whole repeats around the
    // circumference close the seam; thin twigs get one (finer) repeat instead of
    // a random sliver of the picture.
    const bb = source.boundingBox ?? (source.computeBoundingBox(), source.boundingBox);
    const r0 = Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z), h0 = bb.max.y - bb.min.y;
    const r = r0 * (sx + sz) / 2, circ = 2 * Math.PI * r;
    const n = Math.max(1, Math.round(circ / T)), t = circ / n;
    const along = mode === 'sphere' ? Math.PI * h0 / 2 * sy : mode === 'cone' ? Math.hypot(h0 * sy, r) : h0 * sy;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * n, uv.getY(i) * along / t);
  }

  _colour(g, tint, grime) {
    const fn = typeof tint === 'function' ? tint : null;
    let t = typeof tint === 'number' ? [tint, tint, tint] : tint;
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      if (fn) {
        const v = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
        t = typeof v === 'number' ? [v, v, v] : v;
      }
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
      const map = mat.userData.mapping;
      if (map && mat.map) {
        // Each model shows another part of the shared picture.
        const rnd = mulberry32((model.seed ^ map.hash) >>> 0);
        offsetUV(merged, rnd() * map.shift[0], rnd() * map.shift[1]);
      }
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
 *  - textures: pins texture variants, {kind: 0..4}, e.g. `{ bark: 2, brick: 0 }`.
 *              By default every model picks one of the shared, ready-made
 *              textures per kind from its seed (see `src/textures`).
 *
 * Geometry exposure: each model registers simple analytic shapes via
 * `addShape()`. `getColliders()` returns them in WORLD space, so physics /
 * collision code can use them without knowing anything about the model.
 * No physics is implemented here.
 */
export class WorldModel extends Group {
  declare _doors: any;
  declare _ownVariants: any;
  declare _ownedGeometries: any;
  declare _pickRandom: any;
  declare _shapes: any;
  declare _variants: any;
  declare _windows: any;
  declare options: any;
  declare random: any;
  declare seed: any;
  constructor(name, options: any = {}) {
    super();
    this.name = name;
    this.options = options;
    this.seed = (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
    this.random = mulberry32(this.seed); // per-instance PRNG, call as this.random()
    this._pickRandom = mulberry32(this.seed ^ 0x7e57ed); // texture picks, so they never change a model's shape
    this._variants = {};          // texture kind -> picked variant
    this._ownVariants = {};       // same, drawn from per-kind streams (see ownVariant)
    this._shapes = [];            // collision shapes in model-local space
    this._windows = [];           // window descriptions in model-local space
    this._doors = [];             // door descriptions in model-local space
    this._ownedGeometries = [];   // non-shared geometries, freed by dispose()
    const { position, rotation, size = 1 } = options;
    if (position) Array.isArray(position) ? this.position.set(...(position as [number, number, number])) : this.position.copy(position);
    if (typeof rotation === 'number') this.rotation.y = rotation;
    else if (rotation) this.rotation.copy(rotation.isEuler ? rotation : new Euler(rotation.x || 0, rotation.y || 0, rotation.z || 0));
    this.scale.setScalar(size);
  }

  /** Random float in [min, max) from this model's PRNG. */
  rand(min = 0, max = 1) {
    return min + (max - min) * this.random();
  }

  /**
   * Advance the PRNG by `n` draws and ignore them. Marks the spots where a
   * random choice (a colour) moved to the texture pool, so every seed still
   * builds the same shapes as before.
   */
  skip(n = 1) {
    for (let i = 0; i < n; i++) this.random();
  }

  /** Clamp an integer option into [min, max]; non-numbers give `fallback`. */
  static clampInt(value, min, max, fallback) {
    const v = Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(max, Math.max(min, v));
  }

  /**
   * Texture variant (0 .. TEXTURE_VARIANTS - 1) this model wears for `kind`:
   * picked from the shared pool by the seed (same seed, same textures), or
   * pinned with `options.textures`. Stays the same for the whole model.
   * `allowed` limits the random pick to some variants (a pin still wins).
   */
  variant(kind, allowed = null) {
    if (!(kind in this._variants)) {
      const picked = pickVariant(kind, this._pickRandom, allowed); // always drawn, so pinning one kind keeps the others
      const forced = this.options.textures?.[kind];
      this._variants[kind] = Number.isInteger(forced) && forced >= 0 && forced < TEXTURE_VARIANTS ? forced : picked;
    }
    return this._variants[kind];
  }

  /**
   * Like `variant`, but drawn from a stream of its own (seed + kind), so the
   * pick never moves the other kinds' picks. For parts added late (doors, windows).
   */
  ownVariant(kind, allowed = null) {
    if (!(kind in this._ownVariants)) {
      let h = this.seed ^ 0x51ed270b;
      for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
      const picked = pickVariant(kind, mulberry32(h >>> 0), allowed);
      const forced = this.options.textures?.[kind];
      this._ownVariants[kind] = Number.isInteger(forced) && forced >= 0 && forced < TEXTURE_VARIANTS ? forced : picked;
    }
    return this._ownVariants[kind];
  }

  /** Material of `kind` in the model's own-stream variant (see `ownVariant`), optionally recoloured. */
  ownSurface(kind, color = null, options: any = {}) {
    return pooledMaterial(kind, this.ownVariant(kind), { color, flatShading: true, vertexColors: true, roughness: 0.95, ...options });
  }

  /** Shared textured material of `kind` in this model's variant (see `surfaceMaterial`). */
  surface(kind, color = null, vertexColors = true, allowed = null) {
    return surfaceMaterial(kind, this.variant(kind, allowed), color, vertexColors);
  }

  /** The textures this model wears as `{kind: variant}`, e.g. `{ bark: 2, foliage: 0 }`. */
  textureVariants() {
    return { ...this._ownVariants, ...this._variants };
  }

  /** Add a visual mesh using shared geometry and material. */
  addMesh(geometry, mat, position = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new Mesh(geometry, mat);
    m.position.set(...(position as [number, number, number]));
    m.scale.set(...(scale as [number, number, number]));
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
      const out: any = { type, position: pos.toArray(), quaternion: q.toArray() };
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
   * opts: arched (round top, for castles), shutters (colour), sill (colour),
   * glassDoor (tall double door: no sill, `position` is its centre).
   * About a quarter of the windows are lit warmly (random per window).
   */
  addWindow(builder, position, yaw, width = 0.6, height = 0.8, opts: any = {}) {
    const { arched = false, shutters = null, glassDoor = false } = opts;
    const box = shared('window:box', () => new BoxGeometry(1, 1, 1));
    const disc = shared('window:disc', () => {
      const g = new CylinderGeometry(1, 1, 1, 10);
      g.rotateX(Math.PI / 2); // axis along Z
      return g;
    });
    const lit = this.random() < 0.25;
    const wood = this.ownSurface('planks', 0x4a3322);
    const sill = this.ownSurface('stone', opts.sill ?? 0xa9a49a);
    const glass = lit
      ? this.ownSurface('lamp', null, { roughness: 0.4, glow: 0.8 })
      : this.ownSurface('glass', null, { roughness: 0.15, metalness: 0.3, glow: 0.35 });
    const r = width / 2, fw = 0.08;
    // Rectangular part; the arch (if any) replaces the top `r` of the height.
    const rh = arched ? height - r : height;
    const yc = position[1] - (arched ? r / 2 : 0);
    const F = (g, m, u, y, n, sx, sy, sz) => this._facePart(builder, g, m, position, yaw, [u, y, n], [sx, sy, sz]);

    F(box, wood, 0, yc, 0.06, width + fw * 2, rh + fw * 2, 0.12);          // frame, front at 0.12
    F(box, glass, 0, yc, 0.065, width, rh, 0.12);                          // glass, front at 0.125 (just proud of the frame)
    if (arched) {
      const ya = position[1] + height / 2 - r;
      F(disc, wood, 0, ya, 0.06, r + fw, r + fw, 0.12);
      F(disc, glass, 0, ya, 0.065, r, r, 0.12);
    }
    F(box, wood, 0, position[1], 0.065, 0.035, height, 0.13);             // vertical mullion
    F(box, wood, 0, position[1] - height * (glassDoor ? -0.25 : 0.1), 0.065, width, 0.035, 0.13); // transom
    if (!glassDoor) F(box, sill, 0, position[1] - height / 2 - 0.05, 0.1, width + 0.3, 0.07, 0.2);
    if (shutters) {
      const sm = this.ownSurface('planks', shutters), sw = width * 0.5;
      for (const side of [-1, 1]) F(box, sm, side * (width / 2 + fw + sw / 2), yc, 0.05, sw, rh + fw * 2, 0.08);
    }
    this._windows.push({ position: [...position], yaw, width, height });
  }

  /**
   * Door (visual only) on a wall face, `position` = centre of the door foot on
   * the wall surface. Planked leaf with iron straps and a handle, a framing
   * surround, a stone step, and an optional round top.
   */
  addDoor(builder, position, yaw, width = 0.8, height = 1.5, opts: any = {}) {
    const { arched = false, frame = 0x8a857b, wood = 0x5a3b22 } = opts;
    const box = shared('window:box', () => new BoxGeometry(1, 1, 1));
    const disc = shared('window:disc', () => {
      const g = new CylinderGeometry(1, 1, 1, 10);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const leaf = this.ownSurface('planks', wood), dark = material(0x25211e, true), surround = this.ownSurface('stone', frame);
    const r = width / 2, fw = 0.12;
    const rh = arched ? height - r : height;
    const y0 = position[1];
    const F = (g, m, u, y, n, sx, sy, sz) => this._facePart(builder, g, m, position, yaw, [u, y, n], [sx, sy, sz]);

    F(box, surround, 0, y0 + rh / 2, 0.07, width + fw * 2, rh + fw, 0.14);
    F(box, leaf, 0, y0 + rh / 2, 0.08, width, rh, 0.14);      // leaf, front at 0.15 (proud of the surround)
    if (arched) {
      const ya = y0 + height - r;
      F(disc, surround, 0, ya, 0.07, r + fw, r + fw, 0.14);
      F(disc, leaf, 0, ya, 0.08, r, r, 0.14);
    }
    for (let i = -1; i <= 1; i += 2) F(box, dark, i * width * 0.17, y0 + rh / 2, 0.09, 0.02, rh, 0.14); // plank gaps
    for (const f of [0.2, 0.75]) F(box, dark, 0, y0 + rh * f, 0.165, width, 0.07, 0.04); // iron straps
    F(box, dark, width * 0.32, y0 + height * 0.45, 0.19, 0.07, 0.07, 0.06);           // handle
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
