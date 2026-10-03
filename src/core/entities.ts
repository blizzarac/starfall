import type { MonsterDef } from '../data/schemas';
import type { Stats, WeaponType } from './combat/formulas';
import type { Tile } from './grid';

/** Tile-to-tile movement state shared by the player and monsters. */
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
  jobName: string;
  maxJobLevel: number;
  baseXp: number;
  jobXp: number;
  stats: Stats;
  statPoints: number;
  skillPoints: number;
  weapon: { type: WeaponType; atk: number };
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
  savePoint: Tile;
}

export type PlayerIntent =
  | { kind: 'none' }
  | { kind: 'move' }
  | { kind: 'attack'; targetId: number }
  | { kind: 'pickup'; dropId: number };

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
  return { tile: { ...tile }, next: null, stepElapsed: 0, stepDuration: 0, path: [], goal: null, moveMs };
}
