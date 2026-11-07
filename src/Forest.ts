import { InstancedMesh, Matrix4, Quaternion, Vector3, Box3, Frustum, DynamicDrawUsage, Color } from 'three';
import { WorldModel } from './WorldModel.ts';
import { LeafTree } from './models/LeafTree.ts';
import { StylizedTree, MAX_STYLIZED_COMPLEXITY } from './models/StylizedTree.ts';
import { MAX_TREE_COMPLEXITY } from './models/branching.ts';
import { canBake } from './textures/bake.ts';
import { TEXTURE_VARIANTS } from './textures/pool.ts';
import { fallbackColor } from './textures/recipes.ts';
import { fadeMaterial, rangeUniform, setRange, inRange } from './forest/fade.ts';
import { bakeImpostors, createImpostors } from './forest/impostors.ts';
import { canopyGeometry, createCanopy } from './forest/canopy.ts';

/**
 * Detail levels of the real (3D) forest trees. Level 0 is used close to the
 * camera, the last one up to `impostorDistance`. Leaf trees look bad below
 * complexity 7, so real trees stay at 7+ and far trees are impostors.
 */
export const FOREST_LEVELS = [
  { complexity: 12, leafSize: 1 },
  { complexity: 8, leafSize: 1 },
];

/**
 * Detail levels of a `StylizedTree` forest of `complexity` (0..6): the full
 * tree near the camera, a `lowPoly` copy of it (same shape, ~2.5x fewer
 * triangles) farther away.
 */
export const stylizedForestLevels = (complexity) => [{ complexity }, { complexity, lowPoly: true }];

/** Default detail levels of `StylizedTree` forests (`treeType: 'stylized'`): branching trees (complexity 5). */
export const STYLIZED_FOREST_LEVELS = stylizedForestLevels(5);

/**
 * Tree models a Forest can be made of (`treeType`), with their default levels,
 * the highest complexity and the levels for a chosen `complexity`.
 */
export const FOREST_TREE_TYPES = {
  leaf: { Tree: LeafTree, levels: FOREST_LEVELS, max: MAX_TREE_COMPLEXITY, stature: false, levelsFor: (c) => [{ complexity: c }, { complexity: Math.max(0, c - 4) }] },
  stylized: { Tree: StylizedTree, levels: STYLIZED_FOREST_LEVELS, max: MAX_STYLIZED_COMPLEXITY, levelsFor: stylizedForestLevels, stature: true },
};

/** Small integer hash -> [0, 1). */
const hash01 = (n) => {
  let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
};

const _m = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Vector3();
const _cam = new Vector3();
const _frustum = new Frustum();
const _pv = new Matrix4();
const _yAxis = new Vector3(0, 1, 0);
const _sphere: any = { center: new Vector3(), radius: 0 };

/** Triangular distribution on [0, 1] from one uniform draw: middle sizes common, extremes rare. */
const triangular = (u) => (u < 0.5 ? Math.sqrt(2 * u) / 2 : 1 - Math.sqrt(2 * (1 - u)) / 2);

const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

/** Shortest and longest distance from point `p` to box `b`. */
function boxDistances(b, p) {
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y), dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
  const fx = Math.max(Math.abs(p.x - b.min.x), Math.abs(p.x - b.max.x)), fy = Math.max(Math.abs(p.y - b.min.y), Math.abs(p.y - b.max.y)), fz = Math.max(Math.abs(p.z - b.min.z), Math.abs(p.z - b.max.z));
  return [Math.hypot(dx, dy, dz), Math.hypot(fx, fy, fz)];
}

