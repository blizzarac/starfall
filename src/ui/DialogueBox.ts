import type Phaser from 'phaser';
import { DialogueRunner } from '../core/dialogue';
import type { World } from '../core/world';
import type { NpcDef } from '../data/schemas';
import { COLORS, TEXT } from '../render/palette';
import { makeButton, Panel } from './widgets';

/** Conversation window: NPC text plus one button per choice. */
export class DialogueBox {
  readonly panel: Panel;
  private runner: DialogueRunner | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly onShop: (shopId: string) => void,
    private readonly onRefine: () => void,
    private readonly onQuests: () => void,
    private readonly onStorage: () => void,
    private readonly onCraft: () => void,
  ) {
    this.panel = new Panel(
      scene,
      '',
      (sw, sh) => {
        const w = Math.min(420, sw - 24);
        const h = Math.min(320, sh - 40);
        return { w, h, x: Math.round((sw - w) / 2), y: sh - h - 12 };
      },
      () => this.close(),
      true,
    );
  }

  open(npc: NpcDef): void {
    const def = this.world.content.dialogues.get(npc.dialogue);
    if (!def) return;
    this.runner = new DialogueRunner(this.world, def, npc);
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.runner = null;
    this.panel.setVisible(false);
  }

  refresh(): void {
    const view = this.runner?.view();
    if (!this.runner || !view) {
      const shop = this.runner?.openShop;
      const refine = this.runner?.openRefine;
      const quests = this.runner?.openQuests;
      const storage = this.runner?.openStorage;
      const craft = this.runner?.openCraft;
      this.close();
      if (shop) this.onShop(shop);
      if (refine) this.onRefine();
      if (quests) this.onQuests();
      if (storage) this.onStorage();
      if (craft) this.onCraft();
      return;
    }
    const p = this.panel;
    p.layout();
    p.clear();
    p.setTitle(view.speaker);
    // Speech-bubble tail rising from the name box toward the speaker.
    p.add(
      this.scene.add
        .graphics()
        .fillStyle(COLORS.ink)
        .fillTriangle(28, 1, 64, 1, 34, -22),
    );
    const text = p.add(
      this.scene.add.text(14, 46, view.text, { ...TEXT, fontSize: '15px', fontStyle: 'bold', lineSpacing: 5, wordWrap: { width: p.w - 28 } }),
    );
    const choices = view.choices.length > 0 ? view.choices : ['Goodbye'];
    const btnH = 36;
    let y = Math.max(text.y + text.height + 14, p.h - 12 - choices.length * (btnH + 6));
    choices.forEach((label, i) => {
      p.add(
        makeButton(this.scene, 12, y, p.w - 24, btnH, label, () => {
          this.runner?.choose(i);
          this.refresh();
        }).root,
      );
      y += btnH + 6;
    });
  }
}
