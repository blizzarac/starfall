import type { Content } from '../data/content';
import { TERRAIN_CHARS, type ItemDef, type MapDef } from '../data/schemas';
import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import type { GroundDrop, Monster, Mover, Player } from './entities';
import { createMover } from './entities';
import { Emitter } from './events';
import { Grid, sameTile, tileDistance, type Terrain, type Tile } from './grid';
import { findPath } from './pathfinding';
import { applyDeathPenalty, createPlayer, derivedStats, gainXp, raiseStat } from './progression';
import { createRng, randInt, type Rng } from './rng';

export type EntityId = 'player' | number;

export interface WorldEvents extends Record<string, unknown> {
  damage: { sourceId: EntityId; targetId: EntityId; amount: number; crit: boolean };
  miss: { sourceId: EntityId; targetId: EntityId };
  heal: { hp: number; sp: number };
  monsterDied: { monsterId: number; tile: Tile };
  itemPicked: { item: ItemDef };
  itemUsed: { item: ItemDef };
  xpGained: { base: number; job: number };
  levelUp: { kind: 'base' | 'job'; level: number };
  playerDied: { xpLost: number };
  playerRespawned: Record<string, never>;
  notice: { text: string };
}

/** Running totals for the debug overlay. */
export interface SessionStats {
  kills: number;
  baseXp: number;
  jobXp: number;
  /** Gold the picked-up loot would fetch from an NPC (50% of base price). */
  lootValue: number;
  deaths: number;
}

const PLAYER_ATTACK_RANGE = 1;
const PICKUP_RANGE = 1;
const CHASE_REPATH_MS = 300;

/**
 * The whole game simulation for one map. Knows nothing about rendering:
 * scenes call the intent methods and read state or listen to `events`.
 */
export class World {
  readonly grid: Grid;
  readonly player: Player;
  readonly monsters = new Map<number, Monster>();
  readonly drops = new Map<number, GroundDrop>();
  readonly events = new Emitter<WorldEvents>();
  readonly session: SessionStats = { kills: 0, baseXp: 0, jobXp: 0, lootValue: 0, deaths: 0 };
  /** Simulated milliseconds since the world was created. */
  time = 0;

  private nextId = 1;
  private respawns: Array<{ spawnIndex: number; at: number }> = [];
  private readonly rng: Rng;

  constructor(
    readonly content: Content,
    readonly map: MapDef,
    opts: { seed?: number; playerName?: string } = {},
  ) {
    this.rng = createRng(opts.seed ?? Date.now());
    const terrain: Terrain[] = map.rows.flatMap((row) =>
      [...row].map((ch) => TERRAIN_CHARS[ch as keyof typeof TERRAIN_CHARS]),
    );
    this.grid = new Grid(map.width, map.height, terrain);
    this.player = createPlayer(opts.playerName ?? 'Adventurer', map.playerStart);
    this.player.savePoint = { ...map.savePoint };
    map.spawns.forEach((spawn, i) => {
      for (let n = 0; n < spawn.count; n++) this.spawnMonster(i);
    });
  }

  // ---- Intents -----------------------------------------------------------

  /** Walk to a tile. Returns false when the tile can't be reached. */
  moveTo(target: Tile): boolean {
    const p = this.player;
    if (p.dead) return false;
    if (!this.setPath(p, target)) return false;
    p.intent = { kind: 'move' };
    p.sitting = false;
    return true;
  }

  attack(monsterId: number): void {
    const p = this.player;
    if (p.dead || !this.monsters.has(monsterId)) return;
    p.intent = { kind: 'attack', targetId: monsterId };
    p.goal = null;
    p.sitting = false;
  }

  pickUp(dropId: number): void {
    const p = this.player;
    const drop = this.drops.get(dropId);
    if (p.dead || !drop) return;
    p.intent = { kind: 'pickup', dropId };
    p.sitting = false;
    if (tileDistance(p.tile, drop.tile) > PICKUP_RANGE || p.next) this.setPath(p, drop.tile);
  }

  toggleSit(): void {
    const p = this.player;
    if (p.dead) return;
    if (!p.sitting && (p.next || p.path.length > 0)) return;
    p.sitting = !p.sitting;
    p.intent = { kind: 'none' };
  }

