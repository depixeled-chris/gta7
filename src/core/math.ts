export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate-independent exponential smoothing. `lambda` is the decay rate:
 * higher = snappier. Derived so the result is stable regardless of dt.
 */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Shortest signed angular difference (radians) from `a` to `b`, in (-PI, PI]. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const moveToward = (current: number, target: number, maxDelta: number): number => {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
};

/**
 * Highest speed from which you can still stop within `gap` at deceleration
 * `decel` (v = sqrt(2·a·d)). Used so AI cars brake for a pedestrian ahead —
 * and, when the gap is too small, physically can't stop in time.
 */
export const safeApproachSpeed = (gap: number, decel: number): number =>
  Math.sqrt(2 * decel * Math.max(0, gap));
