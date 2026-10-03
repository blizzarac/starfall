import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { nextGoal } from '../src/core/goals';
import { gainXp } from '../src/core/progression';
import { FRAGMENTS, SPLINTER, STORY } from '../src/core/story';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();

function run(w: World, ms: number, until?: () => boolean) {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    w.tick();
    if (until?.()) return;
  }
}

/** Opens an NPC's conversation on the current map (it must be there right now). */
function talk(w: World, npcId: string): DialogueRunner {
  const npc = w.npcs.find((n) => n.id === npcId);
  if (!npc) throw new Error(`${npcId} isn't on ${w.map.id} right now`);
  return new DialogueRunner(w, content.dialogues.get(npc.dialogue)!, npc);
}

/** Picks the visible choice with this label. */
function pick(d: DialogueRunner, label: string) {
  const i = d.view()!.choices.indexOf(label);
  if (i < 0) throw new Error(`no "${label}" in ${JSON.stringify(d.view()!.choices)}`);
  d.choose(i);
}

/** Kills the first monster (or the boss) on the current map, then picks up what it dropped. */
function defeat(w: World, boss = false) {
  const m = [...w.monsters.values()].find((x) => !boss || x.def.boss)!;
  w.player.hp = 1e9;
  m.hp = 1;
  const spot = [{ x: m.tile.x - 1, y: m.tile.y }, { x: m.tile.x + 1, y: m.tile.y }, { x: m.tile.x, y: m.tile.y + 1 }, { x: m.tile.x, y: m.tile.y - 1 }].find((t) => w.grid.isWalkable(t.x, t.y))!;
  w.changeMap(w.map.id, spot);
  w.attack(m.id);
  run(w, 20_000, () => !w.monsters.has(m.id));
  expect(w.monsters.has(m.id)).toBe(false);
  for (const d of [...w.drops.values()]) {
    w.pickUp(d.id);
    run(w, 5000, () => !w.drops.has(d.id));
  }
}

function hero(): World {
  const w = new World(content, content.maps.get(START_MAP)!, { seed: 7 });
  gainXp(w.player, 50_000_000, 0);
  w.player.jobId = 'knight';
  w.player.gold = 1e6;
  return w;
}

type Choices = { splinter: 'Leave it with Nim' | 'Keep it' | 'bury'; crown: 'Take the crown' | 'Leave it'; pell: 'Draw your weapon' | 'Follow him' | 'Walk past' };

/** Plays the whole story with these choices, up to the Heart. */
function playTo(w: World, c: Choices) {
  // Act I: the splinter drops from the first monster you defeat.
  w.changeMap('meadow-1', content.maps.get('meadow-1')!.playerStart);
  defeat(w);
  expect(w.hasItem(SPLINTER, 1)).toBe(true);
  expect(w.flags.has(STORY.splinter)).toBe(true);
  expect(nextGoal(w)).toMatch(/Pell/);

  w.changeMap('town', { x: 17, y: 20 });
  const pell = talk(w, 'guide');
  expect(pell.view()!.text).toMatch(/Put that away/);
  pick(pell, 'Put it away');
  expect(w.flags.has(STORY.pell)).toBe(true);

  if (c.splinter === 'bury') {
    w.changeMap('whisperwood', { x: 15, y: 8 });
    const ring = talk(w, 'ring_of_trees');
    pick(ring, 'Bury the splinter');
    expect(w.hasItem(SPLINTER, 1)).toBe(false);
  } else {
    w.changeMap('town', { x: 8, y: 21 });
    const nim = talk(w, 'tinker_nim');
    pick(nim, c.splinter);
  }

  w.changeMap('caves-2', content.maps.get('caves-2')!.playerStart);
  defeat(w, true);
  expect(w.flags.has(STORY.frag1)).toBe(true);
  expect(w.hasItem(FRAGMENTS.crystal_golem!.item, 1)).toBe(true);

  // Pell is gone; his desk holds the map.
  w.changeMap('town', { x: 16, y: 21 });
  expect(w.npcs.some((n) => n.id === 'guide')).toBe(false);
  pick(talk(w, 'pell_desk'), 'Take the map');
  expect(w.hasItem('pell_map', 1)).toBe(true);

  // Act II.
  w.changeMap('saltmere', { x: 22, y: 11 });
  pick(talk(w, 'dockmaster'), 'Ask about his cargo');
  expect(talk(w, 'dockmaster').view()!.choices).toContain('Ask about his cargo');
  w.changeMap('sunspire', { x: 16, y: 6 });
  expect(w.flags.has(STORY.fountain)).toBe(true);
  w.changeMap('sunken-ruins', { x: 18, y: 4 });
  expect(talk(w, 'archivist').view()!.text).toMatch(/We gave it a name/);
  expect(w.npcs.some((n) => n.id === 'throne')).toBe(false);
  defeat(w, true);
  expect(w.flags.has(STORY.frag2)).toBe(true);
  pick(talk(w, 'throne'), c.crown);
  expect(w.npcs.some((n) => n.id === 'throne')).toBe(false);

  // Act III: the heap grows with every visit; Pell waits on the Citadel road.
  w.changeMap('iron-wastes', { x: 17, y: 4 });
  w.changeMap('sunspire', { x: 16, y: 6 });
  w.changeMap('iron-wastes', { x: 17, y: 4 });
  expect(talk(w, 'scrap_heap').view()!.text).toMatch(/shoulders/);
  const p = talk(w, 'pell_wastes');
  pick(p, 'Why are you here?');
  pick(p, c.pell);
  expect(w.npcs.some((n) => n.id === 'pell_wastes')).toBe(false);

  w.changeMap('clockwork-citadel', content.maps.get('clockwork-citadel')!.playerStart);
  defeat(w, true);
  expect(w.flags.has(STORY.frag3)).toBe(true);
  expect(nextGoal(w)).toMatch(/Three fragments/);
}

