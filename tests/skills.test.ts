import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { gainXp, derivedStats, jobChangeBlocker } from '../src/core/progression';
import { learnBlocker, SKILLS, spRecoveryBonus } from '../src/core/skills';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    world.tick();
    if (until?.()) return;
  }
}

/** A Novice at job level 10 with Basic Training 9, ready for the trial. */
function readyNovice(): World {
  const w = new World(content, town, { seed: 1 });
  gainXp(w.player, 0, 100_000);
  for (let i = 0; i < 9; i++) expect(w.learnSkill('basic_training')).toBeNull();
  return w;
}

function swordsman(): World {
  const w = readyNovice();
  w.addItem('jelly_drop', 10);
  w.applyAction({ type: 'changeJob', job: 'swordsman' });
  expect(w.player.jobId).toBe('swordsman');
  return w;
}

/** Monsters never spawn near the player, so tests walk one over: a free tile `dist` away. */
function bringNear(w: World, m: { tile: { x: number; y: number }; next: unknown; path: unknown[]; goal: unknown }, dist = 3): void {
  const p = w.player.tile;
  for (let dy = -dist; dy <= dist; dy++)
    for (let dx = -dist; dx <= dist; dx++) {
      const t = { x: p.x + dx, y: p.y + dy };
      if (Math.max(Math.abs(dx), Math.abs(dy)) === dist && w.grid.isWalkable(t.x, t.y)) {
        m.tile = t;
        m.next = null;
        m.path = [];
        m.goal = null;
        return;
      }
    }
}

describe('first job', () => {
  it('opens at job level 5 with Basic Training 4, through the guild trial', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.player.jobLevel = 4;
    w.player.skillPoints = 4;
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    expect(jobChangeBlocker(w.player, 'swordsman')).toMatch(/job level 5/);
    w.player.jobLevel = 5;
    expect(jobChangeBlocker(w.player, 'swordsman')).toBeNull();
    // The guild agrees: the trial is offered.
    const harlan = content.maps.get(START_MAP)!.npcs.find((n) => n.id === 'swordsman_captain')!;
    const d = new DialogueRunner(w, content.dialogues.get(harlan.dialogue)!, harlan);
    d.choose(0);
    expect(d.view()!.text).not.toMatch(/Not yet/);
    expect(d.view()!.text).toMatch(/Jelly Drops/);
  });
});

describe('skill points', () => {
  it('a Novice earns enough points for Basic Training 9, and keeps any extra', () => {
    const w = readyNovice();
    expect(w.player.jobLevel).toBeGreaterThanOrEqual(10);
    expect(w.player.skillPoints).toBe(w.player.jobLevel - 10);
    expect(w.skillLevel('basic_training')).toBe(9);
    expect(learnBlocker(w.player, 'basic_training')).toMatch(/mastered/);
  });

  it('Novices cannot learn Swordsman skills, and prerequisites are enforced', () => {
    const w = readyNovice();
    w.player.skillPoints = 5;
    expect(w.learnSkill('bash')).toMatch(/swordsman/);
    const s = swordsman();
    s.player.skillPoints = 10;
    expect(s.learnSkill('magnum_break')).toMatch(/Bash level 5/);
    for (let i = 0; i < 5; i++) s.learnSkill('bash');
    expect(s.learnSkill('magnum_break')).toBeNull();
  });

  it('Basic Training raises max HP', () => {
    const w = new World(content, town, { seed: 1 });
    const before = derivedStats(w.player).maxHp;
    w.player.skillPoints = 1;
    w.learnSkill('basic_training');
    expect(derivedStats(w.player).maxHp).toBeGreaterThan(before);
  });
});

