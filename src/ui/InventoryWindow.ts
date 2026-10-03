import type Phaser from 'phaser';
import { describeGear, EQUIP_SLOTS, SLOT_NAMES } from '../core/equipment';
import { derivedStats } from '../core/progression';
import type { World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 50;
const TYPE_ORDER: Record<ItemDef['type'], number> = { consumable: 0, equipment: 1, card: 2, etc: 3 };
type Tab = 'bag' | 'gear';

/** Your bag (use or equip items) and what you're wearing. */
export class InventoryWindow {
  readonly panel: Panel;
  private page = 0;
  private tab: Tab = 'bag';
  private message = '';

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
    const tabW = (p.w - 30) / 2;
    p.add(makeButton(this.scene, 12, 40, tabW, 32, 'Bag', () => this.setTab('bag'), this.tab === 'bag' ? 0x5a7bb8 : 0x3a4a63).root);
    p.add(makeButton(this.scene, 18 + tabW, 40, tabW, 32, 'Gear', () => this.setTab('gear'), this.tab === 'gear' ? 0x5a7bb8 : 0x3a4a63).root);
    const ratio = w.weightRatio();
    const color = ratio >= 0.9 ? '#ff6b6b' : ratio >= 0.5 ? '#ffb15a' : '#ffe27a';
    const warn = ratio >= 0.9 ? '  overweight: no attacking' : ratio >= 0.5 ? '  heavy: no natural recovery' : '';
    p.add(this.scene.add.text(12, 80, `Gold ${w.player.gold}    Weight ${w.weight()} / ${w.maxWeight()}${warn}`, { ...TEXT, fontSize: '12px', color }));
    if (this.tab === 'bag') this.bag();
    else this.gear();
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: '#9be38f', wordWrap: { width: p.w - 24 } }));
  }

  private bag(): void {
    const w = this.world;
    const items = [...w.player.inventory.keys()]
      .map((id) => w.content.items.get(id))
      .filter((i): i is ItemDef => !!i)
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
    if (items.length === 0) this.panel.add(this.scene.add.text(12, 106, 'Your bag is empty.', { ...TEXT, fontSize: '13px', color: '#c4cfdf' }));
    this.page = pagedList(
      this.panel,
      items,
      this.page,
      102,
      34,
      ROW_H,
      (item, y, pw) => this.bagRow(item, y, pw),
      (pg) => {
        this.page = pg;
        this.refresh();
      },
    );
  }

  private bagRow(item: ItemDef, y: number, pw: number): void {
    const count = this.world.player.inventory.get(item.id) ?? 0;
    this.panel.add(this.scene.add.text(12, y + 2, `${item.name} ×${count}`, { ...TEXT, fontSize: '13px' }));
    const detail = item.equip ? describeGear(item.equip) : (item.description ?? item.type);
    this.panel.add(
      this.scene.add.text(12, y + 20, `${detail} · wt ${item.weight}`, { ...TEXT, fontSize: '11px', color: '#c4cfdf', wordWrap: { width: pw - 100 } }),
    );
    if (item.type === 'consumable') {
      this.panel.add(makeButton(this.scene, pw - 76, y + 4, 64, 36, 'Use', () => this.world.useItem(item.id)).root);
    } else if (item.equip) {
      this.panel.add(
        makeButton(this.scene, pw - 76, y + 4, 64, 36, 'Equip', () => {
          const err = this.world.equip(item.id);
          this.message = err ?? `Equipped ${item.name}.`;
          this.refresh();
        }).root,
      );
    }
  }

  private gear(): void {
    const p = this.world.player;
    const d = derivedStats(p);
    this.panel.add(this.scene.add.text(12, 100, `ATK ${d.atk}   DEF ${d.def}   HIT ${d.hit}   FLEE ${d.flee}`, { ...TEXT, fontSize: '12px' }));
    const rowH = Math.max(40, Math.min(ROW_H, Math.floor((this.panel.h - 160) / EQUIP_SLOTS.length)));
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = 124 + i * rowH;
      const item = p.equipment[slot];
      this.panel.add(this.scene.add.text(12, y + 2, SLOT_NAMES[slot], { ...TEXT, fontSize: '11px', color: '#9fb4d6' }));
      this.panel.add(this.scene.add.text(92, y + 2, item?.name ?? '—', { ...TEXT, fontSize: '13px', color: item ? '#f4f7fb' : '#7d8aa0' }));
      if (item?.equip) {
        this.panel.add(
          this.scene.add.text(92, y + 19, describeGear(item.equip), { ...TEXT, fontSize: '10px', color: '#c4cfdf', wordWrap: { width: this.panel.w - 190 } }),
        );
        this.panel.add(
          makeButton(this.scene, this.panel.w - 88, y + 2, 76, rowH - 8, 'Remove', () => {
            this.world.unequip(slot);
            this.message = `Removed ${item.name}.`;
            this.refresh();
          }).root,
        );
      }
    });
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.message = '';
    this.refresh();
  }
}
