// Fighting and flying things, added onto Game (see sim.js): melee with 1.8
// knockback, bows, fireballs, TNT, ender pearls, bridge eggs, pop-up towers,
// potions, traps and the win check.
import { BUILD_LIMIT, PHYS, VOID_Y } from '../config.js';
import { B, BLOCKS } from '../world/blocks.js';
import { getItem } from './items.js';
import { MAX_TRAPS, TRAPS, TRAP_COSTS } from './shop.js';
import { TPS } from './rules.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const eyeY = (p) => p.pos.y + (p.sneak ? 1.54 : 1.62);

const PROJ = {
  arrow: { gravity: 0.05, drag: 0.99, life: 600 },
  fireball: { gravity: 0, drag: 1, life: 120 },
  pearl: { gravity: 0.03, drag: 0.99, life: 300 },
  egg: { gravity: 0.01, drag: 0.995, life: 50 },
  tnt: { gravity: 0.04, drag: 0.98, life: 1e9 },
};
const TNT_FUSE = 60;

const methods = {
  // ------------------------------------------------------------ melee

  attack(p, targetId, crit) {
    const t = this.players.get(targetId);
    if (this.ended || !t || t === p || !p.alive || !t.alive || t.team === p.team) return;
    // Reach: eye to the closest point of the target's box (3 blocks + lag slack).
    const ey = eyeY(p);
    const cx = clamp(p.pos.x, t.pos.x - 0.3, t.pos.x + 0.3);
    const cy = clamp(ey, t.pos.y, t.pos.y + PHYS.height);
    const cz = clamp(p.pos.z, t.pos.z - 0.3, t.pos.z + 0.3);
    if (Math.hypot(cx - p.pos.x, cy - ey, cz - p.pos.z) > 3.8) return;
    if (t.invuln > 0) return;   // hurt resistance: 10 ticks between hits

    const item = getItem(p.inv.heldId());
    let dmg = 1;
    if (item?.kind === 'sword') dmg = item.damage + (item.tier >= 0 ? 1.25 * this.upgrades.get(p.team).sharp : 0);
    else if (item?.kind === 'axe') dmg = 3 + item.tier;
    else if (item?.kind === 'pickaxe') dmg = 2 + item.tier;
    if (crit) dmg *= 1.5;
    t.invuln = 10;
    this.damage(t, dmg, 'attack', { by: p });

    const d = Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z) || 1;
    const extra = (item?.knockback ?? 0) + (p.sprint ? 1 : 0);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    this.knock(t, (p.pos.x - t.pos.x) / d, (p.pos.z - t.pos.z) / d, [fx * extra * 0.5, extra ? 0.1 : 0, fz * extra * 0.5]);
    this.emit({ type: 'hit', id: p.id, target: t.id, crit: !!crit, x: t.pos.x, y: t.pos.y + 1, z: t.pos.z });
  },

  // Minecraft knockBack(): halve current motion, push 0.4 away and 0.4 up,
  // then add the extra (sprint / Knockback enchant). Applied by the victim.
  knock(t, dx, dz, extra = [0, 0, 0]) {
    if (!t.alive) return;
    this.emit({ type: 'kb', id: t.id, mode: 'hit', dx, dz, extra });
  },

  push(t, vx, vy, vz) {
    if (!t.alive) return;
    this.emit({ type: 'kb', id: t.id, mode: 'add', v: [vx, vy, vz] });
  },

  applyEffect(p, name, ticks, level = 1) {
    p.effects[name] = { ticks, level };
    p.inv.touch();
  },

  // ------------------------------------------------------------ items

  shoot(p, slot, charge, eye, dir) {
    const bow = getItem(p.inv.slots[slot]?.id);
    if (!p.alive || bow?.kind !== 'bow') return;
    let f = Math.min(charge, 20) / 20;
    f = Math.min(1, (f * f + f * 2) / 3);
    if (f < 0.1 || !p.inv.remove('arrow', 1)) return;
    const v = f * 3;
    this.spawnProjectile('arrow', p, eye.x + dir[0] * 0.5, eye.y - 0.1 + dir[1] * 0.5, eye.z + dir[2] * 0.5, dir[0] * v, dir[1] * v, dir[2] * v,
      { power: bow.power, punch: bow.punch, crit: f >= 1 });
    this.emit({ type: 'sound', name: 'bow', x: eye.x, y: eye.y, z: eye.z });
  },

  useItem(p, slot, eye, dir) {
    const s = p.inv.slots[slot];
    const item = getItem(s?.id);
    if (!p.alive || !item) return 'nothing';
    const at = [eye.x + dir[0] * 0.8, eye.y - 0.1 + dir[1] * 0.8, eye.z + dir[2] * 0.8];
    if (item.id === 'fireball') this.spawnProjectile('fireball', p, ...at, dir[0] * 1.1, dir[1] * 1.1, dir[2] * 1.1);
    else if (item.id === 'ender_pearl') this.spawnProjectile('pearl', p, ...at, dir[0] * 1.5, dir[1] * 1.5, dir[2] * 1.5);
    else if (item.kind === 'potion') this.applyEffect(p, item.effect, item.ticks, item.level);
    else return 'nothing';
    p.inv.removeAt(slot, 1);
    this.emit({ type: 'sound', name: item.kind === 'potion' ? 'drink' : 'throw', x: eye.x, y: eye.y, z: eye.z });
    return null;
  },

  // Places a block for a structure (towers, bridge eggs) if the spot is free.
  structureBlock(p, x, y, z, id, anim = false) {
    const w = this.world;
    if (!w.inBounds(x, y, z) || w.get(x, y, z) !== B.AIR || y > BUILD_LIMIT || this.inNoBuild(x, y, z)) return false;
    if (BLOCKS[id].solid && this.cellBlockedByPlayer(x, y, z)) return false;
    w.set(x, y, z, id, true);
    this.emit({ type: 'block', x, y, z, id, by: p.id, anim });
    return true;
  },

  // Placeable builders (Instant Bridge, Pop-up Tower): right-click a spot and
  // the structure builds itself there, facing the way you look.
  deploy(p, slot, x, y, z, fx, fz) {
    const item = getItem(p.inv.slots[slot]?.id);
    if (!p.alive || item?.kind !== 'deploy') return 'nothing';
    if (Math.abs(fx) + Math.abs(fz) !== 1) return 'bad direction';
    if (Math.hypot(x + 0.5 - p.pos.x, y - p.pos.y, z + 0.5 - p.pos.z) > 7) return 'Too far away!';
    if (this.world.get(x, y, z) !== B.AIR || this.inNoBuild(x, y, z)) return 'You can’t build here!';
    const cells = item.build === 'bridge' ? this.bridgeCells(p.team, x, y, z, fx, fz) : this.towerCells(p.team, x, y, z, fx, fz);
    this.builds.push({ owner: p.id, team: p.team, cells, i: 0, rate: item.build === 'bridge' ? 10 : 5 });
    p.inv.removeAt(slot, 1);
    this.emit({ type: 'sound', name: 'whoosh', x, y, z });
    return null;
  },

  // A 4x4 tower, 7 high, door at (x, y, z) facing back toward you, ladder up
  // the back wall, a floor on top with a crenellated parapet and side windows.
  towerCells(team, ax, y0, az, fx, fz) {
    const [rx, rz] = [-fz, fx];
    const at = (u, v) => [ax + fx * (u - 1) + rx * v, az + fz * (u - 1) + rz * v];
    const wall = B.FLUFF + team, trim = B.CLAY + team;
    const ladder = B.LADDER + (fx === 1 ? 1 : fx === -1 ? 0 : fz === 1 ? 3 : 2);
    const cells = [];
    const H = 7;
    for (let y = 0; y <= H + 1; y++) {
      for (let u = 1; u <= 4; u++) for (let v = -1; v <= 2; v++) {
        const edge = u === 1 || u === 4 || v === -1 || v === 2;
        const corner = (u === 1 || u === 4) && (v === -1 || v === 2);
        const [x, z] = at(u, v);
        if (edge) {
          if (y < H) {
            const door = u === 1 && v === 0 && y <= 1;
            const window = (v === -1 || v === 2) && (u === 2 || u === 3) && y === 3;
            if (door || window) continue;
            cells.push([x, y0 + y, z, corner || y === 0 || y === H - 1 ? trim : wall]);
          } else if (y === H) cells.push([x, y0 + y, z, trim]);
          else if (corner || (u + v) % 2 === 0) cells.push([x, y0 + y, z, trim]);   // crenellations
        } else if (y === H - 1 && !(u === 3 && v === 0)) {
          cells.push([x, y0 + y, z, wall]);   // the top floor, with a hole for the ladder
        }
      }
      if (y < H) { const [x, z] = at(3, 0); cells.push([x, y0 + y, z, ladder]); }
    }
    return cells;
  },

  // A straight 3-wide bridge, 24 long, starting at (x, y, z): Fluff deck with a
  // Clay Tile stripe, railings on both sides and lantern posts every 4 blocks.
  bridgeCells(team, sx, sy, sz, fx, fz, L = 24) {
    const [rx, rz] = [-fz, fx];
    const deck = B.FLUFF + team, trim = B.CLAY + team;
    const cells = [];
    for (let u = 0; u < L; u++) {
      const at = (v) => [sx + fx * u + rx * v, sz + fz * u + rz * v];
      for (const v of [0, -1, 1]) { const [x, z] = at(v); cells.push([x, sy, z, v === 0 ? trim : deck]); }
      for (const v of [-2, 2]) {
        const [x, z] = at(v);
        cells.push([x, sy, z, trim]);
        cells.push([x, sy + 1, z, trim]);
        if (u % 4 === 3) { cells.push([x, sy + 2, z, trim]); cells.push([x, sy + 3, z, B.LANTERN]); }
      }
    }
    return cells;
  },

  // Lays a few blocks of every running build per tick, bottom first.
  tickBuilds() {
    for (const job of this.builds) {
      const owner = this.players.get(job.owner) ?? { id: job.owner, team: job.team };
      for (let n = 0; n < (job.rate ?? 5) && job.i < job.cells.length; job.i++) {
        const [x, y, z, id] = job.cells[job.i];
        if (this.structureBlock(owner, x, y, z, id, true)) n++;
      }
    }
    this.builds = this.builds.filter((j) => j.i < j.cells.length);
  },

  // ------------------------------------------------------------ projectiles

  spawnProjectile(kind, owner, x, y, z, vx, vy, vz, extra = {}) {
    const pr = { id: this.nextProj++, kind, owner: owner?.id ?? null, team: owner?.team ?? -1, x, y, z, vx, vy, vz, age: 0, ...extra };
    if (kind === 'tnt') pr.fuse = TNT_FUSE;
    this.projectiles.set(pr.id, pr);
    return pr;
  },

  hitPlayer(pr, x0, y0, z0, x1, y1, z1) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (const t of this.players.values()) {
      if (!t.alive || t.id === pr.owner || (pr.kind !== 'fireball' && t.team === pr.team)) continue;
      if (pr.age < 2 && t.id === pr.owner) continue;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k, z = z0 + (z1 - z0) * k;
        if (Math.abs(x - t.pos.x) < 0.4 && Math.abs(z - t.pos.z) < 0.4 && y > t.pos.y - 0.1 && y < t.pos.y + PHYS.height + 0.1) return { t, x, y, z };
      }
    }
    return null;
  },

  tickProjectiles() {
    const w = this.world;
    for (const pr of [...this.projectiles.values()]) {
      const cfg = PROJ[pr.kind];
      pr.age++;
      if (pr.kind === 'tnt') { this.tickTnt(pr); continue; }
      if (pr.stuck) { if (pr.age > pr.stuck + 30) this.projectiles.delete(pr.id); continue; }

      const x0 = pr.x, y0 = pr.y, z0 = pr.z;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
      const hit = sp > 0 ? w.raycast(x0, y0, z0, pr.vx / sp, pr.vy / sp, pr.vz / sp, sp) : null;
      const blockHit = hit && BLOCKS[hit.id].solid ? hit : null;
      const ex = blockHit ? x0 + pr.vx / sp * blockHit.dist : x0 + pr.vx;
      const ey = blockHit ? y0 + pr.vy / sp * blockHit.dist : y0 + pr.vy;
      const ez = blockHit ? z0 + pr.vz / sp * blockHit.dist : z0 + pr.vz;
      const ph = this.hitPlayer(pr, x0, y0, z0, ex, ey, ez);
      if (ph) { this.impact(pr, ph.x, ph.y, ph.z, null, ph.t); continue; }
      if (blockHit) { this.impact(pr, ex, ey, ez, blockHit, null); continue; }

      pr.x = ex; pr.y = ey; pr.z = ez;
      pr.vx *= cfg.drag; pr.vy = (pr.vy - cfg.gravity) * cfg.drag; pr.vz *= cfg.drag;
      if (pr.age > cfg.life || pr.y < VOID_Y) this.projectiles.delete(pr.id);
    }
  },

  impact(pr, x, y, z, block, target) {
    const owner = this.players.get(pr.owner);
    if (pr.kind === 'arrow') {
      if (target) {
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        let dmg = Math.ceil(sp * (2 + (pr.power ? 1 : 0)));
        if (pr.crit) dmg += Math.floor(this.rand() * (dmg / 2 + 2));
        this.damage(target, dmg, 'arrow', { by: owner });
        const h = Math.hypot(pr.vx, pr.vz) || 1;
        this.knock(target, -pr.vx / h, -pr.vz / h, [pr.vx / h * pr.punch * 0.6, pr.punch ? 0.1 : 0, pr.vz / h * pr.punch * 0.6]);
        if (owner) this.emit({ type: 'sound', name: 'ding', id: owner.id });
        this.projectiles.delete(pr.id);
      } else {
        pr.x = x; pr.y = y; pr.z = z;
        pr.vx = pr.vy = pr.vz = 0;
        pr.stuck = pr.age;
      }
      return;
    }
    this.projectiles.delete(pr.id);
    if (pr.kind === 'fireball') this.explode(x, y, z, 'fireball', owner);
    else if (pr.kind === 'pearl' && owner?.alive) {
      // Land just in front of what we hit, standing on top if it was a floor.
      let tx = x - pr.vx * 0.1, ty = y, tz = z - pr.vz * 0.1;
      if (block && block.ny === 1) ty = block.y + 1;
      owner.pos = { x: tx, y: ty, z: tz };
      owner.tpSeq++;
      this.emit({ type: 'tp', id: owner.id, x: tx, y: ty, z: tz, seq: owner.tpSeq });
      this.damage(owner, 5, 'pearl', { bypassArmor: true });
    }
  },

  tickTnt(pr) {
    const w = this.world;
    const solid = (x, y, z) => BLOCKS[w.get(Math.floor(x), Math.floor(y), Math.floor(z))].solid;
    pr.vy -= 0.04;
    const ny = pr.y + pr.vy;
    if (pr.vy < 0 && solid(pr.x, ny, pr.z)) { pr.y = Math.floor(ny) + 1; pr.vy = 0; pr.vx *= 0.7; pr.vz *= 0.7; }
    else pr.y = ny;
    if (!solid(pr.x + pr.vx, pr.y + 0.5, pr.z)) pr.x += pr.vx;
    if (!solid(pr.x, pr.y + 0.5, pr.z + pr.vz)) pr.z += pr.vz;
    pr.vx *= 0.98; pr.vz *= 0.98;
    if (--pr.fuse <= 0 || pr.y < VOID_Y) {
      this.projectiles.delete(pr.id);
      if (pr.y >= VOID_Y) this.explode(pr.x, pr.y + 0.5, pr.z, 'tnt', this.players.get(pr.owner));
    }
  },

  // Breaks placed blocks (never map blocks or beds) and launches players.
  explode(x, y, z, kind, owner) {
    const w = this.world;
    const R = kind === 'tnt' ? 4 : 2.6;
    const maxBlast = kind === 'tnt' ? 1 : 0;
    const r = Math.ceil(R);
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      const id = w.get(bx, by, bz);
      if (!id || id === B.BED || !w.isPlaced(bx, by, bz) || BLOCKS[id].blast > maxBlast) continue;
      w.set(bx, by, bz, B.AIR);
      this.emit({ type: 'break', x: bx, y: by, z: bz, id, quiet: true });
    }
    const D = R * 1.6;
    const maxDmg = kind === 'tnt' ? 8 : 5;
    const power = kind === 'tnt' ? 2.2 : 1.8;
    for (const t of this.players.values()) {
      if (!t.alive) continue;
      const px = t.pos.x - x, py = t.pos.y + 0.9 - y, pz = t.pos.z - z;
      const d = Math.hypot(px, py, pz);
      if (d > D) continue;
      const f = 1 - d / D;
      const friendly = owner && t.team === owner.team && t !== owner;
      if (!friendly) this.damage(t, maxDmg * f * (t === owner ? 0.5 : 1), kind, { by: owner && t !== owner ? owner : null });
      const n = d || 1;
      this.push(t, (px / n) * power * f, Math.max(0.35, (py / n) * power * f + 0.35 * f), (pz / n) * power * f);
    }
    this.emit({ type: 'explosion', x, y, z, kind });
  },

  // ------------------------------------------------------------ traps

  buyTrap(p, id) {
    const q = this.traps.get(p.team);
    if (!TRAPS.some((t) => t.id === id)) return 'Unknown trap';
    if (q.length >= MAX_TRAPS) return 'Your trap queue is full!';
    const cost = TRAP_COSTS[q.length];
    if (p.inv.count('coin') < cost) return 'Not enough Coins!';
    p.inv.remove('coin', cost);
    q.push(id);
    this.emit({ type: 'upgrade', team: p.team, id: 'trap', by: p.name, name: TRAPS.find((t) => t.id === id).name });
    return null;
  },

  tickTraps() {
    if (this.time % 5) return;
    for (const base of this.map.bases) {
      const q = this.traps.get(base.team);
      if (!q.length) continue;
      if (this.trapCooldown.get(base.team) > this.time) continue;
      const [cx, cz] = base.center;
      const intruder = [...this.players.values()].find((p) => p.alive && p.team !== base.team && !p.effects.milk
        && Math.hypot(p.pos.x - cx, p.pos.z - cz) < 12 && Math.abs(p.pos.y - base.spawn.y) < 10);
      if (!intruder) continue;
      const trap = q.shift();
      this.trapCooldown.set(base.team, this.time + 30 * TPS);
      if (trap === 'trap') { this.applyEffect(intruder, 'blind', 8 * TPS); this.applyEffect(intruder, 'slow', 8 * TPS); }
      if (trap === 'fatigue') this.applyEffect(intruder, 'fatigue', 10 * TPS);
      if (trap === 'alarm') delete intruder.effects.invis;
      if (trap === 'counter') {
        for (const d of this.players.values()) {
          if (d.alive && d.team === base.team && Math.hypot(d.pos.x - cx, d.pos.z - cz) < 16) {
            this.applyEffect(d, 'speed', 15 * TPS, 1);
            this.applyEffect(d, 'jump', 15 * TPS, 2);
          }
        }
      }
      this.emit({ type: 'trap', team: base.team, trap, intruder: intruder.id, intruderName: intruder.name, intruderTeam: intruder.team });
    }
  },

  // ------------------------------------------------------------ the end

  teamsAlive() {
    const alive = new Set();
    for (const p of this.players.values()) if (!p.eliminated && p.connected) alive.add(p.team);
    return alive;
  },

  checkWin() {
    if (!this.competitive || this.ended) return;
    const alive = this.teamsAlive();
    if (alive.size <= 1) this.endGame(alive.size ? [...alive][0] : -1);
  },

  // Time's up: the team with the most players still in wins, then the most
  // final kills; a perfect tie is a draw.
  endByTime() {
    const score = new Map();
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      const s = score.get(p.team) ?? { alive: 0, finals: 0 };
      if (!p.eliminated) s.alive++;
      s.finals += p.finals;
      score.set(p.team, s);
    }
    const ranked = [...score].filter(([, s]) => s.alive > 0).sort((a, b) => b[1].alive - a[1].alive || b[1].finals - a[1].finals);
    const tie = ranked.length > 1 && ranked[0][1].alive === ranked[1][1].alive && ranked[0][1].finals === ranked[1][1].finals;
    this.endGame(ranked.length && !tie ? ranked[0][0] : -1, 'time');
  },

  endGame(winner, reason = 'last team') {
    if (this.ended) return;
    this.ended = true;
    const stats = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, finals: p.finals, beds: p.bedsBroken }));
    this.emit({ type: 'end', winner, stats, reason });
  },

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.alive = false;
    p.eliminated = true;
    this.emit({ type: 'left', id, name: p.name, team: p.team });
    // A team with nobody left has no bed.
    if (![...this.players.values()].some((o) => o.team === p.team && o.connected)) this.breakBed(p.team, null);
    this.checkWin();
  },
};

export function installCombat(Game) {
  Object.assign(Game.prototype, methods);
}
