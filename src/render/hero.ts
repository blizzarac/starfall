/**
 * Character art: slim, mature anime proportions (about 6.5 heads tall), drawn
 * with curves straight onto a canvas at HERO_RES times the size it's shown at,
 * then added as a texture. Three-quarter view facing right, cel-shaded with two
 * tones and ink outlines, like a character-sheet turnaround.
 */
import type Phaser from 'phaser';
import type { HairStyle } from '../core/appearance';
import type { JobExtra } from '../core/jobs';

/** Drawing size in display pixels, and the row the feet stand on. */
export const HERO_W = 60;
export const HERO_H = 108;
export const HERO_FEET = 104;
/** Supersampling: the texture is this many times bigger than it's shown. */
export const HERO_RES = 3;

/** Silhouette of the outfit; each job has its own. */
export type Outfit = 'tunic' | 'coat' | 'armor' | 'robe' | 'ranger' | 'vestment' | 'townsfolk';

export interface HeroLook {
  hairStyle: HairStyle;
  hair: number;
  eye: number;
  skin: number;
  /** Main outfit color. */
  body: number;
  /** Shirt / trim color. */
  accent: number;
  outfit: Outfit;
  extra?: JobExtra;
}

const INK = '#16131c';

/** Where each outfit's coat or robe ends (y), longest for robes. */
const HEM: Record<Outfit, number> = { tunic: 62, townsfolk: 64, coat: 82, armor: 80, ranger: 74, robe: 96, vestment: 95 };
const LINE = 0.9;
const HEAD_SCALE = 0.88;

