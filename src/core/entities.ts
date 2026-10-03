import type { MonsterDef } from '../data/schemas';
import type { Stats } from './combat/formulas';
import type { Equipment } from './equipment';
import type { Tile } from './grid';
import type { JobId } from './jobs';

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
  buffs: Map<string, { level: number; remainingMs: number }>;
  /** Milliseconds until each skill can be used again. */
  cooldowns: Map<string, number>;
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
  inventory: Map<string, number>;
  gold: number;
  savePoint: Place;
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
