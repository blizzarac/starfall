# Starfall

A single-player, browser-based action RPG in the spirit of classic 2D isometric MMOs: chibi sprites, click-to-move combat, stat builds and a job tree. Runs entirely in the browser; no server.

This is the **prototype** phase from the design doc: one map, click-to-move, auto-attack, one monster and a debug overlay. Its gate is a fun check on the kill loop. All art is placeholder shapes drawn at boot.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + unit tests
npm run build      # production build in dist/
```

## Controls

| Input | Action |
| --- | --- |
| Left click ground | Walk there (hold to keep walking toward the pointer) |
| Left click monster | Walk into range and auto-attack |
| Left click loot | Walk over and pick it up |
| F1 / F2 | Use Red Tonic / Sweet Apple |
| Z or Insert | Sit (doubles HP and SP regeneration) |
| A | Stat window (spend points with +) |
| ` or F3 | Debug overlay: paths, AI state, kills/min, XP/h, loot gold/h |

## Layout

```
src/
  core/        simulation, no Phaser imports (unit-tested with Vitest)
    combat/formulas.ts   every balance number lives here
    world.ts             50 ms fixed-tick sim: movement, combat, AI, XP, drops
    pathfinding.ts       A* with 8-way moves, no corner cutting
    progression.ts       levels, stat points, derived stats
    sim.ts               fixed-timestep clock with render interpolation
  data/        JSON content + zod schemas (items, monsters, maps)
  scenes/      Phaser scenes: Boot, World, UI
  render/      isometric projection and palette
tests/         Vitest suites
```

Scenes send intents to `World` (`moveTo`, `attack`, `pickUp`, `useItem`, ...) and draw from its state and events. Content is validated against the zod schemas on load, and `tests/content.test.ts` runs the same check in CI.

Maps are a row-per-line terrain grid for now (`.` grass, `,` flowers, `=` path, `T` tree, `R` rock, `~` water); Tiled import comes with the vertical slice.

## Deploy

`.github/workflows/deploy.yml` typechecks, tests and builds every push and PR, and publishes `main` to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**. The Vite `base` is `/starfall/` in CI.

Saves, the PWA and the starter town are in the next phase (vertical slice).
