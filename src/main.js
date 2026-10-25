// Boot, screens and the main loop. Movement and game logic run at a fixed
// 20 ticks per second like Minecraft; rendering interpolates between ticks.
// Every game (practice, private room, quick play) goes through a session:
// the host runs the real Game, clients mirror it into a "shadow" Game.
import * as THREE from 'three';
import { CENTER, LOBBY_Y, MODES, PHYS, TEAMS } from './config.js';
import { play, setMusic, setMusicVolume, setVolume, unlockAudio } from './audio.js';
import { Inventory } from './game/inventory.js';
import { getItem } from './game/items.js';
import { BREAK_DELAY, EAT_TICKS, REACH_BLOCK, REACH_ENTITY, SWING_TICKS, TPS, breakTicks, fallDamage } from './game/rules.js';
import { Game, TIMELINE } from './game/sim.js';
import { HostSession, ClientSession } from './net/session.js';
import { IS_WINDOWS, Input } from './player/controls.js';
import { Body } from './player/physics.js';
import { DropRenderer } from './render/drops.js';
import { BlockCursor, Particles } from './render/effects.js';
import { FP, FirstPerson } from './render/firstperson.js';
import {
  PlayerModel, faceIcon, createBedModel, createForgeGlow, createGeneratorModel, createLobbyCrystal, createNPC, makeLabel,
} from './render/models.js';
import { ProjectileRenderer } from './render/projectiles.js';
import { RemotePlayers } from './render/remote.js';
import { Renderer } from './render/renderer.js';
import { HUD, MIC_ICON, MUTED_ICON, iconURL } from './ui/hud.js';
import { InventoryUI } from './ui/inventoryui.js';
import { LobbyUI } from './ui/lobbyui.js';
import { Menu, loadSettings, saveSettings } from './ui/menus.js';
import { ShopUI } from './ui/shopui.js';
import { B, BLOCKS, isLadder } from './world/blocks.js';
import { MAPS, generateMap } from './world/mapgen.js';
import { World } from './world/world.js';

const TICK = 1 / TPS;
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const hud = new HUD(document.getElementById('hud'));
const settings = loadSettings();
setVolume(settings.volume);
setMusicVolume(settings.music ?? 0.5);
applyInputSettings(settings);

const particles = new Particles(renderer.scene, null);
const cursor = new BlockCursor(renderer.scene);
const dropsView = new DropRenderer(renderer.scene);
const projView = new ProjectileRenderer(renderer.scene, particles);
const remote = new RemotePlayers(renderer.scene);
const firstPerson = new FirstPerson(renderer.handScene);
const decor = new THREE.Group();
renderer.scene.add(decor);

const state = {
  screen: 'menu',     // 'menu' | 'game'
  phase: 'lobby',     // 'lobby' | 'playing' | 'ended'
  ui: null,           // null | 'inventory' | 'shop' | 'teams' | 'chat' | 'pause'
  session: null,
  lobby: null,
  lobbyPeers: [],
  voiceInfo: null,    // { members: [[id, muted]], talking: [id] } from the host
  world: null, map: null, mapKey: '',
  game: null, me: null,
  lobbyInv: new Inventory(),
  beds: new Map(), npcs: [], genModels: [], animated: [],
  t: 0, orbit: 0, acc: 0,
};

const local = {
  body: new Body(),
  yaw: 0, pitch: 0,
  cam: 0,                        // 0 first person, 1 behind, 2 in front
  eye: PHYS.eye,
  swingInt: 0, swinging: false, swingCount: 0,
  breaking: null, breakDelay: 0,
  placeDelay: 0,
  eating: -1, bow: -1,
  sprintTap: false,
  walked: 0, prevWalked: 0, bob: 0, prevBob: 0, tilt: 0, prevTilt: 0,
  fovMod: 1, prevFovMod: 1,
  hurtTime: 0,
  exh: 0, fall: 0, tpSeq: 0,
  sq: 0, exhOut: 0, bodyN: 0,      // position update number; hunger not yet sent to the host
  rightPending: false, rightDownAt: 0, mining: false,   // right click: a tap places, a hold breaks
  leftPending: false, leftDownAt: 0,                    // left click with blocks in hand: the same
  model: null,
  target: null, ghost: null, npc: null, aimPlayer: null,
  predicted: new Set(),
  hudVisible: true,
};

const isHost = () => state.session?.isHost;
const myId = () => state.session?.myId;

// ------------------------------------------------------------------ map

function pickMap() {
  if (settings.map && settings.map !== 'random' && MAPS.some((m) => m.id === settings.map)) return settings.map;
  return MAPS[Math.floor(Math.random() * MAPS.length)].id;
}

function loadMap(mapId, teamCount, force = false) {
  const key = `${mapId}|${teamCount}`;
  if (!force && state.mapKey === key) return;
  const world = new World();
  const map = generateMap(world, teamCount, mapId);
  state.world = world;
  state.map = map;
  state.mapKey = key;
  particles.world = world;
  renderer.setWorld(world);
  dropsView.clear();
  projView.clear();
  buildDecor();
}

function buildDecor() {
  decor.clear();
  state.animated = [];
  state.beds.clear();
  state.npcs = [];
  state.genModels = [];
  const add = (obj, x, y, z, yaw = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    decor.add(obj);
    if (obj.userData.update) state.animated.push(obj);
    return obj;
  };
  const { map } = state;
  for (const base of map.bases) {
    const { head, foot, dir } = base.bed;
    const bed = add(createBedModel(base.team),
      (head[0] + foot[0]) / 2 + 0.5, head[1], (head[2] + foot[2]) / 2 + 0.5, Math.atan2(dir[0], dir[1]));
    state.beds.set(base.team, bed);
    for (const kind of ['shop', 'upgrades']) {
      const s = base[kind];
      const npc = add(createNPC(kind), s.x, s.y, s.z, s.yaw);
      state.npcs.push({ obj: npc, kind, team: base.team, x: s.x, y: s.y, z: s.z });
    }
    add(createForgeGlow(), base.forge.x, base.forge.y, base.forge.z);
  }
  map.goldGens.forEach((g) => state.genModels.push({ kind: 'gold', obj: add(createGeneratorModel('gold'), g.x, g.y, g.z) }));
  map.diamondGens.forEach((g) => state.genModels.push({ kind: 'diamond', obj: add(createGeneratorModel('diamond'), g.x, g.y, g.z) }));
  const c = map.lobby.crystal;
  state.lobbyDecor = [add(createLobbyCrystal(), c.x, c.y, c.z)];
  const sign = makeLabel([
    { text: 'BLOCKWARS', color: '#ffd23f', size: 96 },
    { text: map.name ?? 'Protect your bed. Break theirs.', color: '#ffffff', size: 40, weight: 700 },
  ], { background: null, scale: 2.6 });
  sign.sprite.position.set(c.x, c.y + 7, c.z);
  decor.add(sign.sprite);
  state.lobbyDecor.push(sign.sprite);
}

// The waiting lobby floats above the middle; like Hypixel, it's removed when
// the match starts (everyone does this locally, the map is the same for all).
function removeLobby() {
  const w = state.world;
  const c = state.map.lobby.crystal;
  const R = 26;
  for (let y = LOBBY_Y - 16; y < w.sy; y++) for (let z = Math.floor(c.z) - R; z <= Math.floor(c.z) + R; z++) for (let x = Math.floor(c.x) - R; x <= Math.floor(c.x) + R; x++) {
    if (!w.inBounds(x, y, z)) continue;
    const i = w.idx(x, y, z);
    if (!w.data[i]) continue;
    w.data[i] = 0;
    w.dirty.add(w.chunkKey(x >> 4, y >> 4, z >> 4));
  }
  for (const o of state.lobbyDecor ?? []) decor.remove(o);
  state.animated = state.animated.filter((o) => !(state.lobbyDecor ?? []).includes(o));
  state.lobbyDecor = [];
}

function removeBedModel(team, burst) {
  const bed = state.beds.get(team);
  if (!bed) return;
  if (burst) {
    const col = new THREE.Color(TEAMS[team].hex);
    particles.burst(bed.position.x, bed.position.y + 0.8, bed.position.z, [col.r * 255, col.g * 255, col.b * 255], 60, { spread: 0.8, speed: 7 });
  }
  decor.remove(bed);
  state.animated = state.animated.filter((o) => o !== bed);
  state.beds.delete(team);
}

// --------------------------------------------------------------- flow

function currentInv() { return state.me ? state.me.inv : state.lobbyInv; }

function teleport(p, yaw) {
  local.body.teleport(p.x, p.y, p.z);
  if (yaw !== null) local.yaw = yaw ?? p.yaw ?? 0;
  if (yaw !== null) local.pitch = 0;
  local.breaking = null;
}

function setLocalModel(team) {
  if (local.model) renderer.scene.remove(local.model.root);
  local.model = new PlayerModel({ team, name: settings.name, showName: false, look: settings.look });
  renderer.scene.add(local.model.root);
  firstPerson.setPlayer(team, settings.name, settings.look);
}

// Fresh map, everyone floating in the waiting lobby (first join and every new round).
function resetToLobby() {
  clearTimeout(roundTimer);
  const mode = MODES[state.lobby.mode] ?? MODES.solo;
  loadMap(state.lobby.mapId, mode.teams, true);
  state.screen = 'game';
  state.phase = 'lobby';
  invUI.hide(); shopUI.hide(); lobbyUI.hide();
  state.ui = hud.touchCheckShown ? 'touch' : hud.voiceAskShown ? 'voice' : null;
  reviewTouch();
  state.game = null;
  state.me = null;
  state.lobbyPeers = [];
  state.lobbyInv = new Inventory();
  state.acc = 0;
  remote.clear();
  hud.setEnd(null);
  hud.setDeath(null);
  hud.setBlind(false);
  hud.setPaused(false);
  setLocalModel(5);
  teleport(state.map.lobby);
  local.body.canFly = true;
  local.body.flying = false;
  local.cam = 0;
  if (isHost()) state.session.setWorld(state.world);
  // Every game starts with a reminder of how building works.
  hud.showTip(`<img src="${iconURL('block:24')}"><span><b>LEFT CLICK</b> places blocks (a quick click) · <b>hold</b> the click to break · right click works too</span>`, 12);
  hud.chat('<span class="system">Placing blocks: <b>left click</b> (a quick click). Hold the click to break blocks.</span>');
}

let roundTimer = null;

function enterGame(session) {
  state.session = session;
  session.onMessage = onNet;
  state.lobby = session.lobby;
  resetToLobby();
  menu.hide();
  document.getElementById('hud').classList.remove('hidden');
  const kind = session.kind;
  if (kind === 'offline') hud.chat(`<span class="system">${session.withBots ? 'Practice vs Bots: every other team is bots. ' : 'Solo practice. '}Press <b>Enter</b> to start now.</span>`);
  if (kind === 'private') hud.chat(`<span class="system">Your room code is <b>${state.lobby.code}</b>. Share it! Press <b>E</b> to pick teams, <b>Enter</b> to start.</span>`);
  if (kind === 'public') hud.chat(`<span class="system">Public game: it starts when <b>${session.minPlayers}</b> players are here. <b>E</b> picks a team.</span>`);
  if (kind === 'client') hud.chat('<span class="system">Joined! Press <b>E</b> to pick a team, <b>T</b> to chat.</span>');
  unlockAudio();
  if (IS_WINDOWS && !touchOk() && !settings.toggleMove) checkTouchpad(() => startPlaying(session));
  else startPlaying(session);
  if (isHost() && kind !== 'offline') stopBackground = startBackgroundTicks();
}

