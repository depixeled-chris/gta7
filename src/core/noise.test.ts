import { describe, it, expect } from 'vitest';
import { makeNoise2D, fbm, ridged, domainWarp } from './noise';
import { hashSeed } from './rng';

describe('makeNoise2D', () => {
  it('is deterministic — same seed yields the same field', () => {
    const a = makeNoise2D(1234);
    const b = makeNoise2D(1234);
    for (const [x, y] of [[0, 0], [1.5, -2.3], [100, 50], [-7, 9]]) {
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  it('different seeds yield different fields', () => {
    const a = makeNoise2D(1);
    const b = makeNoise2D(2);
    // Vanishingly unlikely to match across several samples if seeds differ.
    const same = [[0, 0], [3, 4], [10, 10]].every(([x, y]) => a(x, y) === b(x, y));
    expect(same).toBe(false);
  });

  it('stays within [-1, 1]', () => {
    const n = makeNoise2D(42);
    for (let i = 0; i < 2000; i++) {
      const v = n(i * 0.137, i * -0.219);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('hashSeed', () => {
  it('is deterministic', () => {
    expect(hashSeed(7, 'elevation')).toBe(hashSeed(7, 'elevation'));
    expect(hashSeed(7, 3, 5)).toBe(hashSeed(7, 3, 5));
  });

  it('separates tags so ("a","b") differs from ("ab")', () => {
    expect(hashSeed(1, 'a', 'b')).not.toBe(hashSeed(1, 'ab'));
  });

  it('decorrelates adjacent chunk coords and world seeds', () => {
    expect(hashSeed(1, 0, 0)).not.toBe(hashSeed(1, 0, 1));
    expect(hashSeed(1, 0, 0)).not.toBe(hashSeed(1, 1, 0));
    expect(hashSeed(1, 5, 5)).not.toBe(hashSeed(2, 5, 5));
  });

  it('returns a uint32', () => {
    const h = hashSeed(-99999, 'x', 12345);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('fbm', () => {
  it('is deterministic and bounded within [-1, 1]', () => {
    const n = makeNoise2D(hashSeed(5, 'elevation'));
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.05;
      const v = fbm(n, x, -x, { octaves: 6, frequency: 0.01 });
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(n, x, -x, { octaves: 6, frequency: 0.01 })).toBe(v); // pure
    }
  });
});

describe('ridged', () => {
  it('stays within [0, 1]', () => {
    const n = makeNoise2D(hashSeed(8, 'mountains'));
    for (let i = 0; i < 1000; i++) {
      const v = ridged(n, i * 0.03, i * 0.017, { frequency: 0.02 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('domainWarp', () => {
  it('is deterministic and bounded', () => {
    const field = makeNoise2D(hashSeed(3, 'field'));
    const warp = makeNoise2D(hashSeed(3, 'warp'));
    const v = domainWarp(field, warp, 12.3, -4.5, 4, { frequency: 0.02 });
    expect(v).toBe(domainWarp(field, warp, 12.3, -4.5, 4, { frequency: 0.02 }));
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  });
});
