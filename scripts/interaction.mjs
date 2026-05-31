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
    await page.evaluate(() => window.__skipSplash?.()); // skip the start splash (clean teardown)
  };

  // Drive over a line of pedestrians to earn a wanted level. Polls for police
  // rather than waiting a fixed time — the headless renderer steps the fixed-
  // timestep sim slowly under load, so a fixed wait under-travels the car.
  const raiseWanted = async () => {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.vehicles.cars[g.vehicles.playerIndex];
      for (let i = 0; i < 4; i++) {
        const ped = g.peds.peds[i];
        ped.state = 'walk'; ped.group.visible = true; ped.y = 0; ped.tumble = 0;
        ped.x = p.x + 6 + i * 3; ped.z = p.z;
      }
      p.heading = 0; p.vx = 24; p.vz = 0;
    });
    await page.keyboard.down('KeyW');
    let heat = { kills: 0, wanted: 0, police: 0 };
    for (let i = 0; i < 45 && heat.police < 1; i++) {
      await page.waitForTimeout(120);
      heat = await page.evaluate(() => ({
        kills: window.__game.runOverCount,
        wanted: window.__game.wanted,
        police: window.__game.police,
      }));
    }
    await page.keyboard.up('KeyW');
    return heat;
  };

  // --- 0. Start splash shows on load and dismisses on input (fades out).
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const splashShown = await page.evaluate(() => !!document.getElementById('splash'));
  await page.keyboard.press('Space'); // any key continues
  let splashGone = false;
  for (let i = 0; i < 20 && !splashGone; i++) {
    await page.waitForTimeout(150); // poll through the fade-to-black + fade-from-black + removal
    splashGone = await page.evaluate(() => !document.getElementById('splash'));
  }
  check('splash shows on load and dismisses on input', splashShown && splashGone, `shown=${splashShown}, gone=${splashGone}`);

  // --- 0b. Dismissing the splash raises the title menu (paused) until Play.
  let titleState = { menu: false, paused: false };
  for (let i = 0; i < 20 && !(titleState.menu && titleState.paused); i++) {
    await page.waitForTimeout(100);
    titleState = await page.evaluate(() => ({
      menu: !!document.getElementById('menu') && getComputedStyle(document.getElementById('menu')).display !== 'none',
      paused: window.__game.paused,
    }));
  }
  await page.click('#menu-play'); // Play → enter the running game
  await page.waitForTimeout(200);
  const playing = await page.evaluate(() => ({
    menu: getComputedStyle(document.getElementById('menu')).display !== 'none',
    paused: window.__game.paused,
  }));
  check(
    'title menu shows after splash and Play starts the game',
    titleState.menu && titleState.paused && !playing.menu && !playing.paused,
    `title{menu:${titleState.menu},paused:${titleState.paused}} -> play{menu:${playing.menu},paused:${playing.paused}}`,
  );

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

  // --- 2. Enter another car: stand beside a traffic car on foot, press F.
  await reset();
  await page.keyboard.press('KeyF'); // exit spawn car -> on foot
  await page.waitForTimeout(200);
  const target = await page.evaluate(() => {
    const g = window.__game;
    const cars = g.vehicles.cars;
    const j = cars.findIndex((c, i) => i !== g.vehicles.playerIndex && c.role === 'ai');
    // Banish every other car far away so the only car within reach is our target
    // — which one is "nearest" is otherwise a race against the moving sim.
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    c.role = 'parked'; c.lane = null; c.vx = c.vz = 0; // stop the target too
    g.player.x = c.x - 2.6; g.player.z = c.z; // beside it: within reach, clear of push-out
    return { j, wasFoot: g.mode === 'foot' };
  });
  await page.keyboard.press('KeyF'); // enter the car beside us
  let entered = { mode: 'foot', playerIndex: null };
  for (let i = 0; i < 8 && entered.mode !== 'driving'; i++) {
    await page.waitForTimeout(120);
    entered = await page.evaluate(() => ({
      mode: window.__game.mode,
      playerIndex: window.__game.vehicles.playerIndex,
    }));
  }
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
  // Poll while ramming — the slow headless renderer doesn't push a fixed amount
  // in a fixed time. Shove distance is also mass-weighted now.
  let shovedX = shove.startX;
  for (let i = 0; i < 18 && shovedX <= shove.startX + 1.5; i++) {
    await page.waitForTimeout(150);
    shovedX = await page.evaluate((t) => window.__game.vehicles.cars[t].x, shove.t);
  }
  await page.keyboard.up('KeyW');
  check(
    'ramming shoves the other car',
    shovedX > shove.startX + 1.5,
    `target moved from x=${shove.startX.toFixed(2)} to ${shovedX.toFixed(2)}`,
  );

  // --- 3b. Carjack a curbside PARKED car (not just moving traffic).
  await reset();
  await page.keyboard.press('KeyF'); // exit spawn car -> on foot
  // Poll for the exit to land before we relocate — pressing F again mid-exit
  // would just re-enter the spawn car (index 0).
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => window.__game.mode === 'foot')) break;
    await page.waitForTimeout(100);
  }
  const park = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    // Pick a real parked (curbside) car, then BANISH every other car far away so
    // the only car within reach is our target — no race over which one is nearest
    // (cars drift to varying positions depending on how long the exit poll took).
    const j = cars.findIndex(
      (c, i) => i !== v.playerIndex && c.role === 'parked' &&
        Math.hypot(c.x - g.city.center.x, c.z - g.city.center.z) > 12,
    );
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    g.player.x = cars[j].x - 2.6; // beside it: within reach, clear of push-out
    g.player.z = cars[j].z;
    return { j };
  });
  await page.keyboard.press('KeyF'); // get in
  let parked = { mode: 'foot', idx: null };
  for (let i = 0; i < 8 && parked.mode !== 'driving'; i++) {
    await page.waitForTimeout(120);
    parked = await page.evaluate(() => ({
      mode: window.__game.mode,
      idx: window.__game.vehicles.playerIndex,
    }));
  }
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
  // Poll until the car settles to a near-stop (the slow headless renderer can
  // still be rolling at a fixed sample time) — and bail early if it hits the ped.
  let brakeRes = { speed: 99, dist: 0, health: 100, wasted: false };
  let brakeHit = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(120);
    brakeRes = await page.evaluate((j) => {
      const g = window.__game;
      const c = g.vehicles.cars[j];
      return {
        speed: Math.hypot(c.vx, c.vz),
        dist: Math.hypot(c.x - g.player.x, c.z - g.player.z),
        health: g.health,
        wasted: g.wasted,
      };
    }, braked.j);
    if (brakeRes.health < 100 || brakeRes.wasted) { brakeHit = true; break; }
    if (brakeRes.speed < 1.2) break; // braked to a near-stop, short of the ped
  }
  check(
    // Braked from a 14 m/s cruise and stopped short of the ped (never hit them).
    'cars brake for a standing pedestrian',
    !brakeHit && brakeRes.health === 100 && !brakeRes.wasted && brakeRes.speed < 1.5 && brakeRes.dist > 2.4,
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
  const before = await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    p.heading = 0; p.vx = 22; p.vz = 0; // fast: >= GIB_SPEED
    return g.runOverCount;
  });
  await page.keyboard.down('KeyW');
  // Pin the ped just ahead of the (moving) car each step so its fear-dodge can't
  // carry it clear, and poll for the gib — robust to the slow headless sim rate.
  let splat = { count: before, state: 'walk' };
  for (let i = 0; i < 16 && splat.state !== 'gibbed'; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.vehicles.cars[g.vehicles.playerIndex];
      const ped = g.peds.peds[0];
      if (ped.state === 'walk') { ped.y = 0; ped.tumble = 0; ped.group.visible = true; ped.x = p.x + 3; ped.z = p.z; }
      p.vx = 22;
    });
    await page.waitForTimeout(120);
    splat = await page.evaluate(() => ({
      count: window.__game.runOverCount,
      state: window.__game.peds.peds[0].state,
    }));
  }
  await page.keyboard.up('KeyW');
  check(
    'a fast hit gibs the pedestrian and scores',
    splat.count > before && splat.state === 'gibbed',
    `count ${before} -> ${splat.count}, state=${splat.state}`,
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
  await page.waitForFunction(() => window.__game?.radioReady, { timeout: 5000 }); // manifest loaded
  const radioBefore = await page.evaluate(() => window.__game.radioLabel);
  // Retry the keypress until the tuner leaves OFF (robust to the headless
  // input/loop timing race), capped.
  let radioAfter = radioBefore;
  for (let i = 0; i < 8 && radioAfter === '📻 OFF'; i++) {
    await page.keyboard.press('BracketRight');
    await page.waitForTimeout(120);
    radioAfter = await page.evaluate(() => window.__game.radioLabel);
  }
  check(
    'radio tunes to a station on []',
    radioBefore === '📻 OFF' && radioAfter !== '📻 OFF' && radioAfter.startsWith('📻'),
    `"${radioBefore}" -> "${radioAfter}"`,
  );

  // --- 8. Crime summons police: mow down pedestrians, get a wanted level + chasers.
  await reset();
  const heat = await raiseWanted();
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
  await raiseWanted(); // earn a chaser
  let bustedSeen = false;
  // Keep re-pinning (player still, a cop just within bust range but outside
  // collision range, in the open so it keeps eyes on you) and poll for BUSTED.
  // Generous iteration count because the bust meter needs ~1.8s of SIM time and
  // the headless renderer runs slow.
  for (let i = 0; i < 60 && !bustedSeen; i++) {
    await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      p.vx = 0; p.vz = 0;
      const cop = v.cars.find((c) => c.role === 'police' && c.active);
      if (cop) { cop.x = p.x + 6; cop.z = p.z; cop.vx = 0; cop.vz = 0; }
    });
    await page.waitForTimeout(120);
    bustedSeen = await page.evaluate(() => window.__game.busted);
  }
  check('cops bust you when they pin you slow', bustedSeen, `busted=${bustedSeen}`);

  // --- 9d. "Get away": break the cops' line of sight and the wanted level cools.
  await reset();
  const starsBefore = (await raiseWanted()).wanted;
  // Drop a building between you and the cop so it can't see you, and hold there.
  const losSetup = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const c = g.city.colliders.reduce((a, b) =>
      (b.maxX - b.minX) * (b.maxZ - b.minZ) > (a.maxX - a.minX) * (a.maxZ - a.minZ) ? b : a);
    const z = (c.minZ + c.maxZ) / 2;
    const p = v.cars[v.playerIndex];
    p.x = c.minX - 5; p.z = z; p.vx = 0; p.vz = 0;
    return { px: c.minX - 5, ex: c.maxX + 5, z };
  });
  // "Got away" if we ever observe the cooling flag OR the stars actually drop.
  // (At a low wanted level the cooling window is brief, so don't rely on
  // catching the transient flag alone.)
  let gotAway = false;
  for (let i = 0; i < 70 && !gotAway; i++) {
    await page.evaluate((s) => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      p.x = s.px; p.z = s.z; p.vx = 0; p.vz = 0;
      // Park EVERY active cop on the far side of the building (all sight lines blocked).
      for (const c of v.cars) {
        if (c.role === 'police' && c.active) { c.x = s.ex; c.z = s.z; c.vx = 0; c.vz = 0; }
      }
    }, losSetup);
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => ({ cooling: window.__game.wantedCooling, wanted: window.__game.wanted }));
    if (s.cooling || s.wanted < starsBefore) gotAway = true;
  }
  check(
    'breaking line of sight cools the wanted level',
    starsBefore >= 1 && gotAway,
    `stars before=${starsBefore}, gotAway=${gotAway}`,
  );

  // --- 10. Radio keeps playing after you get out of the car.
  await reset();
  await page.waitForFunction(() => window.__game?.radioReady, { timeout: 5000 }); // manifest loaded
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

  // --- 11. Damage model: a moderate crash dents the car but it survives.
  await reset();
  const dent = await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 2; car.z = (c.minZ + c.maxZ) / 2; car.heading = 0;
    car.vx = 28; car.vz = 0; // a solid but survivable smack into the wall
    return { before: g.carHealth };
  });
  await page.waitForTimeout(500);
  const dented = await page.evaluate(() => ({ health: window.__game.carHealth, wasted: window.__game.wasted }));
  check(
    'a crash damages the car without wrecking it',
    dent.before === 100 && dented.health < 100 && dented.health > 0 && !dented.wasted,
    `carHealth ${dent.before} -> ${dented.health.toFixed(1)}`,
  );

  // --- 12. A full-speed FIRST hit damages the car hard but must NOT total it.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 2; car.z = (c.minZ + c.maxZ) / 2; car.heading = 0;
    car.vx = 90; car.vz = 0; // flat out (~200 mph) straight into the wall
  });
  await page.waitForTimeout(300);
  const bigHit = await page.evaluate(() => ({ health: window.__game.carHealth, wasted: window.__game.wasted }));
  check(
    "a full-speed first hit doesn't total the car",
    bigHit.health > 0 && bigHit.health < 100 && !bigHit.wasted,
    `carHealth -> ${bigHit.health.toFixed(1)}, wasted=${bigHit.wasted}`,
  );

  // --- 12b. Enough damage DOES wreck the player car → explosion + WASTED.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 2; car.z = (c.minZ + c.maxZ) / 2; car.heading = 0;
    car.health = 20; // already badly damaged from earlier knocks
    car.vx = 40; car.vz = 0; // one more hard hit finishes it
  });
  await page.waitForTimeout(300);
  const wreck = await page.evaluate(() => ({
    health: window.__game.carHealth,
    wasted: window.__game.wasted,
    wrecks: window.__game.vehicles.wreckCount,
  }));
  check(
    'a wrecked car explodes and triggers WASTED',
    wreck.health === 0 && wreck.wasted === true && wreck.wrecks >= 1,
    JSON.stringify(wreck),
  );

  // --- 12c. An NPC car wrecks on its own (slams a wall) — player untouched.
  await reset();
  const npc = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const t = v.playerIndex === 0 ? 1 : 0; // any non-player car
    v.cars[t].role = 'parked'; v.cars[t].lane = null;
    v.cars[t].x = c.minX - 2; v.cars[t].z = (c.minZ + c.maxZ) / 2;
    v.cars[t].health = 20; // already battered
    v.cars[t].vx = 60; v.cars[t].vz = 0; // hurled into the building
    // Keep the player car well away so only the NPC wrecks.
    const p = v.cars[v.playerIndex];
    p.x = g.city.center.x; p.z = g.city.center.z; p.vx = p.vz = 0;
    return { before: v.wreckCount };
  });
  await page.waitForTimeout(300);
  const npcWrecked = await page.evaluate(() => ({
    wrecks: window.__game.vehicles.wreckCount,
    wasted: window.__game.wasted,
    carHealth: window.__game.carHealth,
  }));
  check(
    'an NPC car explodes when it takes enough damage (player untouched)',
    npcWrecked.wrecks > npc.before && !npcWrecked.wasted && npcWrecked.carHealth === 100,
    JSON.stringify(npcWrecked),
  );

  // --- 13. Outrunning cops: a cop left far behind closes the gap (rubber-band).
  await reset();
  // Raise a single wanted star (one ped) so exactly one cruiser chases — a clean
  // test of pursuit speed without cruisers fanning each other out (separation).
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const ped = g.peds.peds[0];
    ped.state = 'walk'; ped.group.visible = true; ped.y = 0; ped.tumble = 0;
    ped.x = p.x + 7; ped.z = p.z;
    p.heading = 0; p.vx = 24; p.vz = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  // Make sure a cruiser is actually active+chasing before testing pursuit.
  await page.waitForFunction(() => window.__game.police >= 1, { timeout: 3000 });
  const closeIn = await page.evaluate(() => {
    const v = window.__game.vehicles;
    const p = v.cars[v.playerIndex];
    p.vx = 0; p.vz = 0; // park the player; shove the cop far (within the leash)
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    cop.x = p.x + 120; cop.z = p.z; cop.vx = 0; cop.vz = 0;
    return { gap0: v.nearestPoliceDistance(p.x, p.z) };
  });
  // Poll over a window: a cop weaving the blocks claws ground back over time.
  let closedGap = closeIn.gap0;
  for (let i = 0; i < 12 && closedGap > closeIn.gap0 - 25; i++) {
    await page.waitForTimeout(150);
    const s = await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      return { gap: v.nearestPoliceDistance(p.x, p.z), busted: window.__game.busted };
    });
    if (s.busted) break;
    closedGap = Math.min(closedGap, s.gap);
  }
  check(
    // The old fixed cop speed made up no ground on a stationary target; the
    // rubber-band cop closes meaningfully (exact amount varies with weaving).
    'an outrun cop claws the gap back (rubber-band pursuit)',
    closeIn.gap0 > 110 && closedGap < closeIn.gap0 - 25,
    `gap ${closeIn.gap0.toFixed(0)} -> ${closedGap.toFixed(0)}`,
  );

  // --- 13b. A cop left beyond the leash is re-summoned near you.
  const leashGap0 = await page.evaluate(() => {
    const v = window.__game.vehicles;
    const p = v.cars[v.playerIndex];
    p.vx = 0; p.vz = 0;
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    cop.x = p.x + 240; cop.z = p.z; cop.vx = 0; cop.vz = 0; // way past the leash
    return v.nearestPoliceDistance(p.x, p.z);
  });
  // Poll for the re-summon (placeNear fires the next time drivePolice runs).
  let leashGap = leashGap0;
  for (let i = 0; i < 10 && leashGap > 120; i++) {
    await page.waitForTimeout(120);
    leashGap = await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      return v.nearestPoliceDistance(p.x, p.z);
    });
  }
  check(
    'a cop left beyond the leash is re-summoned near you',
    leashGap0 > 230 && leashGap < 120,
    `gap ${leashGap0.toFixed(0)} -> ${leashGap.toFixed(0)}`,
  );

  // --- 12d. A damaged car trails smoke particles.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    g.vehicles.cars[g.vehicles.playerIndex].health = 20; // badly damaged, not wrecked
  });
  await page.waitForTimeout(400);
  const smoke = await page.evaluate(() => window.__game.vehicles.smokeParticles());
  check('a damaged car emits smoke particles', smoke > 0, `live particles=${smoke}`);

  // --- 13c. On foot, punching a pedestrian gibs them into pixels (and scores).
  await reset();
  await page.keyboard.press('KeyF'); // get out of the car, on foot
  await page.waitForTimeout(250);
  const punchSetup = await page.evaluate(() => {
    const g = window.__game;
    g.player.heading = 0; // face +X
    // Isolate one target so the punch can only connect with it.
    g.peds.peds.forEach((p, i) => {
      if (i > 0) { p.state = 'walk'; p.x = 9000 + i; p.z = 9000; }
    });
    return { before: g.runOverCount, mode: g.mode };
  });
  let gibbed = false;
  for (let i = 0; i < 20 && !gibbed; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const ped = g.peds.peds[0];
      if (ped.state !== 'gibbed') { // keep it pinned right in front until a punch lands
        ped.state = 'walk'; ped.y = 0; ped.tumble = 0; ped.scared = false; ped.group.visible = true;
        ped.x = g.player.x + 1.3; ped.z = g.player.z;
      }
    });
    await page.keyboard.press('Space'); // punch
    await page.waitForTimeout(120);
    gibbed = await page.evaluate(() => window.__game.peds.peds[0].state === 'gibbed');
  }
  const punched = await page.evaluate(() => window.__game.runOverCount);
  check(
    'punching a pedestrian on foot gibs them',
    punchSetup.mode === 'foot' && gibbed && punched > punchSetup.before,
    `gibbed=${gibbed}, count ${punchSetup.before} -> ${punched}`,
  );

  // --- 13d. Police don't run the on-foot player over (they arrest = BUSTED).
  await reset();
  await page.keyboard.press('KeyF'); // on foot
  await page.waitForTimeout(200);
  const copImpact = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    v.setWanted(1, { x: g.player.x, z: g.player.z }, g.city); // activate a cruiser
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    cop.x = g.player.x; cop.z = g.player.z; cop.vx = 30; cop.vz = 0; // fast, right on the player
    return {
      countsAsImpact: !!v.pedestrianImpact(g.player.x, g.player.z, false, true),
      hurtsOnFoot: !!v.pedestrianImpact(g.player.x, g.player.z, false, false),
    };
  });
  check(
    'police are excluded from on-foot run-over damage (arrest, not splatter)',
    copImpact.countsAsImpact === true && copImpact.hurtsOnFoot === false,
    JSON.stringify(copImpact),
  );

  // --- 14. Cars come in varied body shapes (visual variety).
  await reset();
  const shapes = await page.evaluate(() => {
    const ids = new Set(window.__game.vehicles.cars.map((c) => c.shapeId));
    return [...ids];
  });
  check('cars have varied body shapes', shapes.length > 1, `shapes=${shapes.join(',')}`);

  // --- 14c. Cars are specific makes/models; you're driving one.
  const models = await page.evaluate(() => ({
    distinct: new Set(window.__game.vehicles.cars.map((c) => c.profile.id)).size,
    driving: window.__game.carModel,
  }));
  check(
    'cars are named makes/models and you drive one',
    models.distinct > 1 && typeof models.driving === 'string' && models.driving.length > 0,
    `distinct models=${models.distinct}, driving "${models.driving}"`,
  );

  // --- 14b. On foot, you can't clip through a parked car — you get pushed out.
  await reset();
  await page.keyboard.press('KeyF'); // on foot
  await page.waitForFunction(() => window.__game.mode === 'foot', { timeout: 2000 });
  const clip = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const t = v.playerIndex === 0 ? 1 : 0;
    const car = v.cars[t];
    car.role = 'parked'; car.lane = null; car.vx = car.vz = 0;
    car.x = g.player.x + 20; car.z = g.player.z; // a clear spot
    g.player.x = car.x; g.player.z = car.z; // drop the player right on the car
    return { t };
  });
  // Poll for the push-out (resolveActor runs in the foot update each frame).
  let pushed = 0;
  for (let i = 0; i < 14 && pushed < 1.9; i++) {
    await page.waitForTimeout(120);
    pushed = await page.evaluate((t) => {
      const g = window.__game;
      const car = g.vehicles.cars[t];
      return Math.hypot(g.player.x - car.x, g.player.z - car.z);
    }, clip.t);
  }
  check(
    'on foot you are pushed out of cars (no clipping)',
    pushed >= 1.9, // outside CAR_RADIUS — not standing inside the car
    `distance to car = ${pushed.toFixed(2)}`,
  );

  // --- 15. Day/night cycle advances over time.
  await reset();
  const t0 = await page.evaluate(() => window.__game.timeOfDay);
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.__game.timeOfDay);
  check('day/night cycle advances', t1 > t0, `timeOfDay ${t0.toFixed(4)} -> ${t1.toFixed(4)}`);

  // --- 16. Pause menu: Esc freezes the sim (time stops); Esc again resumes.
  await reset();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const pausedState = await page.evaluate(() => ({
    paused: window.__game.paused,
    menu: getComputedStyle(document.getElementById('menu')).display !== 'none',
    t: window.__game.timeOfDay,
  }));
  await page.waitForTimeout(500); // sim should NOT advance while paused
  const stillPaused = await page.evaluate(() => window.__game.timeOfDay);
  await page.keyboard.press('Escape'); // resume
  await page.waitForTimeout(400);
  const resumed = await page.evaluate(() => ({
    paused: window.__game.paused,
    t: window.__game.timeOfDay,
  }));
  check(
    'Esc pauses (sim frozen) and resumes',
    pausedState.paused && pausedState.menu &&
      Math.abs(stillPaused - pausedState.t) < 1e-6 && // time frozen while paused
      !resumed.paused && resumed.t > stillPaused, // time advances again after resume
    `paused=${pausedState.paused} frozenΔ=${(stillPaused - pausedState.t).toFixed(5)} resumed=${!resumed.paused}`,
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
