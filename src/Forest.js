import { InstancedMesh, Matrix4, Quaternion, Vector3, Box3, Frustum, DynamicDrawUsage } from 'three';
import { WorldModel, mulberry32 } from './WorldModel.js';
import { LeafTree } from './models/LeafTree.js';

/**
 * Detail levels of a forest tree. Level 0 is used close to the camera, the
 * last one far away. Lower complexity means far fewer triangles; the leaves
 * grow (`leafSize`) so the crown keeps its mass.
 */
export const FOREST_LEVELS = [
  { complexity: 4, leafSize: 1 },
  { complexity: 2, leafSize: 1.4 },
  { complexity: 0, leafSize: 2 },
];

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Vector3();
const _cam = new Vector3();
const _frustum = new Frustum();
const _pv = new Matrix4();
const _yAxis = new Vector3(0, 1, 0);

const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

/**
 * A forest of `LeafTree`s that stays cheap for hundreds or thousands of trees.
 *
 *  - A handful of tree VARIANTS (different seeds) are built once, each at
 *    several levels of detail (`levels`). Every tree of the forest is just a
 *    position, yaw and scale of one variant.
 *  - Each variant/level/material is ONE `InstancedMesh`, so the draw calls
 *    depend on `variants * levels * 2`, not on the number of trees.
 *  - `update(camera)` (call it once per frame) picks the level per tree from
 *    its distance (`lodDistances`), skips trees outside the view and beyond
 *    `maxDistance`, and rewrites the instance matrices. It does nothing while
 *    camera and forest stay unchanged.
 *
 * Options (all optional):
 *  - count: number of trees (default 1000), area: side of the square area, centred on the model (default 160; `size` stays the uniform scale of every model)
 *  - variants: distinct trees built (default 6), seed (as for every model: same seed, same forest)
 *  - levels: [{complexity, leafSize}] detail levels, best first (default `FOREST_LEVELS`)
 *  - lodDistances: distances where the next level starts (default [25, 70]); `lod: false` keeps level 0 everywhere
 *  - maxDistance: trees further away are not drawn (default 250)
 *  - shadows: only the nearest level casts shadows (default true)
 *  - treeOptions: passed to every `LeafTree` (leafType, trunkColor, textures, ...)
 *  - heightAt(x, z): ground height for each tree (default flat 0)
 *  - minScale, maxScale: random tree size range (default 0.8 .. 1.25)
 *
 * Levels are built from the same seed but another complexity, so a tree
 * changes its shape slightly when it switches level; far away this is
 * hidden by distance and fog. `stats` holds the last frame's numbers.
 * Colliders: one box over the whole area (tag 'forest'); use
 * `getPlacements()` for per-tree positions.
 */
