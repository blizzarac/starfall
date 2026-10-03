import type Phaser from 'phaser';
import { sellPrice } from '../core/combat/formulas';
import { equipBlocker, isPlain, pieceName, type GearPiece } from '../core/equipment';
import { formatDeltas, previewEquip } from '../core/progression';
import type { World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';
import { itemInfo } from '../core/items';
import { itemName } from './ItemInfo';

type Tab = 'buy' | 'sell';
const ROW_H = 86;
type SellRow = { kind: 'stack'; item: ItemDef } | { kind: 'piece'; piece: GearPiece };

/** Buy from an NPC's stock, or sell anything you carry at half price. */
export class ShopWindow {
  readonly panel: Panel;
  private shopId: string | null = null;
  private tab: Tab = 'buy';
  private page = 0;
  private message = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Shop', centered(380, 560, 20), () => this.close(), true);
    world.events.on('inventoryChanged', () => this.panel.visible && this.refresh());
  }

  open(shopId: string): void {
    this.shopId = shopId;
    this.tab = 'buy';
    this.page = 0;
    this.message = '';
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.shopId = null;
    this.panel.setVisible(false);
  }

  refresh(): void {
    const shop = this.shopId ? this.world.content.shops.get(this.shopId) : undefined;
    if (!shop) return;
    const w = this.world;
    const p = this.panel;
    p.layout();
    p.clear();
    p.setTitle(shop.name);
    const tabW = (p.w - 30) / 2;
    p.add(makeButton(this.scene, 12, 40, tabW, 32, 'Buy', () => this.setTab('buy'), this.tab === 'buy' ? 0xffd84a : 0xffffff).root);
    p.add(makeButton(this.scene, 18 + tabW, 40, tabW, 32, 'Sell', () => this.setTab('sell'), this.tab === 'sell' ? 0xffd84a : 0xffffff).root);
    p.add(
      this.scene.add.text(12, 80, `Gold ${w.player.gold}    Weight ${w.weight()} / ${w.maxWeight()}`, { ...TEXT, fontSize: '12px', color: TONE.gold }),
    );

    const items: SellRow[] =
      this.tab === 'buy' ? shop.items.map((id) => ({ kind: 'stack', item: w.content.items.get(id)! })) : this.sellable();
    if (this.tab === 'sell' && items.length > 0) {
      const etc = items.flatMap((r) => (r.kind === 'stack' && r.item.type === 'etc' ? [r.item] : []));
      const total = etc.reduce((sum, i) => sum + sellPrice(i.price) * (w.player.inventory.get(i.id) ?? 0), 0);
      p.add(
        makeButton(this.scene, 12, p.h - 84, p.w - 24, 34, `Sell all loot (+${total} gold)`, () => {
          for (const i of etc) w.sell(i.id, w.player.inventory.get(i.id) ?? 0);
          this.message = `Sold your loot for ${total} gold.`;
          this.refresh();
        }).setEnabled(total > 0).root,
      );
    }
    if (items.length === 0) p.add(this.scene.add.text(12, 110, 'Nothing to sell.', { ...TEXT, fontSize: '13px', color: TONE.muted }));

    this.page = pagedList(
      p,
      items,
      this.page,
      104,
      this.tab === 'sell' ? 84 : 40,
      ROW_H,
      (row, y, pw) => (row.kind === 'stack' ? this.row(row.item, y, pw) : this.pieceRow(row.piece, y, pw)),
      (pg) => {
        this.page = pg;
        this.refresh();
      },
    );
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: TONE.good, wordWrap: { width: p.w - 24 } }));
  }

  /** Stackables, then each unequipped piece of gear on its own row. */
  private sellable(): SellRow[] {
    const w = this.world;
    const stacks: SellRow[] = [...w.player.inventory.keys()]
      .map((id) => w.content.items.get(id))
      .filter((i): i is ItemDef => !!i)
      .map((item) => ({ kind: 'stack', item }));
    return [...stacks, ...w.player.gear.map((piece): SellRow => ({ kind: 'piece', piece }))];
  }

  private pieceRow(piece: GearPiece, y: number, pw: number): void {
    this.panel.add(itemName(this.scene, this.world, 12, y + 4, pieceName(piece), piece.item, piece));
    const warn = isPlain(piece) ? '' : ' · refined/carded!';
    this.panel.add(
      this.scene.add.text(12, y + 20, `${sellPrice(piece.item.price)} gold · wt ${piece.item.weight}${warn}`, {
        ...TEXT,
        fontSize: '11px',
        color: isPlain(piece) ? TONE.muted : TONE.warn,
      }),
    );
    this.panel.add(this.scene.add.text(12, y + 40, itemInfo(piece.item, this.world.content), { ...TEXT, fontSize: '10px', color: TONE.accent, wordWrap: { width: pw - 24 }, maxLines: 3 }));
    this.panel.add(
      makeButton(this.scene, pw - 68, y + 4, 56, 34, 'Sell', () => {
        const err = this.world.sellPiece(piece.uid);
        this.message = err ?? `Sold ${pieceName(piece)}.`;
        this.refresh();
      }).root,
    );
  }

  private row(item: ItemDef, y: number, pw: number): void {
    const w = this.world;
    const have = w.itemCount(item.id);
    const price = this.tab === 'buy' ? item.price : sellPrice(item.price);
    this.panel.add(itemName(this.scene, w, 12, y + 4, item.name, item));
    this.panel.add(
      this.scene.add.text(12, y + 20, `${price} gold · wt ${item.weight} · have ${have}`, { ...TEXT, fontSize: '11px', color: TONE.muted }),
    );
    // What it is and does, for every kind of item; tap the name for the full card.
    const desc = this.panel.add(
      this.scene.add.text(12, y + 40, itemInfo(item, w.content), { ...TEXT, fontSize: '10px', color: TONE.accent, wordWrap: { width: pw - 24 }, maxLines: item.equip ? 2 : 3 }),
    );
    if (item.equip) {
      if (this.tab === 'buy') {
        const blocker = equipBlocker(w.player, item);
        const deltas = blocker ? [] : previewEquip(w.player, w.newPiece(item));
        const color = blocker ? TONE.bad : deltas.length && deltas.every((d) => d.delta > 0) ? TONE.good : deltas.length && deltas.every((d) => d.delta < 0) ? TONE.bad : TONE.ink;
        this.panel.add(
          this.scene.add.text(12, desc.y + desc.height + 1, blocker ?? `If worn: ${formatDeltas(deltas)}`, { ...TEXT, fontSize: '10px', fontStyle: 'bold', color, wordWrap: { width: pw - 24 } }),
        );
      }
    }
    const act = (count: number) => () => {
      const err = this.tab === 'buy' ? w.buy(this.shopId!, item.id, count) : w.sell(item.id, count);
      this.message = err ?? `${this.tab === 'buy' ? 'Bought' : 'Sold'} ${count} × ${item.name}.`;
      this.refresh();
    };
    const verb = this.tab === 'buy' ? 'Buy' : 'Sell';
    this.panel.add(makeButton(this.scene, pw - 132, y + 4, 58, 34, `${verb} 1`, act(1)).root);
    const many = this.tab === 'buy' ? 10 : have;
    this.panel.add(
      makeButton(this.scene, pw - 68, y + 4, 56, 34, this.tab === 'buy' ? '×10' : 'All', act(Math.max(1, many))).setEnabled(many > 1).root,
    );
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.message = '';
    this.refresh();
  }
}
