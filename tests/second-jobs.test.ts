import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { tileDistance } from '../src/core/grid';
import { jobLineage, type JobId } from '../src/core/jobs';
import { derivedStats, gainXp, jobChangeBlocker } from '../src/core/progression';
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

/** A character of the given first job at job level 25. */
function veteran(first: JobId): World {
  const w = new World(content, town, { seed: 5 });
  gainXp(w.player, 0, 100_000);
  for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
  w.applyAction({ type: 'changeJob', job: first });
  gainXp(w.player, 0, 50_000_000);
  expect(w.player.jobLevel).toBeGreaterThanOrEqual(25);
  return w;
}

function promoted(first: JobId, second: JobId): World {
  const w = veteran(first);
  w.applyAction({ type: 'changeJob', job: second });
  expect(w.player.jobId).toBe(second);
  w.player.skillPoints = 100;
  w.player.sp = 9999;
  w.player.baseLevel = 60;
  return w;
}

/** Puts the player in the dunes with every monster but one cleared out. */
function duel(w: World, monsterId = 'sandworm') {
  w.changeMap('sunscorch-dunes', { x: 20, y: 3 });
  const m = [...w.monsters.values()].find((x) => x.def.id === monsterId)!;
  for (const other of w.monsters.values()) if (other !== m) w.monsters.delete(other.id);
  m.def = { ...m.def, ai: { ...m.def.ai, aggressive: false, wanderRadius: 0 } };
  m.hp = 1_000_000;
  const spot = [{ x: m.tile.x - 1, y: m.tile.y }, { x: m.tile.x + 1, y: m.tile.y }, { x: m.tile.x, y: m.tile.y - 1 }].find((t) => w.grid.isWalkable(t.x, t.y))!;
  w.changeMap('sunscorch-dunes', spot);
  return m;
}

describe('second job change', () => {
  it('needs job level 25 in the first job, and the trial item', () => {
    const young = new World(content, town, { seed: 1 });
    gainXp(young.player, 0, 100_000);
    for (let i = 0; i < 9; i++) young.learnSkill('basic_training');
    young.applyAction({ type: 'changeJob', job: 'swordsman' });
    const notices: string[] = [];
    young.events.on('notice', (e) => notices.push(e.text));
    young.applyAction({ type: 'changeJob', job: 'knight' });
    expect(young.player.jobId).toBe('swordsman');
    expect(notices.at(-1)).toMatch(/job level 25/);
    young.player.jobLevel = 24;
    expect(jobChangeBlocker(young.player, 'knight')).toMatch(/job level 25/);
    young.player.jobLevel = 25;
    expect(jobChangeBlocker(young.player, 'knight')).toBeNull();

    const sunspire = content.maps.get('sunspire')!;
    for (const [dialogue, first, second, item, count] of [
      ['knight_order', 'swordsman', 'knight', 'scorpion_tail', 10],
      ['wizard_tower', 'mage', 'wizard', 'sand_ruby', 3],
      ['hunter_lodge', 'archer', 'hunter', 'sand_pelt', 10],
      ['priest_temple', 'acolyte', 'priest', 'old_bone', 10],
    ] as const) {
      const w = veteran(first);
      const npc = sunspire.npcs.find((n) => n.dialogue === dialogue)!;
      const def = content.dialogues.get(dialogue)!;
      let d = new DialogueRunner(w, def, npc);
      d.choose(0);
      expect(d.view()!.text).toMatch(/trial/);
      w.addItem(item, count);
      d = new DialogueRunner(w, def, npc);
      d.choose(0);
      d.choose(0);
      expect(w.player.jobId).toBe(second);
      expect(w.player.jobLevel).toBe(1);
      expect(jobLineage(second)).toEqual(['novice', first, second]);
    }
  });

  it('keeps first-job skills and gear', () => {
    const w = veteran('swordsman');
    w.learnSkill('bash');
    w.addItem('short_sword', 1);
    w.applyAction({ type: 'changeJob', job: 'knight' });
    expect(w.skillLevel('bash')).toBe(1);
    expect(w.equip('short_sword')).toBeNull();
    w.player.baseLevel = 40;
    w.addItem('claymore', 1);
    expect(w.equip('claymore')).toBeNull();
  });
});

