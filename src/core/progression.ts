import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import { createMover, type Player } from './entities';
import type { Tile } from './grid';
import { JOBS, jobOf, NOVICE_JOB_CHANGE, type JobId } from './jobs';
import { learnBlocker, skillLevel, skillStatBonus, type SkillId } from './skills';
import { gearBonus, weaponOf } from './equipment';
import { petBonus } from './pets';
import { BLIND_FACTOR } from './status';

export interface DerivedStats {
  maxHp: number;
  maxSp: number;
  atk: number;
  matk: number;
  hit: number;
  flee: number;
  def: number;
  crit: number;
  aspd: number;
  attackDelayMs: number;
}

/** Base stats plus gear, passive and buff bonuses: what every formula should use. */
export function effectiveStats(p: Player): F.Stats {
  const b = allBonus(p);
  const k = skillStatBonus(p);
  return {
    str: p.stats.str + b.str + k.str,
    agi: p.stats.agi + b.agi + k.agi,
    vit: p.stats.vit + b.vit + k.vit,
    int: p.stats.int + b.int + k.int,
    dex: p.stats.dex + b.dex + k.dex,
    luk: p.stats.luk + b.luk + k.luk,
  };
}

export function derivedStats(p: Player): DerivedStats {
  const s = effectiveStats(p);
  const gear = allBonus(p);
  const blind = p.statuses.has('blind') ? BLIND_FACTOR : 1;
  const job = jobOf(p);
  const weapon = weaponOf(p);
  const aspd = F.aspd(s.agi, s.dex, weapon.type);
  const mastery = weapon.type === 'dagger' || weapon.type === 'sword' ? 4 * skillLevel(p, 'sword_mastery') : 0;
  return {
    maxHp: Math.floor(F.maxHp(p.baseLevel, s.vit) * job.hpFactor * (1 + 0.02 * skillLevel(p, 'basic_training'))) + gear.hp,
    maxSp: Math.floor(F.maxSp(p.baseLevel, s.int) * job.spFactor) + gear.sp,
    atk: F.statusAtk(s) + weapon.atk + mastery + gear.atk,
    matk: F.statusMatk(s.int) + weapon.matk + gear.matk,
    hit: Math.floor((F.hit(p.baseLevel, s.dex) + gear.hit + skillLevel(p, 'vultures_eye')) * blind),
    flee: Math.floor((F.flee(p.baseLevel, s.agi) + gear.flee) * blind),
    def: F.softDef(s.vit) + gear.def,
    crit: F.critChance(s.luk),
    aspd,
    attackDelayMs: F.attackDelayMs(aspd),
  };
}

/** Gear and pet bonuses added together. */
function allBonus(p: Player): ReturnType<typeof gearBonus> {
  const total = gearBonus(p);
  for (const [k, v] of Object.entries(petBonus(p.pet))) total[k as keyof typeof total] += v ?? 0;
  return total;
}

export function createPlayer(name: string, start: Tile): Player {
  const p: Player = {
    ...createMover(start, F.PLAYER_MOVE_MS),
    id: 'player',
    name,
    baseLevel: 1,
    jobLevel: 1,
    jobId: 'novice',
    skills: new Map(),
    buffs: new Map(),
    cooldowns: new Map(),
    casting: null,
    statuses: new Map(),
    quests: { active: new Map(), done: new Map() },
    baseXp: 0,
    jobXp: 0,
    stats: { str: 5, agi: 5, vit: 5, int: 1, dex: 5, luk: 1 },
    statPoints: 20,
    skillPoints: 0,
    equipment: {},
    hp: 0,
    sp: 0,
    sitting: false,
    dead: false,
    respawnIn: 0,
    intent: { kind: 'none' },
    attackCooldown: 0,
    hpRegenTimer: 0,
    spRegenTimer: 0,
    inventory: new Map(),
    gear: [],
    gold: 0,
    savePoint: { map: '', ...start },
    pet: null,
  };
  const d = derivedStats(p);
  p.hp = d.maxHp;
  p.sp = d.maxSp;
  return p;
}

