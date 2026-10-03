import Phaser from 'phaser';
import { audio } from '../audio/engine';
import { viewSize } from '../render/view';
import { COLORS, IMPACT_FONT, TEXT } from '../render/palette';

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
  // Comic button: flat fill, ink border, hard shadow that the face presses down onto.
  const shadow = scene.add.rectangle(3, 3, w, h, COLORS.ink).setOrigin(0);
  const bg = scene.add.rectangle(0, 0, w, h, color).setOrigin(0).setStrokeStyle(2.5, COLORS.ink).setInteractive({ useHandCursor: true });
  const label = scene.add
    .text(w / 2, h / 2, text, { ...TEXT, fontSize: '13px', fontStyle: 'bold', align: 'center', wordWrap: { width: w - 12 } })
    .setOrigin(0.5);
  const face = scene.add.container(0, 0, [bg, label]);
  const root = scene.add.container(x, y, [shadow, face]);
  let enabled = true;
  const press = (down: boolean) => face.setPosition(down ? 2 : 0, down ? 2 : 0);
  bg.on('pointerdown', () => enabled && (press(true), bg.setFillStyle(PRESSED)));
  bg.on('pointerout', () => (press(false), bg.setFillStyle(color)));
  bg.on('pointerup', () => {
    press(false);
    bg.setFillStyle(color);
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
  private readonly shadow: Phaser.GameObjects.Rectangle;
  private readonly titleBar: Phaser.GameObjects.Rectangle;
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
    // A manga panel: paper, thick ink border, a hard shadow offset down-right.
    this.shadow = scene.add.rectangle(6, 6, 10, 10, COLORS.ink).setOrigin(0);
    this.frame = scene.add.rectangle(0, 0, 10, 10, COLORS.paper).setOrigin(0).setStrokeStyle(3, COLORS.ink).setInteractive();
    this.titleBar = scene.add.rectangle(0, 0, 10, 34, COLORS.ink).setOrigin(0);
    this.title = scene.add.text(12, 5, title, { ...TEXT, fontFamily: IMPACT_FONT, fontSize: '22px', color: '#ffffff', fontStyle: 'normal' });
    this.closeBtn = scene.add
      .text(0, 0, '×', { ...TEXT, fontSize: '26px', fontStyle: 'bold', color: '#ffffff', padding: { x: 10, y: 0 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', onClose);
    this.body = scene.add.container(0, 0);
    const win = scene.add.container(0, 0, [this.shadow, this.frame, this.titleBar, this.title, this.closeBtn, this.body]);
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
    this.shadow.setSize(s.w, s.h);
    this.titleBar.setSize(s.w, 34);
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