// ------------------------------------------------------------- click monitor

// Settings → "Show my clicks": every click the game receives, which keys were
// down, how long after the last key press, and what the click did. A tap that
// never shows up here was dropped before it reached the browser.
const clickLog = [];
let lastKeyPress = -1e9;
window.addEventListener('keydown', (e) => { if (!e.repeat) lastKeyPress = performance.now(); }, true);
const ok = (text) => ({ ok: true, text });
const no = (text) => ({ ok: false, text });
const shortKey = (c) => c.replace(/^Key|^Digit/, '').replace(/(Left|Right)$/, '');

function logClick(button, result) {
  if (!settings.clickMonitor) return;
  const keys = [...input.keys].map(shortKey).join('+') || 'none';
  const since = Math.round(performance.now() - lastKeyPress);
  logNote(result, `${button} click · keys held: ${keys} · ${since < 5000 ? `${since} ms after a key press` : 'no key pressed lately'}`);
}

function logNote(result, text = '') {
  if (!settings.clickMonitor) return;
  clickLog.push({ t: performance.now(), text, result });
  if (clickLog.length > 8) clickLog.shift();
}

function clickMonitor() {
  const now = performance.now();
  const rows = clickLog.map((c) => `${((now - c.t) / 1000).toFixed(1)}s ago  ${esc(c.text)}${c.text ? ' → ' : ''}<span class="${c.result.ok ? 'ok' : 'no'}">${esc(c.result.text)}</span>`);
  return `<b>CLICKS THE GAME RECEIVED</b>  (keys held now: ${[...input.keys].map(shortKey).join(' + ') || 'none'})\n${rows.join('\n') || 'None yet. Tap or click while playing.'}`;
}

// Toggle movement (Settings): W A S D, Shift and Ctrl switch on and off
// instead of being held. Windows blocks touchpad taps while a key is held,
// so with nothing held you can tap to build while you keep moving.
const toggles = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, sneak: false, sprint: false };
const OPPOSITE = { KeyW: 'KeyS', KeyS: 'KeyW', KeyA: 'KeyD', KeyD: 'KeyA' };

function clearToggles() { for (const k in toggles) toggles[k] = false; }

function toggleKey(code) {
  if (OPPOSITE[code]) {
    if (code === 'KeyW' && input.doubles.has('KeyW')) { toggles.KeyW = true; toggles.sprint = true; }   // double-tap W: run
    else {
      toggles[code] = !toggles[code];
      if (toggles[code]) toggles[OPPOSITE[code]] = false;
    }
    if (!toggles.KeyW) toggles.sprint = false;
  } else if (code === 'ShiftLeft' || code === 'ShiftRight') toggles.sneak = !toggles.sneak;
  else if (code === 'ControlLeft' || code === 'ControlRight') toggles.sprint = !toggles.sprint;
  else return false;
  const now = [];
  if (toggles.KeyW) now.push(toggles.sprint ? 'Running' : 'Walking');
  if (toggles.KeyS) now.push('Walking back');
  if (toggles.KeyA) now.push('Going left');
  if (toggles.KeyD) now.push('Going right');
  if (toggles.sneak) now.push('Sneaking');
  hud.showAction(now.length ? `${now.join(' · ')} (tap again to stop)` : 'Stopped', 1.5);
  return true;
}

// Right click: a click shorter than this places or uses; holding longer breaks.
const TAP_MS = 180;

function rightTap() { useTap('Right'); }

// Left click places too (handy on a touchpad, where a right click is a
// two-finger tap that Windows drops while you move). It never opens chests.
function leftTap() {
  if (!local.ghost || chestAt(local.target)) {
    swing();
    logClick('Left', no('no spot to place: aim at the side or top of a block'));
    return;
  }
  useTap('Left');
}

function useTap(button) {
  if (local.placeDelay > 0) { logClick(button, no('too soon after the last block')); return; }
  const held = getItem(currentInv().heldId());
  const res = useItem(true);
  local.placeDelay = 1;
  logClick(button, res === true ? ok('placed a block') : res === false ? no('no spot to place: aim at the side or top of a block') : ok(held ? `used ${held.name}` : 'nothing in your hand'));
}

function startPlaying(session) {
  if (state.session !== session || state.screen !== 'game') return;
  if (session.voice) askVoice();
  else input.lock();
}

// ------------------------------------------------------------- Windows touchpads

// Windows throws away touchpad taps while a key is held (so you can't build
// while moving) unless Touchpad sensitivity is "Most sensitive". The game
// can't read that setting, so it checks what actually gets through: a click
// while a key is held proves it's on. Once proven it's remembered; if a whole
// game later has plenty of clicks but none while moving, it asks again.
const TOUCH_OK = 'blockwars-touchpad-ok';
const touchStats = { clicks: 0, moving: 0 };

function touchOk() {
  try { return localStorage.getItem(TOUCH_OK) === '1'; } catch { return true; }
}
function setTouchOk(ok) {
  try { if (ok) localStorage.setItem(TOUCH_OK, '1'); else localStorage.removeItem(TOUCH_OK); } catch { /* storage blocked */ }
}

canvas.addEventListener('mousedown', () => {
  if (!IS_WINDOWS || !input.locked || state.ui) return;
  touchStats.clicks++;
  if (input.keys.size) { touchStats.moving++; setTouchOk(true); }
});

// After a game: lots of clicks, never one while moving, means taps are blocked again.
function reviewTouch() {
  if (IS_WINDOWS && !settings.toggleMove && touchStats.clicks >= 15 && touchStats.moving === 0) setTouchOk(false);
  touchStats.clicks = touchStats.moving = 0;
}

