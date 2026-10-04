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

/** A sturdy player next to a Jellop, holding lures. */
function readyToTame(seed = 1) {
  const w = new World(content, meadow, { seed });
  const m = [...w.monsters.values()].find((x) => x.def.id === 'jellop')!;
  w.changeMap('meadow-1', { x: m.tile.x, y: m.tile.y - 1 });
  const jellop = [...w.monsters.values()].filter((x) => x.def.id === 'jellop').sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
  w.player.hp = 1e9;
  w.addItem('wobbly_pudding', 10);
  return { w, jellop };
}

/** Fights a monster until it's gone (defeated or tamed). */
function fight(w: World, id: number) {
  w.attack(id);
  run(w, 60_000, () => !w.monsters.has(id));
}

function tamed(): World {
  const { w, jellop } = readyToTame();
  w.useItem('wobbly_pudding');
  fight(w, jellop.id);
  if (!w.player.pets.length) throw new Error('never tamed');
  return w;
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

  it('every lure tames a pet species', () => {
    const lures = [...content.items.values()].filter((i) => i.effect === 'tame');
    expect(lures.map((l) => l.tames).sort()).toEqual(Object.keys(Pets.PET_SPECIES).sort());
  });
});

describe('taming and caring', () => {
  it('a readied lure tames the right monster once it is worn down, with no XP or loot', () => {
    const { w, jellop } = readyToTame();
    // Without a lure out, a Jellop is just defeated.
    const xp = w.player.baseXp;
    fight(w, jellop.id);
    expect(w.player.pets).toHaveLength(0);
    expect(w.player.baseXp).toBeGreaterThan(xp);
    // Readying uses the lure up; a second can't be readied while one is out.
    const notices: string[] = [];
    w.events.on('notice', (e) => notices.push(e.text));
    w.useItem('wobbly_pudding');
    expect(w.player.lure).toBe('wobbly_pudding');
    expect(w.itemCount('wobbly_pudding')).toBe(9);
    w.useItem('wobbly_pudding');
    expect(notices.at(-1)).toMatch(/already out/);
    expect(w.itemCount('wobbly_pudding')).toBe(9);
    // The lure waits through other fights and saves.
    w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
    const other = [...w.monsters.values()].find((m) => m.def.id !== 'jellop' && !m.def.boss)!;
    w.changeMap('meadow-2', { x: other.tile.x, y: other.tile.y - 1 });
    const near = [...w.monsters.values()].filter((m) => m.def.id === other.def.id).sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
    fight(w, near.id);
    expect(w.player.pets).toHaveLength(0);
    w.changeMap('meadow-1', meadow.playerStart);
    const loaded = new World(content, meadow, { seed: 3 });
    applySaveDoc(loaded, migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0)))));
    expect(loaded.player.lure).toBe('wobbly_pudding');
    // Wear a Jellop down: it's tamed at a quarter of its HP instead of defeated.
    const j = [...loaded.monsters.values()].find((m) => m.def.id === 'jellop')!;
    loaded.changeMap('meadow-1', { x: j.tile.x, y: j.tile.y - 1 });
    const target = [...loaded.monsters.values()].filter((m) => m.def.id === 'jellop').sort((a, b) => tileDistance(a.tile, loaded.player.tile) - tileDistance(b.tile, loaded.player.tile))[0]!;
    loaded.player.hp = 1e9;
    let lowest = target.hp;
    loaded.events.on('damage', (e) => e.targetId === target.id && (lowest = target.hp));
    const before = loaded.player.baseXp;
    fight(loaded, target.id);
    expect(loaded.player.pets.map((p) => p.species)).toEqual(['jellop']);
    expect(loaded.player.lure).toBeNull();
    expect(lowest).toBeLessThanOrEqual(target.def.hp * Pets.TAME_HP);
    expect(loaded.player.baseXp).toBe(before);
    expect(loaded.drops.size).toBe(0);
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

  it('a starving pet goes home to Brightmoor and waits until you feed it there', () => {
    const w = tamed();
    const pet = w.player.pets[0]!;
    pet.hunger = 0;
    pet.intimacy = 20;
    let home = false;
    w.events.on('petWentHome', () => (home = true));
    run(w, Pets.HUNGER_TICK_MS + 100);
    expect(home).toBe(true);
    // Still yours, but it doesn't follow, help or fight out here.
    expect(w.player.pets).toEqual([pet]);
    expect(pet.waiting).toBe(true);
    expect(w.petMovers()).toHaveLength(0);
    w.addItem(Pets.PET_FOOD, 2);
    expect(w.feedPet(pet)).toMatch(/waiting in Brightmoor/);
    expect(w.itemCount(Pets.PET_FOOD)).toBe(2);
    // It keeps through a save.
    const loaded = new World(content, meadow, { seed: 5 });
    applySaveDoc(loaded, migrate(JSON.parse(JSON.stringify(toSaveDoc(w, 0)))));
    expect(loaded.player.pets[0]!.waiting).toBe(true);
    // In town it waits by Mabel; a treat there brings it back.
    w.changeMap('town', { x: 22, y: 21 });
    run(w, 100);
    const mover = w.petMovers()[0]?.mover;
    expect(mover && tileDistance(mover.tile, Pets.PET_HOME)).toBeLessThanOrEqual(2);
    const hunger = pet.hunger;
    run(w, Pets.HUNGER_TICK_MS * 3);
    expect(pet.hunger).toBe(hunger);
    expect(w.feedPet(pet)).toBeNull();
    expect(pet.waiting).toBe(false);
    expect(pet.intimacy).toBeGreaterThanOrEqual(Pets.START_INTIMACY);
    expect(pet.hunger).toBeGreaterThan(hunger);
    run(w, 100);
    expect(tileDistance(w.petMovers()[0]!.mover.tile, w.player.tile)).toBeLessThanOrEqual(2);
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
    expect(w.player.lure).toBeNull();
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
