import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, Box3, DynamicDrawUsage } from 'three';
import { mulberry32 } from '../WorldModel.ts';
import { Bush } from '../models/Bush.ts';
import { Fern, Bracken, TallGrass, Hosta } from '../models/Plants.ts';
import { fadeMaterial, rangeUniform, setRange } from './fade.ts';

/**
 * Plants of a forest floor: the kinds, their share of all plants and a size factor.
 * Ferns and grass fill the ground, bushes and bracken give it height.
 */
export const UNDERGROWTH_TYPES = [
  { Plant: Fern, share: 0.32, scale: [0.8, 1.4] },
  { Plant: TallGrass, share: 0.22, scale: [0.8, 1.3] },
  { Plant: Bush, share: 0.2, scale: [0.7, 1.4] },
  { Plant: Bracken, share: 0.14, scale: [0.8, 1.3] },
  { Plant: Hosta, share: 0.12, scale: [0.8, 1.4] },
];

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _yAxis = new Vector3(0, 1, 0);
const _sphere = { center: new Vector3(), radius: 0 };

/** No plant grows closer than this to a tree trunk (world units). */
const TRUNK_CLEARANCE = 0.8;

const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

/**
 * Thousands of ferns, bracken, grass tufts, broadleaf plants and bushes between the trees of a
 * `Forest`, cheap enough for a phone. A few seed variants of every kind are built once and drawn
 * as `InstancedMesh`es, one per mesh of a variant (a fern is ONE draw call, a bush two). Plants
 * are small, so there is no impostor tier: they exist up to `distance` and dissolve into the
 * ground with the dithered fade of the forest tiers (and `Forest.detail` shortens the distance
 * on slow devices). Plants are sorted into square chunks (`chunkSize`); only chunks near the
 * camera are looked at, so the CPU cost depends on what is near, not on how many plants there are.
 *
 * Options: count (default 2000), area (side of the square, centred), seed, variants (per kind,
 * default 3), distance (default 60), fade (default 0.15), chunkSize (default 16), shadows (plants
 * cast shadows, default false: they are small and numerous), heightAt(x, z), avoid ([{x, z}] trunks
 * to keep clear of), plantOptions (passed to every plant, e.g. leafColor).
 * `update()` is called by the `Forest` with the camera in forest space.
 */
