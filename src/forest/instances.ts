import { Box3, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Sphere } from 'three';

/** Instances a buffer holds before it first grows: a forest draws only a few trees of each variant at once. */
export const START_CAPACITY = 32;

const newAttribute = (capacity: number) => new InstancedBufferAttribute(new Float32Array(capacity * 16), 16).setUsage(DynamicDrawUsage);

/**
 * The instances of one tree or plant variant (at one detail level), drawn by all of its meshes:
 * bark, blobs and cards of a tree show the same trees. Made for forests, where only the few
 * trees near the camera are drawn out of thousands:
 *  - ONE instance-matrix buffer is shared by all the meshes, so every instance is written and
 *    uploaded once, not once per mesh;
 *  - the buffer is sized for what is drawn, not for every tree of the forest: it starts small
 *    and doubles whenever a frame needs more;
 *  - only the used part goes to the GPU (three.js would otherwise upload the whole buffer of
 *    every mesh, every frame);
 *  - a bounding sphere around this frame's instances lets three.js cull the meshes as a whole.
 *    This matters for the shadow pass: casters away from the shadow camera cost nothing.
 *
 * Every frame: `reset()`, `push()` the instances to draw (nearest first, so the GPU can reject
 * hidden pixels early), then `commit()`.
 */
export class InstanceBuffer {
  /** The meshes drawing these instances (add them to the scene yourself). */
  meshes: InstancedMesh[] = [];
  /** Instances pushed since the last `reset()`. */
  count = 0;
  /** Sphere around this frame's instances; every mesh uses it as its `boundingSphere`. */
  sphere = new Sphere();
  attribute: InstancedBufferAttribute;
  /** Box around the bounding spheres of the pushed instances. */
  _box = new Box3();

  constructor(capacity = START_CAPACITY) {
    this.attribute = newAttribute(Math.max(1, Math.ceil(capacity)));
  }

  /** Instances the buffer holds before it has to grow. */
  get capacity() {
    return this.attribute.count;
  }

  /**
   * A new mesh drawing `geometry` with `material` at every instance. `shadowOnly` meshes are drawn
   * into shadow maps but never on screen (the invisible shadow casters of ground plants).
   */
  addMesh(geometry, material, { castShadow = false, receiveShadow = false, shadowOnly = false } = {}) {
    const mesh = new InstancedMesh(geometry, material, 0);
    mesh.instanceMatrix = this.attribute;
    mesh.boundingSphere = this.sphere; // culled as a whole, in the view and in the shadow pass
    mesh.visible = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    if (shadowOnly) {
      // On screen draw no instance at all (three.js then skips the draw call); the shadow pass
      // runs before the colour pass and gets the full count.
      let count = 0;
      mesh.onBeforeRender = () => { count = mesh.count; mesh.count = 0; };
      mesh.onAfterRender = () => { mesh.count = count; };
      mesh.userData.shadowOnly = true;
    }
    this.meshes.push(mesh);
    return mesh;
  }

  /** Start a new frame with no instances. */
  reset() {
    this.count = 0;
    this._box.makeEmpty();
  }

  /**
   * Add an instance standing at (`x`, `y`, `z`), turned by `yaw` around the vertical axis and
   * scaled by `scale`. `centerY` and `radius`: its bounding sphere (centred above x, z).
   */
  push(x: number, y: number, z: number, yaw: number, scale: number, centerY: number, radius: number) {
    if (this.count === this.attribute.count) this._grow();
    // The matrix of a turn around Y times a uniform scale, written directly (no quaternion).
    const e = this.attribute.array as Float32Array, o = this.count * 16;
    const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
    e[o] = c; e[o + 1] = 0; e[o + 2] = -s; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = scale; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = s; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    this.count++;
    const { min, max } = this._box;
    if (x - radius < min.x) min.x = x - radius;
    if (x + radius > max.x) max.x = x + radius;
    if (centerY - radius < min.y) min.y = centerY - radius;
    if (centerY + radius > max.y) max.y = centerY + radius;
    if (z - radius < min.z) min.z = z - radius;
    if (z + radius > max.z) max.z = z + radius;
  }

  /** Hand this frame's instances to the meshes. Returns the number of draw calls on screen. */
  commit() {
    const n = this.count;
    if (n > 0) {
      const a = this.attribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 16);
      a.needsUpdate = true;
      this._box.getBoundingSphere(this.sphere);
    }
    let drawCalls = 0;
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0 && !mesh.userData.shadowOnly) drawCalls++;
    }
    return drawCalls;
  }

  /** Double the capacity, keeping the instances pushed so far. */
  _grow() {
    const next = newAttribute(this.attribute.count * 2);
    (next.array as Float32Array).set(this.attribute.array as Float32Array);
    for (const mesh of this.meshes) {
      // three.js frees the GPU copy of an instanced mesh's buffer on this event (a buffer cannot be resized).
      mesh.dispatchEvent({ type: 'dispose' });
      mesh.instanceMatrix = next;
    }
    this.attribute = next;
  }
}
