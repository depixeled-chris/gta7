import * as THREE from 'three';
import type { City, Lane } from '../world/City';
import { createRng } from '../core/rng';
import { damp } from '../core/math';
import { makeCar } from '../render/Assets';
import { resolveCircle, circleOverlap, nearestIndex } from './Collision';
import {
  stepVehicle,
  speedOf,
  forwardSpeedOf,
  DEFAULT_VEHICLE,
  type VehicleInput,
} from '../vehicles/VehicleModel';

/**
 * Every car — the one the player drives, ambient AI traffic, and abandoned
 * wrecks — is the same kind of object with a world position and velocity. A
 * single collision pass (buildings + car-vs-car momentum exchange) runs over
 * all of them, so ramming traffic shoves it physically and AI cars steer back
 * to their lane afterward. Only the player's car is integrated by the arcade
 * `stepVehicle` model; the rest follow lanes or coast to rest.
 */

type Role = 'ai' | 'parked';

interface Car {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  role: Role;
  lane: Lane | null;
  cruise: number;
  group: THREE.Group;
  steerWheels: THREE.Object3D[];
}

const PLAYER_COLOR = 0x10a0c8;
const TRAFFIC_COLORS = [0xb23a3a, 0x3a6db2, 0xd9b44a, 0x4ab36a, 0xcccccc, 0x2a2a2a, 0xc06a2a];

const CAR_RADIUS = 1.9;
const LANE_CORRECT = 2.2; // how hard AI steers back to lane centerline
const AI_RECOVER = 2.6; // how fast AI velocity returns to cruise after a hit
const PARK_FRICTION = 1.8; // how fast an abandoned/shoved car coasts to rest
const RESTITUTION = 0.4; // bounciness of car-on-car impacts

export class Vehicles {
  private readonly cars: Car[] = [];
  playerIndex: number | null = 0;
  private steer = 0;

  constructor(scene: THREE.Scene, city: City, trafficCount = 40, seed = 909) {
    const start = makeCar(PLAYER_COLOR);
    start.group.position.set(city.center.x, 0, city.center.z);
    scene.add(start.group);
    this.cars.push({
      x: city.center.x,
      z: city.center.z,
      heading: 0,
      vx: 0,
      vz: 0,
      role: 'parked',
      lane: null,
      cruise: 0,
      group: start.group,
      steerWheels: start.steerWheels,
    });

    const rng = createRng(seed);
    for (let i = 0; i < trafficCount && city.lanes.length > 0; i++) {
      const lane = rng.pick(city.lanes);
      const car = makeCar(rng.pick(TRAFFIC_COLORS));
      scene.add(car.group);
      const along = rng.range(-city.half, city.half);
      this.cars.push({
        x: lane.axis === 'x' ? along : lane.fixed,
        z: lane.axis === 'z' ? along : lane.fixed,
        heading: 0,
        vx: 0,
        vz: 0,
        role: 'ai',
        lane,
        cruise: rng.range(10, 22),
        group: car.group,
        steerWheels: car.steerWheels,
      });
    }

    for (const spot of city.parkingSpots) {
      const car = makeCar(rng.pick(TRAFFIC_COLORS));
      car.group.position.set(spot.x, 0, spot.z);
      car.group.rotation.y = spot.heading;
      scene.add(car.group);
      this.cars.push({
        x: spot.x,
        z: spot.z,
        heading: spot.heading,
        vx: 0,
        vz: 0,
        role: 'parked',
        lane: null,
        cruise: 0,
        group: car.group,
        steerWheels: car.steerWheels,
      });
    }
  }

  update(city: City, dt: number, input: VehicleInput | null): void {
    if (this.playerIndex !== null && input) {
      this.steer = input.steer;
      const pc = this.cars[this.playerIndex];
      const next = stepVehicle(pc, input, DEFAULT_VEHICLE, dt);
      pc.x = next.x;
      pc.z = next.z;
      pc.heading = next.heading;
      pc.vx = next.vx;
      pc.vz = next.vz;
    }

    for (let i = 0; i < this.cars.length; i++) {
      if (i === this.playerIndex) continue;
      const car = this.cars[i];
      if (car.role === 'ai') this.driveAi(car, city, dt);
      else this.coast(car, dt);
    }

    this.collide(city);

    if (this.playerIndex !== null) {
      const c = this.cars[this.playerIndex];
      const b = city.half - 2;
      c.x = Math.max(-b, Math.min(b, c.x));
      c.z = Math.max(-b, Math.min(b, c.z));
    }
    this.syncMeshes();
  }

