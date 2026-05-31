import * as THREE from 'three';
import { generateCity, DEFAULT_CITY } from './world/City';
import { SceneEnv } from './render/Scene';
import { CityAssets, makePed } from './render/Assets';
import { Player } from './entities/Player';
import { FollowCamera, CAR_CAM, FOOT_CAM } from './systems/FollowCamera';
import { Vehicles } from './systems/Vehicles';
import { Pedestrians } from './systems/Pedestrians';
import { Debris } from './systems/Debris';
import { World } from './ecs/World';
import { HUD, type Mode } from './ui/HUD';
import { showSplash } from './ui/Splash';
import { Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { lerp, angleLerp, starsFromHeat } from './core/math';
import { Radio } from './audio/Radio';
import { Sfx } from './audio/Sfx';
import { toMph, type VehicleInput } from './vehicles/VehicleModel';

/** Touch UI + lower quality on coarse-pointer devices; `?touch=1|0` forces it. */
function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

const FOOT_RADIUS = 0.4;
const ENTER_DISTANCE = 6; // generous so curbside parked cars are easy to get into
const ENGINE_HEAR = 28; // on foot, how far a parked car's idle is audible
const STEP_DISTANCE = 1.7; // metres of travel between footstep sounds
let footAccum = 0;

const DAY_LENGTH = 480; // seconds for a full day/night cycle
let timeOfDay = 0; // [0,1), 0 = midnight (the original night look)

const container = document.getElementById('app')!;
const touch = isTouchDevice();
const city = generateCity(DEFAULT_CITY);

const env = new SceneEnv(
  container,
  city,
  touch ? { maxPixelRatio: 1.5, shadowMapSize: 1024 } : {},
);
const assets = new CityAssets(city.config.seed);
city.buildings.forEach((b, i) => env.scene.add(assets.makeBuilding(b, i)));
city.streetlights.forEach((s) => env.scene.add(assets.makeStreetlight(s)));
env.scene.add(assets.makeProps(city.props));

const avatar = makePed(0x2266dd);
env.scene.add(avatar);

// Warm glow that rides the active actor so the night street reads up close.
const lamp = new THREE.PointLight(0xffd9a8, 60, 40, 2);
env.scene.add(lamp);

// A handful of real point lights hop to the streetlights nearest the player,
// so lamps actually cast pools of light without paying for 81 live lights.
const STREETLIGHT_POOL = 6;
const streetlightPool = Array.from({ length: STREETLIGHT_POOL }, () => {
  const l = new THREE.PointLight(0xffcf9a, 45, 28, 1.6);
  env.scene.add(l);
  return l;
});
const slOrder = city.streetlights.map((_, i) => i);

// Twin headlight spots on the car you're driving; dark while on foot.
const headlights = [0, 1].map(() => {
  const light = new THREE.SpotLight(0xfff2d0, 0, 42, 0.62, 0.5, 1.1);
  const target = new THREE.Object3D();
  light.target = target;
  env.scene.add(light, target);
  return { light, target };
});

// One shared ECS World holds all dynamic entities (cars, pedestrians, debris),
// and one shared Debris pool serves both car wrecks and pedestrian gibs.
const world = new World();
const debris = new Debris(env.scene, world);
const vehicles = new Vehicles(env.scene, city, world, debris, touch ? 24 : 40);
const peds = new Pedestrians(env.scene, city, world, debris, touch ? 28 : 60);
const hud = new HUD(container, city, touch);

let touchRoot: HTMLElement | undefined;
if (touch) {
  touchRoot = document.createElement('div');
  container.appendChild(touchRoot);
}
const controls = new Controls(touchRoot);
const follow = new FollowCamera(env.camera);
const player = new Player();

// The radio streams one track at a time from a CDN-hosted manifest, so the
// (large) music library is never bundled. It loads asynchronously and stays
// silent until the first user gesture (browser autoplay policy).
let radio: Radio | null = null;
let radioPrimed = false;
let radioCarIndex: number | null = null; // which car's radio is currently loaded
const sfx = new Sfx();
const markGesture = (): void => {
  sfx.start(); // create/resume the audio context within the gesture
  primeRadio(); // iOS only lets the <audio> element start from inside a gesture
};
addEventListener('keydown', markGesture);
addEventListener('pointerdown', markGesture);

/**
 * Kick the radio off. MUST be reachable from a user-gesture call stack: iOS
 * Safari refuses HTMLAudioElement.play() outside one, so priming from the game
 * loop left the radio silent until the player tapped the radio button. Called
 * from markGesture and retried each gesture until the manifest has loaded.
 */
function primeRadio(): void {
  if (!radio || radioPrimed || mode !== 'driving') return;
  const i = vehicles.playerIndex ?? 0;
  radio.enterCar(i);
  radioCarIndex = i;
  radioPrimed = true;
}

interface RadioManifest {
  baseUrl: string;
  stations: { name: string; tracks: { title: string; file: string }[] }[];
}
fetch('radio.json')
  .then((r) => (r.ok ? (r.json() as Promise<RadioManifest>) : null))
  .then((data) => {
    if (!data?.stations?.length) return;
    radio = new Radio(
      data.stations.map((s) => ({
        name: s.name,
        tracks: s.tracks.map((t) => ({ title: t.title, url: data.baseUrl + t.file })),
      })),
    );
  })
  .catch(() => {});

let mode: Mode = 'driving';
player.x = city.center.x;
player.z = city.center.z;

const MAX_HEALTH = 100;
const HIT_SPEED = 3; // m/s a car must exceed to injure a pedestrian
const DAMAGE_PER_SPEED = 5; // health lost per m/s of impact
const KNOCKBACK = 1.6;
const WASTED_TIME = 3; // seconds the WASTED screen holds before respawn

let health = MAX_HEALTH;
let wasted = false;
let wastedTimer = 0;
let pedContact = false; // were we in contact with a car last frame (edge-trigger)

// Wanted system: "heat" rises with crimes and decays after a grace period;
// it maps to 0–5 stars, and each star is one chasing police car.
const CRIME_HEAT = 16; // heat added per pedestrian you personally run over
const HEAT_GRACE = 4; // seconds OUT OF POLICE SIGHT before heat starts to cool
const HEAT_DECAY = 11; // heat lost per second once cooling
let heat = 0;
let stars = 0;
let sinceUnseen = 0; // seconds since a cop last had line of sight (the "get away" timer)
let wantedCooling = false; // true while stars are cooling off (HUD flashes them)
let prevRunOver = 0;

// Busted: a chasing cop pins you slow for long enough → arrested, game resets.
const BUST_RADIUS = 7; // a cop this close...
const BUST_SPEED = 5; // ...while you're slower than this (m/s)...
const BUST_FILL_TIME = 1.8; // ...for this long → BUSTED
const BUSTED_TIME = 3; // seconds the BUSTED screen holds before respawn
let busted = false;
let bustedTimer = 0;
let bustFill = 0;

const clampToCity = (p: { x: number; z: number }): void => {
  const b = city.half - 2;
  p.x = Math.max(-b, Math.min(b, p.x));
  p.z = Math.max(-b, Math.min(b, p.z));
};

function toggleVehicle(): void {
  if (mode === 'driving') {
    const pose = vehicles.playerPose()!;
    // Step out to the left of the car.
    player.x = pose.x - Math.sin(pose.heading) * 2.4;
    player.z = pose.z - Math.cos(pose.heading) * 2.4;
    player.heading = pose.heading;
    vehicles.exit();
    mode = 'foot';
    sfx.exitCar();
  } else {
    const i = vehicles.nearest(player.x, player.z, ENTER_DISTANCE);
    if (i >= 0) {
      vehicles.enter(i);
      mode = 'driving';
      radio?.enterCar(i);
      radioCarIndex = i;
      radioPrimed = true;
      sfx.enterCar();
    }
  }
}

function drivingInput(): VehicleInput {
  const m = controls.move();
  return {
    throttle: m.y, // forward
    steer: -m.x, // +1 = left, so right stick (+x) steers right
    handbrake: controls.handbrake(),
  };
}

function updateFoot(dt: number): void {
  const yaw = follow.yaw;
  const m = controls.move(true);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dirX = cos * m.y + sin * m.x;
  const dirZ = -sin * m.y + cos * m.x;

  player.update(dirX, dirZ, controls.sprint(true), dt);

  const fixed = city.grid.resolve(player.x, player.z, FOOT_RADIUS);
  player.x = fixed.x;
  player.z = fixed.z;
  // Don't walk through cars (parked or otherwise).
  const offCar = vehicles.resolveActor(player.x, player.z, FOOT_RADIUS);
  player.x = offCar.x;
  player.z = offCar.z;
  clampToCity(player);
}

function enterWasted(): void {
  wasted = true;
  wastedTimer = WASTED_TIME;
  health = 0;
}

function respawn(): void {
  wasted = false;
  busted = false;
  bustFill = 0;
  health = MAX_HEALTH;
  pedContact = false;
  heat = 0; // getting WASTED/BUSTED clears your wanted level
  sinceUnseen = 0;
  wantedCooling = false;
  mode = 'foot';
  player.x = city.center.x;
  player.z = city.center.z + 6;
  player.heading = 0;
}

function enterBusted(): void {
  busted = true;
  bustedTimer = BUSTED_TIME;
  bustFill = 0;
}

/** A chasing cop pinning you slow fills the bust meter; sustained → BUSTED. */
function updateBusted(dt: number): void {
  const t = chaseTarget();
  const speed = mode === 'driving' ? Math.abs(vehicles.playerForwardSpeed()) : player.speed;
  const pinned = vehicles.nearestPoliceDistance(t.x, t.z) < BUST_RADIUS && speed < BUST_SPEED;
  bustFill = pinned ? bustFill + dt : Math.max(0, bustFill - 2 * dt); // fills slow, clears fast
  if (bustFill >= BUST_FILL_TIME) enterBusted();
}

/** Active player pose + velocity the police intercept (the car, or the avatar on foot). */
function chaseTarget(): { x: number; z: number; vx: number; vz: number } {
  const pose = vehicles.playerPose();
  if (mode === 'driving' && pose) {
    const v = vehicles.playerVelocity();
    return { x: pose.x, z: pose.z, vx: v.vx, vz: v.vz };
  }
  return {
    x: player.x,
    z: player.z,
    vx: Math.cos(player.heading) * player.speed,
    vz: -Math.sin(player.heading) * player.speed,
  };
}

/**
 * Crimes raise heat → wanted stars → police. You "get away" GTA-style: once no
 * cop has line of sight to you (broke LOS behind a building, or outran their
 * sight range), the heat cools after a short grace and the stars drop.
 */
function updateWanted(dt: number): void {
  const over = peds.runOverCount;
  const t = chaseTarget();
  const seen = stars > 0 && vehicles.anyPoliceSeesTarget(t.x, t.z, city.colliders);
  if (over > prevRunOver) {
    sfx.gib();
    heat = Math.min(100, heat + (over - prevRunOver) * CRIME_HEAT);
    sinceUnseen = 0;
  } else if (seen) {
    sinceUnseen = 0; // they have eyes on you — wanted holds
  } else {
    sinceUnseen += dt;
    if (sinceUnseen > HEAT_GRACE) heat = Math.max(0, heat - HEAT_DECAY * dt);
  }
  prevRunOver = over;
  wantedCooling = stars > 0 && !seen && sinceUnseen > HEAT_GRACE;
  stars = starsFromHeat(heat);
  vehicles.setWanted(stars, t, city);
}

/** While on foot, take damage from cars that hit us; trigger WASTED at zero. */
function checkPedestrianDamage(): void {
  // Exclude police: a cop catching you on foot triggers BUSTED (arrest), it
  // doesn't run you over. Ordinary traffic can still flatten you.
  const hit = vehicles.pedestrianImpact(player.x, player.z, false, false);
  const contact = !!hit && hit.speed > HIT_SPEED;
  if (contact && !pedContact) {
    health -= hit!.speed * DAMAGE_PER_SPEED;
    player.x += hit!.nx * KNOCKBACK;
    player.z += hit!.nz * KNOCKBACK;
    if (health <= 0) enterWasted();
  }
  pedContact = contact;
}

// Any car (including the one you're driving) moving fast enough flattens peds.
const runOverQuery = (x: number, z: number) => vehicles.pedestrianImpact(x, z, true);
// Pedestrians (like the player on foot) get pushed out of cars they'd clip.
const resolveCars = (x: number, z: number, r: number) => vehicles.resolveActor(x, z, r);

/** Sound the car wrecks from this step; a wrecked player car means WASTED. */
function flushCarWrecks(): void {
  const n = vehicles.consumeExplosions();
  for (let k = 0; k < Math.min(n, 3); k++) sfx.explosion();
  if (vehicles.consumePlayerWreck() && !wasted) enterWasted();
}

function update(dt: number): void {
  player.savePrev();
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;

  if (wasted || busted) {
    if (wasted) wastedTimer -= dt;
    else bustedTimer -= dt;
    vehicles.update(city, dt, null, null);
    flushCarWrecks();
    peds.update(city, dt, runOverQuery, null, resolveCars);
    debris.update(dt); // shared pool, advanced once per frame
    if ((wasted && wastedTimer <= 0) || (busted && bustedTimer <= 0)) respawn();
    controls.endFrame();
    return;
  }

  if (controls.enterExitPressed()) toggleVehicle();

  updateWanted(dt);
  const chase = stars > 0 ? chaseTarget() : null;

  if (mode === 'driving') {
    if (controls.resetPressed()) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput(), null, chase);
    flushCarWrecks();
  } else {
    vehicles.update(city, dt, null, { x: player.x, z: player.z }, chase);
    flushCarWrecks();
    updateFoot(dt);
    checkPedestrianDamage();

    // Punch: gib the pedestrian in front of you (scores + raises heat, like a
    // run-over). Forward is the player's heading: (cos h, -sin h).
    if (controls.punchPressed()) {
      peds.punch(player.x, player.z, Math.cos(player.heading), -Math.sin(player.heading));
    }

    // Footsteps cadence with travel distance (faster when sprinting).
    if (player.speed > 0.1) {
      footAccum += player.speed * dt;
      if (footAccum >= STEP_DISTANCE) {
        footAccum = 0;
        sfx.footstep();
      }
    } else {
      footAccum = STEP_DISTANCE; // first move triggers a step promptly
    }
  }

  if (radio) {
    const step = controls.radioStep();
    if (step !== 0) radio.step(step);
  }

  updateBusted(dt);
  // Pedestrians fear the CAR only (not the player on foot): proximity, or a fast
  // car on a vector to hit them. Threat carries velocity for the vector trigger.
  peds.update(city, dt, runOverQuery, mode === 'driving' ? chaseTarget() : null, resolveCars);
  debris.update(dt); // shared pool, advanced once per frame
  controls.endFrame();
}

