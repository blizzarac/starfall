import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc } from '../src/save/serialize';
import { SAVE_SCHEMA_VERSION } from '../src/save/schema';
import saveV1 from './fixtures/save-v1.json';

const content = loadContent();
const town = content.maps.get(START_MAP)!;
const meadow = content.maps.get('meadow-1')!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    world.tick();
    if (until?.()) return;
  }
}

describe('maps and portals', () => {
  it('walks from town through the south portal into the meadow and back', () => {
    const w = new World(content, town, { seed: 1 });
    const changes: string[] = [];
    w.events.on('mapChanged', (e) => changes.push(e.mapId));
    const exit = town.portals.find((p) => p.to.map === 'meadow-1')!;
    expect(w.moveTo({ x: exit.area.x, y: exit.area.y })).toBe(true);
    run(w, 20_000, () => changes.length > 0);
    expect(w.map.id).toBe('meadow-1');
    expect(w.player.tile).toEqual({ x: exit.to.x, y: exit.to.y });
    expect(w.monsters.size).toBeGreaterThan(0);

    const back = meadow.portals.find((p) => p.to.map === START_MAP)!;
    w.moveTo({ x: back.area.x + 1, y: back.area.y });
    run(w, 20_000, () => changes.length > 1);
    expect(w.map.id).toBe(START_MAP);
    expect(w.monsters.size).toBe(0);
  });

  it('respawns in town after fainting in the field', () => {
    const w = new World(content, town, { seed: 2 });
    w.changeMap('meadow-1', meadow.playerStart);
    w.player.hp = 1;
    for (const m of w.monsters.values()) m.hostile = true;
    run(w, 120_000, () => w.map.id === START_MAP && !w.player.dead);
    expect(w.map.id).toBe(START_MAP);
    expect(w.player.tile).toEqual({ x: town.savePoint.x, y: town.savePoint.y });
  });
});

describe('NPCs and dialogue', () => {
  it('walks up to an NPC and opens its dialogue', () => {
    const w = new World(content, town, { seed: 1 });
    const npc = town.npcs.find((n) => n.id === 'tool_dealer')!;
    let talked: string | null = null;
    w.events.on('talk', (e) => (talked = e.npc.id));
    w.talkTo(npc.id);
    run(w, 20_000, () => talked !== null);
    expect(talked).toBe(npc.id);
    expect(Math.max(Math.abs(w.player.tile.x - npc.x), Math.abs(w.player.tile.y - npc.y))).toBeLessThanOrEqual(F.TALK_RANGE);
  });

  it('NPCs block their own tile', () => {
    const w = new World(content, town, { seed: 1 });
    const npc = town.npcs[0]!;
    expect(w.grid.isWalkable(npc.x, npc.y)).toBe(false);
  });

  it('runs choices, actions and shop hand-off', () => {
    const w = new World(content, town, { seed: 1 });
    const keeper = town.npcs.find((n) => n.dialogue === 'waystone')!;
    w.player.hp = 3;
    const d = new DialogueRunner(w, content.dialogues.get('waystone')!, keeper);
    expect(d.view()!.text).toContain(w.player.name);
    d.choose(1); // rest
    expect(w.player.hp).toBeGreaterThan(3);
    expect(d.view()!.choices).toEqual([]);
    d.choose(0);
    expect(d.done).toBe(true);

    const dealer = town.npcs.find((n) => n.dialogue === 'tool_dealer')!;
    const shop = new DialogueRunner(w, content.dialogues.get('tool_dealer')!, dealer);
    shop.choose(0);
    expect(shop.openShop).toBe('tool_dealer');
    expect(shop.done).toBe(true);
  });

  it('sets the save point where the player stands', () => {
    const w = new World(content, town, { seed: 1 });
    w.changeMap(START_MAP, { x: 14, y: 12 });
    w.applyAction({ type: 'setSavePoint' });
    expect(w.player.savePoint).toEqual({ map: START_MAP, x: 14, y: 12 });
  });
});

