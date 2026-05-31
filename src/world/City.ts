import { createRng, hashSeed } from '../core/rng';
import { makeNoise2D, fbm, type Noise2D } from '../core/noise';
import { classify, BIOMES, type BiomeDef, type FacadeStyle, type PropType } from './biome';
import type { Aabb } from '../systems/Collision';
import { SpatialGrid } from '../systems/SpatialGrid';

export interface Building {
  cx: number; // footprint center
  cz: number;
  width: number; // along X
  depth: number; // along Z
  height: number;
  color: number; // base facade tint
  style: FacadeStyle; // facade texture family
}

/** A drivable lane: a straight segment with a travel direction. */
export interface Lane {
  axis: 'x' | 'z'; // the axis the lane runs along
  fixed: number; // the other coordinate (lane center)
  dir: 1 | -1; // travel direction along `axis`
}

/** A streetlight position (lamp sits on a pole at this ground point). */
export interface Streetlight {
  x: number;
  z: number;
}

/** A sidewalk prop (tree / hydrant / bench) at a ground point. */
export interface Prop {
  x: number;
  z: number;
  type: PropType;
  rot: number; // facing (radians) — matters for benches
}

/** A curbside parking spot: where a parked car sits and which way it faces. */
export interface ParkingSpot {
  x: number;
  z: number;
  heading: number;
}

export interface CityConfig {
  seed: number;
  grid: number; // blocks per side
  blockSize: number; // building-area side length
  roadWidth: number;
  chunkBlocks: number; // blocks per side of one generation chunk
}

export interface City {
  config: CityConfig;
  cell: number; // blockSize + roadWidth
  extent: number; // total side length (centered on origin)
  half: number;
  roadCenters: number[]; // shared by both axes (square grid)
  laneOffset: number; // distance from road center to a lane
  buildings: Building[];
  colliders: Aabb[];
  /** Spatial hash over `colliders`; the collision-query authority (see SpatialGrid). */
  grid: SpatialGrid;
  lanes: Lane[];
  streetlights: Streetlight[];
  props: Prop[];
  parkingSpots: ParkingSpot[];
  /** A road intersection near the middle — a good place to spawn the player. */
  center: { x: number; z: number };
}

export const DEFAULT_CITY: CityConfig = {
  seed: 1971,
  grid: 8,
  blockSize: 42,
  roadWidth: 16,
  chunkBlocks: 4, // 8x8 grid → 2x2 generation chunks
};

/** Shared geometry derived from a config: cell pitch, total extent, half-extent. */
function metrics(config: CityConfig): { cell: number; extent: number; half: number } {
  const cell = config.blockSize + config.roadWidth;
  const extent = config.grid * cell + config.roadWidth; // trailing road closes the grid
  return { cell, extent, half: extent / 2 };
}

/**
 * Continuous, seed-derived noise fields sampled at absolute world coordinates.
 * Because every chunk samples the same fields at the same world point, the
 * biome gradient is continuous across chunk seams for free. Created once per
 * world and shared across chunks (elevation/water join in a later phase).
 */
export interface WorldFields {
  urbanity: Noise2D;
}

export function makeWorldFields(seed: number): WorldFields {
  return { urbanity: makeNoise2D(hashSeed(seed, 'urbanity')) };
}

const URBANITY_FREQ = 0.012; // a few districts span the current finite city

/** Normalized urbanity (0–1) at a world point — drives the city→rural gradient. */
export function urbanityAt(fields: WorldFields, wx: number, wz: number): number {
  const n = fbm(fields.urbanity, wx, wz, { octaves: 4, frequency: URBANITY_FREQ });
  return Math.max(0, Math.min(1, 0.5 + n * 1.35)); // contrast-stretch toward the extremes
}

/**
 * Generate one chunk's worth of buildings + colliders: the blocks in the square
 * [cx,cz] of `chunkBlocks×chunkBlocks` blocks, in world coordinates. Seeded by
 * `hashSeed(seed, cx, cz)`, so a chunk is identical regardless of when/how it's
 * generated — the determinism the streamed world relies on. Blocks past the
 * finite `grid` are skipped (the current world is a finite tiling of chunks).
 */
