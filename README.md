# Starfall

A single-player, browser-based action RPG in the spirit of classic 2D isometric MMOs: chibi sprites, click-to-move combat, stat builds and a job tree. Runs entirely in the browser; no server.

**Play:** https://blizzarac.github.io/starfall/ (on a phone, use *Add to Home Screen* to install it; it then runs fullscreen and offline)

This is the **prototype** phase from the design doc: one map, click-to-move, auto-attack, one monster and a debug overlay. Its gate is a fun check on the kill loop. All art is placeholder shapes drawn at boot.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + unit tests
npm run build      # production build in dist/
```

## Controls

On touch screens, tap where you'd click; the round buttons in the bottom-right cover every key below.

| Input | Action |
| --- | --- |
| Left click ground | Walk there (hold to keep walking toward the pointer) |
| Left click monster | Walk into range and auto-attack |
| Left click loot | Walk over and pick it up |
| Left click NPC | Walk over and talk (shops, save point, tips) |
| F1 / F2 | Use Red Tonic / Sweet Apple |
| I | Items: inventory, weight and gold |
| S | Skills: spend skill points |
| F3–F6 | Use learned active skills (the purple buttons) |
| Z or Insert | Sit (doubles HP and SP regeneration) |
| A | Stat window (spend points with +) |
| ` | Debug overlay (also in the menu): paths, AI state, kills/min, XP/h, loot gold/h |
| Esc / Menu | Save now, export a save file, or save and quit to the title |

## Layout

```
src/
  core/        simulation, no Phaser imports (unit-tested with Vitest)
    combat/formulas.ts   every balance number lives here
    world.ts             50 ms fixed-tick sim: movement, combat, AI, XP, drops
    pathfinding.ts       A* with 8-way moves, no corner cutting
    progression.ts       levels, stat points, derived stats
    sim.ts               fixed-timestep clock with render interpolation
  data/        JSON content + zod schemas (items, monsters, maps, NPC dialogues, shops)
  save/        IndexedDB saves (Dexie), migrations, export/import
  scenes/      Phaser scenes: Boot, Title, World, UI
  ui/          windows: dialogue, shop, inventory
  render/      isometric projection and palette
tests/         Vitest suites
```

Scenes send intents to `World` (`moveTo`, `attack`, `pickUp`, `useItem`, ...) and draw from its state and events. Content is validated against the zod schemas on load, and `tests/content.test.ts` runs the same check in CI.

**Jobs.** Everyone starts as a Novice. At job level 10, with Basic Training at level 9, Captain Harlan in Brightmoor runs the Swordsman trial (bring 10 Jelly Drops). Swordsmen learn Sword Mastery, Increase HP Recovery, Bash, Magnum Break and Endure. Or join the Circle of Mages (Magister Ilse, bring 5 Beetle Shells): Fire, Cold and Lightning Bolt, Soul Strike and Increase SP Recovery. Spells cast from 9 tiles away, show a cast bar, are cut short if you take damage, and cast faster with more DEX. Wren's Archer Lodge (bring 6 Moss Clumps) teaches Owl's Eye, Vulture's Eye, Improve Concentration, Double Strafe and Arrow Shower; with a bow, Archers shoot from 5+ tiles away. Sister Maren's chapel (bring 4 Sweet Apples) makes Acolytes: Heal, Divine Protection, Blessing, Increase AGI and Holy Light. Jobs and skill rules live in `src/core/jobs.ts` and `src/core/skills.ts`.

**Gear.** Eight slots (weapon, shield, head, body, cloak, shoes, two accessories). Greta the blacksmith in Brightmoor sells the basics; rarer pieces drop from monsters (Beetle Buckler, Moss Cap, Clover Charm, Tusk Blade). Equip from *Items → Bag*, see what you wear in *Items → Gear*. **Cards.** Every monster has a rare card (about 0.05%). Gear has 0–4 card slots; tap *Insert* on a card in *Items → Bag* and pick a piece with a free slot of the right type. Cards stay in for good and add stats, damage against an element or size, or resistance. **Refining.** Greta refines gear from +1 to +10 for gold and one Brightstone (sold at the forge, dropped by Mosslings and Bristleboars). +1 to +4 always works; from +5 the odds fall to 60/50/40/30/20/10%, and a failure destroys the piece. Weapons gain 3 ATK per level (staves also MATK), armor 1 DEF. Each piece of gear is tracked on its own (refine level and cards), so two Knives can differ. Gear is plain item data (`equip` block in `src/data/items.json`): ATK, DEF, stat bonuses, job and level limits.

**Hunts.** The Hunting Board in Brightmoor posts repeatable bounties (kill N of a monster) for gold, XP and items. Take up to 3 at a time; progress shows under the status panel and in *Menu → Quest log*; hand them in at the board. Hunts live in `src/data/quests.json`.