describe('the main story', () => {
  it('plays through to Silence: every choice open-handed, the fewest endings offered', () => {
    const w = hero();
    playTo(w, { splinter: 'Leave it with Nim', crown: 'Leave it', pell: 'Walk past' });
    const heart = talk(w, 'the_heart');
    expect(heart.view()!.choices).toEqual(['Shatter them', 'Not yet']);
    pick(heart, 'Shatter them');
    expect(w.flags.get(STORY.ending)).toBe('silence');
    expect(w.hasItem('quiet_stone', 1) || w.player.gear.some((g) => g.item.id === 'quiet_stone')).toBe(true);
    expect(w.hasItem('starglass_1', 1)).toBe(false);
    // Pell comes home.
    w.changeMap('town', { x: 17, y: 20 });
    expect(talk(w, 'pell_returned').view()!.text).toMatch(/quiet/);
    expect(w.npcs.some((n) => n.id === 'the_heart')).toBe(false);
  });

  it('keeping the splinter and taking the crown open Bind and Return', () => {
    const w = hero();
    playTo(w, { splinter: 'Keep it', crown: 'Take the crown', pell: 'Draw your weapon' });
    const heart = talk(w, 'the_heart');
    expect(heart.view()!.choices).toEqual(['Shatter them', 'Bind them to your guild', 'Set the splinter in the gap', 'Not yet']);
    pick(heart, 'Set the splinter in the gap');
    expect(w.flags.get(STORY.ending)).toBe('return');
    expect(w.hasItem(SPLINTER, 1)).toBe(false);
    // Pell left with it.
    w.changeMap('town', { x: 17, y: 20 });
    expect(w.npcs.some((n) => n.id === 'pell_returned' || n.id === 'guide')).toBe(false);
    expect(talk(w, 'pell_desk').view()!.text).toMatch(/Nobody seems to remember/);
  });

  it('the hidden ending: keep the splinter, leave the crown, follow Pell', () => {
    const w = hero();
    playTo(w, { splinter: 'Keep it', crown: 'Leave it', pell: 'Follow him' });
    expect(w.npcs.some((n) => n.id === 'pell_citadel')).toBe(true);
    const heart = talk(w, 'the_heart');
    expect(heart.view()!.choices).toContain('Stand in the gap');
    pick(heart, 'Stand in the gap');
    expect(w.flags.get(STORY.ending)).toBe('gap');
  });

  it('a buried splinter closes the splinter endings', () => {
    const w = hero();
    playTo(w, { splinter: 'bury', crown: 'Take the crown', pell: 'Follow him' });
    expect(talk(w, 'the_heart').view()!.choices).toEqual(['Shatter them', 'Bind them to your guild', 'Not yet']);
  });

  it('the heart speaks to your guild', () => {
    const w = hero();
    w.player.jobId = 'knight';
    w.flags.set(STORY.frag3, true);
    w.changeMap('clockwork-citadel', content.maps.get('clockwork-citadel')!.playerStart);
    expect(talk(w, 'the_heart').view()!.text).toMatch(/oathstone/i);
  });

  it('story items stay with you, and progress is saved', () => {
    const w = hero();
    w.addItem(SPLINTER, 1);
    w.setStoryFlag(STORY.splinter);
    expect(w.sell(SPLINTER, 1)).toMatch(/can’t part/);
    expect(w.store(SPLINTER, 1)).toMatch(/keep that/);
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    const loaded = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    applySaveDoc(loaded, doc);
    expect(loaded.flags.has(STORY.splinter)).toBe(true);
    expect(loaded.hasItem(SPLINTER, 1)).toBe(true);
  });

  it('each guild hands over its keepsake once, including for characters who changed job before', () => {
    const w = hero();
    w.player.jobId = 'knight';
    w.giveJobRelic();
    w.giveJobRelic();
    expect(w.itemCount('oathstone')).toBe(1);
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    const loaded = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    applySaveDoc(loaded, doc);
    expect(loaded.itemCount('oathstone')).toBe(1);
  });
});
