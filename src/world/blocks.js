// Block registry. IDs fit in a Uint8.
//
// hardness uses Minecraft units: a block takes ceil(30 * hardness / speed)
// ticks with the right tool, or ceil(100 * hardness / speed) when it
// needs a tool you are not holding (see breakTicks in game/rules.js).
//
// render:  'cube'   opaque full block
//          'cutout' full block with see-through pixels (leaves)
//          'glass'  translucent, drawn in a second pass
//          'ladder' thin panel against a wall
//          'none'   drawn as a model instead (beds)
// blast:   0 = broken by fireballs and TNT, 1 = only TNT, 2 = immune
import { TEAMS } from '../config.js';

export const B = {
  AIR: 0,
  TURF: 1,
  LOAM: 2,
  SLATE: 3,
  COBBLE: 4,
  BRICKS: 5,
  LOG: 6,
  LEAF: 7,
  SAND: 8,
  TIMBER: 9,
  MOON: 10,
  VOID: 11,
  PRISM: 12,
  LOBBY_GLASS: 13,
  FORGE: 14,
  GOLD_GEN: 15,     // plate under a Gold generator
  DIAMOND_GEN: 16,  // plate under a Diamond generator
  BED: 17,
  LADDER: 18,   // 18..21, one per facing
  FLUFF: 24,    // 24..31, one per team color
  CLAY: 32,     // 32..39, one per team color
  // Map decoration.
  PLANKS_DARK: 40,
  ROOF: 41,
  LANTERN: 42,
  CRATE: 43,
  POLISHED: 44,
  GOLD_BLOCK: 45,
  DIAMOND_BLOCK: 46,
  BRICKS_MOSSY: 47,
  SNOW: 48,
  ICE: 49,
  SANDSTONE: 50,
  LEAF_AUTUMN: 51,
  CHEST: 52,
  LOG_DARK: 53,
  TNT: 54,          // placing it lights it straight away
  ENDER_CHEST: 55,  // personal storage, same contents in every ender chest
};

// Ladder facing = the direction the ladder's front points (away from its wall).
export const LADDER_FACINGS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

export const BLOCKS = [];

function def(id, o) {
  BLOCKS[id] = {
    id,
    name: o.name,
    tiles: o.tiles,
    render: o.render ?? 'cube',
    solid: o.solid ?? true,
    opaque: o.opaque ?? (o.render ?? 'cube') === 'cube',
    hardness: o.hardness ?? Infinity,
    tool: o.tool ?? null,
    needsTool: o.needsTool ?? false,
    minTier: o.minTier ?? 0,
    blast: o.blast ?? 2,
    height: o.height ?? 1,
    climbable: o.climbable ?? false,
    slip: o.slip ?? 0.6,
    team: o.team ?? -1,
    shopItem: o.shopItem ?? false,
  };
}

const all = (t) => ({ top: t, bottom: t, side: t });

