// Gameplay interaction test: drives the real game in headless Chromium and
// asserts the behaviors that were reported broken — building collision,
// entering ANY nearby car (not just the spawn car), and physical bump & shove.
// Uses the window.__game debug handle to set up deterministic scenarios.
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = process.env.URL ? null : await preview({ preview: { port: 5182 } });
const URL = process.env.URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  const reset = async () => {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(700);
  };

  // --- 1. Building collision: drive straight into a wall, don't pass through.
  await reset();
  const wall = await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 3;
    car.z = (c.minZ + c.maxZ) / 2;
    car.heading = 0; // face +X, into the wall
    car.vx = car.vz = 0;
    return { minX: c.minX };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyW');
  const afterRam = await page.evaluate(() => {
    const g = window.__game;
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    return { x: car.x };
  });
  check(
    'building collision blocks the car',
    afterRam.x < wall.minX && afterRam.x > wall.minX - 3.5,
    `car.x=${afterRam.x.toFixed(2)} vs wall minX=${wall.minX.toFixed(2)}`,
  );

  // --- 2. Enter another car: stand on a traffic car on foot, press F.
  await reset();
  await page.keyboard.press('KeyF'); // exit spawn car -> on foot
  await page.waitForTimeout(200);
  const target = await page.evaluate(() => {
    const g = window.__game;
    const cars = g.vehicles.cars;
    let j = -1;
    for (let i = 0; i < cars.length; i++) {
      if (i !== g.vehicles.playerIndex && cars[i].role === 'ai') { j = i; break; }
    }
    g.player.x = cars[j].x;
    g.player.z = cars[j].z;
    return { j, wasFoot: g.mode === 'foot' };
  });
  await page.keyboard.press('KeyF'); // enter the car we're standing on
  await page.waitForTimeout(200);
  const entered = await page.evaluate(() => ({
    mode: window.__game.mode,
    playerIndex: window.__game.vehicles.playerIndex,
  }));
  check(
    'can enter another (traffic) car',
    target.wasFoot && entered.mode === 'driving' && entered.playerIndex === target.j,
    `target=${target.j} now driving index ${entered.playerIndex}`,
  );

  // --- 3. Bump & shove: ram a stationary car, it gets knocked away.
  await reset();
  const shove = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const t = v.playerIndex === 0 ? 1 : 0; // a different car
    const cx = g.city.center.x;
    const cz = g.city.center.z;
    // Park the target dead ahead, stationary.
    v.cars[t].role = 'parked';
    v.cars[t].lane = null;
    v.cars[t].x = cx + 1;
    v.cars[t].z = cz;
    v.cars[t].vx = v.cars[t].vz = 0;
    // Line the player's car up behind it, ramming at speed (+X).
    const p = v.cars[v.playerIndex];
    p.x = cx - 6;
    p.z = cz;
    p.heading = 0;
    p.vx = 25;
    p.vz = 0;
    return { t, startX: v.cars[t].x };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  const shoved = await page.evaluate((t) => {
    const c = window.__game.vehicles.cars[t];
    return { x: c.x, moved: Math.hypot(c.vx, c.vz) };
  }, shove.t);
  check(
    'ramming shoves the other car',
    shoved.x > shove.startX + 3,
    `target moved from x=${shove.startX.toFixed(2)} to ${shoved.x.toFixed(2)}`,
  );

  // --- 4. Cars brake for a pedestrian standing in the road.
  await reset();
  await page.keyboard.press('KeyF'); // on foot
  await page.waitForTimeout(150);
  const braked = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    const j = cars.findIndex((c, i) => i !== v.playerIndex && c.role === 'ai');
    // Isolate the target far from the city edge on a known straight stretch, so
    // it can't wrap around mid-test. Player stands well ahead on the same lane.
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    const cx = g.city.center.x;
    const cz = g.city.center.z;
    c.role = 'ai';
    c.lane = { axis: 'x', fixed: cz, dir: 1 };
    c.cruise = 14;
    c.x = cx - 2; c.z = cz; c.vx = 14; c.vz = 0;
    g.player.x = cx + 22; g.player.z = cz;
    return { j };
  });
  await page.waitForTimeout(3600);
  const brakeRes = await page.evaluate((j) => {
    const g = window.__game;
    const c = g.vehicles.cars[j];
    return {
      speed: Math.hypot(c.vx, c.vz),
      dist: Math.hypot(c.x - g.player.x, c.z - g.player.z),
      health: g.health,
      wasted: g.wasted,
    };
  }, braked.j);
  check(
    'cars brake for a standing pedestrian',
    brakeRes.health === 100 && !brakeRes.wasted && brakeRes.speed < 2 && brakeRes.dist > 2.4,
    JSON.stringify(brakeRes),
  );

  // --- 5. Darting in front of a fast car from inside its stopping distance is fatal.
  await reset();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    const j = cars.findIndex((c, i) => i !== v.playerIndex && c.role === 'ai');
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    const cx = g.city.center.x;
    const cz = g.city.center.z;
    c.role = 'ai';
    c.lane = { axis: 'x', fixed: cz, dir: 1 };
    c.cruise = 30;
    c.x = cx - 2.5; c.z = cz; c.vx = 30; c.vz = 0;
    g.player.x = cx; g.player.z = cz; // right in its path, no time to stop
  });
  await page.waitForTimeout(900);
  const deathRes = await page.evaluate(() => ({ health: window.__game.health, wasted: window.__game.wasted }));
  check(
    'jumping in front of a fast car is fatal (WASTED)',
    deathRes.health < 100 && deathRes.wasted === true,
    JSON.stringify(deathRes),
  );

  if (!results.some((r) => r.name === 'no page errors')) check('no page errors', true, '');
} finally {
  await browser.close();
  server?.httpServer.close();
}

if (results.some((r) => !r.ok)) {
  console.error('\nINTERACTION FAIL');
  process.exitCode = 1;
} else {
  console.log('\nINTERACTION PASS');
}
