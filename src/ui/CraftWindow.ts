import type Phaser from 'phaser';
import type { World } from '../core/world';
import type { RecipeDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';
import { gearVerdict } from './compare';
import { itemName } from './ItemInfo';

const ROW_H = 80;

/** The tinkerer's bench: every recipe with what you have of each material; ones you can make come first. */
export class CraftWindow {
  readonly panel: Panel;
  private page = 0;
  private message = '';
  private messageColor = TONE.good;
  /** Show only recipes you can make right now. */
  private onlyReady = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Tinker', centered(400, 600, 20), () => this.close(), true);
  }

  open(): void {
    this.message = '';
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
    p.add(this.scene.add.text(12, 42, `Gold ${w.player.gold}`, { ...TEXT, fontSize: '12px', color: TONE.gold }));
    p.add(
      makeButton(this.scene, p.w - 132, 38, 120, 26, this.onlyReady ? 'Show all' : 'Only ready', () => {
        this.onlyReady = !this.onlyReady;
        this.page = 0;
        this.refresh();
      }).root,
    );
    const ready = (r: RecipeDef) => w.craftShortfall(r.id).length === 0;
    const upgrade = (r: RecipeDef) => {
      const item = w.content.items.get(r.result)!;
      return !!item.equip && gearVerdict(w.player, w.newPiece(item)).better;
    };
    // Ones you can make first, and upgrades for you first within each group.
    const recipes = [...w.content.recipes.values()]
      .filter((r) => !this.onlyReady || ready(r))
      .map((r) => ({ r, key: Number(ready(r)) * 2 + Number(upgrade(r)) }))
      .sort((a, b) => b.key - a.key)
      .map(({ r }) => r);
    if (recipes.length === 0) {
      p.add(this.scene.add.text(12, 80, 'Nothing you can make yet. Monsters drop the materials.', { ...TEXT, fontSize: '12px', color: TONE.muted, wordWrap: { width: p.w - 24 } }));
    }
    this.page = pagedList(p, recipes, this.page, 74, 40, ROW_H, (r, y, pw) => this.row(r, y, pw), (pg) => {
      this.page = pg;
      this.refresh();
    });
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: this.messageColor, wordWrap: { width: p.w - 24 } }));
  }

  private row(r: RecipeDef, y: number, pw: number): void {
    const w = this.world;
    const item = w.content.items.get(r.result)!;
    const can = w.craftShortfall(r.id).length === 0;
    const level = item.equip?.minLevel && item.equip.minLevel > 1 ? `  · Lv ${item.equip.minLevel}` : '';
    // Gear: how it compares with what you wear now, flagged when it's a clear upgrade.
    const verdict = item.equip ? gearVerdict(w.player, w.newPiece(item)) : null;
    const name = this.panel.add(itemName(this.scene, w, 12, y + 2, `${verdict?.better ? '▲ ' : ''}${item.name}${r.count > 1 ? ` ×${r.count}` : ''}${level}`, item));
    if (verdict?.better) name.setColor(TONE.good);
    // Each material with how many you have, red when short.
    const parts = r.materials.map((m) => {
      const have = w.itemCount(m.item);
      return { text: `${w.content.items.get(m.item)!.name} ${have}/${m.count}`, ok: have >= m.count };
    });
    parts.push({ text: `${r.gold}g`, ok: w.player.gold >= r.gold });
    let x = 12;
    let line = 0;
    for (const part of parts) {
      const t = this.scene.add.text(x, y + 20 + line * 15, part.text, { ...TEXT, fontSize: '11px', color: part.ok ? TONE.muted : TONE.bad });
      if (x > 12 && x + t.width > pw - 92) {
        line += 1;
        x = 12;
        t.setPosition(x, y + 20 + line * 15);
      }
      this.panel.add(t);
      x += t.width + 10;
    }
    const below = y + 20 + (line + 1) * 15;
    if (verdict) {
      this.panel.add(this.scene.add.text(12, below, verdict.text, { ...TEXT, fontSize: '11px', fontStyle: 'bold', color: verdict.color, wordWrap: { width: pw - 108 }, maxLines: 2 }));
    } else if (item.petGear && w.player.pets.length > 0) {
      const bare = w.player.pets.filter((pet) => !pet.gear);
      const text = bare.length > 0 ? `${bare.map((pet) => pet.name).join(', ')} wear${bare.length === 1 ? 's' : ''} nothing yet` : `Your pets wear: ${w.player.pets.map((pet) => pet.gear!.name).join(', ')}`;
      this.panel.add(
        this.scene.add.text(12, below, text, { ...TEXT, fontSize: '11px', fontStyle: 'bold', color: bare.length > 0 ? TONE.good : TONE.ink, wordWrap: { width: pw - 108 } }),
      );
    }
    this.panel.add(
      makeButton(this.scene, pw - 84, y + 8, 72, 32, 'Craft', () => {
        const result = w.craft(r.id);
        if ('error' in result) {
          this.message = result.error;
          this.messageColor = TONE.bad;
        } else {
          this.message = `Made ${item.name}${result.count > 1 ? ` ×${result.count}` : ''}!`;
          this.messageColor = TONE.good;
        }
        this.refresh();
      }, can ? 0xffd84a : 0xffffff).setEnabled(can).root,
    );
  }
}
