import { BoxGeometry, CylinderGeometry, ConeGeometry, Shape, ExtrudeGeometry, Quaternion, Vector3 } from 'three';
import { WorldModel, MergeBuilder, shared, material, stoneMaterial } from '../WorldModel.js';

/** Highest supported castle complexity. */
export const MAX_CASTLE_COMPLEXITY = 5;

const STONES = [0x9a9690, 0x8d8a85, 0xa39e94, 0x948f86];
const ROOFS = [0x8b2f2f, 0x2f4f7a, 0x5b3a29];
const BANNERS = [0xb03030, 0x2f5f9a, 0xc9a227, 0x3a7a4a];
const SHUTTERS = [0x2f5f4a, 0x7a3030, 0x3a4f7a, 0x5a3b22];
const Y = new Vector3(0, 1, 0);

// Unit geometries (scaled per use) shared by all castles.
const cylG = () => shared('castle:cyl', () => new CylinderGeometry(1, 1, 1, 12));  // radius 1, height 1, centred
const coneG = () => shared('castle:cone', () => new ConeGeometry(1, 1, 12));       // radius 1, height 1, centred
const boxG = () => shared('castle:box', () => new BoxGeometry(1, 1, 1));
const pyramidG = () => shared('castle:pyramid', () => {                            // square base, half-side 0.707
  const g = new ConeGeometry(1, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  return g;
});
const gableG = () => shared('castle:gable', () => {                                // 2 wide, 1 high, ridge along Z, depth 1
  const tri = new Shape();
  tri.moveTo(-1, 0); tri.lineTo(1, 0); tri.lineTo(0, 1); tri.closePath();
  const g = new ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
});

/**
 * Procedural castle. Footprint centred on the origin, base at y = 0, the gate
 * faces +Z. Everything is random (random `seed` by default) so no two castles
 * are identical, even with the same complexity.
 *
 * complexity (0..5, default 1):
 *  0  a lone fortified keep (pyramid roof)
 *  1  keep + square curtain wall (12 x 12) + 4 corner towers + gate gap
 *  2  + extra towers along the walls, gate towers, taller keep
 *  3  + a second, outer wall ring (20 x 20) with its own towers and gate,
 *       and 4 turrets on top of the keep
 *  4  + more wall towers, 2 halls in the inner courtyard
 *  5  + 4 courtyard halls and the most wall towers
 *
 * Castles are deliberately irregular: curtain-wall corners are pushed outwards
 * by random amounts (the gate stays on the +Z axis), towers differ in radius,
 * height and style (conical roof or battlements), wall segments have different
 * heights, the keep door and stair turret are off-centre, and a banner flies
 * from the keep. Stone is vertex-tinted per block, darker towards the ground,
 * and gets a masonry texture in browsers.
 *
 * Every tower and the keep carry arched windows (see getWindows()).
 *
 * Colliders are many simple primitives instead of one big shape, so the gates
 * stay passable. Tags (getColliderTags()):
 *  'tower' cylinder | 'roof' cone or convex | 'wall' box (rotated via
 *  quaternion) | 'keep' box | 'hall' box | 'turret' cylinder (keep stair turret)
 */
export class Castle extends WorldModel {
  constructor(options = {}) {
    super('Castle', options);
    this.complexity = WorldModel.clampInt(options.complexity, 0, MAX_CASTLE_COMPLEXITY, 1);
    const c = this.complexity;
    const b = new MergeBuilder();
    this._b = b;
    this._stone = stoneMaterial(STONES[Math.floor(this.random() * STONES.length)]);
    this._roof = material(ROOFS[Math.floor(this.random() * ROOFS.length)], true, true);
    this._banner = material(BANNERS[Math.floor(this.random() * BANNERS.length)], true);

    // Keep: bigger and taller with complexity.
    const keepW = (c === 0 ? 4 : 3 + Math.min(c, 3) * 0.3) * this.rand(0.9, 1.05);
    const keepD = keepW * this.rand(0.9, 1.05);
    const keepH = (3.5 + c * 0.7) * this.rand(0.9, 1.15);
    this._keep(keepW, keepD, keepH, c);

    if (c >= 1) {
      // Inner curtain wall. At complexity 1 only corner towers (no jitter on corner positions).
      const mid = c >= 2 ? Math.min(c - 1, 3) : 0;
      this._ring({ H: 6, gate: 2, cornerR: 1, cornerH: 4, midR: 0.7, midH: 3.2, wallH: 2.4, mid, gateTowers: c >= 2 });
    }
    if (c >= 3) {
      this._ring({ H: 10, gate: 3, cornerR: 1.3, cornerH: 4.5, midR: 0.9, midH: 3.5, wallH: 2, mid: Math.min(c - 2, 3), gateTowers: true });
      // Turrets on the keep corners.
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        this._tower(sx * keepW / 2, sz * keepD / 2, 0.45, this.rand(1.2, 1.8), keepH, false);
      }
    }
    // Courtyard halls sit in the corners between keep and inner wall. Sizes are
    // limited so they never touch the keep, the wall towers, or the gate path (|x| < 1).
    if (c >= 4) {
      this._hall(-1, -1, this.rand(2.4, 3.0), this.rand(1.6, 2.0), this.rand(1.6, 2.2));
      this._hall(1, -1, this.rand(2.4, 3.0), this.rand(1.6, 2.0), this.rand(1.6, 2.2));
    }
    if (c >= 5) {
      this._hall(-1, 1, this.rand(2.2, 2.8), this.rand(1.6, 1.9), this.rand(1.4, 1.9));
      this._hall(1, 1, this.rand(2.2, 2.8), this.rand(1.6, 1.9), this.rand(1.4, 1.9));
    }
    b.build(this);
    this._b = null;
  }

  /** Random per-block brightness with a slight warm/cool drift. */
  _tint() {
    const t = this.rand(0.86, 1.08);
    return [t * this.rand(0.97, 1.03), t, t * this.rand(0.95, 1.02)];
  }

  _stoneBox(position, scale, quaternion = null, grime = true) {
    this._b.add(boxG(), this._stone, { position, scale, quaternion, tint: this._tint(), grime, uv: 'box' });
  }

  _stoneCyl(position, scale, grime = true) {
    this._b.add(cylG(), this._stone, { position, scale, tint: this._tint(), grime, uv: 'cyl' });
  }

  /** Battlements: merlons on top of a box footprint. */
  _boxMerlons(w, d, h, cx = 0, cz = 0) {
    const gap = 0.7, nx = Math.floor(w / gap), nz = Math.floor(d / gap);
    for (let i = 0; i < nx; i++) {
      const u = (i + 0.5) / nx * w - w / 2;
      for (const s of [-1, 1]) this._stoneBox([cx + u, h + 0.15, cz + s * (d / 2 - 0.08)], [0.35, 0.3, 0.16], null, false);
    }
    for (let i = 0; i < nz; i++) {
      const u = (i + 0.5) / nz * d - d / 2;
      for (const s of [-1, 1]) this._stoneBox([cx + s * (w / 2 - 0.08), h + 0.15, cz + u], [0.16, 0.3, 0.35], null, false);
    }
  }

  /** Flag pole with a small banner at (x, y, z). */
  _flag(x, y, z) {
    const b = this._b, yaw = this.rand(0, Math.PI * 2);
    b.add(cylG(), material(0x4a3322, true), { position: [x, y + 0.7, z], scale: [0.035, 1.4, 0.035] });
    b.add(boxG(), this._banner, { position: [x + Math.cos(yaw) * 0.34, y + 1.15, z - Math.sin(yaw) * 0.34], scale: [0.65, 0.4, 0.03], yaw });
  }

  /** Central keep: box + windows + door; pyramid roof only for complexity 0. */
  _keep(w, d, h, c) {
    const b = this._b;
    this._stoneBox([0, h / 2, 0], [w, h, d]);
    this._stoneBox([0, 0.25, 0], [w + 0.25, 0.5, d + 0.25]);          // plinth
    this._stoneBox([0, h * 0.5, 0], [w + 0.1, 0.12, d + 0.1], null, false); // string course
    this.addShape('box', { size: [w, h, d] }, [0, h / 2, 0], null, 'keep');
    if (c === 0) {
      const roofH = this.rand(1.4, 2);
      b.add(pyramidG(), this._roof, { position: [0, h + roofH / 2, 0], scale: [w * 0.78, roofH, d * 0.78], tint: this._tint() });
      this.addShape('convex', { points: [
        [-w * 0.55, h, -d * 0.55], [w * 0.55, h, -d * 0.55], [w * 0.55, h, d * 0.55], [-w * 0.55, h, d * 0.55],
        [0, h + roofH, 0],
      ] }, [0, 0, 0], null, 'roof');
      this._flag(0, h + roofH - 0.05, 0);
    } else {
      this._boxMerlons(w, d, h);
      this._flag(this.rand(-0.3, 0.3) * w, h, this.rand(-0.3, 0.3) * d);
      // Stair turret off-centre on the back face (|x| < 0.4 keeps clear of the halls).
      const tr = 0.5, tx = this.rand(-0.4, 0.4), th = h * this.rand(1.05, 1.2);
      this._stoneCyl([tx, th / 2, -d / 2 - tr * 0.4], [tr, th, tr]);
      this.addShape('cylinder', { radius: tr, height: th }, [tx, th / 2, -d / 2 - tr * 0.4], null, 'turret');
      b.add(coneG(), this._roof, { position: [tx, th + tr * 0.8, -d / 2 - tr * 0.4], scale: [tr * 1.25, tr * 1.6, tr * 1.25], tint: this._tint() });
    }
    // Door on +Z, slightly off-centre.
    this._doorX = this.rand(-0.4, 0.4);
    this.addDoor(b, [this._doorX, 0, d / 2], 0, 0.95, 1.5, { arched: true });
    this._shutter = null;
    this._boxWindows(0, 0, w, d, h, 1.5, this._doorX);
  }

  /**
   * Windows on all four faces of a box centred at (cx, cz) with footprint w x d
   * and height h. `doorX` (a number) leaves the lowest windows around that x on
   * the +Z face free for a door.
   */
  _boxWindows(cx, cz, w, d, h, spacing, doorX = null) {
    const rows = Math.max(1, Math.floor(h / 2));
    const faces = [
      { yaw: 0, len: w, at: (u, y) => [cx + u, y, cz + d / 2] },
      { yaw: Math.PI, len: w, at: (u, y) => [cx - u, y, cz - d / 2] },
      { yaw: Math.PI / 2, len: d, at: (u, y) => [cx + w / 2, y, cz - u] },
      { yaw: -Math.PI / 2, len: d, at: (u, y) => [cx - w / 2, y, cz + u] },
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor(f.len / spacing));
      for (let r = 0; r < rows; r++) {
        const y = (h / rows) * (r + 0.6);
        for (let k = 0; k < cols; k++) {
          const u = (k + 0.5) / cols * f.len - f.len / 2;
          if (doorX !== null && f.yaw === 0 && r === 0 && Math.abs(u - doorX) < 0.9) continue; // door
          if (this.random() < 0.15) continue;                                    // variety
          const opts = { arched: true, sill: 0xb5b0a6, shutters: spacing < 1.5 && this.random() < 0.5 ? this._shutter : null };
          this.addWindow(this._b, f.at(u + this.rand(-0.1, 0.1), y + this.rand(-0.08, 0.08)), f.yaw, this.rand(0.38, 0.5), this.rand(0.7, 0.85), opts);
        }
      }
    }
  }

  /**
   * Round tower: cylinder + cone roof + 1-2 windows facing away from the castle
   * centre. `y0` lifts it (used for turrets standing on the keep).
   */
  _tower(x, z, r, h, y0 = 0, windows = true) {
    const b = this._b;
    const crenel = y0 === 0 && this.random() < 0.35;
    if (crenel) h *= 1.1;
    this._stoneCyl([x, y0 + h / 2, z], [r, h, r]);
    if (y0 === 0) this._stoneCyl([x, 0.25, z], [r * 1.12, 0.5, r * 1.12]); // plinth
    this.addShape('cylinder', { radius: r, height: h }, [x, y0 + h / 2, z], null, 'tower');
    if (crenel) {
      // Corbelled parapet with merlons instead of a roof.
      this._stoneCyl([x, y0 + h - 0.12, z], [r * 1.12, 0.24, r * 1.12], false);
      const n = Math.max(6, Math.round(r * 9));
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * Math.PI * 2;
        this._b.add(boxG(), this._stone, {
          position: [x + Math.sin(a) * r * 1.02, y0 + h + 0.15, z + Math.cos(a) * r * 1.02],
          scale: [r * 2.4 / n, 0.3, 0.16], yaw: a, tint: this._tint(), uv: 'box',
        });
      }
    } else {
      const roofH = r * this.rand(1.3, 2.2);
      const o = this.rand(1.15, 1.35); // roof overhang
      b.add(coneG(), this._roof, { position: [x, y0 + h + roofH / 2, z], scale: [r * o, roofH, r * o], tint: this._tint() });
      this.addShape('cone', { radius: r * o, height: roofH }, [x, y0 + h + roofH / 2, z], null, 'roof');
    }
    if (!windows || r < 0.6) return;
    const out = Math.atan2(x, z);              // direction pointing away from the origin
    const count = r > 0.8 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const yaw = out + (count === 1 ? 0 : (i - 0.5) * 0.9) + this.rand(-0.25, 0.25);
      this.addWindow(b, [x + Math.sin(yaw) * r, y0 + h * this.rand(0.5, 0.8), z + Math.cos(yaw) * r], yaw, 0.26, 0.7, { arched: true, sill: 0xb5b0a6 });
    }
  }

  /** Straight wall segment from a to b (x,z pairs), already trimmed by the caller. */
  _wall(ax, az, bx, bz, height, thick) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    // Rotation about Y mapping the box's local +X onto the wall direction.
    const yaw = Math.atan2(-dz, dx);
    const q = new Quaternion().setFromAxisAngle(Y, yaw);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    this._stoneBox([mx, height / 2, mz], [len, height, thick], q);
    this.addShape('box', { size: [len, height, thick] }, [mx, height / 2, mz], q, 'wall');
    // Merlons along the top, with a little random wear (missing teeth).
    const n = Math.floor(len / 0.8), ux = dx / len, uz = dz / len;
    for (let i = 0; i < n; i++) {
      if (this.random() < 0.06) continue;
      const u = (i + 0.5) / n * len - len / 2;
      this._stoneBox([mx + ux * u, height + 0.15, mz + uz * u], [0.4, 0.3, thick * 0.8], q, false);
    }
  }

  /**
   * A run of wall from node `from` to node `to` ({x,z,r}), with `mid` extra
   * towers in between at (slightly jittered) even spacing (fewer if the run is too short). Towers at the two
   * end nodes are created by the caller; walls are trimmed by node radii.
   */
  _run(from, to, mid, p) {
    // Short runs (e.g. beside the gate) get fewer towers so neighbours never overlap:
    // spacing (minus 12% for the random jitter) must clear both radii plus a margin.
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const needed = Math.max(from.r, to.r) + p.midR * 1.1 + 0.25;
    while (mid > 0 && (dist / (mid + 1)) * 0.88 < needed) mid--;
    const nodes = [from];
    for (let i = 1; i <= mid; i++) {
      const t = i / (mid + 1) + this.rand(-0.05, 0.05);
      const n = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t, r: p.midR * this.rand(0.85, 1.12) };
      this._tower(n.x, n.z, n.r, p.midH * this.rand(0.8, 1.4));
      nodes.push(n);
    }
    nodes.push(to);
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], c = nodes[i + 1];
      const dist = Math.hypot(c.x - a.x, c.z - a.z);
      const ux = (c.x - a.x) / dist, uz = (c.z - a.z) / dist;
      // Trim by tower radii so the wall starts/ends at the tower surface.
      this._wall(a.x + ux * a.r, a.z + uz * a.r, c.x - ux * c.r, c.z - uz * c.r, p.wallH * this.rand(0.85, 1.25), 0.6);
    }
  }

  /**
   * Irregular curtain wall around a nominal square of half-size H, with corner
   * towers, `mid` towers per side, and a gate gap of width `gate` centred on the
   * +Z side. Corners are only ever pushed outwards (so the courtyard stays
   * clear) and the front wall stays on z = H so the gate keeps its place.
   */
  _ring(p) {
    const { H, gate } = p;
    const j = () => this.rand(0, H * 0.22);
    const spots = [[-H - j(), -H - j()], [H + j(), -H - j()], [H + j(), H], [-H - j(), H]];
    const cs = spots.map(([x, z]) => ({ x, z, r: p.cornerR * this.rand(0.9, 1.2) }));
    cs.forEach((n) => this._tower(n.x, n.z, n.r, p.cornerH * this.rand(0.85, 1.4)));

    // Gate flank towers (optional, each its own size); otherwise the wall simply ends at the gate edge.
    const grL = p.gateTowers ? 0.8 * this.rand(0.9, 1.25) : 0;
    const grR = p.gateTowers ? 0.8 * this.rand(0.9, 1.25) : 0;
    const gateL = { x: -(gate / 2 + grL), z: H, r: grL };
    const gateR = { x: gate / 2 + grR, z: H, r: grR };
    if (p.gateTowers) {
      this._tower(gateL.x, gateL.z, grL, p.cornerH * this.rand(1, 1.3));
      this._tower(gateR.x, gateR.z, grR, p.cornerH * this.rand(1, 1.3));
      // Gate lintel between the flank towers, high above the passage.
      const lw = gate + 0.4;
      this._stoneBox([0, 3.2, H], [lw, 0.9, 0.8]);
      this._boxMerlons(lw, 0.8, 3.65, 0, H);
    }
    const half = Math.ceil(p.mid / 2);
    this._run(cs[0], cs[1], p.mid, p);      // back (-Z)
    this._run(cs[1], cs[2], p.mid, p);      // right (+X)
    this._run(cs[3], cs[0], p.mid, p);      // left (-X)
    this._run(cs[2], gateR, half, p);       // front, right of gate
    this._run(cs[3], gateL, half, p);       // front, left of gate
  }

  /**
   * Courtyard hall: box + gable roof + windows, w (x) by d (z) by h.
   * (sx, sz) = +-1 picks the courtyard corner. The hall's outer edges (including
   * the roof overhang) end at 4.6 from the centre, which is clear of the inner
   * wall towers (they start at about 5.2) and, given the size limits at the call
   * sites, clear of the keep (half size <= 2.15) and the gate path (|x| < 1).
   */
  _hall(sx, sz, w, d, h) {
    const b = this._b;
    const ow = w * 1.08, od = d * 1.08;
    const x = sx * (4.6 - ow / 2 - this.rand(0, 0.15));
    const z = sz * (4.6 - od / 2 - this.rand(0, 0.15));
    this._stoneBox([x, h / 2, z], [w, h, d]);
    this.addShape('box', { size: [w, h, d] }, [x, h / 2, z], null, 'hall');
    const roofH = h * 0.6;
    b.add(gableG(), this._roof, { position: [x, h, z], scale: [ow / 2, roofH, od], tint: this._tint() });
    this._stoneBox([x + this.rand(-w, w) * 0.25, h + roofH * 0.8, z + this.rand(-d, d) * 0.25], [0.35, roofH * 0.8, 0.35], null, false); // chimney
    this.addShape('convex', { points: [
      [x - ow / 2, h, z - od / 2], [x + ow / 2, h, z - od / 2], [x + ow / 2, h, z + od / 2], [x - ow / 2, h, z + od / 2],
      [x, h + roofH, z - od / 2], [x, h + roofH, z + od / 2],
    ] }, [0, 0, 0], null, 'roof');
    this._shutter = SHUTTERS[Math.floor(this.random() * SHUTTERS.length)];
    this._boxWindows(x, z, w, d, h, 1.4);
  }
}