/**
 * A forest of `LeafTree`s (or `StylizedTree`s, see `treeType`) you can fly over: the illusion of a huge forest,
 * with real trees only where the player can see the difference.
 *
 * Tiers by distance from the camera (all distances in world units):
 *  1. 3D trees: a handful of tree VARIANTS (different seeds), each built at
 *     several `levels` of detail and drawn as `InstancedMesh`es. Only these
 *     cast shadows (the nearest level).                    0 .. impostorDistance
 *  2. Impostors: pictures of the variants taken from 8 x 4 directions (also
 *     from above), one camera-facing quad per tree, all trees in ONE draw
 *     call. Lit like the real trees (baked normals).       .. canopyDistance
 *  3. Canopy: a single mesh following the crowns (domes per tree) wearing
 *     the hand-drawn `canopy` texture (treetops seen from above). .. maxDistance
 * Between tiers trees dissolve into each other (dithered over `fade` of the
 * distance) instead of popping.
 *
 * The forest is split into square chunks (`chunkSize`): `update(camera)` only
 * looks at single trees in chunks near the camera, so the CPU cost depends on
 * what is near, not on the size of the forest. Impostors and canopy never
 * change on the CPU. Call `update(camera)` once per frame; it does nothing
 * while camera and forest stay put.
 *
 * Options (all optional):
 *  - count: number of trees (default 1000), area: side of the square area, centred on the model (default 160; `size` stays the uniform scale of every model)
 *  - treeType: 'leaf' (`LeafTree`, default) or 'stylized' (`StylizedTree`: blob core + leaf cards, far cheaper)
 *  - variants: distinct trees built (default 6), seed (as for every model: same seed, same forest)
 *  - complexity: complexity of the nearest 3D trees (stylized 0..10, leaf 0..MAX_TREE_COMPLEXITY); the farther level follows
 *    from it (stylized: the same tree `lowPoly`, leaf: complexity - 4). Default: the type's default levels
 *  - levels: [{complexity, leafSize, lowPoly}] detail levels, best first (overrides `complexity`; default `FOREST_LEVELS`,
 *    or `STYLIZED_FOREST_LEVELS` for stylized trees)
 *  - lodDistances: distances where the next 3D level starts (default [12]); `lod: false` keeps level 0 for all 3D trees
 *  - impostors: draw far trees as impostors (default true), impostorDistance (default 25: where real trees end and impostors start), impostorResolution (pixels per picture, default 128)
 *  - canopy: draw the farthest part as a canopy surface (default true), canopyDistance (default 600: where impostors end)
 *  - maxDistance: nothing is drawn beyond (default Infinity: use your camera's far plane / fog)
 *  - fade: width of the cross-fade band as a fraction of the distance (default 0.12, 0 = hard switch)
 *  - detail: factor (0.2 .. 1) on `lodDistances` and `impostorDistance`, see `adaptDetail()`
 *  - chunkSize: side of the culling chunks (default 32)
 *  - shadows: the nearest level casts shadows (default true)
 *  - treeOptions: passed to every tree (leafType, trunkColor, textures, ...)
 *  - textures: { canopy: 0..4 } pins the canopy texture (default: the leaf colourway of the first variant)
 *  - heightAt(x, z): ground height for each tree and the canopy (default flat 0)
 *  - minScale, maxScale: random tree size range (default 0.7 .. 1.35, medium sizes most common)
 *  - sizeVariety: how much the variants differ in trunk height and thickness (default 1, 0 = as the seeds make them):
 *    the variants are spread over tall and slender, short and stout trees, so the forest is no plantation
 *  - renderer: your WebGLRenderer, used to bake the impostors (otherwise a temporary one is used)
 *
 * Without WebGL (Node) nothing is baked: impostors have no pictures, the rest
 * (placements, chunks, canopy shape, `stats`) works the same. Colliders: one
 * box over the whole area (tag 'forest'); use `getPlacements()` for per-tree
 * positions.
 */
