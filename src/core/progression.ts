import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import { createMover, type Player } from './entities';
import type { Tile } from './grid';
import { JOBS, jobOf, NOVICE_JOB_CHANGE, type JobId } from './jobs';
import { learnBlocker, skillLevel, type SkillId } from './skills';
import { gearBonus, weaponOf } from './equipment';

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

/** Base stats plus gear bonuses: what every formula should use. */
export function effectiveStats(p: Player): F.Stats {
  const b = gearBonus(p);
  return { str: p.stats.str + b.str, agi: p.stats.agi + b.agi, vit: p.stats.vit + b.vit, int: p.stats.int + b.int, dex: p.stats.dex + b.dex, luk: p.stats.luk + b.luk };
}

export function derivedStats(p: Player): DerivedStats {
  const s = effectiveStats(p);
  const gear = gearBonus(p);
  const job = jobOf(p);
  const weapon = weaponOf(p);
  const aspd = F.aspd(s.agi, s.dex, weapon.type);
  const mastery = weapon.type === 'dagger' || weapon.type === 'sword' ? 4 * skillLevel(p, 'sword_mastery') : 0;
  return {
    maxHp: Math.floor(F.maxHp(p.baseLevel, s.vit) * job.hpFactor * (1 + 0.02 * skillLevel(p, 'basic_training'))) + gear.hp,
    maxSp: Math.floor(F.maxSp(p.baseLevel, s.int) * job.spFactor) + gear.sp,
    atk: F.statusAtk(s) + weapon.atk + mastery,
    matk: F.statusMatk(s.int) + (p.equipment.weapon?.equip?.matk ?? 0),
    hit: F.hit(p.baseLevel, s.dex) + gear.hit,
    flee: F.flee(p.baseLevel, s.agi) + gear.flee,
    def: F.softDef(s.vit) + gear.def,
    crit: F.critChance(s.luk),
    aspd,
    attackDelayMs: F.attackDelayMs(aspd),
  };
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
    gold: 0,
    savePoint: { map: '', ...start },
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
