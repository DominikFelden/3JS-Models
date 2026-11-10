import { Box3, Vector3 } from 'three';
import {
  SimpleTree, PineTree, OakTree, Bush, Rock, House, Castle, LeafTree, StylizedTree, Forest,
  MAX_STYLIZED_COMPLEXITY, STYLIZED_FOREST_LEVELS,
  MAX_TREE_COMPLEXITY, MAX_CASTLE_COMPLEXITY,
  Wall, Door, Window, GlassDoor, Column, Roof, Chimney, Stairs, Railing, Balcony, Grass, BirdsNest, Flower,
  LEAF_TYPES,
  Mountain, Hill, Cliff, CaveEntrance, Pond, Waterfall, Crystal, IceSpire, Well, Windmill, Watchtower, Bridge, Fence, Signpost, MarketStall, Tent, Mine, WizardTower, Temple, Obelisk, Portal, Ruins, Gravestone, Shrine, Pyramid, Campfire, Torch, Lantern, Chest, Barrel, Crate, Banner, Cart, Anvil, Table, Chair, Bed, Mushroom, GiantMushroom, Cactus, PalmTree, Stump, Log, Reeds, Pumpkin, Rowboat, Ship,
} from './index.ts';

/** Tree controls shown in the viewer's parameter modal (`key` = model option). Colours default to `null`: the picked texture's own colours. */
const TREE_PARAMS = [
  { key: 'trunkHeight', label: 'Trunk height', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: 'trunkThickness', label: 'Trunk thickness', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { key: 'leafSize', label: 'Leaf size', type: 'range', min: 0.5, max: 2.5, step: 0.05, value: 1 },
  { key: 'trunkColor', label: 'Trunk colour', type: 'color', value: null, fallback: '#7a5230' },
  { key: 'leafColor', label: 'Leaf colour', type: 'color', value: null, fallback: '#4a9a2a' },
];
/** Stylized-Tree: does the trunk continue through the crown? `auto` = from the seed (half of them). */
const LEADER_PARAM = { key: 'leader', label: 'Trunk', type: 'select', value: 'auto', options: [['auto', 'Auto (seed)'], ['on', 'Continues'], ['off', 'Splits']] };
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
  { key: 'treeType', label: 'Tree type', type: 'select', value: 'stylized', options: [['stylized', 'Stylized (cards)'], ['leaf', 'Leaf-Tree']] },
  { key: 'count', label: 'Trees', type: 'range', min: 50, max: 60000, step: 50, value: count },
  { key: 'area', label: 'Area (side)', type: 'range', min: 40, max: 1500, step: 10, value: area },
  { key: 'sizeVariety', label: 'Size variety', type: 'range', min: 0, max: 1.5, step: 0.1, value: 1 },
  { key: 'treeDistance', label: '3D tree range', type: 'range', min: 10, max: 100, step: 5, value: 25 },
  { key: 'impostorDistance', label: 'Impostor range', type: 'range', min: 100, max: 1500, step: 50, value: 600 },
  ON_OFF('lod', 'Distance LOD'),
  ON_OFF('impostors', 'Impostors'),
  ON_OFF('canopy', 'Canopy'),
  ON_OFF('shadows', 'Shadows'),
  ON_OFF('autoDetail', 'Auto detail'),
];
/** Complexity slider of the forests: complexity of the nearest 3D (stylized) trees. */
const FOREST_COMPLEXITY = { max: MAX_STYLIZED_COMPLEXITY, value: STYLIZED_FOREST_LEVELS[0].complexity };
/** Forest from the viewer's options; `autoDetail` lets the viewer lower `detail` when the frame rate drops. */
function forest(o) {
  const f = new Forest({
    seed: o.seed, count: o.count, area: o.area, treeType: o.treeType, sizeVariety: o.sizeVariety,
    complexity: o.treeType === 'leaf' ? null : o.complexity, // the slider covers the stylized trees; leaf trees keep their levels
    lod: o.lod !== 'off', impostors: o.impostors !== 'off', canopy: o.canopy !== 'off',
    impostorDistance: o.treeDistance, canopyDistance: o.impostorDistance,
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
  { name: 'Stylized-Tree', complexity: { max: MAX_STYLIZED_COMPLEXITY, value: 2 }, params: [...TREE_PARAMS, LEADER_PARAM], create: (o) => new StylizedTree({ ...o, leader: { on: true, off: false }[o.leader] }) },
  { name: 'Forest', complexity: FOREST_COMPLEXITY, params: FOREST_PARAMS(1000, 160), fog: [150, 1400], create: forest },
  {
    name: 'Forest (fly-over)', complexity: FOREST_COMPLEXITY, params: FOREST_PARAMS(30000, 1000), fog: [200, 1600],
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
  { name: 'Mountain', create: (o) => new Mountain(base(o)) },
  { name: 'Hill', create: (o) => new Hill(base(o)) },
  { name: 'Cliff', create: (o) => new Cliff(base(o)) },
  { name: 'Cave Entrance', create: (o) => new CaveEntrance(base(o)) },
  { name: 'Pond', create: (o) => new Pond(base(o)) },
  { name: 'Waterfall', create: (o) => new Waterfall(base(o)) },
  { name: 'Crystal', create: (o) => new Crystal(base(o)) },
  { name: 'Ice Spire', create: (o) => new IceSpire(base(o)) },
  { name: 'Well', create: (o) => new Well(base(o)) },
  { name: 'Windmill', create: (o) => new Windmill(base(o)) },
  { name: 'Watchtower', create: (o) => new Watchtower(base(o)) },
  { name: 'Bridge', create: (o) => new Bridge(base(o)) },
  { name: 'Fence', create: (o) => new Fence(base(o)) },
  { name: 'Signpost', create: (o) => new Signpost(base(o)) },
  { name: 'Market Stall', create: (o) => new MarketStall(base(o)) },
  { name: 'Tent', create: (o) => new Tent(base(o)) },
  { name: 'Mine', create: (o) => new Mine(base(o)) },
  { name: 'Temple', create: (o) => new Temple(base(o)) },
  { name: 'Obelisk', create: (o) => new Obelisk(base(o)) },
  { name: 'Portal', create: (o) => new Portal(base(o)) },
  { name: 'Ruins', create: (o) => new Ruins(base(o)) },
  { name: 'Gravestone', create: (o) => new Gravestone(base(o)) },
  { name: 'Shrine', create: (o) => new Shrine(base(o)) },
  { name: 'Pyramid', create: (o) => new Pyramid(base(o)) },
  { name: 'Campfire', create: (o) => new Campfire(base(o)) },
  { name: 'Torch', create: (o) => new Torch(base(o)) },
  { name: 'Lantern', create: (o) => new Lantern(base(o)) },
  { name: 'Chest', create: (o) => new Chest(base(o)) },
  { name: 'Barrel', create: (o) => new Barrel(base(o)) },
  { name: 'Crate', create: (o) => new Crate(base(o)) },
  { name: 'Banner', create: (o) => new Banner(base(o)) },
  { name: 'Cart', create: (o) => new Cart(base(o)) },
  { name: 'Anvil', create: (o) => new Anvil(base(o)) },
  { name: 'Table', create: (o) => new Table(base(o)) },
  { name: 'Chair', create: (o) => new Chair(base(o)) },
  { name: 'Bed', create: (o) => new Bed(base(o)) },
  { name: 'Mushroom', create: (o) => new Mushroom(base(o)) },
  { name: 'Giant Mushroom', create: (o) => new GiantMushroom(base(o)) },
  { name: 'Cactus', create: (o) => new Cactus(base(o)) },
  { name: 'Palm Tree', create: (o) => new PalmTree(base(o)) },
  { name: 'Stump', create: (o) => new Stump(base(o)) },
  { name: 'Log', create: (o) => new Log(base(o)) },
  { name: 'Reeds', create: (o) => new Reeds(base(o)) },
  { name: 'Pumpkin', create: (o) => new Pumpkin(base(o)) },
  { name: 'Rowboat', create: (o) => new Rowboat(base(o)) },
  { name: 'Ship', create: (o) => new Ship(base(o)) },
];

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
export const models = unsorted.sort(byName);
