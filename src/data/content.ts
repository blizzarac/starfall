import { z } from 'zod';
import { Grid, type Terrain } from '../core/grid';
import { STARTING_GEAR } from '../core/equipment';
import { JOB_IDS } from '../core/jobs';
import { SKILL_IDS } from '../core/skills';
import { PET_FOOD, PET_SPECIES } from '../core/pets';
import {
  DialogueSchema,
  ItemSchema,
  MapSchema,
  MonsterSchema,
  ShopSchema,
  QuestSchema,
  TERRAIN_CHARS,
  type Condition,
  type DialogueDef,
  type ItemDef,
  type MapDef,
  type MonsterDef,
  type ShopDef,
  type QuestDef,
} from './schemas';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import dialoguesJson from './dialogues.json';
import shopsJson from './shops.json';
import questsJson from './quests.json';

const mapModules = import.meta.glob<{ default: unknown }>('./maps/*.json', { eager: true });

export interface Content {
  items: Map<string, ItemDef>;
  monsters: Map<string, MonsterDef>;
  maps: Map<string, MapDef>;
  dialogues: Map<string, DialogueDef>;
  shops: Map<string, ShopDef>;
  quests: Map<string, QuestDef>;
}

export interface RawContent {
  items: unknown;
  monsters: unknown;
  maps: unknown[];
  dialogues: unknown;
  shops: unknown;
  quests: unknown;
}

/** The map new characters start on and respawn to by default. */
export const START_MAP = 'town';

export function buildGrid(map: MapDef): Grid {
  const terrain: Terrain[] = map.rows.flatMap((row) => [...row].map((ch) => TERRAIN_CHARS[ch as keyof typeof TERRAIN_CHARS]));
  const grid = new Grid(map.width, map.height, terrain);
  for (const npc of map.npcs) grid.occupy(npc.x, npc.y);
  return grid;
}

