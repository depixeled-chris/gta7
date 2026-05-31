/**
 * Biome model: a pure classifier plus a single data table of per-biome
 * generation parameters. The city-core → urban → suburb → rural → water gradient
 * is derived from continuous noise fields (an `urbanity` field + an `elevation`
 * field for water), then everything that differs per biome lives in `BIOMES` as
 * DATA — never scattered `if (biome === …)` branches. Pure and node-testable.
 *
 * `density` is meant to be used as a continuous 0–1 too: a generator can lerp
 * within `heightRange` and treat `buildingDensity` as a per-lot spawn chance, so
 * cores come out tall+dense and rural sparse+low from one number.
 */
export type BiomeId = 'water' | 'rural' | 'suburb' | 'urban' | 'urbanCore';

/** Facade texture family — picked per building so a biome isn't all glass towers. */
export type FacadeStyle = 'glass' | 'brick' | 'concrete';

/** Sidewalk dressing placed along block edges. */
export type PropType = 'tree' | 'hydrant' | 'bench';

export interface BiomeDef {
  id: BiomeId;
  buildingDensity: number; // per-lot spawn probability (0–1)
  heightRange: [number, number]; // metres
  lotSize: number; // smaller = denser blocks
  trafficDensity: number; // 0–1, relative ambient car count
  pedDensity: number; // 0–1, relative ambient pedestrian count
  palette: number[]; // facade tints for this biome
  facades: FacadeStyle[]; // facade texture families that appear here
  propDensity: number; // 0–1 chance of a prop at each sidewalk slot
  props: PropType[]; // street dressing that appears here
}

/**
 * Classification thresholds on a normalized `urbanity` field (0–1) and the
 * `elevation` sea level. Kept in one object because tuning these is expected
 * (Red Blob's repeated warning) and they must stay a single source of truth.
 */
export const BIOME_THRESHOLDS = {
  seaLevel: 0.35, // elevation below this is water
  urbanCore: 0.78,
  urban: 0.58,
  suburb: 0.32,
} as const;

export const BIOMES: Record<BiomeId, BiomeDef> = {
  water: {
    id: 'water',
    buildingDensity: 0,
    heightRange: [0, 0],
    lotSize: 0,
    trafficDensity: 0,
    pedDensity: 0,
    palette: [],
    facades: [],
    propDensity: 0,
    props: [],
  },
  rural: {
    id: 'rural',
    buildingDensity: 0.15,
    heightRange: [5, 11],
    lotSize: 64,
    trafficDensity: 0.2,
    pedDensity: 0.1,
    palette: [0x6b5d4f, 0x7a6a55, 0x5e5346, 0x837256],
    facades: ['brick'], // low houses/barns
    propDensity: 0.55,
    props: ['tree'], // leafy
  },
  suburb: {
    id: 'suburb',
    buildingDensity: 0.5,
    heightRange: [8, 20],
    lotSize: 40,
    trafficDensity: 0.5,
    pedDensity: 0.4,
    palette: [0x8a8f9c, 0x9aa0ad, 0x7c828f, 0xa79f95],
    facades: ['brick', 'concrete'], // houses + small commercial
    propDensity: 0.45,
    props: ['tree', 'hydrant'],
  },
  urban: {
    id: 'urban',
    buildingDensity: 0.8,
    heightRange: [18, 46],
    lotSize: 30,
    trafficDensity: 0.85,
    pedDensity: 0.8,
    palette: [0x3b4252, 0x434c5e, 0x4c566a, 0x5e6472],
    facades: ['glass', 'concrete'], // mid-rise offices + towers
    propDensity: 0.35,
    props: ['hydrant', 'bench', 'tree'],
  },
  urbanCore: {
    id: 'urbanCore',
    buildingDensity: 0.95,
    heightRange: [40, 95],
    lotSize: 26,
    trafficDensity: 1,
    pedDensity: 1,
    palette: [0x2e3440, 0x39414f, 0x3b4252, 0x2b3a55],
    facades: ['glass'], // glass skyscrapers
    propDensity: 0.35,
    props: ['hydrant', 'bench'],
  },
};

/**
 * Classify a point from its normalized `urbanity` (0–1) and `elevation` (0–1)
 * fields. Below sea level is water; otherwise the urbanity bands map to the
 * density gradient. (A `moisture` field will join this when vegetation lands;
 * kept out for now so the classifier stays minimal.)
 */
export function classify(urbanity: number, elevation: number): BiomeId {
  if (elevation < BIOME_THRESHOLDS.seaLevel) return 'water';
  if (urbanity >= BIOME_THRESHOLDS.urbanCore) return 'urbanCore';
  if (urbanity >= BIOME_THRESHOLDS.urban) return 'urban';
  if (urbanity >= BIOME_THRESHOLDS.suburb) return 'suburb';
  return 'rural';
}
