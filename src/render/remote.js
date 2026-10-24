// Other players: one PlayerModel each, eased toward the latest network
// position so 20 updates a second still look smooth.
import * as THREE from 'three';
import { PlayerModel } from './models.js';

const LOBBY_TEAM = 5;   // white hoodies while waiting in the lobby

export class RemotePlayers {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.views = new Map();
  }

  clear() {
    this.group.clear();
    this.views.clear();
  }

  // list: [{ id, name, team, pos, yaw, pitch, sneak, flying, held, heldTint, armorKey, swing, visible }]
  sync(list, dt) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      const team = p.team >= 0 ? p.team : LOBBY_TEAM;
      let v = this.views.get(p.id);
      if (!v || v.team !== team || v.name !== p.name) {
        if (v) this.group.remove(v.model.root);
        const model = new PlayerModel({ team, name: p.name, showName: true });
        model.root.position.set(p.pos.x, p.pos.y, p.pos.z);
        this.group.add(model.root);
        v = { model, team, name: p.name, yaw: p.yaw, swing: p.swing ?? 0, swingT: 0, hurtT: 0, lastPos: { ...p.pos }, speed: 0 };
        this.views.set(p.id, v);
      }
      const m = v.model;
      m.root.visible = p.visible !== false;
      const k = Math.min(1, dt * 14);
      const r = m.root.position;
      const before = { x: r.x, z: r.z };
      r.x += (p.pos.x - r.x) * k;
      r.y += (p.pos.y - r.y) * k;
      r.z += (p.pos.z - r.z) * k;
      if (r.distanceTo(p.pos) > 8) r.set(p.pos.x, p.pos.y, p.pos.z);
      let dy = p.yaw - v.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      v.yaw += dy * k;
      m.root.rotation.y = v.yaw;
      const sp = Math.hypot(r.x - before.x, r.z - before.z) / Math.max(dt, 1e-3);
      v.speed += (sp - v.speed) * Math.min(1, dt * 8);

      if ((p.swing ?? 0) !== v.swing) { v.swing = p.swing; v.swingT = 0.001; }
      if (v.swingT > 0) { v.swingT += dt / 0.3; if (v.swingT >= 1) v.swingT = 0; }
      m.setHeld(p.held ?? null, p.heldTint ?? undefined);
      if (v.armorKey !== p.armorKey) {
        v.armorKey = p.armorKey;
        const parts = (p.armorKey ?? '').split('|');
        const top = parts[0] || parts[1];
        const legs = parts[2] || parts[3];
        m.setArmor(parts.some(Boolean) ? { top: top ? top.split('_')[0] : 'leather', legs: legs ? legs.split('_')[0] : 'leather' } : null);
      }
      m.animate(dt, { speed: v.speed, sneaking: p.sneak, swing: v.swingT, pitch: p.pitch, flying: p.flying });

      // Red flash when hurt.
      if (v.hurtT > 0) {
        v.hurtT -= dt;
        this.tint(m, v.hurtT > 0 ? 0.6 : 0);
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { this.group.remove(v.model.root); this.views.delete(id); }
    }
  }

  hurt(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.hurtT = 0.4;
    this.tint(v.model, 0.6);
  }

  // Hurt flash: a red see-through box over the body (materials are shared
  // between models, so they're left alone).
  tint(model, amount) {
    if (!model.hurtOverlay) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false }));
      box.position.y = 0.95;
      model.root.add(box);
      model.hurtOverlay = box;
    }
    model.hurtOverlay.material.opacity = amount * 0.45;
  }

  // Ray against player boxes for melee: returns { id, dist } or null.
  pick(eye, dir, reach, players) {
    let best = null;
    for (const p of players) {
      const v = this.views.get(p.id);
      if (!v || !v.model.root.visible) continue;
      const c = v.model.root.position;
      const box = [c.x - 0.4, c.y - 0.1, c.z - 0.4, c.x + 0.4, c.y + 1.9, c.z + 0.4];
      const t = rayBox(eye, dir, box);
      if (t !== null && t <= reach && (!best || t < best.dist)) best = { id: p.id, dist: t };
    }
    return best;
  }
}

function rayBox(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = [o.x, o.y, o.z][i], di = d[i];
    if (Math.abs(di) < 1e-9) { if (oi < b[i] || oi > b[i + 3]) return null; continue; }
    let t1 = (b[i] - oi) / di, t2 = (b[i + 3] - oi) / di;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
