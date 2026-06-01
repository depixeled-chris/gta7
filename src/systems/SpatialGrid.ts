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
 *
 * Boxes can be added/removed at runtime (`insert`/`remove`) — the streamed world
 * (R007) loads a chunk's colliders on demand and drops them when the chunk
 * unloads. A removed slot is tombstoned (`null`) and skipped by `resolve`.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly boxes: Array<Aabb | null> = [];
  private stamp: Int32Array;
  private gen = 0;
  private readonly inv: number;

  constructor(boxes: readonly Aabb[], cellSize: number) {
    this.inv = 1 / cellSize;
    this.stamp = new Int32Array(Math.max(16, boxes.length)).fill(-1);
    for (const b of boxes) this.insert(b);
  }

  /** Add a static box; returns an id used to `remove` it later (streaming). */
  insert(box: Aabb): number {
    const id = this.boxes.length;
    this.boxes.push(box);
    if (id >= this.stamp.length) {
      const grown = new Int32Array(this.stamp.length * 2).fill(-1);
      grown.set(this.stamp);
      this.stamp = grown;
    }
    this.forEachCell(box, (k) => {
      const cell = this.cells.get(k);
      if (cell) cell.push(id);
      else this.cells.set(k, [id]);
    });
    return id;
  }

  /** Remove a previously inserted box by id (no-op if already removed). */
  remove(id: number): void {
    const box = this.boxes[id];
    if (!box) return;
    this.forEachCell(box, (k) => {
      const cell = this.cells.get(k);
      if (!cell) return;
      const at = cell.indexOf(id);
      if (at >= 0) cell.splice(at, 1);
      if (cell.length === 0) this.cells.delete(k);
    });
    this.boxes[id] = null;
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
          const box = this.boxes[bi];
          if (!box) continue;
          const r = resolveCircleAabb(x, z, radius, box);
          x = r.x;
          z = r.z;
        }
      }
    }
    return { x, z };
  }

  private forEachCell(box: Aabb, fn: (k: number) => void): void {
    const ix0 = Math.floor(box.minX * this.inv);
    const ix1 = Math.floor(box.maxX * this.inv);
    const iz0 = Math.floor(box.minZ * this.inv);
    const iz1 = Math.floor(box.maxZ * this.inv);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        fn(key(ix, iz));
      }
    }
  }
}

// Pack two small signed cell indices into one integer map key. City coords are
// a few hundred metres, so indices comfortably fit the +4096 bias / 13-bit shift.
function key(ix: number, iz: number): number {
  return ((ix + 4096) << 13) | (iz + 4096);
}
