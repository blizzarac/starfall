import { buildGrid, type Content } from '../data/content';
import type { DialogueAction, ItemDef, MapDef, MonsterDef, NpcDef, PortalDef } from '../data/schemas';
import * as F from './combat/formulas';
import type { StatName } from './combat/formulas';
import type { GroundDrop, Monster, Mover, Player } from './entities';
import { createMover, HOTBAR_SIZE } from './entities';
import { Emitter } from './events';
import { Grid, sameTile, tileDistance, type Tile } from './grid';
import { findPath } from './pathfinding';
import { isJobId, jobLineage, JOBS, type JobId } from './jobs';
import { cardBlocker, cardEffects, EQUIP_SLOTS, MAX_REFINE, equipBlocker, isPlain, slotFor, STARTING_GEAR, weaponOf, type EquipSlot, type GearPiece } from './equipment';
import { applyDeathPenalty, changeJob, createPlayer, derivedStats, effectiveStats, gainXp, learnSkill, raiseStat } from './progression';
import * as S from './skills';
import * as St from './status';
import * as Pets from './pets';
import { cleanAppearance, type Appearance } from './appearance';
import { bountyFor, MAX_ACTIVE_QUESTS, questState } from './quests';
import { checkCondition } from './dialogue';
import { BOSS_LINES, ENDINGS, FRAGMENTS, JOB_RELICS, PICKUP_FLAGS, SPLINTER, STORY, type Ending } from './story';
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
  skillUsed: { skillId: S.SkillId; targets: number[]; /** Center of an area skill. */ at?: Tile };
  castInterrupted: Record<string, never>;
  refined: { name: string; level: number; success: boolean };
  /** An area boss appeared on, or was defeated on, the current map. */
  boss: { kind: 'appeared' | 'defeated'; name: string };
  /** A monster is winding up an area attack: get out of the circle. */
  telegraph: { monsterId: number; tile: Tile; radius: number; ms: number };
  slam: { monsterId: number; tile: Tile; radius: number };
  /** Something was made at a tinkerer's bench. */
  crafted: { itemId: string; count: number };
  /** A boss entered a new phase (1 = the first change). */
  bossPhase: { monsterId: number; phase: number; shout: string };
  statusApplied: { status: St.StatusId };
  statusEnded: { status: St.StatusId };
  questProgress: { questId: string; progress: number; count: number };
  questReady: { questId: string; name: string };
  questCompleted: { questId: string; name: string };
  skillsChanged: Record<string, never>;
  equipmentChanged: Record<string, never>;
  jobChanged: { jobId: string };
  /** The current map was swapped for another; scenes rebuild. */
  mapChanged: { mapId: string };
  storageChanged: Record<string, never>;
  hotbarChanged: Record<string, never>;
  appearanceChanged: Record<string, never>;
  autoChanged: { on: boolean };
  petTamed: { name: string };
  tameFailed: { name: string };
  petFed: { delta: number };
  petRanAway: { name: string };
  /** The pet was renamed, released, replaced or changed gear. */
  petChanged: Record<string, never>;
  /** The pet bit a monster. */
  petAttack: { targetId: number; amount: number };
  /** Battle Aura (or Holy Aura, `holy`) burned a monster. */
  auraHit: { targetId: number; amount: number; holy?: boolean };
  bountyCollected: { gold: number };
  /** A line of story shown over the world for a few seconds. */
  storyLine: { text: string };
  /** A story flag changed: story characters may have come or gone. */
  storyChanged: Record<string, never>;
  /** The main story ended. */
  storyEnded: { ending: Ending; title: string };
  /** Holy Aura just weakened a monster's DEF. */
  weakened: { targetId: number };
  petLevelUp: { name: string; level: number };
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
/** Auto mode looks this far (tiles) for monsters, and this far for loot. */
const AUTO_RANGE = 10;
const AUTO_LOOT_RANGE = 5;
/** A hit at least this share of max HP interrupts a cast. */
export const CAST_BREAK_SHARE = 0.1;

/** Shared storage: one stash for every character, kept outside the save slots. */
export interface Storage {
  items: Map<string, number>;
  gear: GearPiece[];
}

