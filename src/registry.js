import { SimpleTree, PineTree, OakTree, Bush, Rock, Castle } from './index.js';

/** Models listed in the viewer menu. Add new models here. */
export const models = [
  { name: 'SimpleTree', create: () => new SimpleTree() },
  { name: 'PineTree', create: () => new PineTree() },
  { name: 'OakTree', create: () => new OakTree() },
  { name: 'Bush', create: () => new Bush() },
  { name: 'Rock', create: () => new Rock({ seed: 3 }) },
  { name: 'Castle', create: () => new Castle() },
];
