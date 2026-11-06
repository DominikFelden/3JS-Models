import { Box3, Vector3 } from 'three';
import {
  SimpleTree, PineTree, OakTree, Bush, Rock, House, Castle, LeafTree, Forest,
  MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY,
  Wall, Door, Window, GlassDoor, Column, Roof, Chimney, Stairs, Railing, Balcony, Grass, BirdsNest, Flower,
  LEAF_TYPES,
} from './index.ts';

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
 * `fog: [near, far]` widens the viewer's fog for big scenes (default [80, 300]).
 * `create` also receives the viewer's `renderer` (used to bake forest impostors).
 * (`seed` is undefined for a fresh random model, or a number to rebuild one.)
 */
const ON_OFF = (key, label) => ({ key, label, type: 'select', value: 'on', options: [['on', 'On'], ['off', 'Off']] });
const FOREST_PARAMS = (count, area) => [
  { key: 'count', label: 'Trees', type: 'range', min: 50, max: 60000, step: 50, value: count },
  { key: 'area', label: 'Area (side)', type: 'range', min: 40, max: 1500, step: 10, value: area },
  ON_OFF('lod', 'Distance LOD'),
  ON_OFF('impostors', 'Impostors'),
  ON_OFF('canopy', 'Canopy'),
  ON_OFF('shadows', 'Shadows'),
  ON_OFF('autoDetail', 'Auto detail'),
];
/** Forest from the viewer's options; `autoDetail` lets the viewer lower `detail` when the frame rate drops. */
function forest(o) {
  const f = new Forest({
    seed: o.seed, count: o.count, area: o.area, lod: o.lod !== 'off', impostors: o.impostors !== 'off', canopy: o.canopy !== 'off',
    shadows: o.shadows !== 'off', textures: o.textures, treeOptions: { textures: o.textures }, renderer: o.renderer,
  });
  (f as any).autoDetail = o.autoDetail !== 'off';
  return f;
}
const base = (o) => ({ seed: o.seed, textures: o.textures });
const unsorted = [
  { name: 'SimpleTree', create: () => new SimpleTree() },
  { name: 'PineTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, params: TREE_PARAMS, create: (o) => new PineTree(o) },
  { name: 'OakTree', complexity: { max: MAX_TREE_COMPLEXITY, value: 2 }, params: TREE_PARAMS, create: (o) => new OakTree(o) },
  { name: 'Leaf-Tree', complexity: { max: MAX_TREE_COMPLEXITY, value: 4 }, params: [LEAF_TYPE_PARAM, ...TREE_PARAMS], create: (o) => new LeafTree(o) },
  { name: 'Forest (Leaf-Tree)', params: FOREST_PARAMS(1000, 160), fog: [150, 1400], create: forest },
  {
    name: 'Forest (fly-over)', params: FOREST_PARAMS(30000, 1000), fog: [200, 1600],
    create: (o) => {
      const f = forest(o);
      f.viewBox = new Box3(new Vector3(-120, 0, -120), new Vector3(120, 60, 120)); // start high above the trees
      return f;
    },
  },
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
  { name: 'Grass', create: (o) => new Grass(base(o)) },
  { name: 'Railing', create: (o) => new Railing(base(o)) },
  { name: 'Roof (flat)', create: (o) => new Roof({ ...base(o), type: 'flat' }) },
  { name: 'Roof (gable)', create: (o) => new Roof({ ...base(o), type: 'gable' }) },
  { name: 'Roof (hip)', create: (o) => new Roof({ ...base(o), type: 'hip' }) },
  { name: 'Stairs', create: (o) => new Stairs(base(o)) },
  { name: 'Wall', create: (o) => new Wall(base(o)) },
  { name: 'Wall (brick)', create: (o) => new Wall({ ...base(o), surface: 'brick' }) },
  { name: 'Window', create: (o) => new Window(base(o)) },
  { name: 'Window (arched)', create: (o) => new Window({ ...base(o), arched: true }) },
  { name: 'Glass Door', create: (o) => new GlassDoor(base(o)) },
  { name: 'Castle', complexity: { max: MAX_CASTLE_COMPLEXITY, value: 3 }, create: (o) => new Castle(o) },
];

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
export const models = unsorted.sort(byName);
