// Every block texture is painted here in code, pixel by pixel, at startup.
// Style: warm, saturated, chunky 32px tiles with a soft bevel on each block.
// Nothing is taken from Minecraft.
import * as THREE from 'three';
import { TEAMS } from '../config.js';

export const TILE = 32;
const T = TILE;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  if (typeof hex === 'string') hex = parseInt(hex.replace('#', ''), 16);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const scale = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
export const mix = (a, b, t) => [
  clamp255(a[0] + (b[0] - a[0]) * t),
  clamp255(a[1] + (b[1] - a[1]) * t),
  clamp255(a[2] + (b[2] - a[2]) * t),
];
const C = hexToRgb;

// A 32x32 RGBA pixel buffer with painting helpers.
class Painter {
  constructor(seed) {
    this.d = new Uint8ClampedArray(T * T * 4);
    this.r = mulberry32(seed);
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= T || y >= T) return;
    const i = (y * T + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  // Wrapping set, for patterns that tile seamlessly.
  setw(x, y, c, a = 255) { this.set(((x % T) + T) % T, ((y % T) + T) % T, c, a); }
  get(x, y) {
    const i = (y * T + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }
  alpha(x, y) { return this.d[(y * T + x) * 4 + 3]; }
  mul(x, y, f) {
    if (x < 0 || y < 0 || x >= T || y >= T) return;
    const i = (y * T + x) * 4;
    this.d[i] = clamp255(this.d[i] * f);
    this.d[i + 1] = clamp255(this.d[i + 1] * f);
    this.d[i + 2] = clamp255(this.d[i + 2] * f);
  }
  mulw(x, y, f) { this.mul(((x % T) + T) % T, ((y % T) + T) % T, f); }
  blend(x, y, c, t) {
    if (x < 0 || y < 0 || x >= T || y >= T) return;
    const m = mix(this.get(x, y), c, t);
    const i = (y * T + x) * 4;
    this.d[i] = m[0]; this.d[i + 1] = m[1]; this.d[i + 2] = m[2];
  }
  fill(c, a = 255) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) this.set(x, y, c, a);
  }
  rect(x0, y0, w, h, c, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }
  noise(amount) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) this.mul(x, y, 1 + (this.r() - 0.5) * amount);
  }
  // Soft two-pixel bevel: light top-left, dark bottom-right.
  bevel(light = 1.12, dark = 0.8) {
    const l2 = 1 + (light - 1) * 0.45, d2 = 1 - (1 - dark) * 0.45;
    for (let i = 0; i < T; i++) {
      this.mul(i, 0, light); this.mul(0, i, light);
      this.mul(i, T - 1, dark); this.mul(T - 1, i, dark);
    }
    for (let i = 1; i < T - 1; i++) {
      this.mul(i, 1, l2); this.mul(1, i, l2);
      this.mul(i, T - 2, d2); this.mul(T - 2, i, d2);
    }
  }
  speckle(n, c, size = 1) {
    for (let k = 0; k < n; k++) {
      const x = Math.floor(this.r() * T), y = Math.floor(this.r() * T);
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.setw(x + dx, y + dy, c);
    }
  }
  // Little rounded pebbles with a highlight, for dirt and stone.
  pebbles(n, dark, light) {
    for (let k = 0; k < n; k++) {
      const x = Math.floor(this.r() * T), y = Math.floor(this.r() * T);
      const w = 2 + Math.floor(this.r() * 2), h = 2;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.setw(x + dx, y + dy, dark);
      this.setw(x, y, light);
    }
  }
  canvas() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = T;
    cv.getContext('2d').putImageData(new ImageData(this.d, T, T), 0, 0);
    return cv;
  }
}

// Smooth tiling value noise in [0, 1], period T.
function tileNoise(seed, cell) {
  const n = T / cell;
  const r = mulberry32(seed);
  const g = [];
  for (let i = 0; i < n * n; i++) g.push(r());
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// ---------------------------------------------------------------- tiles

const LOAM = C('#9e6a43');
const GRASS = C('#62c64b');
const SNOW = C('#f3f8ff');

function paintLoam(p) {
  p.fill(LOAM);
  p.noise(0.12);
  const n = tileNoise(p.r() * 1e9, 8);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) p.mul(x, y, 0.92 + n(x, y) * 0.16);
  p.pebbles(14, C('#7a5032'), C('#bb8659'));
  p.speckle(10, C('#86593a'));
}

