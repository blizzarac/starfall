import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { HOTBAR_SIZE } from '../src/core/entities';
import { tileDistance } from '../src/core/grid';
import { gainXp } from '../src/core/progression';
import { World } from '../src/core/world';
import { loadContent } from '../src/data/content';
import { migrate } from '../src/save/migrations';
import { applySaveDoc, toSaveDoc } from '../src/save/serialize';

const content = loadContent();
const meadow = content.maps.get('meadow-1')!;

function run(world: World, ms: number, until?: () => boolean): void {
  for (let t = 0; t < ms; t += F.TICK_MS) {
    world.tick();
    if (until?.()) return;
  }
}

describe('Auto mode', () => {
  it('fights the nearest monsters and picks up the loot', () => {
    const w = new World(content, meadow, { seed: 4 });
    w.player.stats.str = 40;
    let kills = 0;
    w.events.on('monsterDied', () => kills++);
    w.setAuto(true);
    run(w, 60_000);
    expect(kills).toBeGreaterThan(3);
    expect(w.session.lootValue).toBeGreaterThan(0);
  });

  it('a manual move takes over, and Auto resumes after arriving', () => {
    const w = new World(content, meadow, { seed: 4 });
    w.setAuto(true);
    const t = w.player.tile;
    w.moveTo({ x: t.x + 3, y: t.y });
    run(w, 400);
    expect(w.player.intent.kind).toBe('move');
    run(w, 5000, () => w.player.intent.kind === 'attack');
    expect(w.player.intent.kind).toBe('attack');
  });

  it('drinks potions when low, and stops when out of them', () => {
    const w = new World(content, meadow, { seed: 4 });
    w.addItem('red_tonic', 1);
    w.setAuto(true);
    w.player.hp = 5;
    run(w, 100);
    expect(w.itemCount('red_tonic')).toBe(0);
    w.player.hp = 5;
    run(w, 100);
    expect(w.auto).toBe(false);
  });

  it('turns off when the player faints', () => {
    const w = new World(content, meadow, { seed: 4 });
    w.setAuto(true);
    w.player.hp = 1;
    const m = [...w.monsters.values()].sort((a, b) => tileDistance(a.tile, w.player.tile) - tileDistance(b.tile, w.player.tile))[0]!;
    m.def = { ...m.def, atk: [999, 999], hit: 999 };
    w.addItem('red_tonic', 0);
    run(w, 30_000, () => w.player.dead);
    expect(w.player.dead).toBe(true);
    expect(w.auto).toBe(false);
  });
});

describe('best potion', () => {
  it('drinks the smallest potion that covers the missing HP', () => {
    const w = new World(content, meadow, { seed: 1 });
    gainXp(w.player, 50_000, 0);
    w.addItem('red_tonic', 3);
    w.addItem('yellow_tonic', 3);
    w.player.hp -= 30;
    w.useBestPotion();
    expect(w.itemCount('red_tonic')).toBe(2);
    w.player.hp = 10;
    w.useBestPotion();
    expect(w.itemCount('yellow_tonic')).toBe(2);
  });
});

describe('quick bar', () => {
  it('fills with newly learned active skills, takes consumables, and caps at 8', () => {
    const w = new World(content, meadow, { seed: 1 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 9; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'swordsman' });
    w.player.skillPoints = 20;
    w.learnSkill('bash');
    w.learnSkill('bash');
    w.learnSkill('sword_mastery');
    expect(w.player.hotbar).toEqual(['bash']);
    expect(w.toggleHotbar('sword_mastery')).toMatch(/can't/);
    expect(w.toggleHotbar('red_tonic')).toBeNull();
    w.moveHotbar('red_tonic', -1);
    expect(w.player.hotbar).toEqual(['red_tonic', 'bash']);
    for (const id of ['sweet_apple', 'green_herb', 'panacea', 'fly_wing', 'butterfly_wing', 'orange_tonic']) w.toggleHotbar(id);
    expect(w.player.hotbar).toHaveLength(HOTBAR_SIZE);
    expect(w.toggleHotbar('yellow_tonic')).toMatch(/holds 8/);
    w.addItem('red_tonic', 1);
    w.useHotbar(0);
    expect(w.itemCount('red_tonic')).toBe(0);
  });

  it('is saved, and older saves rebuild it from learned skills', () => {
    const w = new World(content, meadow, { seed: 1 });
    w.player.skills.set('bash', 3);
    w.player.hotbar = ['red_tonic', 'bash'];
    const doc = JSON.parse(JSON.stringify(toSaveDoc(w, 0)));
    const a = new World(content, meadow, { seed: 2 });
    applySaveDoc(a, migrate(doc));
    expect(a.player.hotbar).toEqual(['red_tonic', 'bash']);
    delete doc.hotbar;
    const b = new World(content, meadow, { seed: 2 });
    applySaveDoc(b, migrate(doc));
    expect(b.player.hotbar).toEqual(['bash']);
  });
});
