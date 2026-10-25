// The authoritative game state, stepped at 20 ticks per second: players
// (health, hunger, inventory), generators, dropped items, beds and the event
// timeline. In multiplayer this runs on the host; clients read its events.
import { BUILD_LIMIT, PHYS, TEAMS, VOID_Y } from '../config.js';
import { B, BLOCKS, isLadder } from '../world/blocks.js';
import { Inventory } from './inventory.js';
import { getItem, blockItem } from './items.js';
import { AXES, ARMOR_TIERS, PICKAXES, UPGRADES, offerGive, resolveOffer, resolveUpgrade } from './shop.js';
import { PICKUP_DELAY, RESPAWN_TICKS, TPS, afterArmor, canHarvest } from './rules.js';
import { installCombat } from './combat.js';

const MIN = 60 * TPS;

// Generator speeds in seconds per item, and how many may pile up.
export const GEN = {
  silver: { every: 2.0, cap: 48 },
  coin: { every: 6.0, cap: 120, amount: 10 },   // coins drop 10 at a time
  gold: { tiers: [12, 9, 6], cap: 8 },
  baseGold: { every: 10, cap: 8, item: 'gold' },        // Gold Generator upgrade
  baseDiamond: { every: 10, cap: 4, item: 'diamond' },  // Diamond Generator upgrade
  diamond: { tiers: [65, 50, 35], cap: 2 },
};

export const TIMELINE = [
  { at: 6 * MIN, name: 'Gold II', run: (g) => g.setTier('gold', 2) },
  { at: 12 * MIN, name: 'Diamond II', run: (g) => g.setTier('diamond', 2) },
  { at: 18 * MIN, name: 'Gold III', run: (g) => g.setTier('gold', 3) },
  { at: 24 * MIN, name: 'Diamond III', run: (g) => g.setTier('diamond', 3) },
  { at: 30 * MIN, name: 'Bed gone', run: (g) => g.destroyAllBeds() },
  { at: 40 * MIN, name: 'Game end', run: (g) => g.endByTime() },
];

export class Game {
  constructor({ world, map }) {
    this.world = world;
    this.map = map;
    this.time = 0;
    this.players = new Map();
    this.drops = new Map();
    this.nextDrop = 1;
    this.events = [];
    this.timelineIndex = 0;
    this.beds = new Map(map.bases.map((b) => [b.team, true]));
    this.upgrades = new Map(map.bases.map((b) => [b.team, { sharp: 0, prot: 0, haste: 0, forge: 0, heal: 0, goldgen: 0, diagen: 0 }]));
    this.rand = Math.random;
    this.projectiles = new Map();
    this.nextProj = 1;
    this.builds = [];   // pop-up towers going up
    this.traps = new Map(map.bases.map((b) => [b.team, []]));
    this.trapCooldown = new Map(map.bases.map((b) => [b.team, 0]));
    this.teamChests = new Map(map.bases.map((b) => [b.team, new Array(27).fill(null)]));
    this.competitive = false;   // true when 2+ teams started with players: last team standing wins
    this.ended = false;

    this.gens = [];
    for (const base of map.bases) {
      const p = base.forge;
      this.gens.push({ kind: 'silver', team: base.team, x: p.x, y: p.y, z: p.z, timer: this.jitter(GEN.silver.every) });
      this.gens.push({ kind: 'coin', team: base.team, x: p.x, y: p.y, z: p.z, timer: this.jitter(GEN.coin.every) });
    }
    for (const p of map.goldGens) this.gens.push({ kind: 'gold', tier: 1, x: p.x, y: p.y, z: p.z, timer: GEN.gold.tiers[0] * TPS });
    for (const p of map.diamondGens) this.gens.push({ kind: 'diamond', tier: 1, x: p.x, y: p.y, z: p.z, timer: GEN.diamond.tiers[0] * TPS });
  }

