import { createMover } from '../core/entities';
import { MAX_REFINE, type EquipSlot, type GearPiece } from '../core/equipment';
import type { ItemDef } from '../data/schemas';
import { JOBS } from '../core/jobs';
import { isSkillId } from '../core/skills';
import { buildGrid, START_MAP } from '../data/content';
import { derivedStats } from '../core/progression';
import type { World } from '../core/world';
import { SAVE_SCHEMA_VERSION, type SaveDoc, type SavedPiece } from './schema';

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
      jobId: p.jobId,
      baseLevel: p.baseLevel,
      jobLevel: p.jobLevel,
      skills: Object.fromEntries(p.skills),
      baseXp: p.baseXp,
      jobXp: p.jobXp,
      stats: { ...p.stats },
      statPoints: p.statPoints,
      skillPoints: p.skillPoints,
      equipment: Object.fromEntries(world.wornPieces().map(([slot, piece]) => [slot, savePiece(piece)])),
      // A save taken while fainted restores to full at the save point, matching respawn.
      hp: p.dead ? d.maxHp : p.hp,
      sp: p.dead ? d.maxSp : p.sp,
    },
    inventory: Object.fromEntries(p.inventory),
    gear: p.gear.map(savePiece),
    gold: p.gold,
    storage: {},
    quests: { active: Object.fromEntries(p.quests.active), done: Object.fromEntries(p.quests.done) },
    flags: Object.fromEntries(world.flags),
    position: p.dead ? { ...p.savePoint } : { map: world.map.id, x: at.x, y: at.y },
    savePoint: { ...p.savePoint },
  };
}

/** Restores a save onto a freshly built world. Unknown items and bad positions fall back safely. */
export function applySaveDoc(world: World, doc: SaveDoc): void {
  const p = world.player;
  const c = doc.character;
  Object.assign(p, {
    name: c.name,
    jobId: c.jobId,
    baseLevel: c.baseLevel,
    jobLevel: Math.min(c.jobLevel, JOBS[c.jobId].maxJobLevel),
    baseXp: c.baseXp,
    jobXp: c.jobXp,
    stats: { ...c.stats },
    statPoints: c.statPoints,
    skillPoints: c.skillPoints,
  });
  // Gear and cards that no longer exist in the game are dropped rather than failing the load.
  const items = world.content.items;
  const loadPiece = (s: SavedPiece): GearPiece | null => {
    const item = items.get(s.item);
    if (!item?.equip) return null;
    const cards = s.cards.map((id) => items.get(id)).filter((c): c is ItemDef => !!c?.card);
    return world.newPiece(item, Math.min(s.refine, MAX_REFINE), cards.slice(0, item.equip.slots));
  };
  p.equipment = {};
  for (const [slot, saved] of Object.entries(c.equipment)) {
    const piece = saved && loadPiece(saved);
    if (piece) p.equipment[slot as EquipSlot] = piece;
  }
  p.gear = doc.gear.map(loadPiece).filter((g): g is GearPiece => !!g);
  p.inventory = new Map();
  for (const [id, n] of Object.entries(doc.inventory)) {
    const item = items.get(id);
    if (!item) continue;
    // Older saves kept gear in the stackable inventory.
    if (item.equip) for (let i = 0; i < n; i++) p.gear.push(world.newPiece(item));
    else p.inventory.set(id, n);
  }
  p.gold = doc.gold;
  // Hunts that no longer exist are dropped.
  const known = (id: string) => world.content.quests.has(id);
  p.quests = {
    active: new Map(Object.entries(doc.quests.active).filter(([id]) => known(id))),
    done: new Map(Object.entries(doc.quests.done).filter(([id]) => known(id))),
  };
  world.restoreFlags(doc.flags);
  p.skills = new Map(Object.entries(c.skills).filter(([id]) => isSkillId(id)));

  // Places on maps that no longer exist, or tiles that are now blocked, fall back to safe spots.
  const valid = (place: SaveDoc['position']) => {
    const map = world.content.maps.get(place.map);
    return !!map && buildGrid(map).isWalkable(place.x, place.y);
  };
  const start = world.content.maps.get(START_MAP)!;
  p.savePoint = valid(doc.savePoint) ? { ...doc.savePoint } : { map: START_MAP, ...start.savePoint };
  // The world was built on the saved position's map when that map exists.
  const here = doc.position.map === world.map.id && valid(doc.position) ? doc.position : null;
  if (here) Object.assign(p, createMover(here, p.moveMs));
  else world.changeMap(p.savePoint.map, p.savePoint);

  const d = derivedStats(p);
  p.hp = Math.min(Math.max(1, c.hp), d.maxHp);
  p.sp = Math.min(c.sp, d.maxSp);
}

function savePiece(piece: GearPiece): SavedPiece {
  return { item: piece.item.id, refine: piece.refine, cards: piece.cards.map((c) => c.id) };
}
