// Arrows, fireballs, pearls, eggs and lit TNT.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { blockGeometry } from '../world/mesher.js';
import { blockMaterial, glowSprite } from './models.js';

function make(kind) {
  const g = new THREE.Group();
  if (kind === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), new THREE.MeshLambertMaterial({ color: 0xcfd4dc }));
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.36;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.14), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    fl.position.z = 0.26;
    g.add(shaft, tip, fl);
  } else if (kind === 'fireball') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshBasicMaterial({ color: 0xff8a2a })));
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: 0xffe066 })));
    g.add(glowSprite(0xff7a1a, 2.2));
  } else if (kind === 'pearl') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2fa58f, emissive: 0x0f5c55 })));
    g.add(glowSprite(0x5fffd0, 0.8));
  } else if (kind === 'egg') {
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf4ead8 }));
    egg.scale.y = 1.3;
    g.add(egg);
  } else if (kind === 'tnt') {
    const mesh = new THREE.Mesh(blockGeometry(B.TNT), blockMaterial().clone());
    mesh.position.y = 0.5;
    g.add(mesh);
    g.userData.mesh = mesh;
  }
  return g;
}

export class ProjectileRenderer {
  constructor(scene, particles) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.objs = new Map();
    this.particles = particles;
  }

  clear() { this.group.clear(); this.objs.clear(); }

  sync(projectiles, t, dt) {
    for (const [id, o] of this.objs) if (!projectiles.has(id)) { this.group.remove(o); this.objs.delete(id); }
    for (const p of projectiles.values()) {
      let o = this.objs.get(p.id);
      if (!o) {
        o = make(p.kind);
        o.position.set(p.x, p.y, p.z);
        this.objs.set(p.id, o);
        this.group.add(o);
      }
      const k = Math.min(1, dt * 20);
      o.position.x += (p.x - o.position.x) * k;
      o.position.y += (p.y - o.position.y) * k;
      o.position.z += (p.z - o.position.z) * k;
      if (p.kind === 'arrow' && (p.vx || p.vy || p.vz)) {
        o.lookAt(o.position.x - p.vx, o.position.y - p.vy, o.position.z - p.vz);
      }
      if (p.kind === 'fireball') {
        o.rotation.x += dt * 4; o.rotation.y += dt * 3;
        if (Math.random() < 0.6) this.particles.burst(o.position.x, o.position.y, o.position.z, [255, 140 + Math.random() * 80, 40], 1, { spread: 0.15, speed: 0.6, gravity: -2, size: 0.12 });
      }
      if (p.kind === 'tnt') {
        // Flash white faster as the fuse runs out.
        const flash = Math.sin(t * (p.fuse < 20 ? 30 : 12)) > 0.4;
        const m = o.userData.mesh.material;
        m.color.setScalar(flash ? 2.2 : 1);
        o.userData.mesh.scale.setScalar(p.fuse < 10 ? 1 + (10 - p.fuse) * 0.015 : 1);
        if (Math.random() < 0.3) this.particles.burst(o.position.x, o.position.y + 1.1, o.position.z, [90, 90, 90], 1, { spread: 0.05, speed: 0.4, gravity: -3, size: 0.08 });
      }
    }
  }
}
