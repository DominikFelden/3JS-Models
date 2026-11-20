import {
  Scene, Mesh, OrthographicCamera, WebGLRenderTarget, MeshBasicMaterial, ShaderMaterial, MeshStandardMaterial,
  InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, DataTexture, Color, Vector2, Vector3, Sphere,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, DynamicDrawUsage, type Vector4, type WebGLRenderer,
  RGBAFormat, UnsignedByteType, SRGBColorSpace, NoColorSpace, ClampToEdgeWrapping, LinearFilter,
  LinearMipmapLinearFilter, NearestFilter, NoToneMapping, DoubleSide,
} from 'three';
import { withBakeRenderer } from '../textures/bake.ts';
import { FADE_PARS, fadeTest, type rangeUniform } from './fade.ts';
import { BILLBOARD_ATTRIBUTES, BILLBOARD_VERTEX, injectBillboard } from './billboard.ts';
import { START_CAPACITY } from './instances.ts';

/**
 * Impostors: every tree variant is photographed once from many directions
 * into a texture atlas (colour + normals). Far trees are then drawn as one
 * camera-facing quad each that shows the picture taken from the nearest
 * directions, lit like the real tree (normals). All impostors of a forest are
 * ONE draw call; their positions never change, the vertex shader drops the
 * trees that are not in the impostor range.
 *
 * Views: IMPOSTOR_YAWS directions around the tree times IMPOSTOR_ELEVATIONS
 * heights from the side (0°) to straight above (90°), so a player flying
 * over the forest also sees the trees from above.
 */
export const IMPOSTOR_YAWS = 8;
export const IMPOSTOR_ELEVATIONS = 4;

type ViewCounts = { yaws: number, elevations: number };
const TREE_VIEWS = { yaws: IMPOSTOR_YAWS, elevations: IMPOSTOR_ELEVATIONS };

type ImpostorPlacement = { x: number, y: number, z: number, yaw: number, scale: number, variant: number };
export type ImpostorBounds = { centreY: number, radius: number };
type CameraUniform = { value: Vector3 };
type TreeUniforms = { camera: CameraUniform, scale: { value: number }, range: ReturnType<typeof rangeUniform> };

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

// Normal pass of the bake: flat triangle normals in tree space, turned towards the camera (thin leaves are
// double sided), or the smooth vertex normals for smooth materials (e.g. crowns lit as one volume).
// Cut-out (alpha-tested) and billboarded leaf cards are cut and turned as in the colour pass.
const NORMAL_VERT = /* glsl */ `
#ifdef BILLBOARD
${BILLBOARD_ATTRIBUTES}
#endif
varying vec3 vPos;
varying vec3 vNormal;
#ifdef CUTOUT
varying vec2 vUv;
uniform mat3 uMapTransform;
#endif
void main() {
  vec3 transformed = position;
#ifdef BILLBOARD
${BILLBOARD_VERTEX}
#endif
  vPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vNormal = transpose(mat3(viewMatrix)) * (normalMatrix * normal);
#ifdef CUTOUT
  vUv = (uMapTransform * vec3(uv, 1.0)).xy;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const NORMAL_FRAG = /* glsl */ `
uniform vec3 uView;
uniform sampler2D uMap;
uniform float uAlphaTest;
uniform float uOpacity;
varying vec3 vPos;
varying vec3 vNormal;
#ifdef CUTOUT
varying vec2 vUv;
#endif
void main() {
#ifdef CUTOUT
  if (texture2D(uMap, vUv).a * uOpacity < uAlphaTest) discard;
#else
  if (uOpacity < uAlphaTest) discard;
#endif
#ifdef SMOOTH
  vec3 n = normalize(vNormal);
  #ifdef DOUBLE_SIDED
  n *= gl_FrontFacing ? 1.0 : -1.0;
  #elif defined(FLIP_SIDED)
  n = -n;
  #endif
#else
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(n, uView) < 0.0) n = -n;
#endif
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

