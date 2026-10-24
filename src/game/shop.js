// Shop catalogs. Silver (base generator) buys the basics, Gold (middle gold
// generators) buys iron gear and better tools, Diamonds (middle diamond
// generators) buy the best gear. Coins (base generator) only buy team upgrades.
import { B } from '../world/blocks.js';
import { blockItem, getItem } from './items.js';

export const CURRENCIES = {
  silver: { name: 'Silver', color: '#dfe6f0' },
  coin: { name: 'Coins', color: '#ffd23f' },
  gold: { name: 'Gold', color: '#ffb02e' },
  diamond: { name: 'Diamonds', color: '#5ff0ff' },
};

export const PICKAXES = ['wood_pickaxe', 'iron_pickaxe', 'gold_pickaxe', 'diamond_pickaxe'];
export const AXES = ['wood_axe', 'stone_axe', 'iron_axe', 'diamond_axe'];
const PICK_COST = [{ silver: 10 }, { silver: 10 }, { gold: 2 }, { gold: 4 }];
const AXE_COST = [{ silver: 10 }, { silver: 10 }, { gold: 2 }, { gold: 4 }];
export const ARMOR_TIERS = ['leather', 'chain', 'iron', 'diamond'];

// give: { block, count } | { item, count } | { armor: tier } | { tool: 'pickaxe' | 'axe' } | { shears: true }
const OFFERS = {
  fluff: { give: { block: 'fluff', count: 16 }, cost: { silver: 4 }, desc: 'Cheap, fast to place and break. Great for bridging.' },
  clay: { give: { block: 'clay', count: 16 }, cost: { silver: 12 }, desc: 'Sturdier blocks. Needs a pickaxe to break quickly.' },
  prism: { give: { block: B.PRISM, count: 4 }, cost: { gold: 2 }, desc: 'Blast-proof glass. Explosions can’t break it.' },
  moon: { give: { block: B.MOON, count: 8 }, cost: { gold: 3 }, desc: 'Strong stone that stops fireballs.' },
  ladder: { give: { block: B.LADDER, count: 8 }, cost: { silver: 4 }, desc: 'Climb walls. Place it on the side of a block.' },
  timber: { give: { block: B.TIMBER, count: 16 }, cost: { gold: 3 }, desc: 'Good bed defence. Breaks fast with an axe.' },
  voidstone: { give: { block: B.VOID, count: 4 }, cost: { diamond: 4 }, desc: 'Nearly unbreakable. Needs a diamond pickaxe.' },

  stone_sword: { give: { item: 'stone_sword' }, cost: { silver: 10 }, desc: 'Replaces your wooden sword.' },
  iron_sword: { give: { item: 'iron_sword' }, cost: { gold: 3 }, desc: 'Replaces your current sword.' },
  diamond_sword: { give: { item: 'diamond_sword' }, cost: { diamond: 4 }, desc: 'The strongest sword.' },
  kb_stick: { give: { item: 'kb_stick' }, cost: { gold: 3 }, desc: 'Knockback II. Send them flying off the edge!' },

  arrows: { give: { item: 'arrow', count: 8 }, cost: { silver: 4 }, desc: 'Ammo for your bow.' },
  bow: { give: { item: 'bow' }, cost: { gold: 4 }, desc: 'Hold right click to draw, let go to shoot.' },
  bow_power: { give: { item: 'bow_power' }, cost: { gold: 8 }, desc: 'Power I: arrows hit 50% harder.' },
  bow_punch: { give: { item: 'bow_punch' }, cost: { diamond: 3 }, desc: 'Power I and Punch I: hard hits that knock back.' },

  fireball: { give: { item: 'fireball' }, cost: { silver: 40 }, desc: 'Explodes on impact: breaks blocks and launches players.' },
  tnt: { give: { block: B.TNT, count: 1 }, cost: { gold: 4 }, desc: 'Lights itself when placed. Blows up most blocks.' },
  ender_pearl: { give: { item: 'ender_pearl' }, cost: { diamond: 4 }, desc: 'Teleports you where it lands.' },
  bridge_egg: { give: { item: 'bridge_egg' }, cost: { diamond: 2 }, desc: 'Place it at an edge: a 24-block Fluff bridge with railings builds itself.' },
  popup_tower: { give: { item: 'popup_tower' }, cost: { silver: 24 }, desc: 'Place it on the ground: a 4x4 Fluff tower with a ladder builds itself.' },
  magic_milk: { give: { item: 'magic_milk' }, cost: { gold: 3 }, desc: 'Enemy traps ignore you for 30 seconds.' },

  speed_potion: { give: { item: 'speed_potion' }, cost: { diamond: 1 }, desc: 'Speed II for 45 seconds.' },
  jump_potion: { give: { item: 'jump_potion' }, cost: { diamond: 1 }, desc: 'Jump Boost V for 45 seconds.' },
  invis_potion: { give: { item: 'invis_potion' }, cost: { diamond: 2 }, desc: 'Invisible for 30 seconds (armor too).' },

  chain_armor: { give: { armor: 'chain' }, cost: { silver: 48 }, desc: 'Permanent full chain armor.' },
  iron_armor: { give: { armor: 'iron' }, cost: { gold: 18 }, desc: 'Permanent full iron armor.' },
  diamond_armor: { give: { armor: 'diamond' }, cost: { diamond: 18 }, desc: 'Permanent full diamond armor.' },

  pickaxe: { give: { tool: 'pickaxe' }, desc: 'Upgrades one tier each purchase. Drops a tier when you die.' },
  axe: { give: { tool: 'axe' }, desc: 'Upgrades one tier each purchase. Drops a tier when you die.' },
  shears: { give: { shears: true }, cost: { silver: 20 }, desc: 'Permanent. Cuts Fluff very fast.' },

  steak: { give: { item: 'steak', count: 2 }, cost: { silver: 4 }, desc: 'Fills 4 hunger shanks.' },
  apple: { give: { item: 'apple', count: 3 }, cost: { silver: 3 }, desc: 'A quick snack.' },
  golden_apple: { give: { item: 'golden_apple' }, cost: { gold: 2 }, desc: 'Heals you and gives 2 extra hearts.' },
};

