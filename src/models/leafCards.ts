import {
  BufferGeometry, Float32BufferAttribute, Color, DataTexture, MeshStandardMaterial, MeshDepthMaterial,
  RGBAFormat, UnsignedByteType, SRGBColorSpace, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter,
  RGBADepthPacking, DoubleSide,
} from 'three';
import { mulberry32, shared } from '../WorldModel.ts';
import { coverageMipmaps, ALPHA_CUT } from '../forest/impostors.ts';
import { injectBillboard } from '../forest/billboard.ts';

/** Pixels of the card texture (2 x 2 different leaf clumps). */
export const CARD_TEXTURE_SIZE = 256;

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * Draw the leaf clumps: four 128 px pictures of ~30 overlapping, inked leaves
 * (light greys, the material colour tints them). Pure JS, no WebGL needed.
 * Returns { data, size, mean } (mean: linear brightness of the leaf pixels).
 */
export function drawLeafClumps(size = CARD_TEXTURE_SIZE) {
  const data = new Uint8Array(size * size * 4);
  const frame = size / 2;
  const margin = frame * 0.04;
  const reach = frame / 2 - margin;
  const ink = Math.max(1, frame / 100);
  let sum = 0, n = 0;
  for (let q = 0; q < 4; q++) {
    const rnd = mulberry32(0x1eaf + q * 7919);
    const leaves = [];
    const count = 26 + q * 2;
    for (let j = 0; j < count; j++) {
      const a = j * 2.39996 + (rnd() - 0.5) * 0.8;
      const inner = j < 9;
      const L = reach * (inner ? 0.45 + rnd() * 0.15 : 0.42 + rnd() * 0.2);
      const start = reach * (inner ? rnd() * 0.2 : 0.2 + rnd() * 0.35);
      const base = Math.min(start, reach - L);
      const dx = Math.cos(a), dy = Math.sin(a);
      leaves.push({ bx: frame / 2 + dx * base, by: frame / 2 + dy * base, dx, dy, L, W: L * (0.5 + rnd() * 0.14) });
    }
    const ox = (q % 2) * frame, oy = Math.floor(q / 2) * frame;
    for (let y = 0; y < frame; y++) {
      for (let x = 0; x < frame; x++) {
        let shade = -1;
        for (let j = leaves.length - 1; j >= 0; j--) {
          const l = leaves[j];
          const px = x + 0.5 - l.bx, py = y + 0.5 - l.by;
          const u = (px * l.dx + py * l.dy) / l.L;
          if (u <= 0 || u >= 1) continue;
          const v = -px * l.dy + py * l.dx;
          const hw = (l.W / 2) * Math.sin(Math.PI * u) ** 0.75;
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
    t.mipmaps = coverageMipmaps(data, size, size, size / 2);
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
    mat.onBeforeCompile = injectBillboard;
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
 * Card geometry. `cards`: [{ center: Vector3, size, angle, clump (0..3),
 * normal: Vector3, tint: [r,g,b] }]. Positions hold a fixed quad (used
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
    const h = c.size / 2, cs = Math.cos(c.angle), sn = Math.sin(c.angle);
    const u0 = (c.clump % 2) * 0.5, v0 = Math.floor(c.clump / 2) * 0.5;
    reach = Math.max(reach, h * Math.SQRT2);
    corners.forEach(([x, y], k) => {
      const o = i * 4 + k;
      const cx = (x * cs - y * sn) * h, cy = (x * sn + y * cs) * h;
      pos.set([c.center.x + cx, c.center.y + cy, c.center.z], o * 3);
      ctr.set([c.center.x, c.center.y, c.center.z], o * 3);
      cor.set([cx, cy], o * 2);
      nor.set([c.normal.x, c.normal.y, c.normal.z], o * 3);
      col.set(c.tint, o * 3);
      uv.set([u0 + (x + 1) * 0.25, v0 + (y + 1) * 0.25], o * 2);
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
