/** Pure camera-framing math for the chase cam. No `three`; unit-tested. */
export interface FollowParams {
  distance: number;
  height: number;
  lookHeight: number;
  stiffness: number; // higher = snappier
  speedPull?: number; // metres of distance pulled IN per m/s of speed (eye lag comp)
}

/**
 * The camera trails closer as speed rises so the eye's damping lag doesn't widen
 * the framing. Never closer than half the resting distance.
 */
export function followDistance(p: FollowParams, speed: number): number {
  return Math.max(p.distance * 0.5, p.distance - speed * (p.speedPull ?? 0));
}

/**
 * A point damped at `stiffness` toward a target moving with velocity `(vx, vz)` settles
 * `(vx, vz) / stiffness` behind it. The look-at is damped toward the car, so leading it by
 * the full velocity vector cancels that lag on **both** axes — keeping the car centred even
 * mid-powerslide, when travel direction diverges from heading. (A scalar, heading-aligned
 * lead misses the lateral drift, so the car slides off-centre during a slide.) Straight-line
 * driving has `v ≈ forward·speed`, so this reduces to the original forward-only lead and
 * framing-vs-speed is unchanged.
 */
export function lookLead(p: FollowParams, vx: number, vz: number): { x: number; z: number } {
  const k = p.stiffness;
  return { x: vx / k, z: vz / k };
}
