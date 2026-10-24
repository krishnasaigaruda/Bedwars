// Game sessions. The host runs the real Game and talks to every client;
// a client sends its movement and actions and mirrors what the host says.
// Practice is just a host with no network.
//
// Client -> host: probe, hello, team, st (movement, 20/s), act, chat
// Host -> client: info, welcome, reject, lobby, start, snap (20/s), me, ev, chat, blk
import { CENTER, LOBBY_Y, MODES, TEAMS } from '../config.js';
import { getItem } from '../game/items.js';
import { Game } from '../game/sim.js';
import { Bot, botName } from '../game/bots.js';

// Events that only matter to the player they're about.
const PRIVATE = new Set(['pickup', 'ate', 'bought', 'kb', 'tp', 'reward', 'deny']);

const countItems = (stacks) => {
  const m = new Map();
  for (const s of stacks) if (s) m.set(`${s.id}|${s.tint ?? ''}`, (m.get(`${s.id}|${s.tint ?? ''}`) ?? 0) + s.count);
  return m;
};
const sameCounts = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export class HostSession {
  // kind: 'offline' (practice) | 'private' | 'public'
  constructor({ peer = null, kind, mode, mapId, name, code = null, bots = false }) {
    this.isHost = true;
    this.kind = kind;
    this.withBots = bots;
    this.bots = [];
    this.peer = peer;
    this.myId = 'host';
    this.mode = MODES[mode] ?? MODES.solo;
    this.links = new Map();
    this.game = null;
    this.onMessage = () => {};
    this.lobby = {
      state: 'waiting', countdown: 0, mode: this.mode.id, mapId, code, kind,
      min: kind === 'public' ? this.mode.size * 2 : 1,
      players: [{ id: this.myId, name, team: -1, host: true }],
    };
    this.lastMe = new Map();
    this.lobbyPos = new Map();
    this.ticks = 0;
    // Practice vs Bots: the bots wait in the lobby with you, one per free slot.
    this.wander = new Map();
    if (bots) {
      for (let n = 0; n < this.maxPlayers - 1; n++) this.lobby.players.push({ id: `bot${n}`, name: botName(n), team: -1, bot: true });
    }
    if (peer) peer.on('connection', (conn) => this.accept(conn));
    if (kind === 'offline') this.startCountdown(10);
  }

  get maxPlayers() { return this.mode.teams * this.mode.size; }
  // Public games wait for at least two full teams (Squads: 8, Trios: 6...).
  get minPlayers() { return this.mode.size * 2; }

  // ------------------------------------------------------------ lobby

  accept(conn) {
    import('./transport.js').then(({ Link }) => {
      const link = new Link(conn);
      link.onData((m) => this.receive(link, m));
      link.onClose(() => this.dropLink(link));
    });
  }

  info() {
    return { t: 'info', state: this.lobby.state, players: this.lobby.players.length, max: this.maxPlayers, mode: this.mode.id };
  }

  receive(link, m) {
    if (m.t === 'probe') { link.send(this.info()); return; }
    if (m.t === 'hello') { this.join(link, m); return; }
    if (!this.links.has(link.id)) return;
    if (m.t === 'team') this.pickTeam(link.id, m.team);
    else if (m.t === 'st') this.clientState(link.id, m);
    else if (m.t === 'act') this.handleAction(link.id, m);
    else if (m.t === 'chat') this.chat(link.id, m.text);
  }

  join(link, m) {
    if (this.lobby.state === 'playing') { link.send({ t: 'reject', reason: 'That game has already started.' }); link.close(); return; }
    if (this.lobby.players.length >= this.maxPlayers) { link.send({ t: 'reject', reason: 'That room is full.' }); link.close(); return; }
    const name = String(m.name || 'Player').replace(/[^\w\- ]/g, '').slice(0, 16) || 'Player';
    this.links.set(link.id, link);
    this.lobby.players.push({ id: link.id, name, team: -1 });
    link.send({ t: 'welcome', id: link.id, lobby: this.lobby });
    this.systemChat(`${name} joined the game (${this.lobby.players.length}/${this.maxPlayers})`);
    this.lobbyChanged();
  }

  dropLink(link) {
    if (!this.links.has(link.id)) return;
    this.links.delete(link.id);
    const p = this.lobby.players.find((x) => x.id === link.id);
    this.lobby.players = this.lobby.players.filter((x) => x.id !== link.id);
    if (p) this.systemChat(`${p.name} left the game`);
    if (this.game) this.game.removePlayer(link.id);
    else this.lobbyChanged();
  }

  pickTeam(id, team) {
    if (this.lobby.state === 'playing') return;
    const p = this.lobby.players.find((x) => x.id === id);
    if (!p) return;
    if (team >= 0 && (team >= this.mode.teams || this.lobby.players.filter((x) => x.team === team && x !== p).length >= this.mode.size)) return;
    p.team = team;
    this.lobbyChanged();
  }

  lobbyChanged() {
    // Public rooms count down by themselves once there are enough players.
    this.lobby.min = this.kind === 'public' ? this.minPlayers : 1;
    if (this.kind === 'public' && this.lobby.state !== 'playing') {
      const n = this.lobby.players.length;
      if (n >= this.minPlayers && this.lobby.state === 'waiting') this.startCountdown(20);
      else if (n < this.minPlayers && this.lobby.state === 'countdown') this.lobby.state = 'waiting';
      if (n >= this.maxPlayers && this.lobby.countdown > 10) this.lobby.countdown = 10;
    }
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.onMessage({ t: 'lobby', lobby: this.lobby });
  }

  startCountdown(sec) {
    if (this.lobby.state === 'playing') return;
    this.lobby.state = 'countdown';
    this.lobby.countdown = sec;
    this.lobbyChanged();
  }

  // Host pressed start (private rooms and practice).
  requestStart() {
    if (this.lobby.state === 'playing') return;
    if (this.lobby.state === 'countdown') this.lobby.countdown = Math.min(this.lobby.countdown, 1);
    else this.startCountdown(this.kind === 'offline' ? 0.01 : 5);
  }

  assignTeams() {
    const size = this.mode.size;
    const counts = new Array(this.mode.teams).fill(0);
    for (const p of this.lobby.players) if (p.team >= 0) counts[p.team]++;
    for (const p of this.lobby.players) {
      if (p.team >= 0 && counts[p.team] <= size) continue;
      if (p.team >= 0) counts[p.team]--;
      let best = 0;
      for (let t = 1; t < counts.length; t++) if (counts[t] < counts[best]) best = t;
      p.team = best;
      counts[best]++;
    }
  }

  // After a game: everyone back to the waiting lobby on a fresh map.
  newRound(mapId) {
    if (this.lobby.state !== 'playing') return;
    this.game = null;
    this.bots = [];
    this.lastMe.clear();
    this.lobbyPos.clear();
    this.wander.clear();
    this.lobby.state = 'waiting';
    this.lobby.countdown = 0;
    this.lobby.mapId = mapId;
    this.lobby.round = (this.lobby.round ?? 1) + 1;
    if (this.kind === 'public') for (const p of this.lobby.players) p.team = -1;
    const msg = { t: 'round', lobby: this.lobby };
    this.broadcast(msg);
    this.onMessage(msg);
    if (this.kind === 'offline') this.startCountdown(10);
    else this.lobbyChanged();
  }

  // Called by main once the world for this map exists.
  createGame(world, map) {
    const game = new Game({ world, map });
    for (const p of this.lobby.players) {
      const gp = game.addPlayer({ id: p.id, name: p.name, team: p.team });
      const s = map.bases[p.team].spawn;
      gp.pos = { x: s.x, y: s.y, z: s.z };
    }
    this.bots = [];
    for (const p of this.lobby.players) if (p.bot) this.bots.push(new Bot(game, game.players.get(p.id)));
    const used = new Set([...game.players.values()].map((p) => p.team));
    game.competitive = (this.kind !== 'offline' || this.withBots) && used.size >= 2;
    // Teams nobody plays on have no bed, in every mode (practice too).
    for (const base of map.bases) if (!used.has(base.team)) game.breakBed(base.team, null);
    game.takeEvents();
    this.game = game;
    return game;
  }

  // ------------------------------------------------------------ per tick

  // Bots stroll around the lobby plaza while everyone waits.
  wanderBots() {
    const cx = CENTER.x + 0.5, cz = CENTER.z + 0.5, y = LOBBY_Y + 1;
    for (const p of this.lobby.players) {
      if (!p.bot) continue;
      let w = this.wander.get(p.id);
      const spot = () => { const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 4; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
      if (!w) { const [x, z] = spot(); w = { x, z, tx: x, tz: z, wait: Math.floor(Math.random() * 60), yaw: 0 }; this.wander.set(p.id, w); }
      const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
      if (d < 0.2) {
        if (--w.wait <= 0) { [w.tx, w.tz] = spot(); w.wait = 40 + Math.floor(Math.random() * 120); }
      } else {
        const step = Math.min(d, 0.2);
        w.x += (dx / d) * step; w.z += (dz / d) * step;
        w.yaw = Math.atan2(-dx, -dz);
      }
      this.lobbyPos.set(p.id, { p: [w.x, y, w.z], yaw: w.yaw, pitch: 0, fl: 0 });
    }
  }

  tick(dt) {
    this.ticks++;
    if (!this.game && this.withBots) this.wanderBots();
    if (!this.game && this.links.size && this.ticks % 2 === 0) this.broadcast({ t: 'lsnap', pl: this.lobbyView() });
    if (this.lobby.state === 'countdown') {
      const before = Math.ceil(this.lobby.countdown);
      this.lobby.countdown -= dt;
      if (this.lobby.countdown <= 0) {
        this.lobby.state = 'playing';
        this.assignTeams();
        const msg = { t: 'start', lobby: this.lobby };
        this.broadcast(msg);
        this.onMessage(msg);
        return;
      }
      if (Math.ceil(this.lobby.countdown) !== before) this.lobbyChanged();
    }
    if (!this.game) return;
    for (const bot of this.bots) bot.tick();
    this.game.step();
    for (const e of this.game.takeEvents()) {
      if (e.type === 'kb') this.bots.find((b) => b.p.id === e.id)?.knock(e);
      this.onMessage({ t: 'ev', e });
      if (PRIVATE.has(e.type) || (e.type === 'sound' && e.id)) this.links.get(e.id)?.send({ t: 'ev', e });
      else this.broadcast({ t: 'ev', e });
    }
    if (this.links.size) this.sendSnapshots();
  }

  snapshot() {
    const g = this.game;
    const pl = [];
    for (const p of g.players.values()) {
      if (!p.connected) continue;
      const heldStack = p.inv.held();
      pl.push([p.id, +p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3), +p.yaw.toFixed(3), +p.pitch.toFixed(3),
        (p.sneak ? 1 : 0) | (p.sprint ? 2 : 0) | (p.alive ? 4 : 0) | (p.effects.invis ? 8 : 0) | (p.eliminated ? 16 : 0) | (p.flying ? 32 : 0),
        heldStack?.id ?? null, heldStack?.tint ?? null, p.inv.armor.map((a) => a?.id ?? '').join('|'), p.swing]);
    }
    const dr = [...g.drops.values()].map((d) => [d.id, d.item, d.count, +d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2), d.tint ?? null]);
    const pr = [...g.projectiles.values()].map((q) => [q.id, q.kind, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +q.vx.toFixed(2), +q.vy.toFixed(2), +q.vz.toFixed(2), q.fuse ?? 0]);
    const gens = g.gens.filter((x) => x.kind === 'gold' || x.kind === 'diamond').map((x) => [x.tier, x.timer]);
    const beds = [...g.beds].filter(([, v]) => v).map(([k]) => k);
    return { t: 'snap', time: g.time, pl, dr, pr, gens, beds };
  }

  sendSnapshots() {
    const snap = this.snapshot();
    for (const [id, link] of this.links) {
      link.send(snap);
      const p = this.game.players.get(id);
      if (!p) continue;
      const me = this.meMessage(p);
      const key = JSON.stringify(me);
      if (this.lastMe.get(id) !== key) { this.lastMe.set(id, key); link.send(me); }
    }
  }

  meMessage(p) {
    const g = this.game;
    return {
      t: 'me',
      inv: { slots: p.inv.slots, armor: p.inv.armor },
      hp: Math.round(p.hp * 10) / 10, ab: Math.round(p.absorption * 10) / 10, food: p.food,
      alive: p.alive, resp: p.alive ? 0 : Math.ceil(p.respawnIn / 20), elim: p.eliminated,
      regen: p.regenTicks > 2 ? Math.ceil(p.regenTicks / 20) : 0, absT: Math.ceil(p.absorbTicks / 20),
      fx: Object.fromEntries(Object.entries(p.effects).map(([k, v]) => [k, { ticks: Math.ceil(v.ticks / 20) * 20, level: v.level }])),
      ups: g.upgrades.get(p.team), traps: g.traps.get(p.team),
      tiers: [p.armorTier, p.pickTier, p.axeTier, p.shears ? 1 : 0],
      score: [p.kills, p.finals, p.bedsBroken],
      chest: g.teamChests.get(p.team), ender: p.ender,
    };
  }

  // ------------------------------------------------------------ input from players

  clientState(id, m) {
    const p = this.game?.players.get(id);
    if (!p) { this.lobbyPos?.set(id, m); return; }
    if (!p.alive) return;
    if ((m.tq ?? 0) !== p.tpSeq) return;   // sent before they saw their latest teleport
    p.pos = { x: m.p[0], y: m.p[1], z: m.p[2] };
    p.yaw = m.yaw; p.pitch = m.pitch;
    p.sneak = !!(m.fl & 1); p.sprint = !!(m.fl & 2); p.flying = !!(m.fl & 4);
    p.swing = m.sw ?? p.swing;
    if (m.exh) this.game.addExhaustion(p, Math.min(2, m.exh));
    if (m.fall > 3) this.game.damage(p, Math.ceil(m.fall - 3), 'fall', { bypassArmor: true });
  }

  // Runs one action for a player; returns null or the reason it failed.
  handleAction(id, m) {
    const g = this.game;
    const p = g?.players.get(id);
    if (!p) return 'not playing';
    let why = null;
    switch (m.a) {
      case 'place': why = g.place(p, m.x, m.y, m.z, m.slot, m.id); break;
      case 'break': why = g.breakBlock(p, m.x, m.y, m.z); break;
      case 'buy': why = g.buy(p, m.key); break;
      case 'upg': why = g.buyUpgrade(p, m.key); break;
      case 'trap': why = g.buyTrap(p, m.key); break;
      case 'drop': g.dropFromSlot(p, m.slot, m.all, m.eye, m.dir); break;
      case 'eat': g.eat(p, m.slot); break;
      case 'attack': g.attack(p, m.target, m.crit); break;
      case 'shoot': g.shoot(p, m.slot, m.charge, m.eye, m.dir); break;
      case 'use': why = g.useItem(p, m.slot, m.eye, m.dir); if (why === 'nothing') why = null; break;
      case 'deploy': why = g.deploy(p, m.slot, m.x, m.y, m.z, m.fx, m.fz); if (why === 'nothing') why = null; break;
      case 'select': p.inv.selected = Math.max(0, Math.min(8, m.slot | 0)); break;
      case 'inv': why = this.rearrange(p, m); break;
      default: why = 'unknown action';
    }
    if (why && id !== this.myId && why !== 'occupied') this.links.get(id)?.send({ t: 'ev', e: { type: 'deny', id, why, a: m.a } });
    // Undo a client's guess if the host said no.
    if (why && id !== this.myId && (m.a === 'place' || m.a === 'break')) {
      this.links.get(id)?.send({ t: 'blk', x: m.x, y: m.y, z: m.z, id: g.world.get(m.x, m.y, m.z), placed: g.world.isPlaced(m.x, m.y, m.z) });
      this.lastMe.delete(id);
    }
    return why;
  }

  // Inventory moves from a client's inventory screen. Accepted only if the
  // items add up (plus whatever they threw out or hold on the cursor).
  rearrange(p, m) {
    const box = m.cont ? this.game.container(p, m.cont.kind) : null;
    if (m.cont && (!box || m.cont.slots.length !== box.length)) { this.lastMe.delete(p.id); return 'Too far from the chest'; }
    const before = countItems([...p.inv.slots, ...p.inv.armor, p.cursor, ...(box ?? [])]);
    const after = countItems([...m.slots, ...m.armor, m.cursor, m.thrown, ...(m.cont?.slots ?? [])]);
    if (!sameCounts(before, after) || m.slots.length !== 36 || m.armor.length !== 4) { this.lastMe.delete(p.id); return 'out of sync'; }
    for (const s of [...m.slots, ...m.armor, ...(m.cont?.slots ?? [])]) if (s && !getItem(s.id)) return 'bad item';
    if (box) for (let i = 0; i < box.length; i++) box[i] = m.cont.slots[i] ? { ...m.cont.slots[i] } : null;
    p.inv.slots = m.slots.map((s) => (s ? { ...s } : null));
    p.inv.armor = m.armor.map((s) => (s ? { ...s } : null));
    p.cursor = m.cursor ? { ...m.cursor } : null;
    p.inv.touch();
    if (m.thrown) {
      const eye = { x: p.pos.x, y: p.pos.y + 1.62, z: p.pos.z };
      const dir = [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
      this.game.spawnDrop(m.thrown.id, m.thrown.count, eye.x, eye.y - 0.3, eye.z, { vx: dir[0] * 0.3, vy: dir[1] * 0.3 + 0.1, vz: dir[2] * 0.3, pickup: 40, tint: m.thrown.tint });
    }
    return null;
  }

  chat(id, text) {
    const p = this.lobby.players.find((x) => x.id === id);
    if (!p) return;
    const clean = String(text).slice(0, 120);
    if (!clean.trim()) return;
    const team = this.game?.players.get(id)?.team ?? p.team;
    const msg = { t: 'chat', id, name: p.name, team, text: clean };
    this.broadcast(msg);
    this.onMessage(msg);
  }

  systemChat(text) {
    const msg = { t: 'chat', system: true, text };
    this.broadcast(msg);
    this.onMessage(msg);
  }

  broadcast(msg) { for (const l of this.links.values()) l.send(msg); }

  // ------------------------------------------------------------ the local player (host)

  // In the lobby the host's position is shared like everyone else's; in game
  // main writes it straight into the Game.
  sendState(st) { if (!this.game) this.lobbyPos.set(this.myId, st); }

  lobbyView() {
    const out = [];
    for (const [id, m] of this.lobbyPos) {
      if (!this.lobby.players.some((p) => p.id === id)) { this.lobbyPos.delete(id); continue; }
      out.push([id, m.p[0], m.p[1], m.p[2], m.yaw, m.pitch, m.fl]);
    }
    return out;
  }
  action(a, data) { return this.handleAction(this.myId, { a, ...data }); }
  sendChat(text) { this.chat(this.myId, text); }
  setTeam(team) { this.pickTeam(this.myId, team); }

  leave() {
    for (const l of this.links.values()) l.close();
    this.links.clear();
    this.peer?.destroy();
  }
}

