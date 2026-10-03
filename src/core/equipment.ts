import type { CardDef, EquipDef, GearBonus, ItemDef } from '../data/schemas';
import type { Element, Size, WeaponType } from './combat/formulas';
import type { Player } from './entities';
import { isJobId, jobLineage, JOBS } from './jobs';

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

/**
 * One physical piece of gear. Unlike potions, two Knives can differ:
 * each has its own refine level and slotted cards.
 */
export interface GearPiece {
  /** Unique within a play session; reassigned on load. */
  uid: number;
  item: ItemDef;
  refine: number;
  /** Card item ids slotted in, at most `item.equip.slots`. */
  cards: ItemDef[];
}

export type Equipment = Partial<Record<EquipSlot, GearPiece>>;

export const MAX_REFINE = 10;

/** ATK a weapon gains per refine level (MATK too, for staves). */
export const WEAPON_REFINE_ATK = 3;
/** DEF armor gains per refine level. */
export const ARMOR_REFINE_DEF = 1;

/** Bare hands when nothing is equipped. Refining adds to weapon ATK. */
export function weaponOf(p: Pick<Player, 'equipment'>): { type: WeaponType; atk: number; matk: number } {
  const piece = p.equipment.weapon;
  const w = piece?.item.equip;
  if (!piece || !w?.weaponType) return { type: 'fist', atk: 0, matk: 0 };
  const refine = piece.refine * WEAPON_REFINE_ATK;
  return { type: w.weaponType, atk: w.atk + refine, matk: w.matk + (w.weaponType === 'staff' ? refine : 0) };
}

type TotalBonus = Required<GearBonus>;

function emptyBonus(): TotalBonus {
  return { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0, hp: 0, sp: 0, hit: 0, flee: 0, atk: 0, matk: 0, def: 0 };
}

function addBonus(total: TotalBonus, b: GearBonus): void {
  for (const [k, v] of Object.entries(b)) total[k as keyof GearBonus] += v ?? 0;
}

/** Sum of every worn piece: item bonuses, armor DEF (with refines) and card bonuses. */
export function gearBonus(p: Pick<Player, 'equipment'>): TotalBonus {
  const total = emptyBonus();
  for (const [slot, piece] of Object.entries(p.equipment) as Array<[EquipSlot, GearPiece | undefined]>) {
    const e = piece?.item.equip;
    if (!piece || !e) continue;
    total.def += e.def + (slot === 'weapon' ? 0 : piece.refine * ARMOR_REFINE_DEF);
    addBonus(total, e.bonus);
    for (const card of piece.cards) if (card.card) addBonus(total, card.card.bonus);
  }
  return total;
}

export interface CardEffects {
  vsElement: Partial<Record<Element, number>>;
  vsSize: Partial<Record<Size, number>>;
  resist: Partial<Record<Element, number>>;
}

/** Damage modifiers from every slotted card in worn gear. */
export function cardEffects(p: Pick<Player, 'equipment'>): CardEffects {
  const out: CardEffects = { vsElement: {}, vsSize: {}, resist: {} };
  const merge = <K extends string>(into: Partial<Record<K, number>>, from: Partial<Record<K, number>>) => {
    for (const [k, v] of Object.entries(from) as Array<[K, number]>) into[k] = (into[k] ?? 0) + v;
  };
  for (const piece of Object.values(p.equipment)) {
    for (const card of piece?.cards ?? []) {
      if (!card.card) continue;
      merge(out.vsElement, card.card.vsElement);
      merge(out.vsSize, card.card.vsSize);
      merge(out.resist, card.card.resist);
    }
  }
  return out;
}

