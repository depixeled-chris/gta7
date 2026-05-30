import * as THREE from 'three';
import type { Building, Streetlight } from '../world/City';
import { makeFacadeTexture, makeGlowTexture } from './textures';

const LAMP_HEIGHT = 5.2;

const UV_TILE = 24; // world units per full facade-texture tile (~3 units/window)

/**
 * Mesh factories. Buildings share a small pool of facade textures and a cached
 * material-per-(texture x tint) set, so hundreds of towers cost only a handful
 * of materials. Per-building geometry carries custom UV scaling so window rows
 * track each tower's real height.
 */
export class CityAssets {
  private readonly facades: THREE.CanvasTexture[];
  private readonly sideCache = new Map<string, THREE.Material>();
  private readonly roofMat: THREE.Material;

  // Shared across every streetlight so the whole grid of lamps costs a handful
  // of GPU resources, not one set per pole.
  private readonly poleGeo = new THREE.CylinderGeometry(0.13, 0.18, LAMP_HEIGHT, 8);
  private readonly headGeo = new THREE.SphereGeometry(0.42, 12, 10);
  private readonly poolGeo = new THREE.PlaneGeometry(11, 11);
  private readonly poleMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7, metalness: 0.4 });
  private readonly headMat = new THREE.MeshStandardMaterial({
    color: 0xffe6bf,
    emissive: 0xffd9a0,
    emissiveIntensity: 3,
  });
  private readonly poolMat: THREE.Material;

  constructor(seed: number, variants = 3) {
    this.facades = Array.from({ length: variants }, (_, i) => makeFacadeTexture(seed + i * 101));
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.95 });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });
  }

  makeStreetlight(s: Streetlight): THREE.Group {
    const g = new THREE.Group();

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = LAMP_HEIGHT / 2;
    pole.castShadow = true;
    g.add(pole);

    const head = new THREE.Mesh(this.headGeo, this.headMat);
    head.position.y = LAMP_HEIGHT;
    g.add(head);

    const pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.05; // hover just above the road to avoid z-fighting
    g.add(pool);

    g.position.set(s.x, 0, s.z);
    return g;
  }

  makeBuilding(b: Building, index: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(b.width, b.height, b.depth);
    scaleFacadeUvs(geo, b.width, b.height, b.depth);

    const facade = this.facades[index % this.facades.length];
    const side = this.sideMaterial(facade, b.color);
    // Face order: +X, -X, +Y(roof), -Y(floor), +Z, -Z.
    const mesh = new THREE.Mesh(geo, [side, side, this.roofMat, this.roofMat, side, side]);
    mesh.position.set(b.cx, b.height / 2, b.cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private sideMaterial(facade: THREE.CanvasTexture, tint: number): THREE.Material {
    const key = `${facade.uuid}:${tint}`;
    let mat = this.sideCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: tint,
        map: facade,
        emissive: 0xffffff,
        emissiveMap: facade,
        emissiveIntensity: 1.1,
        roughness: 0.75,
        metalness: 0.05,
      });
      this.sideCache.set(key, mat);
    }
    return mat;
  }
}

/** Scale per-face UVs so windows tile by real dimensions; roof/floor collapse to the dark texel. */
function scaleFacadeUvs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const set = (face: number, su: number, sv: number): void => {
    const base = face * 8;
    for (let i = 0; i < 4; i++) {
      uv.array[base + i * 2] *= su;
      uv.array[base + i * 2 + 1] *= sv;
    }
  };
  const ru = (n: number) => n / UV_TILE;
  set(0, ru(d), ru(h)); // +X
  set(1, ru(d), ru(h)); // -X
  set(2, 0, 0); // +Y roof
  set(3, 0, 0); // -Y floor
  set(4, ru(w), ru(h)); // +Z
  set(5, ru(w), ru(h)); // -Z
  uv.needsUpdate = true;
}

export interface CarMesh {
  group: THREE.Group;
  /** Front wheels, rotated for a visual steering cue. */
  steerWheels: THREE.Object3D[];
}

export function makeCar(color: number): CarMesh {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 1.9), bodyMat);
  body.position.y = 0.65;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.7, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x10131a, metalness: 0.2, roughness: 0.3 }),
  );
  cabin.position.set(-0.2, 1.2, 0);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14);
  wheelGeo.rotateX(Math.PI / 2); // roll axis -> Z (the car's lateral axis)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
  const steerWheels: THREE.Object3D[] = [];
  for (const wx of [1.3, -1.3]) {
    for (const wz of [0.95, -0.95]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.45, wz);
      wheel.castShadow = true;
      group.add(wheel);
      if (wx > 0) steerWheels.push(wheel);
    }
  }

  const head = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xfff0c0, emissiveIntensity: 2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x551015, emissive: 0xff2030, emissiveIntensity: 1.4 });
  for (const lz of [0.6, -0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.35), head);
    hl.position.set(2.0, 0.6, lz);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.35), tail);
    tl.position.set(-2.0, 0.6, lz);
    group.add(tl);
  }

  return { group, steerWheels };
}

export function makePed(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.7 }),
  );
  head.position.y = 1.45;
  head.castShadow = true;
  group.add(head);
  return group;
}
