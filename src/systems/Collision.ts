/**
 * Minimal collision: the world is a set of axis-aligned building footprints
 * and every moving actor is a circle on the ground plane. Resolving a circle
 * against AABBs by minimum-translation push-out is cheap, allocation-free in
 * the hot path, and pure — so it is unit-tested without a renderer.
 */
export interface Aabb {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** Push a circle out of a single AABB if it overlaps. Returns corrected center. */
export function resolveCircleAabb(
  cx: number,
  cz: number,
  radius: number,
  box: Aabb,
): Vec2 {
  const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));
  const dx = cx - closestX;
  const dz = cz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq > radius * radius) return { x: cx, z: cz };

  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    return { x: cx + (dx / dist) * push, z: cz + (dz / dist) * push };
  }

  // Center is inside the box: eject along the axis of least penetration.
  const toLeft = cx - box.minX;
  const toRight = box.maxX - cx;
  const toTop = cz - box.minZ;
  const toBottom = box.maxZ - cz;
  const minPen = Math.min(toLeft, toRight, toTop, toBottom);
  if (minPen === toLeft) return { x: box.minX - radius, z: cz };
  if (minPen === toRight) return { x: box.maxX + radius, z: cz };
  if (minPen === toTop) return { x: cx, z: box.minZ - radius };
  return { x: cx, z: box.maxZ + radius };
}

export function resolveCircle(
  cx: number,
  cz: number,
  radius: number,
  boxes: readonly Aabb[],
): Vec2 {
  let x = cx;
  let z = cz;
  for (const box of boxes) {
    const r = resolveCircleAabb(x, z, radius, box);
    x = r.x;
    z = r.z;
  }
  return { x, z };
}

/** Unit push-out separating two overlapping circles, or null if they don't touch. */
export function circleOverlap(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  rSum: number,
): { nx: number; nz: number; depth: number } | null {
  const dx = ax - bx;
  const dz = az - bz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= rSum * rSum) return null;
  // Degenerate exact overlap: pick an arbitrary but stable axis.
  if (distSq < 1e-9) return { nx: 1, nz: 0, depth: rSum };
  const dist = Math.sqrt(distSq);
  return { nx: dx / dist, nz: dz / dist, depth: rSum - dist };
}

/**
 * Impulse magnitude for a 1-D elastic-ish collision along the contact normal.
 * `vn` is the relative normal velocity (negative = approaching); `e` is
 * restitution. `j/ma` and `-j/mb` are the per-car normal-velocity changes.
 * Equal masses reduce to the old `-(1+e)·vn/2` per car. Pure.
 */
export function resolveCarImpulse(vn: number, ma: number, mb: number, e: number): number {
  return (-(1 + e) * vn) / (1 / ma + 1 / mb);
}

/** Does segment A→B cross this AABB? (2D slab test, segment param t∈[0,1].) */
function segHitsAabb(ax: number, az: number, bx: number, bz: number, box: Aabb): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.minX || ax > box.maxX) return false;
  } else {
    let t1 = (box.minX - ax) / dx;
    let t2 = (box.maxX - ax) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (az < box.minZ || az > box.maxZ) return false;
  } else {
    let t1 = (box.minZ - az) / dz;
    let t2 = (box.maxZ - az) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/** True if the line of sight A→B is blocked by any of the boxes (buildings). */
export function segmentBlocked(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  boxes: readonly Aabb[],
): boolean {
  for (const box of boxes) if (segHitsAabb(ax, az, bx, bz, box)) return true;
  return false;
}

/** Index of the nearest point within `maxDist`, or -1. */
export function nearestIndex(
  x: number,
  z: number,
  points: ReadonlyArray<Vec2>,
  maxDist: number,
): number {
  let best = -1;
  let bestSq = maxDist * maxDist;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    const d = dx * dx + dz * dz;
    if (d <= bestSq) {
      bestSq = d;
      best = i;
    }
  }
  return best;
}
