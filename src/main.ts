import * as THREE from 'three';
import { generateCity, DEFAULT_CITY } from './world/City';
import { SceneEnv } from './render/Scene';
import { CityAssets, makeCar, makePed } from './render/Assets';
import { Player } from './entities/Player';
import { FollowCamera, CAR_CAM, FOOT_CAM } from './systems/FollowCamera';
import { resolveCircle } from './systems/Collision';
import { Traffic } from './systems/Traffic';
import { Pedestrians } from './systems/Pedestrians';
import { HUD, type Mode } from './ui/HUD';
import { Input } from './core/Input';
import { GameLoop } from './core/GameLoop';
import { stepVehicle, DEFAULT_VEHICLE, toKmh, type VehicleState } from './vehicles/VehicleModel';

const CAR_RADIUS = 1.8;
const FOOT_RADIUS = 0.4;
const ENTER_DISTANCE = 4.5;

const container = document.getElementById('app')!;
const city = generateCity(DEFAULT_CITY);

const env = new SceneEnv(container, city);
const assets = new CityAssets(city.config.seed);
city.buildings.forEach((b, i) => env.scene.add(assets.makeBuilding(b, i)));

const playerCar = makeCar(0x10a0c8);
env.scene.add(playerCar.group);

const avatar = makePed(0x2266dd);
env.scene.add(avatar);

// Warm glow that rides the active actor so the night street reads up close.
const lamp = new THREE.PointLight(0xffd9a8, 60, 40, 2);
env.scene.add(lamp);

const traffic = new Traffic(env.scene, city);
const peds = new Pedestrians(env.scene, city);
const hud = new HUD(container, city);
const input = new Input();
const follow = new FollowCamera(env.camera);

let mode: Mode = 'driving';
let steerInput = 0;
const vehicle: VehicleState = { x: city.center.x, z: city.center.z, heading: 0, speed: 0 };
const player = new Player();
player.x = city.center.x;
player.z = city.center.z;

const clampToCity = (p: { x: number; z: number }): void => {
  const b = city.half - 2;
  p.x = Math.max(-b, Math.min(b, p.x));
  p.z = Math.max(-b, Math.min(b, p.z));
};

function toggleVehicle(): void {
  if (mode === 'driving') {
    // Step out to the left of the car.
    const lx = Math.sin(vehicle.heading);
    const lz = Math.cos(vehicle.heading);
    player.x = vehicle.x - lx * 2.4;
    player.z = vehicle.z - lz * 2.4;
    player.heading = vehicle.heading;
    mode = 'foot';
  } else {
    const dist = Math.hypot(player.x - vehicle.x, player.z - vehicle.z);
    if (dist <= ENTER_DISTANCE) mode = 'driving';
  }
}

function updateDriving(dt: number): void {
  const throttle = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
  steerInput = input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']); // +1 = left
  const handbrake = input.isDown('Space');

  const next = stepVehicle(vehicle, { throttle, steer: steerInput, handbrake }, DEFAULT_VEHICLE, dt);
  Object.assign(vehicle, next);

  const fixed = resolveCircle(vehicle.x, vehicle.z, CAR_RADIUS, city.colliders);
  if (fixed.x !== vehicle.x || fixed.z !== vehicle.z) {
    vehicle.x = fixed.x;
    vehicle.z = fixed.z;
    vehicle.speed *= 0.35; // scrub speed on impact
  }
  clampToCity(vehicle);

  if (input.wasPressed('KeyR')) {
    vehicle.x = city.center.x;
    vehicle.z = city.center.z;
    vehicle.heading = 0;
    vehicle.speed = 0;
  }
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

function update(dt: number): void {
  if (input.wasPressed('KeyF') || input.wasPressed('KeyE')) toggleVehicle();

  if (mode === 'driving') updateDriving(dt);
  else updateFoot(dt);

  traffic.update(city, dt);
  peds.update(city, dt);
  input.endFrame();
}

function render(): void {
  playerCar.group.position.set(vehicle.x, 0, vehicle.z);
  playerCar.group.rotation.y = vehicle.heading;
  for (const w of playerCar.steerWheels) w.rotation.y = steerInput * 0.5;

  avatar.position.set(player.x, 0, player.z);
  avatar.rotation.y = player.heading;
  avatar.visible = mode === 'foot';

  const active = mode === 'driving' ? vehicle : player;
  lamp.position.set(active.x, 3.5, active.z);

  const dt = 1 / 60;
  if (mode === 'driving') follow.update(vehicle.x, vehicle.z, vehicle.heading, CAR_CAM, dt);
  else follow.update(player.x, player.z, player.heading, FOOT_CAM, dt);

  hud.update(toKmh(vehicle.speed), mode, active, traffic.positions());
  env.render();
}

new GameLoop(update, render).start();
