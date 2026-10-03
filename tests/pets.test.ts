import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { tileDistance } from '../src/core/grid';
import * as Pets from '../src/core/pets';
import { derivedStats, effectiveStats } from '../src/core/progression';
import { World } from '../src/core/world';
import { loadContent } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const meadow = content.maps.get('meadow-1')!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    world.tick();
    if (until?.()) return;
  }
}

/** A player next to a nearly beaten Jellop, holding lures. */
function readyToTame(seed = 1) {
  const w = new World(content, meadow, { seed });
  const m = [...w.monsters.values()][0]!;
  w.changeMap('meadow-1', { x: m.tile.x, y: m.tile.y - 1 });
  const jellop = [...w.monsters.values()].sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
  jellop.hp = 1;
  w.addItem('wobbly_pudding', 10);
  return { w, jellop };
}

function tamed(): World {
  for (let seed = 1; seed < 50; seed++) {
    const { w } = readyToTame(seed);
    for (let i = 0; i < 10 && w.player.pets.length === 0; i++) w.useItem('wobbly_pudding');
    if (w.player.pets.length) return w;
  }
  throw new Error('never tamed');
}

describe('pet rules', () => {
  it('fondness and appetite tiers', () => {
    expect(Pets.fondness(50)).toBe('Awkward');
    expect(Pets.fondness(250)).toBe('Neutral');
    expect(Pets.fondness(950)).toBe('Loyal');
    expect(Pets.appetite(5)).toBe('Starving');
    expect(Pets.appetite(95)).toBe('Stuffed');
  });

  it('feeding a hungry pet builds friendship; overfeeding hurts it', () => {
    const pet: Pets.Pet = { ...Pets.newPet('jellop', 'Jelly'), intimacy: 100, hunger: 30 };
    expect(Pets.feed(pet)).toBe(40);
    expect(pet.intimacy).toBe(140);
    pet.hunger = 95;
    expect(Pets.feed(pet)).toBe(-50);
    expect(pet.hunger).toBe(100);
  });

  it('bonuses start at half when Shy, full at Neutral, and double when Loyal', () => {
    const pet: Pets.Pet = { ...Pets.newPet('thicket_wolf', 'Rex'), intimacy: 50, hunger: 50 };
    expect(Pets.petBonus(pet)).toEqual({});
    pet.intimacy = 100;
    expect(Pets.petBonus(pet)).toEqual({ atk: 5, agi: 1 });
    pet.intimacy = 300;
    expect(Pets.petBonus(pet)).toEqual({ atk: 10, agi: 1 });
    pet.intimacy = 950;
    expect(Pets.petBonus(pet)).toEqual({ atk: 20, agi: 2 });
  });

  it('worn-down monsters are easier to tame', () => {
    expect(Pets.tameChance(100, 100)).toBeCloseTo(0.2);
    expect(Pets.tameChance(1, 100)).toBeGreaterThan(0.75);
  });

  it('every lure tames a pet species', () => {
    const lures = [...content.items.values()].filter((i) => i.effect === 'tame');
    expect(lures.map((l) => l.tames).sort()).toEqual(Object.keys(Pets.PET_SPECIES).sort());
  });
});

