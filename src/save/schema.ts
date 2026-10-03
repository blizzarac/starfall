import { z } from 'zod';
import { STAT_NAMES } from '../core/combat/formulas';
import { EQUIP_SLOTS } from '../core/equipment';
import { JOBS, type JobId } from '../core/jobs';

export const SAVE_SCHEMA_VERSION = 7;

const Place = z.object({ map: z.string(), x: z.number().int(), y: z.number().int() });
const Counts = z.record(z.string(), z.number().int().positive());

/** One piece of gear: which item, how far it's refined, which cards are slotted. */
const PieceSchema = z.object({
  item: z.string(),
  refine: z.number().int().min(0).max(10).default(0),
  cards: z.array(z.string()).default([]),
});
export type SavedPiece = z.infer<typeof PieceSchema>;

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
    equipment: z.partialRecord(z.enum(EQUIP_SLOTS), PieceSchema),
    hp: z.number().int().nonnegative(),
    sp: z.number().int().nonnegative(),
  }),
  /** Stackable items. */
  inventory: Counts,
  /** Unequipped gear pieces. */
  gear: z.array(PieceSchema),
  gold: z.number().int().nonnegative(),
  /** Unused: storage is shared by every slot and saved on its own (see StorageDocSchema). */
  storage: Counts,
  /** Active hunts (kills so far) and how often each hunt was completed. */
  quests: z.object({ active: z.record(z.string(), z.number().int().nonnegative()), done: z.record(z.string(), z.number().int().nonnegative()) }),
  flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  position: Place,
  savePoint: Place,
  /** The tamed pet, if any. */
  pet: z
    .object({
      species: z.string(),
      name: z.string().min(1).max(24),
      intimacy: z.number().int().min(0).max(1000),
      hunger: z.number().int().min(0).max(100),
    })
    .nullable(),
});
export type SaveDoc = z.infer<typeof SaveDocSchema>;

/** The shared storage, kept once for all slots (not inside any save). */
export const StorageDocSchema = z.object({
  items: Counts.default({}),
  gear: z.array(PieceSchema).default([]),
});
export type StorageDoc = z.infer<typeof StorageDocSchema>;

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
