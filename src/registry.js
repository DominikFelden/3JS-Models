import {
  SimpleTree, PineTree, OakTree, Bush, Rock, House, Castle, LeafTree,
  MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY,
  Wall, Door, Window, Column, Roof, Chimney, Stairs, Railing, Balcony, Grass, BirdsNest, Flower, FlowerBud, LeafModel,
  OvalLeaf, TriangleLeaf, LEAF_TYPES,
} from './index.js';

/** Tree controls shown in the viewer's parameter modal (`key` = model option). Colours default to `null`: the picked texture's own colours. */
const TREE_PARAMS = [
  { key: 'trunkHeight', label: 'Trunk height', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: 'trunkThickness', label: 'Trunk thickness', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: 'leafSize', label: 'Leaf size', type: 'range', min: 0.5, max: 2.5, step: 0.05, value: 1 },
  { key: 'trunkColor', label: 'Trunk colour', type: 'color', value: null, fallback: '#7a5230' },
  { key: 'leafColor', label: 'Leaf colour', type: 'color', value: null, fallback: '#4a9a2a' },
];
const LEAF_TYPE_PARAM = {
  key: 'leafType', label: 'Leaf type', type: 'select', value: 'oak',
  options: Object.keys(LEAF_TYPES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]),
};

/**
 * Models listed in the viewer menu (sorted alphabetically automatically). Add new models here.
 * `create(opts)` receives `{ complexity, seed, textures }` from the viewer (`textures` pins
 * texture variants, `{kind: 0..4}`; pass it on to the model).
 * `complexity: { max, value }` makes the viewer show a complexity slider.
 * `params` lists extra controls (range / select / color) for the viewer's parameter modal; their
 * values are passed to `create` under their `key`. A colour with `value: null` is "auto" (not set).
 * (`seed` is undefined for a fresh random model, or a number to rebuild one.)
 */
const base = (o) => ({ seed: o.seed, textures: o.textures });
const unsorted = [
  { name: 'SimpleTree', create: () => new SimpleTree() },
  { name: 'PineTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, params: TREE_PARAMS, create: (o) => new PineTree(o) },
  { name: 'OakTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, params: TREE_PARAMS, create: (o) => new OakTree(o) },
  { name: 'Leaf-Tree', complexity: { max: MAX_TREE_COMPLEXITY, value: 4 }, params: [LEAF_TYPE_PARAM, ...TREE_PARAMS], create: (o) => new LeafTree(o) },
  { name: 'Bush', create: (o) => new Bush(o) },
  { name: 'Rock', create: (o) => new Rock(base(o)) },
  { name: 'House (cottage)', create: (o) => new House({ ...base(o), type: 'cottage' }) },
  { name: 'House (longhouse)', create: (o) => new House({ ...base(o), type: 'longhouse' }) },
  { name: 'House (towerhouse)', create: (o) => new House({ ...base(o), type: 'towerhouse' }) },
  { name: 'Balcony', create: (o) => new Balcony(base(o)) },
  { name: "Bird's nest", create: (o) => new BirdsNest(base(o)) },
  { name: 'Chimney', create: (o) => new Chimney(base(o)) },
  { name: 'Column', create: (o) => new Column(base(o)) },
  { name: 'Door', create: (o) => new Door(base(o)) },
  { name: 'Door (arched)', create: (o) => new Door({ ...base(o), arched: true }) },
  { name: 'Flower', create: (o) => new Flower(base(o)) },
  { name: 'Flower bud', create: (o) => new FlowerBud(base(o)) },
  { name: 'Grass', create: (o) => new Grass(base(o)) },
  { name: 'Leaf (oval)', create: (o) => new LeafModel({ ...base(o), LeafClass: OvalLeaf }) },
  { name: 'Leaf (triangle)', create: (o) => new LeafModel({ ...base(o), LeafClass: TriangleLeaf }) },
  { name: 'Railing', create: (o) => new Railing(base(o)) },
  { name: 'Roof (flat)', create: (o) => new Roof({ ...base(o), type: 'flat' }) },
  { name: 'Roof (gable)', create: (o) => new Roof({ ...base(o), type: 'gable' }) },
  { name: 'Roof (hip)', create: (o) => new Roof({ ...base(o), type: 'hip' }) },
  { name: 'Stairs', create: (o) => new Stairs(base(o)) },
  { name: 'Wall', create: (o) => new Wall(base(o)) },
  { name: 'Wall (brick)', create: (o) => new Wall({ ...base(o), surface: 'brick' }) },
  { name: 'Window', create: (o) => new Window(base(o)) },
  { name: 'Window (arched)', create: (o) => new Window({ ...base(o), arched: true }) },
  { name: 'Castle', complexity: { max: MAX_CASTLE_COMPLEXITY, value: 3 }, create: (o) => new Castle(o) },
];

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
export const models = unsorted.sort(byName);
