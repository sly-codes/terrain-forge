import * as THREE from 'three';
import { createNoise2D, createRandom } from './noise.js';
import { FLOOR_Y, WORLD_SIZE, waterHeight } from './world-config.js';

const HALF = WORLD_SIZE / 2;
const SEABED_MIN = FLOOR_Y + 2.5;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const smoothstep = (edge0, edge1, x) => {
  const k = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------

// Builds the grid of heights for one world. Everything random comes from `seed`.
export function generateHeightField(config, seed) {
  const random = createRandom(seed);
  const noise = createNoise2D(random);

  const segments = config.detail;
  const count = segments + 1;
  const step = WORLD_SIZE / segments;
  const heights = new Float32Array(count * count);
  const lava = config.biome === 'volcanic' ? new Float32Array(count * count) : null;

  const roughness = config.roughness / 100;
  const persistence = 0.36 + roughness * 0.3;
  const peakHeight = 8 + config.mountainHeight * 0.26;
  const islandScale = config.islandSize / 100;
  const volcano = { x: (random() - 0.5) * 0.3 * islandScale, z: (random() - 0.5) * 0.3 * islandScale };

  // Several noise scales added together: broad shapes first, then finer detail.
  const fbm = (x, z) => {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let total = 0;
    for (let octave = 0; octave < 5; octave++) {
      sum += amplitude * noise(x * frequency, z * frequency);
      total += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return sum / total;
  };

  // Folding the noise around zero gives sharp crests, used for mountain ridges.
  const ridged = (x, z) => {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let total = 0;
    for (let octave = 0; octave < 3; octave++) {
      sum += amplitude * (1 - Math.abs(noise(x * frequency, z * frequency)));
      total += amplitude;
      amplitude *= 0.45;
      frequency *= 2;
    }
    return sum / total;
  };

  // nx and nz go from -1 to 1 across the diorama. Returns [height, lava amount].
  const elevation = (nx, nz) => {
    // Warping the coordinates bends the coastline so it is never a clean circle.
    const wx = nx + 0.18 * noise(nx * 1.3 + 11, nz * 1.3 + 7);
    const wz = nz + 0.18 * noise(nx * 1.3 - 5, nz * 1.3 + 19);
    const coast = 1 + 0.28 * noise(wx * 1.7 + 31, wz * 1.7 - 13);
    const distance = Math.hypot(wx, wz) / (islandScale * 1.3 * coast);

    // Island falloff, plus a guaranteed band of water along the diorama edges.
    const edge = smoothstep(1, 0.8, Math.max(Math.abs(nx), Math.abs(nz)));
    const mask = (1 - smoothstep(0.42, 1.05, distance)) * edge;

    const hills = fbm(wx * 1.25, wz * 1.25) * 0.5 + 0.5;
    const ridge = ridged(wx * 1.5 + 40, wz * 1.5 + 40);
    let shape = hills * 0.5 + ridge * ridge * (0.15 + roughness * 0.6);
    let lavaAmount = 0;

    if (config.biome === 'snowy') {
      shape = hills * 0.4 + Math.pow(ridge, 1.5) * (0.35 + roughness * 0.55);
    } else if (config.biome === 'volcanic') {
      // One dominant cone with a crater dug into its top.
      const cone = Math.max(0, 1 - Math.hypot(wx - volcano.x, wz - volcano.z) / (0.62 * islandScale));
      const rim = 0.8;
      const profile = cone < rim ? Math.pow(cone, 1.3) : Math.pow(rim, 1.3) - (cone - rim) * 1.7;
      shape = shape * 0.5 + profile * 0.95;
      lavaAmount = smoothstep(rim + 0.02, rim + 0.12, cone);
    }

    // Mountains gather toward the middle, which leaves room for lowlands and beaches.
    const land = shape * Math.pow(mask, 1.3) + mask * 0.3 - 0.18;
    const y = land > 0 ? land * land * peakHeight * 1.3 : land * 34;
    return [Math.max(SEABED_MIN, y), lavaAmount];
  };

  let maxHeight = -Infinity;
  let peak = { x: 0, z: 0 };
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const [y, lavaAmount] = elevation((i / segments) * 2 - 1, (j / segments) * 2 - 1);
      const index = j * count + i;
      heights[index] = y;
      if (lava) lava[index] = lavaAmount;
      if (y > maxHeight) {
        maxHeight = y;
        peak = { x: -HALF + i * step, z: -HALF + j * step };
      }
    }
  }

  // Height of the mesh surface at any point, following the same triangles as the mesh.
  const sample = (x, z) => {
    const gx = clamp((x + HALF) / step, 0, segments - 0.0001);
    const gz = clamp((z + HALF) / step, 0, segments - 0.0001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = heights[j * count + i];
    const b = heights[j * count + i + 1];
    const c = heights[(j + 1) * count + i];
    const d = heights[(j + 1) * count + i + 1];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };

  // 0 on flat ground, close to 1 on a cliff.
  const slope = (x, z) => {
    const dx = sample(x + step, z) - sample(x - step, z);
    const dz = sample(x, z + step) - sample(x, z - step);
    return 1 - (2 * step) / Math.hypot(dx, 2 * step, dz);
  };

  const waterY = waterHeight(config);
  return {
    segments,
    count,
    step,
    heights,
    lava,
    noise,
    waterY,
    maxHeight,
    peak,
    crater: lava ? { x: volcano.x * HALF, z: volcano.z * HALF } : null,
    sample,
    slope,
    // 0 at the waterline, 1 at the highest point of this world
    relative: (y) => clamp((y - waterY) / Math.max(1, maxHeight - waterY), 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const colorCache = new Map();
const hex = (value) => {
  if (!colorCache.has(value)) colorCache.set(value, new THREE.Color(value));
  return colorCache.get(value);
};
const blend = (out, from, to, k) => out.copy(hex(from)).lerp(hex(to), clamp(k, 0, 1));

// Each function picks the color of one triangle.
// f: { t: relative height 0..1, alt: height above water, slope, v and w: slow noise in -1..1, lava }
const PAINTERS = {
  tropical(out, p, f) {
    if (f.alt < 0) return blend(out, p.seabed, p.deep, -f.alt / 5);
    if (f.alt < 0.9 + f.v * 0.5) return out.copy(hex(p.sand));
    if (f.slope > 0.45) return blend(out, p.rock, p.peak, f.t);
    if (f.t < 0.28) return blend(out, p.grassLight, p.grass, f.t / 0.28 + f.v * 0.35);
    if (f.t < 0.62) return blend(out, p.grass, p.forest, (f.t - 0.28) / 0.3 + f.v * 0.3);
    return blend(out, p.rock, p.peak, (f.t - 0.62) / 0.3);
  },
  volcanic(out, p, f) {
    if (f.alt < 0) return blend(out, p.seabed, p.deep, -f.alt / 5);
    if (f.lava > 0) return blend(out, p.lavaDark, p.lava, f.lava + f.v * 0.25);
    if (f.alt < 0.8) return out.copy(hex(p.sand));
    // Thin glowing veins running down the slopes.
    if (Math.abs(f.w) < 0.045 && f.t > 0.22) return blend(out, p.lavaDark, p.ember, f.t * 1.4);
    if (f.slope > 0.55) return out.copy(hex(p.basalt));
    if (f.t < 0.28) return blend(out, p.moss, p.basalt, f.t / 0.28 + f.v * 0.4);
    if (f.t < 0.72) return blend(out, p.basalt, p.rust, (f.v * 0.5 + 0.5) * 0.75);
    return blend(out, p.basalt, p.ash, (f.t - 0.72) / 0.2);
  },
  snowy(out, p, f) {
    if (f.alt < 0) return blend(out, p.seabed, p.deep, -f.alt / 5);
    if (f.alt < 0.8) return out.copy(hex(p.sand));
    const snowLine = 0.38 + f.v * 0.08;
    if (f.t > snowLine && f.slope < 0.62) return blend(out, p.snowShade, p.snow, 0.5 + f.w * 0.5 + f.t * 0.4);
    if (f.slope > 0.5) return out.copy(hex(p.rock));
    if (f.v > 0.45) return out.copy(hex(p.frost));
    return blend(out, p.tundra, p.rock, f.t / snowLine - 0.2);
  },
};

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

// Low-poly terrain: every triangle has its own three vertices and a single color,
// which keeps the facets clearly visible. The side walls of the diorama are included.
export function buildTerrainGeometry(field, biome, biomeId) {
  const { segments, count, step, heights, lava, noise } = field;
  const triangles = segments * segments * 2 + segments * 8;
  const positions = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  const paint = PAINTERS[biomeId];
  const color = new THREE.Color();
  const face = { t: 0, alt: 0, slope: 0, v: 0, w: 0, lava: 0 };
  let cursor = 0;

  const vertex = (x, y, z, c) => {
    positions[cursor] = x;
    positions[cursor + 1] = y;
    positions[cursor + 2] = z;
    colors[cursor] = c.r;
    colors[cursor + 1] = c.g;
    colors[cursor + 2] = c.b;
    cursor += 3;
  };

  const triangle = (ax, ay, az, bx, by, bz, cx, cy, cz, lavaAmount) => {
    // Face normal from the cross product of two edges; its y part tells how steep the face is.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;

    face.alt = my - field.waterY;
    face.t = field.relative(my);
    face.slope = 1 - Math.abs(ny) / Math.hypot(nx, ny, nz);
    face.v = noise(mx * 0.07 + 90, mz * 0.07 + 90);
    face.w = noise(mx * 0.19 - 50, mz * 0.19 + 50);
    face.lava = lavaAmount;
    paint(color, biome.terrain, face);
    // Slight brightness change per face so neighbours never merge into one flat area.
    color.multiplyScalar(0.94 + 0.12 * (noise(mx * 3.1, mz * 3.1) * 0.5 + 0.5));

    vertex(ax, ay, az, color);
    vertex(bx, by, bz, color);
    vertex(cx, cy, cz, color);
  };

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const x0 = -HALF + i * step;
      const z0 = -HALF + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      const ia = j * count + i;
      const a = heights[ia];
      const b = heights[ia + 1];
      const c = heights[ia + count];
      const d = heights[ia + count + 1];
      const lavaAmount = lava ? (lava[ia] + lava[ia + 1] + lava[ia + count] + lava[ia + count + 1]) / 4 : 0;
      triangle(x0, a, z0, x0, c, z1, x1, b, z0, lavaAmount);
      triangle(x1, b, z0, x0, c, z1, x1, d, z1, lavaAmount);
    }
  }

  // Walls: from each border edge straight down to the floor, lighter soil on top.
  const top = hex(biome.wall[0]);
  const bottom = hex(biome.wall[1]);
  const wall = (x0, z0, y0, x1, z1, y1) => {
    vertex(x0, y0, z0, top);
    vertex(x1, y1, z1, top);
    vertex(x0, FLOOR_Y, z0, bottom);
    vertex(x1, y1, z1, top);
    vertex(x1, FLOOR_Y, z1, bottom);
    vertex(x0, FLOOR_Y, z0, bottom);
  };
  const last = segments * count;
  for (let i = 0; i < segments; i++) {
    const p0 = -HALF + i * step;
    const p1 = p0 + step;
    wall(p0, -HALF, heights[i], p1, -HALF, heights[i + 1]);
    wall(p0, HALF, heights[last + i], p1, HALF, heights[last + i + 1]);
    wall(-HALF, p0, heights[i * count], -HALF, p1, heights[(i + 1) * count]);
    wall(HALF, p0, heights[i * count + segments], HALF, p1, heights[(i + 1) * count + segments]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// The rough rock hanging under the diorama, which makes it read as a floating island.
export function buildUndersideGeometry() {
  const depth = 34;
  const geometry = new THREE.ConeGeometry(HALF * Math.SQRT2, depth, 4, 4, true);
  geometry.rotateY(Math.PI / 4);
  geometry.rotateX(Math.PI);
  geometry.translate(0, FLOOR_Y - depth / 2, 0);

  // Push every vertex below the top ring sideways. The offset only depends on the
  // position, so vertices that share a place stay together and the mesh stays closed.
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (y > FLOOR_Y - 0.01) continue;
    position.setX(i, x + Math.sin(x * 0.31 + y * 1.7) * 5);
    position.setZ(i, z + Math.cos(z * 0.27 - y * 1.3) * 5);
    position.setY(i, y + Math.sin(x * 0.2 + z * 0.2) * 2.5);
  }
  geometry.computeVertexNormals();
  return geometry;
}
