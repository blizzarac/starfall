/**
 * Pixel-art scenery and props: trees, rocks, palms, building blocks, the
 * notice board, loot bags, portals and shadows. Each is painted at half its
 * size in the world (two world units per art pixel) and registered with that
 * resolution, so placement code keeps using world-size scales and feet rows.
 */
import Phaser from 'phaser';
import { setArtRes } from './art';
import { monsterFrameCanvas } from './monsters';
import { mix, Pix, ramp, type Pt } from './pix';

const INK = 0x16111e;
const RES = 0.5;

function register(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
  setArtRes(key, RES);
}

/** Paints `draw` onto a w x h art-pixel canvas and registers it as `key`. */
function prop(scene: Phaser.Scene, key: string, w: number, h: number, draw: (p: Pix) => void, opts: { outline?: boolean; alpha?: number } = {}): void {
  const p = new Pix(w, h);
  draw(p);
  if (opts.outline !== false) p.outline(INK);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  p.blit(canvas.getContext('2d')!, 0, 0, opts.alpha);
  register(scene, key, canvas);
}

/** Every scenery texture the world uses (world sizes and feet rows as before). */
export function makeProps(scene: Phaser.Scene): void {
  prop(scene, 'shadow', 20, 8, (p) => p.ellipse(10, 4, 9.5, 3.5, INK), { outline: false, alpha: 80 });
  prop(scene, 'tree', 32, 48, tree);
  prop(scene, 'rock', 24, 16, rock);
  prop(scene, 'palm', 34, 48, palm);
  prop(scene, 'board', 24, 29, board);
  prop(scene, 'drop', 10, 10, drop);
  for (const windows of [false, true]) prop(scene, windows ? 'house-window' : 'house', 32, 36, (p) => house(p, windows), { outline: false });
  prop(scene, 'cavewall', 32, 36, cavewall, { outline: false });
  for (const glyph of [false, true]) prop(scene, glyph ? 'ruin-glyph' : 'ruin', 32, 36, (p) => ruin(p, glyph), { outline: false });
  prop(scene, 'portal', 32, 16, portal, { outline: false, alpha: 230 });
  prop(scene, 'tile-outline', 32, 16, (p) => diamondEdge(p, 0xffffff), { outline: false });
  register(scene, 'bird', monsterFrameCanvas('bird', 0xffffff));
}

function tree(p: Pix): void {
  const bark = ramp(0x8a5a36);
  const leaf = [ramp(0x3f9a4a), ramp(0x52b85a), ramp(0x6ad66b)] as const;
  p.poly([[13.5, 44.5], [14.5, 27], [18.5, 27], [19.5, 44.5]], bark.b);
  p.poly([[16.5, 44.5], [17, 27], [18.5, 27], [19.5, 44.5]], bark.d);
  p.set(15, 38, bark.k);
  p.set(15, 33, bark.l);
  p.rect(12, 44, 9, 1, bark.d);
  // Canopy: dark back clumps, mid clumps, a bright crown; dithered highlights.
  for (const [x, y, r] of [[8, 21, 7], [24, 21, 7], [16, 23, 9]] as const) p.ellipse(x, y, r, r * 0.85, leaf[0].b);
  for (const [x, y, r] of [[10, 15, 7], [22, 16, 7], [16, 18, 8]] as const) p.ellipse(x, y, r, r * 0.85, leaf[1].b);
  p.ellipse(15, 10, 7, 6, leaf[2].b);
  p.ellipse(13, 8, 3.5, 2.5, leaf[2].l);
  for (let y = 4; y < 30; y++) {
    for (let x = 1; x < 31; x++) {
      const c = p.get(x, y);
      if (c === leaf[1].b && (x + y) % 4 === 0 && y < 15) p.set(x, y, leaf[1].l);
      if ((c === leaf[0].b || c === leaf[1].b) && (x * 3 + y) % 7 === 0 && y > 18) p.set(x, y, leaf[0].d);
    }
  }
  for (const [x, y] of [[9, 17], [21, 19], [15, 24], [6, 23], [25, 23]] as const) {
    p.set(x, y, leaf[0].k);
    p.set(x + 1, y + 1, leaf[0].k);
    p.set(x + 2, y + 1, leaf[0].k);
    p.set(x + 3, y, leaf[0].k);
  }
  p.set(12, 7, leaf[2].h);
}

