/**
 * Techno-knight pixel characters: medieval armor, robes and capes with
 * glowing energy trim, plasma blades, tech gauntlets, visors and comm
 * earpieces. Every frame of every animation is painted from a pose (limb
 * angles, stride, body bob) onto a small pixel canvas, then packed into one
 * sprite sheet per character with Phaser animations for each action.
 *
 * Two facings are drawn: front (facing down-right) and back (facing
 * up-right). Left-facing sprites are the same frames flipped.
 */
import Phaser from 'phaser';
import type { HairStyle } from '../core/appearance';
import { mix, Pix, ramp, type Pt, type Ramp } from './pix';

/** Frame size in art pixels, and where the feet stand. */
export const KNIGHT_W = 64;
export const KNIGHT_H = 56;
export const KNIGHT_FEET = 52;

export type Gear = 'novice' | 'swordsman' | 'knight' | 'mage' | 'wizard' | 'archer' | 'hunter' | 'acolyte' | 'priest' | 'townsfolk' | 'guard';
export type Weapon = 'none' | 'dagger' | 'sword' | 'greatsword' | 'staff' | 'bow' | 'mace';
export type Facing = 'F' | 'B';
export type Anim = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'sit';

export interface KnightLook {
  hairStyle: HairStyle;
  hair: number;
  eye: number;
  skin: number;
  /** Main cloth color (tunic, tabard, robe, cape). */
  cloth: number;
  /** Energy color for trim, cores, blades and visors. */
  glow: number;
  gear: Gear;
  weapon: Weapon;
  /** Equipped gear shown on the sprite (all optional; the job's look fills in). */
  /** 0 plain steel, 1 plasma, 2 heavy plasma. */
  weaponTier?: 0 | 1 | 2;
  shield?: boolean;
  helm?: 'cap' | 'moss' | 'turban' | 'crown';
  armor?: 'leather' | 'crystal' | 'sun' | 'coat' | 'clockwork';
  /** Cape color, when a cloak is worn. */
  cloak?: number;
  /** Highly refined weapons sparkle. */
  shimmer?: boolean;
}

export const ANIMS: ReadonlyArray<{ name: Anim; frames: number; rate: number; repeat: number }> = [
  { name: 'idle', frames: 4, rate: 5, repeat: -1 },
  { name: 'walk', frames: 6, rate: 11, repeat: -1 },
  { name: 'attack', frames: 5, rate: 18, repeat: 0 },
  { name: 'cast', frames: 3, rate: 8, repeat: -1 },
  { name: 'hurt', frames: 2, rate: 10, repeat: 0 },
  { name: 'sit', frames: 1, rate: 1, repeat: 0 },
];
const FACINGS: readonly Facing[] = ['F', 'B'];
const COLS = 6;

export const frameName = (facing: Facing, anim: Anim, i: number) => `${facing}-${anim}-${i}`;
export const animKey = (key: string, facing: Facing, anim: Anim) => `${key}:${facing}-${anim}`;

/** Paints the sheet for `look` into texture `key` and registers its animations (once). */
export function ensureKnight(scene: Phaser.Scene, key: string, look: KnightLook, only?: { facing: Facing; anim: Anim }): string {
  if (scene.textures.exists(key)) return key;
  // Painting is slow on phones: characters that only ever stand still get just that row.
  const wanted = (facing: Facing, anim: Anim) => !only || (only.facing === facing && only.anim === anim);
  const canvas = document.createElement('canvas');
  canvas.width = KNIGHT_W * COLS;
  canvas.height = KNIGHT_H * (only ? 1 : ANIMS.length * FACINGS.length);
  const ctx = canvas.getContext('2d')!;
  const frames: Array<{ name: string; x: number; y: number }> = [];
  FACINGS.forEach((facing, fi) => {
    ANIMS.forEach((a, ai) => {
      const row = only ? 0 : fi * ANIMS.length + ai;
      if (!wanted(facing, a.name)) return;
      for (let i = 0; i < a.frames; i++) {
        const pix = paintFrame(look, facing, a.name, i);
        pix.blit(ctx, i * KNIGHT_W, row * KNIGHT_H);
        frames.push({ name: frameName(facing, a.name, i), x: i * KNIGHT_W, y: row * KNIGHT_H });
      }
    });
  });
  const tex = scene.textures.addCanvas(key, canvas)!;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (const f of frames) tex.add(f.name, 0, f.x, f.y, KNIGHT_W, KNIGHT_H);
  for (const facing of FACINGS) {
    for (const a of ANIMS) {
      if (!wanted(facing, a.name)) continue;
      const k = animKey(key, facing, a.name);
      if (scene.anims.exists(k)) scene.anims.remove(k);
      scene.anims.create({
        key: k,
        frames: Array.from({ length: a.frames }, (_, i) => ({ key, frame: frameName(facing, a.name, i) })),
        frameRate: a.rate,
        repeat: a.repeat,
      });
    }
  }
  return key;
}

// ---- Poses ---------------------------------------------------------------------

/**
 * Angles are in degrees measured from straight down, positive toward the
 * facing direction: 0 hangs down, 90 points forward, 180 points up.
 */
interface Pose {
  /** Upper body offset: down (+) / up (-), and lean forward (+). */
  bob: number;
  lean: number;
  /** Feet: forward offset and lift off the ground. */
  legB: [number, number];
  legF: [number, number];
  armB: number;
  bendB: number;
  armF: number;
  bendF: number;
  /** Direction the weapon points (bow: direction it aims). */
  weapon: number;
  bowDraw?: number;
  fx?: 'slash' | 'slash2' | 'smash' | 'cast' | 'bolt' | 'arrow' | 'punch';
  sit?: boolean;
  /** Frame index, for flickering effects and the drone's float. */
  i: number;
}

function basePose(weapon: Weapon, i: number): Pose {
  const p: Pose = { bob: 0, lean: 0, legB: [0, 0], legF: [0, 0], armB: 6, bendB: 10, armF: 12, bendF: 32, weapon: 0, i };
  if (weapon === 'sword' || weapon === 'dagger') Object.assign(p, { armF: 15, bendF: 40, weapon: 145 });
  else if (weapon === 'greatsword') Object.assign(p, { armF: 18, bendF: 36, weapon: 162 });
  else if (weapon === 'staff') Object.assign(p, { armF: 14, bendF: 30, weapon: 176 });
  else if (weapon === 'bow') Object.assign(p, { armF: 14, bendF: 22, weapon: 55 });
  else if (weapon === 'mace') Object.assign(p, { armF: 10, bendF: 24, weapon: 30 });
  return p;
}

