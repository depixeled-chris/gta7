import { describe, it, expect } from 'vitest';
import { radialDeadzone, readGamepadIntent, GP, STICK_DEADZONE } from './gamepad';

describe('radialDeadzone', () => {
  it('zeroes input inside the deadzone', () => {
    const r = radialDeadzone(0.05, 0.05, 0.12); // mag ~0.07 < 0.12
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('rescales so the deadzone edge maps to 0 and full deflection stays 1', () => {
    const edge = radialDeadzone(STICK_DEADZONE, 0, STICK_DEADZONE);
    expect(edge.x).toBeCloseTo(0, 6);
    const full = radialDeadzone(1, 0, STICK_DEADZONE);
    expect(full.x).toBeCloseTo(1, 6);
  });

  it('preserves direction (no axis bias)', () => {
    const r = radialDeadzone(0.6, 0.8, 0.12); // mag 1.0 along a diagonal
    expect(r.y / r.x).toBeCloseTo(0.8 / 0.6, 6);
  });
});

describe('readGamepadIntent', () => {
  const noButtons = Array(17).fill(0);

  it('idles at neutral', () => {
    const r = readGamepadIntent([0, 0, 0, 0], noButtons);
    expect(r.steer).toBe(0);
    expect(r.forward).toBe(0);
    expect(r.throttle).toBe(0);
    expect(r.handbrake).toBe(false);
    expect(r.sprint).toBe(false);
  });

  it('left stick forward is +forward (axis up is -1) and does NOT throttle', () => {
    const r = readGamepadIntent([0, -1, 0, 0], noButtons);
    expect(r.forward).toBeCloseTo(1, 6);
    expect(r.throttle).toBe(0); // the stick must never feed the gas — triggers only
    expect(r.steer).toBe(0);
  });

  it('left stick X steers', () => {
    const r = readGamepadIntent([1, 0, 0, 0], noButtons);
    expect(r.steer).toBeCloseTo(1, 6);
    expect(r.throttle).toBe(0);
  });

  it('right trigger accelerates, left trigger reverses (throttle only)', () => {
    const buttons = noButtons.slice();
    buttons[GP.RT] = 1;
    expect(readGamepadIntent([0, 0, 0, 0], buttons).throttle).toBeCloseTo(1, 6);
    buttons[GP.RT] = 0;
    buttons[GP.LT] = 1;
    expect(readGamepadIntent([0, 0, 0, 0], buttons).throttle).toBeCloseTo(-1, 6);
  });

  it('maps B to handbrake and L3 to sprint', () => {
    const buttons = noButtons.slice();
    buttons[GP.B] = 1;
    buttons[GP.L3] = 1;
    const r = readGamepadIntent([0, 0, 0, 0], buttons);
    expect(r.handbrake).toBe(true);
    expect(r.sprint).toBe(true);
  });
});
