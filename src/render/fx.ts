/**
 * Pixel-art skill and hit effects, painted once at boot as small animated
 * sheets. Most are drawn in white and grey so a tint gives them their color
 * (fire orange, frost blue, holy gold...); arrows and meteors carry their own.
 */
import Phaser from 'phaser';
import { mix, Pix } from './pix';

const W = 0xffffff;
const L = 0xdcdce8;
const M = 0xa8a8c0;
const D = 0x74749a;

export type FxKey = 'fx-spark' | 'fx-slash' | 'fx-ring' | 'fx-orb' | 'fx-burst' | 'fx-pillar' | 'fx-bolt' | 'fx-plus' | 'fx-arrow' | 'fx-meteor';

interface FxDef {
  key: FxKey;
  w: number;
  h: number;
  frames: number;
  rate: number;
  repeat: number;
  paint: (p: Pix, i: number, n: number) => void;
}

/** A tiny deterministic random source, so effects look the same every run. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DEFS: FxDef[] = [
  {
    // Hit spark: a bright core and rays flying out, then breaking into dots.
    key: 'fx-spark',
    w: 16,
    h: 16,
    frames: 5,
    rate: 24,
    repeat: 0,
    paint(p, i) {
      const c = 8;
      if (i < 3) p.ellipse(c, c, 2.6 - i * 0.8, 2.6 - i * 0.8, W);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.2;
        const len = k % 2 ? 4 : 7;
        const r0 = 2 + i * 1.4;
        const r1 = Math.min(7.5, r0 + len - i * 1.2);
        for (let r = r0; r <= r1; r += 1) p.set(c + Math.cos(a) * r, c + Math.sin(a) * r, r < r0 + 1.5 ? W : i > 2 ? M : L);
      }
    },
  },
  {
    // Sword arc: a crescent that sweeps around and fades to sparks.
    key: 'fx-slash',
    w: 32,
    h: 32,
    frames: 5,
    rate: 22,
    repeat: 0,
    paint(p, i) {
      const sweep = Math.min(1, (i + 1) / 3);
      const from = -2.4;
      const to = from + 2.8 * sweep;
      for (let a = from; a <= to; a += 0.04) {
        const t = (a - from) / (to - from || 1);
        const thick = i >= 3 ? 1 : Math.max(1, Math.round(3 * Math.sin(Math.PI * t)));
        for (let r = 13 - thick; r <= 13; r++) {
          if (i === 4 && (Math.round(a * 30) + r) % 3) continue;
          p.set(16 + Math.cos(a) * r, 16 + Math.sin(a) * r, r === 13 ? W : r === 12 ? L : M);
        }
      }
    },
  },
  {
    // Shockwave on the ground: an iso ring expanding, its fill fading.
    key: 'fx-ring',
    w: 64,
    h: 32,
    frames: 6,
    rate: 16,
    repeat: 0,
    paint(p, i, n) {
      const t = (i + 1) / n;
      const rx = 6 + 25 * t;
      const ry = rx / 2;
      for (let a = 0; a < Math.PI * 2; a += 0.02) {
        if (i >= n - 2 && Math.round(a * 50) % 3) continue;
        p.set(32 + Math.cos(a) * rx, 16 + Math.sin(a) * ry, W);
        p.set(32 + Math.cos(a) * (rx - 1.5), 16 + Math.sin(a) * (ry - 1), L);
      }
      if (i < n - 2) p.ellipse(32, 16, rx - 2, ry - 1.5, D, (x, y) => (x + y + i) % 3 === 0);
    },
  },
  {
    // Energy orb in flight, pulsing.
    key: 'fx-orb',
    w: 12,
    h: 12,
    frames: 4,
    rate: 16,
    repeat: -1,
    paint(p, i) {
      const r = 3.2 + (i % 2) * 0.6;
      p.ellipse(6, 6, r + 1.2, r + 1.2, D, (x, y) => (x + y + i) % 2 === 0);
      p.ellipse(6, 6, r, r, L);
      p.ellipse(5.5, 5.5, r * 0.5, r * 0.5, W);
      const sp = [[1, 1], [10, 2], [11, 9], [2, 10]][i]!;
      p.set(sp[0]!, sp[1]!, W);
    },
  },
  {
    // Impact explosion: a flash, a ring, scattered embers.
    key: 'fx-burst',
    w: 32,
    h: 32,
    frames: 6,
    rate: 18,
    repeat: 0,
    paint(p, i) {
      const rnd = rand(7 + i);
      if (i === 0) p.ellipse(16, 16, 5, 5, W);
      if (i === 1) {
        p.ellipse(16, 16, 9, 9, L);
        p.ellipse(16, 16, 6, 6, W);
      }
      if (i >= 2) {
        const r = 6 + i * 2.2;
        for (let a = 0; a < Math.PI * 2; a += 0.05) if (i < 4 || Math.round(a * 40) % 3 === 0) p.set(16 + Math.cos(a) * r, 16 + Math.sin(a) * r, i < 4 ? W : M);
        if (i < 4) p.ellipse(16, 16, r - 2, r - 2, M, (x, y) => (x * 3 + y) % 4 === 0);
      }
      for (let k = 0; k < 10; k++) {
        const a = rnd() * Math.PI * 2;
        const d = 4 + i * 2.4 + rnd() * 3;
        if (d < 15) p.set(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, k % 3 ? L : W);
      }
    },
  },
  {
    // A column of light: drops in narrow, widens, thins out; motes rise.
    key: 'fx-pillar',
    w: 24,
    h: 64,
    frames: 6,
    rate: 14,
    repeat: 0,
    paint(p, i) {
      const widths = [2, 6, 9, 8, 5, 2];
      const w = widths[i]!;
      const top = i === 0 ? 40 : 0;
      for (let y = top; y < 60; y++) {
        for (let x = 12 - w / 2; x < 12 + w / 2; x++) {
          const edge = Math.abs(x + 0.5 - 12) > w / 2 - 1.2;
          if (i >= 4 && (x + y) % 2) continue;
          p.set(x, y, edge ? L : W);
        }
      }
      p.ellipse(12, 60, w / 2 + 4, 2.5, M, (x, y) => (x + y) % 2 === 0);
      const rnd = rand(31 + i);
      for (let k = 0; k < 8; k++) p.set(2 + rnd() * 20, 60 - ((rnd() * 50 + i * 8) % 56), k % 2 ? W : L);
    },
  },
  {
    // Lightning from the sky: a jagged bolt with forks, flickering.
    key: 'fx-bolt',
    w: 24,
    h: 96,
    frames: 4,
    rate: 18,
    repeat: 0,
    paint(p, i) {
      const rnd = rand(91 + (i % 2));
      let x = 12;
      for (let y = 0; y < 94; y += 6) {
        const nx = Math.max(3, Math.min(21, x + (rnd() - 0.5) * 10));
        p.line(x, y, nx, y + 6, i === 3 ? M : W, i < 2 ? 2 : 1);
        if (rnd() < 0.25 && i < 3) p.line(nx, y + 6, nx + (rnd() - 0.5) * 12, y + 12, L);
        x = nx;
      }
      if (i < 3) p.ellipse(x, 92, 6, 3, L, (px, py) => (px + py) % 2 === 0);
    },
  },
  {
    // Healing "+" sparkles that pop and fade.
    key: 'fx-plus',
    w: 9,
    h: 9,
    frames: 4,
    rate: 10,
    repeat: 0,
    paint(p, i) {
      const r = [2, 4, 3, 2][i]!;
      for (let k = -r; k <= r; k++) {
        p.set(4 + k, 4, Math.abs(k) === r ? L : W);
        p.set(4, 4 + k, Math.abs(k) === r ? L : W);
      }
      if (i === 1) p.ellipse(4, 4, 1.5, 1.5, W);
    },
  },
  {
    // An arrow with a steel tip and glowing fletching, pointing right.
    key: 'fx-arrow',
    w: 16,
    h: 5,
    frames: 1,
    rate: 1,
    repeat: 0,
    paint(p) {
      p.line(3, 2, 12, 2, 0x6b4a2e);
      p.line(12, 1, 15, 2, 0xe8edf5);
      p.line(12, 3, 15, 2, 0xa8b2c4);
      p.set(15, 2, 0xffffff);
      p.line(0, 1, 3, 1, 0x6ff2ff);
      p.line(0, 3, 3, 3, 0x4fb8d0);
      p.outline(0x16111e);
    },
  },
  {
    // A meteor with a flaming tail, falling to the lower right.
    key: 'fx-meteor',
    w: 20,
    h: 20,
    frames: 2,
    rate: 12,
    repeat: -1,
    paint(p, i) {
      for (let k = 0; k < 9; k++) {
        const t = k / 9;
        p.ellipse(13 - k * 1.3, 13 - k * 1.3, 3.5 - t * 2.5 + (i && k % 2 ? 0.5 : 0), 3.5 - t * 2.5, mix(0xffd84a, 0xff4a2a, t));
      }
      p.ellipse(14, 14, 3.6, 3.6, 0x7a3a2a);
      p.ellipse(13, 13, 1.6, 1.6, 0xff9a4a);
      p.outline(0x16111e);
    },
  },
];

/** Paints every effect sheet and registers its animation (frames are named "0", "1"...). */
export function makeFx(scene: Phaser.Scene): void {
  for (const d of DEFS) {
    if (scene.textures.exists(d.key)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = d.w * d.frames;
    canvas.height = d.h;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < d.frames; i++) {
      const p = new Pix(d.w, d.h);
      d.paint(p, i, d.frames);
      p.blit(ctx, i * d.w, 0);
    }
    const tex = scene.textures.addCanvas(d.key, canvas)!;
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (let i = 0; i < d.frames; i++) tex.add(String(i), 0, i * d.w, 0, d.w, d.h);
    if (!scene.anims.exists(d.key)) {
      scene.anims.create({ key: d.key, frames: Array.from({ length: d.frames }, (_, i) => ({ key: d.key, frame: String(i) })), frameRate: d.rate, repeat: d.repeat });
    }
  }
}
