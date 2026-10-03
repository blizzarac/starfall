import type Phaser from 'phaser';
import { describeBonus } from '../core/equipment';
import { appetite, bonusFactor, describePetGear, fondness, MAX_INTIMACY, MAX_PET_LEVEL, PET_ATTACK_MS, PET_FOOD, PET_SPECIES, petAttackDamage, petBonus, petXpToNext } from '../core/pets';
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
    this.panel = new Panel(scene, 'Pet', centered(380, 640), () => this.close());
    const refresh = () => this.panel.visible && this.refresh();
    for (const e of ['petFed', 'petChanged', 'petTamed', 'petRanAway', 'petLevelUp', 'inventoryChanged'] as const) world.events.on(e, refresh);
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
    p.setTitle(`${pet.name} · Lv ${pet.level}`);
    text(12, 42, `${def?.name ?? pet.species} · ${species.blurb}`, 12, TONE.muted);

    const bar = (y: number, label: string, value: string, frac: number, color: number) => {
      text(12, y, label, 13, TONE.ink, true);
      p.add(this.scene.add.text(p.w - 12, y, value, { ...TEXT, fontSize: '13px', color: TONE.accent, fontStyle: 'bold' }).setOrigin(1, 0));
      const g = this.scene.add.graphics();
      g.fillStyle(COLORS.barBack).fillRect(12, y + 19, p.w - 24, 10);
      g.fillStyle(color).fillRect(12, y + 19, (p.w - 24) * Math.max(0, Math.min(1, frac)), 10);
      g.lineStyle(2, COLORS.ink).strokeRect(12, y + 19, p.w - 24, 10);
      p.add(g);
    };
    const maxed = pet.level >= MAX_PET_LEVEL;
    const need = petXpToNext(pet.level);
    bar(64, 'Level', maxed ? `Lv ${pet.level} (max)` : `Lv ${pet.level} · ${Math.floor((pet.xp / need) * 100)}%`, maxed ? 1 : pet.xp / need, 0xa98bff);
    bar(102, 'Friendship', fondness(pet.intimacy), pet.intimacy / MAX_INTIMACY, 0xff8fb8);
    bar(140, 'Fullness', appetite(pet.hunger), pet.hunger / 100, 0xffb52e);
    let y = 176;
    const line = (s: string, size: number, color: string) => {
      const t = text(12, y, s, size, color);
      y += t.height + 5;
    };
    line('Grows from fights you win together. Friendship rises with every win, each level, and treats when it is hungry.', 11, TONE.muted);

    const bonus = describeBonus(petBonus(pet)).join(' · ');
    const perk = species.loots ? `${bonus ? ' · ' : ''}picks up loot` : '';
    const starving = appetite(pet.hunger) === 'Starving';
    line(bonusFactor(pet.intimacy) === 0 ? `Too awkward to help yet. Feed it and fight together.` : `Helping you: ${bonus}${perk}`, 13, bonusFactor(pet.intimacy) ? TONE.good : TONE.muted);
    line(starving ? 'Too hungry to fight!' : `Bites for about ${petAttackDamage(pet)} every ${PET_ATTACK_MS / 1000} s`, 13, starving ? TONE.bad : TONE.ink);

    // Gear: what it wears, and the collars and charms in your bag.
    const gear = pet.gear;
    const gw = p.w - 24;
    text(12, y + 2, gear ? `Wears: ${gear.name}` : 'Wears: nothing', 13, TONE.ink, true);
    if (gear) {
      p.add(makeButton(this.scene, p.w - 12 - 84, y - 2, 84, 26, 'Take off', () => {
        w.unequipPetGear();
        this.message = `${gear.name} is back in your bag.`;
        this.messageColor = TONE.muted;
      }).root);
      y += 26;
      line(describePetGear(gear.petGear!), 12, TONE.accent);
    } else y += 24;
    const spare = [...w.player.inventory.keys()].map((id) => w.content.items.get(id)!).filter((it) => it?.petGear);
    for (const it of spare.slice(0, 3)) {
      p.add(
        makeButton(this.scene, 12, y, gw, 30, `Wear ${it.name}: ${describePetGear(it.petGear!)}`, () => {
          const err = w.equipPetGear(it.id);
          this.message = err ?? `${pet.name} now wears the ${it.name}.`;
          this.messageColor = err ? TONE.bad : TONE.good;
        }, 0xc8f0ff).root,
      );
      y += 34;
    }
    if (!gear && spare.length === 0) line('Mabel in Brightmoor sells collars and charms; the tinkerer makes stronger ones.', 11, TONE.muted);

    const treats = w.itemCount(PET_FOOD);
    const bw = p.w - 24;
    y = Math.max(y + 6, p.h - 150);
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
    text(12, y + 44, this.message, 13, this.messageColor);
  }
}