function atlasTexture(data, width, height, colorSpace, frame = 0) {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  if (frame) {
    t.mipmaps = coverageMipmaps(data, width, height, frame);
    t.generateMipmaps = false;
  } else t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Impostor pixels with less alpha than this are discarded. */
export const ALPHA_CUT = 0.45;

/**
 * Mip chain for the colour atlas (frames of `frame` pixels). Ordinary mipmaps
 * average the alpha of a sparse crown down below the cut-off, so distant
 * impostors dissolve into a few scattered dots. Here each frame of each level
 * gets its alpha scaled up until at least the same fraction of its pixels
 * passes the cut-off as at full size ("alpha-test coverage preservation";
 * rather a little fuller than see-through, never beyond the pixels that had
 * any leaf in them). Colour is
 * alpha-weighted so empty pixels do not darken the tree.
 */
export function coverageMipmaps(data, width, height, frame) {
  const cut = ALPHA_CUT * 255;
  const tiles = (w, h, f, fn) => {
    for (let ty = 0; ty < h; ty += f) for (let tx = 0; tx < w; tx += f) fn(tx, ty, Math.min(f, w - tx), Math.min(f, h - ty));
  };
  const coverage = (d, w, x0, y0, tw, th, scale) => {
    let n = 0;
    for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) if (d[(y * w + x) * 4 + 3] * scale >= cut) n++;
    return n / (tw * th);
  };
  const target = [];
  tiles(width, height, frame, (x, y, tw, th) => target.push(coverage(data, width, x, y, tw, th, 1)));

  const levels = [{ data, width, height }];
  let src = data, w = width, h = height, f = frame;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const dst = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (let dy = 0; dy < 2; dy++) {
          const sy = Math.min(h - 1, y * 2 + dy);
          for (let dx = 0; dx < 2; dx++) {
            const i = (sy * w + Math.min(w - 1, x * 2 + dx)) * 4;
            const wa = src[i + 3] + 1; // +1: fully empty blocks keep their fill colour
            r += src[i] * wa; g += src[i + 1] * wa; b += src[i + 2] * wa; wsum += wa;
            a += src[i + 3];
          }
        }
        const o = (y * nw + x) * 4;
        dst[o] = Math.round(r / wsum); dst[o + 1] = Math.round(g / wsum); dst[o + 2] = Math.round(b / wsum);
        dst[o + 3] = Math.round(a / 4);
      }
    }
    f = Math.max(1, f >> 1);
    if (f >= 2) {
      let t = 0;
      tiles(nw, nh, f, (x0, y0, tw, th) => {
        const want = target[t++] ?? 0;
        let lo = 1, hi = 16;
        if (want <= 0 || coverage(dst, nw, x0, y0, tw, th, lo) >= want) return;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) / 2;
          if (coverage(dst, nw, x0, y0, tw, th, mid) < want) lo = mid; else hi = mid;
        }
        for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) {
          const i = (y * nw + x) * 4 + 3;
          dst[i] = Math.min(255, Math.round(dst[i] * hi));
        }
      });
    }
    levels.push({ data: dst, width: nw, height: nh });
    src = dst; w = nw; h = nh;
  }
  return levels;
}

/** Atlas grid for `frames` frames of `size` pixels, kept within the GPU's texture size. */
export function atlasLayout(variants: number, size: number, maxTextureSize = 4096, views = TREE_VIEWS) {
  const frames = variants * views.elevations * views.yaws;
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const frame = Math.max(8, Math.min(size, Math.floor(maxTextureSize / cols), Math.floor(maxTextureSize / rows)));
  return { cols, rows, frame, width: cols * frame, height: rows * frame };
}

export type ImpostorAtlas = ReturnType<typeof atlasLayout> & {
  color: DataTexture, normal: DataTexture, means: Color[], views: ViewCounts,
};

/**
 * Photograph every variant from all impostor directions. Meshes have their base at the origin.
 *  - renderer: the host's WebGLRenderer (optional, otherwise a private one)
 *  - frameSize: pixels per picture (default 128)
 *  - views: yaw and elevation counts (trees use 8 x 4, smaller plants need fewer)
 */
