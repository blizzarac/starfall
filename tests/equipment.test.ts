import { describe, expect, it } from 'vitest';
import { gearBonus, weaponOf } from '../src/core/equipment';
import { derivedStats, effectiveStats, gainXp } from '../src/core/progression';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';
import saveV1 from './fixtures/save-v1.json';

const content = loadContent();
const town = content.maps.get(START_MAP)!;
const fresh = () => new World(content, town, { seed: 1 });

describe('equipment', () => {
  it('new characters start with a Novice Knife and a Cotton Shirt', () => {
    const w = fresh();
    expect(w.player.equipment.weapon?.id).toBe('novice_knife');
    expect(w.player.equipment.body?.id).toBe('cotton_shirt');
    expect(weaponOf(w.player)).toEqual({ type: 'dagger', atk: 17 });
    expect(w.player.inventory.size).toBe(0);
  });

  it('equipping swaps the old piece back into the bag and changes stats', () => {
    const w = fresh();
    const atk = derivedStats(w.player).atk;
    w.addItem('stiletto', 1);
    expect(w.equip('stiletto')).toBeNull();
    expect(w.player.equipment.weapon?.id).toBe('stiletto');
    expect(w.player.inventory.get('novice_knife')).toBe(1);
    expect(w.player.inventory.has('stiletto')).toBe(false);
    expect(derivedStats(w.player).atk).toBeGreaterThan(atk);
    expect(effectiveStats(w.player).dex).toBe(w.player.stats.dex + 1);
  });

  it('armor adds DEF and bonuses add HP', () => {
    const w = fresh();
    const before = derivedStats(w.player);
    w.addItem('leather_cap', 1);
    w.addItem('moss_cap', 1);
    w.equip('leather_cap');
    expect(derivedStats(w.player).def).toBe(before.def + 2);
    w.equip('moss_cap');
    expect(derivedStats(w.player).maxHp).toBe(before.maxHp + 25);
    expect(gearBonus(w.player).def).toBe(1 + 1); // shirt + moss cap
  });

  it('enforces job and level limits', () => {
    const w = fresh();
    w.addItem('short_sword', 1);
    w.addItem('leather_vest', 1);
    expect(w.equip('short_sword')).toMatch(/swordsman/);
    expect(w.equip('leather_vest')).toMatch(/level 10/);
    gainXp(w.player, 100_000, 0);
    expect(w.equip('leather_vest')).toBeNull();
    expect(w.player.inventory.get('cotton_shirt')).toBe(1);
    expect(w.equip('tusk_blade')).toMatch(/don't have/);
  });

  it('accessories fill both accessory slots', () => {
    const w = fresh();
    w.addItem('clover_charm', 2);
    w.equip('clover_charm');
    w.equip('clover_charm');
    expect(w.player.equipment.acc1?.id).toBe('clover_charm');
    expect(w.player.equipment.acc2?.id).toBe('clover_charm');
    expect(effectiveStats(w.player).luk).toBe(w.player.stats.luk + 4);
  });

  it('unequipping returns the item and worn gear counts toward weight', () => {
    const w = fresh();
    const worn = w.weight();
    expect(worn).toBe(content.items.get('novice_knife')!.weight + content.items.get('cotton_shirt')!.weight);
    w.unequip('weapon');
    expect(w.player.equipment.weapon).toBeUndefined();
    expect(weaponOf(w.player).type).toBe('fist');
    expect(w.weight()).toBe(worn);
    expect(w.sell('novice_knife', 1)).toBeNull();
  });

  it('saves and restores worn gear', () => {
    const w = fresh();
    w.addItem('buckler', 1);
    w.equip('buckler');
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    expect(doc.character.equipment).toEqual({ weapon: 'novice_knife', body: 'cotton_shirt', shield: 'buckler' });
    const back = fresh();
    applySaveDoc(back, doc);
    expect(back.player.equipment.shield?.id).toBe('buckler');
  });

  it('old saves get the knife they used to have built in', () => {
    const doc = migrate(saveV1);
    expect(doc.character.equipment).toEqual({ weapon: 'novice_knife', body: 'cotton_shirt' });
    const w = new World(content, content.maps.get(doc.position.map)!, { seed: 1 });
    applySaveDoc(w, doc);
    expect(weaponOf(w.player)).toEqual({ type: 'dagger', atk: 17 });
  });
});
