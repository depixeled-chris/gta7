import { clamp } from './math';

/**
 * Player-facing settings — the single source of truth for everything the
 * options menu controls. `sanitize` is pure (clamps/validates an untrusted
 * blob, e.g. from localStorage or a URL) so it's unit-tested; load/save are the
 * thin browser-storage glue around it.
 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface GameOptions {
  masterVolume: number; // 0..1, scales all SFX + radio
  quality: Quality; // render cost (device pixel ratio)
  dayLength: number; // seconds for a full day/night cycle
}

export const DEFAULT_OPTIONS: GameOptions = {
  masterVolume: 0.8,
  quality: 'high',
  dayLength: 480,
};

const DAY_LENGTH_RANGE = { min: 30, max: 1800 } as const;

/** Coerce an unknown blob into valid options, falling back per-field. Pure. */
export function sanitize(raw: unknown): GameOptions {
  const o = (raw ?? {}) as Partial<Record<keyof GameOptions, unknown>>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    masterVolume: clamp(num(o.masterVolume, DEFAULT_OPTIONS.masterVolume), 0, 1),
    quality: QUALITIES.includes(o.quality as Quality) ? (o.quality as Quality) : DEFAULT_OPTIONS.quality,
    dayLength: clamp(num(o.dayLength, DEFAULT_OPTIONS.dayLength), DAY_LENGTH_RANGE.min, DAY_LENGTH_RANGE.max),
  };
}

/** Device-pixel-ratio cap for each quality tier (the cheapest lever to apply live). */
export const qualityPixelRatio = (q: Quality): number =>
  q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;

const STORAGE_KEY = 'gta7.options';

export function loadOptions(): GameOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(opts: GameOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // storage disabled (private mode) — options just won't persist
  }
}
