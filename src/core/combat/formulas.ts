/**
 * Every balance number in the game lives here, so tuning touches one file.
 * Functions are pure; randomness is passed in.
 */
import type { Rng } from '../rng';

export const TICK_MS = 50;
export const MAX_BASE_LEVEL = 99;
export const MAX_STAT = 99;

export type StatName = 'str' | 'agi' | 'vit' | 'int' | 'dex' | 'luk';
export const STAT_NAMES: readonly StatName[] = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
export type Stats = Record<StatName, number>;

export const ELEMENTS = [
  'neutral',
  'water',
  'earth',
  'fire',
  'wind',
  'poison',
  'holy',
  'shadow',
  'ghost',
  'undead',
] as const;
export type Element = (typeof ELEMENTS)[number];

export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export type WeaponType = 'fist' | 'dagger' | 'sword' | 'bow' | 'staff' | 'mace';

// ---- Progression ---------------------------------------------------------

/** Points needed to raise a stat from `current` to `current + 1`. */
export function statRaiseCost(current: number): number {
  return Math.floor((current - 1) / 10) + 2;
}

/** Stat points granted on reaching `level`. */
export function statPointsForLevel(level: number): number {
  return Math.floor(level / 5) + 3;
}

/** Base XP needed to go from `level` to `level + 1`. */
export function baseXpToNext(level: number): number {
  return Math.round(10 * level * level + 10 * level);
}

/** Job XP needed to go from `jobLevel` to `jobLevel + 1`; later jobs scale it up by `factor`. */
export function jobXpToNext(jobLevel: number, factor = 1): number {
  return Math.round((8 * Math.pow(jobLevel, 1.8) + 6) * factor);
}

/** XP lost on death: 1% of the current level's requirement. */
export function deathXpPenalty(level: number): number {
  return Math.floor(baseXpToNext(level) * 0.01);
}

// ---- Derived stats -------------------------------------------------------

/** Grows a little faster than linearly, so later monsters can hit harder without one-shotting. */
export function maxHp(level: number, vit: number): number {
  return Math.floor((40 + 8 * level + 0.1 * level * level) * (1 + vit / 100));
}

/** Grows with level, and clearly with INT: each point adds 2% plus 2 SP (before the job's factor). */
export function maxSp(level: number, int: number): number {
  return Math.floor((10 + 3 * level) * (1 + int / 50) + 2 * int);
}

/** ATK from stats alone; weapon ATK is added on top. */
export function statusAtk(s: Pick<Stats, 'str' | 'dex' | 'luk'>, ranged = false): number {
  // Bows draw their power from DEX, everything else from STR.
  const main = ranged ? s.dex : s.str;
  const side = ranged ? s.str : s.dex;
  const bonus = Math.floor(main / 10);
  return main + bonus * bonus + Math.floor(side / 5) + Math.floor(s.luk / 5);
}

export function hit(level: number, dex: number): number {
  return level + dex;
}

export function flee(level: number, agi: number): number {
  return level + agi;
}

/** Magic attack from INT, before weapon MATK. */
export function statusMatk(int: number): number {
  const bonus = Math.floor(int / 5);
  return int + bonus * bonus;
}

/** DEX shortens casting; 150 DEX means instant casts. */
export function castTimeMs(baseMs: number, dex: number): number {
  return Math.round(baseMs * Math.max(0, 1 - dex / 150));
}

/** Magic always hits; monster DEF counts half against it. */
export function magicDamage(matk: number, perHit: number, elementMod: number, def: number, rng: Rng): number {
  if (elementMod === 0) return 0;
  const raw = matk * perHit * elementMod * (0.9 + rng() * 0.2);
  return Math.max(1, Math.floor(afterDefense(raw, def / 2)));
}

/** However high the DEF, at least this share of a hit gets through. */
export const MIN_DAMAGE_SHARE = 0.4;

/**
 * DEF is subtracted from a hit, but never takes more than 60% of it: armor
 * shrugs off weak hits, and nobody becomes immune to anything.
 */
export function afterDefense(raw: number, def: number): number {
  return Math.max(raw * MIN_DAMAGE_SHARE, raw - Math.max(0, def));
}

/** Soft defense from VIT, subtracted after multipliers. */
export function softDef(vit: number): number {
  return Math.floor(vit / 2);
}

export function critChance(luk: number): number {
  return (1 + luk * 0.3) / 100;
}

const WEAPON_BASE_ASPD: Record<WeaponType, number> = {
  fist: 150,
  dagger: 148,
  sword: 144,
  bow: 140,
  staff: 136,
  mace: 142,
};

/** ASPD on a 0–190 scale, from AGI, DEX and weapon type. */
export function aspd(agi: number, dex: number, weapon: WeaponType): number {
  return Math.min(190, Math.floor(WEAPON_BASE_ASPD[weapon] + agi * 0.4 + dex * 0.1));
}

/** Milliseconds between auto-attacks for a given ASPD. */
export function attackDelayMs(aspdValue: number): number {
  return (200 - aspdValue) * 20;
}

