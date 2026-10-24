// Pixel-art item sprites drawn in code (32x32, cartoon outline), plus icons
// for the hotbar and extruded 3D meshes for items held in the hand.
import * as THREE from 'three';
import { getItem } from '../game/items.js';
import { BLOCKS } from '../world/blocks.js';
import { TILE, getAtlas, hexToRgb, mix, scale } from '../world/textures.js';

const N = 32;             // sprite resolution in pixels
const OUTLINE = hexToRgb('#1e1b2a');

const PALETTES = {
  wood: { a: '#e3a86b', b: '#b47a42', c: '#7a4a22' },
  stone: { a: '#d8dce3', b: '#a3a9b4', c: '#6c727e' },
  iron: { a: '#ffffff', b: '#dde2ea', c: '#a0a8b8' },
  gold: { a: '#fff6a8', b: '#ffd23f', c: '#d39516' },
  diamond: { a: '#dcffff', b: '#5ef0ff', c: '#1fa8c4' },
  silver: { a: '#ffffff', b: '#cfd6e2', c: '#8a94a7' },
  emerald: { a: '#b6ffd0', b: '#45e07f', c: '#1f9e52' },
  apple: { a: '#ff8f80', b: '#e8323a', c: '#a3141f' },
  steak: { a: '#e3856a', b: '#b8452e', c: '#7a2418' },
  chain: { a: '#e3e6ec', b: '#a9afbb', c: '#5f6573' },
  leather: { a: '#c99167', b: '#a0663a', c: '#6b3f20' },
  fire: { a: '#fff3a0', b: '#ffa62b', c: '#e8452c' },
  pearl: { a: '#c8fff1', b: '#2fa58f', c: '#0f5c55' },
  egg: { a: '#ffffff', b: '#f4ead8', c: '#c9b79a' },
  tower: { a: '#ffb0a8', b: '#e8423f', c: '#9c2723' },
  speedp: { a: '#c9f6ff', b: '#47c8ff', c: '#1b7fb0' },
  jumpp: { a: '#d6ffc9', b: '#5fe04a', c: '#2e9a22' },
  invisp: { a: '#f0f2f8', b: '#b6bccb', c: '#7a8193' },
  milk: { a: '#ffffff', b: '#eef3f8', c: '#9aa3b2' },
};
const COMMON = {
  h: '#a4693a', d: '#6b3f1c',          // handle wood, light and dark
  g: '#454a5a', G: '#6a7084',          // guard / pommel metal
  w: '#ffffff', W: '#f6efe2',          // highlight, bone
  r: '#e04848', R: '#a82a2a',          // red grips
  s: '#efefef',                        // bow string
  k: '#4fbf4a', e: '#6b3f1c',          // leaf, stem
};

// ------------------------------------------------------------ geometry

function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = Math.hypot(dx, dy);
  let t = ((px - ax) * dx + (py - ay) * dy) / (l * l);
  t = Math.max(0, Math.min(1, t));
  const ex = px - ax - dx * t, ey = py - ay - dy * t;
  return { d: Math.hypot(ex, ey), t, side: (dx * (py - ay) - dy * (px - ax)) / l };
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function star(cx, cy, ro, ri) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? ri : ro;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// One ingot, authored around (2..14.5, 6..13.2).
function ingot(x, y) {
  if (inPoly(x, y, [[5, 6], [14.5, 6], [11.5, 9.4], [2, 9.4]])) {
    if (y < 6.9 && x > 6 && x < 13.5) return 'w';
    return 'a';
  }
  if (inPoly(x, y, [[2, 9.4], [11.5, 9.4], [11.5, 13.2], [2, 13.2]])) return y > 12.3 ? 'c' : 'b';
  if (inPoly(x, y, [[11.5, 9.4], [14.5, 6], [14.5, 9.8], [11.5, 13.2]])) return 'c';
  return null;
}

