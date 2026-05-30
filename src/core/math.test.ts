import { describe, it, expect } from 'vitest';
import { clamp, lerp, damp, angleDelta, moveToward, safeApproachSpeed } from './math';

describe('clamp', () => {
  it('bounds values to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpolates endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('damp', () => {
  it('approaches the target and is frame-rate independent', () => {
    // One big step and many small steps over the same time should converge alike.
    const big = damp(0, 1, 5, 1);
    let small = 0;
    for (let i = 0; i < 100; i++) small = damp(small, 1, 5, 0.01);
    expect(small).toBeCloseTo(big, 5);
    expect(big).toBeGreaterThan(0.9);
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed difference', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    // From 0.1 rad to -0.1 rad (i.e. just below 2PI) the short way is negative.
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 5);
  });
});

describe('moveToward', () => {
  it('steps toward the target without overshooting', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(0, 2, 3)).toBe(2);
    expect(moveToward(10, 0, 3)).toBe(7);
  });
});

describe('safeApproachSpeed', () => {
  it('is zero when there is no room to stop', () => {
    expect(safeApproachSpeed(0, 7)).toBe(0);
    expect(safeApproachSpeed(-5, 7)).toBe(0);
  });
  it('grows with the available gap', () => {
    expect(safeApproachSpeed(10, 7)).toBeGreaterThan(safeApproachSpeed(2, 7));
  });
  it('matches v = sqrt(2·a·d)', () => {
    expect(safeApproachSpeed(4, 2)).toBeCloseTo(4); // sqrt(2*2*4)=4
  });
});
