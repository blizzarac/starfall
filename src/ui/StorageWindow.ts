import type Phaser from 'phaser';
import { describePiece, pieceName, type GearPiece } from '../core/equipment';
import { STORAGE_CAPACITY, type World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 50;
type Tab = 'bag' | 'storage';
type Row = { kind: 'stack'; item: ItemDef; count: number } | { kind: 'piece'; piece: GearPiece };

/** The courier's shared stash: move items between your bag and storage. */
export class StorageWindow {
  readonly panel: Panel;
  private page = 0;
  private tab: Tab = 'bag';
  private message = '';
  private messageColor = TONE.good;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Storage', centered(380, 560, 20), () => this.close(), true);
    const refresh = () => this.panel.visible && this.refresh();
    world.events.on('storageChanged', refresh);
    world.events.on('inventoryChanged', refresh);
  }

  open(): void {
    this.message = '';
    this.tab = 'bag';
    this.page = 0;
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.panel.setVisible(false);
  }

  refresh(): void {
    const w = this.world;
    const p = this.panel;
    p.layout();
    p.clear();
    const tabW = (p.w - 30) / 2;
    p.add(makeButton(this.scene, 12, 40, tabW, 32, 'Your bag', () => this.setTab('bag'), this.tab === 'bag' ? 0xffd84a : 0xffffff).root);
    p.add(makeButton(this.scene, 18 + tabW, 40, tabW, 32, 'Storage', () => this.setTab('storage'), this.tab === 'storage' ? 0xffd84a : 0xffffff).root);
    p.add(
      this.scene.add.text(12, 80, `Storage ${w.storageUsed()} / ${STORAGE_CAPACITY}    Weight ${w.weight()} / ${w.maxWeight()}`, {
        ...TEXT,
        fontSize: '12px',
        color: TONE.gold,
      }),
    );
    const rows = this.rows();
    if (rows.length === 0) {
      const empty = this.tab === 'bag' ? 'Nothing in your bag to store.' : 'Storage is empty. Every one of your characters shares it.';
      p.add(this.scene.add.text(12, 106, empty, { ...TEXT, fontSize: '13px', color: TONE.muted, wordWrap: { width: p.w - 24 } }));
    }
    this.page = pagedList(p, rows, this.page, 102, 34, ROW_H, (row, y, pw) => this.row(row, y, pw), (pg) => {
      this.page = pg;
      this.refresh();
    });
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: this.messageColor, wordWrap: { width: p.w - 24 } }));
  }

  private rows(): Row[] {
    const w = this.world;
    const stacks = this.tab === 'bag' ? w.player.inventory : w.storage.items;
    const gear = this.tab === 'bag' ? w.player.gear : w.storage.gear;
    const out: Row[] = [];
    for (const [id, count] of stacks) {
      const item = w.content.items.get(id);
      if (item) out.push({ kind: 'stack', item, count });
    }
    for (const piece of gear) out.push({ kind: 'piece', piece });
    const name = (r: Row) => (r.kind === 'stack' ? r.item.name : r.piece.item.name);
    return out.sort((a, b) => name(a).localeCompare(name(b)));
  }

  private row(row: Row, y: number, pw: number): void {
    const toStorage = this.tab === 'bag';
    if (row.kind === 'piece') {
      this.line(pieceName(row.piece), describePiece(row.piece), y, pw);
      this.button(toStorage ? 'Store' : 'Take', pw - 76, 64, y, () =>
        this.result(toStorage ? this.world.storePiece(row.piece.uid) : this.world.takePiece(row.piece.uid), pieceName(row.piece)),
      );
      return;
    }
    const { item, count } = row;
    this.line(`${item.name} ×${count}`, item.description ?? item.type, y, pw);
    const move = (n: number) =>
      this.result(toStorage ? this.world.store(item.id, n) : this.world.takeOut(item.id, n), n > 1 ? `${item.name} ×${n}` : item.name);
    this.button('All', pw - 64, 52, y, () => move(count));
    if (count > 1) this.button('1', pw - 112, 42, y, () => move(1));
  }

  private result(err: string | null, what: string): void {
    this.message = err ?? `${this.tab === 'bag' ? 'Stored' : 'Took out'} ${what}.`;
    this.messageColor = err ? TONE.bad : TONE.good;
    this.refresh();
  }

  private line(title: string, detail: string, y: number, pw: number): void {
    this.panel.add(this.scene.add.text(12, y + 2, title, { ...TEXT, fontSize: '13px' }));
    this.panel.add(this.scene.add.text(12, y + 20, detail, { ...TEXT, fontSize: '11px', color: TONE.muted, wordWrap: { width: pw - 136 } }));
  }

  private button(label: string, x: number, w: number, y: number, onTap: () => void): void {
    this.panel.add(makeButton(this.scene, x, y + 4, w, 36, label, onTap).root);
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.page = 0;
    this.message = '';
    this.refresh();
  }
}