// Horizontal boards: warm planks with dark seams, used by several tiles.
function paintBoards(p, base, seam, { rows = 4, nails = true } = {}) {
  const h = T / rows;
  for (let b = 0; b < rows; b++) {
    const y0 = b * h;
    const tint = 0.93 + p.r() * 0.14;
    const cut = (b % 2 ? 9 : 23) + Math.floor(p.r() * 4) - 2;
    for (let y = y0; y < y0 + h; y++) for (let x = 0; x < T; x++) {
      let f = tint * (1 + (p.r() - 0.5) * 0.05);
      if (y === y0) f *= 1.18;
      else if (y === y0 + 1) f *= 1.06;
      else if (y === y0 + h - 2) f *= 0.9;
      p.set(x, y, scale(base, f));
    }
    for (let x = 0; x < T; x++) p.set(x, y0 + h - 1, seam);
    // Grain streaks.
    for (let k = 0; k < 4; k++) {
      const gx = Math.floor(p.r() * T), gy = y0 + 2 + Math.floor(p.r() * (h - 4));
      const len = 4 + Math.floor(p.r() * 8);
      for (let i = 0; i < len; i++) p.mulw(gx + i, gy, 0.88);
    }
    for (let y = y0; y < y0 + h - 1; y++) {
      p.set(cut, y, seam);
      p.mul(cut + 1, y, 1.12);
    }
    if (nails) {
      p.set(cut - 2, y0 + 2, scale(seam, 0.9)); p.set(cut + 3, y0 + 2, scale(seam, 0.9));
      p.set(cut - 2, y0 + h - 3, scale(seam, 0.9)); p.set(cut + 3, y0 + h - 3, scale(seam, 0.9));
    }
  }
}

function paintBricks(p, brick, mortar) {
  p.fill(mortar);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 8;
    const off = row % 2 ? 8 : 0;
    for (let b = -1; b < 2; b++) {
      const x0 = b * 16 + off;
      const tint = 0.9 + p.r() * 0.2;
      for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 15; x++) {
        let f = tint * (1 + (p.r() - 0.5) * 0.06);
        if (y === y0) f *= 1.16;
        else if (y === y0 + 1) f *= 1.06;
        else if (y === y0 + 6) f *= 0.8;
        if (x === x0) f *= 1.08;
        if (x === x0 + 14) f *= 0.86;
        p.setw(x, y, scale(brick, f));
      }
    }
  }
}

function paintRings(p, light, dark, bark) {
  p.fill(bark);
  p.noise(0.1);
  for (let y = 2; y < T - 2; y++) for (let x = 2; x < T - 2; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    const ring = Math.floor(d / 2.2 + (p.r() < 0.08 ? 0.5 : 0));
    p.set(x, y, scale(ring % 2 ? light : dark, 1 + (p.r() - 0.5) * 0.06));
  }
  p.bevel(1.06, 0.82);
}

function paintLeaves(p, base, light, dark, accent) {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) p.set(x, y, scale(base, 0.88 + p.r() * 0.18));
  for (let k = 0; k < 46; k++) {
    const x = Math.floor(p.r() * T), y = Math.floor(p.r() * T);
    const c = accent && p.r() < 0.2 ? accent : base;
    p.setw(x, y, light); p.setw(x + 1, y, scale(c, 1.05));
    p.setw(x, y + 1, scale(c, 1.0)); p.setw(x + 1, y + 1, dark); p.setw(x + 2, y + 1, scale(dark, 1.1));
    p.setw(x + 1, y + 2, dark);
  }
  // See-through gaps.
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (p.r() < 0.07) p.set(x, y, dark, 0);
}

function gemPlate(p, ring, shine, glow) {
  p.fill(C('#2f3443'));
  p.noise(0.1);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const d = Math.abs(x - 15.5) + Math.abs(y - 15.5);
    if (d > 9.5 && d < 13.5) p.set(x, y, scale(ring, d < 11 ? 1.15 : d > 12.5 ? 0.8 : 1));
    else if (d <= 5.5) p.set(x, y, scale(shine, d < 2 ? 1.1 : 0.95));
    else if (d <= 6.5) p.set(x, y, glow);
  }
  for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28]]) { p.rect(x, y, 2, 2, C('#9aa3b6')); p.set(x, y, C('#d5dbe6')); }
  p.bevel(1.25, 0.72);
}