let stopTouchCheck = null;
function checkTouchpad(done) {
  state.ui = 'touch';
  input.unlock();
  hud.setTouchCheck(true);
  const card = hud.touchCheck;
  const pad = card.querySelector('[data-pad]');
  const status = card.querySelector('[data-status]');
  const say = (html, cls = '') => { status.innerHTML = html; status.className = `touch-status ${cls}`; };
  const idle = () => { pad.className = 'touch-pad'; pad.innerHTML = 'Hold <b>W</b> and tap here'; };
  const held = new Map();   // key -> when it went down
  let passed = false;
  idle();
  say('Already set up, or using a mouse? Just hold W and tap.');

  const keyDown = (e) => {
    if (passed || e.code === 'Escape' || e.code === 'Tab' || held.has(e.code)) return;
    held.set(e.code, performance.now());
    pad.className = 'touch-pad holding';
    pad.innerHTML = 'Now <b>tap</b>!';
  };
  const keyUp = (e) => { held.delete(e.code); if (!held.size && !passed) idle(); };
  const blur = () => { held.clear(); if (!passed) idle(); };
  const tap = (e) => {
    e.preventDefault();
    if (passed) return;
    if (!held.size) { say('Keep holding <b>W</b> while you tap.', 'warn'); return; }
    passed = true;
    setTouchOk(true);
    pad.className = 'touch-pad ok';
    pad.innerHTML = '✔ It works!';
    say('Taps get through while you move. Have fun!', 'good');
    play('ding');
    setTimeout(() => { stop(); done(); }, 900);
  };
  // Holding a key with nothing getting through: Windows is still eating the taps.
  const timer = setInterval(() => {
    const since = Math.max(0, ...[...held.values()].map((t) => performance.now() - t));
    if (!passed && since > 3000) say('Tapping but nothing happens? Windows is still blocking taps: change the setting above, then try again.', 'warn');
  }, 250);
  const onClick = (e) => {
    if (e.target.closest('[data-leave]')) leaveToMenu();
    if (e.target.closest('[data-toggle]')) {
      settings.toggleMove = true;
      saveSettings(settings);
      play('click');
      hud.chat('<span class="system">Toggle movement is on: tap <b>W</b> to start walking and tap it again to stop (same for A, S, D and Shift). Turn it off in Settings.</span>');
      stop();
      done();
    }
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  pad.addEventListener('mousedown', tap);
  card.addEventListener('click', onClick);
  const stop = () => {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', blur);
    pad.removeEventListener('mousedown', tap);
    card.removeEventListener('click', onClick);
    clearInterval(timer);
    hud.setTouchCheck(false);
    if (state.ui === 'touch') state.ui = null;
    stopTouchCheck = null;
  };
  stopTouchCheck = stop;
}

// ------------------------------------------------------------- voice chat

// Every online game asks once whether you want to join the voice chat.
function askVoice() {
  state.ui = 'voice';
  input.unlock();
  hud.setVoiceAsk(true);
}

hud.voiceAsk.addEventListener('click', (e) => {
  const choice = e.target.closest('[data-voice]')?.dataset.voice;
  if (!choice) return;
  hud.setVoiceAsk(false);
  state.ui = null;
  play('click');
  if (choice === 'yes') joinVoice();
  else {
    input.lock();
    hud.chat('<span class="system">No voice chat. You can join any time from the <b>Esc</b> menu.</span>');
  }
});

async function joinVoice() {
  const session = state.session;
  const v = session?.voice;
  if (!v || v.joined) return;
  const { why } = await v.join();
  if (state.session !== session) { v.close(); return; }
  v.setVolume(settings.voiceVolume);
  const note = {
    blocked: 'Your microphone is blocked, so you can only listen. Allow it from the icon in the address bar, then leave and join voice chat again.',
    nomic: 'No microphone found, so you can only listen.',
    insecure: 'Talking needs a secure (https) page, so you can only listen here.',
    failed: 'Couldn’t reach the host for voice chat.',
  }[why];
  hud.chat(`<span class="system">${note ?? 'You joined the voice chat! Press <b>Esc</b> to mute or leave.'}</span>`);
  if (!note) play('ding');
  refreshPauseVoice();
  // Grab the mouse again (the browser may want a click if the mic question took a while).
  if (state.screen === 'game' && !state.ui && !input.locked) {
    input.lock();
    setTimeout(() => { if (state.screen === 'game' && !state.ui && !input.locked) { hud.setPaused(false); hud.setResume(true); } }, 400);
  }
}

function leaveVoice() {
  state.session?.voice?.leave();
  state.voiceInfo = null;
  hud.chat('<span class="system">You left the voice chat.</span>');
  refreshPauseVoice();
}

// The voice buttons in the Esc menu.
function refreshPauseVoice() {
  const v = state.session?.voice;
  if (!v) { hud.pauseVoice.innerHTML = ''; return; }
  hud.pauseVoice.innerHTML = v.joined
    ? `<div class="row"><button class="btn btn-wood" data-act="voice-mute" ${v.listenOnly ? 'disabled' : ''}>${v.listenOnly ? 'No Mic' : v.muted ? 'Unmute Mic' : 'Mute Mic'}</button>
       <button class="btn btn-wood" data-act="voice-leave">Leave Voice</button></div>`
    : '<button class="btn btn-wood" data-act="voice-join">Join Voice Chat</button>';
}

// Who's in the voice chat (only shown once you've joined it).
function voicePanel() {
  const members = state.voiceInfo?.members ?? [];
  const talking = new Set(state.voiceInfo?.talking ?? []);
  const rows = members.map(([id, muted]) => {
    const gp = state.game?.players.get(id);
    const name = gp?.name ?? state.lobby?.players.find((p) => p.id === id)?.name ?? 'Player';
    const color = gp && gp.team >= 0 ? TEAMS[gp.team].css : '#ffffff';
    return `<div class="voice-row ${talking.has(id) && !muted ? 'talking' : ''}">${muted ? MUTED_ICON : MIC_ICON}<b style="color:${color}">${esc(name)}${id === myId() ? ' (you)' : ''}</b></div>`;
  }).join('');
  return `<div class="voice-head">${MIC_ICON} Voice Chat <small>${members.length} in</small></div>${rows}`;
}

let stopBackground = null;
function startBackgroundTicks() {
  // When the host's tab is hidden, requestAnimationFrame stops; a worker
  // timer keeps the game running for everyone else.
  let stop = () => {};
  import('./net/transport.js').then(({ backgroundTicker }) => {
    stop = backgroundTicker(50, () => { if (document.hidden && state.screen === 'game') tick(); });
  });
  return () => stop();
}

function beginMatch() {
  state.phase = 'playing';
  const lobby = state.lobby;
  const s = state.session;
  let game;
  if (s.isHost) {
    game = s.createGame(state.world, state.map);
  } else {
    // A shadow copy that only mirrors what the host tells us.
    game = new Game({ world: state.world, map: state.map });
    game.shadow = true;
    for (const p of lobby.players) game.addPlayer({ id: p.id, name: p.name, team: p.team }).look = p.look ?? null;
  }
  state.game = game;
  state.me = game.players.get(s.myId);
  const me = state.me;
  removeLobby();
  for (const base of state.map.bases) if (!game.beds.get(base.team)) removeBedModel(base.team, false);
  setLocalModel(me.team);
  local.tpSeq = 0;
  teleport(state.map.bases[me.team].spawn);
  me.pos = { ...local.body.pos };
  local.body.canFly = false;
  local.body.flying = false;
  me.inv.selected = 0;
  closeUI(true);
  hud.setBanner(null);
  hud.showTitle('GO!', 'Protect your bed. Break theirs!', 2, TEAMS[me.team].css);
  hud.chat(`<span class="system">The game has started! You are on the <b style="color:${TEAMS[me.team].css}">${TEAMS[me.team].name}</b> team.</span>`);
  play('go');
}

function leaveToMenu(note) {
  clearTimeout(roundTimer);
  closeUI(false);
  state.session?.leave();
  state.session = null;
  stopBackground?.();
  stopBackground = null;
  state.screen = 'menu';
  state.ui = null;
  input.unlock();
  document.getElementById('hud').classList.add('hidden');
  hud.setPaused(false);
  hud.setVoiceAsk(false);
  hud.setVoice(null);
  state.voiceInfo = null;
  stopTouchCheck?.();
  reviewTouch();
  hud.setDeath(null);
  hud.setBanner(null);
  hud.setEnd(null);
  hud.setBlind(false);
  if (local.model) { renderer.scene.remove(local.model.root); local.model = null; }
  firstPerson.root.visible = false;
  cursor.show(null);
  cursor.showGhost(null);
  cursor.setProgress(null, 0);
  state.game = null;
  state.me = null;
  remote.clear();
  dropsView.clear();
  projView.clear();
  menu.show();
  menu.note(note ?? '');
}

// ----------------------------------------------------------------- network

function onNet(m) {
  switch (m.t) {
    case 'lobby':
      state.lobby = m.lobby;
      lobbyUI.render(state.lobby, myId(), canStart());
      break;
    case 'lsnap':
      if ((m.n ?? 0) < (state.session.lsnapN ?? -1)) break;   // an older one that arrived late
      state.session.lsnapN = m.n ?? 0;
      state.lobbyPeers = m.pl.filter((r) => r[0] !== myId());
      break;
    case 'start':
      state.lobby = m.lobby;
      beginMatch();
      break;
    case 'round':
      state.lobby = m.lobby;
      resetToLobby();
      hud.chat(`<span class="system">Round ${m.lobby.round}! New map: <b>${esc(state.map.name ?? '')}</b>.${canStart() ? ' Press <b>Enter</b> to start.' : ''}</span>`);
      hud.showTitle(`ROUND ${m.lobby.round}`, state.map.name ?? '', 2.5, '#ffd23f');
      play('go');
      input.lock();
      break;
    case 'snap':
      applySnapshot(m);
      break;
    case 'me':
      applyMe(m);
      break;
    case 'ev':
      handleEvent(m.e);
      break;
    case 'blk':
      if (m.id === B.AIR) logNote(no('the host took back a block you placed'));
      if (state.world.get(m.x, m.y, m.z) !== m.id) state.world.set(m.x, m.y, m.z, m.id, m.placed);
      break;
    case 'chat': {
      if (m.system) { hud.chat(`<span class="system">${esc(m.text)}</span>`); break; }
      const color = m.team >= 0 ? TEAMS[m.team].css : '#ffffff';
      hud.chat(`<b style="color:${color}">${esc(m.name)}</b>: ${esc(m.text)}`);
      play('click');
      break;
    }
    case 'voice':
      state.voiceInfo = m;
      break;
    case 'voiceLost':
      hud.chat('<span class="system">Voice chat disconnected. Join again from the <b>Esc</b> menu.</span>');
      refreshPauseVoice();
      break;
    case 'closed':
      if (state.screen === 'game') leaveToMenu('Lost connection to the host.');
      break;
    default:
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function applySnapshot(m) {
  const g = state.game;
  if (!g) return;
  // Snapshots can arrive out of order: skip older ones and any from the last round.
  if ((m.rd ?? 1) !== (state.lobby?.round ?? 1) || m.time < (g.snapTime ?? -1)) return;
  g.snapTime = m.time;
  g.time = m.time;
  while (g.timelineIndex < TIMELINE.length && TIMELINE[g.timelineIndex].at <= g.time) g.timelineIndex++;
  for (const r of m.pl) {
    const p = g.players.get(r[0]);
    if (!p) continue;
    p.connected = true;
    p.alive = !!(r[6] & 4);
    p.eliminated = !!(r[6] & 16);
    if (p === state.me) continue;
    p.netT = m.time;
    p.pos = { x: r[1], y: r[2], z: r[3] };
    p.yaw = r[4]; p.pitch = r[5];
    p.sneak = !!(r[6] & 1); p.sprint = !!(r[6] & 2); p.invis = !!(r[6] & 8); p.flying = !!(r[6] & 32);
    p.heldId = r[7]; p.heldTint = r[8]; p.armorKey = r[9]; p.swing = r[10];
  }
  for (const p of g.players.values()) if (!m.pl.some((r) => r[0] === p.id)) p.connected = false;
  for (const [id, k, f, b, ping] of m.sc ?? []) {
    const p = g.players.get(id);
    if (p) p.ping = ping ?? null;
    if (p && p !== state.me) { p.kills = k; p.finals = f; p.bedsBroken = b; }
  }
  g.drops = new Map(m.dr.map((r) => [r[0], { id: r[0], item: r[1], count: r[2], x: r[3], y: r[4], z: r[5], tint: r[6] ?? undefined }]));
  g.projectiles = new Map(m.pr.map((r) => [r[0], { id: r[0], kind: r[1], x: r[2], y: r[3], z: r[4], vx: r[5], vy: r[6], vz: r[7], fuse: r[8] }]));
  const gens = g.gens.filter((x) => x.kind === 'gold' || x.kind === 'diamond');
  m.gens.forEach(([tier, timer], i) => { if (gens[i]) { gens[i].tier = tier; gens[i].timer = timer; } });
  for (const base of state.map.bases) {
    const alive = m.beds.includes(base.team);
    if (g.beds.get(base.team) && !alive) removeBedModel(base.team, false);
    g.beds.set(base.team, alive);
  }
}

function applyMe(m) {
  const me = state.me;
  if (!me) return;
  me.inv.slots = m.inv.slots.map((s) => (s ? { ...s } : null));
  me.inv.armor = m.inv.armor.map((s) => (s ? { ...s } : null));
  me.inv.touch();
  me.hp = m.hp; me.absorption = m.ab; me.food = m.food;
  me.alive = m.alive; me.respawnIn = m.resp * TPS; me.eliminated = m.elim;
  me.regenTicks = m.regen * TPS; me.absorbTicks = m.absT * TPS;
  me.effects = m.fx;
  state.game.upgrades.set(me.team, m.ups);
  state.game.traps.set(me.team, m.traps);
  [me.armorTier, me.pickTier, me.axeTier] = m.tiers;
  me.shears = !!m.tiers[3];
  [me.kills, me.finals, me.bedsBroken] = m.score;
  const fill = (arr, src) => { for (let i = 0; i < arr.length; i++) arr[i] = src?.[i] ? { ...src[i] } : null; };
  if (!invUI.cursor) {
    fill(state.game.teamChests.get(me.team), m.chest);
    fill(me.ender, m.ender);
  }
}

// Every gameplay action goes through the session: the host applies it right
// away (and returns why it failed), clients send it and wait.
function act(a, data = {}) { return state.session.action(a, data); }

// ----------------------------------------------------------------- UI

const invUI = new InventoryUI(document.getElementById('inventory'), {
  onClose: () => closeUI(true),
  onDrop: (stack) => throwStack(stack),
  onChange: () => syncInventory(),
});
const shopUI = new ShopUI(document.getElementById('shop'), {
  onBuy: (key) => buyResult(act('buy', { key })),
  onUpgrade: (key) => buyResult(act('upg', { key })),
  onTrap: (key) => buyResult(act('trap', { key })),
  onClose: () => closeUI(true),
});
const lobbyUI = new LobbyUI(document.getElementById('teams'), {
  onPick: (team) => { state.session.setTeam(team); play('click'); },
  onStart: () => { state.session.requestStart(); closeUI(true); },
  onClose: () => closeUI(true),
});

function buyResult(why) {
  play(why ? 'deny' : 'pop');
  return why;
}

const canStart = () => isHost() && state.session.kind !== 'public' && state.phase === 'lobby';

function openUI(kind) {
  if ((kind === 'shop' || kind === 'upgrades') && !state.me) { hud.showAction('The shop opens when the game starts!'); return; }
  local.breaking = null;
  // Mark the screen open before letting go of the mouse, so the release
  // isn't mistaken for Esc (which would show the pause menu).
  state.ui = kind === 'upgrades' ? 'shop' : kind;
  input.unlock();
  if (kind === 'inventory') invUI.show(currentInv());
  if (kind === 'shop') shopUI.show(state.me, 'items');
  if (kind === 'upgrades') shopUI.show(state.me, 'upgrades', state.game.upgrades.get(state.me.team), state.game.traps.get(state.me.team));
  if (kind === 'teams') lobbyUI.show(state.lobby, myId(), canStart());
  play('click');
}

// relock: true when closed by a key or click (the browser allows grabbing
// the mouse again then). Esc doesn't allow it, so we just ask for a click.
function closeUI(relock) {
  if (!['inventory', 'shop', 'teams'].includes(state.ui)) return;
  invUI.hide();
  shopUI.hide();
  lobbyUI.hide();
  state.ui = null;
  if (relock) input.lock();
  if (!input.locked && state.screen === 'game') hud.setResume(true);
}

function showPause() {
  if (state.screen !== 'game') return;
  state.ui = 'pause';
  refreshPauseVoice();
  hud.setPaused(true);
}

function openChat() {
  state.ui = 'chat';
  input.enabled = false;
  input.keys.clear();
  hud.openChat((text) => state.session.sendChat(text), () => {
    input.enabled = true;
    state.ui = null;
    input.lock();
  });
}

// Clients tell the host about inventory rearranging (the host checks it adds up).
function syncInventory(thrown) {
  if (isHost() || !state.me) return;
  const inv = state.me.inv;
  const c = invUI.container;
  act('inv', { slots: inv.slots, armor: inv.armor, cursor: invUI.cursor ?? null, thrown: thrown ?? null, cont: c ? { kind: c.kind, slots: c.slots } : null });
}

function throwStack(stack) {
  if (!state.game || !stack) return;
  if (!isHost()) { syncInventory(stack); return; }
  const eye = eyePos(1);
  const dir = lookDir();
  state.game.spawnDrop(stack.id, stack.count, eye.x, eye.y - 0.3, eye.z, {
    vx: dir[0] * 0.3, vy: dir[1] * 0.3 + 0.1, vz: dir[2] * 0.3, pickup: 40, tint: stack.tint,
  });
}

// ----------------------------------------------------------- targeting

function lookDir() {
  const cp = Math.cos(local.pitch);
  return [-Math.sin(local.yaw) * cp, Math.sin(local.pitch), -Math.cos(local.yaw) * cp];
}

function eyePos(alpha) {
  const p = local.body.lerp(alpha);
  return { x: p.x, y: p.y + local.eye, z: p.z };
}

function npcHit(eye, dir) {
  let best = null;
  for (const n of state.npcs) {
    if (Math.hypot(n.x - eye.x, n.z - eye.z) > REACH_ENTITY + 1) continue;
    for (let t = 0; t <= REACH_ENTITY; t += 0.05) {
      const x = eye.x + dir[0] * t, y = eye.y + dir[1] * t, z = eye.z + dir[2] * t;
      if (Math.hypot(x - n.x, z - n.z) < 0.45 && y >= n.y && y <= n.y + 2.1) {
        if (!best || t < best.dist) best = { npc: n, dist: t };
        break;
      }
    }
  }
  return best;
}

function heldBlockFor(hit) {
  const item = getItem(currentInv().heldId());
  if (!item || item.kind !== 'block') return null;
  if (!isLadder(item.block)) return item.block;
  // Ladders hang on the clicked side, or face you if you clicked a top/bottom.
  let fx = hit.nx, fz = hit.nz;
  if (hit.ny !== 0) {
    const [lx, , lz] = lookDir();
    if (Math.abs(lx) > Math.abs(lz)) { fx = -Math.sign(lx); fz = 0; } else { fz = -Math.sign(lz); fx = 0; }
  }
  return B.LADDER + (fx === 1 ? 0 : fx === -1 ? 1 : fz === 1 ? 2 : 3);
}

function ladderSupported(id, x, y, z) {
  const f = [[1, 0], [-1, 0], [0, 1], [0, -1]][id - B.LADDER];
  return BLOCKS[state.world.get(x - f[0], y, z - f[1])].opaque;
}

// Bridge assist: when aiming past the edge into the void, find the air cell on
// the layer under your feet that touches an existing block.
function assistCell(eye, dir) {
  const w = state.world;
  const layer = Math.floor(local.body.pos.y + 1e-3) - 1;
  for (let t = 0.6; t <= REACH_BLOCK; t += 0.08) {
    const x = Math.floor(eye.x + dir[0] * t), y = Math.floor(eye.y + dir[1] * t), z = Math.floor(eye.z + dir[2] * t);
    if (y > layer) continue;
    if (y < layer) return null;
    if (w.get(x, y, z) !== B.AIR) return null;
    const touches = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]
      .some(([dx, dy, dz]) => BLOCKS[w.get(x + dx, y + dy, z + dz)].solid);
    if (touches && state.game.canPlace(state.me, x, y, z, B.FLUFF) === null) return [x, y, z];
  }
  return null;
}

function otherPlayers() {
  if (!state.game) return [];
  return [...state.game.players.values()].filter((p) => p !== state.me && p.alive && p.connected && !p.eliminated);
}

function updateTarget(alpha) {
  const eye = eyePos(alpha);
  const dir = lookDir();
  local.target = null; local.ghost = null; local.npc = null; local.aimPlayer = null;
  if (state.ui || (state.me && (!state.me.alive || state.me.eliminated))) return;
  const hit = state.world.raycast(eye.x, eye.y, eye.z, dir[0], dir[1], dir[2], REACH_BLOCK);
  const npc = npcHit(eye, dir);
  if (npc && (!hit || npc.dist < hit.dist)) { local.npc = npc.npc; return; }
  if (state.phase !== 'playing') return;
  const aim = remote.pick(eye, dir, REACH_ENTITY, otherPlayers());
  if (aim && (!hit || aim.dist < hit.dist)) { local.aimPlayer = aim.id; return; }
  local.target = hit;
  const item = getItem(currentInv().heldId());
  if (item?.kind === 'deploy') { if (hit) local.ghost = deployPlan(item, hit); return; }
  if (item?.kind !== 'block') return;
  if (hit) {
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    const id = heldBlockFor(hit);
    const ok = state.game.canPlace(state.me, x, y, z, id) === null && (!isLadder(id) || ladderSupported(id, x, y, z));
    if (ok) local.ghost = { x, y, z, id };
  } else if (settings.bridgeAssist) {
    const c = assistCell(eye, dir);
    if (c) local.ghost = { x: c[0], y: c[1], z: c[2], id: item.block, assist: true };
  }
}

// Where an Instant Bridge / Pop-up Tower would go for this aim, with an
// outline box covering the whole structure.
function deployPlan(item, hit) {
  if (hit.ny === -1) return null;
  const fx0 = -Math.sin(local.yaw), fz0 = -Math.cos(local.yaw);
  const [fx, fz] = Math.abs(fx0) > Math.abs(fz0) ? [Math.sign(fx0), 0] : [0, Math.sign(fz0)];
  const [rx, rz] = [-fz, fx];
  let x, y, z;
  if (item.build === 'bridge') {
    // Clicking the side of the edge block starts the bridge beside it; clicking
    // its top starts in front of it. Either way the deck is level with that block.
    if (hit.ny === 0) { x = hit.x + hit.nx; y = hit.y; z = hit.z + hit.nz; }
    else { x = hit.x + fx; y = hit.y; z = hit.z + fz; }
  } else {
    x = hit.x + hit.nx; y = hit.y + hit.ny; z = hit.z + hit.nz;
  }
  const w = state.world;
  if (w.get(x, y, z) !== B.AIR || state.game.inNoBuild(x, y, z)) return null;
  const [L, v0, v1, h] = item.build === 'bridge' ? [24, -2, 2, 2] : [4, -1, 2, 9];
  const xs = [x + rx * v0, x + rx * v1, x + fx * (L - 1) + rx * v0, x + fx * (L - 1) + rx * v1];
  const zs = [z + rz * v0, z + rz * v1, z + fz * (L - 1) + rz * v0, z + fz * (L - 1) + rz * v1];
  return { deploy: true, x, y, z, fx, fz, box: [Math.min(...xs), y, Math.min(...zs), Math.max(...xs), y + h - 1, Math.max(...zs)] };
}

// ------------------------------------------------------------- actions

function swing() {
  // Minecraft swingItem: restart once past the halfway point.
  if (!local.swinging || local.swingInt >= SWING_TICKS / 2 || local.swingInt < 0) {
    local.swingInt = -1;
    local.swinging = true;
    local.swingCount++;
  }
}

function tryPlace() {
  const g = local.ghost;
  if (!g || !state.game) return false;
  const inv = currentInv();
  if (isHost()) {
    const why = act('place', { x: g.x, y: g.y, z: g.z, slot: inv.selected, id: g.id });
    if (why) { if (why !== 'occupied') hud.showAction(why); return false; }
  } else {
    // Guess it works; the host corrects us if not.
    if (g.id !== B.TNT) state.world.set(g.x, g.y, g.z, g.id, true);
    inv.removeAt(inv.selected, 1);
    // Send where we are right now, so the host doesn't think we're still standing there.
    const b = local.body;
    act('place', { x: g.x, y: g.y, z: g.z, slot: inv.selected, id: g.id, at: [+b.pos.x.toFixed(3), +b.pos.y.toFixed(3), +b.pos.z.toFixed(3)] });
  }
  play('place');
  swing();
  return true;
}

function useItem(first) {
  if (state.ui) return;
  if (local.npc) { if (first) openNpc(local.npc); return; }
  if (first && chestAt(local.target) && !input.keys.has('ShiftLeft')) { openContainer(chestAt(local.target)); return; }
  const inv = currentInv();
  const item = getItem(inv.heldId());
  if (!item || !state.me) return;
  if (item.kind === 'food') {
    if (local.eating < 0) {
      if (!item.golden && state.me.food >= 20) { if (first) hud.showAction('You’re not hungry!'); return; }
      local.eating = 0;
    }
    return;
  }
  if (item.kind === 'bow') {
    if (inv.count('arrow') <= 0) { if (first) hud.showAction('You have no arrows!'); return; }
    if (local.bow < 0) local.bow = 0;
    return;
  }
  if (item.kind === 'block') return tryPlace();
  if (item.kind === 'deploy') {
    if (!first || state.phase !== 'playing') return;
    const g = local.ghost;
    if (!g?.deploy) { hud.showAction(item.build === 'bridge' ? 'Aim at the edge of a block to place the bridge' : 'Aim at the ground to place the tower'); return; }
    const why = act('deploy', { slot: inv.selected, x: g.x, y: g.y, z: g.z, fx: g.fx, fz: g.fz });
    if (why) hud.showAction(why); else swing();
    return;
  }
  if (item.kind === 'armor' && first) {
    const held = inv.held();
    const worn = inv.armor[item.slot];
    inv.armor[item.slot] = { ...held, count: 1 };
    inv.slots[inv.selected] = worn;
    inv.touch();
    syncInventory();
    play('pop');
    return;
  }
  if ((item.kind === 'throw' || item.kind === 'tower' || item.kind === 'potion') && first && state.phase === 'playing') {
    const why = act('use', { slot: inv.selected, eye: eyePos(1), dir: lookDir() });
    if (why) hud.showAction(why);
    swing();
  }
}

const CHESTS = { [B.CHEST]: { kind: 'team', title: 'Team Chest' }, [B.ENDER_CHEST]: { kind: 'ender', title: 'Ender Chest' } };
const chestAt = (t) => (t && CHESTS[t.id]) || null;

function openContainer(info) {
  const slots = state.game?.container(state.me, info.kind);
  if (!slots) { hud.showAction(info.kind === 'team' ? 'That’s not your team’s chest!' : 'Get closer to the chest'); return; }
  local.breaking = null;
  state.ui = 'inventory';
  input.unlock();
  invUI.show(currentInv(), { kind: info.kind, title: info.title, slots });
  play('click');
}

function openNpc(n) {
  openUI(n.kind === 'shop' ? 'shop' : 'upgrades');
}

function interact() {
  if (local.npc) openNpc(local.npc);
  else if (chestAt(local.target)) openContainer(chestAt(local.target));
  else if (state.phase === 'lobby') openUI('teams');
  else openUI('inventory');
}

function attack() {
  const b = local.body;
  swing();
  if (!local.aimPlayer || !state.me?.alive) return;
  const crit = b.fallDistance > 0 && !b.onGround && !b.onLadder;
  act('attack', { target: local.aimPlayer, crit });
  play('hit');
  // Hitting while sprinting slows you and stops the sprint (1.8).
  if (b.sprinting) { b.vel.x *= 0.6; b.vel.z *= 0.6; b.sprinting = false; local.sprintTap = false; }
  state.game.addExhaustion?.(state.me, 0.3);
}

function dropHeld(all) {
  if (!state.game || !state.me?.alive) return;
  const inv = state.me.inv;
  if (!inv.held()) return;
  if (!isHost()) inv.removeAt(inv.selected, all ? inv.held().count : 1);
  act('drop', { slot: inv.selected, all, eye: eyePos(1), dir: lookDir() });
  swing();
}

function selectSlot(i) {
  const inv = currentInv();
  if (i === inv.selected) return;
  inv.selected = i;
  inv.touch();
  const id = inv.heldId();
  if (id) hud.showItemName(id);
  local.breaking = null;
  local.eating = -1;
  local.bow = -1;
  if (state.me) act('select', { slot: i });
}

// ------------------------------------------------------------- tick (20/s)

function effectLevel(name) { return state.me?.effects?.[name]?.level ?? 0; }

function tick() {
  const b = local.body;
  const w = state.world;
  const s = state.session;
  const me = state.me;
  const alive = !me || (me.alive && !me.eliminated);
  const playing = state.phase === 'playing';
  const controls = input.locked && !state.ui;

  // Movement.
  if (!me || me.alive || me.eliminated) {
    if (!controls || !alive) clearToggles();
    const tg = controls && settings.toggleMove;
    const k = (c) => controls && (input.keys.has(c) || (tg && !!toggles[c]));
    const mv = {
      forward: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      strafe: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      jump: k('Space'),
      sneak: k('ShiftLeft') || k('ShiftRight') || (tg && toggles.sneak),
      sprint: k('ControlLeft') || k('ControlRight') || (tg && toggles.sprint),
      sprintTap: local.sprintTap,
      yaw: local.yaw,
      canSprint: !me || me.food > 6,
    };
    if (local.eating >= 0 || local.bow >= 0) { mv.forward *= 0.2; mv.strafe *= 0.2; mv.sprint = false; mv.sprintTap = false; }
    const speedMul = (1 + 0.2 * effectLevel('speed')) * (1 - 0.15 * effectLevel('slow'));
    b.tick(w, mv, speedMul, effectLevel('jump'));
    if (!b.sprinting || !k('KeyW')) local.sprintTap = false;

    if (me && playing && alive) {
      if (b.sprinting && b.onGround) local.exh += 0.1 * b.walked;
      if (b.jumped) local.exh += b.sprinting ? 0.8 : 0.2;
      if (b.landedFrom > 3) local.fall = Math.max(local.fall, b.landedFrom);
    }
    if (b.landedFrom > 1.5) play('land');
  }
  if (state.phase === 'lobby' && b.pos.y < LOBBY_Y - 30) teleport(state.map.lobby);

  // Tell the game where we are.
  const fl = (b.sneaking ? 1 : 0) | (b.sprinting ? 2 : 0) | (b.flying ? 4 : 0);
  if (s.isHost && me) {
    if (me.alive) {
      me.pos.x = b.pos.x; me.pos.y = b.pos.y; me.pos.z = b.pos.z;
      me.yaw = local.yaw; me.pitch = local.pitch; me.sneak = b.sneaking; me.sprint = b.sprinting; me.flying = b.flying; me.swing = local.swingCount;
      if (local.exh) state.game.addExhaustion(me, local.exh);
      if (local.fall) state.game.damage(me, fallDamage(local.fall), 'fall', { bypassArmor: true });
    }
  } else {
    if (me) { me.pos.x = b.pos.x; me.pos.y = b.pos.y; me.pos.z = b.pos.z; }
    s.sendState({ p: [+b.pos.x.toFixed(3), +b.pos.y.toFixed(3), +b.pos.z.toFixed(3)], yaw: +local.yaw.toFixed(3), pitch: +local.pitch.toFixed(3), fl, sw: local.swingCount, tq: local.tpSeq, sq: ++local.sq });
    // Positions may get lost on the way; hunger and falls must not, so they
    // go separately (falls right away, hunger twice a second).
    if (me) {
      local.exhOut += local.exh;
      if (local.fall || (local.exhOut && ++local.bodyN >= 10)) {
        s.action('body', { exh: +local.exhOut.toFixed(3), fall: +local.fall.toFixed(2) });
        local.exhOut = 0;
        local.bodyN = 0;
      }
    }
  }
  local.exh = 0;
  local.fall = 0;

  // View bobbing and FOV, as EntityPlayer / EntityRenderer do it.
  local.prevWalked = local.walked; local.prevBob = local.bob; local.prevTilt = local.tilt; local.prevFovMod = local.fovMod;
  local.walked += b.walked * 0.6;
  const speed = Math.min(0.1, Math.hypot(b.vel.x, b.vel.z));
  local.bob += ((b.onGround && alive ? speed : 0) - local.bob) * 0.4;
  local.tilt += ((b.onGround ? 0 : Math.atan(-b.vel.y * 0.2) * 15) - local.tilt) * 0.8;
  let fov = 1;
  if (b.flying) fov *= 1.1;
  if (b.sprinting) fov *= 1.15;
  if (effectLevel('speed')) fov *= 1 + 0.05 * effectLevel('speed');
  if (local.bow >= 0) { const f = Math.min(1, local.bow / 20); fov *= 1 - f * f * 0.15; }
  local.fovMod += (fov - local.fovMod) * 0.5;
  if (local.hurtTime > 0) local.hurtTime--;

  // Arm swing.
  if (local.swinging) {
    local.swingInt++;
    if (local.swingInt >= SWING_TICKS) { local.swingInt = 0; local.swinging = false; }
  }

  // Breaking (PlayerControllerMP.onPlayerDamageBlock): hold left click, or
  // hold right click (a quick right click places instead).
  const holding = (pending, at, down) => down && (!pending || performance.now() - at >= TAP_MS);
  local.mining = holding(local.leftPending, local.leftDownAt, input.mouse.left) || (local.rightPending && holding(true, local.rightDownAt, input.mouse.right));
  if (controls && playing && alive && local.mining && !local.npc && !local.aimPlayer) {
    const t = local.target;
    if (local.breakDelay > 0) local.breakDelay--;
    else if (t) {
      const key = `${t.x},${t.y},${t.z}`;
      const why = state.game.canBreak(me, t.x, t.y, t.z);
      if (why) {
        if (!local.breaking || local.breaking.key !== key) hud.showAction(why);
        local.breaking = { key, progress: 0, blocked: true };
      } else {
        if (!local.breaking || local.breaking.key !== key || local.breaking.blocked) local.breaking = { key, progress: 0, sound: 0 };
        swing();  // the arm only keeps swinging while you're actually mining
        const ticks = breakTicks(t.id, currentInv().heldId(), state.game.haste(me), !!me.effects?.fatigue);
        local.breaking.progress = ticks === 0 ? 1 : local.breaking.progress + 1 / ticks;
        local.breaking.ticks = ticks;
        if (--local.breaking.sound <= 0) { play('dig'); local.breaking.sound = 4; }
        if (local.breaking.progress >= 1) {
          if (!s.isHost && t.id !== B.BED) {
            local.predicted.add(key);
            particles.blockBurst(t.x, t.y, t.z, t.id);
            play('break');
            state.world.set(t.x, t.y, t.z, B.AIR);
          }
          act('break', { x: t.x, y: t.y, z: t.z });
          local.breaking = null;
          if (ticks > 0) local.breakDelay = BREAK_DELAY;
        }
      }
    } else local.breaking = null;
  } else {
    local.breaking = null;
    local.breakDelay = 0;
  }

  // Holding right click: eating (32 ticks) and drawing a bow.
  if (local.placeDelay > 0) local.placeDelay--;
  const held = getItem(currentInv().heldId());
  if (controls && alive && input.mouse.right) {
    if (local.eating >= 0) {
      if (held?.kind !== 'food') local.eating = -1;
      else {
        local.eating++;
        if (local.eating % 4 === 0) play('eat');
        if (local.eating >= EAT_TICKS) {
          act('eat', { slot: currentInv().selected });
          play('burp');
          local.eating = -1;
        }
      }
    }
    if (local.bow >= 0) {
      if (held?.kind !== 'bow') local.bow = -1;
      else local.bow++;
    }
  } else {
    local.eating = -1;
    if (local.bow >= 0) {
      if (held?.kind === 'bow' && local.bow >= 3) act('shoot', { slot: currentInv().selected, charge: local.bow, eye: eyePos(1), dir: lookDir() });
      local.bow = -1;
    }
  }

  s.tick(TICK);
}

// ------------------------------------------------------------- events

function handleEvent(e) {
  const me = state.me;
  const mine = me && e.id === me.id;
  switch (e.type) {
    case 'block':
      if (state.world.get(e.x, e.y, e.z) !== e.id) state.world.set(e.x, e.y, e.z, e.id, true);
      if (e.anim) {
        // Pop-up tower going up: a little puff and a pop for every few blocks.
        particles.blockBurst(e.x, e.y, e.z, e.id, 5);
        if (Math.random() < 0.3) play('place');
      }
      break;
    case 'break': {
      const key = `${e.x},${e.y},${e.z}`;
      if (local.predicted.delete(key)) break;
      if (state.world.get(e.x, e.y, e.z) !== B.AIR) state.world.set(e.x, e.y, e.z, B.AIR);
      particles.blockBurst(e.x, e.y, e.z, e.id);
      if (!e.quiet) play('break');
      break;
    }
    case 'bedBroken': {
      const { head, foot } = state.map.bases[e.team].bed;
      for (const c of [head, foot]) if (state.world.get(c[0], c[1], c[2]) !== B.AIR) state.world.set(c[0], c[1], c[2], B.AIR);
      if (state.game) state.game.beds.set(e.team, false);
      removeBedModel(e.team, true);
      if (!e.byName) break;
      const t = TEAMS[e.team];
      const by = ` by <span style="color:${TEAMS[e.byTeam].css}">${esc(e.byName)}</span>`;
      const bedLine = `<b style="color:#fff">BED DESTRUCTION &gt;</b> <span style="color:${t.css}">${t.name} Bed</span> was destroyed${by}!`;
      hud.message(bedLine, 8);
      hud.chat(bedLine);
      if (me && e.team === me.team) hud.showTitle('BED DESTROYED!', 'You will no longer respawn!', 3.5, '#ff4f45');
      else if (me && e.by === me.id) hud.showTitle('BED DESTROYED!', `You broke ${t.name}'s bed!`, 2.5, t.css);
      play('bed');
      break;
    }
    case 'pickup':
      if (mine) play('pop');
      break;
    case 'hurt':
      if (mine) { hud.hurt(); play('hurt'); local.hurtTime = 10; } else remote.hurt(e.id);
      break;
    case 'hit':
      if (e.crit) particles.burst(e.x, e.y, e.z, [255, 255, 255], 10, { spread: 0.3, speed: 3, size: 0.07 });
      break;
    case 'kb':
      if (mine) applyKnockback(e);
      break;
    case 'tp':
      if (mine) { teleport({ x: e.x, y: e.y, z: e.z }, null); local.tpSeq = e.seq ?? local.tpSeq; play('whoosh'); }
      break;
    case 'reward':
      if (mine) {
        const parts = Object.entries(e.loot).map(([k, n]) => `+${n} ${getItem(k).name}`).join(', ');
        hud.message(`<span style="color:#5bd23c">${parts}</span>`);
        play('pop');
      }
      break;
    case 'death':
      if (mine) {
        local.breaking = null;
        local.eating = -1;
        local.bow = -1;
        closeUI(false);
        if (e.final) hud.showTitle('YOU DIED!', 'Your bed is gone. You are now spectating.', 4, '#ff4f45');
      }
      if (e.killer && me && e.killer === me.id) {
        play('ding');
        const victim = `<span style="color:${TEAMS[e.team].css}">${esc(e.name)}</span>`;
        hud.showAction(e.final ? 'FINAL KILL!' : 'KILL!', 2);
        hud.message(`${e.final ? '<b style="color:#5ff0ff">FINAL KILL</b> on' : 'You killed'} ${victim}!`, 4);
      }
      hud.message(deathMessage(e), 6);
      hud.chat(deathMessage(e));
      break;
    case 'respawn':
      if (mine) {
        teleport({ x: e.x, y: e.y, z: e.z }, e.yaw);
        local.tpSeq = e.seq ?? local.tpSeq;
        hud.showTitle('RESPAWNED!', '', 1.5, '#5bd23c');
      }
      break;
    case 'genTier':
      hud.message(`${e.kind === 'gold' ? 'Gold' : 'Diamond'} generators are now <span style="color:#fff">Tier ${['I', 'II', 'III'][e.tier - 1]}</span>`);
      break;
    case 'upgrade':
      if (me && e.team === me.team) {
        hud.message(`<span style="color:#fff">${esc(e.by)}</span> purchased <span style="color:#5bd23c">${esc(e.name)}</span>`);
        if (e.by !== me.name) play('go');
      }
      break;
    case 'trap':
      if (me && e.team === me.team) { hud.showTitle('TRAP TRIGGERED!', `${e.intruderName} walked into your base`, 2.5, '#ff4f45'); play('bed'); }
      if (me && e.intruder === me.id) hud.showTitle('It’s a trap!', 'You set off an enemy trap', 2, '#ffd23f');
      break;
    case 'explosion':
      particles.burst(e.x, e.y, e.z, e.kind === 'tnt' ? [255, 160, 60] : [255, 120, 40], e.kind === 'tnt' ? 70 : 40, { spread: 1.2, speed: 9, size: 0.18 });
      particles.burst(e.x, e.y, e.z, [80, 80, 80], 30, { spread: 1.5, speed: 4, gravity: -2, size: 0.25 });
      play('boom');
      break;
    case 'sound':
      play(e.name);
      break;
    case 'deny':
      if (mine) { hud.showAction(e.why); play('deny'); }
      break;
    case 'left':
      hud.message(`<span style="color:${TEAMS[e.team].css}">${esc(e.name)}</span> left the game.`);
      break;
    case 'end':
      showEnd(e);
      break;
    default:
  }
}

// Minecraft knockBack() / addVelocity(), applied to our own body.
function applyKnockback(e) {
  const v = local.body.vel;
  if (e.mode === 'hit') {
    v.x /= 2; v.y /= 2; v.z /= 2;
    v.x -= e.dx * 0.4; v.z -= e.dz * 0.4;
    v.y = Math.min(0.4, v.y + 0.4);
    v.x += e.extra[0]; v.y += e.extra[1]; v.z += e.extra[2];
  } else {
    v.x += e.v[0]; v.y += e.v[1]; v.z += e.v[2];
  }
  local.body.onGround = false;
}

function deathMessage(e) {
  const name = `<span style="color:${TEAMS[e.team].css}">${esc(e.name)}</span>`;
  const killer = e.killerName ? `<span style="color:${TEAMS[e.killerTeam].css}">${esc(e.killerName)}</span>` : null;
  const how = killer
    ? { void: `was knocked into the void by ${killer}`, fall: `was knocked off a cliff by ${killer}`, arrow: `was shot by ${killer}`, fireball: `was blown up by ${killer}`, tnt: `was blown up by ${killer}` }[e.cause] ?? `was killed by ${killer}`
    : { void: 'fell into the void', fall: 'hit the ground too hard', starve: 'starved to death', pearl: 'landed too hard', tnt: 'blew up', fireball: 'blew up' }[e.cause] ?? 'died';
  return `${name} ${how}.${e.final ? ' <span style="color:#5ff0ff">FINAL KILL!</span>' : ''}`;
}

function showEnd(e) {
  state.phase = 'ended';
  closeUI(false);
  const me = state.me;
  const won = me && e.winner === me.team;
  const title = e.winner < 0 ? 'DRAW' : won ? 'VICTORY!' : `${TEAMS[e.winner].name.toUpperCase()} WINS`;
  const color = e.winner < 0 ? '#ffd23f' : won ? '#5bd23c' : TEAMS[e.winner].css;
  const why = e.reason === 'time' ? 'Time ran out: most players left wins.' : '';
  const rows = [...e.stats].sort((a, b) => (b.finals + b.kills) - (a.finals + a.kills)).map((p) =>
    `<tr><td style="color:${TEAMS[p.team].css}">${esc(p.name)}</td><td>${p.kills}</td><td>${p.finals}</td><td>${p.beds}</td></tr>`).join('');
  const host = isHost();
  hud.setEnd(`<div class="panel end-card"><div class="end-title" style="color:${color}">${title}</div>
    ${why ? `<div class="end-why">${why}</div>` : ''}
    <table class="end-table"><tr><th>Player</th><th>Kills</th><th>Finals</th><th>Beds</th></tr>${rows}</table>
    <div class="end-next">${host ? 'Next round starts in <b data-count>15</b>s' : 'Waiting for the host to start the next round…'}</div>
    <div class="row">${host ? '<button class="btn btn-green" data-again>Play again</button>' : ''}<button class="btn btn-red" data-leave>Leave</button></div></div>`);
  hud.end.querySelector('[data-leave]').addEventListener('click', () => leaveToMenu());
  hud.end.querySelector('[data-again]')?.addEventListener('click', () => nextRound());
  input.unlock();
  play(won ? 'go' : 'bed');
  if (host) {
    let n = 15;
    const tickDown = () => {
      if (state.phase !== 'ended' || state.screen !== 'game') return;
      n--;
      const c = hud.end.querySelector('[data-count]');
      if (c) c.textContent = n;
      if (n <= 0) nextRound(); else roundTimer = setTimeout(tickDown, 1000);
    };
    roundTimer = setTimeout(tickDown, 1000);
  }
}

function nextRound() {
  clearTimeout(roundTimer);
  if (!isHost() || state.phase !== 'ended') return;
  state.session.newRound(pickMap());
}

// ------------------------------------------------------------- per frame

// Ticks behind the newest update to draw other players (see RemotePlayers).
const NET_DELAY = 2;

function remoteList() {
  if (state.game) {
    return otherPlayers().map((p) => {
      const held = p.heldId !== undefined ? { id: p.heldId, tint: p.heldTint } : (p.inv.held() ?? {});
      // Players over the network carry the tick of their update; the host's
      // bots move every game tick.
      const net = p.netT != null;
      return {
        t: net ? p.netT : state.game.time, delay: net ? NET_DELAY : 1,
        id: p.id, name: p.name, team: p.team, pos: p.pos, yaw: p.yaw, pitch: p.pitch, sneak: p.sneak, flying: p.flying,
        held: held?.id ?? null, heldTint: held?.tint, armorKey: p.armorKey ?? p.inv.armor.map((a) => a?.id ?? '').join('|'),
        swing: p.swing, visible: !(p.invis || p.effects?.invis), look: p.look,
      };
    });
  }
  if (isHost()) {
    // Lobby: the host knows everyone's position directly.
    return state.session.lobbyView().filter((r) => r[0] !== myId()).map(lobbyRow);
  }
  return state.lobbyPeers.map(lobbyRow);
}

function lobbyRow(r) {
  const lp = state.lobby?.players.find((p) => p.id === r[0]);
  return { id: r[0], name: lp?.name ?? 'Player', team: -1, pos: { x: r[1], y: r[2], z: r[3] }, yaw: r[4], pitch: r[5], sneak: !!(r[6] & 1), flying: !!(r[6] & 4), held: null, armorKey: '', swing: 0, look: lp?.look, t: r[7], delay: NET_DELAY + 1 };
}

function updateGame(dt) {
  const b = local.body;
  const me = state.me;
  const controls = input.locked && !state.ui;
  const alive = !me || (me.alive && !me.eliminated);

  if (controls) {
    const k = 0.15 * (Math.PI / 180) * settings.sensitivity;
    local.yaw -= input.mouse.dx * k;
    local.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, local.pitch - input.mouse.dy * k));
    if (input.mouse.wheel) selectSlot((currentInv().selected + input.mouse.wheel + 9) % 9);
    if (input.doubleTapped('Space') && b.canFly) { b.flying = !b.flying; b.vel.y = 0; play('whoosh'); }
    if (input.doubleTapped('KeyW')) local.sprintTap = true;
    if (input.mouse.leftPressed && alive) {
      const kind = getItem(currentInv().heldId())?.kind;
      if (local.npc) { openNpc(local.npc); logClick('Left', ok('opened the shop')); }
      else if (!local.aimPlayer && (kind === 'block' || kind === 'deploy')) {
        // Holding something placeable: wait to see if it's a click (place) or a hold (break).
        if (input.mouse.left) { local.leftPending = true; local.leftDownAt = performance.now(); }
        else leftTap();   // pressed and let go within this frame
      } else {
        attack();
        logClick('Left', ok(local.aimPlayer ? 'hit a player' : local.target ? 'started breaking' : 'swing'));
      }
    }
    if (local.leftPending && !input.mouse.left) {
      local.leftPending = false;
      if (performance.now() - local.leftDownAt < TAP_MS) leftTap();
    }
    if (input.mouse.rightPressed && alive) {
      // Things with their own right-click use (food, bows, throwables, potions,
      // armor), shops and chests act right away. Otherwise wait: a quick
      // click places, holding it breaks.
      const kind = getItem(currentInv().heldId())?.kind;
      const opens = local.npc || (chestAt(local.target) && !input.keys.has('ShiftLeft'));
      if (opens || ['food', 'bow', 'throw', 'potion', 'armor', 'tower'].includes(kind)) rightTap();
      else if (input.mouse.right) { local.rightPending = true; local.rightDownAt = performance.now(); }
      else rightTap();   // pressed and let go within this frame
    }
    if (local.rightPending && !input.mouse.right) {
      local.rightPending = false;
      if (performance.now() - local.rightDownAt < TAP_MS) rightTap();
    }
  }

  // Fixed-rate simulation.
  state.acc = Math.min(state.acc + dt, 0.5);   // after a hitch, catch up at most 10 ticks (as Minecraft does)
  while (state.acc >= TICK && state.screen === 'game') { state.acc -= TICK; tick(); }
  if (state.screen !== 'game') return;
  const alpha = state.acc / TICK;

  // Spectating after a final death.
  if (me?.eliminated && !b.canFly) { b.canFly = true; b.flying = true; }

  // Lobby banner.
  if (state.phase === 'lobby' && state.lobby) {
    const L = state.lobby;
    const mode = MODES[L.mode] ?? MODES.solo;
    if (L.state === 'countdown') hud.setBanner(`TIME TO START THE GAME <em>${Math.max(0, Math.ceil(L.countdown))}s</em>`);
    else {
      const need = L.min > 1 && L.players.length < L.min ? ` · NEED <em>${L.min}</em> TO START` : '';
      hud.setBanner(`WAITING FOR PLAYERS <em>${L.players.length}/${mode.teams * mode.size}</em>${need}${L.code ? ` · ROOM <em>${L.code}</em>` : ''}`);
    }
    if (L.state === 'countdown') {
      const n = Math.ceil(L.countdown);
      if (n !== state.lastTick && n > 0 && n <= 5) play('tick');
      state.lastTick = n;
    }
    if (!isHost()) L.countdown = Math.max(0, L.countdown - dt);
  }

  // Camera.
  const targetEye = b.sneaking ? PHYS.sneakEye : PHYS.eye;
  local.eye += (targetEye - local.eye) * Math.min(1, dt * 18);
  const eye = eyePos(alpha);
  const dir = lookDir();
  const cam = renderer.camera;
  const fovMod = local.prevFovMod + (local.fovMod - local.prevFovMod) * alpha;
  cam.fov = settings.fov * fovMod;
  cam.updateProjectionMatrix();
  const walked = -(local.prevWalked + (local.walked - local.prevWalked) * alpha);
  const bob = settings.bobbing ? local.prevBob + (local.bob - local.prevBob) * alpha : 0;
  const tilt = settings.bobbing ? local.prevTilt + (local.tilt - local.prevTilt) * alpha : 0;
  const hurtRoll = local.hurtTime > 0 ? -Math.sin(Math.pow(Math.max(0, local.hurtTime - alpha) / 10, 4) * Math.PI) * 14 : 0;
  let yaw = local.yaw, pitch = local.pitch;
  let cx = eye.x, cy = eye.y, cz = eye.z;
  local.camDist = 4;
  if (local.cam > 0) {
    const s = local.cam === 1 ? -1 : 1;
    const ray = state.world.raycast(eye.x, eye.y, eye.z, dir[0] * s, dir[1] * s, dir[2] * s, 4);
    const dist = ray ? Math.max(0.2, ray.dist - 0.2) : 4;
    cx += dir[0] * s * dist; cy += dir[1] * s * dist; cz += dir[2] * s * dist;
    if (local.cam === 2) { yaw += Math.PI; pitch = -pitch; }
    local.camDist = dist;
  }
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  if (local.cam === 0) {
    // Minecraft view bobbing: a small sway in view space.
    const w = walked * Math.PI;
    const off = new THREE.Vector3(Math.sin(w) * bob * 0.5, -Math.abs(Math.cos(w) * bob), 0).applyEuler(cam.rotation);
    cx -= off.x; cy -= off.y; cz -= off.z;
    cam.rotation.set(
      pitch - (Math.abs(Math.cos(w - 0.2) * bob) * 5 + tilt) * (Math.PI / 180),
      yaw,
      -(Math.sin(w) * bob * 3 + hurtRoll) * (Math.PI / 180),
      'YXZ',
    );
  }
  cam.position.set(cx, cy, cz);

  // Other players, projectiles, drops.
  remote.sync(remoteList(), dt);
  if (state.game) {
    dropsView.sync(state.game.drops, state.t, dt);
    projView.sync(state.game.projectiles, state.t, dt);
  }

  // Targets, outlines and the crack overlay.
  updateTarget(alpha);
  const inv = currentInv();
  const heldId = inv.heldId();
  cursor.show(local.target && !local.ghost?.assist ? local.target : null);
  if (local.ghost?.box) cursor.showGhostBox(local.ghost.box);
  else cursor.showGhost(local.ghost ? [local.ghost.x, local.ghost.y, local.ghost.z] : null);
  // Stretch the cracks so the last stage shows on the tick before it breaks.
  const br = local.breaking;
  // Advance smoothly between ticks too, and reach the last stage just before it breaks.
  const crack = br && !br.blocked && br.ticks > 1
    ? Math.min(0.999, (br.progress + (local.mining ? alpha / br.ticks : 0)) * br.ticks / (br.ticks - 1)) : 0;
  cursor.setProgress(local.target, crack);
  hud.setPrompt(local.npc ? (local.npc.kind === 'shop' ? 'Item Shop' : 'Team Upgrades')
    : chestAt(local.target) ? chestAt(local.target).title
    : state.phase === 'lobby' && !state.ui ? 'Pick team' : null);

  // Hand and body.
  const swingP = local.swinging ? Math.max(0, Math.min(1, (local.swingInt + alpha) / SWING_TICKS)) : 0;
  firstPerson.root.visible = local.cam === 0 && alive;
  renderer.showHand = firstPerson.root.visible;
  const heldSlot = inv.held();
  firstPerson.update({
    id: heldId, tint: heldSlot?.tint, swing: swingP, dt,
    eat: local.eating >= 0 ? Math.min(1, (local.eating + alpha) / EAT_TICKS) : -1,
    walked, bob, tilt,
  });
  const m = local.model;
  const pos = b.lerp(alpha);
  m.root.visible = local.cam > 0 && local.camDist > 1 && alive;
  m.root.position.set(pos.x, pos.y, pos.z);
  m.root.rotation.y = local.yaw;
  m.setHeld(heldId, heldSlot?.tint);
  // The body shows whatever armor is in the armor slots right now.
  const armorKey = inv.armor.map((a) => a?.id ?? '').join('|');
  if (m.armorKey !== armorKey) {
    m.armorKey = armorKey;
    const top = inv.armor[0] ?? inv.armor[1];
    const legs = inv.armor[2] ?? inv.armor[3];
    m.setArmor(inv.armor.some(Boolean) ? { top: top ? top.id.split('_')[0] : 'leather', legs: legs ? legs.id.split('_')[0] : 'leather' } : null);
  }
  m.animate(dt, { speed: Math.hypot(b.vel.x, b.vel.z) * TPS, sneaking: b.sneaking, swing: swingP, pitch: local.pitch, flying: b.flying, onGround: b.onGround });

  // HUD.
  hud.setHotbar(inv);
  if (me) {
    hud.setHealth(me.hp, me.absorption);
    hud.setHunger(me.food);
    hud.setDeath(me.alive || me.eliminated ? null : `Respawning in ${Math.ceil(me.respawnIn / TPS)}s`);
    hud.setBlind(!!me.effects?.blind);
    hud.setEffects(activeEffects(me));
  } else {
    hud.setHealth(20, 0);
    hud.setHunger(20);
    hud.setEffects([]);
  }
  if (shopUI.open && state.me) {
    shopUI.upgrades = state.game.upgrades.get(state.me.team);
    shopUI.traps = state.game.traps.get(state.me.team);
  }
  hud.setTab(input.keys.has('Tab') && !state.ui ? tabList() : null);
  hud.setVoice(state.session?.voice?.joined ? voicePanel() : null);
  hud.setClicks(settings.clickMonitor ? clickMonitor() : null);
  hud.setTopbar(state.game ? topbar() : null);
  invUI.update();
  shopUI.update();
  if (state.game) {
    updateGenLabels();
    hud.setBoard(scoreboard());
  } else hud.setBoard(null);
  hud.setDebug(`${Math.round(1 / Math.max(dt, 1e-3))} fps · xyz ${b.pos.x.toFixed(2)} ${b.pos.y.toFixed(2)} ${b.pos.z.toFixed(2)} · ${b.onGround ? 'ground' : 'air'}${b.sprinting ? ' · sprint' : ''}${b.sneaking ? ' · sneak' : ''}${b.flying ? ' · fly' : ''} · ${(Math.hypot(b.vel.x, b.vel.z) * TPS).toFixed(2)} b/s · ${state.session?.kind}${netInfo()}`);
}

