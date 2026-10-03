import type { QuestDef } from '../data/schemas';
import type { Player } from './entities';

/** How many hunts can be on the go at once. */
export const MAX_ACTIVE_QUESTS = 3;

export type QuestState = 'locked' | 'available' | 'active' | 'ready';

export function questState(p: Pick<Player, 'quests' | 'baseLevel'>, q: QuestDef): QuestState {
  const progress = p.quests.active.get(q.id);
  if (progress !== undefined) return progress >= q.target.count ? 'ready' : 'active';
  if (p.baseLevel < q.minLevel) return 'locked';
  if (!q.repeatable && (p.quests.done.get(q.id) ?? 0) > 0) return 'locked';
  return 'available';
}
