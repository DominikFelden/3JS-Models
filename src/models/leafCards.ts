import {
  BufferGeometry, Float32BufferAttribute, Color, DataTexture, MeshStandardMaterial, MeshDepthMaterial,
  RGBAFormat, UnsignedByteType, SRGBColorSpace, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter,
  RGBADepthPacking, DoubleSide,
} from 'three';
import { mulberry32, shared } from '../WorldModel.ts';
import { coverageMipmaps, ALPHA_CUT } from '../forest/impostors.ts';
import { injectBillboard } from '../forest/billboard.ts';

/** The card texture is a CARD_GRID x CARD_GRID atlas of leaf-clump pictures. */
export const CARD_GRID = 4;
/** Leaf-clump pictures in the atlas: a row per leaf shape (`LEAF_SHAPES`), a column per arrangement. */
export const CARD_PICTURES = CARD_GRID * CARD_GRID;
/** Pixels of the card texture (CARD_GRID x CARD_GRID pictures of 128 px). */
export const CARD_TEXTURE_SIZE = 512;

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * Leaf shapes, one per atlas row: width / length (`w`, ± `dw`), outline exponent (`p`: small =
 * round, large = slender) and `skew` (< 1: widest near the stalk, > 1: near the tip).
 */
const LEAF_SHAPES = [
  { w: 0.5, dw: 0.14, p: 0.75, skew: 1 },     // oval
  { w: 0.28, dw: 0.06, p: 0.95, skew: 1 },    // slender, willow-like
  { w: 0.78, dw: 0.12, p: 0.5, skew: 1.15 },  // round, aspen-like
  { w: 0.6, dw: 0.1, p: 0.85, skew: 0.65 },   // pointed, birch-like
];

/**
 * Leaf arrangements, one per atlas column. Each returns leaves { bx, by, a (direction), L }
 * in a frame of `f` px; `fit` keeps a leaf inside the frame.
 */
const ARRANGEMENTS = [
  // Rosette: leaves radiating from the middle.
  (f, rnd, s) => {
    const reach = f * 0.46, out = [];
    const count = Math.round((28 + rnd() * 4) * density(s));
    for (let j = 0; j < count; j++) {
      const inner = j < 9;
      const L = reach * (inner ? 0.45 + rnd() * 0.15 : 0.42 + rnd() * 0.2);
      const start = reach * (inner ? rnd() * 0.2 : 0.2 + rnd() * 0.35);
      const a = j * 2.39996 + (rnd() - 0.5) * 0.8, base = Math.min(start, reach - L);
      out.push({ bx: f / 2 + Math.cos(a) * base, by: f / 2 + Math.sin(a) * base, a, L });
    }
    return out;
  },
  // Spray: leaves alternating along a curved twig across the frame, smaller towards its tip.
  (f, rnd, s) => {
    const out = [], a0 = -Math.PI * 0.75 + (rnd() - 0.5) * 0.4;
    const steps = Math.round(14 * density(s)), bend = (rnd() - 0.5) * 0.8;
    let x = f / 2 - Math.cos(a0) * f * 0.36, y = f / 2 - Math.sin(a0) * f * 0.36;
    for (let j = 0; j < steps; j++) {
      const t = j / (steps - 1), a = a0 + bend * t;
      const L = f * (0.36 - 0.14 * t) * (0.85 + rnd() * 0.3);
      for (const side of [1, -1]) {
        if (rnd() < 0.15) continue;
        out.push({ bx: x, by: y, a: a + side * (0.75 + rnd() * 0.35), L });
      }
      x += Math.cos(a) * f * 0.72 / steps;
      y += Math.sin(a) * f * 0.72 / steps;
    }
    out.push({ bx: x, by: y, a: a0 + bend, L: f * 0.25 });
    return out.reverse(); // tip leaves underneath, the big ones near the stalk on top
  },
  // Hanging fan: leaves drooping from a point near the top.
  (f, rnd, s) => {
    const out = [], cx = f * (0.42 + rnd() * 0.16), cy = f * 0.16;
    const count = Math.round(20 * density(s));
    for (let j = 0; j < count; j++) {
      const a = Math.PI / 2 + (vdc(j + 1) - 0.5) * 2.6 + (rnd() - 0.5) * 0.3;
      const start = f * rnd() * 0.25, L = f * (0.32 + rnd() * 0.22);
      out.push({ bx: cx + Math.cos(a) * start, by: cy + Math.sin(a) * start, a, L });
    }
    return out;
  },
  // Loose cluster: a few small rosettes with gaps between them.
  (f, rnd, s) => {
    const out = [], k = 3 + Math.floor(rnd() * 2), a0 = rnd() * Math.PI * 2;
    for (let c = 0; c < k; c++) {
      const ca = a0 + (c / k) * Math.PI * 2 + (rnd() - 0.5) * 0.6, cr = f * (0.17 + rnd() * 0.08);
      const cx = f / 2 + Math.cos(ca) * cr, cy = f / 2 + Math.sin(ca) * cr;
      const m = Math.round(8 * density(s));
      for (let j = 0; j < m; j++) {
        const a = j * 2.39996 + rnd() * 0.8;
        out.push({ bx: cx, by: cy, a, L: f * (0.2 + rnd() * 0.1) });
      }
    }
    return out;
  },
];

