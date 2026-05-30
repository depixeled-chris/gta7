import * as THREE from 'three';
import { generateCity, DEFAULT_CITY } from './world/City';
import { SceneEnv } from './render/Scene';
import { CityAssets, makePed } from './render/Assets';
import { Player } from './entities/Player';
import { FollowCamera, CAR_CAM, FOOT_CAM } from './systems/FollowCamera';
import { resolveCircle } from './systems/Collision';
import { Vehicles } from './systems/Vehicles';
import { Pedestrians } from './systems/Pedestrians';
import { HUD, type Mode } from './ui/HUD';
import { Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { lerp, angleLerp, starsFromHeat } from './core/math';
import { Radio } from './audio/Radio';
import { Sfx } from './audio/Sfx';
import { toKmh, DEFAULT_VEHICLE, type VehicleInput } from './vehicles/VehicleModel';

/** Touch UI + lower quality on coarse-pointer devices; `?touch=1|0` forces it. */
function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

const FOOT_RADIUS = 0.4;
const ENTER_DISTANCE = 6; // generous so curbside parked cars are easy to get into

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

const vehicles = new Vehicles(env.scene, city, touch ? 24 : 40);
const peds = new Pedestrians(env.scene, city, touch ? 28 : 60);
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
let userGestured = false;
const sfx = new Sfx();
const markGesture = (): void => {
  userGestured = true;
  sfx.start(); // create/resume the audio context within the gesture
};
addEventListener('keydown', markGesture);
addEventListener('pointerdown', markGesture);

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
const HEAT_GRACE = 6; // seconds of no crime before heat starts to cool
const HEAT_DECAY = 11; // heat lost per second once cooling
let heat = 0;
let stars = 0;
let sinceCrime = 0;
let prevRunOver = 0;

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
    radio?.exitCar();
    sfx.exitCar();
  } else {
    const i = vehicles.nearest(player.x, player.z, ENTER_DISTANCE);
    if (i >= 0) {
      vehicles.enter(i);
      mode = 'driving';
      radio?.enterCar();
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
  const m = controls.move();
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dirX = cos * m.y + sin * m.x;
  const dirZ = -sin * m.y + cos * m.x;

  player.update(dirX, dirZ, controls.sprint(), dt);

  const fixed = resolveCircle(player.x, player.z, FOOT_RADIUS, city.colliders);
  player.x = fixed.x;
  player.z = fixed.z;
  clampToCity(player);
}

function enterWasted(): void {
  wasted = true;
  wastedTimer = WASTED_TIME;
  health = 0;
}

function respawn(): void {
  wasted = false;
  health = MAX_HEALTH;
  pedContact = false;
  heat = 0; // getting WASTED clears your wanted level
  sinceCrime = 0;
  mode = 'foot';
  player.x = city.center.x;
  player.z = city.center.z + 6;
  player.heading = 0;
}

/** Active player position the police home in on (the car, or the avatar on foot). */
function chaseTarget(): { x: number; z: number } {
  const pose = vehicles.playerPose();
  return mode === 'driving' && pose ? { x: pose.x, z: pose.z } : { x: player.x, z: player.z };
}

/** Crimes raise heat; it cools after a grace period. Heat → wanted stars → police. */
function updateWanted(dt: number): void {
  const over = peds.runOverCount;
  if (over > prevRunOver) {
    sfx.gib();
    heat = Math.min(100, heat + (over - prevRunOver) * CRIME_HEAT);
    sinceCrime = 0;
  } else {
    sinceCrime += dt;
    if (sinceCrime > HEAT_GRACE) heat = Math.max(0, heat - HEAT_DECAY * dt);
  }
  prevRunOver = over;
  stars = starsFromHeat(heat);
  vehicles.setWanted(stars, chaseTarget(), city);
}

/** While on foot, take damage from cars that hit us; trigger WASTED at zero. */
function checkPedestrianDamage(): void {
  const hit = vehicles.pedestrianImpact(player.x, player.z);
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

function update(dt: number): void {
  player.savePrev();

  if (wasted) {
    wastedTimer -= dt;
    vehicles.update(city, dt, null, null);
    peds.update(city, dt, runOverQuery);
    if (wastedTimer <= 0) respawn();
    controls.endFrame();
    return;
  }

  if (controls.enterExitPressed()) toggleVehicle();

  updateWanted(dt);
  const chase = stars > 0 ? chaseTarget() : null;

  if (mode === 'driving') {
    if (controls.resetPressed()) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput(), null, chase);
  } else {
    vehicles.update(city, dt, null, { x: player.x, z: player.z }, chase);
    updateFoot(dt);
    checkPedestrianDamage();
  }

  if (radio) {
    const step = controls.radioStep();
    if (step !== 0) radio.step(step);
    // Spawned in a car: tune in once the player has gestured (autoplay rules).
    if (!radioPrimed && userGestured && mode === 'driving') {
      radio.enterCar();
      radioPrimed = true;
    }
  }

  peds.update(city, dt, runOverQuery);
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

  follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, frameDt);

  const speedKmh = mode === 'driving' ? toKmh(vehicles.playerForwardSpeed()) : toKmh(player.speed);
  hud.update(speedKmh, mode, active, vehicles.positions(), health, wasted);
  hud.setRunOverCount(peds.runOverCount);
  hud.setRadio(radio ? radio.label() : '📻 OFF');
  hud.setWanted(stars);

  const driving = mode === 'driving';
  sfx.setEngine(driving, Math.abs(vehicles.playerForwardSpeed()) / DEFAULT_VEHICLE.maxSpeed);
  sfx.setScreech(driving ? Math.max(0, (vehicles.playerLateralSpeed() - 2) / 8) : 0);

  env.render();
}

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
      readonly health: number;
      readonly wasted: boolean;
      readonly runOverCount: number;
      readonly radioLabel: string;
      readonly wanted: number;
      readonly police: number;
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
  get wasted() {
    return wasted;
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
  get police() {
    return vehicles.activePoliceCount();
  },
  vehicles,
  player,
  peds,
  city,
};

new GameLoop(update, render).start();
