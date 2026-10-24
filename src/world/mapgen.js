// Deterministic map generator. Every map has floating team bases around one
// big middle island with a huge tiered structure holding the Diamond
// generators. Each Gold generator sits on its own small island in the gap
// between two neighbouring bases. The waiting lobby floats high above.
//
// Base layout uses local coords: lx runs across the base, lz runs toward the
// middle (front). at(lx, lz) turns them into world x/z.
import { CENTER, ISLAND_Y, LOBBY_Y } from '../config.js';
import { B } from './blocks.js';

export const MAPS = [
  { id: 'garden', name: 'Sky Garden' },
  { id: 'frost', name: 'Frost Peak' },
  { id: 'desert', name: 'Sun Temple' },
  { id: 'autumn', name: 'Autumn Keep' },
];

const THEMES = {
  garden: {
    top: B.TURF, soil: B.LOAM, rock: B.SLATE, rock2: B.COBBLE,
    floor: B.POLISHED, floor2: B.BRICKS, path: B.BRICKS,
    wall: B.BRICKS, wall2: B.BRICKS_MOSSY, roof: B.ROOF, post: B.LOG, wood: B.TIMBER,
    accent: B.GOLD_BLOCK, log: B.LOG, leaf: B.LEAF, tree: 'round', crown: 'tower',
  },
  frost: {
    top: B.SNOW, soil: B.LOAM, rock: B.SLATE, rock2: B.ICE,
    floor: B.POLISHED, floor2: B.ICE, path: B.POLISHED,
    wall: B.POLISHED, wall2: B.BRICKS, roof: B.PLANKS_DARK, post: B.LOG_DARK, wood: B.PLANKS_DARK,
    accent: B.DIAMOND_BLOCK, log: B.LOG_DARK, leaf: B.LEAF, tree: 'pine', crown: 'spire',
  },
  desert: {
    top: B.SAND, soil: B.SANDSTONE, rock: B.SANDSTONE, rock2: B.SLATE,
    floor: B.SANDSTONE, floor2: B.POLISHED, path: B.SANDSTONE,
    wall: B.SANDSTONE, wall2: B.POLISHED, roof: B.SANDSTONE, post: B.SANDSTONE, wood: B.TIMBER,
    accent: B.GOLD_BLOCK, log: B.LOG, leaf: B.LEAF, tree: 'palm', crown: 'pavilion',
  },
  autumn: {
    top: B.TURF, soil: B.LOAM, rock: B.SLATE, rock2: B.COBBLE,
    floor: B.PLANKS_DARK, floor2: B.BRICKS_MOSSY, path: B.COBBLE,
    wall: B.BRICKS_MOSSY, wall2: B.BRICKS, roof: B.ROOF, post: B.LOG_DARK, wood: B.PLANKS_DARK,
    accent: B.GOLD_BLOCK, log: B.LOG_DARK, leaf: B.LEAF_AUTUMN, tree: 'round', crown: 'tower',
  },
};

// ---------------------------------------------------------------- noise

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed), b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed), d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function strSeed(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- helpers

function fill(world, x0, y0, z0, x1, y1, z1, id) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const az = Math.min(z0, z1), bz = Math.max(z0, z1);
  for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) world.put(x, y, z, id);
}

// Floating island over a bounding box. dist(x, z) is 0 at the heart and 1 at
// the rim; the edge gets a little noise, the underside tapers like a cone.
function island(world, th, x0, z0, x1, z1, top, dist, depth, seed, rough = 0.24) {
  const W = x1 - x0 + 1, D = z1 - z0 + 1;
  const ts = new Float32Array(W * D).fill(-1);
  let heart = -1, heartD = Infinity;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = dist(x, z);
    const edge = 1 + (valueNoise(x * 0.35, z * 0.35, seed) - 0.5) * rough;
    if (d > edge) continue;
    const i = (z - z0) * W + (x - x0);
    ts[i] = 1 - d / edge;
    if (d < heartD) { heartD = d; heart = i; }
  }
  if (heart < 0) return;
  // Noisy edges can pinch off tiny islets; keep only the main body.
  const keep = new Uint8Array(W * D);
  const stack = [heart];
  keep[heart] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, z = (i - x) / W;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const j = nz * W + nx;
      if (keep[j] || ts[j] < 0) continue;
      keep[j] = 1;
      stack.push(j);
    }
  }
  for (let i = 0; i < W * D; i++) {
    if (!keep[i]) continue;
    const x = x0 + (i % W), z = z0 + Math.floor(i / W);
    const t = ts[i];
    const lip = t < 0.08 && valueNoise(x * 0.9, z * 0.9, seed + 3) > 0.55 ? 1 : 0;
    const surface = top - lip;
    const under = Math.round(2 + depth * Math.pow(t, 0.75) + valueNoise(x * 0.5, z * 0.5, seed + 9) * 3);
    for (let y = Math.max(1, surface - under); y <= surface; y++) {
      let id;
      if (y === surface) id = th.top;
      else if (y >= surface - 2) id = th.soil;
      else id = hash2(x * 7 + y, z, seed) < 0.15 ? th.rock2 : th.rock;
      world.put(x, y, z, id);
    }
  }
}

