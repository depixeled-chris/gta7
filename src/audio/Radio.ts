import { RadioModel, type RadioStation } from './RadioModel';

const HEAR_RADIUS = 30; // on foot, how far you can still hear a car's radio

/**
 * The car radio. Streams one track at a time from a CDN (the library is never
 * bundled) via a single <audio> element, driven by the pure RadioModel tuner.
 *
 * GTA-isms:
 *  - Each car remembers its own station; the first time you get into a given
 *    car it's tuned to a RANDOM station, so every car sounds different.
 *  - Tuning in drops you into the middle of a track (live-broadcast feel).
 *  - Leaving a car doesn't stop it — the radio keeps playing and fades with
 *    distance as you walk away (until out of earshot). Get back in and it's
 *    right where it would be.
 *
 * Only one car is audible at a time (the one you're in or just left) — running
 * a stream per car isn't feasible. Browsers block audio until a user gesture,
 * so nothing sounds until `enterCar()` fires from input. (Note: iOS Safari
 * ignores HTMLAudioElement.volume, so the distance fade is desktop-only there.)
 */
export class Radio {
  private readonly model: RadioModel;
  private readonly audio = new Audio();
  private readonly carStations = new Map<number, number>(); // carId -> station index
  private loadedCarId: number | null = null;
  private prefetchLink?: HTMLLinkElement;
  private errorStreak = 0;
  private masterVolume = 0.8; // 0..1 from options; scales the proximity volume

  /** Master volume (0..1) from the options menu. */
  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  constructor(stations: RadioStation[]) {
    this.model = new RadioModel(stations);
    this.audio.preload = 'auto';
    this.audio.addEventListener('playing', () => (this.errorStreak = 0));
    this.audio.addEventListener('ended', () => {
      this.model.nextTrack();
      this.playCurrent(false); // broadcast rolls on whether or not you're aboard
    });
    // Skip a track that won't load — but bail after a few in a row so a network
    // outage can't spin the tuner through the whole station instantly.
    this.audio.addEventListener('error', () => {
      if (++this.errorStreak > 3) {
        this.audio.pause();
        return;
      }
      this.model.nextTrack();
      this.playCurrent(false);
    });
  }

  /** Get into car `carId`: tune to its station (random the first time), play. */
  enterCar(carId: number): void {
    if (carId === this.loadedCarId) {
      // Back in the car that's been playing — just resume where it is.
      this.audio.volume = 1;
      if (this.model.current()) void this.audio.play().catch(() => {});
      return;
    }
    let station = this.carStations.get(carId);
    if (station === undefined) {
      station = Math.floor(Math.random() * this.model.stations.length);
      this.carStations.set(carId, station);
    }
    this.loadedCarId = carId;
    this.audio.volume = 1;
    this.model.tuneTo(station);
    this.playCurrent(true);
  }

  /** Change station (in a car); the car remembers the new choice. */
  step(dir: number): void {
    this.model.cycleStation(dir);
    if (this.loadedCarId !== null) this.carStations.set(this.loadedCarId, this.model.stationIndex);
    this.playCurrent(true);
  }

  /**
   * Per-frame: full volume in the car; on foot it ducks immediately (a clear
   * "you stepped out" change, since a cross-origin stream can't be EQ'd) and
   * then fades with distance, muted out of earshot.
   */
  updateProximity(inCar: boolean, distance: number): void {
    if (this.loadedCarId === null) return;
    const v = (inCar ? 1 : Math.max(0, 1 - distance / HEAR_RADIUS) * 0.5) * this.masterVolume;
    this.audio.volume = v;
    if (v <= 0.001) {
      if (!this.audio.paused) this.audio.pause();
    } else if (this.audio.paused && this.model.current()) {
      void this.audio.play().catch(() => {});
    }
  }

  private playCurrent(seekMiddle: boolean): void {
    const c = this.model.current();
    if (!c) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      return;
    }
    this.audio.src = c.track.url;
    this.audio.load();
    if (seekMiddle) {
      const onMeta = (): void => {
        this.audio.removeEventListener('loadedmetadata', onMeta);
        if (isFinite(this.audio.duration) && this.audio.duration > 20) {
          this.audio.currentTime = this.audio.duration * (0.05 + Math.random() * 0.5);
        }
        void this.audio.play().catch(() => {});
      };
      this.audio.addEventListener('loadedmetadata', onMeta);
    } else {
      void this.audio.play().catch(() => {});
    }
    this.prefetchNext();
  }

  /** Warm the browser cache with the upcoming track so playback never stalls. */
  private prefetchNext(): void {
    const next = this.model.peekNextUrl();
    if (!next) return;
    if (!this.prefetchLink) {
      this.prefetchLink = document.createElement('link');
      this.prefetchLink.rel = 'prefetch';
      this.prefetchLink.as = 'audio';
      document.head.appendChild(this.prefetchLink);
    }
    if (this.prefetchLink.href !== next) this.prefetchLink.href = next;
  }

  /** Short HUD label, e.g. "📻 Specter Signals I — Track 03" or "📻 OFF". */
  label(): string {
    const c = this.model.current();
    return c ? `📻 ${c.station} — ${c.track.title}` : '📻 OFF';
  }
}
