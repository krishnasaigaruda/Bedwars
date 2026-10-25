# BlockWars — Bedwars clone (browser, PeerJS, no backend)

Plain files, no build. Three.js + PeerJS from CDN through an import map. Run with any static server
(`python3 -m http.server`), because ES modules don't load from `file://`. Works on GitHub Pages.

Visual style: bright, chunky, stylized voxels like minefun.io. Every texture is drawn in code on a
canvas at startup (no image files, nothing copied from Minecraft). The models for beds, players, NPCs
and generators are custom too.

## Where things stand (Oct 24)

All seven build steps are in. Where the sections below disagree with this list, this list wins:
the design changed while we built it.

- **Currencies:**
  - Silver: base forge, 1 every 2 seconds. Buys the basics.
  - Coins: base forge, 10 every 6 seconds. Buys team upgrades only.
  - Gold: 4 gold islands between the bases. Buys better gear and blocks.
  - Diamonds: generators on the middle structure. Buys the best gear.
- **Base generators:**
  - They only run while someone is within 20 blocks.
  - Everyone standing on one gets their own share.
  - Team upgrades can add a Gold or Diamond generator at your base (one item every 10s).
- **Maps:** 4 themes (Sky Garden, Frost Peak, Sun Temple, Autumn Keep).
  - The world is 256×128×256.
  - One big middle island with a giant structure, plus 4 gold islands.
  - Gaps are 18–33 blocks.
- **Shop prices:**
  - Armor is a full set: chain 48 silver, iron 18 gold, diamond 18 diamonds.
  - Moonstone is 8 for 3 gold, Timber 16 for 3 gold, Prism Glass 4 for 2 gold.
  - Utility, ranged and potion items are all in. The pop-up tower is 4×4 and builds itself; the bridge egg makes a 3-wide bridge.
- **Movement and building:** Minecraft 1.8 numbers, 20 ticks a second.
  - Reach is 4.5 blocks, one block per click, crack stages match break time.
  - Hunger and fall damage work.
