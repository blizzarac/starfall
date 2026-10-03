import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { DialogueRunner } from '../src/core/dialogue';
import { weaponOf } from '../src/core/equipment';
import { derivedStats } from '../src/core/progression';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

function rich(seed = 1): World {
  const w = new World(content, town, { seed });
  w.player.gold = 1_000_000;
  w.addItem('brightstone', 50);
  return w;
}

describe('refining', () => {
  it('+1 to +4 never fails and adds weapon ATK', () => {
    const w = rich();
    const knife = w.player.equipment.weapon!;
    const atk = derivedStats(w.player).atk;
    for (let i = 1; i <= 4; i++) expect(w.refine(knife.uid)).toEqual({ success: true, level: i });
    expect(knife.refine).toBe(4);
    expect(weaponOf(w.player).atk).toBe(17 + 4 * 3);
    expect(derivedStats(w.player).atk).toBe(atk + 12);
    expect(w.itemCount('brightstone')).toBe(46);
  });

  it('armor refines add DEF', () => {
    const w = rich();
    const def = derivedStats(w.player).def;
    w.refine(w.player.equipment.body!.uid);
    expect(derivedStats(w.player).def).toBe(def + 1);
  });

  it('charges gold and ore, and refuses without them', () => {
    const w = new World(content, town, { seed: 1 });
    const uid = w.player.equipment.weapon!.uid;
    expect(w.refine(uid)).toEqual({ error: expect.stringMatching(/Brightstone/) });
    w.addItem('brightstone', 1);
    expect(w.refine(uid)).toEqual({ error: expect.stringMatching(/100 gold/) });
    w.player.gold = 100;
    expect(w.refine(uid)).toEqual({ success: true, level: 1 });
    expect(w.player.gold).toBe(0);
  });

  it('a failure above +4 keeps the piece and its level, worn or not', () => {
    let failures = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = rich(seed);
      const knife = w.player.equipment.weapon!;
      for (let i = 0; i < 12; i++) {
        const before = knife.refine;
        const result = w.refine(knife.uid);
        if ('error' in result) break;
        if (!result.success) {
          failures++;
          expect(knife.refine).toBe(before);
        }
        expect(w.player.equipment.weapon).toBe(knife);
        expect(weaponOf(w.player).type).not.toBe('fist');
      }
    }
    expect(failures).toBeGreaterThan(0);
  });

  it('success rates match the table over many attempts', () => {
    const w = rich(7);
    w.player.gold = 1e12;
    let ok = 0;
    const tries = 2000;
    for (let i = 0; i < tries; i++) {
      w.addItem('stiletto', 1);
      w.addItem('brightstone', 1);
      const piece = w.player.gear[w.player.gear.length - 1]!;
      piece.refine = 4;
      if ((w.refine(piece.uid) as { success: boolean }).success) ok++;
      w.player.gear = [];
    }
    expect(ok / tries).toBeGreaterThan(F.refineChance(5) - 0.05);
    expect(ok / tries).toBeLessThan(F.refineChance(5) + 0.05);
  });

  it('Greta opens the refine window', () => {
    const w = rich();
    const npc = town.npcs.find((n) => n.dialogue === 'blacksmith')!;
    const d = new DialogueRunner(w, content.dialogues.get('blacksmith')!, npc);
    d.choose(1);
    d.choose(0);
    expect(d.openRefine).toBe(true);
    expect(d.done).toBe(true);
  });
});
