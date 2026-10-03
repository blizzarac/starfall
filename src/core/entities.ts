import type { MonsterDef } from '../data/schemas';
import type { Stats } from './combat/formulas';
import type { Equipment, GearPiece } from './equipment';
import type { Tile } from './grid';
import type { JobId } from './jobs';
import type { Pet } from './pets';
import type { StatusId } from './status';

/** Tile-to-tile movement state shared by the player and monsters. */
/** A tile on a specific map. */
export interface Place {
  map: string;
  x: number;
  y: number;
}

export interface Mover {
  /** Last tile fully arrived at; the logical position for range checks. */
  tile: Tile;
  /** Tile currently being stepped into, if mid-step. */
  next: Tile | null;
  stepElapsed: number;
  stepDuration: number;
  path: Tile[];
  /** Destination the current path was computed toward. */
  goal: Tile | null;
  moveMs: number;
}

export interface Player extends Mover {
  id: 'player';
  name: string;
  baseLevel: number;
  jobLevel: number;
  jobId: JobId;
  /** Learned skill levels by skill id. */
  skills: Map<string, number>;
  /** Active timed buffs by skill id. */
  buffs: Map<string, { level: number; remainingMs: number; /** Remaining strength, for barriers. */ value?: number }>;
  /** Milliseconds until each skill can be used again. */
  cooldowns: Map<string, number>;
  /** Status effects and the time each has left. */
  statuses: Map<StatusId, { remainingMs: number; tickMs: number }>;
  /** Hunting quests: progress of active ones, and how often each was completed. */
  quests: { active: Map<string, number>; done: Map<string, number> };
  /** A spell being cast; taking damage or moving cancels it. */
  casting: { skillId: string; targetId: number; remainingMs: number; totalMs: number } | null;
  baseXp: number;
  jobXp: number;
  stats: Stats;
  statPoints: number;
  skillPoints: number;
  /** Equipped items by slot. Worn items are not in the inventory. */
  equipment: Equipment;
  hp: number;
  sp: number;
  sitting: boolean;
  dead: boolean;
  respawnIn: number;
  /** What the player is walking toward or attacking. */
  intent: PlayerIntent;
  attackCooldown: number;
  hpRegenTimer: number;
  spRegenTimer: number;
  /** Stackable items (potions, loot, cards) by item id. */
  inventory: Map<string, number>;
  /** Unequipped gear, one entry per piece. */
  gear: GearPiece[];
  gold: number;
  savePoint: Place;
  /** The tamed monster following the player, if any. */
  pet: Pet | null;
}

export type PlayerIntent =
  | { kind: 'none' }
  | { kind: 'move' }
  | { kind: 'attack'; targetId: number }
  | { kind: 'pickup'; dropId: number }
  | { kind: 'talk'; npcId: string }
  | { kind: 'skill'; skillId: string; targetId: number };

export type MonsterState = 'idle' | 'wander' | 'chase' | 'attack';

export interface Monster extends Mover {
  id: number;
  def: MonsterDef;
  spawnIndex: number;
  hp: number;
  state: MonsterState;
  stateTimer: number;
  /** True once the player has hit it or it has aggroed; it then hunts the player. */
  hostile: boolean;
  attackCooldown: number;
  /** Time until the next special attack. */
  specialTimer: number;
  /** A special attack being wound up: it lands on `tile` when the timer runs out. */
  windup: { remainingMs: number; tile: Tile } | null;
}

export interface GroundDrop {
  id: number;
  itemId: string;
  tile: Tile;
  expiresIn: number;
}

export function createMover(tile: Tile, moveMs: number): Mover {
  return { tile: { x: tile.x, y: tile.y }, next: null, stepElapsed: 0, stepDuration: 0, path: [], goal: null, moveMs };
}
