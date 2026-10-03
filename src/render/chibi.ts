import Phaser from 'phaser';
import { appearanceKey, EYE_COLORS, HAIR_COLORS, SKIN_TONES, type Appearance, type HairStyle } from '../core/appearance';
import type { JobDef, JobExtra, JobId } from '../core/jobs';
import { ensureHero, HERO_FEET, HERO_H, HERO_RES, type Outfit } from './hero';

/**
 * Character sprites. (The name is historical: they used to be chibis.) The art
 * itself lives in hero.ts; this module picks outfits and colors per job and NPC.
 */

/** Scale to show a character sprite at its intended on-screen size. */
export const CHAR_SCALE = 1 / HERO_RES;

export interface ChibiLook {
  hairStyle: HairStyle;
  hair: number;
  eye: number;
  skin: number;
}

/** Outfit silhouette and trim color for each job. */
const JOB_STYLE: Record<JobId, { outfit: Outfit; accent: number }> = {
  novice: { outfit: 'tunic', accent: 0xd9b46a },
  swordsman: { outfit: 'coat', accent: 0xc43a2a },
  knight: { outfit: 'armor', accent: 0xc43a2a },
  mage: { outfit: 'robe', accent: 0xe8c35a },
  wizard: { outfit: 'robe', accent: 0x7fe3ff },
  archer: { outfit: 'ranger', accent: 0xd9b46a },
  hunter: { outfit: 'ranger', accent: 0xc43a2a },
  acolyte: { outfit: 'vestment', accent: 0xe8c35a },
  priest: { outfit: 'vestment', accent: 0xc43a6a },
};

/** The player's sprite for a job and appearance; drawn once per combination. */
export function playerChibi(scene: Phaser.Scene, job: JobDef, a: Appearance): string {
  const style = JOB_STYLE[job.id];
  return ensureHero(scene, `hero-${job.id}-${appearanceKey(a)}`, {
    hairStyle: a.hairStyle,
    hair: HAIR_COLORS[a.hairColor]!,
    eye: EYE_COLORS[a.eyeColor]!,
    skin: SKIN_TONES[a.skinTone]!,
    body: job.look.body,
    accent: style.accent,
    outfit: style.outfit,
    extra: job.look.extra,
  });
}

/** An NPC's sprite: townsfolk clothes in its color, with its own look. */
export function ensureChibi(scene: Phaser.Scene, key: string, body: number, look: ChibiLook, extra?: JobExtra): string {
  const accent = Phaser.Display.Color.ValueToColor(body).lighten(30).color;
  return ensureHero(scene, key, { ...look, body, accent, outfit: (key.length + body) % 3 === 0 ? 'coat' : 'townsfolk', extra });
}

/** Origin Y that puts a character's feet on the tile. */
export function chibiOrigin(_scene?: Phaser.Scene, _key?: string): number {
  return HERO_FEET / HERO_H;
}

export function hexColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
