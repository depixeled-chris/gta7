/** Pure camera-framing math for the chase cam. No `three`; unit-tested. */
export interface FollowParams {
  distance: number;
  height: number;
  lookHeight: number;
  stiffness: number; // higher = snappier
  speedPull?: number; // metres of distance pulled IN per m/s of speed (eye lag comp)
  slideSwing?: number; // 0..1: fraction of the lateral (powerslide) lag LEFT as on-screen swing — 0 pins the car centre, 1 lets it drift fully off
  maxSwing?: number; // hard cap (world metres) on that lateral swing — ~20% of screen at CAR_CAM
}

/**
 * The camera trails closer as speed rises so the eye's damping lag doesn't widen
 * the framing. Never closer than half the resting distance.
 */
export function followDistance(p: FollowParams, speed: number): number {
  return Math.max(p.distance * 0.5, p.distance - speed * (p.speedPull ?? 0));
}

/**
 * The look-at lead, split into forward (along heading) and lateral (perpendicular)
 * components — the caller passes the car's velocity already decomposed.
 *
 * A point damped at `stiffness` toward a target moving at velocity v settles v/stiffness
 * behind it. We **fully** lead the forward component (cancels the "car climbs toward the
 * top of the screen at speed" lag), but only **partially** lead the lateral component:
 * `slideSwing` of the lateral lag is left in (capped by `maxSwing`) so the car swings out a
 * little during a powerslide instead of being pinned dead-centre — a small, bounded drift
 * rather than the original full, excessive swing. With `slideSwing = 0` the car stays
 * centred; straight-line driving (no lateral velocity) is unaffected either way.
 */
export function lookLead(
  p: FollowParams,
  vForward: number,
  vLateral: number,
): { forward: number; lateral: number } {
  const k = p.stiffness;
  const fullLateral = vLateral / k; // the lateral lag if left entirely uncompensated
  const cap = p.maxSwing ?? Infinity;
  const swing = Math.max(-cap, Math.min(cap, fullLateral * (p.slideSwing ?? 0)));
  return { forward: vForward / k, lateral: fullLateral - swing };
}