const painters = {
  echest_side(p) {
    p.fill(C('#1d2a2c'));
    p.noise(0.16);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x * 7 + y * 13) % 23 === 0) p.set(x, y, C('#2f4547'));
    p.rect(0, 12, T, 2, C('#0e1517'));
    p.rect(13, 9, 6, 8, C('#2b2b33'));
    p.rect(14, 10, 4, 6, C('#43e0b0'));
    p.rect(15, 11, 2, 4, C('#0f5c55'));
    p.bevel(1.25, 0.7);
  },
  echest_top(p) {
    p.fill(C('#1d2a2c'));
    p.noise(0.16);
    for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) if (x === 2 || y === 2 || x === 29 || y === 29) p.set(x, y, C('#2f4547'));
    p.rect(12, 12, 8, 8, C('#43e0b0'));
    p.rect(14, 14, 4, 4, C('#0f5c55'));
    p.bevel(1.25, 0.7);
  },
  tnt_side(p) {
    const red = C('#e3342f'), white = C('#f4efe4'), dark = C('#7a1a17');
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const band = Math.floor(x / 8) % 2 ? scale(red, 0.88) : red;
      p.set(x, y, band);
    }
    p.rect(0, 11, T, 10, white);
    p.rect(0, 11, T, 1, dark);
    p.rect(0, 20, T, 1, dark);
    const ink = C('#2a1a10');
    p.rect(4, 13, 6, 2, ink); p.rect(6, 13, 2, 7, ink);                  // T
    p.rect(12, 13, 2, 7, ink); p.rect(18, 13, 2, 7, ink);                // N
    for (let i = 0; i < 5; i++) p.rect(13 + i, 14 + i, 1, 2, ink);
    p.rect(22, 13, 6, 2, ink); p.rect(24, 13, 2, 7, ink);                // T
    p.noise(0.06);
    p.bevel(1.08, 0.82);
  },
  tnt_top(p) {
    p.fill(C('#e3342f'));
    p.noise(0.08);
    p.rect(12, 12, 8, 8, C('#f4efe4'));
    p.rect(15, 6, 2, 8, C('#4a3b2a'));
    p.set(15, 5, C('#ffd23f')); p.set(16, 5, C('#ff8a2a'));
    p.bevel(1.1, 0.8);
  },
  turf_top(p) {
    p.fill(GRASS);
    p.noise(0.1);
    const n = tileNoise(p.r() * 1e9, 8);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) p.mul(x, y, 0.93 + n(x, y) * 0.14);
    for (let k = 0; k < 70; k++) {
      const x = Math.floor(p.r() * T), y = Math.floor(p.r() * T);
      const c = p.r() < 0.55 ? C('#80d968') : C('#4aa83a');
      p.setw(x, y, c); p.setw(x, y + 1, scale(c, 0.95));
    }
    // One small flower.
    const fx = 8 + Math.floor(p.r() * 14), fy = 8 + Math.floor(p.r() * 14);
    const petal = C(['#ffffff', '#ff9ad5', '#9fd8ff'][Math.floor(p.r() * 3)]);
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]]) p.set(fx + dx, fy + dy, petal);
    p.set(fx, fy, C('#ffc93a'));
    p.bevel(1.07, 0.86);
  },
  turf_side(p) {
    paintLoam(p);
    for (let x = 0; x < T; x++) {
      let h = 7 + (p.r() < 0.5 ? 1 : 0) + (p.r() < 0.25 ? 1 : 0);
      if (p.r() < 0.12) h += 3;
      for (let y = 0; y < h; y++) p.set(x, y, scale(GRASS, 1 + (p.r() - 0.5) * 0.12));
      p.set(x, 0, scale(GRASS, 1.14));
      p.set(x, h - 1, scale(GRASS, 0.72));
      p.mul(x, h, 0.82);
    }
    p.bevel(1.05, 0.84);
  },
  loam(p) { paintLoam(p); p.bevel(1.06, 0.84); },
  slate(p) {
    p.fill(C('#8b93a7'));
    p.noise(0.07);
    const dark = C('#6f7789'), light = C('#a5adc0');
    for (const row of [7, 15, 24]) {
      let x = Math.floor(p.r() * 6);
      while (x < T) {
        const len = 5 + Math.floor(p.r() * 10);
        for (let i = 0; i < len && x + i < T; i++) { p.set(x + i, row, dark); p.set(x + i, row + 1, light); }
        x += len + 2 + Math.floor(p.r() * 4);
      }
    }
    p.speckle(14, light);
    p.speckle(8, dark);
    p.bevel(1.1, 0.8);
  },
  cobble(p) {
    const seeds = [];
    for (let k = 0; k < 13; k++) seeds.push([p.r() * T, p.r() * T, 0.85 + p.r() * 0.3]);
    const base = C('#99a0ae'), mortar = C('#575c69');
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let d1 = 1e9, d2 = 1e9, best = null, bx = 0, by = 0;
      for (const s of seeds) for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
        const dx = x + 0.5 - s[0] - ox, dy = y + 0.5 - s[1] - oy;
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = s; bx = dx; by = dy; } else if (d < d2) d2 = d;
      }
      if (d2 - d1 < 1.5) p.set(x, y, mortar);
      else {
        const lit = 1.08 - (bx + by) * 0.018 - d1 * 0.012;
        p.set(x, y, scale(base, best[2] * lit * (1 + (p.r() - 0.5) * 0.06)));
      }
    }
  },
  bricks(p) { paintBricks(p, C('#9aa3b6'), C('#585f70')); },
  bricks_mossy(p) {
    paintBricks(p, C('#98a1b2'), C('#585f70'));
    const n = tileNoise(p.r() * 1e9, 8);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const v = n(x, y) + (y % 8 === 7 ? 0.18 : 0);
      if (v > 0.62) p.set(x, y, scale(C('#5d9b3b'), 0.85 + p.r() * 0.3));
    }
  },
  log_side(p) {
    p.fill(C('#efe6d1'));
    p.noise(0.05);
    for (let x = 0; x < T; x += 4) for (let y = 0; y < T; y++) if (p.r() < 0.55) p.mul(x + 1, y, 0.95);
    const mark = C('#3c3632');
    for (let k = 0; k < 10; k++) {
      const x = Math.floor(p.r() * 26), y = Math.floor(p.r() * T);
      const len = 3 + Math.floor(p.r() * 5);
      for (let i = 0; i < len; i++) {
        p.setw(x + i, y, mark);
        if (p.r() < 0.6) p.setw(x + i, y + 1, scale(mark, 1.4));
        p.mulw(x + i, y - 1, 0.95);
      }
    }
    for (let y = 0; y < T; y++) { p.mul(0, y, 0.86); p.mul(T - 1, y, 0.86); }
  },
  log_top(p) { paintRings(p, C('#e6c38c'), C('#cfa168'), C('#efe6d1')); },
  log_dark_side(p) {
    p.fill(C('#5b3d25'));
    for (let x = 0; x < T; x++) {
      const f = [0.75, 0.95, 1.1, 1.0, 0.85][(x + Math.floor(x / 5)) % 5];
      for (let y = 0; y < T; y++) p.mul(x, y, f * (1 + (p.r() - 0.5) * 0.1));
    }
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(p.r() * T), y = Math.floor(p.r() * T);
      for (let i = 0; i < 5; i++) p.setw(x, y + i, C('#3a2615'));
    }
  },
  log_dark_top(p) { paintRings(p, C('#956a3e'), C('#7a5430'), C('#4f3420')); },
  leaf(p) { paintLeaves(p, C('#3fae4f'), C('#6bd47a'), C('#2c843a')); },
  leaf_autumn(p) { paintLeaves(p, C('#e8862e'), C('#ffbb55'), C('#b2571b'), C('#d8442a')); },
  sand(p) {
    p.fill(C('#f2d48e'));
    p.noise(0.07);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (Math.sin((x * 0.4 + y) * 0.9) > 0.86) p.mul(x, y, 0.93);
    }
    p.speckle(18, C('#dcb466'));
    p.speckle(12, C('#fff1c6'));
    p.bevel(1.05, 0.86);
  },
  timber(p) { paintBoards(p, C('#dd9450'), C('#6b3a17')); },
  planks_dark(p) { paintBoards(p, C('#7c5132'), C('#352011')); },
  crate_side(p) {
    paintBoards(p, C('#d28c4b'), C('#7a4520'), { nails: false });
    const frame = C('#9c602c'), dark = C('#5a3414');
    for (let i = 0; i < T; i++) for (let k = 0; k < 3; k++) {
      p.set(i, k, scale(frame, k === 0 ? 1.15 : 1)); p.set(k, i, scale(frame, k === 0 ? 1.12 : 1));
      p.set(i, T - 1 - k, scale(frame, k === 0 ? 0.75 : 0.95)); p.set(T - 1 - k, i, scale(frame, k === 0 ? 0.78 : 0.95));
    }
    for (let i = 3; i < T - 3; i++) for (let w = -1; w <= 1; w++) {
      p.set(i + w, T - 1 - i, scale(frame, w === -1 ? 1.12 : w === 1 ? 0.82 : 1));
    }
    for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29]]) { p.rect(x, y, 2, 2, dark); }
  },
  crate_top(p) {
    paintBoards(p, C('#d28c4b'), C('#7a4520'), { nails: false });
    const frame = C('#9c602c');
    for (let i = 0; i < T; i++) for (let k = 0; k < 3; k++) {
      p.set(i, k, scale(frame, k === 0 ? 1.15 : 1)); p.set(k, i, scale(frame, k === 0 ? 1.12 : 1));
      p.set(i, T - 1 - k, scale(frame, k === 0 ? 0.75 : 0.95)); p.set(T - 1 - k, i, scale(frame, k === 0 ? 0.78 : 0.95));
    }
  },
  chest_top(p) {
    paintBoards(p, C('#c98340'), C('#6b3a17'), { nails: false });
    const edge = C('#5a3414');
    for (let i = 0; i < T; i++) { p.set(i, 0, edge); p.set(0, i, edge); p.set(i, T - 1, edge); p.set(T - 1, i, edge); }
    for (let i = 1; i < T - 1; i++) { p.mul(i, 1, 1.15); p.mul(1, i, 1.12); p.mul(i, T - 2, 0.8); p.mul(T - 2, i, 0.82); }
  },
  chest_side(p) {
    paintBoards(p, C('#c98340'), C('#6b3a17'), { nails: false });
    const edge = C('#5a3414');
    for (let i = 0; i < T; i++) { p.set(i, 0, edge); p.set(0, i, edge); p.set(i, T - 1, edge); p.set(T - 1, i, edge); }
    for (let x = 1; x < T - 1; x++) { p.set(x, 11, edge); p.mul(x, 12, 0.75); p.mul(x, 10, 1.15); }
    // Metal latch with a keyhole.
    const metal = C('#cfd4de');
    p.rect(13, 8, 6, 9, C('#3a3f4c'));
    p.rect(14, 9, 4, 7, metal);
    for (let y = 9; y < 16; y++) p.mul(17, y, 0.8);
    p.mul(14, 9, 1.1);
    p.rect(15, 12, 2, 2, C('#2a2d36'));
  },
  roof(p) {
    const base = C('#c9483a');
    p.fill(scale(base, 0.55));
    for (let row = 0; row < 4; row++) {
      const y0 = row * 8, off = row % 2 ? 4 : 0;
      for (let t = -1; t < 4; t++) {
        const x0 = t * 8 + off;
        const tint = 0.9 + p.r() * 0.2;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          // Rounded bottom corners give the scalloped tile look.
          const cx = x - 3.5, cy = y - 1.5;
          if (y > 4 && Math.hypot(cx, Math.max(0, cy - 3)) > 3.9) continue;
          let f = tint * (1.12 - y * 0.035);
          if (x === 0) f *= 1.08;
          if (x === 7) f *= 0.82;
          p.setw(x0 + x, y0 + y, scale(base, f * (1 + (p.r() - 0.5) * 0.06)));
        }
      }
    }
  },
  lantern(p) {
    const frame = C('#3a3430');
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      p.set(x, y, mix(C('#fff4b8'), C('#e8722a'), Math.min(1, d * 1.15)));
    }
    for (let i = 0; i < T; i++) for (let k = 0; k < 3; k++) {
      p.set(i, k, frame); p.set(k, i, frame); p.set(i, T - 1 - k, frame); p.set(T - 1 - k, i, frame);
    }
    for (const x of [10, 21]) for (let y = 3; y < T - 3; y++) { p.set(x, y, frame); p.set(x + 1, y, scale(frame, 1.4)); }
    for (let x = 3; x < T - 3; x++) { p.set(x, 15, frame); p.set(x, 16, scale(frame, 1.4)); }
    for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29]]) p.rect(x, y, 2, 2, C('#8a7f72'));
  },
  polished(p) {
    p.fill(C('#a9b0bd'));
    p.noise(0.04);
    for (let i = 0; i < T; i++) for (let y = 0; y < T; y++) if ((i + y) % 13 === 0 && i > 3 && y > 3 && i < 28 && y < 28) p.mul(i, y, 1.05);
    for (let i = 0; i < T; i++) {
      for (let k = 0; k < 3; k++) {
        p.mul(i, k, 1.14 - k * 0.04); p.mul(k, i, 1.12 - k * 0.04);
        p.mul(i, T - 1 - k, 0.78 + k * 0.06); p.mul(T - 1 - k, i, 0.8 + k * 0.06);
      }
    }
  },
  gold_block(p) {
    p.fill(C('#ffcf3a'));
    p.noise(0.05);
    for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) p.mul(x, y, 1.04);
    for (let i = 4; i < 28; i++) { p.set(i, 4, C('#fff3a0')); p.set(4, i, C('#fff3a0')); p.set(i, 27, C('#c98a12')); p.set(27, i, C('#c98a12')); }
    for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) p.set(8 + i + k * 6, 20 - i - k * 2, C('#fff8c8'));
    p.bevel(1.25, 0.7);
  },
  diamond_block(p) {
    p.fill(C('#55e3f0'));
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const fx = (x % 16) - 7.5, fy = (y % 16) - 7.5;
      const d = Math.abs(fx) + Math.abs(fy);
      if (d < 7) p.mul(x, y, fx + fy < 0 ? 1.18 : 0.92);
      else if (d < 8) p.set(x, y, C('#2ab4c9'));
    }
    p.speckle(6, C('#ffffff'));
    p.bevel(1.25, 0.72);
  },
  snow_top(p) {
    p.fill(SNOW);
    const n = tileNoise(p.r() * 1e9, 8);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (n(x, y) > 0.6) p.set(x, y, C('#dde9f6'));
    p.speckle(16, C('#ffffff'));
    p.speckle(8, C('#cad9ea'));
    p.bevel(1.03, 0.88);
  },
  snow_side(p) {
    paintLoam(p);
    for (let x = 0; x < T; x++) {
      let h = 8 + (p.r() < 0.5 ? 1 : 0);
      if (p.r() < 0.15) h += 3;
      for (let y = 0; y < h; y++) p.set(x, y, scale(SNOW, 1 - (p.r() * 0.04)));
      p.set(x, h - 1, C('#c6d8ec'));
      p.mul(x, h, 0.8);
    }
    p.bevel(1.03, 0.84);
  },
  ice(p) {
    p.fill(C('#a9dcf5'));
    p.noise(0.05);
    for (let k = 0; k < 4; k++) {
      const x0 = Math.floor(p.r() * T);
      for (let i = 0; i < 14; i++) p.setw(x0 + i, i * 2 + k, C('#dcf3ff'));
    }
    for (let k = 0; k < 3; k++) {
      let x = Math.floor(p.r() * T), y = Math.floor(p.r() * T);
      for (let s = 0; s < 10; s++) {
        p.setw(x, y, C('#7cbde2'));
        if (p.r() < 0.5) x += p.r() < 0.5 ? 1 : -1; else y += 1;
      }
    }
    p.bevel(1.18, 0.8);
  },
  sandstone_top(p) {
    p.fill(C('#ead08f'));
    p.noise(0.06);
    p.speckle(14, C('#d8b873'));
    for (let i = 3; i < 29; i++) { p.mul(i, 3, 0.9); p.mul(3, i, 0.9); p.mul(i, 28, 1.08); p.mul(28, i, 1.08); }
    p.bevel(1.1, 0.8);
  },
  sandstone_side(p) {
    p.fill(C('#e3c483'));
    p.noise(0.06);
    for (let y = 0; y < 6; y++) for (let x = 0; x < T; x++) p.mul(x, y, 1.08);
    for (let x = 0; x < T; x++) { p.set(x, 6, C('#c7a464')); p.set(x, 25, C('#c7a464')); p.mul(x, 26, 1.1); }
    for (const y of [12, 18]) for (let x = 0; x < T; x++) if (p.r() < 0.75) p.mul(x, y, 0.9);
    for (let x = 0; x < T; x += 8) for (let y = 27; y < T; y++) { p.mul(x + 3, y, 0.85); p.mul(x + 4, y, 0.85); }
    p.bevel(1.06, 0.82);
  },
  moonstone(p) {
    p.fill(C('#f1e8b6'));
    p.noise(0.06);
    for (let k = 0; k < 6; k++) {
      const cx = 3 + p.r() * 26, cy = 3 + p.r() * 26, r = 2 + p.r() * 3;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < r - 0.8) p.mul(x, y, 0.92);
        else if (d < r + 0.6) p.set(x, y, C(x + 0.5 < cx ? '#d0c287' : '#fff8dc'));
      }
    }
    p.bevel(1.06, 0.84);
  },
  voidstone(p) {
    p.fill(C('#241a37'));
    p.noise(0.2);
    p.speckle(18, C('#3b2c58'));
    for (let k = 0; k < 4; k++) {
      let x = Math.floor(p.r() * T), y = Math.floor(p.r() * T);
      for (let s = 0; s < 16; s++) {
        p.setw(x, y, C(s % 4 === 1 ? '#efd0ff' : '#a45cff'));
        if (p.r() < 0.5) x += p.r() < 0.5 ? 1 : -1; else y += p.r() < 0.5 ? 1 : -1;
      }
    }
    p.bevel(1.3, 0.78);
  },
  prism(p) {
    p.fill(C('#bdf2ff'), 50);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if ((x + y) % 16 === 0 || (x - y + 32) % 16 === 0) p.set(x, y, C('#8fe3ff'), 150);
    }
    for (let i = 0; i < T; i++) {
      p.set(i, 0, C('#f2fdff'), 235); p.set(0, i, C('#f2fdff'), 235);
      p.set(i, 1, C('#d8f7ff'), 170); p.set(1, i, C('#d8f7ff'), 170);
      p.set(i, T - 1, C('#6fc6e6'), 235); p.set(T - 1, i, C('#6fc6e6'), 235);
    }
    for (let i = 4; i < 13; i++) { p.set(i, 16 - i, C('#ffffff'), 190); p.set(i + 1, 16 - i, C('#ffffff'), 120); }
  },
  lobby_glass(p) {
    p.fill(C('#e3f7ff'), 34);
    for (let i = 0; i < T; i++) {
      p.set(i, 0, C('#ffffff'), 200); p.set(0, i, C('#ffffff'), 200);
      p.set(i, T - 1, C('#cdeaf7'), 200); p.set(T - 1, i, C('#cdeaf7'), 200);
    }
    for (let i = 5; i < 12; i++) p.set(i, 17 - i, C('#ffffff'), 110);
  },
  ladder(p) {
    p.fill([0, 0, 0], 0);
    const rope = C('#d2a466');
    for (let y = 0; y < T; y++) for (const x0 of [4, 25]) for (let dx = 0; dx < 3; dx++) {
      const twist = ((y + dx * 2) >> 1) % 3;
      p.set(x0 + dx, y, scale(rope, [1.08, 0.92, 0.78][twist] * (dx === 2 ? 0.88 : 1)));
    }
    const rung = C('#b27536');
    for (const y0 of [3, 11, 19, 27]) for (let x = 3; x < 29; x++) {
      p.set(x, y0, scale(rung, 1.18));
      p.set(x, y0 + 1, rung);
      p.set(x, y0 + 2, scale(rung, 0.72));
    }
  },
  forge_top(p) {
    p.fill(C('#3b4150'));
    p.noise(0.08);
    for (let y = 6; y < 26; y++) for (let x = 6; x < 26; x++) {
      const hole = (x % 4 === 1 || x % 4 === 2) && (y % 4 === 1 || y % 4 === 2);
      if (hole) {
        const d = Math.hypot(x - 15.5, y - 15.5) / 12;
        p.set(x, y, mix(C('#ffe27a'), C('#ff7a2a'), Math.min(1, d)));
      } else p.set(x, y, C('#23272f'));
    }
    for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) { p.rect(x, y, 2, 2, C('#a3acbd')); p.set(x, y, C('#dfe5ef')); }
    p.bevel(1.22, 0.72);
  },
  forge_side(p) {
    p.fill(C('#3b4150'));
    p.noise(0.08);
    for (let x = 0; x < T; x++) {
      p.set(x, 13, C('#23272f'));
      p.set(x, 14, C('#ff8a2a')); p.set(x, 15, C('#ffc45c')); p.set(x, 16, C('#ffe9a0')); p.set(x, 17, C('#ff8a2a'));
      p.set(x, 18, C('#23272f'));
    }
    for (const x of [10, 21]) for (let y = 0; y < T; y++) if (y < 13 || y > 18) { p.mul(x, y, 0.8); p.mul(x + 1, y, 1.12); }
    for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) { p.rect(x, y, 2, 2, C('#a3acbd')); p.set(x, y, C('#dfe5ef')); }
    p.bevel(1.22, 0.72);
  },
  goldgen_top(p) { gemPlate(p, C('#ffcf3a'), C('#fff3a0'), C('#c98a12')); },
  diagen_top(p) { gemPlate(p, C('#4fe6f6'), C('#d4fdff'), C('#1fa8c4')); },
};

