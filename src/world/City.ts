import { createRng } from '../core/rng';
import type { Aabb } from '../systems/Collision';

export interface Building {
  cx: number; // footprint center
  cz: number;
  width: number; // along X
  depth: number; // along Z
  height: number;
  color: number; // base facade tint
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
  lanes: Lane[];
  streetlights: Streetlight[];
  parkingSpots: ParkingSpot[];
  /** A road intersection near the middle — a good place to spawn the player. */
  center: { x: number; z: number };
}

export const DEFAULT_CITY: CityConfig = {
  seed: 1971,
  grid: 8,
  blockSize: 42,
  roadWidth: 16,
};

// Dusk-city facade palette: muted concrete and glass tones.
const PALETTE = [0x3b4252, 0x434c5e, 0x4c566a, 0x2e3440, 0x5e6472, 0x39414f];

export function generateCity(config: CityConfig = DEFAULT_CITY): City {
  const rng = createRng(config.seed);
  const { grid, blockSize, roadWidth } = config;
  const cell = blockSize + roadWidth;
  const extent = grid * cell + roadWidth; // trailing road closes the grid
  const half = extent / 2;

  // World is centered on the origin: shift every generated coordinate by -half.
  const roadCenters: number[] = [];
  for (let i = 0; i <= grid; i++) {
    roadCenters.push(i * cell + roadWidth / 2 - half);
  }

  const buildings: Building[] = [];
  const colliders: Aabb[] = [];

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const blockX = i * cell + roadWidth - half;
      const blockZ = j * cell + roadWidth - half;
      addBlock(blockX, blockZ, blockSize, rng, buildings, colliders);
    }
  }

  const laneOffset = roadWidth / 4;
  const lanes = buildLanes(roadCenters, half, laneOffset);
  const streetlights = buildStreetlights(roadCenters, roadWidth);
  const parkingSpots = buildParkingSpots(roadCenters, cell, blockSize, roadWidth, half, rng, colliders);

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
    lanes,
    streetlights,
    parkingSpots,
    center: { x: mid, z: mid },
  };
}

function addBlock(
  originX: number,
  originZ: number,
  size: number,
  rng: ReturnType<typeof createRng>,
  buildings: Building[],
  colliders: Aabb[],
): void {
  const margin = 3; // sidewalk gap between facade and curb
  // Each block is split into a 1x1 or 2x2 set of lots for visual variety.
  const lots = rng.chance(0.55) ? 2 : 1;
  const lotSize = size / lots;

  for (let li = 0; li < lots; li++) {
    for (let lj = 0; lj < lots; lj++) {
      if (lots === 2 && rng.chance(0.12)) continue; // occasional empty lot / plaza

      const lotX = originX + li * lotSize;
      const lotZ = originZ + lj * lotSize;
      const width = lotSize - margin * 2;
      const depth = lotSize - margin * 2;
      if (width < 4 || depth < 4) continue;

      const cx = lotX + lotSize / 2;
      const cz = lotZ + lotSize / 2;
      const tall = rng.chance(0.18);
      const height = tall
        ? rng.range(40, 95) // skyscrapers punctuate the skyline
        : rng.range(8, 28);

      buildings.push({
        cx,
        cz,
        width,
        depth,
        height,
        color: rng.pick(PALETTE),
      });

      const hw = width / 2;
      const hd = depth / 2;
      colliders.push({
        minX: cx - hw,
        minZ: cz - hd,
        maxX: cx + hw,
        maxZ: cz + hd,
      });
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
