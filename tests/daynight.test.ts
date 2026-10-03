import { describe, expect, it } from 'vitest';
import { cyclePhase, DAY_CYCLE_MS, lightAt } from '../src/render/daynight';

describe('day and night', () => {
  it('cycles through day, dusk, night and dawn', () => {
    const labels = Array.from({ length: 100 }, (_, i) => lightAt(i / 100).label);
    expect(new Set(labels)).toEqual(new Set(['Day', 'Dusk', 'Night', 'Dawn']));
    expect(lightAt(0.2)).toEqual({ tint: 0xffffff, night: 0, label: 'Day' });
    expect(lightAt(0.7).night).toBe(1);
  });

  it('changes smoothly, with no jumps at the seams', () => {
    for (let i = 0; i < 1000; i++) {
      const a = lightAt(i / 1000).night;
      const b = lightAt(((i + 1) % 1000) / 1000).night;
      expect(Math.abs(a - b)).toBeLessThan(0.05);
    }
  });

  it('follows the clock, and caves are always dim', () => {
    expect(cyclePhase(DAY_CYCLE_MS * 3 + DAY_CYCLE_MS / 4)).toBeCloseTo(0.25);
    expect(lightAt(0.1, true).night).toBeGreaterThan(0.5);
  });
});
