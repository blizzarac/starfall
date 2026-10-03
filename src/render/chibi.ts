import Phaser from 'phaser';
import { appearanceKey, EYE_COLORS, HAIR_COLORS, SKIN_TONES, type Appearance, type HairStyle } from '../core/appearance';
import type { JobDef, JobExtra } from '../core/jobs';
import { feetOrigin, inkify, inkPad } from './ink';

/** Size of a chibi drawing before inking, and the row its feet stand on. */
export const CHIBI_W = 48;
export const CHIBI_H = 62;
export const CHIBI_FEET_Y = 60;

/** Everything that varies between chibis besides the outfit color. */
export interface ChibiLook {
  hairStyle: HairStyle;
  hair: number;
  eye: number;
  skin: number;
}

const INK = 0x16131c;

/** The player's sprite for a job and appearance; drawn once per combination. */
export function playerChibi(scene: Phaser.Scene, job: JobDef, a: Appearance, scale = 1): string {
  return ensureChibi(
    scene,
    `job-${job.id}-${appearanceKey(a)}${scale !== 1 ? `@${scale}` : ''}`,
    job.look.body,
    { hairStyle: a.hairStyle, hair: HAIR_COLORS[a.hairColor]!, eye: EYE_COLORS[a.eyeColor]!, skin: SKIN_TONES[a.skinTone]! },
    job.look.extra,
    scale,
  );
}

/**
 * Draws an anime-style chibi facing right into texture `key` (once), then inks it:
 * big head, a hairstyle, large glossy manga eyes, a jacket in the job or NPC color.
 */
export function ensureChibi(scene: Phaser.Scene, key: string, body: number, look: ChibiLook, extra?: JobExtra, scale = 1): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  // Drawn at `scale` for crisp large previews; the drawing itself is in 1x units.
  if (scale !== 1) g.scaleCanvas(scale, scale);
  const shade = Phaser.Display.Color.ValueToColor(body).darken(22).color;
  const hairShade = Phaser.Display.Color.ValueToColor(look.hair).darken(18).color;
  const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
  const ox = 2; // everything shifted right a little to leave room for hair behind the head

  // Hair that hangs behind the body comes first.
  drawBackHair(g, look.hairStyle, look.hair, hairShade, V, ox);

  // Legs and boots.
  g.fillStyle(0x2c2a3a).fillRoundedRect(ox + 14, 47, 7, 11, 2).fillRoundedRect(ox + 23, 47, 7, 11, 2);
  g.fillStyle(0x4a3424).fillRoundedRect(ox + 13, 54, 9, 6, 2).fillRoundedRect(ox + 22, 54, 9, 6, 2);
  // Jacket: a flared shape with a darker side and a white collar.
  g.fillStyle(body).fillPoints([V(ox + 13, 32), V(ox + 31, 32), V(ox + 34, 50), V(ox + 10, 50)], true);
  g.fillStyle(shade).fillPoints([V(ox + 24, 32), V(ox + 31, 32), V(ox + 34, 50), V(ox + 25, 50)], true);
  g.fillStyle(0xffffff).fillTriangle(ox + 17, 32, ox + 22, 38, ox + 22, 32).fillTriangle(ox + 27, 32, ox + 22, 38, ox + 22, 32);
  g.fillStyle(0x8a5a3b).fillRect(ox + 11, 44, 22, 3);
  g.fillStyle(0xffd84a).fillRect(ox + 20, 44, 4, 3);
  drawExtra(g, extra, V, ox);

  // Head: big and round, with a soft chin shadow.
  g.fillStyle(look.skin).fillCircle(ox + 22, 19, 16);
  g.fillStyle(Phaser.Display.Color.ValueToColor(look.skin).darken(8).color).fillEllipse(ox + 26, 31, 12, 4);

  drawFrontHair(g, look.hairStyle, look.hair, hairShade, V, ox);
  drawEyes(g, look.eye, ox);

  // Blush and a small smile.
  g.fillStyle(0xff8fa3, 0.7).fillEllipse(ox + 21, 29, 5, 2.4).fillEllipse(ox + 35, 29, 3.6, 2.2);
  g.lineStyle(1.3, INK).beginPath().arc(ox + 30, 30, 1.6, 0.2, Math.PI - 0.2).strokePath();

  g.generateTexture(key, CHIBI_W * scale, CHIBI_H * scale);
  g.destroy();
  inkify(scene, key, { outline: 2.2 * scale, tone: true, toneStep: 3.5 * scale });
  return key;
}

