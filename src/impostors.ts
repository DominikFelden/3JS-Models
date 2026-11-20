import { Box3, Matrix4, Mesh, Vector3, type Object3D, type WebGLRenderer, type PlaneGeometry, type MeshStandardMaterial } from 'three';
import { bakeImpostors, modelImpostorQuad } from './forest/impostors.ts';
import { canBake } from './textures/bake.ts';

export type ModelImpostorOptions = {
  renderer?: WebGLRenderer;
  frameSize?: number;
};

export type ModelImpostor = {
  /** Create a two-triangle proxy sharing this variant's geometry, material and atlas. */
  createMesh(): Mesh<PlaneGeometry, MeshStandardMaterial>;
  /** Release shared resources after removing every proxy using this asset. */
  dispose(): void;
};

/**
 * Bake the current pose of a static model into a relightable impostor seen from all sides.
 * The root's placement is ignored; the proxy belongs at the same transform as the source model.
 * Returns null if there is no canvas or supplied renderer. Does not change the source or set LOD distances.
 */
export function bakeModelImpostor(model: Object3D, { renderer, frameSize = 128 }: ModelImpostorOptions = {}): ModelImpostor | null {
  if (!Number.isInteger(frameSize) || frameSize < 8) throw new RangeError('Impostor frameSize must be an integer of at least 8 pixels.');
  if (!renderer && !canBake()) return null;

  const bounds = new Box3();
  const meshes: Mesh[] = [];
  function collect(node: Object3D, matrix: Matrix4) {
    if (node instanceof Mesh && !node.userData.shadowOnly
      && (Array.isArray(node.material) ? node.material.some((m) => m.visible && m.colorWrite) : node.material.visible && node.material.colorWrite)) {
      if ('isInstancedMesh' in node || 'isSkinnedMesh' in node || node.geometry.isInstancedBufferGeometry) {
        throw new Error('Model impostors require static, non-instanced meshes.');
      }
      const { geometry } = node;
      const positions = geometry.getAttribute('position');
      if (positions?.count) {
        const mesh = new Mesh(geometry, node.material);
        mesh.matrix.copy(matrix);
        meshes.push(mesh);
        // Shader-facing leaf cards can extend beyond their rest geometry in any direction.
        const centres = geometry.getAttribute('cardCenter');
        const corners = geometry.getAttribute('cardCorner');
        if (centres && corners) {
          const point = new Vector3();
          const box = new Box3();
          const scale = matrix.getMaxScaleOnAxis();
          for (let i = 0; i < centres.count; i++) {
            point.fromBufferAttribute(centres, i).applyMatrix4(matrix);
            const extent = Math.hypot(corners.getX(i), corners.getY(i)) * scale;
            box.min.set(point.x - extent, point.y - extent, point.z - extent);
            box.max.set(point.x + extent, point.y + extent, point.z + extent);
            bounds.union(box);
          }
        } else {
          bounds.union(new Box3().setFromBufferAttribute(positions).applyMatrix4(matrix));
        }
      }
    }
    for (const child of node.children) {
      if (!child.visible) continue;
      const local = child.matrixAutoUpdate ? new Matrix4().compose(child.position, child.quaternion, child.scale) : child.matrix;
      collect(child, new Matrix4().multiplyMatrices(matrix, local));
    }
  }
  collect(model, new Matrix4());
  if (!meshes.length || bounds.isEmpty()) throw new Error('Model impostors require visible mesh geometry.');

  const centre = bounds.getCenter(new Vector3());
  const radius = Math.max(bounds.getSize(new Vector3()).length() * 0.51, 0.001);
  const atlas = bakeImpostors([{ meshes, centreY: centre.y, centre, radius }], {
    renderer, frameSize, views: { yaws: 8, elevations: 5 }, fullSphere: true,
  });
  const quad = modelImpostorQuad(atlas, centre, radius);
  let disposed = false;
  return {
    createMesh() {
      if (disposed) throw new Error('Cannot create a mesh from a disposed model impostor.');
      const mesh = new Mesh(quad.geometry, quad.material);
      mesh.name = 'ModelImpostor';
      return mesh;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      quad.geometry.dispose();
      quad.material.dispose();
      atlas.color.dispose();
      atlas.normal.dispose();
    },
  };
}