// Shapes are authored in a 16-unit square; (x, y) is a sample point in it.
const SHAPES = {
  sword(x, y) {
    const b = seg(x, y, 5.6, 10.4, 14.2, 1.8);
    const w = 1.3 * Math.min(1, (1 - b.t) * 5);
    if (b.d < w && b.t > 0.01) return b.side < -0.35 ? 'a' : b.side > 0.35 ? 'c' : 'b';
    const g = seg(x, y, 3.1, 7.7, 8.3, 12.9);
    if (g.d < 0.85) return g.side > 0 ? 'g' : 'G';
    const h = seg(x, y, 5.4, 10.6, 2.7, 13.3);
    if (h.d < 0.65) return Math.floor(h.t * 5) % 2 ? 'd' : 'h';
    if (Math.hypot(x - 2.1, y - 13.9) < 1.2) return 'G';
    return null;
  },
  pickaxe(x, y) {
    const dx = x - 6, dy = y - 10;
    const d = Math.hypot(dx, dy), da = Math.atan2(dy, dx) + Math.PI / 4;
    if (Math.abs(da) < 1.0) {
      const thick = 1.0 * (1 - Math.pow(Math.abs(da), 3)) + 0.28;
      const off = d - 7.6;
      if (Math.abs(off) < thick) return Math.abs(da) > 0.8 ? 'c' : off > 0.3 ? 'a' : off < -0.45 ? 'c' : 'b';
    }
    const h = seg(x, y, 2.2, 13.8, 11.2, 4.8);
    if (h.d < 0.65) return h.side > 0 ? 'd' : 'h';
    return null;
  },
  axe(x, y) {
    const rx = x - 2.2, ry = y - 13.8;
    const s = (rx - ry) * 0.7071, q = (rx + ry) * 0.7071;
    if (q > 0.35 && q < 4.2 && s > 10.4 - q * 0.35 && s < 12.6 + q * 0.3) return q > 3.3 ? 'a' : q < 1.2 ? 'c' : 'b';
    if (q < -0.35 && q > -1.9 && s > 11.2 && s < 12.6) return 'c';
    if (Math.abs(q) < 0.65 && s > 0 && s < 13.4) return q > 0 ? 'd' : 'h';
    return null;
  },
  shears(x, y) {
    if (Math.hypot(x - 7.6, y - 8.8) < 0.75) return 'g';
    const b1 = seg(x, y, 7.6, 8.8, 12.8, 1.6);
    if (b1.d < 0.95 * (1 - b1.t * 0.6) + 0.18) return b1.side < 0 ? 'a' : 'c';
    const b2 = seg(x, y, 7.6, 8.8, 2.4, 1.6);
    if (b2.d < 0.95 * (1 - b2.t * 0.6) + 0.18) return b2.side > 0 ? 'a' : 'c';
    for (const cx of [4.6, 10.6]) {
      const d = Math.hypot(x - cx, y - 12.4);
      if (d > 1.05 && d < 2.45) return d > 1.9 ? 'R' : 'r';
    }
    if (seg(x, y, 7.6, 8.8, 5.6, 10.6).d < 0.75 || seg(x, y, 7.6, 8.8, 9.6, 10.6).d < 0.75) return 'r';
    return null;
  },
  bow(x, y) {
    if (x < 14.2 && y < 14.2) {
      const d = Math.hypot(x - 14.2, y - 14.2);
      const t = (Math.atan2(y - 14.2, x - 14.2) + Math.PI) / (Math.PI / 2);
      const thick = 0.5 + 0.6 * Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
      if (Math.abs(d - 11.4) < thick) {
        if (t > 0.42 && t < 0.58) return 'd';
        if (t < 0.07 || t > 0.93) return 'c';
        return d < 11.4 ? 'a' : 'b';
      }
    }
    if (seg(x, y, 2.9, 13.6, 13.6, 2.9).d < 0.32) return 's';
    return null;
  },
  arrow(x, y) {
    if (inPoly(x, y, [[14.5, 1.5], [10.5, 3.3], [12.7, 5.5]])) return x + y < 16 ? 'a' : 'c';
    const tail = seg(x, y, 2, 14, 5.4, 10.6);
    if (tail.d < 1.6 && tail.d > 0.4 && tail.t > 0.02 && tail.t < 0.98) return tail.side > 0 ? 'w' : 'r';
    if (seg(x, y, 2, 14, 12, 4).d < 0.42) return 'h';
    return null;
  },
  bar(x, y) { return ingot(x, y); },
  nugget(x, y) {
    // A little stack of three gold bars.
    const place = (cx, cy, s) => ingot(8.25 + (x - cx) / s, 9.6 + (y - cy) / s);
    return place(8, 7.2, 0.58) ?? place(4.6, 11.6, 0.58) ?? place(11.4, 11.6, 0.58);
  },
  coin(x, y) {
    const cx = 7.5, cy = 7.6;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= 6.2) {
      if (d > 5.1) return (x - cx) + (y - cy) < 0 ? 'a' : 'c';
      if (inPoly(x, y, star(cx, cy + 0.1, 2.9, 1.25))) return 'a';
      if (d > 3.6 && d < 4.3) return 'c';
      const ang = Math.atan2(y - cy, x - cx);
      if (d > 4.4 && d < 5 && ang < -1.6 && ang > -2.9) return 'w';
      return 'b';
    }
    if (Math.hypot(x - cx - 0.9, y - cy - 0.9) <= 6.2) return 'e';
    return null;
  },
  gem(x, y) {
    if (inPoly(x, y, [[5.6, 3], [10.4, 3], [9.7, 4.5], [6.3, 4.5]])) return 'w';
    if (inPoly(x, y, [[4.6, 3], [11.4, 3], [14, 6.6], [2, 6.6]])) return x < 8 ? 'a' : 'b';
    if (inPoly(x, y, [[2, 6.6], [14, 6.6], [8, 14.6]])) {
      if (Math.abs(y - 6.8) < 0.3) return 'c';
      return x < 6 ? 'a' : x < 10 ? 'b' : 'c';
    }
    return null;
  },
  apple(x, y) {
    const body = Math.hypot(x - 6.2, y - 9.4) < 4.9 || Math.hypot(x - 9.8, y - 9.4) < 4.9;
    if (body && !(y < 5.4 && Math.abs(x - 8) < 1.1)) {
      if (Math.hypot(x - 5, y - 7.2) < 1.1) return 'w';
      const l = (x - 8) * -0.09 + (y - 9.4) * -0.12;
      return l > 0.3 ? 'a' : l < -0.45 ? 'c' : 'b';
    }
    if (seg(x, y, 8, 5.8, 8.8, 2.2).d < 0.5) return 'e';
    const lx = x - 10.8, ly = y - 3.3, a = -0.45;
    const u = lx * Math.cos(a) + ly * Math.sin(a), v = -lx * Math.sin(a) + ly * Math.cos(a);
    if ((u / 2.3) ** 2 + (v / 1.05) ** 2 < 1) return 'k';
    return null;
  },
  steak(x, y) {
    const a = -0.6, dx = x - 9.2, dy = y - 7.8;
    const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    const e = (u / 5.8) ** 2 + (v / 4.1) ** 2 + 0.1 * Math.sin(u * 1.4);
    if (e < 1) {
      if (e > 0.76) return 'c';
      if (Math.abs(Math.sin(u * 1.3 + v * 0.7)) < 0.16 && e < 0.62) return 'W';
      if (((u - v * 0.4) % 2.8 + 2.8) % 2.8 < 0.4) return 'c';
      return u + v < 0 ? 'a' : 'b';
    }
    if (seg(x, y, 2.6, 13.4, 5.2, 10.8).d < 0.7) return 'W';
    if (Math.hypot(x - 2, y - 12.8) < 0.95 || Math.hypot(x - 2.9, y - 14) < 0.95) return 'W';
    return null;
  },
  helmet(x, y) {
    const inside = y >= 3.4 && y <= 11 && x >= 2.4 && x <= 13.6 && (y >= 6 || Math.hypot(x - 8, (y - 6.4) * 1.2) <= 5.7);
    if (!inside) return null;
    if (y > 7.8 && x > 4.6 && x < 11.4) return null;
    if (y > 10.2) return 'c';
    if (y < 4.6 && Math.abs(x - 8) < 2.5) return 'w';
    return x < 5 ? 'a' : x > 11 ? 'c' : 'b';
  },
  chestplate(x, y) {
    if (!inPoly(x, y, [[1.5, 3], [5.5, 3], [6.6, 4.8], [9.4, 4.8], [10.5, 3], [14.5, 3], [14.5, 7.6], [12.4, 7.6], [12.4, 13.6], [3.6, 13.6], [3.6, 7.6], [1.5, 7.6]])) return null;
    if (y > 12.6) return 'c';
    if (Math.abs(x - 8) < 0.45 && y > 5.2) return 'c';
    if (y < 4.3) return 'a';
    return x < 8 ? 'a' : 'b';
  },
  leggings(x, y) {
    if (!inPoly(x, y, [[3.4, 2.4], [12.6, 2.4], [12.6, 14], [9.2, 14], [8, 7], [6.8, 14], [3.4, 14]])) return null;
    if (y < 4.2) return y < 3.2 ? 'a' : 'c';
    if (y > 13.1) return 'c';
    return x < 8 ? 'a' : 'b';
  },
  boots(x, y) {
    const l = inPoly(x, y, [[2, 6], [5.6, 6], [5.6, 10.8], [7.2, 10.8], [7.2, 13.6], [2, 13.6]]);
    const r = inPoly(x, y, [[9.2, 6], [12.8, 6], [12.8, 10.8], [14.4, 10.8], [14.4, 13.6], [9.2, 13.6]]);
    if (!l && !r) return null;
    if (y < 7.3) return 'a';
    if (y > 12.7) return 'c';
    return l ? 'a' : 'b';
  },
  stick(x, y) {
    const s = seg(x, y, 2.5, 13.5, 13.5, 2.5);
    if (s.d < 1.1) return s.side < -0.2 ? 'a' : 'b';
    return null;
  },
  fireball(x, y) {
    const d = Math.hypot(x - 8, y - 8.6);
    const flick = Math.sin(x * 2.1) * 0.9 + Math.cos(y * 1.7) * 0.6;
    if (d < 2.6) return 'a';
    if (d < 4.6) return 'b';
    if (d < 6.2 + (y < 8 ? flick : 0)) return 'c';
    return null;
  },
  pearl(x, y) {
    const d = Math.hypot(x - 8, y - 8);
    if (d > 5.6) return null;
    if (Math.hypot(x - 6.3, y - 6.2) < 1.4) return 'w';
    return d > 4.6 ? 'c' : x + y < 15 ? 'a' : 'b';
  },
  egg(x, y) {
    const d = Math.hypot((x - 8) / 4.6, (y - 8.8) / 6);
    if (d > 1) return null;
    if (Math.hypot(x - 6.6, y - 6) < 1.1) return 'w';
    if ((Math.floor(x * 1.3) * 7 + Math.floor(y * 1.3) * 3) % 11 === 0) return 'c';
    return d > 0.82 ? 'c' : 'b';
  },
  tower(x, y) {
    if (y < 3.2 && x > 3 && x < 13 && (Math.floor(x) % 3 !== 1)) return 'a';
    if (x > 3 && x < 13 && y >= 3.2 && y < 14.5) {
      if (x > 6.8 && x < 9.2 && y > 5) return (Math.floor(y) % 2) ? 'h' : 'd';
      return (Math.floor(y) % 3 === 0) ? 'c' : 'b';
    }
    return null;
  },
  potion(x, y) {
    if (x > 6.4 && x < 9.6 && y > 1.4 && y < 3.2) return 'h';
    if (x > 6.8 && x < 9.2 && y >= 3.2 && y < 6.4) return 'W';
    const d = Math.hypot(x - 8, y - 10.2);
    if (d > 5) return null;
    if (Math.hypot(x - 6.2, y - 8.3) < 1) return 'w';
    return y > 9 ? (d > 4 ? 'c' : 'b') : 'a';
  },
  milk(x, y) {
    if (inPoly(x, y, [[3, 5], [13, 5], [11.6, 14], [4.4, 14]])) {
      if (y < 7) return 'w';
      return x > 10 ? 'c' : 'b';
    }
    const h = seg(x, y, 3.5, 5, 8, 1.5), h2 = seg(x, y, 8, 1.5, 12.5, 5);
    if (h.d < 0.55 || h2.d < 0.55) return 'g';
    return null;
  },
};

