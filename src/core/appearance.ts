/** How a character looks. Purely cosmetic; saved with the character. */
export interface Appearance {
  hairStyle: HairStyle;
  /** Index into HAIR_COLORS. */
  hairColor: number;
  /** Index into EYE_COLORS. */
  eyeColor: number;
  /** Index into SKIN_TONES. */
  skinTone: number;
}

export const HAIR_STYLES = ['spiky', 'bob', 'long', 'ponytail', 'twintails', 'short'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const HAIR_STYLE_NAMES: Record<HairStyle, string> = {
  spiky: 'Messy',
  bob: 'Bob',
  long: 'Long',
  ponytail: 'Ponytail',
  twintails: 'Twin tails',
  short: 'Short',
};

export const HAIR_COLORS = [0x6b4a8c, 0x2a2433, 0x7a4a2a, 0xf0c95a, 0xd9483a, 0xff8fc0, 0x4a7fe0, 0xd8dce6, 0x3fae6a] as const;
export const EYE_COLORS = [0x3a6fd8, 0x2f9a58, 0x8a5a2a, 0xd83a3a, 0x8a4ad8, 0xe0a020] as const;
export const SKIN_TONES = [0xffe3cc, 0xf6cfae, 0xdba67e, 0xa8714c] as const;

export const DEFAULT_APPEARANCE: Appearance = { hairStyle: 'spiky', hairColor: 0, eyeColor: 0, skinTone: 0 };

/** Keeps a loaded or edited appearance inside the known options. */
export function cleanAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  const pick = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  return {
    hairStyle: HAIR_STYLES.includes(a?.hairStyle as HairStyle) ? (a!.hairStyle as HairStyle) : DEFAULT_APPEARANCE.hairStyle,
    hairColor: pick(a?.hairColor, HAIR_COLORS.length, DEFAULT_APPEARANCE.hairColor),
    eyeColor: pick(a?.eyeColor, EYE_COLORS.length, DEFAULT_APPEARANCE.eyeColor),
    skinTone: pick(a?.skinTone, SKIN_TONES.length, DEFAULT_APPEARANCE.skinTone),
  };
}

/** Short stable key, used to cache the drawn sprite. */
export function appearanceKey(a: Appearance): string {
  return `${a.hairStyle}-${a.hairColor}-${a.eyeColor}-${a.skinTone}`;
}

/** A varied but fixed look for an NPC, picked from its id. */
export function npcAppearance(id: string, hairColor: number): { hairStyle: HairStyle; hair: number; eye: number; skin: number } {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return {
    hairStyle: HAIR_STYLES[h % HAIR_STYLES.length]!,
    hair: hairColor,
    eye: EYE_COLORS[(h >>> 8) % EYE_COLORS.length]!,
    skin: SKIN_TONES[(h >>> 16) % SKIN_TONES.length]!,
  };
}
