import {
  SimpleTree, PineTree, OakTree, Bush, Rock, House, Castle,
  MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY,
} from './index.js';

/**
 * Models listed in the viewer menu. Add new models here.
 * `create(opts)` receives `{ complexity, seed }` from the viewer.
 * `complexity: { max, value }` makes the viewer show a complexity slider.
 * (`seed` is undefined for a fresh random model, or a number to rebuild one.)
 */
export const models = [
  { name: 'SimpleTree', create: () => new SimpleTree() },
  { name: 'PineTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, create: (o) => new PineTree(o) },
  { name: 'OakTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, create: (o) => new OakTree(o) },
  { name: 'Bush', create: (o) => new Bush(o) },
  { name: 'Rock', create: (o) => new Rock({ seed: o.seed }) },
  { name: 'House (cottage)', create: (o) => new House({ type: 'cottage', seed: o.seed }) },
  { name: 'House (longhouse)', create: (o) => new House({ type: 'longhouse', seed: o.seed }) },
  { name: 'House (towerhouse)', create: (o) => new House({ type: 'towerhouse', seed: o.seed }) },
  { name: 'Castle', complexity: { max: MAX_CASTLE_COMPLEXITY, value: 3 }, create: (o) => new Castle(o) },
];
