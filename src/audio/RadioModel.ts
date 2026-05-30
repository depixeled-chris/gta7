export interface RadioTrack {
  title: string;
  url: string;
}

export interface RadioStation {
  name: string;
  tracks: RadioTrack[];
}

/**
 * Pure tuner logic for the car radio — no audio element, no DOM, so the
 * station/track index handling is unit-testable. `stationIndex === -1` means
 * the radio is off; cycling steps through OFF → station 0 → … → station N-1 →
 * OFF. Switching stations resets to its first track; tracks wrap.
 */
export class RadioModel {
  stationIndex = -1; // -1 = off
  trackIndex = 0;

  constructor(readonly stations: RadioStation[]) {}

  /** Step the station selector by dir (+1 next, -1 previous), wrapping via OFF. */
  cycleStation(dir: number): void {
    const n = this.stations.length;
    if (n === 0) return;
    let i = this.stationIndex + (dir >= 0 ? 1 : -1);
    if (i >= n) i = -1;
    else if (i < -1) i = n - 1;
    this.stationIndex = i;
    this.trackIndex = 0;
  }

  /** Advance to the next track on the current station (wraps). */
  nextTrack(): void {
    if (this.stationIndex < 0) return;
    const count = this.stations[this.stationIndex].tracks.length;
    if (count > 0) this.trackIndex = (this.trackIndex + 1) % count;
  }

  get isOn(): boolean {
    return this.stationIndex >= 0 && this.stations.length > 0;
  }

  current(): { station: string; track: RadioTrack } | null {
    if (!this.isOn) return null;
    const station = this.stations[this.stationIndex];
    const track = station.tracks[this.trackIndex];
    if (!track) return null;
    return { station: station.name, track };
  }

  /** URL of the track that will play after this one (for prefetching), or null. */
  peekNextUrl(): string | null {
    if (!this.isOn) return null;
    const tracks = this.stations[this.stationIndex].tracks;
    if (tracks.length === 0) return null;
    return tracks[(this.trackIndex + 1) % tracks.length].url;
  }

  /** Drop onto a given track index (clamped/wrapped) — used to tune in mid-broadcast. */
  setTrack(i: number): void {
    if (!this.isOn) return;
    const count = this.stations[this.stationIndex].tracks.length;
    if (count > 0) this.trackIndex = ((i % count) + count) % count;
  }
}
