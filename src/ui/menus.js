// Main menu: name, mode, map, play buttons and settings. The map orbits behind it.
import { MODES, TEAMS } from '../config.js';
import { play } from '../audio.js';
import { MAPS } from '../world/mapgen.js';
import { iconURL } from './hud.js';

const SETTINGS_KEY = 'blockwars-settings';
const DEFAULTS = {
  name: '', mode: 'solo', map: 'random',
  sensitivity: 1, fov: 70, volume: 0.6, bobbing: true, bridgeAssist: true,
};

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
          <input id="name" class="input" maxlength="16" value="${s.name.replace(/"/g, '')}" spellcheck="false" autocomplete="off">
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
      <label class="slider">Volume <b id="v-vol">${Math.round(s.volume * 100)}%</b>
        <input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      ${toggle('bob', 'View bobbing', s.bobbing)}
      ${toggle('assist', 'Bridge assist (outline + place at the edge when aiming past it)', s.bridgeAssist)}`, (m) => {
      const bind = (id, key, fmt) => m.querySelector(`#${id}`).addEventListener('input', (e) => {
        s[key] = Number(e.target.value);
        m.querySelector(`#v-${id}`).textContent = fmt(s[key]);
        saveSettings(s);
        this.handlers.onSettings?.(s);
      });
      bind('sens', 'sensitivity', (v) => v.toFixed(2));
      bind('fov', 'fov', (v) => v);
      bind('vol', 'volume', (v) => `${Math.round(v * 100)}%`);
      const check = (id, key) => m.querySelector(`#${id}`).addEventListener('change', (e) => {
        s[key] = e.target.checked;
        saveSettings(s);
        this.handlers.onSettings?.(s);
      });
      check('bob', 'bobbing');
      check('assist', 'bridgeAssist');
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
      { title: 'Bridge across', icons: ['block:24', 'bridge_egg', 'popup_tower'], text: `Hold <b>Shift</b> at the edge (you won’t fall), look down at the side of the block and <b>right-click</b> to place. The white outline shows where it goes. <b>Instant Bridge</b> and <b>Pop-up Tower</b> build themselves where you aim.` },
      { title: 'Fight & break beds', icons: ['iron_sword', 'bow', 'fireball', 'block:54'], text: `<b>Left-click</b> to hit (jump while hitting for crits) and hold it to break blocks. Cover your bed with blocks, and use pickaxes, fireballs and TNT to get through other teams’ defences.` },
      { title: 'Play together', icons: ['ender_pearl', 'magic_milk'], text: `<b>PLAY</b> finds a public game. A <b>Private Room</b> gives you a code to share with friends. In the lobby press <b>E</b> to pick a team and <b>T</b> to chat. Hold <b>Tab</b> to see everyone. Want to warm up? Try <b>Practice vs Bots</b>.` },
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
      ['Ctrl / double-tap W', 'Sprint'], ['Left click', 'Attack / break (hold)'], ['Right click', 'Place / use / eat (hold)'],
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
