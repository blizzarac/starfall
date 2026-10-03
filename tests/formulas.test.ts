import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { createRng } from '../src/core/rng';

describe('formulas', () => {
  it('makes high stats cost more to raise', () => {
    expect(F.statRaiseCost(1)).toBe(2);
    expect(F.statRaiseCost(10)).toBe(2);
    expect(F.statRaiseCost(11)).toBe(3);
    expect(F.statRaiseCost(98)).toBe(11);
  });

  it('clamps hit chance to 5–95%', () => {
    expect(F.hitChance(0, 500)).toBe(0.05);
    expect(F.hitChance(500, 0)).toBe(0.95);
    expect(F.hitChance(20, 20)).toBeCloseTo(0.8);
  });

  it('attacks faster with more AGI', () => {
    const slow = F.attackDelayMs(F.aspd(1, 1, 'dagger'));
    const fast = F.attackDelayMs(F.aspd(60, 30, 'dagger'));
    expect(fast).toBeLessThan(slow);
    expect(F.aspd(500, 500, 'dagger')).toBe(190);
  });

  it('applies element and size, then defense, with a floor of 1', () => {
    const rng = () => 0.5; // variance 1.0
    expect(F.damage({ atk: 100, def: 10 }, rng)).toBe(90);
    expect(F.damage({ atk: 100, elementModifier: 1.5, sizeModifier: 0.5, def: 0 }, rng)).toBe(75);
    expect(F.damage({ atk: 5, def: 50 }, rng)).toBe(1);
    expect(F.damage({ atk: 100, elementModifier: 0, def: 0 }, rng)).toBe(0);
  });

  it('keeps normal damage within ±10%', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      const d = F.damage({ atk: 100, def: 0 }, rng);
      expect(d).toBeGreaterThanOrEqual(90);
      expect(d).toBeLessThanOrEqual(110);
    }
  });

  it('crits ignore defense', () => {
    expect(F.damage({ atk: 100, def: 1000, crit: true }, () => 0)).toBe(154);
  });

  it('looks up the element table with neutral as the default', () => {
    expect(F.elementModifier('fire', 'earth')).toBe(1.5);
    expect(F.elementModifier('neutral', 'ghost')).toBe(0.25);
    expect(F.elementModifier('neutral', 'water')).toBe(1);
  });

  it('charges 1% of the level requirement on death', () => {
    expect(F.deathXpPenalty(10)).toBe(Math.floor(F.baseXpToNext(10) / 100));
  });
});
