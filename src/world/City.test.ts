import { describe, it, expect } from 'vitest';
import { generateCity, DEFAULT_CITY } from './City';

describe('generateCity', () => {
  it('is deterministic for a given seed', () => {
    const a = generateCity({ ...DEFAULT_CITY, seed: 123 });
    const b = generateCity({ ...DEFAULT_CITY, seed: 123 });
    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings[0]).toEqual(b.buildings[0]);
    expect(a.lanes).toEqual(b.lanes);
  });

  it('varies layout with the seed', () => {
    const a = generateCity({ ...DEFAULT_CITY, seed: 1 });
    const b = generateCity({ ...DEFAULT_CITY, seed: 2 });
    expect(a.buildings).not.toEqual(b.buildings);
  });

  it('produces a non-empty, centered world', () => {
    const city = generateCity(DEFAULT_CITY);
    expect(city.buildings.length).toBeGreaterThan(10);
    expect(city.colliders.length).toBe(city.buildings.length);
    expect(city.extent).toBeGreaterThan(0);
    // Center spawn sits within the world bounds.
    expect(Math.abs(city.center.x)).toBeLessThan(city.half);
  });

  it('keeps every building footprint inside the world bounds', () => {
    const city = generateCity(DEFAULT_CITY);
    for (const b of city.buildings) {
      expect(Math.abs(b.cx) + b.width / 2).toBeLessThanOrEqual(city.half + 1e-6);
      expect(Math.abs(b.cz) + b.depth / 2).toBeLessThanOrEqual(city.half + 1e-6);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('emits balanced traffic lanes on both axes', () => {
    const city = generateCity(DEFAULT_CITY);
    const xs = city.lanes.filter((l) => l.axis === 'x');
    const zs = city.lanes.filter((l) => l.axis === 'z');
    expect(xs.length).toBe(zs.length);
    expect(city.lanes.length).toBeGreaterThan(0);
  });
});
