import { Float32BufferAttribute } from 'three';

/**
 * Generates UVs that keep a texture at a constant WORLD size, so a wall of any
 * dimension shows bricks of the same size. It looks at the final (already
 * transformed) triangles and returns a non-indexed geometry, because every
 * triangle gets its own projection plane.
 *
 *  - 'world': box projection. The dominant axis of a triangle's normal picks
 *             the plane (x/z for tops, otherwise y is "up"). For things where
 *             no direction matters (rocks).
 *  - 'face':  projects into the triangle's own plane with v running up the
 *             wall or up the slope of a roof, so brick courses and shingle
 *             rows stay level. Coordinates are absolute, so neighbouring
 *             surfaces of one model continue each other's pattern.
 *
 * @param {BufferGeometry} geometry
 * @param {'world'|'face'} mode
 * @param {number} tile world size of one texture repeat
 */
export function projectUV(geometry, mode, tile) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / tile;
  const face = mode === 'face';

  for (let t = 0; t + 2 < pos.count; t += 3) {
    const ax = pos.getX(t), ay = pos.getY(t), az = pos.getZ(t);
    const e1x = pos.getX(t + 1) - ax, e1y = pos.getY(t + 1) - ay, e1z = pos.getZ(t + 1) - az;
    const e2x = pos.getX(t + 2) - ax, e2y = pos.getY(t + 2) - ay, e2z = pos.getZ(t + 2) - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) { nx = 0; ny = 1; nz = 0; } else { nx /= len; ny /= len; nz /= len; }

    // Texture axes u, v in world space (unit length).
    let ux, uy, uz, vx, vy, vz;
    if (face) {
      const h = Math.hypot(nx, nz);
      if (h < 1e-3) { ux = 1; uy = 0; uz = 0; vx = 0; vy = 0; vz = 1; } // floor or ceiling
      else {
        ux = nz / h; uy = 0; uz = -nx / h; // horizontal, along the surface
        vx = ny * uz; vy = nz * ux - nx * uz; vz = -ny * ux; // up the slope (cross of normal and u)
      }
    } else {
      const X = Math.abs(nx), Y = Math.abs(ny), Z = Math.abs(nz);
      if (Y >= X && Y >= Z) { ux = 1; uy = 0; uz = 0; vx = 0; vy = 0; vz = 1; }
      else if (X >= Z) { ux = 0; uy = 0; uz = 1; vx = 0; vy = 1; vz = 0; }
      else { ux = 1; uy = 0; uz = 0; vx = 0; vy = 1; vz = 0; }
    }

    for (let i = 0; i < 3; i++) {
      const x = pos.getX(t + i), y = pos.getY(t + i), z = pos.getZ(t + i);
      uv[(t + i) * 2] = (x * ux + y * uy + z * uz) * k;
      uv[(t + i) * 2 + 1] = (x * vx + y * vy + z * vz) * k;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** Add (du, dv) to every UV of a geometry, in place. */
export function offsetUV(geometry, du, dv) {
  const uv = geometry.attributes.uv;
  if (!uv || (!du && !dv)) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  uv.needsUpdate = true;
}
