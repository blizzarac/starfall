/**
 * Pixel-art monsters with a techno-fantasy twist: glowing cores, cyber eyes,
 * metal tusks and claws. Each species gets a sprite sheet in its own color
 * with idle, move and attack animations, painted from simple poses.
 * Monsters face right; left-facing ones are flipped.
 */
import Phaser from 'phaser';
import type { MonsterDef } from '../data/schemas';
import { mix, Pix, ramp, type Ramp } from './pix';

export type Shape = MonsterDef['look']['shape'];
export type MonsterAnim = 'idle' | 'move' | 'attack';

export const MON_W = 48;
export const MON_H = 44;
const FY = 40;
const CX = 22;
/** World units per art pixel for monsters and props. */
export const WORLD_PX = 2;

const ANIMS: ReadonlyArray<{ name: MonsterAnim; frames: number; rate: number; repeat: number }> = [
  { name: 'idle', frames: 4, rate: 5, repeat: -1 },
  { name: 'move', frames: 4, rate: 9, repeat: -1 },
  { name: 'attack', frames: 3, rate: 12, repeat: 0 },
];

const INK = 0x16111e;
const STEEL = ramp(0x9ba6bc);
const DARK = ramp(0x3e3a4c);
const CYAN = 0x6ff2ff;
const RED = 0xff4a4a;

export const monsterKey = (shape: Shape, color: number) => `mon-${shape}-${color.toString(16)}`;
export const monsterAnimKey = (key: string, anim: MonsterAnim) => `${key}:${anim}`;
/** Origin Y that stands a monster frame on its feet. */
export const MON_ORIGIN_Y = (FY + 0.5) / MON_H;

/** Paints the sheet for a monster shape in a color and registers its animations (once). */
export function ensureMonster(scene: Phaser.Scene, shape: Shape, color: number): string {
  const key = monsterKey(shape, color);
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  canvas.width = MON_W * 4;
  canvas.height = MON_H * ANIMS.length;
  const ctx = canvas.getContext('2d')!;
  const frames: Array<{ name: string; x: number; y: number }> = [];
  ANIMS.forEach((a, row) => {
    for (let i = 0; i < a.frames; i++) {
      paintMonster(shape, color, a.name, i).blit(ctx, i * MON_W, row * MON_H);
      frames.push({ name: `${a.name}-${i}`, x: i * MON_W, y: row * MON_H });
    }
  });
  const tex = scene.textures.addCanvas(key, canvas)!;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (const f of frames) tex.add(f.name, 0, f.x, f.y, MON_W, MON_H);
  for (const a of ANIMS) {
    const k = monsterAnimKey(key, a.name);
    if (scene.anims.exists(k)) continue;
    scene.anims.create({
      key: k,
      frames: Array.from({ length: a.frames }, (_, i) => ({ key, frame: `${a.name}-${i}` })),
      frameRate: a.rate,
      repeat: a.repeat,
    });
  }
  return key;
}

/** One standing frame as a plain canvas (for static uses like the courier bird). */
export function monsterFrameCanvas(shape: Shape, color: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MON_W;
  canvas.height = MON_H;
  paintMonster(shape, color, 'idle', 0).blit(canvas.getContext('2d')!, 0, 0);
  return canvas;
}

interface MPose {
  i: number;
  bob: number;
  /** Squash: >1 wider and flatter. */
  sq: number;
  /** Walk cycle, -1..1. */
  step: number;
  lunge: number;
  open: boolean;
  /** Wing beat, -1 (down) .. 1 (up). */
  wing: number;
  /** Attack wind-up, 0..1. */
  raise: number;
}

function mpose(anim: MonsterAnim, i: number): MPose {
  const p: MPose = { i, bob: 0, sq: 1, step: 0, lunge: 0, open: false, wing: [1, 0, -1, 0][i % 4]!, raise: 0 };
  if (anim === 'idle') {
    p.bob = i >= 2 ? 1 : 0;
    p.sq = [1, 1.04, 1.08, 1.04][i]!;
  } else if (anim === 'move') {
    p.step = [0, 1, 0, -1][i]!;
    p.bob = [0, -1, 0, -1][i]!;
    p.sq = [1.08, 0.94, 1.08, 0.94][i]!;
  } else {
    Object.assign(p, [
      { lunge: -1, sq: 0.9, raise: 1, wing: 1 },
      { lunge: 3, sq: 1.12, open: true, raise: 0, wing: -1 },
      { lunge: 1, sq: 1, raise: 0.3, wing: 0 },
    ][i]!);
  }
  return p;
}

