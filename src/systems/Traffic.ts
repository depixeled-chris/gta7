import * as THREE from 'three';
import type { City, Lane } from '../world/City';
import { createRng } from '../core/rng';
import { makeCar } from '../render/Assets';

interface TrafficCar {
  lane: Lane;
  t: number; // position along the lane's axis
  speed: number;
  group: THREE.Group;
}

const CAR_COLORS = [0xb23a3a, 0x3a6db2, 0xd9b44a, 0x4ab36a, 0xcccccc, 0x2a2a2a, 0xc06a2a];

/**
 * Ambient traffic. Each car rides one lane and wraps around at the city edge —
 * a deliberately cheap "infinite loop" that reads fine through fog. Cars don't
 * collide with each other or the player; they exist for ambience.
 */
export class Traffic {
  private readonly cars: TrafficCar[] = [];

  constructor(scene: THREE.Scene, city: City, count = 40, seed = 909) {
    const rng = createRng(seed);
    for (let i = 0; i < count && city.lanes.length > 0; i++) {
      const lane = rng.pick(city.lanes);
      const { group } = makeCar(rng.pick(CAR_COLORS));
      scene.add(group);
      this.cars.push({
        lane,
        t: rng.range(-city.half, city.half),
        speed: rng.range(8, 18),
        group,
      });
    }
  }

  update(city: City, dt: number): void {
    const span = city.half;
    for (const car of this.cars) {
      car.t += car.lane.dir * car.speed * dt;
      if (car.t > span) car.t -= span * 2;
      else if (car.t < -span) car.t += span * 2;

      let x: number;
      let z: number;
      if (car.lane.axis === 'x') {
        x = car.t;
        z = car.lane.fixed;
      } else {
        x = car.lane.fixed;
        z = car.t;
      }
      const fx = car.lane.axis === 'x' ? car.lane.dir : 0;
      const fz = car.lane.axis === 'z' ? car.lane.dir : 0;
      car.group.position.set(x, 0, z);
      car.group.rotation.y = Math.atan2(-fz, fx);
    }
  }

  positions(): Array<{ x: number; z: number }> {
    return this.cars.map((c) => ({ x: c.group.position.x, z: c.group.position.z }));
  }
}
