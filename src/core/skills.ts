import type { Player } from './entities';
import { jobLineage, type JobId } from './jobs';

export type SkillId = 'basic_training' | 'sword_mastery' | 'hp_recovery' | 'bash' | 'magnum_break' | 'endure';

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
