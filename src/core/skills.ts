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
  | 'holy_light'
  | 'pierce'
  | 'bowling_bash'
  | 'two_hand_quicken'
  | 'riding'
  | 'two_hand_mastery'
  | 'battle_aura'
  | 'holy_aura'
  | 'sight_rasher'
  | 'thunderstorm'
  | 'meteor_storm'
  | 'blitz_beat'
  | 'steel_crow'
  | 'claymore_trap'
  | 'kyrie_eleison'
  | 'magnus_exorcismus'
  | 'impositio_manus';

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
  /** Magic attacks: always hit, use MATK, one damage number per hit. `only` limits which elements it can hurt. */
  magic?: { element: Element; hits: (level: number) => number; perHit: (level: number) => number; only?: readonly Element[] };
  /** Area skills: hit every monster within `radius` tiles of the caster or of the target. */
  area?: { radius: number; around: 'self' | 'target' };
  /** Only usable while holding a two-handed weapon. */
  needsTwoHanded?: boolean;
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
  return 200 + 150 * lv;
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
    describe: (lv) => `+${6 * lv} SP and +${(lv * SP_RECOVERY_SHARE * 100).toFixed(1).replace(/\.0$/, '')}% of max SP per natural recovery tick; SP potions restore ${10 * lv}% more.`,
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
    spCost: (lv) => 11 + lv,
    cooldownMs: 0,
    describe: (lv) => `A holy ray for ${Math.round(holyLightModifier(lv) * 100)}% MATK. Deadly to undead and shadow. Cast 1 s before DEX.`,
    short: 'Holy',
    range: SPELL_RANGE,
    castMs: () => 1000,
    magic: { element: 'holy', hits: () => 1, perHit: holyLightModifier },
  },

  // ---- Knight ----
  pierce: {
    id: 'pierce',
    name: 'Pierce',
    job: 'knight',
    maxLevel: 10,
    kind: 'enemy',
    requires: [],
    spCost: () => 7,
    cooldownMs: 0,
    describe: (lv) => `${100 + 10 * lv}% damage, hitting small monsters once, medium twice and large three times. +${5 * lv}% hit.`,
    short: 'Pierce',
  },
  bowling_bash: {
    id: 'bowling_bash',
    name: 'Bowling Bash',
    job: 'knight',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'bash', level: 5 }],
    spCost: (lv) => 12 + lv,
    cooldownMs: 1000,
    describe: (lv) => `Smashes the target into everything next to it for ${100 + 40 * lv}% damage.`,
    short: 'Bowling',
  },
  two_hand_quicken: {
    id: 'two_hand_quicken',
    name: 'Two-Hand Quicken',
    job: 'knight',
    maxLevel: 10,
    kind: 'self',
    requires: [],
    spCost: (lv) => 10 + 4 * lv,
    cooldownMs: 0,
    describe: (lv) => `Attack 30% faster with a two-handed sword for ${30 * lv} s.`,
    short: 'Quicken',
    buffMs: (lv) => 30_000 * lv,
    needsTwoHanded: true,
  },
  riding: {
    id: 'riding',
    name: 'Riding',
    job: 'knight',
    maxLevel: 1,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: () => 'Ride a trusty mount: move 20% faster.',
    short: 'Ride',
  },
  two_hand_mastery: {
    id: 'two_hand_mastery',
    name: 'Two-Hand Mastery',
    job: 'knight',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `+${TWO_HAND_MASTERY_ATK * lv} ATK and +${lv}% critical chance with a two-handed sword.`,
    short: '2H Mastery',
  },
  battle_aura: {
    id: 'battle_aura',
    name: 'Battle Aura',
    job: 'knight',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `A fighting spirit burns around you: every second, monsters attacking you within ${auraRadius(lv)} tile${auraRadius(lv) > 1 ? 's' : ''} take ${auraPercent(lv)}% of your ATK. It never misses.`,
    short: 'Aura',
  },
  holy_aura: {
    id: 'holy_aura',
    name: 'Holy Aura',
    job: 'knight',
    maxLevel: 10,
    kind: 'passive',
    requires: [],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) =>
      `A holy light surrounds you: every second, monsters attacking you within ${auraRadius(lv)} tile${auraRadius(lv) > 1 ? 's' : ''} take ${holyAuraPercent(lv)}% of your ATK as holy damage and lose ${Math.round(holyAuraDefCut(lv) * 100)}% DEF for ${HOLY_WEAKEN_MS / 1000} s.`,
    short: 'Holy',
  },

  // ---- Wizard ----
  sight_rasher: {
    id: 'sight_rasher',
    name: 'Sight Rasher',
    job: 'wizard',
    maxLevel: 10,
    kind: 'area',
    requires: [{ id: 'fire_bolt', level: 3 }],
    spCost: (lv) => 33 + 2 * lv,
    cooldownMs: 1500,
    describe: (lv) => `A ring of fire around you: ${100 + 20 * lv}% MATK to everything within 2 tiles. Instant.`,
    short: 'Rasher',
    magic: { element: 'fire', hits: () => 1, perHit: (lv) => 1 + 0.2 * lv },
    area: { radius: 2, around: 'self' },
  },
  thunderstorm: {
    id: 'thunderstorm',
    name: 'Thunderstorm',
    job: 'wizard',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'lightning_bolt', level: 3 }],
    spCost: (lv) => 24 + 5 * lv,
    cooldownMs: 0,
    describe: (lv) => `${lv} lightning strike${lv > 1 ? 's' : ''} on everything within 2 tiles of the target, each for 80% MATK. Cast ${((1500 + 200 * lv) / 1000).toFixed(1)} s before DEX.`,
    short: 'Storm',
    range: SPELL_RANGE,
    castMs: (lv) => 1500 + 200 * lv,
    magic: { element: 'wind', hits: (lv) => lv, perHit: () => 0.8 },
    area: { radius: 2, around: 'target' },
  },
  meteor_storm: {
    id: 'meteor_storm',
    name: 'Meteor Storm',
    job: 'wizard',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'sight_rasher', level: 2 }, { id: 'thunderstorm', level: 1 }],
    spCost: (lv) => 20 + 6 * lv,
    cooldownMs: 2000,
    describe: (lv) => `${Math.ceil(lv / 2) + 1} meteors on everything within 2 tiles of the target, each for 125% MATK. Cast 6 s before DEX.`,
    short: 'Meteor',
    range: SPELL_RANGE,
    castMs: () => 6000,
    magic: { element: 'fire', hits: (lv) => Math.ceil(lv / 2) + 1, perHit: () => 1.25 },
    area: { radius: 2, around: 'target' },
  },

  // ---- Hunter ----
  blitz_beat: {
    id: 'blitz_beat',
    name: 'Blitz Beat',
    job: 'hunter',
    maxLevel: 5,
    kind: 'enemy',
    requires: [],
    spCost: (lv) => 7 + 3 * lv,
    cooldownMs: 0,
    describe: (lv) => `Your falcon dives ${lv} time${lv > 1 ? 's' : ''}, each for 40 + DEX + INT/2 damage. Never misses, ignores DEF.`,
    short: 'Blitz',
    weaponRange: true,
  },
  steel_crow: {
    id: 'steel_crow',
    name: 'Steel Crow',
    job: 'hunter',
    maxLevel: 10,
    kind: 'passive',
    requires: [{ id: 'blitz_beat', level: 1 }],
    spCost: () => 0,
    cooldownMs: 0,
    describe: (lv) => `Blitz Beat hits ${6 * lv} harder.`,
    short: 'Crow',
  },
  claymore_trap: {
    id: 'claymore_trap',
    name: 'Claymore Trap',
    job: 'hunter',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'arrow_shower', level: 1 }],
    spCost: () => 15,
    cooldownMs: 1500,
    describe: (lv) => `Lobs a fire trap that bursts on the target and everything next to it for ${Math.round(claymoreModifier(lv) * 100)}% damage. Never misses.`,
    short: 'Claymore',
    weaponRange: true,
  },

  // ---- Priest ----
  kyrie_eleison: {
    id: 'kyrie_eleison',
    name: 'Kyrie Eleison',
    job: 'priest',
    maxLevel: 10,
    kind: 'self',
    requires: [{ id: 'blessing', level: 2 }],
    spCost: (lv) => 20 + 2 * lv,
    cooldownMs: 0,
    describe: (lv) => `A barrier that absorbs damage up to ${10 + 2 * lv}% of your max HP. Lasts 2 minutes or until broken.`,
    short: 'Kyrie',
    buffMs: () => 120_000,
  },
  magnus_exorcismus: {
    id: 'magnus_exorcismus',
    name: 'Magnus Exorcismus',
    job: 'priest',
    maxLevel: 10,
    kind: 'enemy',
    requires: [{ id: 'holy_light', level: 1 }, { id: 'heal', level: 5 }],
    spCost: (lv) => 40 + 3 * lv,
    cooldownMs: 3000,
    describe: (lv) => `${lv} holy blast${lv > 1 ? 's' : ''} on every undead and shadow monster within 2 tiles of the target, each for 100% MATK. Cast 5 s before DEX.`,
    short: 'Magnus',
    range: SPELL_RANGE,
    castMs: () => 5000,
    magic: { element: 'holy', hits: (lv) => lv, perHit: () => 1, only: ['undead', 'shadow'] },
    area: { radius: 2, around: 'target' },
  },
  impositio_manus: {
    id: 'impositio_manus',
    name: 'Impositio Manus',
    job: 'priest',
    maxLevel: 5,
    kind: 'self',
    requires: [],
    spCost: (lv) => 10 + 3 * lv,
    cooldownMs: 0,
    describe: (lv) => `ATK +${5 * lv} for 60 s.`,
    short: 'Impos',
    buffMs: () => 60_000,
  },
};

