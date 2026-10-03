import type { QuestDef } from '../data/schemas';
import type { Player } from './entities';

/** How many hunts can be on the go at once. */
export const MAX_ACTIVE_QUESTS = 3;

export type QuestState = 'locked' | 'available' | 'active' | 'ready' | 'done';

/** Gold added to the standing bounty for each monster defeated (bosses pay far more). */
export function bountyFor(monster: { level: number; boss?: boolean }): number {
  return monster.boss ? monster.level * 20 : Math.floor(monster.level / 2) + 1;
}

export function questState(p: Pick<Player, 'quests' | 'baseLevel'>, q: QuestDef): QuestState {
  const progress = p.quests.active.get(q.id);
  if (progress !== undefined) return progress >= q.target.count ? 'ready' : 'active';
  if (!q.repeatable && (p.quests.done.get(q.id) ?? 0) > 0) return 'done';
  if (p.baseLevel < q.minLevel) return 'locked';
  return 'available';
}
