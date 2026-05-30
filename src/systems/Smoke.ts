import * as THREE from 'three';
import { makeSmokeTexture } from '../render/textures';

/**
 * Smoke particles for damaged cars — a pool of camera-facing billboard sprites
 * (NOT 3D geometry), so a battered car trails greasy smoke that grows, drifts
 * up, and fades. Emission rate scales with how wrecked the car is. Purely
 * visual: it uses Math.random and is advanced in `update`, with the sprites'
 * own billboarding handling orientation, so no per-frame interpolation needed.
 */
interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  life: number;
  ttl: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

const POOL = 96;
const LIFE = 1.5;
const RATE = 26; // puffs/second at full intensity

export class Smoke {
  private readonly puffs: Puff[] = [];
  private accum = 0;

  constructor(scene: THREE.Scene) {
    const map = makeSmokeTexture();
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map,
        color: 0x2b2d33,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({
        sprite, mat, active: false, life: 0, ttl: LIFE,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1,
      });
    }
  }

  /** Emit smoke at (x,z) this step; `intensity` (0–1) scales the rate. */
  emit(x: number, z: number, intensity: number, dt: number): void {
    if (intensity <= 0) return;
    this.accum += RATE * intensity * dt;
    while (this.accum >= 1) {
      this.accum -= 1;
      this.spawn(x, z, intensity);
    }
  }

  private spawn(x: number, z: number, intensity: number): void {
    const p = this.puffs.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.sprite.visible = true;
    p.life = 0;
    p.ttl = LIFE * (0.7 + Math.random() * 0.6);
    p.x = x + (Math.random() - 0.5) * 0.6;
    p.y = 0.9 + Math.random() * 0.4;
    p.z = z + (Math.random() - 0.5) * 0.6;
    p.vx = (Math.random() - 0.5) * 1.2;
    p.vy = 1.4 + Math.random() * 1.2;
    p.vz = (Math.random() - 0.5) * 1.2;
    p.size = 0.8 + Math.random() * 0.8;
    // Hotter damage smokes darker.
    p.mat.color.setHex(intensity > 0.7 ? 0x17181c : 0x2b2d33);
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.life += dt;
      const t = p.life / p.ttl;
      if (t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        p.mat.opacity = 0;
        continue;
      }
      p.vy += 0.6 * dt; // buoyant rise accelerates a touch
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const scale = p.size * (1 + t * 2.2); // billows outward as it rises
      p.sprite.position.set(p.x, p.y, p.z);
      p.sprite.scale.setScalar(scale);
      // Fade in fast, out slow.
      p.mat.opacity = Math.min(1, t * 6) * (1 - t) * 0.7;
    }
  }

  /** Number of live particles (debug/telemetry). */
  activeCount(): number {
    let n = 0;
    for (const p of this.puffs) if (p.active) n++;
    return n;
  }
}
