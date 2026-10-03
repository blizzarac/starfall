/**
 * A tiny pixel-art canvas: integer pixels, flat colors, no anti-aliasing.
 * Shapes are filled by testing pixel centers, so edges stay crisp at any scale.
 */

export type Pt = readonly [number, number];

/** Opaque 0xRRGGBB colors; 0 in the buffer means transparent, so colors are stored +1. */
export class Pix {
  private readonly px: Int32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int32Array(w * h);
  }

  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c + 1;
  }

  /** The color at a pixel, or -1 if it's transparent. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.px[y * this.w + x]! - 1;
  }

  has(x: number, y: number): boolean {
    return this.get(x, y) >= 0;
  }

  /** Recolors pixels that are already drawn (for shading inside a shape). */
  tint(x: number, y: number, c: number): void {
    if (this.has(x, y)) this.set(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Filled ellipse centered on (cx, cy); `test` can skip pixels (e.g. keep only the top half). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, test?: (x: number, y: number) => boolean): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!test || test(x, y))) this.set(x, y, c);
      }
    }
  }

  /** Filled polygon (even-odd rule on pixel centers). */
  poly(pts: readonly Pt[], c: number, test?: (x: number, y: number) => boolean): void {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (inside(pts, x + 0.5, y + 0.5) && (!test || test(x, y))) this.set(x, y, c);
      }
    }
  }

  /** A line `width` pixels thick (1-4). */
  line(x0: number, y0: number, x1: number, y1: number, c: number, width = 1): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const lo = -Math.floor((width - 1) / 2);
    const hi = Math.ceil((width - 1) / 2);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) if (width < 3 || Math.abs(dx) + Math.abs(dy) < width) this.set(x + dx, y + dy, c);
    }
  }

  /**
   * A one-pixel ink outline around everything drawn so far. Outline pixels
   * take a dark version of the color they border, which reads softer than
   * pure black (the "selective outline" pixel artists use).
   */
  outline(ink: number): void {
    const add: Array<[number, number, number]> = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.has(x, y)) continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)].find((c) => c >= 0);
        if (n !== undefined) add.push([x, y, mix(ink, n, 0.18)]);
      }
    }
    for (const [x, y, c] of add) this.set(x, y, c);
  }

  /** Copies the pixels into a 2D canvas at (ox, oy), optionally see-through. */
  blit(ctx: CanvasRenderingContext2D, ox: number, oy: number, alpha = 255): void {
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) {
      const v = this.px[i]!;
      if (v === 0) continue;
      const c = v - 1;
      img.data[i * 4] = (c >> 16) & 255;
      img.data[i * 4 + 1] = (c >> 8) & 255;
      img.data[i * 4 + 2] = c & 255;
      img.data[i * 4 + 3] = alpha;
    }
    ctx.putImageData(img, ox, oy);
  }
}

function inside(pts: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Blends two colors: t = 0 gives a, t = 1 gives b. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A five-step color ramp. Shadows shift toward violet and highlights toward
 * warm yellow, which looks richer than plain darker/lighter versions.
 */
export interface Ramp {
  /** Deepest shadow. */
  k: number;
  d: number;
  b: number;
  l: number;
  /** Specular highlight. */
  h: number;
}

export function ramp(c: number): Ramp {
  return {
    k: mix(mix(c, 0x000000, 0.55), 0x2a1f4a, 0.3),
    d: mix(mix(c, 0x000000, 0.28), 0x3a2f6a, 0.18),
    b: c,
    l: mix(c, 0xfff2c8, 0.32),
    h: mix(c, 0xffffff, 0.65),
  };
}
