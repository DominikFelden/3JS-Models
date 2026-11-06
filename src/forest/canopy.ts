import { BufferGeometry, Float32BufferAttribute, Color, Mesh } from 'three';
import { pooledMaterial } from '../textures/pool.ts';
import { MAPPING } from '../textures/recipes.ts';
import { injectFadeFragment } from './fade.ts';

/** Most grid vertices per side of the canopy (keeps big forests cheap). */
export const MAX_CANOPY_GRID = 257;

/**
 * Height field of a forest's crowns: every tree adds a dome (a spherical cap
 * of its crown) and each grid vertex takes the highest dome. Where no crown
 * reaches, the surface drops to the ground, so clearings stay open and the
 * forest edge is a closed wall of crowns. Cells without any crown are left
 * out (the host's terrain shows there).
 *
 *  - trees: [{x, y, z, scale, variant}] in forest space
 *  - crowns: per variant { top, radius, depth } (tree space, scale 1)
 *  - colors: per variant linear Color (the average colour of the tree)
 *  - area: side of the square, cell: grid spacing, ground(x, z): height of the ground
 * Vertex colours: the colour of the tree owning the vertex, darker low in the canopy.
 */
export function canopyGeometry(trees, crowns, colors, { area, cell, ground = (_x: number, _z: number) => 0 }) {
  const maxR = crowns.reduce((m, c) => Math.max(m, c.radius), 0) * trees.reduce((m, t) => Math.max(m, t.scale), 1);
  const span = area + 2 * (maxR + cell);
  const n = Math.min(MAX_CANOPY_GRID, Math.max(2, Math.ceil(span / cell) + 1));
  const step = span / (n - 1);
  const x0 = -span / 2;
  const h = new Float32Array(n * n).fill(-Infinity);
  const owner = new Int32Array(n * n).fill(-1);
  for (const t of trees) {
    const c = crowns[t.variant];
    const r = c.radius * t.scale, top = t.y + c.top * t.scale, depth = c.depth * t.scale;
    const i0 = Math.max(0, Math.floor((t.x - r - x0) / step)), i1 = Math.min(n - 1, Math.ceil((t.x + r - x0) / step));
    const j0 = Math.max(0, Math.floor((t.z - r - x0) / step)), j1 = Math.min(n - 1, Math.ceil((t.z + r - x0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (x0 + i * step - t.x) / r, dz = (x0 + j * step - t.z) / r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        const v = top - depth + depth * Math.sqrt(1 - d2);
        const k = j * n + i;
        if (v > h[k]) { h[k] = v; owner[k] = t.variant; }
      }
    }
  }

  const avg = new Color(0, 0, 0);
  colors.forEach((c) => avg.add(c));
  avg.multiplyScalar(1 / Math.max(1, colors.length));
  const tallest = crowns.reduce((m, c) => Math.max(m, c.top), 1);
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const tile = MAPPING.canopy.tile;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * step, z = x0 + j * step, g = ground(x, z);
      const covered = owner[k] >= 0;
      const y = covered ? Math.max(h[k], g) : g - 0.3;
      pos.set([x, y, z], k * 3);
      uv.set([x / tile, z / tile], k * 2);
      const base = covered ? colors[owner[k]] : avg;
      const shade = covered ? 0.5 + 0.55 * Math.min(1, Math.max(0, (y - g) / tallest)) : 0.35;
      col.set([base.r * shade, base.g * shade, base.b * shade], k * 3);
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (owner[a] < 0 && owner[b] < 0 && owner[c] < 0 && owner[d] < 0) continue;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

const CANOPY_VERT = /* glsl */ `
uniform vec3 uForestCam;
uniform float uForestScale;
varying float vForestDist;
varying vec3 vCanopyPos;
varying vec3 vCanopyN;
`;

// Treetops on the top of the canopy, the same picture stood upright on its steep sides (the forest edge).
const CANOPY_MAP = /* glsl */ `
#ifdef USE_MAP
{
  float wTop = smoothstep(0.35, 0.75, abs(normalize(vCanopyN).y));
  vec4 top = texture2D(map, vCanopyPos.xz / CANOPY_TILE);
  vec4 side = texture2D(map, vec2(vCanopyPos.x + vCanopyPos.z, vCanopyPos.y) / CANOPY_TILE);
  diffuseColor *= mix(side, top, wTop);
}
#endif
`;

/**
 * The canopy mesh: wears the `canopy` texture `variant`, recoloured to white
 * (vertex colours carry each tree's colour) and only drawn from `range` on.
 */
export function createCanopy(geometry, variant, shared) {
  const material = pooledMaterial('canopy', variant, { color: 0xffffff, flatShading: false, vertexColors: true, roughness: 1 }).clone();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uForestCam: shared.camera, uForestScale: shared.scale });
    shader.vertexShader = CANOPY_VERT + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vForestDist = uForestScale * distance(position, uForestCam);
  vCanopyPos = position;
  vCanopyN = normal;`);
    shader.fragmentShader = `#define CANOPY_TILE ${MAPPING.canopy.tile.toFixed(1)}\nvarying vec3 vCanopyPos;\nvarying vec3 vCanopyN;\n${shader.fragmentShader
      .replace('#include <map_fragment>', CANOPY_MAP)}`;
    injectFadeFragment(shader, shared.canopyRange);
  };
  material.customProgramCacheKey = () => 'forest-canopy';
  const mesh = new Mesh(geometry, material);
  mesh.name = 'ForestCanopy';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
