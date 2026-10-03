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

**Gear.** Eight slots (weapon, shield, head, body, cloak, shoes, two accessories). Greta the blacksmith in Brightmoor sells the basics; rarer pieces drop from monsters (Beetle Buckler, Moss Cap, Clover Charm, Tusk Blade). Equip from *Items → Bag*, see what you wear in *Items → Gear*. **Cards.** Every monster has a card (1% per kill; bosses 25%). Gear has 0–4 card slots; tap *Insert* on a card in *Items → Bag* and pick a piece with a free slot of the right type. Cards stay in for good and add stats, damage against an element or size, or resistance. **Refining.** Greta refines gear from +1 to +10 for gold and one Brightstone (sold at the forge, dropped by Mosslings and Bristleboars). +1 to +4 always works; from +5 the odds fall to 60/50/40/30/20/10%; a failure only costs the ore and gold, never the piece. Weapons gain 3 ATK per level (staves also MATK), armor 1 DEF. Each piece of gear is tracked on its own (refine level and cards), so two Knives can differ. Gear is plain item data (`equip` block in `src/data/items.json`): ATK, DEF, stat bonuses, job and level limits.

**Hunts.** The Hunting Board in Brightmoor posts repeatable bounties (kill N of a monster) for gold, XP and items. Take up to 3 at a time; progress shows under the status panel and in *Menu → Quest log*; hand them in at the board. Hunts live in `src/data/quests.json`.

**Saltmere and the Courier Guild.** East of Whisperwood, Saltmere Coast (Brinejellies, Shellsnaps, Gullwings, Lv 18–24) leads to the harbor town of Saltmere, with Nell's Harbor Market (Blue Tonics for SP, Sailor Boots, Seafarer's Coat), a waystone and Captain Rook's docks. The Courier Guild (Pippa in Brightmoor, Pip in Saltmere) runs storage for 30 gold: one stash of up to 100 different things shared by all three save slots, saved together with each save. Couriers also teleport you for free between the towns you have already visited, and can set your return point.

**Pets.** Mabel in Brightmoor sells lures for Jellops, Mosslings, Thicket Wolves, Shellsnaps and Gullwings. Use a lure from your bag within 6 tiles of that monster; the more worn down it is, the better the odds (20% at full HP, up to 80%). One pet follows you at a time; tap it to see its friendship and fullness, feed it Pet Treats, rename or release it. Pets level up (to Lv 50) from the monsters you defeat together, and bite whatever you're fighting (or whatever attacks you) every 2.5 s, harder with level and friendship. Friendship grows with every win, each pet level, and treats fed when it's hungry; overfeeding hurts it. Its bonus starts at half when *Shy*, is full at *Neutral* and doubles at *Loyal*, and grows 5% per level; Jellops and Gullwings also fetch loot near you. A pet wears one collar or charm: Mabel sells the Leather Collar (bites +30%), Feed Bag (hunger −50%), Jingle Bell (friendship +50%) and Study Ribbon (pet XP +50%); the tinkerers make the Spiked Collar, Treasure Sniffer and Clockwork Harness. A pet left starving loses friendship and eventually runs away. Saves are now version 7 (older saves migrate with no pet).

**Sunspire and second jobs.** Captain Rook's ship sails from Saltmere to the desert city of Sunspire (500 gold; meant for level 30+). South of the city lie the Sunscorch Dunes (Dune Scorpions, Sand Wolves, Sandworms, Lv 32–37) and, past the broken columns, the Sunken Ruins (Rattlebones and Wrapped Ones, both undead, Lv 40–44) where the Dust Pharaoh (Lv 55 boss, 30-minute respawn) slams the floor of its throne room. At job level 25 each first job takes a trial in Sunspire: Knight (10 Scorpion Tails; Pierce, Bowling Bash, Two-Hand Quicken, Riding), Wizard (3 Sand Rubies; Sight Rasher, Thunderstorm, Meteor Storm), Hunter (10 Sand Pelts; Blitz Beat, Steel Crow, Claymore Trap) and Priest (10 Old Bones; Kyrie Eleison, Magnus Exorcismus, Impositio Manus). Second jobs keep their earlier skills and gear. Zahra's bazaar sells the second-job weapons. The skill bar now holds up to 8 skills and wraps into two rows on phones.

**Auto, Potion and the quick bar.** *Auto* fights the nearest monster (ones attacking you first), picks up loot within 5 tiles and drinks a potion below 35% HP; tap the map to take over and it resumes a moment after you arrive. It switches off if you faint, run out of potions or your bag gets too heavy. *Potion* drinks the smallest HP potion that covers what you're missing. The quick bar above the main buttons holds up to 8 skills and items: newly learned skills join automatically, *Bar* in Skills and Items adds or removes them, and *Menu → Edit quick bar* reorders them. Keys: F1–F8 for the bar, Q potion, T auto. A red ring marks your current target, and big monsters are easier to tap.

**Appearance.** New characters pick a look before they start, and *Menu → Appearance* changes it any time for free: six hair styles (Spiky, Bob, Long, Ponytail, Twin tails, Short), nine hair colors, six eye colors and four skin tones, with a big live preview. Every chibi, NPCs included, now has large glossy manga eyes; NPCs get their own hair style, eye color and skin tone. The look is saved with the character and shown on the title screen.

