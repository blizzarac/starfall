import { describe, expect, it } from 'vitest';
import * as F from '../src/core/combat/formulas';
import { HOTBAR_SIZE } from '../src/core/entities';
import { tileDistance } from '../src/core/grid';
import { gainXp } from '../src/core/progression';
import type { SkillId } from '../src/core/skills';
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

  it('a mage opens with bolts from range before swinging the staff', () => {
    const w = new World(content, content.maps.get('meadow-2')!, { seed: 4 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'mage' });
    w.player.skillPoints = 5;
    for (let i = 0; i < 5; i++) expect(w.learnSkill('fire_bolt')).toBeNull();
    w.player.hp = 1e6;
    // Only earth monsters around, which fire hurts most.
    for (const m of [...w.monsters.values()]) if (m.def.element !== 'earth') w.monsters.delete(m.id);
    const beetle = [...w.monsters.values()][0]!;
    const spot = [{ x: beetle.tile.x - 4, y: beetle.tile.y }, { x: beetle.tile.x + 4, y: beetle.tile.y }, { x: beetle.tile.x, y: beetle.tile.y - 4 }, { x: beetle.tile.x, y: beetle.tile.y + 4 }].find((t) => w.grid.isWalkable(t.x, t.y))!;
    w.changeMap('meadow-2', spot);
    // Just that one beetle, so nothing else walks up and interrupts the cast.
    for (const m of [...w.monsters.values()]) if (m.id !== beetle.id) w.monsters.delete(m.id);
    const order: string[] = [];
    w.events.on('skillUsed', (e) => order.push(`skill:${e.skillId}`));
    w.events.on('damage', (e) => e.sourceId === 'player' && order.push('hit'));
    w.setAuto(true);
    run(w, 20_000, () => order.length >= 3);
    expect(order[0]).toBe('skill:fire_bolt');
  });

  it('fires on Jellops, skips spells they barely feel, and prefers what they are weakest to', () => {
    const mage = (skills: SkillId[]) => {
      const w = new World(content, meadow, { seed: 4 });
      gainXp(w.player, 0, 100_000);
      for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
      w.applyAction({ type: 'changeJob', job: 'mage' });
      w.player.skillPoints = 30;
      for (const id of skills) for (let i = 0; i < 3; i++) w.learnSkill(id);
      w.player.hp = 1e6;
      const used: string[] = [];
      w.events.on('skillUsed', (e) => used.push(e.skillId));
      w.setAuto(true);
      run(w, 15_000, () => used.length >= 2);
      return used;
    };
    // Jellops are water: fire only loses 10%, so it's still worth casting…
    expect(mage(['fire_bolt'])).toContain('fire_bolt');
    // …cold does a quarter, so Auto swings instead…
    expect(mage(['cold_bolt'])).toEqual([]);
    // …and lightning hits water hardest, so it comes first.
    expect(mage(['fire_bolt', 'lightning_bolt'])[0]).toBe('lightning_bolt');
  });

  it('an acolyte heals itself when hurt', () => {
    const w = new World(content, meadow, { seed: 4 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'acolyte' });
    w.player.skillPoints = 3;
    for (let i = 0; i < 3; i++) expect(w.learnSkill('heal')).toBeNull();
    const used: string[] = [];
    w.events.on('skillUsed', (e) => used.push(e.skillId));
    w.player.hp = Math.round(w.player.hp * 0.5);
    w.setAuto(true);
    run(w, 5000, () => used.length > 0);
    expect(used[0]).toBe('heal');
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
  it('keeps going when a spell target dies mid-cast (to a pet, say), and stands up when switched on', () => {
    const w = new World(content, content.maps.get('meadow-2')!, { seed: 4 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'mage' });
    w.player.skillPoints = 5;
    for (let i = 0; i < 5; i++) w.learnSkill('fire_bolt');
    w.player.hp = 1e6;
    w.toggleSit();
    w.setAuto(true);
    expect(w.player.sitting).toBe(false);
    run(w, 20_000, () => !!w.player.casting);
    const target = w.monsters.get(w.player.casting!.targetId)!;
    w.monsters.delete(target.id);
    run(w, 200);
    // Not stuck "casting" at a monster that is gone.
    expect(w.player.casting?.targetId).not.toBe(target.id);
    let hits = 0;
    w.events.on('skillUsed', () => hits++);
    run(w, 10_000, () => hits > 0);
    expect(hits).toBeGreaterThan(0);
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

describe('spawning', () => {
  it('monsters never appear within 10 tiles of the player, on entering a map or respawning', () => {
    const w = new World(content, meadow, { seed: 6 });
    const m0 = [...w.monsters.values()][0]!;
    w.changeMap('meadow-2', content.maps.get('meadow-2')!.playerStart);
    w.changeMap('meadow-1', m0.tile);
    for (const m of w.monsters.values()) expect(tileDistance(m.tile, w.player.tile)).toBeGreaterThanOrEqual(10);
    // Clear the map while standing in the middle of a spawn area; everything respawns away from you.
    const seen = new Set<number>();
    for (const m of [...w.monsters.values()]) {
      seen.add(m.id);
      w.monsters.delete(m.id);
    }
    const respawns = (w as unknown as { respawns: Array<{ spawnIndex: number; at: number }> }).respawns;
    meadow.spawns.forEach((sp, i) => {
      for (let n = 0; n < sp.count; n++) respawns.push({ spawnIndex: i, at: 0 });
    });
    for (let t = 0; t < 30_000; t += F.TICK_MS) {
      w.player.hp = 1e6;
      w.tick();
      for (const m of w.monsters.values()) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        expect(tileDistance(m.tile, w.player.tile)).toBeGreaterThanOrEqual(10);
      }
    }
  });
});

describe('Auto after an interrupted cast', () => {
  it('fights with basic attacks for a moment instead of recasting into every hit', () => {
    const w = new World(content, content.maps.get('meadow-2')!, { seed: 4 });
    gainXp(w.player, 0, 100_000);
    for (let i = 0; i < 4; i++) w.learnSkill('basic_training');
    w.applyAction({ type: 'changeJob', job: 'mage' });
    w.player.skillPoints = 5;
    for (let i = 0; i < 5; i++) w.learnSkill('fire_bolt');
    w.player.hp = 1e6;
    w.setAuto(true);
    run(w, 20_000, () => !!w.player.casting);
    expect(w.player.casting).not.toBeNull();
    // A heavy hit knocks the spell away.
    const m = w.monsters.get(w.player.casting!.targetId)!;
    (w as unknown as { hurtPlayer: (m: unknown, amount: number) => void }).hurtPlayer(m, 1000);
    expect(w.player.casting).toBeNull();
    const used: string[] = [];
    w.events.on('skillUsed', (e) => used.push(e.skillId));
    let hits = 0;
    w.events.on('damage', (e) => e.sourceId === 'player' && hits++);
    w.events.on('miss', () => hits++);
    run(w, 3000);
    expect(w.player.casting).toBeNull();
    expect(used).toEqual([]);
    expect(hits).toBeGreaterThan(0);
  });
});
