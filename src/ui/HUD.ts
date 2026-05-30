import type { City } from '../world/City';

export type Mode = 'driving' | 'foot';

const MAP_SIZE = 190;

/**
 * DOM overlay: speedometer, current mode, control legend, and a live minimap.
 * The static map (roads + footprints) is rendered once to an offscreen canvas
 * in the constructor; each frame only the dynamic dots are composited on top.
 */
export class HUD {
  private readonly speedEl: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D;
  private readonly staticMap: HTMLCanvasElement;
  private readonly toWorld: number;
  private readonly healthFill: HTMLElement;
  private readonly wastedEl: HTMLElement;

  constructor(container: HTMLElement, private readonly city: City, touch = false) {
    this.toWorld = MAP_SIZE / city.extent;

    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;color:#e8ecf5;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;text-shadow:0 1px 3px #000;';
    container.appendChild(root);

    const speedBox = document.createElement('div');
    // On touch the action buttons own the bottom-right corner, so the readout
    // moves to the top-right (the decorative title is hidden there instead).
    speedBox.style.cssText = touch
      ? 'position:absolute;right:18px;top:12px;text-align:right;line-height:1;'
      : 'position:absolute;right:20px;bottom:20px;text-align:right;line-height:1;';
    this.speedEl = document.createElement('div');
    this.speedEl.style.cssText = `font-size:${touch ? 30 : 46}px;font-weight:700;letter-spacing:-1px;`;
    const unit = document.createElement('div');
    unit.textContent = 'KM/H';
    unit.style.cssText = 'font-size:13px;opacity:.6;margin-top:2px;';
    speedBox.append(this.speedEl, unit);
    root.appendChild(speedBox);

    this.modeEl = document.createElement('div');
    this.modeEl.style.cssText =
      'position:absolute;left:20px;top:18px;font-size:15px;font-weight:700;' +
      'padding:6px 12px;background:rgba(10,14,24,.55);border-radius:6px;backdrop-filter:blur(4px);';
    root.appendChild(this.modeEl);

    const healthTrack = document.createElement('div');
    healthTrack.style.cssText =
      'position:absolute;left:20px;top:54px;width:180px;height:12px;' +
      'background:rgba(10,14,24,.55);border-radius:6px;overflow:hidden;';
    this.healthFill = document.createElement('div');
    this.healthFill.style.cssText = 'height:100%;width:100%;background:#54ff84;transition:width .1s linear;';
    healthTrack.appendChild(this.healthFill);
    root.appendChild(healthTrack);

    this.wastedEl = document.createElement('div');
    this.wastedEl.textContent = 'WASTED';
    this.wastedEl.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
      'font-size:13vw;font-weight:800;letter-spacing:6px;color:#c0202a;' +
      'background:radial-gradient(circle,rgba(40,0,0,.35),rgba(0,0,0,.85));' +
      'text-shadow:0 4px 24px #000;font-family:Georgia,"Times New Roman",serif;';
    root.appendChild(this.wastedEl);

    const help = document.createElement('div');
    help.innerHTML =
      'WASD / Arrows — drive &nbsp;·&nbsp; Space — handbrake<br>' +
      'F — enter / exit vehicle &nbsp;·&nbsp; Shift — sprint &nbsp;·&nbsp; R — reset car';
    help.style.cssText =
      'position:absolute;left:20px;bottom:20px;font-size:12px;opacity:.7;line-height:1.6;';
    if (touch) help.style.display = 'none'; // the on-screen controls sit here instead
    root.appendChild(help);

    const title = document.createElement('div');
    title.innerHTML = 'GTA <b>7</b> <span style="opacity:.5;font-weight:400">// vertical slice</span>';
    title.style.cssText = 'position:absolute;right:20px;top:18px;font-size:15px;';
    if (touch) title.style.display = 'none'; // top-right is the speedometer on touch
    root.appendChild(title);

    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = this.mapCanvas.height = MAP_SIZE;
    this.mapCanvas.style.cssText =
      'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);' +
      'border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(8,10,16,.55);';
    if (touch) {
      // Shrink the radar so it clears the joystick/buttons; keep full internal resolution.
      this.mapCanvas.style.width = '128px';
      this.mapCanvas.style.height = '128px';
      this.mapCanvas.style.bottom = '12px';
    }
    root.appendChild(this.mapCanvas);
    this.mapCtx = this.mapCanvas.getContext('2d')!;

    this.staticMap = this.buildStaticMap();
  }

  private mapX(wx: number): number {
    return (wx + this.city.half) * this.toWorld;
  }
  private mapY(wz: number): number {
    return (wz + this.city.half) * this.toWorld;
  }

  private buildStaticMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE;
    const ctx = c.getContext('2d')!;

    ctx.strokeStyle = 'rgba(120,140,180,.55)';
    ctx.lineWidth = Math.max(1, this.city.config.roadWidth * this.toWorld * 0.6);
    for (const rc of this.city.roadCenters) {
      const p = this.mapX(rc);
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, MAP_SIZE);
      ctx.moveTo(0, p);
      ctx.lineTo(MAP_SIZE, p);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(180,200,235,.32)';
    for (const b of this.city.buildings) {
      ctx.fillRect(
        this.mapX(b.cx - b.width / 2),
        this.mapY(b.cz - b.depth / 2),
        b.width * this.toWorld,
        b.depth * this.toWorld,
      );
    }
    return c;
  }

  update(
    speedKmh: number,
    mode: Mode,
    player: { x: number; z: number; heading: number },
    cars: ReadonlyArray<{ x: number; z: number }>,
    health: number,
    wasted: boolean,
  ): void {
    this.speedEl.textContent = String(Math.round(speedKmh));
    this.modeEl.textContent = mode === 'driving' ? '🚗 DRIVING' : '🚶 ON FOOT';

    const h = Math.max(0, Math.min(100, health));
    this.healthFill.style.width = `${h}%`;
    this.healthFill.style.background = h > 50 ? '#54ff84' : h > 20 ? '#ffd24a' : '#ff5a4a';
    this.wastedEl.style.display = wasted ? 'flex' : 'none';

    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.drawImage(this.staticMap, 0, 0);

    ctx.fillStyle = '#ffd24a';
    for (const car of cars) {
      ctx.fillRect(this.mapX(car.x) - 1.5, this.mapY(car.z) - 1.5, 3, 3);
    }

    // Player as a heading arrow.
    const px = this.mapX(player.x);
    const py = this.mapY(player.z);
    const fx = Math.cos(player.heading);
    const fz = -Math.sin(player.heading);
    ctx.fillStyle = mode === 'driving' ? '#54ff84' : '#54c8ff';
    ctx.beginPath();
    ctx.moveTo(px + fx * 6, py + fz * 6);
    ctx.lineTo(px - fz * 4 - fx * 3, py + fx * 4 - fz * 3);
    ctx.lineTo(px + fz * 4 - fx * 3, py - fx * 4 - fz * 3);
    ctx.closePath();
    ctx.fill();
  }
}
