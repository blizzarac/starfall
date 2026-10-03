import { z } from 'zod';
import { ELEMENTS, SIZES } from '../core/combat/formulas';

const BonusSchema = z
  .object({
    str: z.number().int(),
    agi: z.number().int(),
    vit: z.number().int(),
    int: z.number().int(),
    dex: z.number().int(),
    luk: z.number().int(),
    hp: z.number().int(),
    sp: z.number().int(),
    hit: z.number().int(),
    flee: z.number().int(),
    atk: z.number().int(),
    matk: z.number().int(),
    def: z.number().int(),
  })
  .partial();
export type GearBonus = z.infer<typeof BonusSchema>;

export const EquipSchema = z
  .object({
    slot: z.enum(['weapon', 'shield', 'head', 'body', 'cloak', 'shoes', 'accessory']),
    atk: z.number().int().nonnegative().default(0),
    /** Magic attack, for staves. */
    matk: z.number().int().nonnegative().default(0),
    def: z.number().int().nonnegative().default(0),
    weaponType: z.enum(['dagger', 'sword', 'bow', 'staff', 'mace']).optional(),
    twoHanded: z.boolean().default(false),
    /** Jobs that can wear it; omit for everyone. */
    jobs: z.array(z.string()).optional(),
    minLevel: z.number().int().min(1).default(1),
    bonus: BonusSchema.default({}),
    /** Card slots, 0–4. */
    slots: z.number().int().min(0).max(4).default(0),
  })
  .refine((e) => (e.slot === 'weapon') === (e.weaponType !== undefined), 'weapons need a weaponType, and only weapons have one');
export type EquipDef = z.infer<typeof EquipSchema>;

const ElementMap = z.partialRecord(z.enum(ELEMENTS), z.number());
const SizeMap = z.partialRecord(z.enum(SIZES), z.number());

/** What a card does once slotted into gear. Percent values are fractions (0.15 = +15%). */
export const CardSchema = z.object({
  fits: z.enum(['weapon', 'shield', 'head', 'body', 'cloak', 'shoes', 'accessory']),
  bonus: BonusSchema.default({}),
  /** Extra damage dealt to monsters of these elements. */
  vsElement: ElementMap.default({}),
  /** Extra damage dealt to monsters of these sizes. */
  vsSize: SizeMap.default({}),
  /** Less damage taken from monsters of these elements. */
  resist: ElementMap.default({}),
});
export type CardDef = z.infer<typeof CardSchema>;

export const ItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    type: z.enum(['consumable', 'etc', 'card', 'equipment']),
    /** Base price in gold; NPCs buy at 50%. */
    price: z.number().int().nonnegative(),
    weight: z.number().int().nonnegative(),
    heal: z.object({ hp: z.number().int().nonnegative(), sp: z.number().int().nonnegative() }).optional(),
    /** Special use effect: random teleport on the current map, or return to the save point. */
    effect: z.enum(['teleport', 'return', 'tame']).optional(),
    /** For lures: the monster id this item tames. */
    tames: z.string().optional(),
    /** Status effects this item cures. */
    cure: z.array(z.enum(['poison', 'stun', 'blind'])).optional(),
    equip: EquipSchema.optional(),
    card: CardSchema.optional(),
    description: z.string().optional(),
  })
  .refine((i) => (i.type === 'equipment') === (i.equip !== undefined), 'equipment items (and only those) need an equip block')
  .refine((i) => (i.type === 'card') === (i.card !== undefined), 'cards (and only cards) need a card block')
  .refine((i) => (i.effect === 'tame') === (i.tames !== undefined), 'lures (and only lures) name the monster they tame');
export type ItemDef = z.infer<typeof ItemSchema>;

export const DropSchema = z.object({
  item: z.string(),
  /** Independent chance per kill, 0–1. */
  chance: z.number().gt(0).max(1),
});

const InflictSchema = z.object({
  status: z.enum(['poison', 'stun', 'blind']),
  /** Chance per hit, before the player's resistance. */
  chance: z.number().gt(0).max(1),
  durationMs: z.number().int().positive(),
});