export class ClientSession {
  constructor({ peer, link, name }) {
    this.isHost = false;
    this.kind = 'client';
    this.peer = peer;
    this.link = link;
    this.name = name;
    this.myId = peer.id;
    this.lobby = null;
    this.onMessage = () => {};
    this.queue = [];
    link.onData((m) => {
      if (m.t === 'lobby' || m.t === 'welcome') this.lobby = m.lobby;
      if (m.t === 'start' || m.t === 'round') this.lobby = m.lobby;
      this.onMessage(m);
    });
    link.onClose(() => this.onMessage({ t: 'closed' }));
  }

  // Resolves with the lobby, or rejects with the host's reason.
  hello() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The host didn’t answer.')), 8000);
      const prev = this.onMessage;
      this.onMessage = (m) => {
        if (m.t === 'welcome') { clearTimeout(t); this.myId = m.id; this.onMessage = prev; resolve(m.lobby); }
        else if (m.t === 'reject') { clearTimeout(t); this.onMessage = prev; reject(new Error(m.reason)); }
      };
      this.link.send({ t: 'hello', name: this.name });
    });
  }

  get mode() { return MODES[this.lobby?.mode] ?? MODES.solo; }
  tick() {}
  sendState(st) { this.link.send({ t: 'st', ...st }); }
  action(a, data) { this.link.send({ t: 'act', a, ...data }); return null; }
  sendChat(text) { this.link.send({ t: 'chat', text }); }
  setTeam(team) { this.link.send({ t: 'team', team }); }
  requestStart() {}
  leave() { this.link.close(); this.peer?.destroy(); }
}

export { TEAMS };