/** Big manga eyes: white, a two-tone iris, pupil, two highlights, thick upper lashes. */
function drawEyes(g: Phaser.GameObjects.Graphics, iris: number, ox: number): void {
  const light = Phaser.Display.Color.ValueToColor(iris).lighten(25).color;
  const dark = Phaser.Display.Color.ValueToColor(iris).darken(35).color;
  // Near eye a little wider than the far one, since the face turns right.
  for (const [cx, w] of [[ox + 23.8, 9], [ox + 34.8, 7.2]] as const) {
    const cy = 22.5;
    const h = 14.5;
    g.fillStyle(0xffffff).fillEllipse(cx, cy, w, h);
    g.fillStyle(iris).fillEllipse(cx + 0.4, cy + 0.8, w - 1.6, h - 2);
    g.fillStyle(light).fillEllipse(cx + 0.4, cy + 3.2, w - 3, (h - 2) / 2.4);
    g.fillStyle(dark).fillEllipse(cx + 0.6, cy + 0.2, w * 0.38, h * 0.42);
    g.fillStyle(0xffffff).fillCircle(cx - w * 0.18, cy - h * 0.2, w * 0.2).fillCircle(cx + w * 0.22, cy + h * 0.22, w * 0.09);
    // Upper lash line, heavier toward the outer corner, with a flick.
    g.lineStyle(2.4, INK).beginPath().arc(cx, cy + 1.5, w / 2 + 0.3, Math.PI * 1.12, Math.PI * 1.88).strokePath();
    g.lineStyle(1.6, INK).lineBetween(cx + w / 2, cy - h * 0.28, cx + w / 2 + 2, cy - h * 0.4);
    // Brow.
    g.lineStyle(1.6, INK).lineBetween(cx - w / 2 + 0.5, cy - h / 2 - 3, cx + w / 2 - 0.5, cy - h / 2 - 3.6);
  }
}

type Vec = (x: number, y: number) => Phaser.Math.Vector2;

function drawBackHair(g: Phaser.GameObjects.Graphics, style: HairStyle, hair: number, shade: number, V: Vec, ox: number): void {
  g.fillStyle(shade);
  if (style === 'long') {
    g.fillPoints([V(ox + 6, 12), V(ox + 22, 6), V(ox + 26, 20), V(ox + 22, 46), V(ox + 6, 48), V(ox + 2, 30)], true);
    g.fillStyle(hair).fillPoints([V(ox + 8, 12), V(ox + 20, 8), V(ox + 20, 30), V(ox + 12, 44), V(ox + 5, 30)], true);
  } else if (style === 'ponytail') {
    g.fillPoints([V(ox + 8, 10), V(ox - 2, 18), V(ox, 36), V(ox + 4, 32), V(ox + 6, 22), V(ox + 12, 14)], true);
  } else if (style === 'twintails') {
    g.fillPoints([V(ox + 7, 13), V(ox - 1, 22), V(ox + 1, 42), V(ox + 6, 36), V(ox + 8, 24)], true);
    g.fillPoints([V(ox + 36, 12), V(ox + 45, 22), V(ox + 43, 40), V(ox + 38, 34), V(ox + 37, 24)], true);
  } else if (style === 'bob') {
    g.fillRoundedRect(ox + 3, 8, 14, 24, 6);
  }
}

