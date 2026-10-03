import type { GearBonus, ItemDef, PetGearDef } from '../data/schemas';
import { describeBonus } from './equipment';

/** A tamed monster that follows the player. Saved with the character. */
export interface Pet {
  /** Monster id of the species. */
  species: string;
  name: string;
  /** Friendship, 0–1000. At 0 the pet runs away. */
  intimacy: number;
  /** Fullness, 0–100. Drops over time; feed with a Pet Treat. */
  hunger: number;
  /** Grows from the monsters you defeat together, 1–MAX_PET_LEVEL. */
  level: number;
  /** XP toward the next level. */
  xp: number;
  /** The collar or charm it wears, if any (saved as its item id). */
  gear: ItemDef | null;
}

export interface PetSpecies {
  /** Stats the pet gives once Neutral; doubled once Loyal. */
  bonus: GearBonus;
  /** Picks up loot near the player. */
  loots: boolean;
  /** One line for the pet window. */
  blurb: string;
}

/** Monsters that can be tamed, by monster id. Each one's lure item names it in `tames`. */
export const PET_SPECIES: Record<string, PetSpecies> = {
  jellop: { bonus: { luk: 2, hp: 30 }, loots: true, blurb: 'Bounces after loot and brings it to you.' },
  mossling: { bonus: { vit: 1, hp: 80 }, loots: false, blurb: 'Sturdy and calm. Makes you hardier.' },
  thicket_wolf: { bonus: { atk: 10, agi: 1 }, loots: false, blurb: 'A loyal hunter. Sharpens your attacks.' },
  shellsnap: { bonus: { def: 3, hp: 40 }, loots: false, blurb: 'Snaps at anything that gets close.' },
  gullwing: { bonus: { dex: 2, flee: 4 }, loots: true, blurb: 'Swoops on shiny loot and keeps your aim keen.' },
};

/** How many pets can be out with you at once. */
export const MAX_PETS = 3;
export const PET_FOOD = 'pet_treat';
export const START_INTIMACY = 100;
export const START_HUNGER = 80;
export const MAX_INTIMACY = 1000;
/** Hunger drops by one point this often (simulated ms). */
export const HUNGER_TICK_MS = 20_000;
/** While starving, intimacy drops this much per hunger tick. */
export const STARVING_LOSS = 20;
/** How far (tiles) from the player a looting pet goes for drops. */
export const PET_LOOT_RANGE = 5;
export const MAX_PET_LEVEL = 50;
/** Friendship for each monster defeated together (while the pet isn't starving). */
export const KILL_INTIMACY = 2;
/** Friendship on each pet level up. */
export const LEVEL_INTIMACY = 15;
/** Time between the pet's bites. */
export const PET_ATTACK_MS = 2500;
/** How far (tiles) the pet reaches to bite. */
export const PET_ATTACK_RANGE = 3;

/** XP a pet needs to go from `level` to the next: the same curve as yours. */
export function petXpToNext(level: number): number {
  return Math.round(10 * level * level + 10 * level);
}

/** What the pet's collar or charm does; empty without one. */
export function petGear(pet: Pet | null): PetGearDef {
  return pet?.gear?.petGear ?? {};
}

/**
 * Gives XP to the pet; returns how many levels it gained. A full level caps
 * the XP so nothing is wasted on the bar.
 */
export function gainPetXp(pet: Pet, xp: number): number {
  let gained = 0;
  pet.xp += Math.max(0, Math.round(xp));
  while (pet.level < MAX_PET_LEVEL && pet.xp >= petXpToNext(pet.level)) {
    pet.xp -= petXpToNext(pet.level);
    pet.level += 1;
    gained += 1;
  }
  if (pet.level >= MAX_PET_LEVEL) pet.xp = 0;
  return gained;
}

