import Phaser from 'phaser';
import { appearanceKey, EYE_COLORS, HAIR_COLORS, SKIN_TONES, type Appearance, type HairStyle } from '../core/appearance';
import type { JobDef, JobId } from '../core/jobs';
import { ensureKnight, KNIGHT_FEET, KNIGHT_H, type Gear, type Weapon } from './knight';

/**
 * Character sprites. (The name is historical: they used to be chibis.) The
 * pixel art lives in knight.ts; this module picks gear and colors per job and NPC.
 */

/** World units per art pixel for characters in the world. */
export const WORLD_CHAR_SCALE = 1.75;
/** The standing frame used for portraits. */
export const PORTRAIT_FRAME = 'F-idle-0';

export interface ChibiLook {
  hairStyle: HairStyle;
  hair: number;
  eye: number;
  skin: number;
}

/** Gear, weapon and energy color for each job. */
const JOB_STYLE: Record<JobId, { gear: Gear; weapon: Weapon; glow: number }> = {
  novice: { gear: 'novice', weapon: 'none', glow: 0x6dffa8 },
  swordsman: { gear: 'swordsman', weapon: 'sword', glow: 0x4fe6ff },
  knight: { gear: 'knight', weapon: 'greatsword', glow: 0x5aa8ff },
  mage: { gear: 'mage', weapon: 'staff', glow: 0xc77dff },
  wizard: { gear: 'wizard', weapon: 'staff', glow: 0xff6ae0 },
  archer: { gear: 'archer', weapon: 'bow', glow: 0xa8ff5e },
  hunter: { gear: 'hunter', weapon: 'bow', glow: 0xffa84f },
  acolyte: { gear: 'acolyte', weapon: 'mace', glow: 0xffe27a },
  priest: { gear: 'priest', weapon: 'mace', glow: 0x8af0ff },
};

/** The player's sprite sheet for a job and appearance; painted once per combination. */
export function playerChibi(scene: Phaser.Scene, job: JobDef, a: Appearance): string {
  const style = JOB_STYLE[job.id];
  return ensureKnight(scene, `knight-${job.id}-${appearanceKey(a)}`, {
    hairStyle: a.hairStyle,
    hair: HAIR_COLORS[a.hairColor]!,
    eye: EYE_COLORS[a.eyeColor]!,
    skin: SKIN_TONES[a.skinTone]!,
    cloth: job.look.body,
    glow: style.glow,
    gear: style.gear,
    weapon: style.weapon,
  });
}

/**
 * An NPC's sprite sheet in its own colors. Guild masters (ids starting with a
 * job, like "knight_commander") wear that job's gear; everyone else dresses as
 * townsfolk, and harbor captains as guards.
 */
export function ensureChibi(scene: Phaser.Scene, key: string, body: number, look: ChibiLook): string {
  const id = key.replace(/^npc-/, '');
  const job = (Object.keys(JOB_STYLE) as JobId[]).find((j) => id.startsWith(`${j}_`));
  const style = job ? JOB_STYLE[job] : /dock|captain/.test(id) ? { gear: 'guard' as const, weapon: 'sword' as const, glow: 0x4fe6ff } : null;
  return ensureKnight(scene, key, {
    ...look,
    cloth: body,
    glow: style?.glow ?? 0x4fe6ff,
    gear: style?.gear ?? 'townsfolk',
    weapon: style?.weapon ?? 'none',
  });
}

/** Origin Y that puts a character's feet on the tile. */
export function chibiOrigin(): number {
  return (KNIGHT_FEET + 0.5) / KNIGHT_H;
}

export function hexColor(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}
