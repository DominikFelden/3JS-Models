import { Group, Mesh, Vector3, Quaternion, Euler, MeshStandardMaterial } from 'three';

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _pq = new Quaternion();

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

/**
 * Base class of all world models (trees, rocks, bushes, castles).
 *
 * Options (all optional):
 *  - position: {x,y,z} or [x,y,z]   world position of the model's base centre
 *  - rotation: number (yaw in radians around Y) or {x,y,z} Euler angles (radians)
 *  - size:     uniform scale factor (1 = default size). Uniform only, so that
 *              cylinders stay cylinders and spheres stay spheres.
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
    this._shapes = []; // shapes in model-local space
    const { position, rotation, size = 1 } = options;
    if (position) Array.isArray(position) ? this.position.set(...position) : this.position.copy(position);
    if (typeof rotation === 'number') this.rotation.y = rotation;
    else if (rotation) this.rotation.copy(rotation.isEuler ? rotation : new Euler(rotation.x || 0, rotation.y || 0, rotation.z || 0));
    this.scale.setScalar(size);
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
   *  - cylinder: {radius, height}   (axis = local Y, centred)
   *  - box:      {size:[x,y,z]}     (full extents, centred)
   *  - sphere:   {radius}
   *  - cone:     {radius, height}   (axis = local Y, centred)
   *  - convex:   {points:[[x,y,z],...]} (convex hull vertices; position/rotation unused)
   */
  addShape(type, data, position = [0, 0, 0], rotation = null) {
    this._shapes.push({ type, data, position, rotation });
  }

  /**
   * Geometric info in world space. Each entry:
   * { type, position:{x,y,z}, quaternion:{x,y,z,w}, ...dimensions }
   * Dimensions are already multiplied by `size`. Convex shapes return
   * world-space `points` and an identity quaternion.
   */
  getColliders() {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_p, _pq, _s);
    const k = _s.x; // uniform scale
    return this._shapes.map(({ type, data, position, rotation }) => {
      if (type === 'convex') {
        const points = data.points.map((pt) => _p.set(...pt).applyMatrix4(this.matrixWorld).toArray());
        return { type, position: this.getWorldPosition(new Vector3()).toArray(), quaternion: [0, 0, 0, 1], points };
      }
      const pos = new Vector3(...position).applyMatrix4(this.matrixWorld);
      _q.copy(_pq);
      if (rotation) _q.multiply(rotation);
      const out = { type, position: pos.toArray(), quaternion: _q.toArray() };
      if (data.radius !== undefined) out.radius = data.radius * k;
      if (data.height !== undefined) out.height = data.height * k;
      if (data.size) out.size = data.size.map((v) => v * k);
      return out;
    });
  }

  /** Axis-aligned world bounding box of all shapes, as {min:[x,y,z], max:[x,y,z]}. */
  getBounds() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const v = new Vector3();
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
