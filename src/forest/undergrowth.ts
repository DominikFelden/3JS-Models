import { Group, Vector3, Box3 } from 'three';
import { mulberry32 } from '../WorldModel.ts';
import { Bush } from '../models/Bush.ts';
import { Fern, Bracken, TallGrass, Hosta } from '../models/Plants.ts';
import { fadeMaterial, rangeUniform, rangeBand, setRange } from './fade.ts';
import { InstanceBuffer, START_CAPACITY } from './instances.ts';

/**
 * Plants of a forest floor: the kinds, their share of all plants, a size factor and how far they
 * are drawn (`distance`: factor on the undergrowth's `distance`). Ferns and grass fill the ground,
 * bushes and bracken give it height. Low plants end sooner: from afar they are a few pixels of
 * green on green ground. `far`: options of a cheaper copy of the kind (same seed, same plant),
 * drawn from the undergrowth's `lodDistance` on. Bushes have one: with hundreds of leaf cards they
 * are by far the costliest plants.
 */
export const UNDERGROWTH_TYPES: { Plant: any, share: number, scale: [number, number], distance: number, far?: object }[] = [
  { Plant: Fern, share: 0.32, scale: [0.8, 1.4], distance: 0.85 },
  { Plant: TallGrass, share: 0.22, scale: [0.8, 1.3], distance: 0.7 },
  { Plant: Bush, share: 0.2, scale: [0.7, 1.4], distance: 1, far: { lowPoly: true } },
  { Plant: Bracken, share: 0.14, scale: [0.8, 1.3], distance: 1 },
  { Plant: Hosta, share: 0.12, scale: [0.8, 1.4], distance: 0.7 },
];

/** One detail level of a plant kind: the distances it is drawn at, as a range uniform (shaders) and as `band` (CPU). */
type KindLevel = { id: number, range: { value: any }, band: { lo: number, hi: number }, used: boolean };
/** A plant kind: its config, the index of its first variant, its levels and how far any of them reaches (world units). */
type Kind = { first: number, config: any, levels: KindLevel[], reach: number };
/** One seed variant of a kind: its instances and bounding radius at each level of the kind, and the sphere around all levels (centre `cy` above the base). */
type Variant = { kind: Kind, cy: number, radius: number, levels: { buffer: InstanceBuffer, triangles: number, radius: number }[] };
/** The plants in one cell of the grid, the box around them and its distance to the camera (this frame). */
type Chunk = { plants: number[], box: Box3, near: number };

const _p = new Vector3();
const _sphere = { center: new Vector3(), radius: 0 };
const byNear = (a: Chunk, b: Chunk) => a.near - b.near;

/** No plant grows closer than this to a tree trunk (world units). */
const TRUNK_CLEARANCE = 0.8;

/** Map key of grid cell (`cx`, `cz`): one number instead of a string (unique while |cx|, |cz| < 32768). */
const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

