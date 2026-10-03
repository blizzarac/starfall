/**
 * Map lighting. Outdoors is always plain daylight; underground maps are dim,
 * so lamps, glowing machines and the player's own light shine there.
 */
export interface Light {
  /** Multiply tint over the world (white = no change). */
  tint: number;
  /** How dark it is, 0 (daylight) to 1: lamps and glows shine this much. */
  night: number;
}

const DAYLIGHT: Light = { tint: 0xffffff, night: 0 };
const CAVE: Light = { tint: 0x6a6a9a, night: 0.8 };

export function mapLight(underground: boolean): Light {
  return underground ? CAVE : DAYLIGHT;
}
