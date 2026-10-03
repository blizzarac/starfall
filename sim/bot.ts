/**
 * A simple autopilot that plays the real game rules headlessly, so balance can
 * be measured instead of guessed. It fights, heals, spends points, shops and
 * changes job like a reasonable (not perfect) player. Travel between maps is
 * instant: the numbers measure fighting, resting and shopping, not walking.
 */
import * as F from '../src/core/combat/formulas';
import type { StatName } from '../src/core/combat/formulas';
import { equipBlocker, slotFor } from '../src/core/equipment';
import type { Monster } from '../src/core/entities';
import { tileDistance } from '../src/core/grid';
import { JOBS, SECOND_JOB_LEVEL, type JobId } from '../src/core/jobs';
import { derivedStats } from '../src/core/progression';
import { learnBlocker, SKILLS, type SkillId } from '../src/core/skills';
import { World } from '../src/core/world';
import type { Content } from '../src/data/content';
import type { ItemDef } from '../src/data/schemas';

export interface Build {
  /** Job path, e.g. ['swordsman', 'knight']. */
  path: [JobId, JobId];
  /** Stat weights; points go to the stat furthest below its share. */
  stats: Partial<Record<StatName, number>>;
  /** Skills to learn, in order (each entry is one point). */
  skills: SkillId[];
  /** Attack skills to use, best first; the bot casts the first affordable one. */
  attacks: SkillId[];
  /** Buffs to keep up. */
  buffs: SkillId[];
  /** A self-heal skill, if any. */
  heal?: SkillId;
}

/** Hunting grounds, easiest first. The bot picks the hardest one it's ready for. */
export const AREAS: Array<{ map: string; minLevel: number; label: string }> = [
  { map: 'meadow-1', minLevel: 1, label: 'Southern Meadow' },
  { map: 'meadow-2', minLevel: 6, label: 'Thornfield' },
  { map: 'meadow-3', minLevel: 11, label: 'Mossy Hollow' },
  { map: 'whisperwood', minLevel: 16, label: 'Whisperwood' },
  { map: 'saltmere-coast', minLevel: 21, label: 'Saltmere Coast' },
  { map: 'caves-1', minLevel: 25, label: 'Glimmer Caves' },
  { map: 'sunscorch-dunes', minLevel: 34, label: 'Sunscorch Dunes' },
  { map: 'sunken-ruins', minLevel: 44, label: 'Sunken Ruins' },
];

/** Shops a player can reach; the bot buys the best gear it can wear and afford. */
const GEAR_SHOPS = ['blacksmith', 'port_market', 'desert_bazaar'];
/** HP potions, weakest first; the bot carries the best one that fits its max HP. */
const POTIONS = ['red_tonic', 'orange_tonic', 'yellow_tonic', 'white_tonic'];
const SP_POTION = 'blue_tonic';

export interface Sample {
  minutes: number;
  baseLevel: number;
  jobLevel: number;
  jobId: JobId;
  area: string;
}

export interface BotStats {
  kills: number;
  deaths: number;
  goldEarned: number;
  goldSpent: number;
  potions: number;
  /** Sim minutes spent in each area. */
  areaMinutes: Record<string, number>;
  /** Kills per area. */
  areaKills: Record<string, number>;
  /** XP per area. */
  areaXp: Record<string, number>;
  areaDeaths: Record<string, number>;
  samples: Sample[];
  /** Minutes at which each base level was reached. */
  levelAt: Record<number, number>;
  jobChangeAt: Partial<Record<JobId, number>>;
}

export class Bot {
  readonly stats: BotStats = {
    kills: 0,
    deaths: 0,
    goldEarned: 0,
    goldSpent: 0,
    potions: 0,
    areaMinutes: {},
    areaKills: {},
    areaXp: {},
    areaDeaths: {},
    samples: [],
    levelAt: { 1: 0 },
    jobChangeAt: {},
  };
  private skillQueue: SkillId[];
  private thinkMs = 0;
  private resting = false;
  private area = AREAS[0]!;
  private sinceShop = 0;
  /** Recent deaths (sim ms) per area; an area that keeps killing us is avoided for a while. */
  private recentDeaths = new Map<string, number[]>();

  constructor(
    readonly world: World,
    readonly build: Build,
  ) {
    this.skillQueue = [...build.skills];
    const ev = world.events;
    ev.on('monsterDied', () => {
      this.stats.kills++;
      this.stats.areaKills[this.area.label] = (this.stats.areaKills[this.area.label] ?? 0) + 1;
    });
    ev.on('xpGained', (e) => (this.stats.areaXp[this.area.label] = (this.stats.areaXp[this.area.label] ?? 0) + e.base));
    ev.on('playerDied', () => {
      this.stats.deaths++;
      this.recentDeaths.set(this.area.map, [...(this.recentDeaths.get(this.area.map) ?? []), this.world.time]);
      this.stats.areaDeaths[this.area.label] = (this.stats.areaDeaths[this.area.label] ?? 0) + 1;
    });
    ev.on('levelUp', (e) => {
      if (e.kind === 'base') this.stats.levelAt[e.level] = this.minutes;
    });
  }

