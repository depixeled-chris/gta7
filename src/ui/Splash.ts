/**
 * Start splash: the title image (`public/splash.png`) centered on black,
 * aspect-preserved (letterboxed — never stretched). Click / tap / any key /
 * any gamepad button continues. Transition is fade-to-black then fade-from-
 * black: the image fades out leaving pure black, then the black fades away to
 * reveal the game. The first gesture also unlocks audio (autoplay policy).
 * Given an id so the e2e harness can remove it before testing.
 */
export function showSplash(container: HTMLElement, onContinue?: () => void): void {
  const overlay = document.createElement('div');
  overlay.id = 'splash';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100;background:#000;display:flex;' +
    'align-items:center;justify-content:center;transition:opacity .6s ease;' +
    'touch-action:none;cursor:pointer;';

  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}splash.png`;
  img.alt = 'GTA 7 — Guns, Traffic & Anarchy';
  // Fit centered, preserve aspect ratio; black fills the leftover space.
  img.style.cssText = 'max-width:100%;max-height:100%;width:auto;height:auto;display:block;transition:opacity .4s ease;';
  overlay.appendChild(img);

  const hint = document.createElement('div');
  hint.textContent = 'Click to continue';
  hint.style.cssText =
    'position:absolute;bottom:7%;left:0;right:0;text-align:center;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;' +
    'color:rgba(255,255,255,.7);text-shadow:0 1px 3px #000;transition:opacity .4s ease;' +
    'animation:splashPulse 1.4s ease-in-out infinite;';
  const style = document.createElement('style');
  style.textContent = '@keyframes splashPulse{0%,100%{opacity:.35}50%{opacity:.9}}';
  overlay.append(style, hint);

  container.appendChild(overlay);

  let dismissed = false;
  let padRaf = 0;

  const cleanup = (): void => {
    removeEventListener('pointerdown', dismiss);
    removeEventListener('keydown', dismiss);
    cancelAnimationFrame(padRaf);
  };

  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    onContinue?.(); // unlock audio — covers the gamepad path (no DOM gesture event)
    cleanup();
    // Phase 1 — fade the title out to pure black.
    img.style.opacity = '0';
    hint.style.opacity = '0';
    hint.style.animation = 'none';
    // Phase 2 — fade the black away, revealing (fading in) the game.
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 650);
    }, 420);
  };

  addEventListener('pointerdown', dismiss);
  addEventListener('keydown', dismiss);

  // Gamepads aren't event-driven — poll for any pressed button while shown.
  const pollPad = (): void => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.buttons.some((b) => b.pressed)) {
        dismiss();
        return;
      }
    }
    padRaf = requestAnimationFrame(pollPad);
  };
  padRaf = requestAnimationFrame(pollPad);

  // Test hook: tear the splash down instantly (cancels the poll + listeners),
  // instead of removing the element and leaking the rAF loop.
  (window as Window & { __skipSplash?: () => void }).__skipSplash = (): void => {
    cleanup();
    overlay.remove();
  };
}
