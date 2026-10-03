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

Maps are a row-per-line terrain grid (`.` grass, `,` flowers, `=` path, `:` cobblestone, `T` tree, `R` rock, `~` water, `#` building) plus spawns, NPCs and edge portals. Every map file in `src/data/maps/` is loaded automatically, and the content check fails the build if a portal, NPC dialogue, shop or drop points at something that doesn't exist.

NPC conversations live in `src/data/dialogues.json`: nodes with text and choices, optional conditions (job, job level, skill level, items held) and actions (set save point, heal, open a shop, take or give items, change job).

## Deploy

`.github/workflows/deploy.yml` typechecks, tests and builds every push and PR, and publishes `main` to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**. The Vite `base` is `/starfall/` in CI.

## Saves

Three slots on the title screen. The game autosaves every 60 seconds and whenever the tab is hidden or closed, which matters on phones, where background tabs get killed without warning. Each slot keeps its last 3 saves; if the newest is unreadable, loading falls back to the previous one. Saves live in this browser's IndexedDB, so **export a save file** (title screen or in-game menu) as a backup or to move to another device, and import it into any slot.

When the save format changes, bump `SAVE_SCHEMA_VERSION` in `src/save/schema.ts` and add a step to `MIGRATIONS` in `src/save/migrations.ts`; old saves upgrade on load.

## Offline and updates

`vite-plugin-pwa` generates the manifest and a service worker that precaches the whole build, so once loaded the game runs offline and can be installed to the home screen. When a new version is deployed, a banner offers **Save & reload** instead of swapping files mid-session.