export function bakeImpostors(
  variants: (ImpostorBounds & {meshes: Mesh[], centre?: Vector3})[],
  { renderer = null, frameSize = 128, views = TREE_VIEWS, fullSphere = false }:
    {renderer?: WebGLRenderer | null, frameSize?: number, views?: ViewCounts, fullSphere?: boolean} = {},
): ImpostorAtlas {
  return withBakeRenderer(renderer, (r) => {
    const { yaws, elevations } = views;
    const layout = atlasLayout(variants.length, frameSize, r.capabilities.maxTextureSize, views);
    const { cols, frame: S, width: W, height: H } = layout;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const target = (colorSpace) => new WebGLRenderTarget(W, H, {
      colorSpace, depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter,
    });
    const colorTarget = target(SRGBColorSpace);
    const normalTarget = target(NoColorSpace);
    const uView = { value: new Vector3() };
    const basic = new Map();
    const normals = new Map();
    const alphaTest = (m) => fullSphere && m.transparent ? Math.max(ALPHA_CUT, m.alphaTest) : m.alphaTest;
    const albedo = (m) => {
      if (!basic.has(m)) {
        const b = new MeshBasicMaterial({
          map: m.map ?? null, color: m.color ?? 0xffffff, vertexColors: m.vertexColors, side: m.side,
          alphaTest: alphaTest(m), opacity: m.opacity, visible: m.visible && (!fullSphere || m.colorWrite),
        });
        if (m.userData.billboard) { b.onBeforeCompile = injectBillboard; b.customProgramCacheKey = () => 'leaf-card-basic'; }
        basic.set(m, b);
      }
      return basic.get(m);
    };
    const normalOf = (m) => {
      if (normals.has(m)) return normals.get(m);
      const defines: any = {};
      if (fullSphere ? m.flatShading === false : !m.flatShading) defines.SMOOTH = '';
      if (m.map && alphaTest(m) > 0) defines.CUTOUT = '';
      if (m.userData.billboard) defines.BILLBOARD = '';
      if (m.map?.matrixAutoUpdate) m.map.updateMatrix();
      const normal = new ShaderMaterial({
        vertexShader: NORMAL_VERT, fragmentShader: NORMAL_FRAG, defines, side: m.side, visible: m.visible && (!fullSphere || m.colorWrite),
        uniforms: {
          uView, uMap: { value: m.map }, uMapTransform: { value: m.map?.matrix },
          uAlphaTest: { value: alphaTest(m) }, uOpacity: { value: m.opacity },
        },
      });
      normals.set(m, normal);
      return normal;
    };
    const groups = variants.map(({ meshes }) => meshes.map((src) => {
      const color = new Mesh(src.geometry, Array.isArray(src.material) ? src.material.map(albedo) : albedo(src.material));
      const normal = new Mesh(src.geometry, Array.isArray(src.material) ? src.material.map(normalOf) : normalOf(src.material));
      if (fullSphere) {
        for (const mesh of [color, normal]) {
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(src.matrix);
        }
      }
      color.frustumCulled = normal.frustumCulled = false;
      scene.add(color, normal);
      return { color, normal };
    }));

    const saved = {
      target: r.getRenderTarget(), cubeFace: r.getActiveCubeFace(), mipLevel: r.getActiveMipmapLevel(),
      tone: r.toneMapping, autoClear: r.autoClear, autoClearColor: r.autoClearColor, autoClearDepth: r.autoClearDepth,
      xr: r.xr.enabled, clearAlpha: r.getClearAlpha(), clearColor: r.getClearColor(new Color()),
    };
    r.toneMapping = NoToneMapping;
    r.autoClear = r.autoClearColor = r.autoClearDepth = true;
    r.xr.enabled = false;
    const centre = new Vector3();
    const dir = new Vector3();
    try {
      for (const [pass, rt] of [['color', colorTarget], ['normal', normalTarget]] as [string, any][]) {
        // Empty pixels get a neutral value so mipmaps do not bleed black (colour) or a wrong normal into the tree.
        if (pass === 'color') r.setClearColor(0x3a5a30, 0); else r.setClearColor(new Color().setRGB(0.5, 1, 0.5, NoColorSpace), 0);
        rt.scissorTest = true;
        variants.forEach((v, vi) => {
          groups.forEach((g, gi) => g.forEach((m) => {
            m.color.visible = pass === 'color' && gi === vi;
            m.normal.visible = pass === 'normal' && gi === vi;
          }));
          centre.set(0, v.centreY, 0);
          if (v.centre) centre.copy(v.centre);
          const R = v.radius;
          Object.assign(camera, { left: -R, right: R, top: R, bottom: -R, near: R * 0.01, far: R * 4 });
          camera.updateProjectionMatrix();
          for (let e = 0; e < elevations; e++) {
            const el = (e / (elevations - 1) - (fullSphere ? 0.5 : 0)) * (fullSphere ? Math.PI : Math.PI / 2);
            for (let y = 0; y < yaws; y++) {
              const a = (y / yaws) * Math.PI * 2;
              const idx = (vi * elevations + e) * yaws + y;
              const x0 = (idx % cols) * S, y0 = Math.floor(idx / cols) * S;
              dir.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
              camera.position.copy(centre).addScaledVector(dir, R * 2);
              // Straight above, "up" is the limit of the side views' up for this yaw, so the picture turns with the yaw.
              if (e === elevations - 1) camera.up.set(-Math.sin(a), 0, -Math.cos(a));
              else if (fullSphere && e === 0) camera.up.set(Math.sin(a), 0, Math.cos(a));
              else camera.up.set(0, 1, 0);
              camera.lookAt(centre);
              camera.updateMatrixWorld();
              uView.value.copy(dir);
              rt.viewport.set(x0, y0, S, S);
              rt.scissor.set(x0, y0, S, S);
              r.setRenderTarget(rt);
              r.render(scene, camera);
            }
          }
        });
      }
      const colorData = new Uint8Array(W * H * 4);
      const normalData = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(colorTarget, 0, 0, W, H, colorData);
      r.readRenderTargetPixels(normalTarget, 0, 0, W, H, normalData);
      const means = fillAndMeasure(colorData, layout, variants.length, elevations * yaws);
      return {
        ...layout,
        views,
        color: atlasTexture(colorData, W, H, SRGBColorSpace, S),
        normal: atlasTexture(normalData, W, H, NoColorSpace),
        means,
      };
    } finally {
      r.setRenderTarget(saved.target, saved.cubeFace, saved.mipLevel);
      r.toneMapping = saved.tone;
      r.autoClear = saved.autoClear;
      r.autoClearColor = saved.autoClearColor;
      r.autoClearDepth = saved.autoClearDepth;
      r.xr.enabled = saved.xr;
      r.setClearColor(saved.clearColor, saved.clearAlpha);
      colorTarget.dispose();
      normalTarget.dispose();
      normals.forEach((m) => m.dispose());
      basic.forEach((m) => m.dispose());
    }
  });
}