/** Parses raw JSON against the schemas and checks every cross-reference. Throws on any problem. */
export function buildContent(raw: RawContent, knownJobs: ReadonlySet<string> = new Set()): Content {
  const byId = <T extends { id: string }>(list: T[], kind: string) => {
    const out = new Map<string, T>();
    for (const entry of list) {
      if (out.has(entry.id)) throw new Error(`Duplicate ${kind} id '${entry.id}'`);
      out.set(entry.id, entry);
    }
    return out;
  };
  const content: Content = {
    items: byId(z.array(ItemSchema).parse(raw.items), 'item'),
    monsters: byId(z.array(MonsterSchema).parse(raw.monsters), 'monster'),
    maps: byId(raw.maps.map((m) => MapSchema.parse(m)), 'map'),
    dialogues: byId(z.array(DialogueSchema).parse(raw.dialogues), 'dialogue'),
    shops: byId(z.array(ShopSchema).parse(raw.shops), 'shop'),
    quests: byId(z.array(QuestSchema).parse(raw.quests), 'quest'),
  };
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const needItem = (id: string, where: string) => content.items.has(id) || fail(`${where} refers to unknown item '${id}'`);

  for (const m of content.monsters.values()) for (const d of m.drops) needItem(d.item, `Monster '${m.id}' drop`);
  for (const item of content.items.values()) {
    if (item.tames && !content.monsters.has(item.tames)) fail(`Lure '${item.id}' tames unknown monster '${item.tames}'`);
    if (item.tames && !PET_SPECIES[item.tames]) fail(`Lure '${item.id}' tames '${item.tames}', which has no pet entry`);
  }
  for (const shop of content.shops.values()) for (const id of shop.items) needItem(id, `Shop '${shop.id}'`);
  for (const q of content.quests.values()) {
    if (!content.monsters.has(q.target.monster)) fail(`Quest '${q.id}' hunts unknown monster '${q.target.monster}'`);
    for (const it of q.reward.items) needItem(it.id, `Quest '${q.id}' reward`);
  }
  for (const id of STARTING_GEAR) {
    needItem(id, 'Starting gear');
    if (!content.items.get(id)!.equip) fail(`Starting gear '${id}' is not equipment`);
  }
  for (const item of content.items.values()) {
    for (const job of item.equip?.jobs ?? []) {
      if (knownJobs.size > 0 && !knownJobs.has(job)) fail(`Item '${item.id}' is limited to unknown job '${job}'`);
    }
  }

  needItem(PET_FOOD, 'Pet food');
  if (!content.maps.has(START_MAP)) fail(`Start map '${START_MAP}' is missing`);
  const grids = new Map([...content.maps.values()].map((m) => [m.id, buildGrid(m)]));
  const walkable = (map: string, x: number, y: number) => grids.get(map)?.isWalkable(x, y) ?? false;
  for (const map of content.maps.values()) {
    const where = `Map '${map.id}'`;
    if (!walkable(map.id, map.playerStart.x, map.playerStart.y)) fail(`${where} playerStart is not walkable`);
    if (!walkable(map.id, map.savePoint.x, map.savePoint.y)) fail(`${where} savePoint is not walkable`);
    for (const s of map.spawns) content.monsters.has(s.monster) || fail(`${where} spawns unknown monster '${s.monster}'`);
    for (const npc of map.npcs) content.dialogues.has(npc.dialogue) || fail(`${where} NPC '${npc.id}' has unknown dialogue '${npc.dialogue}'`);
    for (const p of map.portals) {
      if (!content.maps.has(p.to.map)) fail(`${where} portal leads to unknown map '${p.to.map}'`);
      if (!walkable(p.to.map, p.to.x, p.to.y)) fail(`${where} portal lands on a blocked tile in '${p.to.map}'`);
      const target = content.maps.get(p.to.map)!;
      const landsOnPortal = target.portals.some(
        (q) => p.to.x >= q.area.x && p.to.x < q.area.x + q.area.w && p.to.y >= q.area.y && p.to.y < q.area.y + q.area.h,
      );
      if (landsOnPortal) fail(`${where} portal lands on another portal in '${p.to.map}'`);
    }
  }

  const checkCondition = (c: Condition | undefined, where: string) => {
    if (!c) return;
    if (c.hasItem) needItem(c.hasItem.id, where);
    if (c.job && knownJobs.size > 0 && !knownJobs.has(c.job)) fail(`${where} checks unknown job '${c.job}'`);
    if (c.skillMin && !SKILL_IDS.has(c.skillMin.id)) fail(`${where} checks unknown skill '${c.skillMin.id}'`);
    for (const map of [c.visited, c.notMap]) if (map && !content.maps.has(map)) fail(`${where} checks unknown map '${map}'`);
  };
  for (const dlg of content.dialogues.values()) {
    for (const [nodeId, node] of Object.entries(dlg.nodes)) {
      const where = `Dialogue '${dlg.id}' node '${nodeId}'`;
      const needNode = (next: string | undefined) => !next || next in dlg.nodes || fail(`${where} goes to missing node '${next}'`);
      if ('branch' in node) {
        node.branch.forEach((b) => (checkCondition(b.if, where), needNode(b.next)));
        needNode(node.else);
        continue;
      }
      for (const choice of node.choices) {
        needNode(choice.next);
        checkCondition(choice.if, where);
        for (const a of choice.do) {
          if (a.type === 'openShop' && !content.shops.has(a.shop)) fail(`${where} opens unknown shop '${a.shop}'`);
          if (a.type === 'takeItem' || a.type === 'giveItem') needItem(a.id, where);
          if (a.type === 'changeJob' && knownJobs.size > 0 && !knownJobs.has(a.job)) fail(`${where} changes to unknown job '${a.job}'`);
          if (a.type === 'warp' && !walkable(a.map, a.x, a.y)) fail(`${where} warps to a blocked or unknown spot in '${a.map}'`);
        }
      }
    }
  }
  return content;
}

export const RAW_CONTENT: RawContent = {
  items: itemsJson,
  monsters: monstersJson,
  maps: Object.values(mapModules).map((m) => m.default),
  dialogues: dialoguesJson,
  shops: shopsJson,
  quests: questsJson,
};

export function loadContent(): Content {
  return buildContent(RAW_CONTENT, JOB_IDS);
}
