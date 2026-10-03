import { describe, expect, it } from 'vitest';
import { appearanceKey, cleanAppearance, DEFAULT_APPEARANCE, HAIR_COLORS, npcAppearance } from '../src/core/appearance';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { slotMetaFrom } from '../src/save/schema';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

describe('appearance', () => {
  it('cleans unknown or out-of-range choices back to defaults', () => {
    expect(cleanAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(cleanAppearance({ hairStyle: 'mullet' as never, hairColor: 99, eyeColor: 2, skinTone: -1 })).toEqual({ ...DEFAULT_APPEARANCE, eyeColor: 2 });
  });

  it('is saved, shown on the title card, and old saves get the default look', () => {
    const w = new World(content, town, { seed: 1 });
    let changed = 0;
    w.events.on('appearanceChanged', () => changed++);
    w.setAppearance({ hairStyle: 'twintails', hairColor: HAIR_COLORS.length - 1, eyeColor: 4, skinTone: 2 });
    expect(changed).toBe(1);
    const doc = JSON.parse(JSON.stringify(toSaveDoc(w, 0)));
    const b = new World(content, town, { seed: 2 });
    applySaveDoc(b, migrate(doc));
    expect(b.player.appearance).toEqual(w.player.appearance);
    expect(slotMetaFrom(1, migrate(doc)).appearance).toEqual(w.player.appearance);
    delete doc.appearance;
    const c = new World(content, town, { seed: 2 });
    applySaveDoc(c, migrate(doc));
    expect(c.player.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('gives each NPC a stable look and each combination its own sprite key', () => {
    expect(npcAppearance('guide', 0x123456)).toEqual(npcAppearance('guide', 0x123456));
    expect(appearanceKey(DEFAULT_APPEARANCE)).not.toBe(appearanceKey({ ...DEFAULT_APPEARANCE, eyeColor: 1 }));
  });
});
