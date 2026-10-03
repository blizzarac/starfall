import { createMover } from '../core/entities';
import { derivedStats } from '../core/progression';
import type { World } from '../core/world';
import { SAVE_SCHEMA_VERSION, type SaveDoc } from './schema';

/** Snapshot of the player's state. Pure: reads the world, touches nothing. */
export function toSaveDoc(world: World, playtimeMs: number, now = Date.now()): SaveDoc {
  const p = world.player;
  // Save where the player will stand, so a mid-step save never lands between tiles.
  const at = p.next ?? p.tile;
  const d = derivedStats(p);
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: now,
    playtimeMs: Math.floor(playtimeMs),
    character: {
      name: p.name,
      jobName: p.jobName,
      baseLevel: p.baseLevel,
      jobLevel: p.jobLevel,
      maxJobLevel: p.maxJobLevel,
      baseXp: p.baseXp,
      jobXp: p.jobXp,
      stats: { ...p.stats },
      statPoints: p.statPoints,
      skillPoints: p.skillPoints,
      weapon: { ...p.weapon },
      // A save taken while fainted restores to full at the save point, matching respawn.
      hp: p.dead ? d.maxHp : p.hp,
      sp: p.dead ? d.maxSp : p.sp,
    },
    inventory: Object.fromEntries(p.inventory),
    storage: {},
    quests: {},
    flags: {},
    position: p.dead ? { map: world.map.id, ...p.savePoint } : { map: world.map.id, x: at.x, y: at.y },
    savePoint: { map: world.map.id, ...p.savePoint },
  };
}

/** Restores a save onto a freshly built world. Unknown items and bad positions fall back safely. */
export function applySaveDoc(world: World, doc: SaveDoc): void {
  const p = world.player;
  const c = doc.character;
  Object.assign(p, {
    name: c.name,
    jobName: c.jobName,
    baseLevel: c.baseLevel,
    jobLevel: c.jobLevel,
    maxJobLevel: c.maxJobLevel,
    baseXp: c.baseXp,
    jobXp: c.jobXp,
    stats: { ...c.stats },
    statPoints: c.statPoints,
    skillPoints: c.skillPoints,
    weapon: { ...c.weapon },
  });
  p.inventory = new Map(Object.entries(doc.inventory).filter(([id]) => world.content.items.has(id)));

  const onMap = (place: SaveDoc['position']) =>
    place.map === world.map.id && world.grid.isWalkable(place.x, place.y) ? { x: place.x, y: place.y } : null;
  p.savePoint = onMap(doc.savePoint) ?? { ...world.map.savePoint };
  Object.assign(p, createMover(onMap(doc.position) ?? p.savePoint, p.moveMs));

  const d = derivedStats(p);
  p.hp = Math.min(Math.max(1, c.hp), d.maxHp);
  p.sp = Math.min(c.sp, d.maxSp);
}
