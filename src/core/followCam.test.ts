import { describe, it, expect } from 'vitest';
import { followDistance, lookLead, type FollowParams } from './followCam';
import { damp } from './math';

const CAR_CAM: FollowParams = {
  distance: 9,
  height: 4.2,
  lookHeight: 1.4,
  stiffness: 4,
  speedPull: 0.16,
  slideSwing: 0.3,
  maxSwing: 2,
};

/**
 * Forward-axis framing: car moving at `speed` along heading. Returns how far it ends up
 * *ahead* of the look-at (positive = drifted toward the top of the screen).
 */
function forwardOffset(speed: number, withLead: boolean): number {
  const dt = 1 / 60;
  const lead = withLead ? lookLead(CAR_CAM, speed, 0).forward : 0;
  let car = 0;
  let look = 0;
  for (let i = 0; i < 600; i++) {
    car += speed * dt;
    look = damp(look, car + lead, CAR_CAM.stiffness, dt);
  }
  return car - look;
}

/**
 * Lateral-axis framing during a slide: car translating sideways at `vLateral` (with some
 * forward `vForward`). Returns the residual sideways offset of the car from centre — the
 * powerslide "swing".
 */
function lateralSwing(vForward: number, vLateral: number): number {
  const dt = 1 / 60;
  const lead = lookLead(CAR_CAM, vForward, vLateral).lateral;
  let car = 0;
  let look = 0;
  for (let i = 0; i < 600; i++) {
    car += vLateral * dt;
    look = damp(look, car + lead, CAR_CAM.stiffness, dt);
  }
  return car - look;
}

describe('followDistance', () => {
  it('pulls in with speed, clamped at half the resting distance', () => {
    expect(followDistance(CAR_CAM, 0)).toBeCloseTo(9);
    expect(followDistance(CAR_CAM, 10)).toBeCloseTo(9 - 10 * 0.16);
    expect(followDistance(CAR_CAM, 1000)).toBeCloseTo(4.5);
  });
});

describe('lookLead', () => {
  it('leads the forward component fully (speed / stiffness)', () => {
    expect(lookLead(CAR_CAM, 0, 0)).toEqual({ forward: 0, lateral: 0 });
    expect(lookLead(CAR_CAM, 8, 0).forward).toBeCloseTo(2);
  });

  it('leaves a bounded fraction of the lateral lag as swing', () => {
    // vLateral 8 → full lag 2; slideSwing 0.3 leaves 0.6 → lateral lead 1.4.
    expect(lookLead(CAR_CAM, 0, 8).lateral).toBeCloseTo(2 * (1 - 0.3));
    // A big slide: full lag 5, swing capped at maxSwing(2) → lateral lead 5 - 1.5.
    expect(lookLead(CAR_CAM, 0, 20).lateral).toBeCloseTo(5 - Math.min(2, 5 * 0.3));
  });
});

describe('camera framing', () => {
  it('keeps the car centred along travel across the speed range (forward fix)', () => {
    for (const speed of [0, 5, 15, 30]) {
      expect(Math.abs(forwardOffset(speed, true))).toBeLessThan(0.3);
    }
  });

  it('without the lead the car drifts forward with speed — the original bug', () => {
    const slow = forwardOffset(5, false);
    const fast = forwardOffset(30, false);
    expect(slow).toBeGreaterThan(0.5);
    expect(fast).toBeGreaterThan(slow); // drift grows with speed
    expect(Math.abs(forwardOffset(30, true))).toBeLessThan(fast / 10); // lead removes it
  });

  it('lets the car swing out a little in a powerslide — small + bounded, not pinned, not excessive', () => {
    const swing = Math.abs(lateralSwing(18, 12));
    expect(swing).toBeGreaterThan(0.05); // not pinned dead-centre
    expect(swing).toBeLessThanOrEqual(CAR_CAM.maxSwing! + 1e-9); // never past the cap (~20% screen)
    expect(swing).toBeLessThan(12 / CAR_CAM.stiffness); // far less than the original full swing
  });
});
