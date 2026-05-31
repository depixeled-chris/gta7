import { describe, it, expect } from 'vitest';
import { generateCity, generateChunk, DEFAULT_CITY } from './City';

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

  it('is a tiling of chunks — chunk buildings sum to the whole city', () => {
    const city = generateCity(DEFAULT_CITY);
    const chunksPerSide = Math.ceil(DEFAULT_CITY.grid / DEFAULT_CITY.chunkBlocks);
    let total = 0;
    for (let cx = 0; cx < chunksPerSide; cx++) {
      for (let cz = 0; cz < chunksPerSide; cz++) {
        total += generateChunk(cx, cz, DEFAULT_CITY).buildings.length;
      }
    }
    expect(total).toBe(city.buildings.length);
  });
});

describe('generateChunk', () => {
  it('is deterministic — same coord+seed yields an identical chunk', () => {
    const a = generateChunk(1, 2, DEFAULT_CITY);
    const b = generateChunk(1, 2, DEFAULT_CITY);
    expect(a).toEqual(b);
  });

  it('differs by chunk coordinate (independent of visit order)', () => {
    const a = generateChunk(0, 0, DEFAULT_CITY);
    const b = generateChunk(1, 0, DEFAULT_CITY);
    expect(a.buildings).not.toEqual(b.buildings);
  });

  it('differs by world seed', () => {
    const a = generateChunk(0, 0, { ...DEFAULT_CITY, seed: 1 });
    const b = generateChunk(0, 0, { ...DEFAULT_CITY, seed: 2 });
    expect(a.buildings).not.toEqual(b.buildings);
  });

  it('emits one collider per building', () => {
    const c = generateChunk(0, 0, DEFAULT_CITY);
    expect(c.colliders.length).toBe(c.buildings.length);
  });
});

describe('biome-driven variety', () => {
  it('spans a wide height range — dense tall cores AND low outskirts', () => {
    const city = generateCity(DEFAULT_CITY);
    const heights = city.buildings.map((b) => b.height);
    const tall = heights.filter((h) => h >= 40).length; // core-scale
    const low = heights.filter((h) => h <= 20).length; // suburb/rural-scale
    expect(tall).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
  });

  it('uses more than one biome palette across the city', () => {
    const city = generateCity(DEFAULT_CITY);
    const colors = new Set(city.buildings.map((b) => b.color));
    // A single biome has 4 tints; spanning biomes yields more distinct colours.
    expect(colors.size).toBeGreaterThan(4);
  });

  it('mixes facade styles across the city (not all glass towers)', () => {
    const city = generateCity(DEFAULT_CITY);
    const styles = new Set(city.buildings.map((b) => b.style));
    expect(styles.size).toBeGreaterThan(1);
  });
});

describe('street props', () => {
  it('places sidewalk props that never sit inside a building', () => {
    const city = generateCity(DEFAULT_CITY);
    expect(city.props.length).toBeGreaterThan(0);
    for (const p of city.props) {
      for (const c of city.colliders) {
        const inside = p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ;
        expect(inside).toBe(false);
      }
    }
  });

  it('uses more than one prop type across the city', () => {
    const types = new Set(generateCity(DEFAULT_CITY).props.map((p) => p.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    expect(generateCity(DEFAULT_CITY).props).toEqual(generateCity(DEFAULT_CITY).props);
  });
});

describe('parking', () => {
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
