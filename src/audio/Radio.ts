import { RadioModel, type RadioStation } from './RadioModel';

/**
 * The car radio. Streams one track at a time from a CDN (the library is never
 * bundled) via a single <audio> element, driven by the pure RadioModel tuner.
 *
 * GTA-isms: it plays only while you're in a car, and tuning in (entering a car
 * or switching station) drops you into the middle of the track as if the
 * broadcast had been running all along. While a track plays, the next one is
 * prefetched so it's warm by the time it's needed. Browsers block audio until
 * a user gesture, so nothing sounds until `enterCar()` is called from input.
 */
export class Radio {
  private readonly model: RadioModel;
  private readonly audio = new Audio();
  private inCar = false;
  private started = false;
  private prefetchLink?: HTMLLinkElement;
  private errorStreak = 0;

  constructor(stations: RadioStation[]) {
    this.model = new RadioModel(stations);
    this.audio.preload = 'auto';
    this.audio.addEventListener('playing', () => (this.errorStreak = 0));
    this.audio.addEventListener('ended', () => {
      this.model.nextTrack();
      if (this.inCar) this.playCurrent(false); // let the next song play from its start
    });
    // Skip a track that won't load — but bail after a few in a row so a network
    // outage can't spin the tuner through the whole station instantly.
    this.audio.addEventListener('error', () => {
      if (!this.inCar) return;
      if (++this.errorStreak > 3) {
        this.audio.pause();
        return;
      }
      this.model.nextTrack();
      this.playCurrent(false);
    });
  }

  /**
   * Get in a car: turn on (first time), then drop onto a RANDOM track at a
   * random point, so every car sounds like its own in-progress broadcast.
   * Stay in the car and tracks roll on from their start, as expected.
   */
  enterCar(): void {
    this.inCar = true;
    if (!this.started) {
      this.started = true;
      this.model.stationIndex = 0;
    }
    this.model.tuneInRandom(); // fresh shuffle, dropped in mid-broadcast
    this.playCurrent(true);
  }

  exitCar(): void {
    this.inCar = false;
    this.audio.pause();
  }

  /** Change station (works anytime; only audible in a car). */
  step(dir: number): void {
    this.model.cycleStation(dir);
    if (this.inCar) this.playCurrent(true);
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
        this.audio.play().catch(() => {});
      };
      this.audio.addEventListener('loadedmetadata', onMeta);
    } else {
      this.audio.play().catch(() => {});
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