/**
 * Average colour (linear) of each variant's opaque pixels, and paint the
 * empty pixels of every frame in its variant's average sRGB colour, so the
 * soft (mipmapped) outline of a far tree keeps the tree's colour.
 */
function fillAndMeasure(data, { cols, frame: S, width: W }, nVariants, per) {
  const means = [];
  for (let v = 0; v < nVariants; v++) {
    const sum = [0, 0, 0], raw = [0, 0, 0];
    let n = 0;
    const each = (fn) => {
      for (let f = v * per; f < (v + 1) * per; f++) {
        const x0 = (f % cols) * S, y0 = Math.floor(f / cols) * S;
        for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) fn((y * W + x) * 4);
      }
    };
    each((i) => {
      if (data[i + 3] < 128) return;
      for (let c = 0; c < 3; c++) { sum[c] += SRGB_TO_LINEAR[data[i + c]]; raw[c] += data[i + c]; }
      n++;
    });
    const fill = raw.map((s) => (n ? Math.round(s / n) : 90));
    each((i) => {
      if (data[i + 3] >= 128) return;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2];
    });
    means.push(n ? new Color(sum[0] / n, sum[1] / n, sum[2] / n) : new Color(0.1, 0.2, 0.08));
  }
  return means;
}

function impostorGeometry() {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('normal', quad.attributes.normal);
  geometry.setAttribute('uv', quad.attributes.uv);
  return geometry;
}

/** One static instanced quad per tree; the vertex shader collapses trees outside the tier's range. */
export function createImpostors(
  trees: ImpostorPlacement[], variants: ImpostorBounds[], atlas: ImpostorAtlas | null, shared: TreeUniforms, color = new Color(0x3a6a30),
) {
  const geometry = impostorGeometry();
  const pos = new Float32Array(trees.length * 4);
  const meta = new Float32Array(trees.length * 2);
  trees.forEach((t, i) => {
    pos.set([t.x, t.y, t.z, t.scale], i * 4);
    meta.set([t.yaw, t.variant], i * 2);
  });
  geometry.setAttribute('iPos', new InstancedBufferAttribute(pos, 4));
  geometry.setAttribute('iMeta', new InstancedBufferAttribute(meta, 2));
  geometry.instanceCount = trees.length;
  const mesh = impostorMesh(geometry, atlas, shared.camera, { variants, shared, color });
  mesh.name = 'ForestImpostors';
  return mesh;
}

