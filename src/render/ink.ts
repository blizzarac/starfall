import type Phaser from 'phaser';

/**
 * Color-manga treatment for generated textures: a bold black ink outline
 * around the silhouette and halftone screentone on the shadow side.
 *
 * Outlining grows the texture by `pad` pixels on every side; use
 * `feetOrigin` to place inked sprites so their feet stay on the tile.
 */

const pads = new Map<string, number>();

export const INK = '#16131c';

export interface InkOptions {
  /** Outline thickness in px. */
  outline?: number;
  /** Add halftone dots to the lower-right half (the side away from the light). */
  tone?: boolean;
  /** Dot spacing for the screentone. */
  toneStep?: number;
}

/** Replaces texture `key` with an outlined, screentoned copy. Safe to call once per key. */
export function inkify(scene: Phaser.Scene, key: string, opts: InkOptions = {}): void {
  if (pads.has(key) || !scene.textures.exists(key)) return;
  const outline = opts.outline ?? 2.5;
  const pad = Math.ceil(outline) + 1;
  const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
  const w = src.width + pad * 2;
  const h = src.height + pad * 2;

  // Silhouette: the shape filled solid black.
  const sil = document.createElement('canvas');
  sil.width = src.width;
  sil.height = src.height;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(src, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = INK;
  sctx.fillRect(0, 0, sil.width, sil.height);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  // Stamping the silhouette around a circle gives an even outline on every edge.
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ctx.drawImage(sil, pad + Math.cos(a) * outline, pad + Math.sin(a) * outline);
  }
  ctx.drawImage(src, pad, pad);

  if (opts.tone) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    // Light comes from the upper left; shade everything below the diagonal.
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h);
    ctx.lineTo(w, h * 0.35);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = 'rgba(22, 19, 28, 0.28)';
    const step = opts.toneStep ?? 4;
    for (let y = 0; y < h; y += step) {
      for (let x = (y / step) % 2 ? step / 2 : 0; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  scene.textures.remove(key);
  scene.textures.addCanvas(key, out);
  pads.set(key, pad);
}

/** Padding inkify added around a texture (0 if not inked). */
export function inkPad(key: string): number {
  return pads.get(key) ?? 0;
}

/** Origin Y that puts pixel row `feetPx` of the original drawing on the ground. */
export function feetOrigin(scene: Phaser.Scene, key: string, feetPx: number): number {
  const pad = inkPad(key);
  const h = scene.textures.get(key).getSourceImage().height;
  return (feetPx + pad) / h;
}

/** Radial manga speed lines around a point, fading out quickly. */
export function speedLines(scene: Phaser.Scene, x: number, y: number, opts: { inner?: number; outer?: number; count?: number; depth?: number; color?: number } = {}): void {
  const g = scene.add.graphics().setDepth(opts.depth ?? 4500);
  const inner = opts.inner ?? 40;
  const outer = opts.outer ?? 150;
  const count = opts.count ?? 26;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
    const r0 = inner + Math.random() * 20;
    const r1 = outer + Math.random() * 40;
    const width = 1 + Math.random() * 2.5;
    // Tapered spike: a thin triangle from the outer edge toward the center.
    const nx = Math.cos(a + Math.PI / 2) * width;
    const ny = Math.sin(a + Math.PI / 2) * width;
    g.fillStyle(opts.color ?? 0x16131c, 0.85);
    g.fillTriangle(x + Math.cos(a) * r1 + nx, y + Math.sin(a) * r1 + ny, x + Math.cos(a) * r1 - nx, y + Math.sin(a) * r1 - ny, x + Math.cos(a) * r0, y + Math.sin(a) * r0);
  }
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.08, duration: 320, onComplete: () => g.destroy() });
}

/** A spiky starburst (for crits and onomatopoeia), drawn into a graphics object centered at 0,0. */
export function starburst(g: Phaser.GameObjects.Graphics, radius: number, points: number, fill: number): Phaser.GameObjects.Graphics {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.6;
    const a = (i / (points * 2)) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  g.fillStyle(fill).fillPoints(pts as Phaser.Math.Vector2[], true);
  g.lineStyle(3, 0x16131c).strokePoints(pts as Phaser.Math.Vector2[], true);
  return g;
}

/** Radius of the pre-drawn starburst texture ('burst'). */
export const BURST_RADIUS = 48;

/** Draws the comic starburst once at boot; effects scale the image instead of redrawing polygons. */
export function makeBurstTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const size = BURST_RADIUS * 2 + 8;
  g.translateCanvas(size / 2, size / 2);
  starburst(g, BURST_RADIUS, 12, 0xffffff);
  g.generateTexture('burst', size, size);
  g.destroy();
}
