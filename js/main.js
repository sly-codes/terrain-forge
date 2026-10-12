import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRandom, hashSeed } from './noise.js';
import { createScatter } from './scatter.js';
import { buildTerrainGeometry, buildUndersideGeometry, generateHeightField } from './terrain.js';
import { BIOMES, DEFAULTS, FLOOR_Y, RANGES, WORLD_SIZE, cleanSeed, randomSeed, sanitizeConfig } from './world-config.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const canvas = $('scene');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let config = sanitizeConfig(DEFAULTS);
let field = null; // height field of the current world
let terrain = null;
let scatter = null;

// ---------------------------------------------------------------------------
// Renderer, scene and camera
// ---------------------------------------------------------------------------

let renderer;
try {
  // preserveDrawingBuffer keeps the last frame readable, which the screenshot needs.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
} catch {
  $('error').hidden = false;
  throw new Error('WebGL is not available.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 1, 1200);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 55;
controls.maxDistance = 340;
controls.maxPolarAngle = Math.PI * 0.49; // never below the horizon
controls.screenSpacePanning = false;
controls.autoRotate = !reducedMotion;
controls.autoRotateSpeed = 0.45;

// Panning stays close to the island so it can never be lost.
controls.addEventListener('change', () => {
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -35, 35);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -35, 35);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, -2, 24);
});
controls.addEventListener('start', () => {
  cameraMove = null;
  $('hint').classList.add('is-gone');
});

// Sky: a vertical gradient painted on a tiny canvas and used as the scene background.
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 4;
skyCanvas.height = 256;
const skyTexture = new THREE.CanvasTexture(skyCanvas);
skyTexture.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTexture;

const hemisphere = new THREE.HemisphereLight(0xffffff, 0x555555, 1.25);
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(70, 95, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -82;
sun.shadow.camera.right = sun.shadow.camera.top = 82;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.6;
const lavaLight = new THREE.PointLight(0xff6a1f, 0, 60, 1.6);
scene.add(hemisphere, sun, lavaLight);

// ---------------------------------------------------------------------------
// Permanent scene objects
// ---------------------------------------------------------------------------

// Terrain and scattered objects live in this group so they can rise together.
const world = new THREE.Group();
scene.add(world);

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.92,
  metalness: 0,
  side: THREE.DoubleSide,
});

const underside = new THREE.Mesh(
  buildUndersideGeometry(),
  new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, side: THREE.DoubleSide })
);
scene.add(underside);

// Water: a transparent block for the sides and a faceted, gently moving surface on top.
const waterMaterial = new THREE.MeshStandardMaterial({
  flatShading: true,
  transparent: true,
  opacity: 0.7,
  roughness: 0.25,
  metalness: 0.05,
  depthWrite: false,
});
const waterBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), waterMaterial);
waterBlock.renderOrder = 1;
const waterSurface = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE + 0.1, WORLD_SIZE + 0.1, 34, 34).rotateX(-Math.PI / 2).toNonIndexed(),
  waterMaterial
);
waterSurface.renderOrder = 2;
waterSurface.receiveShadow = true;
scene.add(waterBlock, waterSurface);

const grid = new THREE.GridHelper(WORLD_SIZE, 10, 0xb6ff3c, 0xffffff);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.material.depthWrite = false;
grid.renderOrder = 3;
grid.visible = false;
scene.add(grid);

// A few low-poly clouds drifting above the island.
const clouds = (() => {
  const random = createRandom(7);
  const puffs = [];
  for (let c = 0; c < 5; c++) {
    const center = { x: (random() - 0.5) * 220, y: 54 + random() * 14, z: (random() - 0.5) * 150 };
    for (let p = 0; p < 4; p++) {
      puffs.push({
        x: center.x + (random() - 0.5) * 9,
        y: center.y + (random() - 0.5) * 1.5,
        z: center.z + (random() - 0.5) * 5,
        scale: 1.8 + random() * 1.8,
      });
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, transparent: true, opacity: 0.92 }),
    puffs.length
  );
  scene.add(mesh);
  return { mesh, puffs, dummy: new THREE.Object3D() };
})();

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

let riseStart = 0;

function applyBiome(biome) {
  const ctx = skyCanvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
  gradient.addColorStop(0, biome.sky[0]);
  gradient.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
  skyTexture.needsUpdate = true;

  hemisphere.color.set(biome.sky[1]);
  hemisphere.groundColor.set(biome.ground);
  sun.color.set(biome.sun);
  waterMaterial.color.set(biome.water);
  underside.material.color.set(biome.underside);
}

function applyWater(waterY) {
  const height = waterY - FLOOR_Y;
  waterBlock.scale.set(WORLD_SIZE + 0.12, height - 0.08, WORLD_SIZE + 0.12);
  waterBlock.position.y = FLOOR_Y + (height - 0.08) / 2;
  waterSurface.position.y = waterY;
  grid.position.y = waterY + 0.25;
}

