/**
 * Time of day. One cycle is DAY_CYCLE_MS of real time, shared by every map
 * (it follows the clock, so it carries on across map changes and sessions):
 * a long day, a warm dusk, a blue night and a pink dawn. Underground maps
 * stay dim all the time.
 */
import { mix } from './pix';

export const DAY_CYCLE_MS = 12 * 60 * 1000;

const DAY = 0xffffff;
const DUSK = 0xffa878;
const NIGHT = 0x4a5a9a;
const DAWN = 0xffb4a8;
const CAVE = 0x6a6a9a;

export interface Light {
  /** Multiply tint over the world (white = no change). */
  tint: number;
  /** How dark it is, 0 (day) to 1 (night): lamps and glows shine this much. */
  night: number;
  label: 'Day' | 'Dusk' | 'Night' | 'Dawn';
}

/** Where `now` falls in the cycle, 0..1. */
export function cyclePhase(now: number): number {
  return (((now % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS) / DAY_CYCLE_MS;
}

const ramp = (p: number, from: number, to: number) => Math.min(1, Math.max(0, (p - from) / (to - from)));

/** Lighting for a point in the cycle. */
export function lightAt(phase: number, underground = false): Light {
  if (underground) return { tint: CAVE, night: 0.8, label: 'Night' };
  const p = phase;
  if (p < 0.5) return { tint: DAY, night: 0, label: 'Day' };
  if (p < 0.54) return { tint: mix(DAY, DUSK, ramp(p, 0.5, 0.54)), night: 0.4 * ramp(p, 0.5, 0.54), label: 'Dusk' };
  if (p < 0.58) return { tint: mix(DUSK, NIGHT, ramp(p, 0.54, 0.58)), night: 0.4 + 0.6 * ramp(p, 0.54, 0.58), label: 'Dusk' };
  if (p < 0.9) return { tint: NIGHT, night: 1, label: 'Night' };
  if (p < 0.95) return { tint: mix(NIGHT, DAWN, ramp(p, 0.9, 0.95)), night: 1 - 0.6 * ramp(p, 0.9, 0.95), label: 'Dawn' };
  return { tint: mix(DAWN, DAY, ramp(p, 0.95, 1)), night: 0.4 * (1 - ramp(p, 0.95, 1)), label: 'Dawn' };
}
