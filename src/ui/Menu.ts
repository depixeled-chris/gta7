import { type GameOptions, QUALITIES } from '../core/options';

/**
 * In-game pause menu + options panel (a DOM overlay, like HUD/Splash, but
 * pointer-interactive). The simulation is frozen by the caller (GameLoop pause)
 * while this is open; the menu only renders controls and reports intent through
 * callbacks. Options edits are pushed live via `onOptionsChange` so the player
 * hears/sees the effect immediately. Given ids so the e2e harness can drive it.
 */
export interface MenuCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onOptionsChange: (opts: GameOptions) => void;
}

const PANEL_BG = 'rgba(12,16,26,.92)';
const ACCENT = '#54a0ff';

export class Menu {
  private readonly overlay: HTMLElement;
  private opts: GameOptions;
  private open = false;

  constructor(container: HTMLElement, opts: GameOptions, private readonly cb: MenuCallbacks) {
    this.opts = { ...opts };

    const overlay = document.createElement('div');
    overlay.id = 'menu';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;' +
      'background:rgba(2,4,10,.55);backdrop-filter:blur(3px);' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;color:#e8ecf5;';
    this.overlay = overlay;

    const panel = document.createElement('div');
    panel.style.cssText =
      `min-width:300px;max-width:90vw;padding:26px 28px;background:${PANEL_BG};` +
      'border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.6);';
    overlay.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'PAUSED';
    title.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:4px;margin-bottom:18px;text-align:center;';
    panel.appendChild(title);

    panel.appendChild(this.optionsSection());
    panel.appendChild(this.controlsSection());

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;margin-top:20px;';
    buttons.append(
      this.button('Resume', () => this.cb.onResume(), 'menu-resume', true),
      this.button('Restart', () => this.cb.onRestart(), 'menu-restart', false),
    );
    panel.appendChild(buttons);

    container.appendChild(overlay);
  }

  private optionsSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    wrap.appendChild(
      this.sliderRow('Volume', 0, 1, 0.05, this.opts.masterVolume, 'menu-volume', (v) => {
        this.opts = { ...this.opts, masterVolume: v };
        this.cb.onOptionsChange(this.opts);
      }),
    );

    wrap.appendChild(
      this.segmentedRow('Quality', QUALITIES as readonly string[], this.opts.quality, 'menu-quality', (q) => {
        this.opts = { ...this.opts, quality: q as GameOptions['quality'] };
        this.cb.onOptionsChange(this.opts);
      }),
    );

    wrap.appendChild(
      this.sliderRow('Day length', 30, 1800, 30, this.opts.dayLength, 'menu-daylength', (v) => {
        this.opts = { ...this.opts, dayLength: v };
        this.cb.onOptionsChange(this.opts);
      }),
    );
    return wrap;
  }

  private controlsSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);' +
      'font-size:11px;line-height:1.7;opacity:.75;';
    wrap.innerHTML =
      '<b style="opacity:.9">CONTROLS</b><br>' +
      'Drive — WASD / arrows · <b>Space</b> handbrake · <b>F</b> enter/exit · <b>[ ]</b> radio<br>' +
      'On foot — WASD · <b>Shift</b> sprint · <b>Space</b> punch · <b>F</b> enter car<br>' +
      'Gamepad — RT/LT throttle · stick steer · <b>A</b> enter / hold sprint · <b>B</b> handbrake · <b>X</b> punch<br>' +
      '<b>Esc</b> / Start — pause · <b>R</b> reset';
    return wrap;
  }

  private sliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    id: string,
    onInput: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;';
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:88px;opacity:.85;';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = `flex:1;accent-color:${ACCENT};`;
    input.addEventListener('input', () => onInput(Number(input.value)));
    row.append(name, input);
    return row;
  }

  private segmentedRow(
    label: string,
    choices: readonly string[],
    selected: string,
    id: string,
    onPick: (choice: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;';
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:88px;opacity:.85;';
    const group = document.createElement('div');
    group.id = id;
    group.style.cssText = 'display:flex;gap:6px;flex:1;';
    const paint = (): void => {
      [...group.children].forEach((c) => {
        const on = (c as HTMLElement).dataset.value === selected;
        (c as HTMLElement).style.background = on ? ACCENT : 'rgba(255,255,255,.08)';
        (c as HTMLElement).style.color = on ? '#06122a' : '#e8ecf5';
      });
    };
    choices.forEach((choice) => {
      const b = document.createElement('button');
      b.textContent = choice;
      b.dataset.value = choice;
      b.style.cssText =
        'flex:1;padding:6px 0;border:none;border-radius:6px;cursor:pointer;text-transform:capitalize;' +
        'font-family:inherit;font-size:12px;';
      b.addEventListener('click', () => {
        selected = choice;
        paint();
        onPick(choice);
      });
      group.appendChild(b);
    });
    paint();
    row.append(name, group);
    return row;
  }

  private button(label: string, onClick: () => void, id: string, primary: boolean): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.id = id;
    b.style.cssText =
      'flex:1;padding:11px 0;border:none;border-radius:8px;cursor:pointer;font-family:inherit;' +
      `font-size:14px;font-weight:700;color:${primary ? '#06122a' : '#e8ecf5'};` +
      `background:${primary ? ACCENT : 'rgba(255,255,255,.1)'};`;
    b.addEventListener('click', onClick);
    return b;
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.overlay.style.display = open ? 'flex' : 'none';
  }

  toggle(): void {
    this.setOpen(!this.open);
  }
}