  useItem(itemId: string): void {
    const p = this.player;
    const item = this.content.items.get(itemId);
    const count = p.inventory.get(itemId) ?? 0;
    if (p.dead || !item?.heal || count <= 0) return;
    const d = derivedStats(p);
    const hp = Math.min(item.heal.hp, d.maxHp - p.hp);
    const sp = Math.min(item.heal.sp, d.maxSp - p.sp);
    p.hp += hp;
    p.sp += sp;
    this.removeItem(itemId);
    this.events.emit('itemUsed', { item });
    this.events.emit('heal', { hp, sp });
  }

  raiseStat(stat: StatName): boolean {
    return raiseStat(this.player, stat);
  }

  // ---- Simulation --------------------------------------------------------

  /** Advances the simulation by one fixed tick. */
  tick(): void {
    const dt = F.TICK_MS;
    this.time += dt;
    this.updatePlayer(dt);
    for (const m of [...this.monsters.values()]) this.updateMonster(m, dt);
    this.updateDrops(dt);
    this.updateRespawns();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (p.dead) {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0) this.respawnPlayer();
      return;
    }
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    const intent = p.intent;

    if (intent.kind === 'attack') {
      const target = this.monsters.get(intent.targetId);
      if (!target) {
        p.intent = { kind: 'none' };
        p.path = [];
      } else {
        const inRange = () => tileDistance(p.tile, target.tile) <= PLAYER_ATTACK_RANGE;
        if (!p.next && inRange()) {
          p.path = [];
        } else {
          const stale = !p.goal || !sameTile(p.goal, target.tile);
          if (stale && !this.setPath(p, target.tile)) {
            p.intent = { kind: 'none' };
            this.events.emit('notice', { text: 'Target is out of reach.' });
          }
          advance(p, dt, inRange);
        }
        if (p.intent.kind === 'attack' && !p.next && inRange() && p.attackCooldown === 0) {
          this.playerAttack(target);
        }
      }
    } else if (intent.kind === 'pickup') {
      const drop = this.drops.get(intent.dropId);
      if (!drop) {
        p.intent = { kind: 'none' };
      } else {
        const inRange = () => tileDistance(p.tile, drop.tile) <= PICKUP_RANGE;
        advance(p, dt, inRange);
        if (!p.next && inRange()) {
          p.path = [];
          p.intent = { kind: 'none' };
          this.collect(drop);
        } else if (!p.next && p.path.length === 0) {
          p.intent = { kind: 'none' };
        }
      }
    } else {
      advance(p, dt, () => false);
      if (!p.next && p.path.length === 0) p.intent = { kind: 'none' };
    }

