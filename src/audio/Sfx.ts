import { engineToneHz } from '../core/math';

/**
 * Synthesized sound effects via the Web Audio API — no audio files. An engine
 * drone whose pitch tracks speed, tyre screech from filtered noise, a noise
 * "crunch" for gibs, and short blips for getting in/out. The context is created
 * and resumed on the first user gesture (autoplay policy); every method no-ops
 * until then, so it's safe to call anytime.
 */
const MASTER_BOOST = 2.2; // internal headroom boost; user volume scales this

export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private engineOsc?: OscillatorNode;
  private engineGain?: GainNode;
  private screechGain?: GainNode;
  private started = false;
  private masterVolume = 0.8; // 0..1 from options; scales the internal boost

  start(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_BOOST * this.masterVolume; // a compressor tames the peaks
    // Limiter so the boosted gain doesn't clip harshly when effects stack.
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.noise = this.makeNoise(1);

    // Engine: a sawtooth through a lowpass; frequency rises with speed.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 50;
    this.engineOsc.connect(lp);
    lp.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();

    // Tyre screech: looping noise through a resonant bandpass, gated by gain.
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300;
    bp.Q.value = 6;
    const screech = ctx.createBufferSource();
    screech.buffer = this.noise;
    screech.loop = true;
    screech.connect(bp);
    bp.connect(this.screechGain);
    this.screechGain.connect(this.master);
    screech.start();

    void ctx.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx!.sampleRate * seconds);
    const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Continuous engine note. Pitch follows a faked automatic gearbox (rises
   * through a gear, drops on the upshift). `volume` (0–1) lets it idle quietly
   * at a parked car and fade with distance as you walk away; pass 0 to silence.
   */
  setEngine(speed01: number, volume: number): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.06, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(engineToneHz(speed01), t, 0.05);
  }

  /** Master volume (0..1) from the options menu; applied live. */
  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(MASTER_BOOST * this.masterVolume, this.ctx.currentTime, 0.02);
    }
  }

  /** A dull footstep tap — audible over the engine/ambient bed. */
  footstep(): void {
    this.burst(0.08, 340, 0.32);
  }

  /** Tyre screech level (0–1) — driven by lateral slip / hard braking. */
  setScreech(amount01: number): void {
    if (!this.ctx || !this.screechGain) return;
    const a = Math.max(0, Math.min(1, amount01));
    this.screechGain.gain.setTargetAtTime(a * 0.13, this.ctx.currentTime, 0.05);
  }

  gib(): void {
    this.burst(0.18, 520, 0.32);
  }
  /** A car wreck: a low, long noise boom with a pitch-down thud under it. */
  explosion(): void {
    this.burst(0.7, 240, 0.6);
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
  }
  enterCar(): void {
    this.blip(340, 0.12);
  }
  exitCar(): void {
    this.blip(190, 0.12);
  }

  private burst(dur: number, cutoff: number, peak: number): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  private blip(freq: number, dur: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }
}