  emit(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  jitter(sec) { return Math.round(sec * TPS * (0.9 + this.rand() * 0.2)); }

  // ------------------------------------------------------------ players

  addPlayer({ id, name, team }) {
    const p = {
      id, name, team,
      inv: new Inventory(),
      hp: 20, absorption: 0,
      food: 20, saturation: 5, exhaustion: 0, foodTimer: 0,
      regenTicks: 0, regenTimer: 0, absorbTicks: 0,
      pos: { x: 0, y: 0, z: 0 },
      alive: true, respawnIn: 0, eliminated: false,
      pickTier: -1, axeTier: -1, shears: false, armorTier: 0,
      lastHit: null, invuln: 0, effects: {}, tpSeq: 0,
      yaw: 0, pitch: 0, sneak: false, sprint: false, onGround: true, held: null, swing: 0, connected: true,
      kills: 0, finals: 0, bedsBroken: 0,
      ender: new Array(27).fill(null),   // personal Ender Chest, kept through deaths
    };
    this.players.set(id, p);
    this.giveStarter(p);
    return p;
  }

  giveStarter(p) {
    p.inv.clear();
    p.inv.add('wood_sword');
    if (p.pickTier >= 0) p.inv.add(PICKAXES[p.pickTier]);
    if (p.axeTier >= 0) p.inv.add(AXES[p.axeTier]);
    if (p.shears) p.inv.add('shears');
    this.equipArmor(p);
  }

  // A full set in the bought tier; leather is dyed in the team color.
  equipArmor(p) {
    const tint = TEAMS[p.team].hex;
    const tier = ARMOR_TIERS[p.armorTier];
    p.inv.armor = ['helmet', 'chestplate', 'leggings', 'boots']
      .map((piece) => ({ id: `${tier}_${piece}`, count: 1, tint: tier === 'leather' ? tint : undefined }));
    p.inv.touch();
  }

  armorPoints(p) {
    return p.inv.armor.reduce((n, s) => n + (s ? getItem(s.id)?.defense ?? 0 : 0), 0);
  }

  spawnPoint(p) { return this.map.bases[p.team].spawn; }

  addExhaustion(p, n) { p.exhaustion = Math.min(40, p.exhaustion + n); }

  damage(p, amount, cause, opts = {}) {
    if (!p.alive || amount <= 0 || this.ended) return;
    if (opts.by && opts.by !== p) p.lastHit = { by: opts.by.id, time: this.time };
    let dmg = opts.bypassArmor ? amount : afterArmor(amount, this.armorPoints(p));
    if (!opts.bypassArmor) dmg *= 1 - 0.04 * this.upgrades.get(p.team).prot;
    if (p.absorption > 0) {
      const a = Math.min(p.absorption, dmg);
      p.absorption -= a;
      dmg -= a;
    }
    p.hp = Math.max(0, p.hp - dmg);
    this.addExhaustion(p, 0.3);
    this.emit({ type: 'hurt', id: p.id, cause, by: opts.by?.id ?? null });
    if (p.hp <= 0) this.kill(p, cause);
  }

  heal(p, amount) { p.hp = Math.min(20, p.hp + amount); }

  kill(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.effects = {};
    const bed = this.beds.get(p.team);
    p.respawnIn = bed ? RESPAWN_TICKS : -1;
    if (!bed) p.eliminated = true;
    // Whoever hit you in the last 10 seconds gets the kill and your resources.
    const killer = p.lastHit && this.time - p.lastHit.time < 10 * TPS ? this.players.get(p.lastHit.by) : null;
    p.lastHit = null;
    if (killer && killer !== p) {
      if (bed) killer.kills++; else killer.finals++;
      const loot = {};
      for (const cur of ['silver', 'coin', 'gold', 'diamond']) {
        const n = p.inv.count(cur);
        if (!n) continue;
        p.inv.remove(cur, n);
        const left = killer.alive ? killer.inv.add(cur, n) : n;
        if (n - left > 0) loot[cur] = n - left;
      }
      if (Object.keys(loot).length) this.emit({ type: 'reward', id: killer.id, loot });
    }
    this.emit({
      type: 'death', id: p.id, name: p.name, team: p.team, cause, final: !bed,
      killer: killer?.id ?? null, killerName: killer?.name ?? null, killerTeam: killer?.team ?? null,
    });
    this.checkWin();
  }

  respawn(p) {
    p.alive = true;
    p.hp = 20; p.absorption = 0;
    p.food = 20; p.saturation = 5; p.exhaustion = 0; p.foodTimer = 0;
    p.regenTicks = 0; p.absorbTicks = 0; p.effects = {}; p.invuln = 60;
    // Tools drop a tier on death (never below wood); everything else resets.
    if (p.pickTier > 0) p.pickTier--;
    if (p.axeTier > 0) p.axeTier--;
    this.giveStarter(p);
    const s = this.spawnPoint(p);
    p.pos = { x: s.x, y: s.y, z: s.z };
    p.tpSeq++;
    this.emit({ type: 'respawn', id: p.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, seq: p.tpSeq });
  }

  // Minecraft FoodStats.onUpdate plus our potion-like effects.
  tickPlayer(p) {
    if (!p.alive) {
      if (p.respawnIn > 0 && --p.respawnIn === 0) this.respawn(p);
      return;
    }
    if (p.exhaustion >= 4) {
      p.exhaustion -= 4;
      if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
      else p.food = Math.max(0, p.food - 1);
    }
    if (p.food >= 18 && p.hp < 20) {
      if (++p.foodTimer >= 80) { this.heal(p, 1); this.addExhaustion(p, 3); p.foodTimer = 0; }
    } else if (p.food <= 0) {
      if (++p.foodTimer >= 80) {
        if (p.hp > 10) this.damage(p, 1, 'starve', { bypassArmor: true });
        p.foodTimer = 0;
      }
    } else p.foodTimer = 0;

    // Heal Pool: regeneration near your own base.
    if (this.upgrades.get(p.team).heal) {
      const c = this.map.bases[p.team].center;
      if (Math.hypot(p.pos.x - c[0], p.pos.z - c[1]) < 14 && p.regenTicks < 2) p.regenTicks = 2;
    }
    if (p.regenTicks > 0) {
      p.regenTicks--;
      if (++p.regenTimer >= 25) { p.regenTimer = 0; this.heal(p, 1); }
    }
    if (p.absorbTicks > 0 && --p.absorbTicks === 0) p.absorption = 0;
    if (p.invuln > 0) p.invuln--;
    for (const k of Object.keys(p.effects)) if (--p.effects[k].ticks <= 0) delete p.effects[k];
    if (p.pos.y < VOID_Y) this.kill(p, 'void');
  }

  eat(p, slot) {
    const s = p.inv.slots[slot];
    const item = getItem(s?.id);
    if (!p.alive || !item || item.kind !== 'food') return false;
    if (!item.golden && p.food >= 20) return false;
    p.inv.removeAt(slot, 1);
    p.food = Math.min(20, p.food + item.food);
    p.saturation = Math.min(p.food, p.saturation + item.saturation);
    if (item.golden) {
      p.regenTicks = 5 * TPS;
      p.absorption = 4;
      p.absorbTicks = 120 * TPS;
    }
    this.emit({ type: 'ate', id: p.id, item: item.id });
    return true;
  }

  // ------------------------------------------------------------ blocks

  // self/at: where the placing player says they are right now. A client's
  // position reaches the host a little late, so a player running over the
  // spot they place on would otherwise still seem to be standing in it.
  cellBlockedByPlayer(x, y, z, self = null, at = null) {
    const hw = PHYS.width / 2;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const q = p === self && at ? at : p.pos;
      if (q.x - hw < x + 1 && q.x + hw > x && q.y < y + 1 && q.y + PHYS.height > y && q.z - hw < z + 1 && q.z + hw > z) return true;
    }
    return false;
  }

