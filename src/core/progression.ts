import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import { createMover, type Player } from './entities';
import type { Tile } from './grid';

export interface DerivedStats {
  maxHp: number;
  maxSp: number;
  atk: number;
  hit: number;
  flee: number;
  def: number;
  crit: number;
  aspd: number;
  attackDelayMs: number;
}

export function derivedStats(p: Player): DerivedStats {
  const s = p.stats;
  const aspd = F.aspd(s.agi, s.dex, p.weapon.type);
  return {
    maxHp: F.maxHp(p.baseLevel, s.vit),
    maxSp: F.maxSp(p.baseLevel, s.int),
    atk: F.statusAtk(s) + p.weapon.atk,
    hit: F.hit(p.baseLevel, s.dex),
    flee: F.flee(p.baseLevel, s.agi),
    def: F.softDef(s.vit),
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
    jobName: 'Novice',
    maxJobLevel: 10,
    baseXp: 0,
    jobXp: 0,
    stats: { str: 5, agi: 5, vit: 5, int: 1, dex: 5, luk: 1 },
    statPoints: 20,
    skillPoints: 0,
    weapon: { type: 'dagger', atk: 17 },
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

  p.jobXp += jobXp;
  while (p.jobLevel < p.maxJobLevel && p.jobXp >= F.jobXpToNext(p.jobLevel)) {
    p.jobXp -= F.jobXpToNext(p.jobLevel);
    p.jobLevel += 1;
    p.skillPoints += 1;
    ups.job.push(p.jobLevel);
  }
  if (p.jobLevel >= p.maxJobLevel) p.jobXp = Math.min(p.jobXp, F.jobXpToNext(p.jobLevel) - 1);

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