describe('job change', () => {
  it('runs the guild trial: not ready, fee, then oath', () => {
    const fresh = new World(content, town, { seed: 1 });
    const npc = town.npcs.find((n) => n.dialogue === 'swordsman_guild')!;
    const def = content.dialogues.get('swordsman_guild')!;
    let d = new DialogueRunner(fresh, def, npc);
    d.choose(0);
    expect(d.view()!.text).toMatch(/Not yet/);

    const w = readyNovice();
    d = new DialogueRunner(w, def, npc);
    d.choose(0);
    expect(d.view()!.text).toMatch(/10 Jelly Drops/);

    w.addItem('jelly_drop', 12);
    const jobs: string[] = [];
    w.events.on('jobChanged', (e) => jobs.push(e.jobId));
    d = new DialogueRunner(w, def, npc);
    d.choose(0);
    d.choose(0); // I swear it
    expect(jobs).toEqual(['swordsman']);
    expect(w.player.jobId).toBe('swordsman');
    expect(w.player.jobLevel).toBe(1);
    expect(w.player.inventory.get('jelly_drop')).toBe(2);
    expect(d.view()!.text).toMatch(/Welcome to the Guild/);
    expect(derivedStats(w.player).maxHp).toBe(w.player.hp);
  });

  it('a Swordsman has more HP, and job levels have no cap', () => {
    const n = readyNovice();
    const novHp = derivedStats(n.player).maxHp;
    const s = swordsman();
    expect(derivedStats(s.player).maxHp).toBeGreaterThan(novHp);
    gainXp(s.player, 0, 10_000_000);
    expect(s.player.jobLevel).toBeGreaterThan(50);
  });

  it('the guild hides the join option from Swordsmen', () => {
    const s = swordsman();
    const npc = town.npcs.find((n) => n.dialogue === 'swordsman_guild')!;
    const d = new DialogueRunner(s, content.dialogues.get('swordsman_guild')!, npc);
    expect(d.view()!.choices).not.toContain('I want to become a Swordsman');
  });
});

describe('active skills', () => {
  function field(): World {
    const w = swordsman();
    w.player.skillPoints = 30;
    for (let i = 0; i < 10; i++) w.learnSkill('bash');
    for (let i = 0; i < 5; i++) w.learnSkill('magnum_break');
    for (let i = 0; i < 5; i++) w.learnSkill('endure');
    w.changeMap('meadow-1', content.maps.get('meadow-1')!.playerStart);
    w.player.sp = 500;
    bringNear(w, [...w.monsters.values()][0]!);
    return w;
  }

  it('Bash walks to the nearest monster, spends SP and hits hard', () => {
    const w = field();
    const used: string[] = [];
    const hits: number[] = [];
    w.events.on('skillUsed', (e) => used.push(e.skillId));
    w.events.on('damage', (e) => e.sourceId === 'player' && hits.push(e.amount));
    w.events.on('miss', (e) => e.sourceId === 'player' && hits.push(0));
    w.useSkill('bash');
    expect(w.player.intent.kind).toBe('skill');
    run(w, 30_000, () => used.length > 0);
    expect(used).toEqual(['bash']);
    expect(w.player.sp).toBe(500 - SKILLS.bash.spCost(10));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('Magnum Break hits every monster within 2 tiles and goes on cooldown', () => {
    const w = field();
    const ms = [...w.monsters.values()].slice(0, 3);
    ms.forEach((m, i) => Object.assign(m, { tile: { x: w.player.tile.x + (i - 1), y: w.player.tile.y + 1 }, next: null, path: [] }));
    let targets: number[] = [];
    w.events.on('skillUsed', (e) => (targets = e.targets));
    w.useSkill('magnum_break');
    expect(targets.length).toBeGreaterThanOrEqual(3);
    const sp = w.player.sp;
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useSkill('magnum_break');
    expect(w.player.sp).toBe(sp);
    expect(notices[0]).toMatch(/isn't ready/);
    run(w, SKILLS.magnum_break.cooldownMs + 100);
    expect(w.player.cooldowns.has('magnum_break')).toBe(false);
  });

  it('Endure reduces damage taken and wears off', () => {
    const w = field();
    w.useSkill('endure');
    expect(w.player.buffs.get('endure')?.level).toBe(5);
    run(w, 30_000);
    expect(w.player.buffs.has('endure')).toBe(false);
  });

  it('refuses skills without enough SP', () => {
    const w = field();
    w.player.sp = 1;
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useSkill('bash');
    expect(notices).toEqual(['Not enough SP.']);
  });
});

describe('saving jobs and skills', () => {
  it('round-trips job, job level and skills', () => {
    const s = swordsman();
    s.player.skillPoints = 3;
    s.learnSkill('bash');
    s.learnSkill('sword_mastery');
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(s, 0))));
    const w = new World(content, town, { seed: 1 });
    applySaveDoc(w, doc);
    expect(w.player.jobId).toBe('swordsman');
    expect(w.skillLevel('bash')).toBe(1);
    expect(w.skillLevel('sword_mastery')).toBe(1);
    expect(w.skillLevel('basic_training')).toBe(9);
  });
});

