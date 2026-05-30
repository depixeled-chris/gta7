export interface RadioTrack {
  title: string;
  url: string;
}

export interface RadioStation {
  name: string;
  tracks: RadioTrack[];
}

/**
 * Pure tuner logic for the car radio — no audio element, no DOM, so it's
 * unit-testable. `stationIndex === -1` means off; cycling steps OFF → station 0
 * → … → OFF. Each station plays a SHUFFLED order (Fisher–Yates): every track
 * once before any repeats, and a reshuffle never replays the track that just
 * finished. The RNG is injectable so the shuffle is deterministic in tests.
 */
export class RadioModel {
  stationIndex = -1; // -1 = off
  private order: number[] = []; // shuffled track indices for the current station
  private pos = 0; // index into `order`

  constructor(
    readonly stations: RadioStation[],
    private readonly rand: () => number = Math.random,
  ) {}

  get isOn(): boolean {
    return this.stationIndex >= 0 && this.stations.length > 0;
  }

  /** Index into the current station's track list (derived from the shuffle). */
  get trackIndex(): number {
    return this.order.length ? this.order[this.pos] : 0;
  }

  cycleStation(dir: number): void {
    const n = this.stations.length;
    if (n === 0) return;
    let i = this.stationIndex + (dir >= 0 ? 1 : -1);
    if (i >= n) i = -1;
    else if (i < -1) i = n - 1;
    this.stationIndex = i;
    this.reshuffle();
  }

  /** Tune in mid-broadcast: fresh shuffle, dropped at a random point in it. */
  tuneInRandom(): void {
    this.reshuffle();
    if (this.order.length) this.pos = Math.floor(this.rand() * this.order.length);
  }

  /** Jump to a specific station (clamped) and tune in mid-broadcast. */
  tuneTo(stationIndex: number): void {
    if (this.stations.length === 0) return;
    this.stationIndex = Math.max(0, Math.min(this.stations.length - 1, stationIndex));
    this.tuneInRandom();
  }

  nextTrack(): void {
    if (!this.isOn || this.order.length === 0) return;
    this.pos++;
    if (this.pos >= this.order.length) {
      const justPlayed = this.order[this.order.length - 1];
      this.reshuffle();
      // Avoid the new order opening with the track we just heard.
      if (this.order.length > 1 && this.order[0] === justPlayed) {
        [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
      }
    }
  }

  current(): { station: string; track: RadioTrack } | null {
    if (!this.isOn) return null;
    const station = this.stations[this.stationIndex];
    const track = station.tracks[this.trackIndex];
    return track ? { station: station.name, track } : null;
  }

  /** URL of the next track in the shuffle (for prefetch), or null at the boundary. */
  peekNextUrl(): string | null {
    if (!this.isOn || this.pos + 1 >= this.order.length) return null;
    return this.stations[this.stationIndex].tracks[this.order[this.pos + 1]].url;
  }

  private reshuffle(): void {
    this.pos = 0;
    const n = this.isOn ? this.stations[this.stationIndex].tracks.length : 0;
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    this.order = a;
  }
}
