import { type Aabb, type Vec2, resolveCircleAabb } from './Collision';

/**
 * A MUTABLE uniform spatial hash over building colliders for a streamed world.
 * Unlike `SpatialGrid` (built once over a finite city), chunks register their
 * colliders here on load and remove them on unload, so collision always covers
 * exactly the loaded region — at any world coordinate (string cell keys, so no
 * coordinate range limit).
 *
 * `resolve` is push-out-equivalent to a `resolveCircle` over the loaded boxes:
 * buildings never overlap and a small actor circle touches at most one box at a
 * time, and `resolveCircleAabb` is idempotent on a box it doesn't overlap, so a
 * box spanning several queried cells being tested twice is harmless — no dedup
 * needed. (Asserted in the unit test.)
 */
export class WorldGrid {
  private readonly cells = new Map<string, Aabb[]>();
  private readonly chunkBoxes = new Map<string, Array<{ cell: string; box: Aabb }>>();
  private readonly inv: number;

  constructor(cellSize: number) {
    this.inv = 1 / cellSize;
  }

  has(key: string): boolean {
    return this.chunkBoxes.has(key);
  }

  loadedChunks(): number {
    return this.chunkBoxes.size;
  }

  addChunk(key: string, boxes: readonly Aabb[]): void {
    if (this.chunkBoxes.has(key)) return;
    const placed: Array<{ cell: string; box: Aabb }> = [];
    for (const box of boxes) {
      const ix0 = Math.floor(box.minX * this.inv);
      const ix1 = Math.floor(box.maxX * this.inv);
      const iz0 = Math.floor(box.minZ * this.inv);
      const iz1 = Math.floor(box.maxZ * this.inv);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const ck = `${ix}:${iz}`;
          const cell = this.cells.get(ck);
          if (cell) cell.push(box);
          else this.cells.set(ck, [box]);
          placed.push({ cell: ck, box });
        }
      }
    }
    this.chunkBoxes.set(key, placed);
  }

  removeChunk(key: string): void {
    const placed = this.chunkBoxes.get(key);
    if (!placed) return;
    for (const { cell, box } of placed) {
      const arr = this.cells.get(cell);
      if (!arr) continue;
      const i = arr.indexOf(box);
      if (i >= 0) arr.splice(i, 1);
      if (arr.length === 0) this.cells.delete(cell);
    }
    this.chunkBoxes.delete(key);
  }

  /** Push a circle out of any nearby loaded box. Drop-in for `resolveCircle`. */
  resolve(cx: number, cz: number, radius: number): Vec2 {
    let x = cx;
    let z = cz;
    const ix0 = Math.floor((cx - radius) * this.inv);
    const ix1 = Math.floor((cx + radius) * this.inv);
    const iz0 = Math.floor((cz - radius) * this.inv);
    const iz1 = Math.floor((cz + radius) * this.inv);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const cell = this.cells.get(`${ix}:${iz}`);
        if (!cell) continue;
        for (const box of cell) {
          const r = resolveCircleAabb(x, z, radius, box);
          x = r.x;
          z = r.z;
        }
      }
    }
    return { x, z };
  }
}
