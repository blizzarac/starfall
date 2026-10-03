import Phaser from 'phaser';
import type { Terrain } from '../core/grid';
import type { World } from '../core/world';
import { COLORS } from '../render/palette';
import { quality } from '../render/quality';
import { drawPixelBox } from './pixelui';

/** Width (px) of the map diamond inside the frame. */
const SIZE = 84;
const PAD = 6;
/** Redraw the moving dots this often (ms). */
const REFRESH_MS = 120;

const TERRAIN_COLOR: Record<Terrain, number> = {
  grass: 0x9adf73,
  flower: 0x9adf73,
  path: 0xf2dca2,
  cobble: 0xe4ded0,
  sand: 0xf7e3a8,
  plank: 0xd69d5e,
  water: 0x5fd0f5,
  tree: 0x3f8f4a,
  palm: 0x3fae4f,
  rock: 0x8d96a3,
  wall: 0xe8563f,
  cavewall: 0x3d3945,
  ruin: 0xcfa564,
};

/**
 * A small isometric overview in the corner: the map's ground, exits (cyan),
 * NPCs (yellow), monsters (red; bosses purple), your pet (pink) and you (white).
 * Tap it to open the world map.
 */
export class Minimap {
  readonly root: Phaser.GameObjects.Container;
  private readonly ground: Phaser.GameObjects.Image;
  private readonly dots: Phaser.GameObjects.Graphics;
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly shadow: Phaser.GameObjects.Rectangle;
  private readonly chrome: Phaser.GameObjects.Graphics;
  private k = 1;
  private ox = 0;
  private sinceDraw = REFRESH_MS;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    onTap: () => void,
  ) {
    this.shadow = scene.add.rectangle(4, 4, 10, 10, COLORS.ink, 0).setOrigin(0);
    this.frame = scene.add.rectangle(0, 0, 10, 10, COLORS.paper, 0).setOrigin(0);
    this.chrome = scene.add.graphics();
    this.frame.setInteractive({ useHandCursor: true }).on('pointerup', onTap);
    this.ground = scene.add.image(PAD, PAD, '__DEFAULT').setOrigin(0);
    this.dots = scene.add.graphics();
    this.root = scene.add.container(0, 0, [this.shadow, this.chrome, this.frame, this.ground, this.dots]);
    this.rebuild();
  }

  get width(): number {
    return this.frame.width;
  }

  get height(): number {
    return this.frame.height;
  }

  /** Redraws the ground for the current map (cached per map). */
  rebuild(): void {
    const map = this.world.map;
    const { width: w, height: h } = map;
    this.k = SIZE / (w + h);
    this.ox = h * this.k;
    const key = `minimap-${map.id}`;
    const texW = Math.ceil((w + h) * this.k);
    const texH = Math.ceil(((w + h) * this.k) / 2);
    if (!this.scene.textures.exists(key)) {
      const g = this.scene.make.graphics({}, false);
      const grid = this.world.grid;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = grid.terrainAt(x, y)!;
          const c = this.project(x, y);
          g.fillStyle(map.kind === 'dungeon' && (t === 'grass' || t === 'flower') ? 0x8a8494 : TERRAIN_COLOR[t]);
          g.fillPoints(
            [
              new Phaser.Math.Vector2(c.x, c.y - this.k / 2),
              new Phaser.Math.Vector2(c.x + this.k, c.y),
              new Phaser.Math.Vector2(c.x, c.y + this.k / 2),
              new Phaser.Math.Vector2(c.x - this.k, c.y),
            ],
            true,
          );
        }
      }
      g.generateTexture(key, texW, texH);
      g.destroy();
    }
    this.ground.setTexture(key);
    this.frame.setSize(texW + PAD * 2, texH + PAD * 2);
    this.shadow.setSize(texW + PAD * 2, texH + PAD * 2);
    this.frame.input?.hitArea.setTo(0, 0, texW + PAD * 2, texH + PAD * 2);
    drawPixelBox(this.chrome.clear(), 0, 0, texW + PAD * 2, texH + PAD * 2, COLORS.paper);
    this.frame.input?.hitArea.setTo(0, 0, texW + PAD * 2, texH + PAD * 2);
    this.sinceDraw = REFRESH_MS;
  }

  update(delta: number): void {
    this.sinceDraw += delta;
    if (this.sinceDraw < (quality.low ? REFRESH_MS * 3 : REFRESH_MS)) return;
    this.sinceDraw = 0;
    const g = this.dots.clear();
    const w = this.world;
    const dot = (x: number, y: number, color: number, r: number) => {
      const c = this.project(x, y);
      g.fillStyle(COLORS.ink).fillCircle(PAD + c.x, PAD + c.y, r + 1);
      g.fillStyle(color).fillCircle(PAD + c.x, PAD + c.y, r);
    };
    for (const portal of w.map.portals) {
      for (let dy = 0; dy < portal.area.h; dy++) for (let dx = 0; dx < portal.area.w; dx++) dot(portal.area.x + dx, portal.area.y + dy, 0x6fd6ff, 1.6);
    }
    for (const npc of w.npcs) dot(npc.x, npc.y, 0xffd84a, 1.8);
    for (const m of w.monsters.values()) dot(m.tile.x, m.tile.y, m.def.boss ? 0xb46cf0 : 0xff4a3a, m.def.boss ? 3 : 1.4);
    if (w.petMover) dot(w.petMover.tile.x, w.petMover.tile.y, 0xff8fb8, 1.6);
    const p = w.player.next ?? w.player.tile;
    dot(p.x, p.y, 0xffffff, 2.6);
  }

  private project(x: number, y: number): { x: number; y: number } {
    // Same diamond layout as the world, shrunk: tile centers sit at the middle of each cell.
    return { x: (x - y) * this.k + this.ox, y: (x + y + 1) * (this.k / 2) };
  }
}
