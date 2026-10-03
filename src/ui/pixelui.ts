import type Phaser from 'phaser';
import { COLORS } from '../render/palette';
import { mix } from '../render/pix';

/** One "pixel" of UI chrome, in CSS pixels. */
export const PX = 2;

/** Lighter and darker versions of a fill, for bevels. */
function bevel(fill: number): { light: number; dark: number } {
  return { light: mix(fill, 0xffffff, 0.55), dark: mix(fill, 0x2a1f4a, 0.28) };
}

/**
 * A pixel-art box: ink border with notched corners, a lit top-left edge,
 * a shaded bottom-right edge and (optionally) a hard drop shadow.
 * `pressed` flips the bevel so a button looks pushed in.
 */
export function drawPixelBox(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  opts: { shadow?: boolean; pressed?: boolean; border?: number } = {},
): Phaser.GameObjects.Graphics {
  const u = PX;
  const ink = opts.border ?? COLORS.ink;
  if (opts.shadow !== false) {
    g.fillStyle(COLORS.ink, 1);
    g.fillRect(x + u * 2, y + u * 3, w - u, h - u * 2);
    g.fillRect(x + u * 3, y + u * 2, w - u * 3, h);
  }
  g.fillStyle(ink, 1);
  g.fillRect(x, y + u, w, h - u * 2);
  g.fillRect(x + u, y, w - u * 2, h);
  g.fillStyle(fill, 1);
  g.fillRect(x + u, y + u, w - u * 2, h - u * 2);
  const { light, dark } = bevel(fill);
  const top = opts.pressed ? dark : light;
  const bottom = opts.pressed ? light : dark;
  g.fillStyle(top, 1);
  g.fillRect(x + u * 2, y + u, w - u * 4, u);
  g.fillRect(x + u, y + u * 2, u, h - u * 4);
  g.fillStyle(bottom, 1);
  g.fillRect(x + u * 2, y + h - u * 2, w - u * 4, u);
  g.fillRect(x + w - u * 2, y + u * 2, u, h - u * 4);
  return g;
}
