import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { gainXp, derivedStats } from '../src/core/progression';
import { questState, MAX_ACTIVE_QUESTS } from '../src/core/quests';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

function run(w: World, ms: number, until?: () => boolean) {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    w.tick();
    if (until?.()) return;
  }
}

describe('hunting quests', () => {
  it('accept, hunt, turn in for gold, XP and items', () => {
    const w = new World(content, town, { seed: 1 });
    const q = content.quests.get('jellop_cleanup')!;
    expect(w.acceptQuest(q.id)).toBeNull();
    expect(w.acceptQuest(q.id)).toMatch(/already/);
    w.changeMap('meadow-1', content.maps.get('meadow-1')!.playerStart);
    w.player.hp = 1e6;
    const ready: string[] = [];
    w.events.on('questReady', (e) => ready.push(e.questId));
    while (ready.length === 0) {
      const target = [...w.monsters.values()][0]!;
      target.hp = 1;
      w.attack(target.id);
      run(w, 30_000, () => !w.monsters.has(target.id));
    }
    expect(questState(w.player, q)).toBe('ready');
    expect(w.player.quests.active.get(q.id)).toBe(q.target.count);
    const gold = w.player.gold;
    const xpBefore = w.session.baseXp;
    expect(w.turnInQuest(q.id)).toBeNull();
    expect(w.player.gold).toBe(gold + q.reward.gold);
    expect(w.session.baseXp - xpBefore).toBe(q.reward.baseXp);
    expect(w.player.quests.done.get(q.id)).toBe(1);
    expect(questState(w.player, q)).toBe('available'); // repeatable
  });

  it('enforces level and the active-hunt limit', () => {
    const w = new World(content, town, { seed: 1 });
    expect(w.acceptQuest('golem_slayer')).toMatch(/level 25/);
    gainXp(w.player, 10_000_000, 0);
    const ids = [...content.quests.keys()];
    for (const id of ids.slice(0, MAX_ACTIVE_QUESTS)) expect(w.acceptQuest(id)).toBeNull();
    expect(w.acceptQuest(ids[MAX_ACTIVE_QUESTS]!)).toMatch(/only take/);
    w.abandonQuest(ids[0]!);
    expect(w.acceptQuest(ids[MAX_ACTIVE_QUESTS]!)).toBeNull();
    expect(w.turnInQuest(ids[1]!)).toMatch(/isn't finished/);
  });

  it('the board opens the quest window and progress is saved', () => {
    const w = new World(content, town, { seed: 1 });
    const board = town.npcs.find((n) => n.dialogue === 'hunting_board')!;
    const d = new DialogueRunner(w, content.dialogues.get('hunting_board')!, board);
    d.choose(0);
    expect(d.openQuests).toBe(true);
    w.acceptQuest('jellop_cleanup');
    w.player.quests.active.set('jellop_cleanup', 7);
    w.player.quests.done.set('beetle_bother', 2);
    const back = new World(content, town, { seed: 2 });
    applySaveDoc(back, migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0)))));
    expect(back.player.quests.active.get('jellop_cleanup')).toBe(7);
    expect(back.player.quests.done.get('beetle_bother')).toBe(2);
  });
});

describe('status effects', () => {
  it('poison drains HP down to 1, blocks regen, and Green Herb cures it', () => {
    const w = new World(content, town, { seed: 1 });
    w.inflict('poison', 1, 120_000);
    expect(w.player.statuses.has('poison')).toBe(true);
    run(w, 70_000); // 2% of 50 HP per second, never below 1
    expect(w.player.hp).toBe(1);
    w.addItem('green_herb', 1);
    w.useItem('green_herb');
    expect(w.player.statuses.has('poison')).toBe(false);
  });

  it('stun stops every action until it wears off', () => {
    const w = new World(content, town, { seed: 1 });
    w.inflict('stun', 1, 2000);
    expect(w.moveTo({ x: w.player.tile.x + 2, y: w.player.tile.y })).toBe(false);
    run(w, 2500);
    expect(w.player.statuses.has('stun')).toBe(false);
    expect(w.moveTo({ x: w.player.tile.x + 2, y: w.player.tile.y })).toBe(true);
  });

  it('blind cuts HIT and FLEE by a quarter; VIT resists poison', () => {
    const w = new World(content, town, { seed: 1 });
    const before = derivedStats(w.player);
    w.inflict('blind', 1, 5000);
    const after = derivedStats(w.player);
    expect(after.hit).toBe(Math.floor(before.hit * 0.75));
    expect(after.flee).toBe(Math.floor(before.flee * 0.75));
    w.player.stats.vit = 100;
    w.inflict('poison', 1, 5000);
    expect(w.player.statuses.has('poison')).toBe(false);
  });

  it('Puffcaps can poison, resting at the waystone cures everything', () => {
    const w = new World(content, content.maps.get('whisperwood')!, { seed: 5 });
    w.player.hp = 1e6;
    const puff = [...w.monsters.values()].find((m) => m.def.id === 'puffcap')!;
    w.changeMap('whisperwood', puff.tile);
    const p = [...w.monsters.values()].find((m) => m.def.id === 'puffcap')!;
    p.hostile = true;
    p.hp = 1e9;
    // Keep the player topped up: we only care whether a hit poisons them.
    for (let t = 0; t < 120_000 && !w.player.statuses.has('poison'); t += F.TICK_MS) {
      w.player.hp = derivedStats(w.player).maxHp;
      w.tick();
    }
    expect(w.player.statuses.has('poison')).toBe(true);
    w.applyAction({ type: 'heal' });
    expect(w.player.statuses.size).toBe(0);
  });
});
