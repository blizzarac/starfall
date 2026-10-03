import type { Player } from './entities';

export type StatusId = 'poison' | 'stun' | 'blind';
export const STATUS_IDS: readonly StatusId[] = ['poison', 'stun', 'blind'];

export const STATUS_INFO: Record<StatusId, { name: string; color: string; describe: string }> = {
  poison: { name: 'Poisoned', color: '#9be36a', describe: 'Loses 2% HP every second (never below 1) and no natural recovery.' },
  stun: { name: 'Stunned', color: '#ffe27a', describe: "Can't move, attack or use skills." },
  blind: { name: 'Blinded', color: '#b8a4ff', describe: 'HIT and FLEE are cut by a quarter.' },
};

/** Which stat resists each status: every point cuts the chance by 1% and the duration by 0.5%. */
const RESIST_STAT: Record<StatusId, 'vit' | 'int'> = { poison: 'vit', stun: 'vit', blind: 'int' };

export function resistedChance(status: StatusId, chance: number, stats: { vit: number; int: number }): number {
  return Math.max(0, chance * (1 - stats[RESIST_STAT[status]] / 100));
}

export function resistedDuration(status: StatusId, ms: number, stats: { vit: number; int: number }): number {
  return Math.round(ms * Math.max(0.2, 1 - stats[RESIST_STAT[status]] / 200));
}

export const POISON_TICK_MS = 1000;

export function poisonDamage(maxHp: number): number {
  return Math.max(1, Math.floor(maxHp * 0.02));
}

/** HIT/FLEE multiplier while blind. */
export const BLIND_FACTOR = 0.75;

export function has(p: Pick<Player, 'statuses'>, id: StatusId): boolean {
  return p.statuses.has(id);
}
