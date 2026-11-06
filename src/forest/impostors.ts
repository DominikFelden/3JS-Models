import {
  Scene, Mesh, OrthographicCamera, WebGLRenderTarget, MeshBasicMaterial, ShaderMaterial, MeshStandardMaterial,
  InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, DataTexture, Color, Vector2, Vector3,
  RGBAFormat, UnsignedByteType, SRGBColorSpace, NoColorSpace, ClampToEdgeWrapping, LinearFilter,
  LinearMipmapLinearFilter, NearestFilter, NoToneMapping, DoubleSide,
} from 'three';
import { withBakeRenderer } from '../textures/bake.ts';
import { FADE_PARS, FADE_TEST } from './fade.ts';

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

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const NORMAL_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Flat normal of the triangle in tree space, turned towards the camera (thin leaves are double sided).
const NORMAL_FRAG = /* glsl */ `
uniform vec3 uView;
varying vec3 vPos;
void main() {
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(n, uView) < 0.0) n = -n;
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
export function atlasLayout(variants, size, maxTextureSize = 4096) {
  const frames = variants * IMPOSTOR_ELEVATIONS * IMPOSTOR_YAWS;
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const frame = Math.max(8, Math.min(size, Math.floor(maxTextureSize / cols), Math.floor(maxTextureSize / rows)));
  return { cols, rows, frame, width: cols * frame, height: rows * frame };
}

/**
 * Photograph every variant from all impostor directions.
 *  - variants: [{ meshes: [Mesh], centreY, radius }] (meshes in tree space, base at the origin)
 *  - renderer: the host's WebGLRenderer (optional, otherwise a private one)
 *  - frameSize: pixels per picture (default 128)
 * Returns { color, normal, cols, rows, frame, means: [Color] (linear average of each variant) }.
 */
export function bakeImpostors(variants, { renderer = null, frameSize = 128 }: any = {}) {
  return withBakeRenderer(renderer, (r) => {
    const layout = atlasLayout(variants.length, frameSize, r.capabilities.maxTextureSize);
    const { cols, frame: S, width: W, height: H } = layout;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const target = (colorSpace) => new WebGLRenderTarget(W, H, {
      colorSpace, depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter,
    });
    const colorTarget = target(SRGBColorSpace);
    const normalTarget = target(NoColorSpace);
    const normalMat = new ShaderMaterial({ vertexShader: NORMAL_VERT, fragmentShader: NORMAL_FRAG, uniforms: { uView: { value: new Vector3() } }, side: DoubleSide });
    const basic = new Map();
    const albedo = (m) => {
      if (!basic.has(m)) basic.set(m, new MeshBasicMaterial({ map: m.map, color: m.color, vertexColors: m.vertexColors, side: m.side }));
      return basic.get(m);
    };
    const groups = variants.map(({ meshes }) => meshes.map((src) => {
      const color = new Mesh(src.geometry, albedo(src.material));
      const normal = new Mesh(src.geometry, normalMat);
      color.frustumCulled = normal.frustumCulled = false;
      scene.add(color, normal);
      return { color, normal };
    }));

    const saved = {
      target: r.getRenderTarget(), tone: r.toneMapping, autoClear: r.autoClear, clearAlpha: r.getClearAlpha(), clearColor: r.getClearColor(new Color()),
    };
    r.toneMapping = NoToneMapping;
    r.autoClear = true;
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
          const R = v.radius;
          Object.assign(camera, { left: -R, right: R, top: R, bottom: -R, near: R * 0.01, far: R * 4 });
          camera.updateProjectionMatrix();
          for (let e = 0; e < IMPOSTOR_ELEVATIONS; e++) {
            const el = (e / (IMPOSTOR_ELEVATIONS - 1)) * Math.PI / 2;
            for (let y = 0; y < IMPOSTOR_YAWS; y++) {
              const a = (y / IMPOSTOR_YAWS) * Math.PI * 2;
              const idx = (vi * IMPOSTOR_ELEVATIONS + e) * IMPOSTOR_YAWS + y;
              const x0 = (idx % cols) * S, y0 = Math.floor(idx / cols) * S;
              dir.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
              camera.position.copy(centre).addScaledVector(dir, R * 2);
              // Straight above, "up" is the limit of the side views' up for this yaw, so the picture turns with the yaw.
              if (e === IMPOSTOR_ELEVATIONS - 1) camera.up.set(-Math.sin(a), 0, -Math.cos(a)); else camera.up.set(0, 1, 0);
              camera.lookAt(centre);
              camera.updateMatrixWorld();
              normalMat.uniforms.uView.value.copy(dir);
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
      const means = fillAndMeasure(colorData, layout, variants.length);
      return {
        ...layout,
        color: atlasTexture(colorData, W, H, SRGBColorSpace, S),
        normal: atlasTexture(normalData, W, H, NoColorSpace),
        means,
      };
    } finally {
      r.setRenderTarget(saved.target);
      r.toneMapping = saved.tone;
      r.autoClear = saved.autoClear;
      r.setClearColor(saved.clearColor, saved.clearAlpha);
      colorTarget.dispose();
      normalTarget.dispose();
      normalMat.dispose();
      basic.forEach((m) => m.dispose());
    }
  });
}

/**
 * Average colour (linear) of each variant's opaque pixels, and paint the
 * empty pixels of every frame in its variant's average sRGB colour, so the
 * soft (mipmapped) outline of a far tree keeps the tree's colour.
 */
function fillAndMeasure(data, { cols, frame: S, width: W }, nVariants) {
  const per = IMPOSTOR_ELEVATIONS * IMPOSTOR_YAWS;
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

/**
 * The impostors of a forest: one instanced quad per tree.
 *  - trees: [{x, y, z, yaw, scale, variant}] in forest space
 *  - variants: [{ centreY, radius }] per tree variant (crown centre height, bounding radius)
 *  - atlas: result of `bakeImpostors`, or null (no WebGL: plain colour, never really drawn)
 *  - shared: { range, camera, scale } uniforms owned by the forest
 */
export function createImpostors(trees, variants, atlas, shared, color = new Color(0x3a6a30)) {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('normal', quad.attributes.normal);
  geometry.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(trees.length * 4);
  const meta = new Float32Array(trees.length * 2);
  trees.forEach((t, i) => {
    pos.set([t.x, t.y, t.z, t.scale], i * 4);
    meta.set([t.yaw, t.variant], i * 2);
  });
  geometry.setAttribute('iPos', new InstancedBufferAttribute(pos, 4));
  geometry.setAttribute('iMeta', new InstancedBufferAttribute(meta, 2));
  geometry.instanceCount = trees.length;

  const material = new MeshStandardMaterial({ color: atlas ? 0xffffff : color, roughness: 1, metalness: 0, side: DoubleSide });
  const variantInfo = variants.map((v) => new Vector2(v.centreY, v.radius));
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uForestCam: shared.camera, uForestScale: shared.scale, uImpVariants: { value: variantInfo },
      uImpGrid: { value: new Vector2(atlas?.cols ?? 1, atlas?.rows ?? 1) },
      uImpColor: { value: atlas?.color ?? null }, uImpNormal: { value: atlas?.normal ?? null },
    });
    const defines = `#define IMP_YAWS ${IMPOSTOR_YAWS}.0\n#define IMP_ELEVS ${IMPOSTOR_ELEVATIONS}.0\n#define IMP_VARIANTS ${variantInfo.length}\n${atlas ? '#define IMP_ATLAS\n' : ''}`;
    shader.vertexShader = `${defines}${IMPOSTOR_VERT_PARS}${shader.vertexShader.replace('#include <begin_vertex>', IMPOSTOR_VERT)}`;
    shader.fragmentShader = `${defines}${IMPOSTOR_FRAG_PARS}${shader.fragmentShader
      .replace('#include <map_fragment>', IMPOSTOR_MAP)
      .replace('#include <normal_fragment_begin>', IMPOSTOR_NORMAL)}`;
    shader.uniforms.uForestRange = shared.range;
    shader.fragmentShader = FADE_PARS + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `${FADE_TEST}\n#include <clipping_planes_fragment>`);
  };
  material.customProgramCacheKey = () => `forest-impostor:${variantInfo.length}:${!!atlas}`;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // trees are culled by distance in the vertex shader
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'ForestImpostors';
  return mesh;
}

