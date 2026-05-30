import { clamp } from './math';
import { Input } from './Input';
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
  private readonly touch?: TouchControls;

  constructor(touchRoot?: HTMLElement) {
    if (touchRoot) this.touch = new TouchControls(touchRoot);
  }

  move(): { x: number; y: number } {
    let x = this.kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let y = this.kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (this.touch) {
      const t = this.touch.stick();
      x = clamp(x + t.x, -1, 1);
      y = clamp(y + t.y, -1, 1);
    }
    return { x, y };
  }

  handbrake(): boolean {
    return this.kb.isDown('Space') || (this.touch?.handbrake ?? false);
  }

  sprint(): boolean {
    return this.kb.isDown('ShiftLeft') || this.kb.isDown('ShiftRight') || (this.touch?.sprint ?? false);
  }

  enterExitPressed(): boolean {
    const key = this.kb.wasPressed('KeyF') || this.kb.wasPressed('KeyE');
    const tap = this.touch?.consumeEnter() ?? false; // always consume, never short-circuit
    return key || tap;
  }

  resetPressed(): boolean {
    const key = this.kb.wasPressed('KeyR');
    const tap = this.touch?.consumeReset() ?? false;
    return key || tap;
  }

  endFrame(): void {
    this.kb.endFrame();
  }
}
