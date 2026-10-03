import Phaser from 'phaser';
import { COLORS } from './palette';

/** Feet position inside a chibi texture (for setOrigin). */
export const CHIBI_W = 40;
export const CHIBI_H = 56;
export const CHIBI_FEET_Y = 54;

/**
 * Draws a chibi character facing right into texture `key` (once).
 * Body and hair colors make NPCs and jobs distinguishable until real sprites exist.
 */
export function ensureChibi(scene: Phaser.Scene, key: string, body: number, hair: number, extra?: 'sword' | 'staff'): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x3b3f52).fillRoundedRect(12, 44, 7, 10, 2).fillRoundedRect(21, 44, 7, 10, 2);
  g.fillStyle(body).fillRoundedRect(10, 28, 20, 19, 6);
  g.fillStyle(0xffffff, 0.2).fillRoundedRect(12, 30, 6, 12, 3);
  g.fillStyle(0x8a5a3b).fillRect(10, 40, 20, 3);
  if (extra === 'sword') {
    g.fillStyle(0xd9dee8).fillRect(31, 22, 3, 22);
    g.fillStyle(0x8a5a3b).fillRect(28, 40, 9, 3);
  }
  if (extra === 'staff') {
    g.fillStyle(0x8a5a3b).fillRect(32, 14, 3, 40);
    g.fillStyle(0x9be3ff).fillCircle(33.5, 12, 4.5);
    g.fillStyle(0xffffff, 0.8).fillCircle(32, 10.5, 1.5);
  }
  g.fillStyle(COLORS.playerSkin).fillCircle(20, 18, 14);
  g.fillStyle(hair).fillEllipse(18, 9, 30, 15).fillCircle(8, 16, 6);
  g.fillStyle(0x2a1e2e).fillEllipse(23, 20, 3.5, 6).fillEllipse(30, 20, 3.5, 6);
  g.fillStyle(0xffffff).fillCircle(23.6, 18.5, 1).fillCircle(30.6, 18.5, 1);
  g.fillStyle(0xff9aa8, 0.6).fillCircle(21, 25, 2.2).fillCircle(32, 25, 2);
  g.generateTexture(key, CHIBI_W, CHIBI_H);
  g.destroy();
  return key;
}

export function hexColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
