import * as THREE from 'three';
import type { City } from '../world/City';

/**
 * Owns the renderer, scene graph, camera and the static environment (ground +
 * road grid + dusk lighting). A single directional light covers the whole city
 * for shadows; everything else is emissive, which keeps the night look cheap.
 */
export class SceneEnv {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement, city: City) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    this.addLights(city);
    this.addGround(city);
    this.addRoads(city);

    window.addEventListener('resize', this.onResize);
  }

  private addLights(city: City): void {
    this.scene.add(new THREE.AmbientLight(0x35406a, 0.6));

    const hemi = new THREE.HemisphereLight(0x3a4a7a, 0x0a0a12, 0.7);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0xbcd0ff, 1.5);
    moon.position.set(city.half * 0.6, city.half * 1.2, city.half * 0.4);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const cam = moon.shadow.camera;
    cam.left = -city.half;
    cam.right = city.half;
    cam.top = city.half;
    cam.bottom = -city.half;
    cam.near = 1;
    cam.far = city.extent * 2.5;
    moon.shadow.bias = -0.0006;
    this.scene.add(moon);
    this.scene.add(moon.target);
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
