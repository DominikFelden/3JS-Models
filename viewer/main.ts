import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Box3, Vector3,
  HemisphereLight, DirectionalLight, Fog, CircleGeometry, MeshStandardMaterial, Mesh,
  BoxGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, MeshNormalMaterial,
  PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { models } from '../src/registry.ts';
import { bakeModelImpostor, Forest, type ModelImpostor } from '../src/index.ts';
import { preloadTextures, getTexture, TEXTURE_VARIANTS } from '../src/textures/index.ts';
import { setToonShading, ToonOutlines } from '../src/toon/index.ts';

// Toon shading patches three.js shaders, so it is switched on before anything is drawn.
// `?toon=0` starts with the plain look; the checkboxes switch both at any time.
const params = new URLSearchParams(location.search);
setToonShading({ enabled: params.get('toon') !== '0' });

const scene = new Scene();
scene.background = new Color(0xbfd9ee);
const colliderScene = new Scene();
colliderScene.background = scene.background;
const colliderMaterial = new MeshNormalMaterial();
const FOG = [80, 300]; // default; big scenes (forests) ask for more with `fog` in the registry
scene.fog = new Fog(0xbfd9ee, ...FOG);
const camera = new PerspectiveCamera(50, 1, 0.1, 6000);
const renderer = new WebGLRenderer({ antialias: true });
// Phones have very dense screens; 1.5 pixels per CSS pixel looks the same and saves a lot of fill rate.
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
// The stats count a whole frame (shadow maps, outline pass, screen); three would restart them at every render() call.
renderer.info.autoReset = false;
const view = document.getElementById('view') as any;
view.appendChild(renderer.domElement);
const outlines = new ToonOutlines(renderer);
outlines.enabled = params.get('outlines') !== '0' && params.get('toon') !== '0';
Object.assign(window as any, { outlines, setToonShading }); // tweak from the browser console

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  outlines.setSize(w, h);
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
const ground = new Mesh(new CircleGeometry(3000, 96), new MeshStandardMaterial({ color: 0x6a8f48, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
let current = null;

const select = document.getElementById('select') as any;
const search = document.getElementById('search') as any;
const noMatch = document.getElementById('noMatch') as any;
const slider = document.getElementById('complexity') as any;
const sliderValue = document.getElementById('complexityValue') as any;
const sliderRow = document.getElementById('complexityRow') as any;
const rerollButton = document.getElementById('reroll') as any;
const seedLabel = document.getElementById('seed') as any;
const dock = document.getElementById('dock') as any;
const modal = document.getElementById('modal') as any;
const modalRows = document.getElementById('modalRows') as any;
const paramsHint = document.getElementById('paramsHint') as any;
const texturesSection = document.getElementById('texturesSection') as any;
const textureRows = document.getElementById('textureRows') as any;
const paramsButton = document.getElementById('paramsButton') as any;
const loading = document.getElementById('loading') as any;
const previewRow = document.getElementById('impostorPreviewRow');
const previewToggle = document.querySelector<HTMLInputElement>('#impostorPreview');
const previewDistance = document.querySelector<HTMLInputElement>('#impostorPreviewDistance');
const previewStatus = document.getElementById('impostorPreviewStatus');
const colliderToggle = document.querySelector<HTMLInputElement>('#showColliders');
let previewAsset: ModelImpostor | null = null;
let previewMesh: ReturnType<ModelImpostor['createMesh']> | null = null;
const previewOrigin = new Vector3();

type Collider = { position: [number, number, number]; quaternion: [number, number, number, number] } & (
  | { type: 'box'; size: [number, number, number] }
  | { type: 'cone' | 'cylinder'; radius: number; height: number }
  | { type: 'sphere'; radius: number }
  | { type: 'convex'; points: [number, number, number][] }
);

function createColliderMesh(collider: Collider) {
  // Hull points are already in world space, so don't apply the collider transform again.
  if (collider.type === 'convex') {
    return new Mesh(new ConvexGeometry(collider.points.map((point) => new Vector3(...point))), colliderMaterial);
  }
  let geometry;
  switch (collider.type) {
    case 'box': geometry = new BoxGeometry(...collider.size); break;
    case 'cone': geometry = new ConeGeometry(collider.radius, collider.height, 24); break;
    case 'cylinder': geometry = new CylinderGeometry(collider.radius, collider.radius, collider.height, 24); break;
    case 'sphere': geometry = new SphereGeometry(collider.radius, 24, 16); break;
  }
  const mesh = new Mesh(geometry, colliderMaterial);
  mesh.position.fromArray(collider.position);
  mesh.quaternion.fromArray(collider.quaternion);
  return mesh;
}

function refreshPreview() {
  clearImpostorPreview();
  for (const mesh of colliderScene.children) {
    if (mesh instanceof Mesh) mesh.geometry.dispose();
  }
  colliderScene.clear();
  if (colliderToggle.checked) {
    previewRow.hidden = true;
    const colliders: Collider[] = current?.getColliders?.() ?? [];
    for (const collider of colliders) colliderScene.add(createColliderMesh(collider));
  } else {
    buildImpostorPreview();
  }
}

function clearImpostorPreview() {
  if (previewMesh) scene.remove(previewMesh);
  previewAsset?.dispose();
  previewMesh = previewAsset = null;
  if (current) current.visible = true;
  previewStatus.textContent = '';
}

function buildImpostorPreview() {
  previewRow.hidden = current instanceof Forest;
  if (!previewToggle.checked || !current || previewRow.hidden) return;
  try {
    previewAsset = bakeModelImpostor(current, { renderer });
    if (!previewAsset) {
      previewStatus.textContent = 'Impostor unavailable';
      return;
    }
    previewMesh = previewAsset.createMesh();
    previewMesh.position.copy(current.position);
    previewMesh.quaternion.copy(current.quaternion);
    previewMesh.scale.copy(current.scale);
    scene.add(previewMesh);
    updateImpostorPreview();
  } catch (error) {
    console.error('Could not bake model impostor:', error);
    previewStatus.textContent = 'Impostor bake failed';
  }
}

function updateImpostorPreview() {
  if (!previewMesh) return;
  const distance = previewDistance.valueAsNumber;
  previewMesh.visible = previewDistance.validity.valid && Number.isFinite(distance)
    && camera.position.distanceTo(current.getWorldPosition(previewOrigin)) >= distance;
  current.visible = !previewMesh.visible;
  const status = previewMesh.visible ? 'Impostor' : '3D model';
  if (previewStatus.textContent !== status) previewStatus.textContent = status;
}

previewToggle.addEventListener('change', refreshPreview);
colliderToggle.addEventListener('change', refreshPreview);

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

let lastBuildMs = 0;
let pendingShow: ReturnType<typeof setTimeout> | undefined;

/** (Re)build the selected model. `reframe` moves the camera to fit the new model. */
function show(reframe) {
  clearTimeout(pendingShow);
  const entry = models[Number(select.value)];
  clearImpostorPreview();
  if (current) {
    scene.remove(current);
    current.dispose?.(); // free this model's own geometries (shared ones stay)
  }
  // No seed given -> every build is a new random variation.
  const started = performance.now();
  current = entry.create({ complexity: Number(slider.value), seed, textures: { ...pins() }, renderer, ...values() });
  lastBuildMs = performance.now() - started;
  [(scene.fog as any).near, (scene.fog as any).far] = entry.fog ?? FOG;
  seed = current.seed; // later changes (sliders) modify this very model; Re-roll picks a new seed
  seedLabel.textContent = current.seed !== undefined ? `seed ${current.seed}` : '';
  scene.add(current);
  refreshPreview();
  paramsButton.style.display = defs().length || usedTextures().length ? '' : 'none';
  if (modal.style.display === 'flex') renderTextures();
  if (!reframe) return;
  const box = current.viewBox ?? new Box3().setFromObject(current);
  const size = box.getSize(new Vector3()).length();
  const center = box.getCenter(new Vector3());
  controls.target.copy(center);
  outlines.set({ fade: [Math.max(40, size * 2.5), Math.max(160, size * 8)] }); // big models keep their lines
  camera.position.copy(center).add(new Vector3(1, 0.6, 1).normalize().multiplyScalar(size * 1.4));
  controls.update();
}

/**
 * Rebuild for controls that fire while being dragged (sliders). Quick models rebuild at once; slow
 * ones (big forests take a few hundred ms) wait until the control rests for a moment, instead of
 * stalling the page at every step of the drag.
 */
function showSoon() {
  clearTimeout(pendingShow);
  pendingShow = setTimeout(() => show(false), lastBuildMs > 30 ? 200 : 0);
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
    showSoon();
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
  document.querySelectorAll(`[data-key="${key}"]`).forEach((el: any) => {
    if (value !== null) el.value = value;
    if (el.type === 'range') el.nextElementSibling.textContent = Number(value).toFixed(2);
  });
  document.querySelectorAll(`[data-auto="${key}"]`).forEach((el: any) => { el.checked = value === null; });
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
(document.getElementById('modalClose') as any).addEventListener('click', () => { modal.style.display = 'none'; });
modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
(document.getElementById('randomize') as any).addEventListener('click', randomize);

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
  const groups = new Map();
  models.forEach((m, i) => {
    if (!m.name.toLowerCase().includes(q)) return;
    if (!groups.has(m.category)) {
      const group = document.createElement('optgroup');
      group.label = m.category;
      groups.set(m.category, group);
      select.appendChild(group);
    }
    groups.get(m.category).appendChild(new Option(m.name, String(i)));
  });
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
// Rebuild live while dragging (slow models once the slider rests); keep the camera where the user put it.
slider.addEventListener('input', () => { sliderValue.textContent = slider.value; showSoon(); });
rerollButton.addEventListener('click', randomize);
configureSlider();
renderParams();

const toonBox = document.getElementById('toon') as any, outlineBox = document.getElementById('outlines') as any;
toonBox.checked = params.get('toon') !== '0';
outlineBox.checked = outlines.enabled;
toonBox.addEventListener('change', () => setToonShading({ enabled: toonBox.checked }));
outlineBox.addEventListener('change', () => { outlines.enabled = outlineBox.checked; });

const statsBox = document.getElementById('stats') as any;
/** FPS and draw load, shown for models that report `stats` (Forest) to judge performance on a phone. */
function showStats(fps) {
  const st = colliderToggle.checked ? null : current?.stats;
  statsBox.style.display = st ? 'block' : 'none';
  if (!st) return;
  const { calls, triangles } = renderer.info.render;
  statsBox.textContent = `${fps} fps\n3D trees ${st.visible}/${st.trees}\nplants ${st.plants}\ngrass clumps ${st.clumps}\nLOD ${st.levels.join(' / ')}\nimpostors ${st.impostors}\ncanopy ${st.canopy ? 'on' : 'off'}\ndetail ${Math.round(st.detail * 100)}%\ndraw calls ${calls}\ntriangles ${(triangles / 1000).toFixed(0)}k`;
}

/** Paint the shared texture pool with the viewer's own renderer (with progress), then show the first model. */
async function start() {
  const percent = document.getElementById('loadingPercent') as any;
  try {
    await preloadTextures({ renderer, onProgress: (p) => { percent.textContent = `${Math.round(p * 100)}%`; } });
  } finally {
    loading.remove();
  }
  show(true);
  let frames = 0, since = performance.now(), fps = 0;
  renderer.setAnimationLoop(() => {
    renderer.info.reset(); // count this frame's draw calls and triangles over all its render passes
    controls.update();
    if (colliderToggle.checked) {
      renderer.render(colliderScene, camera);
    } else {
      current?.update?.(camera); // models with levels of detail (Forest) choose what to draw
      updateImpostorPreview();
      outlines.render(scene, camera);
    }
    frames++;
    const now = performance.now();
    if (now - since >= 500) {
      fps = Math.round(frames * 1000 / (now - since));
      frames = 0;
      since = now;
      if (!colliderToggle.checked && current?.autoDetail) current.adaptDetail(fps);
      showStats(fps);
    }
  });
}
start();
