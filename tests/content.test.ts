import { describe, expect, it } from 'vitest';
import { buildContent, loadContent, RAW_CONTENT } from '../src/data/content';

describe('content', () => {
  it('validates all shipped data', () => {
    const content = loadContent();
    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.maps.has('meadow-1')).toBe(true);
  });

  it('rejects drops that point at unknown items', () => {
    const monsters = structuredClone(RAW_CONTENT.monsters) as Array<{ drops: unknown[] }>;
    monsters[0]!.drops.push({ item: 'nope', chance: 0.5 });
    expect(() => buildContent({ ...RAW_CONTENT, monsters })).toThrow(/unknown item 'nope'/);
  });

  it('rejects maps with ragged rows', () => {
    const map = structuredClone(RAW_CONTENT.maps[0]!) as { rows: string[] };
    map.rows[3] = map.rows[3]!.slice(1);
    expect(() => buildContent({ ...RAW_CONTENT, maps: [map] })).toThrow();
  });
});