function rock(p: Pix): void {
  const r = ramp(0xb7bfcb);
  p.ellipse(12, 9, 10.5, 5.5, r.d);
  p.ellipse(11, 7.5, 9, 4.6, r.b);
  p.ellipse(8, 6, 4, 2, r.l);
  p.set(7, 5, r.h);
  p.line(13, 6, 15, 9, r.k);
  p.line(15, 9, 14, 12, r.k);
  p.set(18, 11, mix(r.d, 0x5aa04a, 0.6));
  p.set(19, 11, mix(r.d, 0x5aa04a, 0.6));
  p.set(4, 12, mix(r.d, 0x5aa04a, 0.6));
}

function palm(p: Pix): void {
  const bark = ramp(0xa8703f);
  const pts: Pt[] = [[15, 46], [16, 36], [18, 26], [20, 16]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k]!;
    const [x1, y1] = pts[k + 1]!;
    p.line(x0, y0, x1, y1, bark.b, 4);
  }
  for (let y = 18; y < 46; y += 4) {
    const x = Math.round(15 + (46 - y) * 0.17);
    p.line(x - 1, y, x + 2, y - 1, bark.d);
  }
  const frond = ramp(0x3fae4f);
  const tip: Array<[number, number, number]> = [[2, 17, 0], [7, 8, 1], [20, 4, 2], [31, 10, 1], [33, 20, 0], [12, 22, 0]];
  for (const [ax, ay, shade] of tip) {
    const c = shade === 2 ? frond.l : shade === 1 ? frond.b : frond.d;
    const mx = (20 + ax) / 2;
    const my = (14 + ay) / 2 - 2;
    p.line(20, 14, mx, my, c, 2);
    p.line(mx, my, ax, ay, c, 2);
    // Leaflets hanging off each frond.
    for (let t = 0.3; t < 1; t += 0.2) {
      const lx = 20 + (ax - 20) * t;
      const ly = 14 + (ay - 14) * t - 2 * Math.sin(Math.PI * t);
      p.line(lx, ly, lx + (ax < 20 ? -1 : 1), ly + 3, c);
    }
  }
  p.ellipse(18, 16, 1.8, 1.8, 0x6a4024);
  p.ellipse(22, 17, 1.8, 1.8, 0x7a4a2a);
  p.set(17, 15, 0xa8703f);
}

function board(p: Pix): void {
  const wood = ramp(0x9a6b42);
  p.rect(4, 11, 2, 16, wood.d);
  p.rect(18, 11, 2, 16, wood.d);
  p.rect(1, 3, 22, 14, wood.b);
  p.rect(1, 3, 22, 1, wood.l);
  p.rect(1, 16, 22, 1, wood.d);
  for (const y of [7, 11]) p.line(2, y, 22, y, wood.d);
  // Two paper notices and a glowing holo-screen.
  p.rect(3, 5, 5, 7, 0xf4ead2);
  p.rect(9, 6, 5, 6, 0xf4ead2);
  p.set(5, 5, 0xc9452f);
  p.set(11, 6, 0xc9452f);
  p.line(4, 8, 6, 8, 0xb8ac94);
  p.line(4, 10, 6, 10, 0xb8ac94);
  p.rect(15, 5, 6, 6, 0x1e3a4a);
  p.rect(16, 6, 4, 1, 0x6ff2ff);
  p.rect(16, 8, 3, 1, 0x4fb8d0);
  p.set(19, 9, 0xffffff);
}

function drop(p: Pix): void {
  // Drawn light so a tint gives it its color.
  p.ellipse(5, 6, 4, 3.5, 0xffffff);
  p.rect(3, 1, 4, 2, 0xe8e8ee);
  p.rect(3, 3, 4, 1, 0xb8b8c4);
  p.ellipse(5.5, 7, 3, 2.5, 0xe0e0e8, (x, y) => y > 6 && x > 4);
  p.set(3, 5, 0xffffff);
  p.set(6, 6, 0xd8f8ff);
}

