import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../src/core/combat/formulas';
import { World } from '../src/core/world';
import { loadContent } from '../src/data/content';

const content = loadContent();

/** Puts the player next to the Clockwork Titan, strong enough to survive. */
function atTheTitan() {
  const w = new World(content, content.maps.get('clockwork-citadel')!, { seed: 3 });
  const titan = [...w.monsters.values()].find((m) => m.def.id === 'clockwork_titan')!;
  w.changeMap('clockwork-citadel', { x: titan.tile.x, y: titan.tile.y + 1 });
  const boss = [...w.monsters.values()].find((m) => m.def.id === 'clockwork_titan')!;
  w.player.baseLevel = 99;
  w.player.hp = 1_000_000;
  return { w, boss };
}

describe('boss phases', () => {
  it('the Clockwork Titan shouts, speeds up and calls in minions as its HP falls', () => {
    const { w, boss } = atTheTitan();
    const shouts: string[] = [];
    w.events.on('bossPhase', (e) => shouts.push(e.shout));
    const before = w.monsters.size;
    // Knock it below 60%: Overdrive, two drones.
    boss.hp = Math.floor(boss.def.hp * 0.59);
    (w as unknown as { checkPhase(m: typeof boss): void }).checkPhase(boss);
    expect(shouts).toEqual(['OVERDRIVE!!']);
    expect(boss.phase).toBe(1);
    expect(w.monsters.size).toBe(before + 2);
    // Straight past 25%: Core Meltdown, plus a knight.
    boss.hp = Math.floor(boss.def.hp * 0.2);
    (w as unknown as { checkPhase(m: typeof boss): void }).checkPhase(boss);
    expect(shouts).toEqual(['OVERDRIVE!!', 'CORE MELTDOWN!!']);
    expect(w.monsters.size).toBe(before + 3);
    const minions = [...w.monsters.values()].filter((m) => m.summoned);
    expect(minions.every((m) => m.hostile)).toBe(true);
  });

  it('enraged bosses attack faster, and summoned minions never respawn', () => {
    const { w, boss } = atTheTitan();
    boss.hp = Math.floor(boss.def.hp * 0.2);
    (w as unknown as { checkPhase(m: typeof boss): void }).checkPhase(boss);
    boss.hostile = true;
    const hits: number[] = [];
    w.events.on('damage', (e) => e.sourceId === boss.id && hits.push(w.time));
    w.events.on('miss', (e) => e.sourceId === boss.id && hits.push(w.time));
    for (let t = 0; t < 20_000; t += TICK_MS) w.tick();
    const gaps = hits.slice(1).map((t, i) => t - hits[i]!);
    // Base delay 1700ms; two phases make it 1700 * 0.75 * 0.85 ≈ 1084ms.
    expect(Math.min(...gaps)).toBeLessThan(1300);

    const count = w.monsters.size;
    for (const m of [...w.monsters.values()].filter((m) => m.summoned)) {
      m.hp = 1;
      (w as unknown as { hurtMonster(m: unknown, n: number, crit: boolean): void }).hurtMonster(m, 10, false);
    }
    for (let t = 0; t < 120_000; t += TICK_MS) w.tick();
    expect([...w.monsters.values()].some((m) => m.summoned)).toBe(false);
    expect(w.monsters.size).toBeLessThanOrEqual(count);
  });
});