function paintMonster(shape: Shape, color: number, anim: MonsterAnim, i: number): Pix {
  const p = new Pix(MON_W, MON_H);
  const f = mpose(anim, i);
  const r = ramp(color);
  PAINTERS[shape](p, r, f);
  p.outline(INK);
  // Attack effects glow, so they're drawn after the outline.
  if (shape === 'mushroom' && anim === 'attack' && i === 1) {
    for (const [x, y] of [[14, -9], [17, -12], [19, -7], [21, -11], [16, -5], [23, -8]] as const) p.set(CX + x, FY + y, mix(r.l, 0xffffff, 0.5));
  }
  return p;
}

type Painter = (p: Pix, r: Ramp, f: MPose) => void;

/** Two-pixel-tall eye with a shine on top. */
function eye(p: Pix, x: number, y: number, c = INK): void {
  p.set(x, y, 0xffffff);
  p.set(x, y + 1, c);
  p.set(x + 1, y, c);
  p.set(x + 1, y + 1, c);
}

/** A shaded ellipse body: base, darker lower part, light patch upper-left, one specular pixel. */
function body(p: Pix, cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
  p.ellipse(cx, cy, rx, ry, r.b);
  p.ellipse(cx, cy, rx, ry, r.d, (_x, y) => y > cy + ry * 0.4);
  p.ellipse(cx - rx * 0.35, cy - ry * 0.4, Math.max(1, rx * 0.4), Math.max(1, ry * 0.32), r.l);
  p.set(cx - rx * 0.5, cy - ry * 0.55, r.h);
}

function legs(p: Pix, xs: number[], top: number, f: MPose, c: number, len: number, w = 2): void {
  xs.forEach((x, k) => {
    const s = k % 2 === 0 ? f.step : -f.step;
    const lift = s > 0.5 ? 1 : 0;
    p.line(x, top, x + s, top + len - lift, c, w);
  });
}

