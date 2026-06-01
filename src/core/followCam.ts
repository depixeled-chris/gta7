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
 * A point damped toward a target moving at `speed` settles `speed / stiffness`
 * behind it. The look-at point is damped toward the car, so with no compensation it
 * lags by that much and the car climbs toward the top of the screen as speed rises.
 * Leading the look-at forward by the lag cancels it, keeping the car framed
 * consistently — the look-at analog of `speedPull` for the eye.
 */
export function lookLead(p: FollowParams, speed: number): number {
  return speed / p.stiffness;
}
