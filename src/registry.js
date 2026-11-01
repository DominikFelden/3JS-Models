import {
  SimpleTree, PineTree, OakTree, Bush, Rock, House, Castle, LeafTree,
  MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY,
  Wall, Door, Window, Column, Roof, Chimney, Stairs, Railing, Balcony, Grass, BirdsNest, Flower, FlowerBud, LeafModel,
  OvalLeaf, TriangleLeaf,
} from './index.js';

/**
 * Models listed in the viewer menu (sorted alphabetically automatically). Add new models here.
 * `create(opts)` receives `{ complexity, seed }` from the viewer.
 * `complexity: { max, value }` makes the viewer show a complexity slider.
 * (`seed` is undefined for a fresh random model, or a number to rebuild one.)
 */
const unsorted = [
  { name: 'SimpleTree', create: () => new SimpleTree() },
  { name: 'PineTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, create: (o) => new PineTree(o) },
  { name: 'OakTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, create: (o) => new OakTree(o) },
  { name: 'Leaf-Tree', complexity: { max: MAX_TREE_COMPLEXITY, value: 4 }, create: (o) => new LeafTree(o) },
  { name: 'Bush', create: (o) => new Bush(o) },
  { name: 'Rock', create: (o) => new Rock({ seed: o.seed }) },
  { name: 'House (cottage)', create: (o) => new House({ type: 'cottage', seed: o.seed }) },
  { name: 'House (longhouse)', create: (o) => new House({ type: 'longhouse', seed: o.seed }) },
  { name: 'House (towerhouse)', create: (o) => new House({ type: 'towerhouse', seed: o.seed }) },
  { name: 'Balcony', create: (o) => new Balcony({ seed: o.seed }) },
  { name: "Bird's nest", create: (o) => new BirdsNest({ seed: o.seed }) },
  { name: 'Chimney', create: (o) => new Chimney({ seed: o.seed }) },
  { name: 'Column', create: (o) => new Column({ seed: o.seed }) },
  { name: 'Door', create: (o) => new Door({ seed: o.seed }) },
  { name: 'Door (arched)', create: (o) => new Door({ seed: o.seed, arched: true }) },
  { name: 'Flower', create: (o) => new Flower({ seed: o.seed }) },
  { name: 'Flower bud', create: (o) => new FlowerBud({ seed: o.seed }) },
  { name: 'Grass', create: (o) => new Grass({ seed: o.seed }) },
  { name: 'Leaf (oval)', create: (o) => new LeafModel({ seed: o.seed, LeafClass: OvalLeaf }) },
  { name: 'Leaf (triangle)', create: (o) => new LeafModel({ seed: o.seed, LeafClass: TriangleLeaf }) },
  { name: 'Railing', create: (o) => new Railing({ seed: o.seed }) },
  { name: 'Roof (flat)', create: (o) => new Roof({ seed: o.seed, type: 'flat' }) },
  { name: 'Roof (gable)', create: (o) => new Roof({ seed: o.seed, type: 'gable' }) },
  { name: 'Roof (hip)', create: (o) => new Roof({ seed: o.seed, type: 'hip' }) },
  { name: 'Stairs', create: (o) => new Stairs({ seed: o.seed }) },
  { name: 'Wall', create: (o) => new Wall({ seed: o.seed }) },
  { name: 'Wall (brick)', create: (o) => new Wall({ seed: o.seed, surface: 'brick' }) },
  { name: 'Window', create: (o) => new Window({ seed: o.seed }) },
  { name: 'Window (arched)', create: (o) => new Window({ seed: o.seed, arched: true }) },
  { name: 'Castle', complexity: { max: MAX_CASTLE_COMPLEXITY, value: 3 }, create: (o) => new Castle(o) },
];

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
export const models = unsorted.sort(byName);
