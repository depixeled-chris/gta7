// Runtime smoke test: loads the built game in headless Chromium, captures any
// console/page errors, screenshots the frame, and decodes it to prove the 3D
// scene actually rasterized (not a black/blank canvas). Exits non-zero on any
// failure so CI / the build pipeline can gate on it.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { preview } from 'vite';

const OUT = process.env.OUT || 'smoke.png';

// Self-host the built app so the test is one command (`node scripts/smoke.mjs`)
// after `npm run build`. Honors an external URL if one is provided.
const server = process.env.URL ? null : await preview({ preview: { port: 5180 } });
const URL = process.env.URL || server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
  ],
});

const fail = (msg) => {
  console.error('SMOKE FAIL:', msg);
  process.exitCode = 1;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(3000); // let a few frames render
  await page.evaluate(() => window.__skipSplash?.()); // reveal the scene (clean splash teardown)

  const dom = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return {
      hasCanvas: !!c,
      w: c?.width ?? 0,
      h: c?.height ?? 0,
      hud: document.body.innerText.includes('MPH'),
      mode: /DRIVING|ON FOOT/.test(document.body.innerText),
    };
  });

  // Perf telemetry — logged (not asserted) so regressions are visible across runs.
  const perf = await page.evaluate(() => window.__game?.perf ?? null);
  if (perf) {
    console.log(
      `PERF  draws=${perf.drawCalls}  tris=${perf.triangles}  geom=${perf.geometries}  tex=${perf.textures}  frame=${perf.frameMs.toFixed(1)}ms`,
    );
  }

  const shot = await page.screenshot();
  writeFileSync(OUT, shot);
  const png = PNG.sync.read(shot);

  // Scene-rendered heuristics: a real frame has many distinct colors and a
  // meaningful fraction of bright (lit-window / headlight) pixels, unlike a
  // flat clear color.
  const colors = new Set();
  let bright = 0;
  const step = 4 * 7; // sample stride
  for (let i = 0; i < png.data.length; i += step) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    colors.add((r >> 3) + ',' + (g >> 3) + ',' + (b >> 3));
    if (r + g + b > 360) bright++;
  }
  const sampled = Math.floor(png.data.length / step);
  const brightFrac = bright / sampled;

  console.log(JSON.stringify({ dom, uniqueColors: colors.size, brightFrac: +brightFrac.toFixed(4), errors }, null, 2));

  if (errors.length) fail(`${errors.length} console/page error(s)`);
  if (!dom.hasCanvas) fail('no <canvas> element');
  if (!dom.hud || !dom.mode) fail('HUD did not mount');
  if (colors.size < 60) fail(`scene looks flat (only ${colors.size} colors)`);
  if (brightFrac < 0.002) fail(`no lit pixels (bright frac ${brightFrac})`);

  if (!process.exitCode) console.log('SMOKE PASS');
} finally {
  await browser.close();
  server?.httpServer.close();
}
