import * as THREE from 'three';
import { lerp } from '../core/math';

interface Piece {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  size: number;
  active: boolean;
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

const POOL = 120;
const PER_BURST = 12;
const LIFE = 2.6;
const GRAVITY = 20;
// Voxel-ish gib palette: a bit of skin tone, a bit of dark, rest the shirt colour.
const SKIN = 0xd8b48a;
const DARK = 0x2a2a2a;

/**
 * A shared pool of little cubes. When a pedestrian is run over they "explode
 * into tiny block parts" — a batch of pieces is flung from the impact point,
 * falls under gravity, bounces once, and fades back into the pool. Pure visual
 * flair, so it uses Math.random and is interpolated for smoothness.
 */
export class Debris {
  private readonly pieces: Piece[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.pieces.push({
        mesh, mat, size: 0.2, active: false, life: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, spinX: 0, spinZ: 0,
      });
    }
  }

  /** Spew a batch of cubes from (x,z), carrying some of the car's momentum. */
  burst(x: number, z: number, shirt: number, carVx: number, carVz: number): void {
    let spawned = 0;
    for (const p of this.pieces) {
      if (p.active) continue;
      const size = 0.14 + Math.random() * 0.16;
      p.active = true;
      p.life = LIFE;
      p.size = size;
      p.x = p.px = x + (Math.random() - 0.5) * 0.6;
      p.y = p.py = 0.4 + Math.random() * 0.9;
      p.z = p.pz = z + (Math.random() - 0.5) * 0.6;
      p.vx = carVx * 0.35 + (Math.random() - 0.5) * 7;
      p.vz = carVz * 0.35 + (Math.random() - 0.5) * 7;
      p.vy = 3 + Math.random() * 5;
      p.spinX = (Math.random() - 0.5) * 16;
      p.spinZ = (Math.random() - 0.5) * 16;
      p.mat.color.setHex(Math.random() < 0.25 ? SKIN : Math.random() < 0.3 ? DARK : shirt);
      p.mesh.scale.setScalar(size);
      p.mesh.visible = true;
      if (++spawned >= PER_BURST) break;
    }
  }

  update(dt: number): void {
    for (const p of this.pieces) {
      if (!p.active) continue;
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

      p.mesh.rotation.x += p.spinX * dt;
      p.mesh.rotation.z += p.spinZ * dt;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }

  render(alpha: number): void {
    for (const p of this.pieces) {
      if (!p.active) continue;
      p.mesh.position.set(lerp(p.px, p.x, alpha), lerp(p.py, p.y, alpha), lerp(p.pz, p.z, alpha));
    }
  }
}
