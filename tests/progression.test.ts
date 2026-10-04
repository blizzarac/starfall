import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { applyDeathPenalty, createPlayer, derivedStats, gainXp, raiseStat } from '../src/core/progression';

describe('progression', () => {
  it('levels up through several levels at once and grants stat points', () => {
    const p = createPlayer('t', { x: 0, y: 0 });
    const points = p.statPoints;
    const ups = gainXp(p, F.baseXpToNext(1) + F.baseXpToNext(2) + 5, 0);
    expect(ups.base).toEqual([2, 3]);
    expect(p.baseLevel).toBe(3);
    expect(p.baseXp).toBe(5);
    expect(p.statPoints).toBe(points + F.statPointsForLevel(2) + F.statPointsForLevel(3));
  });

  it('fully heals on base level up', () => {
    const p = createPlayer('t', { x: 0, y: 0 });
    p.hp = 1;
    gainXp(p, F.baseXpToNext(1), 0);
    expect(p.hp).toBe(derivedStats(p).maxHp);
  });

  it('has no level caps: base and job levels keep rising, a skill point per job level', () => {
    const p = createPlayer('t', { x: 0, y: 0 });
    gainXp(p, 1e9, 1_000_000);
    expect(p.jobLevel).toBeGreaterThan(50);
    expect(p.skillPoints).toBe(p.jobLevel - 1);
    expect(p.baseLevel).toBeGreaterThan(99);
  });

  it('spends stat points by the raise cost', () => {
    const p = createPlayer('t', { x: 0, y: 0 });
    p.statPoints = 3;
    expect(raiseStat(p, 'str')).toBe(true);
    expect(p.stats.str).toBe(6);
    expect(p.statPoints).toBe(1);
    expect(raiseStat(p, 'str')).toBe(false);
  });

  it('never takes XP below zero on death', () => {
    const p = createPlayer('t', { x: 0, y: 0 });
    gainXp(p, F.baseXpToNext(1) + F.baseXpToNext(2) + F.baseXpToNext(3) + F.baseXpToNext(4) + F.baseXpToNext(5) + F.baseXpToNext(6) + F.baseXpToNext(7) + F.baseXpToNext(8) + F.baseXpToNext(9), 0);
    expect(p.baseLevel).toBe(10);
    expect(applyDeathPenalty(p)).toBe(0);
    p.baseXp = 500;
    expect(applyDeathPenalty(p)).toBe(F.deathXpPenalty(10));
  });
});
