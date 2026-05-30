import { describe, it, expect } from 'vitest';
import { resolveCircleAabb, resolveCircle, type Aabb } from './Collision';

const box: Aabb = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 };

describe('resolveCircleAabb', () => {
  it('leaves a circle outside the box untouched', () => {
    const r = resolveCircleAabb(20, 0, 1, box);
    expect(r).toEqual({ x: 20, z: 0 });
  });

  it('pushes a circle out to the nearest face when overlapping an edge', () => {
    // Circle straddling the +X face: should be pushed clear along +X.
    const r = resolveCircleAabb(5.5, 0, 1, box);
    expect(r.x).toBeCloseTo(6); // maxX + radius
    expect(r.z).toBeCloseTo(0);
  });

  it('ejects a circle whose center is inside via least penetration', () => {
    // Slightly past center toward +X face -> ejected out the +X side.
    const r = resolveCircleAabb(3, 0, 1, box);
    expect(r.x).toBeCloseTo(6);
    expect(r.z).toBeCloseTo(0);
  });

  it('resolves a corner overlap diagonally', () => {
    const r = resolveCircleAabb(6, 6, 2, box);
    const dx = r.x - 5;
    const dz = r.z - 5;
    expect(Math.hypot(dx, dz)).toBeCloseTo(2, 5); // pushed to radius from corner
  });
});

describe('resolveCircle', () => {
  it('resolves against multiple boxes', () => {
    const boxes: Aabb[] = [
      { minX: -5, minZ: -5, maxX: 5, maxZ: 5 },
      { minX: 6, minZ: -5, maxX: 16, maxZ: 5 },
    ];
    const r = resolveCircle(5.5, 0, 1, boxes);
    // Wedged in the 1-unit gap between two boxes -> ends up clear of both.
    expect(r.x).toBeGreaterThanOrEqual(4);
    expect(r.x).toBeLessThanOrEqual(7);
  });
});
