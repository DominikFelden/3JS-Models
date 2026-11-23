import {
  Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, Vector3,
  DoubleSide, type ColorRepresentation, type Material,
} from 'three';
import { mulberry32 } from '../WorldModel.ts';
import { getTexture, pickVariant, textureMean } from '../textures/pool.ts';
import { MAPPING } from '../textures/recipes.ts';
import { fadeMaterial, rangeUniform, rangeBand, setRange } from './fade.ts';
import { InstanceBuffer, START_CAPACITY } from './instances.ts';

/**
 * The illusion of grass on a whole forest floor. `ground` uses only a tiled grass texture;
 * `simple` adds a single batch of sparse low-poly tufts. The original `detailed` mode
 * uses three tiers by distance from the camera:
 *
 *  1. **Ground shader** (everywhere, one mesh): the floor is painted with hand-drawn looking
 *     grass in its fragment shader: big lush / dry patches, dappled tones and short blade
 *     strokes that fade out with distance. It costs no extra geometry per blade, so it covers
 *     any area.
 *  2. **Near clumps** (up to `nearDistance`): tiny crossed cards (3 quads, 6 triangles) with
 *     procedural, alpha-cut blades, drawn as instances. Every clump has its own size, turn and tint.
 *  3. **Far clumps** (to `distance`): only a fraction (`farShare`) of the clumps, drawn larger so the
 *     floor still looks covered, dithered into the near ones and out into the bare ground shader.
 *
 * Clumps are not stored for the whole area (a square kilometre would hold hundreds of thousands).
 * Every chunk of the grid derives its clumps from `seed` and its own coordinates when the camera
 * comes near, and forgets them when it leaves, so the same seed always grows the same meadow
 * whatever path the camera took. Chunks are culled by the view frustum, as are single clumps.
 *
 * Without WebGL (Node) nothing differs on the CPU: the materials are just never compiled.
 *
 * `length` scales the height of 3D grass without changing its width or placement.
 * The clump options below describe the detailed defaults.
 * Options: area (side of the square, centred), seed, density (clumps per square unit, default 1.2),
 * distance (default 50), nearDistance (default 18), farShare (default 0.25), fade (default 0.15),
 * variants (clump shapes, default 3), chunkSize (default 8), color (default 0x6f9f3f),
 * dryColor (default 0xb4ae58), heightAt(x, z), groundLift (default 0.03, keeps the floor above a
 * ground plane at the same height).
 * `update()` is called by the `Forest` with the camera in forest space.
 */

const CARDS_PER_CLUMP = 3;
const CARD_WIDTH = 0.8;
const CARD_HEIGHT = 0.55;
/** Far clumps are drawn this much larger than near ones. */
const FAR_SCALE = 1.8;
const MAX_CARD_HEIGHT = CARD_HEIGHT * 1.15;
/** Chunks kept between frames; older ones are rebuilt from the seed when needed again. */
const MAX_CACHED_CHUNKS = 512;
/** Floats per clump in a chunk: x, y, z, yaw, scale, variant, isFar. */
const STRIDE = 7;

type Palette = { dark: { value: Color }, light: { value: Color }, dry: { value: Color } };
type Chunk = { data: Float32Array, count: number, box: Box3, near: number, usedIn: number };
type Level = { range: ReturnType<typeof rangeUniform>, band: { lo: number, hi: number } };
type Variant = { geometry: BufferGeometry, levels: InstanceBuffer[], triangles: number };

export type MeadowType = 'ground' | 'simple' | 'detailed';

export interface MeadowOptions {
  type?: MeadowType;
  length?: number;
  area?: number;
  seed?: number;
  density?: number;
  distance?: number;
  nearDistance?: number;
  farShare?: number;
  fade?: number;
  variants?: number;
  chunkSize?: number;
  color?: ColorRepresentation;
  dryColor?: ColorRepresentation;
  heightAt?: (x: number, z: number) => number;
  groundLift?: number;
}

