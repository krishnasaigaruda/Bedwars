// Item registry. An inventory slot is { id, count } (count defaults to 1),
// e.g. { id: 'stone_sword' } or { id: 'block:24', count: 16 }.
//
// sprite + mat pick the pixel art in render/sprites.js. Leather armor is
// tinted with the wearer's team color (tint).
//
// Currencies: Silver and Coins come from your base generator, Gold from the
// gold generators and Diamonds from the diamond generators in the middle.
import { BLOCKS } from '../world/blocks.js';

export const ITEMS = {};
const add = (id, o) => { ITEMS[id] = { id, stack: 1, ...o }; };

// Swords: damage is in half-hearts, like Minecraft.
add('wood_sword', { name: 'Wooden Sword', kind: 'sword', tier: 0, damage: 4, sprite: 'sword', mat: 'wood' });
add('stone_sword', { name: 'Stone Sword', kind: 'sword', tier: 1, damage: 5, sprite: 'sword', mat: 'stone' });
add('iron_sword', { name: 'Iron Sword', kind: 'sword', tier: 2, damage: 6, sprite: 'sword', mat: 'iron' });
add('diamond_sword', { name: 'Diamond Sword', kind: 'sword', tier: 3, damage: 7, sprite: 'sword', mat: 'diamond' });

// Tools. speed already includes the Efficiency enchant they come with
// (Minecraft: tool speed + level² + 1).
add('wood_pickaxe', { name: 'Wooden Pickaxe', kind: 'pickaxe', tier: 0, speed: 4, sprite: 'pickaxe', mat: 'wood' });
add('iron_pickaxe', { name: 'Iron Pickaxe', kind: 'pickaxe', tier: 1, speed: 11, sprite: 'pickaxe', mat: 'iron' });
add('gold_pickaxe', { name: 'Golden Pickaxe', kind: 'pickaxe', tier: 2, speed: 22, sprite: 'pickaxe', mat: 'gold' });
add('diamond_pickaxe', { name: 'Diamond Pickaxe', kind: 'pickaxe', tier: 3, speed: 18, sprite: 'pickaxe', mat: 'diamond' });
add('wood_axe', { name: 'Wooden Axe', kind: 'axe', tier: 0, speed: 4, sprite: 'axe', mat: 'wood' });
add('stone_axe', { name: 'Stone Axe', kind: 'axe', tier: 1, speed: 6, sprite: 'axe', mat: 'stone' });
add('iron_axe', { name: 'Iron Axe', kind: 'axe', tier: 2, speed: 11, sprite: 'axe', mat: 'iron' });
add('diamond_axe', { name: 'Diamond Axe', kind: 'axe', tier: 3, speed: 18, sprite: 'axe', mat: 'diamond' });
add('shears', { name: 'Shears', kind: 'shears', tier: 0, speed: 5, sprite: 'shears', mat: 'iron' });

add('kb_stick', { name: 'Knockback Stick', kind: 'sword', tier: -1, damage: 1, knockback: 2, sprite: 'stick', mat: 'wood' });

// Bows: power multiplies arrow damage, punch adds knockback.
add('bow', { name: 'Bow', kind: 'bow', power: 0, punch: 0, sprite: 'bow', mat: 'wood' });
add('bow_power', { name: 'Bow (Power I)', kind: 'bow', power: 1, punch: 0, sprite: 'bow', mat: 'gold' });
add('bow_punch', { name: 'Bow (Power I, Punch I)', kind: 'bow', power: 1, punch: 1, sprite: 'bow', mat: 'diamond' });
add('arrow', { name: 'Arrow', kind: 'ammo', sprite: 'arrow', mat: 'stone', stack: 64 });

// Utility items, used with right click.
add('fireball', { name: 'Fireball', kind: 'throw', sprite: 'fireball', mat: 'fire', stack: 64 });
add('ender_pearl', { name: 'Ender Pearl', kind: 'throw', sprite: 'pearl', mat: 'pearl', stack: 16 });
// Builders: right-click a spot and the structure builds itself there.
add('bridge_egg', { name: 'Instant Bridge', kind: 'deploy', build: 'bridge', sprite: 'egg', mat: 'egg', stack: 16 });
add('popup_tower', { name: 'Pop-up Tower', kind: 'deploy', build: 'tower', sprite: 'tower', mat: 'tower', stack: 64 });
add('speed_potion', { name: 'Speed II Potion (45s)', kind: 'potion', effect: 'speed', level: 2, ticks: 900, sprite: 'potion', mat: 'speedp', stack: 1 });
add('jump_potion', { name: 'Jump V Potion (45s)', kind: 'potion', effect: 'jump', level: 5, ticks: 900, sprite: 'potion', mat: 'jumpp', stack: 1 });
add('invis_potion', { name: 'Invisibility Potion (30s)', kind: 'potion', effect: 'invis', level: 1, ticks: 600, sprite: 'potion', mat: 'invisp', stack: 1 });
add('magic_milk', { name: 'Magic Milk', kind: 'potion', effect: 'milk', level: 1, ticks: 600, sprite: 'milk', mat: 'milk', stack: 1 });

