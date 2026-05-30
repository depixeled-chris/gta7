import { type Aabb, type Vec2, resolveCircleAabb } from './Collision';

/**
 * A uniform spatial hash over static AABBs (building footprints). The previous
 * collision path scanned every collider for every actor each step — O(actors ×
 * colliders). This buckets each box into the grid cells it spans once, so a
 * circle only tests the handful of boxes in its own cell neighborhood.
 *
 * It is the single collision-query authority: `resolve` is push-out-equivalent
 * to `resolveCircle` over the full set, because city buildings never overlap and
 * a small actor circle can touch at most one box at a time (a per-query stamp
 * guarantees each box is resolved at most once even when it spans cells). That
 * equivalence is asserted in the unit test, so this stays Three-free and pure.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Int32Array;
  private gen = 0;
  private readonly inv: number;

  constructor(
    private readonly boxes: readonly Aabb[],
    cellSize: number,
  ) {
    this.inv = 1 / cellSize;
    this.stamp = new Int32Array(boxes.length).fill(-1);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const ix0 = Math.floor(b.minX * this.inv);
      const ix1 = Math.floor(b.maxX * this.inv);
      const iz0 = Math.floor(b.minZ * this.inv);
      const iz1 = Math.floor(b.maxZ * this.inv);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = key(ix, iz);
          const cell = this.cells.get(k);
          if (cell) cell.push(i);
          else this.cells.set(k, [i]);
        }
      }
    }
  }

  /** Push a circle out of any nearby box. Drop-in for `resolveCircle`. */
  resolve(cx: number, cz: number, radius: number): Vec2 {
    let x = cx;
    let z = cz;
    const gen = ++this.gen;
    const ix0 = Math.floor((cx - radius) * this.inv);
    const ix1 = Math.floor((cx + radius) * this.inv);
    const iz0 = Math.floor((cz - radius) * this.inv);
    const iz1 = Math.floor((cz + radius) * this.inv);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const cell = this.cells.get(key(ix, iz));
        if (!cell) continue;
        for (const bi of cell) {
          if (this.stamp[bi] === gen) continue;
          this.stamp[bi] = gen;
          const r = resolveCircleAabb(x, z, radius, this.boxes[bi]);
          x = r.x;
          z = r.z;
        }
      }
    }
    return { x, z };
  }
}

// Pack two small signed cell indices into one integer map key. City coords are
// a few hundred metres, so indices comfortably fit the +4096 bias / 13-bit shift.
function key(ix: number, iz: number): number {
  return ((ix + 4096) << 13) | (iz + 4096);
}