// Flatten a cell to a solid floor at y, with soil underneath and air above.
function level(world, th, x, z, y, clear) {
  for (let k = y - 3; k < y; k++) if (world.get(x, k, z) === B.AIR) world.put(x, k, z, th.soil);
  world.put(x, y, z, th.top);
  for (let k = y + 1; k <= y + clear; k++) world.put(x, k, z, B.AIR);
}

function setLeaf(world, th, x, y, z) {
  if (world.get(x, y, z) === B.AIR) world.put(x, y, z, th.leaf);
}

function tree(world, th, x, y, z, rand) {
  if (th.tree === 'pine') {
    const h = 6 + Math.floor(rand() * 2);
    for (let i = 0; i < h; i++) world.put(x, y + i, z, th.log);
    const top = y + h;
    const rings = [2, 1, 2, 1, 1, 0];
    rings.forEach((r, i) => {
      const yy = top - 4 + i;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dx === 0 && dz === 0 && yy < top) continue;
        setLeaf(world, th, x + dx, yy, z + dz);
      }
    });
    setLeaf(world, th, x, top + 2, z);
    return;
  }
  if (th.tree === 'palm') {
    const h = 5 + Math.floor(rand() * 2);
    for (let i = 0; i < h; i++) world.put(x, y + i, z, th.log);
    const top = y + h - 1;
    setLeaf(world, th, x, top + 1, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= 3; k++) setLeaf(world, th, x + dx * k, k === 3 ? top - 1 : top, z + dz * k);
    }
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) setLeaf(world, th, x + dx, top, z + dz);
    return;
  }
  const h = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < h; i++) world.put(x, y + i, z, th.log);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy <= -1 ? 2 : 1;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && rand() < 0.7) continue;
      if (dx === 0 && dz === 0 && dy < 0) continue;
      setLeaf(world, th, x + dx, top + dy, z + dz);
    }
  }
}

// A post with a lantern on top.
function lamp(world, th, x, y, z, h = 2) {
  for (let i = 0; i < h; i++) world.put(x, y + i, z, th.post);
  world.put(x, y + h, z, B.LANTERN);
}

// ---------------------------------------------------------------- layout

// All the distances for each team count, in one place. Gaps (edge to edge):
// base -> middle about 33, base -> gold island and gold island -> middle
// about 18-24.
const LAYOUTS = {
  8: { R: 70, S: 20, mid: 27, gold: 43, goldLen: 4.5 },
  4: { R: 62, S: 0, mid: 18, gold: 35, goldLen: 11 },
};

// Base centers on a square ring around the middle.
function basePlacements(teamCount) {
  const { R, S } = LAYOUTS[teamCount];
  if (teamCount === 4) return [[R, 0], [0, R], [-R, 0], [0, -R]];
  return [[R, -S], [R, S], [S, R], [-S, R], [-R, S], [-R, -S], [-S, -R], [S, -R]];
}

export function generateMap(world, teamCount, mapId = MAPS[0].id) {
  const meta = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  const th = THEMES[meta.id];
  const seed = (strSeed(meta.id) + teamCount * 7919) >>> 0;
  const map = {
    id: meta.id, name: meta.name, teamCount,
    bases: [], goldGens: [], diamondGens: [], lobby: null, noBuild: [],
  };
  basePlacements(teamCount).forEach(([ox, oz], team) => buildBase(world, th, map, team, ox, oz, seed));
  buildMiddle(world, th, map, teamCount, seed);
  buildGoldIslands(world, th, map, teamCount, seed);
  map.lobby = buildLobby(world, th, seed);
  return map;
}