export const CATEGORIES = [
  { id: 'quick', name: 'Quick Buy', icon: 'block:24', offers: ['fluff', 'stone_sword', 'chain_armor', 'pickaxe', 'timber', 'iron_sword', 'iron_armor', 'shears', 'moon', 'golden_apple', 'fireball', 'tnt', 'bow', 'arrows', 'steak', 'popup_tower', 'ender_pearl', 'axe'] },
  { id: 'blocks', name: 'Blocks', icon: 'block:24', offers: ['fluff', 'clay', 'prism', 'moon', 'ladder', 'timber', 'voidstone'] },
  { id: 'melee', name: 'Melee', icon: 'stone_sword', offers: ['stone_sword', 'iron_sword', 'diamond_sword', 'kb_stick'] },
  { id: 'armor', name: 'Armor', icon: 'iron_boots', offers: ['chain_armor', 'iron_armor', 'diamond_armor'] },
  { id: 'tools', name: 'Tools', icon: 'iron_pickaxe', offers: ['pickaxe', 'axe', 'shears'] },
  { id: 'ranged', name: 'Ranged', icon: 'bow', offers: ['arrows', 'bow', 'bow_power', 'bow_punch'] },
  { id: 'utility', name: 'Utility', icon: 'fireball', offers: ['fireball', 'tnt', 'ender_pearl', 'bridge_egg', 'popup_tower', 'golden_apple', 'magic_milk'] },
  { id: 'potions', name: 'Potions', icon: 'speed_potion', offers: ['speed_potion', 'jump_potion', 'invis_potion'] },
  { id: 'food', name: 'Food', icon: 'steak', offers: ['steak', 'apple', 'golden_apple'] },
];