// ------------------------------------------------------------ sprites

function paletteFor(item, tint) {
  let pal = PALETTES[item.mat] ?? PALETTES.iron;
  if (item.mat === 'leather' && tint != null) {
    const t = hexToRgb(tint);
    const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    pal = { a: css(mix(t, [255, 255, 255], 0.35)), b: css(t), c: css(scale(t, 0.6)) };
  }
  const out = {};
  for (const [k, v] of Object.entries({ ...COMMON, ...pal })) out[k] = parseCss(v);
  out.e = item.sprite === 'coin' ? scale(out.c, 0.72) : out.e;
  return out;
}

function parseCss(v) {
  if (v.startsWith('#')) return hexToRgb(v);
  return v.match(/\d+/g).slice(0, 3).map(Number);
}

const spriteCache = new Map();

// { data: Uint8ClampedArray(32*32*4), canvas } for an item id.
export function itemSprite(id, tint) {
  const key = `${id}|${tint ?? ''}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const item = getItem(id);
  const data = new Uint8ClampedArray(N * N * 4);
  const shape = item && SHAPES[item.sprite];
  if (shape) {
    const pal = paletteFor(item, tint);
    const chain = item.mat === 'chain';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let k = shape((x + 0.5) / 2, (y + 0.5) / 2);
      if (!k) continue;
      if (chain && k === 'b' && (x + y * 2) % 4 === 0) k = 'c';
      const c = pal[k] ?? pal.b;
      const i = (y * N + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  // Cartoon outline around every filled pixel.
  const filled = (x, y) => x >= 0 && y >= 0 && x < N && y < N && data[(y * N + x) * 4 + 3] === 255;
  const outline = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (filled(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && filled(x + dx, y + dy)) { near = true; break; }
    if (near) outline.push([x, y]);
  }
  for (const [x, y] of outline) {
    const i = (y * N + x) * 4;
    data[i] = OUTLINE[0]; data[i + 1] = OUTLINE[1]; data[i + 2] = OUTLINE[2]; data[i + 3] = 254;
  }
  // Soft shade just inside the bottom-right edge for a rounder look.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    if (data[i + 3] !== 255) continue;
    const nb = (dx, dy) => { const j = ((y + dy) * N + x + dx) * 4; return x + dx < N && y + dy < N && data[j + 3] === 254; };
    if (nb(1, 0) || nb(0, 1)) { data[i] *= 0.84; data[i + 1] *= 0.84; data[i + 2] *= 0.84; }
  }
  for (let i = 3; i < data.length; i += 4) if (data[i] === 254) data[i] = 255;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  canvas.getContext('2d').putImageData(new ImageData(data, N, N), 0, 0);
  const out = { data, canvas };
  spriteCache.set(key, out);
  return out;
}

// Isometric little cube for block items in the hotbar.
const blockIconCache = new Map();
export function blockIcon(blockId, size = 48) {
  const key = `${blockId}|${size}`;
  if (blockIconCache.has(key)) return blockIconCache.get(key);
  const atlas = getAtlas();
  const b = BLOCKS[blockId];
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const S = size, k = 1 / TILE;
  if (b.render === 'ladder') {
    ctx.drawImage(atlas.tile('ladder'), 0, 0, S, S);
  } else {
    const face = (tile, a, bb, c, d, e, f, dark) => {
      ctx.setTransform(a * k, bb * k, c * k, d * k, e, f);
      ctx.drawImage(atlas.tile(tile), 0, 0);
      if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, TILE, TILE); }
    };
    const m = S * 0.04;
    const W = S - m * 2;
    face(b.tiles.top, W / 2, -W / 4, W / 2, W / 4, m, m + W / 4, 0);
    face(b.tiles.side, W / 2, W / 4, 0, W / 2, m, m + W / 4, 0.2);
    face(b.tiles.side, W / 2, -W / 4, 0, W / 2, m + W / 2, m + W / 2, 0.38);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Dark outline around the cube silhouette.
    ctx.strokeStyle = 'rgba(30,27,42,0.9)';
    ctx.lineWidth = Math.max(1, S / 32);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(m + W / 2, m);
    ctx.lineTo(m + W, m + W / 4);
    ctx.lineTo(m + W, m + W * 0.75);
    ctx.lineTo(m + W / 2, m + W);
    ctx.lineTo(m, m + W * 0.75);
    ctx.lineTo(m, m + W / 4);
    ctx.closePath();
    ctx.stroke();
  }
  blockIconCache.set(key, cv);
  return cv;
}

export function itemIcon(id, tint) {
  const item = getItem(id);
  if (!item) return null;
  if (item.kind === 'block') return blockIcon(item.block);
  return itemSprite(id, tint).canvas;
}

// Extrude a sprite into a thin slab of coloured voxels, 1 unit wide,
// centred on the origin in the XY plane, facing +z.
const meshCache = new Map();
export function itemGeometry(id, tint) {
  const key = `${id}|${tint ?? ''}`;
  if (meshCache.has(key)) return meshCache.get(key);
  const { data } = itemSprite(id, tint);
  const pos = [], col = [], nor = [], idx = [];
  const s = 1 / N, t = 1 / 16;
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : data[(y * N + x) * 4 + 3]);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const quad = (a, b, c, d, n, rgb, shade) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) {
      col.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
      nor.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!at(x, y)) continue;
    const i = (y * N + x) * 4;
    const rgb = [lin(data[i]), lin(data[i + 1]), lin(data[i + 2])];
    const x0 = x * s - 0.5, x1 = x0 + s;
    const y1 = 0.5 - y * s, y0 = y1 - s;
    const z0 = -t / 2, z1 = t / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], rgb, 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], rgb, 0.85);
    if (!at(x, y - 1)) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], rgb, 0.95);
    if (!at(x, y + 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], rgb, 0.6);
    if (!at(x - 1, y)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], rgb, 0.75);
    if (!at(x + 1, y)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], rgb, 0.7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  meshCache.set(key, g);
  return g;
}