function updateStreetlightPool(ax: number, az: number): void {
  const sl = city.streetlights;
  const d2 = (i: number): number => (sl[i].x - ax) ** 2 + (sl[i].z - az) ** 2;
  slOrder.sort((a, b) => d2(a) - d2(b));
  for (let i = 0; i < streetlightPool.length; i++) {
    const s = sl[slOrder[i]];
    streetlightPool[i].position.set(s.x, 4.8, s.z);
  }
}

function updateHeadlights(pose: { x: number; z: number; heading: number } | null): void {
  if (!pose) {
    for (const h of headlights) h.light.intensity = 0;
    return;
  }
  const fx = Math.cos(pose.heading);
  const fz = -Math.sin(pose.heading);
  const rx = Math.sin(pose.heading);
  const rz = Math.cos(pose.heading);
  for (let i = 0; i < headlights.length; i++) {
    const side = i === 0 ? -0.6 : 0.6;
    const h = headlights[i];
    h.light.position.set(pose.x + fx * 2 + rx * side, 0.7, pose.z + fz * 2 + rz * side);
    h.target.position.set(pose.x + fx * 16, 0.1, pose.z + fz * 16);
    h.light.intensity = 90;
  }
}

function render(alpha: number, frameDt: number): void {
  // Interpolate every moving thing between its previous and current physics
  // step so motion stays smooth regardless of how steps line up with frames.
  vehicles.render(alpha);
  peds.render(alpha);
  debris.render(alpha); // shared pool, drawn once per frame

  const ax = lerp(player.px, player.x, alpha);
  const az = lerp(player.pz, player.z, alpha);
  const ah = angleLerp(player.ph, player.heading, alpha);
  avatar.position.set(ax, 0, az);
  avatar.rotation.y = ah;
  avatar.visible = mode === 'foot';

  const carPose = vehicles.playerPoseInterp(alpha);
  const active =
    mode === 'driving' && carPose ? carPose : { x: ax, z: az, heading: ah, speed: player.speed };
  lamp.position.set(active.x, 3.5, active.z);
  updateStreetlightPool(active.x, active.z);
  updateHeadlights(mode === 'driving' && carPose ? carPose : null);

  follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, frameDt, Math.abs(active.speed));

  const speedMph = mode === 'driving' ? toMph(vehicles.playerForwardSpeed()) : toMph(player.speed);
  // The health bar reads car integrity while driving, avatar health on foot.
  const shownHealth = mode === 'driving' ? vehicles.playerCarHealth() : health;
  hud.update(speedMph, mode, active, vehicles.positions(), shownHealth, wasted);
  hud.setRunOverCount(peds.runOverCount);
  hud.setCarName(mode === 'driving' ? vehicles.playerCarName() : null);
  hud.setRadio(radio ? radio.label() : '📻 OFF');
  hud.setWanted(stars, wantedCooling);
  hud.setBusted(busted);

  const driving = mode === 'driving';
  if (driving) {
    sfx.setEngine(Math.abs(vehicles.playerForwardSpeed()) / vehicles.playerMaxSpeed(), 1);
    sfx.setScreech(Math.max(0, (vehicles.playerLateralSpeed() - 2) / 8));
    if (radio) radio.updateProximity(true, 0);
  } else {
    sfx.setScreech(0);
    // The car you left keeps idling and playing; both fade as you walk off.
    const dist =
      radioCarIndex !== null
        ? Math.hypot(player.x - vehicles.carPosition(radioCarIndex).x, player.z - vehicles.carPosition(radioCarIndex).z)
        : Infinity;
    const near = Math.max(0, 1 - dist / ENGINE_HEAR);
    sfx.setEngine(0, near * 0.6); // idle, quieter than under throttle
    if (radio) radio.updateProximity(false, dist);
  }

  env.setTimeOfDay(timeOfDay);
  env.render();

  // Perf telemetry (watched in the smoke run; see performance-vigilance memory).
  if (frameDt > 0) perf.frameMs = perf.frameMs === 0 ? frameDt * 1000 : perf.frameMs * 0.9 + frameDt * 1000 * 0.1;
  const info = env.renderer.info;
  perf.drawCalls = info.render.calls;
  perf.triangles = info.render.triangles;
  perf.geometries = info.memory.geometries;
  perf.textures = info.memory.textures;
}

