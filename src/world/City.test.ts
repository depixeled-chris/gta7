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

  it('places a streetlight at every road intersection, deterministically', () => {
    const city = generateCity(DEFAULT_CITY);
    const n = city.roadCenters.length;
    expect(city.streetlights.length).toBe(n * n);
    expect(generateCity(DEFAULT_CITY).streetlights).toEqual(city.streetlights);
  });

  it('generates curbside parking spots that never sit inside a building', () => {
    const city = generateCity(DEFAULT_CITY);
    expect(city.parkingSpots.length).toBeGreaterThan(0);
    for (const s of city.parkingSpots) {
      for (const c of city.colliders) {
        const inside = s.x > c.minX && s.x < c.maxX && s.z > c.minZ && s.z < c.maxZ;
        expect(inside).toBe(false);
      }
    }
    expect(generateCity(DEFAULT_CITY).parkingSpots).toEqual(city.parkingSpots);
  });
});
