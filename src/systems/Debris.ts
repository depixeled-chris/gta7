import * as THREE from 'three';
import { lerp } from '../core/math';
import { World, defineComponent } from '../ecs/World';

/**
 * Pooled "block part" gibs/wreck chunks: a batch of cubes flung from an impact,
 * falling under gravity, bouncing once, fading back into the pool.
 *
 * This is the first system migrated onto the ECS (see
 * docs/research/ecs-architecture.md) — behind the same public API
 * (burst/explode/update/render) so its callers are untouched. Internally each
 * live cube is an entity with a `DebrisPiece` data component and a `DebrisMesh`
 * render component; `update`/`render` are ECS systems. The THREE meshes are
 * pooled (a free-list) and only their state lives in the ECS — proving the
 * data-vs-render-mesh split and the update/interpolated-render stages in-engine.
 * Purely visual, so it uses Math.random.
 */
interface PieceData {
  size: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  // Previous-step position for render interpolation.
  px: number;
  py: number;
  pz: number;
  spinX: number;
  spinZ: number;
}
interface MeshRef {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

const DebrisPiece = defineComponent<PieceData>('DebrisPiece');
const DebrisMesh = defineComponent<MeshRef>('DebrisMesh');

const POOL = 120;
const PER_BURST = 12;
const LIFE = 2.6;
const GRAVITY = 20;
// Voxel-ish gib palette: a bit of skin tone, a bit of dark, rest the shirt colour.
const SKIN = 0xd8b48a;
const DARK = 0x2a2a2a;

export class Debris {
  private readonly free: MeshRef[] = []; // pooled meshes not currently in use

  // Shares the one game World (entities co-exist with cars/peds); runs its
  // passes directly rather than via the World scheduler, since the game's
  // per-frame order is orchestrated explicitly in main.
  constructor(scene: THREE.Scene, private readonly world: World) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.free.push({ mesh, mat });
    }
  }

  /** Spew a batch of cubes from (x,z), carrying some of the car's momentum. */
  burst(x: number, z: number, shirt: number, carVx: number, carVz: number): void {
    for (let n = 0; n < PER_BURST; n++) {
      const ref = this.free.pop();
      if (!ref) break;
      const size = 0.14 + Math.random() * 0.16;
      ref.mat.color.setHex(Math.random() < 0.25 ? SKIN : Math.random() < 0.3 ? DARK : shirt);
      ref.mesh.scale.setScalar(size);
      ref.mesh.visible = true;
      const px = x + (Math.random() - 0.5) * 0.6;
      const py = 0.4 + Math.random() * 0.9;
      const pz = z + (Math.random() - 0.5) * 0.6;
      const e = this.world.create();
      this.world.add(e, DebrisMesh, ref);
      this.world.add(e, DebrisPiece, {
        size, life: LIFE, x: px, y: py, z: pz, px, py, pz,
        vx: carVx * 0.35 + (Math.random() - 0.5) * 7,
        vz: carVz * 0.35 + (Math.random() - 0.5) * 7,
        vy: 3 + Math.random() * 5,
        spinX: (Math.random() - 0.5) * 16,
        spinZ: (Math.random() - 0.5) * 16,
      });
    }
  }

  /**
   * A car wreck: a bigger, hotter burst than a pedestrian gib — larger chunks
   * in the body colour mixed with ember orange, flung up and out from (x,z).
   */
  explode(x: number, z: number, body: number, carVx: number, carVz: number): void {
    const EMBER = 0xff6a1a;
    for (let n = 0; n < PER_BURST * 2; n++) {
      const ref = this.free.pop();
      if (!ref) break;
      const size = 0.3 + Math.random() * 0.5;
      ref.mat.color.setHex(Math.random() < 0.4 ? EMBER : Math.random() < 0.3 ? DARK : body);
      ref.mesh.scale.setScalar(size);
      ref.mesh.visible = true;
      const px = x + (Math.random() - 0.5) * 1.4;
      const py = 0.6 + Math.random() * 1.4;
      const pz = z + (Math.random() - 0.5) * 1.4;
      const e = this.world.create();
      this.world.add(e, DebrisMesh, ref);
      this.world.add(e, DebrisPiece, {
        size, life: LIFE, x: px, y: py, z: pz, px, py, pz,
        vx: carVx * 0.4 + (Math.random() - 0.5) * 12,
        vz: carVz * 0.4 + (Math.random() - 0.5) * 12,
        vy: 6 + Math.random() * 8,
        spinX: (Math.random() - 0.5) * 20,
        spinZ: (Math.random() - 0.5) * 20,
      });
    }
  }

  update(dt: number): void {
    this.step(this.world, dt);
  }

  render(alpha: number): void {
    this.draw(this.world, alpha);
  }

  /** Update system: integrate motion, bounce, spin, and recycle dead pieces. */
  private step(w: World, dt: number): void {
    for (const e of w.query(DebrisPiece)) {
      const p = w.get(e, DebrisPiece)!;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;

      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const rest = p.size / 2;
      if (p.y < rest) {
        p.y = rest;
        p.vy *= -0.35; // bounce
        p.vx *= 0.6;
        p.vz *= 0.6;
        if (Math.abs(p.vy) < 0.6) p.vy = 0;
      }

      const ref = w.get(e, DebrisMesh)!;
      ref.mesh.rotation.x += p.spinX * dt;
      ref.mesh.rotation.z += p.spinZ * dt;

      p.life -= dt;
      if (p.life <= 0) {
        ref.mesh.visible = false;
        this.free.push(ref); // return the mesh to the pool
        w.destroy(e);
      }
    }
  }

  /** Render system: position each cube, interpolated between physics steps. */
  private draw(w: World, alpha: number): void {
    for (const e of w.query(DebrisPiece, DebrisMesh)) {
      const p = w.get(e, DebrisPiece)!;
      const ref = w.get(e, DebrisMesh)!;
      ref.mesh.position.set(lerp(p.px, p.x, alpha), lerp(p.py, p.y, alpha), lerp(p.pz, p.z, alpha));
    }
  }

  /** Live piece count (debug/telemetry). */
  count(): number {
    return this.world.query(DebrisPiece).length;
  }
}
