// Inventory screen (and chest screen) with Minecraft click rules: left click
// picks up / drops / swaps a stack, right click splits or places one,
// shift-click moves between hotbar and backpack (or between chest and
// inventory), number keys swap with the hotbar, Q drops, and clicking outside
// the window throws the held stack.
import { getItem, stackSize } from '../game/items.js';
import { iconURL } from './hud.js';

const ARMOR_NAMES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];

export class InventoryUI {
  constructor(root, { onClose, onDrop, onChange }) {
    this.root = root;
    this.onClose = onClose;
    this.onDrop = onDrop;
    this.onChange = onChange;
    this.inv = null;
    this.cursor = null;
    this.hover = -1;
    this.open = false;

    root.innerHTML = `
      <div class="panel inv-panel">
        <div class="cont hidden"><div class="panel-title cont-title"></div><div class="inv-grid inv-cont"></div></div>
        <div class="panel-title inv-title">Inventory</div>
        <div class="inv-top">
          <div class="inv-armor"></div>
          <div class="inv-tip">Shift-click to move · Right-click to split · Q to drop</div>
        </div>
        <div class="inv-grid inv-main"></div>
        <div class="inv-grid inv-hot"></div>
      </div>
      <div class="cursor-stack hidden"><img><span></span></div>
      <div class="inv-tooltip hidden"></div>`;
    this.panel = root.querySelector('.inv-panel');
    this.cursorEl = root.querySelector('.cursor-stack');
    this.tooltip = root.querySelector('.inv-tooltip');
    this.slotEls = [];
    const mk = (parent, i) => {
      const s = document.createElement('div');
      s.className = 'islot';
      s.innerHTML = '<img draggable="false"><span></span>';
      s.dataset.i = i;
      parent.appendChild(s);
      this.slotEls[i] = s;
    };
    this.contEls = [];
    for (let i = 0; i < 27; i++) {
      const c = document.createElement('div');
      c.className = 'islot';
      c.innerHTML = '<img draggable="false"><span></span>';
      c.dataset.c = i;
      root.querySelector('.inv-cont').appendChild(c);
      this.contEls.push(c);
    }
    this.contWrap = root.querySelector('.cont');
    this.contTitle = root.querySelector('.cont-title');
    this.container = null;
    for (let i = 9; i < 36; i++) mk(root.querySelector('.inv-main'), i);
    for (let i = 0; i < 9; i++) mk(root.querySelector('.inv-hot'), i);
    this.armorEls = [];
    const armor = root.querySelector('.inv-armor');
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('div');
      s.className = 'islot armor';
      s.innerHTML = '<img draggable="false"><span></span>';
      s.title = ARMOR_NAMES[i];
      s.dataset.armor = i;
      armor.appendChild(s);
      this.armorEls.push(s);
    }

