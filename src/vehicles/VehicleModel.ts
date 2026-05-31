import { clamp } from '../core/math';

/**
 * Arcade vehicle dynamics with a real velocity vector and tyre grip — NOT a
 * rigid-body sim, but enough to powerslide. Velocity is tracked in world space
 * and decomposed each step into forward/lateral components relative to the
 * car's heading. Lateral grip bleeds off sideways velocity; the handbrake
 * slashes that grip, so the car keeps its momentum while the nose swings round
 * — i.e. it drifts. Pure and deterministic (no Three.js, no globals).
 *
 * Coordinate convention matches the renderer: world X = east, Z = south,
 * heading 0 points toward +X and increases counter-clockwise (toward -Z), so
 * forward = (cos h, -sin h) and right = (sin h, cos h).
 */
export interface VehicleState {
  x: number;
  z: number;
  heading: number; // radians
  vx: number; // world velocity
  vz: number;
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
  drag: number; // proportional air drag per second
  rollingResistance: number; // constant deceleration (m/s^2)
  turnRate: number; // rad/s at full steering authority
  gripSpeed: number; // speed (m/s) at which steering reaches full authority
  gripNormal: number; // lateral grip (1/s) with tyres planted
  gripHandbrake: number; // lateral grip with the handbrake locked (low = slide)
  handbrakeDrag: number; // extra deceleration while the handbrake is held
  handbrakeSteer: number; // steering multiplier while sliding (flickability)
}

export const DEFAULT_VEHICLE: VehicleConfig = {
  enginePower: 13, // lower accel: it takes a while to wind up to top speed
  brakePower: 34,
  reverseMaxSpeed: 16,
  maxSpeed: 90, // ~200 mph — fast enough that the readout matches the sensation
  drag: 0.06, // light drag so the high top speed is reachable
  rollingResistance: 4,
  turnRate: 2.7,
  gripSpeed: 9,
  gripNormal: 10,
  gripHandbrake: 0.7,
  handbrakeDrag: 4,
  handbrakeSteer: 1.4,
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

  let { vx, vz } = state;
  const cosH = Math.cos(state.heading);
  const sinH = Math.sin(state.heading);
  const fx = cosH; // forward
  const fz = -sinH;

  // Engine / brake force along the current forward axis.
  const vForward = vx * fx + vz * fz;
  if (throttle !== 0) {
    const opposing =
      (vForward > EPS && throttle < 0) || (vForward < -EPS && throttle > 0);
    const accel = opposing ? cfg.brakePower : cfg.enginePower;
    vx += fx * throttle * accel * dt;
    vz += fz * throttle * accel * dt;
  }

  // Rolling resistance + handbrake drag oppose the velocity vector directly.
  const speed = Math.hypot(vx, vz);
  if (speed > 1e-5) {
    const decel = (cfg.rollingResistance + (input.handbrake ? cfg.handbrakeDrag : 0)) * dt;
    const factor = Math.max(0, 1 - decel / speed);
    vx *= factor;
    vz *= factor;
  }
  vx -= vx * cfg.drag * dt;
  vz -= vz * cfg.drag * dt;

  // Steering rotates the heading; authority ramps with speed and flips in
  // reverse. The handbrake makes it flickier. We only invert for a GENUINE
  // reverse (backing up with grip): mid-drift the nose swings past 90° from the
  // travel direction, so the forward projection goes negative even though the
  // car is still sailing forward — inverting there would pin the slide at 90°.
  const authority = clamp(Math.hypot(vx, vz) / cfg.gripSpeed, 0, 1);
  const dir = vForward < -EPS && !input.handbrake ? -1 : 1;
  const steerMul = input.handbrake ? cfg.handbrakeSteer : 1;
  const heading = state.heading + steer * cfg.turnRate * authority * dir * steerMul * dt;

  // Re-decompose velocity against the NEW heading and bleed off the lateral
  // component by the active grip. High grip realigns velocity to the nose
  // (crisp turn); low grip (handbrake) preserves the slide.
  const nfx = Math.cos(heading);
  const nfz = -Math.sin(heading);
  const nrx = Math.sin(heading); // right
  const nrz = Math.cos(heading);
  let forward = vx * nfx + vz * nfz;
  let lateral = vx * nrx + vz * nrz;

  const grip = input.handbrake ? cfg.gripHandbrake : cfg.gripNormal;
  lateral *= Math.exp(-grip * dt);
  forward = clamp(forward, -cfg.reverseMaxSpeed, cfg.maxSpeed);

  vx = nfx * forward + nrx * lateral;
  vz = nfz * forward + nrz * lateral;

  return { x: state.x + vx * dt, z: state.z + vz * dt, heading, vx, vz };
}

/** Total speed magnitude (m/s). */
export const speedOf = (s: VehicleState): number => Math.hypot(s.vx, s.vz);

/** Signed speed along the heading (negative = reversing). */
export const forwardSpeedOf = (s: VehicleState): number =>
  s.vx * Math.cos(s.heading) - s.vz * Math.sin(s.heading);

/** Sideways slip speed — magnitude is how hard the car is drifting. */
export const lateralSpeedOf = (s: VehicleState): number =>
  s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);

/** Speed magnitude in km/h for the HUD. */
export const toKmh = (speed: number): number => Math.abs(speed) * 3.6;

/** Speed magnitude in mph for the HUD. */
export const toMph = (speed: number): number => Math.abs(speed) * 2.236936;

/** Full body integrity of an undamaged car. */
export const CAR_MAX_HEALTH = 100;

// Cars are tough. Bumps and scrapes shrug off entirely, and even a flat-out
// crash only takes a chunk: damage per impact saturates at MAX_SINGLE_IMPACT
// (30% of health), so wrecking an intact car takes four hard hits or sustained
// ramming — not a single fender-bender.
const DAMAGE_FREE_SPEED = 12; // m/s of impact you can shrug off entirely
const DAMAGE_SCALE = 1; // health lost per m/s above the free threshold
const MAX_SINGLE_IMPACT = CAR_MAX_HEALTH * 0.3; // no single hit takes more than 30%

/** Damage from one impact at `impactSpeed` (m/s of closing/into-wall velocity). */
export const crashDamage = (impactSpeed: number): number =>
  Math.min(MAX_SINGLE_IMPACT, Math.max(0, Math.abs(impactSpeed) - DAMAGE_FREE_SPEED) * DAMAGE_SCALE);
