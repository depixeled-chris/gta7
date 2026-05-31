import { describe, it, expect } from 'vitest';
import { sanitize, DEFAULT_OPTIONS, qualityPixelRatio } from './options';

describe('sanitize', () => {
  it('returns defaults for empty/garbage input', () => {
    expect(sanitize(null)).toEqual(DEFAULT_OPTIONS);
    expect(sanitize(42)).toEqual(DEFAULT_OPTIONS);
    expect(sanitize({})).toEqual(DEFAULT_OPTIONS);
  });

  it('clamps volume to 0..1', () => {
    expect(sanitize({ masterVolume: 5 }).masterVolume).toBe(1);
    expect(sanitize({ masterVolume: -2 }).masterVolume).toBe(0);
  });

  it('clamps day length to a sane range', () => {
    expect(sanitize({ dayLength: 1 }).dayLength).toBe(30);
    expect(sanitize({ dayLength: 99999 }).dayLength).toBe(1800);
  });

  it('rejects an unknown quality, keeps a valid one', () => {
    expect(sanitize({ quality: 'ultra' }).quality).toBe(DEFAULT_OPTIONS.quality);
    expect(sanitize({ quality: 'low' }).quality).toBe('low');
  });

  it('falls back per-field on NaN/wrong types', () => {
    const o = sanitize({ masterVolume: NaN, dayLength: 'abc', quality: 7 });
    expect(o).toEqual(DEFAULT_OPTIONS);
  });
});

describe('qualityPixelRatio', () => {
  it('maps tiers low<medium<high', () => {
    expect(qualityPixelRatio('low')).toBeLessThan(qualityPixelRatio('medium'));
    expect(qualityPixelRatio('medium')).toBeLessThan(qualityPixelRatio('high'));
  });
});
