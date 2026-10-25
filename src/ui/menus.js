// Main menu: name, mode, map, play buttons and settings. The map orbits behind it.
import * as THREE from 'three';
import { MODES, TEAMS } from '../config.js';
import { LOOK_OPTIONS, PlayerModel, resolveLook } from '../render/models.js';
import { play } from '../audio.js';
import { MAPS } from '../world/mapgen.js';
import { iconURL } from './hud.js';
import { IS_WINDOWS, keyName } from '../player/controls.js';

const SETTINGS_KEY = 'blockwars-settings';
const DEFAULTS = {
  name: '', mode: 'solo', map: 'random',
  sensitivity: 1, fov: 70, volume: 0.6, music: 0.5, bobbing: true, bridgeAssist: true,
  placeKey: 'KeyF', attackKey: 'KeyR', rawInput: !IS_WINDOWS, voiceVolume: 1,
};

// Keys the game already uses; the place/attack keys can't take these.
const TAKEN = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'KeyE', 'KeyQ', 'KeyT', 'Slash', 'Tab', 'Enter', 'Escape', 'F1', 'F3', 'F5', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Digit${n}`)]);

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}

function randomName() {
  const a = ['Swift', 'Lucky', 'Bouncy', 'Crafty', 'Sneaky', 'Mighty', 'Fluffy', 'Turbo', 'Pixel', 'Cosmic'];
  const b = ['Fox', 'Bridger', 'Miner', 'Panda', 'Knight', 'Builder', 'Dragon', 'Cactus', 'Ninja', 'Golem'];
  return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)] + Math.floor(Math.random() * 90 + 10);
}

const LOGO = 'BLOCKWARS'.split('').map((c, i) => `<span style="--c:${TEAMS[i % 8].css};--i:${i}">${c}</span>`).join('');

export class Menu {
  constructor(root, settings, handlers) {
    this.root = root;
    this.settings = settings;
    this.handlers = handlers;
    if (!settings.name) { settings.name = randomName(); saveSettings(settings); }
    this.render();
    // First visit: show the guide once.
    if (!settings.seenHowTo) {
      settings.seenHowTo = true;
      saveSettings(settings);
      setTimeout(() => this.openHowTo(), 400);
    }
  }

  render() {
    const s = this.settings;
    const modes = Object.values(MODES).map((m) => `
      <button class="mode ${m.id === s.mode ? 'active' : ''}" data-mode="${m.id}">
        <span class="mode-name">${m.label}</span>
        <span class="mode-desc">${m.teams} teams × ${m.size}</span>
        <span class="mode-dots">${TEAMS.slice(0, m.teams).map((t) => `<i style="background:${t.css}"></i>`).join('')}</span>
      </button>`).join('');
    const maps = [{ id: 'random', name: 'Random' }, ...MAPS].map((m) =>
      `<button class="chip ${m.id === s.map ? 'active' : ''}" data-map="${m.id}">${m.name}</button>`).join('');

    this.root.innerHTML = `
      <div class="menu-wrap">
        <div class="logo">${LOGO}</div>
        <div class="tagline">Protect your bed. Break theirs.</div>
        <div class="panel menu-card">
          <label class="field-label" for="name">Your name</label>
          <div class="name-row">
            <input id="name" class="input" maxlength="16" value="${s.name.replace(/"/g, '')}" spellcheck="false" autocomplete="off">
            <button class="btn btn-wood" data-act="wardrobe">Wardrobe</button>
          </div>
          <div class="field-label">Mode</div>
          <div class="modes">${modes}</div>
          <div class="field-label">Map</div>
          <div class="chips">${maps}</div>
          <button class="btn btn-green btn-big" data-act="quick">PLAY</button>
          <div class="row">
            <button class="btn btn-wood" data-act="create">Private Room</button>
            <div class="join">
              <input id="code" class="input code" maxlength="5" placeholder="CODE" spellcheck="false" autocomplete="off">
              <button class="btn btn-wood" data-act="join">Join</button>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-yellow" data-act="practiceBots">Practice vs Bots</button>
            <button class="btn btn-yellow" data-act="practice">Practice Solo</button>
          </div>
          <div class="menu-note" id="menu-note"></div>
        </div>
        <div class="menu-foot">
          <button class="link" data-act="howto">How to Play</button>
          <span>·</span>
          <button class="link" data-act="settings">Settings</button>
          <span>·</span>
          <button class="link" data-act="controls">Controls</button>
        </div>
      </div>`;

    const $ = (q) => this.root.querySelector(q);
    $('#name').addEventListener('input', (e) => {
      s.name = e.target.value.replace(/[^\w\- ]/g, '').slice(0, 16);
      saveSettings(s);
    });
    $('#code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    this.root.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
      s.mode = b.dataset.mode;
      saveSettings(s);
      play('click');
      this.root.querySelectorAll('.mode').forEach((o) => o.classList.toggle('active', o === b));
      this.handlers.onPreview?.();
    }));
    this.root.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => {
      s.map = b.dataset.map;
      saveSettings(s);
      play('click');
      this.root.querySelectorAll('[data-map]').forEach((o) => o.classList.toggle('active', o === b));
      this.handlers.onPreview?.();
    }));
    this.root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      play('click');
      const act = b.dataset.act;
      if (!s.name.trim()) { s.name = randomName(); $('#name').value = s.name; saveSettings(s); }
      if (act === 'settings') return this.openSettings();
      if (act === 'controls') return this.openControls();
      if (act === 'howto') return this.openHowTo();
      if (act === 'wardrobe') return this.openWardrobe();
      if (act === 'join') return this.handlers.onJoin?.($('#code').value);
      if (act === 'practiceBots') return this.handlers.onPractice?.(true);
      if (act === 'practice') return this.handlers.onPractice?.(false);
      this.handlers[{ quick: 'onQuick', create: 'onCreate' }[act]]?.();
    }));
  }

  note(text) {
    const n = this.root.querySelector('#menu-note');
    if (n) n.textContent = text;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  // Modals live in their own layer so they work both on the menu and in game.
  modal(html, onReady) {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="panel modal-card">${html}<button class="btn btn-green" data-close>Done</button></div>`;
    m.classList.remove('hidden');
    m.querySelector('[data-close]').addEventListener('click', () => {
      play('click');
      m.classList.add('hidden');
      const cb = this.onModalClose;
      this.onModalClose = null;
      cb?.();
    });
    onReady?.(m);
  }

  openSettings(onClose) {
    this.onModalClose = onClose;
    const s = this.settings;
    const toggle = (id, label, on) => `<label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
    this.modal(`
      <div class="panel-title">Settings</div>
      <label class="slider">Mouse sensitivity <b id="v-sens">${s.sensitivity.toFixed(2)}</b>
        <input type="range" id="sens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"></label>
      <label class="slider">Field of view <b id="v-fov">${s.fov}</b>
        <input type="range" id="fov" min="50" max="110" step="1" value="${s.fov}"></label>
      <label class="slider">Sound effects <b id="v-vol">${Math.round(s.volume * 100)}%</b>
        <input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="slider">Music <b id="v-music">${Math.round(s.music * 100)}%</b>
        <input type="range" id="music" min="0" max="1" step="0.05" value="${s.music}"></label>
      <label class="slider">Voice chat <b id="v-voice">${Math.round(s.voiceVolume * 100)}%</b>
        <input type="range" id="voice" min="0" max="1" step="0.05" value="${s.voiceVolume}"></label>
      ${toggle('bob', 'View bobbing', s.bobbing)}
      ${toggle('assist', 'Bridge assist (outline + place at the edge when aiming past it)', s.bridgeAssist)}
      ${toggle('raw', 'Raw mouse input (best with a mouse, turn off for a laptop touchpad)', s.rawInput)}
      <div class="bind-row"><span>Place / use key <small>(as well as right click)</small></span><button class="btn-key" data-bind="placeKey">${keyName(s.placeKey)}</button></div>
      <div class="bind-row"><span>Attack / break key <small>(as well as left click)</small></span><button class="btn-key" data-bind="attackKey">${keyName(s.attackKey)}</button></div>
      ${IS_WINDOWS ? `<div class="settings-note">Laptop touchpad on Windows? Windows ignores taps while you hold a key (like S or Shift when bridging), so ${s.placeKey ? `use the <b>${keyName(s.placeKey)}</b> key to place` : 'set a Place key above'}. Or open Windows Settings → Bluetooth &amp; devices → Touchpad → Taps and set <b>Touchpad sensitivity</b> to <b>Most sensitive</b>.</div>` : ''}`, (m) => {
      const bind = (id, key, fmt) => m.querySelector(`#${id}`).addEventListener('input', (e) => {
        s[key] = Number(e.target.value);
        m.querySelector(`#v-${id}`).textContent = fmt(s[key]);
        saveSettings(s);
        this.handlers.onSettings?.(s);
      });
      bind('sens', 'sensitivity', (v) => v.toFixed(2));
      bind('fov', 'fov', (v) => v);
      bind('vol', 'volume', (v) => `${Math.round(v * 100)}%`);
      bind('music', 'music', (v) => `${Math.round(v * 100)}%`);
      bind('voice', 'voiceVolume', (v) => `${Math.round(v * 100)}%`);
      const check = (id, key) => m.querySelector(`#${id}`).addEventListener('change', (e) => {
        s[key] = e.target.checked;
        saveSettings(s);
        this.handlers.onSettings?.(s);
      });
      check('bob', 'bobbing');
      check('assist', 'bridgeAssist');
      check('raw', 'rawInput');

      // Click a key button, then press the key you want (Esc cancels,
      // Backspace clears it).
      m.querySelectorAll('[data-bind]').forEach((btn) => btn.addEventListener('click', () => {
        const key = btn.dataset.bind;
        btn.textContent = 'Press a key…';
        btn.classList.add('listening');
        const done = () => {
          window.removeEventListener('keydown', onKey, true);
          btn.classList.remove('listening');
          m.querySelectorAll('[data-bind]').forEach((b) => { b.textContent = keyName(s[b.dataset.bind]); });
        };
        const onKey = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.code === 'Escape') { done(); return; }
          if (TAKEN.has(e.code)) { btn.textContent = `${keyName(e.code)} is taken`; play('deny'); return; }
          const code = e.code === 'Backspace' || e.code === 'Delete' ? null : e.code;
          const other = key === 'placeKey' ? 'attackKey' : 'placeKey';
          if (code && s[other] === code) s[other] = null;
          s[key] = code;
          saveSettings(s);
          this.handlers.onSettings?.(s);
          play('click');
          done();
        };
        window.addEventListener('keydown', onKey, true);
      }));
    });
  }

  // Customize your character: pick from the same parts the game uses.
  // Your shirt is always your team's color in a match.
  openWardrobe() {
    const s = this.settings;
    let look = { ...(s.look ?? {}) };
    const FIELDS = [
      ['skin', 'Skin'], ['hairStyle', 'Hair style'], ['hair', 'Hair color'], ['eyes', 'Eyes'],
      ['shirt', 'Top'], ['pants', 'Pants'], ['shoes', 'Shoes'], ['cap', 'Cap color'],
    ];
    const NAMES = { short: 'Short', fringe: 'Fringe', side: 'Side part', long: 'Long', cap: 'Cap', spiky: 'Spiky', hoodie: 'Hoodie', tee: 'T-shirt' };
    const rows = () => {
      const cur = resolveLook(s.name, look);
      return FIELDS.map(([key, label]) => `<div class="wr-row"><span class="wr-label">${label}</span><div class="wr-choices">${
        LOOK_OPTIONS[key].map((v) => v.startsWith('#')
          ? `<button class="wr-swatch ${cur[key] === v ? 'on' : ''}" data-f="${key}" data-v="${v}" style="background:${v}"></button>`
          : `<button class="chip ${cur[key] === v ? 'active' : ''}" data-f="${key}" data-v="${v}">${NAMES[v] ?? v}</button>`).join('')
      }</div></div>`).join('');
    };
    this.modal(`<div class="panel-title">Wardrobe</div>
      <div class="wardrobe"><canvas class="wr-preview" width="220" height="300"></canvas><div class="wr-opts">${rows()}</div></div>
      <div class="row"><button class="btn btn-wood" data-random>Random</button><button class="btn btn-wood" data-reset>Reset</button></div>`, (m) => {
      // A little 3D preview that spins while the wardrobe is open.
      const canvas = m.querySelector('.wr-preview');
      const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      gl.setSize(220, 300, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(1, 2, -2);
      scene.add(sun);
      const cam = new THREE.PerspectiveCamera(32, 220 / 300, 0.1, 50);
      cam.position.set(0, 1.15, -4.2);
      cam.lookAt(0, 0.95, 0);
      let model = null;
      const rebuild = () => {
        if (model) scene.remove(model.root);
        model = new PlayerModel({ team: 0, name: s.name, showName: false, look });
        model.shadow && (model.shadow.visible = false);
        scene.add(model.root);
      };
      rebuild();
      let last = performance.now();
      const spin = (now) => {
        if (m.classList.contains('hidden') || !m.contains(canvas)) { gl.dispose(); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        model.root.rotation.y += dt * 0.8;
        model.animate(dt, { speed: 0 });
        gl.render(scene, cam);
        requestAnimationFrame(spin);
      };
      requestAnimationFrame(spin);

      const save = () => {
        s.look = Object.keys(look).length ? look : null;
        saveSettings(s);
        m.querySelector('.wr-opts').innerHTML = rows();
        rebuild();
      };
      m.addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (b) { look = { ...look, [b.dataset.f]: b.dataset.v }; play('click'); save(); return; }
        if (e.target.closest('[data-random]')) {
          look = Object.fromEntries(Object.entries(LOOK_OPTIONS).map(([k, opts]) => [k, opts[Math.floor(Math.random() * opts.length)]]));
          play('pop'); save();
        }
        if (e.target.closest('[data-reset]')) { look = {}; play('click'); save(); }
      });
    });
  }

  // A short paged guide for new players.
  openHowTo(onClose) {
    this.onModalClose = onClose;
    const img = (id) => `<img src="${iconURL(id)}">`;
    const pages = [
      { title: 'Protect your bed', icons: ['block:24', 'block:32', 'block:9'], text: `Every team has a bed on its island. While your bed stands, you respawn when you die. <b>Break the other beds</b> and knock those players out for good. The <b>last team standing wins</b>.` },
      { title: 'Collect money', icons: ['silver', 'coin', 'gold', 'diamond'], text: `<b>Silver</b> and <b>Coins</b> drop at your base generator: stand on it to collect. <b>Gold</b> is on the small islands between bases, and <b>Diamonds</b> are on the big middle island.` },
      { title: 'Go shopping', icons: ['stone_sword', 'iron_chestplate', 'golden_apple'], text: `Walk up to the <b>goblin</b> and press <b>E</b> for the Item Shop (Silver, Gold, Diamonds). The <b>tinker</b> sells <b>Team Upgrades</b> and traps for Coins. Buy blocks first!` },
      { title: 'Bridge across', icons: ['block:24', 'bridge_egg', 'popup_tower'], text: `Hold <b>Shift</b> at the edge (you won’t fall), look down at the side of the block and <b>right-click</b>${this.settings.placeKey ? ` (or press <b>${keyName(this.settings.placeKey)}</b>)` : ''} to place. The white outline shows where it goes. <b>Instant Bridge</b> and <b>Pop-up Tower</b> build themselves where you aim.` },
      { title: 'Fight & break beds', icons: ['iron_sword', 'bow', 'fireball', 'block:54'], text: `<b>Left-click</b> to hit (jump while hitting for crits) and hold it to break blocks. Cover your bed with blocks, and use pickaxes, fireballs and TNT to get through other teams’ defences.` },
      { title: 'Play together', icons: ['ender_pearl', 'magic_milk'], text: `<b>PLAY</b> finds a public game. A <b>Private Room</b> gives you a code to share with friends. In the lobby press <b>E</b> to pick a team and <b>T</b> to chat. Online games ask if you want <b>voice chat</b> (join or leave any time from the Esc menu). Hold <b>Tab</b> to see everyone. Want to warm up? Try <b>Practice vs Bots</b>.` },
    ];
    let i = 0;
    const page = () => {
      const p = pages[i];
      return `<div class="howto-icons">${p.icons.map(img).join('')}</div>
        <div class="howto-title">${i + 1}. ${p.title}</div>
        <div class="howto-text">${p.text}</div>
        <div class="howto-nav">
          <button class="btn btn-wood" data-prev ${i === 0 ? 'disabled' : ''}>Back</button>
          <span class="howto-dots">${pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</span>
          <button class="btn btn-yellow" data-next>${i === pages.length - 1 ? 'Got it!' : 'Next'}</button>
        </div>`;
    };
    this.modal(`<div class="panel-title">How to Play</div><div class="howto">${page()}</div>`, (m) => {
      const box = m.querySelector('.howto');
      box.addEventListener('click', (e) => {
        if (e.target.closest('[data-prev]') && i > 0) i--;
        else if (e.target.closest('[data-next]')) {
          if (i === pages.length - 1) { m.querySelector('[data-close]').click(); return; }
          i++;
        } else return;
        play('click');
        box.innerHTML = page();
      });
    });
  }

  openControls(onClose) {
    this.onModalClose = onClose;
    const rows = [
      ['W A S D', 'Move'], ['Space', 'Jump · double-tap to fly in the lobby'], ['Shift', 'Sneak (won’t fall off edges)'],
      ['Ctrl / double-tap W', 'Sprint'],
      [`Left click${this.settings.attackKey ? ` / ${keyName(this.settings.attackKey)}` : ''}`, 'Attack / break (hold)'],
      [`Right click${this.settings.placeKey ? ` / ${keyName(this.settings.placeKey)}` : ''}`, 'Place / use / eat (hold)'],
      ['E', 'Talk to a shopkeeper · pick team in lobby · otherwise inventory'], ['Q', 'Drop item (Ctrl+Q: whole stack)'], ['T', 'Chat'],
      ['1–9 / scroll', 'Pick hotbar slot'], ['F5', 'Change camera'], ['F1', 'Hide HUD'], ['F3', 'Debug info'], ['Esc', 'Pause'],
    ];
    const tips = [
      ['Goal', 'Protect your bed and break everyone else’s. With your bed gone you can’t respawn. The last team standing wins.'],
      ['Money', 'Your base makes Silver and Coins. Gold islands sit between the bases and Diamonds are in the middle.'],
      ['Item Shop', 'Talk to the goblin (E). Silver, Gold and Diamonds buy blocks, weapons, armor and tools.'],
      ['Team Upgrades', 'Talk to the tinker (E). Coins buy upgrades and traps for your whole team.'],
      ['Bridging', 'Hold Shift at the edge, look down at the side of the block and right-click to place. The white outline shows where it goes.'],
      ['Instant Bridge', 'Aim at the edge of a block and right-click: a 3-wide bridge with railings builds out the way you face.'],
      ['Pop-up Tower', 'Aim at the ground and right-click: a 4x4 tower with a ladder builds itself there.'],
      ['Fireball / TNT', 'Fireballs explode where they hit. TNT lights itself when placed. Both break placed blocks, but not glass or beds.'],
      ['Ender Pearl', 'Throw it and you teleport to where it lands (it costs a little health).'],
    ];
    this.modal(`<div class="panel-title">Controls</div><div class="controls">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
      <div class="panel-title" style="font-size:24px;margin-top:6px">How to play</div>
      <div class="controls">${tips.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>`);
  }
}
