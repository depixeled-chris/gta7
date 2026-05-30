import { stickVector } from '../core/math';

/**
 * On-screen controls for touch devices: a left analog joystick (steer +
 * throttle when driving, move direction on foot) and right-hand action
 * buttons. Exposes the same shape of intent the keyboard does — an analog
 * move vector plus held/edge buttons — so `Controls` can merge the two
 * without either side knowing about the other.
 *
 * Pointer events (not touch events) drive it, so Chromium's synthetic touch in
 * tests and real fingers both work; move/up are tracked on `window` so a drag
 * that slides off the knob keeps following.
 */
export class TouchControls {
  private readonly vec = { x: 0, y: 0 };
  private brakeHeld = false;
  private sprintHeld = false;
  private enterEdge = false;
  private resetEdge = false;

  private stickPointer: number | null = null;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly radius = 58;

  constructor(root: HTMLElement) {
    root.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:5;' +
      'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';

    this.base = div(
      root,
      'tc-stick',
      'position:absolute;left:26px;bottom:26px;width:140px;height:140px;border-radius:50%;' +
        'background:rgba(20,26,40,.4);border:2px solid rgba(255,255,255,.18);pointer-events:auto;touch-action:none;',
    );
    this.knob = div(
      this.base,
      'tc-knob',
      'position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;' +
        'background:rgba(230,238,255,.55);border:2px solid rgba(255,255,255,.5);pointer-events:none;',
    );

    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.vec.x = 0;
      this.vec.y = 0;
      this.knob.style.transform = 'translate(0px,0px)';
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // A 2x2 grid keeps every button on screen even on a short landscape phone
    // (a tall column pushed the top button off the top edge).
    const pad = div(
      root,
      'tc-buttons',
      'position:absolute;right:20px;bottom:20px;display:grid;grid-template-columns:repeat(2,66px);' +
        'grid-auto-rows:66px;gap:12px;pointer-events:none;',
    );
    this.holdButton(pad, 'tc-enter', 'F', 'enter / exit', () => (this.enterEdge = true));
    this.holdButton(
      pad,
      'tc-brake',
      '✋',
      'handbrake',
      () => (this.brakeHeld = true),
      () => (this.brakeHeld = false),
    );
    this.holdButton(
      pad,
      'tc-sprint',
      '»',
      'sprint',
      () => (this.sprintHeld = true),
      () => (this.sprintHeld = false),
    );
    this.holdButton(pad, 'tc-reset', '⟲', 'reset', () => (this.resetEdge = true));
  }

  private moveStick(clientX: number, clientY: number): void {
    const r = this.base.getBoundingClientRect();
    const v = stickVector(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), this.radius);
    this.vec.x = v.x;
    this.vec.y = v.y;
    this.knob.style.transform = `translate(${v.x * this.radius}px,${-v.y * this.radius}px)`;
  }

  private holdButton(
    parent: HTMLElement,
    id: string,
    glyph: string,
    label: string,
    onDown: () => void,
    onUp?: () => void,
  ): void {
    const b = div(
      parent,
      id,
      'width:66px;height:66px;border-radius:50%;pointer-events:auto;touch-action:none;' +
        'display:flex;align-items:center;justify-content:center;font-size:27px;' +
        'background:rgba(20,26,40,.55);border:2px solid rgba(255,255,255,.22);color:#e8ecf5;',
    );
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => {
      onDown();
      b.style.background = 'rgba(90,120,180,.7)';
      e.preventDefault();
    });
    const up = (e: PointerEvent): void => {
      if (onUp) onUp();
      b.style.background = 'rgba(20,26,40,.55)';
      e.preventDefault();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }

  stick(): { x: number; y: number } {
    return this.vec;
  }
  get handbrake(): boolean {
    return this.brakeHeld;
  }
  get sprint(): boolean {
    return this.sprintHeld;
  }
  consumeEnter(): boolean {
    const e = this.enterEdge;
    this.enterEdge = false;
    return e;
  }
  consumeReset(): boolean {
    const r = this.resetEdge;
    this.resetEdge = false;
    return r;
  }
}

function div(parent: HTMLElement, id: string, css: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = css;
  parent.appendChild(el);
  return el;
}
