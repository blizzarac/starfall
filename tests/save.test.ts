import 'fake-indexeddb/auto';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../src/data/content';
import { World } from '../src/core/world';
import { gainXp } from '../src/core/progression';
import { KEEP_SAVES, SaveDb } from '../src/save/db';
import { parseSaveFile } from '../src/save/manager';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';
import { SaveDocSchema } from '../src/save/schema';

const content = loadContent();
const map = content.maps.get('meadow-1')!;
const newWorld = () => new World(content, map, { seed: 1 });

function progressedWorld(): World {
  const w = newWorld();
  const p = w.player;
  p.name = 'Mira';
  gainXp(p, 500, 120);
  w.raiseStat('agi');
  p.inventory.set('red_tonic', 3);
  p.inventory.set('jelly_drop', 12);
  p.hp = 7;
  w.moveTo({ x: map.playerStart.x + 4, y: map.playerStart.y });
  for (let i = 0; i < 100; i++) w.tick();
  return w;
}

describe('save serialization', () => {
  it('round-trips player state into a fresh world', () => {
    const src = progressedWorld();
    const doc = toSaveDoc(src, 1234);
    const dst = newWorld();
    applySaveDoc(dst, doc);
    const a = src.player;
    const b = dst.player;
    expect(b.name).toBe('Mira');
    expect([b.baseLevel, b.jobLevel, b.baseXp, b.jobXp]).toEqual([a.baseLevel, a.jobLevel, a.baseXp, a.jobXp]);
    expect(b.stats).toEqual(a.stats);
    expect(b.statPoints).toBe(a.statPoints);
    expect([...b.inventory]).toEqual([...a.inventory]);
    expect(b.tile).toEqual(a.tile);
    expect(b.hp).toBe(7);
    expect(doc.playtimeMs).toBe(1234);
  });

  it('survives JSON and still validates', () => {
    const doc = toSaveDoc(progressedWorld(), 0);
    expect(parseSaveFile(JSON.stringify(doc))).toEqual(doc);
  });

  it('saves a fainted player at the save point with full HP', () => {
    const w = progressedWorld();
    w.player.dead = true;
    w.player.hp = 0;
    const doc = toSaveDoc(w, 0);
    expect({ x: doc.position.x, y: doc.position.y }).toEqual(w.player.savePoint);
    expect(doc.character.hp).toBeGreaterThan(0);
  });

  it('falls back to the save point when the saved tile is not walkable', () => {
    const doc = toSaveDoc(progressedWorld(), 0);
    doc.position = { map: map.id, x: 0, y: 0 };
    const w = newWorld();
    applySaveDoc(w, doc);
    expect(w.player.tile).toEqual(w.player.savePoint);
  });

  it('drops items the game no longer has', () => {
    const doc = toSaveDoc(progressedWorld(), 0);
    doc.inventory.removed_item = 2;
    const w = newWorld();
    applySaveDoc(w, doc);
    expect(w.player.inventory.has('removed_item')).toBe(false);
  });
});

describe('migrate', () => {
  it('runs every step from the save version up to the target', () => {
    const v1 = toSaveDoc(newWorld(), 0) as unknown as Record<string, unknown>;
    const steps = {
      2: (d: Record<string, unknown>) => ({ ...d, extra: 'added in v2' }),
      3: (d: Record<string, unknown>) => {
        const { extra, ...rest } = d;
        return { ...rest, flags: { migrated: extra as string } };
      },
    };
    const v3Schema = SaveDocSchema.extend({ schemaVersion: z.literal(3) });
    const out = migrate(v1, steps, 3, v3Schema);
    expect(out.schemaVersion).toBe(3);
    expect(out.flags).toEqual({ migrated: 'added in v2' });
    expect(() => migrate(v1, { 2: steps[2] }, 3, v3Schema)).toThrow(/No migration to save version 3/);
  });

  it('rejects saves from a newer game and garbage', () => {
    const doc = { ...toSaveDoc(newWorld(), 0), schemaVersion: 99 };
    expect(() => migrate(doc)).toThrow(/newer version/);
    expect(() => migrate({ hello: 1 })).toThrow(/schemaVersion/);
    expect(() => parseSaveFile('not json')).toThrow(/not JSON/);
  });
});

describe('SaveDb', () => {
  let db: SaveDb;
  afterEach(async () => {
    await db.delete();
  });

  it('writes, lists and loads the newest save in a slot', async () => {
    db = new SaveDb('test-1');
    const w = progressedWorld();
    await db.write(1, toSaveDoc(w, 100, 1000));
    w.player.baseXp += 1;
    await db.write(1, toSaveDoc(w, 200, 2000));
    const loaded = await db.load(1);
    expect(loaded?.playtimeMs).toBe(200);
    const slots = await db.listSlots();
    expect(slots.get(1)).toMatchObject({ name: 'Mira', playtimeMs: 200, savedAt: 2000 });
    expect(slots.has(2)).toBe(false);
    expect(await db.load(2)).toBeNull();
  });

  it(`keeps only the last ${KEEP_SAVES} saves per slot`, async () => {
    db = new SaveDb('test-2');
    const w = newWorld();
    for (let i = 0; i < 6; i++) await db.write(1, toSaveDoc(w, i, i));
    await db.write(2, toSaveDoc(w, 0, 0));
    expect(await db.saves.where('slot').equals(1).count()).toBe(KEEP_SAVES);
    expect(await db.saves.where('slot').equals(2).count()).toBe(1);
  });

  it('rolls back to an older save when the newest is corrupt', async () => {
    db = new SaveDb('test-3');
    const w = newWorld();
    await db.write(1, toSaveDoc(w, 111, 1));
    await db.saves.add({ slot: 1, savedAt: 2, doc: { schemaVersion: 1, broken: true } });
    expect((await db.load(1))?.playtimeMs).toBe(111);
  });

  it('clears a slot', async () => {
    db = new SaveDb('test-4');
    await db.write(3, toSaveDoc(newWorld(), 0));
    await db.clearSlot(3);
    expect(await db.load(3)).toBeNull();
    expect((await db.listSlots()).has(3)).toBe(false);
  });
});
