import Phaser from 'phaser';
import { feetOrigin, inkify } from './ink';
import type { JobExtra } from '../core/jobs';
import { COLORS } from './palette';

/** Size of a chibi drawing before inking, and the row its feet stand on. */
export const CHIBI_W = 44;
export const CHIBI_H = 60;
export const CHIBI_FEET_Y = 58;

/**
 * Draws an anime-style chibi facing right into texture `key` (once), then inks it:
 * big head, spiky hair, large glossy eyes, a jacket in the job or NPC color.
 */
export function ensureChibi(scene: Phaser.Scene, key: string, body: number, hair: number, extra?: JobExtra): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  const shade = Phaser.Display.Color.ValueToColor(body).darken(22).color;
  const hairShade = Phaser.Display.Color.ValueToColor(hair).darken(18).color;
  const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

  // Legs and boots.
  g.fillStyle(0x2c2a3a).fillRoundedRect(14, 46, 7, 11, 2).fillRoundedRect(23, 46, 7, 11, 2);
  g.fillStyle(0x4a3424).fillRoundedRect(13, 53, 9, 5, 2).fillRoundedRect(22, 53, 9, 5, 2);
  // Jacket: a flared shape with a darker side and a white collar.
  g.fillStyle(body).fillPoints([V(13, 31), V(31, 31), V(34, 49), V(10, 49)], true);
  g.fillStyle(shade).fillPoints([V(24, 31), V(31, 31), V(34, 49), V(25, 49)], true);
  g.fillStyle(0xffffff).fillTriangle(17, 31, 22, 37, 22, 31).fillTriangle(27, 31, 22, 37, 22, 31);
  g.fillStyle(0x8a5a3b).fillRect(11, 43, 22, 3);
  g.fillStyle(0xffd84a).fillRect(20, 43, 4, 3);
  if (extra === 'sword') {
    g.fillStyle(0xe8edf5).fillPoints([V(35, 16), V(38, 16), V(38, 42), V(36.5, 45), V(35, 42)], true);
    g.fillStyle(0xffd84a).fillRect(32, 41, 9, 3);
    g.fillStyle(0x6b4a2e).fillRect(35, 44, 3, 6);
  }
  if (extra === 'staff') {
    g.fillStyle(0x8a5a3b).fillRect(36, 12, 3, 46);
    g.fillStyle(0x7fe3ff).fillCircle(37.5, 10, 5.5);
    g.fillStyle(0xffffff).fillCircle(36, 8.5, 2);
  }
  if (extra === 'bow') {
    // A recurve bow held upright on the right, string pulled straight.
    g.lineStyle(3, 0x8a5a3b).beginPath().arc(30, 34, 15, -1.2, 1.2).strokePath();
    g.lineStyle(1, 0xf4f0e6).lineBetween(30 + 15 * Math.cos(-1.2), 34 + 15 * Math.sin(-1.2), 30 + 15 * Math.cos(1.2), 34 + 15 * Math.sin(1.2));
    g.fillStyle(0x6b4a2e).fillRect(42, 32, 3, 5);
    // Quiver on the back.
    g.fillStyle(0x8a5a3b).fillRoundedRect(6, 26, 6, 16, 2);
    g.fillStyle(0xff6a5a).fillTriangle(6, 26, 9, 21, 12, 26);
  }
  if (extra === 'mace') {
    g.fillStyle(0x8a5a3b).fillRect(36, 26, 3, 24);
    g.fillStyle(0xd9dee8).fillCircle(37.5, 24, 5.5);
    g.fillStyle(0xffd84a).fillCircle(37.5, 24, 2.2);
    // A little cross on the robe.
    g.fillStyle(0xffd84a).fillRect(20.5, 37, 3, 9).fillRect(18, 39.5, 8, 3);
  }
  // Head.
  g.fillStyle(COLORS.playerSkin).fillCircle(22, 19, 15);
  g.fillStyle(0xf2c8ac).fillEllipse(26, 30, 12, 4);
  // Spiky hair: a cap plus jagged spikes falling over the forehead and back.
  g.fillStyle(hair).fillEllipse(20, 10, 32, 17);
  g.fillPoints([V(6, 12), V(2, 26), V(10, 18)], true);
  g.fillPoints([V(8, 6), V(0, 4), V(10, 2)], true);
  g.fillPoints([V(14, 2), V(16, -2 + 2), V(22, 1)], true);
  g.fillPoints([V(24, 2), V(32, -1 + 2), V(30, 6)], true);
  g.fillPoints([V(30, 6), V(38, 8), V(33, 12)], true);
  g.fillPoints([V(18, 12), V(22, 20), V(25, 12)], true);
  g.fillPoints([V(25, 12), V(30, 19), V(33, 12)], true);
  g.fillStyle(hairShade).fillEllipse(14, 13, 12, 6);
  g.fillStyle(0xffffff, 0.55).fillEllipse(18, 6, 9, 2.5);
  // Big glossy eyes: white, colored iris, dark pupil, two highlights.
  for (const ex of [24, 32]) {
    g.fillStyle(0xffffff).fillEllipse(ex, 21, 6, 9);
    g.fillStyle(0x3a6fd8).fillEllipse(ex + 0.5, 22, 4.6, 7);
    g.fillStyle(0x16131c).fillEllipse(ex + 0.8, 22.5, 2.6, 4.2);
    g.fillStyle(0xffffff).fillCircle(ex - 0.6, 19.6, 1.3).fillCircle(ex + 1.6, 24.5, 0.6);
  }
  g.lineStyle(1.6, 0x16131c).lineBetween(21, 16, 26, 15.5).lineBetween(30, 15.5, 34.5, 16.5);
  g.fillStyle(0xff8fa3, 0.75).fillEllipse(22, 27, 5, 2.4).fillEllipse(34, 27, 4, 2.2);
  g.lineStyle(1.3, 0x16131c).beginPath().arc(30, 28, 1.8, 0.2, Math.PI - 0.2).strokePath();
  g.generateTexture(key, CHIBI_W, CHIBI_H);
  g.destroy();
  inkify(scene, key, { outline: 2.2, tone: true, toneStep: 3.5 });
  return key;
}

/** Origin Y for a chibi texture so its feet sit on the tile. */
export function chibiOrigin(scene: Phaser.Scene, key: string): number {
  return feetOrigin(scene, key, CHIBI_FEET_Y);
}

export function hexColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
