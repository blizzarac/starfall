import { describe, expect, it } from 'vitest';
import { itemInfo } from '../src/core/items';
import { loadContent } from '../src/data/content';

const content = loadContent();
const info = (id: string) => itemInfo(content.items.get(id)!, content);

describe('item descriptions', () => {
  it('says what potions, wings and cures do', () => {
    expect(info('red_tonic')).toMatch(/restores 45 HP/);
    expect(info('blue_tonic')).toMatch(/restores 30 SP/);
    expect(info('fly_wing')).toMatch(/teleports you/);
    expect(info('panacea')).toMatch(/cures poison, stun, blind/);
    expect(info('wobbly_pudding')).toMatch(/tames a Jellop/);
  });

  it('says loot sells for gold and what a tinkerer makes from it', () => {
    expect(info('beetle_shell')).toMatch(/sells for 9 gold/);
    expect(info('beetle_shell')).toMatch(/crafts Leather Cap, Beetle Buckler/);
  });

  it('says where gear goes and what a card fits', () => {
    expect(info('short_sword')).toMatch(/^Weapon \(sword\): ATK/);
    expect(info('leather_cap')).toMatch(/^Headgear: DEF/);
    expect(info('jellop_card')).toMatch(/^Card for armor: HP \+40/);
  });

  it('describes every item without falling back to a bare type', () => {
    for (const item of content.items.values()) {
      const text = itemInfo(item, content);
      expect(text.length, item.id).toBeGreaterThan(12);
      expect(text, item.id).not.toMatch(/^(etc|consumable|card|equipment)$/);
    }
  });
});
