import type { GearBonus } from '../data/schemas';

/** A tamed monster that follows the player. Saved with the character. */
export interface Pet {
  /** Monster id of the species. */
  species: string;
  name: string;
  /** Friendship, 0–1000. At 0 the pet runs away. */
  intimacy: number;
  /** Fullness, 0–100. Drops over time; feed with a Pet Treat. */
  hunger: number;
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

/** 0 below Neutral, 1 from Neutral, 2 when Loyal. */
export function bonusFactor(intimacy: number): number {
  const f = fondness(intimacy);
  return f === 'Loyal' ? 2 : f === 'Neutral' || f === 'Cordial' ? 1 : 0;
}

/** Stats the current pet gives. */
export function petBonus(pet: Pet | null): GearBonus {
  if (!pet) return {};
  const species = PET_SPECIES[pet.species];
  const k = bonusFactor(pet.intimacy);
  if (!species || k === 0) return {};
  return Object.fromEntries(Object.entries(species.bonus).map(([key, v]) => [key, (v ?? 0) * k]));
}

/** Chance a lure works: better the more the monster is worn down. */
export function tameChance(hp: number, maxHp: number): number {
  return 0.2 + 0.6 * (1 - Math.max(0, Math.min(1, hp / maxHp)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
