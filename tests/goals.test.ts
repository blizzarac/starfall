import { describe, expect, it } from 'vitest';
import { mapLevelRange, nextGoal, recommendedMap } from '../src/core/goals';
import { gainXp } from '../src/core/progression';
import { visitedFlag, World } from '../src/core/world';
import { loadContent, START_MAP } from '../src/data/content';
import { WORLD_LAYOUT } from '../src/ui/WorldMapWindow';

const content = loadContent();
const town = content.maps.get(START_MAP)!;

describe('next goal', () => {
  it('walks a new player through the novice steps', () => {
    const w = new World(content, town, { seed: 1 });
    expect(nextGoal(w)).toMatch(/job level 5/);
    gainXp(w.player, 0, 100_000);
    expect(nextGoal(w)).toMatch(/Basic Training/);
    for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
    expect(nextGoal(w)).toMatch(/guild/);
  });

  it('points to Saltmere, then the second-job trial in Sunspire', () => {
    const w = new World(content, town, { seed: 1 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'archer' });
    w.player.baseLevel = 19;
    expect(nextGoal(w)).toMatch(/Saltmere/);
    w.flags.set(visitedFlag('saltmere'), true);
    expect(nextGoal(w)).toMatch(/Train in/);
    gainXp(w.player, 0, 50_000_000);
    expect(nextGoal(w)).toMatch(/Sail to Sunspire/);
    w.flags.set(visitedFlag('sunspire'), true);
    expect(nextGoal(w)).toMatch(/trial/);
  });

  it('recommends harder hunting grounds as you level, never a boss lair', () => {
    const w = new World(content, town, { seed: 1 });
    expect(recommendedMap(w)!.id).toBe('meadow-1');
    w.player.baseLevel = 20;
    const mid = recommendedMap(w)!;
    expect(mapLevelRange(w, mid)![0]).toBeLessThanOrEqual(22);
    w.player.baseLevel = 42;
    expect(recommendedMap(w)!.id).toBe('sunken-ruins');
    w.player.baseLevel = 48;
    expect(recommendedMap(w)!.id).toBe('iron-wastes');
    w.player.baseLevel = 60;
    expect(recommendedMap(w)!.id).toBe('clockwork-citadel');
    for (let lv = 1; lv <= 60; lv++) {
      w.player.baseLevel = lv;
      expect(recommendedMap(w)!.id).not.toBe('caves-2');
    }
  });
});

describe('world map', () => {
  it('places every map', () => {
    for (const id of content.maps.keys()) expect(WORLD_LAYOUT[id], id).toBeDefined();
  });
});
