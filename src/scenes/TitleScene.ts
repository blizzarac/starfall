import Phaser from 'phaser';
import { SLOT_IDS, type SaveDb } from '../save/db';
import { downloadSave, getLastSlot, parseSaveFile, pickFile } from '../save/manager';
import type { SlotMeta } from '../save/schema';
import { COLORS, TEXT } from '../render/palette';
import { startSession } from './session';

const CARD_H = 110;
const CARD_GAP = 12;

/** Slot selection: continue, start a new character, or export / import / delete a save. */
export class TitleScene extends Phaser.Scene {
  private db!: SaveDb;
  private cards: Phaser.GameObjects.Container[] = [];
  private status!: Phaser.GameObjects.Text;
  private heading!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private slots = new Map<number, SlotMeta>();
  private busy = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.db = this.registry.get('db') as SaveDb;
    this.cards = [];
    this.busy = false;
    this.cameras.main.setBackgroundColor('#2f5d3a');
    this.heading = this.add.text(0, 0, 'Starfall', { ...TEXT, fontSize: '40px', fontStyle: 'bold', strokeThickness: 6 }).setOrigin(0.5, 0);
    this.sub = this.add.text(0, 0, 'Choose a save slot', { ...TEXT, fontSize: '14px', color: '#d6deea' }).setOrigin(0.5, 0);
    this.status = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '13px', align: 'center', wordWrap: { width: 340 } })
      .setOrigin(0.5, 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.slots = await this.db.listSlots();
    } catch (err) {
      this.slots = new Map();
      this.say(`Saves are unavailable in this browser (${err instanceof Error ? err.message : err}).`);
    }
    this.buildCards();
  }

  private layout(): void {
    const { width } = this.scale;
    const top = Math.max(24, this.scale.height / 2 - (3 * (CARD_H + CARD_GAP) + 120) / 2);
    this.heading.setPosition(width / 2, top);
    this.sub.setPosition(width / 2, top + 54);
    this.cards.forEach((card, i) => card.setPosition(width / 2, top + 90 + i * (CARD_H + CARD_GAP)));
    this.status.setPosition(width / 2, top + 90 + 3 * (CARD_H + CARD_GAP) + 4).setWordWrapWidth(Math.min(380, width - 32));
  }

  private buildCards(): void {
    this.cards.forEach((c) => c.destroy());
    const w = Math.min(380, this.scale.width - 32);
    const last = getLastSlot();
    this.cards = SLOT_IDS.map((id) => {
      const meta = this.slots.get(id);
      const lit = meta && id === last;
      const bg = this.add
        .rectangle(0, 0, w, CARD_H, COLORS.ui, 0.88)
        .setOrigin(0.5, 0)
        .setStrokeStyle(lit ? 3 : 1, lit ? 0xffe27a : COLORS.uiBorder, lit ? 1 : 0.6)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => void this.play(id));
      const left = -w / 2 + 14;
      const children: Phaser.GameObjects.GameObject[] = [bg];
      if (meta) {
        children.push(
          this.add.text(left, 10, `${meta.name}`, { ...TEXT, fontSize: '17px', fontStyle: 'bold' }),
          this.add.text(left, 34, `${meta.jobName}  ·  Base Lv ${meta.baseLevel}  ·  Job Lv ${meta.jobLevel}`, { ...TEXT, fontSize: '12px' }),
          this.add.text(left, 52, `${formatPlaytime(meta.playtimeMs)} played  ·  saved ${formatAgo(meta.savedAt)}`, {
            ...TEXT,
            fontSize: '11px',
            color: '#c4cfdf',
          }),
        );
      } else {
        children.push(
          this.add.text(left, 14, `Slot ${id}  ·  empty`, { ...TEXT, fontSize: '16px', color: '#c4cfdf' }),
          this.add.text(left, 40, 'Tap to start a new character', { ...TEXT, fontSize: '12px', color: '#c4cfdf' }),
        );
      }
      const actions: Array<[string, () => void]> = meta
        ? [
            ['Export', () => void this.exportSlot(id)],
            ['Import', () => void this.importSlot(id)],
            ['Delete', () => void this.deleteSlot(id)],
          ]
        : [['Import', () => void this.importSlot(id)]];
      let x = w / 2 - 10;
      for (const [label, fn] of actions.reverse()) {
        const btn = this.add
          .text(x, CARD_H - 10, label, { ...TEXT, fontSize: '12px', backgroundColor: '#3a4a63', padding: { x: 10, y: 6 } })
          .setOrigin(1, 1)
          .setInteractive({ useHandCursor: true })
          .on('pointerup', fn);
        children.push(btn);
        x -= btn.width + 8;
      }
      return this.add.container(0, 0, children);
    });
    this.layout();
  }

  private say(text: string): void {
    this.status.setText(text);
  }

  /** Runs one slot action at a time so double taps can't start two games. */
  private async guarded(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
    }
  }

  private play(slot: number): Promise<void> {
    return this.guarded(async () => {
      if (this.slots.has(slot)) {
        const doc = await this.db.load(slot);
        if (!doc) throw new Error(`Slot ${slot} couldn't be read. Import a backup, or delete it to start over.`);
        await startSession(this, slot, doc);
        return;
      }
      const name = askName();
      if (name === null) return;
      await startSession(this, slot, null, name);
    });
  }

  private exportSlot(slot: number): Promise<void> {
    return this.guarded(async () => {
      const doc = await this.db.load(slot);
      if (!doc) throw new Error(`Slot ${slot} has no readable save to export.`);
      downloadSave(doc);
      this.say(`Exported ${doc.character.name}. Keep the file somewhere safe.`);
    });
  }

  private importSlot(slot: number): Promise<void> {
    return this.guarded(async () => {
      const text = await pickFile();
      if (text === null) return;
      const doc = parseSaveFile(text);
      const existing = this.slots.get(slot);
      if (existing && !window.confirm(`Replace ${existing.name} (Lv ${existing.baseLevel}) in slot ${slot} with ${doc.character.name} (Lv ${doc.character.baseLevel})?`)) {
        return;
      }
      await this.db.write(slot, doc);
      this.say(`Imported ${doc.character.name} into slot ${slot}.`);
      await this.refresh();
    });
  }

  private deleteSlot(slot: number): Promise<void> {
    return this.guarded(async () => {
      const meta = this.slots.get(slot);
      if (!meta || !window.confirm(`Delete ${meta.name} (Lv ${meta.baseLevel})? This can't be undone unless you exported a backup.`)) return;
      await this.db.clearSlot(slot);
      this.say(`Slot ${slot} cleared.`);
      await this.refresh();
    });
  }
}

function askName(): string | null {
  const raw = window.prompt('Name your character', 'Adventurer');
  if (raw === null) return null;
  const name = raw.trim().slice(0, 24);
  return name || 'Adventurer';
}

function formatPlaytime(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