export function generateChunk(
  cx: number,
  cz: number,
  config: CityConfig = DEFAULT_CITY,
  fields: WorldFields = makeWorldFields(config.seed),
): { buildings: Building[]; colliders: Aabb[]; props: Prop[] } {
  const { grid, blockSize, roadWidth, chunkBlocks } = config;
  const { cell, half } = metrics(config);
  const rng = createRng(hashSeed(config.seed, cx, cz));
  const buildings: Building[] = [];
  const colliders: Aabb[] = [];
  const props: Prop[] = [];

  for (let bi = 0; bi < chunkBlocks; bi++) {
    for (let bj = 0; bj < chunkBlocks; bj++) {
      const gi = cx * chunkBlocks + bi; // global block index
      const gj = cz * chunkBlocks + bj;
      if (gi >= grid || gj >= grid) continue;
      const blockX = gi * cell + roadWidth - half;
      const blockZ = gj * cell + roadWidth - half;
      // The biome at this block sets its building density, height and palette.
      const u = urbanityAt(fields, blockX + blockSize / 2, blockZ + blockSize / 2);
      const biome = BIOMES[classify(u, 1)]; // elevation=1 (dry) until water lands
      addBlock(blockX, blockZ, blockSize, rng, biome, buildings, colliders);
      addProps(blockX, blockZ, blockSize, rng, biome, colliders, props);
    }
  }
  return { buildings, colliders, props };
}


export function generateCity(config: CityConfig = DEFAULT_CITY): City {
  const { grid, blockSize, roadWidth, chunkBlocks } = config;
  const { cell, extent, half } = metrics(config);

  // World is centered on the origin: shift every generated coordinate by -half.
  const roadCenters: number[] = [];
  for (let i = 0; i <= grid; i++) {
    roadCenters.push(i * cell + roadWidth / 2 - half);
  }

  // Buildings come from a tiling of independently-seeded chunks (the same path a
  // streamed world will load on demand), so the finite city is just chunk (0,0)..(n,n).
  const buildings: Building[] = [];
  const colliders: Aabb[] = [];
  const props: Prop[] = [];
  const fields = makeWorldFields(config.seed); // built once, shared across chunks
  const chunksPerSide = Math.ceil(grid / chunkBlocks);
  for (let cx = 0; cx < chunksPerSide; cx++) {
    for (let cz = 0; cz < chunksPerSide; cz++) {
      const chunk = generateChunk(cx, cz, config, fields);
      buildings.push(...chunk.buildings);
      colliders.push(...chunk.colliders);
      props.push(...chunk.props);
    }
  }

  const laneOffset = roadWidth / 4;
  const lanes = buildLanes(roadCenters, half, laneOffset);
  const streetlights = buildStreetlights(roadCenters, roadWidth);
  // Parking gets its own deterministic stream, independent of per-chunk building RNG.
  const parkingRng = createRng(hashSeed(config.seed, 'parking'));
  const parkingSpots = buildParkingSpots(roadCenters, cell, blockSize, roadWidth, half, parkingRng, colliders);

  // Spawn at the central intersection of the grid.
  const mid = roadCenters[Math.floor(roadCenters.length / 2)];

  return {
    config,
    cell,
    extent,
    half,
    roadCenters,
    laneOffset,
    buildings,
    colliders,
    grid: new SpatialGrid(colliders, cell),
    lanes,
    streetlights,
    props,
    parkingSpots,
    center: { x: mid, z: mid },
  };
}

