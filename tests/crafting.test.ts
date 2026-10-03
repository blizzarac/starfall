import { describe, expect, it } from 'vitest';
import { sellPrice } from '../src/core/combat/formulas';
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
    expect(w.player.gold).toBe(100 - content.recipes.get('leather_cap')!.gold);
    expect(w.player.gear.some((g) => g.item.id === 'leather_cap')).toBe(true);
    expect(crafted).toEqual(['leather_cap']);
  });

  it('says what is missing, and takes nothing when it cannot be made', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.addItem('bat_wing', 1);
    w.player.gold = 0;
    expect(w.craftShortfall('fly_wing')).toEqual(['1 more Gull Feather']);
    expect(w.craftShortfall('tusk_blade')).toContain(`${content.recipes.get('tusk_blade')!.gold} more gold`);
    const result = w.craft('fly_wing');
    expect(result).toHaveProperty('error');
    expect(w.itemCount('bat_wing')).toBe(1);
    w.addItem('gull_feather', 1);
    expect(w.craft('fly_wing')).toEqual({ itemId: 'fly_wing', count: 3 });
    expect(w.itemCount('fly_wing')).toBe(3);
  });

  it('always pays: materials plus the fee sell for less than what you make', () => {
    for (const r of content.recipes.values()) {
      const value = (id: string) => sellPrice(content.items.get(id)!.price);
      const cost = r.materials.reduce((sum, m) => sum + value(m.item) * m.count, 0) + r.gold;
      expect(cost, r.id).toBeLessThan(value(r.result) * r.count);
    }
  });

  it('buying every material from a shop never makes crafting a gold loop', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    // The cheapest place to buy each item, if any shop sells it.
    const buy = (id: string) => {
      const prices = [...content.shops.values()].filter((s) => s.items.includes(id)).map((s) => w.buyPrice(s.id, content.items.get(id)!));
      return prices.length ? Math.min(...prices) : sellPrice(content.items.get(id)!.price);
    };
    for (const r of content.recipes.values()) {
      const cost = r.materials.reduce((sum, m) => sum + buy(m.item) * m.count, 0) + r.gold;
      expect(cost, r.id).toBeGreaterThan(sellPrice(content.items.get(r.result)!.price) * r.count);
    }
  });

  it('the materials trader only stocks what you have found', () => {
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    w.player.gold = 10_000;
    expect(w.shopItems('materials')).toEqual([]);
    expect(w.buy('materials', 'wolf_pelt')).toMatch(/not for sale/);
    // Picking one up unlocks it for good, even after it's sold.
    w.drops.set(1, { id: 1, itemId: 'wolf_pelt', tile: { ...w.player.tile }, expiresIn: 60_000 });
    w.pickUp(1);
    for (let i = 0; i < 20 && w.drops.size; i++) w.tick();
    expect(w.itemCount('wolf_pelt')).toBe(1);
    w.sell('wolf_pelt', 1);
    expect(w.shopItems('materials')).toEqual(['wolf_pelt']);
    const gold = w.player.gold;
    expect(w.buy('materials', 'wolf_pelt', 2)).toBeNull();
    expect(w.player.gold).toBe(gold - 2 * Math.ceil(content.items.get('wolf_pelt')!.price * 1.5));
    // Materials already in the bag (from older saves) count as found.
    w.addItem('gear_cog', 1);
    expect(w.shopItems('materials')).toContain('gear_cog');
  });

  it('the traders stock every regular monster material, from every area you have visited', () => {
    const shop = content.shops.get('materials')!;
    for (const m of content.monsters.values()) {
      if (m.boss) continue;
      for (const d of m.drops) if (content.items.get(d.item)!.type === 'etc') expect(shop.items, `${m.id} drops ${d.item}`).toContain(d.item);
    }
    // Having been to the Iron Wastes is enough: its loot is in stock even if you sold it all.
    const w = new World(content, content.maps.get(START_MAP)!, { seed: 1 });
    expect(w.shopItems('materials')).not.toContain('gear_cog');
    w.changeMap('iron-wastes', content.maps.get('iron-wastes')!.playerStart);
    expect(w.shopItems('materials')).toEqual(expect.arrayContaining(['scrap_metal', 'gear_cog', 'power_cell']));
    expect(w.shopItems('materials')).not.toContain('sand_ruby');
  });

  it('every town has a materials trader', () => {
    for (const town of [...content.maps.values()].filter((m) => m.kind === 'town')) {
      const npc = town.npcs.find((n) => n.dialogue === 'materials_trader');
      expect(npc, town.id).toBeDefined();
    }
  });

  it('every town has a crafting table that opens the bench', () => {
    const towns = [...content.maps.values()].filter((m) => m.kind === 'town');
    expect(towns.length).toBeGreaterThanOrEqual(3);
    for (const town of towns) {
      const bench = town.npcs.find((n) => n.sprite === 'bench');
      expect(bench, town.id).toBeDefined();
      const nodes = Object.values(content.dialogues.get(bench!.dialogue)!.nodes);
      expect(nodes.some((n) => 'choices' in n && n.choices.some((c) => c.do.some((a) => a.type === 'openCraft')))).toBe(true);
    }
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