export class Undergrowth extends Group {
  declare count: number;
  declare distance: number;
  declare fade: number;
  declare stats: { visible: number, triangles: number, drawCalls: number };
  declare _plants: { x: number, y: number, z: number, yaw: number, scale: number, variant: number }[];
  declare _variants: { cy: number, radius: number, meshes: InstancedMesh[], triangles: number, slot: number }[];
  declare _chunks: { plants: number[], box: Box3 }[];
  declare _range: { value: any };
  declare _geometries: any[];
  declare _fadeMaterials: Map<string, any>;
  constructor({
    count = 2000, area = 160, seed = 1, variants = 3, distance = 60, fade = 0.15, chunkSize = 16, shadows = false, heightAt = null, avoid = [], plantOptions = {},
  }: any = {}) {
    super();
    this.name = 'Undergrowth';
    this.distance = distance;
    this.fade = fade;
    this._range = rangeUniform();
    this._geometries = [];
    this._fadeMaterials = new Map();
    const rnd = mulberry32(seed >>> 0);

    // Variants: `variants` seeds of every kind, in one flat list with the kind they belong to.
    const nVariants = Math.max(1, Math.round(variants));
    const kinds: { first: number, config: any }[] = [];
    const built = [];
    UNDERGROWTH_TYPES.forEach((config) => {
      kinds.push({ first: built.length, config });
      for (let v = 0; v < nVariants; v++) built.push(new config.Plant({ ...plantOptions, seed: (seed + Math.imul(built.length + 1, 0x9e3779b1)) >>> 0 }));
    });

    // Placement: random, but never on a trunk. Trunks are looked up in a grid of 4-unit cells.
    const cell = 4;
    const trunks = new Map<string, { x: number, z: number }[]>();
    for (const t of avoid) {
      const key = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
      if (!trunks.has(key)) trunks.set(key, []);
      trunks.get(key).push(t);
    }
    const nearTrunk = (x, z) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const t of trunks.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < TRUNK_CLEARANCE) return true;
      }
      return false;
    };
    const total = kinds.reduce((s, k) => s + k.config.share, 0);
    this._plants = [];
    const perVariant = new Array(built.length).fill(0);
    for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 4; tries++) {
        x = (rnd() - 0.5) * area; z = (rnd() - 0.5) * area;
        if (!nearTrunk(x, z)) break;
      }
      let pick = rnd() * total, kind = kinds[kinds.length - 1];
      for (const k of kinds) { pick -= k.config.share; if (pick < 0) { kind = k; break; } }
      const variant = kind.first + Math.floor(rnd() * nVariants);
      const [lo, hi] = kind.config.scale;
      perVariant[variant]++;
      this._plants.push({ x, y: heightAt ? heightAt(x, z) : 0, z, yaw: rnd() * Math.PI * 2, scale: lo + rnd() * (hi - lo), variant });
    }
    this.count = this._plants.length;

    // Draw material: a fading copy of the plant's own, shared by every instance of it.
    const fadeOf = (mat) => {
      if (!this._fadeMaterials.has(mat.uuid)) this._fadeMaterials.set(mat.uuid, fadeMaterial(mat, this._range));
      return this._fadeMaterials.get(mat.uuid);
    };
    this._variants = built.map((plant, v) => {
      this._geometries.push(...plant._ownedGeometries);
      plant._ownedGeometries.length = 0;
      const box = new Box3();
      const meshes = plant.children.filter((o: any) => o.isMesh).map((src: any) => {
        const mesh = new InstancedMesh(src.geometry, fadeOf(src.material), perVariant[v]);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false; // instances are culled one by one in update()
        mesh.castShadow = shadows && src.castShadow;
        mesh.receiveShadow = src.receiveShadow;
        src.geometry.computeBoundingBox();
        box.union(src.geometry.boundingBox);
        if (perVariant[v] > 0) this.add(mesh);
        return mesh;
      });
      let r2 = 0;
      const cy = box.getCenter(_p).y;
      for (const mesh of meshes) {
        const pos = mesh.geometry.attributes.position;
        const reach = mesh.geometry.userData.cardReach ?? 0; // leaf cards turn to the camera
        for (let i = 0; i < pos.count; i++) r2 = Math.max(r2, (Math.sqrt(pos.getX(i) ** 2 + (pos.getY(i) - cy) ** 2 + pos.getZ(i) ** 2) + reach) ** 2);
      }
      return { cy, radius: Math.sqrt(r2) * 1.02, meshes, triangles: meshes.reduce((t, m) => t + trianglesOf(m), 0), slot: 0 };
    });

    // Chunks: plants sorted into a grid; each chunk knows the box around its plants.
    const size = Math.max(4, chunkSize);
    const nc = Math.max(1, Math.ceil(area / size));
    const chunkMap = new Map<number, { plants: number[], box: Box3 }>();
    this._plants.forEach((t, i) => {
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((t.x + area / 2) / size)));
      const cz = Math.min(nc - 1, Math.max(0, Math.floor((t.z + area / 2) / size)));
      const key = cz * nc + cx;
      if (!chunkMap.has(key)) chunkMap.set(key, { plants: [], box: new Box3() });
      const ch = chunkMap.get(key);
      ch.plants.push(i);
      const v = this._variants[t.variant];
      const r = v.radius * t.scale;
      ch.box.expandByPoint(_p.set(t.x - r, t.y - r, t.z - r));
      ch.box.expandByPoint(_p.set(t.x + r, t.y + (v.cy + v.radius) * t.scale, t.z + r));
    });
    this._chunks = [...chunkMap.values()];
    this.stats = { visible: 0, triangles: 0, drawCalls: 0 };
  }

  /**
   * Choose the plants to draw. `camera`: camera position in forest space, `k`: forest scale (world
   * units per forest unit), `frustum`: view frustum in forest space, `detail`: factor on the distance.
   */
  update(camera: Vector3, k: number, frustum, detail = 1) {
    const far = this.distance * detail;
    setRange(this._range, null, far, this.fade);
    const reach = far * (1 + this.fade / 2) / k;
    for (const v of this._variants) v.slot = 0;
    let visible = 0, triangles = 0;
    for (const ch of this._chunks) {
      if (ch.box.distanceToPoint(camera) >= reach || !frustum.intersectsBox(ch.box)) continue;
      for (const i of ch.plants) {
        const t = this._plants[i];
        if (Math.hypot(t.x - camera.x, t.y - camera.y, t.z - camera.z) * k >= far * (1 + this.fade / 2)) continue;
        const v = this._variants[t.variant];
        _sphere.center.set(t.x, t.y + v.cy * t.scale, t.z);
        _sphere.radius = v.radius * t.scale;
        if (!frustum.intersectsSphere(_sphere)) continue;
        _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(_yAxis, t.yaw), _s.setScalar(t.scale));
        for (const mesh of v.meshes) mesh.setMatrixAt(v.slot, _m);
        v.slot++;
        visible++;
        triangles += v.triangles;
      }
    }
    let drawCalls = 0;
    for (const v of this._variants) {
      for (const mesh of v.meshes) {
        mesh.count = v.slot;
        mesh.visible = v.slot > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (v.slot > 0) drawCalls++;
      }
    }
    this.stats = { visible, triangles, drawCalls };
  }

  dispose() {
    (this.children as any[]).filter((o) => o.isInstancedMesh).forEach((m) => m.dispose());
    this._fadeMaterials.forEach((m) => m.dispose());
    this._fadeMaterials.clear();
    this._geometries.forEach((g) => g.dispose());
    this._geometries.length = 0;
  }
}