**Maps and goals.** A minimap under the menu button shows the area's layout, exits (cyan), NPCs (yellow), monsters (red, bosses purple), your pet and you; tap it for the world map, which lists every area with its monster levels (places you haven't been show as "???") and the ship route. A ★ line under the status panel always suggests what to do next: the novice steps, a guild to join, where to train for your level, new towns to find, bosses, and your second-job trial.

**Performance.** Scenery off screen is hidden so the renderer skips it, only the current area's ground image is kept in memory (visiting every area used to double the memory), combat text is reused instead of re-created, the comic starburst is drawn once, and monster HP bars redraw only when HP changes. *Menu → Effects: Low* caps the game at 30 fps and turns off screen shake, flashes and speed lines, with fewer particles, for older phones and longer battery life. The simulation clamps long pauses, so a backgrounded game picks up where it left off.

**Gear and stats screens.** Gear in your bag and in shops shows what it would change if worn ("If worn: ATK +34", green when strictly better, red when worse, or why you can't wear it). The stat window shows what one more point in each stat does before you spend it (including carry weight for STR). *Items → Bag* has filters (All, Use, Gear, Cards, Loot), shops keep *Sell all loot*, and the log fades out after a few seconds and merges repeats ("Not enough SP. ×3") so it stays out of the way.

**Balance.** `npm run balance` runs a bot for each job path (Knight, Wizard, Hunter, Priest) through the real game rules for 6 simulated hours and writes `docs/balance.md`: minutes to each base level, job change times, kills and deaths per hour, gold, and XP per minute in every area. The bot (`sim/bot.ts`) fights, heals, rests, spends points, shops and backs off from areas that keep killing it. `SIM_HOURS` and `SIM_SEEDS` change the run length and count. Guilds hand out a starter weapon on joining, potions come in four tiers (Red, Orange, Yellow, White), and Saltmere and Sunspire sell mid-tier weapons for every job line.

**Sound.** Every sound effect and music track is synthesized in the browser with the Web Audio API (`src/audio/`), so nothing extra is downloaded. Each area has its own looping tune (town, harbor, field, forest, cave), generated from a seed, scale and chord progression. *Menu → Music / Sounds* cycles the volume (Off, 30%, 60%, 100%), and the title screen has a mute toggle; settings are kept on the device. Sound starts after the first tap, as browsers require.

**Status effects.** Puffcaps can poison (2% HP per second, never below 1, no natural recovery), Cave Bats blind (HIT and FLEE −25%), Stonelings and the golem's slam stun (no actions). VIT resists poison and stun, INT resists blindness. Green Herbs cure poison, a Panacea cures everything, and resting at the waystone clears it all.

The world so far: **Brightmoor** (town) → **Southern Meadow** (Jellops, passive) → **Thornfield** (Thornbeetles attack on sight) → **Mossy Hollow** (Mosslings, and aggressive Bristleboars) → **Whisperwood** (Puffcaps, Thicket Wolves) → **Glimmer Caves** (Cave Bats, Stonelings) → **Crystal Hall**, home of the first area boss.

**Area boss.** The Crystal Golem (Lv 30) winds up a ground slam every few seconds: a red circle shows where it lands, so step out. It drops a Golem Core, Brightstone and Glimmer Shards every time, sometimes Crystal Mail, and a quarter of the time its card. After it falls it returns 20 real minutes later, even if you leave the map or close the game (the timer is saved).

Maps are a row-per-line terrain grid (`.` grass, `,` flowers, `=` path, `:` cobblestone, `T` tree, `R` rock, `~` water, `#` building) plus spawns, NPCs and edge portals. Every map file in `src/data/maps/` is loaded automatically, and the content check fails the build if a portal, NPC dialogue, shop or drop points at something that doesn't exist.

NPC conversations live in `src/data/dialogues.json`: nodes with text and choices, optional conditions (job, job level, skill level, items held) and actions (set save point, heal, open a shop, take or give items, change job).

## Deploy

`.github/workflows/deploy.yml` typechecks, tests and builds every push and PR, and publishes `main` to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**. The Vite `base` is `/starfall/` in CI.

## Saves

Three slots on the title screen. The game autosaves every 60 seconds and whenever the tab is hidden or closed, which matters on phones, where background tabs get killed without warning. Each slot keeps its last 3 saves; if the newest is unreadable, loading falls back to the previous one. Saves live in this browser's IndexedDB, so **export a save file** (title screen or in-game menu) as a backup or to move to another device, and import it into any slot.

When the save format changes, bump `SAVE_SCHEMA_VERSION` in `src/save/schema.ts` and add a step to `MIGRATIONS` in `src/save/migrations.ts`; old saves upgrade on load.

## Offline and updates

`vite-plugin-pwa` generates the manifest and a service worker that precaches the whole build, so once loaded the game runs offline and can be installed to the home screen. When a new version is deployed, a banner offers **Save & reload** instead of swapping files mid-session.