// What an offer means for this player right now: the item shown, its price,
// and whether it can be bought.
export function resolveOffer(key, p) {
  const o = OFFERS[key];
  const g = o.give;
  const out = { key, desc: o.desc, cost: o.cost, count: g.count ?? 1, status: 'ok' };
  if (g.block !== undefined) {
    const id = g.block === 'fluff' ? B.FLUFF + p.team : g.block === 'clay' ? B.CLAY + p.team : g.block;
    out.icon = blockItem(id);
  } else if (g.item) out.icon = g.item;
  else if (g.armor) {
    out.icon = `${g.armor}_boots`;
    if (ARMOR_TIERS.indexOf(g.armor) <= p.armorTier) out.status = 'owned';
  } else if (g.tool) {
    const list = g.tool === 'pickaxe' ? PICKAXES : AXES;
    const costs = g.tool === 'pickaxe' ? PICK_COST : AXE_COST;
    const cur = g.tool === 'pickaxe' ? p.pickTier : p.axeTier;
    const next = Math.min(cur + 1, list.length - 1);
    out.icon = list[next];
    out.cost = costs[next];
    if (cur >= list.length - 1) out.status = 'maxed';
  } else if (g.shears) {
    out.icon = 'shears';
    if (p.shears) out.status = 'owned';
  }
  out.name = getItem(out.icon)?.name ?? key;
  if (g.armor) out.name = getItem(out.icon).name.replace(' Boots', ' Armor');
  if (g.block === 'fluff') out.name = 'Fluff';
  if (g.block === 'clay') out.name = 'Clay Tile';
  return out;
}

export const offerGive = (key) => OFFERS[key].give;

// ---------------------------------------------------------- team upgrades
// Bought with Coins, shared by the whole team. cost[i] is the price of tier i+1.

export const UPGRADES = [
  { id: 'sharp', name: 'Sharpened Swords', icon: 'iron_sword', cost: [160], desc: 'Your team’s swords deal +1 damage.' },
  { id: 'prot', name: 'Reinforced Armor', icon: 'iron_chestplate', cost: [80, 160, 320, 640], desc: 'Protection on your team’s armor: 4% less damage per tier.' },
  { id: 'haste', name: 'Maniac Miner', icon: 'gold_pickaxe', cost: [80, 160], desc: 'Haste for your team: +20% mining speed per tier.' },
  {
    id: 'forge', name: 'Forge', icon: 'silver', cost: [80, 160, 240, 320],
    tiers: ['Silver Forge: +50% resources', 'Golden Forge: +100% resources', 'Blazing Forge: +150% resources', 'Molten Forge: +200% resources'],
    desc: 'Makes your base generator faster.',
  },
  { id: 'goldgen', name: 'Gold Generator', icon: 'gold', cost: [200], desc: 'Your base also makes 1 Gold every 10 seconds.' },
  { id: 'diagen', name: 'Diamond Generator', icon: 'diamond', cost: [500], desc: 'Your base also makes 1 Diamond every 10 seconds.' },
  { id: 'heal', name: 'Heal Pool', icon: 'golden_apple', cost: [40], desc: 'Regeneration for your team near your base.' },
];

export function resolveUpgrade(u, level) {
  const maxed = level >= u.cost.length;
  const roman = ['I', 'II', 'III', 'IV'];
  return {
    ...u,
    level,
    maxed,
    price: maxed ? null : { coin: u.cost[level] },
    label: u.cost.length > 1 ? `${u.name} ${roman[Math.min(level, u.cost.length - 1)]}` : u.name,
    next: u.tiers ? u.tiers[Math.min(level, u.tiers.length - 1)] : u.desc,
  };
}

// Traps go off (one at a time, in order) when an enemy walks into your base.
// The price grows with how many are already queued.
export const TRAPS = [
  { id: 'trap', name: 'It’s a Trap!', icon: 'invis_potion', desc: 'The intruder gets Blindness and Slowness for 8 seconds.' },
  { id: 'counter', name: 'Counter-Offensive', icon: 'speed_potion', desc: 'Your team near the base gets Speed and Jump Boost for 15 seconds.' },
  { id: 'alarm', name: 'Alarm Trap', icon: 'bow', desc: 'Reveals invisible intruders and warns your team.' },
  { id: 'fatigue', name: 'Miner Fatigue Trap', icon: 'iron_pickaxe', desc: 'The intruder mines much slower for 10 seconds.' },
];
export const TRAP_COSTS = [40, 80, 160];
export const MAX_TRAPS = 3;