**Saltmere and the Courier Guild.** East of Whisperwood, Saltmere Coast (Brinejellies, Shellsnaps, Gullwings, Lv 18–24) leads to the harbor town of Saltmere, with Nell's Harbor Market (Blue Tonics for SP, Sailor Boots, Seafarer's Coat), a waystone and Captain Rook's docks. The Courier Guild (Pippa in Brightmoor, Pip in Saltmere) runs storage for 30 gold: one stash of up to 100 different things shared by all three save slots, saved together with each save. Couriers also teleport you to towns and fields you've already visited, and can set your return point.

**Pets.** Mabel in Brightmoor sells lures for Jellops, Mosslings, Thicket Wolves, Shellsnaps and Gullwings. Use a lure from your bag within 6 tiles of that monster; the more worn down it is, the better the odds (20% at full HP, up to 80%). One pet follows you at a time; tap it to see its friendship and fullness, feed it Pet Treats, rename or release it. Feeding a hungry pet builds friendship and overfeeding hurts it. From *Neutral* it adds its bonus (doubled at *Loyal*), and Jellops and Gullwings fetch loot near you. A pet left starving loses friendship and eventually runs away. Saves are now version 7 (older saves migrate with no pet).

**Sunspire and second jobs.** Captain Rook's ship sails from Saltmere to the desert city of Sunspire (500 gold; meant for level 30+). South of the city lie the Sunscorch Dunes (Dune Scorpions, Sand Wolves, Sandworms, Lv 32–37) and, past the broken columns, the Sunken Ruins (Rattlebones and Wrapped Ones, both undead, Lv 40–44) where the Dust Pharaoh (Lv 55 boss, 30-minute respawn) slams the floor of its throne room. At job level 40 each first job takes a trial in Sunspire: Knight (10 Scorpion Tails; Pierce, Bowling Bash, Two-Hand Quicken, Riding), Wizard (3 Sand Rubies; Sight Rasher, Thunderstorm, Meteor Storm), Hunter (10 Sand Pelts; Blitz Beat, Steel Crow, Claymore Trap) and Priest (10 Old Bones; Kyrie Eleison, Magnus Exorcismus, Impositio Manus). Second jobs keep their earlier skills and gear. Zahra's bazaar sells the second-job weapons. The skill bar now holds up to 8 skills and wraps into two rows on phones.

**Sound.** Every sound effect and music track is synthesized in the browser with the Web Audio API (`src/audio/`), so nothing extra is downloaded. Each area has its own looping tune (town, harbor, field, forest, cave), generated from a seed, scale and chord progression. *Menu → Music / Sounds* cycles the volume (Off, 30%, 60%, 100%), and the title screen has a mute toggle; settings are kept on the device. Sound starts after the first tap, as browsers require.

**Status effects.** Puffcaps can poison (2% HP per second, never below 1, no natural recovery), Cave Bats blind (HIT and FLEE −25%), Stonelings and the golem's slam stun (no actions). VIT resists poison and stun, INT resists blindness. Green Herbs cure poison, a Panacea cures everything, and resting at the waystone clears it all.

The world so far: **Brightmoor** (town) → **Southern Meadow** (Jellops, passive) → **Thornfield** (Thornbeetles attack on sight) → **Mossy Hollow** (Mosslings, and aggressive Bristleboars) → **Whisperwood** (Puffcaps, Thicket Wolves) → **Glimmer Caves** (Cave Bats, Stonelings) → **Crystal Hall**, home of the first area boss.

**Area boss.** The Crystal Golem (Lv 30) winds up a ground slam every few seconds: a red circle shows where it lands, so step out. It drops a Golem Core, Brightstone and Glimmer Shards every time, sometimes Crystal Mail, and rarely its card. After it falls it returns 20 real minutes later, even if you leave the map or close the game (the timer is saved).

Maps are a row-per-line terrain grid (`.` grass, `,` flowers, `=` path, `:` cobblestone, `T` tree, `R` rock, `~` water, `#` building) plus spawns, NPCs and edge portals. Every map file in `src/data/maps/` is loaded automatically, and the content check fails the build if a portal, NPC dialogue, shop or drop points at something that doesn't exist.

NPC conversations live in `src/data/dialogues.json`: nodes with text and choices, optional conditions (job, job level, skill level, items held) and actions (set save point, heal, open a shop, take or give items, change job).

## Deploy

`.github/workflows/deploy.yml` typechecks, tests and builds every push and PR, and publishes `main` to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**. The Vite `base` is `/starfall/` in CI.

## Saves

Three slots on the title screen. The game autosaves every 60 seconds and whenever the tab is hidden or closed, which matters on phones, where background tabs get killed without warning. Each slot keeps its last 3 saves; if the newest is unreadable, loading falls back to the previous one. Saves live in this browser's IndexedDB, so **export a save file** (title screen or in-game menu) as a backup or to move to another device, and import it into any slot.

When the save format changes, bump `SAVE_SCHEMA_VERSION` in `src/save/schema.ts` and add a step to `MIGRATIONS` in `src/save/migrations.ts`; old saves upgrade on load.

## Offline and updates

`vite-plugin-pwa` generates the manifest and a service worker that precaches the whole build, so once loaded the game runs offline and can be installed to the home screen. When a new version is deployed, a banner offers **Save & reload** instead of swapping files mid-session.
