import type Phaser from 'phaser';
import { HOTBAR_SIZE } from '../core/entities';
import { isSkillId, SKILLS } from '../core/skills';
import type { World } from '../core/world';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, Panel } from './widgets';

const ROW_H = 46;

/** Reorder or remove quick-bar entries. Adding happens from the Skills and Items windows. */
export class HotbarWindow {
  readonly panel: Panel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Quick bar', centered(360, 40 + 60 + HOTBAR_SIZE * ROW_H + 20), () => this.close(), true);
    world.events.on('hotbarChanged', () => this.panel.visible && this.refresh());
  }

  open(): void {
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
    const bar = w.player.hotbar;
    p.add(
      this.scene.add.text(12, 42, `Up to ${HOTBAR_SIZE} skills and items, left to right on screen. Add them with "Bar" in Skills or Items.`, {
        ...TEXT,
        fontSize: '12px',
        color: TONE.muted,
        wordWrap: { width: p.w - 24 },
      }),
    );
    if (bar.length === 0) p.add(this.scene.add.text(12, 96, 'The bar is empty.', { ...TEXT, fontSize: '13px' }));
    bar.forEach((id, i) => {
      const y = 92 + i * ROW_H;
      const name = isSkillId(id) ? SKILLS[id].name : (w.content.items.get(id)?.name ?? id);
      p.add(this.scene.add.text(12, y + 10, `${i + 1}. ${name}`, { ...TEXT, fontSize: '13px', fontStyle: 'bold' }));
      p.add(makeButton(this.scene, p.w - 150, y + 2, 40, 36, '◀', () => w.moveHotbar(id, -1)).setEnabled(i > 0).root);
      p.add(makeButton(this.scene, p.w - 104, y + 2, 40, 36, '▶', () => w.moveHotbar(id, 1)).setEnabled(i < bar.length - 1).root);
      p.add(makeButton(this.scene, p.w - 58, y + 2, 46, 36, '✕', () => w.toggleHotbar(id), 0xffa8a0).root);
    });
  }
}
