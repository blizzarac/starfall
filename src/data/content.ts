import { z } from 'zod';
import { ItemSchema, MapSchema, MonsterSchema, type ItemDef, type MapDef, type MonsterDef } from './schemas';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import meadowJson from './maps/meadow-1.json';

export interface Content {
  items: Map<string, ItemDef>;
  monsters: Map<string, MonsterDef>;
  maps: Map<string, MapDef>;
}

/** Parses raw JSON against the schemas and checks cross-references. Throws on any problem. */
export function buildContent(raw: { items: unknown; monsters: unknown; maps: unknown[] }): Content {
  const items = z.array(ItemSchema).parse(raw.items);
  const monsters = z.array(MonsterSchema).parse(raw.monsters);
  const maps = raw.maps.map((m) => MapSchema.parse(m));

  const byId = <T extends { id: string }>(list: T[], kind: string) => {
    const out = new Map<string, T>();
    for (const entry of list) {
      if (out.has(entry.id)) throw new Error(`Duplicate ${kind} id '${entry.id}'`);
      out.set(entry.id, entry);
    }
    return out;
  };
  const content: Content = {
    items: byId(items, 'item'),
    monsters: byId(monsters, 'monster'),
    maps: byId(maps, 'map'),
  };

  for (const m of monsters) {
    for (const d of m.drops) {
      if (!content.items.has(d.item)) throw new Error(`Monster '${m.id}' drops unknown item '${d.item}'`);
    }
  }
  for (const map of maps) {
    for (const s of map.spawns) {
      if (!content.monsters.has(s.monster)) throw new Error(`Map '${map.id}' spawns unknown monster '${s.monster}'`);
    }
  }
  return content;
}

export const RAW_CONTENT = { items: itemsJson, monsters: monstersJson, maps: [meadowJson] };

export function loadContent(): Content {
  return buildContent(RAW_CONTENT);
}
