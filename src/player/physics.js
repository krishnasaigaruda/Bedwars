// Player movement, ported from Minecraft 1.8 (EntityLivingBase /
// EntityPlayerSP). Runs at 20 ticks per second in blocks per tick; the
// renderer interpolates between ticks.
//
// Per tick: accelerate (moveFlying), collide (moveEntity: y, then x, then z,
// with step-up and the sneak edge guard), then gravity 0.08 and drag 0.98
// vertically, ground friction slipperiness * 0.91 horizontally.
import { PHYS } from '../config.js';
import { BLOCKS } from '../world/blocks.js';

const HW = PHYS.width / 2;
const STEP = 0.6;
const GRAVITY = 0.08;
const DRAG = 0.98;
const AIR_FRICTION = 0.91;
const WALK = 0.1;            // movement speed attribute
const SPRINT_MUL = 1.3;
const AIR_ACCEL = 0.02;
const JUMP = 0.42;
const SPRINT_JUMP_BOOST = 0.2;
const FLY_SPEED = 0.05;

function boxesIn(world, x0, y0, z0, x1, y1, z1) {
  const out = [];
  for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++)
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        const b = BLOCKS[world.get(x, y, z)];
        if (!b || !b.solid) continue;
        out.push([x, y, z, x + 1, y + b.height, z + 1]);
      }
  return out;
}

const overlaps = (a0, a1, b0, b1) => a1 > b0 + 1e-7 && a0 < b1 - 1e-7;
const intersects = (a, b) => overlaps(a[0], a[3], b[0], b[3]) && overlaps(a[1], a[4], b[1], b[4]) && overlaps(a[2], a[5], b[2], b[5]);

function clipY(boxes, bb, dy) {
  for (const b of boxes) {
    if (!overlaps(bb[0], bb[3], b[0], b[3]) || !overlaps(bb[2], bb[5], b[2], b[5])) continue;
    if (dy > 0 && bb[4] <= b[1] + 1e-7) dy = Math.min(dy, b[1] - bb[4]);
    else if (dy < 0 && bb[1] >= b[4] - 1e-7) dy = Math.max(dy, b[4] - bb[1]);
  }
  return dy;
}
function clipX(boxes, bb, dx) {
  for (const b of boxes) {
    if (!overlaps(bb[1], bb[4], b[1], b[4]) || !overlaps(bb[2], bb[5], b[2], b[5])) continue;
    if (dx > 0 && bb[3] <= b[0] + 1e-7) dx = Math.min(dx, b[0] - bb[3]);
    else if (dx < 0 && bb[0] >= b[3] - 1e-7) dx = Math.max(dx, b[3] - bb[0]);
  }
  return dx;
}
function clipZ(boxes, bb, dz) {
  for (const b of boxes) {
    if (!overlaps(bb[0], bb[3], b[0], b[3]) || !overlaps(bb[1], bb[4], b[1], b[4])) continue;
    if (dz > 0 && bb[5] <= b[2] + 1e-7) dz = Math.min(dz, b[2] - bb[5]);
    else if (dz < 0 && bb[2] >= b[5] - 1e-7) dz = Math.max(dz, b[5] - bb[2]);
  }
  return dz;
}
const shift = (bb, dx, dy, dz) => { bb[0] += dx; bb[3] += dx; bb[1] += dy; bb[4] += dy; bb[2] += dz; bb[5] += dz; };

