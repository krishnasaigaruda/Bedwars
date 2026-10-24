// Block-break particles, the target-block outline and the crack overlay.
import * as THREE from 'three';
import { getAtlas } from '../world/textures.js';
import { BLOCKS } from '../world/blocks.js';

const MAX = 800;

export class Particles {
  constructor(scene, world) {
    this.world = world;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
    this.m = new THREE.Matrix4();
    this.c = new THREE.Color();
  }

  burst(x, y, z, rgb, n = 14, opts = {}) {
    const spread = opts.spread ?? 0.4, speed = opts.speed ?? 3, size = opts.size ?? 0.11;
    for (let i = 0; i < n; i++) {
      if (this.p.length >= MAX) this.p.shift();
      const f = 0.8 + Math.random() * 0.35;
      this.p.push({
        x: x + (Math.random() - 0.5) * spread * 2,
        y: y + (Math.random() - 0.5) * spread * 2,
        z: z + (Math.random() - 0.5) * spread * 2,
        vx: (Math.random() - 0.5) * speed,
        vy: Math.random() * speed * 0.9 + 1,
        vz: (Math.random() - 0.5) * speed,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        size: size * (0.7 + Math.random() * 0.6),
        r: (rgb[0] / 255) * f, g: (rgb[1] / 255) * f, b: (rgb[2] / 255) * f,
        gravity: opts.gravity ?? 18,
      });
    }
  }

  blockBurst(x, y, z, id, n = 18) {
    const b = BLOCKS[id];
    if (!b.tiles) return;
    this.burst(x + 0.5, y + 0.5, z + 0.5, getAtlas().avg(b.tiles.side), n);
  }

  update(dt) {
    let n = 0;
    const out = [];
    for (const q of this.p) {
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.gravity * dt;
      const nx = q.x + q.vx * dt, ny = q.y + q.vy * dt, nz = q.z + q.vz * dt;
      if (this.world && BLOCKS[this.world.get(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) {
        q.vx *= 0.3; q.vz *= 0.3; q.vy = 0;
      } else { q.x = nx; q.y = ny; q.z = nz; }
      const s = q.size * Math.min(1, q.life * 3);
      this.m.makeScale(s, s, s);
      this.m.setPosition(q.x, q.y, q.z);
      this.mesh.setMatrixAt(n, this.m);
      this.c.setRGB(q.r, q.g, q.b, THREE.SRGBColorSpace);
      this.mesh.setColorAt(n, this.c);
      out.push(q);
      n++;
    }
    this.p = out;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class BlockCursor {
  constructor(scene) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x14121c, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    scene.add(this.outline);

    // Where the held block would go: white outline plus a faint fill.
    this.ghost = new THREE.Group();
    this.ghost.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })));
    this.ghost.add(new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false })));
    this.ghost.visible = false;
    scene.add(this.ghost);

    const atlas = getAtlas();
    this.crackTex = [];
    for (let s = 0; s < 10; s++) {
      const t = new THREE.CanvasTexture(atlas.tile(`crack_${s}`));
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      this.crackTex.push(t);
    }
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.crack.visible = false;
    scene.add(this.crack);
  }

  showGhost(cell) {
    this.ghost.visible = !!cell;
    this.ghost.scale.set(1, 1, 1);
    if (cell) this.ghost.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
  }

  // Outline a whole structure: box = [x0, y0, z0, x1, y1, z1] in cells (inclusive).
  showGhostBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;
    this.ghost.visible = true;
    this.ghost.scale.set(x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1);
    this.ghost.position.set((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2);
  }

  show(hit) {
    if (!hit) { this.outline.visible = false; this.crack.visible = false; return; }
    const h = BLOCKS[hit.id].height;
    this.outline.visible = true;
    this.outline.scale.set(1, h, 1);
    this.outline.position.set(hit.x + 0.5, hit.y + h / 2, hit.z + 0.5);
  }

  setProgress(hit, progress) {
    if (!hit || progress <= 0) { this.crack.visible = false; return; }
    const h = BLOCKS[hit.id].height;
    this.crack.visible = true;
    this.crack.scale.set(1, h, 1);
    this.crack.position.set(hit.x + 0.5, hit.y + h / 2, hit.z + 0.5);
    this.crack.material.map = this.crackTex[Math.min(9, Math.floor(progress * 10))];
  }
}