function pose(weapon: Weapon, anim: Anim, i: number): Pose {
  const p = basePose(weapon, i);
  if (anim === 'idle') {
    const breath = i >= 2 ? 1 : 0;
    p.bob = breath;
    p.armF += breath * 2;
    p.weapon -= breath * 3;
    p.armB -= breath * 2;
  } else if (anim === 'walk') {
    const ph = (i / 6) * Math.PI * 2;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    p.legF = [Math.round(2.4 * s), Math.max(0, Math.round(1.4 * c))];
    p.legB = [Math.round(-2.4 * s), Math.max(0, Math.round(-1.4 * c))];
    p.bob = i % 3 === 0 ? -1 : 0;
    p.armB += 24 * s;
    p.armF -= 12 * s;
    p.weapon -= 8 * s;
  } else if (anim === 'attack') {
    attackPose(p, weapon, i);
  } else if (anim === 'cast') {
    p.armF = 105;
    p.bendF = -10;
    p.armB = 70;
    p.bendB = 30;
    p.weapon = weapon === 'staff' ? 160 : weapon === 'bow' ? 120 : p.weapon + 10;
    p.fx = 'cast';
  } else if (anim === 'hurt') {
    p.lean = i === 0 ? -2 : -1;
    p.bob = i === 0 ? 1 : 0;
    p.armF -= 20;
    p.armB -= 25;
    p.weapon -= 25;
    p.legF = [-1, 0];
  } else if (anim === 'sit') {
    p.sit = true;
    p.bob = 6;
    p.armF = 20;
    p.bendF = 50;
    p.armB = 10;
    p.weapon = weapon === 'staff' || weapon === 'greatsword' || weapon === 'sword' || weapon === 'dagger' ? 175 : p.weapon;
  }
  return p;
}

function attackPose(p: Pose, weapon: Weapon, i: number): void {
  const set = (o: Partial<Pose>) => Object.assign(p, o);
  if (weapon === 'sword' || weapon === 'greatsword' || weapon === 'dagger') {
    [
      { armF: 165, bendF: 15, weapon: 205, lean: -1, legF: [-1, 0] as [number, number] },
      { armF: 130, bendF: 0, weapon: 125, lean: 0 },
      { armF: 80, bendF: -10, weapon: 72, lean: 2, legF: [2, 0] as [number, number], fx: 'slash' as const },
      { armF: 45, bendF: 10, weapon: 35, lean: 1, legF: [2, 0] as [number, number], fx: 'slash2' as const },
      { armF: 20, bendF: 30, weapon: 110, lean: 0 },
    ].forEach((o, k) => k === i && set(o));
  } else if (weapon === 'mace') {
    [
      { armF: 170, bendF: 10, weapon: 195, lean: -1 },
      { armF: 140, bendF: 0, weapon: 150, lean: 0 },
      { armF: 70, bendF: 0, weapon: 65, lean: 2, legF: [2, 0] as [number, number], fx: 'smash' as const },
      { armF: 50, bendF: 10, weapon: 50, lean: 2, legF: [2, 0] as [number, number] },
      { armF: 20, bendF: 25, weapon: 40, lean: 0 },
    ].forEach((o, k) => k === i && set(o));
  } else if (weapon === 'staff') {
    [
      { armF: 60, bendF: 20, weapon: 172, lean: -1 },
      { armF: 95, bendF: 0, weapon: 160, lean: 0, fx: 'cast' as const },
      { armF: 110, bendF: -5, weapon: 135, lean: 2, legF: [2, 0] as [number, number], fx: 'bolt' as const },
      { armF: 95, bendF: 0, weapon: 150, lean: 1 },
      { armF: 30, bendF: 25, weapon: 172, lean: 0 },
    ].forEach((o, k) => k === i && set(o));
  } else if (weapon === 'bow') {
    [
      { armF: 90, bendF: 0, weapon: 90, armB: 75, bendB: 40, bowDraw: 1 },
      { armF: 90, bendF: 0, weapon: 90, armB: 65, bendB: 95, bowDraw: 3, lean: -1 },
      { armF: 90, bendF: 0, weapon: 90, armB: 40, bendB: 60, bowDraw: 0, fx: 'arrow' as const, lean: 1 },
      { armF: 85, bendF: 0, weapon: 88, armB: 30, bendB: 40, bowDraw: 0 },
      { armF: 30, bendF: 20, weapon: 60, armB: 10, bendB: 10 },
    ].forEach((o, k) => k === i && set(o));
  } else {
    [
      { armF: 40, bendF: 95, lean: -1, armB: 30, bendB: 80 },
      { armF: 88, bendF: 0, lean: 2, legF: [2, 0] as [number, number], fx: 'punch' as const },
      { armF: 90, bendF: 0, lean: 2, legF: [2, 0] as [number, number] },
      { armF: 50, bendF: 60, lean: 1 },
      { armF: 15, bendF: 30, lean: 0 },
    ].forEach((o, k) => k === i && set(o));
  }
}

// ---- Outfits ---------------------------------------------------------------------

interface Spec {
  torso: 'jacket' | 'plate' | 'robe' | 'vest' | 'tunic';
  pauldrons: 0 | 1 | 2;
  cape: boolean;
  head: 'ear' | 'visor' | 'goggles' | 'circlet' | 'none';
  greaves: boolean;
  scarf: boolean;
  drone: boolean;
}

const SPECS: Record<Gear, Spec> = {
  novice: { torso: 'jacket', pauldrons: 1, cape: false, head: 'ear', greaves: false, scarf: false, drone: false },
  swordsman: { torso: 'plate', pauldrons: 1, cape: false, head: 'ear', greaves: true, scarf: false, drone: false },
  knight: { torso: 'plate', pauldrons: 2, cape: true, head: 'visor', greaves: true, scarf: false, drone: false },
  mage: { torso: 'robe', pauldrons: 0, cape: false, head: 'circlet', greaves: false, scarf: false, drone: false },
  wizard: { torso: 'robe', pauldrons: 2, cape: true, head: 'circlet', greaves: false, scarf: false, drone: false },
  archer: { torso: 'vest', pauldrons: 0, cape: false, head: 'goggles', greaves: false, scarf: true, drone: false },
  hunter: { torso: 'vest', pauldrons: 1, cape: true, head: 'goggles', greaves: false, scarf: true, drone: false },
  acolyte: { torso: 'robe', pauldrons: 0, cape: false, head: 'circlet', greaves: false, scarf: false, drone: false },
  priest: { torso: 'robe', pauldrons: 2, cape: true, head: 'circlet', greaves: false, scarf: false, drone: true },
  townsfolk: { torso: 'tunic', pauldrons: 0, cape: false, head: 'none', greaves: false, scarf: false, drone: false },
  guard: { torso: 'plate', pauldrons: 2, cape: false, head: 'visor', greaves: true, scarf: false, drone: false },
};

const INK = 0x16111e;
const STEEL = ramp(0x9ba6bc);
const DARK = ramp(0x4a4f64);
const PANTS = ramp(0x3b3e56);
const LEATHER = ramp(0x7c5034);
const GOLD = ramp(0xe2b24c);
const SHIRT = ramp(0xe8e0cf);