- **Chests:** Team Chest (shared) and Ender Chest (personal) at every base. Contents stay through deaths.
- **Multiplayer:** host-authoritative over PeerJS (`src/net/`).
  - Private room codes (`?room=CODE` links) and Quick Play slots.
  - Lobby with flying and a team picker, chat on T, player list on Tab (with each player's ping).
  - Positions and snapshots go over a second, unreliable data channel (`Link.sendFast`), numbered so
    late ones are dropped. Everything else stays on the reliable one. Other players are drawn 2 ticks
    in the past and interpolated (`render/remote.js`), so Wi-Fi hiccups don't freeze them.
- **Voice chat** (`src/net/voice.js`): every online game asks "join voice chat?" (Yes/No); join,
  mute or leave later from the Esc menu. Players only connect to the host, so the host mixes:
  each player calls the host with their mic and gets back one stream of everyone else. The host
  sends the member list and who's talking; a panel at the bottom right shows it once you've joined.
  No mic, or mic blocked, means listen-only.
- **Controls:** Place and attack also have keys (F and R by default, set in Settings) for laptop
  touchpads; Windows ignores touchpad taps while a key is held. Raw mouse input is off by default
  on Windows because touchpads need the system's pointer acceleration.
- **Dev server:** don't use `python3 -m http.server`; it lets the browser cache old code. Run the
  no-cache script instead, from the project folder:
  `python3 /private/tmp/claude-501/-Users-krishna-Documents-git-Bedwars/0efe6c7f-f990-465f-a579-acd512082ce1/scratchpad/serve.py . 8642`
  - That file lives in a temporary folder, so copy it into the project if you want to keep it.

**Still open:**
- Host migration (if the host leaves, the game ends).
- A TURN server option for strict networks.
- Bots.
- Mobile controls.
- Ending at the 40-minute mark: there are no sudden-death dragons.

---

## 1. Modes (standard Hypixel layouts)

| Mode    | Teams | Per team | Max players | Map ring |
|---------|-------|----------|-------------|----------|
| Solo    | 8     | 1        | 8           | 8 bases  |
| Doubles | 8     | 2        | 16          | 8 bases  |
| Trios   | 4     | 3        | 12          | 4 bases  |
| Squads  | 4     | 4        | 16          | 4 bases  |

Team colors: Red, Blue, Green, Yellow, Aqua, White, Pink, Gray (4-team modes use the first 4).

---

## 2. Joining and the waiting lobby

**Main menu:** name input (saved in localStorage), mode picker, then:
- **Quick Play**: join a public room that is about to start, or open a new one if none exists.
- **Create Private Room**: get a 5-letter code (no I/O/0/1), plus a copy-link button (`?room=CODE`).
- **Join with Code**: type the code.

**How rooms work without a backend:** we use the free public PeerJS signaling server (0.peerjs.com)
only to find peers. Once peers connect, all traffic goes directly between browsers over WebRTC.
- Private host peer ID: `bwfun1-priv-<CODE>`
- Public room slots: `bwfun1-pub-<mode>-<0..9>`
  - Quick Play connects to all 10 slots of the mode in parallel (3 s timeout). Each host that answers
    replies `info {state, players, max, countdownLeft}`.
  - Pick the room in `waiting` or `countdown` state that isn't full and has the **most** players, so
    rooms fill up instead of splitting.
  - If none are found, take the first free slot with `new Peer(slotId)`. If you get `unavailable-id`,
    try the next slot. You become the host.
  - Once the game starts, the host answers `in-game`, so searchers skip it.

**Waiting lobby (before the game):**
- A floating lobby platform high above the map center (y ≈ 120), styled as a glass and plank hub with
  the map visible below.
- **Fly mode:** double-tap Space to toggle flying, like creative mode. Space rises, Shift sinks.
  Falling off teleports you back to the platform. No damage, no blocks.
- HUD shows the mode, player count `5/8`, the room code (private rooms), and a countdown title.
- **Public rooms:** the 20 s countdown starts when at least 50% of slots are filled (min 2). It drops
  to 10 s when the room is full, and cancels if players leave and the count falls below the minimum.
- **Private rooms:** the host gets a **Start** button (works with 2+ players) and a **team picker**
  panel. Everyone can click a team color that isn't full.
- At start, teams are auto-balanced (keeping picks), and everyone teleports to their island. Flying is
  turned off.

Late join after the start: not allowed. Shows "Game in progress" (spectating is a possible extra).

---

## 3. Network architecture

- **Star topology, host-authoritative.** The host's browser runs the real game simulation. The host
  is also a player and connects through a local loopback connection that uses the same code path.
- **Host owns:** block edits, inventories, health, damage, beds, generators and dropped items,
  projectiles, shop and upgrade purchases, timers and events, win checks.
- **Clients own (with host sanity checks):** their own movement. Clients predict their own movement
  and send position, velocity, yaw, pitch and flags at 20 Hz. The host checks speed and teleports, and
  can snap a client back.
- **Optimistic actions:** a client places or breaks a block locally right away. The host confirms
  (broadcasts) or rejects (`blockFix` reverts it).
- **Two DataConnections per client:**
  - `rel`, reliable: events, block edits, inventory, chat, shop.
  - `fast`, unreliable: player state and snapshots.
  - Fallback: use only `rel` if the unreliable channel fails.
- **Tick:** host simulation runs at 20 TPS. Snapshots are broadcast at 20 Hz. Remote entities are
  interpolated about 100 ms behind.
- **Background tab fix:** browsers throttle timers in background tabs. The host tick is driven by a
  Web Worker heartbeat (`postMessage` every 50 ms), which isn't throttled the same way.
- **World sync:** the map is generated deterministically from `mapId` and the mode. On join, the host
  sends only the diff list (placed and broken blocks).
- **Host leaves:** the game ends with the message "Host left". Host migration is out of scope for v1.
- **NAT:** STUN from Google by default. An optional TURN config field in settings helps strict
  school or work networks.

### Messages

Client → host:
`hello{name, mode}`, `pickTeam{team}`, `start`, `st{p,v,yaw,pitch,flags,slot}`,
`place{x,y,z,slot}`, `dig{x,y,z}` (sent when finished; the host checks the time),
`attack{target}`, `shoot{charge,dir}`, `use{slot,dir}` (fireball, pearl, egg, potion, gapple, TNT),
`buy{item}`, `upgrade{id}`, `drop{slot}`, `chat{text}`

Host → client:
`welcome{id, room, lobby}`, `lobby{players, teams, countdown}`, `begin{teams, spawn, edits}`,
`snap{players[], items[], projectiles[]}`, `block{x,y,z,id}`, `blockFix`, `inv{slots, armor, res}`,
`hp{hp, absorb, effects}`, `ev{type,...}` (kill, final, bedBreak, title, sound, gen tier),
`chat`, `teamUp{upgrades, traps}`, `end{winner, stats}`

---

## 4. World and engine

- **Voxels:** 16³ chunks of `Uint8Array` block IDs. World about 192×96×192. The void is below y=0.
  The build limit is y = map top + 25.
- **Meshing:** face culling, per-vertex ambient occlusion (gives the soft minefun look), one texture
  atlas with `NearestFilter`, a separate transparent pass for glass and leaves. Only dirty chunks are
  remeshed.
- **Lighting:** hemisphere light, a sun with a soft shadow at low resolution, fog, gradient sky dome,
  cartoon clouds.
- **Protected map blocks:** only blocks that players placed (tracked in a set) and beds can be
  broken. No-build zones: around the shop and upgrade NPCs, on top of generators, inside spawn points.
- **Raycast:** DDA voxel raycast for picking blocks (reach 4.5) and player hitboxes (reach 3.0, the
  host allows 3.6 for lag).

### Blocks (own names and textures, Bedwars roles)

| Role (shop)       | Our block   | Texture idea                                    |
|-------------------|-------------|-------------------------------------------------|
| Wool              | Fluff       | Team-tinted quilted squares with stitch lines   |
| Hardened clay     | Clay Tile   | Team-tinted brick tiles, rounded corners        |
| Blast-proof glass | Prism Glass | Translucent with a hex pattern, light rim       |
| End stone         | Moonstone   | Pale cream with small craters                   |
| Planks            | Timber      | Horizontal boards with nail dots                |
| Obsidian          | Voidstone   | Deep purple-black with glowing violet cracks    |
| Ladder            | Rope Ladder | Rope and rungs, climbable                       |
| (map) grass       | Moss Turf   | Mint top with tiny flowers, loam sides          |
| (map) stone, etc. | Slate, Cobble, Birch log, Leaf, Sand, Lobby glass |                       |

### Models (all custom, not Minecraft)

- **Bed:** a "Dream Bed", 2 blocks long. Rounded wooden frame, a puffy team-colored quilt with a star
  emblem, a big white pillow, and short corner posts. A **team-colored crystal floats and spins above
  the head**, so you can see the bed from far away. When the bed breaks, the crystal shatters into
  particles.
- **Player:** chunky blocky character with a big head and simple eyes, a team-colored hoodie, and
  shorter arms and legs. Armor shows as tinted overlay boxes: team-colored leather by default; the
  legs and boots tint chain, iron or diamond. The held item is visible. Name tags are team-colored.
  Walk, swing and hurt-flash animations.
- **Items:** flat 16×16 pixel sprites extruded into 3D (swords, pickaxes, bow). Dropped items spin and
  bob.
- **NPCs:** "Trader" (item shop) and "Tinker" (team upgrades), stylized round-headed merchants.
- **Generators:**
  - Island forge: a glowing pad.
  - Diamond and emerald generators: a floating rotating crystal with a hologram showing "Tier II" and
    "Spawns in 12s".

### Map generator (procedural, deterministic)

- Team islands are evenly spaced on a ring (radius about 64 for 8 teams, 52 for 4 teams). Each island
  has:
  - the bed, at the back facing the center
  - the forge
  - the Trader and the Tinker
  - a team chest
  - a spawn point
- 4 diamond islands on the diagonals between bases.
- A mid island with emerald generators: 4 in 8-team modes, 2 in 4-team modes.
- Trees and decoration. Gaps are sized so you have to bridge.

---

## 5. Player controls and physics

- WASD to move. Space to jump (in the lobby, double-tap toggles fly). Ctrl or double-tap W to sprint.
  **Shift to sneak, which stops you walking off edges (important for bridging).**
- LMB attack or break. RMB place or use. 1–9 or scroll for the hotbar. E opens the inventory. Q drops
  an item. T opens chat. Tab shows the player list. Esc opens the menu. F5 toggles third person.
- AABB of 0.6×1.8, gravity, step-free collision, ladders, fall damage (fall height minus 3), void
  death below y < -20.
- Settings: sensitivity, FOV, render distance, volume, optional TURN server.

---

## 6. Combat (1.8-style, like Hypixel)

- 20 HP (10 hearts). Natural regeneration when out of combat. No attack cooldown; hit
  invulnerability is 500 ms.
- Sword damage: wood 4, stone 5, iron 6, diamond 7. Sharpness adds +1.25. Critical hits (while
  falling) do ×1.5.
- Armor points reduce damage. Protection adds 4% per level.
- Knockback: base, plus extra when sprinting, plus the knockback stick.
- Bow: charge up to 1 s, arrow physics, damage scales with charge. Power and Punch enchants.
- **Death with your bed alive:** respawn after 5 s (spectator camera). You keep your permanent armor
  and shears. Pickaxe and axe drop one tier. Your sword resets to wood. You lose all resources.
- **The killer gets the victim's resources** (iron, gold, diamonds, emeralds), shown as "+12 Iron"
  in chat. For void and fall deaths, the last player who hit you within 10 s gets the kill.
- **Death with no bed:** FINAL KILL. You become a spectator. A team is eliminated when its last
  member is final-killed. The last team left wins.

---

## 7. Resources: generators and how drops are split

| Generator          | Item     | Tier I | Tier II | Tier III | Ground cap |
|--------------------|----------|--------|---------|----------|------------|
| Island forge       | Iron     | 1/1.0s | —       | —        | 48         |
| Island forge       | Gold     | 1/6.0s | —       | —        | 12         |
| Diamond (×4)       | Diamond  | 30s    | 23s     | 12s      | 4          |
| Emerald (mid)      | Emerald  | 65s    | 50s     | 35s      | 2          |

**Forge upgrades** (team upgrade):
- Iron Forge: +50%
- Golden Forge: +100%
- Emerald Forge: also spawns 1 emerald every 75 s at the base
- Molten Forge: +200%

**How drops are distributed:**
- Drops merge into one stack entity per generator, with a count shown above it. This keeps network
  and render cost low and stops the floor filling with hundreds of items. When the stack reaches the
  cap, the generator pauses.
- Auto-pickup radius is 1.5 blocks. Stacks are picked up in batches.
- **Forge split (Hypixel-style):** when someone picks up iron or gold at their own forge, every
  **teammate standing within 2 blocks of the forge also gets the same amount**. Teams that farm
  together all gear up, and nobody has to wait their turn. Diamonds and emeralds are **not** split:
  first come, first served.
- Items dropped by players (Q) don't split and can be picked up by anyone.
- Iron and gold generator timers have a little random jitter (±10%) so drops feel natural.

**Event timeline** (shown in the scoreboard as "Diamond II in 4:12"):
- 6:00 Diamond II
- 12:00 Emerald II
- 18:00 Diamond III
- 24:00 Emerald III
- 30:00 All beds destroyed
- 40:00 Game end (draw, or the team with the most players alive wins)

---

## 8. Item shop (Trader). Hypixel prices, our block names

Shop UI: a category tab row and a grid. Hover shows the cost. Prices are red if you can't afford
them. Shift-click buys 5 stacks. A Quick Buy tab comes first.

- **Blocks:**
  - Fluff ×16: 4 iron
  - Clay Tile ×16: 12 iron
  - Prism Glass ×4: 12 iron
  - Moonstone ×12: 24 iron
  - Rope Ladder ×8: 4 iron
  - Timber ×16: 4 gold
  - Voidstone ×4: 4 emerald
- **Melee:**
  - Stone sword: 10 iron
  - Iron sword: 7 gold
  - Diamond sword: 4 emerald
  - Knockback stick: 5 gold
- **Armor (permanent):**
  - Chain: 24 iron
  - Iron: 12 gold
  - Diamond: 6 emerald
- **Tools (tiered, drop one tier on death):**
  - Pickaxe: wood 10 iron, iron 10 iron, gold 3 gold, diamond 6 gold
  - Axe: wood 10 iron, stone 10 iron, iron 3 gold, diamond 6 gold
  - Shears (permanent): 20 iron
- **Ranged:**
  - Arrows ×8: 2 gold
  - Bow: 12 gold
  - Bow with Power I: 20 gold
  - Bow with Power I and Punch I: 6 emerald
- **Potions (45 s):**
  - Speed II: 1 emerald
  - Jump Boost V: 1 emerald
  - Invisibility (30 s): 2 emerald
- **Utility:**
  - Golden apple: 3 gold
  - Fireball: 40 iron
  - TNT: 4 gold (8 in Trios and Squads)
  - Ender pearl: 4 emerald
  - Bridge egg: 1 emerald
  - Pop-up tower: 24 iron
  - Magic milk: 4 gold

**Mining speed:** hardness × tool multiplier.
- Shears are fast on Fluff. The axe is fast on Timber and ladders. The pickaxe is fast on Clay,
  Moonstone and Voidstone.
- Voidstone takes about 9 s even with a diamond pickaxe.
- Maniac Miner gives Haste.
- A crack overlay shows break progress.

**Explosions:**
- Fireball: breaks Fluff, Timber, Clay and ladders, and gives knockback (fireball jumping).
- TNT: fuse 3 s. Also breaks Moonstone.
- Prism Glass and Voidstone are immune to both.

---

## 9. Team upgrades (Tinker, costs in diamonds)

| Upgrade              | Solo/Doubles  | Trios/Squads   |
|----------------------|---------------|----------------|
| Sharpened Swords     | 4             | 8              |
| Reinforced Armor I–IV| 2 / 4 / 8 / 16| 5 / 10 / 20 / 30 |
| Maniac Miner I–II    | 2 / 4         | 4 / 6          |
| Forge I–IV           | 2 / 4 / 6 / 8 | 4 / 8 / 12 / 16|
| Heal Pool            | 1             | 3              |

**Traps:** a queue of up to 3. Each one costs 1, then 2, then 4 diamonds. A trap triggers when an
enemy enters the 7-block base radius.
- It's a Trap: blindness and slowness
- Counter-Offensive: speed and jump for defenders
- Alarm: reveals invisible players and alerts the team
- Miner Fatigue

---

## 10. HUD and UI

- **Right sidebar scoreboard (Hypixel-style):**
  - BLOCKWARS title, date, "Diamond II in 3:21"
  - One line per team: `R Red ✓` (bed alive), `✗` (bed gone), or the number of players alive
  - Your kills, final kills and beds broken
- Hearts, armor bar, and a 9-slot hotbar with counts.
- Resource counters next to the hotbar (iron, gold, diamonds, emeralds).
- Big center titles: "BED DESTROYED!", "VICTORY!", the respawn countdown.
- Killfeed (top-right, colored names, icons for void, bow and bed) and a chat log (bottom-left,
  fades out, T to type).
- Tab player list, inventory screen, Shop and Tinker windows, Esc settings menu, and an end screen
  with stats and a Play Again button.
- Font: a chunky pixel-ish web font from Google Fonts (e.g. "Press Start 2P" for titles and "Rubik"
  for the UI).

**Audio:** WebAudio procedural sounds with no audio files: hit, break, place, pickup ding,
bed-destroyed horn, countdown ticks, trap alarm.

---

## 11. Files

```
index.html          import map (three@0.160.0, peerjs@1.5.4), UI root
style.css
src/
  main.js           boot, screens, main loop
  config.js         modes, prices, generator rates, timeline, upgrade costs, constants
  audio.js
  net/
    transport.js    PeerJS wrapper: host and client, rel and fast channels, loopback, worker heartbeat
    matchmaking.js  private codes, public slot scan, claiming a slot
    protocol.js     message names, number packing
  world/
    blocks.js       block registry (hardness, tool, breakable, blast-proof, transparent, texture)
    textures.js     procedural canvas atlas and item sprites
    world.js        chunks, get/set, DDA raycast, placed-block set
    mapgen.js       islands, generators, NPC spots, lobby platform
    mesher.js       chunk meshing with ambient occlusion
  render/
    renderer.js     scene, camera, sky, fog, lights, chunk meshes
    models.js       player, Dream Bed, NPCs, generators, items, projectiles
    effects.js      particles, crack overlay, damage tilt, hit flash
  player/
    controls.js     pointer lock, keybinds, double-tap detection
    physics.js      AABB vs voxels, sneak edge guard, fly, ladders
  game/
    host.js         authoritative sim (tick, players, generators, items, combat, beds, events, win)
    client.js       local prediction, interpolation buffers, applying host messages
    rules.js        damage, armor, knockback, mining time, explosions
    inventory.js    slots, armor, resources, death downgrade
    shop.js         catalog and purchase validation
    upgrades.js     team upgrades and traps
  ui/
    menus.js        main menu, Quick Play, private room, join code, settings
    lobby.js        lobby HUD, team picker, start button, countdown
    hud.js          hearts, hotbar, scoreboard, titles, killfeed, chat, tab list
    shopui.js       Shop and Tinker windows
```

---

## 12. Build order (milestones; test each before the next)

1. **Engine sandbox:** textures, chunks, mesher, sky, controls, physics (sneak, fly), place and
   break, map generator. Fly around the generated map alone.
2. **Rules offline** (host plus loopback, one player): beds, forge and generators, drops, pickup
   split, inventory, hotbar, Shop UI, mining tiers, death, respawn, void.
3. **Networking:** transport, private rooms, the waiting lobby with fly mode, team picker,
   countdown, `begin`, sync of movement and blocks. Test with two tabs.
4. **Combat:** melee, armor, knockback, bow, kill rewards, final kills, elimination, win and end
   screen, killfeed and chat.
5. **Diamond and emerald generator tiers, the event timeline, the Tinker** (upgrades and traps),
   scoreboard.
6. **Utility items:** fireball, TNT, pearl, bridge egg, pop-up tower, potions, golden apple, milk.
7. **Quick Play matchmaking** and polish: sounds, particles, models, settings, tab list, performance
   (binary snapshots if needed).

**Out of scope for v1:** bots, host migration, sudden-death dragons, spectating someone else's game,
mobile touch controls.