// Rebuilds the whole world from `config`. Old meshes are removed and released first.
function buildWorld({ animate = false } = {}) {
  config = sanitizeConfig(config);
  const biome = BIOMES[config.biome];
  const seed = hashSeed(config.seed);
  const started = performance.now();

  field = generateHeightField(config, seed);

  if (terrain) {
    world.remove(terrain);
    terrain.geometry.dispose();
  }
  terrain = new THREE.Mesh(buildTerrainGeometry(field, biome, config.biome), terrainMaterial);
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  world.add(terrain);

  if (scatter) {
    world.remove(scatter.group);
    scatter.dispose();
  }
  scatter = createScatter(field, config, biome, seed);
  world.add(scatter.group);

  applyBiome(biome);
  applyWater(field.waterY);

  if (field.crater) {
    lavaLight.position.set(field.crater.x, field.sample(field.crater.x, field.crater.z) + 5, field.crater.z);
    lavaLight.intensity = 60;
  } else {
    lavaLight.intensity = 0;
  }

  if (animate && !reducedMotion) riseStart = performance.now();
  updateReadouts(performance.now() - started);
}

// Slider moves can fire many times per frame: rebuild once per frame at most.
let buildQueued = false;
function queueBuild() {
  if (buildQueued) return;
  buildQueued = true;
  requestAnimationFrame(() => {
    buildQueued = false;
    buildWorld();
  });
}

// Used by the buttons: shows the "Forging" badge, then builds with the rise animation.
function forgeWorld() {
  $('badge').hidden = false;
  requestAnimationFrame(() =>
    setTimeout(() => {
      buildWorld({ animate: true });
      $('badge').hidden = true;
    }, 0)
  );
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const HOME_DIRECTION = new THREE.Vector3(1, 0.7, 0.95).normalize();
const HOME_TARGET = new THREE.Vector3(0, 0, 0);
let cameraMove = null;

// Further away on narrow screens so the whole island always fits.
function homePosition() {
  const distance = 190 * THREE.MathUtils.clamp(1.45 / camera.aspect, 1, 3.4);
  return HOME_DIRECTION.clone().multiplyScalar(distance).add(HOME_TARGET);
}

function resetCamera(instant = false) {
  if (instant || reducedMotion) {
    camera.position.copy(homePosition());
    controls.target.copy(HOME_TARGET);
    return;
  }
  cameraMove = {
    start: performance.now(),
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: homePosition(),
  };
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(340, homePosition().length() * 1.25);
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const easeOut = (k) => 1 - Math.pow(1 - k, 3);

function animateWater(time) {
  const position = waterSurface.geometry.attributes.position;
  const limit = WORLD_SIZE / 2 - 0.5;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    // The border stays flat so the surface keeps touching the sides of the block.
    const inside = Math.abs(x) < limit && Math.abs(z) < limit;
    position.setY(i, inside ? Math.sin(x * 0.32 + time * 1.3) * 0.11 + Math.cos(z * 0.27 + time) * 0.11 : 0);
  }
  position.needsUpdate = true;
}

function animateClouds(time) {
  const { mesh, puffs, dummy } = clouds;
  puffs.forEach((puff, i) => {
    const x = ((puff.x + time * 1.6 + 130) % 260) - 130;
    dummy.position.set(x, puff.y, puff.z);
    dummy.scale.set(puff.scale * 1.5, puff.scale * 0.55, puff.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function frame(now) {
  requestAnimationFrame(frame);
  const time = now / 1000;

  // New worlds grow out of the diorama floor.
  const rise = riseStart ? Math.min(1, (now - riseStart) / 750) : 1;
  const scale = riseStart ? 0.02 + 0.98 * easeOut(rise) : 1;
  world.scale.y = scale;
  world.position.y = FLOOR_Y * (1 - scale);
  if (rise >= 1) riseStart = 0;

  if (cameraMove) {
    const k = Math.min(1, (now - cameraMove.start) / 700);
    camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.toPosition, easeOut(k));
    controls.target.lerpVectors(cameraMove.fromTarget, HOME_TARGET, easeOut(k));
    if (k >= 1) cameraMove = null;
  }

  if (!reducedMotion) {
    animateWater(time);
    animateClouds(time);
  }
  lavaLight.intensity = field?.crater ? 60 + Math.sin(time * 3) * 14 : 0;

  controls.update();
  updateCoordinates();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Coordinates under the pointer
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = { ndc: new THREE.Vector2(), inside: false, moved: false };

// Walks along the view ray until it goes under the terrain or the water.
function pickGround() {
  raycaster.setFromCamera(pointer.ndc, camera);
  const { origin, direction } = raycaster.ray;
  const half = WORLD_SIZE / 2;
  const point = new THREE.Vector3();
  const surface = (p) => Math.max(field.sample(p.x, p.z), field.waterY);

  for (let t = 20; t < 700; t += 1.5) {
    point.copy(direction).multiplyScalar(t).add(origin);
    if (Math.abs(point.x) > half || Math.abs(point.z) > half || point.y > surface(point)) continue;
    let near = t - 1.5;
    let far = t;
    for (let i = 0; i < 6; i++) {
      const middle = (near + far) / 2;
      point.copy(direction).multiplyScalar(middle).add(origin);
      if (point.y > surface(point)) near = middle;
      else far = middle;
    }
    return point;
  }
  return null;
}

function updateCoordinates() {
  const coords = $('coords');
  if (!grid.visible || !pointer.inside) return coords.classList.remove('is-on');
  if (!pointer.moved) return;
  pointer.moved = false;

  const point = pickGround();
  coords.classList.toggle('is-on', Boolean(point));
  if (!point) return;
  const altitude = field.sample(point.x, point.z) - field.waterY;
  const label = altitude >= 0 ? `ALT ${altitude.toFixed(1)}` : `DEPTH ${(-altitude).toFixed(1)}`;
  coords.textContent = `X ${point.x.toFixed(1)}  Z ${point.z.toFixed(1)}  ${label}`;
}

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  pointer.inside = true;
  pointer.moved = true;
});
canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
});

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

function formatValue(key, value) {
  return RANGES[key].unit === 'grid' ? `${value} × ${value}` : `${value}%`;
}

// Writes `config` back into every control.
function syncControls() {
  for (const [key, range] of Object.entries(RANGES)) {
    const input = $(key);
    input.min = range.min;
    input.max = range.max;
    input.step = range.step;
    input.value = config[key];
    input.style.setProperty('--fill', `${((config[key] - range.min) / (range.max - range.min)) * 100}%`);
    $(`${key}-out`).textContent = formatValue(key, config[key]);
  }
  document.querySelectorAll('[data-biome]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.biome === config.biome));
  });
  $('seed').value = config.seed;
  $('seed-label').textContent = config.seed;
}