export interface LevelUps {
  base: number[];
  job: number[];
}

/** Adds XP, applying every level-up it causes. Level-ups fully restore HP and SP. */
export function gainXp(p: Player, baseXp: number, jobXp: number): LevelUps {
  const ups: LevelUps = { base: [], job: [] };

  p.baseXp += baseXp;
  while (p.baseLevel < F.MAX_BASE_LEVEL && p.baseXp >= F.baseXpToNext(p.baseLevel)) {
    p.baseXp -= F.baseXpToNext(p.baseLevel);
    p.baseLevel += 1;
    p.statPoints += F.statPointsForLevel(p.baseLevel);
    ups.base.push(p.baseLevel);
  }
  if (p.baseLevel >= F.MAX_BASE_LEVEL) p.baseXp = 0;

  const job = jobOf(p);
  const jobNeed = () => F.jobXpToNext(p.jobLevel, job.jobXpFactor);
  p.jobXp += jobXp;
  while (p.jobLevel < job.maxJobLevel && p.jobXp >= jobNeed()) {
    p.jobXp -= jobNeed();
    p.jobLevel += 1;
    p.skillPoints += 1;
    ups.job.push(p.jobLevel);
  }
  if (p.jobLevel >= job.maxJobLevel) p.jobXp = Math.min(p.jobXp, jobNeed() - 1);

  if (ups.base.length > 0) {
    const d = derivedStats(p);
    p.hp = d.maxHp;
    p.sp = d.maxSp;
  }
  return ups;
}

/** Spends stat points to raise one stat by 1. Returns false if not allowed. */
export function raiseStat(p: Player, stat: StatName): boolean {
  const current = p.stats[stat];
  const cost = F.statRaiseCost(current);
  if (current >= F.MAX_STAT || p.statPoints < cost) return false;
  p.statPoints -= cost;
  p.stats[stat] = current + 1;
  const d = derivedStats(p);
  p.hp = Math.min(p.hp, d.maxHp);
  p.sp = Math.min(p.sp, d.maxSp);
  return true;
}

export function applyDeathPenalty(p: Player): number {
  const loss = Math.min(p.baseXp, F.deathXpPenalty(p.baseLevel));
  p.baseXp -= loss;
  return loss;
}

/** Spends one skill point. Returns why not, or null on success. */
export function learnSkill(p: Player, id: SkillId): string | null {
  const blocker = learnBlocker(p, id);
  if (blocker) return blocker;
  p.skills.set(id, skillLevel(p, id) + 1);
  p.skillPoints -= 1;
  const d = derivedStats(p);
  p.hp = Math.min(p.hp, d.maxHp);
  return null;
}

/** Why the player can't become `to` right now, or null if they can. */
export function jobChangeBlocker(p: Player, to: JobId): string | null {
  const from = jobOf(p);
  if (!from.next.includes(to)) return `A ${from.name} can't become a ${JOBS[to].name}.`;
  if (from.id === 'novice') {
    if (p.jobLevel < NOVICE_JOB_CHANGE.jobLevel) return `Reach job level ${NOVICE_JOB_CHANGE.jobLevel} first.`;
    if (skillLevel(p, 'basic_training') < NOVICE_JOB_CHANGE.basicTraining) {
      return `Learn Basic Training to level ${NOVICE_JOB_CHANGE.basicTraining} first.`;
    }
  }
  return null;
}

/** Changes job: job level resets to 1, skills and unspent points carry over, HP and SP refill. */
export function changeJob(p: Player, to: JobId): string | null {
  const blocker = jobChangeBlocker(p, to);
  if (blocker) return blocker;
  p.jobId = to;
  p.jobLevel = 1;
  p.jobXp = 0;
  const d = derivedStats(p);
  p.hp = d.maxHp;
  p.sp = d.maxSp;
  return null;
}
