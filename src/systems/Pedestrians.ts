import * as THREE from 'three';
import type { City } from '../world/City';
import { createRng, type Rng } from '../core/rng';
import { lerp, angleLerp } from '../core/math';
import { resolveCircle } from './Collision';
import { makePed } from '../render/Assets';
import { Debris } from './Debris';

type State = 'walk' | 'shoved' | 'gibbed';

interface Ped {
  state: State;
  x: number;
  z: number;
  y: number; // height while knocked into the air
  heading: number;
  tumble: number; // faceplant rotation while down (0 = upright)
  speed: number;
  turnTimer: number;
  color: number; // shirt colour, reused for gib cubes
  scared: boolean; // fleeing the on-foot player (trembles + runs away)
  vx: number; // velocity while shoved
  vz: number;
  vy: number;
  timer: number; // shove recovery / gib respawn countdown
  // Previous-step pose for render interpolation.
  px: number;
  pz: number;
  py: number;
  ph: number;
  ptumble: number;
  group: THREE.Group;
}

type ImpactQuery = (
  x: number,
  z: number,
) => { speed: number; vx: number; vz: number; isPlayer: boolean } | null;

const SHIRTS = [0xcf5b5b, 0x5b8acf, 0x6ccf8a, 0xcfc05b, 0xa05bcf, 0xdddddd, 0x444444];
const RADIUS = 0.35;
const SHOVE_SPEED = 2; // m/s: below this a car is too slow to do anything
const GIB_SPEED = 9; // m/s (~32 km/h): at/above this they explode; between, just shoved
const SHOVE_TIME = 1.6; // seconds knocked over before getting back up
const GIB_TIME = 3.5; // seconds gibbed before respawning elsewhere
const GRAVITY = 18;
const FEAR_RADIUS = 9; // how close the on-foot player must be to scare a pedestrian
const FLEE_SPEED = 5; // scared pedestrians scurry faster than they stroll

/**
 * Wandering pedestrians with a three-state life: walking, shoved (clipped at
 * low speed — flung, tumbles, gets back up, survives), or gibbed (hit fast
 * enough to explode into cubes, then respawn elsewhere). Only the player's
 * gib kills score on the HUD.
 */
export class Pedestrians {
  private readonly peds: Ped[] = [];
  private readonly rng: Rng;
  private readonly debris: Debris;
  private tick = 0; // render-frame counter for the fear tremble
  runOverCount = 0;

  constructor(scene: THREE.Scene, private readonly city: City, count = 60, seed = 333) {
    this.rng = createRng(seed);
    this.debris = new Debris(scene);
    for (let i = 0; i < count; i++) {
      const color = this.rng.pick(SHIRTS);
      const group = makePed(color);
      scene.add(group);
      const x = this.rng.range(-city.half, city.half);
      const z = this.rng.range(-city.half, city.half);
      const heading = this.rng.range(0, Math.PI * 2);
      this.peds.push({
        state: 'walk', x, z, y: 0, heading, tumble: 0, color, scared: false,
        speed: this.rng.range(1, 2.2),
        turnTimer: this.rng.range(1, 5),
        vx: 0, vz: 0, vy: 0, timer: 0,
        px: x, pz: z, py: 0, ph: heading, ptumble: 0,
        group,
      });
    }
  }

