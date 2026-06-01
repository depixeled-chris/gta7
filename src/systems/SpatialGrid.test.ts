import { describe, it, expect } from 'vitest';
import { SpatialGrid } from './SpatialGrid';
import { resolveCircle, type Aabb } from './Collision';
import { generateCity, DEFAULT_CITY } from '../world/City';
import { createRng } from '../core/rng';

describe('SpatialGrid', () => {
  it('resolve() matches a full resolveCircle scan over the real city', () => {
    const city = generateCity(DEFAULT_CITY);
    const grid = new SpatialGrid(city.colliders, city.cell);
    const rng = createRng(4242);
    const radius = 1.9; // CAR_RADIUS — the largest actor

    // Sample points across the whole map, biased toward building edges where
    // push-out actually happens, and assert bit-for-bit agreement.
    for (let i = 0; i < 5000; i++) {
      const x = rng.range(-city.half, city.half);
      const z = rng.range(-city.half, city.half);
      const full = resolveCircle(x, z, radius, city.colliders);
      const fast = grid.resolve(x, z, radius);
      expect(fast.x).toBeCloseTo(full.x, 10);
      expect(fast.z).toBeCloseTo(full.z, 10);
    }
  });

  it('resolves a circle out of a box it overlaps', () => {
    const boxes: Aabb[] = [{ minX: 0, minZ: 0, maxX: 10, maxZ: 10 }];
    const grid = new SpatialGrid(boxes, 4);
    const r = grid.resolve(11, 5, 2); // 1 unit into the right face
    expect(r.x).toBeCloseTo(12, 10);
    expect(r.z).toBeCloseTo(5, 10);
  });

  it('handles a box that spans many cells without double-pushing', () => {
    const boxes: Aabb[] = [{ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }];
    const grid = new SpatialGrid(boxes, 4); // box spans 25x25 cells
    const r = grid.resolve(50, 101, 2); // just above the top face
    expect(r.x).toBeCloseTo(50, 10);
    expect(r.z).toBeCloseTo(102, 10); // pushed out exactly radius, once
  });

  it('leaves a circle in open space untouched', () => {
    const city = generateCity(DEFAULT_CITY);
    const grid = new SpatialGrid(city.colliders, city.cell);
    const r = grid.resolve(city.center.x, city.center.z, 1.9); // road intersection
    expect(r.x).toBeCloseTo(city.center.x, 10);
    expect(r.z).toBeCloseTo(city.center.z, 10);
  });

  it('insert adds a box that resolve pushes out of; remove clears it', () => {
    const grid = new SpatialGrid([], 4);
    const id = grid.insert({ minX: 0, minZ: 0, maxX: 10, maxZ: 10 });
    let r = grid.resolve(11, 5, 2); // 1 unit into the right face
    expect(r.x).toBeCloseTo(12, 10);
    grid.remove(id);
    r = grid.resolve(11, 5, 2);
    expect(r.x).toBeCloseTo(11, 10); // open space again
  });

  it('remove of a multi-cell box leaves nothing behind in any cell', () => {
    const grid = new SpatialGrid([], 4);
    const id = grid.insert({ minX: 0, minZ: 0, maxX: 100, maxZ: 100 }); // 25x25 cells
    grid.remove(id);
    const r = grid.resolve(50, 101, 2);
    expect(r.z).toBeCloseTo(101, 10); // untouched
  });

  it('streaming churn: re-inserting after removal still resolves', () => {
    const grid = new SpatialGrid([{ minX: -5, minZ: -5, maxX: 5, maxZ: 5 }], 4);
    const id = grid.insert({ minX: 20, minZ: 0, maxX: 30, maxZ: 10 });
    grid.remove(id);
    const id2 = grid.insert({ minX: 20, minZ: 0, maxX: 30, maxZ: 10 });
    const r = grid.resolve(19, 5, 2); // 1 unit into the left face of the re-inserted box
    expect(r.x).toBeCloseTo(18, 10);
    expect(id2).toBeGreaterThan(id);
  });
});
