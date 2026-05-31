import { describe, it, expect } from 'vitest';
import { ChunkManager } from './ChunkManager';
import { chunkSpan, chunkKey } from '../world/streaming';
import { DEFAULT_CITY } from '../world/City';

const cfg = DEFAULT_CITY;
const span = chunkSpan(cfg);

function spyManager(loadRadius = 2, unloadRadius = 3) {
  const loads: string[] = [];
  const unloads: string[] = [];
  const m = new ChunkManager(
    cfg,
    { load: (cx, cz) => loads.push(chunkKey(cx, cz)), unload: (cx, cz) => unloads.push(chunkKey(cx, cz)) },
    loadRadius,
    unloadRadius,
  );
  return { m, loads, unloads };
}

describe('ChunkManager', () => {
  it('loads the full ring around the start position', () => {
    const { m, loads } = spyManager(2);
    m.update(0, 0); // chunk (0,0)
    expect(loads.length).toBe(25); // (2*2+1)^2
    expect(loads).toContain(chunkKey(0, 0));
    expect(loads).toContain(chunkKey(2, 2));
    expect(loads).toContain(chunkKey(-2, -2));
    expect(m.loadedCount()).toBe(25);
  });

  it('loads its own chunk first (nearest-first)', () => {
    const { m, loads } = spyManager(2);
    m.update(0, 0);
    expect(loads[0]).toBe(chunkKey(0, 0));
  });

  it('does nothing while the player stays within the same chunk', () => {
    const { m, loads } = spyManager(2);
    m.update(0, 0);
    const after = loads.length;
    m.update(span * 0.4, span * 0.4); // still chunk (0,0)
    expect(loads.length).toBe(after);
  });

  it('streams new chunks in and old ones out when crossing a boundary', () => {
    const { m, loads, unloads } = spyManager(2, 3);
    m.update(0, 0);
    loads.length = 0;
    // Walk east several chunks so some fall outside the unload radius.
    m.update(span * 4.5, 0); // chunk (4,0)
    expect(loads.length).toBeGreaterThan(0); // new eastern chunks loaded
    expect(unloads.length).toBeGreaterThan(0); // far western chunks unloaded
    expect(unloads).toContain(chunkKey(-2, 0)); // gap 6 from cx=4 > unloadRadius 3
    expect(m.has(4, 0)).toBe(true);
  });

  it('hysteresis: a one-chunk hop does not unload (load 2 < unload 3)', () => {
    const { m, unloads } = spyManager(2, 3);
    m.update(0, 0);
    m.update(span * 1.5, 0); // chunk (1,0): a chunk at -2 is now gap 3, still <= unloadRadius
    expect(unloads.length).toBe(0);
  });
});