describe('Mage', () => {
  function mage(): World {
    const w = readyNovice();
    w.addItem('beetle_shell', 5);
    const npc = town.npcs.find((n) => n.dialogue === 'mage_guild')!;
    const d = new DialogueRunner(w, content.dialogues.get('mage_guild')!, npc);
    d.choose(0);
    d.choose(0); // I vow it
    expect(w.player.jobId).toBe('mage');
    w.player.skillPoints = 30;
    return w;
  }

  it('joins through the Circle trial and gets lots of SP', () => {
    const w = mage();
    expect(w.player.inventory.has('beetle_shell')).toBe(false);
    expect(derivedStats(w.player).maxSp).toBeGreaterThan(derivedStats(readyNovice().player).maxSp * 2 - 2);
    expect(w.learnSkill('bash')).toMatch(/swordsman/);
    expect(w.learnSkill('fire_bolt')).toBeNull();
  });

  it('casts a bolt from range, one damage number per bolt', () => {
    const w = mage();
    for (let i = 0; i < 3; i++) w.learnSkill('cold_bolt');
    w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
    w.player.sp = 500;
    const target = [...w.monsters.values()].find((m) => m.def.id === 'jellop')!;
    w.changeMap('meadow-2', { x: target.tile.x - 5 > 2 ? target.tile.x - 5 : target.tile.x + 5, y: target.tile.y });
    w.attack(target.id);
    w.player.intent = { kind: 'skill', skillId: 'cold_bolt', targetId: target.id };
    const hits: number[] = [];
    w.events.on('damage', (e) => e.sourceId === 'player' && hits.push(e.amount));
    run(w, 20_000, () => hits.length > 0);
    expect(hits.length).toBe(3);
    expect(w.player.next).toBeNull();
  });

  it('DEX shortens casts and damage interrupts them', () => {
    expect(F.castTimeMs(1000, 75)).toBe(500);
    expect(F.castTimeMs(1000, 200)).toBe(0);
    const w = mage();
    for (let i = 0; i < 10; i++) w.learnSkill('fire_bolt');
    w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
    w.player.sp = 500;
    w.player.hp = 9999;
    const beetle = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle')!;
    w.changeMap('meadow-2', beetle.tile);
    const b = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle' && Math.abs(m.tile.x - w.player.tile.x) <= 1 && Math.abs(m.tile.y - w.player.tile.y) <= 1)!;
    b.hostile = true;
    w.player.intent = { kind: 'skill', skillId: 'fire_bolt', targetId: b.id };
    let interrupted = false;
    w.events.on('castInterrupted', () => (interrupted = true));
    run(w, 15_000, () => interrupted);
    expect(interrupted).toBe(true);
    expect(w.player.casting).toBeNull();
  });

  it('chip damage below a tenth of max HP does not break a cast', () => {
    const w = mage();
    for (let i = 0; i < 10; i++) w.learnSkill('fire_bolt');
    w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
    w.player.sp = 500;
    const beetle = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle')!;
    w.changeMap('meadow-2', beetle.tile);
    const b = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle' && Math.abs(m.tile.x - w.player.tile.x) <= 1 && Math.abs(m.tile.y - w.player.tile.y) <= 1)!;
    for (const m of w.monsters.values()) if (m !== b) w.monsters.delete(m.id);
    b.def = { ...b.def, atk: [1, 1], hit: 999 };
    b.hostile = true;
    w.player.intent = { kind: 'skill', skillId: 'fire_bolt', targetId: b.id };
    let interrupted = false;
    let hitMe = 0;
    w.events.on('castInterrupted', () => (interrupted = true));
    w.events.on('damage', (e) => e.targetId === 'player' && hitMe++);
    let cast = false;
    w.events.on('skillUsed', () => (cast = true));
    run(w, 15_000, () => cast);
    expect(hitMe).toBeGreaterThan(0);
    expect(interrupted).toBe(false);
    expect(cast).toBe(true);
  });
});