export const MonsterSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  level: z.number().int().min(1).max(150),
  hp: z.number().int().positive(),
  atk: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  def: z.number().int().nonnegative(),
  hit: z.number().int().nonnegative(),
  flee: z.number().int().nonnegative(),
  element: z.enum(ELEMENTS),
  size: z.enum(SIZES),
  attackDelayMs: z.number().int().positive(),
  attackRange: z.number().int().min(1),
  moveMs: z.number().int().positive(),
  ai: z.object({
    /** Passive monsters never start a fight but always hit back. */
    aggressive: z.boolean(),
    aggroRange: z.number().int().nonnegative(),
    chaseRange: z.number().int().positive(),
    wanderRadius: z.number().int().nonnegative(),
  }),
  baseXp: z.number().int().nonnegative(),
  jobXp: z.number().int().nonnegative(),
  drops: z.array(DropSchema),
  /** Placeholder look until sprite sheets exist. */
  look: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    scale: z.number().positive(),
    shape: z
      .enum(['blob', 'beetle', 'sprout', 'boar', 'wolf', 'mushroom', 'bat', 'golem', 'crab', 'bird', 'scorpion', 'worm', 'skeleton', 'mummy', 'pharaoh', 'drone', 'automaton', 'titan'])
      .default('blob'),
  }),
  /** A status effect this monster's normal attacks may cause. */
  inflict: InflictSchema.optional(),
  /** Area bosses (MVPs): one at a time, long real-time respawn, announced. */
  boss: z.boolean().default(false),
  /** A telegraphed area attack used while fighting. */
  special: z
    .object({
      kind: z.literal('slam'),
      everyMs: z.number().int().positive(),
      windupMs: z.number().int().nonnegative(),
      radius: z.number().int().positive(),
      modifier: z.number().positive(),
      inflict: InflictSchema.optional(),
    })
    .optional(),
  /**
   * Boss phases, in order: each starts when HP drops below `belowHp` (a
   * fraction), with a shout, harder or faster attacks, a changed slam and
   * minions called in. Effects stack: later phases build on earlier ones.
   */
  phases: z
    .array(
      z.object({
        belowHp: z.number().gt(0).lt(1),
        shout: z.string(),
        /** Multiplies attack damage. */
        atkMul: z.number().positive().default(1),
        /** Multiplies the time between attacks (below 1 is faster). */
        delayMul: z.number().positive().default(1),
        slamRadius: z.number().int().positive().optional(),
        slamEveryMs: z.number().int().positive().optional(),
        summon: z.object({ monster: z.string(), count: z.number().int().positive() }).optional(),
      }),
    )
    .default([]),
});
export type MonsterDef = z.infer<typeof MonsterSchema>;

const TileSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

/** Terrain legend for map rows. */
export const TERRAIN_CHARS = {
  '.': 'grass',
  ',': 'flower',
  '=': 'path',
  ':': 'cobble',
  T: 'tree',
  R: 'rock',
  '~': 'water',
  '#': 'wall',
  X: 'cavewall',
  _: 'sand',
  '+': 'plank',
  P: 'palm',
  W: 'ruin',
  M: 'machine',
} as const;

const PlaceSchema = z.object({ map: z.string(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

export const NpcSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  dialogue: z.string(),
  look: z.object({ body: z.string().regex(/^#[0-9a-f]{6}$/i), hair: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  /** How it's drawn: a person, or a notice board. */
  sprite: z.enum(['chibi', 'board']).default('chibi'),
});
export type NpcDef = z.infer<typeof NpcSchema>;

/** Stepping on any tile of `area` warps to `to`. */
export const PortalSchema = z.object({
  area: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }),
  to: PlaceSchema,
});
export type PortalDef = z.infer<typeof PortalSchema>;

export const MapSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['town', 'field', 'dungeon']),
    /** Two alternating grass shades, so each field has its own feel. */
    grass: z.tuple([z.string().regex(/^#[0-9a-f]{6}$/i), z.string().regex(/^#[0-9a-f]{6}$/i)]).optional(),
    /** Suggested as a training ground by the next-goal hint (boss lairs aren't). */
    hunt: z.boolean().default(true),
    /** Background tune; defaults by kind (town, field, cave). */
    music: z.enum(['title', 'town', 'harbor', 'field', 'forest', 'cave', 'desert']).optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    rows: z.array(z.string()),
    playerStart: TileSchema,
    savePoint: TileSchema,
    spawns: z.array(
      z.object({
        monster: z.string(),
        count: z.number().int().positive(),
        respawnMs: z.number().int().positive(),
        area: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }),
      }),
    ),
    npcs: z.array(NpcSchema).default([]),
    portals: z.array(PortalSchema).default([]),
  })
  .superRefine((m, ctx) => {
    if (m.rows.length !== m.height) {
      ctx.addIssue({ code: 'custom', message: `expected ${m.height} rows, got ${m.rows.length}` });
    }
    m.rows.forEach((row, y) => {
      if (row.length !== m.width) {
        ctx.addIssue({ code: 'custom', path: ['rows', y], message: `expected ${m.width} columns, got ${row.length}` });
      }
      for (const ch of row) {
        if (!(ch in TERRAIN_CHARS)) {
          ctx.addIssue({ code: 'custom', path: ['rows', y], message: `unknown terrain '${ch}'` });
        }
      }
    });
  });
