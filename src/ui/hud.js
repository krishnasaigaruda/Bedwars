// In-game overlay, styled after minefun: wooden hotbar with number tabs,
// chunky hearts, a hunger bar, a message feed, countdown banner,
// scoreboard, interaction prompt and death screen.
import { getItem, itemHint } from '../game/items.js';
import { itemIcon } from '../render/sprites.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

const iconCache = new Map();
export function iconURL(id, tint) {
  const key = `${id}|${tint ?? ''}`;
  if (!iconCache.has(key)) {
    const c = itemIcon(id, tint);
    iconCache.set(key, c ? c.toDataURL() : '');
  }
  return iconCache.get(key);
}

export const MIC_ICON = '<svg class="mic" viewBox="0 0 12 16"><rect x="3.5" y="1" width="5" height="9" rx="2.5"/><path d="M1.5 7.5a4.5 4.5 0 0 0 9 0M6 12v3M3.5 15h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
export const MUTED_ICON = '<svg class="mic muted" viewBox="0 0 12 16"><rect x="3.5" y="1" width="5" height="9" rx="2.5"/><path d="M1.5 7.5a4.5 4.5 0 0 0 9 0M6 12v3M3.5 15h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M1 1l10 14" stroke="#ff4d4d" stroke-width="2" stroke-linecap="round"/></svg>';

