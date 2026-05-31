import { describe, it, expect } from 'vitest';
import {
  generateChunk,
  makeWorldFields,
  chunkSpan,
  chunkCoordOf,
  chunksInRing,
  spawnLaneNear,
  cellOf,
} from './streaming';
import { DEFAULT_CITY } from './City';
import { createRng } from '../core/rng';

const cfg = DEFAULT_CITY;
const fields = makeWorldFields(cfg.seed);

describe('streaming generateChunk', () => {
  it('is deterministic — same coord+seed yields an identical chunk', () => {
    const a = generateChunk(3, -2, cfg, fields);
    const b = generateChunk(3, -2, cfg, makeWorldFields(cfg.seed));
    expect(a).toEqual(b);
  });

  it('differs by chunk coordinate and by seed (independent of visit order)', () => {
    const a = generateChunk(0, 0, cfg, fields);
    const b = generateChunk(1, 0, cfg, fields);
    expect(a.buildings).not.toEqual(b.buildings);
    const other = makeWorldFields(cfg.seed + 1);
    const c = generateChunk(0, 0, { ...cfg, seed: cfg.seed + 1 }, other);
    expect(c.buildings).not.toEqual(a.buildings);
  });

  it('emits one collider per building and one streetlight per block', () => {
    const c = generateChunk(5, 5, cfg, fields);
    expect(c.colliders.length).toBe(c.buildings.length);
    expect(c.streetlights.length).toBe(cfg.chunkBlocks * cfg.chunkBlocks);
  });

  it('generates content far from the origin (truly unbounded)', () => {
    const far = generateChunk(1000, -1000, cfg, fields);
    expect(far.streetlights.length).toBe(cfg.chunkBlocks * cfg.chunkBlocks);
    // Its streetlights sit out where that chunk actually is.
    const span = chunkSpan(cfg);
    for (const s of far.streetlights) {
      expect(s.x).toBeGreaterThan(1000 * span - 1);
      expect(s.z).toBeLessThan(-1000 * span + span + 1);
    }
  });

  it('tiles without overlap — adjacent chunks own disjoint block ranges', () => {
    const a = generateChunk(0, 0, cfg, fields);
    const b = generateChunk(1, 0, cfg, fields);
    const maxAx = Math.max(...a.streetlights.map((s) => s.x));
    const minBx = Math.min(...b.streetlights.map((s) => s.x));
    expect(minBx).toBeGreaterThan(maxAx); // chunk 1's content is east of chunk 0's
  });
});

describe('streaming helpers', () => {
  it('chunkSpan and chunkCoordOf are consistent', () => {
    const span = chunkSpan(cfg);
    expect(span).toBe(cfg.chunkBlocks * cellOf(cfg));
    expect(chunkCoordOf(0, cfg)).toBe(0);
    expect(chunkCoordOf(span - 0.01, cfg)).toBe(0);
    expect(chunkCoordOf(span, cfg)).toBe(1);
    expect(chunkCoordOf(-1, cfg)).toBe(-1);
  });

  it('chunksInRing covers the square and is nearest-first', () => {
    const ring = chunksInRing(2, 2, 1);
    expect(ring.length).toBe(9); // 3x3
    expect(ring[0]).toEqual({ cx: 2, cz: 2 }); // centre first
  });

  it('spawnLaneNear puts a car on a valid lane near the point', () => {
    const rng = createRng(7);
    for (let i = 0; i < 50; i++) {
      const r = spawnLaneNear(100, -50, rng, cfg, 60);
      expect(r.lane.axis === 'x' || r.lane.axis === 'z').toBe(true);
      expect(r.lane.dir === 1 || r.lane.dir === -1).toBe(true);
      // The car sits on its lane's fixed coordinate.
      if (r.lane.axis === 'x') expect(r.z).toBeCloseTo(r.lane.fixed, 6);
      else expect(r.x).toBeCloseTo(r.lane.fixed, 6);
    }
  });
});
