// Minecraft-style inventory: slots 0-8 are the hotbar, 9-35 the main grid,
// plus four armor slots (helmet, chestplate, leggings, boots).
import { getItem, stackSize } from './items.js';

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null);
    this.armor = [null, null, null, null];
    this.selected = 0;
    this.version = 0;   // bumps on every change so the UI knows to redraw
  }

  touch() { this.version++; }
  held() { return this.slots[this.selected]; }
  heldId() { return this.slots[this.selected]?.id ?? null; }

  set(i, stack) {
    this.slots[i] = stack && stack.count > 0 ? stack : null;
    this.touch();
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  findIndex(pred) { return this.slots.findIndex((s) => s && pred(s, getItem(s.id))); }

  // Adds items, merging into existing stacks first, then the first empty slot
  // (hotbar first). Returns how many did not fit.
  add(id, count = 1, extra = {}) {
    const max = stackSize(id);
    let left = count;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && s.tint === extra.tint) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(left, max);
      this.slots[i] = { id, count: n, ...extra };
      left -= n;
    }
    if (left !== count) this.touch();
    return left;
  }

  canFit(id, count = 1) {
    const max = stackSize(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.id === id) room += max - s.count;
      if (room >= count) return true;
    }
    return false;
  }

  // Removes `count` of an item; returns false (and removes nothing) if short.
  remove(id, count) {
    if (this.count(id) < count) return false;
    let left = count;
    for (let i = 35; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(left, s.count);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.touch();
    return true;
  }

  removeAt(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const taken = { ...s, count: Math.min(n, s.count) };
    s.count -= taken.count;
    if (s.count <= 0) this.slots[i] = null;
    this.touch();
    return taken;
  }

  replace(pred, stack) {
    const i = this.findIndex(pred);
    if (i >= 0) { this.slots[i] = stack; this.touch(); return true; }
    return false;
  }

  clear(keep = () => false) {
    for (let i = 0; i < 36; i++) if (this.slots[i] && !keep(this.slots[i], getItem(this.slots[i].id))) this.slots[i] = null;
    this.touch();
  }
}