export class Body {
  constructor() {
    this.pos = { x: 0, y: 0, z: 0 };
    this.prev = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };   // blocks per tick
    this.onGround = false;
    this.flying = false;
    this.canFly = false;
    this.sneaking = false;
    this.sprinting = false;
    this.onLadder = false;
    this.collidedH = false;
    this.fallDistance = 0;
    this.landedFrom = 0;    // fall distance of a landing that happened this tick
    this.jumpTicks = 0;
    this.jumped = false;    // a jump started this tick
    this.walked = 0;        // horizontal distance moved this tick
  }

  teleport(x, y, z) {
    this.pos.x = this.prev.x = x;
    this.pos.y = this.prev.y = y;
    this.pos.z = this.prev.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.fallDistance = 0;
    this.flying = false;
  }

  aabb() {
    const p = this.pos;
    return [p.x - HW, p.y, p.z - HW, p.x + HW, p.y + PHYS.height, p.z + HW];
  }

  // Interpolated position for rendering, alpha = progress into the next tick.
  lerp(alpha) {
    return {
      x: this.prev.x + (this.pos.x - this.prev.x) * alpha,
      y: this.prev.y + (this.pos.y - this.prev.y) * alpha,
      z: this.prev.z + (this.pos.z - this.prev.z) * alpha,
    };
  }

  groundBelow(world, dx, dz) {
    const bb = this.aabb();
    shift(bb, dx, -1, dz);
    for (const b of boxesIn(world, bb[0], bb[1], bb[2], bb[3], bb[4], bb[5])) if (intersects(bb, b)) return true;
    return false;
  }

  touchingLadder(world) {
    const p = this.pos;
    return BLOCKS[world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))].climbable;
  }

  slipperiness(world) {
    const p = this.pos;
    const id = world.get(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z));
    return BLOCKS[id].slip;
  }

  // input: { forward, strafe (-1..1, + = right), jump, sneak, sprint, sprintTap, yaw, canSprint }
  tick(world, input, speedMul = 1, jumpBoost = 0) {
    const v = this.vel;
    this.prev.x = this.pos.x; this.prev.y = this.pos.y; this.prev.z = this.pos.z;
    this.landedFrom = 0;
    this.jumped = false;

    let forward = input.forward * 0.98;
    let strafe = input.strafe * 0.98;
    this.sneaking = !!input.sneak && !this.flying;
    if (this.sneaking) { forward *= 0.3; strafe *= 0.3; }

    // Sprinting: needs forward >= 0.8 and food, stops on walls.
    const canSprint = input.canSprint !== false || this.flying;
    if (!this.sprinting && forward >= 0.8 && canSprint && (input.sprint || input.sprintTap)) this.sprinting = true;
    if (this.sprinting && (forward < 0.8 || this.collidedH || !canSprint)) this.sprinting = false;

    for (const k of ['x', 'y', 'z']) if (Math.abs(v[k]) < 0.005) v[k] = 0;

    if (this.jumpTicks > 0) this.jumpTicks--;
    if (this.flying) {
      if (input.sneak) v.y -= FLY_SPEED * 3;
      if (input.jump) v.y += FLY_SPEED * 3;
    } else if (input.jump && !this.onLadder) {
      if (this.onGround && this.jumpTicks === 0) {
        v.y = JUMP + jumpBoost * 0.1;
        if (this.sprinting) {
          v.x += -Math.sin(input.yaw) * SPRINT_JUMP_BOOST;
          v.z += -Math.cos(input.yaw) * SPRINT_JUMP_BOOST;
        }
        this.jumpTicks = 10;
        this.jumped = true;
      }
    } else this.jumpTicks = 0;

    // moveFlying: accelerate toward the input direction.
    const slip = this.onGround ? this.slipperiness(world) * AIR_FRICTION : AIR_FRICTION;
    let accel;
    if (this.flying) accel = FLY_SPEED * (this.sprinting ? 2 : 1);
    else if (this.onGround) accel = WALK * speedMul * (this.sprinting ? SPRINT_MUL : 1) * (0.16277136 / (slip * slip * slip));
    else accel = AIR_ACCEL * (this.sprinting ? SPRINT_MUL : 1);
    let len = strafe * strafe + forward * forward;
    if (len >= 1e-4) {
      len = Math.max(1, Math.sqrt(len));
      const f = (forward * accel) / len, s = (strafe * accel) / len;
      const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
      v.x += -sin * f + cos * s;
      v.z += -cos * f - sin * s;
    }

    this.onLadder = !this.flying && this.touchingLadder(world);
    if (this.onLadder) {
      v.x = Math.max(-0.15, Math.min(0.15, v.x));
      v.z = Math.max(-0.15, Math.min(0.15, v.z));
      this.fallDistance = 0;
      v.y = Math.max(v.y, -0.15);
      if (this.sneaking && v.y < 0) v.y = 0;
    }

    // Friction is picked before moving (as in 1.8): the jump tick still uses
    // ground friction, the landing tick still uses air friction.
    const friction = this.onGround ? this.slipperiness(world) * AIR_FRICTION : AIR_FRICTION;
    const flyY = v.y;
    this.move(world, v.x, v.y, v.z);
    if (this.collidedH && this.onLadder) v.y = 0.2;

    if (this.flying) {
      v.y = flyY * 0.6;
      if (this.onGround) this.flying = false;
    } else {
      v.y = (v.y - GRAVITY) * DRAG;
    }
    v.x *= friction;
    v.z *= friction;
  }

  move(world, dx, dy, dz) {
    // Sneaking stops you walking off an edge (Minecraft checks 0.05 at a time).
    if (this.sneaking && this.onGround) {
      const s = 0.05;
      while (dx !== 0 && !this.groundBelow(world, dx, 0)) dx = Math.abs(dx) < s ? 0 : dx - Math.sign(dx) * s;
      while (dz !== 0 && !this.groundBelow(world, 0, dz)) dz = Math.abs(dz) < s ? 0 : dz - Math.sign(dz) * s;
      while (dx !== 0 && dz !== 0 && !this.groundBelow(world, dx, dz)) {
        dx = Math.abs(dx) < s ? 0 : dx - Math.sign(dx) * s;
        dz = Math.abs(dz) < s ? 0 : dz - Math.sign(dz) * s;
      }
    }

    const wantX = dx, wantY = dy, wantZ = dz;
    const bb = this.aabb();
    const boxes = boxesIn(world,
      Math.min(bb[0], bb[0] + dx) - 0.01, Math.min(bb[1], bb[1] + dy) - 0.01, Math.min(bb[2], bb[2] + dz) - 0.01,
      Math.max(bb[3], bb[3] + dx) + 0.01, Math.max(bb[4], bb[4] + dy) + STEP, Math.max(bb[5], bb[5] + dz) + 0.01);

    dy = clipY(boxes, bb, dy); shift(bb, 0, dy, 0);
    dx = clipX(boxes, bb, dx); shift(bb, dx, 0, 0);
    dz = clipZ(boxes, bb, dz); shift(bb, 0, 0, dz);

    const groundish = this.onGround || (wantY !== dy && wantY < 0);
    let stepped = false;
    if (!this.flying && groundish && (dx !== wantX || dz !== wantZ)) {
      const sb = this.aabb();
      const up = clipY(boxes, sb, STEP); shift(sb, 0, up, 0);
      const sx = clipX(boxes, sb, wantX); shift(sb, sx, 0, 0);
      const sz = clipZ(boxes, sb, wantZ); shift(sb, 0, 0, sz);
      const down = clipY(boxes, sb, -up); shift(sb, 0, down, 0);
      if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-9) {
        for (let i = 0; i < 6; i++) bb[i] = sb[i];
        dx = sx; dz = sz;
        stepped = true;
      }
    }

    const ox = this.pos.x, oz = this.pos.z;
    this.collidedH = dx !== wantX || dz !== wantZ;
    const collidedV = stepped || dy !== wantY;
    this.onGround = collidedV && wantY < 0;
    if (dx !== wantX) this.vel.x = 0;
    if (dz !== wantZ) this.vel.z = 0;
    if (collidedV) this.vel.y = 0;

    this.pos.x = (bb[0] + bb[3]) / 2;
    this.pos.y = bb[1];
    this.pos.z = (bb[2] + bb[5]) / 2;
    this.walked = Math.hypot(this.pos.x - ox, this.pos.z - oz);

    // Fall tracking (updateFallState).
    if (this.onGround) {
      if (this.fallDistance > 0 && !this.flying) this.landedFrom = this.fallDistance;
      this.fallDistance = 0;
    } else if (this.flying || this.onLadder) this.fallDistance = 0;
    else if (dy < 0) this.fallDistance -= dy;
  }
}