// F3 line for a client: its connection to the host.
function netInfo() {
  const link = state.session?.link;
  if (!link) return '';
  return ` · ping ${link.ping ?? '?'} ms ${link.relay ? '(relay)' : '(direct)'}${link.fastOk ? ' · fast' : ''}`;
}

// Minefun-style bar at the top: a trophy with how many teams are left, then
// every player's face grouped by team (grey while dead, crossed out when out).
function topbar() {
  const g = state.game;
  const groups = [];
  for (const base of state.map.bases) {
    const team = [...g.players.values()].filter((p) => p.team === base.team);
    if (!team.length) continue;
    const t = TEAMS[base.team];
    const faces = team.map((p) => {
      const cls = !p.connected || p.eliminated ? 'out' : !p.alive ? 'dead' : '';
      return `<span class="face ${cls}" title="${esc(p.name)}"><img src="${faceIcon(p.name, p.look)}"></span>`;
    }).join('');
    groups.push(`<span class="tb-team ${g.beds.get(base.team) ? '' : 'nobed'}" style="--tc:${t.css}">${faces}</span>`);
  }
  const alive = g.teamsAlive().size;
  return `<span class="tb-rank">#${alive}<i>🏆</i></span>${groups.join('')}`;
}

// Hold Tab: everyone in the game, grouped by team.
function tabList() {
  const mode = MODES[state.lobby?.mode] ?? MODES.solo;
  let rows = '';
  if (state.game) {
    for (const base of state.map.bases) {
      const team = [...state.game.players.values()].filter((p) => p.team === base.team);
      if (!team.length) continue;
      const t = TEAMS[base.team];
      const bed = state.game.beds.get(base.team) ? '✔' : '✘';
      rows += `<div class="tab-team" style="color:${t.css}">${t.name} <span>${bed}</span></div>`;
      for (const p of team) {
        const status = !p.connected ? 'left' : p.eliminated ? 'out' : !p.alive ? 'dead' : '';
        const ping = pingOf(p);
        const stats = `${p.kills ?? 0} kills · ${p.finals ?? 0} finals · ${p.bedsBroken ?? 0} beds${ping != null ? ` · <i style="color:${pingColor(ping)}">${ping} ms</i>` : ''}`;
        rows += `<div class="tab-row ${status}"><b>${esc(p.name)}${p === state.me ? ' (you)' : ''}</b><span>${status || stats}</span></div>`;
      }
    }
  } else {
    for (const p of state.lobby?.players ?? []) {
      const t = p.team >= 0 ? TEAMS[p.team] : null;
      rows += `<div class="tab-row"><b>${esc(p.name)}${p.id === myId() ? ' (you)' : ''}</b><span style="color:${t?.css ?? '#fff'}">${t ? t.name : 'random team'}${p.host ? ' · host' : ''}</span></div>`;
    }
  }
  const count = state.lobby?.players.length ?? 1;
  return `<div class="tab-head">BLOCKWARS · ${mode.label} · ${count} player${count === 1 ? '' : 's'}${state.lobby?.code ? ` · ROOM ${state.lobby.code}` : ''}</div>${rows}`;
}

