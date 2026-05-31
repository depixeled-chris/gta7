import { describe, it, expect } from 'vitest';
import { classify, BIOMES, BIOME_THRESHOLDS, type BiomeId } from './biome';

describe('classify', () => {
  const dry = 1; // above sea level

  it('returns water below sea level regardless of urbanity', () => {
    expect(classify(0, 0)).toBe('water');
    expect(classify(1, BIOME_THRESHOLDS.seaLevel - 0.01)).toBe('water');
  });

  it('maps the urbanity gradient to the density bands', () => {
    expect(classify(0.0, dry)).toBe('rural');
    expect(classify(0.4, dry)).toBe('suburb');
    expect(classify(0.65, dry)).toBe('urban');
    expect(classify(0.9, dry)).toBe('urbanCore');
  });

  it('is monotonic in urbanity (denser never classifies sparser)', () => {
    const order: BiomeId[] = ['rural', 'suburb', 'urban', 'urbanCore'];
    let last = -1;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const rank = order.indexOf(classify(u, dry));
      expect(rank).toBeGreaterThanOrEqual(last);
      last = Math.max(last, rank);
    }
  });
});

describe('BIOMES table', () => {
  it('has an entry for every biome id with self-consistent id', () => {
    for (const id of Object.keys(BIOMES) as BiomeId[]) {
      expect(BIOMES[id].id).toBe(id);
    }
  });

  it('density and traffic rise with urbanization, rural→core', () => {
    const ladder: BiomeId[] = ['rural', 'suburb', 'urban', 'urbanCore'];
    for (let i = 1; i < ladder.length; i++) {
      expect(BIOMES[ladder[i]].buildingDensity).toBeGreaterThan(BIOMES[ladder[i - 1]].buildingDensity);
      expect(BIOMES[ladder[i]].heightRange[1]).toBeGreaterThan(BIOMES[ladder[i - 1]].heightRange[1]);
      expect(BIOMES[ladder[i]].trafficDensity).toBeGreaterThanOrEqual(BIOMES[ladder[i - 1]].trafficDensity);
    }
  });

  it('water is empty', () => {
    expect(BIOMES.water.buildingDensity).toBe(0);
    expect(BIOMES.water.palette).toHaveLength(0);
    expect(BIOMES.water.facades).toHaveLength(0);
    expect(BIOMES.water.props).toHaveLength(0);
  });

  it('every buildable biome offers at least one facade style', () => {
    for (const id of Object.keys(BIOMES) as BiomeId[]) {
      if (BIOMES[id].buildingDensity > 0) expect(BIOMES[id].facades.length).toBeGreaterThan(0);
    }
  });
});
