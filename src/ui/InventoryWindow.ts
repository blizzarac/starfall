import type Phaser from 'phaser';
import { cardBlocker, describeCard, describePiece, EQUIP_SLOTS, equipBlocker, pieceName, SLOT_NAMES, type GearPiece } from '../core/equipment';
import { derivedStats, formatDeltas, previewEquip } from '../core/progression';
import type { World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { itemInfo } from '../core/items';
import { itemName } from './ItemInfo';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 64;
const TYPE_ORDER: Record<ItemDef['type'], number> = { consumable: 0, equipment: 1, petgear: 2, card: 3, etc: 4 };
type Tab = 'bag' | 'gear';
/** Bag filters: everything, or one item type. */
const FILTERS: Array<{ label: string; type: ItemDef['type'] | null }> = [
  { label: 'All', type: null },
  { label: 'Use', type: 'consumable' },
  { label: 'Gear', type: 'equipment' },
  { label: 'Cards', type: 'card' },
  { label: 'Loot', type: 'etc' },
];
type Row = { kind: 'stack'; item: ItemDef } | { kind: 'piece'; piece: GearPiece };

/** Your bag (use, equip, slot cards) and what you're wearing. */
export class InventoryWindow {
  readonly panel: Panel;
  private page = 0;
  private tab: Tab = 'bag';
  private filter: ItemDef['type'] | null = null;
  private message = '';
  /** Set while choosing which piece of gear a card goes into. */
  private inserting: ItemDef | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Items', centered(380, 560), () => this.close());
    const refresh = () => this.panel.visible && this.refresh();
    world.events.on('inventoryChanged', refresh);
    world.events.on('equipmentChanged', refresh);
  }

  open(): void {
    this.message = '';
    this.inserting = null;
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.inserting = null;
    this.panel.setVisible(false);
  }

  toggle(): void {
    if (this.panel.visible) this.close();
    else this.open();
  }

  refresh(): void {
    const w = this.world;
    const p = this.panel;
    p.layout();
    p.clear();
    p.setTitle(this.inserting ? `Insert ${this.inserting.name}` : 'Items');
    if (this.inserting) {
      this.insertPicker(this.inserting);
    } else {
      const tabW = (p.w - 30) / 2;
      p.add(makeButton(this.scene, 12, 40, tabW, 32, 'Bag', () => this.setTab('bag'), this.tab === 'bag' ? 0xffd84a : 0xffffff).root);
      p.add(makeButton(this.scene, 18 + tabW, 40, tabW, 32, 'Gear', () => this.setTab('gear'), this.tab === 'gear' ? 0xffd84a : 0xffffff).root);
      const ratio = w.weightRatio();
      const color = ratio >= 0.9 ? TONE.bad : ratio >= 0.5 ? TONE.warn : TONE.gold;
      const warn = ratio >= 0.9 ? '  overweight: no attacking' : ratio >= 0.5 ? '  heavy: no natural recovery' : '';
      p.add(this.scene.add.text(12, 80, `Gold ${w.player.gold}    Weight ${w.weight()} / ${w.maxWeight()}${warn}`, { ...TEXT, fontSize: '12px', color }));
      if (this.tab === 'bag') this.bag();
      else this.gear();
    }
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: TONE.good, wordWrap: { width: p.w - 24 } }));
  }

  private rows(): Row[] {
    const w = this.world;
    const stacks: Row[] = [...w.player.inventory.keys()]
      .map((id) => w.content.items.get(id))
      .filter((i): i is ItemDef => !!i)
      .map((item) => ({ kind: 'stack', item }));
    const pieces: Row[] = w.player.gear.map((piece) => ({ kind: 'piece', piece }));
    const itemOf = (r: Row) => (r.kind === 'stack' ? r.item : r.piece.item);
    return [...stacks, ...pieces]
      .filter((r) => this.filter === null || itemOf(r).type === this.filter)
      .sort(
      (a, b) => TYPE_ORDER[itemOf(a).type] - TYPE_ORDER[itemOf(b).type] || itemOf(a).name.localeCompare(itemOf(b).name),
    );
  }

  private bag(): void {
    const chipW = (this.panel.w - 24 - 4 * 6) / FILTERS.length;
    FILTERS.forEach((f, i) => {
      this.panel.add(
        makeButton(this.scene, 12 + i * (chipW + 6), 100, chipW, 28, f.label, () => {
          this.filter = f.type;
          this.page = 0;
          this.refresh();
        }, this.filter === f.type ? 0xffd84a : 0xffffff).root,
      );
    });
    const rows = this.rows();
    if (rows.length === 0) this.panel.add(this.scene.add.text(12, 142, this.filter ? 'Nothing of that kind.' : 'Your bag is empty.', { ...TEXT, fontSize: '13px', color: TONE.muted }));
    this.page = pagedList(this.panel, rows, this.page, 138, 34, ROW_H, (row, y, pw) => this.bagRow(row, y, pw), (pg) => {
      this.page = pg;
      this.refresh();
    });
  }

  private bagRow(row: Row, y: number, pw: number): void {
    const w = this.world;
    if (row.kind === 'piece') {
      const piece = row.piece;
      const detail = this.line(pieceName(piece), `${describePiece(piece)} · wt ${piece.item.weight}`, y, pw, piece.item, piece);
      this.compare(piece, Math.max(y + 40, detail.y + detail.height + 1), pw);
      this.button('Equip', pw, y, () => {
        const err = w.equip(piece.uid);
        this.message = err ?? `Equipped ${pieceName(piece)}.`;
        this.refresh();
      });
      return;
    }
    const item = row.item;
    const count = w.player.inventory.get(item.id) ?? 0;
    this.line(`${item.name} ×${count}`, `${itemInfo(item, w.content)} · wt ${item.weight}`, y, pw, item);
    if (item.type === 'consumable') {
      this.button('Use', pw, y, () => w.useItem(item.id));
      const onBar = w.player.hotbar.includes(item.id);
      this.panel.add(
        makeButton(this.scene, pw - 128, y + 4, 46, 36, onBar ? 'Bar ✓' : 'Bar', () => {
          this.message = w.toggleHotbar(item.id) ?? '';
          this.refresh();
        }, onBar ? 0xffd84a : 0xffffff).root,
      );
    }
    else if (item.petGear && w.player.pet)
      this.button('Pet', pw, y, () => {
        const err = w.equipPetGear(item.id);
        this.message = err ?? `${w.player.pet?.name} now wears the ${item.name}.`;
        this.refresh();
      });
    else if (item.card)
      this.button('Insert', pw, y, () => {
        this.inserting = item;
        this.page = 0;
        this.message = '';
        this.refresh();
      });
  }

  /** Lists every piece (bag and worn) this card could go into. */
  private insertPicker(card: ItemDef): void {
    const w = this.world;
    const p = this.panel;
    p.add(
      this.scene.add.text(12, 40, `${card.card ? describeCard(card.card) : ''}\nCards can't be removed once inserted.`, {
        ...TEXT,
        fontSize: '12px',
        color: TONE.muted,
        wordWrap: { width: p.w - 24 },
      }),
    );
    const pieces = [...w.wornPieces().map(([, piece]) => piece), ...w.player.gear].filter((g) => !cardBlocker(g, card));
    if (pieces.length === 0) {
      p.add(this.scene.add.text(12, 90, `Nothing you own has a free ${card.card?.fits} slot.`, { ...TEXT, fontSize: '13px', color: TONE.warn }));
    }
    this.page = pagedList(p, pieces, this.page, 86, 80, ROW_H, (piece, y, pw) => {
      const worn = w.wornPieces().some(([, g]) => g === piece);
      this.line(`${pieceName(piece)}${worn ? ' (worn)' : ''}`, describePiece(piece), y, pw, piece.item, piece);
      this.button('Insert', pw, y, () => {
        const err = w.insertCard(card.id, piece.uid);
        this.message = err ?? `${card.name} is now in ${pieceName(piece)}.`;
        this.inserting = null;
        this.refresh();
      });
    }, (pg) => {
      this.page = pg;
      this.refresh();
    });
    p.add(
      makeButton(this.scene, 12, p.h - 72, p.w - 24, 34, 'Cancel', () => {
        this.inserting = null;
        this.refresh();
      }).root,
    );
  }

  private gear(): void {
    const w = this.world;
    const d = derivedStats(w.player);
    this.panel.add(this.scene.add.text(12, 100, `ATK ${d.atk}  MATK ${d.matk}  DEF ${d.def}  FLEE ${d.flee}`, { ...TEXT, fontSize: '12px' }));
    const rowH = Math.max(40, Math.min(ROW_H, Math.floor((this.panel.h - 160) / EQUIP_SLOTS.length)));
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = 124 + i * rowH;
      const piece = w.player.equipment[slot];
      this.panel.add(this.scene.add.text(12, y + 2, SLOT_NAMES[slot], { ...TEXT, fontSize: '11px', color: TONE.accent }));
      this.panel.add(this.scene.add.text(92, y + 2, piece ? pieceName(piece) : '—', { ...TEXT, fontSize: '13px', color: piece ? TONE.ink : TONE.disabled }));
      if (!piece) return;
      this.panel.add(
        this.scene.add.text(92, y + 19, describePiece(piece), { ...TEXT, fontSize: '10px', color: TONE.muted, wordWrap: { width: this.panel.w - 190 } }),
      );
      this.panel.add(
        makeButton(this.scene, this.panel.w - 88, y + 2, 76, rowH - 8, 'Remove', () => {
          w.unequip(slot);
          this.message = `Removed ${pieceName(piece)}.`;
          this.refresh();
        }).root,
      );
    });
  }

  /** How this piece compares with what's worn now, in green (better), red (worse) or ink (mixed). */
  private compare(piece: GearPiece, top: number, pw: number): void {
    const blocker = equipBlocker(this.world.player, piece.item);
    const deltas = blocker ? [] : previewEquip(this.world.player, piece);
    const color = blocker ? TONE.bad : deltas.every((d) => d.delta > 0) && deltas.length ? TONE.good : deltas.every((d) => d.delta < 0) && deltas.length ? TONE.bad : TONE.ink;
    this.panel.add(
      this.scene.add.text(12, top, blocker ?? `If worn: ${formatDeltas(deltas)}`, { ...TEXT, fontSize: '11px', fontStyle: 'bold', color, wordWrap: { width: pw - 24 } }),
    );
  }

  /** A row's title (tap it for the item card) and a short description beside the buttons. */
  private line(title: string, detail: string, y: number, pw: number, item?: ItemDef, piece?: GearPiece): Phaser.GameObjects.Text {
    this.panel.add(item ? itemName(this.scene, this.world, 12, y + 2, title, item, piece) : this.scene.add.text(12, y + 2, title, { ...TEXT, fontSize: '13px' }));
    return this.panel.add(this.scene.add.text(12, y + 20, detail, { ...TEXT, fontSize: '11px', color: TONE.muted, wordWrap: { width: pw - 150 }, maxLines: 2 }));
  }

  private button(label: string, pw: number, y: number, onTap: () => void): void {
    this.panel.add(makeButton(this.scene, pw - 76, y + 4, 64, 36, label, onTap).root);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.message = '';
    this.refresh();
  }
}