type Pt = [number, number];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
function shadeOf(c: number, k: number): string {
  const r = Math.round(((c >> 16) & 255) * k);
  const g = Math.round(((c >> 8) & 255) * k);
  const b = Math.round((c & 255) * k);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

/** Draws the character into a new canvas texture `key` (once). */
export function ensureHero(scene: Phaser.Scene, key: string, look: HeroLook): string {
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  canvas.width = HERO_W * HERO_RES;
  canvas.height = HERO_H * HERO_RES;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(HERO_RES, HERO_RES);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  new HeroPainter(ctx, look).paint();
  scene.textures.addCanvas(key, canvas);
  return key;
}

class HeroPainter {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly look: HeroLook,
  ) {}

  paint(): void {
    const L = this.look;
    this.groundShadow();
    this.headSpace(() => this.backHair());
    this.backArm();
    this.legs();
    this.coatBack();
    this.torso();
    if (L.extra === 'bow') this.quiver();
    this.headSpace(() => {
      this.neckAndHead();
      this.face();
      this.frontHair();
    });
    this.frontArm();
    this.weapon();
  }

  /** The head is drawn a little smaller than its sketch, about 5.5 heads tall overall. */
  private headSpace(draw: () => void): void {
    const c = this.ctx;
    c.save();
    c.translate(30, 28);
    c.scale(HEAD_SCALE, HEAD_SCALE);
    c.translate(-30, -28);
    draw();
    c.restore();
  }

  // ---- Primitives ----------------------------------------------------------

  /** A closed path through points; `smooth` rounds it with midpoint curves. */
  private path(pts: Pt[], smooth = false): void {
    const c = this.ctx;
    c.beginPath();
    if (!smooth) {
      c.moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) c.lineTo(p[0], p[1]);
    } else {
      const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const n = pts.length;
      const start = mid(pts[n - 1]!, pts[0]!);
      c.moveTo(start[0], start[1]);
      for (let i = 0; i < n; i++) {
        const p = pts[i]!;
        const m = mid(p, pts[(i + 1) % n]!);
        c.quadraticCurveTo(p[0], p[1], m[0], m[1]);
      }
    }
    c.closePath();
  }

  /**
   * Fills a shape with its base color, shades the part left of `shadeX`
   * (away from the light, which comes from the front-right), and inks it.
   */
  private part(pts: Pt[], color: number, opts: { smooth?: boolean; shadeX?: number; shade?: number; line?: number } = {}): void {
    const c = this.ctx;
    this.path(pts, opts.smooth);
    c.fillStyle = hex(color);
    c.fill();
    if (opts.shadeX !== undefined) {
      c.save();
      this.path(pts, opts.smooth);
      c.clip();
      c.fillStyle = shadeOf(color, opts.shade ?? 0.72);
      c.fillRect(-10, -10, opts.shadeX + 10, HERO_H + 20);
      c.restore();
    }
    this.path(pts, opts.smooth);
    c.strokeStyle = INK;
    c.lineWidth = opts.line ?? LINE;
    c.stroke();
  }

  private line(pts: Pt[], width = 0.5, color = INK): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0]![0], pts[0]![1]);
    for (const p of pts.slice(1)) c.lineTo(p[0], p[1]);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }

  // ---- Body ------------------------------------------------------------------

  private groundShadow(): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(22,19,28,0.28)';
    c.beginPath();
    c.ellipse(30, HERO_FEET, 15, 3.6, 0, 0, Math.PI * 2);
    c.fill();
  }

  private legs(): void {
    const pants = 0x302d3b;
    // Back leg slightly behind, front leg a touch forward; both taper to the knee and ankle.
    this.part([[23.6, 57], [29.2, 57], [28.8, 74], [28.2, 90], [24.6, 90], [24, 74]], pants, { shadeX: 26.6, shade: 0.72, smooth: true });
    this.part([[29.4, 57], [36, 57], [36.6, 74], [36.2, 90], [31.4, 90], [30.6, 74]], pants, { shadeX: 31.8, shade: 0.82, smooth: true });
    this.line([[33, 66], [33.8, 73]], 0.35);
    // Boots: shafts flare a little at the top, toes point to the right.
    const boot = 0x2a2230;
    this.part([[23.6, 82], [29, 81.6], [28.8, 98.4], [32.4, 100.4], [32.6, 104], [23.2, 104], [23.6, 96]], boot, { shadeX: 25.4, shade: 0.7 });
    this.part([[30.8, 81.4], [36.8, 81.6], [36.4, 97.6], [41.6, 100.2], [41.8, 104], [30.6, 104], [31, 95]], boot, { shadeX: 32.6, shade: 0.75 });
    this.line([[24, 86.5], [28.8, 86.2]], 0.5, '#8a7f95');
    this.line([[31.2, 86], [36.6, 86.2]], 0.5, '#8a7f95');
    this.line([[36.6, 99.6], [41.4, 101.6]], 0.35, '#8a7f95');
  }

  /** Long coat or robe panels that hang behind the legs. */
  private coatBack(): void {
    const L = this.look;
    const len = HEM[L.outfit];
    if (len < 70) return;
    this.part([[19.6, 48], [27, 52], [27.6, len - 3], [21.6, len + 1.5], [14.2, len - 1.5], [17.4, 62]], L.body, {
      shadeX: 60,
      shade: 0.58,
    });
  }

  private torso(): void {
    const L = this.look;
    const hem = HEM[L.outfit];
    const flare = L.outfit === 'robe' || L.outfit === 'vestment' ? 5 : 3.2;
    // Inner shirt in the open V of the coat.
    this.part([[27.6, 29], [34.2, 29], [33.4, 40], [31.6, 52.4], [28.6, 52.4], [28.4, 40]], L.accent, { shadeX: 29.6, shade: 0.75 });
    this.line([[29.2, 36], [32.6, 37.2]], 0.35);
    this.line([[29, 43], [32, 44]], 0.35);
    // Coat, back half: broad shoulder, chest, nipped waist, flaring skirt.
    const back: Pt[] = [
      [18.6, 31.4], [22.4, 28.6], [27.6, 27.6], [29, 36], [29.6, 52], [30.4, hem], [23.6, hem + 0.6], [18.6 - flare, hem - 2], [22.2, 58], [23.4, 52], [21.4, 42],
    ];
    // Coat, front half.
    const front: Pt[] = [
      [33.6, 27.4], [38.2, 28.4], [41.6, 31], [41, 40], [37.8, 52], [39.2, 58], [42 + flare, hem - 2], [34.4, hem], [32, 52], [32.8, 40],
    ];
    this.part(back, L.body, { shadeX: 25.6, shade: 0.66 });
    this.part(front, L.body, { shadeX: 35, shade: 0.84 });
    // Lapels folding back from the opening.
    this.part([[27.6, 27.8], [29.4, 31.4], [28.6, 40], [27, 33]], L.body, { line: 0.55, shadeX: 40, shade: 0.8 });
    this.part([[33.6, 27.6], [35.6, 33], [33.2, 40], [32.6, 31.6]], L.body, { line: 0.55, shadeX: 40, shade: 1.15 });
    // Belt.
    const belt = L.outfit === 'robe' || L.outfit === 'vestment' ? L.accent : 0x4a2f20;
    this.part([[23.2, 51.2], [38, 51.2], [37.8, 54.6], [23.4, 54.6]], belt, { shadeX: 26.6, shade: 0.75, line: 0.7 });
    this.part([[29, 50.8], [32.2, 50.8], [32.2, 55], [29, 55]], 0xe8c35a, { line: 0.55 });
    // Folds in the skirt of the coat.
    if (hem > 62) {
      this.line([[25.6, 60], [23.8, hem - 2]], 0.4);
      this.line([[36.8, 60], [39, hem - 2]], 0.4);
      this.line([[30.6, 56], [31.4, hem - 0.5]], 0.5);
    }
    // High collar standing up behind the neck.
    this.part([[23.6, 28.8], [27, 23.8], [29.2, 27.4], [27.2, 29.4]], L.body, { shadeX: 60, shade: 0.55, line: 0.7 });
    this.part([[33, 27.2], [35.4, 23.6], [38.2, 28.4]], L.body, { line: 0.7, shadeX: 60, shade: 0.8 });
    if (L.outfit === 'armor') {
      // Pauldrons and a breastplate.
      this.part([[17.6, 31], [22.4, 27.8], [26.4, 29.6], [25.6, 35.6], [19.6, 37]], 0xbfc6d2, { smooth: true, shadeX: 21.6 });
      this.part([[35.6, 28.4], [41.2, 29], [43.6, 33.6], [41.6, 37.4], [37, 35]], 0xdfe4ec, { smooth: true, shadeX: 38 });
      this.part([[27.6, 30.6], [34.4, 30.6], [34.2, 44], [31, 47.6], [27.8, 44]], 0xc4cad6, { shadeX: 30.6, shade: 0.78 });
      this.line([[31, 31.4], [31, 46.4]], 0.4);
      this.line([[28.8, 38], [33.6, 38]], 0.35);
    }
    if (L.outfit === 'vestment' || L.outfit === 'robe') {
      const stole = L.outfit === 'vestment' ? 0xf4efe0 : L.accent;
      this.part([[30.2, 29], [32.2, 29], [33.6, hem - 6], [31.4, hem - 4.6]], stole, { line: 0.55 });
      if (L.outfit === 'vestment') {
        this.part([[31.4, 60], [32.6, 60], [32.8, 67], [31.6, 67]], 0xe8c35a, { line: 0.4 });
        this.part([[29.8, 62.4], [34.4, 62.4], [34.4, 63.6], [29.8, 63.6]], 0xe8c35a, { line: 0.4 });
      }
    }
    if (L.outfit === 'ranger') {
      // Hood resting on the shoulders, and a scarf.
      this.part([[19.4, 29], [23.6, 24.8], [28, 26.6], [27, 31.6], [21.6, 33.6]], L.body, { smooth: true, shadeX: 60, shade: 0.6 });
      this.part([[27, 26], [35, 25.6], [36.4, 28.6], [27.4, 29.4]], L.accent, { line: 0.6, shadeX: 29, shade: 0.75 });
    }
    if (L.outfit === 'townsfolk' || L.outfit === 'tunic') {
      // A strap across the chest.
      this.line([[27.2, 30], [37, 50]], 1, shadeOf(L.accent, 0.5));
    }
  }

  private backArm(): void {
    const L = this.look;
    // Mostly hidden behind the torso: shoulder, sleeve and a glimpse of the hand.
    this.part([[18.8, 31], [23.2, 31.6], [22.6, 44], [21.6, 53], [18.4, 53], [18.4, 43]], L.body, { shadeX: 60, shade: 0.55, smooth: true });
    this.part([[18.4, 52.4], [21.8, 52.4], [21.8, 57.2], [19.6, 58], [18.2, 56.4]], 0x26222e, { smooth: true, line: 0.6 });
  }

  private frontArm(): void {
    const L = this.look;
    // Upper arm to a slightly bent elbow, forearm widening into the cuff.
    this.part([[37, 29], [41.6, 30.6], [43.2, 42], [42.6, 44.6], [38.6, 44.4], [37.8, 36]], L.body, { shadeX: 39.2, shade: 0.84, smooth: true });
    this.part([[38.6, 43.4], [42.8, 43.6], [44, 51.6], [39.4, 52.6]], L.body, { shadeX: 40.4, shade: 0.84 });
    this.part([[39.2, 50.6], [44.2, 50], [44.6, 53.4], [39.6, 54.2]], L.accent, { line: 0.6, shadeX: 41, shade: 0.8 });
    // Gloved hand: palm, thumb and a hint of fingers.
    this.part([[39.8, 53.6], [44.4, 53.2], [45.2, 57.2], [44, 60.4], [41.2, 60.6], [39.6, 58]], 0x26222e, { smooth: true, line: 0.7 });
    this.line([[42, 57.4], [42.4, 60.2]], 0.35, '#5a5366');
    this.line([[40.2, 42], [42.8, 43.2]], 0.4);
  }

  private quiver(): void {
    this.part([[15.6, 30.4], [20, 29.2], [23.2, 54], [18.8, 55]], 0x7a4a2a, { shadeX: 18.2 });
    for (const [x, y] of [[15.8, 28], [17.8, 27.2], [19.8, 27.8]] as const) this.part([[x, y], [x + 1.3, y - 3.4], [x + 2.4, y + 0.4]], 0xf4f0e6, { line: 0.4 });
  }

  private neckAndHead(): void {
    const skin = this.look.skin;
    this.part([[27.6, 20.6], [32, 20.6], [32.2, 28.6], [27.8, 28.6]], skin, { shadeX: 30, shade: 0.78 });
    // Head in three-quarter view: round skull at the back, a narrow jaw and pointed chin in front.
    this.part(
      [[20.6, 12.4], [23.4, 5.6], [29.6, 3.4], [35.4, 6], [37.6, 11.6], [37.6, 15.6], [36.4, 19.6], [34, 23.2], [31.4, 24.8], [27.8, 23.4], [24, 20.6], [21.2, 16.6]],
      skin,
      { smooth: true, shadeX: 25, shade: 0.86 },
    );
    // Ear.
    this.part([[24, 13.8], [26, 13.4], [26.4, 18.4], [24.6, 18.8]], skin, { smooth: true, line: 0.6, shadeX: 25, shade: 0.8 });
    this.line([[24.9, 15], [25.4, 17.4]], 0.3);
  }

  /** Sharp anime eyes: angled upper lid, tall colored iris with highlights, thin lower lid, brows. */
  private face(): void {
    const L = this.look;
    const c = this.ctx;
    const eye = (cx: number, w: number, h: number, inner: number) => {
      const top = 13.8;
      // Almond-shaped white: the inner corner sits lower than the outer one.
      const shape: Pt[] = [[cx - w / 2, top + inner], [cx - w / 6, top - 0.1], [cx + w / 2, top - 0.3], [cx + w / 2 - 0.3, top + h * 0.75], [cx, top + h], [cx - w / 2 + 0.2, top + inner + h * 0.55]];
      this.path(shape, true);
      c.fillStyle = '#ffffff';
      c.fill();
      c.save();
      this.path(shape, true);
      c.clip();
      // Iris: tall ellipse with a darker top half, pupil and a light lower crescent.
      const ix = cx + w * 0.08;
      const iy = top + h * 0.55;
      c.fillStyle = hex(L.eye);
      c.beginPath();
      c.ellipse(ix, iy, w * 0.32, h * 0.62, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shadeOf(L.eye, 0.55);
      c.fillRect(ix - w, top - 1, w * 2, h * 0.38);
      c.fillStyle = shadeOf(L.eye, 0.3);
      c.beginPath();
      c.ellipse(ix + 0.1, iy - 0.2, w * 0.13, h * 0.32, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = shadeOf(L.eye, 1.45);
      c.beginPath();
      c.ellipse(ix, iy + h * 0.4, w * 0.22, h * 0.14, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(ix - w * 0.12, iy - h * 0.25, Math.max(0.4, w * 0.12), 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(ix + w * 0.14, iy + h * 0.2, 0.22, 0, Math.PI * 2);
      c.fill();
      // Heavy upper lid with a flick at the outer corner; a fine lower lid.
      this.line([[cx - w / 2 - 0.4, top + inner + 0.2], [cx - w / 6, top - 0.35], [cx + w / 2 + 0.3, top - 0.5], [cx + w / 2 + 1.2, top - 1.2]], 0.95);
      this.line([[cx + w / 2, top - 0.4], [cx + w / 2 + 0.9, top + 0.6]], 0.5);
      this.line([[cx - w / 2 + 0.8, top + inner + h * 0.75], [cx + w * 0.1, top + h + 0.1], [cx + w / 2 - 0.4, top + h * 0.8]], 0.35);
    };
    eye(31.2, 4.6, 3.6, 0.7);
    eye(35.9, 2.6, 3.3, 0.3);
    // Brows: angled and close to the eyes, which reads as cool rather than cute.
    this.line([[28.6, 11.6], [31.2, 10.7], [33.4, 11.2]], 0.75);
    this.line([[34.8, 11.1], [37, 11.8]], 0.65);
    // Nose: a single stroke with a soft shadow; mouth: a short line.
    this.line([[37, 15.8], [37.9, 18.6], [37.1, 19]], 0.45);
    this.line([[34.2, 21.4], [36.2, 21.1]], 0.55);
    c.fillStyle = 'rgba(255,120,140,0.25)';
    c.beginPath();
    c.ellipse(34.8, 19, 1.6, 0.7, 0, 0, Math.PI * 2);
    c.fill();
  }

  // ---- Hair --------------------------------------------------------------------

  private hairColors(): { base: number; dark: string; light: string } {
    return { base: this.look.hair, dark: shadeOf(this.look.hair, 0.62), light: shadeOf(this.look.hair, 1.45) };
  }

  /** Hair that hangs behind the head and body (long styles, tails). */
  private backHair(): void {
    const { base } = this.hairColors();
    const s = this.look.hairStyle;
    if (s === 'long') {
      this.part([[19.6, 8], [27, 5.4], [27.6, 24], [26.4, 40], [25, 60], [21.4, 54], [18.6, 62], [16.4, 50], [15.2, 36], [17.2, 22]], base, { shadeX: 60, shade: 0.62 });
    } else if (s === 'ponytail') {
      this.part([[20.6, 7.6], [24, 5.6], [22, 13], [17.6, 22], [15.6, 34], [17.4, 46], [12.6, 40], [11, 27], [14.4, 14]], base, { shadeX: 60, shade: 0.65 });
    } else if (s === 'twintails') {
      this.part([[19.2, 10], [23.4, 11], [21, 24], [21.6, 40], [18.6, 54], [15.8, 42], [16.4, 22]], base, { shadeX: 60, shade: 0.62 });
      this.part([[34, 9], [38, 10], [41, 22], [42, 40], [39.4, 52], [37.8, 38], [37.2, 22]], base, { shadeX: 39, shade: 0.75 });
    } else if (s === 'bob') {
      this.part([[19.2, 9], [25, 5.6], [27, 22], [25, 27.6], [20, 27], [18.2, 18]], base, { shadeX: 60, shade: 0.64, smooth: true });
    } else if (s === 'spiky') {
      // Messy strands at the nape, swept back and down.
      this.part([[20.6, 14], [16.2, 21], [19.8, 19.4], [17.8, 26], [22, 21.6], [22.2, 27.4], [24.6, 21]], base, { shadeX: 60, shade: 0.62 });
    }
  }

  /**
   * A single tapered lock of hair: a curved leaf from a root on the scalp to a
   * pointed tip, bowed sideways by `bend`. The root edge isn't inked so locks
   * blend into the cap they grow from.
   */
  private lock(root: Pt, tip: Pt, w: number, bend: number, color: string, line = 0.6): void {
    const c = this.ctx;
    const dx = tip[0] - root[0];
    const dy = tip[1] - root[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mx = (root[0] + tip[0]) / 2 + nx * bend;
    const my = (root[1] + tip[1]) / 2 + ny * bend;
    c.beginPath();
    c.moveTo(root[0] + (nx * w) / 2, root[1] + (ny * w) / 2);
    c.quadraticCurveTo(mx + nx * w * 0.42, my + ny * w * 0.42, tip[0], tip[1]);
    c.quadraticCurveTo(mx - nx * w * 0.42, my - ny * w * 0.42, root[0] - (nx * w) / 2, root[1] - (ny * w) / 2);
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = line;
    c.stroke();
  }

  /** The hair on the head: locks sticking out behind, a cap, and long bangs over the face. */
  private frontHair(): void {
    const { base, dark, light } = this.hairColors();
    const s = this.look.hairStyle;
    const c = this.ctx;
    const baseCss = hex(base);
    // How far the locks reach: wild for Messy, cropped for Short, sleek for the long styles.
    const k = s === 'spiky' ? 0.85 : s === 'short' ? 0.55 : 0.4;
    type Lock = [Pt, Pt, number, number];
    const reach = ([r, t, w, b]: Lock): Lock => [r, [r[0] + (t[0] - r[0]) * k, r[1] + (t[1] - r[1]) * k], w, b * k];
    const behind: Lock[] = [
      [[22, 8], [13.2, 7.4], 5.4, -1.8],
      [[21, 12], [13.2, 16.4], 5, 1.6],
      [[21.6, 16], [16.2, 22.8], 4.4, 1.4],
      [[25, 4.2], [16.8, 2.2], 5.6, -1.8],
      [[29, 2.6], [21.8, -0.6], 5.6, -1.8],
    ];
    const above: Lock[] = [
      [[33, 3.2], [26.8, -0.6], 5.6, -1.8],
      [[36.6, 5], [35.4, 0.2], 4.6, -1.2],
      [[38, 8.4], [42, 6.6], 4, -0.9],
    ];
    for (const l of behind.map(reach)) this.lock(...l, dark);
    for (const l of above.map(reach)) this.lock(...l, baseCss);
    const cap: Pt[] = [[20.2, 17], [19.6, 9.6], [22.6, 4], [29.4, 1.4], [35.6, 3], [39, 7.4], [39.4, 11], [36, 9.6], [31, 10], [26, 11.6], [23.4, 17.4]];
    this.part(cap, base, { smooth: true, shadeX: 24.6, shade: 0.66 });
    // Strand lines and a glossy highlight band across the crown.
    c.save();
    this.path(cap, true);
    c.clip();
    for (const [a, b] of [[[24.6, 4.6], [26.4, 10.6]], [[29.4, 3], [29.6, 9.6]], [[33.6, 3.6], [33.4, 9.4]], [[21, 9], [22.6, 14.6]]] as Array<[Pt, Pt]>) this.line([a, b], 0.35);
    c.strokeStyle = light;
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(23.6, 6.2);
    c.quadraticCurveTo(29.6, 3.4, 36.2, 6.6);
    c.stroke();
    c.restore();
    // Bangs: long strands over the forehead, one falling between the eyes.
    const long = s !== 'spiky' && s !== 'short';
    const drop = s === 'short' ? 0.6 : long ? 1.08 : 1;
    const bangs: Lock[] = [
      [[26.4, 8.6], [24.8, 19.6], 4.6, 1],
      [[29.4, 8.6], [28.2, 17], 4.6, 1.2],
      [[32.4, 8.6], [33.8, 18.4], 4.4, 1],
      [[35.6, 8.2], [37.8, 15.8], 4, 0.8],
      [[38.4, 8.4], [40.4, 13.4], 2.8, 0.5],
    ];
    for (const [r, t, w, b] of bangs) this.lock(r, [r[0] + (t[0] - r[0]) * drop, r[1] + (t[1] - r[1]) * drop], w, b, baseCss, 0.55);
    // A side lock framing the far cheek for longer styles.
    if (s === 'long' || s === 'bob' || s === 'twintails') this.lock([38.4, 9.4], [38.6, 25.6], 3.4, 1, baseCss, 0.6);
    if (s === 'ponytail') this.part([[19.4, 7.6], [22, 6.4], [22.6, 9.2], [20, 10.2]], this.look.accent, { line: 0.5 });
    if (s === 'twintails') {
      this.part([[19.6, 9.6], [22.2, 9.6], [22, 12.2], [19.6, 12.2]], this.look.accent, { line: 0.5 });
      this.part([[34.6, 7.8], [37.2, 7.8], [37.2, 10.4], [34.6, 10.4]], this.look.accent, { line: 0.5 });
    }
  }

  // ---- Weapons -----------------------------------------------------------------

  private weapon(): void {
    const e = this.look.extra;
    if (e === 'sword') {
      // A long blade held point-down along the leg.
      this.part([[40.6, 57], [42.4, 57], [44.6, 97], [43.4, 99.4], [42.4, 97.4]], 0xe8edf5, { shadeX: 41.8, shade: 0.8, line: 0.7 });
      this.part([[37.8, 55.2], [45.2, 54.4], [45.4, 56.4], [38, 57.2]], 0xc43a2a, { line: 0.6 });
      this.part([[40.2, 49], [42, 48.8], [42.2, 55], [40.4, 55.2]], 0x2a2230, { line: 0.5 });
    } else if (e === 'staff') {
      this.part([[43, 14], [44.8, 14], [45.2, 102], [43.4, 102]], 0x7a4a2a, { shadeX: 43.8, line: 0.7 });
      this.part([[41, 10], [44, 4], [47, 10], [44, 15]], 0x7fe3ff, { line: 0.7, shadeX: 43.2, shade: 0.75 });
      this.part([[43.6, 7], [44.6, 7], [44.4, 9], [43.6, 9]], 0xffffff, { line: 0 });
    } else if (e === 'bow') {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(42, 28);
      c.quadraticCurveTo(52, 56, 42, 86);
      c.strokeStyle = INK;
      c.lineWidth = 2.6;
      c.stroke();
      c.strokeStyle = '#8a5a3b';
      c.lineWidth = 1.5;
      c.stroke();
      this.line([[42, 28], [42, 86]], 0.35, '#f4f0e6');
    } else if (e === 'mace') {
      this.part([[40.4, 56], [42, 56], [42.6, 86], [41, 86]], 0x7a4a2a, { line: 0.6 });
      this.part([[38.4, 84], [45, 84], [46, 90], [41.8, 94], [37.6, 90]], 0xd9dee8, { smooth: true, shadeX: 41, line: 0.7 });
      this.part([[41, 87], [42.6, 87], [42.6, 89], [41, 89]], 0xe8c35a, { line: 0.4 });
    }
  }
}