/** Bangs length (rows below the hairline) for each of the 13 head columns. */
const BANGS: Record<HairStyle, number[]> = {
  spiky: [3, 4, 2, 1, 2, 1, 1, 2, 1, 1, 2, 3, 2],
  short: [2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  bob: [4, 3, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 3],
  long: [4, 3, 2, 1, 1, 1, 2, 1, 1, 1, 1, 3, 4],
  ponytail: [3, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1, 2, 2],
  twintails: [3, 3, 2, 1, 1, 1, 2, 2, 1, 1, 2, 2, 3],
};

/** Front face, 13x13, facing right: s skin, S shade, b brow, k lash, i/I iris, w shine, n nose, m mouth, r blush. */
const FACE = [
  '...sssssss...',
  '.sssssssssss.',
  'sssssssssssss',
  'sssssssssssss',
  'Sssssssssssss',
  'SSssbbbssbbss',
  'SSsskkksskkss',
  'SSssiwisswiss',
  'SSssIIIssIIss',
  'SSssssssssnss',
  'SSssrrsssrrss',
  '.SSsssssmmss.',
  '....SSsssss..',
];

function paintFrame(look: KnightLook, facing: Facing, anim: Anim, i: number): Pix {
  const pix = new Pix(KNIGHT_W, KNIGHT_H);
  const painter = new Painter(pix, look, pose(look.weapon, anim, i));
  if (facing === 'F') painter.front();
  else painter.back();
  pix.outline(INK);
  painter.effects();
  return pix;
}

class Painter {
  private readonly spec: Spec;
  private readonly cloth: Ramp;
  private readonly hair: Ramp;
  private readonly skin: Ramp;
  private readonly eye: Ramp;
  private readonly glow: Ramp;
  /** Armor plating (steel, crystal or sunsteel) and the cape's cloth. */
  private readonly plateR: Ramp;
  private readonly capeR: Ramp;
  /** Upper-body offset (lean, bob). */
  private readonly ux: number;
  private readonly uy: number;
  private handF: Pt = [0, 0];

  constructor(
    private readonly p: Pix,
    private readonly look: KnightLook,
    private readonly pose: Pose,
  ) {
    // Worn armor and cloaks override the job's outfit.
    const base = SPECS[look.gear];
    const plated = look.armor === 'crystal' || look.armor === 'sun' || look.armor === 'clockwork';
    this.spec = {
      ...base,
      torso: plated ? 'plate' : look.armor === 'coat' ? 'robe' : look.armor === 'leather' && base.torso !== 'robe' ? 'vest' : base.torso,
      pauldrons: plated ? 2 : base.pauldrons,
      greaves: base.greaves || plated,
      cape: base.cape || look.cloak !== undefined,
    };
    this.plateR = look.armor === 'crystal' ? ramp(0x9fd8ff) : look.armor === 'sun' ? ramp(0xf2c14e) : look.armor === 'clockwork' ? ramp(0xc9883a) : STEEL;
    this.cloth = ramp(look.armor === 'coat' ? 0x2f4a7a : look.cloth);
    this.capeR = look.cloak !== undefined ? ramp(look.cloak) : this.cloth;
    this.hair = ramp(look.hair);
    this.skin = ramp(look.skin);
    this.eye = ramp(look.eye);
    this.glow = ramp(look.glow);
    this.ux = pose.lean;
    this.uy = pose.bob;
  }

  /** Point in the upper body's frame (moves with lean and bob). */
  private u(x: number, y: number): Pt {
    return [x + this.ux, y + this.uy];
  }

  private upoly(pts: Pt[], c: number, test?: (x: number, y: number) => boolean): void {
    this.p.poly(pts.map(([x, y]) => this.u(x, y)), c, test);
  }

  // ---- Facings -----------------------------------------------------------------

  front(): void {
    const s = this.spec;
    if (s.cape) this.capeBehind();
    this.hairBack(false);
    const backHand = this.arm(this.u(26, 28), this.pose.armB, this.pose.bendB, true);
    if (this.look.weapon === 'bow' && this.pose.bowDraw !== undefined) this.p.rect(backHand[0], backHand[1], 2, 2, this.skin.d);
    this.legs();
    this.torso(true);
    if (s.pauldrons === 2) this.pauldron(this.u(25, 28.5), true);
    if (this.look.shield) this.shield(true);
    this.neck();
    this.face();
    this.hairFront();
    this.headgear(true);
    if (s.drone) this.drone();
    this.weaponArm(true);
  }

  back(): void {
    const s = this.spec;
    this.legs();
    if (s.drone) this.drone();
    this.arm(this.u(26, 28), this.pose.armB, this.pose.bendB, true);
    this.torso(false);
    if (s.cape) this.capeBack();
    if (this.look.shield) this.shield(false);
    this.backOfHead();
    this.headgear(false);
    if (s.pauldrons === 2) this.pauldron(this.u(25, 28.5), true);
    this.weaponArm(false);
  }

  // ---- Body ----------------------------------------------------------------------

  private legs(): void {
    const r = this.spec.greaves ? STEEL : PANTS;
    if (this.pose.sit) {
      // Sitting: thighs forward, shins down, both on the ground.
      for (const [hx, shade] of [[28, true], [33, false]] as const) {
        const y = 44;
        this.p.rect(hx, y, 7, 4, shade ? r.d : r.b);
        this.p.rect(hx, y, 7, 1, shade ? r.b : r.l);
        this.boot(hx + 6, KNIGHT_FEET, shade);
      }
      return;
    }
    const legHipY = 38 + Math.max(0, this.uy);
    this.leg(28 + Math.round(this.ux / 2), legHipY, this.pose.legB, r, true);
    this.leg(33 + Math.round(this.ux / 2), legHipY, this.pose.legF, r, false);
  }

  private leg(hx: number, hy: number, [dx, lift]: [number, number], r: Ramp, back: boolean): void {
    const fy = KNIGHT_FEET - lift;
    const fx = hx + dx;
    const ankle = fy - 5;
    const base = back ? r.d : r.b;
    this.p.poly([[hx, hy], [hx + 4, hy], [fx + 4, ankle], [fx, ankle]], base);
    for (let y = hy; y < ankle; y++) {
      const t = (y - hy) / Math.max(1, ankle - hy);
      const x = Math.round(hx + (fx - hx) * t);
      this.p.tint(x, y, back ? r.b : r.l);
      this.p.tint(x + 3, y, back ? r.k : r.d);
    }
    if (this.spec.greaves) {
      // Knee guard with an energy stud.
      const ky = Math.round((hy + ankle) / 2);
      const kx = Math.round((hx + fx) / 2);
      this.p.rect(kx, ky - 1, 4, 2, back ? STEEL.b : STEEL.l);
      this.p.set(kx + 1, ky - 1, this.glow.b);
    }
    this.boot(fx, fy, back);
  }

  private boot(fx: number, fy: number, back: boolean): void {
    const r = DARK;
    this.p.poly([[fx, fy - 5], [fx + 4, fy - 5], [fx + 4, fy - 2], [fx + 6, fy - 1.5], [fx + 6, fy + 0.6], [fx - 0.4, fy + 0.6]], back ? r.d : r.b);
    this.p.rect(fx, fy - 5, 4, 1, back ? r.b : r.l);
    this.p.set(fx + 5, fy - 1, back ? STEEL.d : STEEL.l);
    this.p.rect(fx, fy, 6, 1, r.k);
  }

  private torso(front: boolean): void {
    const s = this.spec;
    const c = this.cloth;
    const shape: Pt[] = [[25, 27], [39, 27], [38, 31], [37, 36.5], [27, 36.5], [26, 31]];
    if (s.torso === 'robe') {
      // The robe's skirt covers the legs down to the boots.
      this.upoly([[26.5, 36], [37.5, 36], [40.5, 50.5 - this.uy], [23.5, 50.5 - this.uy]], c.b);
      this.upoly([[34, 36], [37.5, 36], [40.5, 50.5 - this.uy], [36, 50.5 - this.uy]], c.d);
      this.upoly([[26.5, 36], [28, 36], [25.5, 50.5 - this.uy], [23.5, 50.5 - this.uy]], c.l);
      // Circuit-trace hem.
      for (let x = 23; x <= 41; x++) this.p.tint(x + this.ux, 50, (x + this.pose.i) % 3 === 0 ? this.glow.l : this.glow.d);
      if (front) {
        for (let y = 37; y < 49; y++) this.p.tint(32 + this.ux, y + this.uy, this.glow.d);
        this.p.set(32 + this.ux, 42 + this.uy, this.glow.h);
      }
    }
    if (s.torso === 'tunic') {
      this.upoly([[27, 36], [37, 36], [38.5, 41.5], [25.5, 41.5]], c.b);
      this.upoly([[34, 36], [37, 36], [38.5, 41.5], [35, 41.5]], c.d);
    }
    this.upoly(shape, c.b);
    // Shade the far side and light the near shoulder line.
    this.upoly(shape, c.d, (x) => x - this.ux >= 35);
    this.upoly(shape, c.l, (x, y) => y - this.uy <= 27 || x - this.ux <= 26);
    if (s.torso === 'plate') this.plate(front);
    else if (s.torso === 'jacket') this.jacket(front);
    else if (s.torso === 'vest') this.vest(front);
    else if (s.torso === 'robe') this.robeTop(front);
    // Belt with a tech buckle.
    const [bx, by] = this.u(27, 36);
    this.p.rect(bx, by, 11, 2, LEATHER.d);
    this.p.rect(bx, by, 11, 1, LEATHER.b);
    if (front) {
      this.p.rect(bx + 4, by, 3, 2, STEEL.l);
      this.p.set(bx + 5, by + 1, this.glow.b);
    }
    if (s.torso === 'plate') {
      // Hip plates and a tabard in the cloth color.
      const [fx, fy] = this.u(27, 38);
      this.p.rect(fx, fy, 11, 2, STEEL.d);
      this.p.rect(fx, fy, 11, 1, STEEL.b);
      this.upoly([[29.5, 38], [35.5, 38], [35.5, 45], [32.5, 46.5], [29.5, 45]], front ? c.b : c.d);
      this.upoly([[29.5, 38], [30.5, 38], [30.5, 45], [29.5, 45]], front ? c.l : c.b);
      if (front) this.p.set(32 + this.ux, 41 + this.uy, this.glow.l);
    }
    if (s.pauldrons >= 1) this.pauldron(this.u(39, 28.5), false);
    if (s.scarf) {
      const [sx, sy] = this.u(28, 25);
      this.p.rect(sx, sy, 9, 3, this.glow.d);
      this.p.rect(sx, sy, 9, 1, this.glow.b);
      if (!front) this.p.poly([[sx + 1, sy + 2], [sx + 4, sy + 2], [sx + 2, sy + 9], [sx - 1, sy + 8]], this.glow.d);
    }
  }

  private plate(front: boolean): void {
    const st = this.plateR;
    this.upoly([[27, 28], [37, 28], [36.5, 35.5], [27.5, 35.5]], front ? st.b : st.d);
    this.upoly([[34.5, 28], [37, 28], [36.5, 35.5], [34.5, 35.5]], front ? st.d : st.k);
    if (front) {
      for (let y = 29; y <= 35; y++) this.p.tint(32 + this.ux, y + this.uy, st.l);
      // Energy core in the chest, with a circuit line.
      const [cx, cy] = this.u(31, 30);
      this.p.rect(cx, cy, 2, 2, this.glow.b);
      this.p.set(cx, cy, this.glow.h);
      this.p.set(cx - 2, cy + 3, this.glow.d);
      this.p.set(cx - 1, cy + 3, this.glow.d);
      this.p.set(cx + 3, cy + 3, this.glow.d);
      this.p.set(cx + 4, cy + 3, this.glow.d);
      this.upoly([[29, 27], [36, 27], [35, 28.6], [30, 28.6]], st.l);
    } else {
      for (let y = 29; y <= 35; y++) this.p.tint(32 + this.ux, y + this.uy, st.b);
      this.p.set(32 + this.ux, 31 + this.uy, this.glow.d);
    }
  }

  private jacket(front: boolean): void {
    if (!front) {
      this.p.set(32 + this.ux, 30 + this.uy, this.glow.d);
      return;
    }
    this.upoly([[30.5, 27], [34.5, 27], [32.5, 31]], SHIRT.b);
    // A strap across the chest with a little status light.
    this.p.line(27 + this.ux, 28 + this.uy, 36 + this.ux, 35 + this.uy, LEATHER.b, 2);
    this.p.set(35 + this.ux, 29 + this.uy, this.glow.b);
  }

  private vest(front: boolean): void {
    const l = LEATHER;
    this.upoly([[25.5, 28], [30, 28], [30, 36.5], [27, 36.5]], front ? l.b : l.d);
    this.upoly([[34, 28], [38.5, 28], [37.5, 36.5], [34, 36.5]], front ? l.d : l.k);
    if (front) {
      this.p.set(29 + this.ux, 31 + this.uy, this.glow.b);
      this.p.set(29 + this.ux, 33 + this.uy, STEEL.l);
    }
  }

  private robeTop(front: boolean): void {
    const trim = this.look.gear === 'acolyte' || this.look.gear === 'priest' ? GOLD : this.glow;
    if (front) {
      this.upoly([[30, 27], [34.5, 27], [32.5, 36]], trim.d);
      this.upoly([[31, 27], [33.5, 27], [32.5, 33]], trim.b);
      this.p.set(32 + this.ux, 30 + this.uy, this.glow.h);
    }
    // High collar.
    this.upoly([[27, 25], [37, 25], [38, 28], [26, 28]], front ? this.cloth.l : this.cloth.d);
  }

  private pauldron([x, y]: Pt, back: boolean): void {
    const st = this.plateR;
    this.p.ellipse(x, y, back ? 3 : 3.6, back ? 2.6 : 3, back ? st.d : st.b);
    this.p.ellipse(x - 0.6, y - 0.8, 2, 1.4, back ? st.b : st.l);
    if (!back) this.p.set(x - 1, y - 2, st.h);
    for (let dx = -2; dx <= 2; dx++) this.p.set(x + dx, y + 2, back ? this.glow.d : this.glow.b);
  }

  /** A round tech shield on the off arm, with an energy cross. */
  private shield(front: boolean): void {
    const st = this.plateR;
    const [x, y] = this.u(23.5, 34);
    this.p.ellipse(x, y, 3.6, 5, front ? st.b : st.d);
    this.p.ellipse(x - 0.8, y - 1.5, 1.8, 2.4, front ? st.l : st.b);
    if (front) {
      this.p.line(x, y - 3, x, y + 3, this.glow.b);
      this.p.line(x - 2, y - 0.5, x + 2, y - 0.5, this.glow.b);
      this.p.set(x, y - 0.5, this.glow.h);
    } else {
      this.p.rect(x - 1, y - 1, 2, 2, DARK.b);
    }
  }

  private neck(): void {
    const [x, y] = this.u(31, 23);
    this.p.rect(x, y, 3, 4, this.skin.d);
  }

  private capeBehind(): void {
    const sway = this.pose.lean * -1 + (this.pose.i % 2);
    this.p.poly([this.u(26, 27), this.u(38, 27), [42 + sway, 47], [22 + sway, 47]], this.capeR.k);
    this.p.poly([this.u(26, 27), this.u(30, 27), [25 + sway, 47], [22 + sway, 47]], this.capeR.d);
    for (let x = 22; x <= 42; x += 2) this.p.tint(x + sway, 46, this.glow.d);
  }

  private capeBack(): void {
    const sway = this.pose.lean * -1 + (this.pose.i % 2);
    const c = this.capeR;
    this.p.poly([this.u(25, 27), this.u(39, 27), [43 + sway, 48], [21 + sway, 48]], c.b);
    this.p.poly([this.u(35, 27), this.u(39, 27), [43 + sway, 48], [37 + sway, 48]], c.d);
    for (const fx of [28, 32, 36]) this.p.line(fx + this.ux, 30 + this.uy, fx + sway + (fx - 32) / 3, 47, c.d);
    for (let x = 21; x <= 43; x++) this.p.tint(x + sway, 47, x % 2 === 0 ? this.glow.b : this.glow.d);
    this.upoly([[25, 27], [39, 27], [38, 29], [26, 29]], c.l);
  }

  /** An arm from the shoulder; returns where the hand is. */
  private arm(sh: Pt, a: number, bend: number, back: boolean): Pt {
    const dir = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    const d1 = dir(a);
    const d2 = dir(a + bend);
    const elbow: Pt = [sh[0] + d1[0] * 5, sh[1] + d1[1] * 5];
    const hand: Pt = [elbow[0] + d2[0] * 5, elbow[1] + d2[1] * 5];
    const sleeve = this.spec.torso === 'plate' ? STEEL : this.cloth;
    const glove = this.spec.torso === 'robe' ? this.cloth : DARK;
    this.p.line(sh[0], sh[1], elbow[0], elbow[1], back ? sleeve.d : sleeve.b, 3);
    this.p.line(elbow[0], elbow[1], hand[0], hand[1], back ? glove.d : glove.b, 3);
    // Light along the upper edge of each segment.
    const lit = (d: Pt): Pt => {
      let px = -d[1];
      let py = d[0];
      if (px + py > 0) [px, py] = [-px, -py];
      return [px, py];
    };
    if (!back) {
      const [l1x, l1y] = lit(d1);
      this.p.line(sh[0] + l1x, sh[1] + l1y, elbow[0] + l1x, elbow[1] + l1y, sleeve.l);
      const [l2x, l2y] = lit(d2);
      this.p.line(elbow[0] + l2x, elbow[1] + l2y, hand[0] + l2x, hand[1] + l2y, glove.l);
    }
    // Gauntlet light and the hand.
    this.p.set((elbow[0] + hand[0]) / 2, (elbow[1] + hand[1]) / 2, back ? this.glow.d : this.glow.b);
    this.p.rect(Math.round(hand[0]) - 1, Math.round(hand[1]) - 1, 2, 2, back ? DARK.d : DARK.b);
    return hand;
  }

  private weaponArm(front: boolean): void {
    const w = this.look.weapon;
    // Facing away, a weapon held forward is mostly hidden by the body, so it's drawn first.
    if (!front) this.handF = this.handPos();
    if (!front && w !== 'none') this.drawWeapon(this.handF);
    const hand = this.arm(this.u(38, 28), this.pose.armF, this.pose.bendF, !front);
    this.handF = hand;
    if (front && w !== 'none') {
      this.drawWeapon(hand);
      this.p.rect(Math.round(hand[0]) - 1, Math.round(hand[1]) - 1, 2, 2, DARK.l);
    }
  }

  private handPos(): Pt {
    const dir = (deg: number): Pt => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    const sh = this.u(38, 28);
    const d1 = dir(this.pose.armF);
    const d2 = dir(this.pose.armF + this.pose.bendF);
    return [sh[0] + d1[0] * 5 + d2[0] * 5, sh[1] + d1[1] * 5 + d2[1] * 5];
  }

  // ---- Head ----------------------------------------------------------------------

  private headTL(): Pt {
    return this.u(27, 11);
  }

  private face(): void {
    const [hx, hy] = this.headTL();
    const sk = this.skin;
    const colors: Record<string, number> = {
      s: sk.b,
      S: sk.d,
      h: sk.l,
      b: this.hair.k,
      k: mix(this.eye.k, INK, 0.5),
      i: this.eye.b,
      I: this.eye.l,
      w: 0xffffff,
      n: sk.d,
      m: mix(sk.d, 0x8a2a3a, 0.45),
      r: mix(sk.b, 0xff7a8a, 0.35),
    };
    FACE.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = colors[row[x]!];
        if (c !== undefined) this.p.set(hx + x, hy + y, c);
      }
    });
  }

  private hairFront(): void {
    const [hx, hy] = this.headTL();
    const h = this.hair;
    const style = this.look.hairStyle;
    if (style === 'spiky') {
      for (const [b1, b2, tip] of [
        [[hx + 1, hy + 3], [hx + 3, hy + 0], [hx - 3, hy - 1]],
        [[hx + 2, hy + 1], [hx + 6, hy - 1], [hx + 1, hy - 4]],
        [[hx + 5, hy - 1], [hx + 9, hy - 1], [hx + 7, hy - 5]],
        [[hx + 8, hy - 1], [hx + 12, hy + 1], [hx + 13, hy - 3]],
        [[hx + 11, hy + 1], [hx + 13, hy + 4], [hx + 16, hy + 1]],
      ] as Array<[Pt, Pt, Pt]>) {
        this.p.poly([b1, tip, b2, [hx + 6.5, hy + 4]], h.b);
      }
    }
    const capRy = style === 'short' ? 5.2 : 5.8;
    this.p.ellipse(hx + 6.5, hy + 4.6, 7.4, capRy, h.b, (_x, y) => y <= hy + 4);
    // Bangs.
    BANGS[style].forEach((len, col) => {
      for (let r = 0; r < len; r++) this.p.set(hx + col, hy + 5 + r, r === len - 1 ? h.d : h.b);
    });
    // Side hair by the ear (back of the head, screen-left).
    const side = style === 'long' || style === 'bob' ? 11 : style === 'short' ? 6 : 8;
    for (let y = hy + 3; y <= hy + side; y++) {
      this.p.set(hx - 1, y, h.d);
      this.p.set(hx, y, y > hy + 6 ? h.d : h.b);
    }
    // Framing lock on the face side for longer styles.
    if (style === 'long' || style === 'bob' || style === 'twintails') {
      for (let y = hy + 4; y <= hy + (style === 'long' ? 13 : 11); y++) this.p.set(hx + 13, y, h.d);
      for (let y = hy + 4; y <= hy + 9; y++) this.p.set(hx + 12, y, h.b);
    }
    // Shading: dark crown edge on the far side, a glossy highlight band.
    for (let y = hy - 1; y <= hy + 4; y++) {
      this.p.tint(hx + 12, y, h.d);
      this.p.tint(hx + 13, y, h.d);
    }
    for (let x = 2; x <= 7; x++) this.p.tint(hx + x, hy + 1, h.l);
    for (let x = 3; x <= 5; x++) this.p.tint(hx + x, hy, h.l);
    this.p.tint(hx + 4, hy + 1, mix(h.l, h.h, 0.5));
    if (style === 'ponytail' || style === 'twintails') this.p.rect(hx - 1, hy + 3, 2, 2, this.glow.b);
  }

  /** Hair that hangs behind the body when facing front. */
  private hairBack(fromBehind: boolean): void {
    const [hx, hy] = this.headTL();
    const h = this.hair;
    const fill = fromBehind ? h.b : h.d;
    const style = this.look.hairStyle;
    if (style === 'long') {
      this.p.poly([[hx - 1.5, hy + 3], [hx + 14.5, hy + 3], [hx + 15.5, hy + 22], [hx + 12, hy + 25], [hx + 1, hy + 25], [hx - 2.5, hy + 22]], fill);
      if (fromBehind) for (const x of [hx + 3, hx + 7, hx + 11]) this.p.line(x, hy + 14, x, hy + 24, h.d);
    } else if (style === 'bob') {
      this.p.poly([[hx - 1.5, hy + 3], [hx + 14.5, hy + 3], [hx + 14.5, hy + 14], [hx - 1.5, hy + 14]], fill);
    } else if (style === 'ponytail') {
      const tail: Pt[] = fromBehind
        ? [[hx + 5, hy + 8], [hx + 9, hy + 8], [hx + 9, hy + 18], [hx + 7, hy + 25], [hx + 5, hy + 18]]
        : [[hx + 1, hy + 2], [hx + 4, hy + 3], [hx - 1, hy + 12], [hx - 4, hy + 21], [hx - 6.5, hy + 17], [hx - 3, hy + 8]];
      this.p.poly(tail, h.b);
      this.p.poly(tail, h.d, (x) => x <= (fromBehind ? hx + 6 : hx - 3));
      if (fromBehind) this.p.rect(hx + 6, hy + 8, 2, 2, this.glow.b);
    } else if (style === 'twintails') {
      this.p.poly([[hx - 1, hy + 3], [hx + 2, hy + 3], [hx + 0.5, hy + 12], [hx - 0.5, hy + 23], [hx - 4.5, hy + 20], [hx - 4.5, hy + 10]], h.b);
      this.p.poly([[hx + 11, hy + 3], [hx + 14, hy + 3], [hx + 17.5, hy + 10], [hx + 17.5, hy + 20], [hx + 13.5, hy + 23], [hx + 12.5, hy + 12]], h.d);
      this.p.rect(hx + 12, hy + 3, 2, 2, this.glow.b);
    } else if (style === 'spiky') {
      this.p.poly([[hx, hy + 2], [hx - 4.5, hy + 1], [hx, hy + 5.5]], h.d);
      this.p.poly([[hx, hy + 6], [hx - 4, hy + 8], [hx + 1, hy + 9.5]], h.d);
    }
  }

  private backOfHead(): void {
    const [hx, hy] = this.headTL();
    const h = this.hair;
    const style = this.look.hairStyle;
    this.p.rect(hx + 4, hy + 11, 5, 3, this.skin.d);
    if (style === 'spiky') {
      for (const [b1, b2, tip] of [
        [[hx + 0, hy + 3], [hx + 3, hy + 0], [hx - 3, hy - 2]],
        [[hx + 3, hy + 0], [hx + 7, hy - 1], [hx + 4, hy - 5]],
        [[hx + 7, hy - 1], [hx + 11, hy + 0], [hx + 10, hy - 4]],
        [[hx + 11, hy + 1], [hx + 13, hy + 4], [hx + 16, hy + 0]],
        [[hx - 0.5, hy + 7], [hx + 1, hy + 11], [hx - 3.5, hy + 11]],
        [[hx + 12, hy + 7], [hx + 13.5, hy + 11], [hx + 16, hy + 9]],
      ] as Array<[Pt, Pt, Pt]>) {
        this.p.poly([b1, tip, b2, [hx + 6.5, hy + 5]], h.b);
      }
    }
    this.p.ellipse(hx + 6.5, hy + 5.6, 7.3, style === 'short' ? 6.4 : 6.8, h.b);
    // Shade the lower half and the far side; gloss on top.
    this.p.ellipse(hx + 6.5, hy + 5.6, 7.3, 6.8, h.d, (x, y) => y >= hy + 9 || x >= hx + 12);
    for (let x = 3; x <= 8; x++) this.p.tint(hx + x, hy + 1, h.l);
    for (let x = 4; x <= 6; x++) this.p.tint(hx + x, hy, h.l);
    // Strand lines.
    for (const x of [hx + 4, hx + 9]) this.p.line(x, hy + 5, x - 1, hy + 10, h.d);
    this.hairBack(true);
  }

  private headgear(front: boolean): void {
    const [hx, hy] = this.headTL();
    const g = this.glow;
    if (this.look.helm) {
      this.helm(front);
      return;
    }
    const kind = this.spec.head;
    if (kind === 'ear') {
      const ex = front ? hx - 1 : hx + 12;
      this.p.rect(ex, hy + 6, 2, 3, DARK.b);
      this.p.set(ex + (front ? 0 : 1), hy + 7, g.b);
    } else if (kind === 'visor') {
      if (front) {
        for (let y = hy + 6; y <= hy + 8; y++) {
          for (let x = hx + 2; x <= hx + 13; x++) {
            const under = this.p.get(x, y);
            this.p.set(x, y, mix(under >= 0 ? under : g.d, y === hy + 6 ? g.l : g.b, 0.72));
          }
        }
        this.p.set(hx + 5, hy + 6, g.h);
        this.p.set(hx + 6, hy + 6, g.h);
        this.p.rect(hx, hy + 6, 2, 3, STEEL.d);
      } else {
        for (let x = hx - 1; x <= hx + 13; x++) this.p.set(x, hy + 7, DARK.b);
        this.p.rect(hx + 12, hy + 6, 2, 3, STEEL.d);
      }
    } else if (kind === 'goggles') {
      for (let x = hx - 1; x <= hx + 13; x++) this.p.set(x, hy + 4, DARK.b);
      if (front) {
        for (const lx of [hx + 3, hx + 8]) {
          this.p.rect(lx, hy + 2, 3, 3, DARK.l);
          this.p.rect(lx + 0.5, hy + 2.5, 2, 2, g.b);
          this.p.set(lx + 0.5, hy + 2.5, g.h);
        }
      }
    } else if (kind === 'circlet') {
      for (let x = hx; x <= hx + 13; x++) this.p.set(x, hy + 4, x === hx + 7 ? g.h : GOLD.b);
      if (front) {
        this.p.set(hx + 7, hy + 3, g.b);
        this.p.set(hx + 6, hy + 4, g.b);
        this.p.set(hx + 8, hy + 4, g.b);
      }
    }
  }

  /** Worn headgear replaces the job's earpiece, visor or circlet. */
  private helm(front: boolean): void {
    const [hx, hy] = this.headTL();
    const g = this.glow;
    const helm = this.look.helm;
    const cx = hx + 6.5;
    if (helm === 'cap' || helm === 'moss') {
      const r = helm === 'cap' ? LEATHER : ramp(0x5aa04a);
      this.p.ellipse(cx, hy + 3.4, 7.8, 4.6, r.b, (_x, y) => y <= hy + 4);
      this.p.ellipse(cx - 2, hy + 1, 3, 1.5, r.l);
      if (front) for (let x = hx + 3; x <= hx + 15; x++) this.p.set(x, hy + 4, r.d);
      else for (let x = hx - 1; x <= hx + 13; x++) this.p.set(x, hy + 4, r.d);
      if (helm === 'moss') {
        this.p.poly([[cx, hy - 1], [cx + 5, hy - 5], [cx + 2, hy]], ramp(0x3fae4f).l);
        this.p.set(cx + 3, hy - 3, mix(0xc8ff8a, g.b, 0.3));
      } else if (front) this.p.set(hx + 11, hy + 2, g.b);
    } else if (helm === 'turban') {
      this.p.ellipse(cx, hy + 2.6, 8.2, 4.8, SHIRT.b, (_x, y) => y <= hy + 5);
      for (const k of [0, 3]) this.p.line(hx + k, hy + 4, hx + 8 + k, hy - 1, SHIRT.d);
      this.p.ellipse(cx + 3, hy + 1, 2.5, 1.4, SHIRT.l);
      if (front) {
        this.p.rect(hx + 10, hy + 1, 3, 3, GOLD.b);
        this.p.set(hx + 11, hy + 2, g.h);
      }
    } else if (helm === 'crown') {
      for (let x = hx; x <= hx + 13; x++) {
        this.p.set(x, hy + 2, GOLD.b);
        this.p.set(x, hy + 3, GOLD.d);
      }
      for (const k of [0, 4, 9, 13]) {
        this.p.line(hx + k, hy + 1, hx + k, hy - 1, GOLD.l);
        this.p.set(hx + k, hy - 2, k === 4 || k === 9 ? g.h : GOLD.h);
      }
      if (front) this.p.set(hx + 7, hy + 2, 0xff4a6a);
    }
  }

  private drone(): void {
    const f = [0, -1, -1, 0, 1, 1][this.pose.i % 6]!;
    const x = 15;
    const y = 18 + f;
    this.p.ellipse(x, y, 3, 3, STEEL.b);
    this.p.ellipse(x - 0.8, y - 0.8, 1.6, 1.4, STEEL.l);
    this.p.rect(x - 1, y, 3, 1, this.glow.b);
    this.p.set(x, y, this.glow.h);
    this.p.set(x - 3, y, STEEL.d);
    this.p.set(x + 3, y, STEEL.d);
    this.p.set(x, y + 4, this.glow.d);
  }

  // ---- Weapons -------------------------------------------------------------------

  private drawWeapon(hand: Pt): void {
    const w = this.look.weapon;
    const a = (this.pose.weapon * Math.PI) / 180;
    const d: Pt = [Math.sin(a), Math.cos(a)];
    const n: Pt = [-d[1], d[0]];
    const at = (k: number, side = 0): Pt => [hand[0] + d[0] * k + n[0] * side, hand[1] + d[1] * k + n[1] * side];
    const g = this.glow;
    const ln = (p0: Pt, p1: Pt, c: number, width = 1) => this.p.line(p0[0], p0[1], p1[0], p1[1], c, width);
    const tier = this.look.weaponTier ?? 1;
    if (w === 'sword' || w === 'greatsword' || w === 'dagger') {
      const big = w === 'greatsword';
      const len = (w === 'dagger' ? 7 : big ? 16 : 12) + (tier === 2 ? 2 : 0);
      const width = (big ? 3 : 2) + (tier === 2 && !big ? 1 : 0);
      ln(at(-3), at(1), DARK.b, 2);
      this.p.set(...at(-3.5), GOLD.b);
      // Plain steel at first; plasma blades (colored edge, white-hot core) on better swords.
      ln(at(2.5), at(len), tier === 0 ? STEEL.b : g.b, width);
      ln(at(2.5), at(len - 1), tier === 0 ? STEEL.h : g.h, 1);
      this.p.set(...at(len + 0.8), tier === 0 ? STEEL.l : g.l);
      const guard = w === 'dagger' ? 1.5 : big ? 3.5 : 2.5;
      ln(at(1.5, -guard), at(1.5, guard), STEEL.l, 2);
      if (tier > 0) this.p.set(...at(1.5), g.h);
    } else if (w === 'staff') {
      ln(at(-7), at(13), tier === 0 ? LEATHER.l : DARK.l, 1);
      ln(at(-7, 1), at(13, 1), tier === 0 ? LEATHER.d : DARK.d, 1);
      this.p.set(...at(4), g.b);
      this.p.set(...at(8), g.b);
      ln(at(13, -2), at(13, 2), STEEL.l, 1);
      const [cx, cy] = at(16);
      const size = tier === 0 ? 0.7 : tier === 2 ? 1.3 : 1;
      this.p.poly([[cx, cy - 3.5 * size], [cx + 2.5 * size, cy], [cx, cy + 3.5 * size], [cx - 2.5 * size, cy]], tier === 0 ? mix(g.b, 0x8a8a9a, 0.5) : g.b);
      if (tier === 2) for (const [ox, oy] of [[-4, -2], [4, 1], [0, -6]] as const) this.p.set(cx + ox, cy + oy, g.l);
      this.p.set(cx - 1, cy - 1, g.h);
      this.p.set(cx, cy - 2, g.h);
      this.p.set(cx + 1, cy + 1, g.d);
    } else if (w === 'bow') {
      // Compound bow: metal limbs, cams at the tips, a glowing string.
      const draw = this.pose.bowDraw ?? 0;
      const tip1 = at(1, -9);
      const tip2 = at(1, 9);
      const pts: Pt[] = [];
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const side = -9 + 18 * t;
        pts.push(at(1 + 3.2 * (1 - (2 * t - 1) ** 2), side));
      }
      for (let k = 0; k < pts.length - 1; k++) ln(pts[k]!, pts[k + 1]!, k === 4 || k === 5 ? LEATHER.b : tier === 0 ? LEATHER.l : DARK.l, 2);
      this.p.rect(tip1[0] - 1, tip1[1] - 1, 2, 2, STEEL.l);
      this.p.rect(tip2[0] - 1, tip2[1] - 1, 2, 2, STEEL.l);
      const nock = at(-draw);
      const string = tier === 0 ? SHIRT.b : g.l;
      ln(tip1, nock, string);
      ln(nock, tip2, string);
      if (draw > 0) {
        ln(nock, at(6), g.h);
        this.p.set(...at(6.5), STEEL.h);
      }
    } else if (w === 'mace') {
      ln(at(-2), at(9), DARK.b, 2);
      ln(at(-2), at(9), DARK.l, 1);
      const [cx, cy] = at(11);
      this.p.rect(cx - 2, cy - 2, 5, 5, STEEL.b);
      this.p.rect(cx - 2, cy - 2, 5, 1, STEEL.l);
      this.p.rect(cx - 2, cy + 2, 5, 1, STEEL.d);
      this.p.rect(cx - 2, cy, 5, 1, tier === 0 ? STEEL.d : g.b);
      if (tier > 0) this.p.set(cx, cy, g.h);
      if (tier === 2) for (const [ox, oy] of [[-3, -3], [3, -3]] as const) this.p.set(cx + ox, cy + oy, STEEL.h);
    }
  }

  /** Light effects drawn over the outline (they glow, so they have no ink). */
  effects(): void {
    const fx = this.pose.fx;
    const g = this.glow;
    if (this.look.shimmer && this.look.weapon !== 'none') {
      // +7 and up: sparkles travel along the weapon.
      const a = (this.pose.weapon * Math.PI) / 180;
      const [hx, hy] = this.handF;
      for (const k of [3 + ((this.pose.i * 3) % 9), 6 + ((this.pose.i * 5) % 8)]) {
        const x = hx + Math.sin(a) * k;
        const y = hy + Math.cos(a) * k;
        this.p.set(x, y, 0xffffff);
        this.p.set(x + 1, y, g.h);
        this.p.set(x - 1, y, g.h);
        this.p.set(x, y - 1, g.l);
      }
    }
    if (!fx) return;
    const sh = this.u(38, 28);
    const big = this.look.weapon === 'greatsword' ? 3 : 0;
    const arc = (r: number, from: number, to: number, c: number, step = 3) => {
      for (let a = from; a >= to; a -= step) {
        const rad = (a * Math.PI) / 180;
        this.p.set(sh[0] + Math.sin(rad) * r, sh[1] + Math.cos(rad) * r, c);
      }
    };
    if (fx === 'slash') {
      arc(17 + big, 160, 40, g.l);
      arc(16 + big, 150, 50, g.h);
      arc(15 + big, 135, 65, g.b, 4);
    } else if (fx === 'slash2') {
      arc(17 + big, 100, 20, g.d, 6);
      arc(16 + big, 80, 30, g.b, 5);
    } else if (fx === 'smash' || fx === 'punch') {
      const a = (this.pose.weapon * Math.PI) / 180;
      const reach = fx === 'smash' ? 11 : 1;
      const cx = this.handF[0] + Math.sin(a) * reach;
      const cy = this.handF[1] + Math.cos(a) * reach;
      const len = fx === 'smash' ? 4 : 2;
      for (let k = 0; k < 8; k++) {
        const r = (k / 8) * Math.PI * 2;
        for (let s = 2; s <= len + 1; s++) this.p.set(cx + Math.cos(r) * s, cy + Math.sin(r) * s, s === 2 ? g.h : g.l);
      }
    } else if (fx === 'cast' || fx === 'bolt') {
      const staff = this.look.weapon === 'staff';
      const a = (this.pose.weapon * Math.PI) / 180;
      const cx = staff ? this.handF[0] + Math.sin(a) * 16 : this.handF[0] + 2;
      const cy = staff ? this.handF[1] + Math.cos(a) * 16 : this.handF[1] - 1;
      const r = fx === 'bolt' ? 3.5 : 2 + (this.pose.i % 2) * 0.6;
      this.p.ellipse(cx, cy, r + 1, r + 1, g.d, (x, y) => (x + y) % 2 === 0);
      this.p.ellipse(cx, cy, r, r, g.l);
      this.p.ellipse(cx, cy, r / 2, r / 2, g.h);
      const sparks: Pt[] = [[-5, -3], [4, -5], [6, 2], [-4, 4], [0, -7], [-7, 0]];
      sparks.forEach(([sx, sy], k) => {
        if ((k + this.pose.i) % 2 === 0) this.p.set(cx + sx, cy + sy, k % 3 === 0 ? g.h : g.l);
      });
      if (fx === 'bolt') for (let k = 4; k <= 10; k++) this.p.set(cx + Math.sin(a) * k, cy + Math.cos(a) * k, k % 2 ? g.h : g.l);
    } else if (fx === 'arrow') {
      const [hx, hy] = this.handF;
      for (let k = 3; k <= 20; k++) this.p.set(hx + k, hy, k > 17 ? STEEL.h : k % 3 === 0 ? g.l : g.b);
      this.p.set(hx + 19, hy - 1, STEEL.l);
      this.p.set(hx + 19, hy + 1, STEEL.l);
    }
  }
}