function paintFluff(p, rgb) {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const cx = (x % 16) - 7.5, cy = (y % 16) - 7.5;
    const f = 1.12 - Math.hypot(cx, cy) * 0.026 - (cx + cy) * 0.006;
    p.set(x, y, scale(rgb, f * (1 + (p.r() - 0.5) * 0.06)));
  }
  for (let i = 0; i < T; i++) for (const line of [0, 16]) {
    const f = (i % 3) === 2 ? 0.95 : 0.72;
    p.set(i, line, scale(rgb, f));
    p.set(line, i, scale(rgb, f));
    p.mul(i, line + 1, 1.06);
    p.mul(line + 1, i, 1.06);
  }
  for (const c of [0, 16]) for (const d of [0, 16]) {
    p.set(c, d, scale(rgb, 0.6));
  }
}

function paintClay(p, rgb) {
  const base = scale(mix(rgb, C('#8d6e62'), 0.36), 0.93);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const lx = x % 16, ly = y % 16;
    let f = 1 + (p.r() - 0.5) * 0.06;
    if (lx >= 14 || ly >= 14) f = lx === 15 || ly === 15 ? 0.62 : 0.78;
    else if (lx === 0 || ly === 0) f = 1.16;
    else if (lx === 1 || ly === 1) f = 1.07;
    const corner = (lx <= 1 || lx >= 14) && (ly <= 1 || ly >= 14);
    if (corner && (lx === 0 || lx === 15) && (ly === 0 || ly === 15)) f = 0.62;
    p.set(x, y, scale(base, f));
  }
  p.speckle(10, scale(base, 0.9));
}

