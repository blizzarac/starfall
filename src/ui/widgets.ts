import Phaser from 'phaser';
import { audio } from '../audio/engine';
import { viewSize } from '../render/view';
import { COLORS, TITLE_FONT, TEXT } from '../render/palette';
import { drawPixelBox, PX } from './pixelui';

/** Fill while a button is held down. */
const PRESSED = 0xffe27a;

export interface Button {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setEnabled(on: boolean): Button;
}

/** A rectangular button that fires on release, sized for fingers. */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onTap: () => void,
  color = 0xffffff,
): Button {
  // Pixel button: notched ink border, bevelled face, hard shadow the face presses down onto.
  const shadow = drawPixelBox(scene.add.graphics(), 0, 0, w, h, COLORS.ink, { border: COLORS.ink }).setAlpha(1);
  const look = scene.add.graphics();
  const paint = (fill: number, pressed: boolean) => drawPixelBox(look.clear(), 0, 0, w, h, fill, { shadow: false, pressed });
  paint(color, false);
  const bg = scene.add.rectangle(0, 0, w, h, color, 0).setOrigin(0).setInteractive({ useHandCursor: true });
  const label = scene.add
    .text(w / 2, h / 2, text, { ...TEXT, fontSize: '14px', fontStyle: 'bold', align: 'center', wordWrap: { width: w - 12 } })
    .setOrigin(0.5);
  const face = scene.add.container(0, 0, [look, bg, label]);
  const root = scene.add.container(x, y, [shadow, face]);
  let enabled = true;
  const press = (down: boolean) => face.setPosition(down ? PX : 0, down ? PX : 0);
  bg.on('pointerdown', () => enabled && (press(true), paint(PRESSED, true)));
  bg.on('pointerout', () => (press(false), paint(color, false)));
  bg.on('pointerup', () => {
    press(false);
    paint(color, false);
    if (!enabled) return;
    audio.play('tap');
    onTap();
  });
  const button: Button = {
    root,
    bg,
    label,
    setEnabled(on) {
      enabled = on;
      root.setAlpha(on ? 1 : 0.4);
      return button;
    },
  };
  return button;
}

/**
 * A titled window with a close button. Content goes in `body`, which is rebuilt
 * on every refresh. `modal` adds a full-screen dim layer that eats taps.
 */
export class Panel {
  readonly root: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Rectangle;
  /** The pixel-art window chrome, redrawn when the size changes. */
  private readonly chrome: Phaser.GameObjects.Graphics;
  private readonly dim: Phaser.GameObjects.Rectangle | null;
  private readonly title: Phaser.GameObjects.Text;
  private readonly closeBtn: Phaser.GameObjects.Text;
  w = 0;
  h = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    title: string,
    private readonly size: (screenW: number, screenH: number) => { w: number; h: number; x: number; y: number },
    onClose: () => void,
    modal = false,
  ) {
    this.dim = modal ? scene.add.rectangle(0, 0, 10, 10, COLORS.ink, 0.35).setOrigin(0).setInteractive() : null;
    // A pixel window: paper, notched ink border, bevel, a dark title strip and a hard shadow.
    this.chrome = scene.add.graphics();
    this.frame = scene.add.rectangle(0, 0, 10, 10, COLORS.paper, 0).setOrigin(0).setInteractive();
    this.title = scene.add.text(12, 8, title, { ...TEXT, fontFamily: TITLE_FONT, fontSize: '16px', color: '#ffffff', fontStyle: 'bold' });
    this.closeBtn = scene.add
      .text(0, 0, '×', { ...TEXT, fontSize: '26px', fontStyle: 'bold', color: '#ffffff', padding: { x: 10, y: 0 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', onClose);
    this.body = scene.add.container(0, 0);
    const win = scene.add.container(0, 0, [this.chrome, this.frame, this.title, this.closeBtn, this.body]);
    this.root = scene.add.container(0, 0, this.dim ? [this.dim, win] : [win]).setDepth(50).setVisible(false);
    this.layout();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(on: boolean): void {
    this.root.setVisible(on);
  }

  setTitle(text: string): void {
    this.title.setText(text);
  }

  /** Repositions for the current screen size. Returns true if the size changed. */
  layout(): boolean {
    const { width, height } = viewSize(this.scene);
    const s = this.size(width, height);
    const changed = s.w !== this.w || s.h !== this.h;
    this.w = s.w;
    this.h = s.h;
    this.dim?.setSize(width, height);
    const win = this.root.list[this.root.list.length - 1] as Phaser.GameObjects.Container;
    win.setPosition(s.x, s.y);
    this.frame.setSize(s.w, s.h);
    if (changed || this.chrome.commandBuffer.length === 0) {
      const g = drawPixelBox(this.chrome.clear(), 0, 0, s.w, s.h, COLORS.paper);
      // Title strip with a pixel highlight line.
      g.fillStyle(COLORS.ink, 1).fillRect(PX, PX, s.w - PX * 2, 34 - PX);
      g.fillStyle(0x3a3450, 1).fillRect(PX * 2, PX * 2, s.w - PX * 4, PX);
    }
    this.frame.input?.hitArea.setTo(0, 0, s.w, s.h);
    this.closeBtn.setX(s.w);
    return changed;
  }

  clear(): void {
    this.body.removeAll(true);
  }

  add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.body.add(obj);
    return obj;
  }
}

/** Centered window size that fits phones: at most `maxW` × `maxH`, with a margin. */
export function centered(maxW: number, maxH: number, bottomReserve = 90) {
  return (sw: number, sh: number) => {
    const w = Math.min(maxW, sw - 24);
    const h = Math.min(maxH, sh - 24 - bottomReserve);
    return { w, h, x: Math.round((sw - w) / 2), y: Math.max(12, Math.round((sh - bottomReserve - h) / 2)) };
  };
}

/** Lays out one page of rows and Prev/Next controls. Returns the clamped page index. */
export function pagedList<T>(
  panel: Panel,
  items: T[],
  page: number,
  top: number,
  bottom: number,
  rowH: number,
  renderRow: (item: T, y: number, w: number) => void,
  onPage: (page: number) => void,
): number {
  const perPage = Math.max(1, Math.floor((panel.h - top - bottom - 40) / rowH));
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(0, page), pages - 1);
  items.slice(p * perPage, (p + 1) * perPage).forEach((item, i) => renderRow(item, top + i * rowH, panel.w));
  if (pages > 1) {
    const y = panel.h - bottom - 36;
    panel.add(makeButton(panel.body.scene, 12, y, 70, 30, '‹ Prev', () => onPage(p - 1)).setEnabled(p > 0).root);
    panel.add(makeButton(panel.body.scene, panel.w - 82, y, 70, 30, 'Next ›', () => onPage(p + 1)).setEnabled(p < pages - 1).root);
    panel.add(panel.body.scene.add.text(panel.w / 2, y + 15, `${p + 1} / ${pages}`, { ...TEXT, fontSize: '12px' }).setOrigin(0.5));
  }
  return p;
}
