import {
  BufferGeometry, Float32BufferAttribute, Color, DataTexture, MeshStandardMaterial, MeshDepthMaterial, Vector3,
  RGBAFormat, UnsignedByteType, SRGBColorSpace, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter,
  RGBADepthPacking, DoubleSide,
} from 'three';
import { mulberry32, shared } from '../WorldModel.ts';
import { coverageMipmaps, ALPHA_CUT } from '../forest/impostors.ts';

/**
 * Hand-inked fronds for ground plants (ferns, bracken, tall grass, broadleaf
 * plants). Like the leaf cards of the stylized tree, a plant is a few alpha-cut
 * quads wearing a drawn picture, so a whole fern costs ~10 quads and one draw
 * call. Unlike leaf cards, fronds are real (not camera-facing) strips: they
 * arch out of the plant's centre and are lit with normals that lean to the sky.
 *
 * The pictures live in one atlas, one square picture per `PLANT_PICTURES` entry.
 */

/** Pictures in the atlas, left to right. */
export const PLANT_PICTURES = { fern: 0, bracken: 1, grass: 2, broadleaf: 3 };
const PICTURE_COUNT = 4;
/** Pixels of one square picture. */
export const PLANT_PICTURE_SIZE = 128;

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** A leaf or stalk to paint: base (bx, by), unit direction (dx, dy), length L, width W, outline exponent p and skew. */
type Stroke = { bx: number, by: number, dx: number, dy: number, L: number, W: number, p: number, skew: number, flat?: number };

const stroke = (bx, by, angle, L, W, p = 0.8, skew = 1, flat?): Stroke => ({ bx, by, dx: Math.sin(angle), dy: -Math.cos(angle), L, W, p, skew, flat });

/**
 * Leaflets along a (slightly bending) stalk from (bx, by) pointing `angle` (0 = up the picture):
 * `pairs` pairs of leaflets, the longest in the lower third and shrinking towards the tip.
 * `spread` is the angle between leaflet and stalk, `bend` the angle the stalk curves over its length.
 */
function pinnate(bx, by, angle, length, pairs, { leaflet, spread, bend = 0, width = 0.22, rnd, stalk = 0.12 }): Stroke[] {
  const out: Stroke[] = [];
  let x = bx, y = by, a = angle;
  const step = length * (1 - stalk) / pairs;
  const bare = length * stalk;
  out.push(stroke(bx, by, angle, length, 2.6, 2, 1, 0.55)); // the stalk itself
  x += Math.sin(a) * bare; y -= Math.cos(a) * bare;
  for (let i = 0; i < pairs; i++) {
    const t = i / (pairs - 1);
    a = angle + bend * (bare + i * step) / length;
    const size = leaflet * (0.15 + 0.85 * Math.sin(Math.PI * (1 - t) ** 1.1)) * (0.9 + rnd() * 0.2);
    for (const side of [-1, 1]) {
      const la = a + side * (spread - 0.35 * t + (rnd() - 0.5) * 0.2);
      out.push(stroke(x, y, la, size, size * width * 2.2, 0.85, 1));
    }
    x += Math.sin(a) * step; y -= Math.cos(a) * step;
  }
  out.push(stroke(x, y, a, leaflet * 0.5, leaflet * 0.2, 0.85, 1)); // terminal leaflet
  return out;
}