  get minutes(): number {
    return this.world.time / 60_000;
  }

  /** Plays for `minutes` of game time (or until base level `untilLevel`). */
  run(minutes: number, untilLevel = 99): void {
    const end = this.world.time + minutes * 60_000;
    let nextSample = 0;
    while (this.world.time < end && this.world.player.baseLevel < untilLevel) {
      if (this.world.time >= nextSample) {
        nextSample += 5 * 60_000;
        const p = this.world.player;
        this.stats.samples.push({ minutes: Math.round(this.minutes), baseLevel: p.baseLevel, jobLevel: p.jobLevel, jobId: p.jobId, area: this.area.label });
      }
      this.thinkMs -= F.TICK_MS;
      if (this.thinkMs <= 0) {
        this.thinkMs = 200;
        this.think();
      }
      this.world.tick();
      this.stats.areaMinutes[this.area.label] = (this.stats.areaMinutes[this.area.label] ?? 0) + F.TICK_MS / 60_000;
    }
  }

  private think(): void {
    const w = this.world;
    const p = w.player;
    if (p.dead) return;
    this.spendPoints();
    this.maybeChangeJob();
    this.sinceShop += 200;

    // Go home to sell and restock when heavy, out of potions for a while, or every 20 minutes.
    const hasLoot = [...p.inventory.keys()].some((id) => !POTIONS.includes(id) && id !== SP_POTION && w.content.items.get(id)?.type !== 'card') || p.gear.length > 0;
    if ((w.weightRatio() > 0.45 && hasLoot) || this.sinceShop > 20 * 60_000) return this.shop();

    // Hunt in the hardest area we're ready for, unless it killed us 3 times in the last 30 minutes.
    const tooHot = (map: string) => (this.recentDeaths.get(map) ?? []).filter((t) => w.time - t < 30 * 60_000).length >= 3;
    let idx = AREAS.findLastIndex((a) => p.baseLevel >= a.minLevel);
    if (idx > 0 && tooHot(AREAS[idx]!.map)) idx--;
    const want = AREAS[Math.max(0, idx)]!;
    if (want !== this.area || w.map.id !== want.map) {
      this.area = want;
      const map = w.content.maps.get(want.map)!;
      w.changeMap(want.map, map.playerStart);
      return;
    }

    const d = derivedStats(p);
    const hpFrac = p.hp / d.maxHp;
    // Heal: skill, then potion, then rest.
    if (this.build.heal && hpFrac < 0.6 && w.skillLevel(this.build.heal) > 0 && p.sp >= SKILLS[this.build.heal].spCost(w.skillLevel(this.build.heal))) {
      w.useSkill(this.build.heal);
      return;
    }
    const pot = [...POTIONS].reverse().find((id) => w.itemCount(id) > 0);
    if (hpFrac < 0.4 && pot) {
      w.useItem(pot);
      this.stats.potions++;
    }
    if (p.sp < d.maxSp * 0.15 && w.itemCount(SP_POTION) > 0 && this.build.attacks.some((s) => SKILLS[s].magic)) w.useItem(SP_POTION);
    const fighting = [...w.monsters.values()].some((m) => m.hostile && tileDistance(m.tile, p.tile) <= 3);
    // Swarmed and losing: escape with a Fly Wing.
    const swarm = [...w.monsters.values()].filter((m) => m.hostile && tileDistance(m.tile, p.tile) <= 3).length;
    if (hpFrac < 0.3 && swarm >= 2 && w.itemCount('fly_wing') > 0) {
      w.useItem('fly_wing');
      return;
    }
    if (this.resting) {
      if ((hpFrac > 0.95 && p.sp > d.maxSp * 0.8) || fighting) {
        this.resting = false;
        if (p.sitting) w.toggleSit();
      } else {
        if (!p.sitting && !p.next) w.toggleSit();
        return;
      }
    }
    if (!fighting && (hpFrac < 0.5 || (this.needsSp() && p.sp < d.maxSp * 0.25))) {
      this.resting = true;
      p.intent = { kind: 'none' };
      p.path = [];
      return;
    }

    for (const b of this.build.buffs) {
      const lv = w.skillLevel(b);
      if (lv > 0 && !p.buffs.has(b) && p.sp >= SKILLS[b].spCost(lv) + 20) {
        w.useSkill(b);
        return;
      }
    }

    // Loot when nothing is attacking.
    if (!fighting && p.intent.kind !== 'attack' && p.intent.kind !== 'skill') {
      const drop = [...w.drops.values()].find((dr) => tileDistance(dr.tile, p.tile) <= 6);
      if (drop && p.intent.kind !== 'pickup') {
        w.pickUp(drop.id);
        return;
      }
      if (p.intent.kind === 'pickup') return;
    }

    if (p.casting || p.intent.kind === 'skill') return;
    const target = this.pickTarget();
    if (!target) return;
    if (p.intent.kind !== 'attack' || p.intent.targetId !== target.id) w.attack(target.id);
    for (const s of this.build.attacks) {
      const lv = w.skillLevel(s);
      const skill = SKILLS[s];
      if (lv === 0 || (p.cooldowns.get(s) ?? 0) > 0 || p.sp < skill.spCost(lv)) continue;
      if (skill.magic?.only && !skill.magic.only.includes(target.def.element)) continue;
      // Spells only when the element doesn't backfire.
      if (skill.magic && F.elementModifier(skill.magic.element, target.def.element) < 1) continue;
      w.useSkill(s);
      return;
    }
  }