describe('Knight', () => {
  it('Pierce hits a large monster three times', () => {
    const w = promoted('swordsman', 'knight');
    w.learnSkill('pierce');
    const worm = duel(w);
    expect(worm.def.size).toBe('large');
    let hits = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && hits++);
    w.events.on('miss', (e) => e.sourceId === 'player' && hits++);
    w.useSkill('pierce');
    run(w, 3000, () => hits >= 3);
    expect(hits).toBe(3);
  });

  it('Two-Hand Quicken needs a two-handed sword and speeds up attacks; Riding speeds up walking', () => {
    const w = promoted('swordsman', 'knight');
    w.learnSkill('two_hand_quicken');
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useSkill('two_hand_quicken');
    expect(notices.at(-1)).toMatch(/two-handed/);
    w.addItem('claymore', 1);
    expect(w.equip('claymore')).toBeNull();
    const before = derivedStats(w.player).attackDelayMs;
    w.useSkill('two_hand_quicken');
    expect(derivedStats(w.player).attackDelayMs).toBeLessThan(before);
    w.learnSkill('riding');
    expect(w.player.moveMs).toBe(Math.round(F.PLAYER_MOVE_MS * S.RIDING_MOVE));
  });

  it('Battle Aura burns monsters attacking you every second, and leaves peaceful ones alone', () => {
    const w = promoted('swordsman', 'knight');
    const m = duel(w, 'sandworm');
    w.player.hp = 1e6;
    const hits: number[] = [];
    w.events.on('auraHit', (e) => e.targetId === m.id && hits.push(e.amount));
    // Not learned: nothing.
    m.hostile = true;
    for (let t = 0; t < 3000; t += F.TICK_MS) w.tick();
    expect(hits).toEqual([]);
    for (let i = 0; i < 5; i++) expect(w.learnSkill('battle_aura')).toBeNull();
    // A monster standing next to you but not fighting is spared.
    m.hostile = false;
    for (let t = 0; t < 3000; t += F.TICK_MS) w.tick();
    expect(hits).toEqual([]);
    m.hostile = true;
    for (let t = 0; t < 3000; t += F.TICK_MS) w.tick();
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(4);
    expect(Math.min(...hits)).toBeGreaterThan(0);
  });

  it('Two-Hand Mastery adds ATK and crit with a two-handed sword only', () => {
    const w = promoted('swordsman', 'knight');
    w.addItem('short_sword', 1);
    expect(w.equip('short_sword')).toBeNull();
    const oneHand = derivedStats(w.player);
    for (let i = 0; i < 10; i++) expect(w.learnSkill('two_hand_mastery')).toBeNull();
    expect(derivedStats(w.player).atk).toBe(oneHand.atk);
    w.addItem('claymore', 1);
    expect(w.equip('claymore')).toBeNull();
    const before = { ...derivedStats(w.player) };
    w.player.skills.delete('two_hand_mastery');
    const without = derivedStats(w.player);
    expect(before.atk - without.atk).toBe(10 * S.TWO_HAND_MASTERY_ATK);
    expect(before.crit - without.crit).toBeCloseTo(0.1);
  });
});

describe('Wizard', () => {
  it('Thunderstorm strikes everything near the target', () => {
    const w = promoted('mage', 'wizard');
    for (let i = 0; i < 3; i++) w.learnSkill('lightning_bolt');
    w.learnSkill('thunderstorm');
    w.changeMap('sunscorch-dunes', { x: 20, y: 3 });
    const ms = [...w.monsters.values()].slice(0, 3);
    for (const m of w.monsters.values()) if (!ms.includes(m)) w.monsters.delete(m.id);
    const base = { x: 20, y: 10 };
    ms.forEach((m, i) => {
      m.tile = { x: base.x + i, y: base.y };
      m.path = [];
      m.next = null;
      m.hp = 1_000_000;
      m.def = { ...m.def, moveMs: 1e9, ai: { ...m.def.ai, aggressive: false, wanderRadius: 0 } };
    });
    w.changeMap('sunscorch-dunes', { x: 20, y: 6 });
    const hitIds = new Set<number | string>();
    w.events.on('damage', (e) => e.sourceId === 'player' && hitIds.add(e.targetId));
    w.useSkill('thunderstorm');
    run(w, 5000, () => hitIds.size >= 3);
    expect(hitIds.size).toBe(3);
  });

  it('Sight Rasher burns everything around the caster instantly', () => {
    const w = promoted('mage', 'wizard');
    for (let i = 0; i < 3; i++) w.learnSkill('fire_bolt');
    w.learnSkill('sight_rasher');
    const m = duel(w, 'sand_wolf');
    let hit = false;
    w.events.on('damage', (e) => e.targetId === m.id && (hit = true));
    w.useSkill('sight_rasher');
    expect(hit).toBe(true);
  });
});

