import type { Content } from '../data/content';
import type { ItemDef } from '../data/schemas';
import { sellPrice } from './combat/formulas';
import { describeCard, describeGear } from './equipment';

const SLOT_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  shield: 'Shield',
  head: 'Headgear',
  body: 'Armor',
  cloak: 'Cloak',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

/**
 * A plain-language line saying what an item is for: what a potion does,
 * which recipes use a piece of loot, what a card adds and where it fits,
 * and what slot gear goes in, followed by its flavor text.
 */
export function itemInfo(item: ItemDef, content: Pick<Content, 'recipes' | 'items'>): string {
  const flavor = item.description ?? '';
  if (item.equip) {
    const e = item.equip;
    const kind = e.weaponType ? `${SLOT_LABEL.weapon} (${e.weaponType})` : SLOT_LABEL[e.slot];
    return [`${kind}: ${describeGear(e).replace(/^\w+( \(two-handed\))?, /, '')}`, flavor].filter(Boolean).join(' — ');
  }
  if (item.card) {
    const effect = describeCard(item.card).replace(/ · fits \w+$/, '');
    return `Card for ${SLOT_LABEL[item.card.fits]?.toLowerCase() ?? item.card.fits}: ${effect}. Insert it into gear with a free slot (Items → Bag).`;
  }
  if (item.type === 'consumable') {
    const parts: string[] = [];
    if (item.heal?.hp) parts.push(`restores ${item.heal.hp} HP`);
    if (item.heal?.sp) parts.push(`restores ${item.heal.sp} SP`);
    if (item.cure?.length) parts.push(`cures ${item.cure.join(', ')}`);
    if (item.effect === 'teleport') parts.push('teleports you to a random spot on this map');
    if (item.effect === 'return') parts.push('takes you back to your save point');
    const generated = parts.length ? `Use: ${parts.join(', ')}.` : '';
    // Lures and other specials explain themselves best in their own words.
    if (item.effect === 'tame' || !generated) return flavor || 'Use it from Items → Bag.';
    return flavor && !/^(Restores|Cures|Teleports|Returns)/.test(flavor) ? `${generated} ${flavor}` : generated;
  }
  // Loot: what it's worth and what a tinkerer can make from it.
  const uses = [...content.recipes.values()].filter((r) => r.materials.some((m) => m.item === item.id)).map((r) => content.items.get(r.result)?.name ?? r.result);
  const parts = [`Loot, sells for ${sellPrice(item.price)} gold`];
  if (uses.length) parts.push(`crafts ${uses.slice(0, 3).join(', ')}${uses.length > 3 ? ` and ${uses.length - 3} more` : ''}`);
  return `${parts.join('; ')}.${flavor ? ` ${flavor}` : ''}`;
}