// ---------------------------------------------------------------- bases

function buildBase(world, th, map, team, ox, oz, seed) {
  const Y = ISLAND_Y;
  const f = Math.abs(ox) > Math.abs(oz) ? [-Math.sign(ox), 0] : [0, -Math.sign(oz)];
  const r = [-f[1], f[0]];
  const bx = CENTER.x + ox, bz = CENTER.z + oz;
  const at = (lx, lz) => [bx + r[0] * lx + f[0] * lz, bz + r[1] * lx + f[1] * lz];
  const toLocal = (x, z) => [(x - bx) * r[0] + (z - bz) * r[1], (x - bx) * f[0] + (z - bz) * f[1]];
  const put = (lx, y, lz, id) => { const [x, z] = at(lx, lz); world.put(x, y, z, id); };
  const box = (lx0, y0, lz0, lx1, y1, lz1, id) => {
    const [x0, z0] = at(lx0, lz0), [x1, z1] = at(lx1, lz1);
    fill(world, x0, y0, z0, x1, y1, z1, id);
  };
  // Re-skin the floor only where the island actually exists.
  const floor = (lx, lz, id) => {
    const [x, z] = at(lx, lz);
    if (world.get(x, Y, z) !== B.AIR) world.put(x, Y, z, id);
  };
  const noBuild = (lx0, y0, lz0, lx1, y1, lz1) => {
    const [x0, z0] = at(lx0, lz0), [x1, z1] = at(lx1, lz1);
    map.noBuild.push([Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)]);
  };
  const accent = B.CLAY + team, banner = B.FLUFF + team;

  // Island: an oval 20 wide and 26 deep, a bit longer at the back.
  island(world, th, bx - 16, bz - 16, bx + 16, bz + 16, Y,
    (x, z) => { const [lx, lz] = toLocal(x, z); return Math.hypot(lx / 10, (lz + 1) / 13); }, 15, seed + team * 31);
  for (let lz = -14; lz <= 12; lz++) for (let lx = -10; lx <= 10; lx++) {
    if (Math.hypot(lx / 9.4, (lz + 1) / 12.2) > 1) continue;
    const [x, z] = at(lx, lz);
    level(world, th, x, z, Y, 10);
  }

  // Team path from spawn to the front edge, and a pad around the bed.
  for (let lz = -5; lz <= 12; lz++) for (let lx = -1; lx <= 1; lx++) floor(lx, lz, accent);
  for (let lz = 1; lz <= 6; lz++) for (const lx of [-2, 2]) floor(lx, lz, th.floor2);

  // Forge hut at the back: posts, a back wall with a team stripe, a hipped roof.
  for (let lz = -12; lz <= -5; lz++) for (let lx = -4; lx <= 4; lx++) floor(lx, lz, th.floor);
  for (let lz = -10; lz <= -6; lz++) for (let lx = -2; lx <= 2; lx++) floor(lx, lz, accent);
  for (let lz = -9; lz <= -7; lz++) for (let lx = -1; lx <= 1; lx++) put(lx, Y, lz, B.FORGE);
  for (const lx of [-3, 3]) for (const lz of [-11, -6]) box(lx, Y + 1, lz, lx, Y + 4, lz, th.post);
  box(-2, Y + 1, -11, 2, Y + 4, -11, th.wall);
  box(-2, Y + 3, -11, 2, Y + 3, -11, banner);
  box(-4, Y + 5, -12, 4, Y + 5, -5, th.roof);
  box(-3, Y + 6, -11, 3, Y + 6, -6, th.roof);
  box(-2, Y + 7, -10, 2, Y + 7, -7, th.roof);
  put(0, Y + 8, -8, B.LANTERN);
  for (const lx of [-3, 3]) put(lx, Y + 5, -5, B.LANTERN);
  put(-2, Y + 1, -10, B.CHEST);
  put(2, Y + 1, -10, B.ENDER_CHEST);

  // Shop (left) and upgrades (right) stalls with striped awnings.
  for (const side of [-1, 1]) {
    for (let lz = -6; lz <= 0; lz++) for (let lx = 3; lx <= 8; lx++) floor(lx * side, lz, th.wood);
    for (const lx of [4, 7]) for (const lz of [-5, -1]) box(lx * side, Y + 1, lz, lx * side, Y + 3, lz, th.post);
    box(7 * side, Y + 1, -4, 7 * side, Y + 3, -2, th.wood);
    box(7 * side, Y + 2, -3, 7 * side, Y + 2, -3, B.LANTERN);
    for (let lz = -6; lz <= 0; lz++) box(3 * side, Y + 4, lz, 8 * side, Y + 4, lz, lz % 2 ? accent : B.FLUFF + 5);
    put(6 * side, Y + 1, -5, B.CRATE);
    put(6 * side, Y + 1, -1, B.CRATE);
    put(6 * side, Y + 2, -1, B.CRATE);
  }

  // Bed in the middle of the path, head toward the back.
  const [hx, hz] = at(0, 3), [fx2, fz2] = at(0, 4);
  world.put(hx, Y + 1, hz, B.BED);
  world.put(fx2, Y + 1, fz2, B.BED);
  for (const lx of [-3, 3]) lamp(world, th, ...shiftY(at(lx, 2), Y + 1));

  // Gate posts at the front edge, trees and bushes on the sides.
  for (const lx of [-3, 3]) { const [x, z] = at(lx, 9); if (world.get(x, Y, z) !== B.AIR) lamp(world, th, x, Y + 1, z, 2); }
  const rand = mulberry32(seed + team * 97);
  for (const [lx, lz] of [[-7, 6], [7, 6]]) {
    const [x, z] = at(lx, lz);
    if (world.get(x, Y, z) !== B.AIR) tree(world, th, x, Y + 1, z, rand);
  }
  for (const [lx, lz] of [[-8, 2], [8, 2], [-6, -9], [6, -9]]) {
    const [x, z] = at(lx, lz);
    if (world.get(x, Y, z) !== B.AIR && world.get(x, Y + 1, z) === B.AIR) world.put(x, Y + 1, z, th.leaf);
  }

  const [sx, sz] = at(0, -5);
  const [gx, gz] = at(0, -8);
  const [tx, tz] = at(-5, -3);
  const [ux, uz] = at(5, -3);
  const [cx, cz] = at(-2, -10);
  const [ex, ez] = at(2, -10);
  noBuild(-1, Y + 1, -9, 1, Y + 3, -7);
  noBuild(-6, Y + 1, -4, -4, Y + 2, -2);
  noBuild(4, Y + 1, -4, 6, Y + 2, -2);
  map.noBuild.push([sx, Y + 1, sz, sx, Y + 2, sz]);

  map.bases.push({
    team,
    facing: f,
    right: r,
    center: [bx, bz],
    spawn: { x: sx + 0.5, y: Y + 1, z: sz + 0.5, yaw: Math.atan2(-f[0], -f[1]) },
    bed: { head: [hx, Y + 1, hz], foot: [fx2, Y + 1, fz2], dir: f },
    forge: { x: gx + 0.5, y: Y + 1, z: gz + 0.5 },
    shop: { x: tx + 0.5, y: Y + 1, z: tz + 0.5, yaw: Math.atan2(-r[0], -r[1]) },
    upgrades: { x: ux + 0.5, y: Y + 1, z: uz + 0.5, yaw: Math.atan2(r[0], r[1]) },
    chest: [cx, Y + 1, cz],
    enderChest: [ex, Y + 1, ez],
  });
}

