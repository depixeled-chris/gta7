import * as THREE from 'three';
import { daylightFactor, sunPosition } from '../core/math';
import { makeGlowTexture } from './textures';
import type { City } from '../world/City';

/**
 * Owns the renderer, scene graph, camera and the static environment (ground +
 * road grid + dusk lighting). A single directional light covers the whole city
 * for shadows; everything else is emissive, which keeps the night look cheap.
 */
export interface SceneQuality {
  maxPixelRatio?: number; // cap device pixel ratio (lower = cheaper)
  shadowMapSize?: number; // directional shadow resolution
}

// Night (t=0, the original look) ↔ day palette, lerped by the daylight factor.
const NIGHT = {
  sky: 0x141a2e,
  ambient: { color: 0x35406a, intensity: 0.6 },
  hemiSky: 0x3a4a7a,
  sun: { color: 0xbcd0ff, intensity: 1.5 },
};
const DAY = {
  sky: 0x9ec3e6,
  ambient: { color: 0x9fb3d0, intensity: 0.95 },
  hemiSky: 0x87b5e0,
  sun: { color: 0xfff4e0, intensity: 2.6 },
};

export class SceneEnv {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private ambient!: THREE.AmbientLight;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private sunDisc!: THREE.Sprite;
  private sunRadius = 0;

  constructor(container: HTMLElement, city: City, quality: SceneQuality = {}) {
    const maxPixelRatio = quality.maxPixelRatio ?? 2;
    const shadowMapSize = quality.shadowMapSize ?? 2048;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141a2e);
    this.scene.fog = new THREE.Fog(0x141a2e, city.extent * 0.18, city.extent * 0.7);

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.5,
      city.extent * 1.5,
    );
    this.camera.position.set(0, 30, 30);

    this.addLights(city, shadowMapSize);
    this.addGround(city);
    this.addRoads(city);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
  }

  private addLights(city: City, shadowMapSize: number): void {
    this.ambient = new THREE.AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(NIGHT.hemiSky, 0x0a0a12, 0.7);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(NIGHT.sun.color, NIGHT.sun.intensity);
    sun.position.set(city.half * 0.6, city.half * 1.2, city.half * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -city.half;
    cam.right = city.half;
    cam.top = city.half;
    cam.bottom = -city.half;
    cam.near = 1;
    cam.far = city.extent * 2.5;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(sun.target); // target stays at origin; moving the light sweeps shadows
    this.sun = sun;

    // A visible sun/moon disc that rides the same arc as the directional light.
    this.sunRadius = city.extent * 1.1; // inside the camera far plane (extent*1.5)
    const disc = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    disc.scale.setScalar(city.extent * 0.22);
    this.scene.add(disc);
    this.sunDisc = disc;
    this.setTimeOfDay(0); // place everything for the initial (midnight) look
  }

  /**
   * Drive the day/night look from a time-of-day in [0,1) (0 = midnight). Lerps
   * sky/fog colour and light colour+intensity between the night and day
   * palettes by a daylight factor (0 at night, 1 at noon), and rides the sun
   * (the shadow-casting directional light + a visible disc) along an east→
   * overhead→west arc so shadows sweep across the city through the day.
   */
  setTimeOfDay(t: number): void {
    const d = daylightFactor(t); // 0 night → 1 noon
    const mix = (a: number, b: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), d);
    const lerpN = (a: number, b: number): number => a + (b - a) * d;

    const sky = mix(NIGHT.sky, DAY.sky);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);

    this.ambient.color.copy(mix(NIGHT.ambient.color, DAY.ambient.color));
    this.ambient.intensity = lerpN(NIGHT.ambient.intensity, DAY.ambient.intensity);
    this.hemi.color.copy(mix(NIGHT.hemiSky, DAY.hemiSky));
    this.sun.color.copy(mix(NIGHT.sun.color, DAY.sun.color));
    this.sun.intensity = lerpN(NIGHT.sun.intensity, DAY.sun.intensity);

    // Sweep the light + disc along the day's arc (target stays at the origin).
    const dir = sunPosition(t);
    this.sun.position.set(dir.x * this.sunRadius, dir.y * this.sunRadius, dir.z * this.sunRadius);
    this.sunDisc.position.copy(this.sun.position);
    // Warm sun by day, pale moon by night; never fully invisible.
    this.sunDisc.material.color.copy(mix(0xaec6ff, 0xfff1c4));
    this.sunDisc.material.opacity = 0.45 + 0.4 * d;
  }

  private addGround(city: City): void {
    const size = city.extent * 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private addRoads(city: City): void {
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x202430, roughness: 0.9 });
    const roadGeoH = new THREE.PlaneGeometry(city.extent, city.config.roadWidth);
    const roadGeoV = new THREE.PlaneGeometry(city.config.roadWidth, city.extent);

    for (const c of city.roadCenters) {
      const h = new THREE.Mesh(roadGeoH, asphalt);
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.02, c);
      h.receiveShadow = true;
      this.scene.add(h);

      const v = new THREE.Mesh(roadGeoV, asphalt);
      v.rotation.x = -Math.PI / 2;
      v.position.set(c, 0.02, 0);
      v.receiveShadow = true;
      this.scene.add(v);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
