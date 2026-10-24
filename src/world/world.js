// Voxel storage: one flat Uint8Array, split into 16³ chunks for meshing.
import { CHUNK, WORLD } from '../config.js';
import { BLOCKS, B } from './blocks.js';

export class World {
  constructor(sx = WORLD.X, sy = WORLD.Y, sz = WORLD.Z) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
    this.ncx = sx / CHUNK; this.ncy = sy / CHUNK; this.ncz = sz / CHUNK;
    this.placed = new Set();   // indices of blocks placed by players
    this.dirty = new Set();    // chunk keys that need a new mesh
  }

  idx(x, y, z) { return (y * this.sz + z) * this.sx + x; }
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return B.AIR;
    return this.data[(y * this.sz + z) * this.sx + x];
  }

  // Raw write used by the map generator: no dirty tracking.
  put(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.idx(x, y, z)] = id;
  }

  set(x, y, z, id, placed = false) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.idx(x, y, z);
    this.data[i] = id;
    if (placed && id !== B.AIR) this.placed.add(i); else this.placed.delete(i);
    // Neighbouring chunks may change too (face culling and corner shading).
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      this.dirty.add(this.chunkKey(nx >> 4, ny >> 4, nz >> 4));
    }
    return true;
  }

  isPlaced(x, y, z) { return this.inBounds(x, y, z) && this.placed.has(this.idx(x, y, z)); }

  chunkKey(cx, cy, cz) { return cx + this.ncx * (cy + this.ncy * cz); }
  chunkCoords(key) {
    const cx = key % this.ncx;
    const cy = Math.floor(key / this.ncx) % this.ncy;
    const cz = Math.floor(key / (this.ncx * this.ncy));
    return [cx, cy, cz];
  }

  chunkIsEmpty(cx, cy, cz) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    for (let y = y0; y < y0 + CHUNK; y++) for (let z = z0; z < z0 + CHUNK; z++) {
      const row = (y * this.sz + z) * this.sx + x0;
      for (let x = 0; x < CHUNK; x++) if (this.data[row + x]) return false;
    }
    return true;
  }

  // Does this cell block movement for an AABB spanning [y0, y1]?
  solidBox(x, y, z) {
    const b = BLOCKS[this.get(x, y, z)];
    return b && b.solid ? b.height : 0;
  }

  // Amanatides & Woo voxel walk. Returns the first non-air cell hit
  // plus the face normal it was entered through.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = sx ? Math.abs(1 / dx) : Infinity;
    const tdy = sy ? Math.abs(1 / dy) : Infinity;
    const tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      const id = this.get(x, y, z);
      if (id !== B.AIR) {
        const b = BLOCKS[id];
        // Beds are half height: only count the hit if the ray is low enough.
        if (b.height >= 1 || oy + dy * t <= y + b.height + 1e-3 || ny === 1) {
          return { x, y, z, id, nx, ny, nz, dist: t };
        }
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
}
