import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { tileDistance } from '../src/core/grid';
import { derivedStats, effectiveStats, gainXp } from '../src/core/progression';
import * as S from '../src/core/skills';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    world.tick();
    if (until?.()) return;
  }
}

function become(job: 'archer' | 'acolyte'): World {
  const w = new World(content, town, { seed: 3 });
  gainXp(w.player, 0, 100_000);
  for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
  w.applyAction({ type: 'changeJob', job });
  expect(w.player.jobId).toBe(job);
  w.player.skillPoints = 40;
  return w;
}

/** An archer with a bow, standing in the meadow; returns the nearest Jellop. */
function archerInMeadow() {
  const w = become('archer');
  w.addItem('willow_bow', 1);
  expect(w.equip('willow_bow')).toBeNull();
  w.changeMap('meadow-1', { x: 20, y: 22 });
  const m = [...w.monsters.values()].sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
  m.hp = 100_000;
  return { w, m };
}

describe('guild trials', () => {
  it.each([
    ['archer_guild', 'moss_clump', 6, 'archer'],
    ['acolyte_chapel', 'sweet_apple', 4, 'acolyte'],
  ] as const)('%s takes %i %s and changes job', (dialogue, item, count, job) => {
    const w = new World(content, town, { seed: 1 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
    const npc = town.npcs.find((n) => n.dialogue === dialogue)!;
    const def = content.dialogues.get(dialogue)!;
    let d = new DialogueRunner(w, def, npc);
    d.choose(0);
    expect(d.view()!.text).toMatch(new RegExp(`${count}`));
    w.addItem(item, count);
    d = new DialogueRunner(w, def, npc);
    d.choose(0);
    d.choose(0);
    expect(w.player.jobId).toBe(job);
    expect(w.itemCount(item)).toBe(0);
  });
});

describe('Archer', () => {
  it('only archers can hold bows, and a bow reaches 5 tiles (more with Vulture\'s Eye)', () => {
    const novice = new World(content, town, { seed: 1 });
    novice.addItem('willow_bow', 1);
    expect(novice.equip('willow_bow')).toMatch(/Only for Archer/);
    const { w } = archerInMeadow();
    expect(w.attackRange()).toBe(S.BOW_RANGE);
    for (let i = 0; i < 3; i++) w.learnSkill('owls_eye');
    for (let i = 0; i < 4; i++) w.learnSkill('vultures_eye');
    expect(w.attackRange()).toBe(S.BOW_RANGE + 2);
  });

  it('shoots from range without walking up to the monster', () => {
    const { w, m } = archerInMeadow();
    let hits = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && hits++);
    w.events.on('miss', (e) => e.sourceId === 'player' && hits++);
    m.def = { ...m.def, ai: { ...m.def.ai, wanderRadius: 0 }, moveMs: 1e9 };
    w.attack(m.id);
    run(w, 5000, () => hits > 0);
    expect(hits).toBeGreaterThan(0);
    expect(tileDistance(w.player.tile, m.tile)).toBeGreaterThan(1);
  });

  it("Owl's Eye adds DEX and Double Strafe fires two arrows", () => {
    const { w, m } = archerInMeadow();
    const dex = effectiveStats(w.player).dex;
    w.learnSkill('owls_eye');
    expect(effectiveStats(w.player).dex).toBe(dex + 1);
    w.learnSkill('double_strafe');
    let hits = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && hits++);
    w.events.on('miss', (e) => e.sourceId === 'player' && hits++);
    w.useSkill('double_strafe');
    run(w, 5000, () => hits >= 2);
    expect(hits).toBe(2);
    expect(m.hostile).toBe(true);
  });

  it('bow skills need a bow', () => {
    const w = become('archer');
    // The guild's starter bow is equipped on joining; take it off.
    expect(w.player.equipment.weapon?.item.id).toBe('willow_bow');
    w.unequip('weapon');
    w.learnSkill('double_strafe');
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useSkill('double_strafe');
    expect(notices.at(-1)).toMatch(/needs a bow/);
  });

  it('Improve Concentration raises AGI and DEX until it wears off', () => {
    const w = become('archer');
    for (let i = 0; i < 3; i++) w.learnSkill('owls_eye');
    w.learnSkill('vultures_eye');
    w.learnSkill('improve_concentration');
    const before = effectiveStats(w.player);
    w.player.sp = 999;
    w.useSkill('improve_concentration');
    expect(effectiveStats(w.player).agi).toBe(before.agi + 2);
    expect(effectiveStats(w.player).dex).toBe(before.dex + 2);
    run(w, 81_000);
    expect(effectiveStats(w.player).agi).toBe(before.agi);
  });
});

describe('Acolyte', () => {
  it('Heal restores HP by base level and INT', () => {
    const w = become('acolyte');
    w.learnSkill('heal');
    w.player.hp = 1;
    w.useSkill('heal');
    const expected = S.healAmount(w.player.baseLevel, effectiveStats(w.player).int, 1);
    expect(w.player.hp).toBe(1 + expected);
  });

  it('Increase AGI speeds up walking and Blessing raises STR, INT and DEX', () => {
    const w = become('acolyte');
    for (let i = 0; i < 3; i++) w.learnSkill('heal');
    w.learnSkill('increase_agi');
    for (let i = 0; i < 3; i++) w.learnSkill('divine_protection');
    w.learnSkill('blessing');
    const before = effectiveStats(w.player);
    w.player.sp = 999;
    w.useSkill('increase_agi');
    w.player.sp = 999;
    w.useSkill('blessing');
    const after = effectiveStats(w.player);
    expect(after.agi).toBe(before.agi + 3);
    expect([after.str, after.int, after.dex]).toEqual([before.str + 1, before.int + 1, before.dex + 1]);
    expect(w.player.moveMs).toBeLessThan(F.PLAYER_MOVE_MS);
  });

  it('Holy Light is a holy spell that hurts shadow monsters more', () => {
    const w = become('acolyte');
    w.learnSkill('heal');
    w.learnSkill('holy_light');
    expect(S.SKILLS.holy_light.magic!.element).toBe('holy');
    expect(F.elementModifier('holy', 'shadow')).toBeGreaterThan(1);
    w.changeMap('caves-1', { x: 19, y: 2 });
    const bat = [...w.monsters.values()].find((m) => m.def.element === 'shadow')!;
    for (const m of w.monsters.values()) if (m !== bat) w.monsters.delete(m.id);
    bat.def = { ...bat.def, ai: { ...bat.def.ai, aggressive: false } };
    w.player.sp = 999;
    let dealt = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && (dealt += e.amount));
    w.useSkill('holy_light');
    run(w, 4000, () => dealt > 0);
    expect(dealt).toBeGreaterThan(0);
  });

  it('Divine Protection reduces damage from shadow monsters', () => {
    const w = become('acolyte');
    for (let i = 0; i < 5; i++) w.learnSkill('divine_protection');
    expect(S.divineProtectionReduction(5)).toBeCloseTo(0.2);
    expect(derivedStats(w.player).maxSp).toBeGreaterThan(0);
  });
});
