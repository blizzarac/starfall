import { z } from 'zod';
import { ELEMENTS, SIZES } from '../core/combat/formulas';

export const ItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  type: z.enum(['consumable', 'etc', 'card', 'equipment']),
  /** Base price in gold; NPCs buy at 50%. */
  price: z.number().int().nonnegative(),
  weight: z.number().int().nonnegative(),
  heal: z.object({ hp: z.number().int().nonnegative(), sp: z.number().int().nonnegative() }).optional(),
});
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
  look: z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/i), scale: z.number().positive() }),
});
export type MonsterDef = z.infer<typeof MonsterSchema>;

const TileSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

/** Terrain legend for map rows. */
export const TERRAIN_CHARS = {
  '.': 'grass',
  ',': 'flower',
  '=': 'path',
  T: 'tree',
  R: 'rock',
  '~': 'water',
} as const;

export const MapSchema = z
  .object({
    id: z.string(),
    name: z.string(),
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