  private needsSp(): boolean {
    return this.build.attacks.some((s) => SKILLS[s].magic && this.world.skillLevel(s) > 0);
  }

  /** Whoever is attacking us, else the nearest monster. */
  private pickTarget(): Monster | null {
    const w = this.world;
    const p = w.player;
    let best: Monster | null = null;
    let score = Infinity;
    for (const m of w.monsters.values()) {
      const s = tileDistance(m.tile, p.tile) - (m.hostile ? 50 : 0) + (m.def.boss ? 1000 : 0);
      if (s < score) {
        best = m;
        score = s;
      }
    }
    return best;
  }

  private spendPoints(): void {
    const w = this.world;
    const p = w.player;
    const weights = this.build.stats;
    const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
    for (let guard = 0; guard < 100 && p.statPoints > 0; guard++) {
      const sum = Object.values(p.stats).reduce((a, b) => a + b, 0);
      let pick: StatName | null = null;
      let gap = -Infinity;
      for (const [stat, wgt] of Object.entries(weights) as Array<[StatName, number]>) {
        const g = (wgt / total) * sum - p.stats[stat];
        if (g > gap && p.stats[stat] < F.MAX_STAT) {
          gap = g;
          pick = stat;
        }
      }
      if (!pick || !w.raiseStat(pick)) break;
    }
    while (p.skillPoints > 0) {
      if (p.jobId === 'novice') {
        if (w.learnSkill('basic_training')) break;
        continue;
      }
      const i = this.skillQueue.findIndex((s) => !learnBlocker(p, s));
      if (i < 0) break;
      w.learnSkill(this.skillQueue[i]!);
      this.skillQueue.splice(i, 1);
    }
  }

  private maybeChangeJob(): void {
    const w = this.world;
    const p = w.player;
    const [first, second] = this.build.path;
    const to = p.jobId === 'novice' ? first : p.jobId === first ? second : null;
    if (!to) return;
    if (p.jobLevel < (p.jobId === 'novice' ? 10 : SECOND_JOB_LEVEL)) return;
    const before = p.jobId;
    w.applyAction({ type: 'changeJob', job: to });
    if (p.jobId !== before) {
      this.stats.jobChangeAt[to] = this.minutes;
      // Skills the new job can't learn yet were skipped; try the list again.
      this.skillQueue = this.build.skills.filter((s) => w.skillLevel(s) < SKILLS[s].maxLevel);
      this.shop();
    }
  }

  /** Back to town: sell loot, restock potions, buy better gear. */
  private shop(): void {
    const w = this.world;
    const p = w.player;
    this.sinceShop = 0;
    if (p.sitting) w.toggleSit();
    w.changeMap('town', w.content.maps.get('town')!.playerStart);
    const before = p.gold;
    for (const [id] of [...p.inventory]) {
      const item = w.content.items.get(id)!;
      // Keep potions and the odd card; sell everything else.
      if (item.type === 'etc' || (item.type === 'consumable' && !POTIONS.includes(id) && id !== SP_POTION)) w.sell(id, p.inventory.get(id)!);
    }
    for (const piece of [...p.gear]) w.sellPiece(piece.uid);
    this.stats.goldEarned += p.gold - before;
    this.buyGear();
    const spend = (id: string, want: number) => {
      const item = w.content.items.get(id)!;
      const n = Math.min(want - w.itemCount(id), Math.floor((p.gold * 0.4) / item.price));
      if (n > 0 && !w.buy(shopOf(w.content, id), id, n)) this.stats.goldSpent += item.price * n;
    };
    // The cheapest potion that heals at least a fifth of max HP, else the biggest one.
    const maxHp = derivedStats(p).maxHp;
    const pot = POTIONS.find((id) => w.content.items.get(id)!.heal!.hp >= maxHp / 5) ?? POTIONS[POTIONS.length - 1]!;
    spend(pot, 20);
    spend('fly_wing', 5);
    if (this.needsSp() && p.baseLevel >= 20) spend(SP_POTION, 5);
  }