describe('taming and caring', () => {
  it('needs the right monster nearby, and keeps the lure otherwise', () => {
    const w = new World(content, content.maps.get('town')!, { seed: 1 });
    w.addItem('wobbly_pudding', 1);
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useItem('wobbly_pudding');
    expect(notices.at(-1)).toMatch(/No Jellop/);
    expect(w.itemCount('wobbly_pudding')).toBe(1);
  });

  it('a tamed Jellop follows the player and leaves the map as a wild monster', () => {
    const w = tamed();
    expect(w.player.pets[0]!.species).toBe('jellop');
    expect(w.petMovers()[0]?.mover).not.toBeNull();
    w.moveTo({ x: w.player.tile.x + 6, y: w.player.tile.y });
    run(w, 6000);
    expect(tileDistance(w.petMovers()[0]!.mover!.tile, w.player.tile)).toBeLessThanOrEqual(2);
  });

  it('feeding with treats makes it Neutral, which raises its bonus from half to full', () => {
    const w = tamed();
    const luk = effectiveStats(w.player).luk;
    const hp = derivedStats(w.player).maxHp;
    w.addItem('pet_treat', 5);
    w.player.pets[0]!.hunger = 20;
    for (let i = 0; i < 4; i++) {
      w.player.pets[0]!.hunger = 20;
      expect(w.feedPet()).toBeNull();
    }
    expect(Pets.fondness(w.player.pets[0]!.intimacy)).toBe('Neutral');
    // A Shy jellop gave LUK +1 (half of 2); Neutral gives all of it.
    expect(effectiveStats(w.player).luk).toBe(luk + 1);
    expect(derivedStats(w.player).maxHp).toBeGreaterThan(hp);
  });

  it('a looting pet fetches drops near the player', () => {
    const w = tamed();
    const p = w.player.tile;
    const spot = { x: p.x + 2, y: p.y };
    w.drops.set(9999, { id: 9999, itemId: 'jelly_drop', tile: spot, expiresIn: 60_000 });
    const before = w.itemCount('jelly_drop');
    run(w, 5000, () => !w.drops.has(9999));
    expect(w.drops.has(9999)).toBe(false);
    expect(w.itemCount('jelly_drop')).toBe(before + 1);
  });

  it('a starving pet loses friendship and eventually runs away', () => {
    const w = tamed();
    w.player.pets[0]!.hunger = 0;
    w.player.pets[0]!.intimacy = 20;
    let ran = false;
    w.events.on('petRanAway', () => (ran = true));
    run(w, Pets.HUNGER_TICK_MS + 100);
    expect(ran).toBe(true);
    expect(w.player.pets).toHaveLength(0);
  });

  it('the pet is saved and loaded, and old saves load without one', () => {
    const w = tamed();
    w.renamePet('Wobbles');
    const doc = JSON.parse(JSON.stringify(toSaveDoc(w, 0)));
    const fresh = new World(content, meadow, { seed: 2 });
    applySaveDoc(fresh, migrate(doc));
    expect(fresh.player.pets[0]).toMatchObject({ species: 'jellop', name: 'Wobbles' });
    const { pet: _pet, ...v6 } = { ...doc, schemaVersion: 6 };
    expect(migrate(v6).pet).toBeNull();
  });
});

