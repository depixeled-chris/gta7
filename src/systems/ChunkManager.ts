import { chunkCoordOf, chunkKey, chunksInRing } from '../world/streaming';
import type { CityConfig } from '../world/City';

/**
 * Area-of-interest streaming: keeps a ring of chunks loaded around a moving
 * point, loading new ones as you approach and unloading those left behind, with
 * hysteresis (load radius < unload radius) so oscillating across a boundary
 * doesn't thrash. The actual work — generating content, building/disposing
 * meshes, registering colliders in the WorldGrid — is injected as `hooks`, so
 * this core is Three-free and unit-testable. The chunk is also the future
 * AOI/shard unit for multiplayer (see docs/research/multiplayer.md).
 */
export interface ChunkHooks {
  load(cx: number, cz: number): void;
  unload(cx: number, cz: number): void;
}

export class ChunkManager {
  private readonly loaded = new Set<string>();
  private centerCx = NaN;
  private centerCz = NaN;

  constructor(
    private readonly config: CityConfig,
    private readonly hooks: ChunkHooks,
    private readonly loadRadius = 2,
    private readonly unloadRadius = 3,
  ) {}

  /** Reconcile the loaded set to the ring around (x,z). Cheap when the player
   *  hasn't crossed a chunk boundary (recomputes only on change). */
  update(x: number, z: number): void {
    const cx = chunkCoordOf(x, this.config);
    const cz = chunkCoordOf(z, this.config);
    if (cx === this.centerCx && cz === this.centerCz && this.loaded.size > 0) return;
    this.centerCx = cx;
    this.centerCz = cz;

    // Load the ring, nearest-first (so the player's own chunk comes in first).
    for (const c of chunksInRing(cx, cz, this.loadRadius)) {
      const k = chunkKey(c.cx, c.cz);
      if (!this.loaded.has(k)) {
        this.hooks.load(c.cx, c.cz);
        this.loaded.add(k);
      }
    }
    // Unload anything past the (larger) unload radius — the hysteresis band.
    for (const k of [...this.loaded]) {
      const [lx, lz] = k.split(':').map(Number);
      if (Math.max(Math.abs(lx - cx), Math.abs(lz - cz)) > this.unloadRadius) {
        this.hooks.unload(lx, lz);
        this.loaded.delete(k);
      }
    }
  }

  loadedCount(): number {
    return this.loaded.size;
  }

  has(cx: number, cz: number): boolean {
    return this.loaded.has(chunkKey(cx, cz));
  }
}
