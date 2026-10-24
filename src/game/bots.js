// Practice bots. Each bot is an ordinary Game player driven by a little
// state machine running on the host: gear up at the forge, bridge to an
// enemy bed and break it, and fight anyone who comes close. Bots move with
// the same physics as real players.
import { Body } from '../player/physics.js';
import { B, BLOCKS } from '../world/blocks.js';
import { getItem } from './items.js';
import { breakTicks } from './rules.js';

const NAMES = ['Pixel', 'Nugget', 'Bouncer', 'Sparky', 'Waffles', 'Biscuit', 'Turbo', 'Pebble', 'Noodle', 'Gizmo', 'Rocket', 'Mango', 'Ziggy', 'Pickles', 'Dusty', 'Comet'];
export const botName = (i) => `Bot ${NAMES[i % NAMES.length]}`;

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Bot {
  constructor(game, player, rand = Math.random) {
    this.g = game;
    this.p = player;
    this.rand = rand;
    this.body = new Body();
    this.yaw = 0;
    this.state = 'gear';
    this.waited = 0;
    this.placeCd = 0;
    this.attackCd = 0;
    this.breaking = null;
    this.sidestep = 0;
    this.sideDir = 1;
    this.stuckCheck = { x: 0, z: 0, t: 0 };
    this.wasAlive = false;
    this.swing = 0;
    this.axis = null;     // 'x' or 'z': the direction of the current straight stretch
    this.trail = [];      // breadcrumbs back home along our own bridge
    // Human-ish imperfection.
    this.react = 0;       // ticks before reacting to a newly seen enemy
    this.foe = null;
    this.wobble = rand() * 6.28;
    this.strafeDir = 1;
    this.strafeFor = 0;
    this.digDelay = 0;
    this.t = 0;
  }

  // Turn toward a yaw gradually, with a little hand shake.
  turn(target, rate = 0.22) {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-rate, Math.min(rate, d)) + (this.rand() - 0.5) * 0.04;
    return Math.abs(d);
  }

  spawned() {
    const s = this.p.pos;
    this.body.teleport(s.x, s.y, s.z);
    this.yaw = this.g.map.bases[this.p.team].spawn.yaw;
    this.state = 'gear';
    this.waited = 0;
    this.breaking = null;
    this.axis = null;
    this.trail = [];
  }

  // Knockback from the game (same maths the real client uses).
  knock(e) {
    const v = this.body.vel;
    if (e.mode === 'hit') {
      v.x /= 2; v.y /= 2; v.z /= 2;
      v.x -= e.dx * 0.4; v.z -= e.dz * 0.4;
      v.y = Math.min(0.4, v.y + 0.4);
      v.x += e.extra[0]; v.y += e.extra[1]; v.z += e.extra[2];
    } else { v.x += e.v[0]; v.y += e.v[1]; v.z += e.v[2]; }
    this.body.onGround = false;
  }

  slotOf(pred) { return this.p.inv.slots.findIndex((s) => s && pred(getItem(s.id), s)); }
  blocksLeft() { const i = this.slotOf((it) => it?.kind === 'block' && it.block !== B.TNT); return i; }
  blockCount() {
    return this.p.inv.slots.reduce((n, s) => n + (s && getItem(s.id)?.kind === 'block' && getItem(s.id).block !== B.TNT ? s.count : 0), 0);
  }

  nearestEnemy(range) {
    let best = null, bd = range;
    for (const o of this.g.players.values()) {
      if (!o.alive || o.eliminated || o.team === this.p.team || o.effects?.invis) continue;
      const d = Math.hypot(o.pos.x - this.p.pos.x, o.pos.z - this.p.pos.z);
      if (d < bd && Math.abs(o.pos.y - this.p.pos.y) < 4) { bd = d; best = o; }
    }
    return best;
  }

  targetBed() {
    let best = null, bd = Infinity;
    for (const base of this.g.map.bases) {
      if (base.team === this.p.team || !this.g.beds.get(base.team)) continue;
      const [x, , z] = base.bed.head;
      const d = Math.hypot(x - this.p.pos.x, z - this.p.pos.z);
      if (d < bd) { bd = d; best = base; }
    }
    return best;
  }

  // What a bot buys at the goblin, best things first, keeping enough
  // silver for blocks.
  shop() {
    const g = this.g, p = this.p;
    const silver = () => p.inv.count('silver'), gold = () => p.inv.count('gold'), dia = () => p.inv.count('diamond');
    if (dia() >= 4 && !p.inv.count('diamond_sword')) g.buy(p, 'diamond_sword');
    if (gold() >= 18 && p.armorTier < 2) g.buy(p, 'iron_armor');
    if (gold() >= 3 && !p.inv.count('iron_sword') && !p.inv.count('diamond_sword')) g.buy(p, 'iron_sword');
    if (gold() >= 2 && p.inv.count('golden_apple') < 2) g.buy(p, 'golden_apple');
    if (silver() >= 10 && p.inv.count('wood_sword')) g.buy(p, 'stone_sword');
    if (silver() >= 10 + 16 && p.pickTier < 0) g.buy(p, 'pickaxe');
    if (silver() >= 48 + 16 && p.armorTier < 1) g.buy(p, 'chain_armor');
    if (silver() >= 20 + 24 && !p.shears) g.buy(p, 'shears');
    for (let i = 0; i < 8 && silver() >= 4 && this.blockCount() < 128; i++) g.buy(p, 'fluff');
  }

  // Team upgrades with coins, in a sensible order.
  upgrade() {
    const g = this.g, p = this.p;
    const ups = g.upgrades.get(p.team);
    for (const id of ['forge', 'sharp', 'prot', 'haste', 'heal']) {
      if (p.inv.count('coin') < 40) return;
      if (ups[id] < 2) g.buyUpgrade(p, id);
    }
  }

  tick() {
    const p = this.p, g = this.g, b = this.body, w = g.world;
    if (!p.alive) { this.wasAlive = false; return; }
    if (!this.wasAlive) { this.wasAlive = true; this.spawned(); }
    if (this.placeCd > 0) this.placeCd--;
    if (p.hp < 9 && p.absorption <= 0 && this.rand() < 0.05) {
      const apple = this.slotOf((it) => it?.id === 'golden_apple');
      if (apple >= 0) g.eat(p, apple);
    }
    if (this.attackCd > 0) this.attackCd--;
    if (this.sidestep > 0) this.sidestep--;
    this.t++;

    const mv = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: this.yaw, canSprint: true };
    let goal = null;
    let bridging = false;

    // 1. Fight anyone close by.
    // Anyone inside our base (or near our bed) is the first priority;
    // otherwise whoever comes within ~14 blocks.
    const base = g.map.bases[p.team];
    let enemy = null;
    for (const o of g.players.values()) {
      if (!o.alive || o.eliminated || o.team === p.team || o.effects?.invis) continue;
      if (Math.hypot(o.pos.x - base.center[0], o.pos.z - base.center[1]) < 16 && Math.abs(o.pos.y - base.spawn.y) < 8) { enemy = o; break; }
    }
    if (!enemy) enemy = this.nearestEnemy(14);
    if (enemy && enemy.id !== this.foe) { this.foe = enemy.id; this.react = 8 + Math.floor(this.rand() * 12); }
    if (!enemy) this.foe = null;
    if (enemy && this.react > 0) this.react--;
    if (enemy && this.react <= 0) {
      const dx = enemy.pos.x - p.pos.x, dz = enemy.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const aimOff = this.turn(yawTo(dx, dz), 0.3);
      this.select((it) => it?.kind === 'sword');
      if (d > 2.3) { mv.forward = 1; mv.sprint = this.rand() < 0.9; }
      else if (d < 1.6) mv.forward = -0.6;
      // Circle-strafe, switching sides every second or two.
      if (--this.strafeFor <= 0) { this.strafeDir = this.rand() < 0.5 ? -1 : 1; this.strafeFor = 20 + Math.floor(this.rand() * 30); }
      if (d < 4) mv.strafe = this.strafeDir * 0.7;
      // A bit less reach than a player (about 2.5 blocks to your hitbox), and
      // only about half the swings land.
      if (d < 2.8 && Math.abs(enemy.pos.y - p.pos.y) < 1.8 && this.attackCd <= 0) {
        this.swing++;
        if (aimOff < 0.32 && this.rand() < 0.5) g.attack(p, enemy.id, b.fallDistance > 0 && !b.onGround);
        this.attackCd = 10 + Math.floor(this.rand() * 10);
        if (b.sprinting) { b.vel.x *= 0.6; b.vel.z *= 0.6; b.sprinting = false; }
      }
      if (d < 3.5 && b.onGround && this.rand() < 0.04) mv.jump = true;
      goal = { x: enemy.pos.x, z: enemy.pos.z, near: 2.2 };
    } else if (enemy) {
      // Still reacting: keep doing what we were doing, just slower.
      mv.forward = 0.5;
    } else if (this.state === 'gear') {
      // 2. Stand on the forge until there's enough silver, then shop.
      const f = g.map.bases[p.team].forge;
      goal = { x: f.x, z: f.z, near: 0.6 };
      if (Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < 1.2) {
        this.waited++;
        const blocks = this.blockCount();
        if ((p.inv.count('silver') >= 34 && blocks < 32) || blocks >= 64 || this.waited > 90 * 20) {
          this.state = 'shop';
          this.waited = 0;
          this.axis = null;
        }
      }
    } else if (this.state === 'shop' || this.state === 'upgrade') {
      // Walk up to the goblin (or the tinker), then buy.
      const npc = g.map.bases[p.team][this.state === 'shop' ? 'shop' : 'upgrades'];
      const d = Math.hypot(npc.x - p.pos.x, npc.z - p.pos.z);
      if (d > 2.4) goal = { x: npc.x, z: npc.z, near: 2.2 };
      else if (++this.waited > 15) {
        this.waited = 0;
        this.axis = null;
        if (this.state === 'shop') {
          this.shop();
          this.state = p.inv.count('coin') >= 80 ? 'upgrade' : 'attack';
        } else {
          this.upgrade();
          this.state = 'attack';
        }
        if (this.state === 'attack') {
          if (this.blockCount() < 16) this.state = 'gear';
          this.trail = [];
        }
      } else this.turn(yawTo(npc.x - p.pos.x, npc.z - p.pos.z), 0.25);
    } else if (this.state === 'retreat') {
      // Out of blocks: walk back along our own bridge, then restock.
      const crumb = this.trail[this.trail.length - 1];
      if (!crumb) this.state = 'gear';
      else if (Math.hypot(crumb.x - p.pos.x, crumb.z - p.pos.z) < 0.7) this.trail.pop();
      else { this.turn(yawTo(crumb.x - p.pos.x, crumb.z - p.pos.z), 0.2); mv.forward = 1; mv.sneak = true; }
    } else {
      // 3. Bridge to the nearest standing enemy bed and break it.
      const base = this.targetBed();
      if (!base) {
        const anyone = this.nearestEnemy(500);
        if (anyone) goal = { x: anyone.pos.x, z: anyone.pos.z, near: 2 };
      } else {
        const [hx, hy, hz] = base.bed.head;
        const bd = Math.hypot(hx + 0.5 - p.pos.x, hz + 0.5 - p.pos.z);
        if (bd < 3) this.breakToward(hx, hy, hz);
        else goal = { x: hx + 0.5, z: hz + 0.5, near: 2 };
      }
    }

    // Walk toward the goal one axis at a time, so bridges come out straight.
    if (goal && !enemy) {
      const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z;
      if (Math.hypot(dx, dz) > goal.near) {
        // Stick to one axis until that part of the trip is done.
        if (!this.axis || (this.axis === 'x' ? Math.abs(dx) < 0.6 : Math.abs(dz) < 0.6)) this.axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
        this.turn(this.axis === 'x' ? yawTo(Math.sign(dx), 0) : yawTo(0, Math.sign(dz)), 0.18);
        mv.forward = 1;
        mv.sprint = this.state === 'gear' ? this.rand() < 0.85 : this.rand() < 0.4;
        // A little side-to-side drift on solid ground, like a person steering.
        if (b.onGround) mv.strafe = Math.sin(this.t * 0.07 + this.wobble) * 0.25;
      }
    }
    if (this.state === 'attack') {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - p.pos.x, last.z - p.pos.z) > 1.2) this.trail.push({ x: p.pos.x, z: p.pos.z });
    }
    if (this.sidestep > 0) mv.strafe = this.sideDir;

    // Never walk off an edge: place a block there first, or stop.
    if (mv.forward > 0 && b.onGround) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const cx = Math.floor(p.pos.x + fx * 0.9), cz = Math.floor(p.pos.z + fz * 0.9), cy = Math.floor(p.pos.y + 0.01) - 1;
      if (!BLOCKS[w.get(cx, cy, cz)].solid) {
        bridging = true;
        mv.sprint = false;
        mv.sneak = true;
        mv.strafe = 0;
        const slot = this.blocksLeft();
        if (slot < 0) { mv.forward = 0; if (!enemy && this.state === 'attack') this.state = 'retreat'; }
        else if (this.placeCd <= 0) {
          const id = getItem(p.inv.slots[slot].id).block;
          p.inv.selected = slot;
          const why = g.place(p, cx, cy, cz, slot, id);
          // A normal player sneak-bridges about one block every half second.
          if (!why) { this.swing++; this.placeCd = 7 + Math.floor(this.rand() * 6) + (this.rand() < 0.1 ? 15 : 0); } else mv.forward = 0;
        } else mv.forward = 0;
      }
    }

    // Walls: hop up one block, dig through player blocks, otherwise step around.
    if (b.collidedH && mv.forward > 0 && !bridging) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const cx = Math.floor(p.pos.x + fx * 0.9), cz = Math.floor(p.pos.z + fz * 0.9), cy = Math.floor(p.pos.y + 0.01);
      const low = w.get(cx, cy, cz), high = w.get(cx, cy + 1, cz);
      if (BLOCKS[low].solid && !BLOCKS[high].solid && !BLOCKS[w.get(cx, cy + 2, cz)].solid) mv.jump = true;
      else if (w.isPlaced(cx, cy + 1, cz)) this.dig(cx, cy + 1, cz);
      else if (w.isPlaced(cx, cy, cz)) this.dig(cx, cy, cz);
      else if (this.sidestep <= 0) { this.sidestep = 25; this.sideDir = this.rand() < 0.5 ? -1 : 1; }
    }

    // Stuck for 3 seconds: try a different way round.
    if (++this.stuckCheck.t >= 60) {
      if (Math.hypot(p.pos.x - this.stuckCheck.x, p.pos.z - this.stuckCheck.z) < 1 && mv.forward > 0) {
        this.sidestep = 30; this.sideDir = -this.sideDir; mv.jump = true;
      }
      this.stuckCheck = { x: p.pos.x, z: p.pos.z, t: 0 };
    }

    mv.yaw = this.yaw;
    b.tick(w, mv);
    p.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    p.yaw = this.yaw;
    p.pitch = bridging ? -1.1 : 0;
    p.sneak = b.sneaking;
    p.sprint = b.sprinting;
    p.swing = this.swing;
    if (b.landedFrom > 3) g.damage(p, Math.ceil(b.landedFrom - 3), 'fall', { bypassArmor: true });
  }

  select(pred) {
    const i = this.slotOf(pred);
    if (i >= 0) this.p.inv.selected = i;
  }

  // Break the bed, digging through whatever covers it first.
  breakToward(x, y, z) {
    const p = this.p, w = this.g.world;
    const ex = p.pos.x, ey = p.pos.y + 1.62, ez = p.pos.z;
    const tx = x + 0.5 - ex, ty = y + 0.3 - ey, tz = z + 0.5 - ez;
    const len = Math.hypot(tx, ty, tz);
    this.yaw = yawTo(tx, tz);
    const hit = w.raycast(ex, ey, ez, tx / len, ty / len, tz / len, len + 1);
    if (hit) this.dig(hit.x, hit.y, hit.z);
  }

  dig(x, y, z) {
    const g = this.g, w = g.world, p = this.p;
    const id = w.get(x, y, z);
    if (!id || g.canBreak(p, x, y, z)) { this.breaking = null; return; }
    const key = `${x},${y},${z}`;
    if (!this.breaking || this.breaking.key !== key) this.breaking = { key, ticks: -(8 + Math.floor(this.rand() * 14)) };
    const need = Math.ceil(breakTicks(id, p.inv.heldId(), g.haste(p)) * 1.4) + 4;
    if (this.breaking.ticks >= 0 && this.breaking.ticks % 6 === 0) this.swing++;
    if (++this.breaking.ticks >= need) {
      g.breakBlock(p, x, y, z);
      this.breaking = null;
    }
  }
}
