// Shared constants for every part of the game.

export const VERSION = 'bwfun1';
// Shown on the main menu, so you can tell an old cached copy from the newest one.
export const BUILD = 'Oct 24 · 16';

export const CHUNK = 16;
export const WORLD = { X: 256, Y: 128, Z: 256 };
export const CENTER = { x: 128, z: 128 };

export const ISLAND_Y = 48;               // top surface of every island
export const BUILD_LIMIT = ISLAND_Y + 26; // highest y a player may place at
export const LOBBY_Y = 100;               // waiting lobby floor
export const VOID_Y = -24;                // below this you die

export const TEAMS = [
  { name: 'Red',    letter: 'R', hex: 0xff4b4b, css: '#ff4b4b' },
  { name: 'Blue',   letter: 'B', hex: 0x3f7bff, css: '#3f7bff' },
  { name: 'Green',  letter: 'G', hex: 0x4fd65a, css: '#4fd65a' },
  { name: 'Yellow', letter: 'Y', hex: 0xffd23f, css: '#ffd23f' },
  { name: 'Aqua',   letter: 'A', hex: 0x3fe0e0, css: '#3fe0e0' },
  { name: 'White',  letter: 'W', hex: 0xf2f2f2, css: '#f2f2f2' },
  { name: 'Pink',   letter: 'P', hex: 0xff7ad9, css: '#ff7ad9' },
  { name: 'Gray',   letter: 'S', hex: 0x8a8f9c, css: '#8a8f9c' },
];

export const MODES = {
  solo:    { id: 'solo',    label: 'Solo',    teams: 8, size: 1 },
  doubles: { id: 'doubles', label: 'Doubles', teams: 8, size: 2 },
  trios:   { id: 'trios',   label: 'Trios',   teams: 4, size: 3 },
  squads:  { id: 'squads',  label: 'Squads',  teams: 4, size: 4 },
};

// Movement, in blocks and seconds. Tuned to feel like 1.8 Minecraft.
export const PHYS = {
  width: 0.6,
  height: 1.8,
  sneakHeight: 1.65,
  eye: 1.62,
  sneakEye: 1.5,
  gravity: 32,
  terminal: 60,
  jump: 8.9,
  walk: 4.32,
  sprint: 5.6,
  sneak: 1.4,
  fly: 10.9,
  flySprint: 21.6,
  flyVertical: 8,
  groundAccel: 18,
  airAccel: 3.2,
  ladderUp: 2.4,
  ladderDown: 3,
  reachBlock: 4.6,
  reachHit: 3,
};
