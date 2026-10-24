// Scene setup: sky, fog, lights, clouds, chunk meshes and the first-person hand.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CENTER, CHUNK } from '../config.js';
import { meshChunk } from '../world/mesher.js';
import { getAtlas } from '../world/textures.js';

const SKY_TOP = '#3d9bff';
const SKY_HORIZON = '#bfe7ff';
const SKY_BOTTOM = '#33478f';

export class Renderer {
  constructor(canvas) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 110, 300);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 800);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x9a8a72, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(0.45, 1, 0.3);
    this.scene.add(sun);

    const atlas = getAtlas();
    this.solidMat = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 });
    this.glassMat = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, depthWrite: false });

    this.chunks = new Map();
    this.chunkGroup = new THREE.Group();
    this.scene.add(this.chunkGroup);

    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);

    // The first-person hand gets its own scene so it never clips into walls.
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a72, 2.4));
    const handSun = new THREE.DirectionalLight(0xffffff, 1.6);
    handSun.position.set(0.3, 1, 0.6);
    this.handScene.add(handSun);
    this.showHand = true;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
  }

  makeSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
        bottom: { value: new THREE.Color(SKY_BOTTOM) },
        sunDir: { value: new THREE.Vector3(0.45, 0.62, 0.3).normalize() },
      },
      // Colors are passed straight through so they match the fog exactly.
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.45));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.95, 0.8) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    // Our colors are sRGB hex; skip the linear conversion THREE.Color does.
    for (const k of ['top', 'horizon', 'bottom']) mat.uniforms[k].value.convertLinearToSRGB();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return mesh;
  }

  makeClouds() {
    const parts = [];
    let seed = 4;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const cx = (r() - 0.5) * 700, cz = (r() - 0.5) * 700;
      const n = 2 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const w = 10 + r() * 18, d = 8 + r() * 14;
        const g = new THREE.BoxGeometry(w, 3.5, d);
        g.translate(cx + (r() - 0.5) * 22, 0, cz + (r() - 0.5) * 16);
        parts.push(g);
      }
    }
    const geo = mergeGeometries(parts);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, opacity: 0.88 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(CENTER.x, 128, CENTER.z);
    mesh.userData.drift = 0;
    return mesh;
  }

  // ---------------------------------------------------------- chunks

  setWorld(world) {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.world = world;
    for (let cz = 0; cz < world.ncz; cz++) for (let cy = 0; cy < world.ncy; cy++) for (let cx = 0; cx < world.ncx; cx++) {
      if (!world.chunkIsEmpty(cx, cy, cz)) this.buildChunk(world.chunkKey(cx, cy, cz));
    }
    world.dirty.clear();
  }

  disposeChunk(c) {
    for (const m of [c.solid, c.glass]) {
      if (!m) continue;
      this.chunkGroup.remove(m);
      m.geometry.dispose();
    }
  }

  buildChunk(key) {
    const old = this.chunks.get(key);
    if (old) this.disposeChunk(old);
    const [cx, cy, cz] = this.world.chunkCoords(key);
    const geo = meshChunk(this.world, cx, cy, cz);
    const entry = { solid: null, glass: null };
    if (geo.solid) {
      entry.solid = new THREE.Mesh(geo.solid, this.solidMat);
      this.chunkGroup.add(entry.solid);
    }
    if (geo.glass) {
      entry.glass = new THREE.Mesh(geo.glass, this.glassMat);
      entry.glass.renderOrder = 1;
      this.chunkGroup.add(entry.glass);
    }
    this.chunks.set(key, entry);
  }

  update(dt) {
    if (this.world && this.world.dirty.size) {
      for (const key of this.world.dirty) this.buildChunk(key);
      this.world.dirty.clear();
    }
    this.sky.position.copy(this.camera.position);
    this.clouds.userData.drift = (this.clouds.userData.drift + dt * 1.2) % 700;
    this.clouds.position.x = CENTER.x + this.clouds.userData.drift - 350;
  }

  render() {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (this.showHand) {
      this.gl.clearDepth();
      this.gl.render(this.handScene, this.handCamera);
    }
  }
}

export { CHUNK };
