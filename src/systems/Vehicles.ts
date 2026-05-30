import * as THREE from 'three';
import type { City, Lane } from '../world/City';
import { createRng } from '../core/rng';
import { damp, lerp, angleLerp, safeApproachSpeed } from '../core/math';
import { makeCar } from '../render/Assets';
import { resolveCircle, circleOverlap, nearestIndex } from './Collision';
import {
  stepVehicle,
  speedOf,
  forwardSpeedOf,
  lateralSpeedOf,
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

type Role = 'ai' | 'parked' | 'police';

interface Car {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  // Previous-step pose, for render interpolation between fixed steps.
  px: number;
  pz: number;
  ph: number;
  role: Role;
  active: boolean; // police idle in a pool until a wanted level activates them
  lane: Lane | null;
  cruise: number;
  group: THREE.Group;
  steerWheels: THREE.Object3D[];
  lightMat?: THREE.MeshStandardMaterial; // police roof light (flashed in render)
}

const PLAYER_COLOR = 0x10a0c8;
const TRAFFIC_COLORS = [0xb23a3a, 0x3a6db2, 0xd9b44a, 0x4ab36a, 0xcccccc, 0x2a2a2a, 0xc06a2a];

const CAR_RADIUS = 1.9;
const LANE_CORRECT = 2.2; // how hard AI steers back to lane centerline
const AI_RECOVER = 2.6; // how fast AI velocity returns to cruise after a hit
const PARK_FRICTION = 1.8; // how fast an abandoned/shoved car coasts to rest
const RESTITUTION = 0.4; // bounciness of car-on-car impacts

const PED_LANE_HALF = 2.6; // how wide a car watches for a pedestrian in its path
const PED_STOP_GAP = 5; // distance ahead of a pedestrian a car aims to stop
const PED_BRAKE_DECEL = 7; // braking authority used to compute a safe speed
const PED_BRAKE_RATE = 5; // how hard the car decelerates toward that safe speed
const PED_REACH = CAR_RADIUS + 0.5; // contact distance for running a pedestrian over

const POLICE_COLOR = 0x12131c;
const POLICE_POOL = 5; // one per wanted star
const POLICE_SPEED = 27; // faster than traffic, slower than the player's top speed
const POLICE_ACCEL = 2.4;
const POLICE_SPAWN_DIST = 72; // how far from the player a cruiser appears

export interface PedImpact {
  speed: number; // car speed at the moment of contact (m/s)
  nx: number; // knockback direction (from car toward pedestrian)
  nz: number;
  vx: number; // the car's velocity (for flinging a pedestrian along it)
  vz: number;
  isPlayer: boolean; // was it the player's car (for scoring run-overs)
}

export class Vehicles {
  private readonly cars: Car[] = [];
  playerIndex: number | null = 0;
  private steer = 0;
  private flash = 0; // render-frame counter for the flashing police lights

  constructor(scene: THREE.Scene, city: City, trafficCount = 40, seed = 909) {
    this.spawn(scene, makeCar(PLAYER_COLOR), city.center.x, city.center.z, 0, 'parked', null, 0);

    const rng = createRng(seed);
    for (let i = 0; i < trafficCount && city.lanes.length > 0; i++) {
      const lane = rng.pick(city.lanes);
      const along = rng.range(-city.half, city.half);
      const x = lane.axis === 'x' ? along : lane.fixed;
      const z = lane.axis === 'z' ? along : lane.fixed;
      this.spawn(scene, makeCar(rng.pick(TRAFFIC_COLORS)), x, z, 0, 'ai', lane, rng.range(10, 22));
    }

    for (const spot of city.parkingSpots) {
      this.spawn(scene, makeCar(rng.pick(TRAFFIC_COLORS)), spot.x, spot.z, spot.heading, 'parked', null, 0);
    }

    // A pool of idle police cars (hidden off-map) that a wanted level activates.
    for (let i = 0; i < POLICE_POOL; i++) {
      const mesh = makeCar(POLICE_COLOR);
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0x220008,
        emissive: 0xff2030,
        emissiveIntensity: 2.5,
      });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 1.1), lightMat);
      bar.position.set(-0.2, 1.62, 0);
      mesh.group.add(bar);
      mesh.group.visible = false;
      scene.add(mesh.group);
      this.cars.push({
        x: 1e6, z: 1e6, heading: 0, vx: 0, vz: 0, px: 1e6, pz: 1e6, ph: 0,
        role: 'police', active: false, lane: null, cruise: 0,
        group: mesh.group, steerWheels: mesh.steerWheels, lightMat,
      });
    }
  }

  private spawn(
    scene: THREE.Scene,
    mesh: { group: THREE.Group; steerWheels: THREE.Object3D[] },
    x: number,
    z: number,
    heading: number,
    role: Role,
    lane: Lane | null,
    cruise: number,
  ): void {
    mesh.group.position.set(x, 0, z);
    mesh.group.rotation.y = heading;
    scene.add(mesh.group);
    this.cars.push({
      x, z, heading, vx: 0, vz: 0, px: x, pz: z, ph: heading,
      role, active: true, lane, cruise, group: mesh.group, steerWheels: mesh.steerWheels,
    });
  }

  update(
    city: City,
    dt: number,
    input: VehicleInput | null,
    pedestrian: { x: number; z: number } | null = null,
    chaseTarget: { x: number; z: number } | null = null,
  ): void {
    // Snapshot the pre-step pose so render() can interpolate up to it.
    for (const c of this.cars) {
      c.px = c.x;
      c.pz = c.z;
      c.ph = c.heading;
    }

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
      if (!car.active) continue;
      if (car.role === 'ai') this.driveAi(car, city, dt, pedestrian);
      else if (car.role === 'police') this.drivePolice(car, dt, chaseTarget);
      else this.coast(car, dt);
    }

    this.collide(city);

    if (this.playerIndex !== null) {
      const c = this.cars[this.playerIndex];
      const b = city.half - 2;
      c.x = Math.max(-b, Math.min(b, c.x));
      c.z = Math.max(-b, Math.min(b, c.z));
    }
  }

  /** Position meshes, interpolating between the previous and current step. */
  render(alpha: number): void {
    this.flash++;
    const blue = Math.floor(this.flash / 16) % 2 === 0;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!c.active) continue;
      c.group.position.set(lerp(c.px, c.x, alpha), 0, lerp(c.pz, c.z, alpha));
      c.group.rotation.y = angleLerp(c.ph, c.heading, alpha);
      if (i === this.playerIndex) {
        for (const w of c.steerWheels) w.rotation.y = this.steer * 0.5;
      }
      if (c.lightMat) c.lightMat.emissive.setHex(blue ? 0x2030ff : 0xff2030);
    }
  }

  private driveAi(
    car: Car,
    city: City,
    dt: number,
    pedestrian: { x: number; z: number } | null,
  ): void {
    const lane = car.lane!;
    const half = city.half;

    // Wrap around the city edge so the loop of traffic never runs out.
    if (lane.axis === 'x') {
      if (car.x > half) car.x -= half * 2;
      else if (car.x < -half) car.x += half * 2;
    } else if (car.z > half) car.z -= half * 2;
    else if (car.z < -half) car.z += half * 2;

    // Brake for a pedestrian standing in this car's path. The car only slows
    // as fast as PED_BRAKE_RATE allows, so darting in front from inside the
    // stopping distance gets you hit.
    let cruise = car.cruise;
    let rate = AI_RECOVER;
    if (pedestrian) {
      const ahead =
        lane.axis === 'x'
          ? (pedestrian.x - car.x) * lane.dir
          : (pedestrian.z - car.z) * lane.dir;
      const sideways =
        lane.axis === 'x' ? Math.abs(pedestrian.z - car.z) : Math.abs(pedestrian.x - car.x);
      if (ahead > 0 && sideways < PED_LANE_HALF) {
        const safe = safeApproachSpeed(ahead - PED_STOP_GAP, PED_BRAKE_DECEL);
        if (safe < cruise) {
          cruise = safe;
          rate = PED_BRAKE_RATE;
        }
      }
    }

    const lateral = lane.axis === 'x' ? car.z - lane.fixed : car.x - lane.fixed;
    const alongV = lane.dir * cruise;
    const latV = -lateral * LANE_CORRECT;
    const desX = lane.axis === 'x' ? alongV : latV;
    const desZ = lane.axis === 'z' ? alongV : latV;

    car.vx = damp(car.vx, desX, rate, dt);
    car.vz = damp(car.vz, desZ, rate, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    if (Math.hypot(car.vx, car.vz) > 0.5) car.heading = Math.atan2(-car.vz, car.vx);
  }

  /**
   * The fastest car overlapping a point at (px,pz), or null. When `includePlayer`
   * is false the player's own car is skipped (used for damage to the on-foot
   * player); when true it counts too (used for running pedestrians over).
   */
  pedestrianImpact(px: number, pz: number, includePlayer = false): PedImpact | null {
    let best: PedImpact | null = null;
    for (let i = 0; i < this.cars.length; i++) {
      if (!includePlayer && i === this.playerIndex) continue;
      const c = this.cars[i];
      const dist = Math.hypot(c.x - px, c.z - pz);
      if (dist >= PED_REACH) continue;
      const speed = Math.hypot(c.vx, c.vz);
      if (!best || speed > best.speed) {
        const d = dist || 1e-3;
        best = {
          speed,
          nx: (px - c.x) / d,
          nz: (pz - c.z) / d,
          vx: c.vx,
          vz: c.vz,
          isPlayer: i === this.playerIndex,
        };
      }
    }
    return best;
  }

  private coast(car: Car, dt: number): void {
    car.vx = damp(car.vx, 0, PARK_FRICTION, dt);
    car.vz = damp(car.vz, 0, PARK_FRICTION, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    if (Math.hypot(car.vx, car.vz) > 0.5) car.heading = Math.atan2(-car.vz, car.vx);
  }

  /** Police seek straight toward the player (building collisions slide them around). */
  private drivePolice(car: Car, dt: number, target: { x: number; z: number } | null): void {
    if (!target) {
      this.coast(car, dt);
      return;
    }
    const tx = target.x - car.x;
    const tz = target.z - car.z;
    const d = Math.hypot(tx, tz);
    const desX = d > 1 ? (tx / d) * POLICE_SPEED : 0;
    const desZ = d > 1 ? (tz / d) * POLICE_SPEED : 0;
    car.vx = damp(car.vx, desX, POLICE_ACCEL, dt);
    car.vz = damp(car.vz, desZ, POLICE_ACCEL, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    if (Math.hypot(car.vx, car.vz) > 0.5) car.heading = Math.atan2(-car.vz, car.vx);
  }

  /** Keep exactly `stars` police active, spawning newcomers near the target. */
  setWanted(stars: number, target: { x: number; z: number }, city: City): void {
    let active = 0;
    for (const car of this.cars) {
      if (car.role !== 'police') continue;
      const shouldBeActive = active < stars;
      if (shouldBeActive && !car.active) {
        const ang = Math.random() * Math.PI * 2;
        const b = city.half - 4;
        car.x = car.px = Math.max(-b, Math.min(b, target.x + Math.cos(ang) * POLICE_SPAWN_DIST));
        car.z = car.pz = Math.max(-b, Math.min(b, target.z + Math.sin(ang) * POLICE_SPAWN_DIST));
        car.vx = car.vz = 0;
        car.heading = car.ph = 0;
        car.active = true;
        car.group.visible = true;
      } else if (!shouldBeActive && car.active) {
        car.active = false;
        car.group.visible = false;
      }
      if (car.active) active++;
    }
  }

  activePoliceCount(): number {
    return this.cars.filter((c) => c.role === 'police' && c.active).length;
  }

  private collide(city: City): void {
    for (const car of this.cars) {
      if (!car.active) continue;
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
        if (!a.active || !b.active) continue;
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
    c.x = c.px = city.center.x; // snap prev too, so render doesn't slide across the map
    c.z = c.pz = city.center.z;
    c.heading = c.ph = 0;
    c.vx = 0;
    c.vz = 0;
  }

  playerPose(): { x: number; z: number; heading: number; speed: number } | null {
    if (this.playerIndex === null) return null;
    const c = this.cars[this.playerIndex];
    return { x: c.x, z: c.z, heading: c.heading, speed: speedOf(c) };
  }

  /** Player-car pose interpolated between the last two steps, for the camera. */
  playerPoseInterp(alpha: number): { x: number; z: number; heading: number; speed: number } | null {
    if (this.playerIndex === null) return null;
    const c = this.cars[this.playerIndex];
    return {
      x: lerp(c.px, c.x, alpha),
      z: lerp(c.pz, c.z, alpha),
      heading: angleLerp(c.ph, c.heading, alpha),
      speed: speedOf(c),
    };
  }

  /** Signed forward speed of the player's car (for the HUD), or 0 on foot. */
  playerForwardSpeed(): number {
    if (this.playerIndex === null) return 0;
    return forwardSpeedOf(this.cars[this.playerIndex]);
  }

  /** Sideways slip speed of the player's car (for tyre-screech SFX), or 0 on foot. */
  playerLateralSpeed(): number {
    if (this.playerIndex === null) return 0;
    return Math.abs(lateralSpeedOf(this.cars[this.playerIndex]));
  }

  positions(): Array<{ x: number; z: number }> {
    return this.cars.map((c) => ({ x: c.x, z: c.z }));
  }
}