const _p = new Vector3();
const _sphere = { center: new Vector3(), radius: 0 };
const byNear = (a: Chunk, b: Chunk) => a.near - b.near;
const chunkKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const HASH_GLSL = /* glsl */ `
float meadowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float meadowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(meadowHash(i), meadowHash(i + vec2(1.0, 0.0)), f.x), mix(meadowHash(i + vec2(0.0, 1.0)), meadowHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const PALETTE_PARS = /* glsl */ `
uniform vec3 uMeadowDark;
uniform vec3 uMeadowLight;
uniform vec3 uMeadowDry;
`;

/** The ground: patches of tone plus short blade strokes, the strokes fading out where clumps end. */
const GROUND_FRAGMENT = /* glsl */ `
{
  vec2 p = vMeadowPos + uMeadowOffset;
  // Wide patches of lush and dry grass; strokes are noise stretched along z so they read as blades.
  float patches = meadowNoise(p * 0.035) * 0.6 + meadowNoise(p * 0.11) * 0.4;
  vec3 col = mix(uMeadowDark, uMeadowLight, smoothstep(0.25, 0.75, patches));
  col = mix(col, uMeadowDry, smoothstep(0.6, 0.85, meadowNoise(p * 0.05 + 17.0)) * 0.3);
  float detail = 1.0 - smoothstep(uMeadowDetail.x, uMeadowDetail.y, vMeadowDist);
  float light = smoothstep(0.55, 0.8, meadowNoise(vec2(p.x * 9.0, p.y * 2.2)));
  float dark = smoothstep(0.6, 0.85, meadowNoise(vec2(p.x * 7.0 + 31.0, p.y * 1.8)));
  col *= 1.0 + (light * 0.22 - dark * 0.28) * detail;
  diffuseColor.rgb *= col;
}
`;

/** Procedural blades on a card: up to 6, each a tapering triangle with its own height, lean and tone. */
const CLUMP_FRAGMENT = /* glsl */ `
{
  float u = vMeadowUv.x, y = vMeadowUv.y;
  bool hit = false;
  float tone = 0.5, bladeHeight = 1.0;
  for (int i = 0; i < 6; i++) {
    float s = float(i);
    float r1 = meadowHash(vec2(vMeadowCard, s));
    float r2 = meadowHash(vec2(s, vMeadowCard + 7.3));
    float r3 = meadowHash(vec2(vMeadowCard + 3.1, s * 1.7));
    float h = 0.55 + 0.45 * r2;
    float centre = 0.12 + 0.76 * r1 + (r3 - 0.5) * 0.5 * y * y;
    float halfWidth = 0.1 * (1.0 - y / h);
    if (y < h && abs(u - centre) < halfWidth) { hit = true; tone = r3; bladeHeight = h; }
  }
  if (!hit) discard;
  vec3 root = uMeadowDark * 0.7;
  vec3 tip = mix(uMeadowLight, uMeadowDry, 0.3 * vMeadowTint) * 1.1;
  vec3 blade = mix(root, tip, smoothstep(0.0, 1.0, y / bladeHeight));
  diffuseColor.rgb *= blade * (0.82 + 0.36 * tone) * (0.9 + 0.2 * vMeadowTint);
}
`;

/** Crossed cards through the centre; a card's seed picks its blades, `uv` runs across and up. */
function clumpGeometry(rnd: () => number) {
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [], seeds: number[] = [], index: number[] = [];
  const turn = rnd() * Math.PI;
  for (let c = 0; c < CARDS_PER_CLUMP; c++) {
    const angle = turn + (c / CARDS_PER_CLUMP) * Math.PI + (rnd() - 0.5) * 0.3;
    const dx = Math.cos(angle) * CARD_WIDTH / 2, dz = Math.sin(angle) * CARD_WIDTH / 2;
    const height = CARD_HEIGHT * (0.85 + rnd() * 0.3);
    const seed = rnd() * 100 + 1;
    const first = positions.length / 3;
    positions.push(-dx, -0.02, -dz, dx, -0.02, dz, dx, height, dz, -dx, height, -dz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    // Normals point up so the cards are lit like the ground they stand on (not like walls).
    for (let i = 0; i < 4; i++) { normals.push(0, 1, 0); seeds.push(seed); }
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aMeadowCard', new Float32BufferAttribute(seeds, 1));
  geometry.setIndex(index);
  return geometry;
}

/** Opaque blades put triangles only where there is grass, avoiding card overdraw and shader cutouts. */
function simpleClumpGeometry(rnd: () => number, palette: Palette) {
  const positions: number[] = [], colors: number[] = [], normals: number[] = [];
  const tip = new Color();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + rnd() * 0.5;
    const x = Math.cos(angle), z = Math.sin(angle);
    const base = 0.06 + rnd() * 0.04, width = 0.08 + rnd() * 0.04;
    const height = CARD_HEIGHT * (0.55 + rnd() * 0.55);
    positions.push(x * base - z * width, -0.02, z * base + x * width,
      x * base + z * width, -0.02, z * base - x * width, x * 0.3, height, z * 0.3);
    tip.copy(palette.light.value).lerp(palette.dry.value, rnd() * 0.45);
    const root = palette.dark.value;
    colors.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

// Double-sided grass should be lit from above regardless of which side faces the camera.
const upwardLighting = (source: string) => source.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  normal *= faceDirection;`);