const shiftY = ([x, z], y) => [x, y, z];

// ---------------------------------------------------------------- middle

function buildMiddle(world, th, map, teamCount, seed) {
  const Y = ISLAND_Y;
  const mx = CENTER.x, mz = CENTER.z;
  const big = teamCount === 8;
  const H = LAYOUTS[teamCount].mid; // island half size
  const H1 = big ? 11 : 10;     // first tier half size, top at Y+4
  const H2 = big ? 6 : 5;       // second tier half size, top at Y+8
  const G = big ? 19 : 12;      // corner planter offset from the middle
  const put = (dx, y, dz, id) => world.put(mx + dx, y, mz + dz, id);
  const box = (dx0, y0, dz0, dx1, y1, dz1, id) => fill(world, mx + dx0, y0, mz + dz0, mx + dx1, y1, mz + dz1, id);
  const cheb = (dx, dz) => Math.max(Math.abs(dx), Math.abs(dz));
  const shape = (x, z) => Math.pow(Math.pow(Math.abs(x - mx) / H, 6) + Math.pow(Math.abs(z - mz) / H, 6), 1 / 6);
  const rand = mulberry32(seed + 5);

  island(world, th, mx - H - 3, mz - H - 3, mx + H + 3, mz + H + 3, Y, shape, 22, seed + 5, 0.12);
  for (let dz = -H; dz <= H; dz++) for (let dx = -H; dx <= H; dx++) {
    if (shape(mx + dx, mz + dz) > 0.97) continue;
    level(world, th, mx + dx, mz + dz, Y, 36);
  }

  // Paved plaza with a checker ring, and paths out to every edge.
  for (let dz = -H; dz <= H; dz++) for (let dx = -H; dx <= H; dx++) {
    const c = cheb(dx, dz);
    if (shape(mx + dx, mz + dz) > 0.9) continue;
    if (c <= H1 + 5) put(dx, Y, dz, c === H1 + 5 || ((dx + dz) & 1 && c > H1 + 2) ? th.floor2 : th.floor);
    if (Math.min(Math.abs(dx), Math.abs(dz)) <= 1) put(dx, Y, dz, th.path);
  }

  // Tier 1: a big solid platform with lantern windows.
  box(-H1, Y + 1, -H1, H1, Y + 4, H1, th.wall);
  box(-H1 + 1, Y + 4, -H1 + 1, H1 - 1, Y + 4, H1 - 1, th.floor);
  for (let i = -H1; i <= H1; i++) {
    if (Math.abs(i) === 6) for (const [dx, dz] of [[i, -H1], [i, H1], [-H1, i], [H1, i]]) put(dx, Y + 2, dz, B.LANTERN);
    if ((i & 1) === 0) for (const [dx, dz] of [[i, -H1], [i, H1], [-H1, i], [H1, i]]) put(dx, Y + 3, dz, th.wall2);
  }
  // Tier 2 on top of it.
  box(-H2, Y + 5, -H2, H2, Y + 8, H2, th.wall);
  box(-H2 + 1, Y + 8, -H2 + 1, H2 - 1, Y + 8, H2 - 1, th.floor);
  for (const s of [-1, 1]) {
    put(s * 3, Y + 6, -H2, B.LANTERN); put(s * 3, Y + 6, H2, B.LANTERN);
    put(-H2, Y + 6, s * 3, B.LANTERN); put(H2, Y + 6, s * 3, B.LANTERN);
  }

  // Grand staircases on all four sides, 1-block steps, 3 wide.
  const axes = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [ax, az] of axes) {
    for (let k = 1; k <= 3; k++) for (let p = -1; p <= 1; p++) {
      const dx1 = ax * (H1 + k) + az * p, dz1 = az * (H1 + k) + ax * p;
      box(dx1, Y + 1, dz1, dx1, Y + 4 - k, dz1, th.wall);
      put(dx1, Y + 4 - k, dz1, th.path);
      const dx2 = ax * (H2 + k) + az * p, dz2 = az * (H2 + k) + ax * p;
      box(dx2, Y + 5, dz2, dx2, Y + 8 - k, dz2, th.wall);
      put(dx2, Y + 8 - k, dz2, th.path);
    }
    // Lamps flanking the bottom of each staircase.
    for (const p of [-2, 2]) lamp(world, th, mx + ax * (H1 + 3) + az * p, Y + 1, mz + az * (H1 + 3) + ax * p, 2);
  }

  // Battlements on both tier rims, leaving the stair openings free.
  for (const [half, y] of [[H1, Y + 5], [H2, Y + 9]]) {
    for (let i = -half; i <= half; i++) {
      if (Math.abs(i) <= 2 || (i & 1)) continue;
      for (const [dx, dz] of [[i, -half], [i, half], [-half, i], [half, i]]) put(dx, y, dz, th.wall2);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(sx * H1, Y + 5, sz * H1, sx * H1, Y + 7, sz * H1, th.post);
    put(sx * H1, Y + 8, sz * H1, B.LANTERN);
  }

  buildCrown(world, th, mx, mz, Y + 8, big);

  // Diamond generators: on the first tier's corners (8 teams) or up on the
  // second tier beside the crown (4 teams).
  const diamondSpots = big
    ? [[-8, -8, Y + 4], [8, -8, Y + 4], [-8, 8, Y + 4], [8, 8, Y + 4]]
    : [[-4, -4, Y + 8], [4, 4, Y + 8]];
  for (const [dx, dz, py] of diamondSpots) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) put(dx + a, py, dz + b, B.DIAMOND_BLOCK);
    put(dx, py, dz, B.DIAMOND_GEN);
    box(dx - 1, py + 1, dz - 1, dx + 1, py + 3, dz + 1, B.AIR);
    map.diamondGens.push({ x: mx + dx + 0.5, y: py + 1, z: mz + dz + 0.5 });
    map.noBuild.push([mx + dx - 1, py + 1, mz + dz - 1, mx + dx + 1, py + 3, mz + dz + 1]);
  }

  // Lamp-lit planters on the island corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const gx = sx * G, gz = sz * G;
    box(gx - 1, Y, gz - 1, gx + 1, Y, gz + 1, th.floor2);
    put(gx, Y, gz, th.top);
    tree(world, th, mx + gx, Y + 1, mz + gz, rand);
    for (const [a, b] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) lamp(world, th, mx + gx + a, Y + 1, mz + gz + b, 1);
  }

  // Trees in planters around the plaza.
  const tSpots = big
    ? [[15, 7], [-15, 7], [15, -7], [-15, -7], [7, 15], [-7, 15], [7, -15], [-7, -15]]
    : [[13, 6], [-13, 6], [13, -6], [-13, -6], [6, 13], [-6, 13], [6, -13], [-6, -13]];
  for (const [dx, dz] of tSpots) {
    put(dx, Y, dz, th.top);
    tree(world, th, mx + dx, Y + 1, mz + dz, rand);
  }
  // Scattered bushes on the outer grass.
  for (let i = 0; i < (big ? 36 : 24); i++) {
    const dx = Math.round((rand() * 2 - 1) * (H - 2)), dz = Math.round((rand() * 2 - 1) * (H - 2));
    if (cheb(dx, dz) <= H1 + 6 || Math.min(Math.abs(dx), Math.abs(dz)) <= 2) continue;
    if (Math.abs(Math.abs(dx) - G) <= 4 && Math.abs(Math.abs(dz) - G) <= 4) continue;
    if (world.get(mx + dx, Y, mz + dz) === th.top && world.get(mx + dx, Y + 1, mz + dz) === B.AIR) put(dx, Y + 1, dz, th.leaf);
  }
}