describe('pet levels, bites and gear', () => {
  it('levels up from XP, keeps the leftover, and stops at the cap', () => {
    const pet = Pets.newPet('jellop', 'Jelly');
    expect(Pets.gainPetXp(pet, Pets.petXpToNext(1) + 5)).toBe(1);
    expect(pet).toMatchObject({ level: 2, xp: 5 });
    pet.level = Pets.MAX_PET_LEVEL - 1;
    expect(Pets.gainPetXp(pet, 1e9)).toBe(1);
    expect(pet).toMatchObject({ level: Pets.MAX_PET_LEVEL, xp: 0 });
  });

  it('higher levels give bigger bonuses and bites', () => {
    const pet = { ...Pets.newPet('thicket_wolf', 'Rex'), intimacy: 300 };
    const low = Pets.petBonus(pet).atk!;
    const bite = Pets.petAttackDamage(pet);
    pet.level = 21;
    expect(Pets.petBonus(pet).atk).toBe(low * 2);
    expect(Pets.petAttackDamage(pet)).toBeGreaterThan(bite * 5);
  });

  it('defeating monsters together gives the pet XP and friendship', () => {
    const w = tamed();
    const pet = w.player.pets[0]!;
    pet.hunger = 80;
    const levels: number[] = [];
    w.events.on('petLevelUp', (e) => levels.push(e.level));
    const before = pet.intimacy;
    for (let i = 0; i < 5; i++) {
      const m = [...w.monsters.values()].sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
      m.hp = 1;
      w.attack(m.id);
      run(w, 15_000, () => !w.monsters.has(m.id));
    }
    expect(pet.level).toBeGreaterThan(1);
    expect(levels.at(-1)).toBe(pet.level);
    expect(pet.intimacy).toBeGreaterThan(before + 5 * Pets.KILL_INTIMACY);
  });

  it('bites what the player is fighting', () => {
    const w = tamed();
    const bites: number[] = [];
    w.events.on('petAttack', (e) => bites.push(e.amount));
    const m = [...w.monsters.values()].sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
    m.hp = 1e6;
    w.player.hp = 1e6;
    w.attack(m.id);
    run(w, 12_000);
    expect(bites.length).toBeGreaterThanOrEqual(3);
  });

  it('wears one collar or charm, swapping through the bag', () => {
    const w = tamed();
    const pet = w.player.pets[0]!;
    pet.intimacy = 300;
    const bite = Pets.petAttackDamage(pet);
    expect(w.equipPetGear('leather_collar')).toMatch(/don't have/);
    w.addItem('leather_collar', 1);
    w.addItem('spiked_collar', 1);
    expect(w.equipPetGear('leather_collar')).toBeNull();
    expect(Pets.petAttackDamage(pet)).toBeGreaterThan(bite);
    const atk = derivedStats(w.player).atk;
    expect(w.equipPetGear('spiked_collar')).toBeNull();
    expect(w.itemCount('leather_collar')).toBe(1);
    expect(derivedStats(w.player).atk).toBe(atk + 5);
    w.unequipPetGear();
    expect(pet.gear).toBeNull();
    expect(w.itemCount('spiked_collar')).toBe(1);
    // A released pet leaves its collar behind.
    w.equipPetGear('spiked_collar');
    w.releasePet();
    expect(w.itemCount('spiked_collar')).toBe(1);
  });

  it('a feed bag slows hunger', () => {
    const plain = tamed();
    const bagged = tamed();
    bagged.addItem('feed_bag', 1);
    bagged.equipPetGear('feed_bag');
    plain.player.pets[0]!.hunger = bagged.player.pets[0]!.hunger = 80;
    plain.player.hp = bagged.player.hp = 1e6;
    run(plain, 200_000);
    run(bagged, 200_000);
    expect(80 - bagged.player.pets[0]!.hunger).toBeLessThan(80 - plain.player.pets[0]!.hunger);
  });

  it('level, XP and gear are saved; older pets load as level 1', () => {
    const w = tamed();
    const pet = w.player.pets[0]!;
    pet.level = 12;
    pet.xp = 34;
    w.addItem('jingle_bell', 1);
    w.equipPetGear('jingle_bell');
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    const fresh = new World(content, meadow, { seed: 9 });
    applySaveDoc(fresh, doc);
    expect(fresh.player.pets[0]).toMatchObject({ level: 12, xp: 34, gear: { id: 'jingle_bell' } });
    const old = { ...doc, pets: undefined, pet: { species: 'jellop', name: 'Old', intimacy: 300, hunger: 50 } };
    applySaveDoc(fresh, migrate(old));
    expect(fresh.player.pets[0]).toMatchObject({ level: 1, xp: 0, gear: null });
  });
});

describe('several pets', () => {
  it('up to three follow you, each fights, and their bonuses add up', () => {
    const w = tamed();
    w.player.pets[0]!.intimacy = 500;
    const hpWithOne = derivedStats(w.player).maxHp;
    w.player.pets.push({ ...Pets.newPet('jellop', 'Two'), intimacy: w.player.pets[0]!.intimacy }, { ...Pets.newPet('jellop', 'Three'), intimacy: w.player.pets[0]!.intimacy });
    w.changeMap(w.map.id, w.player.tile);
    expect(w.petMovers().filter((m) => m.mover)).toHaveLength(3);
    expect(derivedStats(w.player).maxHp).toBeGreaterThan(hpWithOne);
    // A fourth lure does nothing: the bag keeps it.
    const lures = w.itemCount('wobbly_pudding');
    w.addItem('wobbly_pudding', 1);
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useItem('wobbly_pudding');
    expect(notices.at(-1)).toMatch(/already have 3 pets/);
    expect(w.player.pets).toHaveLength(Pets.MAX_PETS);
    expect(w.itemCount('wobbly_pudding')).toBe(lures + 1);
    // Feeding and releasing touch only the chosen pet.
    w.addItem(Pets.PET_FOOD, 1);
    const hunger = w.player.pets[0]!.hunger;
    w.player.pets[2]!.hunger = 10;
    expect(w.feedPet(w.player.pets[2])).toBeNull();
    expect(w.player.pets[0]!.hunger).toBe(hunger);
    expect(w.player.pets[2]!.hunger).toBeGreaterThan(10);
    w.releasePet(w.player.pets[1]);
    expect(w.player.pets.map((p) => p.name)).not.toContain('Two');
    expect(w.petMovers()).toHaveLength(2);
    const doc = migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0))));
    const fresh = new World(content, meadow, { seed: 4 });
    applySaveDoc(fresh, doc);
    expect(fresh.player.pets.map((p) => p.name)).toEqual(w.player.pets.map((p) => p.name));
  });
});