// Currencies.
add('silver', { name: 'Silver', kind: 'resource', sprite: 'bar', mat: 'silver', stack: 64 });
add('coin', { name: 'Coins', kind: 'resource', sprite: 'coin', mat: 'gold', stack: 999 });
add('gold', { name: 'Gold', kind: 'resource', sprite: 'nugget', mat: 'gold', stack: 64 });
add('diamond', { name: 'Diamond', kind: 'resource', sprite: 'gem', mat: 'diamond', stack: 64 });

// Food: food points and saturation, as in Minecraft. eatTicks = 32 (1.6 s).
add('apple', { name: 'Apple', kind: 'food', food: 4, saturation: 2.4, sprite: 'apple', mat: 'apple', stack: 64 });
add('steak', { name: 'Steak', kind: 'food', food: 8, saturation: 12.8, sprite: 'steak', mat: 'steak', stack: 64 });
add('golden_apple', { name: 'Golden Apple', kind: 'food', food: 4, saturation: 9.6, golden: true, sprite: 'apple', mat: 'gold', stack: 64 });

// Armor. Helmet and chestplate are always team leather; leggings and boots
// are the tier you bought. defense = Minecraft armor points.
const ARMOR = [
  ['leather', 'Leather', [1, 3, 2, 1]],
  ['chain', 'Chain', [2, 5, 4, 1]],
  ['iron', 'Iron', [2, 6, 5, 2]],
  ['diamond', 'Diamond', [3, 8, 6, 3]],
];
const PIECES = [['helmet', 'Helmet'], ['chestplate', 'Chestplate'], ['leggings', 'Leggings'], ['boots', 'Boots']];
for (const [mat, matName, points] of ARMOR) {
  PIECES.forEach(([piece, pieceName], i) => {
    add(`${mat}_${piece}`, { name: `${matName} ${pieceName}`, kind: 'armor', slot: i, defense: points[i], sprite: piece, mat });
  });
}

export function getItem(id) {
  if (!id) return null;
  if (id.startsWith('block:')) {
    const block = Number(id.slice(6));
    const b = BLOCKS[block];
    if (!b) return null;
    return { id, name: b.name, kind: 'block', block, stack: 64 };
  }
  return ITEMS[id] ?? null;
}

export const blockItem = (blockId) => `block:${blockId}`;
export const stackSize = (id) => getItem(id)?.stack ?? 1;

// One-line "how do I use this" shown when you pick the item in your hotbar.
const HINTS = {
  fireball: 'Right-click to throw. Explodes on impact and launches players',
  ender_pearl: 'Right-click to throw. You teleport to where it lands',
  bridge_egg: 'Aim at the edge and right-click: a 3-wide bridge with railings builds the way you face',
  popup_tower: 'Aim at the ground and right-click: a 4x4 tower with a ladder builds there',
  magic_milk: 'Right-click to drink. Enemy traps ignore you for 30s',
  kb_stick: 'Hit players to knock them far away',
  silver: 'Spend it at the Item Shop',
  gold: 'Spend it at the Item Shop on better gear',
  diamond: 'Spend it at the Item Shop on the best gear',
  coin: 'Spend coins on Team Upgrades',
};
export function itemHint(id) {
  const item = getItem(id);
  if (!item) return '';
  if (HINTS[item.id]) return HINTS[item.id];
  if (item.kind === 'block') return item.block === 54 ? 'Place it: it lights itself and explodes after 3s' : 'Right-click to place · Shift to sneak at edges';
  return {
    sword: 'Left-click players to attack. Jump + hit for a critical',
    pickaxe: 'Hold left-click to mine Clay, Moonstone and Voidstone',
    axe: 'Hold left-click to chop Timber fast',
    shears: 'Hold left-click to cut Fluff fast',
    bow: 'Hold right-click to draw, let go to shoot',
    food: 'Hold right-click to eat',
    potion: 'Right-click to drink',
    armor: 'Right-click to wear it',
    ammo: 'Arrows for your bow',
  }[item.kind] ?? '';
}
