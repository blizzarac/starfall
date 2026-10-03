import type Phaser from 'phaser';
import { sellPrice } from '../core/combat/formulas';
import { describePiece, equipBlocker, pieceName, type GearPiece } from '../core/equipment';
import { itemInfo } from '../core/items';
import type { World } from '../core/world';
import type { ItemDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { makeButton, Panel } from './widgets';

/** Marks a tappable item name in lists. */
export const INFO_MARK = ' ⓘ';

/** A card with everything about one item: what it does, its worth, weight, and whether you can use it. */
class ItemInfoPanel {
  readonly panel: Panel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(
      scene,
      'Item',
      (sw, sh) => {
        const w = Math.min(340, sw - 32);
        const h = Math.min(320, sh - 80);
        return { w, h, x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2) };
      },
      () => this.panel.setVisible(false),
      true,
    );
    this.panel.root.setDepth(80);
  }

  show(item: ItemDef, piece?: GearPiece): void {
    const p = this.panel;
    p.layout();
    p.clear();
    p.setTitle(piece ? pieceName(piece) : item.name);
    const w = this.world;
    let y = 46;
    const add = (text: string, style: Partial<Phaser.Types.GameObjects.Text.TextStyle>) => {
      const t = p.add(this.scene.add.text(14, y, text, { ...TEXT, fontSize: '13px', wordWrap: { width: p.w - 28 }, lineSpacing: 3, ...style }));
      y += t.height + 10;
    };
    add(itemInfo(item, w.content), {});
    if (piece && (piece.refine > 0 || piece.cards.length > 0)) add(`This piece: ${describePiece(piece)}`, { fontSize: '12px', color: TONE.accent });
    if (item.equip) {
      const blocker = equipBlocker(w.player, item);
      add(blocker ?? 'You can wear this.', { fontSize: '12px', fontStyle: 'bold', color: blocker ? TONE.bad : TONE.good });
    }
    add(`Price ${item.price} gold · sells for ${sellPrice(item.price)} · weight ${item.weight}\nYou have ${w.itemCount(item.id)}`, { fontSize: '11px', color: TONE.muted });
    p.add(makeButton(this.scene, p.w / 2 - 50, p.h - 48, 100, 34, 'OK', () => p.setVisible(false)).root);
    p.setVisible(true);
  }
}

const panels = new WeakMap<Phaser.Scene, ItemInfoPanel>();

/** Opens the detail card for an item (one shared card per scene run). */
export function showItemInfo(scene: Phaser.Scene, world: World, item: ItemDef, piece?: GearPiece): void {
  let panel = panels.get(scene);
  // Scenes are reused across sessions: a card from an earlier run was destroyed with it.
  if (!panel || !panel.panel.root.scene) {
    panel = new ItemInfoPanel(scene, world);
    panels.set(scene, panel);
  }
  panel.show(item, piece);
}

/** An item name in a list: tap it for the detail card. */
export function itemName(scene: Phaser.Scene, world: World, x: number, y: number, label: string, item: ItemDef, piece?: GearPiece): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label + INFO_MARK, { ...TEXT, fontSize: '13px', fontStyle: 'bold' })
    .setInteractive({ useHandCursor: true })
    .on('pointerup', () => showItemInfo(scene, world, item, piece));
}
