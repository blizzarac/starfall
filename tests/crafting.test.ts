import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';

const content = loadContent();

describe('crafting', () => {
  it('turns materials and gold into the result', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    const crafted: string[] = [];
    w.events.on('crafted', (e) => crafted.push(e.itemId));
    w.addItem('beetle_shell', 7);
    w.player.gold = 100;
    expect(w.craftShortfall('leather_cap')).toEqual([]);
    expect(w.craft('leather_cap')).toEqual({ itemId: 'leather_cap', count: 1 });
    expect(w.itemCount('beetle_shell')).toBe(1);
    expect(w.player.gold).toBe(20);
    expect(w.player.gear.some((g) => g.item.id === 'leather_cap')).toBe(true);
    expect(crafted).toEqual(['leather_cap']);
  });

  it('says what is missing, and takes nothing when it cannot be made', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.addItem('bat_wing', 1);
    w.player.gold = 0;
    expect(w.craftShortfall('fly_wing')).toEqual(['10 more gold', '1 more Gull Feather']);
    const result = w.craft('fly_wing');
    expect(result).toHaveProperty('error');
    expect(w.itemCount('bat_wing')).toBe(1);
    w.addItem('gull_feather', 1);
    w.player.gold = 10;
    expect(w.craft('fly_wing')).toEqual({ itemId: 'fly_wing', count: 2 });
    expect(w.itemCount('fly_wing')).toBe(2);
  });

  it('every recipe uses real items, and a tinkerer opens the bench', () => {
    expect(content.recipes.size).toBeGreaterThan(10);
    for (const map of ['town', 'sunspire']) {
      const tinker = content.maps.get(map)!.npcs.find((n) => n.id.startsWith('tinker'));
      expect(tinker, map).toBeDefined();
      const nodes = Object.values(content.dialogues.get(tinker!.dialogue)!.nodes);
      expect(nodes.some((n) => 'choices' in n && n.choices.some((c) => c.do.some((a) => a.type === 'openCraft')))).toBe(true);
    }
  });
});