// Ten break stages. Cracks grow outward from the middle and get thicker;
// by the last stage most of the block is shattered (like Minecraft's).
function paintCrack(p, stage) {
  p.fill([0, 0, 0], 0);
  const rr = mulberry32(99);
  const segs = [];
  const walk = (x, y, dx, dy, steps, depth) => {
    for (let s = 0; s < steps; s++) {
      segs.push([x, y, depth]);
      if (rr() < 0.55) x += dx; else y += dy;
      if (rr() < 0.15) x -= dx;
      if (rr() < 0.15) y -= dy;
      if (depth < 2 && rr() < 0.08) walk(x, y, rr() < 0.5 ? dx : -dx, rr() < 0.5 ? dy : -dy, steps - s, depth + 1);
    }
  };
  for (let branch = 0; branch < 12; branch++) {
    walk(15 + Math.floor(rr() * 3), 15 + Math.floor(rr() * 3), rr() < 0.5 ? 1 : -1, rr() < 0.5 ? 1 : -1, 22, 0);
  }
  segs.sort((a, b) => Math.hypot(a[0] - 16, a[1] - 16) - Math.hypot(b[0] - 16, b[1] - 16));
  const n = Math.floor(segs.length * (stage + 1) / 10);
  const dark = [18, 12, 22];
  for (let i = 0; i < n; i++) {
    const [x, y, depth] = segs[i];
    p.set(x, y, dark, 235);
    if (depth === 0 || stage >= 5) p.set(x + 1, y, dark, 170);
    if (stage >= 7) p.set(x, y + 1, dark, 140);
  }
  // Late stages: a darker, crumbly look all over.
  if (stage >= 6) {
    const k = (stage - 5) * 22;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (p.alpha(x, y) === 0 && rr() < 0.06 * (stage - 5)) p.set(x, y, dark, 60 + k);
    }
  }
}

