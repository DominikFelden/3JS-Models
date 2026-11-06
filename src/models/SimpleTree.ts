import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
} from 'three';
import { pooledMaterial } from '../textures/pool.ts';

// Geometries and materials are created once and shared by all instances.
let shared = null;

/** Repeat the texture `u` times around and `v` times along a primitive (whole `u` keeps the seam closed). */
function repeatUV(geometry, u, v) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geometry;
}

function getShared() {
  if (!shared) {
    shared = {
      trunkGeometry: repeatUV(new CylinderGeometry(0.2, 0.3, 2, 8), 1, 1.25),
      leavesGeometry: repeatUV(new SphereGeometry(1, 12, 10), 5, 2.5),
      trunkMaterial: pooledMaterial('bark', 0, { flatShading: false }),
      leavesMaterial: pooledMaterial('foliage', 0, { flatShading: false }),
    };
  }
  return shared;
}

/**
 * A simple tree: cylinder trunk with a sphere as leaves. Base sits at y = 0.
 * Every instance shares the same geometries and the first bark and foliage
 * textures of the shared pool (use `OakTree` / `PineTree` for variety).
 */
export class SimpleTree extends Group {
  constructor() {
    super();
    this.name = 'SimpleTree';
    const s = getShared();

    const trunk = new Mesh(s.trunkGeometry, s.trunkMaterial);
    trunk.position.y = 1;
    const leaves = new Mesh(s.leavesGeometry, s.leavesMaterial);
    leaves.position.y = 2.6;
    leaves.scale.set(1.2, 1.2, 1.2);

    this.add(trunk, leaves);
  }
}
