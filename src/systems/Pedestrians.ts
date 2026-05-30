import * as THREE from 'three';
import type { City } from '../world/City';
import { createRng, type Rng } from '../core/rng';
import { lerp, angleLerp } from '../core/math';
import { resolveCircle } from './Collision';
import { makePed } from '../render/Assets';
import { Debris } from './Debris';

interface Ped {
  x: number;
  z: number;
  heading: number;
  speed: number;
  turnTimer: number;
  color: number; // shirt colour, reused for the gib cubes
  hit: boolean; // currently "dead" (exploded), waiting to respawn
  downTimer: number;
  // Previous-step pose for render interpolation.
  px: number;
  pz: number;
  ph: number;
  group: THREE.Group;
}

/** Impact a car deals to a point, as reported by the Vehicles system. */
type ImpactQuery = (
  x: number,
  z: number,
) => { speed: number; vx: number; vz: number; isPlayer: boolean } | null;

const SHIRTS = [0xcf5b5b, 0x5b8acf, 0x6ccf8a, 0xcfc05b, 0xa05bcf, 0xdddddd, 0x444444];
const RADIUS = 0.35;
const RUNOVER_SPEED = 4; // m/s a car must exceed to splatter a pedestrian
const DOWN_TIME = 3.5; // seconds before a flattened pedestrian respawns elsewhere

/**
 * Wandering pedestrians. Each walks until a timer fires or it bumps a building.
 * A car moving faster than RUNOVER_SPEED runs one over: the body vanishes in a
 * burst of little cubes (see Debris) and respawns elsewhere a few seconds
 * later. `runOverCount` counts only the player's kills (ambient traffic is
 * lethal too, but doesn't pad your tally).
 */
export class Pedestrians {
  private readonly peds: Ped[] = [];
  private readonly rng: Rng;
  private readonly debris: Debris;
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
        x, z, heading, color,
        speed: this.rng.range(1, 2.2),
        turnTimer: this.rng.range(1, 5),
        hit: false, downTimer: 0,
        px: x, pz: z, ph: heading,
        group,
      });
    }
  }

  update(city: City, dt: number, impactAt?: ImpactQuery): void {
    for (const ped of this.peds) {
      ped.px = ped.x;
      ped.pz = ped.z;
      ped.ph = ped.heading;

      if (ped.hit) {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) this.respawn(ped);
        continue;
      }

      ped.turnTimer -= dt;
      if (ped.turnTimer <= 0) {
        ped.heading += (Math.sin(ped.x * 12.9 + ped.z * 78.2) * 0.5 + 0.5) * Math.PI - Math.PI / 2;
        ped.turnTimer = 2 + ((ped.x * 0.37 + ped.z * 0.91) % 3);
      }

      const nx = ped.x + Math.cos(ped.heading) * ped.speed * dt;
      const nz = ped.z - Math.sin(ped.heading) * ped.speed * dt;
      const fixed = resolveCircle(nx, nz, RADIUS, city.colliders);
      if (fixed.x !== nx || fixed.z !== nz) ped.heading += Math.PI; // bounced off a wall
      ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
      ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

      const imp = impactAt?.(ped.x, ped.z);
      if (imp && imp.speed > RUNOVER_SPEED) this.splatter(ped, imp);
    }

    this.debris.update(dt);
  }

  private splatter(
    ped: Ped,
    imp: { speed: number; vx: number; vz: number; isPlayer: boolean },
  ): void {
    ped.hit = true;
    ped.downTimer = DOWN_TIME;
    ped.group.visible = false;
    this.debris.burst(ped.x, ped.z, ped.color, imp.vx, imp.vz);
    if (imp.isPlayer) this.runOverCount++;
  }

  private respawn(ped: Ped): void {
    ped.x = ped.px = this.rng.range(-this.city.half, this.city.half);
    ped.z = ped.pz = this.rng.range(-this.city.half, this.city.half);
    ped.heading = ped.ph = this.rng.range(0, Math.PI * 2);
    ped.turnTimer = this.rng.range(1, 5);
    ped.hit = false;
    ped.group.visible = true;
  }

  /** Position meshes, interpolating between the previous and current step. */
  render(alpha: number): void {
    for (const ped of this.peds) {
      if (ped.hit) continue; // hidden while exploded
      ped.group.position.set(lerp(ped.px, ped.x, alpha), 0, lerp(ped.pz, ped.z, alpha));
      ped.group.rotation.y = angleLerp(ped.ph, ped.heading, alpha);
    }
    this.debris.render(alpha);
  }
}