// ---- Hit and damage ------------------------------------------------------

export function hitChance(attackerHit: number, defenderFlee: number): number {
  return Math.min(0.95, Math.max(0.05, (90 + attackerHit - defenderFlee) / 100));
}

/** Multiplier for an attack of element `atk` landing on a target of element `def`. */
const ELEMENT_TABLE: Record<Element, Partial<Record<Element, number>>> = {
  neutral: { ghost: 0.25 },
  water: { fire: 1.5, water: 0.25, wind: 0.9, undead: 1.0 },
  earth: { wind: 1.5, earth: 0.25, fire: 0.9 },
  fire: { earth: 1.5, undead: 1.25, fire: 0.25, water: 0.9 },
  wind: { water: 1.5, wind: 0.25, earth: 0.9 },
  poison: { poison: 0, undead: 0.5, ghost: 0.5, shadow: 0.5 },
  holy: { shadow: 1.25, undead: 1.5, holy: 0 },
  shadow: { holy: 1.25, shadow: 0, undead: 0 },
  ghost: { ghost: 1.25, neutral: 0.25 },
  undead: { holy: 1.25, undead: 0, shadow: 0 },
};

export function elementModifier(atk: Element, def: Element): number {
  return ELEMENT_TABLE[atk][def] ?? 1;
}

const SIZE_TABLE: Record<WeaponType, Record<Size, number>> = {
  fist: { small: 1, medium: 1, large: 1 },
  dagger: { small: 1, medium: 0.85, large: 0.7 },
  sword: { small: 0.9, medium: 1, large: 0.9 },
  bow: { small: 1, medium: 1, large: 0.85 },
  staff: { small: 1, medium: 1, large: 1 },
  mace: { small: 1, medium: 1, large: 1 },
};

export function sizeModifier(weapon: WeaponType, size: Size): number {
  return SIZE_TABLE[weapon][size];
}

export interface DamageInput {
  atk: number;
  skillModifier?: number;
  elementModifier?: number;
  sizeModifier?: number;
  def: number;
  crit?: boolean;
}

/**
 * Damage = ATK × skill × element × size (±10% variance), minus DEF (see afterDefense).
 * Crits skip variance (always max roll) and ignore defense.
 * Always at least 1 unless the element modifier is 0.
 */
export function damage(input: DamageInput, rng: Rng): number {
  const elem = input.elementModifier ?? 1;
  if (elem === 0) return 0;
  const variance = input.crit ? 1.1 : 0.9 + rng() * 0.2;
  const raw = input.atk * (input.skillModifier ?? 1) * elem * (input.sizeModifier ?? 1) * variance;
  const afterDef = input.crit ? raw * 1.4 : afterDefense(raw, input.def);
  return Math.max(1, Math.floor(afterDef));
}

// ---- Regeneration --------------------------------------------------------

export function hpRegenIntervalMs(sitting: boolean): number {
  return sitting ? 3000 : 6000;
}

export function hpRegenAmount(maxHpValue: number, vit: number): number {
  return Math.max(1, Math.floor(maxHpValue / 100) + Math.floor(vit / 4));
}

export function spRegenIntervalMs(sitting: boolean): number {
  return sitting ? 2000 : 4000;
}

/** SP back per regen tick: a share of max SP, plus one for every 4 INT. */
export function spRegenAmount(maxSpValue: number, int: number): number {
  return Math.max(1, 1 + Math.floor(maxSpValue / 40) + Math.floor(int / 4));
}

// ---- Inventory and trade ---------------------------------------------------

export function maxWeight(str: number): number {
  return 800 + 30 * str;
}

/** At or above this share of max weight, natural HP/SP regeneration stops. */
export const WEIGHT_NO_REGEN = 0.5;
/** At or above this share, the player can't attack. */
export const WEIGHT_NO_ATTACK = 0.9;

/** What an NPC pays for an item. */
export function sellPrice(price: number): number {
  return Math.floor(price / 2);
}

// ---- Refining ------------------------------------------------------------

/** Chance that refining to `nextLevel` succeeds. Up to +4 is always safe. */
const REFINE_CHANCE = [1, 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

export function refineChance(nextLevel: number): number {
  return REFINE_CHANCE[nextLevel - 1] ?? 0;
}

/** Gold per refine attempt, on top of one ore. */
export function refineCost(nextLevel: number): number {
  return 100 * nextLevel;
}

export const REFINE_ORE = 'brightstone';

// ---- Movement ------------------------------------------------------------

/** Diagonal steps take √2 as long as straight ones. */
export function stepDurationMs(moveMs: number, diagonal: boolean): number {
  return diagonal ? Math.round(moveMs * Math.SQRT2) : moveMs;
}

export const PLAYER_MOVE_MS = 150;
export const PLAYER_RESPAWN_MS = 3000;
export const DROP_LIFETIME_MS = 60_000;
/** How close (tiles) the player must be to talk to an NPC. */
export const TALK_RANGE = 2;
