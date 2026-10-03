import type { Player } from './entities';
import type { Element, Stats, WeaponType } from './combat/formulas';
import { jobLineage, type JobId } from './jobs';

export type SkillId =
  | 'basic_training'
  | 'sword_mastery'
  | 'hp_recovery'
  | 'bash'
  | 'magnum_break'
  | 'endure'
  | 'sp_recovery'
  | 'fire_bolt'
  | 'cold_bolt'
  | 'lightning_bolt'
  | 'soul_strike'
  | 'owls_eye'
  | 'vultures_eye'
  | 'improve_concentration'
  | 'double_strafe'
  | 'arrow_shower'
  | 'heal'
  | 'divine_protection'
  | 'blessing'
  | 'increase_agi'
  | 'holy_light';

export interface SkillDef {
  id: SkillId;
  name: string;
  job: JobId;
  maxLevel: number;
  /** passive: always on. enemy: needs a target in melee range. self: buff. area: hits around you. */
  kind: 'passive' | 'enemy' | 'self' | 'area';
  requires: Array<{ id: SkillId; level: number }>;
  spCost: (level: number) => number;
  /** Time before the skill can be used again, in ms. */
  cooldownMs: number;
  describe: (level: number) => string;
  /** Short label for the HUD button. */
  short: string;
  /** How far away (tiles) an enemy skill can be used from. Defaults to melee. */
  range?: number;
  /** Base cast time in ms before DEX reduction; 0 or absent means instant. */
  castMs?: (level: number) => number;
  /** Magic attacks: always hit, use MATK, one damage number per hit. */
  magic?: { element: Element; hits: (level: number) => number; perHit: (level: number) => number };
  /** Self buffs: how long the buff lasts, in ms. */
  buffMs?: (level: number) => number;
  /** Reaches as far as the equipped weapon (bows shoot from afar). */
  weaponRange?: boolean;
  /** Only usable with this weapon type equipped. */
  needsWeapon?: WeaponType;
}

const SPELL_RANGE = 9;

function bolt(id: SkillId, name: string, element: Element, short: string): SkillDef {
  return {
    id,
    name,
    job: 'mage',
    maxLevel: 10,
    kind: 'enemy',
    requires: [],
    spCost: (lv) => 10 + 2 * lv,
    cooldownMs: 0,
    describe: (lv) => `${lv} ${element} bolt${lv > 1 ? 's' : ''}, each for 100% MATK. Cast ${(boltCast(lv) / 1000).toFixed(1)} s before DEX.`,
    short,
    range: SPELL_RANGE,
    castMs: boltCast,
    magic: { element, hits: (lv) => lv, perHit: () => 1 },
  };
}

