import { describe, expect, it } from 'vitest';
import { themeFor } from '../src/audio/director';
import { composeLoop, degreeToMidi, loopSteps, midiToHz, THEME_IDS, THEMES } from '../src/audio/music';
import { nextVolume, parseAudioSettings, volumeLabel } from '../src/audio/settings';
import { DEFAULT_AUDIO } from '../src/audio/engine';
import { loadContent } from '../src/data/content';

describe('procedural music', () => {
  it.each(THEME_IDS)('%s composes the same loop every time, inside the loop', (id) => {
    const theme = THEMES[id];
    const a = composeLoop(theme);
    expect(composeLoop(theme)).toEqual(a);
    expect(a.some((n) => n.voice === 'lead')).toBe(true);
    expect(a.some((n) => n.voice === 'bass')).toBe(true);
    for (const n of a) {
      expect(n.step).toBeGreaterThanOrEqual(0);
      expect(n.step).toBeLessThan(loopSteps(theme));
      if (n.voice === 'lead') expect(Math.abs(n.midi - (theme.root + 12 * theme.lead.octave))).toBeLessThanOrEqual(18);
    }
  });

  it('maps scale degrees to notes across octaves', () => {
    const c = { root: 60, scale: [0, 2, 4, 5, 7, 9, 11] };
    expect(degreeToMidi(c, 0)).toBe(60);
    expect(degreeToMidi(c, 7)).toBe(72);
    expect(degreeToMidi(c, -1)).toBe(59);
    expect(midiToHz(69)).toBeCloseTo(440);
  });

  it('every map has a tune', () => {
    const content = loadContent();
    for (const map of content.maps.values()) expect(THEME_IDS).toContain(themeFor(map));
    expect(themeFor(content.maps.get('saltmere')!)).toBe('harbor');
    expect(themeFor(content.maps.get('caves-1')!)).toBe('cave');
  });
});

describe('audio settings', () => {
  it('falls back to defaults for missing or broken settings', () => {
    expect(parseAudioSettings(undefined)).toEqual(DEFAULT_AUDIO);
    expect(parseAudioSettings({ music: 5 })).toEqual(DEFAULT_AUDIO);
    expect(parseAudioSettings({ music: 0.3, sfx: 0, muted: true })).toEqual({ music: 0.3, sfx: 0, muted: true });
  });

  it('cycles volume Off → 30% → 60% → 100% → Off', () => {
    expect([0, 0.3, 0.6, 1].map(nextVolume)).toEqual([0.3, 0.6, 1, 0]);
    expect(volumeLabel(0)).toBe('Off');
    expect(volumeLabel(0.6)).toBe('60%');
  });
});