describe('Hunter', () => {
  it('Blitz Beat never misses and scales with DEX and INT', () => {
    const w = promoted('archer', 'hunter');
    w.learnSkill('blitz_beat');
    w.learnSkill('blitz_beat');
    const m = duel(w);
    let hits = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && hits++);
    w.useSkill('blitz_beat');
    run(w, 3000, () => hits >= 2);
    expect(hits).toBe(2);
    expect(S.blitzDamage(50, 20, 0)).toBeGreaterThan(S.blitzDamage(10, 20, 0));
    expect(tileDistance(w.player.tile, m.tile)).toBeLessThanOrEqual(1);
  });
});

describe('Priest', () => {
  it('Kyrie Eleison absorbs damage until it breaks', () => {
    const w = promoted('acolyte', 'priest');
    for (let i = 0; i < 3; i++) w.learnSkill('divine_protection');
    w.learnSkill('blessing');
    w.learnSkill('blessing');
    w.learnSkill('kyrie_eleison');
    w.player.sp = 9999;
    w.useSkill('kyrie_eleison');
    const shield = w.player.buffs.get('kyrie_eleison')!.value!;
    expect(shield).toBe(S.kyrieShield(derivedStats(w.player).maxHp, 1));
    const m = duel(w, 'dune_scorpion');
    m.def = { ...m.def, hit: 9999, atk: [shield + 50, shield + 50], inflict: undefined };
    m.hostile = true;
    const hp = w.player.hp;
    run(w, 5000, () => !w.player.buffs.has('kyrie_eleison'));
    expect(w.player.buffs.has('kyrie_eleison')).toBe(false);
    expect(hp - w.player.hp).toBeLessThan(shield + 50);
  });

  it('Magnus Exorcismus only harms undead and shadow monsters', () => {
    const w = promoted('acolyte', 'priest');
    for (let i = 0; i < 5; i++) w.learnSkill('heal');
    w.learnSkill('holy_light');
    w.learnSkill('magnus_exorcismus');
    const worm = duel(w);
    let dealt = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && (dealt += e.amount));
    w.player.sp = 9999;
    w.useSkill('magnus_exorcismus');
    run(w, 7000, () => w.player.intent.kind === 'none' && !w.player.casting);
    expect(dealt).toBe(0);
    expect(worm.def.element).toBe('earth');
    expect(S.SKILLS.magnus_exorcismus.magic!.only).toContain('undead');
  });

  it('Impositio Manus adds ATK', () => {
    const w = promoted('acolyte', 'priest');
    w.learnSkill('impositio_manus');
    const atk = derivedStats(w.player).atk;
    w.useSkill('impositio_manus');
    expect(derivedStats(w.player).atk).toBe(atk + 5);
  });
});

describe('the desert', () => {
  it('Captain Rook sails to Sunspire for 500 gold, and Dax sails back', () => {
    const w = new World(content, content.maps.get('saltmere')!, { seed: 1 });
    w.player.gold = 1200;
    const npc = content.maps.get('saltmere')!.npcs.find((n) => n.dialogue === 'dockmaster')!;
    const d = new DialogueRunner(w, content.dialogues.get('dockmaster')!, npc);
    d.choose(0);
    expect(w.map.id).toBe('sunspire');
    expect(w.player.gold).toBe(700);
    const dax = content.maps.get('sunspire')!.npcs.find((n) => n.dialogue === 'sunspire_sailor')!;
    new DialogueRunner(w, content.dialogues.get('sunspire_sailor')!, dax).choose(0);
    expect(w.map.id).toBe('saltmere');
  });

  it('the Dust Pharaoh is an undead boss in the ruins', () => {
    const boss = content.monsters.get('dust_pharaoh')!;
    expect(boss.boss).toBe(true);
    expect(boss.element).toBe('undead');
    expect(content.maps.get('sunken-ruins')!.spawns.some((s) => s.monster === 'dust_pharaoh')).toBe(true);
  });
});