const IMPOSTOR_VERT_PARS = /* glsl */ `
attribute vec4 iPos;
attribute vec2 iMeta;
uniform vec3 uForestCam;
uniform float uForestScale;
uniform vec4 uForestRange;
uniform vec2 uImpVariants[IMP_VARIANTS];
varying float vForestDist;
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
  float scale = iPos.w;
  float d = uForestScale * distance(iPos.xyz, uForestCam);
  vForestDist = d;
  if (d >= uForestRange.x - 0.5 * uForestRange.y && d < uForestRange.z + 0.5 * uForestRange.w) {
    vec2 info = uImpVariants[int(iMeta.y + 0.5)];
    vec3 centre = iPos.xyz + vec3(0.0, info.x * scale, 0.0);
    vec3 f = uForestCam - centre;
    float fl = length(f);
    f = fl > 1e-5 ? f / fl : vec3(0.0, 0.0, 1.0);
    vec3 right = cross(vec3(0.0, 1.0, 0.0), f);
    float rl = length(right);
    right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
    vec3 up = cross(f, right);
    transformed = centre + (right * position.x + up * position.y) * (2.0 * info.y * scale);

    // Direction to the camera in the tree's own frame picks the pictures.
    float c = cos(iMeta.x);
    float s = sin(iMeta.x);
    vec3 l = vec3(c * f.x - s * f.z, f.y, s * f.x + c * f.z);
    float az = atan(l.x, l.z);
    if (az < 0.0) az += 6.28318531;
    float fy = az / (6.28318531 / IMP_YAWS);
    float y0 = mod(floor(fy), IMP_YAWS);
    float y1 = mod(y0 + 1.0, IMP_YAWS);
    float fe = asin(clamp(l.y, 0.0, 1.0)) / (1.57079633 / (IMP_ELEVS - 1.0));
    float e0 = min(floor(fe), IMP_ELEVS - 2.0);
    float base = iMeta.y * IMP_ELEVS + e0;
    vImpFrames = vec4(base * IMP_YAWS + y0, base * IMP_YAWS + y1, (base + 1.0) * IMP_YAWS + y0, (base + 1.0) * IMP_YAWS + y1);
    vImpBlend = vec2(fract(fy), clamp(fe - e0, 0.0, 1.0));
    mat3 m = normalMatrix * mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
    vImpN0 = m[0];
    vImpN1 = m[1];
    vImpN2 = m[2];
  }
}
`;