    this.regenerate(p, dt);
  }

  private regenerate(p: Player, dt: number): void {
    const d = derivedStats(p);
    p.hpRegenTimer += dt;
    if (p.hpRegenTimer >= F.hpRegenIntervalMs(p.sitting)) {
      p.hpRegenTimer = 0;
      p.hp = Math.min(d.maxHp, p.hp + F.hpRegenAmount(d.maxHp, p.stats.vit));
    }
    p.spRegenTimer += dt;
    if (p.spRegenTimer >= F.spRegenIntervalMs(p.sitting)) {
      p.spRegenTimer = 0;
      p.sp = Math.min(d.maxSp, p.sp + F.spRegenAmount(d.maxSp, p.stats.int));
    }
  }

  private playerAttack(target: Monster): void {
    const p = this.player;
    const d = derivedStats(p);
    p.attackCooldown = d.attackDelayMs;
    target.hostile = true;

    const crit = this.rng() < d.crit;
    if (!crit && this.rng() >= F.hitChance(d.hit, target.def.flee)) {
      this.events.emit('miss', { sourceId: 'player', targetId: target.id });
      return;
    }
    const amount = F.damage(
      {
        atk: d.atk,
        elementModifier: F.elementModifier('neutral', target.def.element),
        sizeModifier: F.sizeModifier(p.weapon.type, target.def.size),
        def: target.def.def,
        crit,
      },
      this.rng,
    );
    target.hp -= amount;
    this.events.emit('damage', { sourceId: 'player', targetId: target.id, amount, crit });
    if (target.hp <= 0) this.killMonster(target);
  }

  private killMonster(m: Monster): void {
    const p = this.player;
    this.monsters.delete(m.id);
    this.respawns.push({ spawnIndex: m.spawnIndex, at: this.time + this.map.spawns[m.spawnIndex]!.respawnMs });
    this.events.emit('monsterDied', { monsterId: m.id, tile: { ...m.tile } });
    this.session.kills += 1;

    const ups = gainXp(p, m.def.baseXp, m.def.jobXp);
    this.session.baseXp += m.def.baseXp;
    this.session.jobXp += m.def.jobXp;
    this.events.emit('xpGained', { base: m.def.baseXp, job: m.def.jobXp });
    for (const level of ups.base) this.events.emit('levelUp', { kind: 'base', level });
    for (const level of ups.job) this.events.emit('levelUp', { kind: 'job', level });

    const spots = this.dropSpots(m.tile);
    let spot = 0;
    for (const drop of m.def.drops) {
      if (this.rng() >= drop.chance) continue;
      const tile = spots[spot++ % spots.length]!;
      const id = this.nextId++;
      this.drops.set(id, { id, itemId: drop.item, tile, expiresIn: F.DROP_LIFETIME_MS });
    }
  }

  /** The monster's tile, then walkable neighbors, so several drops don't stack. */
  private dropSpots(center: Tile): Tile[] {
    const spots: Tile[] = [{ ...center }];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.grid.isWalkable(center.x + dx, center.y + dy)) {
          spots.push({ x: center.x + dx, y: center.y + dy });
        }
      }
    }
    return spots;
  }

  private collect(drop: GroundDrop): void {
    const item = this.content.items.get(drop.itemId)!;
    this.drops.delete(drop.id);
    this.player.inventory.set(item.id, (this.player.inventory.get(item.id) ?? 0) + 1);
    this.session.lootValue += Math.floor(item.price / 2);
    this.events.emit('itemPicked', { item });
  }

  private removeItem(itemId: string): void {
    const inv = this.player.inventory;
    const left = (inv.get(itemId) ?? 0) - 1;
    if (left > 0) inv.set(itemId, left);
    else inv.delete(itemId);
  }

  private updateMonster(m: Monster, dt: number): void {
    const p = this.player;
    const ai = m.def.ai;
    m.attackCooldown = Math.max(0, m.attackCooldown - dt);
    m.stateTimer -= dt;
    const dist = tileDistance(m.tile, p.tile);

    if (p.dead) m.hostile = false;
    else if (!m.hostile && ai.aggressive && dist <= ai.aggroRange) m.hostile = true;
    if (m.hostile && dist > ai.chaseRange) {
      m.hostile = false;
      m.path = [];
      m.state = 'idle';
      m.stateTimer = 1000;
    }

    if (m.hostile) {
      const inRange = () => tileDistance(m.tile, p.tile) <= m.def.attackRange;
      if (!m.next && inRange()) {
        m.state = 'attack';
        m.path = [];
        if (m.attackCooldown === 0) this.monsterAttack(m);
        return;
      }
      m.state = 'chase';
      const stale = !m.goal || !sameTile(m.goal, p.tile);
      const stuck = !m.next && m.path.length === 0;
      if (stale && (stuck || m.stateTimer <= 0)) {
        this.setPath(m, p.tile, 400);
        m.stateTimer = CHASE_REPATH_MS;
      }
      advance(m, dt, inRange);
      return;
    }

    if (m.state === 'wander' || m.next) {
      advance(m, dt, () => false);
      if (!m.next && m.path.length === 0) {
        m.state = 'idle';
        m.stateTimer = randInt(this.rng, 2000, 6000);
      }
    } else {
      m.state = 'idle';
      if (m.stateTimer <= 0) {
        const r = ai.wanderRadius;
        const target = { x: m.tile.x + randInt(this.rng, -r, r), y: m.tile.y + randInt(this.rng, -r, r) };
        if (this.inSpawnArea(m.spawnIndex, target, r) && this.setPath(m, target, 200)) {
          m.state = 'wander';
        } else {
          m.stateTimer = randInt(this.rng, 500, 2000);
        }
      }
    }
  }

  private monsterAttack(m: Monster): void {
    const p = this.player;
    const d = derivedStats(p);
    m.attackCooldown = m.def.attackDelayMs;
    if (this.rng() >= F.hitChance(m.def.hit, d.flee)) {
      this.events.emit('miss', { sourceId: m.id, targetId: 'player' });
      return;
    }
    const amount = F.damage({ atk: randInt(this.rng, m.def.atk[0], m.def.atk[1]), def: d.def }, this.rng);
    p.hp -= amount;
    p.sitting = false;
    this.events.emit('damage', { sourceId: m.id, targetId: 'player', amount, crit: false });
    if (p.hp <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    p.respawnIn = F.PLAYER_RESPAWN_MS;
    p.intent = { kind: 'none' };
    p.path = [];
    p.next = null;
    p.sitting = false;
    this.session.deaths += 1;
    const xpLost = applyDeathPenalty(p);
    for (const m of this.monsters.values()) m.hostile = false;
    this.events.emit('playerDied', { xpLost });
  }

  private respawnPlayer(): void {
    const p = this.player;
    const d = derivedStats(p);
    Object.assign(p, createMover(p.savePoint, p.moveMs));
    p.dead = false;
    p.hp = d.maxHp;
    p.sp = d.maxSp;
    p.attackCooldown = 0;
    this.events.emit('playerRespawned', {});
  }

  private updateDrops(dt: number): void {
    for (const drop of this.drops.values()) {
      drop.expiresIn -= dt;
      if (drop.expiresIn <= 0) this.drops.delete(drop.id);
    }
  }

  private updateRespawns(): void {
    const due = this.respawns.filter((r) => r.at <= this.time);
    if (due.length === 0) return;
    this.respawns = this.respawns.filter((r) => r.at > this.time);
    for (const r of due) this.spawnMonster(r.spawnIndex);
  }

  private spawnMonster(spawnIndex: number): void {
    const spawn = this.map.spawns[spawnIndex]!;
    const def = this.content.monsters.get(spawn.monster)!;
    const tile = this.randomWalkableIn(spawn.area);
    if (!tile) return;
    const id = this.nextId++;
    this.monsters.set(id, {
      ...createMover(tile, def.moveMs),
      id,
      def,
      spawnIndex,
      hp: def.hp,
      state: 'idle',
      stateTimer: randInt(this.rng, 0, 4000),
      hostile: false,
      attackCooldown: 0,
    });
  }

  private randomWalkableIn(area: { x: number; y: number; w: number; h: number }): Tile | null {
    for (let i = 0; i < 100; i++) {
      const x = area.x + randInt(this.rng, 0, area.w - 1);
      const y = area.y + randInt(this.rng, 0, area.h - 1);
      if (this.grid.isWalkable(x, y)) return { x, y };
    }
    return null;
  }

  private inSpawnArea(spawnIndex: number, t: Tile, margin: number): boolean {
    const a = this.map.spawns[spawnIndex]!.area;
    return t.x >= a.x - margin && t.y >= a.y - margin && t.x < a.x + a.w + margin && t.y < a.y + a.h + margin;
  }

  /** Paths from wherever the mover will next stand. Leaves the mover untouched on failure. */
  private setPath(m: Mover, target: Tile, maxNodes?: number): boolean {
    const from = m.next ?? m.tile;
    const path = findPath(this.grid, from, target, { maxNodes });
    if (!path) return false;
    m.path = path;
    m.goal = { ...target };
    return true;
  }
}