/** Different items (stacks plus gear pieces) the storage can hold. */
export const STORAGE_CAPACITY = 100;

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
  /** Saved key/value state: boss respawn times, quest flags. */
  readonly flags = new Map<string, string | number | boolean>();
  /** Auto mode: fight the nearest monster and pick up loot until switched off. */
  auto = false;
  /** After a manual move, Auto waits this long (ms) before taking over again. */
  private autoPauseMs = 0;
  /** Where the pet stands; null without a pet. Not saved: it reappears next to the player. */
  petMover: Mover | null = null;
  private petHungerMs = 0;
  private petAttackMs = 0;
  private auraMs = 0;
  /** Story lines already shown for a monster (by id and kind), so each plays once. */
  private storyLinesShown = new Set<string>();
  private holyAuraMs = 0;
  /** Drops the pet couldn't pick up (too heavy), so it doesn't keep trying. */
  private petSkips = new Set<number>();

  /** The shared stash; the save manager loads and saves it alongside the slot. */
  readonly storage: Storage = { items: new Map(), gear: [] };

  private currentMap!: MapDef;
  private currentGrid!: Grid;
  private nextId = 1;
  private nextGearUid = 1;
  private respawns: Array<{ spawnIndex: number; at: number }> = [];
  /** Bosses waiting to respawn, by wall-clock time so the wait survives leaving the map or the game. */
  private bossWaits: Array<{ spawnIndex: number; at: number }> = [];
  private readonly rng: Rng;
  /** Wall clock in ms; injectable so tests can fast-forward boss timers. */
  readonly now: () => number;

  constructor(
    readonly content: Content,
    map: MapDef,
    opts: { seed?: number; playerName?: string; now?: () => number } = {},
  ) {
    this.rng = createRng(opts.seed ?? Date.now());
    this.now = opts.now ?? (() => Date.now());
    this.player = createPlayer(opts.playerName ?? 'Adventurer', map.playerStart);
    this.player.savePoint = { map: map.id, ...map.savePoint };
    for (const id of STARTING_GEAR) {
      const item = content.items.get(id);
      if (item?.equip) this.player.equipment[slotFor(this.player, item.equip)] = this.newPiece(item);
    }
    this.loadMap(map);
  }

  get map(): MapDef {
    return this.currentMap;
  }

  get grid(): Grid {
    return this.currentGrid;
  }

  /** The people and things on this map right now (story characters come and go with the story). */
  get npcs(): readonly NpcDef[] {
    return this.currentMap.npcs.filter((n) => checkCondition(this, n.if));
  }

  // ---- Intents -----------------------------------------------------------

  /** Walk to a tile. Returns false when the tile can't be reached. */
  moveTo(target: Tile): boolean {
    const p = this.player;
    if (p.dead || this.stunned()) return false;
    if (!this.setPath(p, target)) return false;
    p.casting = null;
    p.intent = { kind: 'move' };
    p.sitting = false;
    return true;
  }

  attack(monsterId: number): void {
    const p = this.player;
    if (p.dead || this.stunned() || !this.monsters.has(monsterId)) return;
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
    if (p.dead || this.stunned() || !drop) return;
    p.intent = { kind: 'pickup', dropId };
    p.sitting = false;
    p.casting = null;
    if (tileDistance(p.tile, drop.tile) > PICKUP_RANGE || p.next) this.setPath(p, drop.tile);
  }

  talkTo(npcId: string): void {
    const p = this.player;
    const npc = this.npcs.find((n) => n.id === npcId);
    if (p.dead || this.stunned() || !npc) return;
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
    if (p.dead || this.stunned()) return;
    if (!p.sitting && (p.next || p.path.length > 0 || p.casting)) return;
    p.sitting = !p.sitting;
    p.intent = { kind: 'none' };
  }

  useItem(itemId: string): void {
    const p = this.player;
    const item = this.content.items.get(itemId);
    const count = p.inventory.get(itemId) ?? 0;
    if (p.dead || !item || item.type !== 'consumable' || count <= 0) return;
    if (item.effect === 'tame') return this.tame(item);
    if (item.heal) {
      const d = derivedStats(p);
      const boost = 1 + 0.1 * S.skillLevel(p, 'hp_recovery');
      const hp = Math.min(Math.floor(item.heal.hp * boost), d.maxHp - p.hp);
      const sp = Math.min(item.heal.sp, d.maxSp - p.sp);
      p.hp += hp;
      p.sp += sp;
      this.events.emit('heal', { hp, sp });
    }
    if (item.cure) this.cure(item.cure);
    if (item.effect === 'teleport') {
      const tile = this.randomWalkableIn({ x: 0, y: 0, w: this.grid.width, h: this.grid.height });
      if (tile) this.placePlayer(tile);
    } else if (item.effect === 'return') {
      this.goToSavePoint();
    }
    this.removeItem(itemId, 1);
    this.events.emit('itemUsed', { item });
  }

  // ---- Quick bar, potions and Auto ------------------------------------------

  /** Changes how the character looks (free, any time). */
  setAppearance(a: Appearance): void {
    this.player.appearance = cleanAppearance(a);
    this.events.emit('appearanceChanged', {});
  }

  /** Adds or removes a skill or consumable on the quick bar. Returns why not, or null. */
  toggleHotbar(id: string): string | null {
    const bar = this.player.hotbar;
    const at = bar.indexOf(id);
    if (at >= 0) {
      bar.splice(at, 1);
    } else {
      const item = this.content.items.get(id);
      const ok = (S.isSkillId(id) && S.SKILLS[id].kind !== 'passive' && this.skillLevel(id) > 0) || item?.type === 'consumable';
      if (!ok) return "That can't go on the bar.";
      if (bar.length >= HOTBAR_SIZE) return `The bar holds ${HOTBAR_SIZE}. Remove something first.`;
      bar.push(id);
    }
    this.events.emit('hotbarChanged', {});
    return null;
  }

  /** Moves a quick-bar entry one place left (-1) or right (+1). */
  moveHotbar(id: string, dir: -1 | 1): void {
    const bar = this.player.hotbar;
    const i = bar.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= bar.length) return;
    [bar[i], bar[j]] = [bar[j]!, bar[i]!];
    this.events.emit('hotbarChanged', {});
  }

  /** Uses quick-bar slot `i`. */
  useHotbar(i: number): void {
    const id = this.player.hotbar[i];
    if (!id) return;
    if (S.isSkillId(id)) this.useSkill(id);
    else this.useItem(id);
  }

  /** HP potions the player carries, weakest first. */
  hpPotions(): ItemDef[] {
    return [...this.player.inventory.keys()]
      .map((id) => this.content.items.get(id)!)
      .filter((it) => it.type === 'consumable' && (it.heal?.hp ?? 0) > 0 && !it.effect)
      .sort((a, b) => a.heal!.hp - b.heal!.hp);
  }

  /** Drinks the smallest potion that covers the missing HP, or the biggest one. */
  useBestPotion(): void {
    const p = this.player;
    const missing = derivedStats(p).maxHp - p.hp;
    const pots = this.hpPotions();
    if (pots.length === 0) return void this.events.emit('notice', { text: 'No HP potions left.' });
    const pick = pots.find((it) => it.heal!.hp >= missing) ?? pots[pots.length - 1]!;
    this.useItem(pick.id);
  }

  setAuto(on: boolean): void {
    this.auto = on;
    this.autoPauseMs = 0;
    this.events.emit('autoChanged', { on });
  }

  private updateAuto(dt: number): void {
    const p = this.player;
    if (!this.auto || p.dead || p.casting || this.stunned()) return;
    // A manual move takes over; Auto resumes a moment after arriving.
    if (p.intent.kind === 'move' || p.intent.kind === 'talk') {
      this.autoPauseMs = 1500;
      return;
    }
    if (p.sitting) return;
    this.autoPauseMs -= dt;
    if (this.autoPauseMs > 0) return;
    const d = derivedStats(p);
    if (p.hp < d.maxHp * 0.35) {
      if (this.hpPotions().length > 0) this.useBestPotion();
      else {
        this.setAuto(false);
        this.events.emit('notice', { text: 'Auto stopped: HP is low and you have no potions.' });
        return;
      }
    }
    if (this.weightRatio() >= F.WEIGHT_NO_ATTACK) {
      this.setAuto(false);
      this.events.emit('notice', { text: 'Auto stopped: your bag is too heavy.' });
      return;
    }
    // Mid-fight: work in skills between basic attacks.
    if (p.intent.kind === 'attack') {
      const target = this.monsters.get(p.intent.targetId);
      if (target) this.autoSkill(target);
      return;
    }
    if (p.intent.kind !== 'none') return;
    const fighting = [...this.monsters.values()].some((m) => m.hostile && tileDistance(m.tile, p.tile) <= 2);
    if (!fighting) {
      let drop: GroundDrop | null = null;
      for (const dr of this.drops.values()) {
        if (tileDistance(dr.tile, p.tile) > AUTO_LOOT_RANGE) continue;
        if (this.weight() + (this.content.items.get(dr.itemId)?.weight ?? 0) > this.maxWeight()) continue;
        if (!drop || tileDistance(dr.tile, p.tile) < tileDistance(drop.tile, p.tile)) drop = dr;
      }
      if (drop) return this.pickUp(drop.id);
    }
    let best: Monster | null = null;
    let score = Infinity;
    for (const m of this.monsters.values()) {
      const dist = tileDistance(m.tile, p.tile);
      if (dist > AUTO_RANGE) continue;
      const s = dist - (m.hostile ? 100 : 0);
      if (s < score) {
        best = m;
        score = s;
      }
    }
    if (!best) return;
    this.attack(best.id);
    // Open with a skill if one fits (a mage starts with a bolt from range).
    this.autoSkill(best);
  }

  /** Skills Auto may use: what's on your quick bar, in its order; everything you know if the bar has none. */
  private autoSkills(): S.SkillId[] {
    const p = this.player;
    const usable = (id: string): id is S.SkillId => S.isSkillId(id) && S.SKILLS[id].kind !== 'passive' && S.skillLevel(p, id) > 0;
    const bar = p.hotbar.filter(usable);
    return bar.length > 0 ? bar : [...p.skills.keys()].filter(usable);
  }

  /**
   * Uses the first skill that makes sense right now: a heal when hurt, a buff
   * that has run out, then attack skills the target doesn't shrug off. Keeps a
   * little SP back for healing. Returns true when it used one.
   */
  private autoSkill(target: Monster): boolean {
    const p = this.player;
    const d = derivedStats(p);
    const weapon = weaponOf(p);
    const twoHanded = !!p.equipment.weapon?.item.equip?.twoHanded;
    const healLv = S.skillLevel(p, 'heal');
    // SP kept back so a healer can always heal.
    const reserve = healLv > 0 ? S.SKILLS.heal.spCost(healLv) : Math.round(d.maxSp * 0.1);
    for (const id of this.autoSkills()) {
      const skill = S.SKILLS[id];
      const lv = S.skillLevel(p, id);
      const cost = skill.spCost(lv);
      if ((p.cooldowns.get(id) ?? 0) > 0 || p.sp < cost) continue;
      if (skill.needsWeapon && weapon.type !== skill.needsWeapon) continue;
      if (skill.needsTwoHanded && !twoHanded) continue;
      if (skill.kind === 'self') {
        if (id === 'heal') {
          if (p.hp >= d.maxHp * 0.6) continue;
        } else if (!skill.buffMs || p.buffs.has(id)) continue;
      } else {
        if (p.sp - cost < reserve) continue;
        if (skill.magic?.only && !skill.magic.only.includes(target.def.element)) continue;
        if (skill.magic && F.elementModifier(skill.magic.element, target.def.element) < 1) continue;
        // Area skills around you need something in reach.
        if (skill.kind === 'area' && skill.area?.around === 'self' && ![...this.monsters.values()].some((m) => tileDistance(m.tile, p.tile) <= skill.area!.radius)) continue;
      }
      this.useSkill(id);
      return true;
    }
    return false;
  }

  // ---- Pets ------------------------------------------------------------------

  /** Throws a lure at the nearest monster it works on. Fails without using it if none is near. */
  private tame(lure: ItemDef): void {
    const p = this.player;
    const notice = (text: string) => this.events.emit('notice', { text });
    const def = this.content.monsters.get(lure.tames ?? '');
    if (!def) return;
    if (p.pet) return notice('You already have a pet. Release it first (tap your pet).');
    let target: Monster | null = null;
    for (const m of this.monsters.values()) {
      if (m.def.id !== def.id || tileDistance(m.tile, p.tile) > 6) continue;
      if (!target || tileDistance(m.tile, p.tile) < tileDistance(target.tile, p.tile)) target = m;
    }
    if (!target) return notice(`No ${def.name} close enough. Get within 6 tiles.`);
    this.removeItem(lure.id, 1);
    this.events.emit('itemUsed', { item: lure });
    if (this.rng() >= Pets.tameChance(target.hp, def.hp)) {
      target.hostile = true;
      this.events.emit('tameFailed', { name: def.name });
      return;
    }
    // The tamed monster leaves the map; a wild one respawns as usual, with no loot or XP.
    this.monsters.delete(target.id);
    this.respawns.push({ spawnIndex: target.spawnIndex, at: this.time + this.map.spawns[target.spawnIndex]!.respawnMs });
    this.events.emit('monsterDied', { monsterId: target.id, tile: { ...target.tile } });
    p.pet = Pets.newPet(def.id, def.name);
    this.petMover = createMover(target.tile, F.PLAYER_MOVE_MS);
    this.petHungerMs = 0;
    this.refreshStats();
    this.events.emit('petTamed', { name: def.name });
  }

  /** Feeds the pet a treat. Returns why not, or null. */
  feedPet(): string | null {
    const pet = this.player.pet;
    if (!pet) return "You don't have a pet.";
    if (!this.hasItem(Pets.PET_FOOD, 1)) return `You need a ${this.content.items.get(Pets.PET_FOOD)?.name ?? 'treat'}.`;
    this.removeItem(Pets.PET_FOOD, 1);
    const delta = Pets.feed(pet);
    // A friendship charm makes treats count for more too.
    if (delta > 0) pet.intimacy = Math.min(Pets.MAX_INTIMACY, pet.intimacy + Math.round(delta * (Pets.petGear(pet).friendship ?? 0)));
    this.refreshStats();
    this.events.emit('petFed', { delta });
    return null;
  }

  /** Raises (or lowers) friendship; gains grow with a friendship charm. */
  private addIntimacy(amount: number): void {
    const pet = this.player.pet;
    if (!pet || amount === 0) return;
    const gain = amount > 0 ? amount * (1 + (Pets.petGear(pet).friendship ?? 0)) : amount;
    const before = Pets.bonusFactor(pet.intimacy);
    pet.intimacy = Math.max(0, Math.min(Pets.MAX_INTIMACY, Math.round(pet.intimacy + gain)));
    if (Pets.bonusFactor(pet.intimacy) !== before) this.refreshStats();
  }

  /** A monster fell with the pet out: it learns from the fight and grows fonder of you. */
  private rewardPet(baseXp: number): void {
    const pet = this.player.pet;
    if (!pet || !this.petMover) return;
    const levels = Pets.gainPetXp(pet, baseXp * (1 + (Pets.petGear(pet).xp ?? 0)));
    if (Pets.appetite(pet.hunger) !== 'Starving') this.addIntimacy(Pets.KILL_INTIMACY);
    if (levels > 0) {
      this.addIntimacy(Pets.LEVEL_INTIMACY * levels);
      this.refreshStats();
      this.events.emit('petLevelUp', { name: pet.name, level: pet.level });
    }
  }

  /** Puts a collar or charm from the bag on the pet; whatever it wore goes back in the bag. */
  equipPetGear(itemId: string): string | null {
    const pet = this.player.pet;
    const item = this.content.items.get(itemId);
    if (!pet) return "You don't have a pet.";
    if (!item?.petGear || !this.hasItem(itemId, 1)) return "You don't have that.";
    this.removeItem(itemId, 1);
    if (pet.gear) this.addItem(pet.gear.id, 1);
    pet.gear = item;
    this.refreshStats();
    this.events.emit('petChanged', {});
    return null;
  }

  /** Takes the pet's collar or charm back into the bag. */
  unequipPetGear(): void {
    const pet = this.player.pet;
    if (!pet?.gear) return;
    this.addItem(pet.gear.id, 1);
    pet.gear = null;
    this.refreshStats();
    this.events.emit('petChanged', {});
  }

  renamePet(name: string): void {
    const pet = this.player.pet;
    const clean = name.trim().slice(0, 16);
    if (!pet || !clean) return;
    pet.name = clean;
    this.events.emit('petChanged', {});
  }

  /** Lets the pet go for good. */
  releasePet(): void {
    if (!this.player.pet) return;
    // It leaves its collar behind.
    if (this.player.pet.gear) this.addItem(this.player.pet.gear.id, 1);
    this.player.pet = null;
    this.petMover = null;
    this.refreshStats();
    this.events.emit('petChanged', {});
  }

  /** Puts the pet next to the player (after loading, teleporting or changing maps). */
  private placePet(): void {
    if (!this.player.pet) {
      this.petMover = null;
      return;
    }
    const p = this.player.tile;
    const spot = this.dropSpots(p).find((t) => !sameTile(t, p)) ?? p;
    this.petMover = createMover(spot, F.PLAYER_MOVE_MS);
    this.petSkips.clear();
  }

  private updatePet(dt: number): void {
    const p = this.player;
    const pet = p.pet;
    if (!pet) return;
    if (!this.petMover) this.placePet();
    const mover = this.petMover!;

    this.petHungerMs += dt * (1 - (Pets.petGear(pet).appetite ?? 0));
    while (this.petHungerMs >= Pets.HUNGER_TICK_MS) {
      this.petHungerMs -= Pets.HUNGER_TICK_MS;
      pet.hunger = Math.max(0, pet.hunger - 1);
      if (Pets.appetite(pet.hunger) === 'Starving') this.addIntimacy(-Pets.STARVING_LOSS);
      if (pet.hunger === 25) this.events.emit('notice', { text: `${pet.name} is hungry. Feed it a Pet Treat.` });
      if (pet.intimacy === 0) {
        const name = pet.name;
        this.releasePet();
        this.events.emit('petRanAway', { name });
        return;
      }
    }
    this.petBite(dt);

    // Looters fetch nearby drops; everyone else (and looters with nothing to do) follows.
    const species = Pets.PET_SPECIES[pet.species];
    if (species?.loots && !p.dead && !mover.next) {
      let best: GroundDrop | null = null;
      for (const d of this.drops.values()) {
        if (this.petSkips.has(d.id) || tileDistance(d.tile, p.tile) > Pets.PET_LOOT_RANGE + (Pets.petGear(pet).lootRange ?? 0)) continue;
        if (!best || tileDistance(d.tile, mover.tile) < tileDistance(best.tile, mover.tile)) best = d;
      }
      if (best) {
        if (sameTile(mover.tile, best.tile)) {
          const item = this.content.items.get(best.itemId)!;
          if (this.weight() + item.weight > this.maxWeight()) this.petSkips.add(best.id);
          else this.collect(best);
        } else if (!mover.goal || !sameTile(mover.goal, best.tile)) {
          if (!this.setPath(mover, best.tile, 300)) this.petSkips.add(best.id);
        }
        advance(mover, dt, () => false);
        return;
      }
    }
    const dist = tileDistance(mover.tile, p.tile);
    if (dist > 12) {
      this.placePet();
      return;
    }
    const target = p.next ?? p.tile;
    if (dist > 2 && !mover.next && (!mover.goal || tileDistance(mover.goal, target) > 1)) this.setPathNear(mover, target);
    advance(mover, dt, () => tileDistance(mover.tile, target) <= 1);
  }

  /**
   * Battle Aura: every second, burns the monsters that are attacking the player
   * up close. Passive monsters you walk past are left alone.
   */
  private updateAura(dt: number): void {
    const p = this.player;
    const lv = S.skillLevel(p, 'battle_aura');
    if (lv === 0 || p.dead) return;
    this.auraMs -= dt;
    if (this.auraMs > 0) return;
    this.auraMs = S.AURA_TICK_MS;
    const radius = S.auraRadius(lv);
    const atk = derivedStats(p).atk * (S.auraPercent(lv) / 100);
    for (const m of [...this.monsters.values()]) {
      if (!m.hostile || tileDistance(m.tile, p.tile) > radius) continue;
      this.hurtMonster(m, F.damage({ atk, def: this.monsterDef(m) }, this.rng), false, 'aura');
    }
  }

  /** Holy Aura: a little holy damage each second, and the DEF of everything it touches drops for a while. */
  private updateHolyAura(dt: number): void {
    const p = this.player;
    const lv = S.skillLevel(p, 'holy_aura');
    if (lv === 0 || p.dead) return;
    this.holyAuraMs -= dt;
    if (this.holyAuraMs > 0) return;
    this.holyAuraMs = S.AURA_TICK_MS;
    const radius = S.auraRadius(lv);
    const atk = derivedStats(p).atk * (S.holyAuraPercent(lv) / 100);
    for (const m of [...this.monsters.values()]) {
      if (!m.hostile || tileDistance(m.tile, p.tile) > radius) continue;
      const fresh = !m.weakened || m.weakened.until <= this.time;
      m.weakened = { share: S.holyAuraDefCut(lv), until: this.time + S.HOLY_WEAKEN_MS };
      if (fresh) this.events.emit('weakened', { targetId: m.id });
      const amount = F.damage({ atk, elementModifier: F.elementModifier('holy', m.def.element), def: this.monsterDef(m) }, this.rng);
      if (amount > 0) this.hurtMonster(m, amount, false, 'holy');
    }
  }

  /** A monster's DEF right now, after any Holy Aura weakening. */
  monsterDef(m: Monster): number {
    const cut = m.weakened && m.weakened.until > this.time ? m.weakened.share : 0;
    return Math.round(m.def.def * (1 - cut));
  }

  /** The pet joins the fight: it bites what you're attacking, or whatever is attacking you. */
  private petBite(dt: number): void {
    const p = this.player;
    const pet = p.pet!;
    const mover = this.petMover!;
    this.petAttackMs -= dt;
    if (this.petAttackMs > 0 || p.dead || Pets.appetite(pet.hunger) === 'Starving') return;
    let target = p.intent.kind === 'attack' ? this.monsters.get(p.intent.targetId) : undefined;
    if (!target) {
      for (const m of this.monsters.values()) {
        if (!m.hostile || m.state !== 'attack' || tileDistance(m.tile, p.tile) > 2) continue;
        if (!target || tileDistance(m.tile, mover.tile) < tileDistance(target.tile, mover.tile)) target = m;
      }
    }
    if (!target || tileDistance(target.tile, mover.tile) > Pets.PET_ATTACK_RANGE) return;
    this.petAttackMs = Pets.PET_ATTACK_MS;
    const amount = Math.max(1, Math.round(Pets.petAttackDamage(pet) * (0.85 + this.rng() * 0.3)));
    this.hurtMonster(target, amount, false, 'pet');
  }

  // ---- Status effects ----------------------------------------------------

  stunned(): boolean {
    return this.player.statuses.has('stun');
  }

  /** Tries to inflict a status; VIT or INT may resist it. */
  inflict(status: St.StatusId, chance: number, durationMs: number): void {
    const p = this.player;
    if (p.dead) return;
    const stats = effectiveStats(p);
    if (this.rng() >= St.resistedChance(status, chance, stats)) return;
    const ms = St.resistedDuration(status, durationMs, stats);
    const had = p.statuses.get(status);
    p.statuses.set(status, { remainingMs: Math.max(ms, had?.remainingMs ?? 0), tickMs: had?.tickMs ?? St.POISON_TICK_MS });
    if (status === 'stun') {
      p.path = [];
      p.casting = null;
      p.sitting = false;
      if (p.intent.kind !== 'attack') p.intent = { kind: 'none' };
    }
    if (!had) this.events.emit('statusApplied', { status });
  }

  cure(statuses: readonly St.StatusId[]): void {
    for (const s of statuses) {
      if (this.player.statuses.delete(s)) this.events.emit('statusEnded', { status: s });
    }
  }

  private tickStatuses(p: Player, dt: number): void {
    for (const [id, st] of p.statuses) {
      st.remainingMs -= dt;
      if (id === 'poison') {
        st.tickMs -= dt;
        if (st.tickMs <= 0) {
          st.tickMs += St.POISON_TICK_MS;
          const dmg = Math.min(St.poisonDamage(derivedStats(p).maxHp), p.hp - 1);
          if (dmg > 0) {
            p.hp -= dmg;
            this.events.emit('damage', { sourceId: 'player', targetId: 'player', amount: dmg, crit: false });
          }
        }
      }
      if (st.remainingMs <= 0) {
        p.statuses.delete(id);
        this.events.emit('statusEnded', { status: id });
      }
    }
  }

  // ---- Quests --------------------------------------------------------------

  /** Takes a hunt from the board. Returns why not, or null. */
  acceptQuest(id: string): string | null {
    const q = this.content.quests.get(id);
    const p = this.player;
    if (!q) return 'Unknown quest.';
    const state = questState(p, q);
    if (state === 'done') return "You've already finished that hunt.";
    if (state === 'locked') return `Requires base level ${q.minLevel}.`;
    if (state !== 'available') return "You're already on that hunt.";
    if (p.quests.active.size >= MAX_ACTIVE_QUESTS) return `You can only take ${MAX_ACTIVE_QUESTS} hunts at a time.`;
    p.quests.active.set(id, 0);
    this.events.emit('questProgress', { questId: id, progress: 0, count: q.target.count });
    return null;
  }

  abandonQuest(id: string): void {
    if (this.player.quests.active.delete(id)) this.events.emit('questProgress', { questId: id, progress: 0, count: 0 });
  }

  /** Hands in a finished hunt for its reward. Returns why not, or null. */
  turnInQuest(id: string): string | null {
    const q = this.content.quests.get(id);
    const p = this.player;
    if (!q || questState(p, q) !== 'ready') return "That hunt isn't finished yet.";
    p.quests.active.delete(id);
    p.quests.done.set(id, (p.quests.done.get(id) ?? 0) + 1);
    p.gold += q.reward.gold;
    for (const it of q.reward.items) this.addItem(it.id, it.count);
    this.events.emit('questCompleted', { questId: id, name: q.name });
    this.grantXp(q.reward.baseXp, q.reward.jobXp);
    return null;
  }

  /** Pays out the kill bounty at a hunting board. Returns the gold collected. */
  collectBounty(): number {
    const p = this.player;
    const gold = p.bounty;
    if (gold <= 0) return 0;
    p.gold += gold;
    p.bounty = 0;
    this.events.emit('bountyCollected', { gold });
    return gold;
  }

  private trackKill(m: Monster): void {
    const p = this.player;
    // Every monster defeated adds to the standing bounty, quest or not.
    p.bounty += bountyFor(m.def);
    for (const [id, progress] of p.quests.active) {
      const q = this.content.quests.get(id);
      if (!q || q.target.monster !== m.def.id || progress >= q.target.count) continue;
      p.quests.active.set(id, progress + 1);
      this.events.emit('questProgress', { questId: id, progress: progress + 1, count: q.target.count });
      if (progress + 1 >= q.target.count) this.events.emit('questReady', { questId: id, name: q.name });
    }
  }

  private grantXp(base: number, job: number): void {
    const ups = gainXp(this.player, base, job);
    this.session.baseXp += base;
    this.session.jobXp += job;
    this.events.emit('xpGained', { base, job });
    for (const level of ups.base) this.events.emit('levelUp', { kind: 'base', level });
    for (const level of ups.job) this.events.emit('levelUp', { kind: 'job', level });
  }

  raiseStat(stat: StatName): boolean {
    return raiseStat(this.player, stat);
  }

  /** Spends a skill point. Returns why not, or null on success. */
  learnSkill(id: S.SkillId): string | null {
    const wasNew = this.player.skills.get(id) === undefined;
    const err = learnSkill(this.player, id);
    if (!err) {
      // A newly learned active skill lands on the quick bar if there's room.
      const bar = this.player.hotbar;
      if (wasNew && S.SKILLS[id].kind !== 'passive' && !bar.includes(id) && bar.length < HOTBAR_SIZE) bar.push(id);
      this.refreshStats();
      this.events.emit('skillsChanged', {});
    }
    return err;
  }

  /** Uses an active skill. Targeted skills walk into range first, picking the nearest monster if needed. */
  useSkill(id: string): void {
    const p = this.player;
    if (p.dead || !S.isSkillId(id)) return;
    if (this.stunned()) return void this.events.emit('notice', { text: "You're stunned!" });
    const skill = S.SKILLS[id];
    const lv = S.skillLevel(p, id);
    if (lv === 0 || skill.kind === 'passive') return;
    const notice = (text: string) => this.events.emit('notice', { text });
    if (this.weightRatio() >= F.WEIGHT_NO_ATTACK) return notice("You're carrying too much to fight.");
    if (skill.needsWeapon && weaponOf(p).type !== skill.needsWeapon) return notice(`${skill.name} needs a ${skill.needsWeapon} equipped.`);
    if (skill.needsTwoHanded && !p.equipment.weapon?.item.equip?.twoHanded) return notice(`${skill.name} needs a two-handed weapon.`);
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
    const around = (center: Tile, radius: number) => [...this.monsters.values()].filter((m) => tileDistance(center, m.tile) <= radius);
    if (skill.magic && (target || skill.area?.around === 'self')) {
      const magic = skill.magic;
      const center = skill.area?.around === 'self' || !target ? p.tile : target.tile;
      const victims = skill.area ? around(center, skill.area.radius) : [target!];
      // The chosen target first, so effects aim at it.
      victims.sort((a, b) => Number(b === target) - Number(a === target));
      hit.push(...victims.map((m) => m.id));
      this.events.emit('skillUsed', { skillId: id, targets: hit, at: skill.area ? { ...center } : undefined });
      const d = derivedStats(p);
      for (const m of victims) {
        if (magic.only && !magic.only.includes(m.def.element)) continue;
        const elem = F.elementModifier(magic.element, m.def.element);
        for (let i = 0; i < magic.hits(lv) && this.monsters.has(m.id); i++) {
          m.hostile = true;
          this.hurtMonster(m, F.magicDamage(d.matk, magic.perHit(lv) * this.cardDamageFactor(m), elem, this.monsterDef(m), this.rng), false);
        }
      }
    } else if (id === 'pierce' && target) {
      hit.push(target.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      for (let i = 0; i < S.pierceHits(target.def.size) && this.monsters.has(target.id); i++) {
        this.playerHit(target, { modifier: S.pierceModifier(lv), hitBonus: 0.05 * lv, element: 'neutral' });
      }
    } else if (id === 'bowling_bash' && target) {
      const victims = around(target.tile, S.BOWLING_RADIUS);
      hit.push(...victims.map((m) => m.id));
      this.events.emit('skillUsed', { skillId: id, targets: hit, at: { ...target.tile } });
      for (const m of victims) if (this.monsters.has(m.id)) this.playerHit(m, { modifier: S.bowlingModifier(lv), hitBonus: 0.1, element: 'neutral' });
    } else if (id === 'blitz_beat' && target) {
      hit.push(target.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      const s = effectiveStats(p);
      const per = S.blitzDamage(s.dex, s.int, S.skillLevel(p, 'steel_crow'));
      for (let i = 0; i < lv && this.monsters.has(target.id); i++) {
        this.hurtMonster(target, Math.max(1, Math.floor(per * (0.9 + this.rng() * 0.2) * this.cardDamageFactor(target))), false);
      }
    } else if (id === 'claymore_trap' && target) {
      const victims = around(target.tile, S.CLAYMORE_RADIUS);
      hit.push(...victims.map((m) => m.id));
      this.events.emit('skillUsed', { skillId: id, targets: hit, at: { ...target.tile } });
      const d = derivedStats(p);
      for (const m of victims) {
        if (!this.monsters.has(m.id)) continue;
        const amount = F.damage(
          { atk: d.atk, skillModifier: S.claymoreModifier(lv) * this.cardDamageFactor(m), elementModifier: F.elementModifier('fire', m.def.element), def: this.monsterDef(m) },
          this.rng,
        );
        this.hurtMonster(m, amount, false);
      }
    } else if (id === 'kyrie_eleison') {
      p.buffs.set(id, { level: lv, remainingMs: skill.buffMs!(lv), value: S.kyrieShield(derivedStats(p).maxHp, lv) });
      this.events.emit('skillUsed', { skillId: id, targets: [] });
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
    } else if (id === 'double_strafe' && target) {
      hit.push(target.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      for (let i = 0; i < 2 && this.monsters.has(target.id); i++) {
        this.playerHit(target, { modifier: S.doubleStrafeModifier(lv), hitBonus: 0, element: 'neutral' });
      }
    } else if (id === 'arrow_shower' && target) {
      for (const m of this.monsters.values()) if (tileDistance(target.tile, m.tile) <= S.ARROW_SHOWER_RADIUS) hit.push(m.id);
      this.events.emit('skillUsed', { skillId: id, targets: hit });
      for (const mid of hit) {
        const m = this.monsters.get(mid);
        if (m) this.playerHit(m, { modifier: S.arrowShowerModifier(lv), hitBonus: 0, element: 'neutral' });
      }
    } else if (id === 'heal') {
      const d = derivedStats(p);
      const hp = Math.min(S.healAmount(p.baseLevel, effectiveStats(p).int, lv), d.maxHp - p.hp);
      p.hp += hp;
      this.events.emit('skillUsed', { skillId: id, targets: [] });
      this.events.emit('heal', { hp, sp: 0 });
    } else if (skill.buffMs) {
      p.buffs.set(id, { level: lv, remainingMs: skill.buffMs(lv) });
      this.refreshStats();
      this.events.emit('skillUsed', { skillId: id, targets: [] });
    }
  }

  /** Buffs, passives and pets change stats and speed; keep HP and SP within the new maximums. */
  refreshStats(): void {
    const p = this.player;
    const agi = p.buffs.has('increase_agi') ? S.INCREASE_AGI_MOVE : 1;
    const ride = S.skillLevel(p, 'riding') > 0 ? S.RIDING_MOVE : 1;
    p.moveMs = Math.round(F.PLAYER_MOVE_MS * agi * ride);
    const d = derivedStats(p);
    p.hp = Math.min(p.hp, d.maxHp);
    p.sp = Math.min(p.sp, d.maxSp);
  }

  /** How far (tiles) the player's normal attacks reach: bows shoot from afar. */
  attackRange(): number {
    const p = this.player;
    return weaponOf(p).type === 'bow' ? S.BOW_RANGE + Math.floor(S.skillLevel(p, 'vultures_eye') / 2) : PLAYER_ATTACK_RANGE;
  }

  // ---- Inventory and trade -----------------------------------------------

  /** Total weight carried, worn gear included. */
  weight(): number {
    const p = this.player;
    let total = 0;
    for (const [id, n] of p.inventory) total += (this.content.items.get(id)?.weight ?? 0) * n;
    for (const piece of p.gear) total += piece.item.weight;
    for (const piece of Object.values(p.equipment)) total += piece?.item.weight ?? 0;
    return total;
  }

  /** A fresh piece of gear; unrefined with empty slots unless given. */
  newPiece(item: ItemDef, refine = 0, cards: ItemDef[] = []): GearPiece {
    return { uid: this.nextGearUid++, item, refine, cards };
  }

  /** A gear piece by uid, whether in the bag or worn. */
  findPiece(uid: number): { piece: GearPiece; slot: EquipSlot | null } | null {
    const p = this.player;
    const bag = p.gear.find((g) => g.uid === uid);
    if (bag) return { piece: bag, slot: null };
    for (const slot of EQUIP_SLOTS) if (p.equipment[slot]?.uid === uid) return { piece: p.equipment[slot]!, slot };
    return null;
  }

  /**
   * Wears a piece from the bag, putting back whatever it replaces. Accepts a
   * piece uid, or an item id (then the first plain piece of that item).
   * Returns why not, or null.
   */
  equip(pieceOrItem: number | string): string | null {
    const p = this.player;
    const piece =
      typeof pieceOrItem === 'number'
        ? p.gear.find((g) => g.uid === pieceOrItem)
        : (p.gear.find((g) => g.item.id === pieceOrItem && isPlain(g)) ?? p.gear.find((g) => g.item.id === pieceOrItem));
    const item = piece?.item;
    if (!piece || !item?.equip) return "You don't have that.";
    const blocker = equipBlocker(p, item);
    if (blocker) return blocker;
    const slot = slotFor(p, item.equip);
    p.gear = p.gear.filter((g) => g !== piece);
    this.unequipQuiet(slot);
    // A two-handed weapon and a shield can't be held together.
    if (slot === 'weapon' && item.equip.twoHanded) this.unequipQuiet('shield');
    if (slot === 'shield' && p.equipment.weapon?.item.equip?.twoHanded) this.unequipQuiet('weapon');
    p.equipment[slot] = piece;
    this.events.emit('inventoryChanged', {});
    this.afterGearChange();
    return null;
  }

  /** Why this piece can't be refined right now, or null if it can. */
  refineBlocker(uid: number): string | null {
    const found = this.findPiece(uid);
    if (!found) return "You don't have that gear.";
    const next = found.piece.refine + 1;
    if (next > MAX_REFINE) return 'Already at +10.';
    if (!this.hasItem(F.REFINE_ORE, 1)) return `You need a ${this.content.items.get(F.REFINE_ORE)?.name ?? 'refining ore'}.`;
    if (this.player.gold < F.refineCost(next)) return `You need ${F.refineCost(next)} gold.`;
    return null;
  }

  /**
   * One refine attempt: costs gold and one ore either way. Success raises the
   * piece by one; failure (possible above +4) leaves it as it was.
   */
  refine(uid: number): { error: string } | { success: boolean; level: number } {
    const blocker = this.refineBlocker(uid);
    if (blocker) return { error: blocker };
    const { piece } = this.findPiece(uid)!;
    const next = piece.refine + 1;
    this.player.gold -= F.refineCost(next);
    this.removeItem(F.REFINE_ORE, 1);
    const success = this.rng() < F.refineChance(next);
    const name = piece.item.name;
    // A failure only costs the ore and gold: the piece keeps its refine level.
    if (success) piece.refine = next;
    this.afterGearChange();
    this.events.emit('inventoryChanged', {});
    this.events.emit('refined', { name, level: next, success });
    return { success, level: next };
  }

  /** Slots a card from the bag into a piece of gear, for good. Returns why not, or null. */
  insertCard(cardId: string, uid: number): string | null {
    const card = this.content.items.get(cardId);
    const found = this.findPiece(uid);
    if (!card || !this.hasItem(cardId, 1)) return "You don't have that card.";
    if (!found) return "You don't have that gear.";
    const blocker = cardBlocker(found.piece, card);
    if (blocker) return blocker;
    this.removeItem(cardId, 1);
    found.piece.cards.push(card);
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
    this.player.gear.push(old);
    this.events.emit('inventoryChanged', {});
  }

  private afterGearChange(): void {
    const p = this.player;
    const d = derivedStats(p);
    p.hp = Math.min(p.hp, d.maxHp);
    p.sp = Math.min(p.sp, d.maxSp);
    this.events.emit('equipmentChanged', {});
  }

  /** Worn pieces by slot. */
  wornPieces(): Array<[EquipSlot, GearPiece]> {
    return EQUIP_SLOTS.flatMap((slot) => {
      const piece = this.player.equipment[slot];
      return piece ? [[slot, piece] as [EquipSlot, GearPiece]] : [];
    });
  }

  maxWeight(): number {
    return F.maxWeight(effectiveStats(this.player).str);
  }

  weightRatio(): number {
    return this.weight() / this.maxWeight();
  }

  /** Buys `count` of an item from a shop. Returns an error message, or null on success. */
  /**
   * Whether the player has come across this item: picked it up once, has it
   * in the bag or storage, or has been to an area where a regular monster drops it.
   */
  hasFound(itemId: string): boolean {
    if (this.flags.has(foundFlag(itemId)) || this.itemCount(itemId) > 0 || this.storage.items.has(itemId)) return true;
    return (this.dropAreas().get(itemId) ?? []).some((map) => this.flags.has(visitedFlag(map)));
  }

  private dropAreasCache: Map<string, string[]> | null = null;

  /** For each item, the maps where a regular (non-boss) monster drops it. */
  private dropAreas(): Map<string, string[]> {
    if (this.dropAreasCache) return this.dropAreasCache;
    const areas = new Map<string, string[]>();
    for (const map of this.content.maps.values()) {
      for (const spawn of map.spawns) {
        const def = this.content.monsters.get(spawn.monster)!;
        if (def.boss) continue;
        for (const d of def.drops) areas.set(d.item, [...new Set([...(areas.get(d.item) ?? []), map.id])]);
      }
    }
    return (this.dropAreasCache = areas);
  }

  /** What a shop sells right now (a materials trader only stocks what you've found). */
  shopItems(shopId: string): string[] {
    const shop = this.content.shops.get(shopId);
    if (!shop) return [];
    return shop.onlyFound ? shop.items.filter((id) => this.hasFound(id)) : shop.items;
  }

  /** What one of this item costs at this shop. */
  buyPrice(shopId: string, item: ItemDef): number {
    return Math.ceil(item.price * (this.content.shops.get(shopId)?.markup ?? 1));
  }

  buy(shopId: string, itemId: string, count = 1): string | null {
    const shop = this.content.shops.get(shopId);
    const item = this.content.items.get(itemId);
    if (!shop || !item || !this.shopItems(shopId).includes(itemId) || count < 1) return "That's not for sale here.";
    const cost = this.buyPrice(shopId, item) * count;
    if (cost > this.player.gold) return "You can't afford that.";
    if (this.weight() + item.weight * count > this.maxWeight()) return "You can't carry that much.";
    this.player.gold -= cost;
    this.addItem(itemId, count);
    return null;
  }

  /** Sells `count` of an item to any NPC (plain gear pieces first). Returns an error message, or null on success. */
  sell(itemId: string, count = 1): string | null {
    const item = this.content.items.get(itemId);
    if (item?.quest) return 'You can’t part with that.';
    if (!item || count < 1 || this.itemCount(itemId) < count) return "You don't have that many.";
    this.removeItem(itemId, count);
    this.player.gold += F.sellPrice(item.price) * count;
    return null;
  }

  /** Sells one specific piece of gear from the bag. */
  sellPiece(uid: number): string | null {
    const piece = this.player.gear.find((g) => g.uid === uid);
    if (!piece) return "You don't have that.";
    this.player.gear = this.player.gear.filter((g) => g !== piece);
    this.player.gold += F.sellPrice(piece.item.price);
    this.events.emit('inventoryChanged', {});
    return null;
  }

  /** How many of an item are in the bag (worn gear not counted). */
  itemCount(itemId: string): number {
    const item = this.content.items.get(itemId);
    if (item?.equip) return this.player.gear.filter((g) => g.item.id === itemId).length;
    return this.player.inventory.get(itemId) ?? 0;
  }

  /** Learned level of a skill; 0 if unknown. */
  skillLevel(skillId: string): number {
    return S.skillLevel(this.player, skillId);
  }

  hasItem(itemId: string, count: number): boolean {
    return this.itemCount(itemId) >= count;
  }

  /** Adds items to the bag; gear arrives as new, plain pieces. */
  addItem(itemId: string, count: number): void {
    const item = this.content.items.get(itemId);
    if (item?.equip) {
      for (let i = 0; i < count; i++) this.player.gear.push(this.newPiece(item));
    } else {
      const inv = this.player.inventory;
      inv.set(itemId, (inv.get(itemId) ?? 0) + count);
    }
    this.events.emit('inventoryChanged', {});
  }

  /** Removes items from the bag; for gear, plain pieces go before refined or carded ones. */
  removeItem(itemId: string, count: number): void {
    const item = this.content.items.get(itemId);
    if (item?.equip) {
      const p = this.player;
      const ordered = p.gear
        .filter((g) => g.item.id === itemId)
        .sort((a, b) => Number(isPlain(b)) - Number(isPlain(a)) || a.refine - b.refine);
      const gone = new Set(ordered.slice(0, count));
      p.gear = p.gear.filter((g) => !gone.has(g));
    } else {
      const inv = this.player.inventory;
      const left = (inv.get(itemId) ?? 0) - count;
      if (left > 0) inv.set(itemId, left);
      else inv.delete(itemId);
    }
    this.events.emit('inventoryChanged', {});
  }

  // ---- Crafting ------------------------------------------------------------

  /** What's missing to make a recipe: gold and each short material (empty when it can be made). */
  craftShortfall(recipeId: string): string[] {
    const r = this.content.recipes.get(recipeId);
    if (!r) return ['Unknown recipe.'];
    const missing: string[] = [];
    if (this.player.gold < r.gold) missing.push(`${r.gold - this.player.gold} more gold`);
    for (const m of r.materials) {
      const have = this.itemCount(m.item);
      if (have < m.count) missing.push(`${m.count - have} more ${this.content.items.get(m.item)?.name ?? m.item}`);
    }
    return missing;
  }

  /** Makes a recipe: takes the materials and gold, gives the result. */
  craft(recipeId: string): { error: string } | { itemId: string; count: number } {
    const r = this.content.recipes.get(recipeId);
    if (!r) return { error: 'Unknown recipe.' };
    const missing = this.craftShortfall(recipeId);
    if (missing.length > 0) return { error: `You need ${missing.join(', ')}.` };
    for (const m of r.materials) this.removeItem(m.item, m.count);
    this.player.gold -= r.gold;
    this.addItem(r.result, r.count);
    this.events.emit('crafted', { itemId: r.result, count: r.count });
    return { itemId: r.result, count: r.count };
  }

  // ---- Storage -------------------------------------------------------------

  /** Stacks plus gear pieces in storage. */
  storageUsed(): number {
    return this.storage.items.size + this.storage.gear.length;
  }

  /** Moves `count` of a stackable item from the bag into storage. Returns why not, or null. */
  store(itemId: string, count: number): string | null {
    if (this.content.items.get(itemId)?.quest) return 'You’d rather keep that on you.';
    const have = this.player.inventory.get(itemId) ?? 0;
    if (count < 1 || have < count) return "You don't have that many.";
    const items = this.storage.items;
    if (!items.has(itemId) && this.storageUsed() >= STORAGE_CAPACITY) return 'Storage is full.';
    this.removeItem(itemId, count);
    items.set(itemId, (items.get(itemId) ?? 0) + count);
    this.events.emit('storageChanged', {});
    return null;
  }

  /** Moves one gear piece from the bag into storage, refine and cards intact. */
  storePiece(uid: number): string | null {
    const piece = this.player.gear.find((g) => g.uid === uid);
    if (!piece) return "You don't have that.";
    if (this.storageUsed() >= STORAGE_CAPACITY) return 'Storage is full.';
    this.player.gear = this.player.gear.filter((g) => g !== piece);
    this.storage.gear.push(piece);
    this.events.emit('inventoryChanged', {});
    this.events.emit('storageChanged', {});
    return null;
  }

  /** Moves `count` of a stackable item from storage into the bag. */
  takeOut(itemId: string, count: number): string | null {
    const items = this.storage.items;
    const have = items.get(itemId) ?? 0;
    const item = this.content.items.get(itemId);
    if (!item || count < 1 || have < count) return "That isn't in storage.";
    if (this.weight() + item.weight * count > this.maxWeight()) return "You can't carry that much.";
    if (have === count) items.delete(itemId);
    else items.set(itemId, have - count);
    this.addItem(itemId, count);
    this.events.emit('storageChanged', {});
    return null;
  }

  /** Moves one gear piece from storage into the bag. */
  takePiece(uid: number): string | null {
    const piece = this.storage.gear.find((g) => g.uid === uid);
    if (!piece) return "That isn't in storage.";
    if (this.weight() + piece.item.weight > this.maxWeight()) return "You can't carry that much.";
    this.storage.gear = this.storage.gear.filter((g) => g !== piece);
    this.player.gear.push(piece);
    this.events.emit('inventoryChanged', {});
    this.events.emit('storageChanged', {});
    return null;
  }

  // ---- NPC services ------------------------------------------------------

  /** Runs one dialogue action. Returns a shop id when the action opens a shop. */
  applyAction(action: DialogueAction): { openShop?: string; openRefine?: boolean; openQuests?: boolean; openStorage?: boolean; openCraft?: boolean } {
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
        this.cure([...St.STATUS_IDS]);
        this.events.emit('heal', { hp, sp });
        return {};
      }
      case 'openShop':
        return { openShop: action.shop };
      case 'openRefine':
        return { openRefine: true };
      case 'openQuests':
        return { openQuests: true };
      case 'openCraft':
        return { openCraft: true };
      case 'takeItem':
        this.removeItem(action.id, action.count);
        return {};
      case 'giveItem':
        this.addItem(action.id, action.count);
        return {};
      case 'openStorage':
        if (p.gold < action.fee) {
          this.events.emit('notice', { text: `Storage costs ${action.fee} gold to open.` });
          return {};
        }
        p.gold -= action.fee;
        return { openStorage: true };
      case 'warp':
        if (p.gold < action.cost) {
          this.events.emit('notice', { text: `You need ${action.cost} gold for that trip.` });
          return {};
        }
        p.gold -= action.cost;
        this.changeMap(action.map, { x: action.x, y: action.y });
        return {};
      case 'changeJob': {
        const err = isJobId(action.job) ? changeJob(p, action.job) : 'Unknown job.';
        if (err) {
          this.events.emit('notice', { text: err });
          return {};
        }
        const gift = JOBS[action.job as JobId].starterWeapon;
        if (gift && this.content.items.has(gift)) {
          this.addItem(gift, 1);
          this.equip(gift);
          this.events.emit('notice', { text: `The guild gives you a ${this.content.items.get(gift)!.name}.` });
        }
        this.events.emit('jobChanged', { jobId: action.job });
        this.giveJobRelic();
        return {};
      }
      case 'setFlag':
        this.setStoryFlag(action.flag, action.value);
        return {};
      case 'storyEnding':
        this.endStory(action.ending);
        return {};
    }
  }

  // ---- Story ---------------------------------------------------------------

  /** Sets a story flag; story characters on the map may appear or leave. */
  setStoryFlag(flag: string, value: string | number | boolean = true): void {
    this.flags.set(flag, value);
    this.events.emit('storyChanged', {});
  }

  /** Each first-job guild's keepsake, handed over once (also for characters who changed job before it existed). */
  giveJobRelic(): void {
    const line = jobLineage(this.player.jobId);
    for (const job of line) {
      const relic = JOB_RELICS[job];
      if (!relic || this.flags.has(`relic:${relic}`) || !this.content.items.has(relic)) continue;
      this.flags.set(`relic:${relic}`, true);
      this.addItem(relic, 1);
      this.events.emit('notice', { text: `You were given a ${this.content.items.get(relic)!.name}.` });
    }
  }

  /** Ends the story: the fragments are spent, the ending's keepsake is yours. */
  private endStory(ending: Ending): void {
    if (this.flags.has(STORY.ending)) return;
    for (const f of Object.values(FRAGMENTS)) if (this.hasItem(f.item, 1)) this.removeItem(f.item, this.itemCount(f.item));
    if ((ending === 'return' || ending === 'gap') && this.hasItem(SPLINTER, 1)) this.removeItem(SPLINTER, 1);
    const reward = ENDINGS[ending].reward;
    if (this.content.items.has(reward)) this.addItem(reward, 1);
    this.setStoryFlag(STORY.ending, ending);
    this.events.emit('storyEnded', { ending, title: ENDINGS[ending].title });
  }

  /** Story drops after a kill: the splinter (first kill), and a boss's fragment until you have it. */
  private storyDrops(m: Monster): void {
    const drop = (itemId: string) => {
      const id = this.nextId++;
      // Story items wait on the ground much longer than loot.
      this.drops.set(id, { id, itemId, tile: { ...m.tile }, expiresIn: 10 * 60_000 });
    };
    if (!this.flags.has(STORY.splinter) && !this.flags.has(STORY.splinterOut) && !this.hasItem(SPLINTER, 1)) {
      this.flags.set(STORY.splinterOut, true);
      drop(SPLINTER);
    }
    const frag = FRAGMENTS[m.def.id];
    if (frag && !this.flags.has(frag.flag) && !this.hasItem(frag.item, 1) && ![...this.drops.values()].some((d) => d.itemId === frag.item)) drop(frag.item);
  }

  /** A line over the world once a boss turns on you, if you carry Starglass. */
  private bossLine(m: Monster, kind: 'aggro' | 'lastPhase'): void {
    const line = BOSS_LINES[m.def.id]?.[kind];
    if (!line || !this.flags.has(STORY.splinter) || this.storyLinesShown.has(`${m.id}:${kind}`)) return;
    this.storyLinesShown.add(`${m.id}:${kind}`);
    this.events.emit('storyLine', { text: line });
  }

  /** Story moments tied to arriving somewhere. */
  private onEnterMap(mapId: string): void {
    if (mapId === 'sunspire' && this.flags.has(STORY.frag1) && !this.flags.has(STORY.fountain)) {
      this.setStoryFlag(STORY.fountain);
      this.events.emit('storyLine', { text: 'The fountain runs uphill as you pass.' });
    }
    // The heap in the Iron Wastes grows a little every time you come back.
    if (mapId === 'iron-wastes' && this.flags.has(STORY.frag2)) {
      this.setStoryFlag(STORY.heap, Number(this.flags.get(STORY.heap) ?? 0) + 1);
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
    this.onEnterMap(mapId);
  }

  private loadMap(map: MapDef): void {
    this.currentMap = map;
    this.flags.set(visitedFlag(map.id), true);
    this.currentGrid = buildGrid(map);
    this.monsters.clear();
    this.drops.clear();
    this.respawns = [];
    this.bossWaits = [];
    map.spawns.forEach((spawn, i) => {
      const def = this.content.monsters.get(spawn.monster)!;
      const bossAt = def.boss ? Number(this.flags.get(bossFlag(def.id)) ?? 0) : 0;
      if (bossAt > this.now()) {
        this.bossWaits.push({ spawnIndex: i, at: bossAt });
        return;
      }
      for (let n = 0; n < spawn.count; n++) this.spawnMonster(i);
    });
  }

  /** Loads saved flags and respawns the current map, so a boss killed before saving stays dead. */
  restoreFlags(flags: Record<string, string | number | boolean>): void {
    this.flags.clear();
    for (const [k, v] of Object.entries(flags)) this.flags.set(k, v);
    this.loadMap(this.map);
  }

  /** When the boss of this map comes back, or null if it's alive or there is none. */
  bossRespawnAt(): number | null {
    return this.bossWaits.length > 0 ? Math.min(...this.bossWaits.map((b) => b.at)) : null;
  }

  /** Puts the player on a tile, cancelling whatever they were doing. */
  private placePlayer(tile: Tile): void {
    const p = this.player;
    Object.assign(p, createMover(tile, p.moveMs));
    p.intent = { kind: 'none' };
    p.sitting = false;
    p.casting = null;
    for (const m of this.monsters.values()) m.hostile = false;
    this.placePet();
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
    this.updateAuto(dt);
    this.updatePlayer(dt);
    // A portal swapped the map mid-tick; the new map's monsters start fresh next tick.
    if (this.map !== mapBefore) return;
    for (const m of [...this.monsters.values()]) this.updateMonster(m, dt);
    this.updatePet(dt);
    this.updateAura(dt);
    this.updateHolyAura(dt);
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
    this.tickStatuses(p, dt);
    if (this.stunned()) {
      // Finish the current step so the player never freezes between tiles.
      advance(p, dt, () => true);
      return;
    }
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
      } else if (this.approach(p, target, dt, intent.kind === 'skill' ? this.skillRange(intent.skillId) : this.attackRange())) {
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
    if (!S.isSkillId(id)) return PLAYER_ATTACK_RANGE;
    const skill = S.SKILLS[id];
    return skill.weaponRange ? this.attackRange() : (skill.range ?? PLAYER_ATTACK_RANGE);
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
        this.refreshStats();
        this.events.emit('notice', { text: `${S.isSkillId(id) ? S.SKILLS[id].name : id} wore off.` });
      }
    }
  }

  private regenerate(p: Player, dt: number): void {
    // A heavy bag stops natural recovery, which is what sends players back to town. So does poison.
    if (this.weightRatio() >= F.WEIGHT_NO_REGEN || p.statuses.has('poison')) return;
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
      p.sp = Math.min(d.maxSp, p.sp + F.spRegenAmount(d.maxSp, effectiveStats(p).int) + 2 * S.skillLevel(p, 'sp_recovery'));
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
        skillModifier: o.modifier * this.cardDamageFactor(target),
        elementModifier: F.elementModifier(o.element, target.def.element),
        sizeModifier: F.sizeModifier(weaponOf(p).type, target.def.size),
        def: this.monsterDef(target),
        crit,
      },
      this.rng,
    );
    this.hurtMonster(target, amount, crit);
  }

  /** Card bonuses against this monster's element and size, e.g. 1.15 for +15%. */
  private cardDamageFactor(target: Monster): number {
    const fx = cardEffects(this.player);
    return 1 + (fx.vsElement[target.def.element] ?? 0) + (fx.vsSize[target.def.size] ?? 0);
  }

  private hurtMonster(target: Monster, amount: number, crit: boolean, source: 'player' | 'pet' | 'aura' | 'holy' = 'player'): void {
    target.hp -= amount;
    target.hostile = true;
    if (source === 'pet') this.events.emit('petAttack', { targetId: target.id, amount });
    else if (source === 'aura' || source === 'holy') this.events.emit('auraHit', { targetId: target.id, amount, holy: source === 'holy' });
    else this.events.emit('damage', { sourceId: 'player', targetId: target.id, amount, crit });
    if (target.hp <= 0) this.killMonster(target);
    else if (target.def.phases.length > 0) this.checkPhase(target);
  }

  private killMonster(m: Monster): void {
    const p = this.player;
    this.monsters.delete(m.id);
    const respawnMs = this.map.spawns[m.spawnIndex]!.respawnMs;
    if (m.summoned) {
      // Minions a boss called in don't come back.
    } else if (m.def.boss) {
      const at = this.now() + respawnMs;
      this.flags.set(bossFlag(m.def.id), at);
      this.bossWaits.push({ spawnIndex: m.spawnIndex, at });
      this.events.emit('boss', { kind: 'defeated', name: m.def.name });
    } else {
      this.respawns.push({ spawnIndex: m.spawnIndex, at: this.time + respawnMs });
    }
    this.events.emit('monsterDied', { monsterId: m.id, tile: { ...m.tile } });
    this.session.kills += 1;

    this.grantXp(m.def.baseXp, m.def.jobXp);
    this.rewardPet(m.def.baseXp);
    this.trackKill(m);

    const spots = this.dropSpots(m.tile);
    let spot = 0;
    for (const drop of m.def.drops) {
      if (this.rng() >= drop.chance) continue;
      const tile = spots[spot++ % spots.length]!;
      const id = this.nextId++;
      this.drops.set(id, { id, itemId: drop.item, tile, expiresIn: F.DROP_LIFETIME_MS });
    }
    this.storyDrops(m);
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
    this.flags.set(foundFlag(item.id), true);
    const storyFlag = PICKUP_FLAGS[item.id];
    if (storyFlag && !this.flags.has(storyFlag)) {
      this.setStoryFlag(storyFlag);
      if (item.id === SPLINTER) this.events.emit('storyLine', { text: 'It’s warm. It wasn’t, a moment ago.' });
    }
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
    if (m.hostile && m.def.boss) this.bossLine(m, 'aggro');
    if (m.hostile && dist > ai.chaseRange) {
      m.hostile = false;
      m.path = [];
      m.state = 'idle';
      m.stateTimer = 1000;
    }

    if (m.hostile && m.def.special && this.updateSpecial(m, dt)) return;

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

  /**
   * Area attack: wind up on a spot (shown to the player), then hit everything
   * within the radius. Returns true while the monster is busy with it.
   */
  private updateSpecial(m: Monster, dt: number): boolean {
    const base = m.def.special!;
    const mods = this.phaseMods(m);
    const sp = { ...base, radius: mods.slamRadius ?? base.radius, everyMs: mods.slamEveryMs ?? base.everyMs, modifier: base.modifier * mods.atkMul };
    const p = this.player;
    if (m.windup) {
      m.windup.remainingMs -= dt;
      if (m.windup.remainingMs > 0) return true;
      const tile = m.windup.tile;
      m.windup = null;
      m.specialTimer = sp.everyMs;
      this.events.emit('slam', { monsterId: m.id, tile, radius: sp.radius });
      // Mid-step counts as already there, so a dodge started in time always works.
      if (!p.dead && tileDistance(tile, p.next ?? p.tile) <= sp.radius) {
        const atk = ((m.def.atk[0] + m.def.atk[1]) / 2) * sp.modifier;
        this.hurtPlayer(m, F.damage({ atk, def: derivedStats(p).def }, this.rng));
        if (sp.inflict) this.inflict(sp.inflict.status, sp.inflict.chance, sp.inflict.durationMs);
      }
      return true;
    }
    m.specialTimer -= dt;
    // Never while the player is stunned: they couldn't step out of it.
    if (m.specialTimer <= 0 && !m.next && !this.stunned() && tileDistance(m.tile, p.tile) <= sp.radius + 1) {
      m.windup = { remainingMs: sp.windupMs, tile: { ...m.tile } };
      m.path = [];
      this.events.emit('telegraph', { monsterId: m.id, tile: { ...m.tile }, radius: sp.radius, ms: sp.windupMs });
      return true;
    }
    return false;
  }

  private monsterAttack(m: Monster): void {
    const p = this.player;
    const d = derivedStats(p);
    const mods = this.phaseMods(m);
    m.attackCooldown = Math.round(m.def.attackDelayMs * mods.delayMul);
    if (this.rng() >= F.hitChance(m.def.hit, d.flee)) {
      this.events.emit('miss', { sourceId: m.id, targetId: 'player' });
      return;
    }
    this.hurtPlayer(m, F.damage({ atk: randInt(this.rng, m.def.atk[0], m.def.atk[1]) * mods.atkMul, def: d.def }, this.rng));
    const inf = m.def.inflict;
    if (inf) this.inflict(inf.status, inf.chance, inf.durationMs);
  }

  /** Applies a monster's hit to the player after resistances, and breaks any cast. */
  private hurtPlayer(m: Monster, raw: number): void {
    const p = this.player;
    const endure = p.buffs.get('endure');
    const divine = m.def.element === 'undead' || m.def.element === 'shadow' ? S.divineProtectionReduction(S.skillLevel(p, 'divine_protection')) : 0;
    // Monsters hit with their own element, so cards with matching resistance help.
    const resist = Math.min(0.8, cardEffects(p).resist[m.def.element] ?? 0) + (endure ? S.endureReduction(endure.level) : 0) + divine;
    let amount = resist > 0 ? Math.max(1, Math.floor(raw * (1 - Math.min(0.9, resist)))) : raw;
    // Kyrie Eleison soaks damage until its barrier breaks.
    const kyrie = p.buffs.get('kyrie_eleison');
    if (kyrie?.value) {
      const absorbed = Math.min(kyrie.value, amount);
      kyrie.value -= absorbed;
      amount -= absorbed;
      if (kyrie.value <= 0) {
        p.buffs.delete('kyrie_eleison');
        this.events.emit('notice', { text: 'Kyrie Eleison broke!' });
      }
    }
    p.hp -= amount;
    p.sitting = false;
    this.events.emit('damage', { sourceId: m.id, targetId: 'player', amount, crit: false });
    if (amount === 0) return;
    // Only a solid hit (a tenth of max HP or more) breaks concentration.
    if (p.casting && amount >= derivedStats(p).maxHp * CAST_BREAK_SHARE) {
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
    this.refreshStats();
    p.statuses.clear();
    this.session.deaths += 1;
    if (this.auto) this.setAuto(false);
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
      if (drop.expiresIn <= 0) {
        this.drops.delete(drop.id);
        // A splinter left lying around turns up again on a later kill.
        if (drop.itemId === SPLINTER) this.flags.delete(STORY.splinterOut);
      }
    }
  }

  private updateRespawns(): void {
    if (this.bossWaits.length > 0) {
      const now = this.now();
      const ready = this.bossWaits.filter((b) => b.at <= now);
      this.bossWaits = this.bossWaits.filter((b) => b.at > now);
      for (const b of ready) this.spawnMonster(b.spawnIndex);
    }
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
    this.addMonster(def, tile, spawnIndex);
    if (def.boss) this.events.emit('boss', { kind: 'appeared', name: def.name });
  }

  private addMonster(def: MonsterDef, tile: Tile, spawnIndex: number): Monster {
    const id = this.nextId++;
    const m: Monster = {
      ...createMover(tile, def.moveMs),
      id,
      def,
      spawnIndex,
      hp: def.hp,
      state: 'idle',
      stateTimer: randInt(this.rng, 0, 4000),
      hostile: false,
      attackCooldown: 0,
      specialTimer: def.special?.everyMs ?? 0,
      windup: null,
      phase: 0,
    };
    this.monsters.set(id, m);
    return m;
  }

  /** The combined effect of every phase a boss has reached. */
  private phaseMods(m: Monster): { atkMul: number; delayMul: number; slamRadius?: number; slamEveryMs?: number } {
    const mods: { atkMul: number; delayMul: number; slamRadius?: number; slamEveryMs?: number } = { atkMul: 1, delayMul: 1 };
    for (const ph of m.def.phases.slice(0, m.phase)) {
      mods.atkMul *= ph.atkMul;
      mods.delayMul *= ph.delayMul;
      mods.slamRadius = ph.slamRadius ?? mods.slamRadius;
      mods.slamEveryMs = ph.slamEveryMs ?? mods.slamEveryMs;
    }
    return mods;
  }

  /** Moves a boss into its next phase(s) once its HP falls far enough. */
  private checkPhase(m: Monster): void {
    while (m.phase < m.def.phases.length && m.hp < m.def.hp * m.def.phases[m.phase]!.belowHp) {
      const ph = m.def.phases[m.phase]!;
      m.phase += 1;
      this.events.emit('bossPhase', { monsterId: m.id, phase: m.phase, shout: ph.shout });
      if (m.phase === m.def.phases.length) this.bossLine(m, 'lastPhase');
      if (!ph.summon) continue;
      const minion = this.content.monsters.get(ph.summon.monster);
      if (!minion) continue;
      for (let i = 0; i < ph.summon.count; i++) {
        const tile = this.randomWalkableIn({ x: m.tile.x - 3, y: m.tile.y - 3, w: 7, h: 7 });
        if (!tile) continue;
        const add = this.addMonster(minion, tile, m.spawnIndex);
        add.summoned = true;
        add.hostile = true;
      }
    }
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

/** Flag key set once the player has been on a map (unlocks teleports there). */
export function visitedFlag(mapId: string): string {
  return `visited:${mapId}`;
}

/** Flag key holding a boss's respawn time (epoch ms). */
/** Flag key set the first time the player picks up an item (unlocks it at the materials traders). */
export function foundFlag(itemId: string): string {
  return `found:${itemId}`;
}

export function bossFlag(monsterId: string): string {
  return `boss:${monsterId}`;
}
