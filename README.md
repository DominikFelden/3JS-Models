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
| Class | Description | Colliders (in order) |
|---|---|---|
| `SimpleTree` | Trunk + sphere (no options, legacy) | – |
| `PineTree` | Trunk + 3 cones, ~4 high | cylinder (trunk), cone (crown) |
| `OakTree` | Thick trunk + 3 squashed spheres, ~4.5 high | cylinder (trunk), sphere (crown bound) |
| `Bush` | 3 squashed spheres | sphere |
| `Rock` | Randomly displaced icosahedron; option `seed` picks the variant | convex (hull vertices) |
| `Castle` | 12x12 courtyard, 4 round towers with cone roofs, 4 walls (gate gap at +Z), central keep | 4x(cylinder, cone), 5 boxes (walls), 1 box (keep) |

All models are built only from ThreeJS primitives with flat-shaded colours (no textures), low segment counts, and shared geometries/materials (cached per model type, or per seed for rocks). Creating 1000 trees therefore costs 1000 small `Mesh` objects but no extra GPU buffers. For very large forests consider `InstancedMesh` in your game.

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
castle.getColliderTags(); // Castle only: 'tower' | 'roof' | 'wall' | 'keep' per shape
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

**Simple vs. complex models.** A simple cylinder (e.g. a trunk) needs only position, rotation and radius. A complex object such as a castle is *decomposed into many simple primitives*: each tower is a cylinder, each wall a rotated box, the keep a box. The gate is a real gap between two wall boxes, so a character can pass it. Use the tags to treat e.g. roofs differently (ignore them, or use them as triggers). Rocks expose a convex hull instead, which fits the GJK/SAT style of collision checks.

Foliage shapes are bounding shapes of the crown; whether to collide with them is up to the consumer (use the first collider only for "trunk only" collision).

## Adding a model
1. Subclass `WorldModel` in `src/models/`, call `super(name, options)`.
2. Create geometry via `shared(key, factory)` and materials via `material(color, flat)` so they are reused.
3. Add meshes with `addMesh()` and matching collision shapes with `addShape()` (local space; `WorldModel` applies position/rotation/size).
4. Export it from `src/index.js`, register it in `src/registry.js`, add a test.

## Viewer
```
npm install
npm run dev
```
Open the printed URL and pick a model in the menu. New models are registered in `src/registry.js`.

## Tests
`npm test`