/** Why the player can't wear this item, or null if they can. */
export function equipBlocker(p: Pick<Player, 'jobId' | 'baseLevel'>, item: ItemDef): string | null {
  const e = item.equip;
  if (!e) return "That can't be equipped.";
  // Second jobs keep using their first job's gear.
  if (e.jobs && !jobLineage(p.jobId).some((j) => e.jobs!.includes(j))) {
    return `Only for ${e.jobs.map((j) => (isJobId(j) ? JOBS[j].name : j)).join(' or ')}.`;
  }
  if (p.baseLevel < e.minLevel) return `Requires base level ${e.minLevel}.`;
  return null;
}

/** The slot an item goes into: accessories fill the first free accessory slot. */
export function slotFor(p: Pick<Player, 'equipment'>, e: EquipDef): EquipSlot {
  if (e.slot !== 'accessory') return e.slot;
  return p.equipment.acc1 && !p.equipment.acc2 ? 'acc2' : 'acc1';
}

/** Why this card can't go into this piece, or null if it can. */
export function cardBlocker(piece: GearPiece, card: ItemDef): string | null {
  if (!card.card) return "That's not a card.";
  const e = piece.item.equip;
  if (!e) return "That can't hold cards.";
  if (e.slot !== card.card.fits) return `${card.name} only fits ${card.card.fits} gear.`;
  if (piece.cards.length >= e.slots) return `${pieceName(piece)} has no free card slot.`;
  return null;
}

/** "+3 Novice Knife [2]" style name: refine, then free/used slots. */
export function pieceName(piece: GearPiece): string {
  const refine = piece.refine > 0 ? `+${piece.refine} ` : '';
  const slots = piece.item.equip?.slots ?? 0;
  return `${refine}${piece.item.name}${slots > 0 ? ` [${piece.cards.length}/${slots}]` : ''}`;
}

/** A piece nobody has refined or slotted; the one to sell or hand over first. */
export function isPlain(piece: GearPiece): boolean {
  return piece.refine === 0 && piece.cards.length === 0;
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

export function describeBonus(b: GearBonus): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(b)) if (v) parts.push(`${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`);
  return parts;
}

/** One line describing what a card does. */
export function describeCard(c: CardDef): string {
  const parts = describeBonus(c.bonus);
  for (const [k, v] of Object.entries(c.vsElement)) if (v) parts.push(`${pct(v)} dmg vs ${k}`);
  for (const [k, v] of Object.entries(c.vsSize)) if (v) parts.push(`${pct(v)} dmg vs ${k}`);
  for (const [k, v] of Object.entries(c.resist)) if (v) parts.push(`${pct(-v)} dmg from ${k}`);
  parts.push(`fits ${c.fits}`);
  return parts.join(' · ');
}

/** One line describing what a piece of gear does. */
export function describeGear(e: EquipDef): string {
  const parts: string[] = [];
  if (e.weaponType) parts.push(`${e.weaponType}${e.twoHanded ? ' (two-handed)' : ''}, ATK ${e.atk}`);
  if (e.matk) parts.push(`MATK ${e.matk}`);
  if (e.def) parts.push(`DEF ${e.def}`);
  parts.push(...describeBonus(e.bonus));
  if (e.slots) parts.push(`${e.slots} slot${e.slots > 1 ? 's' : ''}`);
  if (e.minLevel > 1) parts.push(`Lv ${e.minLevel}+`);
  if (e.jobs) parts.push(e.jobs.map((j) => j[0]!.toUpperCase() + j.slice(1)).join('/') + ' only');
  return parts.join(' · ');
}

/** Gear description plus its refine and slotted cards. */
export function describePiece(piece: GearPiece): string {
  const e = piece.item.equip;
  if (!e) return '';
  const lines = [describeGear(e)];
  if (piece.refine > 0) {
    lines.push(e.slot === 'weapon' ? `refine +${piece.refine * WEAPON_REFINE_ATK} ATK` : `refine +${piece.refine * ARMOR_REFINE_DEF} DEF`);
  }
  for (const c of piece.cards) lines.push(`${c.name}: ${c.card ? describeCard({ ...c.card, fits: c.card.fits }).replace(/ · fits \w+$/, '') : ''}`);
  return lines.join(' · ');
}
