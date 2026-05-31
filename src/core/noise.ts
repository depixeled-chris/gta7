import { createNoise2D } from 'simplex-noise';
import { createRng } from './rng';

/**
 * Pure, deterministic noise field helpers for procedural world generation.
 * Three-free and node-testable. Everything here is a pure function of a numeric
 * seed (plus world coordinates), so the same seed always yields the same world —
 * the invariant the streamed-world design rests on (see
 * docs/research/generative-world.md).
 *
 * `simplex-noise` builds its permutation table from a `() => [0,1)` source; we
 * feed it our own `mulberry32` (rng.ts) so there's one PRNG in the codebase and
 * no extra determinism surface. Each field MUST get its own seed — a noise
 * function consumes ~256 draws building its table, so sharing one stream across
 * fields would couple them.
 */
export type Noise2D = (x: number, y: number) => number; // output in [-1, 1]

/** A simplex field seeded deterministically from `seed`. */
export function makeNoise2D(seed: number): Noise2D {
  const rng = createRng(seed);
  return createNoise2D(() => rng.next());
}

export interface FbmOptions {
  octaves?: number; // how many layers of detail (4–6 terrain, 2–3 density)
  lacunarity?: number; // frequency multiplier per octave
  gain?: number; // amplitude multiplier per octave (persistence)
  frequency?: number; // base frequency
}

/**
 * Fractal Brownian motion: sum octaves of a noise field, normalized to [-1, 1].
 * Each octave is offset so the layers don't visibly align. Pure.
 */
export function fbm(noise: Noise2D, x: number, y: number, opts: FbmOptions = {}): number {
  const { octaves = 5, lacunarity = 2, gain = 0.5, frequency = 1 } = opts;
  let freq = frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    // Per-octave coordinate offset decorrelates the layers (avoids grid artifacts).
    const ox = o * 5.31;
    const oy = o * 9.17;
    sum += amp * noise(x * freq + ox, y * freq + oy);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/**
 * Ridged fractal noise (for mountainous terrain): folds each octave to a ridge
 * and weights higher octaves by the running value so detail accrues on ridges.
 * Output in [0, 1]. Pure.
 */
export function ridged(noise: Noise2D, x: number, y: number, opts: FbmOptions = {}): number {
  const { octaves = 5, lacunarity = 2, gain = 0.5, frequency = 1 } = opts;
  let freq = frequency;
  let amp = 0.5;
  let sum = 0;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * freq + o * 5.31, y * freq + o * 9.17));
    n *= n;
    n *= prev; // sharpen ridges where the previous octave was high
    prev = n;
    sum += n * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return Math.min(1, Math.max(0, sum));
}

/**
 * Domain warping (Inigo Quilez): displace the sample point by another fbm
 * lookup before sampling, turning blobby noise into organic, flowing shapes —
 * the highest-leverage trick for natural-looking roads, coastlines and biome
 * edges. `amp` is the warp distance in noise space. Pure.
 */
export function domainWarp(
  field: Noise2D,
  warp: Noise2D,
  x: number,
  y: number,
  amp = 4,
  opts: FbmOptions = {},
): number {
  const qx = fbm(warp, x, y, opts);
  const qy = fbm(warp, x + 5.2, y + 1.3, opts);
  return fbm(field, x + amp * qx, y + amp * qy, opts);
}
