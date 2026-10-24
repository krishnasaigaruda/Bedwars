// Models: Minecraft-proportioned players with painted skins, detailed shop
// NPCs, the Dream Bed, generators, drops and labels. Everything is boxes with
// canvas-painted textures, no imported assets.
import * as THREE from 'three';
import { TEAMS } from '../config.js';
import { getItem } from '../game/items.js';
import { blockGeometry } from '../world/mesher.js';
import { getAtlas, hexToRgb, mulberry32 } from '../world/textures.js';
import { itemGeometry } from './sprites.js';

const P = 1.8 / 32;   // one skin pixel, in blocks
const RES = 2;        // texture pixels per skin pixel

const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}

const matCache = new Map();
export function lambert(color, emissive = 0) {
  const k = `${color}|${emissive}`;
  if (!matCache.has(k)) {
    const m = new THREE.MeshLambertMaterial({ color });
    if (emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = emissive; }
    matCache.set(k, m);
  }
  return matCache.get(k);
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// ------------------------------------------------------------- colors

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c) => (Array.isArray(c) ? c : hexToRgb(c));
const css = (c, f = 1) => { const v = rgb(c); return `rgb(${clamp(v[0] * f)},${clamp(v[1] * f)},${clamp(v[2] * f)})`; };
const blend = (a, b, t) => { const x = rgb(a), y = rgb(b); return [0, 1, 2].map((i) => clamp(x[i] + (y[i] - x[i]) * t)); };

function fill(ctx, x, y, w, h, c, f = 1) {
  ctx.fillStyle = css(c, f);
  ctx.fillRect(x, y, w, h);
}

// Per-pixel noisy fill with a gentle top-to-bottom darkening.
function speckle(ctx, W, H, c, rand, amt = 0.08, fade = 0.08) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    ctx.fillStyle = css(c, (1 + (rand() - 0.5) * amt) * (1 - (y / H) * fade));
    ctx.fillRect(x, y, 1, 1);
  }
}

// ------------------------------------------------------------- textures

function pixelTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

export function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(size, size, 1);
  return s;
}

// Floating text, drawn to a canvas. lines: [{ text, color, size, weight }]
export function makeLabel(lines, { background = 'rgba(20,18,32,0.45)', scale = 1 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const draw = (ls) => {
    const pad = 14, gap = 6;
    const fonts = ls.map((l) => `${l.weight ?? 800} ${l.size ?? 34}px Rubik, sans-serif`);
    let w = 0, h = pad * 2;
    ls.forEach((l, i) => {
      ctx.font = fonts[i];
      w = Math.max(w, ctx.measureText(l.text).width);
      h += (l.size ?? 34) + (i ? gap : 0);
    });
    canvas.width = Math.ceil(w + pad * 2);
    canvas.height = Math.ceil(h);
    if (background) {
      ctx.fillStyle = background;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
      ctx.fill();
    }
    let y = pad;
    ls.forEach((l, i) => {
      ctx.font = fonts[i];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(l.text, canvas.width / 2, y);
      ctx.fillStyle = l.color ?? '#fff';
      ctx.fillText(l.text, canvas.width / 2, y);
      y += (l.size ?? 34) + gap;
    });
    tex.needsUpdate = true;
    const k = 0.0105 * scale;
    sprite.scale.set(canvas.width * k, canvas.height * k, 1);
  };
  draw(lines);
  let last = JSON.stringify(lines);
  return {
    sprite,
    set(ls) {
      const key = JSON.stringify(ls);
      if (key === last) return;
      last = key;
      draw(ls);
    },
  };
}

// ------------------------------------------------------------- skin atlas

// BoxGeometry face order and the names our painters use. Faces are painted
// as seen from outside: on 'right' (+x) the canvas left edge is the back,
// on 'left' (-x) it is the front; 'front' is -z, the way models face.
const FACES = ['right', 'left', 'top', 'bottom', 'back', 'front'];

class SkinAtlas {
  constructor(w = 256, h = 256) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.x = 0; this.y = 0; this.row = 0;
    this.tex = null;
    this.mat = null;
  }

  alloc(w, h) {
    if (this.x + w > this.canvas.width) { this.x = 0; this.y += this.row; this.row = 0; }
    const r = { x: this.x, y: this.y };
    this.x += w;
    this.row = Math.max(this.row, h);
    return r;
  }

  // A box w x h x d skin pixels; paint(face, ctx, W, H) draws each face.
  box(w, h, d, paint, inflate = 0) {
    const geo = new THREE.BoxGeometry((w + inflate * 2) * P, (h + inflate * 2) * P, (d + inflate * 2) * P);
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const uv = geo.attributes.uv;
    const S = this.canvas.width, SH = this.canvas.height, e = 0.01;
    FACES.forEach((name, f) => {
      const W = dims[f][0] * RES, H = dims[f][1] * RES;
      const r = this.alloc(W, H);
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      paint(name, ctx, W, H);
      ctx.restore();
      const u0 = (r.x + e) / S, u1 = (r.x + W - e) / S;
      const v0 = 1 - (r.y + H - e) / SH, v1 = 1 - (r.y + e) / SH;
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
      }
    });
    uv.needsUpdate = true;
    if (this.tex) this.tex.needsUpdate = true;
    return geo;
  }

  material() {
    if (this.mat) return this.mat;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshLambertMaterial({ map: this.tex, alphaTest: 0.5 });
    return this.mat;
  }
}

