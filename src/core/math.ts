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

/** Interpolate between two angles along the shortest arc (for render smoothing). */
export const angleLerp = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

/** Map a 0–100 "heat" meter to a 0–5 wanted-star rating. */
export const starsFromHeat = (heat: number): number =>
  Math.max(0, Math.min(5, Math.ceil(heat / 20)));

/**
 * Interception lead time for a pursuer: how far ahead to aim, based on the gap
 * and the closing speed (pursuer + target speed), capped so a sharp turn
 * doesn't send the pursuer to fantasy positions. (Reynolds "pursue".)
 */
export const leadTime = (gap: number, pursuerSpeed: number, targetSpeed: number, maxLead: number): number =>
  Math.min(maxLead, gap / Math.max(1e-3, pursuerSpeed + targetSpeed));

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

/**
 * Virtual-joystick output. Given a drag offset in screen space (dx right+,
 * dy down+) and a knob radius, returns a vector clamped to the unit disc with
 * y flipped so up = +1 (forward). Pure, so the touch mapping is testable.
 */
export const stickVector = (dx: number, dy: number, radius: number): { x: number; y: number } => {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  const scale = Math.min(len, radius) / radius / len;
  return { x: dx * scale, y: -dy * scale };
};
