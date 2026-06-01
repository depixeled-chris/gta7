import { describe, it, expect } from 'vitest';
import { followDistance, lookLead, type FollowParams } from './followCam';
import { damp } from './math';

const CAR_CAM: FollowParams = { distance: 9, height: 4.2, lookHeight: 1.4, stiffness: 4, speedPull: 0.16 };

/**
 * Settle the damped look-at against a car moving at constant `speed` along one axis;
 * return how far the car ends up *ahead* of where the camera aims. A positive offset
 * means the car has drifted forward (toward the top of the screen).
 */
function framingOffset(speed: number, withLead: boolean): number {
  const dt = 1 / 60;
  const lead = withLead ? lookLead(CAR_CAM, speed, 0).x : 0;
  let car = 0;
  let look = 0;
  for (let i = 0; i < 600; i++) {
    car += speed * dt;
    look = damp(look, car + lead, CAR_CAM.stiffness, dt);
  }
  return car - look;
}

/** 2D analog: a car translating at velocity (vx,vz) — e.g. a powerslide where travel
 *  diverges from heading. Returns the car's offset from the look-at on each axis. */
function framingOffset2D(vx: number, vz: number): { dx: number; dz: number } {
  const dt = 1 / 60;
  const lead = lookLead(CAR_CAM, vx, vz);
  let cx = 0;
  let cz = 0;
  let lx = 0;
  let lz = 0;
  for (let i = 0; i < 600; i++) {
    cx += vx * dt;
    cz += vz * dt;
    lx = damp(lx, cx + lead.x, CAR_CAM.stiffness, dt);
    lz = damp(lz, cz + lead.z, CAR_CAM.stiffness, dt);
  }
  return { dx: cx - lx, dz: cz - lz };
}

describe('followDistance', () => {
  it('pulls in with speed, clamped at half the resting distance', () => {
    expect(followDistance(CAR_CAM, 0)).toBeCloseTo(9);
    expect(followDistance(CAR_CAM, 10)).toBeCloseTo(9 - 10 * 0.16);
    expect(followDistance(CAR_CAM, 1000)).toBeCloseTo(4.5);
  });
});

describe('lookLead', () => {
  it('leads by the damping lag, velocity / stiffness, per axis', () => {
    expect(lookLead(CAR_CAM, 0, 0)).toEqual({ x: 0, z: 0 });
    expect(lookLead(CAR_CAM, 8, 0).x).toBeCloseTo(2);
    const lead = lookLead(CAR_CAM, 8, 12); // a slide: both axes
    expect(lead.x).toBeCloseTo(2);
    expect(lead.z).toBeCloseTo(3);
  });
});

describe('camera framing vs speed', () => {
  it('keeps the car centred across the speed range (the fix)', () => {
    for (const speed of [0, 5, 15, 30]) {
      expect(Math.abs(framingOffset(speed, true))).toBeLessThan(0.3);
    }
  });

  it('keeps the car centred mid-powerslide, when travel diverges from heading', () => {
    // Strong lateral component (the slide). Both axes must stay centred.
    const { dx, dz } = framingOffset2D(18, 12);
    expect(Math.abs(dx)).toBeLessThan(0.3);
    expect(Math.abs(dz)).toBeLessThan(0.3);
  });

  it('without the lead the car drifts forward with speed — the original bug', () => {
    const slow = framingOffset(5, false);
    const fast = framingOffset(30, false);
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeGreaterThan(slow); // drift grows with speed
    expect(fast).toBeGreaterThan(5); // and is large at top speed
    // the lead removes essentially all of it
    expect(Math.abs(framingOffset(30, true))).toBeLessThan(fast / 10);
  });
});
