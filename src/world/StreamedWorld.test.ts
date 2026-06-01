import { describe, it, expect } from 'vitest';
import { StreamedWorld, type ChunkRenderHooks } from './StreamedWorld';
import { DEFAULT_CITY } from './City';
import { chunkSpan } from './streaming';

const noop: ChunkRenderHooks = { add() {}, remove() {} };

function pushed(w: StreamedWorld, x: number, z: number): boolean {
  const r = w.resolve(x, z, 1.9);
  return r.x !== x || r.z !== z;
}

describe('StreamedWorld', () => {
  it('loads the ring around the start and aggregates streetlights/colliders', () => {
    const w = new StreamedWorld(DEFAULT_CITY, noop, 2, 3);
    w.update(0, 0);
    expect(w.loadedCount()).toBe(25); // (2*2+1)^2
    expect(w.streetlights.length).toBe(25 * DEFAULT_CITY.chunkBlocks ** 2); // one lamp per block
    expect(w.colliders.length).toBeGreaterThan(0); // seed 1971's origin is built-up
  });

  it('forwards generated chunk data to the render hooks', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const w = new StreamedWorld(
      DEFAULT_CITY,
      { add: (cx, cz) => added.push(`${cx}:${cz}`), remove: (cx, cz) => removed.push(`${cx}:${cz}`) },
      1,
      2,
    );
    w.update(0, 0);
    expect(added.length).toBe(9); // 3x3 ring
    expect(removed.length).toBe(0);
  });

  it('removes a chunk’s colliders from the grid when it unloads', () => {
    const w = new StreamedWorld(DEFAULT_CITY, noop, 2, 3);
    w.update(0, 0);
    const b = w.colliders[0];
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    expect(pushed(w, x, z)).toBe(true); // inside a loaded building → pushed out

    const span = chunkSpan(DEFAULT_CITY);
    w.update(span * 20, 0); // drive far away — the origin chunks unload
    expect(w.has(0, 0)).toBe(false);
    expect(w.loadedCount()).toBe(25); // ring size holds
    expect(pushed(w, x, z)).toBe(false); // that collider is gone from the grid
  });
});