  private buyGear(): void {
    const w = this.world;
    const p = w.player;
    const score = (it: ItemDef) => {
      const e = it.equip!;
      return e.slot === 'weapon' ? (this.needsSp() ? e.matk * 2 + e.atk : e.atk) : e.def * 10 + Object.values(e.bonus).reduce((a, b) => a + (b ?? 0), 0);
    };
    const offers = GEAR_SHOPS.flatMap((s) => w.content.shops.get(s)!.items.map((id) => w.content.items.get(id)!)).filter(
      (it) => it.equip && !equipBlocker(p, it),
    );
    for (const it of offers.sort((a, b) => score(b) - score(a))) {
      const slot = slotFor(p, it.equip!);
      const worn = p.equipment[slot];
      if (worn && score(worn.item) >= score(it)) continue;
      // A bow or staff-only build skips weapons that don't fit its skills.
      if (it.equip!.slot === 'weapon' && this.build.attacks.some((s) => SKILLS[s].needsWeapon && SKILLS[s].needsWeapon !== it.equip!.weaponType)) continue;
      if (it.equip!.slot === 'shield' && p.equipment.weapon?.item.equip?.twoHanded) continue;
      if (it.price > p.gold * 0.8) continue;
      if (!w.buy(shopOf(w.content, it.id), it.id, 1)) {
        this.stats.goldSpent += it.price;
        w.equip(it.id);
      }
    }
  }
}

function shopOf(content: Content, itemId: string): string {
  for (const s of content.shops.values()) if (s.items.includes(itemId)) return s.id;
  return 'tool_dealer';
}

export const BUILDS: Record<string, Build> = {
  knight: {
    path: ['swordsman', 'knight'],
    stats: { str: 5, vit: 3, agi: 3, dex: 1 },
    skills: [...Array(5).fill('bash'), ...Array(10).fill('sword_mastery'), ...Array(5).fill('hp_recovery'), ...Array(3).fill('endure'), ...Array(10).fill('magnum_break'), ...Array(5).fill('bash'), 'riding', ...Array(5).fill('two_hand_mastery'), ...Array(10).fill('pierce'), ...Array(10).fill('bowling_bash'), ...Array(10).fill('two_hand_quicken')],
    attacks: ['bowling_bash', 'pierce', 'bash'],
    buffs: ['two_hand_quicken'],
  },
  wizard: {
    path: ['mage', 'wizard'],
    stats: { int: 6, dex: 4, vit: 2 },
    skills: [...Array(10).fill('fire_bolt'), ...Array(10).fill('cold_bolt'), ...Array(10).fill('lightning_bolt'), ...Array(10).fill('sp_recovery'), ...Array(5).fill('soul_strike'), ...Array(3).fill('sight_rasher'), ...Array(10).fill('thunderstorm'), ...Array(10).fill('meteor_storm'), ...Array(7).fill('sight_rasher')],
    attacks: ['meteor_storm', 'thunderstorm', 'fire_bolt', 'cold_bolt', 'lightning_bolt', 'soul_strike'],
    buffs: [],
  },
  hunter: {
    path: ['archer', 'hunter'],
    stats: { dex: 6, agi: 4, int: 1, vit: 1 },
    skills: [...Array(10).fill('owls_eye'), ...Array(10).fill('double_strafe'), ...Array(10).fill('vultures_eye'), ...Array(5).fill('arrow_shower'), ...Array(10).fill('improve_concentration'), ...Array(5).fill('blitz_beat'), ...Array(10).fill('steel_crow'), ...Array(10).fill('claymore_trap')],
    attacks: ['claymore_trap', 'blitz_beat', 'double_strafe'],
    buffs: ['improve_concentration'],
  },
  priest: {
    path: ['acolyte', 'priest'],
    stats: { int: 5, vit: 3, str: 3, dex: 2 },
    skills: [...Array(5).fill('heal'), 'holy_light', ...Array(5).fill('divine_protection'), ...Array(10).fill('blessing'), ...Array(10).fill('increase_agi'), ...Array(4).fill('holy_light'), ...Array(5).fill('heal'), ...Array(5).fill('impositio_manus'), ...Array(10).fill('kyrie_eleison'), ...Array(10).fill('magnus_exorcismus')],
    attacks: ['magnus_exorcismus', 'holy_light'],
    buffs: ['blessing', 'increase_agi', 'impositio_manus', 'kyrie_eleison'],
    heal: 'heal',
  },
};

export function newRun(content: Content, build: Build, seed: number): Bot {
  const w = new World(content, content.maps.get('town')!, { seed, playerName: 'Bot', now: () => 0 });
  return new Bot(w, build);
}

export { JOBS };
