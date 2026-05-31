import * as THREE from 'three';
import { damp } from '../core/math';

export interface FollowParams {
  distance: number;
  height: number;
  lookHeight: number;
  stiffness: number; // higher = snappier
  speedPull?: number; // metres of distance pulled IN per m/s of speed (lag comp)
}

// A damped chase cam trailing a fast target settles at extra distance ≈ speed/
// stiffness, which reads as "zooming out" at speed. `speedPull` leads the target
// to cancel most of that lag so the framing stays roughly constant.
export const CAR_CAM: FollowParams = { distance: 9, height: 4.2, lookHeight: 1.4, stiffness: 4, speedPull: 0.16 };
export const FOOT_CAM: FollowParams = { distance: 5, height: 3, lookHeight: 1.4, stiffness: 7 };

/**
 * Smoothed chase camera. The desired pose sits behind the target along its
 * heading; both the eye and the look-at point are exponentially damped so the
 * camera glides instead of snapping. Damping is frame-rate independent.
 */
export class FollowCamera {
  private readonly look = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Heading convention matches the sim: forward = (cos h, 0, -sin h). */
  update(x: number, z: number, heading: number, p: FollowParams, dt: number, speed = 0): void {
    const fx = Math.cos(heading);
    const fz = -Math.sin(heading);

    // Pull the camera in as speed rises so damping lag doesn't widen the framing.
    const dist = Math.max(p.distance * 0.5, p.distance - speed * (p.speedPull ?? 0));
    const desiredX = x - fx * dist;
    const desiredZ = z - fz * dist;

    this.camera.position.x = damp(this.camera.position.x, desiredX, p.stiffness, dt);
    this.camera.position.y = damp(this.camera.position.y, p.height, p.stiffness, dt);
    this.camera.position.z = damp(this.camera.position.z, desiredZ, p.stiffness, dt);

    this.look.x = damp(this.look.x, x, p.stiffness, dt);
    this.look.y = damp(this.look.y, p.lookHeight, p.stiffness, dt);
    this.look.z = damp(this.look.z, z, p.stiffness, dt);
    this.camera.lookAt(this.look);
  }

  /** Yaw the camera is currently looking along — used for camera-relative walking. */
  get yaw(): number {
    const dx = this.look.x - this.camera.position.x;
    const dz = this.look.z - this.camera.position.z;
    return Math.atan2(-dz, dx);
  }
}