function impostorMesh(
  geometry: InstancedBufferGeometry, atlas: ImpostorAtlas | null, camera: CameraUniform,
  trees?: { variants: ImpostorBounds[], shared: TreeUniforms, color: Color },
) {
  const material = new MeshStandardMaterial({ color: atlas ? 0xffffff : trees?.color, roughness: 1, metalness: 0, side: DoubleSide });
  configureImpostorMaterial(material, atlas, camera, trees);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // the shader positions the quads; plant instances are culled before they're packed
  return mesh;
}

export function modelImpostorQuad(atlas: ImpostorAtlas, centre: Vector3, radius: number) {
  const geometry = new PlaneGeometry(1, 1);
  geometry.boundingSphere = new Sphere(centre.clone(), Math.SQRT2 * radius);
  const material = new MeshStandardMaterial({ roughness: 1, side: DoubleSide });
  configureImpostorMaterial(material, atlas, undefined, undefined, { centre, radius });
  return { geometry, material };
}

function configureImpostorMaterial(
  material: MeshStandardMaterial, atlas: ImpostorAtlas | null, camera?: CameraUniform,
  trees?: { variants: ImpostorBounds[], shared: TreeUniforms, color: Color },
  model?: { centre: Vector3, radius: number },
) {
  const variantInfo = trees?.variants.map((v) => new Vector2(v.centreY, v.radius));
  const { yaws, elevations } = atlas?.views ?? TREE_VIEWS;
  const defines = `#define IMP_YAWS ${yaws}.0\n#define IMP_ELEVS ${elevations}.0\n`
    + (model ? '#define IMP_MODEL\n' : variantInfo ? `#define IMP_VARIANTS ${variantInfo.length}\n` : '#define IMP_PLANTS\n')
    + (atlas ? '#define IMP_ATLAS\n' : '');
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uImpGrid: { value: new Vector2(atlas?.cols ?? 1, atlas?.rows ?? 1) },
      uImpColor: { value: atlas?.color ?? null }, uImpNormal: { value: atlas?.normal ?? null },
    });
    if (model) Object.assign(shader.uniforms, {
      uImpCentre: { value: model.centre }, uImpRadius: { value: model.radius },
    });
    else shader.uniforms.uForestCam = camera;
    if (trees) Object.assign(shader.uniforms, {
      uForestRange: trees.shared.range, uForestScale: trees.shared.scale, uImpVariants: { value: variantInfo },
    });
    shader.vertexShader = `${defines}${IMPOSTOR_VERT_PARS}${shader.vertexShader.replace('#include <begin_vertex>', IMPOSTOR_VERT)}`;
    shader.fragmentShader = `${defines}${FADE_PARS}${IMPOSTOR_FRAG_PARS}${shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `${model ? '' : fadeTest(trees ? 'uForestRange' : 'vImpRange')}\n#include <clipping_planes_fragment>`)
      .replace('#include <map_fragment>', IMPOSTOR_MAP)
      .replace('#include <normal_fragment_begin>', IMPOSTOR_NORMAL)}`;
  };
  material.customProgramCacheKey = () => `impostor:${model ? 'model' : variantInfo?.length ?? 'plants'}:${yaws}:${elevations}:${!!atlas}`;
}

const INSTANCE_STRIDE = 12;

/** One draw for the culled plants of every kind, with their own atlas frames and fade ranges. */
export class PlantImpostorBatch {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  private atlas: ImpostorAtlas;
  private camera = { value: new Vector3() };
  private instances: InstancedInterleavedBuffer;
  count = 0;

  constructor(atlas: ImpostorAtlas) {
    this.atlas = atlas;
    this.mesh = impostorMesh(impostorGeometry(), atlas, this.camera);
    this.mesh.name = 'PlantImpostors';
    this.instances = this.allocate(START_CAPACITY);
    this.commit();
  }

  private allocate(capacity: number) {
    const buffer = new InstancedInterleavedBuffer(new Float32Array(capacity * INSTANCE_STRIDE), INSTANCE_STRIDE);
    buffer.setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('iPos', new InterleavedBufferAttribute(buffer, 4, 0));
    this.mesh.geometry.setAttribute('iMeta', new InterleavedBufferAttribute(buffer, 4, 4));
    this.mesh.geometry.setAttribute('iRange', new InterleavedBufferAttribute(buffer, 4, 8));
    return buffer;
  }

  reset(camera: Vector3) {
    this.count = 0;
    this.camera.value.copy(camera);
  }

  push(plant: ImpostorPlacement, bounds: ImpostorBounds, range: Vector4) {
    if (this.count === this.instances.count) {
      const previous = this.instances;
      this.mesh.geometry.dispose(); // GPU buffers cannot be resized
      this.instances = this.allocate(previous.count * 2);
      this.instances.array.set(previous.array);
    }
    const { x, y, z, scale, yaw, variant } = plant;
    const { centreY, radius } = bounds;
    const a = this.instances.array, o = this.count++ * INSTANCE_STRIDE;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = scale;
    a[o + 4] = yaw; a[o + 5] = variant; a[o + 6] = centreY; a[o + 7] = radius;
    range.toArray(a, o + 8);
  }

  commit() {
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.mesh.visible) return;
    this.instances.clearUpdateRanges();
    this.instances.addUpdateRange(0, this.count * INSTANCE_STRIDE);
    this.instances.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.atlas.color.dispose();
    this.atlas.normal.dispose();
  }
}

const IMPOSTOR_VERT_PARS = /* glsl */ `
#ifdef IMP_MODEL
uniform vec3 uImpCentre;
uniform float uImpRadius;
#else
attribute vec4 iPos;
uniform vec3 uForestCam;
#ifdef IMP_PLANTS
attribute vec4 iMeta;
attribute vec4 iRange;
varying vec4 vImpRange;
#else
attribute vec2 iMeta;
uniform float uForestScale;
uniform vec4 uForestRange;
uniform vec2 uImpVariants[IMP_VARIANTS];
#endif
varying float vForestDist;
#endif
varying vec2 vImpUv;
varying vec4 vImpFrames;
varying vec2 vImpBlend;
varying vec3 vImpN0;
varying vec3 vImpN1;
varying vec3 vImpN2;
`;

// Camera-facing quad around the crown (all in forest space). Trees outside the
// impostor range collapse into a point, which draws nothing.
const IMPOSTOR_VERT = /* glsl */ `
vec3 transformed = vec3(0.0);
vImpUv = uv;
vImpFrames = vec4(0.0);
vImpBlend = vec2(0.0);
vImpN0 = vec3(1.0, 0.0, 0.0);
vImpN1 = vec3(0.0, 1.0, 0.0);
vImpN2 = vec3(0.0, 0.0, 1.0);
{
#ifdef IMP_MODEL
  mat4 worldToLocal = inverse(modelMatrix);
  vec3 centre = uImpCentre;
  vec3 f = isOrthographic
    ? mat3(worldToLocal) * vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])
    : (worldToLocal * vec4(cameraPosition, 1.0)).xyz - centre;
  float radius = uImpRadius;
  float yaw = 0.0;
  float variant = 0.0;
