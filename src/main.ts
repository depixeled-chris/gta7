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
import { Input } from './core/Input';
import { GameLoop } from './core/GameLoop';
import { toKmh, type VehicleInput } from './vehicles/VehicleModel';

const FOOT_RADIUS = 0.4;
const ENTER_DISTANCE = 5;

const container = document.getElementById('app')!;
const city = generateCity(DEFAULT_CITY);

const env = new SceneEnv(container, city);
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

const vehicles = new Vehicles(env.scene, city);
const peds = new Pedestrians(env.scene, city);
const hud = new HUD(container, city);
const input = new Input();
const follow = new FollowCamera(env.camera);
const player = new Player();

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
  } else {
    const i = vehicles.nearest(player.x, player.z, ENTER_DISTANCE);
    if (i >= 0) {
      vehicles.enter(i);
      mode = 'driving';
    }
  }
}

function drivingInput(): VehicleInput {
  return {
    throttle: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
    steer: input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']), // +1 = left
    handbrake: input.isDown('Space'),
  };
}

function updateFoot(dt: number): void {
  const yaw = follow.yaw;
  const fwd = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
  const strafe = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dirX = cos * fwd + sin * strafe;
  const dirZ = -sin * fwd + cos * strafe;

  player.update(dirX, dirZ, input.isDown('ShiftLeft') || input.isDown('ShiftRight'), dt);

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
  mode = 'foot';
  player.x = city.center.x;
  player.z = city.center.z + 6;
  player.heading = 0;
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

function update(dt: number): void {
  if (wasted) {
    wastedTimer -= dt;
    vehicles.update(city, dt, null, null);
    peds.update(city, dt);
    if (wastedTimer <= 0) respawn();
    input.endFrame();
    return;
  }

  if (input.wasPressed('KeyF') || input.wasPressed('KeyE')) toggleVehicle();

  if (mode === 'driving') {
    if (input.wasPressed('KeyR')) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput(), null);
  } else {
    vehicles.update(city, dt, null, { x: player.x, z: player.z });
    updateFoot(dt);
    checkPedestrianDamage();
  }

  peds.update(city, dt);
  input.endFrame();
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

function render(): void {
  avatar.position.set(player.x, 0, player.z);
  avatar.rotation.y = player.heading;
  avatar.visible = mode === 'foot';

  const pose = vehicles.playerPose();
  const active = mode === 'driving' && pose ? pose : player;
  lamp.position.set(active.x, 3.5, active.z);
  updateStreetlightPool(active.x, active.z);
  updateHeadlights(mode === 'driving' && pose ? pose : null);

  const dt = 1 / 60;
  follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, dt);

  const speedKmh = mode === 'driving' ? toKmh(vehicles.playerForwardSpeed()) : toKmh(player.speed);
  hud.update(speedKmh, mode, active, vehicles.positions(), health, wasted);
  env.render();
}

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
      readonly health: number;
      readonly wasted: boolean;
      vehicles: Vehicles;
      player: Player;
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
  vehicles,
  player,
  city,
};

new GameLoop(update, render).start();
