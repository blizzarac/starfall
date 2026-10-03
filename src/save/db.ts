import Dexie, { type EntityTable } from 'dexie';
import { migrate } from './migrations';
import { slotMetaFrom, StorageDocSchema, type SaveDoc, type SlotMeta, type StorageDoc } from './schema';

export const SLOT_IDS = [1, 2, 3] as const;
/** Autosaves kept per slot; loading falls back to an older one if the newest is unreadable. */
export const KEEP_SAVES = 3;
/** Settings key holding the storage shared by every slot. */
const STORAGE_KEY = 'storage';

interface SaveRow {
  /** Auto-increment, so newer rows always sort after older ones. */
  id?: number;
  slot: number;
  savedAt: number;
  /** Stored raw: validation and migration happen on load. */
  doc: unknown;
}

interface SettingsRow {
  key: string;
  value: unknown;
}

export class SaveDb extends Dexie {
  slots!: EntityTable<SlotMeta, 'id'>;
  saves!: EntityTable<SaveRow, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor(name = 'starfall') {
    super(name);
    this.version(1).stores({
      slots: 'id',
      saves: '++id, slot, [slot+id]',
      settings: 'key',
    });
  }

  /**
   * Writes a save and its slot summary in one transaction, then trims old autosaves.
   * IndexedDB commits a transaction all-or-nothing, so a crash mid-save leaves the
   * previous save intact rather than a half-written one.
   */
  async write(slot: number, doc: SaveDoc, storage?: StorageDoc): Promise<void> {
    await this.transaction('rw', this.saves, this.slots, this.settings, async () => {
      await this.saves.add({ slot, savedAt: doc.savedAt, doc });
      // Storage is written with the save, so the two never disagree about where an item is.
      if (storage) await this.settings.put({ key: STORAGE_KEY, value: storage });
      await this.slots.put(slotMetaFrom(slot, doc));
      const ids = await this.saves.where('[slot+id]').between([slot, Dexie.minKey], [slot, Dexie.maxKey]).primaryKeys();
      const stale = ids.slice(0, Math.max(0, ids.length - KEEP_SAVES));
      if (stale.length > 0) await this.saves.bulkDelete(stale);
    });
  }

  /** Newest save in the slot that still validates, or null if the slot is empty or all are unreadable. */
  async load(slot: number): Promise<SaveDoc | null> {
    const rows = await this.saves.where('[slot+id]').between([slot, Dexie.minKey], [slot, Dexie.maxKey]).reverse().toArray();
    for (const row of rows) {
      try {
        return migrate(row.doc);
      } catch (err) {
        console.warn(`Skipping unreadable save ${row.id} in slot ${slot}`, err);
      }
    }
    return null;
  }

  /** The shared storage; empty if there is none yet or it can't be read. */
  async loadStorage(): Promise<StorageDoc> {
    const row = await this.settings.get(STORAGE_KEY);
    const parsed = StorageDocSchema.safeParse(row?.value ?? {});
    if (!parsed.success) console.warn('Shared storage is unreadable; starting empty', parsed.error);
    return parsed.success ? parsed.data : { items: {}, gear: [] };
  }

  async listSlots(): Promise<Map<number, SlotMeta>> {
    const rows = await this.slots.toArray();
    return new Map(rows.map((r) => [r.id, r]));
  }

  async clearSlot(slot: number): Promise<void> {
    await this.transaction('rw', this.saves, this.slots, async () => {
      await this.saves.where('slot').equals(slot).delete();
      await this.slots.delete(slot);
    });
  }
}
