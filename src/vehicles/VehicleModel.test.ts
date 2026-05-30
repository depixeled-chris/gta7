import { describe, it, expect } from 'vitest';
import {
  stepVehicle,
  DEFAULT_VEHICLE,
  toKmh,
  type VehicleState,
  type VehicleInput,
} from './VehicleModel';

const rest = (): VehicleState => ({ x: 0, z: 0, heading: 0, speed: 0 });
const idle: VehicleInput = { throttle: 0, steer: 0, handbrake: false };
const dt = 1 / 60;

const drive = (s: VehicleState, input: Partial<VehicleInput>, steps: number): VehicleState => {
  let state = s;
  const full = { ...idle, ...input };
  for (let i = 0; i < steps; i++) state = stepVehicle(state, full, DEFAULT_VEHICLE, dt);
  return state;
};

describe('stepVehicle', () => {
  it('accelerates forward under throttle', () => {
    const s = drive(rest(), { throttle: 1 }, 60);
    expect(s.speed).toBeGreaterThan(5);
    expect(s.x).toBeGreaterThan(0); // moved toward +X at heading 0
  });

  it('coasts to a stop when idle', () => {
    const moving = drive(rest(), { throttle: 1 }, 120);
    const stopped = drive(moving, {}, 600);
    expect(stopped.speed).toBeCloseTo(0, 2);
  });

  it('caps speed at maxSpeed', () => {
    const s = drive(rest(), { throttle: 1 }, 6000);
    expect(s.speed).toBeLessThanOrEqual(DEFAULT_VEHICLE.maxSpeed + 1e-6);
  });

  it('reverses but only up to reverseMaxSpeed', () => {
    const s = drive(rest(), { throttle: -1 }, 6000);
    expect(s.speed).toBeLessThan(0);
    expect(s.speed).toBeGreaterThanOrEqual(-DEFAULT_VEHICLE.reverseMaxSpeed - 1e-6);
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

  it('brakes harder than it coasts', () => {
    const moving = drive(rest(), { throttle: 1 }, 120);
    const braked = drive(moving, { throttle: -1 }, 10);
    const coasted = drive(moving, {}, 10);
    expect(braked.speed).toBeLessThan(coasted.speed);
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
