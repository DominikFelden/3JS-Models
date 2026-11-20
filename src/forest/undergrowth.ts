import { Group, Vector3, Box3, Mesh, type BufferGeometry, type Material } from 'three';
import { mulberry32, type WorldModel } from '../WorldModel.ts';
import { Bush } from '../models/Bush.ts';
import { Fern, Bracken, TallGrass, Hosta } from '../models/Plants.ts';
import { fadeMaterial, rangeUniform, rangeBand, setRange } from './fade.ts';
import { bakeImpostors, PlantImpostorBatch, type ImpostorBounds } from './impostors.ts';
import { InstanceBuffer, START_CAPACITY } from './instances.ts';
import { canBake } from '../textures/bake.ts';

type PlantType = { Plant: new (options?: object) => WorldModel, share: number, scale: [number, number], distance: number, far?: object };
/**
 * Plants of a forest floor: the kinds, their share of all plants, a size factor and how far they
 * are drawn (`distance`: factor on the undergrowth's `distance`). `far` is an optional,
 * cheaper 3D copy to use if impostors are disabled or unavailable.
 */
export const UNDERGROWTH_TYPES: PlantType[] = [
  { Plant: Fern, share: 0.32, scale: [0.8, 1.4], distance: 0.85 },
  { Plant: TallGrass, share: 0.22, scale: [0.8, 1.3], distance: 0.7 },
  { Plant: Bush, share: 0.2, scale: [0.7, 1.4], distance: 1, far: { lowPoly: true } },
  { Plant: Bracken, share: 0.14, scale: [0.8, 1.3], distance: 1 },
  { Plant: Hosta, share: 0.12, scale: [0.8, 1.4], distance: 0.7 },
];

type KindLevel = { range: ReturnType<typeof rangeUniform>, band: { lo: number, hi: number } };
type Kind = { first: number, config: PlantType, levels: KindLevel[], hasFallback: boolean, reach: number };
type Variant = {
  kind: Kind, bounds: ImpostorBounds, radius: number,
  levels: { buffer: InstanceBuffer, triangles: number, radius: number }[],
};
type PlantMesh = Mesh<BufferGeometry, Material>;
/** The plants in one cell of the grid, the box around them and its distance to the camera (this frame). */
type Chunk = { plants: number[], box: Box3, near: number };

const _p = new Vector3();
const _sphere = { center: new Vector3(), radius: 0 };
const byNear = (a: Chunk, b: Chunk) => a.near - b.near;

const DEFAULT_LOD_DISTANCE = 25;
const PLANT_IMPOSTOR_BAKE = { frameSize: 48, views: { yaws: 4, elevations: 3 } };

/** No plant grows closer than this to a tree trunk (world units). */
const TRUNK_CLEARANCE = 0.8;

/** Map key of grid cell (`cx`, `cz`): one number instead of a string (unique while |cx|, |cz| < 32768). */
const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const trianglesOf = (geometry: BufferGeometry) => (geometry.index?.count ?? geometry.attributes.position.count) / 3;

/** Bounds centred on the plant's axis hold the geometry at any yaw and the leaf cards at any view. */
function plantRadius(meshes: PlantMesh[], centreY: number) {
  let r2 = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const reach = mesh.geometry.userData.cardReach ?? 0;
    for (let i = 0; i < pos.count; i++) r2 = Math.max(r2, (Math.sqrt(pos.getX(i) ** 2 + (pos.getY(i) - centreY) ** 2 + pos.getZ(i) ** 2) + reach) ** 2);
  }
  return Math.sqrt(r2) * 1.02;
}

/**
 * Thousands of ferns, bracken, grass tufts, broadleaf plants and bushes between the trees of a
 * `Forest`, cheap enough for a phone. A few seed variants of every kind are built once and drawn
 * as `InstancedMesh`es, one per mesh of a variant (a fern is ONE draw call, a bush two), which
 * share one instance buffer sized for what is drawn (see `InstanceBuffer`). From `lodDistance`
 * on, their seeded variants cross-fade to baked, lit impostors in a single batch. Bushes fall back
 * to low-poly meshes when impostors are unavailable. Plants fade out at `distance` (low kinds
 * sooner); `Forest.detail` can shorten this range without cutting into the fully detailed band.
 * Only chunks within reach are visited, and both tiers are frustum culled before submission.
 *
 * With `shadows`, nearby 3D plants cast simple shadows (frond plants use an invisible body;
 * bushes use their cores). Impostors don't cast or receive shadow maps.
 *
 * Options: count (default 2000), area (side of the square, centred), seed, variants (per kind,
 * default 3), distance (default 60), lodDistance (default 25, Infinity disables plant LOD),
 * impostors (default true), renderer (optional WebGLRenderer for baking), fade (default 0.15), chunkSize
 * (default 16), shadows (plants cast shadows, default false: they are small and numerous),
 * heightAt(x, z), avoid ([{x, z}] trunks to keep clear of), plantOptions (passed to every plant,
 * e.g. leafColor).
 * `update()` is called by the `Forest` with the camera in forest space.
 */
