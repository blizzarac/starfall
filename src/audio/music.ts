/**
 * Procedural background music: each theme is a short looping tune generated
 * from a seed, a scale and a chord progression, so no audio files ship.
 * Pure data and note generation here; the engine schedules and plays it.
 */

export type ThemeId = 'title' | 'town' | 'harbor' | 'field' | 'forest' | 'cave' | 'desert';

export const THEME_IDS: readonly ThemeId[] = ['title', 'town', 'harbor', 'field', 'forest', 'cave', 'desert'];

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface Theme {
  bpm: number;
  /** MIDI note of the scale's first degree. */
  root: number;
  /** Semitone offsets of the seven scale degrees. */
  scale: readonly number[];
  /** Chord root (scale degree, 0-based) for each bar of the loop. */
  chords: readonly number[];
  lead: { wave: Wave; gain: number; density: number; octave: number };
  bass: { wave: Wave; gain: number; steps: readonly number[] };
  pad: { wave: Wave; gain: number } | null;
  drums: { kick: readonly number[]; hat: readonly number[]; gain: number } | null;
  seed: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];

export const THEMES: Record<ThemeId, Theme> = {
  title: {
    bpm: 84,
    root: 60,
    scale: MAJOR,
    chords: [0, 5, 3, 4, 0, 5, 1, 4],
    lead: { wave: 'triangle', gain: 0.16, density: 0.45, octave: 1 },
    bass: { wave: 'sine', gain: 0.22, steps: [0, 8] },
    pad: { wave: 'sine', gain: 0.05 },
    drums: null,
    seed: 11,
  },
  town: {
    bpm: 96,
    root: 65,
    scale: MAJOR,
    chords: [0, 3, 5, 4, 0, 3, 1, 4],
    lead: { wave: 'triangle', gain: 0.15, density: 0.55, octave: 0 },
    bass: { wave: 'triangle', gain: 0.2, steps: [0, 6, 8, 14] },
    pad: { wave: 'sine', gain: 0.04 },
    drums: { kick: [0, 8], hat: [4, 12], gain: 0.05 },
    seed: 23,
  },
  harbor: {
    bpm: 108,
    root: 62,
    scale: MIXOLYDIAN,
    chords: [0, 6, 3, 0, 0, 6, 4, 0],
    lead: { wave: 'square', gain: 0.06, density: 0.6, octave: 0 },
    bass: { wave: 'triangle', gain: 0.22, steps: [0, 4, 8, 12] },
    pad: null,
    drums: { kick: [0, 6, 8], hat: [2, 6, 10, 14], gain: 0.05 },
    seed: 37,
  },
  field: {
    bpm: 112,
    root: 67,
    scale: MAJOR,
    chords: [0, 4, 5, 3, 0, 4, 3, 4],
    lead: { wave: 'square', gain: 0.055, density: 0.6, octave: 0 },
    bass: { wave: 'triangle', gain: 0.2, steps: [0, 4, 8, 12] },
    pad: { wave: 'triangle', gain: 0.03 },
    drums: { kick: [0, 8], hat: [0, 4, 8, 12], gain: 0.05 },
    seed: 41,
  },
  forest: {
    bpm: 100,
    root: 64,
    scale: DORIAN,
    chords: [0, 3, 0, 6, 0, 3, 4, 6],
    lead: { wave: 'triangle', gain: 0.15, density: 0.5, octave: 0 },
    bass: { wave: 'sine', gain: 0.22, steps: [0, 10] },
    pad: { wave: 'sine', gain: 0.045 },
    drums: { kick: [0], hat: [8], gain: 0.04 },
    seed: 53,
  },
  cave: {
    bpm: 72,
    root: 57,
    scale: MINOR,
    chords: [0, 0, 5, 6, 0, 3, 4, 4],
    lead: { wave: 'sine', gain: 0.14, density: 0.3, octave: 0 },
    bass: { wave: 'sine', gain: 0.25, steps: [0] },
    pad: { wave: 'triangle', gain: 0.04 },
    drums: null,
    seed: 67,
  },
  desert: {
    bpm: 92,
    root: 64,
    scale: PHRYGIAN_DOMINANT,
    chords: [0, 1, 0, 6, 0, 1, 5, 0],
    lead: { wave: 'sawtooth', gain: 0.04, density: 0.55, octave: 0 },
    bass: { wave: 'triangle', gain: 0.22, steps: [0, 3, 8, 11] },
    pad: { wave: 'sine', gain: 0.04 },
    drums: { kick: [0, 10], hat: [4, 12], gain: 0.05 },
    seed: 79,
  },
};

export const STEPS_PER_BAR = 16;

export interface Note {
  /** Step index within the loop (16 per bar). */
  step: number;
  /** Length in steps. */
  length: number;
  midi: number;
  voice: 'lead' | 'bass' | 'pad' | 'kick' | 'hat';
}

/** Mulberry32: tiny seeded generator so each theme's tune is always the same. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** MIDI note for a scale degree (may be negative or past 7; wraps into octaves). */
export function degreeToMidi(theme: Pick<Theme, 'root' | 'scale'>, degree: number): number {
  const n = theme.scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return theme.root + 12 * octave + theme.scale[idx]!;
}

/** Every note of one loop of the theme. Deterministic for a given theme. */
export function composeLoop(theme: Theme): Note[] {
  const rng = seeded(theme.seed);
  const notes: Note[] = [];
  let prev = theme.chords[0]! + 7 * theme.lead.octave;
  theme.chords.forEach((chord, bar) => {
    const start = bar * STEPS_PER_BAR;
    // Bass: chord root, an octave down.
    for (const s of theme.bass.steps) notes.push({ step: start + s, length: 3, midi: degreeToMidi(theme, chord - 7), voice: 'bass' });
    // Pad: the triad, held for the bar.
    if (theme.pad) for (const d of [0, 2, 4]) notes.push({ step: start, length: STEPS_PER_BAR, midi: degreeToMidi(theme, chord + d), voice: 'pad' });
    if (theme.drums) {
      for (const s of theme.drums.kick) notes.push({ step: start + s, length: 1, midi: 0, voice: 'kick' });
      for (const s of theme.drums.hat) notes.push({ step: start + s, length: 1, midi: 0, voice: 'hat' });
    }
    // Lead: a walk that leans on chord tones on strong beats.
    for (let s = 0; s < STEPS_PER_BAR; s += 2) {
      const strong = s % 4 === 0;
      if (rng() > theme.lead.density + (strong ? 0.2 : 0)) continue;
      const tones = [0, 2, 4].map((d) => chord + d + 7 * theme.lead.octave);
      let target: number;
      if (strong) {
        target = tones.reduce((best, t) => (Math.abs(t - prev) < Math.abs(best - prev) ? t : best), tones[0]!);
        if (rng() < 0.3) target = tones[Math.floor(rng() * tones.length)]!;
      } else {
        target = prev + (rng() < 0.5 ? -1 : 1) * (rng() < 0.7 ? 1 : 2);
      }
      // Keep the melody in a singable range around the root.
      const base = 7 * theme.lead.octave;
      target = Math.max(base - 2, Math.min(base + 9, target));
      const length = s + 4 <= STEPS_PER_BAR && rng() < 0.4 ? 4 : 2;
      notes.push({ step: start + s, length, midi: degreeToMidi(theme, target), voice: 'lead' });
      prev = target;
    }
  });
  return notes;
}

export function loopSteps(theme: Theme): number {
  return theme.chords.length * STEPS_PER_BAR;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
