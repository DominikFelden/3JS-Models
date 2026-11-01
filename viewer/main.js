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
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);

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

/** (Re)build the selected model. `reframe` moves the camera to fit the new model. */
function show(reframe) {
  const entry = models[Number(select.value)];
  if (current) {
    scene.remove(current);
    current.dispose?.(); // free this model's own geometries (shared ones stay)
  }
  // No seed given -> every build is a new random variation.
  current = entry.create({ complexity: Number(slider.value) });
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
select.addEventListener('change', () => { configureSlider(); show(true); });
search.addEventListener('input', () => {
  if (fillSelect()) { configureSlider(); show(true); }
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && select.options.length) { select.selectedIndex = 0; select.dispatchEvent(new Event('change')); }
});
// Rebuild live while dragging; keep the camera where the user put it.
slider.addEventListener('input', () => { sliderValue.textContent = slider.value; show(false); });
rerollButton.addEventListener('click', () => show(false));
configureSlider();
show(true);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