export class Forest extends WorldModel {
  constructor(options = {}) {
    super('Forest', options);
    const {
      count = 1000, area = 160, variants = 6, levels = FOREST_LEVELS, lodDistances = [25, 70], lod = true,
      maxDistance = 250, shadows = true, treeOptions = {}, heightAt = null, minScale = 0.8, maxScale = 1.25,
    } = options;
    this.count = WorldModel.clampInt(count, 0, 100000, 1000);
    this.areaSize = area;
    this.lodDistances = lodDistances;
    this.lod = lod;
    this.maxDistance = maxDistance;
    const nVariants = WorldModel.clampInt(variants, 1, 64, 6);
    const rnd = this.random;

    // Jittered grid: even spread without overlapping trunks, shuffled so the count can be anything.
    const n = Math.max(1, Math.ceil(Math.sqrt(this.count)));
    const cell = area / n;
    const cells = Array.from({ length: n * n }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    this._trees = [];
    const perVariant = new Array(nVariants).fill(0);
    for (let i = 0; i < this.count; i++) {
      const c = cells[i];
      const x = ((c % n) + 0.1 + rnd() * 0.8) * cell - area / 2;
      const z = (Math.floor(c / n) + 0.1 + rnd() * 0.8) * cell - area / 2;
      const variant = Math.floor(rnd() * nVariants);
      perVariant[variant]++;
      this._trees.push({
        x, y: heightAt ? heightAt(x, z) : 0, z, yaw: rnd() * Math.PI * 2, scale: minScale + rnd() * (maxScale - minScale), variant,
      });
    }

    // Variants x levels: build a real LeafTree, keep only its merged meshes.
    this._variants = [];
    for (let v = 0; v < nVariants; v++) {
      const seed = (this.seed + Math.imul(v + 1, 0x9e3779b1)) >>> 0;
      const box = new Box3();
      const lvls = levels.map((level, l) => {
        const tree = new LeafTree({ ...treeOptions, seed, complexity: level.complexity, leafSize: (treeOptions.leafSize ?? 1) * (level.leafSize ?? 1) });
        this._ownedGeometries.push(...tree._ownedGeometries);
        tree._ownedGeometries.length = 0;
        const meshes = tree.children.filter((o) => o.isMesh).map((src) => {
          const mesh = new InstancedMesh(src.geometry, src.material, perVariant[v]);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false; // instances are culled one by one in update()
          mesh.castShadow = shadows && l === 0;
          mesh.receiveShadow = true;
          if (l === 0) { src.geometry.computeBoundingBox(); box.union(src.geometry.boundingBox); }
          return mesh;
        });
        return { meshes, triangles: meshes.reduce((t, m) => t + trianglesOf(m), 0), slot: 0 };
      });
      if (perVariant[v] > 0) lvls.forEach((lv) => lv.meshes.forEach((m) => this.add(m)));
      // Sphere around the crown, centred above the trunk; generous so nothing pops at the screen edge.
      const centre = box.getCenter(new Vector3());
      this._variants.push({ levels: lvls, cy: centre.y, radius: Math.hypot(centre.x, centre.z) + box.getSize(new Vector3()).length() / 2 });
    }

    this.bounds = new Box3(new Vector3(-area / 2, 0, -area / 2), new Vector3(area / 2, 12, area / 2));
    this.viewBox = new Box3(new Vector3(-30, 0, -30), new Vector3(30, 12, 30)); // a good first camera view
    this.addShape('box', { size: [area, 1, area] }, [0, 0.5, 0], null, 'forest');
    this.stats = { trees: this.count, visible: 0, levels: levels.map(() => 0), triangles: 0, drawCalls: 0 };
    this._seen = new Float64Array(48);
    this._levelCount = levels.length;
    this.invalidate();
  }

  /** Per-tree placements: [{x, y, z, yaw, scale, variant}] in forest-local space. */
  getPlacements() {
    return this._trees.map((t) => ({ ...t }));
  }

  /** Force the next `update()` to redo everything (after moving trees, toggling `lod`, ...). */
  invalidate() {
    this._seen.fill(NaN);
  }

  /** Pick level and visibility of every tree for `camera`. Cheap to call every frame. */
  update(camera) {
    camera.updateMatrixWorld();
    this.updateWorldMatrix(true, false);
    const seen = this._seen;
    const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements, w = this.matrixWorld.elements;
    let same = true;
    for (let i = 0; i < 16 && same; i++) same = seen[i] === a[i] && seen[i + 16] === b[i] && seen[i + 32] === w[i];
    if (same) return;
    for (let i = 0; i < 16; i++) { seen[i] = a[i]; seen[i + 16] = b[i]; seen[i + 32] = w[i]; }

    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const k = this.matrixWorld.getMaxScaleOnAxis();
    const last = this._levelCount - 1;
    const counts = this.stats.levels.fill(0);
    let visible = 0, triangles = 0;
    for (const v of this._variants) v.levels.forEach((lv) => { lv.slot = 0; });

    for (const t of this._trees) {
      const variant = this._variants[t.variant];
      _c.set(t.x, t.y + variant.cy * t.scale, t.z).applyMatrix4(this.matrixWorld);
      const dist = _c.distanceTo(_cam);
      const r = variant.radius * t.scale * k;
      if (dist - r > this.maxDistance) continue;
      if (!_frustum.intersectsSphere({ center: _c, radius: r })) continue;
      let level = 0;
      if (this.lod) while (level < last && dist > this.lodDistances[level]) level++;
      const lv = variant.levels[level];
      _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(_yAxis, t.yaw), _s.setScalar(t.scale));
      for (const mesh of lv.meshes) mesh.setMatrixAt(lv.slot, _m);
      lv.slot++;
      counts[level]++;
      triangles += lv.triangles;
      visible++;
    }

    let drawCalls = 0;
    for (const v of this._variants) {
      for (const lv of v.levels) {
        for (const mesh of lv.meshes) {
          mesh.count = lv.slot;
          mesh.visible = lv.slot > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (lv.slot > 0) drawCalls++;
        }
      }
    }
    Object.assign(this.stats, { visible, triangles, drawCalls });
  }

  dispose() {
    this.children.filter((o) => o.isInstancedMesh).forEach((m) => m.dispose());
    super.dispose();
  }
}
