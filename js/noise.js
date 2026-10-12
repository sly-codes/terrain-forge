// Deterministic randomness: a text seed becomes a number, which drives a
// random generator and a 2D simplex noise. Same seed, same world.

// Text to 32-bit integer (xmur3 hash).
export function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// Seeded random generator (mulberry32), returns numbers in [0, 1).
export function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRADIENTS = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1];

// 2D simplex noise, returns values in [-1, 1].
export function createNoise2D(random) {
  const table = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [table[i], table[j]] = [table[j], table[i]];
  }
  const perm = new Uint8Array(512).map((_, i) => table[i & 255]);

  const corner = (ix, iy, x, y) => {
    const t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const g = (perm[ix + perm[iy]] & 7) * 2;
    return t * t * t * t * (GRADIENTS[g] * x + GRADIENTS[g + 1] * y);
  };

  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const ii = i & 255;
    const jj = j & 255;

    return (
      70 *
      (corner(ii, jj, x0, y0) +
        corner(ii + i1, jj + j1, x0 - i1 + G2, y0 - j1 + G2) +
        corner(ii + 1, jj + 1, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2))
    );
  };
}