// ---------------------------------------------------------------- atlas

const COLS = 16;
let atlas = null;

export function getAtlas() {
  if (atlas) return atlas;
  const tiles = new Map();
  let seed = 7;
  const add = (name, fn) => {
    const p = new Painter(seed++ * 7919);
    fn(p);
    tiles.set(name, { canvas: p.canvas(), painter: p });
  };
  for (const [name, fn] of Object.entries(painters)) add(name, fn);
  TEAMS.forEach((t, i) => {
    const rgb = hexToRgb(t.hex);
    add(`fluff_${i}`, (p) => paintFluff(p, rgb));
    add(`clay_${i}`, (p) => paintClay(p, rgb));
  });
  for (let s = 0; s < 10; s++) add(`crack_${s}`, (p) => paintCrack(p, s));

  const rows = Math.ceil(tiles.size / COLS);
  const W = COLS * T, H = Math.pow(2, Math.ceil(Math.log2(rows * T)));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const uvs = new Map();
  let i = 0;
  for (const [name, t] of tiles) {
    const px = (i % COLS) * T, py = Math.floor(i / COLS) * T;
    ctx.drawImage(t.canvas, px, py);
    // Small inset stops neighbouring tiles bleeding in at grazing angles.
    const e = 0.02;
    uvs.set(name, [(px + e) / W, 1 - (py + T - e) / H, (px + T - e) / W, 1 - (py + e) / H]);
    t.avg = averageColor(t.painter);
    i++;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const missing = (name) => { throw new Error(`Unknown texture tile: ${name}`); };
  atlas = {
    texture,
    canvas,
    uv: (name) => uvs.get(name) ?? missing(name),
    tile: (name) => (tiles.get(name) ?? missing(name)).canvas,
    avg: (name) => (tiles.get(name) ?? missing(name)).avg,
  };
  return atlas;
}

function averageColor(p) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < p.d.length; i += 4) {
    if (p.d[i + 3] < 128) continue;
    r += p.d[i]; g += p.d[i + 1]; b += p.d[i + 2]; n++;
  }
  if (!n) return [200, 230, 255];
  return [r / n, g / n, b / n];
}
