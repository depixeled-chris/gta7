/**
 * Keyboard state with edge detection. `isDown` is level-triggered; `wasPressed`
 * is edge-triggered and consumed once per frame via `endFrame()`, which is how
 * one-shot actions (enter/exit vehicle, toggle camera) avoid re-firing.
 */
export class Input {
  private down = new Set<string>();
  private justPressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.justPressed.add(e.code);
      if (HANDLED.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** Returns -1, 0, or +1 from a pair of keys. */
  axis(negative: string[], positive: string[]): number {
    const neg = negative.some((c) => this.down.has(c)) ? 1 : 0;
    const pos = positive.some((c) => this.down.has(c)) ? 1 : 0;
    return pos - neg;
  }

  endFrame(): void {
    this.justPressed.clear();
  }
}

const HANDLED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);