  private driveAi(car: Car, city: City, dt: number): void {
    const lane = car.lane!;
    const half = city.half;

    // Wrap around the city edge so the loop of traffic never runs out.
    if (lane.axis === 'x') {
      if (car.x > half) car.x -= half * 2;
      else if (car.x < -half) car.x += half * 2;
    } else if (car.z > half) car.z -= half * 2;
    else if (car.z < -half) car.z += half * 2;

    const lateral = lane.axis === 'x' ? car.z - lane.fixed : car.x - lane.fixed;
    const alongV = lane.dir * car.cruise;
    const latV = -lateral * LANE_CORRECT;
    const desX = lane.axis === 'x' ? alongV : latV;
    const desZ = lane.axis === 'z' ? alongV : latV;

    car.vx = damp(car.vx, desX, AI_RECOVER, dt);
    car.vz = damp(car.vz, desZ, AI_RECOVER, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
  }

  private coast(car: Car, dt: number): void {
    car.vx = damp(car.vx, 0, PARK_FRICTION, dt);
    car.vz = damp(car.vz, 0, PARK_FRICTION, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
  }

  private collide(city: City): void {
    for (const car of this.cars) {
      const fixed = resolveCircle(car.x, car.z, CAR_RADIUS, city.colliders);
      const px = fixed.x - car.x;
      const pz = fixed.z - car.z;
      const len = Math.hypot(px, pz);
      car.x = fixed.x;
      car.z = fixed.z;
      if (len > 1e-6) {
        const nx = px / len;
        const nz = pz / len;
        const into = car.vx * nx + car.vz * nz;
        if (into < 0) {
          car.vx -= into * nx;
          car.vz -= into * nz;
        }
        car.vx *= 0.6;
        car.vz *= 0.6;
      }
    }

    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const o = circleOverlap(a.x, a.z, b.x, b.z, CAR_RADIUS * 2);
        if (!o) continue;

        const half = o.depth / 2;
        a.x += o.nx * half;
        a.z += o.nz * half;
        b.x -= o.nx * half;
        b.z -= o.nz * half;

        const vn = (a.vx - b.vx) * o.nx + (a.vz - b.vz) * o.nz;
        if (vn < 0) {
          const imp = (-(1 + RESTITUTION) * vn) / 2; // equal mass
          a.vx += imp * o.nx;
          a.vz += imp * o.nz;
          b.vx -= imp * o.nx;
          b.vz -= imp * o.nz;
        }
      }
    }
  }

  private syncMeshes(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.group.position.set(car.x, 0, car.z);
      // The player's car points where it's steered (so drifts read correctly);
      // everyone else faces their travel direction.
      if (i !== this.playerIndex && Math.hypot(car.vx, car.vz) > 0.5) {
        car.heading = Math.atan2(-car.vz, car.vx);
      }
      car.group.rotation.y = car.heading;
      if (i === this.playerIndex) {
        for (const w of car.steerWheels) w.rotation.y = this.steer * 0.5;
      }
    }
  }

  /** Index of the nearest enterable car within range, or -1. */
  nearest(x: number, z: number, maxDist: number): number {
    const points = this.cars.map((c, i) =>
      i === this.playerIndex ? { x: Infinity, z: Infinity } : { x: c.x, z: c.z },
    );
    return nearestIndex(x, z, points, maxDist);
  }

  /** Take control of car `i`; it becomes the player's (and stays parked when left). */
  enter(i: number): void {
    this.playerIndex = i;
    this.cars[i].role = 'parked';
    this.cars[i].lane = null;
  }

  exit(): void {
    this.playerIndex = null;
  }

  resetPlayer(city: City): void {
    if (this.playerIndex === null) return;
    const c = this.cars[this.playerIndex];
    c.x = city.center.x;
    c.z = city.center.z;
    c.heading = 0;
    c.vx = 0;
    c.vz = 0;
  }

  playerPose(): { x: number; z: number; heading: number; speed: number } | null {
    if (this.playerIndex === null) return null;
    const c = this.cars[this.playerIndex];
    return { x: c.x, z: c.z, heading: c.heading, speed: speedOf(c) };
  }

  /** Signed forward speed of the player's car (for the HUD), or 0 on foot. */
  playerForwardSpeed(): number {
    if (this.playerIndex === null) return 0;
    return forwardSpeedOf(this.cars[this.playerIndex]);
  }

  positions(): Array<{ x: number; z: number }> {
    return this.cars.map((c) => ({ x: c.x, z: c.z }));
  }
}
