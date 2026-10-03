import { z } from 'zod';
import type { SaveDb } from '../save/db';
import { audio, DEFAULT_AUDIO, type AudioSettings } from './engine';

const KEY = 'audio';

const AudioSettingsSchema = z.object({
  music: z.number().min(0).max(1),
  sfx: z.number().min(0).max(1),
  muted: z.boolean(),
});

/** Stored settings, or the defaults if missing or unreadable. */
export function parseAudioSettings(raw: unknown): AudioSettings {
  const parsed = AudioSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_AUDIO };
}

export async function loadAudioSettings(db: SaveDb): Promise<void> {
  try {
    audio.apply(parseAudioSettings(await db.getSetting(KEY)));
  } catch {
    // Settings are a nicety; defaults are fine.
  }
}

/** Applies and stores new settings. */
export function updateAudioSettings(db: SaveDb, change: Partial<AudioSettings>): AudioSettings {
  const next = { ...audio.current, ...change };
  audio.apply(next);
  void db.setSetting(KEY, next).catch(() => {});
  return next;
}

/** Volume steps the menu cycles through. */
export const VOLUME_STEPS = [0, 0.3, 0.6, 1] as const;

export function nextVolume(v: number): number {
  const i = VOLUME_STEPS.findIndex((s) => s >= v - 0.01);
  return VOLUME_STEPS[(i + 1) % VOLUME_STEPS.length]!;
}

export function volumeLabel(v: number): string {
  return v === 0 ? 'Off' : `${Math.round(v * 100)}%`;
}