// Round trip to the host: the host measures every link and sends it round.
function pingOf(p) {
  if (isHost()) return state.session.pingOf?.(p.id) ?? null;
  return p.ping ?? null;
}
const pingColor = (ms) => (ms < 80 ? '#7dff6b' : ms < 160 ? '#ffd23f' : '#ff6b6b');

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
function activeEffects(me) {
  const u = state.game.upgrades.get(me.team);
  const out = [];
  if (me.eliminated) out.push({ icon: 'ender_pearl', name: 'Spectating', sub: 'Double-tap Space to fly' });
  if (u.sharp) out.push({ icon: 'iron_sword', name: 'Sharpness I', sub: 'Team upgrade' });
  if (u.prot) out.push({ icon: 'iron_chestplate', name: `Protection ${ROMAN[u.prot]}`, sub: 'Team upgrade' });
  if (u.haste) out.push({ icon: 'gold_pickaxe', name: `Haste ${ROMAN[u.haste]}`, sub: 'Team upgrade' });
  if (u.forge) out.push({ icon: 'silver', name: ['Silver', 'Golden', 'Blazing', 'Molten'][u.forge - 1] + ' Forge', sub: 'Team upgrade' });
  if (u.goldgen) out.push({ icon: 'gold', name: 'Gold Generator', sub: 'Every 10s at base' });
  if (u.diagen) out.push({ icon: 'diamond', name: 'Diamond Generator', sub: 'Every 10s at base' });
  if (u.heal) {
    const c = state.map.bases[me.team].center;
    const near = Math.hypot(local.body.pos.x - c[0], local.body.pos.z - c[1]) < 14;
    out.push({ icon: 'golden_apple', name: 'Heal Pool', sub: near ? 'Healing!' : 'At your base', on: near });
  }
  const traps = state.game.traps.get(me.team) ?? [];
  if (traps.length) out.push({ icon: 'invis_potion', name: `${traps.length} trap${traps.length > 1 ? 's' : ''} ready`, sub: 'Team upgrade' });
  const fx = me.effects ?? {};
  const fxInfo = {
    speed: ['speed_potion', 'Speed'], jump: ['jump_potion', 'Jump Boost'], invis: ['invis_potion', 'Invisibility'],
    milk: ['magic_milk', 'Trap immunity'], blind: ['invis_potion', 'Blindness'], slow: ['invis_potion', 'Slowness'], fatigue: ['iron_pickaxe', 'Mining Fatigue'],
  };
  for (const [k, v] of Object.entries(fx)) {
    if (!fxInfo[k]) continue;
    out.push({ icon: fxInfo[k][0], name: `${fxInfo[k][1]}${v.level > 1 ? ` ${ROMAN[v.level]}` : ''}`, sub: `${Math.ceil(v.ticks / TPS)}s`, on: true });
  }
  if (me.regenTicks > 2) out.push({ icon: 'golden_apple', name: 'Regeneration II', sub: `${Math.ceil(me.regenTicks / TPS)}s`, on: true });
  if (me.absorption > 0) out.push({ icon: 'golden_apple', name: 'Absorption', sub: `${Math.ceil(me.absorbTicks / TPS)}s`, on: true });
  return out;
}