// The centerpiece on top of tier 2 (floor at y).
function buildCrown(world, th, mx, mz, y, big) {
  const put = (dx, yy, dz, id) => world.put(mx + dx, yy, mz + dz, id);
  const box = (dx0, y0, dz0, dx1, y1, dz1, id) => fill(world, mx + dx0, y0, mz + dz0, mx + dx1, y1, mz + dz1, id);
  const roofSteps = (base, halves, id) => halves.forEach((h, i) => box(-h, base + i, -h, h, base + i, h, id));

  if (th.crown === 'pavilion') {
    for (const a of [-2, 2]) for (const b of [-2, 2]) box(a, y + 1, b, a, y + 4, b, th.post);
    box(-1, y, -1, 1, y, 1, B.GOLD_BLOCK);
    roofSteps(y + 5, [3, 2, 1], th.roof);
    box(-3, y + 5, -3, 3, y + 5, 3, th.roof);
    for (const a of [-3, 3]) for (const b of [-3, 3]) put(a, y + 5, b, B.GOLD_BLOCK);
    put(0, y + 8, 0, B.GOLD_BLOCK);
    put(0, y + 9, 0, B.LANTERN);
    return;
  }

  const tall = th.crown === 'spire' ? (big ? 16 : 14) : (big ? 12 : 10);
  const top = y + tall;
  box(-2, y + 1, -2, 2, top, 2, th.wall);
  box(-1, y + 1, -1, 1, top - 1, 1, B.AIR);
  // Doorways on every side and windows further up.
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    box(ax * 2, y + 1, az * 2, ax * 2, y + 2, az * 2, B.AIR);
    for (let k = y + 5; k < top - 1; k += 4) {
      put(ax * 2, k, az * 2, th.crown === 'spire' ? B.ICE : B.LOBBY_GLASS);
      put(ax * 2, k + 1, az * 2, th.crown === 'spire' ? B.ICE : B.LOBBY_GLASS);
    }
    put(ax * 2 + az, y + 3, az * 2 + ax, B.LANTERN);
  }
  for (const a of [-2, 2]) for (const b of [-2, 2]) box(a, y + 1, b, a, top, b, th.post);
  // Team banners hanging off the tower, one color per side.
  [[0, -3], [3, 0], [0, 3], [-3, 0]].forEach(([dx, dz], i) => {
    for (let k = top - 4; k <= top - 2; k++) put(dx, k, dz, B.FLUFF + i * 2);
  });
  if (th.crown === 'spire') {
    roofSteps(top + 1, [3, 2, 2, 1, 1, 0, 0], th.roof);
    put(0, top + 8, 0, th.accent);
    put(0, top + 9, 0, B.LANTERN);
  } else {
    roofSteps(top + 1, [3, 2, 1, 0], th.roof);
    put(0, top + 5, 0, th.accent);
    put(0, top + 6, 0, B.LANTERN);
  }
}

