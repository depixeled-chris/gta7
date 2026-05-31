import { clamp } from './math';
import { Input } from './Input';
import { GamepadInput, GP } from './gamepad';
import { TouchControls } from '../ui/TouchControls';

/**
 * The single source of player intent, merging keyboard and (optional) touch.
 * Both report the same thing — an analog move vector (x: right+, y: forward+),
 * two held modifiers, and two edge-triggered actions — so the game reads one
 * abstraction instead of branching on input device.
 *
 * Steering/throttle and on-foot strafing are both derived from `move()`:
 *   driving: throttle = move.y, steer = -move.x
 *   on foot: forward  = move.y, strafe = move.x
 */
export class Controls {
  private readonly kb = new Input();
  private readonly pad = new GamepadInput();
  private readonly touch?: TouchControls;

  constructor(touchRoot?: HTMLElement) {
    if (touchRoot) this.touch = new TouchControls(touchRoot);
  }

  move(): { x: number; y: number } {
    let x = this.kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let y = this.kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (this.touch) {
      const t = this.touch.stick();
      x += t.x;
      y += t.y;
    }
    const g = this.pad.move();
    x += g.x;
    y += g.y;
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  handbrake(): boolean {
    return this.kb.isDown('Space') || (this.touch?.handbrake ?? false) || this.pad.handbrake();
  }

  sprint(): boolean {
    return (
      this.kb.isDown('ShiftLeft') ||
      this.kb.isDown('ShiftRight') ||
      (this.touch?.sprint ?? false) ||
      this.pad.sprint()
    );
  }

  enterExitPressed(): boolean {
    const key = this.kb.wasPressed('KeyF') || this.kb.wasPressed('KeyE');
    const tap = this.touch?.consumeEnter() ?? false; // always consume, never short-circuit
    const btn = this.pad.wasPressed(GP.A);
    return key || tap || btn;
  }

  resetPressed(): boolean {
    const key = this.kb.wasPressed('KeyR');
    const tap = this.touch?.consumeReset() ?? false;
    return key || tap || this.pad.wasPressed(GP.Y);
  }

  /** On-foot melee. Space (handbrake is driving-only, so it's free on foot). */
  punchPressed(): boolean {
    const key = this.kb.wasPressed('Space');
    const tap = this.touch?.consumePunch() ?? false;
    return key || tap || this.pad.wasPressed(GP.X);
  }

  /** Radio tuner step this frame: +1 next station, -1 previous, 0 none. */
  radioStep(): number {
    const next = this.kb.wasPressed('BracketRight') || this.pad.wasPressed(GP.RB);
    const prev = this.kb.wasPressed('BracketLeft') || this.pad.wasPressed(GP.LB);
    const tap = this.touch?.consumeRadio() ?? false; // touch button only goes forward
    if (next || tap) return 1;
    if (prev) return -1;
    return 0;
  }

  endFrame(): void {
    this.kb.endFrame();
    this.pad.endFrame();
  }
}