export const SKILL_IDS = new Set<string>(Object.keys(SKILLS));

export function isSkillId(id: string): id is SkillId {
  return SKILL_IDS.has(id);
}

export function skillLevel(p: Pick<Player, 'skills'>, id: string): number {
  return p.skills.get(id) ?? 0;
}

/** Skills shown to a player: their job's first, then every earlier job's. */
export function skillsFor(jobId: JobId): SkillDef[] {
  const line = jobLineage(jobId);
  return Object.values(SKILLS)
    .filter((s) => line.includes(s.job))
    .sort((a, b) => line.indexOf(b.job) - line.indexOf(a.job));
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
/** A staff's basic attack is a magic shot from this far… */
export const STAFF_RANGE = 5;
/** …for this share of MATK: free and quick, but weaker than a bolt (100% per hit). */
export const STAFF_SHOT_MATK = 0.6;

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
  return 1.5 + 0.3 * lv;
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

// ---- Second jobs ----------------------------------------------------------

/** Pierce hits once per size step: small 1, medium 2, large 3. */
export function pierceHits(size: 'small' | 'medium' | 'large'): number {
  return size === 'small' ? 1 : size === 'medium' ? 2 : 3;
}

export function pierceModifier(lv: number): number {
  return 1 + 0.1 * lv;
}

export function bowlingModifier(lv: number): number {
  return 1 + 0.4 * lv;
}

export const BOWLING_RADIUS = 1;
/** Two-Hand Quicken multiplies the attack delay by this. */
export const QUICKEN_DELAY = 0.7;
/** Riding multiplies step time by this. */
export const RIDING_MOVE = 0.8;
/** Battle Aura: share of ATK dealt each second to monsters attacking you nearby. */
export function auraPercent(level: number): number {
  return 15 + 5 * level;
}

/** Battle Aura reaches farther from level 6. */
export function auraRadius(level: number): number {
  return level >= 6 ? 2 : 1;
}

export const AURA_TICK_MS = 1000;

/** Increase SP Recovery: extra SP per natural tick, as a share of max SP per level (on top of 6 per level). */
export const SP_RECOVERY_SHARE = 0.01;

/** Extra SP per natural recovery tick from Increase SP Recovery: grows with level and with max SP. */
export function spRecoveryBonus(level: number, maxSp: number): number {
  return level === 0 ? 0 : 6 * level + Math.floor(maxSp * SP_RECOVERY_SHARE * level);
}

/** Holy Aura: a little holy damage each second (share of ATK)… */
export function holyAuraPercent(level: number): number {
  return 5 + 2 * level;
}

/** …and a DEF cut on everything it touches: 13% at level 1 to 40% at 10. */
export function holyAuraDefCut(level: number): number {
  return (10 + 3 * level) / 100;
}

/** How long Holy Aura's DEF cut lasts after a monster leaves the light. */
export const HOLY_WEAKEN_MS = 3000;

/** ATK per level of Two-Hand Mastery, with a two-handed sword. */
export const TWO_HAND_MASTERY_ATK = 5;

export function blitzDamage(dex: number, int: number, steelCrow: number): number {
  return 40 + dex + Math.floor(int / 2) + 6 * steelCrow;
}

export function claymoreModifier(lv: number): number {
  return 1.5 + 0.3 * lv;
}

export const CLAYMORE_RADIUS = 1;

/** HP a fresh Kyrie Eleison barrier absorbs. */
export function kyrieShield(maxHp: number, lv: number): number {
  return Math.floor((maxHp * (10 + 2 * lv)) / 100);
}

export function impositioAtk(lv: number): number {
  return 5 * lv;
}