function boltCast(lv: number): number {
  return 300 + 250 * lv;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  basic_training: {
    id: 'basic_training',
    name: 'Basic Training',
    job: 'novice',
    maxLevel: 9,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `+${2 * lv}% max HP. Level 9 is required to change job.`,
    short: 'Basic',
  },
  sword_mastery: {
    id: 'sword_mastery',
    name: 'Sword Mastery',
    job: 'swordsman',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `+${4 * lv} ATK with daggers and swords.`,
    short: 'Mastery',
  },
  hp_recovery: {
    id: 'hp_recovery',
    name: 'Increase HP Recovery',
    job: 'swordsman',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `+${2 * lv} HP per natural recovery tick, potions heal ${10 * lv}% more.`,
    short: 'HP Rec',
  },
  bash: {
    id: 'bash',
    name: 'Bash',
    job: 'swordsman',
    maxLevel: 10,
    kind: 'enemy',
    requires: [],
    spCost: (lv) => (lv <= 5 ? 8 : 15),
    cooldownMs: 0,
    describe: (lv) => `A heavy blow: ${100 + 30 * lv}% damage, +${5 * lv}% hit chance.`,
    short: 'Bash',
  },
  magnum_break: {
    id: 'magnum_break',
    name: 'Magnum Break',
    job: 'swordsman',
    maxLevel: 10,
    kind: 'area',
    requires: [{ id: 'bash', level: 5 }],
    spCost: () => 30,
    cooldownMs: 2000,
    describe: (lv) => `Fire burst hitting everything within 2 tiles for ${100 + 20 * lv}% damage.`,
    short: 'Magnum',
  },
  endure: {
    id: 'endure',
    name: 'Endure',
    job: 'swordsman',
    maxLevel: 10,
    kind: 'self',
    requires: [{ id: 'bash', level: 3 }],
    spCost: () => 10,
    cooldownMs: 10_000,
    describe: (lv) => `Take ${3 * lv}% less damage for ${10 + 3 * lv} s.`,
    short: 'Endure',
    buffMs: (lv) => endureDurationMs(lv),
  },
  sp_recovery: {
    id: 'sp_recovery',
    name: 'Increase SP Recovery',
    job: 'mage',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `+${lv} SP per natural recovery tick.`,
    short: 'SP Rec',
  },
  fire_bolt: bolt('fire_bolt', 'Fire Bolt', 'fire', 'Fire'),
  cold_bolt: bolt('cold_bolt', 'Cold Bolt', 'water', 'Cold'),
  lightning_bolt: bolt('lightning_bolt', 'Lightning Bolt', 'wind', 'Bolt'),
  soul_strike: {
    id: 'soul_strike',
    name: 'Soul Strike',
    job: 'mage',
    maxLevel: 10,
    kind: 'enemy',
    requires: [],
    spCost: (lv) => 14 + 2 * lv,
    cooldownMs: 0,
    describe: (lv) => `${Math.ceil(lv / 2)} ghost strike${lv > 1 ? 's' : ''}, each for 100% MATK. Almost instant.`,
    short: 'Soul',
    range: SPELL_RANGE,
    castMs: () => 300,
    magic: { element: 'ghost', hits: (lv) => Math.ceil(lv / 2), perHit: () => 1 },
  },
  owls_eye: {
    id: 'owls_eye',
    name: "Owl's Eye",
    job: 'archer',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `DEX +${lv}.`,
    short: 'Owl',
  },
  vultures_eye: {
    id: 'vultures_eye',
    name: "Vulture's Eye",
    job: 'archer',
    maxLevel: 10,
    kind: 'passive',
    requires: [{ id: 'owls_eye', level: 3 }],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `HIT +${lv}, bow range +${Math.floor(lv / 2)} tiles.`,
    short: 'Vulture',
  },
  improve_concentration: {
    id: 'improve_concentration',
    name: 'Improve Concentration',
    job: 'archer',
    maxLevel: 10,
    kind: 'self',
    requires: [{ id: 'vultures_eye', level: 1 }],
    spCost: (lv) => 20 + 3 * lv,
    cooldownMs: 0,
    describe: (lv) => `AGI and DEX +${1 + lv} for ${buffSeconds(lv)} s.`,
    short: 'Focus',
    buffMs: (lv) => buffSeconds(lv) * 1000,
  },
  double_strafe: {
    id: 'double_strafe',
    name: 'Double Strafe',
    job: 'archer',
    maxLevel: 10,
    kind: 'enemy',
    requires: [],
    spCost: () => 12,
    cooldownMs: 0,
    describe: (lv) => `Two arrows at once, each for ${Math.round(doubleStrafeModifier(lv) * 100)}% damage. Needs a bow.`,
    short: 'Double',
    weaponRange: true,
    needsWeapon: 'bow',
  },
  arrow_shower: {
    id: 'arrow_shower',
    name: 'Arrow Shower',
    job: 'archer',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'double_strafe', level: 5 }],
    spCost: () => 15,
    cooldownMs: 1000,
    describe: (lv) => `Rains arrows on the target and everything next to it for ${Math.round(arrowShowerModifier(lv) * 100)}% damage. Needs a bow.`,
    short: 'Shower',
    weaponRange: true,
    needsWeapon: 'bow',
  },
  heal: {
    id: 'heal',
    name: 'Heal',
    job: 'acolyte',
    maxLevel: 10,
    kind: 'self',
    requires: [],
    spCost: (lv) => 10 + 3 * lv,
    cooldownMs: 500,
    describe: (lv) => `Restores (base level + INT) / 8 × ${4 + 8 * lv} HP.`,
    short: 'Heal',
  },
  divine_protection: {
    id: 'divine_protection',
    name: 'Divine Protection',
    job: 'acolyte',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `Take ${4 * lv}% less damage from undead and shadow monsters.`,
    short: 'Divine',
  },
  blessing: {
    id: 'blessing',
    name: 'Blessing',
    job: 'acolyte',
    maxLevel: 10,
    kind: 'self',
    requires: [{ id: 'divine_protection', level: 3 }],
    spCost: (lv) => 20 + 2 * lv,
    cooldownMs: 0,
    describe: (lv) => `STR, INT and DEX +${lv} for ${buffSeconds(lv)} s.`,
    short: 'Bless',
    buffMs: (lv) => buffSeconds(lv) * 1000,
  },
  increase_agi: {
    id: 'increase_agi',
    name: 'Increase AGI',
    job: 'acolyte',
    maxLevel: 10,
    kind: 'self',
    requires: [{ id: 'heal', level: 3 }],
    spCost: (lv) => 18 + 3 * lv,
    cooldownMs: 0,
    describe: (lv) => `AGI +${2 + lv} and move 25% faster for ${buffSeconds(lv)} s.`,
    short: 'AGI Up',
    buffMs: (lv) => buffSeconds(lv) * 1000,
  },
  holy_light: {
    id: 'holy_light',
    name: 'Holy Light',
    job: 'acolyte',
    maxLevel: 5,
    kind: 'enemy',
    requires: [{ id: 'heal', level: 1 }],
    spCost: (lv) => 13 + 2 * lv,
    cooldownMs: 0,
    describe: (lv) => `A holy ray for ${100 + 25 * lv}% MATK. Deadly to undead and shadow. Cast 1.5 s before DEX.`,
    short: 'Holy',
    range: SPELL_RANGE,
    castMs: () => 1500,
    magic: { element: 'holy', hits: () => 1, perHit: holyLightModifier },
  },
};

