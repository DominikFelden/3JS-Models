import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Box3, Vector3,
  HemisphereLight, DirectionalLight, Fog, CircleGeometry, MeshStandardMaterial, Mesh,
  PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { models } from '../src/registry.js';
import { preloadTextures, getTexture, TEXTURE_VARIANTS } from '../src/textures/index.js';

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
const paramsHint = document.getElementById('paramsHint');
const texturesSection = document.getElementById('texturesSection');
const textureRows = document.getElementById('textureRows');
const paramsButton = document.getElementById('paramsButton');
const loading = document.getElementById('loading');

// Parameter values per model (kept when switching back) and the keys pinned below the 3D view.
// A colour of `null` is "auto": the colours of the picked texture.
const paramValues = new Map();
const texturePins = new Map(); // model name -> {kind: variant} chosen in the modal
const pinned = new Set();
let seed;
const defs = () => models[Number(select.value)].params ?? [];
const values = () => {
  const name = models[Number(select.value)].name;
  if (!paramValues.has(name)) paramValues.set(name, Object.fromEntries(defs().map((d) => [d.key, d.value])));
  return paramValues.get(name);
};
const pins = () => {
  const name = models[Number(select.value)].name;
  if (!texturePins.has(name)) texturePins.set(name, {});
  return texturePins.get(name);
};

/** (Re)build the selected model. `reframe` moves the camera to fit the new model. */
function show(reframe) {
  const entry = models[Number(select.value)];
  if (current) {
    scene.remove(current);
    current.dispose?.(); // free this model's own geometries (shared ones stay)
  }
  // No seed given -> every build is a new random variation.
  current = entry.create({ complexity: Number(slider.value), seed, textures: { ...pins() }, ...values() });
  seed = current.seed; // later changes (sliders) modify this very model; Re-roll picks a new seed
  seedLabel.textContent = current.seed !== undefined ? `seed ${current.seed}` : '';
  scene.add(current);
  paramsButton.style.display = defs().length || usedTextures().length ? '' : 'none';
  if (modal.style.display === 'flex') renderTextures();
  if (!reframe) return;
  const box = current.viewBox ?? new Box3().setFromObject(current);
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
  input.value = values()[def.key] ?? def.fallback;
  input.dataset.key = def.key;
  const out = document.createElement('span');
  if (def.type === 'range') out.textContent = Number(input.value).toFixed(2);
  input.addEventListener('input', () => {
    setParam(def.key, def.type === 'range' ? Number(input.value) : input.value);
    show(false);
  });
  wrap.append(input, out);
  if (def.value === null) {
    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = values()[def.key] === null;
    auto.dataset.auto = def.key;
    auto.addEventListener('change', () => { setParam(def.key, auto.checked ? null : input.value); show(false); });
    wrap.append(auto, 'auto');
  }
  return wrap;
}

/** Store a value and update every control showing that key. */
function setParam(key, value) {
  values()[key] = value;
  document.querySelectorAll(`[data-key="${key}"]`).forEach((el) => {
    if (value !== null) el.value = value;
    if (el.type === 'range') el.nextElementSibling.textContent = Number(value).toFixed(2);
  });
  document.querySelectorAll(`[data-auto="${key}"]`).forEach((el) => { el.checked = value === null; });
}

/** Rebuild the dock (pinned controls) and the modal rows for the selected model. */
function renderParams() {
  dock.replaceChildren();
  modalRows.replaceChildren();
  paramsHint.style.display = defs().length ? '' : 'none';
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

const thumbnails = new Map();

/** Picture of a pooled texture for the picker. The data's first row is the image bottom, so rows are flipped. */
function thumbnailUrl(kind, variant) {
  const key = `${kind}:${variant}`;
  if (!thumbnails.has(key)) {
    const texture = getTexture(kind, variant);
    if (!texture) return null;
    const { data, width, height } = texture.image;
    const upright = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      upright.set(data.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    }
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    canvas.getContext('2d').putImageData(new ImageData(upright, width, height), 0, 0);
    thumbnails.set(key, canvas.toDataURL());
  }
  return thumbnails.get(key);
}

/** Texture kinds the current model wears (e.g. bark, foliage). */
function usedTextures() {
  return Object.keys(current?.textureVariants?.() ?? {});
}

/** Texture picker: the shared variants per kind. Click one to pin it for this model, click it again to go back to the seed's pick. */
function renderTextures() {
  textureRows.replaceChildren();
  const kinds = usedTextures();
  texturesSection.style.display = kinds.length ? '' : 'none';
  const worn = current.textureVariants();
  kinds.forEach((kind) => {
    const row = document.createElement('div');
    row.className = 'texrow';
    row.append(Object.assign(document.createElement('span'), { className: 'name', textContent: kind }));
    for (let v = 0; v < TEXTURE_VARIANTS; v++) {
      const url = thumbnailUrl(kind, v);
      if (!url) continue;
      const thumb = Object.assign(document.createElement('img'), { src: url, className: 'thumb', title: `${kind} ${v + 1}`, alt: `${kind} ${v + 1}` });
      if (v === worn[kind]) thumb.classList.add('worn');
      if (pins()[kind] === v) thumb.classList.add('pinned');
      thumb.addEventListener('click', () => {
        if (pins()[kind] === v) delete pins()[kind]; else pins()[kind] = v;
        show(false);
      });
      row.append(thumb);
    }
    textureRows.append(row);
  });
}

/** Random value within a control's range / options. Colours that default to "auto" stay auto. */
function randomValue(def) {
  if (def.type === 'range') {
    const steps = Math.round((def.max - def.min) / def.step);
    return +(def.min + Math.floor(Math.random() * (steps + 1)) * def.step).toFixed(3);
  }
  if (def.type === 'select') return def.options[Math.floor(Math.random() * def.options.length)][0];
  if (def.value === null) return null;
  return `#${new Color().setHSL(Math.random(), 0.35 + Math.random() * 0.5, 0.2 + Math.random() * 0.4).getHexString()}`;
}

/** New seed (so new random textures), no pinned textures and new random values for every parameter. */
function randomize() {
  seed = undefined;
  texturePins.delete(models[Number(select.value)].name);
  defs().forEach((d) => { values()[d.key] = randomValue(d); });
  renderParams();
  show(false);
}

paramsButton.addEventListener('click', () => { modal.style.display = 'flex'; renderTextures(); });
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

const statsBox = document.getElementById('stats');
/** FPS and draw load, shown for models that report `stats` (Forest) to judge performance on a phone. */
function showStats(fps) {
  const st = current?.stats;
  statsBox.style.display = st ? 'block' : 'none';
  if (!st) return;
  const { calls, triangles } = renderer.info.render;
  statsBox.textContent = `${fps} fps\ntrees ${st.visible}/${st.trees}\nLOD ${st.levels.join(' / ')}\ndraw calls ${calls}\ntriangles ${(triangles / 1000).toFixed(0)}k`;
}

/** Paint the shared texture pool with the viewer's own renderer (with progress), then show the first model. */
async function start() {
  const percent = document.getElementById('loadingPercent');
  try {
    await preloadTextures({ renderer, onProgress: (p) => { percent.textContent = `${Math.round(p * 100)}%`; } });
  } finally {
    loading.remove();
  }
  show(true);
  let frames = 0, since = performance.now(), fps = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    current?.update?.(camera); // models with levels of detail (Forest) choose what to draw
    renderer.render(scene, camera);
    frames++;
    const now = performance.now();
    if (now - since >= 500) {
      fps = Math.round(frames * 1000 / (now - since));
      frames = 0;
      since = now;
      showStats(fps);
    }
  });
}
start();
