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

function show(index) {
  if (current) scene.remove(current);
  current = models[index].create();
  scene.add(current);
  const box = new Box3().setFromObject(current);
  const size = box.getSize(new Vector3()).length();
  const center = box.getCenter(new Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new Vector3(1, 0.6, 1).normalize().multiplyScalar(size * 1.5));
  controls.update();
}

const select = document.getElementById('select');
models.forEach((m, i) => select.add(new Option(m.name, i)));
select.addEventListener('change', () => show(Number(select.value)));
show(0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
