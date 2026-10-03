import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../src/core/combat/formulas';
import { findPath } from '../src/core/pathfinding';
import { World } from '../src/core/world';
import { buildGrid, loadContent, START_MAP } from '../src/data/content';

const content = loadContent();

describe('world layout', () => {
  it('every map is reachable from town (on foot or by ship), and every portal and NPC from where you arrive', () => {
    // Ships: NPC warps that aren't the Courier Guild's (which only goes where you've been).
    const ships = new Map<string, Array<{ map: string; x: number; y: number }>>();
    for (const map of content.maps.values()) {
      for (const npc of map.npcs) {
        if (npc.dialogue === 'courier') continue;
        for (const node of Object.values(content.dialogues.get(npc.dialogue)!.nodes)) {
          if ('branch' in node) continue;
          for (const c of node.choices) for (const a of c.do) if (a.type === 'warp') ships.set(map.id, [...(ships.get(map.id) ?? []), a]);
        }
      }
    }
    const seen = new Set<string>();
    const queue: Array<{ map: string; x: number; y: number }> = [{ map: START_MAP, ...content.maps.get(START_MAP)!.playerStart }];
    while (queue.length > 0) {
      const at = queue.shift()!;
      if (seen.has(at.map)) continue;
      seen.add(at.map);
      const map = content.maps.get(at.map)!;
      const grid = buildGrid(map);
      for (const portal of map.portals) {
        const path = findPath(grid, at, { x: portal.area.x, y: portal.area.y }, { maxNodes: 20_000 });
        expect(path, `${map.id}: portal to ${portal.to.map} unreachable`).not.toBeNull();
        queue.push(portal.to);
      }
      for (const to of ships.get(map.id) ?? []) queue.push(to);
      for (const npc of map.npcs) {
        const near = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: npc.x + dx, y: npc.y + dy }))).filter((t) => grid.isWalkable(t.x, t.y));
        expect(near.some((t) => findPath(grid, at, t, { maxNodes: 20_000 })), `${map.id}: ${npc.name} unreachable`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...content.maps.keys()].sort());
  });

  it('portals come in pairs, so you can always walk back', () => {
    for (const map of content.maps.values()) {
      for (const portal of map.portals) {
        const back = content.maps.get(portal.to.map)!.portals.some((p) => p.to.map === map.id);
        expect(back, `${map.id} → ${portal.to.map} has no way back`).toBe(true);
      }
    }
  });
});

describe('aggressive monsters', () => {
  it('Thornbeetles attack a player who walks close', () => {
    const map = content.maps.get('meadow-2')!;
    const w = new World(content, map, { seed: 9 });
    const beetle = [...w.monsters.values()].find((m) => m.def.id === 'thornbeetle')!;
    const hits: number[] = [];
    w.events.on('damage', (e) => e.targetId === 'player' && hits.push(e.amount));
    w.events.on('miss', (e) => e.targetId === 'player' && hits.push(0));
    w.changeMap(map.id, beetle.tile);
    for (let t = 0; t < 10_000 && hits.length === 0; t += TICK_MS) w.tick();
    expect(hits.length).toBeGreaterThan(0);
  });

  it('Jellops never start a fight', () => {
    const w = new World(content, content.maps.get('meadow-1')!, { seed: 9 });
    const jellop = [...w.monsters.values()][0]!;
    w.changeMap('meadow-1', jellop.tile);
    let hit = false;
    w.events.on('damage', (e) => (hit ||= e.targetId === 'player'));
    for (let t = 0; t < 10_000; t += TICK_MS) w.tick();
    expect(hit).toBe(false);
  });
});
