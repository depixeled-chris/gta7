import * as THREE from 'three';
import type { City, Lane } from '../world/City';
import { createRng } from '../core/rng';
import { damp, lerp, angleLerp, safeApproachSpeed, leadTime, pursuitSpeed } from '../core/math';
import { makeCar } from '../render/Assets';
import { circleOverlap, nearestIndex } from './Collision';
import { Debris } from './Debris';
import { Smoke } from './Smoke';
import {
  stepVehicle,
  speedOf,
  forwardSpeedOf,
  lateralSpeedOf,
  crashDamage,
  CAR_MAX_HEALTH,
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
  health: number; // body integrity; explodes at 0 (see crashDamage)
  color: number; // body colour, for the explosion debris
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
const SMOKE_HEALTH = 50; // below this a car visibly smokes; worse as it nears 0

const PED_LANE_HALF = 2.6; // how wide a car watches for a pedestrian in its path
const PED_STOP_GAP = 5; // distance ahead of a pedestrian a car aims to stop
const PED_BRAKE_DECEL = 7; // braking authority used to compute a safe speed
const PED_BRAKE_RATE = 5; // how hard the car decelerates toward that safe speed
const PED_REACH = CAR_RADIUS + 0.5; // contact distance for running a pedestrian over

const POLICE_COLOR = 0x12131c;
const POLICE_POOL = 5; // one per wanted star
const POLICE_SPEED = 32; // base cruise; rubber-bands up with the gap (pursuitSpeed)
const POLICE_MAX_SPEED = 82; // chase ceiling — under the player's ~90 so escape is possible but hard
const POLICE_RUBBERBAND = 0.6; // extra m/s of chase speed per metre of gap
const POLICE_ACCEL = 5; // how hard cruisers wind up to their chase speed
const POLICE_SPAWN_DIST = 72; // how far from the player a cruiser appears
const POLICE_LEASH = 150; // a cop that falls beyond this is re-summoned near the player
// Steering-behavior weights (Reynolds): blended into a desired direction.
const POLICE_LEAD = 1.2; // s of interception lead, capped
const POLICE_PURSUE_W = 1.0;
const POLICE_SEP_RADIUS = 14; // cruisers repel each other within this range
const POLICE_SEP_W = 1.7; // separation beats pursuit in a scrum, loses in open road
const POLICE_AVOID_W = 3.0; // avoidance overrides everything so they don't grind walls
const POLICE_FEELER = CAR_RADIUS + 7; // look-ahead distance for the avoidance probe

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
  private readonly debris: Debris;
  private readonly smoke: Smoke;
  private explosions = 0; // car wrecks since main last consumed them (for SFX)
  private playerWreckPending = false; // player car blew up → main triggers WASTED
  wreckCount = 0; // monotonic total wrecks (debug/telemetry)

  constructor(scene: THREE.Scene, city: City, trafficCount = 40, seed = 909) {
    this.debris = new Debris(scene);
    this.smoke = new Smoke(scene);
    this.spawn(scene, makeCar(PLAYER_COLOR), PLAYER_COLOR, city.center.x, city.center.z, 0, 'parked', null, 0);

    const rng = createRng(seed);
    for (let i = 0; i < trafficCount && city.lanes.length > 0; i++) {
      const lane = rng.pick(city.lanes);
      const along = rng.range(-city.half, city.half);
      const x = lane.axis === 'x' ? along : lane.fixed;
      const z = lane.axis === 'z' ? along : lane.fixed;
      const color = rng.pick(TRAFFIC_COLORS);
      this.spawn(scene, makeCar(color), color, x, z, 0, 'ai', lane, rng.range(10, 22));
    }

    for (const spot of city.parkingSpots) {
      const color = rng.pick(TRAFFIC_COLORS);
      this.spawn(scene, makeCar(color), color, spot.x, spot.z, spot.heading, 'parked', null, 0);
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
        health: CAR_MAX_HEALTH, color: POLICE_COLOR,
        group: mesh.group, steerWheels: mesh.steerWheels, lightMat,
      });
    }
  }

  private spawn(
    scene: THREE.Scene,
    mesh: { group: THREE.Group; steerWheels: THREE.Object3D[] },
    color: number,
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
      role, active: true, lane, cruise, health: CAR_MAX_HEALTH, color,
      group: mesh.group, steerWheels: mesh.steerWheels,
    });
  }

  update(
    city: City,
    dt: number,
    input: VehicleInput | null,
    pedestrian: { x: number; z: number } | null = null,
    chaseTarget: { x: number; z: number; vx?: number; vz?: number } | null = null,
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
      else if (car.role === 'police') this.drivePolice(car, city, dt, chaseTarget);
      else this.coast(car, dt);
    }

    this.collide(city);

    // A car under half health trails smoke, thicker the closer it is to wrecking.
    for (const car of this.cars) {
      if (!car.active || car.health >= SMOKE_HEALTH) continue;
      this.smoke.emit(car.x, car.z, 1 - car.health / SMOKE_HEALTH, dt);
    }
    this.smoke.update(dt);
    this.debris.update(dt);

    if (this.playerIndex !== null) {
      const c = this.cars[this.playerIndex];
      const b = city.half - 2;
      c.x = Math.max(-b, Math.min(b, c.x));
      c.z = Math.max(-b, Math.min(b, c.z));
    }
  }

  /** Position meshes, interpolating between the previous and current step. */
  render(alpha: number): void {
    this.debris.render(alpha);
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

  /**
   * Police steering: a blend of pursuit (lead the player), separation (fan out
   * instead of stacking), and obstacle avoidance (veer along a wall normal felt
   * ahead, so they don't grind buildings). Reynolds-style weighted accumulate.
   */
  private drivePolice(
    car: Car,
    city: City,
    dt: number,
    target: { x: number; z: number; vx?: number; vz?: number } | null,
  ): void {
    if (!target) {
      this.coast(car, dt);
      return;
    }
    const tvx = target.vx ?? 0;
    const tvz = target.vz ?? 0;
    let dx = target.x - car.x;
    let dz = target.z - car.z;
    let gap = Math.hypot(dx, dz) || 1e-3;

    // A cop that's been left hopelessly far behind (you outran it) is re-summoned
    // near you, so the chase keeps pressure instead of trailing uselessly.
    if (gap > POLICE_LEASH) {
      this.placeNear(car, target, city);
      dx = target.x - car.x;
      dz = target.z - car.z;
      gap = Math.hypot(dx, dz) || 1e-3;
    }

    // Chase speed rubber-bands with the gap so a fast quarry can't just leave
    // them standing; capped under the player's top speed.
    const chaseSpeed = pursuitSpeed(gap, POLICE_SPEED, POLICE_MAX_SPEED, POLICE_RUBBERBAND);

    // Pursuit: aim where the player will be, not where they are.
    const lead = leadTime(gap, chaseSpeed, Math.hypot(tvx, tvz), POLICE_LEAD);
    let dirX = target.x + tvx * lead - car.x;
    let dirZ = target.z + tvz * lead - car.z;
    const pl = Math.hypot(dirX, dirZ) || 1e-3;
    dirX = (dirX / pl) * POLICE_PURSUE_W;
    dirZ = (dirZ / pl) * POLICE_PURSUE_W;

    // Separation: pushed away from nearby cruisers, stronger the closer they are.
    let sx = 0;
    let sz = 0;
    for (const o of this.cars) {
      if (o === car || o.role !== 'police' || !o.active) continue;
      const ax = car.x - o.x;
      const az = car.z - o.z;
      const d = Math.hypot(ax, az);
      if (d > 1e-3 && d < POLICE_SEP_RADIUS) {
        sx += ax / (d * d);
        sz += az / (d * d);
      }
    }
    const sl = Math.hypot(sx, sz);
    if (sl > 1e-3) {
      dirX += (sx / sl) * POLICE_SEP_W;
      dirZ += (sz / sl) * POLICE_SEP_W;
    }

    // Obstacle avoidance: probe ahead; if it would clip a building, steer along
    // the push-out normal (reuses the circle/AABB resolver). The look-ahead
    // grows with speed so fast chases don't grind walls.
    const sp = Math.hypot(car.vx, car.vz);
    const hx = sp > 0.5 ? car.vx / sp : dx / gap;
    const hz = sp > 0.5 ? car.vz / sp : dz / gap;
    const feeler = POLICE_FEELER + sp * 0.25;
    const fx = car.x + hx * feeler;
    const fz = car.z + hz * feeler;
    const probe = city.grid.resolve(fx, fz, CAR_RADIUS);
    const nx = probe.x - fx;
    const nz = probe.z - fz;
    const nl = Math.hypot(nx, nz);
    if (nl > 1e-3) {
      dirX += (nx / nl) * POLICE_AVOID_W;
      dirZ += (nz / nl) * POLICE_AVOID_W;
    }

    const cl = Math.hypot(dirX, dirZ) || 1e-3;
    car.vx = damp(car.vx, (dirX / cl) * chaseSpeed, POLICE_ACCEL, dt);
    car.vz = damp(car.vz, (dirZ / cl) * chaseSpeed, POLICE_ACCEL, dt);
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    if (Math.hypot(car.vx, car.vz) > 0.5) car.heading = Math.atan2(-car.vz, car.vx);
  }

  /** Drop a cruiser at the spawn radius around the target, in a random direction. */
  private placeNear(car: Car, target: { x: number; z: number }, city: City): void {
    const ang = Math.random() * Math.PI * 2;
    const b = city.half - 4;
    car.x = car.px = Math.max(-b, Math.min(b, target.x + Math.cos(ang) * POLICE_SPAWN_DIST));
    car.z = car.pz = Math.max(-b, Math.min(b, target.z + Math.sin(ang) * POLICE_SPAWN_DIST));
    car.vx = car.vz = 0;
    car.heading = car.ph = 0;
  }

  /** Keep exactly `stars` police active, spawning newcomers near the target. */
  setWanted(stars: number, target: { x: number; z: number }, city: City): void {
    let active = 0;
    for (const car of this.cars) {
      if (car.role !== 'police') continue;
      const shouldBeActive = active < stars;
      if (shouldBeActive && !car.active) {
        this.placeNear(car, target, city);
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

  /** Distance to the nearest active police car from (x,z), or Infinity if none. */
  nearestPoliceDistance(x: number, z: number): number {
    let best = Infinity;
    for (const c of this.cars) {
      if (c.role !== 'police' || !c.active) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  private collide(city: City): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!car.active) continue;
      const fixed = city.grid.resolve(car.x, car.z, CAR_RADIUS);
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
          this.damage(car, i, -into, city); // wall impact ~ speed into the wall
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
          this.damage(a, i, -vn, city); // both take the closing speed as impact
          this.damage(b, j, -vn, city);
        }
      }
    }
  }

  /** Apply crash damage to a car; wreck it (explode + recycle) when it hits 0. */
  private damage(car: Car, i: number, impactSpeed: number, city: City): void {
    const d = crashDamage(impactSpeed);
    if (d <= 0 || car.health <= 0) return;
    car.health -= d;
    if (car.health <= 0) this.wreck(car, i, city);
  }

  /**
   * A wrecked car explodes into chunks. The player's car triggers WASTED (flag
   * read by main); any other car is recycled — relocated to a fresh lane/spot
   * with full health, reusing its mesh (same pooling idea as the police).
   */
  private wreck(car: Car, i: number, city: City): void {
    this.debris.explode(car.x, car.z, car.color, car.vx, car.vz);
    this.explosions++;
    this.wreckCount++;
    car.health = 0;
    if (i === this.playerIndex) {
      this.playerWreckPending = true;
      return;
    }
    if (car.role === 'ai' && city.lanes.length > 0) {
      const lane = city.lanes[Math.floor(Math.random() * city.lanes.length)];
      const along = (Math.random() * 2 - 1) * city.half;
      car.x = lane.axis === 'x' ? along : lane.fixed;
      car.z = lane.axis === 'z' ? along : lane.fixed;
      car.lane = lane;
    } else if (city.parkingSpots.length > 0) {
      const spot = city.parkingSpots[Math.floor(Math.random() * city.parkingSpots.length)];
      car.x = spot.x;
      car.z = spot.z;
      car.heading = spot.heading;
    }
    car.px = car.x;
    car.pz = car.z;
    car.vx = 0;
    car.vz = 0;
    car.health = CAR_MAX_HEALTH;
  }

  /** Number of car explosions since the last call (for one-shot SFX). */
  consumeExplosions(): number {
    const n = this.explosions;
    this.explosions = 0;
    return n;
  }

  /** True once if the player's car was wrecked since the last call. */
  consumePlayerWreck(): boolean {
    const w = this.playerWreckPending;
    this.playerWreckPending = false;
    return w;
  }

  /** Live smoke-particle count (debug/telemetry). */
  smokeParticles(): number {
    return this.smoke.activeCount();
  }

  /** Player car body integrity (0–100), or full health on foot. */
  playerCarHealth(): number {
    if (this.playerIndex === null) return CAR_MAX_HEALTH;
    return Math.max(0, this.cars[this.playerIndex].health);
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
    this.cars[i].health = CAR_MAX_HEALTH; // a freshly carjacked car starts intact
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
    c.health = CAR_MAX_HEALTH;
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

  /** Player car's world velocity (for police interception), or zero on foot. */
  playerVelocity(): { vx: number; vz: number } {
    if (this.playerIndex === null) return { vx: 0, vz: 0 };
    const c = this.cars[this.playerIndex];
    return { vx: c.vx, vz: c.vz };
  }

  positions(): Array<{ x: number; z: number }> {
    return this.cars.map((c) => ({ x: c.x, z: c.z }));
  }

  /** World position of car `i` (e.g. to fade its radio as you walk away). */
  carPosition(i: number): { x: number; z: number } {
    const c = this.cars[i];
    return { x: c.x, z: c.z };
  }
}