function updateReadouts(milliseconds) {
  const triangles = terrain.geometry.attributes.position.count / 3;
  const peak = Math.max(0, field.maxHeight - field.waterY);
  $('stats').innerHTML =
    `<b>${BIOMES[config.biome].label}</b> · ${triangles.toLocaleString('en-US')} tris · ` +
    `${scatter.treeCount} trees · ${scatter.rockCount} rocks · peak ${peak.toFixed(1)} · ${milliseconds.toFixed(0)} ms`;
  $('seed-label').textContent = config.seed;
}

let toastTimer = 0;
function showToast(message, isError = false) {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

async function copySeed() {
  const label = $('seed-copy');
  try {
    await navigator.clipboard.writeText(config.seed);
    label.textContent = 'Copied';
  } catch {
    // Clipboard access can be refused: select the seed so it can be copied by hand.
    $('seed').select();
    label.textContent = 'Selected';
  }
  setTimeout(() => {
    label.textContent = 'Copy';
  }, 1600);
}

// Saves the current frame of the WebGL canvas, without any of the interface.
function saveScreenshot() {
  try {
    renderer.render(scene, camera);
    canvas.toBlob((blob) => {
      if (!blob) return showToast('The screenshot could not be created.', true);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `terrain-forge-${config.seed.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast(`Saved ${link.download}`);
    }, 'image/png');
    const flash = $('flash');
    flash.classList.remove('is-on');
    void flash.offsetWidth; // restarts the CSS animation
    flash.classList.add('is-on');
  } catch {
    showToast('The screenshot could not be created.', true);
  }
}

const actions = {
  generate() {
    config.seed = cleanSeed($('seed').value) || randomSeed();
    syncControls();
    forgeWorld();
  },
  randomize() {
    config.seed = randomSeed();
    syncControls();
    forgeWorld();
  },
  resetCamera: () => resetCamera(),
  screenshot: saveScreenshot,
};

function bindInterface() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', actions[button.dataset.action]);
  });

  for (const key of Object.keys(RANGES)) {
    $(key).addEventListener('input', (event) => {
      config[key] = Number(event.target.value);
      config = sanitizeConfig(config);
      syncControls();
      queueBuild();
    });
  }

  document.querySelectorAll('[data-biome]').forEach((button) => {
    button.addEventListener('click', () => {
      if (config.biome === button.dataset.biome) return;
      config.biome = button.dataset.biome;
      syncControls();
      forgeWorld();
    });
  });

  $('seed').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') actions.generate();
  });
  $('seed-chip').addEventListener('click', copySeed);

  $('autoRotate').checked = controls.autoRotate;
  $('autoRotate').addEventListener('change', (event) => {
    controls.autoRotate = event.target.checked;
  });
  $('grid').addEventListener('change', (event) => {
    grid.visible = event.target.checked;
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

new ResizeObserver(resize).observe(viewport);
resize();
resetCamera(true);
bindInterface();
syncControls();
buildWorld({ animate: true });
requestAnimationFrame(frame);
viewport.classList.add('is-ready');
