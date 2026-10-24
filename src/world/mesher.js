// Turns a 16³ chunk into vertex buffers: hidden faces culled, soft
// per-vertex ambient occlusion and per-face shading baked into colors.
import * as THREE from 'three';
import { CHUNK } from '../config.js';
import { BLOCKS, B, LADDER_FACINGS, isLadder } from './blocks.js';
import { getAtlas } from './textures.js';

// Corner order per face: bottom-left, bottom-right, top-right, top-left
// as seen from outside, so triangles (0,1,2) (0,2,3) face outward.
export const FACES = [
  { n: [1, 0, 0], tile: 'side', shade: 0.74, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], tile: 'side', shade: 0.74, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], tile: 'top', shade: 1.0, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], tile: 'bottom', shade: 0.52, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], tile: 'side', shade: 0.87, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], tile: 'side', shade: 0.87, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVELS = [0.6, 0.74, 0.87, 1.0];
// Shading is authored as display brightness; vertex colors are linear.
const lin = (v) => Math.pow(v, 2.2);

class Buf {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  quad(verts, uvs, cols, flip) {
    const b = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(cols[i], cols[i], cols[i]);
    }
    if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  geometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function tileUV(atlas, name) {
  const [u0, v0, u1, v1] = atlas.uv(name);
  return CORNER_UV.map(([a, b]) => [u0 + (u1 - u0) * a, v0 + (v1 - v0) * b]);
}

function occludes(world, x, y, z) {
  const b = BLOCKS[world.get(x, y, z)];
  return b && b.opaque ? 1 : 0;
}

export function meshChunk(world, cx, cy, cz) {
  const atlas = getAtlas();
  const solid = new Buf(), glass = new Buf();
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  const verts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cols = [0, 0, 0, 0];

  for (let y = y0; y < y0 + CHUNK; y++) for (let z = z0; z < z0 + CHUNK; z++) for (let x = x0; x < x0 + CHUNK; x++) {
    const id = world.get(x, y, z);
    if (id === B.AIR) continue;
    const b = BLOCKS[id];
    if (b.render === 'none') continue;
    if (b.render === 'ladder') { ladderQuads(solid, atlas, x, y, z, id); continue; }
    const out = b.render === 'glass' ? glass : solid;

    for (const f of FACES) {
      const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
      const nid = world.get(nx, ny, nz);
      const nb = BLOCKS[nid];
      if (nb.opaque) continue;
      if (b.render === 'glass' && nid === id) continue;

      // The two axes along the face, for corner sampling.
      const axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
      const ta = axis === 0 ? 1 : 0, tb = axis === 2 ? 1 : 2;
      for (let i = 0; i < 4; i++) {
        const v = f.v[i];
        verts[i][0] = x + v[0]; verts[i][1] = y + v[1]; verts[i][2] = z + v[2];
        const da = v[ta] ? 1 : -1, db = v[tb] ? 1 : -1;
        const p1 = [nx, ny, nz], p2 = [nx, ny, nz], p3 = [nx, ny, nz];
        p1[ta] += da; p2[tb] += db; p3[ta] += da; p3[tb] += db;
        const s1 = occludes(world, p1[0], p1[1], p1[2]);
        const s2 = occludes(world, p2[0], p2[1], p2[2]);
        const c = occludes(world, p3[0], p3[1], p3[2]);
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        cols[i] = lin(AO_LEVELS[ao] * f.shade);
      }
      const flip = cols[0] + cols[2] < cols[1] + cols[3];
      let uv = tileUV(atlas, b.tiles[f.tile]);
      // Spin grass tops per block so the flower pattern doesn't tile visibly.
      if (id === B.TURF && f.n[1] === 1) {
        const r = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
        const k = r % 4;
        uv = [uv[k % 4], uv[(k + 1) % 4], uv[(k + 2) % 4], uv[(k + 3) % 4]];
      }
      out.quad(verts, uv, cols, flip);
    }
  }
  return { solid: solid.geometry(), glass: glass.geometry() };
}

function ladderQuads(buf, atlas, x, y, z, id) {
  const [fx, , fz] = LADDER_FACINGS[id - B.LADDER];
  const off = 0.0625;
  const uv = tileUV(atlas, 'ladder');
  let v;
  if (fx === 1) v = [[x + off, y, z + 1], [x + off, y, z], [x + off, y + 1, z], [x + off, y + 1, z + 1]];
  else if (fx === -1) v = [[x + 1 - off, y, z], [x + 1 - off, y, z + 1], [x + 1 - off, y + 1, z + 1], [x + 1 - off, y + 1, z]];
  else if (fz === 1) v = [[x, y, z + off], [x + 1, y, z + off], [x + 1, y + 1, z + off], [x, y + 1, z + off]];
  else v = [[x + 1, y, z + 1 - off], [x, y, z + 1 - off], [x, y + 1, z + 1 - off], [x + 1, y + 1, z + 1 - off]];
  const c = [lin(0.9), lin(0.9), lin(0.9), lin(0.9)];
  buf.quad(v, uv, c, false);
  buf.quad([v[1], v[0], v[3], v[2]], [uv[1], uv[0], uv[3], uv[2]], c, false);
}

// A lone 1x1x1 block centred on the origin, for held items and drops.
export function blockGeometry(id) {
  const atlas = getAtlas();
  const b = BLOCKS[id];
  const buf = new Buf();
  for (const f of FACES) {
    const verts = f.v.map((v) => [v[0] - 0.5, v[1] - 0.5, v[2] - 0.5]);
    const s = lin(f.shade * 0.3 + 0.7);
    buf.quad(verts, tileUV(atlas, b.tiles[f.tile]), [s, s, s, s], false);
  }
  return buf.geometry();
}