/** More leaves of slender shapes, fewer of round ones: every picture covers about as much of its frame. */
const density = (s) => (0.5 / s.w) ** 0.75;

const vdc = (i) => { let v = 0, f = 0.5; for (; i > 0; i >>= 1, f /= 2) if (i & 1) v += f; return v; };

/** Shorten a leaf (keeping its stalk) until its tip and flanks stay inside the frame. */
function fit(l, f, margin) {
  const inside = (x, y) => x >= margin && y >= margin && x <= f - margin && y <= f - margin;
  for (let i = 0; i < 12; i++) {
    const tx = l.bx + l.dx * l.L, ty = l.by + l.dy * l.L, mx = l.bx + l.dx * l.L * 0.5, my = l.by + l.dy * l.L * 0.5;
    const hw = l.W / 2;
    if (inside(tx, ty) && inside(mx - l.dy * hw, my + l.dx * hw) && inside(mx + l.dy * hw, my - l.dx * hw)) return l;
    l.L *= 0.88;
    l.W *= 0.88;
  }
  return l;
}

/**
 * Draw the leaf clumps: CARD_GRID x CARD_GRID pictures of overlapping, inked
 * leaves (light greys, the material colour tints them). Each row has its own leaf shape
 * (`LEAF_SHAPES`), each column its own arrangement (`ARRANGEMENTS`: rosette, spray along a
 * twig, hanging fan, loose cluster). Pure JS, no WebGL needed.
 * Returns { data, size, mean } (mean: linear brightness of the leaf pixels).
 */
export function drawLeafClumps(size = CARD_TEXTURE_SIZE) {
  const data = new Uint8Array(size * size * 4);
  const frame = size / CARD_GRID;
  const margin = frame * 0.04;
  const ink = Math.max(1, frame / 100);
  let sum = 0, n = 0;
  for (let q = 0; q < CARD_PICTURES; q++) {
    const rnd = mulberry32(0x1eaf + q * 7919);
    const shape = LEAF_SHAPES[Math.floor(q / CARD_GRID)];
    const leaves = ARRANGEMENTS[q % CARD_GRID](frame, rnd, shape).map((l) => fit({
      bx: l.bx, by: l.by, dx: Math.cos(l.a), dy: Math.sin(l.a), L: l.L,
      W: l.L * (shape.w + (rnd() - 0.5) * 2 * shape.dw),
    }, frame, margin));
    const ox = (q % CARD_GRID) * frame, oy = Math.floor(q / CARD_GRID) * frame;
    for (let y = 0; y < frame; y++) {
      for (let x = 0; x < frame; x++) {
        let shade = -1;
        for (let j = leaves.length - 1; j >= 0; j--) {
          const l = leaves[j];
          const px = x + 0.5 - l.bx, py = y + 0.5 - l.by;
          const u = (px * l.dx + py * l.dy) / l.L;
          if (u <= 0 || u >= 1) continue;
          const v = -px * l.dy + py * l.dx;
          const hw = (l.W / 2) * Math.sin(Math.PI * u ** shape.skew) ** shape.p;
          const edge = hw - Math.abs(v);
          if (edge <= 0) continue;
          if (edge < ink) shade = 0.3; // ink outline
          else if (Math.abs(v) < ink * 0.45 && u > 0.1 && u < 0.8) shade = 0.6; // midrib
          else shade = 0.84 + 0.12 * (v / hw) + 0.06 * u; // one half lit, lighter towards the tip
          break;
        }
        const i = ((oy + y) * size + ox + x) * 4;
        const c = shade < 0 ? 216 : Math.round(Math.min(1, shade) * 255);
        data[i] = data[i + 1] = data[i + 2] = c;
        data[i + 3] = shade < 0 ? 0 : 255;
        if (shade >= 0) { sum += SRGB_TO_LINEAR[c]; n++; }
      }
    }
  }
  return { data, size, mean: n ? sum / n : 1 };
}

