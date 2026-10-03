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
    expect(w.player.equipment.weapon?.item.id).toBe('novice_knife');
    expect(w.player.equipment.body?.item.id).toBe('cotton_shirt');
    expect(weaponOf(w.player)).toEqual({ type: 'dagger', atk: 17, matk: 0 });
    expect(w.player.inventory.size).toBe(0);
    expect(w.player.gear).toEqual([]);
  });

  it('equipping swaps the old piece back into the bag and changes stats', () => {
    const w = fresh();
    const atk = derivedStats(w.player).atk;
    w.addItem('stiletto', 1);
    expect(w.equip('stiletto')).toBeNull();
    expect(w.player.equipment.weapon?.item.id).toBe('stiletto');
    expect(w.itemCount('novice_knife')).toBe(1);
    expect(w.itemCount('stiletto')).toBe(0);
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
    expect(w.itemCount('cotton_shirt')).toBe(1);
    expect(w.equip('tusk_blade')).toMatch(/don't have/);
  });

  it('accessories fill both accessory slots', () => {
    const w = fresh();
    w.addItem('clover_charm', 2);
    w.equip('clover_charm');
    w.equip('clover_charm');
    expect(w.player.equipment.acc1?.item.id).toBe('clover_charm');
    expect(w.player.equipment.acc2?.item.id).toBe('clover_charm');
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
    expect(Object.fromEntries(Object.entries(doc.character.equipment).map(([k, v]) => [k, v!.item]))).toEqual({
      weapon: 'novice_knife',
      body: 'cotton_shirt',
      shield: 'buckler',
    });
    const back = fresh();
    applySaveDoc(back, doc);
    expect(back.player.equipment.shield?.item.id).toBe('buckler');
  });

  it('old saves get the knife they used to have built in', () => {
    const doc = migrate(saveV1);
    expect(doc.character.equipment).toEqual({
      weapon: { item: 'novice_knife', refine: 0, cards: [] },
      body: { item: 'cotton_shirt', refine: 0, cards: [] },
    });
    const w = new World(content, content.maps.get(doc.position.map)!, { seed: 1 });
    applySaveDoc(w, doc);
    expect(weaponOf(w.player)).toEqual({ type: 'dagger', atk: 17, matk: 0 });
  });
});

describe('cards', () => {
  it('slots a card into gear for good and applies its bonus', () => {
    const w = fresh();
    const hp = derivedStats(w.player).maxHp;
    w.addItem('jellop_card', 1);
    const shirt = w.player.equipment.body!;
    expect(w.insertCard('jellop_card', shirt.uid)).toBeNull();
    expect(shirt.cards.map((c) => c.id)).toEqual(['jellop_card']);
    expect(w.itemCount('jellop_card')).toBe(0);
    expect(derivedStats(w.player).maxHp).toBe(hp + 40);
  });

  it('checks the slot type and free slots', () => {
    const w = fresh();
    w.addItem('jellop_card', 2);
    w.addItem('thornbeetle_card', 1);
    const knife = w.player.equipment.weapon!;
    const shirt = w.player.equipment.body!;
    expect(w.insertCard('jellop_card', knife.uid)).toMatch(/only fits body/);
    expect(w.insertCard('jellop_card', shirt.uid)).toBeNull();
    expect(w.insertCard('jellop_card', shirt.uid)).toMatch(/no free card slot/);
    expect(w.insertCard('thornbeetle_card', knife.uid)).toBeNull();
  });

  it('damage cards raise damage against matching monsters', () => {
    const plain = fresh();
    const carded = fresh();
    carded.addItem('thornbeetle_card', 1);
    carded.insertCard('thornbeetle_card', carded.player.equipment.weapon!.uid);
    const total = (w: World) => {
      w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
      w.player.hp = 1e9;
      const target = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle')!;
      target.hp = 1e9;
      let sum = 0;
      w.events.on('damage', (e) => e.sourceId === 'player' && (sum += e.amount));
      w.attack(target.id);
      for (let t = 0; t < 60_000; t += 50) w.tick();
      return sum;
    };
    expect(total(carded)).toBeGreaterThan(total(plain) * 1.05);
  });

  it('cards and refines survive saving, and only plain pieces get sold first', () => {
    const w = fresh();
    w.addItem('novice_knife', 2);
    w.addItem('thornbeetle_card', 1);
    const special = w.player.gear[0]!;
    w.insertCard('thornbeetle_card', special.uid);
    special.refine = 3;
    expect(w.sell('novice_knife', 1)).toBeNull();
    expect(w.player.gear).toEqual([special]);
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    const back = fresh();
    applySaveDoc(back, doc);
    expect(back.player.gear.map((g) => [g.item.id, g.refine, g.cards.map((c) => c.id)])).toEqual([['novice_knife', 3, ['thornbeetle_card']]]);
  });
});