export type MapDef = z.infer<typeof MapSchema>;

// ---- Dialogue -------------------------------------------------------------

/** All listed checks must pass. */
export const ConditionSchema = z.object({
  job: z.string().optional(),
  jobLevelMin: z.number().int().optional(),
  skillMin: z.object({ id: z.string(), level: z.number().int().positive() }).optional(),
  hasItem: z.object({ id: z.string(), count: z.number().int().positive() }).optional(),
  /** The player has been to this map before. */
  visited: z.string().optional(),
  /** The player is not on this map right now (hides a teleport to where you already are). */
  notMap: z.string().optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setSavePoint') }),
  z.object({ type: z.literal('heal') }),
  z.object({ type: z.literal('openShop'), shop: z.string() }),
  z.object({ type: z.literal('openRefine') }),
  z.object({ type: z.literal('openQuests') }),
  z.object({ type: z.literal('takeItem'), id: z.string(), count: z.number().int().positive() }),
  z.object({ type: z.literal('giveItem'), id: z.string(), count: z.number().int().positive() }),
  z.object({ type: z.literal('changeJob'), job: z.string() }),
  /** Opens the shared storage for a fee. */
  z.object({ type: z.literal('openStorage'), fee: z.number().int().nonnegative() }),
  /** Opens the tinkerer's crafting bench. */
  z.object({ type: z.literal('openCraft') }),
  /** Teleports for a fee. */
  z.object({ type: z.literal('warp'), map: z.string(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), cost: z.number().int().nonnegative() }),
]);
export type DialogueAction = z.infer<typeof ActionSchema>;

const ChoiceSchema = z.object({
  label: z.string(),
  /** Node to show next; omit to end the conversation. */
  next: z.string().optional(),
  do: z.array(ActionSchema).default([]),
  /** Choice is hidden unless this holds. */
  if: ConditionSchema.optional(),
});

/** A line of text with choices, or an invisible branch that picks the next node. */
const NodeSchema = z.union([
  z.object({ text: z.string(), choices: z.array(ChoiceSchema).default([]) }),
  z.object({ branch: z.array(z.object({ if: ConditionSchema, next: z.string() })), else: z.string() }),
]);
export type DialogueNode = z.infer<typeof NodeSchema>;

export const DialogueSchema = z.object({
  id: z.string(),
  nodes: z.record(z.string(), NodeSchema).refine((n) => 'start' in n, 'needs a start node'),
});
export type DialogueDef = z.infer<typeof DialogueSchema>;

export const ShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(z.string()).min(1),
});
export type ShopDef = z.infer<typeof ShopSchema>;

// ---- Quests ---------------------------------------------------------------

export const QuestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  description: z.string(),
  minLevel: z.number().int().min(1).default(1),
  repeatable: z.boolean().default(true),
  target: z.object({ monster: z.string(), count: z.number().int().positive() }),
  reward: z.object({
    gold: z.number().int().nonnegative().default(0),
    baseXp: z.number().int().nonnegative().default(0),
    jobXp: z.number().int().nonnegative().default(0),
    items: z.array(z.object({ id: z.string(), count: z.number().int().positive() })).default([]),
  }),
});
export type QuestDef = z.infer<typeof QuestSchema>;

// ---- Crafting -------------------------------------------------------------

/** A tinkerer's recipe: materials and gold in, `count` of `result` out. */
export const RecipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  result: z.string(),
  count: z.number().int().positive().default(1),
  materials: z.array(z.object({ item: z.string(), count: z.number().int().positive() })).min(1),
  gold: z.number().int().nonnegative(),
});
export type RecipeDef = z.infer<typeof RecipeSchema>;