#else
  float scale = iPos.w;
#ifdef IMP_PLANTS
  // Match fadeMaterial's world-space distance to the plant's base.
  float d = distance((modelMatrix * vec4(iPos.xyz, 1.0)).xyz, cameraPosition);
  vec4 range = iRange;
  vImpRange = range;
#else
  float d = uForestScale * distance(iPos.xyz, uForestCam);
  vec4 range = uForestRange;
#endif
  vForestDist = d;
  if (d >= range.x - 0.5 * range.y && d < range.z + 0.5 * range.w) {
#ifdef IMP_PLANTS
    vec2 info = iMeta.zw;
#else
    vec2 info = uImpVariants[int(iMeta.y + 0.5)];
#endif
    vec3 centre = iPos.xyz + vec3(0.0, info.x * scale, 0.0);
    vec3 f = uForestCam - centre;
    float radius = info.y * scale;
    float yaw = iMeta.x;
    float variant = iMeta.y;
#endif
    float fl = length(f);
    f = fl > 1e-5 ? f / fl : vec3(0.0, 0.0, 1.0);
    vec3 right = cross(vec3(0.0, 1.0, 0.0), f);
    float rl = length(right);
    right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
    vec3 up = cross(f, right);
    transformed = centre + (right * position.x + up * position.y) * (2.0 * radius);

    // Direction to the camera in the tree's own frame picks the pictures.
    float c = cos(yaw);
    float s = sin(yaw);
    vec3 l = vec3(c * f.x - s * f.z, f.y, s * f.x + c * f.z);
    // At the pole the +X billboard right corresponds to a +Z view in forest space.
    vec2 horizontal = rl > 1e-4 ? l.xz : vec2(-s, c);
    float az = atan(horizontal.x, horizontal.y);
    if (az < 0.0) az += 6.28318531;
    float fy = az / (6.28318531 / IMP_YAWS);
    float y0 = mod(floor(fy), IMP_YAWS);
    float y1 = mod(y0 + 1.0, IMP_YAWS);
#ifdef IMP_MODEL
    float fe = (asin(clamp(l.y, -1.0, 1.0)) / 3.14159265 + 0.5) * (IMP_ELEVS - 1.0);
#else
    float fe = asin(clamp(l.y, 0.0, 1.0)) / (1.57079633 / (IMP_ELEVS - 1.0));
#endif
    float e0 = min(floor(fe), IMP_ELEVS - 2.0);
    float base = variant * IMP_ELEVS + e0;
    vImpFrames = vec4(base * IMP_YAWS + y0, base * IMP_YAWS + y1, (base + 1.0) * IMP_YAWS + y0, (base + 1.0) * IMP_YAWS + y1);
    vImpBlend = vec2(fract(fy), clamp(fe - e0, 0.0, 1.0));
    mat3 m = normalMatrix * mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    vImpN0 = m[0];
    vImpN1 = m[1];
    vImpN2 = m[2];
#ifndef IMP_MODEL
  }