/** An isometric block (32x36): left face, right face, top. Neighbors merge into one building. */
function block(p: Pix, top: number, left: number, right: number): void {
  p.poly([[0, 9], [16, 17], [16, 36], [0, 28]], left);
  p.poly([[16, 17], [32, 9], [32, 28], [16, 36]], right);
  p.poly([[0, 9], [16, 1], [32, 9], [16, 17]], top);
}

function house(p: Pix, windows: boolean): void {
  const wall = ramp(0xfff0d4);
  const roof = ramp(0xe0563f);
  block(p, roof.b, wall.b, wall.d);
  // Roof tiles in rows, and its overhanging eave.
  for (const t of [0.25, 0.5, 0.75]) p.line(16 * t, 9 + 8 * t, 16 + 16 * t, 1 + 8 * t, roof.d);
  p.line(1, 9, 16, 1.5, roof.l);
  p.poly([[0, 9], [16, 17], [16, 19], [0, 11]], roof.k);
  p.poly([[16, 17], [32, 9], [32, 11], [16, 19]], roof.d);
  // Half-timbered walls.
  const beam = ramp(0x6b4a2e).b;
  p.line(0, 18, 16, 26, beam);
  p.line(16, 26, 32, 18, beam);
  p.line(8, 14, 8, 31, beam);
  p.line(24, 14, 24, 31, beam);
  if (windows) {
    // Windows lit with a cool tech glow.
    p.poly([[3, 19], [6, 20.5], [6, 25.5], [3, 24]], 0x6ff2ff);
    p.set(4, 20, 0xffffff);
    p.poly([[26, 20.5], [29, 19], [29, 24], [26, 25.5]], 0x4fb8d0);
  }
}

function cavewall(p: Pix): void {
  const stone = ramp(0x5b5660);
  block(p, stone.l, stone.b, stone.d);
  for (const [x, y] of [[5, 20], [11, 26], [22, 24], [27, 18]] as const) p.line(x, y, x + 3, y + 1, stone.k);
  for (const [x, y] of [[8, 4], [20, 6]] as const) p.line(x, y, x + 4, y + 2, stone.b);
  // Crystals growing out of the rock.
  const crystal = (x: number, y: number, c: number) => {
    p.poly([[x, y + 5], [x + 1.5, y], [x + 3, y + 5]], c);
    p.set(x + 1, y + 2, 0xffffff);
  };
  crystal(7, 18, 0x9fd8ff);
  crystal(22, 22, 0x6ff2ff);
}

function ruin(p: Pix, glyph: boolean): void {
  const sand = ramp(0xe8c486);
  block(p, sand.l, sand.b, sand.d);
  p.line(0, 18, 16, 26, sand.k);
  p.line(16, 26, 32, 18, sand.k);
  p.line(8, 13, 8, 23, sand.k);
  p.line(24, 13, 24, 23, sand.k);
  p.line(4, 25, 4, 30, sand.k);
  p.line(28, 25, 28, 30, sand.k);
  if (glyph) {
    // A carved sun with a faint ancient glow.
    const g = 0xffc84a;
    p.ellipse(8, 25, 2.2, 2.2, g);
    p.set(8, 25, 0xfff6c8);
    for (const [dx, dy] of [[0, -4], [0, 4], [-4, 0], [4, 0], [-3, -3], [3, 3], [3, -3], [-3, 3]] as const) p.set(8 + dx, 25 + dy, mix(g, sand.b, 0.3));
  }
}

function portal(p: Pix): void {
  p.ellipse(16, 8, 15, 7, 0x1e4a66);
  p.ellipse(16, 8, 15, 7, 0x6fd6ff, (x, y) => !insideEllipse(x, y, 16, 8, 13, 5.6));
  p.ellipse(16, 8, 9, 4, 0xbff0ff, (x, y) => !insideEllipse(x, y, 16, 8, 7.5, 3));
  p.ellipse(16, 8, 3, 1.4, 0xffffff);
}

function insideEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** One-pixel outline of a 32x16 tile diamond. */
function diamondEdge(p: Pix, c: number): void {
  for (let j = -8; j < 8; j++) {
    const hw = 16 - Math.abs(j + 0.5) * 2;
    const y = 8 + j;
    p.set(16 - hw, y, c);
    p.set(16 - hw + 1, y, c);
    p.set(16 + hw - 1, y, c);
    p.set(16 + hw - 2, y, c);
  }
}
