import type Phaser from 'phaser';
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLE_NAMES, HAIR_STYLES, SKIN_TONES, type Appearance } from '../core/appearance';
import { jobOf } from '../core/jobs';
import type { World } from '../core/world';
import { chibiOrigin, playerChibi } from '../render/chibi';
import { animKey } from '../render/knight';
import { COLORS, TITLE_FONT, TEXT, TONE } from '../render/palette';
import { makeButton, Panel } from './widgets';

const SWATCH_R = 15;

/** Change hair style, hair color, eye color and skin tone, with a big live preview. */
export class AppearanceWindow {
  readonly panel: Panel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(
      scene,
      'Appearance',
      (sw, sh) => {
        const w = Math.min(380, sw - 24);
        const h = Math.min(600, sh - 40);
        return { w, h, x: Math.round((sw - w) / 2), y: Math.max(12, Math.round((sh - h) / 2)) };
      },
      () => this.close(),
      true,
    );
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
    const a = w.player.appearance;
    p.layout();
    p.clear();
    const change = (patch: Partial<Appearance>) => {
      w.setAppearance({ ...a, ...patch });
      this.refresh();
    };

    // Big full-height preview in a manga panel.
    const cx = p.w / 2;
    p.add(this.scene.add.rectangle(cx, 120, 150, 182, 0xffe9a8).setStrokeStyle(3, COLORS.ink));
    p.add(this.scene.add.ellipse(cx, 202, 90, 16, COLORS.ink, 0.15));
    // Pixel art scaled up with nearest-neighbor filtering, playing its idle animation.
    const key = playerChibi(this.scene, jobOf(w.player), a, w.player.equipment);
    p.add(this.scene.add.sprite(cx, 204, key).setOrigin(0.5, chibiOrigin()).setScale(3.5).play(animKey(key, 'F', 'idle')));

    let y = 222;
    const heading = (label: string) => {
      p.add(this.scene.add.text(14, y, label, { fontFamily: TITLE_FONT, fontSize: '12px', color: TONE.ink }));
      y += 24;
    };

    heading('HAIR STYLE');
    const i = HAIR_STYLES.indexOf(a.hairStyle);
    const step = (d: number) => () => change({ hairStyle: HAIR_STYLES[(i + d + HAIR_STYLES.length) % HAIR_STYLES.length]! });
    p.add(makeButton(this.scene, 14, y, 48, 36, '◀', step(-1)).root);
    p.add(makeButton(this.scene, p.w - 62, y, 48, 36, '▶', step(1)).root);
    p.add(this.scene.add.text(cx, y + 18, HAIR_STYLE_NAMES[a.hairStyle], { ...TEXT, fontSize: '16px', fontStyle: 'bold' }).setOrigin(0.5));
    y += 48;

    const swatches = (label: string, colors: readonly number[], current: number, pick: (n: number) => void) => {
      heading(label);
      const gap = Math.min(40, (p.w - 28) / colors.length);
      colors.forEach((c, n) => {
        const x = 14 + SWATCH_R + 2 + n * gap;
        const on = n === current;
        const dot = this.scene.add.circle(x, y + SWATCH_R, SWATCH_R, c).setStrokeStyle(on ? 4 : 2, on ? 0xffd84a : COLORS.ink);
        dot.setInteractive({ useHandCursor: true }).on('pointerup', () => pick(n));
        if (on) p.add(this.scene.add.circle(x, y + SWATCH_R, SWATCH_R + 4).setStrokeStyle(2, COLORS.ink));
        p.add(dot);
      });
      y += SWATCH_R * 2 + 14;
    };
    swatches('HAIR COLOR', HAIR_COLORS, a.hairColor, (n) => change({ hairColor: n }));
    swatches('EYES', EYE_COLORS, a.eyeColor, (n) => change({ eyeColor: n }));
    swatches('SKIN', SKIN_TONES, a.skinTone, (n) => change({ skinTone: n }));

    p.add(makeButton(this.scene, 14, p.h - 50, p.w - 28, 38, 'Done', () => this.close(), 0xffd84a).root);
  }
}
