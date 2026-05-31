import { describe, it, expect } from 'vitest';
import { stepVehicle, type VehicleState, type VehicleInput } from './VehicleModel';
import { PROFILES, INTERCEPTOR, PLAYER_PROFILE, type CarProfile } from './profiles';
import { CAR_SHAPES } from '../render/Assets';

const floor: VehicleInput = { throttle: 1, steer: 0, handbrake: false };

/** Top speed a profile reaches under full throttle on a straight (m/s). */
function topSpeed(p: CarProfile): number {
  let s: VehicleState = { x: 0, z: 0, heading: 0, vx: 0, vz: 0 };
  for (let i = 0; i < 1200; i++) s = stepVehicle(s, floor, p, 1 / 60);
  return Math.hypot(s.vx, s.vz);
}

const byId = (id: string): CarProfile => [...PROFILES, INTERCEPTOR].find((p) => p.id === id)!;

describe('car profiles', () => {
  it('every profile is well-formed and uses a real body shape', () => {
    const shapeIds = new Set(CAR_SHAPES.map((s) => s.id));
    const ids = new Set<string>();
    for (const p of [...PROFILES, INTERCEPTOR]) {
      expect(p.manufacturer.length).toBeGreaterThan(0);
      expect(p.model.length).toBeGreaterThan(0);
      expect(shapeIds.has(p.shapeId)).toBe(true);
      expect(ids.has(p.id)).toBe(false); // unique
      ids.add(p.id);
    }
    expect(PROFILES.length).toBe(7); // the seven street makes/models
  });

  it('class hierarchy holds: truck slower than sedan slower than sports slower than super', () => {
    const truck = topSpeed(byId('bunker-hauler'));
    const sedan = topSpeed(byId('crown-vantage'));
    const sports = topSpeed(byId('velocci-strada'));
    const sup = topSpeed(byId('velocci-furia'));
    expect(truck).toBeLessThan(sedan);
    expect(sedan).toBeLessThan(sports);
    expect(sports).toBeLessThan(sup);
  });

  it('a profile never exceeds its own maxSpeed', () => {
    for (const p of [...PROFILES, INTERCEPTOR]) {
      expect(topSpeed(p)).toBeLessThanOrEqual(p.maxSpeed + 1e-6);
    }
  });

  it('the player spawns in a defined model', () => {
    expect(PLAYER_PROFILE.manufacturer).toBeTruthy();
    expect(PLAYER_PROFILE.model).toBeTruthy();
  });
});
