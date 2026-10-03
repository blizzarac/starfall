import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { gearVerdict } from '../src/ui/compare';

const content = loadContent();

describe('gear comparison', () => {
  it('also shows what new gear would give at the refine level of what you wear', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.player.jobId = 'swordsman';
    w.player.baseLevel = 30;
    w.addItem('short_sword', 1);
    const sword = w.player.gear.find((g) => g.item.id === 'short_sword')!;
    sword.refine = 8;
    expect(w.equip(sword.uid)).toBeNull();
    // Tusk Blade has 52 ATK against the Short Sword's 34, but +8 adds 24 to the worn one.
    const v = gearVerdict(w.player, w.newPiece(content.items.get('tusk_blade')!));
    expect(v.better).toBe(false);
    expect(v.text).toMatch(/^If worn: ATK −6 · at \+8 like yours: ATK \+18/);
    // Nothing extra when the worn piece isn't refined higher.
    sword.refine = 0;
    expect(gearVerdict(w.player, w.newPiece(content.items.get('tusk_blade')!)).text).toBe('If worn: ATK +18');
  });
});
