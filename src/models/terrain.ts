import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, LatheGeometry, Vector2 } from 'three';
import { shared } from '../WorldModel.ts';

/**
 * Small helpers for organic, hand-modelled looking shapes (terrain, rocks,
 * ice): seeded 3D value noise, grids that are turned into triangle soups,
 * and a few cached, pre-displaced rock blobs. Displacements only depend on
 * the vertex POSITION, so vertices shared by several faces stay welded.
 */

const smooth = (t) => t * t * (3 - 2 * t);

/** Hash of an integer lattice point to [0, 1). */
export function hash3(x, y, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). `s` is an integer seed. */
export function noise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, s);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Fractal noise in [0, 1), `oct` octaves. */
export function fbm3(x, y, z, s = 0, oct = 3) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise3(x * f, y * f, z * f, s + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Integer noise seed of a model, without touching its random stream. */
export const noiseSeed = (model, salt = 0) => ((model.seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0) & 0xfffff;

/**
 * Triangles of a (rows x cols) quad grid. `at(i, j)` returns the [x, y, z] of
 * grid point i in 0..rows, j in 0..cols. Returns [[a, b, c], ...] with
 * counter-clockwise winding seen from where (i, j) runs (right, up).
 */
export function gridTriangles(rows, cols, at) {
  const pts = [];
  for (let i = 0; i <= rows; i++) {
    const row = [];
    for (let j = 0; j <= cols; j++) row.push(at(i, j));
    pts.push(row);
  }
  const tris = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = pts[i][j], b = pts[i][j + 1], c = pts[i + 1][j + 1], d = pts[i + 1][j];
      // Split along alternating diagonals to avoid a visible grain.
      if ((i + j) % 2) { tris.push([a, b, c], [a, c, d]); } else { tris.push([a, b, d], [b, c, d]); }
    }
  }
  return tris;
}

/** Non-indexed geometry from [[a, b, c], ...] triangles; `flip` reverses the winding. */
export function trianglesGeometry(tris, flip = false) {
  const pos = new Float32Array(tris.length * 9);
  let k = 0;
  for (const t of tris) {
    const order = flip ? [t[0], t[2], t[1]] : t;
    for (const p of order) { pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2]; }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Triangle centre. */
export const centroid = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];

/** Upward component of a triangle's unit normal (1 = flat ground, 0 = wall). */
export function upness(t) {
  const [a, b, c] = t;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return n[1] / (Math.hypot(n[0], n[1], n[2]) || 1);
}

export const BLOB_VARIANTS = 6;

/**
 * Lumpy rock of radius ~1 (cached per variant and detail): an icosphere pushed
 * in and out by noise, with a few flat cleavage planes so it reads as stone,
 * not as a potato. Use `flat` to cut the bottom (sits on the ground at y = -0.25).
 */
export function rockBlob(variant = 0, detail = 1, flat = true) {
  const v = ((variant % BLOB_VARIANTS) + BLOB_VARIANTS) % BLOB_VARIANTS;
  return shared(`terrain:blob:${v}:${detail}:${flat}`, () => {
    const g = new IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const planes = [];
    for (let k = 0; k < 3; k++) {
      const a = hash3(v, k, 1) * Math.PI * 2, e = (hash3(v, k, 2) - 0.3) * 1.2;
      planes.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e), 0.62 + 0.2 * hash3(v, k, 3)]);
    }
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = 0.82 + 0.36 * fbm3(x * 1.6 + v * 7, y * 1.6, z * 1.6, 17 + v, 2);
      x *= r; y *= r; z *= r;
      for (const [nx, ny, nz, d] of planes) {
        const s = x * nx + y * ny + z * nz;
        if (s > d) { x -= nx * (s - d); y -= ny * (s - d); z -= nz * (s - d); }
      }
      if (flat && y < -0.25) y = -0.25;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Crystal / shard of height 1 standing on y = 0: an n-sided prism that tapers
 * to a point (`tip` = share of the height used by the point).
 */
export function shardGeometry(sides = 6, tip = 0.28, taper = 0.85) {
  return shared(`terrain:shard:${sides}:${tip}:${taper}`, () => new LatheGeometry([
    new Vector2(0, 0), new Vector2(0.92, 0), new Vector2(1, 0.06), new Vector2(taper, 1 - tip), new Vector2(0, 1),
  ], sides));
}

/**
 * Copy of `g` (non-indexed) that also has back faces (reversed winding,
 * flipped normals), for thin sheets such as cloth and sails that are seen
 * from both sides but should keep single-sided, shared materials.
 */
export function withBackFaces(g) {
  const src = g.index ? g.toNonIndexed() : g;
  if (!src.attributes.normal) src.computeVertexNormals();
  const out = new BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name], n = a.itemSize, c = a.count;
    const arr = new Float32Array(c * 2 * n);
    arr.set(a.array, 0);
    for (let t = 0; t < c; t += 3) {
      for (const [dst, s] of [[0, 0], [1, 2], [2, 1]]) {
        for (let k = 0; k < n; k++) {
          const v = a.array[(t + s) * n + k];
          arr[(c + t + dst) * n + k] = name === 'normal' ? -v : v;
        }
      }
    }
    out.setAttribute(name, new Float32BufferAttribute(arr, n));
  }
  if (src !== g) src.dispose();
  return out;
}

/**
 * Flame of height 1 standing on y = 0: a faceted teardrop with a slight
 * twist, the stylised shape of a painted fire.
 */
export function flameGeometry() {
  return shared('terrain:flame', () => {
    const g = new LatheGeometry([
      new Vector2(0, 0), new Vector2(0.45, 0.07), new Vector2(0.7, 0.22), new Vector2(0.62, 0.42),
      new Vector2(0.36, 0.66), new Vector2(0.12, 0.87), new Vector2(0, 1),
    ], 7);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = y * 1.6;
      p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a) + 0.12 * y * y, y, x * Math.sin(a) + z * Math.cos(a));
    }
    g.computeVertexNormals();
    return g;
  });
}
