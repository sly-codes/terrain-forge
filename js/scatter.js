import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, createRandom } from './noise.js';
import { WORLD_SIZE } from './world-config.js';

const SPREAD = WORLD_SIZE / 2 - 2.5;
const MAX_TREES = 950;
const MAX_ROCKS = 420;

// ---------------------------------------------------------------------------
// Shared geometries and materials: built once, reused for every world.
// A tree is one trunk and one foliage shape that share the same placement.
// ---------------------------------------------------------------------------

const trunkGeometry = new THREE.CylinderGeometry(0.11, 0.2, 1.1, 5).translate(0, 0.55, 0);

const foliageGeometries = {
  broadleaf: mergeGeometries([
    new THREE.IcosahedronGeometry(1, 0).scale(1, 0.85, 1).translate(0, 1.7, 0),
    new THREE.IcosahedronGeometry(0.62, 0).translate(0.55, 1.25, 0.2),
  ]),
  conifer: mergeGeometries([
    new THREE.ConeGeometry(0.95, 1.3, 6).translate(0, 1.2, 0),
    new THREE.ConeGeometry(0.72, 1.1, 6).translate(0, 1.95, 0),
    new THREE.ConeGeometry(0.46, 1.0, 6).translate(0, 2.65, 0),
  ]),
};

const rockGeometry = (() => {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    // The offset depends on the position, so shared corners move together.
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const k = 1 + 0.28 * Math.sin(x * 7.3 + y * 3.1 + z * 5.7);
    position.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
})();

const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0 });

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

// Remembers what was placed, in grid cells, to keep a minimum distance between objects.
function createSpacing(cellSize) {
  const cells = new Map();
  const key = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  return {
    isFree(x, z, distance) {
      const cx = Math.floor(x / cellSize);
      const cz = Math.floor(z / cellSize);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cz - 1; j <= cz + 1; j++) {
          for (const [px, pz] of cells.get(`${i},${j}`) || []) {
            if (Math.hypot(px - x, pz - z) < distance) return false;
          }
        }
      }
      return true;
    },
    add(x, z) {
      const k = key(x, z);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push([x, z]);
    },
  };
}

function instanced(geometry, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Scatters trees and rocks on the terrain. The result only depends on its arguments.
export function createScatter(field, config, biome, seed) {
  const random = createRandom(seed ^ 0x5bd1e995);
  const groves = createNoise2D(createRandom(seed ^ 0x27d4eb2f));
  const spacing = createSpacing(2.4);
  const palette = (list) => new THREE.Color(list[Math.floor(random() * list.length)]);
  const place = () => (random() * 2 - 1) * SPREAD;

  // Trees: on dry, gentle ground below the tree line, gathered in groves.
  const trees = [];
  const treeTarget = Math.round((config.treeDensity / 100) * biome.trees.amount * MAX_TREES);
  const coverage = 0.3 + (config.treeDensity / 100) * 0.6;
  for (let attempt = 0; attempt < treeTarget * 8 && trees.length < treeTarget; attempt++) {
    const x = place();
    const z = place();
    const y = field.sample(x, z);
    if (y < field.waterY + 0.7 || field.relative(y) > biome.trees.line) continue;
    if (field.slope(x, z) > 0.34) continue;
    if (groves(x * 0.045, z * 0.045) * 0.5 + 0.5 > coverage) continue;
    if (!spacing.isFree(x, z, 1.7)) continue;
    spacing.add(x, z);
    trees.push({ x, y, z, scale: 0.95 + random() * 1.05, turn: random() * Math.PI * 2, lean: (random() - 0.5) * 0.14 });
  }

  // Rocks: almost anywhere, including the shallows, but not on cliffs.
  const rocks = [];
  const rockTarget = Math.round((config.rockDensity / 100) * biome.rocks.amount * 260);
  for (let attempt = 0; attempt < rockTarget * 6 && rocks.length < Math.min(rockTarget, MAX_ROCKS); attempt++) {
    const x = place();
    const z = place();
    const y = field.sample(x, z);
    if (y < field.waterY - 1.2 || field.slope(x, z) > 0.6) continue;
    if (!spacing.isFree(x, z, 1.5)) continue;
    spacing.add(x, z);
    const big = random() < 0.12;
    rocks.push({ x, y, z, scale: big ? 1.3 + random() * 1.2 : 0.35 + random() * 0.7 });
  }

  const group = new THREE.Group();
  const trunkMesh = instanced(trunkGeometry, trees.length);
  const foliageMesh = instanced(foliageGeometries[biome.trees.kind], trees.length);
  const rockMesh = instanced(rockGeometry, rocks.length);
  const dummy = new THREE.Object3D();
  const trunkColor = new THREE.Color(biome.trees.trunk);

  trees.forEach((tree, i) => {
    dummy.position.set(tree.x, tree.y - 0.1, tree.z);
    dummy.rotation.set(tree.lean, tree.turn, tree.lean * 0.6);
    dummy.scale.setScalar(tree.scale);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    foliageMesh.setMatrixAt(i, dummy.matrix);
    trunkMesh.setColorAt(i, trunkColor);
    foliageMesh.setColorAt(i, palette(biome.trees.foliage).multiplyScalar(0.9 + random() * 0.2));
  });

  rocks.forEach((rock, i) => {
    dummy.position.set(rock.x, rock.y - rock.scale * 0.2, rock.z);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.scale.set(rock.scale * (0.8 + random() * 0.5), rock.scale * (0.6 + random() * 0.5), rock.scale);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    rockMesh.setColorAt(i, palette(biome.rocks.colors).multiplyScalar(0.9 + random() * 0.2));
  });

  for (const mesh of [trunkMesh, foliageMesh, rockMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return {
    group,
    treeCount: trees.length,
    rockCount: rocks.length,
    // Geometries and the material are shared, so only the per-world instance data is released.
    dispose() {
      for (const mesh of [trunkMesh, foliageMesh, rockMesh]) mesh.dispose();
    },
  };
}