  inNoBuild(x, y, z) {
    for (const [x0, y0, z0, x1, y1, z1] of this.map.noBuild) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) return true;
    }
    return false;
  }

  // Returns null on success or a reason string.
  canPlace(p, x, y, z, blockId, at = null) {
    const w = this.world;
    if (!p.alive) return 'dead';
    if (!w.inBounds(x, y, z) || w.get(x, y, z) !== B.AIR) return 'occupied';
    if (y > BUILD_LIMIT) return 'Build height limit reached!';
    if (this.inNoBuild(x, y, z)) return 'You can’t place blocks here!';
    if (BLOCKS[blockId].solid && this.cellBlockedByPlayer(x, y, z, p, at)) return 'occupied';
    return null;
  }

  place(p, x, y, z, slot, blockId, at = null) {
    const s = p.inv.slots[slot];
    const item = getItem(s?.id);
    if (!item || item.kind !== 'block') return 'no block';
    const base = isLadder(item.block) ? B.LADDER : item.block;
    if ((isLadder(blockId) ? B.LADDER : blockId) !== base) return 'wrong block';
    const why = this.canPlace(p, x, y, z, blockId, at);
    if (why) return why;
    p.inv.removeAt(slot, 1);
    if (blockId === B.TNT) {
      // TNT lights itself as soon as it's placed.
      this.spawnProjectile('tnt', p, x + 0.5, y, z + 0.5, 0, 0.2, 0);
      this.emit({ type: 'sound', name: 'fuse', x, y, z });
      return null;
    }
    this.world.set(x, y, z, blockId, true);
    this.emit({ type: 'block', x, y, z, id: blockId, by: p.id });
    return null;
  }

  bedTeamAt(x, y, z) {
    for (const base of this.map.bases) {
      const { head, foot } = base.bed;
      if ([head, foot].some((c) => c[0] === x && c[1] === y && c[2] === z)) return base.team;
    }
    return -1;
  }

  canBreak(p, x, y, z) {
    const id = this.world.get(x, y, z);
    if (id === B.BED) {
      const team = this.bedTeamAt(x, y, z);
      if (team === p.team) return 'You can’t break your own bed!';
      return null;
    }
    if (!this.world.isPlaced(x, y, z)) return 'You can only break blocks placed by a player!';
    return null;
  }

  breakBlock(p, x, y, z) {
    const why = this.canBreak(p, x, y, z);
    if (why) return why;
    const id = this.world.get(x, y, z);
    if (id === B.BED) {
      this.breakBed(this.bedTeamAt(x, y, z), p);
      return null;
    }
    this.world.set(x, y, z, B.AIR);
    this.emit({ type: 'break', x, y, z, id, by: p.id });
    // The block pops out as an item you can pick up (ladders of any facing drop as one item).
    if (canHarvest(id, p.inv.heldId())) {
      const dropId = isLadder(id) ? B.LADDER : id;
      this.spawnDrop(blockItem(dropId), 1, x + 0.5, y + 0.3, z + 0.5, {
        vx: (this.rand() - 0.5) * 0.1, vy: 0.2, vz: (this.rand() - 0.5) * 0.1, pickup: 10,
      });
    }
    return null;
  }

  breakBed(team, by) {
    if (!this.beds.get(team)) return;
    this.beds.set(team, false);
    const { head, foot } = this.map.bases[team].bed;
    for (const c of [head, foot]) this.world.set(c[0], c[1], c[2], B.AIR);
    if (by) by.bedsBroken++;
    this.emit({ type: 'bedBroken', team, by: by?.id ?? null, byName: by?.name ?? null, byTeam: by?.team ?? null });
  }

  destroyAllBeds() {
    for (const [team, alive] of this.beds) if (alive) this.breakBed(team, null);
  }

  // ------------------------------------------------------------ chests

  // The storage behind a container, if the player is close enough to open it.
  container(p, kind) {
    const near = (c) => c && Math.hypot(p.pos.x - (c[0] + 0.5), p.pos.y - c[1], p.pos.z - (c[2] + 0.5)) < 6;
    if (kind === 'team') return near(this.map.bases[p.team].chest) ? this.teamChests.get(p.team) : null;
    if (kind === 'ender') return this.map.bases.some((b) => near(b.enderChest)) ? p.ender : null;
    return null;
  }

  // ------------------------------------------------------------ shop

  buy(p, key) {
    const o = resolveOffer(key, p);
    if (o.status !== 'ok') return o.status === 'owned' ? 'You already have this!' : 'Already maxed!';
    for (const [cur, n] of Object.entries(o.cost)) {
      if (p.inv.count(cur) < n) return `Not enough ${getItem(cur).name}!`;
    }
    const g = offerGive(key);
    const giveId = g.block !== undefined ? o.icon : g.item;
    if (giveId && !p.inv.canFit(giveId, o.count)) return 'Your inventory is full!';
    for (const [cur, n] of Object.entries(o.cost)) p.inv.remove(cur, n);

    if (g.armor) {
      p.armorTier = ARMOR_TIERS.indexOf(g.armor);
      this.equipArmor(p);
    } else if (g.tool) {
      const list = g.tool === 'pickaxe' ? PICKAXES : AXES;
      const tierKey = g.tool === 'pickaxe' ? 'pickTier' : 'axeTier';
      p[tierKey]++;
      const next = list[p[tierKey]];
      if (!p.inv.replace((s, it) => it?.kind === g.tool, { id: next, count: 1 })) p.inv.add(next);
    } else if (g.shears) {
      p.shears = true;
      p.inv.add('shears');
    } else if (getItem(giveId).kind === 'sword') {
      if (!p.inv.replace((s) => s.id === 'wood_sword', { id: giveId, count: 1 })) p.inv.add(giveId);
    } else {
      p.inv.add(giveId, o.count);
    }
    this.emit({ type: 'bought', id: p.id, name: o.name });
    return null;
  }

  // ------------------------------------------------------------ drops

  spawnDrop(item, count, x, y, z, opts = {}) {
    const d = {
      id: this.nextDrop++, item, count, x, y, z,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0, vz: opts.vz ?? 0,
      pickup: opts.pickup ?? 0, age: 0,
      gen: opts.gen ?? null, team: opts.team ?? null, tint: opts.tint,
    };
    this.drops.set(d.id, d);
    return d;
  }

  dropFromSlot(p, slot, all, eye, dir) {
    const s = p.inv.slots[slot];
    if (!s || !p.alive) return;
    const taken = p.inv.removeAt(slot, all ? s.count : 1);
    this.spawnDrop(taken.id, taken.count, eye.x, eye.y - 0.3, eye.z, {
      vx: dir[0] * 0.3 + (this.rand() - 0.5) * 0.02,
      vy: dir[1] * 0.3 + 0.1,
      vz: dir[2] * 0.3 + (this.rand() - 0.5) * 0.02,
      pickup: PICKUP_DELAY, tint: taken.tint,
    });
  }

  tickDrops() {
    const w = this.world;
    for (const d of this.drops.values()) {
      d.age++;
      if (d.pickup > 0) d.pickup--;
      if (d.gen === null) {
        // EntityItem physics: gravity, drag, ground friction, no bouncing walls.
        d.vy -= 0.04;
        const nx = d.x + d.vx, ny = d.y + d.vy, nz = d.z + d.vz;
        const solid = (x, y, z) => BLOCKS[w.get(Math.floor(x), Math.floor(y), Math.floor(z))].solid;
        if (solid(nx, d.y + 0.1, d.z)) d.vx = 0; else d.x = nx;
        if (solid(d.x, d.y + 0.1, nz)) d.vz = 0; else d.z = nz;
        if (d.vy < 0 && solid(d.x, ny, d.z)) {
          d.y = Math.floor(ny) + 1;
          d.vy *= -0.5;
          d.ground = true;
        } else { d.y = ny; d.ground = false; }
        const f = d.ground ? 0.6 * 0.98 : 0.98;
        d.vx *= f; d.vz *= f; d.vy *= 0.98;
        if (d.y < VOID_Y || d.age > 5 * MIN) this.drops.delete(d.id);
      }
    }
    // Pick-ups: the player's box grown by (1, 0.5, 1), like Minecraft.
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const q = p.pos;
      for (const d of this.drops.values()) {
        if (d.pickup > 0) continue;
        if (Math.abs(d.x - q.x) > 1.425 || Math.abs(d.z - q.z) > 1.425) continue;
        if (d.y < q.y - 0.625 || d.y > q.y + PHYS.height + 0.625) continue;
        const left = p.inv.add(d.item, d.count, d.tint ? { tint: d.tint } : {});
        const got = d.count - left;
        if (got <= 0) continue;
        this.emit({ type: 'pickup', id: p.id, item: d.item, count: got, drop: d.id });
        this.splitForge(p, d, got);
        if (left > 0) d.count = left; else this.drops.delete(d.id);
      }
    }
  }

  // Teammates standing at the forge get a copy of what you pick up there.
  splitForge(p, d, count) {
    if (d.team === null || d.team !== p.team || (d.item !== 'silver' && d.item !== 'coin')) return;
    const forge = this.map.bases[d.team].forge;
    for (const o of this.players.values()) {
      if (o === p || !o.alive || o.team !== p.team) continue;
      if (Math.hypot(o.pos.x - forge.x, o.pos.z - forge.z) > 2.5 || Math.abs(o.pos.y - forge.y) > 2) continue;
      const left = o.inv.add(d.item, count);
      if (left < count) this.emit({ type: 'pickup', id: o.id, item: d.item, count: count - left, split: true });
    }
  }

  // ------------------------------------------------------------ generators

  setTier(kind, tier) {
    for (const g of this.gens) if (g.kind === kind) g.tier = tier;
    this.emit({ type: 'genTier', kind, tier });
  }

  genInterval(g) {
    if (g.kind === 'gold' || g.kind === 'diamond') return GEN[g.kind].tiers[g.tier - 1] * TPS;
    if (g.kind === 'baseGold' || g.kind === 'baseDiamond') return GEN[g.kind].every * TPS;
    const forge = this.upgrades.get(g.team).forge;
    const speed = [1, 1.5, 2, 2.5, 3][forge];
    return Math.max(1, Math.round(this.jitter(GEN[g.kind].every) / speed));
  }

  haste(p) { return this.upgrades.get(p.team).haste; }

  buyUpgrade(p, id) {
    const u = UPGRADES.find((x) => x.id === id);
    const ups = this.upgrades.get(p.team);
    const r = resolveUpgrade(u, ups[id]);
    if (r.maxed) return 'Already maxed!';
    if (p.inv.count('coin') < r.price.coin) return 'Not enough Coins!';
    p.inv.remove('coin', r.price.coin);
    ups[id]++;
    if (id === 'goldgen' || id === 'diagen') {
      const kind = id === 'goldgen' ? 'baseGold' : 'baseDiamond';
      const f = this.map.bases[p.team].forge;
      this.gens.push({ kind, team: p.team, x: f.x, y: f.y, z: f.z, timer: GEN[kind].every * TPS });
    }
    this.emit({ type: 'upgrade', team: p.team, id, level: ups[id], by: p.name, name: resolveUpgrade(u, ups[id] - 1).label });
    return null;
  }

  // A team's base generator only runs while that team is in the game with
  // at least one player alive...
  teamActive(team) {
    for (const p of this.players.values()) if (p.team === team && p.connected && p.alive) return true;
    return false;
  }

  // ...and somebody (any team) is close by.
  someoneNear(g, radius = 20) {
    for (const p of this.players.values()) {
      if (p.alive && Math.hypot(p.pos.x - g.x, p.pos.z - g.z) < radius && Math.abs(p.pos.y - g.y) < 12) return true;
    }
    return false;
  }

  tickGens() {
    this.gens.forEach((g, i) => {
      if (g.team != null && (!this.teamActive(g.team) || !this.someoneNear(g))) return;
      if (--g.timer > 0) return;
      g.timer = this.genInterval(g);
      const cap = GEN[g.kind].cap;
      const amount = GEN[g.kind].amount ?? 1;
      const item = GEN[g.kind].item ?? g.kind;
      // Base generators hand their output to everyone standing on them,
      // each person getting a full share.
      if (g.team != null) {
        const standing = [...this.players.values()].filter((p) => p.alive
          && Math.abs(p.pos.x - g.x) < 1.8 && Math.abs(p.pos.z - g.z) < 1.8 && Math.abs(p.pos.y - g.y) < 1.5);
        let gave = false;
        for (const p of standing) {
          const got = amount - p.inv.add(item, amount);
          if (got > 0) { gave = true; this.emit({ type: 'pickup', id: p.id, item, count: got }); }
        }
        if (gave) return;
      }
      // Otherwise everything from one generator piles into one stack, up to the cap.
      let stack = null;
      for (const d of this.drops.values()) if (d.gen === i) { stack = d; break; }
      if (stack) {
        if (stack.count >= cap) return;
        stack.count = Math.min(cap, stack.count + amount);
      } else {
        this.spawnDrop(item, amount, g.x, g.y + 0.1, g.z, { gen: i, team: g.team ?? null });
      }
    });
  }

  genCountdown(kind) {
    const g = this.gens.find((x) => x.kind === kind);
    return g ? Math.ceil(g.timer / TPS) : 0;
  }

  nextEvent() {
    const e = TIMELINE[this.timelineIndex];
    return e ? { name: e.name, seconds: Math.max(0, Math.ceil((e.at - this.time) / TPS)) } : null;
  }

  // ------------------------------------------------------------ tick

  step() {
    this.time++;
    while (this.timelineIndex < TIMELINE.length && this.time >= TIMELINE[this.timelineIndex].at) {
      TIMELINE[this.timelineIndex++].run(this);
    }
    for (const p of this.players.values()) this.tickPlayer(p);
    this.tickGens();
    this.tickDrops();
    this.tickProjectiles();
    this.tickTraps();
    this.tickBuilds();
  }
}

installCombat(Game);

export { blockItem };