/** The four pictures as strokes in a square frame of `f` pixels; the plant's base is at the bottom middle. */
const PICTURES: ((f: number, rnd: () => number) => Stroke[])[] = [
  // Fern: one arching frond, finely divided into narrow leaflets.
  (f, rnd) => pinnate(f / 2, f - 3, 0, f * 0.95, 13, { leaflet: f * 0.36, spread: 1.25, bend: 0.15, width: 0.13, rnd }),
  // Bracken: a long stalk and a broad, triangular blade of three-part branches.
  (f, rnd) => {
    const out: Stroke[] = [stroke(f / 2, f - 3, 0, f * 0.95, 3, 2, 1, 0.55)];
    const base = f * 0.3, top = f * 0.9;
    const branches = 5;
    for (let i = 0; i < branches; i++) {
      const t = i / (branches - 1);
      const y = f - 3 - base - (top - base) * t * 0.95;
      const reach = f * (0.46 - 0.3 * t ** 1.3);
      for (const side of [-1, 1]) {
        out.push(...pinnate(f / 2, y, side * (1.15 - 0.35 * t), reach, 6, { leaflet: reach * 0.5, spread: 0.95, width: 0.2, rnd, stalk: 0.05 }));
      }
    }
    out.push(stroke(f / 2, f - 3 - top * 0.9, 0, f * 0.14, f * 0.05, 0.85, 1));
    return out;
  },
  // Tall grass: slender blades fanning out of one point, a few bending over.
  (f, rnd) => {
    const out: Stroke[] = [];
    const blades = 8;
    for (let i = 0; i < blades; i++) {
      const t = (i + 0.5) / blades - 0.5;
      const L = f * (0.62 + 0.3 * (1 - Math.abs(t) * 2) * (0.7 + rnd() * 0.3));
      out.push(stroke(f / 2 + t * f * 0.12, f - 3, t * 1.05 + (rnd() - 0.5) * 0.2, L, L * 0.11, 0.55, 0.55));
    }
    return out;
  },
  // Broadleaf (hosta-like): three big, ribbed oval leaves on short stalks.
  (f, rnd) => [
    stroke(f / 2, f - 3, -0.55, f * 0.78, f * 0.5, 0.7, 0.85),
    stroke(f / 2, f - 3, 0.6, f * 0.72, f * 0.46, 0.7, 0.85),
    stroke(f / 2, f - 3, (rnd() - 0.5) * 0.15, f * 0.95, f * 0.58, 0.7, 0.85),
  ],
];

/** Paint one stroke into the atlas (light greys: the material colour tints them), with an ink outline and a midrib. */
function paint(data: Uint8Array, size: number, ox: number, frame: number, s: Stroke) {
  const hw = Math.max(s.W / 2, 1.5);
  const ex = [s.bx, s.bx + s.dx * s.L, s.bx + s.dx * s.L * 0.5 - s.dy * hw, s.bx + s.dx * s.L * 0.5 + s.dy * hw];
  const ey = [s.by, s.by + s.dy * s.L, s.by + s.dy * s.L * 0.5 + s.dx * hw, s.by + s.dy * s.L * 0.5 - s.dx * hw];
  const x0 = Math.max(0, Math.floor(Math.min(...ex) - 2)), x1 = Math.min(frame - 1, Math.ceil(Math.max(...ex) + 2));
  const y0 = Math.max(0, Math.floor(Math.min(...ey) - 2)), y1 = Math.min(frame - 1, Math.ceil(Math.max(...ey) + 2));
  const ink = Math.max(1, frame / 100);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - s.bx, py = y + 0.5 - s.by;
      const u = (px * s.dx + py * s.dy) / s.L;
      if (u <= 0 || u >= 1) continue;
      const v = -px * s.dy + py * s.dx;
      const half = s.flat !== undefined ? s.W / 2 * (1 - u * 0.7) : (s.W / 2) * Math.sin(Math.PI * u ** s.skew) ** s.p;
      const edge = Math.max(half, s.flat !== undefined ? 0.8 : 0) - Math.abs(v);
      if (edge <= 0) continue;
      let shade;
      if (s.flat !== undefined) shade = s.flat;
      else if (edge < ink) shade = 0.3;
      else if (Math.abs(v) < ink * 0.45 && u > 0.1 && u < 0.85) shade = 0.6;
      else shade = 0.84 + 0.12 * (v / half) + 0.06 * u;
      const c = Math.round(Math.min(1, shade) * 255);
      const i = (y * size + ox + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
}

/** Draw the atlas (PICTURE_COUNT pictures side by side). Pure JS, no WebGL needed. Returns { data, width, height, mean }. */
export function drawPlantAtlas(frame = PLANT_PICTURE_SIZE) {
  const width = frame * PICTURE_COUNT, height = frame;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 216;
  for (let q = 0; q < PICTURE_COUNT; q++) {
    const rnd = mulberry32(0x9a47 + q * 7919);
    const strokes = PICTURES[q](frame, rnd);
    // Paint into a frame-wide strip: each picture gets its own columns, `paint` clips to the frame.
    for (const s of strokes) paint(data, width, q * frame, frame, s);
  }
  let sum = 0, n = 0;
  for (let i = 0; i < width * height; i++) if (data[i * 4 + 3]) { sum += SRGB_TO_LINEAR[data[i * 4]]; n++; }
  return { data, width, height, mean: n ? sum / n : 1 };
}

/** The shared frond texture (alpha-cut, mipmaps keep the silhouette). */
export function plantTexture() {
  return shared('plant:texture', () => {
    const { data, width, height, mean } = drawPlantAtlas();
    const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.mipmaps = coverageMipmaps(data, width, height, PLANT_PICTURE_SIZE);
    t.generateMipmaps = false;
    t.flipY = false;
    t.userData.mean = mean;
    t.needsUpdate = true;
    return t;
  });
}

/** Shared frond material whose average colour matches `color` (a linear `Color`). Double-sided, alpha-cut, vertex-tinted. */
export function plantMaterial(color: Color) {
  const tex = plantTexture();
  return shared(`plant:mat:${color.getHexString()}`, () => {
    const k = 1 / Math.max(0.05, tex.userData.mean);
    return new MeshStandardMaterial({
      color: new Color(Math.min(3, color.r * k), Math.min(3, color.g * k), Math.min(3, color.b * k)),
      map: tex, alphaTest: ALPHA_CUT, vertexColors: true, roughness: 1, side: DoubleSide,
    });
  });
}

/** Shadow-map material for frond meshes (`mesh.customDepthMaterial`). */
export function plantDepthMaterial() {
  return shared('plant:depth', () => new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: plantTexture(), alphaTest: ALPHA_CUT, side: DoubleSide }));
}