const PAINTERS: Record<Shape, Painter> = {
  blob(p, r, f) {
    const rx = 10 * f.sq;
    const ry = 8 / f.sq;
    const cx = CX + f.lunge;
    const cy = FY - ry + 0.5 + Math.min(0, f.bob) * 2;
    body(p, cx, cy, rx, ry, r);
    // A glowing nucleus floats inside.
    p.rect(cx - 3, cy + 1, 2, 2, mix(r.l, CYAN, 0.55));
    p.set(cx - 3, cy + 1, mix(0xffffff, CYAN, 0.3));
    const ex = cx + 2;
    eye(p, ex - 4, cy - 3);
    eye(p, ex + 1, cy - 3);
    if (f.open) p.rect(ex - 2, cy + 1, 3, 2, 0x5a1a2a);
    else for (const [x, y] of [[-2, 1], [-1, 2], [0, 2], [1, 1]] as const) p.set(ex + x, cy + y, INK);
  },

  beetle(p, r, f) {
    const cx = CX + f.lunge;
    const top = FY - 4;
    legs(p, [cx - 7, cx - 3, cx + 2, cx + 6], top, f, DARK.b, 4, 1);
    const cy = FY - 7 + f.bob;
    body(p, cx - 1, cy, 11, 6.5, r);
    // Armored shell with a glowing seam.
    for (let y = cy - 6; y <= cy + 5; y++) p.tint(cx - 1, Math.round(y), (Math.round(y) + f.i) % 2 ? mix(r.l, 0xffc84a, 0.6) : r.k);
    for (let x = cx - 9; x <= cx + 7; x++) p.tint(x, Math.round(cy - 3), r.l);
    p.ellipse(cx + 10, cy + 1, 3.5, 3, DARK.b);
    p.set(cx + 11, cy, 0xffc84a);
    p.line(cx + 12, cy - 1, cx + 15, cy - 5 - f.raise * 2, STEEL.l, 2);
    p.line(cx + 9, cy - 2, cx + 8, cy - 6, DARK.l);
  },

  sprout(p, r, f) {
    const cx = CX + f.lunge;
    const cy = FY - 7 + Math.min(0, f.bob) * 2 + 0.5;
    p.rect(cx - 5 + f.step, FY - 1, 3, 1, r.d);
    p.rect(cx + 2 - f.step, FY - 1, 3, 1, r.d);
    body(p, cx, cy, 8 * f.sq, 7 / f.sq, r);
    const leaf = ramp(0x3fae4f);
    const sx = cx;
    const sy = cy - 7 / f.sq;
    const sway = f.raise * 3 + (f.i % 2);
    p.line(sx, sy, sx, sy - 3, leaf.d);
    p.poly([[sx, sy - 3], [sx - 8, sy - 6 - sway], [sx - 3, sy - 1]], leaf.b);
    p.poly([[sx, sy - 3], [sx + 8, sy - 6 - sway], [sx + 3, sy - 1]], leaf.l);
    p.set(sx - 4, sy - 4, mix(leaf.l, 0xc8ff8a, 0.7));
    p.set(sx + 4, sy - 4, mix(leaf.h, 0xc8ff8a, 0.7));
    p.rect(cx + 1, cy - 1, 1, 2, INK);
    p.rect(cx + 5, cy - 1, 1, 2, INK);
    p.set(cx - 1, cy + 2, mix(r.b, 0xff7a8a, 0.5));
    p.set(cx + 7, cy + 2, mix(r.b, 0xff7a8a, 0.5));
    if (f.open) p.rect(cx + 2, cy + 2, 3, 2, 0x5a1a2a);
  },

  boar(p, r, f) {
    const cx = CX - 1 + f.lunge;
    const by = FY - 9 + f.bob;
    legs(p, [cx - 9, cx - 5, cx + 4, cx + 8], FY - 5, f, r.k, 5, 2);
    body(p, cx - 1, by, 12, 6, r);
    for (let x = cx - 9; x <= cx + 5; x += 2) p.rect(x, by - 7, 1, 2, r.k);
    const hy = by + 1 + (f.open ? 1 : 0);
    p.ellipse(cx + 10, hy, 5, 4.5, r.b);
    p.ellipse(cx + 10, hy, 5, 4.5, r.d, (_x, y) => y > hy + 2);
    p.poly([[cx + 8, hy - 3], [cx + 9, hy - 7], [cx + 11, hy - 3]], r.d);
    p.rect(cx + 14, hy - 1, 3, 3, mix(r.l, 0xffb0a0, 0.55));
    p.set(cx + 16, hy, INK);
    // Steel tusk and a cybernetic eye.
    p.line(cx + 13, hy + 2, cx + 15, hy - 1, STEEL.h, 1);
    p.set(cx + 15, hy - 1, CYAN);
    p.set(cx + 11, hy - 2, RED);
    // Tech collar.
    p.line(cx + 6, by - 5, cx + 6, by + 4, DARK.b, 2);
    p.set(cx + 6, by - 1, CYAN);
  },

  wolf(p, r, f) {
    const cx = CX - 1 + f.lunge;
    const by = FY - 11 + f.bob;
    legs(p, [cx - 8, cx - 5, cx + 4, cx + 7], FY - 7, f, r.d, 7, 2);
    p.poly([[cx - 9, by - 1], [cx - 16, by - 6 - f.raise * 2], [cx - 15, by - 3], [cx - 10, by + 2]], r.d);
    p.set(cx - 16, by - 6 - f.raise * 2, r.l);
    p.ellipse(cx - 1, by, 10, 4.5, r.b);
    p.ellipse(cx - 1, by, 10, 4.5, r.l, (_x, y) => y > by + 1.5);
    p.ellipse(cx - 1, by, 10, 4.5, r.d, (_x, y) => y < by - 2.5);
    const hx = cx + 9;
    const hy = by - 3;
    p.ellipse(hx, hy, 4.5, 4, r.b);
    p.poly([[hx + 2, hy - 1], [hx + 8, hy + 1], [hx + 8, hy + 2.5], [hx + 2, hy + 3]], r.b);
    if (f.open) {
      p.poly([[hx + 2, hy + 3], [hx + 7, hy + 6], [hx + 2, hy + 5]], r.d);
      p.set(hx + 5, hy + 4, 0x8a1a2a);
      p.set(hx + 6, hy + 3, 0xffffff);
    }
    p.set(hx + 8, hy + 1, INK);
    p.poly([[hx - 3, hy - 3], [hx - 2, hy - 8], [hx, hy - 3]], r.d);
    p.poly([[hx, hy - 3], [hx + 2, hy - 8], [hx + 3, hy - 3]], r.b);
    // Cyber eye under a steel plate.
    p.rect(hx, hy - 2, 3, 1, STEEL.l);
    p.set(hx + 1, hy - 1, CYAN);
  },

  mushroom(p, r, f) {
    const cx = CX + f.lunge;
    const lift = Math.min(0, f.bob) * 2;
    const stalk = ramp(0xf4e6cc);
    p.rect(cx - 6 + f.step, FY - 1, 3, 1, stalk.d);
    p.rect(cx + 3 - f.step, FY - 1, 3, 1, stalk.d);
    p.rect(cx - 4, FY - 9 + lift, 8, 8, stalk.b);
    p.rect(cx + 2, FY - 9 + lift, 2, 8, stalk.d);
    p.rect(cx - 1, FY - 6 + lift, 1, 2, INK);
    p.rect(cx + 2, FY - 6 + lift, 1, 2, INK);
    const cy = FY - 11 + lift + f.bob;
    const rx = 12 * f.sq;
    const ry = 6.5 / f.sq;
    p.ellipse(cx, cy, rx, ry, r.b, (_x, y) => y <= cy + 2);
    p.ellipse(cx, cy, rx, ry, r.d, (x, y) => y <= cy + 2 && (y > cy || x > cx + rx * 0.6));
    p.ellipse(cx - rx * 0.3, cy - ry * 0.45, rx * 0.4, ry * 0.3, r.l);
    for (let x = Math.round(cx - rx + 2); x <= cx + rx - 2; x++) p.tint(x, Math.round(cy + 2), r.k);
    // Bioluminescent spots.
    for (const [sx, sy] of [[-6, -1], [0, -4], [5, -1], [-2, 1]] as const) {
      p.ellipse(cx + sx, cy + sy, 1.6, 1.2, mix(r.b, 0xffffff, 0.75));
      p.set(cx + sx, cy + sy, f.open ? 0xffffff : mix(0xffffff, CYAN, 0.35));
    }
  },

  bat(p, r, f) {
    const cx = CX + f.lunge;
    const cy = FY - 17 + f.bob * 2 + (f.open ? 4 : 0);
    const w = f.wing * 5;
    p.poly([[cx - 2, cy - 1], [cx - 14, cy - 4 - w], [cx - 12, cy + 2 - w / 2], [cx - 8, cy + 1], [cx - 5, cy + 4]], r.d);
    p.line(cx - 4, cy, cx - 12, cy - 3 - w, r.k);
    body(p, cx, cy, 4.5, 4.5, r);
    p.poly([[cx - 3, cy - 3], [cx - 2, cy - 8], [cx, cy - 3]], r.b);
    p.poly([[cx, cy - 3], [cx + 2, cy - 8], [cx + 3, cy - 3]], r.b);
    p.set(cx + 2, cy - 9, CYAN);
    p.poly([[cx + 2, cy - 1], [cx + 14, cy - 4 - w], [cx + 12, cy + 2 - w / 2], [cx + 8, cy + 1], [cx + 5, cy + 4]], r.b);
    p.line(cx + 4, cy, cx + 12, cy - 3 - w, r.d);
    p.set(cx - 1, cy - 1, RED);
    p.set(cx + 2, cy - 1, RED);
    if (f.open) {
      p.set(cx, cy + 2, 0xffffff);
      p.set(cx + 2, cy + 2, 0xffffff);
    }
  },

  golem(p, r, f) {
    const cx = CX + f.lunge;
    const by = FY - 19 + f.bob;
    p.rect(cx - 6, FY - 7 - (f.step > 0 ? 1 : 0), 4, 7, r.k);
    p.rect(cx + 2, FY - 7 - (f.step < 0 ? 1 : 0), 4, 7, r.k);
    p.rect(cx - 8, by, 16, 13, r.b);
    p.rect(cx + 4, by, 4, 13, r.d);
    p.rect(cx - 8, by, 16, 1, r.l);
    p.rect(cx - 8, by + 12, 16, 1, r.d);
    p.line(cx - 5, by + 3, cx - 3, by + 7, r.k);
    p.line(cx + 2, by + 8, cx + 5, by + 10, r.k);
    // Crystal core.
    const core = mix(r.l, CYAN, 0.5);
    p.rect(cx - 2, by + 4, 3, 3, core);
    p.set(cx - 2, by + 4, 0xffffff);
    p.rect(cx - 4, by - 6, 8, 6, r.l);
    p.rect(cx + 1, by - 6, 3, 6, r.b);
    p.set(cx - 1, by - 4, CYAN);
    p.set(cx + 2, by - 4, CYAN);
    const arm = Math.round(f.raise * -8 + (f.open ? 3 : 0));
    for (const ax of [cx - 13, cx + 8]) {
      p.rect(ax, by + 1 + arm, 5, 10, ax < cx ? r.d : r.b);
      p.rect(ax, by + 1 + arm, 5, 1, r.l);
      p.poly([[ax + 1, by + 1 + arm], [ax + 2.5, by - 4 + arm], [ax + 4, by + 1 + arm]], mix(r.h, CYAN, 0.35));
    }
  },

  crab(p, r, f) {
    const cx = CX + f.lunge;
    const cy = FY - 6 + f.bob;
    legs(p, [cx - 8, cx - 5, cx - 2, cx + 2, cx + 5, cx + 8], FY - 4, f, r.d, 4, 1);
    body(p, cx, cy, 9, 5, r);
    for (const sx of [-1, 1]) {
      const kx = cx + sx * 12;
      const ky = cy - 5 - f.raise * 3;
      p.line(cx + sx * 7, cy - 1, kx, ky + 2, r.d, 2);
      p.ellipse(kx, ky, 3.5, 3, r.b);
      p.ellipse(kx, ky, 3.5, 3, r.d, (_x, y) => y > ky + 1);
      // Steel pincer tips, open when striking.
      const gap = f.open ? 2 : 0;
      p.line(kx + sx * 2, ky - 2 - gap, kx + sx * 5, ky - 3 - gap, STEEL.l, 2);
      p.line(kx + sx * 2, ky - 1 + gap, kx + sx * 5, ky - 1 + gap, STEEL.b, 1);
    }
    p.line(cx - 2, cy - 4, cx - 2, cy - 8, r.b);
    p.line(cx + 2, cy - 4, cx + 2, cy - 8, r.b);
    eye(p, cx - 3, cy - 10);
    eye(p, cx + 2, cy - 10);
    p.line(cx - 1, cy + 1, cx + 1, cy + 1, INK);
  },

  bird(p, r, f) {
    const cx = CX + f.lunge;
    const cy = FY - 17 + f.bob * 2 + (f.open ? 3 : 0);
    const w = f.wing * 5;
    const orange = 0xffb03a;
    p.poly([[cx - 2, cy - 1], [cx - 14, cy - 5 - w], [cx - 12, cy - 1 - w / 2], [cx - 4, cy + 3]], r.d);
    p.line(cx - 13, cy - 4 - w, cx - 10, cy - 3 - w, STEEL.l);
    body(p, cx, cy, 6, 4.5, r);
    p.ellipse(cx + 5, cy - 2, 3.5, 3, r.b);
    p.poly([[cx + 8, cy - 3], [cx + 12, cy - 1], [cx + 8, cy]], orange);
    p.set(cx + 6, cy - 3, INK);
    p.poly([[cx + 1, cy - 1], [cx + 13, cy - 5 - w], [cx + 11, cy - 1 - w / 2], [cx + 3, cy + 3]], r.l);
    p.line(cx + 12, cy - 4 - w, cx + 9, cy - 3 - w, STEEL.h);
    p.line(cx - 1, cy + 4, cx - 1, cy + 6, orange);
    p.line(cx + 2, cy + 4, cx + 2, cy + 6, orange);
  },

  scorpion(p, r, f) {
    const cx = CX - 1 + f.lunge;
    const cy = FY - 5 + f.bob;
    legs(p, [cx - 6, cx - 3, cx, cx + 3], FY - 4, f, r.d, 4, 1);
    body(p, cx, cy, 9, 3.5, r);
    for (let x = cx - 6; x <= cx + 6; x += 3) p.line(x, cy - 3, x, cy + 2, r.d);
    // Pincers reach out when striking.
    const reach = f.open ? 4 : 0;
    p.line(cx + 8, cy, cx + 12 + reach, cy - 2, r.d, 2);
    p.ellipse(cx + 14 + reach, cy - 2, 2.5, 2, r.b);
    p.set(cx + 16 + reach, cy - 3, STEEL.l);
    p.set(cx + 16 + reach, cy - 1, STEEL.l);
    // Tail curls over the back; the stinger strikes forward.
    const k = f.open ? 1 : 0;
    const seg: Array<[number, number]> = [[cx - 10, cy - 2], [cx - 13, cy - 6], [cx - 12, cy - 10], [cx - 8 + k * 4, cy - 13 + k], [cx - 4 + k * 9, cy - 13 + k * 3]];
    seg.forEach(([x, y], n) => p.ellipse(x, y, 2.2 - n * 0.15, 2.2 - n * 0.15, n % 2 ? r.d : r.b));
    const [tx, ty] = seg[seg.length - 1]!;
    p.line(tx + 1, ty + 1, tx + 3, ty + 3, 0x9dff5e, 1);
    p.set(tx + 3, ty + 3, 0xd8ffb0);
    p.set(cx + 5, cy - 2, INK);
    p.set(cx + 7, cy - 2, INK);
  },

  worm(p, r, f) {
    const cx = CX + f.lunge;
    const h = 17 + f.bob * -2 + (f.open ? 4 : 0) + f.raise * 2;
    p.ellipse(cx, FY - 1, 11, 2.6, mix(r.d, 0x8a6a40, 0.5));
    const lean = f.open ? 3 : f.step;
    p.poly([[cx - 5, FY - 1], [cx + 5, FY - 1], [cx + 4 + lean, FY - 1 - h], [cx - 4 + lean, FY - 1 - h]], r.b);
    p.poly([[cx + 2, FY - 1], [cx + 5, FY - 1], [cx + 4 + lean, FY - 1 - h], [cx + 1 + lean, FY - 1 - h]], r.d);
    for (let y = FY - 5; y > FY - h; y -= 4) {
      const t = (FY - 1 - y) / h;
      p.line(cx - 4 + lean * t, y, cx + 4 + lean * t, y, r.k);
    }
    const hx = cx + lean;
    const hy = FY - 1 - h;
    p.ellipse(hx, hy, 6, 4.5, r.b);
    p.ellipse(hx, hy - 1, f.open ? 4.5 : 3, f.open ? 3.2 : 2, 0x7a1a2a);
    for (let a = 0; a < 6; a++) {
      const t = (a / 6) * Math.PI * 2;
      p.set(hx + Math.cos(t) * (f.open ? 4 : 2.6), hy - 1 + Math.sin(t) * (f.open ? 2.6 : 1.6), 0xfff6e0);
    }
  },

  skeleton(p, r, f) {
    const cx = CX + f.lunge;
    const by = FY + f.bob;
    p.line(cx - 2, by - 10, cx - 2 - f.step * 2, FY - 1, r.b, 2);
    p.line(cx + 2, by - 10, cx + 2 + f.step * 2, FY - 1, r.d, 2);
    p.rect(cx - 3, by - 11, 7, 2, r.d);
    p.line(cx, by - 19, cx, by - 11, r.b, 2);
    for (const y of [-18, -16, -14]) p.line(cx - 3, by + y, cx + 4, by + y, y === -14 ? r.d : r.b);
    p.line(cx - 3, by - 19, cx - 5, by - 12, r.d);
    // Front arm with a red plasma blade.
    const a = f.raise > 0.5 ? -2.4 : f.open ? 1.2 : 0.5;
    const hx = cx + 4 + Math.sin(a + 1.6) * 5;
    const hy = by - 18 + Math.cos(a + 1.6) * -5 + 5;
    p.line(cx + 3, by - 18, hx, hy, r.b);
    const bx = hx + Math.cos(a) * 9;
    const byy = hy - Math.sin(a) * 9;
    p.line(hx, hy, bx, byy, 0xff5a3a, 2);
    p.line(hx, hy, bx, byy, 0xffd0b0, 1);
    p.ellipse(cx + 1, by - 23, 4.5, 4, r.l);
    p.rect(cx - 1, by - 20, 5, 2, r.b);
    p.rect(cx - 1, by - 24, 2, 2, INK);
    p.rect(cx + 2, by - 24, 2, 2, INK);
    p.set(cx - 1, by - 24, RED);
    p.set(cx + 2, by - 24, RED);
    p.set(cx + 1, by - 19, INK);
  },

  mummy(p, r, f) {
    const cx = CX + f.lunge;
    const by = FY + f.bob;
    p.rect(cx - 3 - f.step, by - 10, 3, 10 - f.bob, r.d);
    p.rect(cx + 1 + f.step, by - 10, 3, 10 - f.bob, r.b);
    p.rect(cx - 4, by - 20, 9, 11, r.b);
    p.rect(cx + 2, by - 20, 3, 11, r.d);
    for (let y = by - 19; y < by; y += 3) p.line(cx - 4, y + 1, cx + 4, y - 1, r.d);
    // Trailing bandage.
    p.line(cx - 4, by - 18, cx - 8 - (f.i % 2), by - 13, r.l, 1);
    const ay = by - 18 - Math.round(f.raise * 3) + (f.open ? 1 : 0);
    p.rect(cx + 3, ay, 8 + (f.open ? 3 : 0), 2, r.l);
    p.rect(cx + 3, ay + 3, 7 + (f.open ? 3 : 0), 2, r.b);
    p.ellipse(cx + 1, by - 24, 4, 4, r.b);
    p.line(cx - 3, by - 26, cx + 4, by - 25, r.d);
    p.rect(cx - 2, by - 24, 7, 2, INK);
    p.set(cx, by - 24, 0xffe27a);
    p.set(cx + 3, by - 24, 0xffe27a);
  },

  pharaoh(p, r, f) {
    const cx = CX + f.lunge;
    const by = FY + f.bob;
    const gold = ramp(0xffc83a);
    const blue = ramp(0x3a6fd8);
    p.rect(cx - 4 - f.step, by - 11, 4, 11 - f.bob, r.d);
    p.rect(cx + 1 + f.step, by - 11, 4, 11 - f.bob, r.b);
    p.rect(cx - 6, by - 24, 13, 14, r.b);
    p.rect(cx + 3, by - 24, 4, 14, r.d);
    for (let y = by - 22; y < by - 10; y += 3) p.line(cx - 6, y + 1, cx + 6, y - 1, r.d);
    // Broad collar and belt in gold and lapis.
    p.rect(cx - 6, by - 24, 13, 3, gold.b);
    for (let x = cx - 5; x <= cx + 6; x += 2) p.set(x, by - 23, blue.b);
    p.rect(cx - 6, by - 15, 13, 2, blue.b);
    const ay = by - 22 - Math.round(f.raise * 6);
    p.rect(cx + 6, ay, 7 + (f.open ? 3 : 0), 3, r.l);
    p.rect(cx - 11, ay + 1, 5, 3, r.d);
    if (f.raise > 0.5 || f.open) p.ellipse(cx + 14 + (f.open ? 3 : 0), ay + 1, 2, 2, mix(0xff4a4a, 0xffffff, f.open ? 0.4 : 0.1));
    // Nemes headdress with a glowing gem.
    const hy = by - 30;
    p.poly([[cx - 7, hy + 9], [cx - 4, hy - 3], [cx + 6, hy - 3], [cx + 9, hy + 9], [cx + 5, hy + 7], [cx - 3, hy + 7]], gold.b);
    for (const x of [cx - 3, cx + 1, cx + 5]) p.line(x, hy - 2, x - (x < cx ? 1 : -1), hy + 8, blue.b);
    p.ellipse(cx + 1, hy + 3, 3.5, 3.5, mix(r.d, 0xd9b98a, 0.6));
    p.rect(cx - 2, hy + 2, 7, 2, INK);
    p.set(cx, hy + 2, RED);
    p.set(cx + 3, hy + 2, RED);
    p.poly([[cx, hy - 3], [cx + 1.5, hy - 6], [cx + 3, hy - 3]], gold.l);
    p.set(cx + 1, hy - 4, CYAN);
  },
};
