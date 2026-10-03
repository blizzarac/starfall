import type Phaser from 'phaser';
import { JOURNAL } from '../core/story';
import type { World } from '../core/world';
import { TEXT, TONE } from '../render/palette';
import { centered, Panel } from './widgets';

/** What happened so far, as fragments: quotes and objects, never explanations. */
export class JournalWindow {
  readonly panel: Panel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Journal', centered(380, 600, 20), () => this.close(), true);
  }

  open(): void {
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.panel.setVisible(false);
  }

  refresh(): void {
    const p = this.panel;
    p.layout();
    p.clear();
    const flags = this.world.flags;
    const entries = JOURNAL.filter((e) => flags.has(e.flag) && (e.value === undefined || flags.get(e.flag) === e.value));
    if (entries.length === 0) {
      p.add(this.scene.add.text(14, 48, 'Nothing yet.', { ...TEXT, fontSize: '13px', color: TONE.muted }));
      return;
    }
    // Newest last, like a diary; if it runs long, the oldest scroll off the top.
    let y = 46;
    const texts = entries.map((e) => this.scene.add.text(14, 0, e.text, { ...TEXT, fontSize: '13px', fontStyle: 'italic', wordWrap: { width: p.w - 28 }, lineSpacing: 3 }));
    const room = p.h - 60;
    let total = texts.reduce((sum, t) => sum + t.height + 12, 0);
    let first = 0;
    while (total > room && first < texts.length - 1) total -= texts[first++]!.height + 12;
    texts.forEach((t, i) => {
      if (i < first) return void t.destroy();
      t.setY(y);
      p.add(t);
      y += t.height + 12;
    });
  }
}