// Builds a Minecraft-shaped humanoid. paint = { head, hat, body, jacket, arm, leg },
// each (face, ctx, W, H, side) where side is 'R' or 'L' for limbs.
function buildHumanoid(atlas, paint) {
  const mat = atlas.material();
  const mesh = (geo, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const leg = (side, x) => {
    const g = new THREE.Group();
    g.position.set(x, 12 * P, 0);
    g.add(mesh(atlas.box(4, 12, 4, (f, c, W, H) => paint.leg(f, c, W, H, side)), 0, -6 * P, 0));
    body.add(g);
    return g;
  };
  const legR = leg('R', 2 * P);
  const legL = leg('L', -2 * P);

  const torso = new THREE.Group();
  torso.position.y = 12 * P;
  body.add(torso);
  torso.add(mesh(atlas.box(8, 12, 4, paint.body), 0, 6 * P, 0));
  if (paint.jacket) torso.add(mesh(atlas.box(8, 12, 4, paint.jacket, 0.25), 0, 6 * P, 0));

  const head = new THREE.Group();
  head.position.y = 12 * P;
  torso.add(head);
  head.add(mesh(atlas.box(8, 8, 8, paint.head), 0, 4 * P, 0));
  if (paint.hat) head.add(mesh(atlas.box(8, 8, 8, paint.hat, 0.5), 0, 4 * P, 0));

  const arm = (side, x) => {
    const g = new THREE.Group();
    g.position.set(x, 10 * P, 0);
    g.add(mesh(atlas.box(4, 12, 4, (f, c, W, H) => paint.arm(f, c, W, H, side)), 0, -4 * P, 0));
    torso.add(g);
    return g;
  };
  const armR = arm('R', 6 * P);
  const armL = arm('L', -6 * P);

  const hand = new THREE.Group();
  hand.position.set(0, -9.5 * P, 0);
  armR.add(hand);

  return { root, body, torso, head, armR, armL, legR, legL, hand, mesh, mat };
}

// ------------------------------------------------------------- player looks

const SKINS = ['#f2c39b', '#e5b083', '#d29a6b', '#a8704a', '#7d4e33', '#f7d7bd'];
const HAIRS = ['#3b2418', '#6b3f22', '#1f1b1b', '#d9a441', '#a33b2b', '#efe4c8', '#4a5bd6', '#2c6b3a', '#8a4fc7'];
const EYES = ['#3b6fd6', '#4b8a3a', '#6b4021', '#2b2b33', '#7a4fc0'];
const PANTS = ['#34416b', '#3a3f58', '#5a4632', '#2f3540', '#4a5a3a'];
const SHOES = ['#2d2f3a', '#5a3a22', '#e8e8ee', '#b8323a'];
const STYLES = ['short', 'fringe', 'side', 'long', 'cap', 'spiky'];
const CAPS = ['#d83a3a', '#2f2f3a', '#f2f2f2', '#3f7bff', '#3fbf6a'];

// Everything the Wardrobe can change, and the allowed values.
export const LOOK_OPTIONS = {
  skin: SKINS, hairStyle: STYLES, hair: HAIRS, eyes: EYES,
  shirt: ['hoodie', 'tee'], pants: PANTS, shoes: SHOES, cap: CAPS,
};

// The look generated from a name, with any Wardrobe choices on top
// (unknown or invalid values are ignored).
export function resolveLook(name, custom) {
  const L = looksFor(name || 'player');
  if (custom && typeof custom === 'object') {
    for (const [k, opts] of Object.entries(LOOK_OPTIONS)) if (opts.includes(custom[k])) L[k] = custom[k];
  }
  return L;
}

export function looksFor(name) {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const r = mulberry32(h);
  const pick = (a) => a[Math.floor(r() * a.length)];
  return {
    seed: h,
    skin: pick(SKINS),
    hair: pick(HAIRS),
    eyes: pick(EYES),
    pants: pick(PANTS),
    shoes: pick(SHOES),
    hairStyle: pick(STYLES),
    cap: pick(CAPS),
    shirt: r() < 0.6 ? 'hoodie' : 'tee',
  };
}

// A player's face (front of the head plus hair layer) as a small image URL,
// for the HUD's player bar.
const faceCache = new Map();
export function faceIcon(name, look) {
  const key = `${name}|${look ? JSON.stringify(look) : ''}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const L = resolveLook(name, look);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  const paint = playerPainters(L, 0xffffff);
  paint.head('front', ctx, 16, 16);
  paint.hat('front', ctx, 16, 16);
  const url = cv.toDataURL();
  faceCache.set(key, url);
  return url;
}

function hairHeight(L, x, rand) {
  switch (L.hairStyle) {
    case 'fringe': return 5 + [0, 1, 2, 1][x % 4] + (x < 2 || x > 13 ? 2 : 0);
    case 'side': return x < 9 ? 6 + (x < 4 ? 1 : 0) : 4;
    case 'long': return x < 2 || x > 13 ? 14 : 5 + (x % 3 === 0 ? 1 : 0);
    case 'cap': return 6;
    case 'spiky': return 4 + (rand() < 0.4 ? 1 : 0);
    default: return x < 2 || x > 13 ? 6 : 4;
  }
}

function paintFace(ctx, L, rand, { eyes = L.eyes, brows = true } = {}) {
  // Eyes: whites toward the sides, irises toward the nose, with a catchlight.
  for (const [wx, ix] of [[2, 4], [12, 10]]) {
    fill(ctx, wx, 8, 2, 2, '#ffffff');
    fill(ctx, ix, 8, 2, 2, eyes);
    fill(ctx, ix, 8, 1, 1, blend(eyes, '#ffffff', 0.45));
    fill(ctx, ix + 1, 9, 1, 1, eyes, 0.6);
  }
  if (brows) { fill(ctx, 2, 6, 4, 1, L.hair, 0.75); fill(ctx, 10, 6, 4, 1, L.hair, 0.75); }
  fill(ctx, 7, 10, 2, 2, L.skin, 0.86);
  fill(ctx, 6, 12, 4, 1, '#8a3f35');
  fill(ctx, 5, 11, 1, 1, '#8a3f35');
  fill(ctx, 10, 11, 1, 1, '#8a3f35');
  ctx.fillStyle = 'rgba(255,110,130,0.35)';
  ctx.fillRect(2, 10, 2, 2);
  ctx.fillRect(12, 10, 2, 2);
}

function playerPainters(L, teamHex) {
  const rand = mulberry32(L.seed);
  const team = rgb(teamHex);
  const capped = L.hairStyle === 'cap';
  return {
    head(face, ctx, W, H) {
      speckle(ctx, W, H, L.skin, rand, 0.06, 0.05);
      if (face === 'top') return speckle(ctx, W, H, capped ? L.cap : L.hair, rand, 0.16, 0);
      if (face === 'bottom') { fill(ctx, 0, 0, W, H, L.skin, 0.88); return; }
      const long = L.hairStyle === 'long';
      if (face === 'back') {
        const hb = long ? 16 : 12;
        for (let y = 0; y < hb; y++) for (let x = 0; x < W; x++) fill(ctx, x, y, 1, 1, L.hair, (1 + (rand() - 0.5) * 0.18) * (x % 3 === 0 ? 0.9 : 1));
        if (capped) speckle(ctx, W, 6, L.cap, rand, 0.1, 0);
        return;
      }
      if (face === 'right' || face === 'left') {
        const backFirst = face === 'right';
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const back = backFirst ? x < 8 : x >= 8;
          const hh = back ? (long ? 16 : 11) : (long ? 13 : 5);
          if (y < hh) fill(ctx, x, y, 1, 1, L.hair, 1 + (rand() - 0.5) * 0.18);
        }
        fill(ctx, backFirst ? 8 : 6, 8, 2, 3, L.skin, 0.84);
        if (capped) speckle(ctx, W, 6, L.cap, rand, 0.1, 0);
        return;
      }
      // Front.
      for (let x = 0; x < W; x++) {
        const hh = hairHeight(L, x, rand);
        for (let y = 0; y < hh; y++) fill(ctx, x, y, 1, 1, L.hair, (1 + (rand() - 0.5) * 0.16) * (y === hh - 1 ? 0.82 : 1));
      }
      if (capped) speckle(ctx, W, 5, L.cap, rand, 0.1, 0);
      paintFace(ctx, L, rand, { brows: L.hairStyle !== 'fringe' });
    },
    hat(face, ctx, W, H) {
      if (capped) {
        if (face === 'top') { speckle(ctx, W, H, L.cap, rand, 0.1, 0); fill(ctx, 6, 6, 4, 4, L.cap, 1.2); }
        else if (face !== 'bottom') {
          speckle(ctx, W, 5, L.cap, rand, 0.1, 0);
          if (face === 'front') fill(ctx, 0, 5, W, 2, L.cap, 0.7);
        }
        return;
      }
      if (face === 'top') return speckle(ctx, W, H, L.hair, rand, 0.2, 0);
      if (face === 'bottom') return;
      const long = L.hairStyle === 'long';
      const rows = face === 'front' ? 3 : face === 'back' ? (long ? 15 : 10) : 6;
      for (let x = 0; x < W; x++) {
        let hh = rows - (rand() < 0.35 ? 1 : 0);
        if (L.hairStyle === 'spiky' && face === 'front') hh = x % 4 < 2 ? 3 : 1;
        for (let y = 0; y < hh; y++) fill(ctx, x, y, 1, 1, L.hair, 1.05 + (rand() - 0.5) * 0.2);
      }
    },
    body(face, ctx, W, H) {
      if (face === 'bottom') return speckle(ctx, W, H, L.pants, rand, 0.08, 0);
      speckle(ctx, W, H, team, rand, 0.07, 0.1);
      if (face !== 'top') fill(ctx, 0, H - 3, W, 3, team, 0.76);
      if (face === 'top') { fill(ctx, 5, 2, 6, 4, L.skin, 0.9); return; }
      if (face === 'front') {
        fill(ctx, 6, 0, 4, 2, L.skin); fill(ctx, 7, 2, 2, 1, L.skin);
        if (L.shirt === 'hoodie') {
          fill(ctx, 5, 1, 1, 8, '#f4f4f8'); fill(ctx, 10, 1, 1, 8, '#f4f4f8');
          fill(ctx, 5, 9, 1, 1, '#c9c9d4'); fill(ctx, 10, 9, 1, 1, '#c9c9d4');
          fill(ctx, 3, 14, 10, 6, team, 0.84);
          fill(ctx, 3, 14, 10, 1, team, 0.7);
          fill(ctx, 3, 15, 1, 5, team, 0.74); fill(ctx, 12, 15, 1, 5, team, 0.74);
        } else {
          fill(ctx, 0, 6, W, 2, '#ffffff', 0.95);
          fill(ctx, 6, 10, 4, 4, '#ffffff', 0.95);
          fill(ctx, 7, 11, 2, 2, team, 0.8);
        }
      }
      if (face === 'back' && L.shirt === 'hoodie') {
        fill(ctx, 3, 0, 10, 6, team, 0.82);
        fill(ctx, 3, 6, 10, 1, team, 0.66);
      }
    },
    jacket(face, ctx, W) {
      // The hood bunched up behind the neck.
      if (L.shirt !== 'hoodie') return;
      if (face === 'back') { speckle(ctx, W, 5, team, rand, 0.08, 0); fill(ctx, 0, 4, W, 1, team, 0.7); }
      if (face === 'top') fill(ctx, 0, 6, W, 2, team, 0.86);
    },
    arm(face, ctx, W, H, side) {
      if (face === 'bottom') return speckle(ctx, W, H, L.skin, rand, 0.06, 0);
      speckle(ctx, W, H, team, rand, 0.07, 0.08);
      if (face === 'top') return;
      fill(ctx, 0, 16, W, 2, team, 0.72);
      for (let y = 18; y < H; y++) for (let x = 0; x < W; x++) fill(ctx, x, y, 1, 1, L.skin, (1 + (rand() - 0.5) * 0.06) * (y === H - 1 ? 0.86 : 1));
      if (face === (side === 'R' ? 'left' : 'right')) fill(ctx, 0, 0, W, 16, team, 0.88);
    },
    leg(face, ctx, W, H) {
      if (face === 'bottom') return fill(ctx, 0, 0, W, H, '#cfcfd6');
      speckle(ctx, W, H, L.pants, rand, 0.08, 0.06);
      if (face === 'top') return;
      fill(ctx, 0, 9, W, 1, L.pants, 0.9);
      for (let y = 20; y < H; y++) fill(ctx, 0, y, W, 1, L.shoes, y === 20 ? 1.1 : 1);
      fill(ctx, 0, H - 1, W, 1, '#e9e9ee');
      if (face === 'front') { fill(ctx, 2, 20, 1, 1, '#f4f4f8'); fill(ctx, 5, 20, 1, 1, '#f4f4f8'); }
    },
  };
}

// ------------------------------------------------------------- armor

const ARMOR_COLORS = { chain: '#a8aeb9', iron: '#dfe3ea', diamond: '#56e4f0', gold: '#ffd23f' };

function armorPainter(color, chain, rand, cover = () => true) {
  return (face, ctx, W, H) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!cover(face, x, y, W, H)) continue;
      let f = 1 + (rand() - 0.5) * 0.08;
      if (y === 0) f *= 1.2;
      if (y === H - 1 || x === W - 1) f *= 0.72;
      if (x === 0) f *= 1.1;
      if (chain && (x + y * 2) % 4 === 0) f *= 0.62;
      fill(ctx, x, y, 1, 1, color, f);
    }
  };
}

// ------------------------------------------------------------- items in hand

let blockMat = null, itemMat = null;
export function blockMaterial() {
  if (!blockMat) blockMat = new THREE.MeshBasicMaterial({ map: getAtlas().texture, vertexColors: true, alphaTest: 0.5 });
  return blockMat;
}
export function itemMaterial() {
  if (!itemMat) itemMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return itemMat;
}

export function heldItemObject(id, tint) {
  const item = getItem(id);
  if (!item) return null;
  if (item.kind === 'block') return new THREE.Mesh(blockGeometry(item.block), blockMaterial());
  return new THREE.Mesh(itemGeometry(id, tint), itemMaterial());
}

export function createDropModel(id, tint) {
  const g = new THREE.Group();
  const item = getItem(id);
  if (!item) return g;
  const obj = heldItemObject(id, tint);
  obj.scale.setScalar(item.kind === 'block' ? 0.25 : 0.42);
  g.add(obj);
  return g;
}

// Pose a held object on a third-person hand: blade forward and up, grip in the fist.
function poseInHand(obj, item) {
  if (item.kind === 'block') {
    obj.scale.setScalar(0.24);
    obj.position.set(0, -0.02, -0.08);
    obj.rotation.set(0, Math.PI / 4, 0);
    return;
  }
  const s = 0.62;
  obj.scale.setScalar(s);
  obj.rotation.set(0, Math.PI / 2, 0);
  obj.position.set(0, 0.25 * s - 0.02, -0.25 * s - 0.04);
}

// ------------------------------------------------------------- players

export class PlayerModel {
  constructor({ team = 0, name = '', showName = true, look = null } = {}) {
    this.team = team;
    this.look = resolveLook(name, look);
    this.atlas = new SkinAtlas();
    this.paint = playerPainters(this.look, TEAMS[team].hex);
    const h = buildHumanoid(this.atlas, this.paint);
    Object.assign(this, h);
    this.armor = null;
    this.armorTier = null;

    if (showName) {
      this.label = makeLabel([{ text: name, color: TEAMS[team].css, size: 30 }], { scale: 0.85 });
      this.label.sprite.position.y = 2.15;
      this.root.add(this.label.sprite);
    }

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.root.add(this.shadow);

    this.limb = 0;
    this.limbAmt = 0;
    this.age = 0;
    this.heldId = null;
  }

  setHeld(id, tint) {
    const key = id ? `${id}|${tint ?? ''}` : null;
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.heldId = id;
    this.hand.clear();
    const obj = id && heldItemObject(id, tint);
    if (!obj) return;
    poseInHand(obj, getItem(id));
    this.hand.add(obj);
  }

  // Team leather helmet and chestplate; legs/boots in the bought tier.
  // opts: { top, legs } armor tiers ('leather' | 'chain' | 'iron' | 'diamond')
  // for the helmet/chestplate and the leggings/boots; null hides all armor.
  setArmor(opts) {
    if (!opts) {
      if (this.armor) for (const m of [...this.armor.all, ...this.armor.legs]) m.visible = false;
      return;
    }
    const legsTier = opts.legs ?? 'leather';
    const topTier = opts.top ?? 'leather';
    const colorFor = (tier) => (tier === 'leather' ? blend(TEAMS[this.team].hex, '#8a5a32', 0.12) : ARMOR_COLORS[tier]);
    if (!this.armor) this.armor = { all: [], legs: [] };
    if (topTier !== this.armorTopTier) {
      this.armorTopTier = topTier;
      for (const m of this.armor.all) { m.parent.remove(m); m.geometry.dispose(); }
      const rand = mulberry32(this.look.seed + 5);
      const color = colorFor(topTier);
      const chain = topTier === 'chain';
      const body = armorPainter(color, chain, rand);
      const helmet = armorPainter(color, chain, rand, (f, x, y) => f !== 'bottom' && (f !== 'front' || y < 5 || x < 2 || x > 13) && (f === 'top' || f === 'back' || y < 11 || (f === 'right' ? x < 8 : f === 'left' ? x >= 8 : false)));
      const a = this.atlas;
      const all = [];
      const add = (parent, geo, x, y, z) => { const m = this.mesh(geo, x, y, z); parent.add(m); all.push(m); return m; };
      add(this.head, a.box(8, 8, 8, helmet, 1), 0, 4 * P, 0);
      add(this.torso, a.box(8, 12, 4, body, 0.9), 0, 6 * P, 0);
      add(this.armR, a.box(4, 5, 4, body, 1), 0, -0.5 * P, 0);
      add(this.armL, a.box(4, 5, 4, body, 1), 0, -0.5 * P, 0);
      this.armor.all = all;
    }
    for (const m of this.armor.all) m.visible = true;
    if (legsTier !== this.armorTier) {
      this.armorTier = legsTier;
      for (const m of this.armor.legs) { m.parent.remove(m); m.geometry.dispose(); }
      const rand = mulberry32(this.look.seed + 9);
      const paint = armorPainter(colorFor(legsTier), legsTier === 'chain', rand);
      const a = this.atlas;
      this.armor.legs = [];
      for (const leg of [this.legR, this.legL]) {
        for (const [geo, y] of [[a.box(4, 8, 4, paint, 0.5), -4 * P], [a.box(4, 4, 4, paint, 1), -10 * P]]) {
          const m = this.mesh(geo, 0, y, 0);
          leg.add(m);
          this.armor.legs.push(m);
        }
      }
    }
    for (const m of this.armor.legs) m.visible = true;
  }

  // Minecraft's biped animation, converted to our axes
  // (three.x = -mc.x, three.y = -mc.y, three.z = mc.z).
  animate(dt, { speed = 0, sneaking = false, swing = 0, pitch = 0, flying = false } = {}) {
    const target = Math.min(1, speed / 5);
    this.limbAmt += (target - this.limbAmt) * Math.min(1, dt * 10);
    this.limb += dt * 20 * this.limbAmt;
    this.age += dt * 20;
    const ls = this.limb * 0.6662;
    const la = flying ? this.limbAmt * 0.25 : this.limbAmt;

    let rArmX = Math.cos(ls + Math.PI) * la;
    let lArmX = Math.cos(ls) * la;
    let rArmY = 0, lArmY = 0, rArmZ = 0, lArmZ = 0, bodyY = 0;
    const rLegX = Math.cos(ls) * 1.4 * la;
    const lLegX = Math.cos(ls + Math.PI) * 1.4 * la;
    if (this.heldId) rArmX = rArmX * 0.5 - Math.PI / 10;
    if (swing > 0) {
      const f = swing;
      bodyY = Math.sin(Math.sqrt(f) * Math.PI * 2) * 0.2;
      rArmY += bodyY; lArmY += bodyY; lArmX += bodyY;
      let f1 = 1 - f; f1 *= f1; f1 *= f1; f1 = 1 - f1;
      const f2 = Math.sin(f1 * Math.PI);
      const f3 = Math.sin(f * Math.PI) * (pitch + 0.7) * 0.75;
      rArmX -= f2 * 1.2 + f3;
      rArmY += bodyY * 2;
      rArmZ += Math.sin(f * Math.PI) * -0.4;
    }
    rArmZ += Math.cos(this.age * 0.09) * 0.05 + 0.05;
    lArmZ -= Math.cos(this.age * 0.09) * 0.05 + 0.05;
    rArmX += Math.sin(this.age * 0.067) * 0.05;
    lArmX -= Math.sin(this.age * 0.067) * 0.05;

    this.armR.rotation.set(-rArmX, -rArmY, rArmZ);
    this.armL.rotation.set(-lArmX, -lArmY, lArmZ);
    this.legR.rotation.x = -rLegX;
    this.legL.rotation.x = -lLegX;
    this.torso.rotation.y = -bodyY;

    const lean = sneaking ? -0.45 : 0;
    this.torso.rotation.x = lean;
    this.torso.position.y = 12 * P - (sneaking ? 0.1 : 0);
    this.legR.position.z = this.legL.position.z = sneaking ? 0.14 : 0;
    this.head.rotation.x = Math.max(-1.4, Math.min(1.4, pitch)) - lean;
  }
}

// The right arm on its own, for the first-person view. Origin at the top
// of the shoulder, hanging down -y, front toward -z.
export function createFirstPersonArm({ team = 0, name = 'player', look = null } = {}) {
  const atlas = new SkinAtlas(64, 32);
  const paint = playerPainters(resolveLook(name, look), TEAMS[team].hex);
  const geo = atlas.box(4, 12, 4, (f, c, W, H) => paint.arm(f, c, W, H, 'R'));
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, atlas.material());
  m.position.y = -6 * P;
  g.add(m);
  return g;
}

// ------------------------------------------------------------- Dream Bed

export function createBedModel(team) {
  const g = new THREE.Group();
  const color = TEAMS[team].hex;
  const wood = lambert(0xc98a4b), woodDark = lambert(0x8e5a2c);
  const quilt = lambert(color);
  const quiltLight = lambert(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex());
  const cream = lambert(0xfff6e4), white = lambert(0xffffff);

  for (const [x, z] of [[-0.42, -0.9], [0.42, -0.9], [-0.42, 0.9], [0.42, 0.9]]) g.add(box(0.12, 0.18, 0.12, woodDark, x, 0.09, z));
  g.add(box(1.0, 0.13, 2.0, wood, 0, 0.235, 0));
  g.add(box(0.92, 0.14, 1.88, cream, 0, 0.37, 0));
  g.add(box(0.98, 0.1, 1.3, quilt, 0, 0.47, 0.3));
  g.add(box(0.985, 0.11, 0.16, quiltLight, 0, 0.475, -0.3));
  for (const sx of [-1, 1]) g.add(box(0.02, 0.2, 1.3, quilt, sx * 0.495, 0.38, 0.3));
  g.add(box(0.98, 0.2, 0.02, quilt, 0, 0.38, 0.945));
  const star = new THREE.Group();
  star.position.set(0, 0.525, 0.38);
  star.add(box(0.34, 0.012, 0.07, quiltLight));
  star.add(box(0.07, 0.012, 0.34, quiltLight));
  const diag = box(0.2, 0.012, 0.2, quiltLight);
  diag.rotation.y = Math.PI / 4;
  star.add(diag);
  g.add(star);

  const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8), white);
  pillow.scale.set(0.72, 0.2, 0.36);
  pillow.position.set(0, 0.5, -0.66);
  g.add(pillow);

  g.add(box(1.04, 0.5, 0.1, wood, 0, 0.47, -0.97));
  g.add(box(0.62, 0.26, 0.02, quilt, 0, 0.52, -0.915));
  g.add(box(1.04, 0.3, 0.08, wood, 0, 0.33, 0.97));
  for (const sx of [-1, 1]) {
    g.add(box(0.13, 0.76, 0.13, woodDark, sx * 0.5, 0.38, -0.97));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), quilt);
    knob.position.set(sx * 0.5, 0.82, -0.97);
    g.add(knob);
  }

  // Floating crystal: lets you spot the bed from across the map.
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55, flatShading: true }),
  );
  crystal.scale.y = 1.5;
  crystal.position.set(0, 1.45, -0.2);
  g.add(crystal);
  const glow = glowSprite(color, 1.4);
  glow.position.copy(crystal.position);
  g.add(glow);

  g.userData.update = (t) => {
    crystal.rotation.y = t * 1.6;
    crystal.position.y = 1.45 + Math.sin(t * 2) * 0.08;
    glow.position.y = crystal.position.y;
    glow.material.opacity = 0.55 + Math.sin(t * 3) * 0.15;
  };
  return g;
}

// ------------------------------------------------------------- NPCs

// The shopkeeper: a green goblin merchant in a purple hood with a pack of wares.
function goblinPainters(rand) {
  const skin = '#7cc35a', robe = '#5b3fa6', gold = '#ffcf3a', belt = '#6b3f1c';
  return {
    skin,
    head(face, ctx, W, H) {
      speckle(ctx, W, H, skin, rand, 0.08, 0.05);
      if (face !== 'front') return;
      fill(ctx, 2, 5, 4, 1, '#3d6b2a'); fill(ctx, 10, 5, 4, 1, '#3d6b2a');
      fill(ctx, 2, 6, 3, 4, '#ffe066'); fill(ctx, 11, 6, 3, 4, '#ffe066');
      fill(ctx, 3, 7, 2, 2, '#1b1b22'); fill(ctx, 11, 7, 2, 2, '#1b1b22');
      fill(ctx, 3, 7, 1, 1, '#ffffff'); fill(ctx, 11, 7, 1, 1, '#ffffff');
      fill(ctx, 7, 8, 2, 4, skin, 0.8); fill(ctx, 6, 10, 4, 1, skin, 0.72);
      fill(ctx, 4, 12, 8, 2, '#3a1c1c');
      for (const x of [5, 7, 9]) fill(ctx, x, 12, 1, 1, '#f6f2e0');
      fill(ctx, 4, 11, 1, 1, '#3a1c1c'); fill(ctx, 11, 11, 1, 1, '#3a1c1c');
    },
    hat(face, ctx, W, H) {
      // The hood frames the face.
      if (face === 'bottom') return;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (face === 'front' && y >= 4 && x >= 2 && x <= 13) continue;
        if ((face === 'right' || face === 'left') && y > 12) continue;
        fill(ctx, x, y, 1, 1, robe, 1 + (rand() - 0.5) * 0.1);
      }
      if (face === 'front') { fill(ctx, 2, 3, 12, 1, gold); fill(ctx, 1, 4, 1, 12, gold); fill(ctx, 14, 4, 1, 12, gold); }
    },
    body(face, ctx, W, H) {
      speckle(ctx, W, H, robe, rand, 0.08, 0.12);
      if (face === 'top' || face === 'bottom') return;
      fill(ctx, 0, 13, W, 3, belt);
      fill(ctx, 0, H - 2, W, 2, gold);
      if (face === 'front') {
        fill(ctx, 7, 0, 2, 13, robe, 1.25);
        fill(ctx, 6, 0, 1, 13, gold); fill(ctx, 9, 0, 1, 13, gold);
        fill(ctx, 6, 13, 4, 3, gold); fill(ctx, 7, 14, 2, 1, '#8a6a10');
      }
    },
    arm(face, ctx, W, H) {
      speckle(ctx, W, H, robe, rand, 0.08, 0.08);
      if (face === 'top') return;
      if (face === 'bottom') return speckle(ctx, W, H, skin, rand, 0.06, 0);
      fill(ctx, 0, 15, W, 2, gold);
      ctx.save(); ctx.translate(0, 17); speckle(ctx, W, 7, skin, rand, 0.06, 0); ctx.restore();
    },
    leg(face, ctx, W, H) {
      speckle(ctx, W, H, '#3a2f4a', rand, 0.08, 0.05);
      if (face === 'top') return;
      if (face === 'bottom') return fill(ctx, 0, 0, W, H, '#3d2615');
      fill(ctx, 0, 18, W, 6, '#6b4325');
      fill(ctx, 0, 18, W, 1, '#8a5a32');
      fill(ctx, 0, H - 1, W, 1, '#3d2615');
    },
  };
}

// The upgrades NPC: a bearded tinker with goggles, apron and a hammer.
function tinkerPainters(rand) {
  const skin = '#f0c29b', beard = '#c8642a', shirt = '#4a6fd8', apron = '#7a4f2e';
  return {
    skin, beard,
    head(face, ctx, W, H) {
      speckle(ctx, W, H, skin, rand, 0.06, 0.05);
      if (face === 'top') return speckle(ctx, W, H, '#5a3a22', rand, 0.1, 0);
      if (face === 'back' || face === 'right' || face === 'left') {
        fill(ctx, 0, 0, W, 4, '#5a3a22');
        if (face !== 'back') fill(ctx, face === 'right' ? W - 4 : 0, 9, 4, 7, beard);
        return;
      }
      fill(ctx, 0, 0, W, 4, '#5a3a22');
      fill(ctx, 2, 6, 4, 2, beard, 0.85); fill(ctx, 10, 6, 4, 2, beard, 0.85);
      fill(ctx, 4, 8, 2, 2, '#1b1b22'); fill(ctx, 10, 8, 2, 2, '#1b1b22');
      fill(ctx, 4, 8, 1, 1, '#ffffff'); fill(ctx, 10, 8, 1, 1, '#ffffff');
      fill(ctx, 6, 9, 4, 3, '#e8a08a');
      fill(ctx, 2, 11, 12, 5, beard);
      fill(ctx, 4, 11, 8, 1, beard, 0.8);
    },
    hat(face, ctx, W) {
      // Goggle strap all round the head.
      if (face === 'top' || face === 'bottom') return;
      fill(ctx, 0, 4, W, 2, '#2b2a33');
    },
    body(face, ctx, W, H) {
      speckle(ctx, W, H, shirt, rand, 0.08, 0.1);
      if (face === 'top' || face === 'bottom') return;
      fill(ctx, 0, 14, W, 2, '#3a2a1e');
      if (face === 'front') {
        for (let y = 4; y < H; y++) for (let x = 2; x < 14; x++) fill(ctx, x, y, 1, 1, apron, 1 + (rand() - 0.5) * 0.1);
        fill(ctx, 3, 0, 1, 4, apron); fill(ctx, 12, 0, 1, 4, apron);
        fill(ctx, 5, 17, 6, 4, apron, 0.8);
        fill(ctx, 2, 14, 12, 2, '#3a2a1e');
        fill(ctx, 7, 14, 2, 2, '#c9ced8');
        fill(ctx, 0, 0, W, 1, beard);
      }
    },
    arm(face, ctx, W, H) {
      speckle(ctx, W, H, skin, rand, 0.06, 0.05);
      if (face === 'bottom') return;
      speckle(ctx, W, 8, shirt, rand, 0.08, 0);
      if (face === 'top') return;
      fill(ctx, 0, 8, W, 2, shirt, 1.25);
      for (let k = 0; k < 4; k++) fill(ctx, Math.floor(rand() * W), 11 + Math.floor(rand() * 8), 1, 1, beard, 0.8);
    },
    leg(face, ctx, W, H) {
      speckle(ctx, W, H, '#5a4632', rand, 0.08, 0.05);
      if (face === 'top') return;
      if (face === 'bottom') return fill(ctx, 0, 0, W, H, '#2a1d14');
      fill(ctx, 0, 18, W, 6, '#3a2a1e');
      if (face === 'front') fill(ctx, 0, 21, W, 3, '#9aa2b2');
    },
  };
}

export function createNPC(kind) {
  const trader = kind === 'shop';
  const rand = mulberry32(trader ? 11 : 23);
  const atlas = new SkinAtlas();
  const paint = trader ? goblinPainters(rand) : tinkerPainters(rand);
  const h = buildHumanoid(atlas, paint);
  const g = h.root;
  const extra = (geo, parent, x, y, z) => { const m = h.mesh(geo, x, y, z); parent.add(m); return m; };
  const solid = (c) => (face, ctx, W, H) => speckle(ctx, W, H, c, rand, 0.1, 0.05);

  if (trader) {
    // Pointy ears.
    for (const s of [-1, 1]) {
      const ear = extra(atlas.box(1, 3, 3, solid(paint.skin)), h.head, s * 6 * P, 4.5 * P, 0.5 * P);
      ear.rotation.z = s * 0.55;
    }
    // Pouches on the belt.
    for (const s of [-1, 1]) extra(atlas.box(2, 3, 2, (f, ctx, W, H) => { speckle(ctx, W, H, '#7a4a24', rand, 0.1, 0); fill(ctx, 0, 0, W, 1, '#ffcf3a'); }), h.torso, s * 3 * P, 4 * P, -3 * P);
    // Backpack full of wares.
    const pack = extra(atlas.box(8, 10, 4, (f, ctx, W, H) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fill(ctx, x, y, 1, 1, '#c98340', (1 + (rand() - 0.5) * 0.08) * (y % 6 === 5 ? 0.62 : 1));
      if (f === 'back' || f === 'front') { fill(ctx, 2, 0, 2, H, '#5a3414'); fill(ctx, 12, 0, 2, H, '#5a3414'); fill(ctx, 6, 8, 4, 3, '#cfd4de'); }
    }), h.torso, 0, 6.5 * P, 4 * P);
    const sword = heldItemObject('iron_sword');
    sword.scale.setScalar(0.55);
    sword.rotation.set(0, Math.PI / 2, 0.5);
    sword.position.set(0.1, 0.42, 0.02);
    pack.add(sword);
    const pick = heldItemObject('wood_pickaxe');
    pick.scale.setScalar(0.5);
    pick.rotation.set(0, Math.PI / 2, -0.2);
    pick.position.set(-0.12, 0.38, -0.02);
    pack.add(pick);
    const coins = heldItemObject('gold');
    coins.scale.setScalar(0.45);
    coins.rotation.set(0, Math.PI / 2, 0);
    coins.position.set(0, 0.02, -0.12);
    h.hand.add(coins);
  } else {
    // Bushy beard, goggles and a hammer.
    extra(atlas.box(8, 5, 2, (f, ctx, W, H) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (f === 'front' && y === H - 1 && (x < 2 || x > 13)) continue;
        fill(ctx, x, y, 1, 1, paint.beard, (1 + (rand() - 0.5) * 0.16) * (x % 3 === 0 ? 0.88 : 1));
      }
    }), h.head, 0, 1.5 * P, -5 * P);
    for (const s of [-1, 1]) {
      extra(atlas.box(3, 3, 1, (f, ctx, W, H) => { fill(ctx, 0, 0, W, H, '#2b2a33'); if (f === 'front') { fill(ctx, 1, 1, W - 2, H - 2, '#8ff3ff'); fill(ctx, 1, 1, 2, 1, '#e8ffff'); } }), h.head, s * 2 * P, 5.5 * P, -4.6 * P);
    }
    const hammer = new THREE.Group();
    extra(atlas.box(1, 9, 1, solid('#8a5a32')), hammer, 0, 0, 0);
    extra(atlas.box(4, 2, 2, (f, ctx, W, H) => { speckle(ctx, W, H, '#9aa2b2', rand, 0.1, 0); fill(ctx, 0, 0, W, 1, '#d5dbe6'); }), hammer, 0, 4.5 * P, 0);
    hammer.rotation.x = Math.PI / 2 - 0.3;
    hammer.position.set(0, 0, -0.12);
    h.hand.add(hammer);
    extra(atlas.box(1, 3, 1, solid('#b8c0cc')), h.torso, -3.5 * P, 3.5 * P, -2.5 * P);
  }

  h.armR.rotation.x = 0.35;
  const label = makeLabel(trader
    ? [{ text: 'ITEM SHOP', color: '#8dffb0', size: 30 }, { text: '[E]', color: '#ffe26a', size: 22 }]
    : [{ text: 'TEAM UPGRADES', color: '#a9bcff', size: 30 }, { text: '[E]', color: '#ffe26a', size: 22 }], { scale: 0.7 });
  label.sprite.position.y = 2.45;
  g.add(label.sprite);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  g.userData.head = h.head;
  g.userData.update = (t) => {
    h.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
    h.head.rotation.y = Math.sin(t * 0.5) * 0.45;
    h.head.rotation.x = Math.sin(t * 0.37) * 0.08;
    h.armL.rotation.x = Math.sin(t * 1.1) * 0.06;
    h.armR.rotation.x = 0.35 + Math.sin(t * 1.3) * 0.05;
  };
  return g;
}

// ------------------------------------------------------------- generators

export function createGeneratorModel(kind) {
  const g = new THREE.Group();
  const gold = kind === 'gold';
  const color = gold ? 0xffcf3a : 0x5ff0ff;
  const gem = new THREE.Group();
  if (gold) {
    const bar = lambert(0xffcf3a, 0.35), top = lambert(0xfff0a0, 0.4);
    for (const [x, y] of [[-0.24, 0], [0.24, 0], [0, 0.2]]) {
      gem.add(box(0.44, 0.18, 0.26, bar, x, y, 0));
      gem.add(box(0.36, 0.02, 0.2, top, x, y + 0.1, 0));
    }
    gem.position.y = 1.5;
  } else {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45, flatShading: true }));
    m.scale.set(1, 1.25, 1);
    gem.add(m);
    gem.position.y = 1.5;
  }
  g.add(gem);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 24), lambert(color, 0.6));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  g.add(ring);
  const glow = glowSprite(color, 2.2);
  glow.position.y = 1.5;
  g.add(glow);

  const name = gold ? 'Gold' : 'Diamond';
  const tone = gold ? '#ffd23f' : '#6ff3ff';
  const lines = (tier, seconds) => [
    { text: `Tier ${['I', 'II', 'III'][Math.max(1, Math.min(3, tier)) - 1]}`, color: '#ffe26a', size: 26 },
    { text: name, color: tone, size: 38 },
    { text: `Spawns in ${seconds}s`, color: '#ffffff', size: 24, weight: 600 },
  ];
  const label = makeLabel(lines(1, gold ? 30 : 65), { background: null });
  label.sprite.position.y = 3.1;
  g.add(label.sprite);

  g.userData.label = label;
  g.userData.setInfo = (tier, seconds) => label.set(lines(tier, seconds));
  g.userData.update = (t) => {
    gem.rotation.y = t * 1.3;
    gem.position.y = 1.5 + Math.sin(t * 1.8) * 0.1;
    glow.position.y = gem.position.y;
    ring.rotation.z = t * 0.8;
  };
  return g;
}

export function createForgeGlow() {
  const g = new THREE.Group();
  const glow = glowSprite(0xff9a3c, 3.2);
  glow.position.y = 0.4;
  g.add(glow);
  g.userData.update = (t) => { glow.material.opacity = 0.5 + Math.sin(t * 4) * 0.12; };
  return g;
}

// Big crystal that floats over the waiting lobby, cycling team colors.
export function createLobbyCrystal() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, flatShading: true });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), mat);
  gem.scale.y = 1.6;
  g.add(gem);
  const inner = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat);
    g.add(m);
    inner.push(m);
  }
  const glow = glowSprite(0xffffff, 7);
  g.add(glow);
  const c = new THREE.Color();
  g.userData.update = (t) => {
    gem.rotation.y = t * 0.6;
    gem.position.y = Math.sin(t * 1.2) * 0.25;
    const k = (((t * 0.25) % TEAMS.length) + TEAMS.length) % TEAMS.length;
    const a = new THREE.Color(TEAMS[Math.floor(k)].hex), b = new THREE.Color(TEAMS[(Math.floor(k) + 1) % TEAMS.length].hex);
    c.copy(a).lerp(b, k % 1);
    mat.color.copy(c); mat.emissive.copy(c);
    glow.material.color.copy(c);
    inner.forEach((m, i) => {
      const ang = t * 1.4 + (i * Math.PI * 2) / 3;
      m.position.set(Math.cos(ang) * 2.4, Math.sin(t * 2 + i) * 0.5, Math.sin(ang) * 2.4);
      m.rotation.y = t * 3;
    });
  };
  return g;
}

export { pixelTexture };
