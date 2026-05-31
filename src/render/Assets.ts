import * as THREE from 'three';
import type { Building, Streetlight, Prop } from '../world/City';
import type { FacadeStyle, PropType } from '../world/biome';
import { makeFacadeTexture, makeGlowTexture } from './textures';

const LAMP_HEIGHT = 5.2;

const UV_TILE = 24; // world units per full facade-texture tile (~3 units/window)

/**
 * Mesh factories. Buildings share a small pool of facade textures and a cached
 * material-per-(texture x tint) set, so hundreds of towers cost only a handful
 * of materials. Per-building geometry carries custom UV scaling so window rows
 * track each tower's real height.
 */
const FACADE_STYLES: FacadeStyle[] = ['glass', 'brick', 'concrete'];

export class CityAssets {
  private readonly facadesByStyle: Record<FacadeStyle, THREE.CanvasTexture[]>;
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

  // Shared prototype geometry+material per prop type; each geometry is shifted so
  // its base sits at y=0, so an instance matrix only needs world x/z + rotation.
  private readonly propProto: Record<PropType, { geo: THREE.BufferGeometry; mat: THREE.Material }>;

  constructor(seed: number, variants = 3) {
    // A small pool of texture variants per facade style; buildings draw from the
    // pool matching their biome-assigned style, so the skyline isn't all glass.
    this.facadesByStyle = { glass: [], brick: [], concrete: [] };
    FACADE_STYLES.forEach((style, s) => {
      for (let i = 0; i < variants; i++) {
        this.facadesByStyle[style].push(makeFacadeTexture(seed + s * 1000 + i * 101, style));
      }
    });
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.95 });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });

    const treeGeo = new THREE.ConeGeometry(1.15, 3.4, 8);
    treeGeo.translate(0, 1.7, 0);
    const hydrantGeo = new THREE.BoxGeometry(0.45, 0.9, 0.45);
    hydrantGeo.translate(0, 0.45, 0);
    const benchGeo = new THREE.BoxGeometry(1.6, 0.5, 0.5);
    benchGeo.translate(0, 0.25, 0);
    this.propProto = {
      tree: { geo: treeGeo, mat: new THREE.MeshStandardMaterial({ color: 0x2f5d3a, roughness: 0.9 }) },
      hydrant: { geo: hydrantGeo, mat: new THREE.MeshStandardMaterial({ color: 0xb5402f, roughness: 0.6 }) },
      bench: { geo: benchGeo, mat: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8, metalness: 0.3 }) },
    };
  }

  /** One InstancedMesh per prop type (a few draw calls for the whole map). */
  makeProps(props: Prop[]): THREE.Group {
    const group = new THREE.Group();
    const byType: Record<PropType, Prop[]> = { tree: [], hydrant: [], bench: [] };
    for (const p of props) byType[p.type].push(p);

    const dummy = new THREE.Object3D();
    for (const type of Object.keys(byType) as PropType[]) {
      const list = byType[type];
      if (list.length === 0) continue;
      const { geo, mat } = this.propProto[type];
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    return group;
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

    const pool = this.facadesByStyle[b.style];
    const facade = pool[index % pool.length];
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
  // Repeat a WHOLE number of tiles per face: a fractional repeat leaves a
  // partial tile at the seam that slices windows in half (worst on the big,
  // sparse brick facades). Rounding to integer tiles keeps every window intact;
  // window size then varies slightly per building, which reads fine.
  const ru = (n: number) => Math.max(1, Math.round(n / UV_TILE));
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

/**
 * A car body silhouette. Dimensions stay close to the shared collision circle
 * (CAR_RADIUS), so variety is visual — proportions, ride height, cabin shape —
 * not a physics change (per-car mass/radius is R003). `cabinX` shifts the cabin
 * fore/aft (a pickup's cab sits forward; a van's is long and tall).
 */
export interface CarShape {
  id: string;
  length: number;
  width: number;
  bodyH: number; // body box height
  bodyY: number; // body centre height (ride)
  cabinLen: number;
  cabinH: number;
  cabinX: number; // cabin offset along length (+front)
  wheelR: number;
}

export const CAR_SHAPES: CarShape[] = [
  { id: 'sedan', length: 4.0, width: 1.9, bodyH: 0.7, bodyY: 0.65, cabinLen: 2.1, cabinH: 0.7, cabinX: -0.2, wheelR: 0.45 },
  { id: 'compact', length: 3.5, width: 1.8, bodyH: 0.72, bodyY: 0.62, cabinLen: 1.6, cabinH: 0.74, cabinX: -0.1, wheelR: 0.42 },
  { id: 'sports', length: 4.3, width: 1.86, bodyH: 0.55, bodyY: 0.5, cabinLen: 1.8, cabinH: 0.5, cabinX: -0.35, wheelR: 0.44 },
  { id: 'van', length: 4.4, width: 2.0, bodyH: 1.0, bodyY: 0.8, cabinLen: 2.7, cabinH: 1.0, cabinX: 0.1, wheelR: 0.46 },
  { id: 'pickup', length: 4.4, width: 1.96, bodyH: 0.8, bodyY: 0.72, cabinLen: 1.5, cabinH: 0.95, cabinX: 0.55, wheelR: 0.48 },
];

export function makeCar(color: number, shape: CarShape = CAR_SHAPES[0]): CarMesh {
  const group = new THREE.Group();
  const hl = shape.length / 2;

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(shape.length, shape.bodyH, shape.width), bodyMat);
  body.position.y = shape.bodyY;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(shape.cabinLen, shape.cabinH, shape.width - 0.3),
    new THREE.MeshStandardMaterial({ color: 0x10131a, metalness: 0.2, roughness: 0.3 }),
  );
  cabin.position.set(shape.cabinX, shape.bodyY + shape.bodyH / 2 + shape.cabinH / 2, 0);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(shape.wheelR, shape.wheelR, 0.35, 14);
  wheelGeo.rotateX(Math.PI / 2); // roll axis -> Z (the car's lateral axis)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
  const axle = shape.length * 0.32;
  const track = shape.width / 2;
  const steerWheels: THREE.Object3D[] = [];
  for (const wx of [axle, -axle]) {
    for (const wz of [track, -track]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, shape.wheelR, wz);
      wheel.castShadow = true;
      group.add(wheel);
      if (wx > 0) steerWheels.push(wheel);
    }
  }

  const head = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xfff0c0, emissiveIntensity: 2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x551015, emissive: 0xff2030, emissiveIntensity: 1.4 });
  for (const lz of [0.6, -0.6]) {
    const hlMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.35), head);
    hlMesh.position.set(hl, shape.bodyY - 0.05, lz);
    group.add(hlMesh);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.35), tail);
    tl.position.set(-hl, shape.bodyY - 0.05, lz);
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