/** The shared leaf-card texture (alpha-cut, mipmaps keep the clump outline). */
export function leafCardTexture() {
  return shared('leafcard:texture', () => {
    const { data, size, mean } = drawLeafClumps();
    const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.mipmaps = coverageMipmaps(data, size, size, size / CARD_GRID);
    t.generateMipmaps = false;
    t.flipY = false;
    t.userData.mean = mean;
    t.needsUpdate = true;
    return t;
  });
}

/**
 * Shared material of leaf cards whose average matches `color` (linear
 * `Color`): the inked clump texture, cut out by alpha test, turned to the
 * camera in the vertex shader. Smooth shading: the cards carry the normals of
 * the crown's sphere, so the crown is lit as one soft volume.
 */
export function leafCardMaterial(color) {
  const tex = leafCardTexture();
  const key = `leafcard:mat:${color.getHexString()}`;
  return shared(key, () => {
    const k = 1 / Math.max(0.05, tex.userData.mean);
    const mat = new MeshStandardMaterial({
      color: new Color(Math.min(3, color.r * k), Math.min(3, color.g * k), Math.min(3, color.b * k)),
      map: tex, alphaTest: ALPHA_CUT, vertexColors: true, roughness: 1, side: DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      injectBillboard(shader);
      // No specular: a card faces the camera but carries the crown's normal, so seen from below
      // (normal away from the viewer) the grazing Fresnel sheen would wash its leaves out to white.
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);');
    };
    mat.customProgramCacheKey = () => 'leaf-card';
    mat.userData.billboard = true;
    return mat;
  });
}

/** Shadow-map material for card meshes (`mesh.customDepthMaterial`): cards face the light. */
export function leafCardDepthMaterial() {
  return shared('leafcard:depth', () => {
    const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: leafCardTexture(), alphaTest: ALPHA_CUT });
    mat.onBeforeCompile = injectBillboard;
    mat.customProgramCacheKey = () => 'leaf-card-depth';
    return mat;
  });
}

/**
 * Card geometry. `cards`: [{ center: Vector3, size, angle, clump (0 .. CARD_PICTURES - 1),
 * normal: Vector3, tint: [r,g,b], aspect (width / height, default 1), flip (mirrored) }].
 * Positions hold a fixed quad (used
 * only where no shader runs); bounds are widened by the card size so culling
 * stays correct whichever way the cards turn.
 */
export function leafCardGeometry(cards) {
  const n = cards.length;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), col = new Float32Array(n * 12);
  const ctr = new Float32Array(n * 12), cor = new Float32Array(n * 8), uv = new Float32Array(n * 8);
  const index = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  let reach = 0;
  cards.forEach((c, i) => {
    const k = Math.sqrt(c.aspect ?? 1), hx = (c.size / 2) * k, hy = c.size / 2 / k;
    const cs = Math.cos(c.angle), sn = Math.sin(c.angle), t = 1 / CARD_GRID;
    const u0 = (c.clump % CARD_GRID) * t, v0 = Math.floor(c.clump / CARD_GRID) * t;
    reach = Math.max(reach, Math.hypot(hx, hy));
    corners.forEach(([x, y], k) => {
      const o = i * 4 + k;
      const cx = x * hx * cs - y * hy * sn, cy = x * hx * sn + y * hy * cs;
      pos.set([c.center.x + cx, c.center.y + cy, c.center.z], o * 3);
      ctr.set([c.center.x, c.center.y, c.center.z], o * 3);
      cor.set([cx, cy], o * 2);
      nor.set([c.normal.x, c.normal.y, c.normal.z], o * 3);
      col.set(c.tint, o * 3);
      uv.set([u0 + ((c.flip ? -x : x) + 1) * 0.5 * t, v0 + (y + 1) * 0.5 * t], o * 2);
    });
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('cardCenter', new Float32BufferAttribute(ctr, 3));
  g.setAttribute('cardCorner', new Float32BufferAttribute(cor, 2));
  g.setIndex(index);
  // Turned cards reach up to `reach` around their centre in any direction.
  const box = g.computeBoundingBox.bind(g), sphere = g.computeBoundingSphere.bind(g);
  g.computeBoundingBox = () => { box(); g.boundingBox.expandByScalar(reach); };
  g.computeBoundingSphere = () => { sphere(); g.boundingSphere.radius += reach; };
  g.userData.cardReach = reach;
  return g;
}
