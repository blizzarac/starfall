import type Phaser from 'phaser';
import { describeBonus } from '../core/equipment';
import { appetite, bonusFactor, fondness, MAX_INTIMACY, PET_FOOD, PET_SPECIES } from '../core/pets';
import type { World } from '../core/world';
import { COLORS, TEXT, TONE } from '../render/palette';
import { centered, makeButton, Panel } from './widgets';

/** Your pet: how it feels, what it gives you, feed / rename / release. */
export class PetWindow {
  readonly panel: Panel;
  private message = '';
  private messageColor = TONE.good;
  private confirmRelease = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Pet', centered(360, 430), () => this.close());
    const refresh = () => this.panel.visible && this.refresh();
    for (const e of ['petFed', 'petChanged', 'petTamed', 'petRanAway', 'inventoryChanged'] as const) world.events.on(e, refresh);
  }

  open(): void {
    this.message = '';
    this.confirmRelease = false;
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
    const pet = w.player.pet;
    p.layout();
    p.clear();
    const text = (x: number, y: number, s: string, size: number, color: string = TONE.ink, bold = false) =>
      p.add(this.scene.add.text(x, y, s, { ...TEXT, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', wordWrap: { width: p.w - 24 } }));
    if (!pet) {
      p.setTitle('Pet');
      text(12, 46, "You don't have a pet yet.", 15, TONE.ink, true);
      text(12, 74, 'Mabel in Brightmoor sells lures. Use one from your bag near the right monster (wear it down first) to tame it.', 13, TONE.muted);
      return;
    }
    const species = PET_SPECIES[pet.species]!;
    const def = w.content.monsters.get(pet.species);
    p.setTitle(pet.name);
    text(12, 44, `${def?.name ?? pet.species} · ${species.blurb}`, 12, TONE.muted);

    const bar = (y: number, label: string, value: string, frac: number, color: number) => {
      text(12, y, label, 13, TONE.ink, true);
      text(p.w - 12 - 120, y, value, 13, TONE.accent, true);
      const g = this.scene.add.graphics();
      g.fillStyle(COLORS.barBack).fillRect(12, y + 22, p.w - 24, 12);
      g.fillStyle(color).fillRect(12, y + 22, (p.w - 24) * Math.max(0, Math.min(1, frac)), 12);
      g.lineStyle(2, COLORS.ink).strokeRect(12, y + 22, p.w - 24, 12);
      p.add(g);
    };
    bar(80, 'Friendship', fondness(pet.intimacy), pet.intimacy / MAX_INTIMACY, 0xff8fb8);
    bar(128, 'Fullness', appetite(pet.hunger), pet.hunger / 100, 0xffb52e);

    const k = bonusFactor(pet.intimacy);
    const scaled = Object.fromEntries(Object.entries(species.bonus).map(([key, v]) => [key, (v ?? 0) * Math.max(1, k)]));
    const bonus = describeBonus(scaled).join(' · ');
    const perk = species.loots ? ' · picks up loot' : '';
    text(12, 178, k === 0 ? `Helps once Neutral: ${bonus}${perk}` : `Helping you: ${bonus}${perk}${k === 2 ? ' (Loyal: doubled)' : ''}`, 13, k ? TONE.good : TONE.muted);

    const treats = w.itemCount(PET_FOOD);
    const bw = p.w - 24;
    let y = p.h - 150;
    p.add(
      makeButton(this.scene, 12, y, bw, 38, `Feed a Pet Treat (${treats} left)`, () => {
        const err = w.feedPet();
        this.message = err ?? 'Munch munch!';
        this.messageColor = err ? TONE.bad : TONE.good;
        this.refresh();
      }, 0xffd84a).setEnabled(treats > 0).root,
    );
    y += 46;
    const half = (bw - 8) / 2;
    p.add(
      makeButton(this.scene, 12, y, half, 38, 'Rename', () => {
        const name = window.prompt('New name for your pet:', pet.name);
        if (name) w.renamePet(name);
      }).root,
    );
    p.add(
      makeButton(this.scene, 20 + half, y, half, 38, this.confirmRelease ? 'Really release?' : 'Release', () => {
        if (!this.confirmRelease) {
          this.confirmRelease = true;
          this.refresh();
          return;
        }
        w.releasePet();
        this.message = `${pet.name} wandered off happily.`;
        this.messageColor = TONE.muted;
        this.confirmRelease = false;
        this.refresh();
      }, this.confirmRelease ? 0xff7a5a : 0xffa8a0).root,
    );
    text(12, p.h - 52, this.message, 13, this.messageColor);
  }
}
