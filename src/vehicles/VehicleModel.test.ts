import { describe, it, expect } from 'vitest';
import {
  stepVehicle,
  DEFAULT_VEHICLE,
  speedOf,
  forwardSpeedOf,
  lateralSpeedOf,
  toKmh,
  crashDamage,
  CAR_MAX_HEALTH,
  type VehicleState,
  type VehicleInput,
} from './VehicleModel';

const rest = (): VehicleState => ({ x: 0, z: 0, heading: 0, vx: 0, vz: 0 });
const idle: VehicleInput = { throttle: 0, steer: 0, handbrake: false };
const dt = 1 / 60;

const drive = (s: VehicleState, input: Partial<VehicleInput>, steps: number): VehicleState => {
  let state = s;
  const full = { ...idle, ...input };
  for (let i = 0; i < steps; i++) state = stepVehicle(state, full, DEFAULT_VEHICLE, dt);
  return state;
};

describe('crashDamage', () => {
  it('shrugs off gentle bumps below the free-impact threshold', () => {
    expect(crashDamage(0)).toBe(0);
    expect(crashDamage(8)).toBe(0);
    expect(crashDamage(-8)).toBe(0); // sign of closing velocity doesn't matter
  });

  it('scales with impact speed above the threshold', () => {
    expect(crashDamage(15)).toBeGreaterThan(0);
    expect(crashDamage(30)).toBeGreaterThan(crashDamage(15));
  });

  it('never totals an intact car in a single impact, however fast', () => {
    expect(crashDamage(90)).toBeLessThan(CAR_MAX_HEALTH); // a flat-out crash leaves you alive
    expect(crashDamage(10000)).toBeLessThan(CAR_MAX_HEALTH);
  });

  it('survives several flat-out hits but eventually wrecks (cars are tough)', () => {
    expect(crashDamage(90) * 3).toBeLessThan(CAR_MAX_HEALTH); // three flat-out hits, still alive
    expect(crashDamage(90) * 4).toBeGreaterThanOrEqual(CAR_MAX_HEALTH); // the fourth totals it
  });
});

describe('stepVehicle', () => {
  it('accelerates forward under throttle', () => {
    const s = drive(rest(), { throttle: 1 }, 60);
    expect(forwardSpeedOf(s)).toBeGreaterThan(5);
    expect(s.x).toBeGreaterThan(0); // moved toward +X at heading 0
  });

  it('coasts to a stop when idle', () => {
    const moving = drive(rest(), { throttle: 1 }, 120);
    const stopped = drive(moving, {}, 1200);
    expect(speedOf(stopped)).toBeCloseTo(0, 2);
  });

  it('caps forward speed at maxSpeed', () => {
    const s = drive(rest(), { throttle: 1 }, 6000);
    expect(forwardSpeedOf(s)).toBeLessThanOrEqual(DEFAULT_VEHICLE.maxSpeed + 1e-3);
    expect(forwardSpeedOf(s)).toBeGreaterThan(DEFAULT_VEHICLE.maxSpeed * 0.9);
  });

  it('reverses but only up to reverseMaxSpeed', () => {
    const s = drive(rest(), { throttle: -1 }, 6000);
    expect(forwardSpeedOf(s)).toBeLessThan(0);
    expect(forwardSpeedOf(s)).toBeGreaterThanOrEqual(-DEFAULT_VEHICLE.reverseMaxSpeed - 1e-3);
  });

  it('does not steer while parked', () => {
    const s = drive(rest(), { steer: 1 }, 60);
    expect(s.heading).toBeCloseTo(0, 6);
  });

  it('steers when moving, and reverses turn direction in reverse', () => {
    const fwd = drive(drive(rest(), { throttle: 1 }, 90), { throttle: 1, steer: 1 }, 30);
    expect(fwd.heading).toBeGreaterThan(0);

    const rev = drive(drive(rest(), { throttle: -1 }, 90), { throttle: -1, steer: 1 }, 30);
    expect(rev.heading).toBeLessThan(0);
  });

  it('reversing while steering left backs the car toward its left (real rear-steer)', () => {
    // Forward + left curves toward -Z (the driver's left). Reversing + left
    // should ALSO carry the car toward -Z (you back to your left), even though
    // the nose swings the other way. This is the intuitive, real-car behavior.
    const fwdLeft = drive(rest(), { throttle: 1, steer: 1 }, 80);
    expect(fwdLeft.z).toBeLessThan(0); // forward-left travels toward -Z

    const rev = drive(rest(), { throttle: -1 }, 90); // get moving backward
    const revLeft = drive(rev, { throttle: -1, steer: 1 }, 60);
    expect(revLeft.x).toBeLessThan(rev.x); // still moving backward (-X)
    expect(revLeft.z).toBeLessThan(0); // and curving toward the driver's left
  });

  it('brakes harder than it coasts', () => {
    const moving = drive(rest(), { throttle: 1 }, 120);
    const braked = drive(moving, { throttle: -1 }, 10);
    const coasted = drive(moving, {}, 10);
    expect(forwardSpeedOf(braked)).toBeLessThan(forwardSpeedOf(coasted));
  });

  it('powerslides: the handbrake preserves lateral slip that grip would kill', () => {
    const fast = drive(rest(), { throttle: 1 }, 180);

    const gripTurn = drive(fast, { throttle: 1, steer: 1 }, 25);
    const slideTurn = drive(fast, { throttle: 1, steer: 1, handbrake: true }, 25);

    // With the handbrake the car slips sideways far more than with tyres planted.
    expect(Math.abs(lateralSpeedOf(slideTurn))).toBeGreaterThan(
      Math.abs(lateralSpeedOf(gripTurn)) * 2,
    );
    expect(Math.abs(lateralSpeedOf(slideTurn))).toBeGreaterThan(5);
  });

  it('a powerslide can swing the nose past 90° (the slide is not pinned at a quarter turn)', () => {
    const fast = drive(rest(), { throttle: 1 }, 180); // up to speed, heading 0
    const drift = drive(fast, { steer: 1, handbrake: true }, 90); // hard handbrake turn
    // The forward-projection sign used to flip once the nose passed 90° from the
    // travel direction, inverting steering and pinning the drift near π/2.
    expect(drift.heading).toBeGreaterThan(Math.PI / 2);
  });

  it('grip realigns velocity to the heading after a turn', () => {
    const fast = drive(rest(), { throttle: 1 }, 180);
    const turned = drive(fast, { throttle: 1, steer: 1 }, 40);
    // Planted tyres keep slip small relative to forward motion.
    expect(Math.abs(lateralSpeedOf(turned))).toBeLessThan(Math.abs(forwardSpeedOf(turned)) * 0.5);
  });

  it('is deterministic', () => {
    const a = drive(rest(), { throttle: 1, steer: 0.5 }, 200);
    const b = drive(rest(), { throttle: 1, steer: 0.5 }, 200);
    expect(a).toEqual(b);
  });
});

describe('toKmh', () => {
  it('converts m/s magnitude to km/h', () => {
    expect(toKmh(10)).toBeCloseTo(36);
    expect(toKmh(-10)).toBeCloseTo(36);
  });
});