describe('shops, gold and weight', () => {
  it('buys within budget and sells at half price', () => {
    const w = new World(content, town, { seed: 1 });
    w.player.gold = 120;
    expect(w.buy('tool_dealer', 'red_tonic', 3)).toMatch(/afford/);
    expect(w.buy('tool_dealer', 'red_tonic', 2)).toBeNull();
    expect(w.player.gold).toBe(20);
    expect(w.player.inventory.get('red_tonic')).toBe(2);
    expect(w.buy('tool_dealer', 'jelly_drop', 1)).toMatch(/not for sale/);
    expect(w.sell('red_tonic', 1)).toBeNull();
    expect(w.player.gold).toBe(45);
    expect(w.sell('red_tonic', 5)).toMatch(/don't have/);
  });

  it('refuses purchases that exceed max weight', () => {
    const w = new World(content, town, { seed: 1 });
    w.player.gold = 1_000_000;
    const max = w.maxWeight();
    const tonic = content.items.get('red_tonic')!;
    const fits = Math.floor((max - w.weight()) / tonic.weight); // worn gear counts too
    expect(w.buy('tool_dealer', 'red_tonic', fits + 1)).toMatch(/carry/);
    expect(w.buy('tool_dealer', 'red_tonic', fits)).toBeNull();
    expect(w.weight()).toBeLessThanOrEqual(max);
  });

  it('halves natural regen from half weight, and stops it and attacking at 90%', () => {
    const healed = (fill: number) => {
      const w = new World(content, meadow, { seed: 1 });
      for (const m of [...w.monsters.values()]) w.monsters.delete(m.id);
      // Big enough recovery that halving it shows.
      w.player.baseLevel = 40;
      w.player.stats.vit = 40;
      w.refreshStats();
      const drop = content.items.get('jelly_drop')!;
      if (fill > 0) w.addItem('jelly_drop', Math.ceil((w.maxWeight() * fill) / drop.weight));
      w.player.hp = 5;
      run(w, 20_000);
      return { gained: w.player.hp - 5, w };
    };
    const light = healed(0).gained;
    const half = healed(F.WEIGHT_NO_REGEN);
    expect(half.gained).toBeGreaterThan(0);
    expect(half.gained).toBeLessThan(light);
    expect(half.gained).toBeGreaterThanOrEqual(Math.floor(light / 2) - 2);
    const full = healed(F.WEIGHT_NO_ATTACK);
    expect(full.gained).toBe(0);

    const w = new World(content, meadow, { seed: 1 });
    w.addItem('jelly_drop', Math.ceil((w.maxWeight() * F.WEIGHT_NO_ATTACK) / content.items.get('jelly_drop')!.weight));
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.attack([...w.monsters.keys()][0]!);
    expect(w.player.intent.kind).toBe('none');
    expect(notices[0]).toMatch(/too much/);
  });
});

describe('wings', () => {
  it('Butterfly Wing returns to the save point across maps', () => {
    const w = new World(content, town, { seed: 1 });
    w.changeMap('meadow-1', meadow.playerStart);
    w.addItem('butterfly_wing', 1);
    w.useItem('butterfly_wing');
    expect(w.map.id).toBe(START_MAP);
    expect(w.player.inventory.has('butterfly_wing')).toBe(false);
  });

  it('Fly Wing teleports somewhere walkable on the same map', () => {
    const w = new World(content, meadow, { seed: 4 });
    w.addItem('fly_wing', 1);
    const before = { ...w.player.tile };
    w.useItem('fly_wing');
    expect(w.map.id).toBe('meadow-1');
    expect(w.player.tile).not.toEqual(before);
    expect(w.grid.isWalkable(w.player.tile.x, w.player.tile.y)).toBe(true);
  });
});

describe('old saves', () => {
  it('upgrades a real v1 save exported before shops and jobs existed', () => {
    const doc = migrate(saveV1);
    expect(doc.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(doc.gold).toBe(0);
    expect(doc.character.jobId).toBe('novice');
    expect(doc.character.skills).toEqual({});
    expect(doc.character.name).toBe(saveV1.character.name);
    const w = new World(content, content.maps.get(doc.position.map)!, { seed: 1 });
    applySaveDoc(w, doc);
    expect(w.player.inventory.get('red_tonic')).toBe(2);
  });
});
