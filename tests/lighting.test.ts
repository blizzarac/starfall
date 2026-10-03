import { describe, expect, it } from 'vitest';
import { mapLight } from '../src/render/lighting';

describe('lighting', () => {
  it('is plain daylight outdoors and dim underground', () => {
    expect(mapLight(false)).toEqual({ tint: 0xffffff, night: 0 });
    expect(mapLight(true).night).toBeGreaterThan(0.5);
  });
});
