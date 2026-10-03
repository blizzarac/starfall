import Phaser from 'phaser';
import { SLOT_IDS, type SaveDb } from '../save/db';
import { downloadSave, getLastSlot, parseSaveFile, pickFile } from '../save/manager';
import type { SlotMeta } from '../save/schema';
import { JOBS } from '../core/jobs';
import { chibiOrigin, ensureChibi } from '../render/chibi';
import { COLORS, IMPACT_FONT, TEXT, TONE } from '../render/palette';
import { makeButton } from '../ui/widgets';
import { startSession } from './session';
import { audio } from '../audio/engine';
import { updateAudioSettings } from '../audio/settings';

const CARD_H = 112;
const CARD_GAP = 12;

/** Slot selection: continue, start a new character, or export / import / delete a save. */
export class TitleScene extends Phaser.Scene {
  private db!: SaveDb;
  private cards: Phaser.GameObjects.Container[] = [];
  private status!: Phaser.GameObjects.Text;
  private heading!: Phaser.GameObjects.Text;
  private backdrop!: Phaser.GameObjects.Graphics;
  private sub!: Phaser.GameObjects.Text;
  private soundToggle!: Phaser.GameObjects.Text;
  private slots = new Map<number, SlotMeta>();
  private busy = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.db = this.registry.get('db') as SaveDb;
    this.cards = [];
    this.busy = false;
    this.cameras.main.setBackgroundColor('#fffaf0');
    this.backdrop = this.add.graphics();
    // Manga cover lettering: big, tilted, yellow with a heavy ink outline.
    this.heading = this.add
      .text(0, 0, 'STARFALL', { fontFamily: IMPACT_FONT, fontSize: '64px', color: '#ffd84a', stroke: '#16131c', strokeThickness: 10 })
      .setOrigin(0.5, 0)
      .setAngle(-4)
      .setShadow(5, 5, '#16131c', 0, true, true);
    this.sub = this.add
      .text(0, 0, 'CHOOSE YOUR HERO', { fontFamily: IMPACT_FONT, fontSize: '18px', color: '#ffffff', backgroundColor: '#16131c', padding: { x: 12, y: 4 } })
      .setOrigin(0.5, 0);
    this.status = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '13px', align: 'center', wordWrap: { width: 340 } })
      .setOrigin(0.5, 0);
    // Music starts with the first tap (browsers block sound until then).
    audio.setTheme('title');
    this.soundToggle = this.add
      .text(0, 0, '', { fontFamily: IMPACT_FONT, fontSize: '16px', color: '#16131c', backgroundColor: '#ffffff', padding: { x: 10, y: 5 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        updateAudioSettings(this.db, { muted: !audio.current.muted });
        this.showSoundToggle();
      });
    this.showSoundToggle();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    void this.refresh();
  }

  private showSoundToggle(): void {
    this.soundToggle.setText(audio.current.muted ? 'SOUND OFF' : 'SOUND ON');
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
    const { width, height } = this.scale;
    const top = Math.max(24, this.scale.height / 2 - (3 * (CARD_H + CARD_GAP) + 140) / 2);
    this.heading.setPosition(width / 2, top - 6);
    this.soundToggle.setPosition(width - 10, 10);
    this.sub.setPosition(width / 2, top + 66);
    this.drawBackdrop(width, height, top + 30);
    this.cards.forEach((card, i) => card.setPosition(width / 2, top + 110 + i * (CARD_H + CARD_GAP)));
    this.status.setPosition(width / 2, top + 110 + 3 * (CARD_H + CARD_GAP) + 4).setWordWrapWidth(Math.min(380, width - 32));
  }

  private buildCards(): void {
    this.cards.forEach((c) => c.destroy());
    const w = Math.min(380, this.scale.width - 32);
    const last = getLastSlot();
    this.cards = SLOT_IDS.map((id) => {
      const meta = this.slots.get(id);
      const lit = meta && id === last;
      // Each slot is a comic panel; the last-played one gets a thick border and a tag.
      const shadow = this.add.rectangle(5, 5, w, CARD_H, COLORS.ink).setOrigin(0.5, 0);
      const bg = this.add
        .rectangle(0, 0, w, CARD_H, COLORS.paper)
        .setOrigin(0.5, 0)
        .setStrokeStyle(lit ? 5 : 3, COLORS.ink)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => void this.play(id));
      const job = meta ? Object.values(JOBS).find((j) => j.name === meta.jobName) : undefined;
      const left = -w / 2 + (job ? 64 : 14);
      const children: Phaser.GameObjects.GameObject[] = [shadow, bg];
      if (lit) {
        children.push(
          this.add
            .text(w / 2 - 8, -10, 'LAST PLAYED', { fontFamily: IMPACT_FONT, fontSize: '14px', color: '#16131c', backgroundColor: '#ffd84a', padding: { x: 6, y: 1 } })
            .setOrigin(1, 0)
            .setAngle(3),
        );
      }
      if (job) {
        const key = ensureChibi(this, `job-${job.id}`, job.look.body, COLORS.playerHair, job.look.extra);
        children.push(this.add.image(-w / 2 + 34, 60, key).setOrigin(0.5, chibiOrigin(this, key)).setScale(1.2));
      }
      if (meta) {
        children.push(
          this.add.text(left, 10, `${meta.name}`, { fontFamily: IMPACT_FONT, fontSize: '24px', color: '#16131c' }),
          this.add.text(left, 34, `${meta.jobName}  ·  Base Lv ${meta.baseLevel}  ·  Job Lv ${meta.jobLevel}`, { ...TEXT, fontSize: '12px' }),
          this.add.text(left, 52, `${formatPlaytime(meta.playtimeMs)} played  ·  saved ${formatAgo(meta.savedAt)}`, {
            ...TEXT,
            fontSize: '11px',
            color: TONE.muted,
          }),
        );
      } else {
        children.push(
          this.add.text(left, 14, `Slot ${id}  ·  empty`, { ...TEXT, fontSize: '16px', color: TONE.muted }),
          this.add.text(left, 40, 'Tap to start a new character', { ...TEXT, fontSize: '12px', color: TONE.muted }),
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
        const bw = 70;
        const btn = makeButton(this, x - bw, CARD_H - 40, bw, 28, label, fn, label === 'Delete' ? 0xffa8a0 : 0xffffff);
        children.push(btn.root);
        x -= bw + 10;
      }
      return this.add.container(0, 0, children);
    });
    this.layout();
  }

  /** Speed lines radiating from behind the title, and a halftone fade at the bottom. */
  private drawBackdrop(width: number, height: number, cy: number): void {
    const g = this.backdrop.clear();
    const cx = width / 2;
    const reach = Math.hypot(width, height);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const spread = 0.012 + ((i * 7919) % 13) / 900;
      const r0 = 120 + ((i * 104729) % 60);
      g.fillStyle(COLORS.ink, 0.1 + ((i * 31) % 5) / 40);
      g.fillTriangle(
        cx + Math.cos(a) * r0,
        cy + Math.sin(a) * r0 * 0.6,
        cx + Math.cos(a - spread) * reach,
        cy + Math.sin(a - spread) * reach,
        cx + Math.cos(a + spread) * reach,
        cy + Math.sin(a + spread) * reach,
      );
    }
    // Screentone: dots growing toward the bottom edge.
    for (let y = height * 0.6; y < height; y += 10) {
      const r = ((y - height * 0.6) / (height * 0.4)) * 3.2;
      for (let x = (y / 10) % 2 ? 5 : 0; x < width; x += 10) g.fillStyle(COLORS.ink, 0.22).fillCircle(x, y, r);
    }
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