let genLabelFrame = 0;
function updateGenLabels() {
  if (++genLabelFrame % 10) return;
  const byKind = { gold: [], diamond: [] };
  for (const gen of state.game.gens) if (byKind[gen.kind]) byKind[gen.kind].push(gen);
  for (const kind of ['gold', 'diamond']) {
    state.genModels.filter((x) => x.kind === kind).forEach((m, i) => {
      const gen = byKind[kind][i];
      if (gen) m.obj.userData.setInfo?.(gen.tier, Math.ceil(gen.timer / TPS));
    });
  }
}

function scoreboard() {
  const g = state.game;
  const ev = g.nextEvent();
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const rows = state.map.bases.map((base) => {
    const t = TEAMS[base.team];
    const alive = [...g.players.values()].filter((p) => p.team === base.team && !p.eliminated && p.connected).length;
    const status = g.beds.get(base.team) ? '<b style="color:#5bd23c">✔</b>' : alive ? `<b style="color:#ffd23f">${alive}</b>` : '<b style="color:#ff4f45">✘</b>';
    const you = state.me?.team === base.team ? ' class="you"' : '';
    return `<div class="board-row"><span${you}><b style="color:${t.css}">${t.letter}</b> ${t.name}</span>${status}</div>`;
  }).join('');
  const me = state.me;
  return `<div class="board-title">BLOCKWARS</div>
    ${ev ? `<div class="board-row"><span>${ev.name} in</span><b style="color:#5bd23c">${fmt(ev.seconds)}</b></div>` : ''}
    <div class="board-sep"></div>${rows}<div class="board-sep"></div>
    <div class="board-row"><span>Kills</span><b>${me?.kills ?? 0}</b></div>
    <div class="board-row"><span>Final kills</span><b>${me?.finals ?? 0}</b></div>
    <div class="board-row"><span>Beds broken</span><b>${me?.bedsBroken ?? 0}</b></div>
    <div class="board-row"><span>Map</span><b>${state.map.name ?? ''}</b></div>`;
}

