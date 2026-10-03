import { buildGrid, type Content } from '../data/content';
import type { DialogueAction, ItemDef, MapDef, NpcDef, PortalDef } from '../data/schemas';
import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import type { GroundDrop, Monster, Mover, Player } from './entities';
import { createMover } from './entities';
import { Emitter } from './events';
import { Grid, sameTile, tileDistance, type Tile } from './grid';
import { findPath } from './pathfinding';
import { isJobId } from './jobs';
import { EQUIP_SLOTS, equipBlocker, slotFor, STARTING_GEAR, weaponOf, type EquipSlot } from './equipment';
import { applyDeathPenalty, changeJob, createPlayer, derivedStats, effectiveStats, gainXp, learnSkill, raiseStat } from './progression';
import * as S from './skills';
import type { Element } from './combat/formulas';
import { createRng, randInt, type Rng } from './rng';

export type EntityId = 'player' | number;

export interface WorldEvents extends Record<string, unknown> {
  damage: { sourceId: EntityId; targetId: EntityId; amount: number; crit: boolean };
  miss: { sourceId: EntityId; targetId: EntityId };
  heal: { hp: number; sp: number };
  monsterDied: { monsterId: number; tile: Tile };
  itemPicked: { item: ItemDef };
  itemUsed: { item: ItemDef };
  inventoryChanged: Record<string, never>;
  xpGained: { base: number; job: number };
  levelUp: { kind: 'base' | 'job'; level: number };
  playerDied: { xpLost: number };
  playerRespawned: Record<string, never>;
  /** The player reached an NPC; the UI opens its dialogue. */
  talk: { npc: NpcDef };
  skillUsed: { skillId: S.SkillId; targets: number[] };
  castInterrupted: Record<string, never>;
  skillsChanged: Record<string, never>;
  equipmentChanged: Record<string, never>;
  jobChanged: { jobId: string };
  /** The current map was swapped for another; scenes rebuild. */
  mapChanged: { mapId: string };
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
/** How far (tiles) a skill looks for a target when none is selected. */
const SKILL_AUTO_TARGET_RANGE = 8;
const PICKUP_RANGE = 1;
const CHASE_REPATH_MS = 300;

/**
 * The game simulation. Holds the player and the one map they're on; other maps
 * are not simulated. Knows nothing about rendering: scenes call the intent
 * methods and read state or listen to `events`.
 */
export class World {
  readonly player: Player;
  readonly monsters = new Map<number, Monster>();
  readonly drops = new Map<number, GroundDrop>();
  readonly events = new Emitter<WorldEvents>();
  readonly session: SessionStats = { kills: 0, baseXp: 0, jobXp: 0, lootValue: 0, deaths: 0 };
  /** Simulated milliseconds since the world was created. */
  time = 0;

  private currentMap!: MapDef;
  private currentGrid!: Grid;
  private nextId = 1;
  private respawns: Array<{ spawnIndex: number; at: number }> = [];
  private readonly rng: Rng;

  constructor(
    readonly content: Content,
    map: MapDef,
    opts: { seed?: number; playerName?: string } = {},
  ) {
    this.rng = createRng(opts.seed ?? Date.now());
    this.player = createPlayer(opts.playerName ?? 'Adventurer', map.playerStart);
    this.player.savePoint = { map: map.id, ...map.savePoint };
    for (const id of STARTING_GEAR) {
      const item = content.items.get(id);
      if (item?.equip) this.player.equipment[slotFor(this.player, item.equip)] = item;
    }
    this.loadMap(map);
  }

  get map(): MapDef {
    return this.currentMap;
  }

  get grid(): Grid {
    return this.currentGrid;
  }

  get npcs(): readonly NpcDef[] {
    return this.currentMap.npcs;
  }

  // ---- Intents -----------------------------------------------------------

  /** Walk to a tile. Returns false when the tile can't be reached. */
  moveTo(target: Tile): boolean {
    const p = this.player;
    if (p.dead) return false;
    if (!this.setPath(p, target)) return false;
    p.casting = null;
    p.intent = { kind: 'move' };
    p.sitting = false;
    return true;
  }

  attack(monsterId: number): void {
    const p = this.player;
    if (p.dead || !this.monsters.has(monsterId)) return;
    if (this.weightRatio() >= F.WEIGHT_NO_ATTACK) {
      this.events.emit('notice', { text: "You're carrying too much to fight. Sell or drop some items." });
      return;
    }
    p.intent = { kind: 'attack', targetId: monsterId };
    p.goal = null;
    p.sitting = false;
    p.casting = null;
  }