/** Nudge a hex colour's brightness by ±`amt` (deterministic via rng). Pure int math (no THREE). */
function jitterBrightness(hex: number, rng: ReturnType<typeof createRng>, amt: number): number {
  const f = 1 + (rng.next() * 2 - 1) * amt;
  const ch = (shift: number): number => {
    const v = Math.round(((hex >> shift) & 0xff) * f);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function addBlock(
  originX: number,
  originZ: number,
  size: number,
  rng: ReturnType<typeof createRng>,
  biome: BiomeDef,
  buildings: Building[],
  colliders: Aabb[],
): void {
  if (biome.buildingDensity <= 0) return; // e.g. water — nothing built here

  const margin = 3; // sidewalk gap between facade and curb
  // Denser biomes subdivide into more, smaller lots; sparse biomes stay open.
  const lots = rng.chance(0.3 + biome.buildingDensity * 0.5) ? 2 : 1;
  const lotSize = size / lots;
  const [hMin, hMax] = biome.heightRange;

  for (let li = 0; li < lots; li++) {
    for (let lj = 0; lj < lots; lj++) {
      // The biome's density is the per-lot occupancy: rural blocks are mostly
      // empty, cores almost fully built.
      if (!rng.chance(biome.buildingDensity)) continue;

      const lotX = originX + li * lotSize;
      const lotZ = originZ + lj * lotSize;
      const width = lotSize - margin * 2;
      const depth = lotSize - margin * 2;
      if (width < 4 || depth < 4) continue;

      const cx = lotX + lotSize / 2;
      const cz = lotZ + lotSize / 2;
      const height = rng.range(hMin, hMax);
      const style = rng.pick(biome.facades);

      // Per-building brightness jitter on the biome tint, so a block of the same
      // palette still reads as many distinct buildings rather than clones.
      const color = jitterBrightness(rng.pick(biome.palette), rng, 0.18);
      buildings.push({ cx, cz, width, depth, height, color, style });

      const hw = width / 2;
      const hd = depth / 2;
      colliders.push({ minX: cx - hw, minZ: cz - hd, maxX: cx + hw, maxZ: cz + hd });
    }
  }
}

/**
 * Scatter sidewalk props along a block's perimeter (inset onto the sidewalk
 * strip, clear of the road and of building footprints). Biome sets how many and
 * which kinds. Corners are skipped so props don't land in road intersections.
 */
export function addProps(
  originX: number,
  originZ: number,
  size: number,
  rng: ReturnType<typeof createRng>,
  biome: BiomeDef,
  colliders: Aabb[],
  props: Prop[],
): void {
  if (biome.propDensity <= 0 || biome.props.length === 0) return;
  const inset = 1.6; // onto the sidewalk, between curb and building line
  const slots = Math.max(2, Math.floor(size / 9)); // ~9 m spacing along an edge
  const span = size - inset * 2;

  for (let edge = 0; edge < 4; edge++) {
    for (let k = 1; k < slots; k++) {
      if (!rng.chance(biome.propDensity)) continue;
      const t = (k / slots) * span + inset;
      let x: number;
      let z: number;
      if (edge === 0) { x = originX + inset; z = originZ + t; }
      else if (edge === 1) { x = originX + size - inset; z = originZ + t; }
      else if (edge === 2) { x = originX + t; z = originZ + inset; }
      else { x = originX + t; z = originZ + size - inset; }
      x += rng.range(-0.8, 0.8);
      z += rng.range(-0.8, 0.8);
      if (insideAnyCollider(x, z, colliders, 0.6)) continue;
      props.push({ x, z, type: rng.pick(biome.props), rot: rng.range(0, Math.PI * 2) });
    }
  }
}

function buildLanes(roadCenters: number[], half: number, laneOffset: number): Lane[] {
  const lanes: Lane[] = [];
  // Skip the two outermost roads so traffic stays inside the visible city.
  for (let i = 1; i < roadCenters.length - 1; i++) {
    const fixed = roadCenters[i];
    if (Math.abs(fixed) > half) continue;
    lanes.push({ axis: 'x', fixed: fixed - laneOffset, dir: 1 });
    lanes.push({ axis: 'x', fixed: fixed + laneOffset, dir: -1 });
    lanes.push({ axis: 'z', fixed: fixed - laneOffset, dir: -1 });
    lanes.push({ axis: 'z', fixed: fixed + laneOffset, dir: 1 });
  }
  return lanes;
}

/** One lamp on the curb corner of every road intersection. */
function buildStreetlights(roadCenters: number[], roadWidth: number): Streetlight[] {
  const curb = roadWidth / 2 + 1.2;
  const lights: Streetlight[] = [];
  for (const x of roadCenters) {
    for (const z of roadCenters) {
      lights.push({ x: x + curb, z: z + curb });
    }
  }
  return lights;
}

/**
 * Curbside parked cars: a chance of one car per block edge, hugging the curb
 * just outside the moving-traffic lanes and aligned with the road. Spots that
 * would clip a building are dropped.
 */
function buildParkingSpots(
  roadCenters: number[],
  cell: number,
  blockSize: number,
  roadWidth: number,
  half: number,
  rng: ReturnType<typeof createRng>,
  colliders: Aabb[],
): ParkingSpot[] {
  const offset = roadWidth / 2 + 0.3; // at the curb, clear of the lanes
  const fill = 0.22;
  const grid = roadCenters.length - 1;
  const spots: ParkingSpot[] = [];

  const blockCenter = (b: number): number => b * cell + roadWidth + blockSize / 2 - half;

  const tryAdd = (x: number, z: number, heading: number): void => {
    if (!rng.chance(fill)) return;
    if (insideAnyCollider(x, z, colliders, 2)) return;
    spots.push({ x, z, heading });
  };

  for (const rc of roadCenters) {
    for (let b = 0; b < grid; b++) {
      const along = blockCenter(b);
      // Parked along a road running on the Z axis (car faces ±Z).
      const sx = rng.chance(0.5) ? 1 : -1;
      tryAdd(rc + sx * offset, along, rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      // Parked along a road running on the X axis (car faces ±X).
      const sz = rng.chance(0.5) ? 1 : -1;
      tryAdd(along, rc + sz * offset, rng.chance(0.5) ? 0 : Math.PI);
    }
  }
  return spots;
}

function insideAnyCollider(x: number, z: number, colliders: Aabb[], pad: number): boolean {
  for (const c of colliders) {
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) {
      return true;
    }
  }
  return false;
}
