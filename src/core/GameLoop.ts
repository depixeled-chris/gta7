/**
 * Fixed-timestep loop. Physics advances in constant `step` increments so the
 * simulation is stable and reproducible regardless of display refresh rate;
 * rendering happens once per animation frame. The accumulator is clamped to
 * avoid the "spiral of death" after a tab stall.
 */
export class GameLoop {
  private readonly step: number;
  private readonly maxFrame: number;
  private accumulator = 0;
  private last = 0;
  private running = false;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
    stepHz = 60,
  ) {
    this.step = 1 / stepHz;
    this.maxFrame = this.step * 5;
  }

  start(now = performance.now()): void {
    this.running = true;
    this.last = now;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.last) / 1000;
    this.last = now;
    if (frameTime > this.maxFrame) frameTime = this.maxFrame;
    this.accumulator += frameTime;

    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }
    this.render();
    requestAnimationFrame(this.frame);
  };
}