  update(city: City, dt: number, impactAt?: ImpactQuery, threat?: { x: number; z: number } | null): void {
    for (const ped of this.peds) {
      ped.px = ped.x;
      ped.pz = ped.z;
      ped.py = ped.y;
      ped.ph = ped.heading;
      ped.ptumble = ped.tumble;

      if (ped.state === 'gibbed') {
        ped.timer -= dt;
        if (ped.timer <= 0) this.respawn(ped);
        continue;
      }
      if (ped.state === 'shoved') {
        this.updateShoved(ped, city, dt);
        continue;
      }

      // Panic if the on-foot player gets close: flee directly away (and tremble,
      // in render). Otherwise wander.
      ped.scared = false;
      if (threat) {
        const ax = ped.x - threat.x;
        const az = ped.z - threat.z;
        const fd = Math.hypot(ax, az);
        if (fd < FEAR_RADIUS) {
          ped.scared = true;
          const ux = fd > 1e-3 ? ax / fd : 1;
          const uz = fd > 1e-3 ? az / fd : 0;
          ped.heading = Math.atan2(-uz, ux); // face the way they're bolting
          ped.x += ux * FLEE_SPEED * dt;
          ped.z += uz * FLEE_SPEED * dt;
        }
      }

      if (!ped.scared) {
        ped.turnTimer -= dt;
        if (ped.turnTimer <= 0) {
          ped.heading += (Math.sin(ped.x * 12.9 + ped.z * 78.2) * 0.5 + 0.5) * Math.PI - Math.PI / 2;
          ped.turnTimer = 2 + ((ped.x * 0.37 + ped.z * 0.91) % 3);
        }
        ped.x += Math.cos(ped.heading) * ped.speed * dt;
        ped.z -= Math.sin(ped.heading) * ped.speed * dt;
      }

      const fixed = resolveCircle(ped.x, ped.z, RADIUS, city.colliders);
      if (!ped.scared && (fixed.x !== ped.x || fixed.z !== ped.z)) ped.heading += Math.PI; // bounced off a wall
      ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
      ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

      const imp = impactAt?.(ped.x, ped.z);
      if (imp && imp.speed >= GIB_SPEED) this.gib(ped, imp);
      else if (imp && imp.speed >= SHOVE_SPEED) this.shove(ped, imp);
    }

    this.debris.update(dt);
  }

  private shove(ped: Ped, imp: { vx: number; vz: number }): void {
    ped.state = 'shoved';
    ped.timer = SHOVE_TIME;
    ped.vx = imp.vx * 0.5;
    ped.vz = imp.vz * 0.5;
    ped.vy = 2.5; // small pop
  }

  private updateShoved(ped: Ped, city: City, dt: number): void {
    ped.vy -= GRAVITY * dt;
    ped.y += ped.vy * dt;
    if (ped.y <= 0) {
      ped.y = 0;
      ped.vy = 0;
      ped.vx *= 0.82;
      ped.vz *= 0.82;
    }
    const fixed = resolveCircle(ped.x + ped.vx * dt, ped.z + ped.vz * dt, RADIUS, city.colliders);
    ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
    ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

    // Fall over, then clamber back up during the last stretch of the timer.
    ped.tumble = ped.timer > 0.5 ? Math.min(Math.PI / 2, ped.tumble + dt * 9) : (ped.timer / 0.5) * (Math.PI / 2);

    ped.timer -= dt;
    if (ped.timer <= 0) {
      ped.state = 'walk';
      ped.tumble = 0;
      ped.y = 0;
    }
  }

  private gib(ped: Ped, imp: { vx: number; vz: number; isPlayer: boolean }): void {
    ped.state = 'gibbed';
    ped.timer = GIB_TIME;
    ped.group.visible = false;
    this.debris.burst(ped.x, ped.z, ped.color, imp.vx, imp.vz);
    if (imp.isPlayer) this.runOverCount++;
  }

  private respawn(ped: Ped): void {
    ped.x = ped.px = this.rng.range(-this.city.half, this.city.half);
    ped.z = ped.pz = this.rng.range(-this.city.half, this.city.half);
    ped.y = ped.py = 0;
    ped.heading = ped.ph = this.rng.range(0, Math.PI * 2);
    ped.tumble = ped.ptumble = 0;
    ped.state = 'walk';
    ped.turnTimer = this.rng.range(1, 5);
    ped.group.visible = true;
  }

  /** Position meshes, interpolating between the previous and current step. */
  render(alpha: number): void {
    this.tick++;
    for (const ped of this.peds) {
      if (ped.state === 'gibbed') continue; // hidden while exploded
      // A fast little tremble (visual only) while scared.
      let sx = 0;
      let sz = 0;
      let roll = 0;
      if (ped.scared) {
        sx = Math.sin(this.tick * 1.1 + ped.z) * 0.18;
        sz = Math.cos(this.tick * 1.3 + ped.x) * 0.18;
        roll = Math.sin(this.tick * 1.7 + ped.x) * 0.4; // a real visible shudder
      }
      ped.group.position.set(
        lerp(ped.px, ped.x, alpha) + sx,
        lerp(ped.py, ped.y, alpha),
        lerp(ped.pz, ped.z, alpha) + sz,
      );
      ped.group.rotation.set(lerp(ped.ptumble, ped.tumble, alpha), angleLerp(ped.ph, ped.heading, alpha), roll);
    }
    this.debris.render(alpha);
  }
}
