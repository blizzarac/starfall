import type Phaser from 'phaser';
import type { World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 44;
const TYPE_ORDER: Record<ItemDef['type'], number> = { consumable: 0, equipment: 1, card: 2, etc: 3 };

/** Everything you carry. Consumables can be used straight from the list. */
export class InventoryWindow {
  readonly panel: Panel;
  private page = 0;
  private selected: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Items', centered(360, 520), () => this.close());
    world.events.on('inventoryChanged', () => this.panel.visible && this.refresh());
  }

  open(): void {
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
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
    const ratio = w.weightRatio();
    const color = ratio >= 0.9 ? '#ff6b6b' : ratio >= 0.5 ? '#ffb15a' : '#ffe27a';
    p.add(this.scene.add.text(12, 40, `Gold ${w.player.gold}    Weight ${w.weight()} / ${w.maxWeight()}`, { ...TEXT, fontSize: '12px', color }));
    if (ratio >= 0.5) {
      p.add(
        this.scene.add.text(12, 58, ratio >= 0.9 ? 'Overweight: you can’t attack.' : 'Heavy: no natural HP/SP recovery.', {
          ...TEXT,
          fontSize: '11px',
          color,
        }),
      );
    }
    const items = [...w.player.inventory.keys()]
      .map((id) => w.content.items.get(id))
      .filter((i): i is ItemDef => !!i)
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
    if (items.length === 0) p.add(this.scene.add.text(12, 84, 'Your bag is empty.', { ...TEXT, fontSize: '13px', color: '#c4cfdf' }));

    this.page = pagedList(
      p,
      items,
      this.page,
      80,
      54,
      ROW_H,
      (item, y, pw) => this.row(item, y, pw),
      (pg) => {
        this.page = pg;
        this.refresh();
      },
    );
    const sel = this.selected ? w.content.items.get(this.selected) : undefined;
    const desc = sel ? `${sel.name}: ${sel.description ?? ''}` : 'Tap an item name for details.';
    p.add(this.scene.add.text(12, p.h - 50, desc, { ...TEXT, fontSize: '12px', color: '#c4cfdf', wordWrap: { width: p.w - 24 } }));
  }

  private row(item: ItemDef, y: number, pw: number): void {
    const count = this.world.player.inventory.get(item.id) ?? 0;
    const name = this.scene.add
      .text(12, y + 4, `${item.name} ×${count}`, { ...TEXT, fontSize: '13px' })
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        this.selected = item.id;
        this.refresh();
      });
    this.panel.add(name);
    this.panel.add(this.scene.add.text(12, y + 22, `${item.type} · wt ${item.weight * count}`, { ...TEXT, fontSize: '11px', color: '#c4cfdf' }));
    if (item.type === 'consumable') {
      this.panel.add(makeButton(this.scene, pw - 72, y + 4, 60, 34, 'Use', () => this.world.useItem(item.id)).root);
    }
  }
}
