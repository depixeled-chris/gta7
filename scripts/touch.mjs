// Touch / mobile e2e: loads the game in a touch-enabled mobile context and
// verifies the on-screen controls exist and actually drive the game — the
// joystick accelerates the car, the action button toggles in/out of the car —
// then confirms a normal desktop context shows no touch UI.
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = process.env.URL ? null : await preview({ preview: { port: 5183 } });
const BASE = process.env.URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

const center = async (page, sel) => {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

try {
  // --- Mobile context: touch + small landscape viewport.
  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 820, height: 400 },
  });
  const page = await mobile.newPage();
  page.on('pageerror', (e) => check('no page errors (mobile)', false, e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__skipSplash?.()); // skip the start splash (clean teardown)

  const present = await page.evaluate(() =>
    ['tc-stick', 'tc-knob', 'tc-enter', 'tc-brake', 'tc-sprint', 'tc-reset', 'tc-punch'].every((id) =>
      document.getElementById(id),
    ),
  );
  check('on-screen controls render on a touch device', present);

  // Buttons use real (lucide) SVG icons, and a fullscreen toggle is present.
  const iconified = await page.evaluate(() => ({
    enterHasSvg: !!document.querySelector('#tc-enter svg'),
    radioHasSvg: !!document.querySelector('#tc-radio svg'),
    fullscreen: !!document.getElementById('tc-fullscreen'),
    noFglyph: !/\bF\b/.test(document.getElementById('tc-enter').textContent || ''),
  }));
  check(
    'touch buttons use SVG icons + fullscreen toggle present',
    iconified.enterHasSvg && iconified.radioHasSvg && iconified.fullscreen && iconified.noFglyph,
    JSON.stringify(iconified),
  );

  // Joystick: push up and the car should accelerate from rest.
  const stick = await center(page, '#tc-stick');
  await page.evaluate((p) => {
    document
      .getElementById('tc-stick')
      .dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: p.x, clientY: p.y, bubbles: true }));
  }, stick);
  await page.evaluate((p) => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: p.x, clientY: p.y - 55, bubbles: true }),
    );
  }, stick);
  // Poll while the stick is held — the slow headless renderer under-steps the
  // (deliberately gentle) acceleration in a fixed wait.
  let speed = 0;
  for (let i = 0; i < 30 && speed <= 6; i++) {
    await page.waitForTimeout(150);
    speed = await page.evaluate(() => {
      const v = window.__game.vehicles;
      const c = v.cars[v.playerIndex];
      return Math.hypot(c.vx, c.vz);
    });
  }
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
  check('joystick drives the car forward', speed > 6, `speed=${speed.toFixed(1)} m/s`);

  // Action button: tap it to get out, tap again to get back in.
  const enter = await center(page, '#tc-enter');
  await page.evaluate(() => { // stop the car so stepping out lands cleanly
    const v = window.__game.vehicles; const c = v.cars[v.playerIndex]; c.vx = 0; c.vz = 0;
  });
  await page.touchscreen.tap(enter.x, enter.y);
  let afterExit = 'driving';
  for (let i = 0; i < 20 && afterExit !== 'foot'; i++) {
    await page.waitForTimeout(100);
    afterExit = await page.evaluate(() => window.__game.mode);
  }
  await page.touchscreen.tap(enter.x, enter.y);
  let afterEnter = 'foot';
  for (let i = 0; i < 20 && afterEnter !== 'driving'; i++) {
    await page.waitForTimeout(100);
    afterEnter = await page.evaluate(() => window.__game.mode);
  }
  check(
    'enter/exit button toggles on tap',
    afterExit === 'foot' && afterEnter === 'driving',
    `${afterExit} -> ${afterEnter}`,
  );

  if (!results.some((r) => r.name === 'no page errors (mobile)')) {
    check('no page errors (mobile)', true);
  }

  // --- Desktop context: no touch UI should be created.
  const desktop = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const dpage = await desktop.newPage();
  const dErrors = [];
  dpage.on('pageerror', (e) => dErrors.push(e.message));
  await dpage.goto(BASE, { waitUntil: 'load' });
  await dpage.waitForTimeout(600);
  await dpage.evaluate(() => window.__skipSplash?.());
  const noTouchUi = await dpage.evaluate(() => !document.getElementById('tc-stick'));
  check('desktop shows no touch UI', noTouchUi && dErrors.length === 0, dErrors.join('; '));
} finally {
  await browser.close();
  server?.httpServer.close();
}

if (results.some((r) => !r.ok)) {
  console.error('\nTOUCH FAIL');
  process.exitCode = 1;
} else {
  console.log('\nTOUCH PASS');
}