/** Segments along a frond: enough to show its arch. */
const FROND_SEGMENTS = 4;

/**
 * One frond: a strip arching out of `base`. `yaw` is the direction it leans to, `pitch` its start angle from
 * straight up (0 = upright, 1.57 = flat), `droop` how much further it bends over its length (radians).
 * `length` and `width` are in model units; `picture` is a `PLANT_PICTURES` entry; `tint` multiplies the colour.
 */
export type Frond = { base: Vector3, yaw: number, pitch: number, droop: number, length: number, width: number, picture: number, tint: number[], flip?: boolean };

/**
 * Geometry of many fronds in one mesh. Normals lean to the sky (like the crown normals of the leaf cards),
 * so the plant is lit as one soft clump and its underside is not black.
 */
export function frondGeometry(fronds: Frond[]) {
  const rows = FROND_SEGMENTS + 1;
  const n = fronds.length * rows * 2;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const index: number[] = [];
  const spine = new Vector3(), dir = new Vector3(), side = new Vector3(), normal = new Vector3();
  const t = 1 / PICTURE_COUNT;
  fronds.forEach((f, i) => {
    const out = new Vector3(Math.cos(f.yaw), 0, Math.sin(f.yaw));
    side.set(-out.z, 0, out.x).multiplyScalar(f.width / 2);
    spine.copy(f.base);
    const step = f.length / FROND_SEGMENTS;
    for (let r = 0; r < rows; r++) {
      const along = r / FROND_SEGMENTS;
      const angle = f.pitch + f.droop * along * along; // the frond bends over more towards its tip
      dir.set(out.x * Math.sin(angle), Math.cos(angle), out.z * Math.sin(angle));
      // Frond normal: perpendicular to the spine and the side vector, leaned to the sky.
      normal.crossVectors(side, dir).normalize();
      if (normal.y < 0) normal.negate();
      normal.multiplyScalar(0.5).y += 0.5;
      normal.normalize();
      const shade = 0.72 + 0.28 * along;
      for (let s = 0; s < 2; s++) {
        const o = i * rows * 2 + r * 2 + s, sign = s === 0 ? -1 : 1;
        pos.set([spine.x + side.x * sign, spine.y, spine.z + side.z * sign], o * 3);
        nor.set([normal.x, normal.y, normal.z], o * 3);
        col.set([f.tint[0] * shade, f.tint[1] * shade, f.tint[2] * shade], o * 3);
        uv.set([f.picture * t + ((f.flip ? -sign : sign) + 1) * 0.5 * t, 1 - along], o * 2);
      }
      spine.addScaledVector(dir, step);
    }
    for (let r = 0; r < FROND_SEGMENTS; r++) {
      const a = i * rows * 2 + r * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}
