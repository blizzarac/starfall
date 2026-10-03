import type { z } from 'zod';
import { SAVE_SCHEMA_VERSION, SaveDocSchema, type SaveDoc } from './schema';

type Migration = (prev: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version n-1 document to version n.
 * When the save format changes: bump SAVE_SCHEMA_VERSION, update the schema,
 * and add the step here. Never edit a released step.
 */
export const MIGRATIONS: Record<number, Migration> = {};

/** Upgrades any older save to the current version, then validates it. Throws if it can't. */
export function migrate(raw: unknown): SaveDoc;
export function migrate<T>(raw: unknown, migrations: Record<number, Migration>, target: number, schema: z.ZodType<T>): T;
export function migrate(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SAVE_SCHEMA_VERSION,
  schema: z.ZodType<unknown> = SaveDocSchema,
): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('Save is not an object');
  let doc = raw as Record<string, unknown>;
  const from = doc.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) throw new Error('Save has no valid schemaVersion');
  if (from > target) throw new Error(`Save is from a newer version of the game (v${from})`);
  for (let v = from + 1; v <= target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration to save version ${v}`);
    doc = { ...step(doc), schemaVersion: v };
  }
  return schema.parse(doc);
}