interface Perf {
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}
const perf: Perf = { frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
      readonly health: number;
      readonly carHealth: number;
      readonly wasted: boolean;
      readonly busted: boolean;
      readonly runOverCount: number;
      readonly radioLabel: string;
      readonly wanted: number;
      readonly wantedCooling: boolean;
      readonly police: number;
      readonly timeOfDay: number;
      readonly radioReady: boolean;
      readonly carModel: string | null;
      readonly perf: Perf;
      vehicles: Vehicles;
      player: Player;
      peds: Pedestrians;
      city: typeof city;
    };
  }
}
window.__game = {
  get mode() {
    return mode;
  },
  get health() {
    return health;
  },
  get carHealth() {
    return vehicles.playerCarHealth();
  },
  get wasted() {
    return wasted;
  },
  get busted() {
    return busted;
  },
  get runOverCount() {
    return peds.runOverCount;
  },
  get radioLabel() {
    return radio ? radio.label() : '📻 OFF';
  },
  get wanted() {
    return stars;
  },
  get wantedCooling() {
    return wantedCooling;
  },
  get police() {
    return vehicles.activePoliceCount();
  },
  get timeOfDay() {
    return timeOfDay;
  },
  get radioReady() {
    return radio !== null; // manifest fetched + tuner built
  },
  get carModel() {
    return vehicles.playerCarName();
  },
  get perf() {
    return perf;
  },
  vehicles,
  player,
  peds,
  city,
};

new GameLoop(update, render).start();
showSplash(container); // title screen; click/tap/key/gamepad fades into the game
