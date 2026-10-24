// First-person hand and held item, following Minecraft 1.8's ItemRenderer:
// the same chain of translate/rotate/scale calls, swing curves, the equip
// dip when you switch items, and view bobbing.
import * as THREE from 'three';
import { getItem } from '../game/items.js';
import { createFirstPersonArm, heldItemObject } from './models.js';

const DEG = Math.PI / 180;
const PI = Math.PI;

// Display transforms (Minecraft's model "firstperson" values), kept here so
// they're easy to tweak.
export const FP = {
  base: [0.56, -0.5, -0.8],
  item: { t: [0, 0.25, 0.125], ry: -115, rz: 30, s: 1.4 },
  block: { ry: 135, s: 0.4 },
  // Empty hand: shoulder just off the bottom-right of the screen, arm aimed
  // up and in toward the crosshair, twisted so the palm side shows.
  arm: { shoulder: [0.6, -0.76, -0.42], dir: [-0.38, 0.55, -0.74], roll: 35 },
};

// Builds a matrix the way GL's matrix stack does (each call post-multiplies).
class Stack {
  constructor() { this.m = new THREE.Matrix4(); this.t = new THREE.Matrix4(); this.axis = new THREE.Vector3(); }
  reset() { this.m.identity(); return this; }
  translate(x, y, z) { this.m.multiply(this.t.makeTranslation(x, y, z)); return this; }
  rotate(deg, x, y, z) {
    if (!deg) return this;
    this.m.multiply(this.t.makeRotationAxis(this.axis.set(x, y, z), deg * DEG));
    return this;
  }
  scale(x, y = x, z = x) { this.m.multiply(this.t.makeScale(x, y, z)); return this; }
}

// Minecraft view bobbing; also used for the world camera.
export function applyBobbing(gl, walked, bob, tilt) {
  const w = walked * PI;
  gl.translate(Math.sin(w) * bob * 0.5, -Math.abs(Math.cos(w) * bob), 0);
  gl.rotate(Math.sin(w) * bob * 3, 0, 0, 1);
  gl.rotate(Math.abs(Math.cos(w - 0.2) * bob) * 5, 1, 0, 0);
  gl.rotate(tilt, 1, 0, 0);
}

export class FirstPerson {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
    this.gl = new Stack();
    this.shownId = undefined;
    this.shownTint = undefined;
    this.targetId = null;
    this.equip = 0;          // 0 = held up, 1 = lowered out of view
    this.arm = null;
    this.armKey = '';
    this.obj = null;
    this.q = new THREE.Quaternion();
    this.rm = new THREE.Matrix4();
    this.down = new THREE.Vector3(0, -1, 0);
    this.aim = new THREE.Vector3();
  }

  setPlayer(team, name, look = null) {
    const key = `${team}|${name}|${look ? JSON.stringify(look) : ''}`;
    if (key === this.armKey) return;
    this.armKey = key;
    this.arm = createFirstPersonArm({ team, name, look });
    this.shownId = undefined;
  }

  build(id, tint) {
    this.root.clear();
    this.shownId = id;
    this.shownTint = tint;
    const item = getItem(id);
    if (!item) {
      this.obj = this.arm;
      if (this.arm) this.root.add(this.arm);
      return;
    }
    this.obj = heldItemObject(id, tint);
    this.obj.matrixAutoUpdate = false;
    this.root.add(this.obj);
  }

  // state: { id, tint, swing (0..1), eat (0..1 or -1), walked, bob, tilt, dt }
  update(s) {
    const want = s.id ?? null;
    // Switching items: lower the hand, swap, raise it again (0.4 per tick).
    if (want !== this.shownId || s.tint !== this.shownTint) {
      this.equip = Math.min(1, this.equip + s.dt * 8);
      if (this.equip >= 1 || this.shownId === undefined) this.build(want, s.tint);
    } else this.equip = Math.max(0, this.equip - s.dt * 8);

    const gl = this.gl.reset();
    applyBobbing(gl, s.walked, s.bob, s.tilt);
    const swing = s.swing;
    const sq = Math.sqrt(swing);
    const item = getItem(this.shownId);

    if (!item) {
      if (!this.arm) return;
      // renderPlayerArm: the same swing curves, aimed with a quaternion.
      gl.translate(-0.3 * Math.sin(sq * PI), 0.4 * Math.sin(sq * PI * 2), -0.4 * Math.sin(swing * PI));
      gl.translate(...FP.arm.shoulder);
      gl.translate(0, this.equip * -0.6, 0);
      gl.rotate(Math.sin(sq * PI) * 40, 0, 1, 0);
      gl.rotate(Math.sin(swing * swing * PI) * -20, 0, 0, 1);
      this.q.setFromUnitVectors(this.down, this.aim.set(...FP.arm.dir).normalize());
      gl.m.multiply(this.rm.makeRotationFromQuaternion(this.q));
      gl.rotate(FP.arm.roll, 0, 1, 0);
      this.root.matrix.copy(gl.m);
      this.root.matrixWorldNeedsUpdate = true;
      return;
    }

    if (s.eat >= 0) {
      // Eating: bob the food up and down in front of the mouth.
      const e = s.eat;
      const k = 1 - Math.pow(1 - e, 27);
      gl.translate(0, Math.abs(Math.cos(e * 32 / 4 * PI) * 0.1) * (e < 0.8 ? 1 : 0), 0);
      gl.translate(k * 0.6, -k * 0.5, 0);
      gl.rotate(k * 90, 0, 1, 0);
      gl.rotate(k * 10, 1, 0, 0);
      gl.rotate(k * 30, 0, 0, 1);
    } else {
      gl.translate(-0.4 * Math.sin(sq * PI), 0.2 * Math.sin(sq * PI * 2), -0.2 * Math.sin(swing * PI));
    }
    // transformFirstPersonItem
    gl.translate(...FP.base);
    gl.translate(0, this.equip * -0.6, 0);
    gl.rotate(45, 0, 1, 0);
    gl.rotate(Math.sin(swing * swing * PI) * -20, 0, 1, 0);
    gl.rotate(Math.sin(sq * PI) * -20, 0, 0, 1);
    gl.rotate(Math.sin(sq * PI) * -80, 1, 0, 0);
    gl.scale(0.4);
    // The item model's own "firstperson" display transform.
    if (item.kind === 'block') {
      gl.rotate(FP.block.ry, 0, 1, 0);
      gl.scale(FP.block.s);
    } else {
      gl.translate(...FP.item.t);
      gl.rotate(FP.item.ry, 0, 1, 0);
      gl.rotate(FP.item.rz, 0, 0, 1);
      gl.scale(FP.item.s);
    }
    this.root.matrix.copy(gl.m);
    this.root.matrixWorldNeedsUpdate = true;
  }
}
