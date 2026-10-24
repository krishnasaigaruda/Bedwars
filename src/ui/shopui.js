// Shop windows. 'items': category tabs on the left, offer cards on the
// right. 'upgrades': the team upgrade cards, paid with Coins. Your money is
// listed along the bottom; click a card to buy.
import { getItem } from '../game/items.js';
import { CATEGORIES, CURRENCIES, MAX_TRAPS, TRAPS, TRAP_COSTS, UPGRADES, resolveOffer, resolveUpgrade } from '../game/shop.js';
import { iconURL } from './hud.js';

export class ShopUI {
  constructor(root, { onBuy, onUpgrade, onTrap, onClose }) {
    this.root = root;
    this.onBuy = onBuy;
    this.onUpgrade = onUpgrade;
    this.onTrap = onTrap;
    this.onClose = onClose;
    this.cat = 'quick';
    this.open = false;
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-cat]');
      if (tab) { this.cat = tab.dataset.cat; this.render(); return; }
      const card = e.target.closest('[data-offer], [data-upgrade], [data-trap]');
      if (card) {
        const d = card.dataset;
        const why = d.offer ? this.onBuy(d.offer) : d.upgrade ? this.onUpgrade(d.upgrade) : this.onTrap(d.trap);
        this.flash = { key: d.offer ?? d.upgrade ?? d.trap, ok: !why };
        this.noteText = { text: why || 'Purchased!', ok: !why };
        this.render();
        return;
      }
      if (e.target.closest('[data-close]') || e.target === root) this.onClose();
    });
  }

  show(player, kind, upgrades, traps) {
    this.p = player;
    this.kind = kind;
    this.upgrades = upgrades;
    this.traps = traps;
    this.open = true;
    this.noteText = null;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  cost(c) {
    return Object.entries(c ?? {}).map(([k, n]) => `<span class="cost"><img src="${iconURL(k)}">${n} ${CURRENCIES[k].name}</span>`).join(' ');
  }

  card(attr, key, icon, name, label, state, title, count = 1) {
    const flash = this.flash?.key === key ? (this.flash.ok ? 'flash-ok' : 'flash-no') : '';
    return `<button class="offer ${state} ${flash}" data-${attr}="${key}" title="${title}">
      <div class="offer-icon"><img src="${iconURL(icon)}">${count > 1 ? `<span>${count}</span>` : ''}</div>
      <div class="offer-name">${name}</div>
      <div class="offer-cost">${label}</div></button>`;
  }

  render() {
    if (!this.open) return;
    const p = this.p;
    const afford = (c) => Object.entries(c ?? {}).every(([k, n]) => p.inv.count(k) >= n);
    let body, title, wallet;
    if (this.kind === 'upgrades') {
      title = 'Team Upgrades';
      const cards = UPGRADES.map((u) => {
        const r = resolveUpgrade(u, this.upgrades[u.id]);
        const state = r.maxed ? 'maxed' : afford(r.price) ? 'ok' : 'poor';
        const label = r.maxed ? 'Maxed' : this.cost(r.price);
        return this.card('upgrade', u.id, u.icon, r.label, `${label}<small>${r.maxed ? '' : r.next}</small>`, state, u.desc);
      }).join('');
      const q = this.traps ?? [];
      const trapCost = q.length < MAX_TRAPS ? { coin: TRAP_COSTS[q.length] } : null;
      const trapCards = TRAPS.map((t) => {
        const state = !trapCost ? 'maxed' : afford(trapCost) ? 'ok' : 'poor';
        return this.card('trap', t.id, t.icon, t.name, `${trapCost ? this.cost(trapCost) : 'Queue full'}<small>${t.desc}</small>`, state, t.desc);
      }).join('');
      const queue = q.length ? q.map((id) => TRAPS.find((t) => t.id === id)?.name).join(' → ') : 'empty';
      body = `<div class="shop-grid upgrades">${cards}
        <div class="trap-head">Traps · queue ${q.length}/${MAX_TRAPS}: <b>${queue}</b></div>${trapCards}</div>`;
      wallet = ['coin'];
    } else {
      title = 'Item Shop';
      const cat = CATEGORIES.find((c) => c.id === this.cat) ?? CATEGORIES[0];
      const tabs = CATEGORIES.map((c) => `
        <button class="shop-tab ${c.id === cat.id ? 'active' : ''}" data-cat="${c.id}">
          <img src="${iconURL(c.icon === 'block:24' ? `block:${24 + p.team}` : c.icon)}"><span>${c.name}</span></button>`).join('');
      const cards = cat.offers.map((key) => {
        const o = resolveOffer(key, p);
        const state = o.status !== 'ok' ? o.status : afford(o.cost) ? 'ok' : 'poor';
        const label = state === 'owned' ? 'Owned' : state === 'maxed' ? 'Maxed' : this.cost(o.cost);
        return this.card('offer', key, o.icon, o.name, label, state, o.desc, o.count);
      }).join('');
      body = `<div class="shop-tabs">${tabs}</div><div class="shop-grid">${cards}</div>`;
      wallet = ['silver', 'gold', 'diamond'];
    }
    const money = wallet.map((k) => `<span class="wallet-item"><img src="${iconURL(k)}"><b>${p.inv.count(k)}</b> ${getItem(k).name}</span>`).join('');
    const note = this.noteText ? `<div class="shop-note ${this.noteText.ok ? 'ok' : 'no'}">${this.noteText.text}</div>` : '<div class="shop-note"></div>';
    this.root.innerHTML = `
      <div class="panel shop-panel ${this.kind}">
        <button class="close-x" data-close>✕</button>
        <div class="panel-title">${title}</div>
        <div class="shop-body">${body}</div>
        <div class="shop-foot"><div class="wallet">${money}</div>${note}</div>
      </div>`;
    this.flash = null;
    this.lastKey = this.stateKey();
  }

  stateKey() {
    return `${this.p.inv.version}|${this.kind === 'upgrades' ? Object.values(this.upgrades).join(',') + (this.traps ?? []).join(',') : ''}`;
  }

  update() {
    if (this.open && this.stateKey() !== this.lastKey) this.render();
  }
}