  pickUp(dropId: number): void {
    const p = this.player;
    const drop = this.drops.get(dropId);
    if (p.dead || !drop) return;
    p.intent = { kind: 'pickup', dropId };
    p.sitting = false;
    p.casting = null;
    if (tileDistance(p.tile, drop.tile) > PICKUP_RANGE || p.next) this.setPath(p, drop.tile);
  }

  talkTo(npcId: string): void {
    const p = this.player;
    const npc = this.npcs.find((n) => n.id === npcId);
    if (p.dead || !npc) return;
    p.sitting = false;
    p.casting = null;
    if (!p.next && tileDistance(p.tile, npc) <= F.TALK_RANGE) {
      p.intent = { kind: 'none' };
      p.path = [];
      this.events.emit('talk', { npc });
      return;
    }
    if (!this.setPathNear(p, npc)) {
      this.events.emit('notice', { text: `You can't reach ${npc.name}.` });
      return;
    }
    p.intent = { kind: 'talk', npcId };
  }

  toggleSit(): void {
    const p = this.player;
    if (p.dead) return;
    if (!p.sitting && (p.next || p.path.length > 0 || p.casting)) return;
    p.sitting = !p.sitting;
    p.intent = { kind: 'none' };
  }

  useItem(itemId: string): void {
    const p = this.player;
    const item = this.content.items.get(itemId);
    const count = p.inventory.get(itemId) ?? 0;
    if (p.dead || !item || item.type !== 'consumable' || count <= 0) return;
    if (item.heal) {
      const d = derivedStats(p);
      const boost = 1 + 0.1 * S.skillLevel(p, 'hp_recovery');
      const hp = Math.min(Math.floor(item.heal.hp * boost), d.maxHp - p.hp);
      const sp = Math.min(item.heal.sp, d.maxSp - p.sp);
      p.hp += hp;
      p.sp += sp;
      this.events.emit('heal', { hp, sp });
    }
    if (item.effect === 'teleport') {
      const tile = this.randomWalkableIn({ x: 0, y: 0, w: this.grid.width, h: this.grid.height });
      if (tile) this.placePlayer(tile);
    } else if (item.effect === 'return') {
      this.goToSavePoint();
    }
    this.removeItem(itemId, 1);
    this.events.emit('itemUsed', { item });
  }

  raiseStat(stat: StatName): boolean {
    return raiseStat(this.player, stat);
  }

  /** Spends a skill point. Returns why not, or null on success. */
  learnSkill(id: S.SkillId): string | null {
    const err = learnSkill(this.player, id);
    if (!err) this.events.emit('skillsChanged', {});
    return err;
  }

  /** Uses an active skill. Targeted skills walk into range first, picking the nearest monster if needed. */
  useSkill(id: string): void {
    const p = this.player;
    if (p.dead || !S.isSkillId(id)) return;
    const skill = S.SKILLS[id];
    const lv = S.skillLevel(p, id);
    if (lv === 0 || skill.kind === 'passive') return;
    const notice = (text: string) => this.events.emit('notice', { text });
    if (this.weightRatio() >= F.WEIGHT_NO_ATTACK) return notice("You're carrying too much to fight.");
    if ((p.cooldowns.get(id) ?? 0) > 0) return notice(`${skill.name} isn't ready yet.`);
    if (p.sp < skill.spCost(lv)) return notice('Not enough SP.');
    p.sitting = false;
    p.casting = null;
    if (skill.kind === 'enemy') {
      const target = this.skillTarget();
      if (!target) return notice('No monster nearby.');
      p.intent = { kind: 'skill', skillId: id, targetId: target.id };
      p.goal = null;
      return;
    }
    this.castSkill(id);
  }

  /** The monster being fought, or the closest one (hostile ones first). */
  private skillTarget(): Monster | null {
    const p = this.player;
    const current = p.intent.kind === 'attack' || p.intent.kind === 'skill' ? this.monsters.get(p.intent.targetId) : undefined;
    if (current) return current;
    let best: Monster | null = null;
    let bestScore = Infinity;
    for (const m of this.monsters.values()) {
      const d = tileDistance(p.tile, m.tile);
      if (d > Math.max(SKILL_AUTO_TARGET_RANGE, 9)) continue;
      const score = d - (m.hostile ? 100 : 0);
      if (score < bestScore) {
        best = m;
        bestScore = score;
      }
    }
    return best;
  }

