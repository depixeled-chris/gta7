// Streamed-world smoke test (R007): loads the built game with ?stream=1, drives
// forward so chunks load/unload, and asserts it renders without errors and the
// streamed content is actually present. Mirrors smoke.mjs's render heuristics.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { preview } from 'vite';

const OUT = process.env.OUT || 'stream-smoke.png';
const server = process.env.URL ? null : await preview({ preview: { port: 5181 } });
const base = process.env.URL || server.resolvedUrls.local[0];
const URL = base + (base.includes('?') ? '&' : '?') + 'stream=1';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});

const fail = (msg) => {
  console.error('STREAM SMOKE FAIL:', msg);
  process.exitCode = 1;
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__skipSplash?.());

  // Initial streamed content: chunks loaded around spawn => streetlights present.
  const before = await page.evaluate(() => ({
    mode: window.__game?.mode,
    lights: window.__game?.city?.streetlights?.length ?? 0,
    x: window.__game?.player?.x ?? 0,
  }));

  // Drive forward for a couple seconds so the ring loads/unloads as we move.
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    lights: window.__game?.city?.streetlights?.length ?? 0,
    perf: window.__game?.perf ?? null,
    car: window.__game?.carModel ?? null,
  }));

  const dom = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { hasCanvas: !!c, hud: document.body.innerText.includes('MPH'), mode: /DRIVING|ON FOOT/.test(document.body.innerText) };
  });

  const shot = await page.screenshot();
  writeFileSync(OUT, shot);
  const png = PNG.sync.read(shot);
  const colors = new Set();
  let bright = 0;
  const step = 4 * 7;
  for (let i = 0; i < png.data.length; i += step) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    colors.add((r >> 3) + ',' + (g >> 3) + ',' + (b >> 3));
    if (r + g + b > 360) bright++;
  }
  const brightFrac = bright / Math.floor(png.data.length / step);

  console.log(JSON.stringify({ before, after, dom, uniqueColors: colors.size, brightFrac: +brightFrac.toFixed(4), errors }, null, 2));

  if (errors.length) fail(`${errors.length} console/page error(s)`);
  if (!dom.hasCanvas) fail('no <canvas>');
  if (!dom.hud || !dom.mode) fail('HUD did not mount');
  if (before.lights <= 0) fail('no streamed streetlights at spawn (chunks did not load)');
  if (colors.size < 60) fail(`scene looks flat (${colors.size} colors)`);
  if (brightFrac < 0.002) fail(`no lit pixels (${brightFrac})`);

  if (!process.exitCode) console.log('STREAM SMOKE PASS');
} finally {
  await browser.close();
  server?.httpServer.close();
}