const HEART = (cls) => `<svg class="heart ${cls}" viewBox="0 0 9 9"><path d="M1 0h2v1h1v1h1V1h1V0h2v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z"/></svg>`;

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs>
      <linearGradient id="heart-half"><stop offset="50%" stop-color="#ff3b3b"/><stop offset="50%" stop-color="#4a2020"/></linearGradient>
      <linearGradient id="heart-gold-half"><stop offset="50%" stop-color="#ffcc2e"/><stop offset="50%" stop-color="transparent"/></linearGradient>
      </defs></svg>`;
    el('div', 'crosshair', root);
    this.hurtFx = el('div', 'hurt-fx', root);
    this.feed = el('div', 'feed', root);
    this.banner = el('div', 'banner hidden', root);
    this.topbar = el('div', 'topbar hidden', root);
    this.board = el('div', 'board hidden', root);
    this.prompt = el('div', 'prompt hidden', root);
    this.title = el('div', 'title', root);
    this.titleMain = el('div', 'title-main', this.title);
    this.titleSub = el('div', 'title-sub', this.title);
    this.action = el('div', 'actionbar', root);
    this.itemName = el('div', 'item-name', root);
    this.tip = el('div', 'tip', root);
    this.debug = el('div', 'debug hidden', root);
    this.effects = el('div', 'effects', root);
    this.keys = el('div', 'keyhints', root, `
      <div class="kh"><b>E</b><span>Interact / Bag</span></div>
      <div class="kh"><b>Q</b><span>Drop</span></div>
      <div class="kh"><b>Esc</b><span>Menu</span></div>`);

    const bottom = el('div', 'bottom', root);
    const stats = el('div', 'stats', bottom);
    this.hearts = el('div', 'hearts', stats);
    const hunger = el('div', 'hunger', stats);
    this.hungerFill = el('div', 'hunger-fill', hunger);
    el('div', 'hunger-label', hunger, 'HUNGER');
    this.hotbar = el('div', 'hotbar', bottom);
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot', this.hotbar);
      el('span', 'slot-key', s, String(i + 1));
      const icon = el('img', 'slot-icon', s);
      icon.draggable = false;
      const count = el('span', 'slot-count', s);
      this.slots.push({ s, icon, count, key: '' });
    }
    this.more = el('button', 'slot slot-more', this.hotbar, '<i></i><i></i><i></i>');
    this.more.title = 'Inventory (E)';

    this.chatBox = el('div', 'chat', root);
    this.chatInput = el('input', 'chat-input hidden', root);
    this.chatInput.maxLength = 120;
    this.chatInput.placeholder = 'Say something… (Enter to send, Esc to cancel)';
    this.chatInput.spellcheck = false;
    this.end = el('div', 'end hidden', root);
    this.tab = el('div', 'tablist hidden', root);
    this.blind = el('div', 'blind hidden', root);
    this.death = el('div', 'death hidden', root, '<div class="death-title">YOU DIED!</div><div class="death-sub"></div>');
    this.resume = el('div', 'resume hidden', root, '<b>Click</b> to keep playing');
    this.pause = el('div', 'pause hidden', root);
    this.pause.innerHTML = `<div class="panel pause-card"><div class="panel-title">Paused</div>
      <button class="btn btn-green" data-act="resume">Back to Game</button>
      <button class="btn btn-yellow" data-act="start" hidden>Start Game Now</button>
      <div class="pause-voice"></div>
      <button class="btn btn-wood" data-act="settings">Settings</button>
      <button class="btn btn-red" data-act="menu">Leave Game</button></div>`;
    this.pauseVoice = this.pause.querySelector('.pause-voice');
    this.pauseStart = this.pause.querySelector('[data-act="start"]');
    // Host only: a start button under the lobby banner.
    this.startBtn = el('button', 'btn btn-green start-btn hidden', root, 'START NOW <kbd>Enter</kbd>');
    // Windows only: proves touchpad taps get through while a key is held.
    this.touchCheck = el('div', 'pause hidden', root, `<div class="panel touch-card">
      <div class="panel-title">Touchpad Check</div>
      <div class="voice-text">Windows ignores touchpad taps while you hold a key, so you couldn’t build while moving. Turn that off once:</div>
      <ol class="touch-steps">
        <li><a class="btn btn-wood note-btn" href="ms-settings:devices-touchpad">Open touchpad settings</a></li>
        <li>Under <b>Taps</b>, set <b>Touchpad sensitivity</b> to <b>Most sensitive</b>.</li>
        <li>Come back, <b>hold W</b> and <b>tap the box</b>.</li>
      </ol>
      <div class="touch-pad" data-pad>Hold <b>W</b> and tap here</div>
      <div class="touch-status" data-status>Already set up, or using a mouse? Just hold W and tap.</div>
      <div class="touch-or">Can’t change the setting?</div>
      <button class="btn btn-wood" data-toggle>Use toggle movement</button>
      <div class="voice-small">Tap W to start walking and tap it again to stop (same for A, S, D and Shift), so no key is held down and Windows lets your taps through.</div>
      <button class="btn btn-red" data-leave>Leave</button></div>`);
    this.voice = el('div', 'voice-panel hidden', root);
    this.clicks = el('div', 'click-monitor hidden', root);
    this.voiceAsk = el('div', 'pause hidden', root, `<div class="panel voice-card">
      <div class="voice-big">${MIC_ICON}</div>
      <div class="panel-title">Voice Chat</div>
      <div class="voice-text">Do you want to join the voice chat and talk with the other players in this game?</div>
      <div class="voice-buttons"><button class="btn btn-green" data-voice="yes">Yes</button><button class="btn btn-red" data-voice="no">No</button></div>
      <div class="voice-small">You can join or leave any time from the <b>Esc</b> menu.</div></div>`);

    this.timers = { title: 0, action: 0, item: 0, tip: 0 };
    this.invVersion = -1;
    this.hp = null;
  }

  setHotbar(inv) {
    if (inv.version === this.invVersion && this.selected === inv.selected) return;
    this.invVersion = inv.version;
    this.selected = inv.selected;
    for (let i = 0; i < 9; i++) {
      const st = inv.slots[i];
      const ui = this.slots[i];
      const key = st ? `${st.id}|${st.tint ?? ''}` : '';
      if (ui.key !== key) {
        ui.key = key;
        if (st) { ui.icon.src = iconURL(st.id, st.tint); ui.icon.style.display = ''; } else ui.icon.style.display = 'none';
      }
      ui.count.textContent = st && st.count > 1 ? st.count : '';
      ui.s.classList.toggle('selected', i === inv.selected);
    }
  }

  pulseSlot(i) {
    const s = this.slots[i]?.s;
    if (!s) return;
    s.classList.remove('pulse');
    void s.offsetWidth;
    s.classList.add('pulse');
  }

  showItemName(id) {
    const item = getItem(id);
    if (!item) return;
    const hint = itemHint(id);
    this.itemName.innerHTML = `${item.name}${hint ? `<small>${hint}</small>` : ''}`;
    this.itemName.classList.add('show');
    this.timers.item = hint ? 3.2 : 1.6;
  }

  setHealth(hp, absorption = 0) {
    const key = `${Math.ceil(hp)}|${Math.ceil(absorption)}`;
    if (this.hp === key) return;
    const dropped = this.hp && Math.ceil(hp) < Number(this.hp.split('|')[0]);
    this.hp = key;
    let html = '';
    const h = Math.ceil(hp);
    for (let i = 0; i < 10; i++) {
      const v = h - i * 2;
      html += HEART(v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
    }
    const a = Math.ceil(absorption);
    for (let i = 0; i < Math.ceil(a / 2); i++) html += HEART(a - i * 2 >= 2 ? 'gold' : 'gold half');
    this.hearts.innerHTML = html;
    this.hearts.classList.toggle('low', h <= 6);
    if (dropped) { this.hearts.classList.remove('shake'); void this.hearts.offsetWidth; this.hearts.classList.add('shake'); }
  }

  setHunger(food) {
    const pct = Math.max(0, Math.min(1, food / 20)) * 100;
    this.hungerFill.style.width = `${pct}%`;
    this.hungerFill.classList.toggle('low', food <= 6);
  }

  hurt() {
    this.hurtFx.classList.remove('on');
    void this.hurtFx.offsetWidth;
    this.hurtFx.classList.add('on');
  }

  showTitle(main, sub = '', seconds = 2.5, color = '#fff') {
    this.titleMain.textContent = main;
    this.titleMain.style.color = color;
    this.titleSub.textContent = sub;
    this.title.classList.add('show');
    this.timers.title = seconds;
  }

  // A bigger hint card under the top bar (e.g. how to place blocks).
  showTip(html, seconds = 10) {
    this.tip.innerHTML = html;
    this.tip.classList.add('show');
    this.timers.tip = seconds;
  }

  showAction(text, seconds = 2) {
    this.action.textContent = text;
    this.action.classList.add('show');
    this.timers.action = seconds;
  }

  // Top-left message feed (joins, bed breaks, purchases...).
  message(html, seconds = 6) {
    const m = el('div', 'feed-msg', this.feed, html);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
    setTimeout(() => { m.classList.add('out'); setTimeout(() => m.remove(), 400); }, seconds * 1000);
  }

  setStart(on) { this.startBtn.classList.toggle('hidden', !on); }

  setBanner(html) {
    if (html == null) { this.banner.classList.add('hidden'); this.bannerHtml = null; return; }
    if (html !== this.bannerHtml) { this.bannerHtml = html; this.banner.innerHTML = html; }
    this.banner.classList.remove('hidden');
  }

  setBoard(html) {
    if (html == null) { this.board.classList.add('hidden'); return; }
    if (html !== this.boardHtml) { this.boardHtml = html; this.board.innerHTML = html; }
    this.board.classList.remove('hidden');
  }

  setPrompt(text) {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    if (text !== this.promptText) { this.promptText = text; this.prompt.innerHTML = `<b>E</b> ${text}`; }
    this.prompt.classList.remove('hidden');
  }

  setDeath(sub) {
    this.death.classList.toggle('hidden', sub == null);
    if (sub != null) this.death.querySelector('.death-sub').textContent = sub;
  }

  // Status effects (team upgrades, potions), like Minecraft's effect list.
  setEffects(list) {
    const html = list.map((e) => `<div class="fx ${e.on ? 'on' : ''}"><img src="${iconURL(e.icon)}"><div><b>${e.name}</b><span>${e.sub ?? ''}</span></div></div>`).join('');
    if (html !== this.fxHtml) { this.fxHtml = html; this.effects.innerHTML = html; }
  }

  // ---------------------------------------------------------- chat

  chat(html) {
    const m = el('div', 'chat-msg', this.chatBox, html);
    while (this.chatBox.children.length > 60) this.chatBox.firstChild.remove();
    setTimeout(() => m.classList.add('old'), 10000);
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
  }

  openChat(onSend, onClose) {
    this.chatBox.classList.add('open');
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
    const done = (send) => {
      this.chatInput.removeEventListener('keydown', key);
      const text = this.chatInput.value.trim();
      this.chatInput.blur();
      this.chatInput.classList.add('hidden');
      this.chatBox.classList.remove('open');
      if (send && text) onSend(text);
      onClose();
    };
    const key = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    this.chatInput.addEventListener('keydown', key);
  }

  get chatOpen() { return !this.chatInput.classList.contains('hidden'); }

  setEnd(html) {
    this.end.classList.toggle('hidden', html == null);
    if (html != null) this.end.innerHTML = html;
  }

  setTopbar(html) {
    this.topbar.classList.toggle('hidden', html == null);
    if (html != null && html !== this.topHtml) { this.topHtml = html; this.topbar.innerHTML = html; }
  }

  setTab(html) {
    this.tab.classList.toggle('hidden', html == null);
    if (html != null && html !== this.tabHtml) { this.tabHtml = html; this.tab.innerHTML = html; }
  }

  setVoice(html) {
    this.voice.classList.toggle('hidden', html == null);
    if (html != null && html !== this.voiceHtml) { this.voiceHtml = html; this.voice.innerHTML = html; }
  }
  setClicks(html) {
    this.clicks.classList.toggle('hidden', html == null);
    if (html != null && html !== this.clicksHtml) { this.clicksHtml = html; this.clicks.innerHTML = html; }
  }
  setTouchCheck(on) { this.touchCheck.classList.toggle('hidden', !on); }
  get touchCheckShown() { return !this.touchCheck.classList.contains('hidden'); }
  setVoiceAsk(on) { this.voiceAsk.classList.toggle('hidden', !on); }
  get voiceAskShown() { return !this.voiceAsk.classList.contains('hidden'); }

  setBlind(on) { this.blind.classList.toggle('hidden', !on); }

  // A small hint (not the pause menu) after closing a screen with Esc.
  setResume(on) { this.resume.classList.toggle('hidden', !on); }
  get resumeShown() { return !this.resume.classList.contains('hidden'); }

  setPaused(p) { this.pause.classList.toggle('hidden', !p); }
  setDebug(text) { this.debug.textContent = text; }
  toggleDebug() { this.debug.classList.toggle('hidden'); }
  setVisible(v) { this.root.classList.toggle('hud-off', !v); }

  update(dt) {
    for (const k of ['title', 'action', 'item', 'tip']) {
      if (this.timers[k] <= 0) continue;
      this.timers[k] -= dt;
      if (this.timers[k] <= 0) ({ title: this.title, action: this.action, item: this.itemName, tip: this.tip })[k].classList.remove('show');
    }
  }
}