def(B.AIR, { name: 'Air', tiles: null, render: 'none', solid: false, opaque: false });
def(B.TURF, { name: 'Moss Turf', tiles: { top: 'turf_top', bottom: 'loam', side: 'turf_side' } });
def(B.LOAM, { name: 'Loam', tiles: all('loam') });
def(B.SLATE, { name: 'Slate', tiles: all('slate') });
def(B.COBBLE, { name: 'Cobble', tiles: all('cobble') });
def(B.BRICKS, { name: 'Slate Bricks', tiles: all('bricks') });
def(B.LOG, { name: 'Birch Log', tiles: { top: 'log_top', bottom: 'log_top', side: 'log_side' } });
def(B.LEAF, { name: 'Leaves', tiles: all('leaf'), render: 'cutout', opaque: false });
def(B.SAND, { name: 'Sand', tiles: all('sand') });
def(B.FORGE, { name: 'Forge', tiles: { top: 'forge_top', bottom: 'forge_side', side: 'forge_side' } });
def(B.GOLD_GEN, { name: 'Gold Generator', tiles: { top: 'goldgen_top', bottom: 'bricks', side: 'bricks' } });
def(B.DIAMOND_GEN, { name: 'Diamond Generator', tiles: { top: 'diagen_top', bottom: 'bricks', side: 'bricks' } });
def(B.PLANKS_DARK, { name: 'Dark Planks', tiles: all('planks_dark') });
def(B.ROOF, { name: 'Roof Tiles', tiles: all('roof') });
def(B.LANTERN, { name: 'Lantern Block', tiles: all('lantern') });
def(B.CRATE, { name: 'Crate', tiles: { top: 'crate_top', bottom: 'crate_top', side: 'crate_side' } });
def(B.POLISHED, { name: 'Polished Stone', tiles: all('polished') });
def(B.GOLD_BLOCK, { name: 'Gold Block', tiles: all('gold_block') });
def(B.DIAMOND_BLOCK, { name: 'Diamond Block', tiles: all('diamond_block') });
def(B.BRICKS_MOSSY, { name: 'Mossy Bricks', tiles: all('bricks_mossy') });
def(B.SNOW, { name: 'Snowy Turf', tiles: { top: 'snow_top', bottom: 'loam', side: 'snow_side' } });
def(B.ICE, { name: 'Ice', tiles: all('ice'), slip: 0.98 });
def(B.SANDSTONE, { name: 'Sandstone', tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' } });
def(B.LEAF_AUTUMN, { name: 'Autumn Leaves', tiles: all('leaf_autumn'), render: 'cutout', opaque: false });
def(B.CHEST, { name: 'Team Chest', tiles: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side' } });
def(B.LOG_DARK, { name: 'Dark Log', tiles: { top: 'log_dark_top', bottom: 'log_dark_top', side: 'log_dark_side' } });
def(B.ENDER_CHEST, { name: 'Ender Chest', tiles: { top: 'echest_top', bottom: 'echest_top', side: 'echest_side' } });
def(B.TNT, { name: 'TNT', tiles: { top: 'tnt_top', bottom: 'tnt_top', side: 'tnt_side' }, hardness: 0, blast: 0, shopItem: true });
def(B.LOBBY_GLASS, { name: 'Lobby Glass', tiles: all('lobby_glass'), render: 'glass', opaque: false });

// Blocks players can buy, place and break.
def(B.TIMBER, { name: 'Timber', tiles: all('timber'), hardness: 2, tool: 'axe', blast: 0, shopItem: true });
def(B.MOON, { name: 'Moonstone', tiles: all('moonstone'), hardness: 3, tool: 'pickaxe', needsTool: true, blast: 1, shopItem: true });
def(B.VOID, { name: 'Voidstone', tiles: all('voidstone'), hardness: 50, tool: 'pickaxe', needsTool: true, minTier: 3, blast: 2, shopItem: true });
def(B.PRISM, { name: 'Prism Glass', tiles: all('prism'), render: 'glass', opaque: false, hardness: 0.3, blast: 2, shopItem: true });
def(B.BED, { name: 'Bed', tiles: null, render: 'none', opaque: false, hardness: 0.2, height: 0.5625 });
for (let f = 0; f < 4; f++) {
  def(B.LADDER + f, { name: 'Rope Ladder', tiles: all('ladder'), render: 'ladder', solid: false, opaque: false, hardness: 0.4, tool: 'axe', blast: 0, climbable: true, shopItem: true });
}
TEAMS.forEach((t, i) => {
  def(B.FLUFF + i, { name: `${t.name} Fluff`, tiles: all(`fluff_${i}`), hardness: 0.8, tool: 'shears', blast: 0, team: i, shopItem: true });
  def(B.CLAY + i, { name: `${t.name} Clay Tile`, tiles: all(`clay_${i}`), hardness: 1.25, tool: 'pickaxe', needsTool: true, blast: 0, team: i, shopItem: true });
});

export const isLadder = (id) => id >= B.LADDER && id < B.LADDER + 4;
export const block = (id) => BLOCKS[id] ?? BLOCKS[0];
