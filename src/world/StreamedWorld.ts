import { SpatialGrid } from '../systems/SpatialGrid';
import { ChunkManager } from '../systems/ChunkManager';
import { cellOf, chunkKey, generateChunk, makeWorldFields, type ChunkData } from './streaming';
import type { City, CityConfig, Streetlight, WorldFields } from './City';
import type { Aabb } from '../systems/Collision';

/**
 * The runtime owner of the streamed world (R007). It drives a `ChunkManager`
 * ring around the player and, as chunks load/unload, keeps the collision
 * `SpatialGrid` and the aggregate light/collider lists in sync — then forwards
 * the generated `ChunkData` to render hooks so `main` can build/pool meshes.
 *
 * Three-free and unit-tested: all rendering is injected via `hooks`, so this
 * stays in the pure world layer alongside `City`/`streaming`. It presents the
 * slice of the `City` surface the systems actually read (`grid`/`resolve`,
 * `colliders`, `streetlights`, `center`) so the streamed path can reuse them.
 */
export interface ChunkRenderHooks {
  add(cx: number, cz: number, data: ChunkData): void;
  remove(cx: number, cz: number): void;
}

interface LoadedChunk {
  colliderIds: number[];
  data: ChunkData;
}

export class StreamedWorld {
  readonly config: CityConfig;
  readonly grid: SpatialGrid;
  /** The origin is a road intersection (see streaming.ts) — a clean spawn. */
  readonly center = { x: 0, z: 0 };

  private readonly fields: WorldFields;
  private readonly manager: ChunkManager;
  private readonly loaded = new Map<string, LoadedChunk>();
  private liveStreetlights: Streetlight[] = [];
  private liveColliders: Aabb[] = [];
  private dirty = false;
  /** Side length of the loaded window — used to size the render view (fog, shadow, ground). */
  private readonly viewExtent: number;

  constructor(config: CityConfig, hooks: ChunkRenderHooks, loadRadius = 2, unloadRadius = 3) {
    this.config = config;
    this.fields = makeWorldFields(config.seed);
    this.viewExtent = cellOf(config) * config.chunkBlocks * (2 * unloadRadius + 1);
    this.grid = new SpatialGrid([], cellOf(config));
    this.manager = new ChunkManager(
      config,
      {
        load: (cx, cz) => {
          const data = generateChunk(cx, cz, config, this.fields);
          const colliderIds = data.colliders.map((c) => this.grid.insert(c));
          this.loaded.set(chunkKey(cx, cz), { colliderIds, data });
          this.dirty = true;
          hooks.add(cx, cz, data);
        },
        unload: (cx, cz) => {
          const k = chunkKey(cx, cz);
          const rec = this.loaded.get(k);
          if (rec) {
            for (const id of rec.colliderIds) this.grid.remove(id);
            this.loaded.delete(k);
            this.dirty = true;
          }
          hooks.remove(cx, cz);
        },
      },
      loadRadius,
      unloadRadius,
    );
  }

  /** Reconcile loaded chunks to the ring around (x,z); cheap within a chunk. */
  update(x: number, z: number): void {
    this.manager.update(x, z);
    if (this.dirty) {
      this.rebuildAggregates();
      this.dirty = false;
    }
  }

  /** Push a circle out of any loaded building — drop-in for `city.grid.resolve`. */
  resolve(x: number, z: number, r: number) {
    return this.grid.resolve(x, z, r);
  }

  /** Live streetlights across loaded chunks (for the dynamic light pool). */
  get streetlights(): readonly Streetlight[] {
    return this.liveStreetlights;
  }

  /** Live building colliders across loaded chunks (for police line-of-sight). */
  get colliders(): readonly Aabb[] {
    return this.liveColliders;
  }

  loadedCount(): number {
    return this.loaded.size;
  }

  has(cx: number, cz: number): boolean {
    return this.loaded.has(chunkKey(cx, cz));
  }

  /**
   * A `City`-shaped facade so the existing systems (Vehicles/Pedestrians/HUD/
   * Scene) can read the streamed world. `colliders`/`streetlights` are live
   * getters; `lanes`/`parkingSpots`/`roadCenters`/`buildings`/`props` are empty
   * (traffic/peds/parking spawn player-relative in stream mode, and meshes come
   * via the render hooks, not the up-front arrays); `half` is effectively
   * unbounded so the finite clamps become no-ops; `extent` is the loaded-window
   * size so Scene can size fog/shadows/ground (which then follow the player).
   */
  asCity(): City {
    const self = this;
    return {
      config: this.config,
      cell: cellOf(this.config),
      extent: this.viewExtent,
      half: 1e9,
      roadCenters: [],
      laneOffset: this.config.roadWidth / 4,
      buildings: [],
      props: [],
      lanes: [],
      parkingSpots: [],
      center: this.center,
      grid: this.grid,
      get colliders() {
        return self.liveColliders;
      },
      get streetlights() {
        return self.liveStreetlights;
      },
    };
  }

  private rebuildAggregates(): void {
    const lights: Streetlight[] = [];
    const cols: Aabb[] = [];
    for (const { data } of this.loaded.values()) {
      for (const s of data.streetlights) lights.push(s);
      for (const c of data.colliders) cols.push(c);
    }
    this.liveStreetlights = lights;
    this.liveColliders = cols;
  }
}
