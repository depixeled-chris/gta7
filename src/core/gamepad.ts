import { clamp } from './math';

/**
 * Gamepad support via the Web Gamepad API (see docs/research/gamepad-support.md).
 * The MAPPING is a pure function (`readGamepadIntent`) so it's node-unit-tested;
 * `GamepadInput` is thin browser glue that polls each frame and does edge
 * detection, mirroring the untested keyboard `Input`.
 */

export const STICK_DEADZONE = 0.12;
export const TRIGGER_DEADZONE = 0.06;

/** W3C "standard gamepad" button indices we use. */
export const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10 } as const;

/**
 * Radial deadzone: treat (x,y) as a vector, ignore magnitude below `dz`, and
 * rescale `dz..1` → `0..1` so directional sensitivity stays uniform (no axis
 * bias, no drift). Pure.
 */
export function radialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= dz) return { x: 0, y: 0 };
  const scale = Math.min(1, (mag - dz) / (1 - dz)) / mag;
  return { x: x * scale, y: y * scale };
}

export interface GamepadIntent {
  x: number; // steer / strafe (right +)
  y: number; // throttle / forward (forward +)
  handbrake: boolean;
  sprint: boolean;
}

const trigger = (v: number | undefined): number => {
  const x = v ?? 0;
  return x > TRIGGER_DEADZONE ? x : 0;
};

/**
 * Map a standard gamepad's axes + button values to the analog move intent.
 * Left stick steers/moves; the triggers (RT−LT) add throttle so driving feels
 * right. Sticks use `axes` (up is −1, so forward = −y); triggers are analog
 * `button.value`. Pure.
 */
export function readGamepadIntent(axes: readonly number[], buttonValues: readonly number[]): GamepadIntent {
  const stick = radialDeadzone(axes[0] ?? 0, axes[1] ?? 0, STICK_DEADZONE);
  const throttle = trigger(buttonValues[GP.RT]) - trigger(buttonValues[GP.LT]);
  return {
    x: stick.x,
    y: clamp(-stick.y + throttle, -1, 1),
    handbrake: (buttonValues[GP.B] ?? 0) > 0.5,
    sprint: (buttonValues[GP.L3] ?? 0) > 0.5,
  };
}

/**
 * Thin per-frame poller with button edge detection. Picks the first connected
 * `mapping === "standard"` pad fresh each frame (indices shift on connect/
 * disconnect). No-ops where the Gamepad API is absent. Not unit-tested (browser
 * glue) — the mapping above is the tested part.
 */
export class GamepadInput {
  private polledThisFrame = false;
  private intent: GamepadIntent | null = null;
  private down: boolean[] = [];
  private justPressed = new Set<number>();

  private poll(): void {
    if (this.polledThisFrame) return;
    this.polledThisFrame = true;
    const pads =
      typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        gp = p;
        break;
      }
    }
    if (!gp) {
      this.intent = null;
      return;
    }
    this.intent = readGamepadIntent(gp.axes, gp.buttons.map((b) => b.value));
    for (let i = 0; i < gp.buttons.length; i++) {
      const pressed = gp.buttons[i].pressed;
      if (pressed && !this.down[i]) this.justPressed.add(i);
      this.down[i] = pressed;
    }
  }

  move(): { x: number; y: number } {
    this.poll();
    return this.intent ? { x: this.intent.x, y: this.intent.y } : { x: 0, y: 0 };
  }

  handbrake(): boolean {
    this.poll();
    return this.intent?.handbrake ?? false;
  }

  sprint(): boolean {
    this.poll();
    return this.intent?.sprint ?? false;
  }

  /** Edge-triggered: true the frame `button` transitions to pressed. */
  wasPressed(button: number): boolean {
    this.poll();
    return this.justPressed.has(button);
  }

  endFrame(): void {
    this.polledThisFrame = false;
    this.justPressed.clear();
  }
}