/**
 * Thousands of ferns, bracken, grass tufts, broadleaf plants and bushes between the trees of a
 * `Forest`, cheap enough for a phone. A few seed variants of every kind are built once and drawn
 * as `InstancedMesh`es, one per mesh of a variant (a fern is ONE draw call, a bush two), which
 * share one instance buffer sized for what is drawn (see `InstanceBuffer`). Plants are small, so
 * there is no impostor tier: they exist up to `distance` (low kinds less far, see
 * `UNDERGROWTH_TYPES`) and dissolve into the ground with the dithered fade of the forest tiers.
 * Bushes turn into a cheaper copy of themselves at `lodDistance`, with the same cross-fade
 * (`Forest.detail` shortens both distances on slow devices). Plants are sorted into a grid of
 * square chunks (`chunkSize`); only the cells within reach of the camera are looked at, so the
 * CPU cost depends on what is near, not on how many plants there are.
 *
 * With `shadows` every plant casts a simple shadow: an invisible 20-triangle body drawn only into
 * shadow maps (bushes: the cores of the near ones). Without it these bodies are not even created.
 *
 * Options: count (default 2000), area (side of the square, centred), seed, variants (per kind,
 * default 3), distance (default 60), lodDistance (default 25), fade (default 0.15), chunkSize
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
  declare _grid: { size: number, nc: number, origin: number, chunks: (Chunk | null)[] };
  declare _near: Chunk[];
  declare _geometries: any[];
  declare _fadeMaterials: Map<string, any>;
  constructor({
    count = 2000, area = 160, seed = 1, variants = 3, distance = 60, lodDistance = 25, fade = 0.15, chunkSize = 16, shadows = false, heightAt = null, avoid = [], plantOptions = {},
  }: any = {}) {
    super();
    this.name = 'Undergrowth';
    this.distance = distance;
    this.lodDistance = lodDistance;
    this.fade = fade;
    this._geometries = [];
    this._fadeMaterials = new Map();
    const rnd = mulberry32(seed >>> 0);

    // Variants: `variants` seeds of every kind, in one flat list with the kind they belong to. A kind
    // with a `far` copy has two levels, both built from the variant's seed: the plant and its copy.
    const nVariants = Math.max(1, Math.round(variants));
    this._kinds = [];
    const built: { kind: Kind, plants: any[] }[] = [];
    let levelId = 0;
    for (const config of UNDERGROWTH_TYPES) {
      const levelOptions = config.far ? [{}, config.far] : [{}];
      const levels = levelOptions.map(() => ({ id: levelId++, range: rangeUniform(), band: { lo: 0, hi: 0 }, used: false }));
      const kind: Kind = { first: built.length, config, levels, reach: 0 };
      this._kinds.push(kind);
      for (let v = 0; v < nVariants; v++) {
        const plantSeed = (seed + Math.imul(built.length + 1, 0x9e3779b1)) >>> 0;
        built.push({ kind, plants: levelOptions.map((o) => new config.Plant({ ...plantOptions, ...o, seed: plantSeed })) });
      }
    }

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
    const perVariant = new Array(built.length).fill(0);
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

    // Draw materials: fading copies of the plants' own, one per level of a kind (each level fades at
    // its own distances), shared by all variants of the kind.
    const fadeOf = (mat, level: KindLevel) => {
      const key = `${mat.uuid}:${level.id}`;
      if (!this._fadeMaterials.has(key)) this._fadeMaterials.set(key, fadeMaterial(mat, level.range));
      return this._fadeMaterials.get(key);
    };
    this._variants = built.map(({ kind, plants }, v) => {
      const meshesOf = plants.map((plant) => {
        this._geometries.push(...plant._ownedGeometries);
        plant._ownedGeometries.length = 0;
        return (plant.children as any[]).filter((o) => o.isMesh);
      });
      // Spheres centred on the plant's axis, so they hold the plant whichever way it turns: one per
      // level (for culling) and one around all levels (for the chunk boxes).
      const box = new Box3();
      for (const src of meshesOf[0]) { src.geometry.computeBoundingBox(); box.union(src.geometry.boundingBox); }
      const cy = box.getCenter(_p).y;
      const radiusOf = (sources) => {
        let r2 = 0;
        for (const src of sources) {
          const pos = src.geometry.attributes.position;
          const reach = src.geometry.userData.cardReach ?? 0; // leaf cards turn to the camera
          for (let i = 0; i < pos.count; i++) r2 = Math.max(r2, (Math.sqrt(pos.getX(i) ** 2 + (pos.getY(i) - cy) ** 2 + pos.getZ(i) ** 2) + reach) ** 2);
        }
        return Math.sqrt(r2) * 1.02;
      };
      const levels = meshesOf.map((sources, l) => {
        const buffer = new InstanceBuffer(Math.min(START_CAPACITY, perVariant[v]));
        let triangles = 0;
        for (const src of sources) {
          const shadowOnly = !!src.userData.shadowOnly;
          if (shadowOnly && !shadows) continue; // an invisible shadow caster is of no use without shadows
          const mesh = buffer.addMesh(src.geometry, fadeOf(src.material, kind.levels[l]), {
            castShadow: shadows && l === 0 && src.castShadow, // as with trees, only the nearest level casts shadows
            receiveShadow: src.receiveShadow,
            shadowOnly,
          });
          if (!shadowOnly) triangles += trianglesOf(mesh);
          if (perVariant[v] > 0) this.add(mesh);
        }
        return { buffer, triangles, radius: radiusOf(sources) };
      });
      return { kind, cy, radius: Math.max(...levels.map((lv) => lv.radius)), levels };
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
      ch.box.expandByPoint(_p.set(t.x + r, t.y + (v.cy + v.radius) * t.scale, t.z + r));
    });
    this._grid = { size, nc, origin: -area / 2, chunks };
    this._near = [];
    this.stats = { visible: 0, triangles: 0, drawCalls: 0 };
  }

  /**
   * Choose the plants to draw. `camera`: camera position in forest space, `k`: forest scale (world
   * units per forest unit), `frustum`: view frustum in forest space, `detail`: factor on the distances.
   */
  update(camera: Vector3, k: number, frustum, detail = 1) {
    // Distances of every kind and level (world units): set in their shaders, read back as `band`s.
    const lodAt = Number.isFinite(this.lodDistance) ? this.lodDistance * detail : Infinity;
    let reach = 0;
    for (const kind of this._kinds) {
      const far = this.distance * detail * kind.config.distance;
      const [near, farCopy] = kind.levels;
      const split = !!farCopy && far > lodAt + 1e-9; // the far copy only exists if it starts before the plants end
      setRange(near.range, null, split ? lodAt : far, this.fade);
      near.used = true;
      if (farCopy) {
        farCopy.used = split;
        if (split) setRange(farCopy.range, lodAt, far, this.fade);
      }
      kind.reach = 0;
      for (const level of kind.levels) {
        if (!level.used) { level.band.lo = level.band.hi = 0; continue; } // drawn at no distance
        rangeBand(level.range, level.band);
        kind.reach = Math.max(kind.reach, level.band.hi);
      }
      reach = Math.max(reach, kind.reach);
    }

    for (const v of this._variants) for (const lv of v.levels) lv.buffer.reset();
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
          _sphere.center.set(t.x, t.y + v.cy * t.scale, t.z);
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
          if (drawn) visible++;
        }
      }
    }
    let drawCalls = 0;
    for (const v of this._variants) for (const lv of v.levels) drawCalls += lv.buffer.commit();
    const { stats } = this;
    stats.visible = visible;
    stats.triangles = triangles;
    stats.drawCalls = drawCalls;
  }

  dispose() {
    for (const v of this._variants) for (const lv of v.levels) lv.buffer.meshes.forEach((m) => m.dispose());
    this._fadeMaterials.forEach((m) => m.dispose());
    this._fadeMaterials.clear();
    this._geometries.forEach((g) => g.dispose());
    this._geometries.length = 0;
  }
}
