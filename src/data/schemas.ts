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
  })
  .partial();
export type GearBonus = z.infer<typeof BonusSchema>;

export const EquipSchema = z
  .object({
    slot: z.enum(['weapon', 'shield', 'head', 'body', 'cloak', 'shoes', 'accessory']),
    atk: z.number().int().nonnegative().default(0),
    def: z.number().int().nonnegative().default(0),
    weaponType: z.enum(['dagger', 'sword', 'bow', 'staff']).optional(),
    twoHanded: z.boolean().default(false),
    /** Jobs that can wear it; omit for everyone. */
    jobs: z.array(z.string()).optional(),
    minLevel: z.number().int().min(1).default(1),
    bonus: BonusSchema.default({}),
  })
  .refine((e) => (e.slot === 'weapon') === (e.weaponType !== undefined), 'weapons need a weaponType, and only weapons have one');
export type EquipDef = z.infer<typeof EquipSchema>;

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
    effect: z.enum(['teleport', 'return']).optional(),
    equip: EquipSchema.optional(),
    description: z.string().optional(),
  })
  .refine((i) => (i.type === 'equipment') === (i.equip !== undefined), 'equipment items (and only those) need an equip block');
export type ItemDef = z.infer<typeof ItemSchema>;

export const DropSchema = z.object({
  item: z.string(),
  /** Independent chance per kill, 0–1. */
  chance: z.number().gt(0).max(1),
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
    shape: z.enum(['blob', 'beetle', 'sprout', 'boar']).default('blob'),
  }),
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
} as const;

const PlaceSchema = z.object({ map: z.string(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

export const NpcSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  dialogue: z.string(),
  look: z.object({ body: z.string().regex(/^#[0-9a-f]{6}$/i), hair: z.string().regex(/^#[0-9a-f]{6}$/i) }),
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
    kind: z.enum(['town', 'field']),
    /** Two alternating grass shades, so each field has its own feel. */
    grass: z.tuple([z.string().regex(/^#[0-9a-f]{6}$/i), z.string().regex(/^#[0-9a-f]{6}$/i)]).optional(),
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
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setSavePoint') }),
  z.object({ type: z.literal('heal') }),
  z.object({ type: z.literal('openShop'), shop: z.string() }),
  z.object({ type: z.literal('takeItem'), id: z.string(), count: z.number().int().positive() }),
  z.object({ type: z.literal('giveItem'), id: z.string(), count: z.number().int().positive() }),
  z.object({ type: z.literal('changeJob'), job: z.string() }),
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