export const SKILL_IDS = new Set<string>(Object.keys(SKILLS));

export function isSkillId(id: string): id is SkillId {
  return SKILL_IDS.has(id);
}

export function skillLevel(p: Pick<Player, 'skills'>, id: string): number {
  return p.skills.get(id) ?? 0;
}

/** Skills shown to a player: their job's and every earlier job's. */
export function skillsFor(jobId: JobId): SkillDef[] {
  const line = jobLineage(jobId);
  return Object.values(SKILLS).filter((s) => line.includes(s.job));
}

/** Why a skill point can't go into this skill, or null if it can. */
export function learnBlocker(p: Pick<Player, 'skills' | 'skillPoints' | 'jobId'>, id: SkillId): string | null {
  const s = SKILLS[id];
  if (!jobLineage(p.jobId).includes(s.job)) return `Only a ${s.job} can learn this.`;
  if (skillLevel(p, id) >= s.maxLevel) return 'Already mastered.';
  for (const r of s.requires) {
    if (skillLevel(p, r.id) < r.level) return `Needs ${SKILLS[r.id].name} level ${r.level}.`;
  }
  if (p.skillPoints < 1) return 'No skill points left.';
  return null;
}

// ---- Effects used by the combat code ----------------------------------------

export function bashModifier(lv: number): number {
  return 1 + 0.3 * lv;
}

export function bashHitBonus(lv: number): number {
  return 0.05 * lv;
}

export function magnumModifier(lv: number): number {
  return 1 + 0.2 * lv;
}

export const MAGNUM_RADIUS = 2;
export const MAGNUM_HIT_BONUS = 0.2;

export function endureReduction(lv: number): number {
  return 0.03 * lv;
}

export function endureDurationMs(lv: number): number {
  return (10 + 3 * lv) * 1000;
}

// ---- Archer and Acolyte -------------------------------------------------------

/** Auto-attack range with a bow, before Vulture's Eye. */
export const BOW_RANGE = 5;

function buffSeconds(lv: number): number {
  return 60 + 20 * lv;
}

export function doubleStrafeModifier(lv: number): number {
  return 0.9 + 0.1 * lv;
}

export function arrowShowerModifier(lv: number): number {
  return 0.75 + 0.05 * lv;
}

export const ARROW_SHOWER_RADIUS = 1;

export function holyLightModifier(lv: number): number {
  return 1 + 0.25 * lv;
}

export function healAmount(baseLevel: number, int: number, lv: number): number {
  return Math.max(1, Math.floor((baseLevel + int) / 8)) * (4 + 8 * lv);
}

export function divineProtectionReduction(lv: number): number {
  return 0.04 * lv;
}

/** Increase AGI's move speed: step time is multiplied by this. */
export const INCREASE_AGI_MOVE = 0.75;

/** Stat bonuses from passives and active buffs. */
export function skillStatBonus(p: Pick<Player, 'skills' | 'buffs'>): Stats {
  const out: Stats = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  out.dex += skillLevel(p, 'owls_eye');
  const ic = p.buffs.get('improve_concentration');
  if (ic) {
    out.agi += 1 + ic.level;
    out.dex += 1 + ic.level;
  }
  const bless = p.buffs.get('blessing');
  if (bless) {
    out.str += bless.level;
    out.int += bless.level;
    out.dex += bless.level;
  }
  const agi = p.buffs.get('increase_agi');
  if (agi) out.agi += 2 + agi.level;
  return out;
}