// ---------------------------------------------------------------- gold islands

// One small island on each diagonal, between the two bases around that
// corner. They are stretched sideways (along the gap) so both bases can
// bridge to them without the island crowding the middle.
function buildGoldIslands(world, th, map, teamCount, seed) {
  const Y = ISLAND_Y;
  const g = LAYOUTS[teamCount].gold;    // offset of the island center on both axes
  const a = LAYOUTS[teamCount].goldLen; // half length along the gap
  const b = 4.5;                    // half width toward the middle
  const k = Math.SQRT1_2;
  let i = 0;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const cx = CENTER.x + sx * g, cz = CENTER.z + sz * g;
    const t = [-sz * k, sx * k];    // along the gap
    const n = [sx * k, sz * k];     // away from the middle
    const shape = (x, z) => {
      const dx = x - cx, dz = z - cz;
      return Math.hypot((dx * t[0] + dz * t[1]) / a, (dx * n[0] + dz * n[1]) / b);
    };
    const R = Math.ceil(a) + 3;
    island(world, th, cx - R, cz - R, cx + R, cz + R, Y, shape, 10, seed + 600 + i * 13, 0.18);
    for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) {
      if (shape(x, z) <= 0.9) level(world, th, x, z, Y, 8);
    }
    const fill2 = (x0, y0, z0, x1, y1, z1, id) => fill(world, cx + x0, y0, cz + z0, cx + x1, y1, cz + z1, id);
    // Shelter over the generator, same style as the base huts.
    fill2(-2, Y, -2, 2, Y, 2, th.floor2);
    fill2(-1, Y, -1, 1, Y, 1, B.GOLD_BLOCK);
    world.put(cx, Y, cz, B.GOLD_GEN);
    for (const p of [-2, 2]) for (const q of [-2, 2]) fill2(p, Y + 1, q, p, Y + 3, q, th.post);
    fill2(-2, Y + 4, -2, 2, Y + 4, 2, th.roof);
    fill2(-1, Y + 5, -1, 1, Y + 5, 1, th.roof);
    world.put(cx, Y + 6, cz, th.accent);
    for (const p of [-2, 2]) for (const q of [-2, 2]) world.put(cx + p, Y + 4, cz + q, B.LANTERN);
    // A tree on one tip, a lamp and a bush on the other.
    // Only decorate cells outside the 5x5 shelter so the generator stays open.
    const tip = (d) => [Math.round(cx + t[0] * d), Math.round(cz + t[1] * d)];
    const clear = ([x, z]) => Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 3 && world.get(x, Y, z) !== B.AIR;
    const rand = mulberry32(seed + 900 + i);
    const tTip = tip(a - 2.5), lTip = tip(-(a - 2.5)), bTip = tip(-(a - 4));
    if (clear(tTip)) tree(world, th, tTip[0], Y + 1, tTip[1], rand);
    if (clear(lTip)) lamp(world, th, lTip[0], Y + 1, lTip[1], 2);
    if (clear(bTip) && world.get(bTip[0], Y + 1, bTip[1]) === B.AIR) world.put(bTip[0], Y + 1, bTip[1], th.leaf);

    map.goldGens.push({ x: cx + 0.5, y: Y + 1, z: cz + 0.5 });
    map.noBuild.push([cx - 1, Y + 1, cz - 1, cx + 1, Y + 3, cz + 1]);
    i++;
  }
}