export class Meadow extends Group {
  readonly grassType: MeadowType;
  readonly grassLength: number;
  declare area: number;
  declare distance: number;
  declare nearDistance: number;
  declare fade: number;
  declare density: number;
  declare seed: number;
  declare ground: Mesh;
  declare stats: { clumps: number, triangles: number, drawCalls: number };
  declare _palette: Palette;
  declare _detail: { value: Vector2 };
  declare _levels: Level[];
  declare _variants: Variant[];
  declare _materials: Material[];
  declare _chunks: Map<number, Chunk>;
  declare _near: Chunk[];
  declare _grid: { size: number, count: number, side: number };
  declare _frame: number;
  declare _heightAt: ((x: number, z: number) => number) | null;
  declare _farShare: number;
  private readonly groundLift: number;
  private readonly clumpCenterY: number;
  private readonly clumpRadius: number;

  constructor({
    type = 'detailed', length = 1, area = 160, seed = 1, density = type === 'simple' ? 0.4 : 1.2,
    distance = type === 'simple' ? 24 : 50, nearDistance = 18, farShare = 0.25, fade = 0.15, variants = 3, chunkSize = 8,
    color = 0x6f9f3f, dryColor = 0xb4ae58, heightAt = null, groundLift = 0.03,
  }: MeadowOptions = {}) {
    super();
    this.name = 'Meadow';
    this.grassType = type;
    this.grassLength = Number.isFinite(length) ? Math.min(3, Math.max(0.25, length)) : 1;
    this.groundLift = groundLift;
    this.clumpCenterY = CARD_HEIGHT / 2 * this.grassLength;
    this.clumpRadius = Math.hypot(CARD_WIDTH / 2, (MAX_CARD_HEIGHT + 0.02) * this.grassLength - this.clumpCenterY);
    this.area = area;
    this.seed = seed >>> 0;
    this.density = Math.max(0, density);
    this.distance = distance;
    this.nearDistance = Math.min(nearDistance, distance);
    this.fade = Math.min(1, Math.max(0, fade));
    this._heightAt = heightAt;
    this._farShare = Math.min(1, Math.max(0, farShare));
    this._chunks = new Map();
    this._near = [];
    this._frame = 0;
    const rnd = mulberry32(this.seed);

    // Each seed leans a little towards yellow or blue-green and lighter or darker.
    const light = new Color(color).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08);
    this._palette = {
      light: { value: light },
      dark: { value: light.clone().offsetHSL(0.01, 0.03, -0.14) },
      dry: { value: new Color(dryColor).offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.06) },
    };
    const patternOffset = { value: new Vector2(rnd() * 1000, rnd() * 1000) };
    // Blade strokes of the ground fade out where the clumps do.
    this._detail = { value: new Vector2(distance * 0.5, distance * 1.6) };

    this._materials = [];
    this.ground = this._buildGround(area, heightAt, groundLift, patternOffset);
    this.add(this.ground);

    const levelCount = type === 'ground' ? 0 : type === 'simple' ? 1 : 2;
    const size = Math.max(2, chunkSize);
    this._grid = { size, count: Math.max(1, Math.ceil(area / size)), side: Math.max(1, Math.ceil(size * Math.sqrt(this.density))) };
    this._levels = Array.from({ length: levelCount }, () => ({ range: rangeUniform(), band: { lo: 0, hi: 0 } }));
    this.stats = { clumps: 0, triangles: 0, drawCalls: 0 };
    this._variants = [];
    if (!levelCount || this.density === 0) return;

    const simple = type === 'simple';
    const source = simple ? new MeshStandardMaterial({ side: DoubleSide, vertexColors: true, roughness: 1 }) : this._clumpMaterial();
    if (simple) {
      source.onBeforeCompile = (shader) => { shader.fragmentShader = upwardLighting(shader.fragmentShader); };
      source.customProgramCacheKey = () => 'meadow-simple';
    }
    const materials = this._levels.map((level) => fadeMaterial(source, level.range));
    source.dispose();
    this._materials.push(...materials);
    this._variants = Array.from({ length: simple ? 1 : Math.max(1, Math.round(variants)) }, () => {
      const geometry = simple ? simpleClumpGeometry(rnd, this._palette) : clumpGeometry(rnd);
      geometry.scale(1, this.grassLength, 1);
      const levels = materials.map((material) => {
        const buffer = new InstanceBuffer(START_CAPACITY);
        this.add(buffer.addMesh(geometry, material, { receiveShadow: !simple }));
        return buffer;
      });
      return { geometry, levels, triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3 };
    });
  }

  /** The floor: a plane, or a coarse grid following `heightAt`, wearing the grass pattern. */
  _buildGround(area: number, heightAt, lift: number, offset: { value: Vector2 }) {
    const segments = heightAt ? Math.min(200, Math.max(1, Math.round(area / 4))) : 1;
    const geometry = new PlaneGeometry(area, area, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, (heightAt ? heightAt(x, z) : 0) + lift);
      uv.setXY(i, x / MAPPING.grass.tile + offset.value.x, z / MAPPING.grass.tile + offset.value.y);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const palette = this._palette;
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (this.grassType !== 'detailed') {
      const variant = pickVariant('grass', mulberry32(this.seed));
      material.map = getTexture('grass', variant);
      material.color.copy(palette.light.value);
      if (material.map) {
        const mean = textureMean('grass', variant);
        const { r, g, b } = material.color;
        material.color.setRGB(Math.min(3, r / Math.max(0.03, mean.r)), Math.min(3, g / Math.max(0.03, mean.g)), Math.min(3, b / Math.max(0.03, mean.b)));
      }
    } else {
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
          uMeadowDark: palette.dark, uMeadowLight: palette.light, uMeadowDry: palette.dry, uMeadowOffset: offset, uMeadowDetail: this._detail,
        });
        shader.vertexShader = `varying vec2 vMeadowPos;\nvarying float vMeadowDist;\n${shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vMeadowPos = position.xz;
  vMeadowDist = distance((modelMatrix * vec4(position, 1.0)).xyz, cameraPosition);`)}`;
        shader.fragmentShader = `varying vec2 vMeadowPos;\nvarying float vMeadowDist;\nuniform vec2 uMeadowOffset;\nuniform vec2 uMeadowDetail;\n${PALETTE_PARS}${HASH_GLSL}${shader.fragmentShader
          .replace('#include <map_fragment>', `#include <map_fragment>\n${GROUND_FRAGMENT}`)}`;
      };
      material.customProgramCacheKey = () => 'meadow-ground';
    }
    this._materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'MeadowGround';
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Material of the clump cards (before the fade is added): blades cut from a card by the fragment shader. */
  _clumpMaterial() {
    const palette = this._palette;
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uMeadowDark: palette.dark, uMeadowLight: palette.light, uMeadowDry: palette.dry });
      shader.vertexShader = `attribute float aMeadowCard;\nvarying vec2 vMeadowUv;\nvarying float vMeadowCard;\nvarying float vMeadowTint;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vMeadowUv = uv;
  vMeadowCard = aMeadowCard;
  vMeadowTint = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`)}`;
      shader.fragmentShader = `varying vec2 vMeadowUv;\nvarying float vMeadowCard;\nvarying float vMeadowTint;\n${PALETTE_PARS}${HASH_GLSL}${upwardLighting(shader.fragmentShader)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${CLUMP_FRAGMENT}`)}`;
    };
    material.customProgramCacheKey = () => 'meadow-clump';
    return material;
  }

  /** The clumps of chunk (`cx`, `cz`): one per cell of a jittered grid, all derived from the seed and the chunk. */
  _chunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const cached = this._chunks.get(key);
    if (cached) return cached;
    const { size, side } = this._grid;
    const rnd = mulberry32((this.seed ^ Math.imul(cx + 0x9e37, 0x85ebca6b) ^ Math.imul(cz + 0x7f4a, 0xc2b2ae35)) >>> 0);
    const data = new Float32Array(side * side * STRIDE);
    const box = new Box3();
    const cell = size / side, x0 = cx * size - this.area / 2, z0 = cz * size - this.area / 2;
    let count = 0;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const x = x0 + (i + rnd()) * cell, z = z0 + (j + rnd()) * cell;
        const yaw = rnd() * Math.PI * 2, scale = 0.7 + rnd() * 0.7, variant = Math.floor(rnd() * this._variants.length), isFar = rnd() < this._farShare ? 1 : 0;
        if (Math.abs(x) > this.area / 2 || Math.abs(z) > this.area / 2) continue;
        const y = (this._heightAt?.(x, z) ?? 0) + this.groundLift;
        data.set([x, y, z, yaw, scale, variant, isFar], count * STRIDE);
        const s = this._levels.length > 1 ? scale * FAR_SCALE : scale;
        const r = this.clumpRadius * s, cy = y + this.clumpCenterY * s;
        box.expandByPoint(_p.set(x - r, Math.min(y, cy - r), z - r));
        box.expandByPoint(_p.set(x + r, cy + r, z + r));
        count++;
      }
    }
    const chunk = { data, count, box, near: 0, usedIn: this._frame };
    this._chunks.set(key, chunk);
    return chunk;
  }

  /**
   * Choose the clumps to draw. `camera`: camera position in forest space, `k`: forest scale (world
   * units per forest unit), `frustum`: view frustum in forest space, `detail`: factor on the range.
   */
  update(camera: Vector3, k: number, frustum, detail = 1) {
    if (!this._variants.length) return;
    this._frame++;
    // As for plants: setRange centres the dither band, so the near level ends `fadeInset` early.
    const inset = 1 - this.fade / 2;
    const nearEnd = this.nearDistance / inset;
    const [near, far] = this._levels;
    const end = far ? Math.min(this.distance, Math.max(this.distance * detail, nearEnd)) : this.distance * detail;
    const hasFar = far && end > nearEnd && this._farShare > 0;
    setRange(near.range, null, hasFar ? nearEnd : end, this.fade);
    rangeBand(near.range, near.band);
    if (hasFar) {
      setRange(far.range, nearEnd, end, this.fade);
      rangeBand(far.range, far.band);
    }
    const reach = hasFar ? far.band.hi : near.band.hi;
    for (const v of this._variants) for (const buffer of v.levels) buffer.reset();

    let clumps = 0, triangles = 0;
    const levelCount = hasFar ? 2 : 1;
    if (reach > 0 && (this._heightAt || Math.abs(camera.y - this.groundLift) * k < reach)) {
      const r = reach / k;
      const { size, count: nc } = this._grid;
      const origin = -this.area / 2;
      const x0 = Math.max(0, Math.floor((camera.x - r - origin) / size)), x1 = Math.min(nc - 1, Math.floor((camera.x + r - origin) / size));
      const z0 = Math.max(0, Math.floor((camera.z - r - origin) / size)), z1 = Math.min(nc - 1, Math.floor((camera.z + r - origin) / size));
      const visibleChunks = this._near;
      visibleChunks.length = 0;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const chunk = this._chunk(cx, cz);
          chunk.usedIn = this._frame;
          if (chunk.count === 0) continue;
          chunk.near = chunk.box.distanceToPoint(camera);
          if (chunk.near < r && frustum.intersectsBox(chunk.box)) visibleChunks.push(chunk);
        }
      }
      visibleChunks.sort(byNear); // nearest first: the GPU rejects most of the hidden pixels early

      for (const chunk of visibleChunks) {
        const { data } = chunk;
        for (let i = 0; i < chunk.count; i++) {
          const o = i * STRIDE;
          const x = data[o], y = data[o + 1], z = data[o + 2], scale = data[o + 4];
          const dx = x - camera.x, dy = y - camera.y, dz = z - camera.z;
          const d = k * Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= reach) continue;
          const variant = this._variants[data[o + 5]];
          // Near level: every clump. Far level: only the "far" ones, drawn larger. Both while cross-fading.
          for (let l = 0; l < levelCount; l++) {
            const band = this._levels[l].band;
            if (!(d >= band.lo && d < band.hi) || (l === 1 && data[o + 6] === 0)) continue;
            const s = l === 1 ? scale * FAR_SCALE : scale;
            _sphere.center.set(x, y + this.clumpCenterY * s, z);
            _sphere.radius = this.clumpRadius * s;
            if (!frustum.intersectsSphere(_sphere)) continue;
            variant.levels[l].push(x, y, z, data[o + 3], s, _sphere.center.y, _sphere.radius);
            triangles += variant.triangles;
            clumps++;
          }
        }
      }
    }
    let drawCalls = 0;
    for (const v of this._variants) for (const buffer of v.levels) drawCalls += buffer.commit();
    if (this._chunks.size > MAX_CACHED_CHUNKS) {
      for (const [key, chunk] of this._chunks) if (chunk.usedIn !== this._frame) this._chunks.delete(key);
    }
    this.stats.clumps = clumps;
    this.stats.triangles = triangles;
    this.stats.drawCalls = drawCalls;
  }

  dispose() {
    this.ground.geometry.dispose();
    for (const v of this._variants) {
      v.geometry.dispose();
      for (const buffer of v.levels) buffer.meshes.forEach((m) => m.dispose());
    }
    this._materials.forEach((m) => m.dispose());
    this._materials.length = 0;
    this._chunks.clear();
  }
}
