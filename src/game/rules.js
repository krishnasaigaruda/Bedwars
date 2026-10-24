// Minecraft numbers the game logic shares.
import { BLOCKS } from '../world/blocks.js';
import { getItem } from './items.js';

export const TPS = 20;
export const REACH_BLOCK = 4.5;       // survival block reach (1.8)
export const REACH_ENTITY = 3;
export const PLACE_DELAY = 4;         // ticks between placements while holding right click
export const BREAK_DELAY = 5;         // ticks after a break before the next block starts
export const SWING_TICKS = 6;
export const EAT_TICKS = 32;
export const PICKUP_DELAY = 40;       // ticks before a thrown item can be picked up
export const RESPAWN_TICKS = 5 * TPS;

// Ticks to break a block with the held item (0 = instant, Infinity = never).
export function breakTicks(blockId, heldId, haste = 0, fatigue = false) {
  const b = BLOCKS[blockId];
  if (!b || !Number.isFinite(b.hardness)) return Infinity;
  if (b.hardness <= 0) return 0;
  const item = getItem(heldId);
  const right = !!(item && b.tool && item.kind === b.tool);
  let speed = right ? item.speed : 1;
  const canHarvest = (!b.needsTool || right) && (!b.minTier || (right && item.tier >= b.minTier));
  speed *= 1 + 0.2 * haste;
  if (fatigue) speed *= 0.3;
  const perTick = speed / b.hardness / (canHarvest ? 30 : 100);
  return perTick >= 1 ? 0 : Math.ceil(1 / perTick);
}

// Does breaking this block with this item drop it? (Minecraft: stone-like
// blocks need a pickaxe, Voidstone a diamond one.)
export function canHarvest(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  const item = getItem(heldId);
  const right = !!(item && b.tool && item.kind === b.tool);
  return (!b.needsTool || right) && (!b.minTier || (right && item.tier >= b.minTier));
}

export const fallDamage = (distance) => Math.max(0, Math.ceil(distance - 3));

// 1.8 armor: each armor point blocks 4% of the damage.
export const afterArmor = (damage, armorPoints) => damage * (25 - Math.min(20, armorPoints)) / 25;