export class Forest extends WorldModel {
  declare _canopyTriangles: any;
  declare _chunks: any;
  declare _detail: any;
  declare _fadeMaterials: any;
  declare _forestBox: any;
  declare _impostorsReady: any;
  declare _leafVariants: any;
  declare _levelCount: any;
  declare _levelRanges: any;
  declare _ownedGeometries: any;
  declare _seen: any;
  declare _shared: any;
  declare _treeTextures: any;
  declare _treeVariants: any;
  declare _trees: any;
  declare _variantColors: any;
  declare _variants: any;
  declare areaSize: any;
  declare bounds: any;
  declare canopy: any;
  declare canopyDistance: any;
  declare canopyMesh: any;
  declare chunkCount: any;
  declare fade: any;
  declare impostorAtlas: any;
  declare impostorDistance: any;
  declare impostorMesh: any;
  declare impostors: any;
  declare lod: any;
  declare lodDistances: any;
  declare treeType: any;
  declare levels: any;
  declare maxDistance: any;
  declare random: any;
  declare seed: any;
  declare stats: any;
  declare viewBox: any;
  constructor(options: any = {}) {
    super('Forest', options);
    const {
      count = 1000, area = 160, variants = 6, treeType = 'leaf', complexity = null, levels: levelsOption = null, lodDistances = [12], lod = true,
      impostors = true, impostorDistance = 25, impostorResolution = 128, canopy = true, canopyDistance = 600,
      maxDistance = Infinity, fade = 0.12, detail = 1, chunkSize = 32,
      shadows = true, treeOptions = {}, heightAt = null, minScale = 0.7, maxScale = 1.35, sizeVariety = 1, renderer = null,
    } = options;
    this.count = WorldModel.clampInt(count, 0, 200000, 1000);
    this.treeType = FOREST_TREE_TYPES[treeType] ? treeType : 'leaf';
    const type = FOREST_TREE_TYPES[this.treeType];
    const { Tree } = type;
    const levels = levelsOption
      ?? (complexity === null || complexity === undefined ? type.levels : type.levelsFor(WorldModel.clampInt(complexity, 0, type.max, type.levels[0].complexity)));
    this.levels = levels;
    this.areaSize = area;
    this.lodDistances = lodDistances;
    this.lod = lod;
    this.impostors = impostors;
    this.impostorDistance = impostorDistance;
    this.canopy = canopy;
    this.canopyDistance = canopyDistance;
    this.maxDistance = maxDistance;
    this.fade = fade;
    this._detail = 1;
    this.detail = detail;
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
        x, y: heightAt ? heightAt(x, z) : 0, z, yaw: rnd() * Math.PI * 2, scale: minScale + triangular(rnd()) * (maxScale - minScale), variant,
      });
    }

    // Variants x levels: build a real tree, keep only its merged meshes (with fading copies of its materials).
    this._levelRanges = levels.map(() => rangeUniform());
    this._fadeMaterials = new Map();
    const fadeOf = (mat, l) => {
      const key = `${mat.uuid}:${l}`;
      if (!this._fadeMaterials.has(key)) this._fadeMaterials.set(key, fadeMaterial(mat, this._levelRanges[l]));
      return this._fadeMaterials.get(key);
    };
    this._treeVariants = [];
    const bakeInput = [];
    const variety = Math.max(0, Number(sizeVariety) || 0);
    const offset = hash01(this.seed);
    for (let v = 0; v < nVariants; v++) {
      const seed = (this.seed + Math.imul(v + 1, 0x9e3779b1)) >>> 0;
      // Size class of the variant: spread evenly (golden ratio) from short and stout to tall. Stylized
      // trees take it as their `stature`, other trees as factors on trunk height and thickness.
      const cls = (offset + v * 0.618034) % 1;
      let sized: any = {};
      if (variety > 0 && type.stature) sized = { stature: 0.5 + variety * (cls - 0.5) };
      else if (variety > 0) {
        const tall = 1 + variety * (cls * 0.7 - 0.3);
        sized = {
          trunkHeight: (treeOptions.trunkHeight ?? 1) * tall,
          trunkThickness: (treeOptions.trunkThickness ?? 1) * Math.sqrt(tall) * (1 + variety * (hash01(seed) * 0.45 - 0.2)),
        };
      }
      const box = new Box3();
      let crown = null;
      let sources = null;
      const lvls = levels.map((level, l) => {
        const tree = new Tree({ ...treeOptions, ...level, ...sized, seed, leafSize: (treeOptions.leafSize ?? 1) * (level.leafSize ?? 1) });
        this._ownedGeometries.push(...tree._ownedGeometries);
        tree._ownedGeometries.length = 0;
        const srcMeshes = tree.children.filter((o: any) => o.isMesh) as any[];
        if (l === 0) {
          sources = srcMeshes;
          crown = tree._shapes.find((s) => s.tag === 'crown');
          if (v === 0) this._treeTextures = tree.textureVariants();
          this._leafVariants ??= [];
          this._leafVariants[v] = tree.textureVariants().leaf ?? tree.textureVariants().foliage;
        }
        const meshes = srcMeshes.map((src) => {
          const mesh = new InstancedMesh(src.geometry, fadeOf(src.material, l), perVariant[v]);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false; // instances are culled one by one in update()
          mesh.castShadow = shadows && l === 0;
          if (src.customDepthMaterial) mesh.customDepthMaterial = src.customDepthMaterial; // billboarded leaf cards
          mesh.receiveShadow = true;
          if (l === 0) { src.geometry.computeBoundingBox(); box.union(src.geometry.boundingBox); }
          return mesh;
        });
        return { meshes, triangles: meshes.reduce((t, m) => t + trianglesOf(m), 0), slot: 0 };
      });
      if (perVariant[v] > 0) lvls.forEach((lv) => lv.meshes.forEach((m) => this.add(m)));
      // Sphere around the tree, centred on the trunk axis, so it holds the tree whichever way it turns.
      const cy = box.getCenter(_c).y;
      let r2 = 0;
      for (const src of sources) {
        const p = src.geometry.attributes.position;
        const reach = src.geometry.userData.cardReach ?? 0; // leaf cards turn to the camera
        for (let i = 0; i < p.count; i++) r2 = Math.max(r2, (Math.sqrt(p.getX(i) ** 2 + (p.getY(i) - cy) ** 2 + p.getZ(i) ** 2) + reach) ** 2);
      }
      const radius = Math.sqrt(r2) * 1.02;
      const spread = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
      const crownR = crown ? crown.data.radius : spread;
      const crownY = crown ? crown.position[1] : cy;
      this._treeVariants.push({
        levels: lvls, cy, radius, top: box.max.y,
        crown: { top: box.max.y, radius: crownR, depth: Math.max(1, box.max.y - crownY) },
      });
      bakeInput.push({ meshes: sources, centreY: cy, radius });
    }

    // Chunks: trees sorted into a grid; each chunk knows the box around its trees.
    const chunk = Math.max(4, chunkSize);
    const nc = Math.max(1, Math.ceil(area / chunk));
    const chunkMap = new Map();
    this._trees.forEach((t, i) => {
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((t.x + area / 2) / chunk)));
      const cz = Math.min(nc - 1, Math.max(0, Math.floor((t.z + area / 2) / chunk)));
      const key = cz * nc + cx;
      if (!chunkMap.has(key)) chunkMap.set(key, { trees: [], box: new Box3() });
      const ch = chunkMap.get(key);
      ch.trees.push(i);
      const tv = this._treeVariants[t.variant];
      const r = tv.radius * t.scale;
      ch.box.expandByPoint(_p.set(t.x - r, t.y, t.z - r));
      ch.box.expandByPoint(_p.set(t.x + r, t.y + tv.top * t.scale, t.z + r));
    });
    this._chunks = [...chunkMap.values()];
    this.chunkCount = this._chunks.length;

    const forestBox = new Box3();
    this._chunks.forEach((ch) => forestBox.union(ch.box));
    if (forestBox.isEmpty()) forestBox.set(new Vector3(-area / 2, 0, -area / 2), new Vector3(area / 2, 12, area / 2));
    this._forestBox = forestBox;

    // Uniforms shared by impostors and canopy (camera in forest space, forest scale).
    this._shared = { camera: { value: new Vector3() }, scale: { value: 1 }, range: rangeUniform(), canopyRange: rangeUniform() };

    // Impostor atlas (needs WebGL) and the average colour of each variant (for the canopy).
    let atlas = null;
    // Without WebGL nothing is drawn anyway; impostors still take part in the selection (stats, tests).
    this._impostorsReady = !canBake();
    if (impostors && canBake()) {
      try {
        atlas = bakeImpostors(bakeInput, { renderer, frameSize: impostorResolution });
        this._impostorsReady = true;
      } catch (err) {
        console.warn('3JS-Models: baking forest impostors failed, far trees stay 3D.', err);
        this.impostors = false;
      }
    }
    this.impostorAtlas = atlas;
    const leafColor = treeOptions.leafColor;
    this._variantColors = this._treeVariants.map((_, v) => atlas?.means[v]
      ?? (leafColor !== undefined && leafColor !== null ? new Color(leafColor) : fallbackColor('leaf', this._leafVariants[v] ?? 0)));
    this.impostorMesh = createImpostors(this._trees, bakeInput.map(({ centreY, radius }) => ({ centreY, radius })), atlas, this._shared, this._variantColors[0]);
    this.impostorMesh.visible = false;
    this.add(this.impostorMesh);

    // Canopy: one mesh over the crowns, wearing the canopy texture in the colourway of the leaves.
    const pinned = options.textures?.canopy ?? treeOptions.textures?.canopy;
    const canopyVariant = Number.isInteger(pinned) && pinned >= 0 && pinned < TEXTURE_VARIANTS ? pinned : (this._leafVariants?.[0] ?? 0);
    this._variants.canopy = canopyVariant;
    const spacing = area / Math.max(1, Math.sqrt(this.count));
    const canopyGeo = canopyGeometry(this._trees, this._treeVariants.map((tv) => tv.crown), this._variantColors, {
      area, cell: Math.min(8, Math.max(1.5, spacing * 0.75)), ground: heightAt ?? (() => 0),
    });
    this._ownedGeometries.push(canopyGeo, this.impostorMesh.geometry);
    this.canopyMesh = createCanopy(canopyGeo, canopyVariant, this._shared);
    this.canopyMesh.visible = false;
    this.add(this.canopyMesh);
    this._canopyTriangles = trianglesOf(this.canopyMesh);

    this.bounds = new Box3(new Vector3(-area / 2, 0, -area / 2), new Vector3(area / 2, 12, area / 2));
    this.viewBox = new Box3(new Vector3(-30, 0, -30), new Vector3(30, 12, 30)); // a good first camera view
    this.addShape('box', { size: [area, 1, area] }, [0, 0.5, 0], null, 'forest');
    this.stats = {
      trees: this.count, visible: 0, levels: levels.map(() => 0), impostors: 0, canopy: false, triangles: 0, drawCalls: 0, detail: this._detail, chunks: 0,
    };
    this._seen = new Float64Array(48);
    this._levelCount = levels.length;
    this.invalidate();
  }

  /**
   * Factor (0.2 .. 1) on the 3D distances (`lodDistances`, `impostorDistance`):
   * lower it on slow devices, e.g. with `adaptDetail(fps)`.
   */
  get detail() { return this._detail; }

  set detail(value) {
    const d = Math.min(1, Math.max(0.2, Number.isFinite(value) ? value : 1));
    if (d !== this._detail) { this._detail = d; this.invalidate?.(); }
  }

  /**
   * Adjust `detail` to the measured frame rate: lowers it while `fps` is below
   * `target`, raises it slowly again when there is room. Call it every
   * half second or so with the fps you measured. Returns the new detail.
   */
  adaptDetail(fps, target = 50) {
    if (fps < target * 0.92) this.detail = this._detail * 0.88;
    else if (fps > target * 1.12 && this._detail < 1) this.detail = Math.min(1, this._detail * 1.04);
    return this._detail;
  }

  /** The textures of the trees (first variant) and the canopy, as `{kind: variant}`. */
  textureVariants() {
    return { ...this._treeTextures, canopy: this._variants.canopy };
  }

  /** Per-tree placements: [{x, y, z, yaw, scale, variant}] in forest-local space. */
  getPlacements() {
    return this._trees.map((t) => ({ ...t }));
  }

  /** Force the next `update()` to redo everything (after moving trees, toggling `lod`, ...). */
  invalidate() {
    this._seen?.fill(NaN);
  }

  /**
   * Where each tier starts and ends for the current options and `detail`:
   * { levels: [[near, far]], impostors: [near, far] | null, canopy: [near, far] | null }.
   */
  ranges() {
    const k = this._detail;
    const max = this.maxDistance;
    const canopyStart = this.canopy ? Math.min(this.canopyDistance, max) : null;
    const useImpostors = this.impostors && this._impostorsReady;
    const end3d = Math.min(useImpostors ? this.impostorDistance * k : (canopyStart ?? max), canopyStart ?? max, max);
    const used = this.lod ? this._levelCount : 1;
    const bounds = [null];
    for (let l = 1; l < used; l++) bounds.push(Math.min(end3d, (this.lodDistances[l - 1] ?? Infinity) * k));
    bounds.push(end3d);
    const levels = Array.from({ length: this._levelCount }, (_, l) => (l < used ? [bounds[l], bounds[l + 1]] : null));
    const impostors = useImpostors ? [end3d, canopyStart ?? max] : null;
    return { levels, impostors, canopy: canopyStart === null ? null : [canopyStart, max] };
  }

  /** Pick tier and level of every tree for `camera`. Cheap to call every frame. */
  update(camera) {
    camera.updateMatrixWorld();
    this.updateWorldMatrix(true, false);
    const seen = this._seen;
    const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements, w = this.matrixWorld.elements;
    let same = true;
    for (let i = 0; i < 16 && same; i++) same = seen[i] === a[i] && seen[i + 16] === b[i] && seen[i + 32] === w[i];
    if (same) return;
    for (let i = 0; i < 16; i++) { seen[i] = a[i]; seen[i + 16] = b[i]; seen[i + 32] = w[i]; }

    // Everything below happens in forest space; distances are scaled to world units by k.
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _frustum.setFromProjectionMatrix(_pv);
    _inv.copy(this.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
    const k = this.matrixWorld.getMaxScaleOnAxis();
    this._shared.camera.value.copy(_cam);
    this._shared.scale.value = k;

    const fade = Math.max(0, this.fade);
    const R = this.ranges();
    R.levels.forEach((r, l) => setRange(this._levelRanges[l], r ? r[0] : 0, r ? r[1] : 0, fade));
    if (R.impostors) setRange(this._shared.range, R.impostors[0], R.impostors[1], fade);
    if (R.canopy) setRange(this._shared.canopyRange, R.canopy[0], R.canopy[1], fade);
    const end3d = R.levels.reduce((m, r) => (r ? Math.max(m, r[1]) : m), 0);
    const reach3d = end3d * (1 + fade / 2);
    const imp = R.impostors && this._shared.range;
    const impLo = R.impostors ? R.impostors[0] * (1 - fade / 2) : 0;
    const impHi = R.impostors ? R.impostors[1] * (1 + fade / 2) : 0;

    const counts = this.stats.levels.fill(0);
    let visible = 0, triangles = 0, impostors = 0, chunks = 0;
    for (const v of this._treeVariants) v.levels.forEach((lv) => { lv.slot = 0; });
    const levelRanges = this._levelRanges;
    const used = R.levels.map((r) => !!r && r[1] > r[0] - 1e-9);

    for (const ch of this._chunks) {
      const [near, far] = boxDistances(ch.box, _cam);
      const dNear = near * k, dFar = far * k;
      const has3d = dNear < reach3d;
      const hasImp = imp && dNear < impHi && dFar >= impLo;
      if (!has3d && !hasImp) continue;
      if (!_frustum.intersectsBox(ch.box)) continue;
      chunks++;
      for (const i of ch.trees) {
        const t = this._trees[i];
        const d = k * Math.hypot(t.x - _cam.x, t.y - _cam.y, t.z - _cam.z);
        if (hasImp && inRange(imp, d)) impostors++;
        if (!has3d || d >= reach3d) continue;
        const variant = this._treeVariants[t.variant];
        _sphere.center.set(t.x, t.y + variant.cy * t.scale, t.z);
        _sphere.radius = variant.radius * t.scale;
        if (!_frustum.intersectsSphere(_sphere)) continue;
        let drawn = false;
        for (let l = 0; l < levelRanges.length; l++) {
          if (!used[l] || !inRange(levelRanges[l], d)) continue;
          const lv = variant.levels[l];
          if (!drawn) _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(_yAxis, t.yaw), _s.setScalar(t.scale));
          for (const mesh of lv.meshes) mesh.setMatrixAt(lv.slot, _m);
          lv.slot++;
          counts[l]++;
          triangles += lv.triangles;
          drawn = true;
        }
        if (drawn) visible++;
      }
    }

    let drawCalls = 0;
    for (const v of this._treeVariants) {
      for (const lv of v.levels) {
        for (const mesh of lv.meshes) {
          mesh.count = lv.slot;
          mesh.visible = lv.slot > 0;
          mesh.instanceMatrix.needsUpdate = true;
          if (lv.slot > 0) drawCalls++;
        }
      }
    }
    const [fNear, fFar] = boxDistances(this._forestBox, _cam);
    const inView = _frustum.intersectsBox(this._forestBox);
    this.impostorMesh.visible = !!imp && inView && impostors > 0;
    if (this.impostorMesh.visible) { drawCalls++; triangles += impostors * 2; }
    const canopyLo = R.canopy ? R.canopy[0] * (1 - fade / 2) : 0;
    this.canopyMesh.visible = !!R.canopy && inView && fFar * k >= canopyLo && fNear * k < (R.canopy?.[1] ?? 0) * (1 + fade / 2);
    if (this.canopyMesh.visible) { drawCalls++; triangles += this._canopyTriangles; }
    Object.assign(this.stats, { visible, impostors, canopy: this.canopyMesh.visible, triangles, drawCalls, detail: this._detail, chunks });
  }

  dispose() {
    (this.children as any[]).filter((o) => o.isInstancedMesh).forEach((m) => m.dispose());
    this._fadeMaterials.forEach((m) => m.dispose());
    this._fadeMaterials.clear();
    this.impostorMesh.material.dispose();
    this.canopyMesh.material.dispose();
    this.impostorAtlas?.color.dispose();
    this.impostorAtlas?.normal.dispose();
    super.dispose();
  }
}
