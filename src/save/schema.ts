import { z } from 'zod';
import { STAT_NAMES } from '../core/combat/formulas';
import { EQUIP_SLOTS } from '../core/equipment';
import { JOBS, type JobId } from '../core/jobs';

export const SAVE_SCHEMA_VERSION = 4;

const Place = z.object({ map: z.string(), x: z.number().int(), y: z.number().int() });
const Counts = z.record(z.string(), z.number().int().positive());

/** One slot's full player state. Monsters and ground loot are not saved; they respawn on load. */
export const SaveDocSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  savedAt: z.number(),
  playtimeMs: z.number().nonnegative(),
  character: z.object({
    name: z.string().min(1).max(24),
    jobId: z.enum(Object.keys(JOBS) as [JobId, ...JobId[]]),
    baseLevel: z.number().int().min(1),
    jobLevel: z.number().int().min(1),
    skills: z.record(z.string(), z.number().int().positive()),
    baseXp: z.number().int().nonnegative(),
    jobXp: z.number().int().nonnegative(),
    stats: z.object(Object.fromEntries(STAT_NAMES.map((s) => [s, z.number().int().min(1)])) as Record<
      (typeof STAT_NAMES)[number],
      z.ZodNumber
    >),
    statPoints: z.number().int().nonnegative(),
    skillPoints: z.number().int().nonnegative(),
    /** Equipped item ids by slot. */
    equipment: z.partialRecord(z.enum(EQUIP_SLOTS), z.string()),
    hp: z.number().int().nonnegative(),
    sp: z.number().int().nonnegative(),
  }),
  inventory: Counts,
  gold: z.number().int().nonnegative(),
  /** Kafra-style item storage; unused until towns exist. */
  storage: Counts,
  quests: z.record(z.string(), z.unknown()),
  flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  position: Place,
  savePoint: Place,
});
export type SaveDoc = z.infer<typeof SaveDocSchema>;

/** Summary shown on the title screen without loading the whole save. */
export interface SlotMeta {
  id: number;
  name: string;
  jobName: string;
  baseLevel: number;
  jobLevel: number;
  playtimeMs: number;
  savedAt: number;
}

export function slotMetaFrom(id: number, doc: SaveDoc): SlotMeta {
  const c = doc.character;
  return {
    id,
    name: c.name,
    jobName: JOBS[c.jobId].name,
    baseLevel: c.baseLevel,
    jobLevel: c.jobLevel,
    playtimeMs: doc.playtimeMs,
    savedAt: doc.savedAt,
  };
}
