// Draws dropped items and generator stacks: spinning, bobbing, with more
// copies shown for bigger stacks (like Minecraft).
import * as THREE from 'three';
import { createDropModel } from './models.js';

export class DropRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.objs = new Map();
  }

  clear() {
    this.group.clear();
    this.objs.clear();
  }

  sync(drops, t, dt) {
    for (const [id, o] of this.objs) {
      if (!drops.has(id)) { this.group.remove(o.root); this.objs.delete(id); }
    }
    for (const d of drops.values()) {
      let o = this.objs.get(d.id);
      const copies = d.count >= 32 ? 4 : d.count >= 16 ? 3 : d.count > 1 ? 2 : 1;
      if (!o || o.copies !== copies) {
        if (o) this.group.remove(o.root);
        const root = new THREE.Group();
        for (let i = 0; i < copies; i++) {
          const m = createDropModel(d.item, d.tint);
          m.position.set((i % 2) * 0.09 - 0.045 * (copies > 1 ? 1 : 0), i * 0.06, (i >> 1) * 0.09);
          root.add(m);
        }
        root.position.set(d.x, d.y, d.z);
        o = { root, copies, phase: (d.id * 1.7) % 6.28 };
        this.objs.set(d.id, o);
        this.group.add(root);
      }
      // Ease toward the simulated position (sim runs at 20 tps).
      const k = Math.min(1, dt * 18);
      o.root.position.x += (d.x - o.root.position.x) * k;
      o.root.position.z += (d.z - o.root.position.z) * k;
      const baseY = d.y + 0.25 + Math.sin(t * 2.4 + o.phase) * 0.08;
      o.root.position.y += (baseY - o.root.position.y) * k;
      o.root.rotation.y = t * 1.6 + o.phase;
    }
  }
}
