import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../src/core/combat/formulas';
import { bossFlag, World } from '../src/core/world';
import { loadContent } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const hall = content.maps.get('caves-2')!;

function bossWorld() {
  let clock = 1_000_000;
  const w = new World(content, hall, { seed: 3, now: () => clock });
  return { w, advanceClock: (ms: number) => (clock += ms), now: () => clock };
}

const golem = (w: World) => [...w.monsters.values()].find((m) => m.def.boss);

function run(w: World, ms: number, until?: () => boolean) {
  for (let t = 0; t < ms; t += TICK_MS) {
    w.tick();
    if (until?.()) return;
  }
}

describe('Crystal Golem', () => {
  it('spawns in its hall and is announced', () => {
    const { w } = bossWorld();
    expect(golem(w)?.def.name).toBe('Crystal Golem');
    expect(w.bossRespawnAt()).toBeNull();
  });

  it('telegraphs its slam before it lands', () => {
    const { w } = bossWorld();
    const g = golem(w)!;
    w.changeMap(hall.id, { x: g.tile.x + 1, y: g.tile.y });
    w.player.hp = 1e9;
    const order: string[] = [];
    w.events.on('telegraph', () => order.push('telegraph'));
    w.events.on('slam', () => order.push('slam'));
    run(w, 20_000, () => order.length >= 2);
    expect(order.slice(0, 2)).toEqual(['telegraph', 'slam']);
  });

  it('stays dead for its respawn time, across map changes and saves', () => {
    const { w, advanceClock } = bossWorld();
    const events: string[] = [];
    w.events.on('boss', (e) => events.push(e.kind));
    const g = golem(w)!;
    g.hp = 1;
    w.changeMap(hall.id, { x: g.tile.x + 1, y: g.tile.y });
    w.attack(g.id);
    run(w, 30_000, () => !golem(w));
    expect(events).toContain('defeated');
    expect(w.flags.get(bossFlag('crystal_golem'))).toBeGreaterThan(w.now());
    // Guaranteed drops land on the ground.
    expect([...w.drops.values()].map((d) => d.itemId)).toEqual(expect.arrayContaining(['golem_core', 'brightstone', 'glimmer_shard']));

    // Leave and come back: still gone.
    w.changeMap('caves-1', { x: 19, y: 37 });
    w.changeMap(hall.id, hall.playerStart);
    expect(golem(w)).toBeUndefined();

    // Save and load into a fresh world: still gone.
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    let clock2 = w.now();
    const loaded = new World(content, hall, { seed: 4, now: () => clock2 });
    applySaveDoc(loaded, doc);
    expect(golem(loaded)).toBeUndefined();

    // Twenty minutes later it returns, in both worlds.
    advanceClock(hall.spawns[0]!.respawnMs + 1000);
    clock2 += hall.spawns[0]!.respawnMs + 1000;
    run(w, 100);
    run(loaded, 100);
    expect(golem(w)).toBeDefined();
    expect(golem(loaded)).toBeDefined();
  });
});
