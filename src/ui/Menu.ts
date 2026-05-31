import { type GameOptions, QUALITIES } from '../core/options';

/**
 * The game's menu overlay — a single component rendering two variants that
 * share the options + controls panels:
 *   • 'title' — shown after the splash: New Game (seed), game-mode select, Play.
 *   • 'pause' — Esc / Start mid-game: Resume, Restart.
 * It's a pointer-interactive DOM overlay (unlike HUD); the caller freezes the
 * sim (GameLoop pause) while it's open. Options edits push live + persist via
 * `onOptionsChange`. Given ids so the e2e harness can drive it.
 */
export type MenuVariant = 'title' | 'pause';

export interface MenuCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onPlay: () => void;
  onNewGame: (seed: number) => void;
  onModeChange: (mode: string) => void;
  onOptionsChange: (opts: GameOptions) => void;
}

const PANEL_BG = 'rgba(12,16,26,.92)';
const ACCENT = '#54a0ff';
const MODES = ['explore', 'delivery', 'racing'] as const;
const PLAYABLE_MODES = new Set(['explore']); // others are coming (R033)

export class Menu {
  private readonly overlay: HTMLElement;
  private readonly header: HTMLElement;
  private readonly titleActions: HTMLElement;
  private readonly pauseActions: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private opts: GameOptions;
  private mode = 'explore';
  private variant: MenuVariant = 'title';
  private open = false;

  constructor(
    container: HTMLElement,
    opts: GameOptions,
    seed: number,
    mode: string,
    private readonly cb: MenuCallbacks,
  ) {
    this.opts = { ...opts };
    this.mode = PLAYABLE_MODES.has(mode) ? mode : 'explore';

    const overlay = document.createElement('div');
    overlay.id = 'menu';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;' +
      'background:rgba(2,4,10,.6);backdrop-filter:blur(3px);' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;color:#e8ecf5;';
    this.overlay = overlay;

    const panel = document.createElement('div');
    panel.style.cssText =
      `min-width:320px;max-width:90vw;max-height:90vh;overflow:auto;padding:26px 28px;` +
      `background:${PANEL_BG};border:1px solid rgba(255,255,255,.08);border-radius:14px;` +
      'box-shadow:0 18px 60px rgba(0,0,0,.6);';
    overlay.appendChild(panel);

    this.header = document.createElement('div');
    this.header.style.cssText = 'font-weight:800;text-align:center;margin-bottom:18px;';
    panel.appendChild(this.header);

    // Title-only: game-mode select + seed/New Game.
    this.titleActions = document.createElement('div');
    this.titleActions.style.cssText = 'display:flex;flex-direction:column;gap:14px;margin-bottom:4px;';
    this.titleActions.appendChild(
      this.segmentedRow('Mode', MODES as readonly string[], this.mode, 'menu-mode', (m) => {
        if (!PLAYABLE_MODES.has(m)) return; // disabled until built
        this.mode = m;
        this.cb.onModeChange(m);
      }, (m) => PLAYABLE_MODES.has(m)),
    );
    const seedRow = document.createElement('div');
    seedRow.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:13px;';
    const seedLabel = document.createElement('span');
    seedLabel.textContent = 'Seed';
    seedLabel.style.cssText = 'width:88px;opacity:.85;';
    this.seedInput = document.createElement('input');
    this.seedInput.id = 'menu-seed';
    this.seedInput.type = 'number';
    this.seedInput.value = String(seed);
    this.seedInput.style.cssText =
      'flex:1;min-width:0;padding:7px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.15);' +
      'background:rgba(255,255,255,.06);color:#e8ecf5;font-family:inherit;font-size:13px;';
    seedRow.append(seedLabel, this.seedInput);
    this.titleActions.appendChild(seedRow);
    panel.appendChild(this.titleActions);

    panel.appendChild(this.optionsSection());
    panel.appendChild(this.controlsSection());

    // Action rows (one per variant).
    this.titleActions.appendChild(document.createElement('div')); // spacer handled by gap
    const titleBtns = document.createElement('div');
    titleBtns.style.cssText = 'display:flex;gap:10px;margin-top:20px;';
    titleBtns.append(
      this.button('Play', () => this.cb.onPlay(), 'menu-play', true),
      this.button('New Game', () => this.cb.onNewGame(this.chosenSeed()), 'menu-newgame', false),
    );
    panel.appendChild(titleBtns);

    this.pauseActions = document.createElement('div');
    this.pauseActions.style.cssText = 'display:flex;gap:10px;margin-top:20px;';
    this.pauseActions.append(
      this.button('Resume', () => this.cb.onResume(), 'menu-resume', true),
      this.button('Restart', () => this.cb.onRestart(), 'menu-restart', false),
    );
    panel.appendChild(this.pauseActions);

    // titleBtns belongs to the title variant; track it for show/hide.
    this.titleButtons = titleBtns;

    container.appendChild(overlay);
    this.applyVariant();
  }

  private titleButtons!: HTMLElement;

  private chosenSeed(): number {
    const v = Number(this.seedInput.value);
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  }

  private optionsSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:14px;margin-top:14px;';
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
    const line = (html: string): HTMLElement => {
      const d = document.createElement('div');
      d.innerHTML = html; // static literal — no untrusted content
      return d;
    };
    const h = document.createElement('b');
    h.textContent = 'CONTROLS';
    h.style.opacity = '.9';
    wrap.append(
      h,
      line('Drive — WASD / arrows · <b>Space</b> handbrake · <b>F</b> enter/exit · <b>[ ]</b> radio'),
      line('On foot — WASD · <b>Shift</b> sprint · <b>Space</b> punch · <b>F</b> enter car'),
      line('Gamepad — RT/LT throttle · stick steer · <b>A</b> enter / hold sprint · <b>B</b> handbrake · <b>X</b> punch'),
      line('<b>Esc</b> / Start — pause · <b>R</b> reset'),
    );
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
    enabled: (choice: string) => boolean = () => true,
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
        const el = c as HTMLElement;
        const on = el.dataset.value === selected;
        el.style.background = on ? ACCENT : 'rgba(255,255,255,.08)';
        el.style.color = on ? '#06122a' : '#e8ecf5';
      });
    };
    choices.forEach((choice) => {
      const ok = enabled(choice);
      const b = document.createElement('button');
      b.textContent = choice + (ok ? '' : ' (soon)');
      b.dataset.value = choice;
      b.disabled = !ok;
      b.style.cssText =
        'flex:1;padding:6px 4px;border:none;border-radius:6px;text-transform:capitalize;' +
        `font-family:inherit;font-size:12px;cursor:${ok ? 'pointer' : 'not-allowed'};opacity:${ok ? 1 : 0.4};`;
      b.addEventListener('click', () => {
        if (!ok) return;
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

  private applyVariant(): void {
    const title = this.variant === 'title';
    this.header.textContent = title ? 'GTA 7 — Guns, Traffic & Anarchy' : 'PAUSED';
    this.header.style.fontSize = title ? '18px' : '22px';
    this.header.style.letterSpacing = title ? '1px' : '4px';
    this.titleActions.style.display = title ? 'flex' : 'none';
    this.titleButtons.style.display = title ? 'flex' : 'none';
    this.pauseActions.style.display = title ? 'none' : 'flex';
  }

  isOpen(): boolean {
    return this.open;
  }

  openAs(variant: MenuVariant): void {
    this.variant = variant;
    this.applyVariant();
    this.open = true;
    this.overlay.style.display = 'flex';
  }

  close(): void {
    this.open = false;
    this.overlay.style.display = 'none';
  }
}