  private castSkill(id: S.SkillId, target?: Monster): void {
    const p = this.player;
    const skill = S.SKILLS[id];
    const lv = S.skillLevel(p, id);
    p.sp -= skill.spCost(lv);
    if (skill.cooldownMs > 0) p.cooldowns.set(id, skill.cooldownMs);
    const hit: number[] = [];
    if (skill.magic && target) {
      hit.push(target.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      const d = derivedStats(p);
      const elem = F.elementModifier(skill.magic.element, target.def.element);
      for (let i = 0; i < skill.magic.hits(lv) && this.monsters.has(target.id); i++) {
        target.hostile = true;
        this.hurtMonster(target, F.magicDamage(d.matk, skill.magic.perHit, elem, target.def.def, this.rng), false);
      }
    } else if (id === 'bash' && target) {
      hit.push(target.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      this.playerHit(target, { modifier: S.bashModifier(lv), hitBonus: S.bashHitBonus(lv), element: 'neutral' });
    } else if (id === 'magnum_break') {
      for (const m of this.monsters.values()) if (tileDistance(p.tile, m.tile) <= S.MAGNUM_RADIUS) hit.push(m.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      for (const mid of hit) {
        const m = this.monsters.get(mid);
        if (m) this.playerHit(m, { modifier: S.magnumModifier(lv), hitBonus: S.MAGNUM_HIT_BONUS, element: 'fire' });
      }
    } else if (id === 'endure') {
      p.buffs.set('endure', { level: lv, remainingMs: S.endureDurationMs(lv) });
      this.events.emit('skillUsed', { skillId: id, targets: [] });
    }
  }

  // ---- Inventory and trade -----------------------------------------------

  /** Total weight carried, worn gear included. */
  weight(): number {
    let total = 0;
    for (const [id, n] of this.player.inventory) total += (this.content.items.get(id)?.weight ?? 0) * n;
    for (const item of Object.values(this.player.equipment)) total += item?.weight ?? 0;
    return total;
  }

  /** Wears an item from the inventory, putting back whatever it replaces. Returns why not, or null. */
  equip(itemId: string): string | null {
    const p = this.player;
    const item = this.content.items.get(itemId);
    if (!item?.equip || !this.hasItem(itemId, 1)) return "You don't have that.";
    const blocker = equipBlocker(p, item);
    if (blocker) return blocker;
    const slot = slotFor(p, item.equip);
    this.removeItem(itemId, 1);
    this.unequipQuiet(slot);
    // A two-handed weapon and a shield can't be held together.
    if (slot === 'weapon' && item.equip.twoHanded) this.unequipQuiet('shield');
    if (slot === 'shield' && p.equipment.weapon?.equip?.twoHanded) this.unequipQuiet('weapon');
    p.equipment[slot] = item;
    this.afterGearChange();
    return null;
  }

  unequip(slot: EquipSlot): void {
    if (!this.player.equipment[slot]) return;
    this.unequipQuiet(slot);
    this.afterGearChange();
  }

  private unequipQuiet(slot: EquipSlot): void {
    const old = this.player.equipment[slot];
    if (!old) return;
    delete this.player.equipment[slot];
    this.addItem(old.id, 1);
  }

  private afterGearChange(): void {
    const p = this.player;
    const d = derivedStats(p);
    p.hp = Math.min(p.hp, d.maxHp);
    p.sp = Math.min(p.sp, d.maxSp);
    this.events.emit('equipmentChanged', {});
  }

  /** Equipped item ids by slot, for saving. */
  equipmentIds(): Partial<Record<EquipSlot, string>> {
    const out: Partial<Record<EquipSlot, string>> = {};
    for (const slot of EQUIP_SLOTS) {
      const item = this.player.equipment[slot];
      if (item) out[slot] = item.id;
    }
    return out;
  }

  maxWeight(): number {
    return F.maxWeight(effectiveStats(this.player).str);
  }

  weightRatio(): number {
    return this.weight() / this.maxWeight();
  }

  /** Buys `count` of an item from a shop. Returns an error message, or null on success. */
  buy(shopId: string, itemId: string, count = 1): string | null {
    const shop = this.content.shops.get(shopId);
    const item = this.content.items.get(itemId);
    if (!shop || !item || !shop.items.includes(itemId) || count < 1) return "That's not for sale here.";
    const cost = item.price * count;
    if (cost > this.player.gold) return "You can't afford that.";
    if (this.weight() + item.weight * count > this.maxWeight()) return "You can't carry that much.";
    this.player.gold -= cost;
    this.addItem(itemId, count);
    return null;
  }

  /** Sells `count` of an item to any NPC. Returns an error message, or null on success. */
  sell(itemId: string, count = 1): string | null {
    const item = this.content.items.get(itemId);
    const have = this.player.inventory.get(itemId) ?? 0;
    if (!item || count < 1 || have < count) return "You don't have that many.";
    this.removeItem(itemId, count);
    this.player.gold += F.sellPrice(item.price) * count;
    return null;
  }

  /** Learned level of a skill; 0 if unknown. */
  skillLevel(skillId: string): number {
    return S.skillLevel(this.player, skillId);
  }

  hasItem(itemId: string, count: number): boolean {
    return (this.player.inventory.get(itemId) ?? 0) >= count;
  }

  addItem(itemId: string, count: number): void {
    const inv = this.player.inventory;
    inv.set(itemId, (inv.get(itemId) ?? 0) + count);
    this.events.emit('inventoryChanged', {});
  }

  removeItem(itemId: string, count: number): void {
    const inv = this.player.inventory;
    const left = (inv.get(itemId) ?? 0) - count;
    if (left > 0) inv.set(itemId, left);
    else inv.delete(itemId);
    this.events.emit('inventoryChanged', {});
  }

  // ---- NPC services ------------------------------------------------------

  /** Runs one dialogue action. Returns a shop id when the action opens a shop. */
  applyAction(action: DialogueAction): { openShop?: string } {
    const p = this.player;
    switch (action.type) {
      case 'setSavePoint':
        p.savePoint = { map: this.map.id, ...(p.next ?? p.tile) };
        return {};
      case 'heal': {
        const d = derivedStats(p);
        const hp = d.maxHp - p.hp;
        const sp = d.maxSp - p.sp;
        p.hp = d.maxHp;
        p.sp = d.maxSp;
        this.events.emit('heal', { hp, sp });
        return {};
      }
      case 'openShop':
        return { openShop: action.shop };
      case 'takeItem':
        this.removeItem(action.id, action.count);
        return {};
      case 'giveItem':
        this.addItem(action.id, action.count);
        return {};
      case 'changeJob': {
        const err = isJobId(action.job) ? changeJob(p, action.job) : 'Unknown job.';
        if (err) this.events.emit('notice', { text: err });
        else this.events.emit('jobChanged', { jobId: action.job });
        return {};
      }
    }
  }

  // ---- Maps --------------------------------------------------------------

  /** Moves the player to another map (or another spot on this one). */
  changeMap(mapId: string, tile: Tile): void {
    const map = this.content.maps.get(mapId);
    if (!map) return;
    if (map.id === this.map.id) {
      this.placePlayer(tile);
      return;
    }
    this.loadMap(map);
    this.placePlayer(tile);
    this.events.emit('mapChanged', { mapId });
  }

  private loadMap(map: MapDef): void {
    this.currentMap = map;
    this.currentGrid = buildGrid(map);
    this.monsters.clear();
    this.drops.clear();
    this.respawns = [];
    map.spawns.forEach((spawn, i) => {
      for (let n = 0; n < spawn.count; n++) this.spawnMonster(i);
    });
  }

  /** Puts the player on a tile, cancelling whatever they were doing. */
  private placePlayer(tile: Tile): void {
    const p = this.player;
    Object.assign(p, createMover(tile, p.moveMs));
    p.intent = { kind: 'none' };
    p.sitting = false;
    p.casting = null;
    for (const m of this.monsters.values()) m.hostile = false;
  }

  private goToSavePoint(): void {
    const sp = this.player.savePoint;
    this.changeMap(this.content.maps.has(sp.map) ? sp.map : this.map.id, { x: sp.x, y: sp.y });
  }

  portalAt(tile: Tile): PortalDef | undefined {
    return this.map.portals.find(
      (p) => tile.x >= p.area.x && tile.x < p.area.x + p.area.w && tile.y >= p.area.y && tile.y < p.area.y + p.area.h,
    );
  }

  // ---- Simulation --------------------------------------------------------

  /** Advances the simulation by one fixed tick. */
  tick(): void {
    const dt = F.TICK_MS;
    this.time += dt;
    const mapBefore = this.map;
    this.updatePlayer(dt);
    // A portal swapped the map mid-tick; the new map's monsters start fresh next tick.
    if (this.map !== mapBefore) return;
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
    this.tickTimers(p, dt);
    const intent = p.intent;

    if (intent.kind === 'attack' || intent.kind === 'skill') {
      const target = this.monsters.get(intent.targetId);
      if (!target) {
        p.intent = { kind: 'none' };
        p.path = [];
      } else if (intent.kind === 'skill' && p.casting) {
        // Once a cast starts the target may walk away; the spell still lands, as in the original.
        p.casting.remainingMs -= dt;
        if (p.casting.remainingMs <= 0) {
          p.casting = null;
          this.finishSkill(intent.skillId, target);
        }
      } else if (this.approach(p, target, dt, intent.kind === 'skill' ? this.skillRange(intent.skillId) : PLAYER_ATTACK_RANGE)) {
        if (intent.kind === 'skill' && S.isSkillId(intent.skillId)) {
          const skill = S.SKILLS[intent.skillId];
          const lv = S.skillLevel(p, intent.skillId);
          const cast = skill.castMs ? F.castTimeMs(skill.castMs(lv), effectiveStats(p).dex) : 0;
          if (p.sp < skill.spCost(lv)) {
            this.events.emit('notice', { text: 'Not enough SP.' });
            p.intent = { kind: 'none' };
          } else if (cast > 0) {
            p.casting = { skillId: intent.skillId, targetId: target.id, remainingMs: cast, totalMs: cast };
          } else {
            this.finishSkill(intent.skillId, target);
          }
        } else if (p.attackCooldown === 0) {
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
    } else if (intent.kind === 'talk') {
      const npc = this.npcs.find((n) => n.id === intent.npcId);
      const inRange = () => !!npc && tileDistance(p.tile, npc) <= F.TALK_RANGE;
      advance(p, dt, inRange);
      if (!p.next && (inRange() || p.path.length === 0)) {
        p.path = [];
        p.intent = { kind: 'none' };
        if (npc && inRange()) this.events.emit('talk', { npc });
      }
    } else {
      advance(p, dt, () => false);
      if (!p.next && p.path.length === 0) p.intent = { kind: 'none' };
    }

    const portal = this.portalAt(p.tile);
    if (portal) {
      this.changeMap(portal.to.map, { x: portal.to.x, y: portal.to.y });
      return;
    }
    this.regenerate(p, dt);
  }

  private skillRange(id: string): number {
    return S.isSkillId(id) ? (S.SKILLS[id].range ?? PLAYER_ATTACK_RANGE) : PLAYER_ATTACK_RANGE;
  }

  /** Fires a targeted skill whose cast (if any) has finished, then picks what to do next. */
  private finishSkill(id: string, target: Monster): void {
    const p = this.player;
    if (!S.isSkillId(id)) return;
    const skill = S.SKILLS[id];
    // Re-check SP: it may have dropped while walking over or casting.
    if (p.sp >= skill.spCost(S.skillLevel(p, id))) this.castSkill(id, target);
    else this.events.emit('notice', { text: 'Not enough SP.' });
    // Melee skills keep fighting with normal attacks; casters stay put for the next spell.
    p.intent = this.monsters.has(target.id) && !skill.magic ? { kind: 'attack', targetId: target.id } : { kind: 'none' };
  }

  /** Walks toward a monster until within `range` tiles. True once standing in range. */
  private approach(p: Player, target: Monster, dt: number, range = PLAYER_ATTACK_RANGE): boolean {
    const inRange = () => tileDistance(p.tile, target.tile) <= range;
    if (!p.next && inRange()) {
      p.path = [];
      return true;
    }
    const stale = !p.goal || !sameTile(p.goal, target.tile);
    if (stale && !this.setPath(p, target.tile)) {
      p.intent = { kind: 'none' };
      this.events.emit('notice', { text: 'Target is out of reach.' });
      return false;
    }
    advance(p, dt, inRange);
    return !p.next && inRange();
  }

  private tickTimers(p: Player, dt: number): void {
    for (const [id, ms] of p.cooldowns) {
      if (ms - dt <= 0) p.cooldowns.delete(id);
      else p.cooldowns.set(id, ms - dt);
    }
    for (const [id, buff] of p.buffs) {
      buff.remainingMs -= dt;
      if (buff.remainingMs <= 0) {
        p.buffs.delete(id);
        if (id === 'endure') this.events.emit('notice', { text: 'Endure wore off.' });
      }
    }
  }

  private regenerate(p: Player, dt: number): void {
    // A heavy bag stops natural recovery, which is what sends players back to town.
    if (this.weightRatio() >= F.WEIGHT_NO_REGEN) return;
    const d = derivedStats(p);
    p.hpRegenTimer += dt;
    if (p.hpRegenTimer >= F.hpRegenIntervalMs(p.sitting)) {
      p.hpRegenTimer = 0;
      const bonus = 2 * S.skillLevel(p, 'hp_recovery');
      p.hp = Math.min(d.maxHp, p.hp + F.hpRegenAmount(d.maxHp, effectiveStats(p).vit) + bonus);
    }
    p.spRegenTimer += dt;
    if (p.spRegenTimer >= F.spRegenIntervalMs(p.sitting)) {
      p.spRegenTimer = 0;
      p.sp = Math.min(d.maxSp, p.sp + F.spRegenAmount(d.maxSp, effectiveStats(p).int) + S.skillLevel(p, 'sp_recovery'));
    }
  }

  private playerAttack(target: Monster): void {
    this.player.attackCooldown = derivedStats(this.player).attackDelayMs;
    this.playerHit(target, { modifier: 1, hitBonus: 0, element: 'neutral', canCrit: true });
  }

  /** One hit from the player: normal attacks can crit, skills add damage and accuracy. */
  private playerHit(target: Monster, o: { modifier: number; hitBonus: number; element: Element; canCrit?: boolean }): void {
    const p = this.player;
    const d = derivedStats(p);
    target.hostile = true;
    const crit = !!o.canCrit && this.rng() < d.crit;
    if (!crit && this.rng() >= Math.min(0.95, F.hitChance(d.hit, target.def.flee) + o.hitBonus)) {
      this.events.emit('miss', { sourceId: 'player', targetId: target.id });
      return;
    }
    const amount = F.damage(
      {
        atk: d.atk,
        skillModifier: o.modifier,
        elementModifier: F.elementModifier(o.element, target.def.element),
        sizeModifier: F.sizeModifier(weaponOf(p).type, target.def.size),
        def: target.def.def,
        crit,
      },
      this.rng,
    );
    this.hurtMonster(target, amount, crit);
  }

  private hurtMonster(target: Monster, amount: number, crit: boolean): void {
    target.hp -= amount;
    target.hostile = true;
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
    if (this.weight() + item.weight > this.maxWeight()) {
      this.events.emit('notice', { text: "You can't carry any more. Sell something in town." });
      return;
    }
    this.drops.delete(drop.id);
    this.addItem(item.id, 1);
    this.session.lootValue += F.sellPrice(item.price);
    this.events.emit('itemPicked', { item });
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
    const raw = F.damage({ atk: randInt(this.rng, m.def.atk[0], m.def.atk[1]), def: d.def }, this.rng);
    const endure = p.buffs.get('endure');
    const amount = endure ? Math.max(1, Math.floor(raw * (1 - S.endureReduction(endure.level)))) : raw;
    p.hp -= amount;
    p.sitting = false;
    this.events.emit('damage', { sourceId: m.id, targetId: 'player', amount, crit: false });
    if (p.casting) {
      p.casting = null;
      p.intent = { kind: 'none' };
      this.events.emit('castInterrupted', {});
    }
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
    p.casting = null;
    p.buffs.clear();
    this.session.deaths += 1;
    const xpLost = applyDeathPenalty(p);
    for (const m of this.monsters.values()) m.hostile = false;
    this.events.emit('playerDied', { xpLost });
  }

  private respawnPlayer(): void {
    const p = this.player;
    const d = derivedStats(p);
    p.dead = false;
    p.hp = d.maxHp;
    p.sp = d.maxSp;
    p.attackCooldown = 0;
    this.goToSavePoint();
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
    for (let i = 0; i < 200; i++) {
      const x = area.x + randInt(this.rng, 0, area.w - 1);
      const y = area.y + randInt(this.rng, 0, area.h - 1);
      if (this.grid.isWalkable(x, y) && !this.portalAt({ x, y })) return { x, y };
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

  /** Paths to the closest reachable tile next to `target` (for NPCs, who block their own tile). */
  private setPathNear(m: Mover, target: Tile): boolean {
    const from = m.next ?? m.tile;
    const candidates: Tile[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = { x: target.x + dx, y: target.y + dy };
        if ((dx || dy) && this.grid.isWalkable(t.x, t.y)) candidates.push(t);
      }
    }
    candidates.sort((a, b) => tileDistance(from, a) - tileDistance(from, b));
    return candidates.some((t) => this.setPath(m, t));
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
