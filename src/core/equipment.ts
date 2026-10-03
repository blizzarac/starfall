import type { EquipDef, GearBonus, ItemDef } from '../data/schemas';
import type { WeaponType } from './combat/formulas';
import type { Player } from './entities';

export const EQUIP_SLOTS = ['weapon', 'shield', 'head', 'body', 'cloak', 'shoes', 'acc1', 'acc2'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  shield: 'Shield',
  head: 'Head',
  body: 'Body',
  cloak: 'Cloak',
  shoes: 'Shoes',
  acc1: 'Accessory',
  acc2: 'Accessory',
};

/** Gear new characters start with, equipped. */
export const STARTING_GEAR = ['novice_knife', 'cotton_shirt'];

export type Equipment = Partial<Record<EquipSlot, ItemDef>>;

/** Bare hands when nothing is equipped. */
export function weaponOf(p: Pick<Player, 'equipment'>): { type: WeaponType; atk: number } {
  const w = p.equipment.weapon?.equip;
  return w?.weaponType ? { type: w.weaponType, atk: w.atk } : { type: 'fist', atk: 0 };
}

/** Sum of every equipped item's bonuses, plus total armor DEF. */
export function gearBonus(p: Pick<Player, 'equipment'>): Required<GearBonus> & { def: number } {
  const total = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0, hp: 0, sp: 0, hit: 0, flee: 0, def: 0 };
  for (const item of Object.values(p.equipment)) {
    if (!item?.equip) continue;
    total.def += item.equip.def;
    for (const [k, v] of Object.entries(item.equip.bonus)) total[k as keyof GearBonus] += v ?? 0;
  }
  return total;
}

/** Why the player can't wear this item, or null if they can. */
export function equipBlocker(p: Pick<Player, 'jobId' | 'baseLevel'>, item: ItemDef): string | null {
  const e = item.equip;
  if (!e) return "That can't be equipped.";
  if (e.jobs && !e.jobs.includes(p.jobId)) return `Only for: ${e.jobs.join(', ')}.`;
  if (p.baseLevel < e.minLevel) return `Requires base level ${e.minLevel}.`;
  return null;
}

/** The slot an item goes into: accessories fill the first free accessory slot. */
export function slotFor(p: Pick<Player, 'equipment'>, e: EquipDef): EquipSlot {
  if (e.slot !== 'accessory') return e.slot;
  return p.equipment.acc1 && !p.equipment.acc2 ? 'acc2' : 'acc1';
}

/** One line describing what a piece of gear does. */
export function describeGear(e: EquipDef): string {
  const parts: string[] = [];
  if (e.weaponType) parts.push(`${e.weaponType}${e.twoHanded ? ' (two-handed)' : ''}, ATK ${e.atk}`);
  if (e.def) parts.push(`DEF ${e.def}`);
  for (const [k, v] of Object.entries(e.bonus)) if (v) parts.push(`${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`);
  if (e.minLevel > 1) parts.push(`Lv ${e.minLevel}+`);
  if (e.jobs) parts.push(e.jobs.map((j) => j[0]!.toUpperCase() + j.slice(1)).join('/') + ' only');
  return parts.join(' · ');
}
