# 3JS-Models
A collection of 3D models created from simple ThreeJS geometries, for use in browser web games.

## Use as a submodule
```
git submodule add https://github.com/DominikFelden/3JS-Models.git libs/3JS-Models
```
```js
import { SimpleTree } from './libs/3JS-Models/src/index.js';
scene.add(new SimpleTree());
```
`three` is a peer dependency: the host project provides it. Geometries and materials are created once and shared by all instances.

## Models
| Class | Options besides position/rotation/size | Description | Collider tags (in order) |
|---|---|---|---|
| `SimpleTree` | – | Trunk + sphere (legacy, plain `Group`, no collider API) | – |
| `PineTree` | `complexity` 0-5, `seed` | Trunk + 3 cones; with complexity: whorls of branches and sub-branches with needle tufts | `trunk`, `crown`, then `branch`* |
| `OakTree` | `complexity` 0-5, `seed` | Thick trunk + 3 spheres; with complexity: spreading limbs, sub-branches, leaf blobs on tips | `trunk`, `crown`, then `branch`* |
| `Bush` | – | 3 squashed spheres | `sphere` |
| `Rock` | `seed` | Randomly displaced icosahedron; the seed picks one of 64 shared shapes (`seed % 64`) | `convex` |
| `House` | `type` (`'cottage'`, `'longhouse'`, `'towerhouse'`), `seed` | Box walls, pyramid or gable roof, door, windows on all walls | `body`, `roof` |
| `Castle` | `complexity` 0-5 (default 1), `seed` | Keep, curtain walls, towers, gates, halls, windows (see below) | `keep`, `tower`, `roof`, `wall`, `hall` |

\* The branch colliders are only present when `complexity > 0`.

All models are built only from ThreeJS primitives with flat-shaded colours (no textures), low segment counts, and shared geometries/materials (cached per model type, or per seed for rocks). Creating 1000 trees therefore costs 1000 small `Mesh` objects but no extra GPU buffers. For very large forests consider `InstancedMesh` in your game.

