import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/content';
import { tileDistance } from '../src/core/grid';
import { World } from '../src/core/world';

const content = loadContent();
const map = content.maps.get('meadow-1')!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += 50) {
    world.tick();
    if (until?.()) return;
  }
}

function nearestMonster(world: World) {
  return [...world.monsters.values()].sort(
    (a, b) => tileDistance(a.tile, world.player.tile) - tileDistance(b.tile, world.player.tile),
  )[0]!;
}

describe('World', () => {
  it('spawns every monster the map lists', () => {
    const world = new World(content, map, { seed: 1 });
    expect(world.monsters.size).toBe(map.spawns.reduce((n, s) => n + s.count, 0));
    for (const m of world.monsters.values()) expect(world.grid.isWalkable(m.tile.x, m.tile.y)).toBe(true);
  });

  it('walks the player to a clicked tile', () => {
    const world = new World(content, map, { seed: 1 });
    const target = { x: map.playerStart.x + 5, y: map.playerStart.y };
    expect(world.moveTo(target)).toBe(true);
    run(world, 5000, () => world.player.intent.kind === 'none');
    expect(world.player.tile).toEqual(target);
  });

  it('refuses to walk into a tree', () => {
    const world = new World(content, map, { seed: 1 });
    expect(world.moveTo({ x: 0, y: 0 })).toBe(false);
  });

  it('runs the kill loop: chase, kill, XP, drops, respawn', () => {
    const world = new World(content, map, { seed: 3 });
    const died: number[] = [];
    world.events.on('monsterDied', (e) => died.push(e.monsterId));
    const startCount = world.monsters.size;

    const target = nearestMonster(world);
    world.attack(target.id);
    run(world, 120_000, () => died.length > 0);

    expect(died).toEqual([target.id]);
    expect(world.session.kills).toBe(1);
    expect(world.player.baseXp + world.player.baseLevel).toBeGreaterThan(1);
    expect(world.monsters.size).toBe(startCount - 1);

    run(world, map.spawns[target.spawnIndex]!.respawnMs + 100);
    expect(world.monsters.size).toBe(startCount);
  });

  it('picks up drops into the inventory', () => {
    const world = new World(content, map, { seed: 5 });
    let kills = 0;
    world.events.on('monsterDied', () => kills++);
    while (world.drops.size === 0 && kills < 20) {
      world.attack(nearestMonster(world).id);
      const before = kills;
      run(world, 120_000, () => kills > before);
    }
    const drop = [...world.drops.values()][0]!;
    world.pickUp(drop.id);
    run(world, 10_000, () => !world.drops.has(drop.id));
    expect(world.player.inventory.get(drop.itemId)).toBeGreaterThan(0);
  });

  it('respawns the player at the save point after dying', () => {
    const world = new World(content, map, { seed: 2 });
    const events: string[] = [];
    world.events.on('playerDied', () => events.push('died'));
    world.events.on('playerRespawned', () => events.push('respawned'));
    world.moveTo({ x: map.playerStart.x + 3, y: map.playerStart.y });
    run(world, 3000);
    world.player.hp = 1;
    const m = nearestMonster(world);
    m.hostile = true;
    run(world, 120_000, () => events.length === 2);
    expect(events).toEqual(['died', 'respawned']);
    expect(world.player.tile).toEqual(world.player.savePoint);
    expect(world.player.dead).toBe(false);
  });
});
