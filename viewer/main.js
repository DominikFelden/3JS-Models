import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Box3, Vector3,
  HemisphereLight, DirectionalLight, Fog, CircleGeometry, MeshStandardMaterial, Mesh,
  PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { models } from '../src/registry.js';

const scene = new Scene();
scene.background = new Color(0xbfd9ee);
scene.fog = new Fog(0xbfd9ee, 80, 300);
const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
const view = document.getElementById('view');
view.appendChild(renderer.domElement);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(view);
resize();

// Sky/ground hemisphere light, a warm low sun with soft shadows, and a grass disc to receive them.
scene.add(new HemisphereLight(0xcfe6ff, 0x5a6b3a, 0.9));
const sun = new DirectionalLight(0xfff0d6, 2.4);
sun.position.set(14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
const ground = new Mesh(new CircleGeometry(250, 64), new MeshStandardMaterial({ color: 0x6a8f48, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
let current = null;

const select = document.getElementById('select');
const search = document.getElementById('search');
const noMatch = document.getElementById('noMatch');
const slider = document.getElementById('complexity');
const sliderValue = document.getElementById('complexityValue');
const sliderRow = document.getElementById('complexityRow');
const rerollButton = document.getElementById('reroll');
const seedLabel = document.getElementById('seed');
const dock = document.getElementById('dock');
const modal = document.getElementById('modal');
const modalRows = document.getElementById('modalRows');
const paramsButton = document.getElementById('paramsButton');

// Parameter values per model (kept when switching back) and the keys pinned below the 3D view.
const paramValues = new Map();
const pinned = new Set();
let seed;
const defs = () => models[Number(select.value)].params ?? [];
const values = () => {
  const name = models[Number(select.value)].name;
  if (!paramValues.has(name)) paramValues.set(name, Object.fromEntries(defs().map((d) => [d.key, d.value])));
  return paramValues.get(name);
};

/** (Re)build the selected model. `reframe` moves the camera to fit the new model. */
function show(reframe) {
  const entry = models[Number(select.value)];
  if (current) {
    scene.remove(current);
    current.dispose?.(); // free this model's own geometries (shared ones stay)
  }
  // No seed given -> every build is a new random variation.
  current = entry.create({ complexity: Number(slider.value), seed, ...values() });
  seed = current.seed; // later changes (sliders) modify this very model; Re-roll picks a new seed
  seedLabel.textContent = current.seed !== undefined ? `seed ${current.seed}` : '';
  scene.add(current);
  if (!reframe) return;
  const box = new Box3().setFromObject(current);
  const size = box.getSize(new Vector3()).length();
  const center = box.getCenter(new Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new Vector3(1, 0.6, 1).normalize().multiplyScalar(size * 1.4));
  controls.update();
}

/** One control for a parameter; all copies (modal + dock) of a key stay in sync via `data-key`. */
function makeControl(def) {
  const wrap = document.createElement('label');
  wrap.className = 'ctl';
  wrap.append(def.label + ': ');
  let input;
  if (def.type === 'select') {
    input = document.createElement('select');
    def.options.forEach(([v, t]) => input.add(new Option(t, v)));
  } else {
    input = document.createElement('input');
    input.type = def.type;
    if (def.type === 'range') Object.assign(input, { min: def.min, max: def.max, step: def.step });
  }
  input.value = values()[def.key];
  input.dataset.key = def.key;
  const out = document.createElement('span');
  if (def.type === 'range') out.textContent = Number(input.value).toFixed(2);
  input.addEventListener('input', () => {
    setParam(def.key, def.type === 'range' ? Number(input.value) : input.value);
    show(false);
  });
  wrap.append(input, out);
  return wrap;
}

/** Store a value and update every control showing that key. */
function setParam(key, value) {
  values()[key] = value;
  document.querySelectorAll(`[data-key="${key}"]`).forEach((el) => {
    el.value = value;
    if (el.type === 'range') el.nextElementSibling.textContent = Number(value).toFixed(2);
  });
}

/** Rebuild the dock (pinned controls) and the modal rows for the selected model. */
function renderParams() {
  dock.replaceChildren();
  modalRows.replaceChildren();
  paramsButton.style.display = defs().length ? '' : 'none';
  defs().forEach((def) => {
    const row = document.createElement('div');
    row.className = 'row';
    const pin = document.createElement('label');
    pin.className = 'pin';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = pinned.has(def.key);
    box.addEventListener('change', () => { box.checked ? pinned.add(def.key) : pinned.delete(def.key); renderParams(); });
    pin.append(box, 'Show below');
    row.append(makeControl(def), pin);
    modalRows.append(row);
    if (pinned.has(def.key)) dock.append(makeControl(def));
  });
  dock.style.display = dock.children.length ? 'flex' : 'none';
}

/** Random value within a control's range / options. */
function randomValue(def) {
  if (def.type === 'range') {
    const steps = Math.round((def.max - def.min) / def.step);
    return +(def.min + Math.floor(Math.random() * (steps + 1)) * def.step).toFixed(3);
  }
  if (def.type === 'select') return def.options[Math.floor(Math.random() * def.options.length)][0];
  return `#${new Color().setHSL(Math.random(), 0.35 + Math.random() * 0.5, 0.2 + Math.random() * 0.4).getHexString()}`;
}

/** New seed and new random values for every parameter. */
function randomize() {
  seed = undefined;
  defs().forEach((d) => { values()[d.key] = randomValue(d); });
  renderParams();
  show(false);
}

paramsButton.addEventListener('click', () => { modal.style.display = 'flex'; });
document.getElementById('modalClose').addEventListener('click', () => { modal.style.display = 'none'; });
modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
document.getElementById('randomize').addEventListener('click', randomize);

/** Show the slider only for models that support complexity, and set its range. */
function configureSlider() {
  const c = models[Number(select.value)].complexity;
  sliderRow.style.display = c ? '' : 'none';
  if (c) {
    slider.max = c.max;
    slider.value = c.value;
    sliderValue.textContent = c.value;
  }
}

/** Fill the drop-down with models whose name contains the search text (models are already sorted). */
function fillSelect() {
  const q = search.value.trim().toLowerCase();
  const previous = select.value;
  select.replaceChildren();
  models.forEach((m, i) => { if (m.name.toLowerCase().includes(q)) select.add(new Option(m.name, i)); });
  noMatch.style.display = select.options.length ? 'none' : '';
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  return select.value !== previous && select.options.length > 0;
}

fillSelect();
select.addEventListener('change', () => { seed = undefined; configureSlider(); renderParams(); show(true); });
search.addEventListener('input', () => {
  if (fillSelect()) { seed = undefined; configureSlider(); renderParams(); show(true); }
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && select.options.length) { select.selectedIndex = 0; select.dispatchEvent(new Event('change')); }
});
// Rebuild live while dragging; keep the camera where the user put it.
slider.addEventListener('input', () => { sliderValue.textContent = slider.value; show(false); });
rerollButton.addEventListener('click', randomize);
configureSlider();
renderParams();
show(true);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