    root.addEventListener('mousedown', (e) => this.onMouseDown(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  // container: { kind: 'team' | 'ender', title, slots } or null for the plain inventory.
  show(inv, container = null) {
    this.inv = inv;
    this.container = container;
    this.contWrap.classList.toggle('hidden', !container);
    if (container) this.contTitle.textContent = container.title;
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    if (this.cursor) {
      const left = this.inv.add(this.cursor.id, this.cursor.count, this.cursor.tint ? { tint: this.cursor.tint } : {});
      const rest = { ...this.cursor, count: left };
      this.cursor = null;
      if (left > 0) this.onDrop(rest);
      this.onChange?.();
    }
    this.container = null;
    this.root.classList.add('hidden');
    this.tooltip.classList.add('hidden');
  }

  paint(el, st) {
    const img = el.querySelector('img'), span = el.querySelector('span');
    if (st) { img.src = iconURL(st.id, st.tint); img.style.display = ''; } else img.style.display = 'none';
    span.textContent = st && st.count > 1 ? st.count : '';
  }

  render() {
    if (!this.open) return;
    const inv = this.inv;
    for (let i = 0; i < 36; i++) this.paint(this.slotEls[i], inv.slots[i]);
    inv.armor.forEach((st, i) => this.paint(this.armorEls[i], st));
    this.slotEls.forEach((s, i) => s.classList.toggle('selected', i === inv.selected));
    if (this.container) this.container.slots.forEach((st, i) => this.paint(this.contEls[i], st));
    this.paint(this.cursorEl, this.cursor);
    this.cursorEl.classList.toggle('hidden', !this.cursor);
    this.lastVersion = inv.version;
    this.lastCont = this.contKey();
  }

  contKey() { return this.container ? JSON.stringify(this.container.slots) : ''; }

  update() {
    if (this.open && (this.inv.version !== this.lastVersion || this.contKey() !== this.lastCont)) this.render();
  }

  // Moves a stack into arr[from..to), filling matching stacks first.
  // Returns what didn't fit (count may be 0).
  pour(st, arr, ranges) {
    const max = stackSize(st.id);
    for (const [a, b] of ranges) for (let j = a; j < b && st.count > 0; j++) {
      const t = arr[j];
      if (this.same(t, st) && t.count < max) { const n = Math.min(st.count, max - t.count); t.count += n; st.count -= n; }
    }
    for (const [a, b] of ranges) for (let j = a; j < b && st.count > 0; j++) {
      if (!arr[j]) { arr[j] = { ...st, count: Math.min(st.count, max) }; st.count -= arr[j].count; }
    }
    return st;
  }

  // The shared pick-up / put-down / split rules for any slot array.
  clickArray(arr, i, button) {
    const slot = arr[i];
    const cur = this.cursor;
    if (button === 0) {
      if (!cur) { this.cursor = slot; arr[i] = null; }
      else if (!slot) { arr[i] = cur; this.cursor = null; }
      else if (this.same(cur, slot)) {
        const n = Math.min(cur.count, stackSize(slot.id) - slot.count);
        slot.count += n; cur.count -= n;
        if (cur.count <= 0) this.cursor = null;
      } else { arr[i] = cur; this.cursor = slot; }
    } else if (button === 2) {
      if (!cur && slot) {
        const half = Math.ceil(slot.count / 2);
        this.cursor = { ...slot, count: half };
        slot.count -= half;
        if (slot.count <= 0) arr[i] = null;
      } else if (cur && (!slot || (this.same(cur, slot) && slot.count < stackSize(slot.id)))) {
        if (!slot) arr[i] = { ...cur, count: 1 }; else slot.count++;
        cur.count--;
        if (cur.count <= 0) this.cursor = null;
      }
    }
  }

  clickContainer(i, button, shift) {
    const arr = this.container.slots;
    if (shift && arr[i]) {
      const rest = this.pour({ ...arr[i] }, this.inv.slots, [[9, 36], [0, 9]]);
      arr[i] = rest.count > 0 ? rest : null;
    } else this.clickArray(arr, i, button);
    this.inv.touch();
  }

  same(a, b) { return a && b && a.id === b.id && a.tint === b.tint; }

  click(i, button, shift) {
    const inv = this.inv;
    const slot = inv.slots[i];
    const slotItem = getItem(slot?.id);
    if (shift && slotItem?.kind === 'armor' && !inv.armor[slotItem.slot]) {
      inv.armor[slotItem.slot] = { ...slot, count: 1 };
      inv.removeAt(i, 1);
      return;
    }
    if (shift && slot) {
      // Into the open chest, or between hotbar and backpack.
      const rest = this.container
        ? this.pour({ ...slot }, this.container.slots, [[0, this.container.slots.length]])
        : this.pour({ ...slot }, inv.slots, [i < 9 ? [9, 36] : [0, 9]]);
      inv.slots[i] = rest.count > 0 ? rest : null;
      inv.touch();
      return;
    }
    this.clickArray(inv.slots, i, button);
    inv.touch();
  }

  // Armor slots only accept the matching piece (helmet, chestplate, ...).
  clickArmor(a, shift) {
    const inv = this.inv;
    const worn = inv.armor[a];
    if (shift) {
      if (worn && inv.add(worn.id, 1, worn.tint ? { tint: worn.tint } : {}) === 0) inv.armor[a] = null;
    } else {
      const cur = this.cursor;
      const fits = cur && getItem(cur.id)?.kind === 'armor' && getItem(cur.id).slot === a && cur.count === 1;
      if (!cur) { this.cursor = worn; inv.armor[a] = null; }
      else if (fits) { inv.armor[a] = cur; this.cursor = worn; }
    }
    inv.touch();
  }

  onMouseDown(e) {
    if (!this.open) return;
    const s = e.target.closest('.islot');
    if (s && s.dataset.armor !== undefined) {
      this.clickArmor(Number(s.dataset.armor), e.shiftKey);
      this.render();
      this.onChange?.();
      return;
    }
    if (s && s.dataset.c !== undefined && this.container) {
      this.clickContainer(Number(s.dataset.c), e.button, e.shiftKey);
      this.render();
      this.onChange?.();
      return;
    }
    if (s && s.dataset.i !== undefined) {
      this.click(Number(s.dataset.i), e.button, e.shiftKey);
      this.render();
      this.onChange?.();
      return;
    }
    if (!e.target.closest('.inv-panel') && this.cursor) {
      // Clicked outside: throw the stack (right click throws one).
      const n = e.button === 2 ? 1 : this.cursor.count;
      const thrown = { ...this.cursor, count: n };
      this.cursor.count -= n;
      if (this.cursor.count <= 0) this.cursor = null;
      this.onDrop(thrown, true);
      this.render();
    }
  }

  onMouseMove(e) {
    this.cursorEl.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`;
    const s = e.target.closest('.islot');
    const i = s && s.dataset.i !== undefined ? Number(s.dataset.i) : -1;
    const c = s && s.dataset.c !== undefined && this.container ? Number(s.dataset.c) : -1;
    this.hover = i;
    this.hoverC = c;
    const armorIdx = s ? this.armorEls.indexOf(s) : -1;
    const st = i >= 0 ? this.inv.slots[i] : c >= 0 ? this.container.slots[c] : armorIdx >= 0 ? this.inv.armor[armorIdx] : null;
    if (st && !this.cursor) {
      this.tooltip.textContent = getItem(st.id)?.name ?? st.id;
      this.tooltip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 30}px)`;
      this.tooltip.classList.remove('hidden');
    } else this.tooltip.classList.add('hidden');
  }

  // Keys while the inventory is open. Returns true if handled.
  key(e) {
    if (!this.open) return false;
    const inv = this.inv;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && this.hoverC >= 0 && this.container) {
      const j = Number(m[1]) - 1, arr = this.container.slots;
      [inv.slots[j], arr[this.hoverC]] = [arr[this.hoverC], inv.slots[j]];
      inv.touch();
      this.render();
      this.onChange?.();
      return true;
    }
    if (this.hover < 0) return false;
    if (m) {
      const j = Number(m[1]) - 1;
      [inv.slots[j], inv.slots[this.hover]] = [inv.slots[this.hover], inv.slots[j]];
      inv.touch();
      this.render();
      this.onChange?.();
      return true;
    }
    if (e.code === 'KeyQ' && inv.slots[this.hover]) {
      const taken = inv.removeAt(this.hover, e.ctrlKey || e.metaKey ? inv.slots[this.hover].count : 1);
      this.onDrop(taken, true);
      this.render();
      return true;
    }
    return false;
  }
}