const IMPOSTOR_FRAG_PARS = /* glsl */ `
uniform vec2 uImpGrid;
uniform sampler2D uImpColor;
uniform sampler2D uImpNormal;
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

// Two neighbouring yaw pictures are blended; between two heights the dither picks one.
const IMPOSTOR_MAP = /* glsl */ `
vec3 impNormal = vec3(0.0, 0.0, 1.0);
#ifdef IMP_ATLAS
{
  bool upper = forestDither(gl_FragCoord.yx + 7.0) < vImpBlend.y;
  float fa = upper ? vImpFrames.z : vImpFrames.x;
  float fb = upper ? vImpFrames.w : vImpFrames.y;
  vec2 ua = impUv(fa);
  vec2 ub = impUv(fb);
  // The dither jumps between atlas rows from pixel to pixel; screen derivatives of the
  // smooth quad uv keep the GPU from treating that jump as minification (tiny mips).
  vec2 gx = dFdx(vImpUv) / uImpGrid;
  vec2 gy = dFdy(vImpUv) / uImpGrid;
  vec4 ta = textureGrad(uImpColor, ua, gx, gy);
  vec4 tb = textureGrad(uImpColor, ub, gx, gy);
  // Union of both silhouettes (averaging their alpha would punch holes where they differ).
  vec4 texel = vec4(mix(ta.rgb, tb.rgb, vImpBlend.x), max(ta.a, tb.a));
  if (texel.a < ${ALPHA_CUT.toFixed(3)}) discard;
  diffuseColor.rgb *= texel.rgb;
  vec3 nl = mix(textureGrad(uImpNormal, ua, gx, gy).xyz, textureGrad(uImpNormal, ub, gx, gy).xyz, vImpBlend.x) * 2.0 - 1.0;
  impNormal = normalize(mat3(vImpN0, vImpN1, vImpN2) * nl);
}
#endif
`;

const IMPOSTOR_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = impNormal;
vec3 nonPerturbedNormal = normal;
`;
