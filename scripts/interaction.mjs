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

  // --- 3b. Carjack a curbside PARKED car (not just moving traffic).
  await reset();
  await page.keyboard.press('KeyF'); // exit spawn car -> on foot
  await page.waitForTimeout(200);
  const park = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    // A parked car away from the spawn point (i.e. a curbside one, not the car we just left).
    let j = -1;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.role === 'parked' && Math.hypot(c.x - g.city.center.x, c.z - g.city.center.z) > 12) { j = i; break; }
    }
    g.player.x = cars[j].x - 1.5;
    g.player.z = cars[j].z;
    return { j };
  });
  await page.keyboard.press('KeyF'); // get in
  await page.waitForTimeout(200);
  const parked = await page.evaluate(() => ({
    mode: window.__game.mode,
    idx: window.__game.vehicles.playerIndex,
  }));
  check(
    'can enter a curbside parked car',
    parked.mode === 'driving' && parked.idx === park.j,
    `now driving index ${parked.idx} (target ${park.j})`,
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

  // --- 6. Run over a pedestrian at speed: they gib and the count goes up.
  await reset();
  const ranOver = await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const ped = g.peds.peds[0];
    ped.state = 'walk'; ped.y = 0; ped.tumble = 0; ped.group.visible = true;
    ped.x = p.x + 7; ped.z = p.z;
    p.heading = 0; p.vx = 22; p.vz = 0; // fast: >= GIB_SPEED
    return { before: g.runOverCount };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  const splat = await page.evaluate(() => ({
    count: window.__game.runOverCount,
    state: window.__game.peds.peds[0].state,
  }));
  check(
    'a fast hit gibs the pedestrian and scores',
    splat.count > ranOver.before && splat.state === 'gibbed',
    `count ${ranOver.before} -> ${splat.count}, state=${splat.state}`,
  );

  // --- 6b. A SLOW bump just shoves them (no gib, no score).
  await reset();
  const slow = await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const ped = g.peds.peds[0];
    ped.state = 'walk'; ped.y = 0; ped.tumble = 0; ped.group.visible = true;
    ped.x = p.x + 2; ped.z = p.z; // already in contact range (it'd otherwise dodge)
    p.heading = 0; p.vx = 5; p.vz = 0; // slow: between SHOVE and GIB
    return { before: g.runOverCount };
  });
  await page.waitForTimeout(200);
  const bumped = await page.evaluate(() => ({
    count: window.__game.runOverCount,
    state: window.__game.peds.peds[0].state,
  }));
  check(
    'a slow bump shoves the pedestrian (no gib, no score)',
    bumped.state === 'shoved' && bumped.count === slow.before,
    `state=${bumped.state}, count ${slow.before} -> ${bumped.count}`,
  );

  // --- 7. Radio: cycling the station with ] tunes off OFF to a station.
  await reset();
  const radioBefore = await page.evaluate(() => window.__game.radioLabel);
  await page.keyboard.press('BracketRight');
  await page.waitForTimeout(150);
  await page.keyboard.press('BracketRight');
  await page.waitForTimeout(150);
  const radioAfter = await page.evaluate(() => window.__game.radioLabel);
  check(
    'radio tunes to a station on []',
    radioBefore === '📻 OFF' && radioAfter !== '📻 OFF' && radioAfter.startsWith('📻'),
    `"${radioBefore}" -> "${radioAfter}"`,
  );

  // --- 8. Crime summons police: mow down pedestrians, get a wanted level + chasers.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    for (let i = 0; i < 3; i++) {
      const ped = g.peds.peds[i];
      ped.state = 'walk'; ped.group.visible = true; ped.y = 0; ped.tumble = 0;
      ped.x = p.x + 6 + i * 3; ped.z = p.z;
    }
    p.heading = 0; p.vx = 24; p.vz = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1300);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const heat = await page.evaluate(() => ({
    kills: window.__game.runOverCount,
    wanted: window.__game.wanted,
    police: window.__game.police,
  }));
  check(
    'running people over raises a wanted level and spawns police',
    heat.kills >= 1 && heat.wanted >= 1 && heat.police >= 1,
    JSON.stringify(heat),
  );

  // --- 9. A car bearing down scares pedestrians (vector trigger).
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const ped = g.peds.peds[0];
    ped.state = 'walk'; ped.scared = false; ped.group.visible = true;
    ped.x = p.x + 12; ped.z = p.z; // directly in the car's path
    p.heading = 0; p.vx = 18; p.vz = 0; // barreling toward it
  });
  await page.keyboard.down('KeyW');
  let carScared = false;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(80);
    if (await page.evaluate(() => window.__game.peds.peds[0].scared)) { carScared = true; break; }
  }
  await page.keyboard.up('KeyW');
  check('a car bearing down scares pedestrians', carScared, `scared=${carScared}`);

  // --- 9b. On foot, pedestrians do NOT fear the player (by design).
  await reset();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.peds.peds[0];
    p.state = 'walk'; p.scared = false; p.group.visible = true;
    p.x = g.player.x + 2; p.z = g.player.z; // right next to the on-foot player
  });
  await page.waitForTimeout(400);
  const onFootScared = await page.evaluate(() => window.__game.peds.peds[0].scared);
  check('pedestrians ignore the player on foot', onFootScared === false, `scared=${onFootScared}`);

  // --- 9c. BUSTED: a cop pinning you slow resets the game.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    for (let i = 0; i < 3; i++) {
      const ped = g.peds.peds[i];
      ped.state = 'walk'; ped.group.visible = true; ped.x = p.x + 6 + i * 3; ped.z = p.z;
    }
    p.heading = 0; p.vx = 24; p.vz = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  let bustedSeen = false;
  for (let i = 0; i < 22; i++) {
    // Hold the player still and park a cop just within bust range (but outside
    // collision range so it doesn't ram the player back up to speed).
    await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      p.vx = 0; p.vz = 0;
      const cop = v.cars.find((c) => c.role === 'police' && c.active);
      if (cop) { cop.x = p.x + 6; cop.z = p.z; cop.vx = 0; cop.vz = 0; }
    });
    await page.waitForTimeout(150);
    if (await page.evaluate(() => window.__game.busted)) { bustedSeen = true; break; }
  }
  check('cops bust you when they pin you slow', bustedSeen, `busted=${bustedSeen}`);

  // --- 10. Radio keeps playing after you get out of the car.
  await reset();
  await page.keyboard.press('KeyW'); // gesture: tune in the spawn car's radio
  await page.waitForTimeout(300);
  const inCar = await page.evaluate(() => window.__game.radioLabel);
  await page.keyboard.press('KeyF'); // step out
  await page.waitForTimeout(300);
  const onFoot = await page.evaluate(() => window.__game.radioLabel);
  check(
    'radio keeps playing after exiting the car',
    inCar.startsWith('📻') && inCar !== '📻 OFF' && onFoot === inCar,
    `in-car "${inCar}" -> on-foot "${onFoot}"`,
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
