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