// ---------------------------------------------------------------- lobby

// Waiting lobby: its own floating island with a plaza, a glass fountain,
// team arches, trees and a little parkour spiral.
function buildLobby(world, th, seed) {
  const LY = LOBBY_Y;
  const mx = CENTER.x, mz = CENTER.z;
  const rand = mulberry32(seed + 404);
  const lth = { ...THEMES.garden, leaf: th.leaf, log: th.log, tree: th.tree === 'palm' ? 'round' : th.tree };
  island(world, lth, mx - 20, mz - 20, mx + 20, mz + 20, LY, (x, z) => Math.hypot(x - mx, z - mz) / 17, 7, seed + 77);
  for (let dz = -18; dz <= 18; dz++) for (let dx = -18; dx <= 18; dx++) {
    const d = Math.hypot(dx, dz);
    const x = mx + dx, z = mz + dz;
    if (d <= 16) {
      if (world.get(x, LY, z) === B.AIR) world.put(x, LY, z, B.TURF);
      for (let y = LY - 3; y < LY; y++) if (world.get(x, y, z) === B.AIR) world.put(x, y, z, B.LOAM);
    }
    if (d > 10.6) continue;
    let id = B.BRICKS;
    if (d > 8.4) {
      const sector = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * 8) % 8;
      id = B.FLUFF + sector;
    } else if (d > 6 && d <= 7.2) id = B.TIMBER;
    else if (d <= 2.2) id = B.PRISM;
    world.put(x, LY, z, id);
    if (d > 2.2 && d <= 3.3) world.put(x, LY + 1, z, B.BRICKS);
  }
  // Arches on the four paths out of the plaza.
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([fx, fz], i) => {
    const rx = -fz, rz = fx;
    const team = i * 2;
    for (let k = -2; k <= 2; k++) {
      const bx = mx + fx * 12 + rx * k, bz = mz + fz * 12 + rz * k;
      if (Math.abs(k) === 2) for (let y = 1; y <= 4; y++) world.put(bx, LY + y, bz, B.CLAY + team);
      world.put(bx, LY + 5, bz, Math.abs(k) === 2 ? B.LANTERN : B.FLUFF + team);
      world.put(bx, LY, bz, B.TIMBER);
    }
    for (let s = 11; s <= 15; s++) world.put(mx + fx * s, LY, mz + fz * s, B.TIMBER);
  });
  // Garden ring.
  for (const ang of [0.785, 2.356, 3.927, 5.498]) {
    const x = Math.round(mx + Math.cos(ang) * 13.5), z = Math.round(mz + Math.sin(ang) * 13.5);
    tree(world, lth, x, LY + 1, z, rand);
  }
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2, r = 11.5 + rand() * 4;
    const x = Math.round(mx + Math.cos(ang) * r), z = Math.round(mz + Math.sin(ang) * r);
    if (world.get(x, LY, z) === B.TURF && world.get(x, LY + 1, z) === B.AIR) world.put(x, LY + 1, z, lth.leaf);
  }
  // Parkour: floating fluff steps spiralling up around the plaza.
  for (let i = 0; i < 14; i++) {
    const ang = 0.3 + i * 0.34, r = 9;
    const x = Math.round(mx + Math.cos(ang) * r), z = Math.round(mz + Math.sin(ang) * r);
    world.put(x, LY + 2 + Math.floor(i * 0.75), z, B.FLUFF + (i % 8));
  }
  return { x: mx + 0.5, y: LY + 1, z: mz + 6.5, yaw: 0, crystal: { x: mx + 0.5, y: LY + 7, z: mz + 0.5 } };
}

