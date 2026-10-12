// Shared constants, default settings and biome definitions.

export const WORLD_SIZE = 100; // width and depth of the diorama, in world units
export const FLOOR_Y = -10; // bottom of the diorama block

export const DEFAULTS = Object.freeze({
  seed: 'MOSSY-HARBOR-42',
  biome: 'tropical',
  mountainHeight: 60,
  roughness: 50,
  islandSize: 72,
  detail: 96,
  treeDensity: 60,
  rockDensity: 40,
  waterLevel: 30,
});

// min, max, step and display unit of every slider
export const RANGES = Object.freeze({
  mountainHeight: { min: 10, max: 100, step: 1, unit: '%' },
  roughness: { min: 0, max: 100, step: 1, unit: '%' },
  islandSize: { min: 40, max: 100, step: 1, unit: '%' },
  detail: { min: 32, max: 160, step: 8, unit: 'grid' },
  treeDensity: { min: 0, max: 100, step: 1, unit: '%' },
  rockDensity: { min: 0, max: 100, step: 1, unit: '%' },
  waterLevel: { min: 0, max: 100, step: 1, unit: '%' },
});

export const BIOMES = Object.freeze({
  tropical: {
    label: 'Tropical',
    sky: ['#3f8fd6', '#bfe9f2'],
    sun: '#fff1d6',
    ground: '#6f8f5a',
    water: '#27b6c9',
    wall: ['#8a6a48', '#4c3a2c'],
    underside: '#5b4636',
    terrain: {
      seabed: '#c9b27a',
      deep: '#3f7f86',
      sand: '#f0dc9c',
      grassLight: '#9bd45a',
      grass: '#55b848',
      forest: '#2f8f4a',
      rock: '#8d8f86',
      peak: '#c9cabf',
    },
    trees: {
      kind: 'broadleaf',
      amount: 1,
      line: 0.62,
      trunk: '#7a5236',
      foliage: ['#2fa152', '#4cc45a', '#8fd94a', '#1f8a5b'],
    },
    rocks: { amount: 0.7, colors: ['#9a9c93', '#7f8279', '#b5b6ab'] },
  },
  volcanic: {
    label: 'Volcanic',
    sky: ['#2a1f2e', '#c7624a'],
    sun: '#ffc9a3',
    ground: '#4a2f2a',
    water: '#2c6f8f',
    wall: ['#3a2f2f', '#1c1718'],
    underside: '#241d1f',
    terrain: {
      seabed: '#2b2a30',
      deep: '#1d2a36',
      sand: '#3a363b',
      moss: '#4b5236',
      basalt: '#35313a',
      rust: '#7a3b2c',
      ash: '#8b8588',
      ember: '#ff6a1f',
      lavaDark: '#b3260f',
      lava: '#ffb02e',
    },
    trees: {
      kind: 'conifer',
      amount: 0.16,
      line: 0.4,
      trunk: '#2f2622',
      foliage: ['#4a4f2e', '#5b4a2a', '#7a3a22'],
    },
    rocks: { amount: 1.6, colors: ['#2e2a31', '#463f47', '#5c3a32'] },
  },
  snowy: {
    label: 'Snowy',
    sky: ['#6f93c4', '#e6f0f7'],
    sun: '#f4f8ff',
    ground: '#7f95a8',
    water: '#3f8fc4',
    wall: ['#6c7480', '#3c424c'],
    underside: '#4a5059',
    terrain: {
      seabed: '#7f8c96',
      deep: '#35607f',
      sand: '#a9adb0',
      tundra: '#6f9a7c',
      frost: '#b9d3d6',
      rock: '#757c88',
      snowShade: '#cfe0ee',
      snow: '#ffffff',
    },
    trees: {
      kind: 'conifer',
      amount: 0.5,
      line: 0.46,
      trunk: '#5a4334',
      foliage: ['#2f6658', '#3c7a63', '#27564f', '#d9ecf2'],
    },
    rocks: { amount: 0.9, colors: ['#7d8591', '#646b76', '#dbe6ee'] },
  },
});

const ADJECTIVES = [
  'MOSSY', 'EMBER', 'FROSTY', 'HIDDEN', 'GOLDEN', 'SILENT', 'WILD', 'MISTY', 'AMBER', 'LUNAR',
  'CORAL', 'JADE', 'STORMY', 'SUNNY', 'ANCIENT', 'DRIFTING', 'CRIMSON', 'VELVET', 'HOLLOW', 'BRAVE',
];
const NOUNS = [
  'HARBOR', 'ATOLL', 'FJORD', 'SUMMIT', 'LAGOON', 'CRATER', 'REEF', 'HAVEN', 'RIDGE', 'COVE',
  'PEAK', 'ISLE', 'SHOAL', 'GROVE', 'BLUFF', 'CALDERA', 'TUNDRA', 'DELTA', 'CAPE', 'MESA',
];

export function randomSeed() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
}

export const cleanSeed = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .slice(0, 32);

// Returns a config where every value is valid, whatever was passed in.
export function sanitizeConfig(raw) {
  const config = { ...DEFAULTS, ...raw };
  for (const [key, range] of Object.entries(RANGES)) {
    const value = Number(config[key]);
    const safe = Number.isFinite(value) ? value : DEFAULTS[key];
    const stepped = Math.round(safe / range.step) * range.step;
    config[key] = Math.min(range.max, Math.max(range.min, stepped));
  }
  if (!BIOMES[config.biome]) config.biome = DEFAULTS.biome;
  config.seed = cleanSeed(config.seed) || randomSeed();
  return config;
}

export const waterHeight = (config) => (config.waterLevel - 30) * 0.12;
