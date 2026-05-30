import { clamp } from '../core/math';

/**
 * Arcade vehicle dynamics. Deliberately NOT a rigid-body sim: a tuned
 * kinematic model gives predictable, fun GTA-style handling and stays pure
 * (no Three.js, no globals) so it can be unit-tested deterministically.
 *
 * Coordinate convention matches the renderer: world X = east, Z = south,
 * heading 0 points toward +X and increases counter-clockwise (toward -Z).
 */
export interface VehicleState {
  x: number;
  z: number;
  heading: number; // radians
  speed: number; // m/s along heading (negative = reverse)
}

export interface VehicleInput {
  throttle: number; // [-1, 1]
  steer: number; // [-1, 1] (+1 = left)
  handbrake: boolean;
}

export interface VehicleConfig {
  enginePower: number; // m/s^2 at full throttle
  brakePower: number; // m/s^2 when reversing throttle against motion
  reverseMaxSpeed: number;
  maxSpeed: number;
  drag: number; // passive deceleration per second (fraction of speed)
  rollingResistance: number; // constant deceleration (m/s^2)
  turnRate: number; // rad/s at the steering reference speed
  gripSpeed: number; // speed (m/s) at which steering reaches full authority
  handbrakeDrag: number;
}

export const DEFAULT_VEHICLE: VehicleConfig = {
  enginePower: 14,
  brakePower: 26,
  reverseMaxSpeed: 9,
  maxSpeed: 42,
  drag: 0.6,
  rollingResistance: 4,
  turnRate: 2.4,
  gripSpeed: 12,
  handbrakeDrag: 14,
};

const EPS = 1e-4;

export function stepVehicle(
  state: VehicleState,
  input: VehicleInput,
  cfg: VehicleConfig,
  dt: number,
): VehicleState {
  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);

  let speed = state.speed;
  const movingForward = speed > EPS;
  const movingBackward = speed < -EPS;

  // Throttle that opposes current motion acts as braking; otherwise it drives.
  if (throttle !== 0) {
    const opposing =
      (movingForward && throttle < 0) || (movingBackward && throttle > 0);
    const accel = opposing ? cfg.brakePower : cfg.enginePower;
    speed += throttle * accel * dt;
  }

  // Passive losses: proportional drag + constant rolling resistance.
  speed -= speed * cfg.drag * dt;
  if (input.handbrake) speed -= speed * cfg.handbrakeDrag * dt;
  const roll = cfg.rollingResistance * dt;
  if (speed > 0) speed = Math.max(0, speed - roll);
  else if (speed < 0) speed = Math.min(0, speed + roll);

  speed = clamp(speed, -cfg.reverseMaxSpeed, cfg.maxSpeed);

  // Steering authority scales with speed (you can't turn while parked) and
  // the turn flips sign in reverse, like a real car backing up.
  const authority = clamp(Math.abs(speed) / cfg.gripSpeed, 0, 1);
  const direction = speed >= 0 ? 1 : -1;
  const heading = state.heading + steer * cfg.turnRate * authority * direction * dt;

  return {
    x: state.x + Math.cos(heading) * speed * dt,
    z: state.z - Math.sin(heading) * speed * dt,
    heading,
    speed,
  };
}

/** Speed in km/h for the HUD. */
export const toKmh = (speed: number): number => Math.abs(speed) * 3.6;
