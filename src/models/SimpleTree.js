import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
  MeshStandardMaterial,
} from 'three';

// Geometries and materials are created once and shared by all instances.
let shared = null;

function getShared() {
  if (!shared) {
    shared = {
      trunkGeometry: new CylinderGeometry(0.2, 0.3, 2, 8),
      leavesGeometry: new SphereGeometry(1, 12, 10),
      trunkMaterial: new MeshStandardMaterial({ color: 0x8b5a2b }),
      leavesMaterial: new MeshStandardMaterial({ color: 0x2e8b3d }),
    };
  }
  return shared;
}

/** A simple tree: cylinder trunk with a sphere as leaves. Base sits at y = 0. */
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
