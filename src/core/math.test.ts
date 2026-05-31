import { describe, it, expect } from 'vitest';
import {
  clamp,
  lerp,
  damp,
  angleDelta,
  angleLerp,
  moveToward,
  safeApproachSpeed,
  stickVector,
  starsFromHeat,
  leadTime,
  pursuitSpeed,
  daylightFactor,
  sunPosition,
  engineToneHz,
} from './math';

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

describe('angleLerp', () => {
  it('interpolates along the shortest arc across the wrap', () => {
    // From 0.1 toward (2PI - 0.1): shortest path is backwards through 0.
    const r = angleLerp(0.1, Math.PI * 2 - 0.1, 0.5);
    expect(Math.cos(r)).toBeCloseTo(1, 5); // halfway lands at angle ~0
  });
  it('returns endpoints at t=0 and t=1', () => {
    expect(angleLerp(0.3, 1.2, 0)).toBeCloseTo(0.3);
    expect(angleLerp(0.3, 1.2, 1)).toBeCloseTo(1.2);
  });
});

describe('starsFromHeat', () => {
  it('is 0 at no heat and caps at 5', () => {
    expect(starsFromHeat(0)).toBe(0);
    expect(starsFromHeat(200)).toBe(5);
    expect(starsFromHeat(-10)).toBe(0);
  });
  it('rises a star per 20 heat', () => {
    expect(starsFromHeat(1)).toBe(1);
    expect(starsFromHeat(20)).toBe(1);
    expect(starsFromHeat(21)).toBe(2);
    expect(starsFromHeat(81)).toBe(5);
  });
});

describe('leadTime', () => {
  it('is capped by maxLead', () => {
    expect(leadTime(1000, 27, 64, 1.2)).toBe(1.2);
  });
  it('shrinks as closing speed grows', () => {
    expect(leadTime(50, 27, 64, 5)).toBeLessThan(leadTime(50, 27, 0, 5));
  });
  it('matches gap / closing speed below the cap', () => {
    expect(leadTime(40, 10, 10, 5)).toBeCloseTo(2); // 40 / 20
  });
});

describe('engineToneHz', () => {
  it('rises within a gear and drops at the upshift', () => {
    const gears = 5;
    // Just before the first upshift (1/5) the pitch is high; just after, it drops.
    const before = engineToneHz(0.2 - 0.001, gears);
    const after = engineToneHz(0.2 + 0.001, gears);
    expect(before).toBeGreaterThan(after);
  });
  it('idles low and never drops below idle', () => {
    expect(engineToneHz(0)).toBeCloseTo(48, 0);
    for (let s = 0; s <= 1; s += 0.05) expect(engineToneHz(s)).toBeGreaterThanOrEqual(48 - 1e-6);
  });
});

describe('moveToward', () => {
  it('steps toward the target without overshooting', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(0, 2, 3)).toBe(2);
    expect(moveToward(10, 0, 3)).toBe(7);
  });
});

describe('pursuitSpeed', () => {
  it('cruises at base when the target is right there', () => {
    expect(pursuitSpeed(0, 30, 82, 0.5)).toBe(30);
  });
  it('ramps up with the gap', () => {
    expect(pursuitSpeed(40, 30, 82, 0.5)).toBe(50); // 30 + 40*0.5
  });
  it('never exceeds the cap, however far the target runs', () => {
    expect(pursuitSpeed(10000, 30, 82, 0.5)).toBe(82);
  });
});

describe('daylightFactor', () => {
  it('is dark at midnight and around dawn/dusk, bright at noon', () => {
    expect(daylightFactor(0)).toBeCloseTo(0, 6); // midnight
    expect(daylightFactor(0.25)).toBeCloseTo(0, 6); // dawn
    expect(daylightFactor(0.5)).toBeCloseTo(1, 6); // noon
    expect(daylightFactor(0.75)).toBeCloseTo(0, 6); // dusk
  });
  it('clamps the night half to 0 (never negative) and stays within [0,1]', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const d = daylightFactor(t);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
    expect(daylightFactor(0.9)).toBe(0); // deep night, clamped
  });
});

describe('sunPosition', () => {
  const len = (p: { x: number; y: number; z: number }): number => Math.hypot(p.x, p.y, p.z);
  it('rises in the east, peaks overhead at noon, sets in the west', () => {
    expect(sunPosition(0.25).x).toBeGreaterThan(0); // dawn: east
    expect(sunPosition(0.75).x).toBeLessThan(0); // dusk: west
    expect(sunPosition(0.5).y).toBeGreaterThan(sunPosition(0.25).y); // higher at noon than dawn
  });
  it('never drops below the horizon (light stays above ground)', () => {
    for (let t = 0; t < 1; t += 0.02) expect(sunPosition(t).y).toBeGreaterThan(0);
  });
  it('returns a unit vector', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 0.9]) expect(len(sunPosition(t))).toBeCloseTo(1, 6);
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

describe('stickVector', () => {
  const R = 50;
  it('is zero at the center', () => {
    expect(stickVector(0, 0, R)).toEqual({ x: 0, y: 0 });
  });
  it('maps a full right/up push to +x / +y (y is flipped)', () => {
    expect(stickVector(R, 0, R).x).toBeCloseTo(1);
    expect(stickVector(0, -R, R).y).toBeCloseTo(1); // dragging up
    expect(stickVector(0, R, R).y).toBeCloseTo(-1); // dragging down = reverse
  });
  it('clamps to the unit disc beyond the radius', () => {
    const v = stickVector(R * 3, 0, R);
    expect(v.x).toBeCloseTo(1);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
