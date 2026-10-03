/**
 * Pixel-art ground. Every map is painted once into a single texture at half
 * world resolution (a 64x32 tile is 32x16 art pixels), with per-kind texture
 * (grass tufts, pebbles, planks, cobbles, ripples) and a dark seam wherever two
 * kinds of ground meet.
 */
import { mix, Pix, ramp } from './pix';

const INK = 0x16111e;
/** Half a tile in art pixels. */
const HW = 16;
const HH = 8;

export interface GroundSource {
  width: number;
  height: number;
  /** Ground class ('grass', 'path', 'water'...), or 'void' outside the map. */
  classOf(x: number, y: number): string;
  /** The terrain at a tile (to place flowers). */
  isFlower(x: number, y: number): boolean;
  colorOf(kind: string): number;
  dungeon: boolean;
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function paintGround(src: GroundSource): HTMLCanvasElement {
  const { width, height } = src;
  const W = (width + height) * HW;
  const H = (width + height) * HH;
  const p = new Pix(W, H);
  const ox = height * HW;
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const kind = src.classOf(tx, ty);
      const r = ramp(src.colorOf(kind));
      const cx = (tx - ty) * HW + ox;
      const cy = (tx + ty) * HH + HH;
      const seam = mix(r.d, INK, 0.45);
      const diff = (x: number, y: number) => src.classOf(x, y) !== kind;
      const right = diff(tx + 1, ty);
      const down = diff(tx, ty + 1);
      const left = diff(tx - 1, ty);
      const up = diff(tx, ty - 1);
      for (let j = -HH; j < HH; j++) {
        const hw = HW - Math.abs(j + 0.5) * 2;
        const y = cy + j;
        const x0 = cx - hw;
        const x1 = cx + hw - 1;
        for (let x = x0; x <= x1; x++) p.set(x, y, texel(kind, r, x, y, src.dungeon));
        if (j >= 0) {
          if (right) (p.set(x1, y, seam), p.set(x1 - 1, y, seam));
          if (down) (p.set(x0, y, seam), p.set(x0 + 1, y, seam));
        } else {
          if (left) (p.set(x0, y, seam), p.set(x0 + 1, y, seam));
          if (up) (p.set(x1, y, seam), p.set(x1 - 1, y, seam));
        }
      }
      details(p, kind, r, cx, cy, hash(tx, ty), src.dungeon);
      if (src.isFlower(tx, ty)) flowers(p, cx, cy, hash(ty, tx));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  p.blit(canvas.getContext('2d')!, 0, 0);
  return canvas;
}

/** Base color of one ground pixel: mostly flat, with sparse specks. */
function texel(kind: string, r: ReturnType<typeof ramp>, x: number, y: number, dungeon: boolean): number {
  const h = hash(x, y) % 97;
  if (kind === 'water') {
    // Gentle diagonal banding.
    return (x + y * 2) % 14 < 2 ? mix(r.b, r.l, 0.5) : r.b;
  }
  if (kind === 'cobble' || kind === 'plank') return h < 4 ? mix(r.b, r.d, 0.5) : r.b;
  if (h < 5) return mix(r.b, r.d, dungeon ? 0.7 : 0.45);
  if (h > 93) return mix(r.b, r.l, 0.5);
  return r.b;
}

function details(p: Pix, kind: string, r: ReturnType<typeof ramp>, cx: number, cy: number, h: number, dungeon: boolean): void {
  const at = (k: number, sx: number, sy: number): [number, number] => [cx + (((h >>> k) % sx) - sx / 2), cy + (((h >>> (k + 5)) % sy) - sy / 2)];
  if (kind === 'grass') {
    if (dungeon) {
      if (h % 4 === 0) {
        const [x, y] = at(3, 18, 8);
        p.line(x - 3, y, x, y + 1, r.k);
        p.line(x, y + 1, x + 3, y - 1, r.k);
      }
      return;
    }
    // Grass tufts: little dark "v"s with a light tip.
    for (let k = 0; k < (h % 3) + 1; k++) {
      const [x, y] = at(k * 7 + 2, 22, 9);
      p.set(x - 1, y - 1, r.d);
      p.set(x, y, r.d);
      p.set(x + 1, y - 1, r.d);
      p.set(x + 1, y - 2, r.l);
    }
  } else if (kind === 'path') {
    for (let k = 0; k < 2; k++) {
      const [x, y] = at(k * 9 + 1, 20, 8);
      p.set(x, y, r.d);
      p.set(x + 1, y, r.l);
    }
  } else if (kind === 'sand') {
    if (h % 3 === 0) {
      const [x, y] = at(4, 16, 6);
      p.line(x - 2, y, x + 2, y - 1, r.l);
    }
    const [x, y] = at(11, 22, 9);
    p.set(x, y, r.d);
  } else if (kind === 'plank') {
    // Boards run along one iso axis with dark gaps and nail heads.
    for (const t of [-5, 0, 5]) {
      for (let s = -14; s <= 14; s++) {
        const x = cx + s + t;
        const y = cy - Math.round(s / 2) + Math.round(t / 2);
        if (Math.abs(x - cx) / HW + Math.abs(y - cy) / HH < 0.95) p.set(x, y, r.d);
      }
    }
    if (h % 3 === 0) p.set(cx + 3, cy + 1, r.k);
  } else if (kind === 'cobble') {
    // Four stones per tile with lit edges.
    p.line(cx - 8, cy - 4, cx + 8, cy + 4, r.d);
    p.line(cx + 8, cy - 4, cx - 8, cy + 4, r.d);
    for (const [dx, dy] of [[0, -5], [-8, 0], [8, 0], [0, 5]] as const) p.set(cx + dx - 1, cy + dy - 1, r.l);
  } else if (kind === 'water') {
    if (h % 2 === 0) {
      const [x, y] = at(5, 16, 6);
      p.line(x - 2, y, x, y - 1, r.h);
      p.line(x, y - 1, x + 2, y, r.h);
    }
  }
}

function flowers(p: Pix, cx: number, cy: number, h: number): void {
  const petals = [0xffffff, 0xffd84a, 0xff8fb8, 0xb9a4ff];
  for (let k = 0; k < 2; k++) {
    const x = cx + (((h >>> (k * 4)) & 15) - 7.5) * 1.2;
    const y = cy + (((h >>> (k * 4 + 2)) & 7) - 3.5) * 0.8;
    const c = petals[(h >>> (k * 3)) % petals.length]!;
    p.set(x - 1, y, c);
    p.set(x + 1, y, c);
    p.set(x, y - 1, c);
    p.set(x, y + 1, mix(c, INK, 0.3));
    p.set(x, y, 0xffd84a);
  }
}