function updateMenuCamera(dt) {
  state.orbit += dt * 0.04;
  const cam = renderer.camera;
  const r = 150;
  cam.fov = 60;
  cam.updateProjectionMatrix();
  cam.position.set(CENTER.x + Math.cos(state.orbit) * r, 104, CENTER.z + Math.sin(state.orbit) * r);
  cam.lookAt(CENTER.x, 54, CENTER.z);
  renderer.showHand = false;
}

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  state.t += dt;
  // Chill track on the menu and in the lobby, the upbeat one while playing.
  setMusic(state.screen === 'game' && state.phase === 'playing' ? 'game' : 'menu');
  if (state.screen === 'menu') updateMenuCamera(dt);
  else updateGame(dt);
  for (const o of state.animated) o.userData.update(state.t);
  particles.update(dt);
  renderer.update(dt);
  hud.update(dt);
  renderer.render();
  input.endFrame();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------- wiring

function applyInputSettings(s) {
  input.binds = { attack: s.attackKey, place: s.placeKey };
  input.raw = s.rawInput;
}

window.addEventListener('keydown', (e) => {
  if (state.screen !== 'game' || hud.chatOpen) return;
  if (['F1', 'F3', 'F5', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (state.ui === 'inventory') {
    if (invUI.key(e)) return;
    if (e.code === 'KeyE') closeUI(true);
    else if (e.code === 'Escape') closeUI(false);
    return;
  }
  if (state.ui === 'shop' || state.ui === 'teams') {
    if (e.code === 'KeyE') closeUI(true);
    else if (e.code === 'Escape') closeUI(false);
    return;
  }
  if (state.ui === 'pause' || !input.locked) return;
  if (settings.toggleMove && toggleKey(e.code)) return;
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m) selectSlot(Number(m[1]) - 1);
  else if (e.code === 'KeyE') interact();
  else if (e.code === 'KeyQ') dropHeld(e.ctrlKey || e.metaKey);
  else if (e.code === 'KeyT' || e.code === 'Slash') { e.preventDefault(); openChat(); }
  else if (e.code === 'F5') local.cam = (local.cam + 1) % 3;
  else if (e.code === 'F1') { local.hudVisible = !local.hudVisible; hud.setVisible(local.hudVisible); }
  else if (e.code === 'F3') hud.toggleDebug();
  else if (e.code === 'Enter' && state.phase === 'lobby' && canStart()) state.session.requestStart();
});

async function withNet(fn) {
  menu.note('Connecting…');
  try {
    await fn();
  } catch (err) {
    console.error(err);
    menu.note(err?.message ? `${err.message}` : 'Could not connect. Check your internet and try again.');
  }
}

const menu = new Menu(document.getElementById('menu'), settings, {
  onPractice: (bots) => {
    const session = new HostSession({ kind: 'offline', mode: settings.mode, mapId: pickMap(), name: settings.name, bots, look: settings.look });
    enterGame(session);
  },
  onQuick: () => withNet(async () => {
    const mm = await import('./net/matchmaking.js');
    const r = await mm.quickPlay(settings.mode, (t) => menu.note(t));
    if (r.role === 'host') {
      enterGame(new HostSession({ peer: r.peer, kind: 'public', mode: settings.mode, mapId: pickMap(), name: settings.name, look: settings.look }));
    } else {
      const session = new ClientSession({ peer: r.peer, link: r.link, name: settings.name, look: settings.look });
      await session.hello();
      enterGame(session);
    }
  }),
  onCreate: () => withNet(async () => {
    const mm = await import('./net/matchmaking.js');
    const { peer, code } = await mm.hostPrivate();
    enterGame(new HostSession({ peer, kind: 'private', mode: settings.mode, mapId: pickMap(), name: settings.name, code, look: settings.look }));
  }),
  onJoin: (code) => {
    if (!code || code.length < 5) { menu.note('Type the 5-letter room code first.'); return; }
    withNet(async () => {
      const mm = await import('./net/matchmaking.js');
      const { peer, link } = await mm.joinPrivate(code);
      const session = new ClientSession({ peer, link, name: settings.name, look: settings.look });
      await session.hello();
      enterGame(session);
    });
  },
  onPreview: () => {
    const mode = MODES[settings.mode] ?? MODES.solo;
    loadMap(settings.map === 'random' ? (state.map?.id ?? MAPS[0].id) : settings.map, mode.teams);
  },
  onSettings: (s) => { setVolume(s.volume); setMusicVolume(s.music); applyInputSettings(s); state.session?.voice?.setVolume(s.voiceVolume); },
});

canvas.addEventListener('click', () => {
  if (state.screen === 'game' && !input.locked && !state.ui) { unlockAudio(); input.lock(); }
});
input.onLockChange = (locked) => {
  if (state.screen !== 'game') return;
  if (locked) {
    if (state.ui === 'pause') state.ui = null;
    hud.setPaused(false);
    hud.setResume(false);
  } else if (!state.ui && state.phase !== 'ended' && !hud.resumeShown) showPause();
};
hud.pause.addEventListener('click', (e) => {
  const act2 = e.target.closest('[data-act]')?.dataset.act;
  if (act2 === 'menu') leaveToMenu();
  else if (act2 === 'settings') menu.openSettings();
  else if (act2 === 'resume') { unlockAudio(); input.lock(); }
  else if (act2 === 'voice-join') { play('click'); joinVoice(); }
  else if (act2 === 'voice-leave') { play('click'); leaveVoice(); }
  else if (act2 === 'voice-mute') {
    const v = state.session?.voice;
    v?.setMuted(!v.muted);
    play('click');
    refreshPauseVoice();
  }
});
hud.more.addEventListener('click', () => { if (state.screen === 'game' && !state.ui) openUI('inventory'); });
document.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('beforeunload', (e) => {
  // Ctrl+W while sprinting would otherwise close the tab mid-game.
  if (state.screen === 'game') { e.preventDefault(); e.returnValue = ''; }
});

// Links like ?room=ABCDE join that room straight away.
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) setTimeout(() => menu.handlers.onJoin(roomParam.toUpperCase()), 300);

loadMap(settings.map !== 'random' && MAPS.some((m) => m.id === settings.map) ? settings.map : MAPS[0].id, (MODES[settings.mode] ?? MODES.solo).teams);
requestAnimationFrame(frame);

// Handy for poking at the game from the browser console.
window.blockwars = { state, local, renderer, input, openUI, FP, firstPerson, settings, checkTouchpad, toggles };