export class Undergrowth extends Group {
  declare count: number;
  declare distance: number;
  declare lodDistance: number;
  declare fade: number;
  declare stats: { visible: number, triangles: number, drawCalls: number };
  declare _plants: { x: number, y: number, z: number, yaw: number, scale: number, variant: number }[];
  declare _kinds: Kind[];
  declare _variants: Variant[];
  declare _impostors: PlantImpostorBatch | null;
  declare _grid: { size: number, nc: number, origin: number, chunks: (Chunk | null)[] };
  declare _near: Chunk[];
  declare _geometries: BufferGeometry[];
  declare _fadeMaterials: Map<string, Material>;
  constructor({
    count = 2000, area = 160, seed = 1, variants = 3, distance = 60, lodDistance = DEFAULT_LOD_DISTANCE, fade = 0.15,
    chunkSize = 16, shadows = false, heightAt = null, avoid = [], plantOptions = {}, impostors = true, renderer = null,
  }: any = {}) {
    super();
    this.name = 'Undergrowth';
    this.distance = distance;
    this.lodDistance = lodDistance;
    this.fade = Math.min(1, Math.max(0, fade));
    this._geometries = [];
    this._fadeMaterials = new Map();
    const rnd = mulberry32(seed >>> 0);

    const nVariants = Math.max(1, Math.round(variants));
    this._kinds = UNDERGROWTH_TYPES.map((config, index) => ({
      first: index * nVariants, config, hasFallback: false, reach: 0,
      levels: Array.from({ length: 2 }, () => ({ range: rangeUniform(), band: { lo: 0, hi: 0 } })),
    }));

    // Placement: random, but never on a trunk. Trunks are looked up in a grid of 4-unit cells.
    const cell = 4;
    const trunks = new Map<number, { x: number, z: number }[]>();
    for (const t of avoid) {
      const key = cellKey(Math.floor(t.x / cell), Math.floor(t.z / cell));
      const list = trunks.get(key);
      if (list) list.push(t);
      else trunks.set(key, [t]);
    }
    const nearTrunk = (x, z) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = trunks.get(cellKey(cx + i, cz + j));
        if (list) for (const t of list) if (Math.hypot(t.x - x, t.z - z) < TRUNK_CLEARANCE) return true;
      }
      return false;
    };
    const total = this._kinds.reduce((s, k) => s + k.config.share, 0);
    this._plants = [];
    const perVariant = new Array(this._kinds.length * nVariants).fill(0);
    for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 4; tries++) {
        x = (rnd() - 0.5) * area; z = (rnd() - 0.5) * area;
        if (!nearTrunk(x, z)) break;
      }
      let pick = rnd() * total, kind = this._kinds[this._kinds.length - 1];
      for (const k of this._kinds) { pick -= k.config.share; if (pick < 0) { kind = k; break; } }
      const variant = kind.first + Math.floor(rnd() * nVariants);
      const [lo, hi] = kind.config.scale;
      perVariant[variant]++;
      this._plants.push({ x, y: heightAt ? heightAt(x, z) : 0, z, yaw: rnd() * Math.PI * 2, scale: lo + rnd() * (hi - lo), variant });
    }
    this.count = this._plants.length;

    const takeMeshes = (plant: WorldModel) => {
      this._geometries.push(...plant._ownedGeometries);
      plant._ownedGeometries.length = 0;
      return plant.children.filter((o): o is PlantMesh => o instanceof Mesh && !Array.isArray(o.material));
    };
    // Same seeds and full-detail meshes as the plants drawn up close. Exclude shadow proxies from
    // the bake: even with colourWrite off, they'd obscure fronds in the colour/normal atlas.
    const built = this._kinds.flatMap((kind) => Array.from({ length: nVariants }, (_, v) => {
      const plantSeed = (seed + Math.imul(kind.first + v + 1, 0x9e3779b1)) >>> 0;
      const meshes = takeMeshes(new kind.config.Plant({ ...plantOptions, seed: plantSeed }));
      const box = new Box3();
      for (const mesh of meshes) { mesh.geometry.computeBoundingBox(); box.union(mesh.geometry.boundingBox); }
      const centreY = box.getCenter(_p).y;
      const bounds = { centreY, radius: plantRadius(meshes, centreY) };
      return { kind, meshes, bounds, plantSeed };
    }));
    this._impostors = null;
    const canLod = Number.isFinite(lodDistance);
    if (this.count > 0 && impostors && canLod && distance > lodDistance / (1 - this.fade / 2) && canBake()) {
      let atlas: ReturnType<typeof bakeImpostors> | undefined;
      try {
        atlas = bakeImpostors(built.map(({ meshes, bounds }) => ({
          ...bounds, meshes: meshes.filter((m) => !m.userData.shadowOnly),
        })), { renderer, ...PLANT_IMPOSTOR_BAKE });
      } catch (err) {
        console.warn('3JS-Models: baking plant impostors failed, far plants stay 3D.', err);
      }
      if (atlas) {
        this._impostors = new PlantImpostorBatch(atlas);
        this.add(this._impostors.mesh);
      }
    }

    for (const kind of this._kinds) kind.hasFallback = !this._impostors && canLod && !!kind.config.far;
    this._variants = built.map(({ kind, meshes, bounds, plantSeed }, v) => {
      const levels = [meshes];
      if (kind.hasFallback) {
        levels.push(takeMeshes(new kind.config.Plant({ ...plantOptions, ...kind.config.far, seed: plantSeed })));
      }
      const modelLevels = levels.map((sources, l) => {
        const buffer = new InstanceBuffer(Math.min(START_CAPACITY, perVariant[v]));
        let triangles = 0;
        for (const src of sources) {
          const shadowOnly = !!src.userData.shadowOnly;
          if (shadowOnly && !shadows) continue; // an invisible shadow caster is of no use without shadows
          const key = `${src.material.uuid}:${kind.first}:${l}`;
          let material = this._fadeMaterials.get(key);
          if (!material) {
            material = fadeMaterial(src.material, kind.levels[l].range);
            this._fadeMaterials.set(key, material);
          }
          const mesh = buffer.addMesh(src.geometry, material, {
            castShadow: shadows && l === 0 && src.castShadow, // as with trees, only the nearest level casts shadows
            receiveShadow: src.receiveShadow,
            shadowOnly,
          });
          if (!shadowOnly) triangles += trianglesOf(src.geometry);
          if (perVariant[v] > 0) this.add(mesh);
        }
        return { buffer, triangles, radius: l === 0 ? bounds.radius : plantRadius(sources, bounds.centreY) };
      });
      // Include the corner of the impostor's square in its culling bounds, not just its inscribed circle.
      const radius = this._impostors ? Math.SQRT2 * bounds.radius : Math.max(...modelLevels.map((lv) => lv.radius));
      return { kind, bounds, radius, levels: modelLevels };
    });

    // Chunks: plants sorted into a grid of square cells (at least area / 256 wide, so the grid stays
    // small for huge areas); each chunk knows the box around its plants. Empty cells stay null.
    const size = Math.max(4, chunkSize, area / 256);
    const nc = Math.max(1, Math.ceil(area / size));
    const chunks: (Chunk | null)[] = new Array(nc * nc).fill(null);
    this._plants.forEach((t, i) => {
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((t.x + area / 2) / size)));
      const cz = Math.min(nc - 1, Math.max(0, Math.floor((t.z + area / 2) / size)));
      const ch = (chunks[cz * nc + cx] ??= { plants: [], box: new Box3(), near: 0 });
      ch.plants.push(i);
      const v = this._variants[t.variant];
      const r = v.radius * t.scale;
      ch.box.expandByPoint(_p.set(t.x - r, t.y - r, t.z - r));
      ch.box.expandByPoint(_p.set(t.x + r, t.y + (v.bounds.centreY + v.radius) * t.scale, t.z + r));
    });
    this._grid = { size, nc, origin: -area / 2, chunks };
    this._near = [];
    this.stats = { visible: 0, triangles: 0, drawCalls: 0 };
  }

  /**
   * Choose the plants to draw. `camera`: camera position in forest space, `k`: forest scale (world
   * units per forest unit), `frustum`: view frustum in forest space, `detail`: factor on maximum range.
   */
  update(camera: Vector3, k: number, frustum, detail = 1) {
    const impostors = this._impostors;
    // setRange centers the dither band. Offset its center so the first dithered pixels appear
    // at lodDistance, and don't let Auto Detail fade out a plant before that distance.
    const fadeInset = 1 - this.fade / 2;
    const lodAt = Math.max(0, this.lodDistance) / fadeInset;
    const detailFloor = Number.isFinite(lodAt) ? lodAt : DEFAULT_LOD_DISTANCE / fadeInset;
    let reach = 0;
    for (const kind of this._kinds) {
      const limit = this.distance * kind.config.distance;
      const end = Math.min(limit, Math.max(limit * detail, detailFloor));
      const [near, far] = kind.levels;
      const split = (impostors || kind.hasFallback) && end > lodAt;
      setRange(near.range, null, split ? lodAt : end, this.fade);
      rangeBand(near.range, near.band);
      if (split) {
        setRange(far.range, lodAt, end, this.fade);
        rangeBand(far.range, far.band);
      } else {
        far.band.lo = far.band.hi = 0;
      }
      kind.reach = split ? far.band.hi : near.band.hi;
      reach = Math.max(reach, kind.reach);
    }

    for (const v of this._variants) for (const lv of v.levels) lv.buffer.reset();
    impostors?.reset(camera);
    let visible = 0, triangles = 0;
    if (reach > 0) {
      // Chunks within reach: only the grid cells around the camera are looked at. Nearest first, so
      // they are drawn front to back and the GPU skips most of the pixels hidden behind them.
      const r = reach / k;
      const { size, nc, origin, chunks } = this._grid;
      const x0 = Math.max(0, Math.floor((camera.x - r - origin) / size)), x1 = Math.min(nc - 1, Math.floor((camera.x + r - origin) / size));
      const z0 = Math.max(0, Math.floor((camera.z - r - origin) / size)), z1 = Math.min(nc - 1, Math.floor((camera.z + r - origin) / size));
      const near = this._near;
      near.length = 0;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const ch = chunks[cz * nc + cx];
          if (!ch) continue;
          ch.near = ch.box.distanceToPoint(camera);
          if (ch.near < r && frustum.intersectsBox(ch.box)) near.push(ch);
        }
      }
      near.sort(byNear);

      for (const ch of near) {
        for (const i of ch.plants) {
          const t = this._plants[i];
          const v = this._variants[t.variant];
          const dx = t.x - camera.x, dy = t.y - camera.y, dz = t.z - camera.z;
          const d = k * Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= v.kind.reach) continue;
          _sphere.center.set(t.x, t.y + v.bounds.centreY * t.scale, t.z);
          // Every level whose band holds the plant draws it (both levels while it cross-fades), if in view.
          let drawn = false;
          for (let l = 0; l < v.levels.length; l++) {
            const band = v.kind.levels[l].band;
            if (!(d >= band.lo && d < band.hi)) continue;
            const lv = v.levels[l];
            _sphere.radius = lv.radius * t.scale;
            if (!frustum.intersectsSphere(_sphere)) continue;
            lv.buffer.push(t.x, t.y, t.z, t.yaw, t.scale, _sphere.center.y, _sphere.radius);
            triangles += lv.triangles;
            drawn = true;
          }
          const far = v.kind.levels[1];
          if (impostors && d >= far.band.lo && d < far.band.hi) {
            _sphere.radius = v.radius * t.scale;
            if (frustum.intersectsSphere(_sphere)) {
              impostors.push(t, v.bounds, far.range.value);
              drawn = true;
            }
          }
          if (drawn) visible++;
        }
      }
    }
    let drawCalls = 0;
    for (const v of this._variants) for (const lv of v.levels) drawCalls += lv.buffer.commit();
    if (impostors) {
      impostors.commit();
      if (impostors.count > 0) { drawCalls++; triangles += 2 * impostors.count; }
    }
    const { stats } = this;
    stats.visible = visible;
    stats.triangles = triangles;
    stats.drawCalls = drawCalls;
  }

  dispose() {
    this._impostors?.dispose();
    for (const v of this._variants) for (const lv of v.levels) lv.buffer.meshes.forEach((m) => m.dispose());
    this._fadeMaterials.forEach((m) => m.dispose());
    this._fadeMaterials.clear();
    this._geometries.forEach((g) => g.dispose());
    this._geometries.length = 0;
  }
}