function drawFrontHair(g: Phaser.GameObjects.Graphics, style: HairStyle, hair: number, shade: number, V: Vec, ox: number): void {
  const x = (v: number) => ox + v;
  // The cap every style shares, sitting high enough to leave the eyes clear.
  g.fillStyle(hair).fillEllipse(x(21), style === 'short' ? 9 : 8.5, style === 'short' ? 32 : 35, style === 'short' ? 14 : 16);
  if (style === 'spiky') {
    g.fillPoints([V(x(6), 12), V(x(1), 26), V(x(10), 18)], true);
    g.fillPoints([V(x(8), 6), V(x(0), 3), V(x(10), 1)], true);
    g.fillPoints([V(x(15), 1), V(x(18), -2), V(x(23), 1)], true);
    g.fillPoints([V(x(25), 1), V(x(33), -1), V(x(31), 5)], true);
    g.fillPoints([V(x(31), 5), V(x(39), 8), V(x(34), 11)], true);
    g.fillPoints([V(x(13), 12), V(x(17), 21), V(x(21), 12)], true);
  } else if (style === 'bob') {
    // Straight bangs with a jagged edge, and a lock framing the far cheek.
    g.fillRect(x(10), 7, 28, 7);
    for (let i = 0; i < 6; i++) g.fillTriangle(x(10 + i * 4.6), 13.5, x(14.6 + i * 4.6), 13.5, x(12.3 + i * 4.6), 16.5);
    g.fillStyle(shade).fillRoundedRect(x(36), 10, 5, 18, 2.5);
  } else if (style === 'long') {
    g.fillPoints([V(x(12), 10), V(x(30), 6), V(x(38), 14), V(x(26), 13), V(x(18), 17)], true);
    g.fillStyle(shade).fillRoundedRect(x(36), 11, 5, 24, 2.5);
  } else if (style === 'ponytail') {
    // Side-swept bangs and a hair tie.
    g.fillPoints([V(x(10), 9), V(x(36), 6), V(x(39), 14), V(x(28), 11), V(x(16), 16)], true);
    g.fillStyle(0xff5a8a).fillCircle(x(8), 11, 2.6);
  } else if (style === 'twintails') {
    g.fillPoints([V(x(10), 9), V(x(37), 7), V(x(38), 14), V(x(24), 12), V(x(14), 16)], true);
    g.fillStyle(0xff5a8a).fillCircle(x(7), 13, 2.6).fillCircle(x(37), 12, 2.6);
  } else {
    // Short: a few little tufts.
    g.fillPoints([V(x(14), 10), V(x(18), 15), V(x(22), 10)], true);
    g.fillPoints([V(x(22), 9), V(x(26), 14), V(x(30), 9)], true);
  }
  g.fillStyle(0xffffff, 0.55).fillEllipse(x(17), 4.5, 10, 2.5);
}

function drawExtra(g: Phaser.GameObjects.Graphics, extra: JobExtra | undefined, V: Vec, ox: number): void {
  const x = (v: number) => ox + v;
  if (extra === 'sword') {
    g.fillStyle(0xe8edf5).fillPoints([V(x(35), 17), V(x(38), 17), V(x(38), 43), V(x(36.5), 46), V(x(35), 43)], true);
    g.fillStyle(0xffd84a).fillRect(x(32), 42, 9, 3);
    g.fillStyle(0x6b4a2e).fillRect(x(35), 45, 3, 6);
  }
  if (extra === 'staff') {
    g.fillStyle(0x8a5a3b).fillRect(x(37), 13, 3, 46);
    g.fillStyle(0x7fe3ff).fillCircle(x(38.5), 11, 5.5);
    g.fillStyle(0xffffff).fillCircle(x(37), 9.5, 2);
  }
  if (extra === 'bow') {
    g.lineStyle(3, 0x8a5a3b).beginPath().arc(x(28), 35, 14, -1.2, 1.2).strokePath();
    g.lineStyle(1, 0xf4f0e6).lineBetween(x(28) + 14 * Math.cos(-1.2), 35 + 14 * Math.sin(-1.2), x(28) + 14 * Math.cos(1.2), 35 + 14 * Math.sin(1.2));
    g.fillStyle(0x8a5a3b).fillRoundedRect(x(6), 27, 6, 16, 2);
    g.fillStyle(0xff6a5a).fillTriangle(x(6), 27, x(9), 22, x(12), 27);
  }
  if (extra === 'mace') {
    g.fillStyle(0x8a5a3b).fillRect(x(36), 27, 3, 24);
    g.fillStyle(0xd9dee8).fillCircle(x(37.5), 25, 5.5);
    g.fillStyle(0xffd84a).fillCircle(x(37.5), 25, 2.2);
    g.fillStyle(0xffd84a).fillRect(x(20.5), 38, 3, 9).fillRect(x(18), 40.5, 8, 3);
  }
}

/** Origin Y for a chibi texture so its feet sit on the tile. */
export function chibiOrigin(scene: Phaser.Scene, key: string): number {
  // Works for scaled drawings too: the scale is recovered from the texture height.
  const scale = (scene.textures.get(key).getSourceImage().height - 2 * inkPad(key)) / CHIBI_H;
  return feetOrigin(scene, key, CHIBI_FEET_Y * scale);
}

export function hexColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
