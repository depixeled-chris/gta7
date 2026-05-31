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

/**
 * Rubber-band chase speed: a pursuer cruises at `base` when close and ramps
 * toward `max` the further the target pulls away, so a fast quarry can't simply
 * leave police standing. `gain` is the extra m/s of speed per metre of gap.
 */
export const pursuitSpeed = (gap: number, base: number, max: number, gain: number): number =>
  Math.min(max, base + Math.max(0, gap) * gain);

/**
 * Daylight factor (0 = full night, 1 = noon) for a time-of-day in [0,1) where
 * 0 is midnight. A clamped sine: dark before dawn (0.25) and after dusk (0.75),
 * peaking at noon (0.5). Pure, so the day/night curve is testable.
 */
export const daylightFactor = (t: number): number => Math.max(0, Math.sin((t - 0.25) * Math.PI * 2));

/**
 * Unit direction toward the sun for time-of-day `t` (0 = midnight). The sun
 * rises in the east (+X) at t=0.25, is overhead at noon (t=0.5), and sets in
 * the west (−X) at t=0.75 — so shadows sweep across the city through the day.
 * Elevation is floored just above the horizon so the directional light never
 * drops underground (which would invert shadows); a constant south tilt keeps
 * shadows off the exact grid axes. Pure → the arc is unit-tested.
 */
export const sunPosition = (t: number): { x: number; y: number; z: number } => {
  const angle = (t - 0.25) * Math.PI * 2;
  const x = Math.cos(angle);
  const y = Math.max(0.12, Math.sin(angle));
  const z = 0.35;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
};

/**
 * Engine note frequency for a faked automatic gearbox. Normalized speed (0–1)
 * is split into `gears`; within each gear the pitch ramps idle→idle+span, then
 * drops back to idle at the upshift — the classic rising-then-dropping engine
 * sound. Pure, so the shift behavior is unit-testable.
 */
export const engineToneHz = (
  speed01: number,
  gears = 5,
  idleHz = 48,
  spanHz = 80,
): number => {
  const s = clamp(speed01, 0, 1);
  const g = Math.min(gears - 1, Math.floor(s * gears));
  const within = s * gears - g; // 0..1 progress through the current gear
  return idleHz + within * spanHz;
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