## Complexity, randomness and seeds
Trees and castles take a `complexity` option (integer, clamped to the model's range; invalid values fall back to the default):
```js
new OakTree({ complexity: 0 });   // trunk + simple crown, no branches
new OakTree({ complexity: 4 });   // branches that fork into sub-branches 4 times
new Castle({ complexity: 5 });    // many walls, towers, an outer ring and courtyard halls
```
Randomness: every model picks a **fresh random `seed` by default**, so two models with identical options (e.g. two oaks with `complexity: 5`) never look exactly the same. For reproducible results pass `seed` yourself; read the seed of any model from `model.seed` to rebuild it later:
```js
const a = new Castle({ complexity: 5 });
const copy = new Castle({ complexity: 5, seed: a.seed }); // identical to `a`
```
The same seed with a different `complexity` gives a related-but-different model (the random numbers are consumed in a different order), so don't rely on that.

### Trees
| complexity | PineTree / OakTree |
|---|---|
| 0 | No branches. Trunk with cones / sphere cluster. |
| 1 | One generation of branches. |
| 2..5 | Every branch forks into 2 (15% chance: 3) sub-branches, `complexity` generations deep (`PineTree` caps at 3 generations to keep it cheap). Branches get shorter, thinner and bend randomly; leaves/needles sit on the outermost tips. |

Branched trees grow somewhat taller and wider than the simple tree (up to ~7 units high at `size` 1). Cost (approximate, at `size` 1): complexity 3 about 2-3k vertices, complexity 5 about 8k vertices. All branches and leaves are merged into **one mesh per material (2 draw calls)**. Every branch is also exposed as a `cylinder` collider tagged `branch` (position at the branch centre, `radius`, `height`, and `quaternion` giving its direction), so collision code sees what is drawn. The foliage is exposed as a single `crown` bounding shape.

### Castles
| complexity | Content |
|---|---|
| 0 | A single keep with a pyramid roof, door and windows |
| 1 | + 12x12 curtain wall, 4 corner towers, 4 wall pieces with a gate gap at +Z (the previous default layout) |
| 2 | + extra towers along the walls, gate towers, taller keep |
| 3 | + outer 20x20 wall ring with towers and its own gate, 4 turrets on the keep |
| 4 | + more wall towers, 2 halls in the courtyard |
| 5 | + 4 halls and the most wall towers (about 35 towers, 30 wall pieces, ~8k vertices, 4 draw calls) |

Randomness affects tower and wall heights and radii, tower positions along the walls (corner towers stay at the corners), keep size, hall sizes and positions, window placement, and stone and roof colours. The gates (at `x = 0` on the `+Z` side of both rings) are never blocked; halls keep clear of the path to the keep.

### Windows
Houses and castles have windows (thin glass boxes with a slightly emissive material, no textures). They are part of the single merged mesh. Their data is exposed in world space:
```js
castle.getWindows(); // [{ position:[x,y,z], normal:[x,y,z], width, height }, ...]
```
`position` is the window centre on the wall surface, `normal` the unit vector pointing out of the wall. Windows are **not** colliders; they are decoration (use them e.g. for lighting or AI).

### Houses
```js
new House({ type: 'cottage' });    // 3.5 x 3 footprint, pyramid roof
new House({ type: 'longhouse' });  // 2.8 x 6, gable roof, ridge along Z
new House({ type: 'towerhouse' }); // 2.4 x 2.4, 5 high, pyramid roof, two window rows
```
Proportions, wall and roof colours and window layout vary per instance. The door is on the `+Z` side. Colliders: `body` (box) and `roof` (convex hull). The door is not a gap in the collider.

### Cleaning up
Trees, houses and castles own merged geometries (shared unit geometries are never freed). Call `model.dispose()` when you permanently remove one, e.g. when the viewer rebuilds a model. Not calling it only leaks memory; it never breaks rendering.

## Placing models: position, size, rotation
All models extend `WorldModel` (a `THREE.Group`) and take the same options:
```js
import { PineTree, Rock, Castle } from './libs/3JS-Models/src/index.js';
scene.add(new PineTree({ position: [4, 0, -2], size: 1.5, rotation: Math.PI / 3 }));
scene.add(new Rock({ seed: 7, position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 1, z: 0 } }));
scene.add(new Castle({ size: 2 }));
```
- `position`: `[x,y,z]` or `{x,y,z}`; the model's base centre (y = 0 is the ground).
- `rotation`: a number (yaw around Y, radians), `{x,y,z}` Euler angles, or a `THREE.Euler`.
- `size`: **uniform** scale (default 1). Non-uniform scaling is unsupported so that cylinders and spheres stay exact.
Since models are normal `Group`s you can still move them later with `model.position`, `model.rotation`, `model.scale.setScalar()`.

## Geometric information (for physics / collision in other projects)
No physics is implemented here. Instead each model exposes analytic shapes in **world space**:
```js
const castle = new Castle({ position: [20, 0, 0], rotation: 0.5, size: 2 });
castle.getColliders();    // array of shapes, current world transform
model.getColliderTags();  // label per shape, same order, e.g. 'trunk', 'branch', 'tower', 'wall'
castle.getBounds();       // conservative AABB {min:[x,y,z], max:[x,y,z]}
```
Every shape has `type`, `position:[x,y,z]` (shape centre) and `quaternion:[x,y,z,w]` (world orientation), plus:

| type | extra fields | notes |
|---|---|---|
| `cylinder` | `radius`, `height` | axis = local Y of the shape, centred |
| `cone` | `radius` (base), `height` | axis = local Y, centred on the middle of the height |
| `sphere` | `radius` | |
| `box` | `size:[x,y,z]` | full extents, oriented by `quaternion` |
| `convex` | `points:[[x,y,z],...]` | world-space hull vertices; `quaternion` is identity |

Sizes are already multiplied by `size`. Call `getColliders()` again after moving/rotating the model (it reads the current world matrix; it does not cache).

**Simple vs. complex models.** A simple cylinder (e.g. a trunk) needs only position, rotation and radius. A complex object such as a castle is *decomposed into many simple primitives*: each tower is a cylinder, each wall a rotated box, the keep a box. The gate is a real gap between two wall boxes, so a character can pass it. Use the tags (every model has them) to treat e.g. roofs differently (ignore them, or use them as triggers). Rocks expose a convex hull instead, which fits the GJK/SAT style of collision checks.

Foliage shapes are bounding shapes of the crown; whether to collide with them is up to the consumer (use the first collider only for "trunk only" collision).

## Adding a model
1. Subclass `WorldModel` in `src/models/`, call `super(name, options)`.
2. Create geometry via `shared(key, factory)` and materials via `material(color, flat)` so they are reused.
3. Add meshes with `addMesh()` (few, shared parts) or collect many parts in a `MergeBuilder` and call `builder.build(this)` (one mesh per material; use this for anything with dozens of parts). Add matching collision shapes with `addShape(type, data, position, rotation, tag)` (local space; `WorldModel` applies position/rotation/size).
3b. Use `this.random()` / `this.rand(min, max)` for all randomness (never `Math.random()`), so `seed` makes the model reproducible; use `this.addWindow()` for windows.
4. Export it from `src/index.js`, register it in `src/registry.js`, add a test.

## Viewer
```
npm install
npm run dev
```
Open the printed URL and pick a model in the menu. For models that support it a **Complexity slider** appears; moving it rebuilds the model live (with a new random seed each time). **Re-roll** builds another random variation at the same complexity. The seed of the shown model is displayed next to the button. New models are registered in `src/registry.js`.

## Tests
`npm test`
