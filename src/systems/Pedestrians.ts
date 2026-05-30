import * as THREE from 'three';
import type { City } from '../world/City';
import { createRng } from '../core/rng';
import { lerp, angleLerp } from '../core/math';
import { resolveCircle } from './Collision';
import { makePed } from '../render/Assets';

interface Ped {
  x: number;
  z: number;
  heading: number;
  speed: number;
  turnTimer: number;
  px: number; // previous-step pose for render interpolation
  pz: number;
  ph: number;
  group: THREE.Group;
}

const SHIRTS = [0xcf5b5b, 0x5b8acf, 0x6ccf8a, 0xcfc05b, 0xa05bcf, 0xdddddd, 0x444444];
const RADIUS = 0.35;

/**
 * Wandering pedestrians. Each walks a heading until a timer fires (random
 * turn) or it bumps a building (collision push-out + reverse), bounded to the
 * city. Pure ambience, but they share the same collision routine the player
 * uses, so they never clip into walls.
 */
export class Pedestrians {
  private readonly peds: Ped[] = [];

  constructor(scene: THREE.Scene, city: City, count = 60, seed = 333) {
    const rng = createRng(seed);
    for (let i = 0; i < count; i++) {
      const group = makePed(rng.pick(SHIRTS));
      scene.add(group);
      const x = rng.range(-city.half, city.half);
      const z = rng.range(-city.half, city.half);
      const heading = rng.range(0, Math.PI * 2);
      this.peds.push({
        x,
        z,
        heading,
        speed: rng.range(1, 2.2),
        turnTimer: rng.range(1, 5),
        px: x,
        pz: z,
        ph: heading,
        group,
      });
    }
  }

  update(city: City, dt: number): void {
    for (const ped of this.peds) {
      ped.px = ped.x;
      ped.pz = ped.z;
      ped.ph = ped.heading;

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
    }
  }

  /** Position meshes, interpolating between the previous and current step. */
  render(alpha: number): void {
    for (const ped of this.peds) {
      ped.group.position.set(lerp(ped.px, ped.x, alpha), 0, lerp(ped.pz, ped.z, alpha));
      ped.group.rotation.y = angleLerp(ped.ph, ped.heading, alpha);
    }
  }
}