#endif
}
`;

const IMPOSTOR_FRAG_PARS = /* glsl */ `
uniform vec2 uImpGrid;
uniform sampler2D uImpColor;
uniform sampler2D uImpNormal;
#ifdef IMP_PLANTS
varying vec4 vImpRange;
#endif
varying vec2 vImpUv;
varying vec4 vImpFrames;
varying vec2 vImpBlend;
varying vec3 vImpN0;
varying vec3 vImpN1;
varying vec3 vImpN2;

vec2 impUv(float frame) {
  float row = floor((frame + 0.5) / uImpGrid.x);
  float col = frame - row * uImpGrid.x;
  return (vec2(col, row) + clamp(vImpUv, 0.002, 0.998)) / uImpGrid;
}
`;

// Trees blend two neighbouring yaws. Plants dither both axes: one colour and one normal lookup,
// without artificially thickening a sparse fern or grass tuft by overlaying two silhouettes.
const IMPOSTOR_MAP = /* glsl */ `
vec3 impNormal = vec3(0.0, 0.0, 1.0);
#ifdef IMP_ATLAS
{
  bool upper = forestDither(gl_FragCoord.yx + 7.0) < vImpBlend.y;
  float fa = upper ? vImpFrames.z : vImpFrames.x;
  float fb = upper ? vImpFrames.w : vImpFrames.y;
  // The dither jumps between atlas rows from pixel to pixel; screen derivatives of the
  // smooth quad uv keep the GPU from treating that jump as minification (tiny mips).
  vec2 gx = dFdx(vImpUv) / uImpGrid;
  vec2 gy = dFdy(vImpUv) / uImpGrid;
#if defined(IMP_PLANTS) || defined(IMP_MODEL)
  bool nextYaw = forestDither(gl_FragCoord.xy + vec2(23.0, 13.0)) < vImpBlend.x;
  vec2 uv = impUv(nextYaw ? fb : fa);
  vec4 texel = textureGrad(uImpColor, uv, gx, gy);
  if (texel.a < ${ALPHA_CUT.toFixed(3)}) discard;
  vec3 nl = textureGrad(uImpNormal, uv, gx, gy).xyz * 2.0 - 1.0;
#else
  vec2 ua = impUv(fa);
  vec2 ub = impUv(fb);
  vec4 ta = textureGrad(uImpColor, ua, gx, gy);
  vec4 tb = textureGrad(uImpColor, ub, gx, gy);
  // Union of both silhouettes (averaging their alpha would punch holes where they differ).
  vec4 texel = vec4(mix(ta.rgb, tb.rgb, vImpBlend.x), max(ta.a, tb.a));
  if (texel.a < ${ALPHA_CUT.toFixed(3)}) discard;
  vec3 nl = mix(textureGrad(uImpNormal, ua, gx, gy).xyz, textureGrad(uImpNormal, ub, gx, gy).xyz, vImpBlend.x) * 2.0 - 1.0;
#endif
  diffuseColor.rgb *= texel.rgb;
  impNormal = normalize(mat3(vImpN0, vImpN1, vImpN2) * nl);
}
#endif
`;

const IMPOSTOR_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = impNormal;
vec3 nonPerturbedNormal = normal;
`;
