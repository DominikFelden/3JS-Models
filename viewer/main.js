import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Box3, Vector3,
  AmbientLight, DirectionalLight, GridHelper,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { models } from '../src/registry.js';

const scene = new Scene();
scene.background = new Color(0xdddddd);
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 7);
scene.add(sun, new GridHelper(10, 10));

const controls = new OrbitControls(camera, renderer.domElement);
let current = null;

const select = document.getElementById('select');
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
  camera.position.copy(center).add(new Vector3(1, 0.6, 1).normalize().multiplyScalar(size * 1.5));
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

models.forEach((m, i) => select.add(new Option(m.name, i)));
select.addEventListener('change', () => { configureSlider(); show(true); });
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