describe('staff basic attack', () => {
  it('is a free magic shot from range, weaker than a bolt hit', () => {
    const w = new World(content, content.maps.get('meadow-2')!, { seed: 3 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'mage' });
    w.addItem('oak_staff', 1);
    expect(w.equip('oak_staff')).toBeNull();
    w.player.stats.int = 40;
    w.refreshStats();
    expect(w.attackRange()).toBe(5);
    const m = [...w.monsters.values()][0]!;
    m.hp = 1e6;
    const spot = [{ x: m.tile.x - 4, y: m.tile.y }, { x: m.tile.x + 4, y: m.tile.y }, { x: m.tile.x, y: m.tile.y - 4 }, { x: m.tile.x, y: m.tile.y + 4 }].find((t) => w.grid.isWalkable(t.x, t.y))!;
    w.changeMap('meadow-2', spot);
    const target = [...w.monsters.values()].find((x) => x.tile.x === m.tile.x && x.tile.y === m.tile.y) ?? [...w.monsters.values()][0]!;
    target.hp = 1e6;
    target.def = { ...target.def, ai: { ...target.def.ai, aggressive: false, wanderRadius: 0 }, flee: 999 };
    const sp = w.player.sp;
    const hits: number[] = [];
    let misses = 0;
    w.events.on('damage', (e) => e.targetId === target.id && hits.push(e.amount));
    w.events.on('miss', (e) => e.sourceId === 'player' && misses++);
    const start = { ...w.player.tile };
    w.attack(target.id);
    for (let t = 0; t < 6000; t += F.TICK_MS) w.tick();
    // It fired from where it stood, never missed (even against huge FLEE), and cost no SP.
    expect(w.player.tile).toEqual(start);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(misses).toBe(0);
    expect(w.player.sp).toBeGreaterThanOrEqual(sp);
    const matk = derivedStats(w.player).matk;
    expect(Math.max(...hits)).toBeLessThan(matk * 1.1);
    expect(Math.min(...hits)).toBeGreaterThan(0);
  });
});

describe('Increase SP Recovery', () => {
  it('adds more SP per tick with level and with max SP, and boosts SP potions', () => {
    expect(spRecoveryBonus(0, 500)).toBe(0);
    expect(spRecoveryBonus(5, 176)).toBe(38);
    // Grows with max SP: the same level gives more to a bigger pool.
    expect(spRecoveryBonus(10, 1800)).toBeGreaterThan(spRecoveryBonus(10, 500) + 50);
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.player.jobId = 'mage';
    w.player.skills.set('sp_recovery', 10);
    w.player.sp = 0;
    w.addItem('blue_tonic', 1);
    const sp = content.items.get('blue_tonic')!.heal!.sp;
    w.useItem('blue_tonic');
    expect(w.player.sp).toBe(Math.min(Math.floor(sp * 2), derivedStats(w.player).maxSp));
  });
});
