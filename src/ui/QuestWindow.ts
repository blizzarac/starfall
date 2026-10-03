import type Phaser from 'phaser';
import { MAX_ACTIVE_QUESTS, questState, type QuestState } from '../core/quests';
import type { World } from '../core/world';
import type { QuestDef } from '../data/schemas';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 74;
const STATE_ORDER: Record<QuestState, number> = { ready: 0, active: 1, available: 2, locked: 3 };

/**
 * The hunting board. At the board you can take and hand in hunts; opened
 * from the menu it's a read-only log of what you're on.
 */
export class QuestWindow {
  readonly panel: Panel;
  private page = 0;
  private atBoard = false;
  private message = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Hunting Board', centered(400, 580, 20), () => this.close(), true);
    const refresh = () => this.panel.visible && this.refresh();
    world.events.on('questProgress', refresh);
    world.events.on('questCompleted', refresh);
  }

  open(atBoard: boolean): void {
    this.atBoard = atBoard;
    this.page = 0;
    this.message = '';
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
    p.setTitle(this.atBoard ? 'Hunting Board' : 'Quest Log');
    const active = w.player.quests.active.size;
    p.add(
      this.scene.add.text(12, 40, `Active hunts ${active}/${MAX_ACTIVE_QUESTS}${this.atBoard ? '' : '  ·  hand in at the board in Brightmoor'}`, {
        ...TEXT,
        fontSize: '12px',
        color: TONE.gold,
      }),
    );
    const quests = [...w.content.quests.values()]
      .filter((q) => this.atBoard || w.player.quests.active.has(q.id))
      .sort((a, b) => STATE_ORDER[questState(w.player, a)] - STATE_ORDER[questState(w.player, b)] || a.minLevel - b.minLevel);
    if (quests.length === 0) p.add(this.scene.add.text(12, 70, 'No hunts in progress.', { ...TEXT, fontSize: '13px', color: TONE.muted }));
    this.page = pagedList(p, quests, this.page, 64, 34, ROW_H, (q, y, pw) => this.row(q, y, pw), (pg) => {
      this.page = pg;
      this.refresh();
    });
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: TONE.good, wordWrap: { width: p.w - 24 } }));
  }

  private row(q: QuestDef, y: number, pw: number): void {
    const w = this.world;
    const state = questState(w.player, q);
    const monster = w.content.monsters.get(q.target.monster)!;
    const progress = w.player.quests.active.get(q.id) ?? 0;
    const done = w.player.quests.done.get(q.id) ?? 0;
    const color = state === 'locked' ? TONE.disabled : state === 'ready' ? TONE.good : TONE.ink;
    this.panel.add(this.scene.add.text(12, y, `${q.name}${done ? `  ×${done}` : ''}`, { ...TEXT, fontSize: '13px', fontStyle: 'bold', color }));
    const goal = state === 'active' || state === 'ready' ? `${progress}/${q.target.count}` : `${q.target.count}`;
    this.panel.add(
      this.scene.add.text(12, y + 18, `Defeat ${goal} ${monster.name} · Lv ${q.minLevel}+`, { ...TEXT, fontSize: '11px', color: TONE.muted }),
    );
    const items = q.reward.items.map((it) => `${it.count}× ${w.content.items.get(it.id)?.name ?? it.id}`);
    const reward = [`${q.reward.gold} gold`, `${q.reward.baseXp}/${q.reward.jobXp} XP`, ...items].join(' · ');
    this.panel.add(this.scene.add.text(12, y + 34, reward, { ...TEXT, fontSize: '11px', color: TONE.gold, wordWrap: { width: pw - 110 } }));

    const act = (label: string, fn: () => string | null, ok: string, color?: number) =>
      this.panel.add(
        makeButton(this.scene, pw - 92, y + 4, 80, 38, label, () => {
          this.message = fn() ?? ok;
          this.refresh();
        }, color).root,
      );
    if (state === 'ready' && this.atBoard) act('Turn in', () => w.turnInQuest(q.id), `Hunt complete: ${q.name}!`, 0x9be38f);
    else if (state === 'available' && this.atBoard) act('Accept', () => w.acceptQuest(q.id), `Accepted ${q.name}.`);
    else if (state === 'active' || (state === 'ready' && !this.atBoard))
      act('Abandon', () => (w.abandonQuest(q.id), null), `Abandoned ${q.name}.`, 0xffa8a0);
  }
}