/** What a collar or charm does, in plain words, e.g. "bites +30% · LUK +3". */
export function describePetGear(g: PetGearDef): string {
  const pct = (v: number) => `+${Math.round(v * 100)}%`;
  const parts: string[] = [];
  if (g.attack) parts.push(`bites ${pct(g.attack)}`);
  if (g.friendship) parts.push(`friendship ${pct(g.friendship)}`);
  if (g.xp) parts.push(`pet XP ${pct(g.xp)}`);
  if (g.appetite) parts.push(`hunger −${Math.round(g.appetite * 100)}%`);
  if (g.lootRange) parts.push(`loot reach +${g.lootRange}`);
  parts.push(...describeBonus(g.bonus ?? {}));
  return parts.join(' · ');
}

/** Bite damage before randomness: grows with level and friendship. */
export function petAttackDamage(pet: Pet): number {
  return Math.round((6 + 4 * pet.level) * FONDNESS_ATTACK[fondness(pet.intimacy)] * (1 + (petGear(pet).attack ?? 0)));
}

const FONDNESS_ATTACK: Record<Fondness, number> = { Awkward: 0.5, Shy: 0.75, Neutral: 1, Cordial: 1.25, Loyal: 1.5 };

/** How much stronger the species bonus gets with level: ×1 at Lv 1, ×3.45 at Lv 50. */
export function levelFactor(level: number): number {
  return 1 + (level - 1) * 0.05;
}

export type Fondness = 'Awkward' | 'Shy' | 'Neutral' | 'Cordial' | 'Loyal';

export function fondness(intimacy: number): Fondness {
  if (intimacy < 100) return 'Awkward';
  if (intimacy < 250) return 'Shy';
  if (intimacy < 750) return 'Neutral';
  if (intimacy < 910) return 'Cordial';
  return 'Loyal';
}

export type Appetite = 'Starving' | 'Hungry' | 'Content' | 'Satisfied' | 'Stuffed';

export function appetite(hunger: number): Appetite {
  if (hunger <= 10) return 'Starving';
  if (hunger < 50) return 'Hungry';
  if (hunger < 75) return 'Content';
  if (hunger < 90) return 'Satisfied';
  return 'Stuffed';
}

/** Intimacy change from feeding at this hunger: best when hungry, bad when already full. */
export function feedIntimacy(hunger: number): number {
  switch (appetite(hunger)) {
    case 'Starving':
    case 'Hungry':
      return 40;
    case 'Content':
      return 20;
    case 'Satisfied':
      return 5;
    case 'Stuffed':
      return -50;
  }
}

/** Feeds the pet one treat; returns the intimacy change. */
export function feed(pet: Pet): number {
  const delta = feedIntimacy(pet.hunger);
  pet.intimacy = clamp(pet.intimacy + delta, 0, MAX_INTIMACY);
  pet.hunger = clamp(pet.hunger + 25, 0, 100);
  return delta;
}

const FONDNESS_BONUS: Record<Fondness, number> = { Awkward: 0, Shy: 0.5, Neutral: 1, Cordial: 1.5, Loyal: 2 };

/** How much of the species bonus friendship unlocks: none when Awkward, half when Shy, double when Loyal. */
export function bonusFactor(intimacy: number): number {
  return FONDNESS_BONUS[fondness(intimacy)];
}

/** Stats the current pet gives you: its species bonus, grown by level and friendship, plus its gear's. */
export function petBonus(pet: Pet | null): GearBonus {
  if (!pet) return {};
  const species = PET_SPECIES[pet.species];
  const k = bonusFactor(pet.intimacy) * levelFactor(pet.level);
  const total: Record<string, number> = {};
  if (species && k > 0) for (const [key, v] of Object.entries(species.bonus)) total[key] = Math.round((v ?? 0) * k);
  for (const [key, v] of Object.entries(petGear(pet).bonus ?? {})) total[key] = (total[key] ?? 0) + (v ?? 0);
  return total;
}

/** A fresh pet, as tamed. */
export function newPet(species: string, name: string): Pet {
  return { species, name, intimacy: START_INTIMACY, hunger: START_HUNGER, level: 1, xp: 0, gear: null };
}

/** With a lure readied, a matching monster worn down to this share of its HP is tamed. */
export const TAME_HP = 0.25;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
