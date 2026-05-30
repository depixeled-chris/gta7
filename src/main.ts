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

const avatar = makePed(0x2266dd);
env.scene.add(avatar);

// Warm glow that rides the active actor so the night street reads up close.
const lamp = new THREE.PointLight(0xffd9a8, 60, 40, 2);
env.scene.add(lamp);

const vehicles = new Vehicles(env.scene, city);
const peds = new Pedestrians(env.scene, city);
const hud = new HUD(container, city);
const input = new Input();
const follow = new FollowCamera(env.camera);
const player = new Player();

let mode: Mode = 'driving';
player.x = city.center.x;
player.z = city.center.z;

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

function update(dt: number): void {
  if (input.wasPressed('KeyF') || input.wasPressed('KeyE')) toggleVehicle();

  if (mode === 'driving') {
    if (input.wasPressed('KeyR')) vehicles.resetPlayer(city);
    vehicles.update(city, dt, drivingInput());
  } else {
    vehicles.update(city, dt, null);
    updateFoot(dt);
  }

  peds.update(city, dt);
  input.endFrame();
}

function render(): void {
  avatar.position.set(player.x, 0, player.z);
  avatar.rotation.y = player.heading;
  avatar.visible = mode === 'foot';

  const pose = vehicles.playerPose();
  const active = mode === 'driving' && pose ? pose : player;
  lamp.position.set(active.x, 3.5, active.z);

  const dt = 1 / 60;
  follow.update(active.x, active.z, active.heading, mode === 'driving' ? CAR_CAM : FOOT_CAM, dt);

  const speedKmh = mode === 'driving' ? toKmh(vehicles.playerForwardSpeed()) : toKmh(player.speed);
  hud.update(speedKmh, mode, active, vehicles.positions());
  env.render();
}

declare global {
  interface Window {
    __game?: {
      readonly mode: Mode;
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
  vehicles,
  player,
  city,
};

new GameLoop(update, render).start();
