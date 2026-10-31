import {
  Group, Mesh, Vector3, Quaternion, Euler, Matrix4, BoxGeometry, MeshStandardMaterial,
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

/** Flat-shaded material cache keyed by colour (no textures needed). */
export function material(color, flatShading = false) {
  return shared(`mat:${color}:${flatShading}`, () => new MeshStandardMaterial({ color, flatShading, roughness: 1 }));
}

/** Window glass: slightly emissive so windows stay visible in shadow. */
export function glassMaterial() {
  return shared('mat:glass', () => new MeshStandardMaterial({
    color: 0x2a3f55, emissive: 0x1a2a3a, roughness: 0.3, metalness: 0.2,
  }));
}

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
   */
  add(geometry, mat, { position = [0, 0, 0], scale = [1, 1, 1], yaw = 0, quaternion = null } = {}) {
    const q = quaternion ?? _q.setFromAxisAngle(_yAxis, yaw);
    this._m.compose(_p.set(...position), q, _s.set(...scale));
    const g = geometry.clone();
    g.applyMatrix4(this._m);
    if (!this._parts.has(mat)) this._parts.set(mat, []);
    this._parts.get(mat).push(g);
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
      model.add(new Mesh(merged, mat));
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
   * Register a window (visual + exposed data). Adds a thin glass box to the
   * given MergeBuilder. `yaw` is the direction the window faces: the outward
   * normal is (sin yaw, 0, cos yaw), so yaw 0 faces +Z.
   * `position` is the centre of the window on the wall surface.
   */
  addWindow(builder, position, yaw, width = 0.6, height = 0.8) {
    const depth = 0.1;
    const geo = shared('window:box', () => new BoxGeometry(1, 1, 1));
    // Push the box half its depth outwards so it sits on, not in, the wall.
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const pos = [position[0] + nx * depth / 2, position[1], position[2] + nz * depth / 2];
    builder.add(geo, glassMaterial(), { position: pos, scale: [width, height, depth], yaw });
    this._windows.push({ position: [...position], yaw, width, height });
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