/**
 * Moves along the path for `dt` ms. `shouldStop` is checked at every tile
 * boundary, so a mover stops cleanly on the first tile that satisfies it.
 */
export function advance(m: Mover, dt: number, shouldStop: () => boolean): void {
  let budget = dt;
  while (budget > 0) {
    if (!m.next) {
      if (m.path.length === 0 || shouldStop()) {
        if (m.path.length === 0) m.goal = null;
        return;
      }
      const n = m.path.shift()!;
      m.next = n;
      m.stepElapsed = 0;
      m.stepDuration = F.stepDurationMs(m.moveMs, n.x !== m.tile.x && n.y !== m.tile.y);
    }
    const need = m.stepDuration - m.stepElapsed;
    if (budget >= need) {
      budget -= need;
      m.tile = m.next;
      m.next = null;
      m.stepElapsed = 0;
    } else {
      m.stepElapsed += budget;
      budget = 0;
    }
  }
}

/** Interpolated tile-space position for rendering; `alpha` is progress into the next tick (0–1). */
export function renderPosition(m: Mover, alpha: number): { x: number; y: number } {
  if (!m.next) return { x: m.tile.x, y: m.tile.y };
  const t = Math.min(1, (m.stepElapsed + alpha * F.TICK_MS) / m.stepDuration);
  return { x: m.tile.x + (m.next.x - m.tile.x) * t, y: m.tile.y + (m.next.y - m.tile.y) * t };
}
