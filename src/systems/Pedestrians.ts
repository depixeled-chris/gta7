import * as THREE from 'three';
import type { City } from '../world/City';
import { createRng, type Rng } from '../core/rng';
import { lerp, angleLerp } from '../core/math';
import { makePed } from '../render/Assets';
import { Debris } from './Debris';
import { World, defineComponent } from '../ecs/World';

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

type Threat = { x: number; z: number; vx: number; vz: number } | null | undefined;

/** Each pedestrian is an entity carrying its `Ped` data as one component. */
const Pedestrian = defineComponent<Ped>('Pedestrian');

const SHIRTS = [0xcf5b5b, 0x5b8acf, 0x6ccf8a, 0xcfc05b, 0xa05bcf, 0xdddddd, 0x444444];
const RADIUS = 0.35;
const SHOVE_SPEED = 2; // m/s: below this a car is too slow to do anything
const GIB_SPEED = 9; // m/s (~32 km/h): at/above this they explode; between, just shoved
const SHOVE_TIME = 1.6; // seconds knocked over before getting back up
const GIB_TIME = 3.5; // seconds gibbed before respawning elsewhere
const GRAVITY = 18;
const FLEE_SPEED = 5; // scared pedestrians scurry faster than they stroll
const PUNCH_RANGE = 2.6; // reach of an on-foot punch
// Fear triggers off the active player (on foot OR in a car):
const NEAR_RADIUS = 5.5; // proximity: anything this close scares them (walk-up or slow creep)
const PATH_LOOK = 18; // vector: a fast threat bearing down from up to this far
const PATH_WIDTH = 3.6; // ...within this lateral corridor of its heading (its sweep)
const VECTOR_SPEED = 8; // ...and moving at least this fast (a car, not a stroll)

/**
 * Wandering pedestrians with a three-state life: walking, shoved (clipped at
 * low speed — flung, tumbles, gets back up, survives), or gibbed (hit fast
 * enough to explode into cubes, then respawn elsewhere). Only the player's
 * gib kills score on the HUD.
 *
 * Migrated onto the ECS (see docs/research/ecs-architecture.md): each ped is an
 * entity with a `Pedestrian` component, and the walk/fear/impact loop and the
 * interpolated render are ECS systems. `peds` still exposes the same `Ped`
 * objects (the component values), so the debug handle and e2e are unchanged.
 */
export class Pedestrians {
  private readonly world = new World();
  private readonly peds: Ped[] = [];
  private readonly rng: Rng;
  private readonly debris: Debris;
  private tick = 0; // render-frame counter for the fear tremble
  runOverCount = 0;

  // Per-tick inputs the update system reads (set in `update` before stepping).
  private curCity?: City;
  private curImpact?: ImpactQuery;
  private curThreat: Threat;

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
      const ped: Ped = {
        state: 'walk', x, z, y: 0, heading, tumble: 0, color, scared: false,
        speed: this.rng.range(1, 2.2),
        turnTimer: this.rng.range(1, 5),
        vx: 0, vz: 0, vy: 0, timer: 0,
        px: x, pz: z, py: 0, ph: heading, ptumble: 0,
        group,
      };
      this.peds.push(ped);
      this.world.add(this.world.create(), Pedestrian, ped);
    }
    this.world.addSystem('update', (w, dt) => this.stepPeds(w, dt));
    this.world.addSystem('render', (w, alpha) => this.drawPeds(w, alpha));
  }

  update(city: City, dt: number, impactAt?: ImpactQuery, threat?: Threat): void {
    this.curCity = city;
    this.curImpact = impactAt;
    this.curThreat = threat;
    this.world.update(dt);
    this.debris.update(dt);
  }

  /** Update system: advance every pedestrian (walk / flee / shoved / gibbed). */
  private stepPeds(w: World, dt: number): void {
    const city = this.curCity!;
    const impactAt = this.curImpact;
    const threat = this.curThreat;
    for (const e of w.query(Pedestrian)) {
      const ped = w.get(e, Pedestrian)!;
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

      // Panic from the active player (on foot OR a car): close proximity, or a
      // fast threat bearing down on a path to hit them. Flee away (proximity) or
      // dodge sideways out of the path (vector). Tremble is in render().
      ped.scared = false;
      if (threat) {
        const dx = ped.x - threat.x;
        const dz = ped.z - threat.z;
        const dist = Math.hypot(dx, dz);
        let fx = 0;
        let fz = 0;
        if (dist < NEAR_RADIUS) {
          ped.scared = true; // proximity: bolt straight away
          fx = dist > 1e-3 ? dx / dist : 1;
          fz = dist > 1e-3 ? dz / dist : 0;
        } else {
          const ts = Math.hypot(threat.vx, threat.vz);
          if (ts > VECTOR_SPEED && dist < PATH_LOOK) {
            const tnx = threat.vx / ts;
            const tnz = threat.vz / ts;
            const ahead = dx * tnx + dz * tnz; // ped in front of the threat?
            const lateral = dx * tnz - dz * tnx; // signed offset from its path
            if (ahead > 0 && Math.abs(lateral) < PATH_WIDTH) {
              ped.scared = true; // vector: dodge to the side it's already on
              const side = lateral >= 0 ? 1 : -1;
              fx = tnz * side;
              fz = -tnx * side;
            }
          }
        }
        if (ped.scared) {
          ped.heading = Math.atan2(-fz, fx);
          ped.x += fx * FLEE_SPEED * dt;
          ped.z += fz * FLEE_SPEED * dt;
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

      const fixed = city.grid.resolve(ped.x, ped.z, RADIUS);
      if (!ped.scared && (fixed.x !== ped.x || fixed.z !== ped.z)) ped.heading += Math.PI; // bounced off a wall
      ped.x = Math.max(-city.half, Math.min(city.half, fixed.x));
      ped.z = Math.max(-city.half, Math.min(city.half, fixed.z));

      const imp = impactAt?.(ped.x, ped.z);
      if (imp && imp.speed >= GIB_SPEED) this.gib(ped, imp);
      else if (imp && imp.speed >= SHOVE_SPEED) this.shove(ped, imp);
    }
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
    const fixed = city.grid.resolve(ped.x + ped.vx * dt, ped.z + ped.vz * dt, RADIUS);
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

  /**
   * On-foot melee: gib the nearest walking pedestrian within reach and roughly
   * in front (along dirX,dirZ) — the same pixel burst as a car hit — and score
   * it (which raises heat, like any kill). Returns whether it connected.
   */
  punch(x: number, z: number, dirX: number, dirZ: number): boolean {
    let best = -1;
    let bestD2 = PUNCH_RANGE * PUNCH_RANGE;
    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      if (ped.state !== 'walk') continue;
      const dx = ped.x - x;
      const dz = ped.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD2) continue;
      const d = Math.sqrt(d2) || 1e-3;
      if ((dx / d) * dirX + (dz / d) * dirZ < 0) continue; // must be in front of the punch
      bestD2 = d2;
      best = i;
    }
    if (best < 0) return false;
    this.gib(this.peds[best], { vx: dirX * GIB_SPEED, vz: dirZ * GIB_SPEED, isPlayer: true });
    return true;
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

  render(alpha: number): void {
    this.world.render(alpha);
    this.debris.render(alpha);
  }

  /** Render system: position meshes, interpolating between physics steps. */
  private drawPeds(w: World, alpha: number): void {
    this.tick++;
    for (const e of w.query(Pedestrian)) {
      const ped = w.get(e, Pedestrian)!;
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
  }
}
