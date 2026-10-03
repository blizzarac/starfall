import Phaser from 'phaser';
import type { Monster } from '../core/entities';
import type { Tile } from '../core/grid';
import { weaponOf } from '../core/equipment';
import { jobOf } from '../core/jobs';
import { STATUS_INFO } from '../core/status';
import type { MonsterDef } from '../data/schemas';
import { SimClock } from '../core/sim';
import type { SaveManager } from '../save/manager';
import { renderPosition, type EntityId, type World } from '../core/world';
import { chibiOrigin, ensureChibi, hexColor } from '../render/chibi';
import { feetOrigin, speedLines, starburst } from '../render/ink';
import { COLORS, IMPACT_FONT, WORLD_TEXT } from '../render/palette';
import { depthFor, TILE_H, TILE_W, tileToWorld, worldToTile } from '../render/iso';

interface MonsterView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
  lastX: number;
}

const DROP_TINT: Record<string, number> = { etc: 0xc9d4e6, consumable: 0xff7a7a, card: 0xffd84a, equipment: 0x9be38f };
const BOLT_COLORS: Record<string, number> = {
  fire_bolt: 0xff7a3a,
  cold_bolt: 0x7fd3ff,
  lightning_bolt: 0xfff27a,
  soul_strike: 0xd9b8ff,
};
/** Pixel row each monster drawing stands on (before inking). */
const MONSTER_FEET: Record<MonsterDef['look']['shape'], number> = {
  blob: 38,
  beetle: 36,
  sprout: 40,
  boar: 40,
  wolf: 40,
  mushroom: 42,
  bat: 40,
  golem: 52,
  crab: 36,
  bird: 42,
  scorpion: 36,
  worm: 54,
  skeleton: 54,
  mummy: 54,
  pharaoh: 62,
};
/** Comic sound effects for big hits, by what landed. */
const SFX = {
  hit: ['BAM!', 'WHAM!', 'POW!', 'KRAK!', 'DOKA!'],
  fire_bolt: ['FWOOSH!'],
  cold_bolt: ['KSSHH!'],
  lightning_bolt: ['ZZAP!'],
  soul_strike: ['VOOM!'],
  magnum_break: ['KA-BOOM!'],
  double_strafe: ['TWANG!', 'THWIP!'],
  arrow_shower: ['SHHHK!'],
  holy_light: ['SHIIN!'],
  slam: ['DOOOM!'],
  hurt: ['OOF!', 'GAH!'],
} as const;
/** What the player shouts when casting a buff. */
const BUFF_SHOUTS: Record<string, string> = {
  endure: 'ENDURE!',
  two_hand_quicken: 'QUICKEN!',
  kyrie_eleison: 'KYRIE!',
  impositio_manus: 'IMPOSITIO!',
  improve_concentration: 'FOCUS!',
  blessing: 'BLESSING!',
  increase_agi: 'AGI UP!',
};
/** A map whose grass color is this is a desert: trees and rocks stand on sand. */
const SAND_GROUND = '#f7e3a8';
/** Pointer distance (px) within which a click counts as hitting a monster or drop. */
const PICK_RADIUS = 24;
/** While the button is held, re-issue the move this often so the player follows the pointer. */
const HOLD_REPATH_MS = 120;

/** Draws the world from core state each frame and turns pointer input into intents. */
export class WorldScene extends Phaser.Scene {
  private world!: World;
  private clock!: SimClock;
  private alpha = 0;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Image;
  private monsterViews = new Map<number, MonsterView>();
  private dropViews = new Map<number, Phaser.GameObjects.Image>();
  /** Trees and buildings that fade when the player walks behind them. */
  private trees: Array<{ img: Phaser.GameObjects.Image; tile: Tile }> = [];
  private npcViews = new Map<string, Phaser.GameObjects.Container>();
  /** The pet following the player, and which species/name it was drawn for. */
  private petView: { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; key: string; lastX: number } | null = null;
  private hover!: Phaser.GameObjects.Image;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private castBar!: Phaser.GameObjects.Graphics;
  private statusLabel!: Phaser.GameObjects.Text;
  private holdTimer = 0;
  /** True while a press that started on the map (not on a HUD button) is held. */
  private pressOnMap = false;
  private lastPlayerX = 0;
  private attackAnimUntil = 0;
  private attackDir = { x: 0, y: 0 };

  constructor() {
    super('World');
  }

  create(): void {
    this.world = this.registry.get('world') as World;
    this.clock = new SimClock(() => this.world.tick());
    this.monsterViews.clear();
    this.dropViews.clear();
    this.trees = [];
    this.npcViews.clear();
    this.registry.set('clock', this.clock);

    const map = this.world.map;
    this.cameras.main.setBackgroundColor(map.kind === 'dungeon' ? '#16131c' : map.grass?.[0] === SAND_GROUND ? '#c9a35a' : '#3e7a45');
    this.drawGround();
    this.placeObstacles();
    this.placePortals();
    this.placeNpcs();

    this.hover = this.add.image(0, 0, 'tile-outline').setDepth(2).setAlpha(0.6);
    this.debugGfx = this.add.graphics().setDepth(5000);

    const playerKey = this.playerTexture();
    this.playerBody = this.add.image(0, 0, playerKey).setOrigin(0.5, chibiOrigin(this, playerKey));
    this.castBar = this.add.graphics();
    this.statusLabel = this.add.text(0, -66, '', { ...WORLD_TEXT, fontSize: '11px' }).setOrigin(0.5, 1);
    this.player = this.add.container(0, 0, [this.add.image(0, 0, 'shadow'), this.playerBody, this.castBar, this.statusLabel]);

    const cam = this.cameras.main;
    const { width, height } = this.world.map;
    const left = tileToWorld(0, height - 1).x - TILE_W;
    const right = tileToWorld(width - 1, 0).x + TILE_W;
    const bottom = tileToWorld(width - 1, height - 1).y + TILE_H;
    cam.setBounds(left, -TILE_H * 3, right - left, bottom + TILE_H * 3);
    cam.startFollow(this.player, true, 0.15, 0.15);
    // Phones in portrait need to see more of the map; big screens get a closer view.
    cam.setZoom(this.scale.width < 500 ? 0.9 : window.devicePixelRatio > 1 ? 1.25 : 1);

    this.bindInput();
    this.bindEvents();
    cam.fadeIn(250, 47, 93, 58);
  }

  override update(_time: number, delta: number): void {
    this.alpha = this.clock.advance(delta);
    (this.registry.get('saves') as SaveManager).update(delta);
    this.syncPlayer();
    this.fadeOccluders();
    this.syncMonsters();
    this.syncDrops();
    this.syncPet();
    this.updateHold(delta);
    this.updateHover();
    this.drawDebug();
  }

  // ---- Static map --------------------------------------------------------

  private drawGround(): void {
    const { width, height } = this.world.map;
    const ox = height * (TILE_W / 2);
    const oy = TILE_H / 2;
    const key = `ground-${this.world.map.id}`;
    if (this.textures.exists(key)) {
      this.add.image(-ox, -oy, key).setOrigin(0, 0).setDepth(0);
      return;
    }
    const g = this.make.graphics({}, false);
    const grid = this.world.grid;
    const dungeon = this.world.map.kind === 'dungeon';
    const grass = this.world.map.grass;
    // Terrain classes: an ink line is drawn wherever two different classes meet.
    const classOf = (x: number, y: number): string => {
      const t = grid.terrainAt(x, y);
      if (t === undefined) return 'void';
      if (t === 'tree' || t === 'rock' || t === 'flower') return grass?.[0] === SAND_GROUND ? 'sand' : 'grass';
      if (t === 'palm') return 'sand';
      return t === 'wall' || t === 'ruin' ? 'cobble' : t;
    };
    const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const terrain = grid.terrainAt(x, y)!;
        const kind = classOf(x, y) as keyof typeof COLORS;
        const base = grass && kind === 'grass' ? hexColor(grass[0]!) : (COLORS[kind] as readonly number[])[0]!;
        const c = tileToWorld(x, y);
        const cx = c.x + ox;
        const cy = c.y + oy;
        const h = hash(x, y);
        g.fillStyle(base).fillPoints([V(cx, cy - TILE_H / 2), V(cx + TILE_W / 2, cy), V(cx, cy + TILE_H / 2), V(cx - TILE_W / 2, cy)], true);

        // Hand-drawn texture marks, sparse so the ground stays calm.
        if (kind === 'grass' && !dungeon && h % 3 === 0) {
          g.lineStyle(1.3, COLORS.ink, 0.45);
          const tx = cx + ((h >>> 4) % 30) - 15;
          const ty = cy + ((h >>> 9) % 12) - 6;
          g.lineBetween(tx - 3, ty - 4, tx, ty).lineBetween(tx, ty, tx + 3, ty - 5);
        }
        if (kind === 'grass' && dungeon && h % 4 === 0) {
          g.lineStyle(1.2, COLORS.ink, 0.5);
          const tx = cx + ((h >>> 4) % 26) - 13;
          const ty = cy + ((h >>> 9) % 10) - 5;
          g.lineBetween(tx - 6, ty, tx, ty + 2).lineBetween(tx, ty + 2, tx + 5, ty - 1);
        }
        if (kind === 'path' && h % 2 === 0) {
          g.fillStyle(COLORS.ink, 0.28).fillCircle(cx + ((h >>> 3) % 24) - 12, cy + ((h >>> 8) % 10) - 5, 1.4);
        }
        if (kind === 'sand' && h % 3 === 0) {
          g.fillStyle(0xc9a35a, 0.8).fillCircle(cx + ((h >>> 3) % 24) - 12, cy + ((h >>> 8) % 10) - 5, 1.2);
          g.fillStyle(0xc9a35a, 0.8).fillCircle(cx + ((h >>> 6) % 20) - 10, cy + ((h >>> 11) % 8) - 4, 1);
        }
        if (kind === 'plank') {
          // Boards run along one iso axis, with a dark gap between them.
          g.lineStyle(1.2, COLORS.ink, 0.45);
          // From the left→bottom edge to the top→right edge, parallel to the left→top edge.
          for (const t of [1 / 3, 2 / 3]) g.lineBetween(cx - TILE_W / 2 + (t * TILE_W) / 2, cy + (t * TILE_H) / 2, cx + (t * TILE_W) / 2, cy - TILE_H / 2 + (t * TILE_H) / 2);
          if (h % 4 === 0) g.fillStyle(COLORS.ink, 0.5).fillCircle(cx, cy, 1.2);
        }
        if (kind === 'cobble') {
          g.lineStyle(1, COLORS.ink, 0.22).lineBetween(cx - 16, cy - 8, cx + 16, cy + 8).lineBetween(cx + 16, cy - 8, cx - 16, cy + 8);
        }
        if (kind === 'water' && h % 2 === 0) {
          g.lineStyle(2, 0xffffff, 0.9);
          const wx = cx + ((h >>> 5) % 16) - 8;
          g.beginPath().arc(wx, cy + 4, 6, Math.PI * 1.15, Math.PI * 1.85).strokePath();
        }
        if (terrain === 'flower') {
          const petals = [0xffffff, 0xffd84a, 0xff8fb8, 0xb9a4ff];
          for (let i = 0; i < 2; i++) {
            const px = cx + (((h >>> (i * 4)) & 15) - 7.5) * 2.4;
            const py = cy + (((h >>> (i * 4 + 2)) & 7) - 3.5) * 1.6;
            g.fillStyle(petals[(h >>> (i * 3)) % petals.length]!).fillCircle(px, py, 3);
            g.lineStyle(1.2, COLORS.ink).strokeCircle(px, py, 3);
            g.fillStyle(0xffd84a).fillCircle(px, py, 1);
          }
        }
      }
    }
    // Ink borders between different kinds of ground.
    g.lineStyle(2, COLORS.ink, 0.85);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = tileToWorld(x, y);
        const cx = c.x + ox;
        const cy = c.y + oy;
        const here = classOf(x, y);
        if (classOf(x + 1, y) !== here) g.lineBetween(cx + TILE_W / 2, cy, cx, cy + TILE_H / 2);
        if (classOf(x, y + 1) !== here) g.lineBetween(cx - TILE_W / 2, cy, cx, cy + TILE_H / 2);
        if (x === 0 || classOf(x - 1, y) !== here) g.lineBetween(cx - TILE_W / 2, cy, cx, cy - TILE_H / 2);
        if (y === 0 || classOf(x, y - 1) !== here) g.lineBetween(cx + TILE_W / 2, cy, cx, cy - TILE_H / 2);
      }
    }
    const texW = (width + height) * (TILE_W / 2);
    const texH = (width + height) * (TILE_H / 2);
    g.generateTexture(key, texW, texH);
    g.destroy();
    this.add.image(-ox, -oy, key).setOrigin(0, 0).setDepth(0);
  }

  private placeObstacles(): void {
    const { width, height } = this.world.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = this.world.grid.terrainAt(x, y);
        if (t !== 'tree' && t !== 'rock' && t !== 'wall' && t !== 'cavewall' && t !== 'palm' && t !== 'ruin') continue;
        const p = tileToWorld(x, y);
        let img: Phaser.GameObjects.Image;
        if (t === 'tree') {
          this.add.image(p.x, p.y + 4, 'shadow').setScale(1.3).setDepth(1);
          img = this.add.image(p.x, p.y + 4, 'tree').setOrigin(0.5, feetOrigin(this, 'tree', 88)).setScale(0.9 + (hash(x, y) % 5) * 0.05);
          this.trees.push({ img, tile: { x, y } });
        } else if (t === 'wall') {
          const key = hash(x, y) % 3 === 0 ? 'house-window' : 'house';
          img = this.add.image(p.x, p.y, key).setOrigin(0.5, feetOrigin(this, key, 56));
          this.trees.push({ img, tile: { x, y } });
        } else if (t === 'cavewall' || t === 'ruin') {
          const key = t === 'ruin' ? (hash(x, y) % 4 === 0 ? 'ruin-glyph' : 'ruin') : 'cavewall';
          img = this.add.image(p.x, p.y, key).setOrigin(0.5, feetOrigin(this, key, 56));
          this.trees.push({ img, tile: { x, y } });
        } else if (t === 'palm') {
          this.add.image(p.x, p.y + 4, 'shadow').setScale(1.1).setDepth(1);
          img = this.add.image(p.x, p.y + 4, 'palm').setOrigin(0.5, feetOrigin(this, 'palm', 92)).setFlipX(hash(x, y) % 2 === 0);
          this.trees.push({ img, tile: { x, y } });
        } else {
          this.add.image(p.x, p.y + 2, 'shadow').setDepth(1);
          img = this.add.image(p.x, p.y + 2, 'rock').setOrigin(0.5, feetOrigin(this, 'rock', 28));
        }
        img.setDepth(depthFor(p.y));
      }
    }
  }

  /** The player's look follows their job. */
  private playerTexture(): string {
    const job = jobOf(this.world.player);
    return ensureChibi(this, `job-${job.id}`, job.look.body, COLORS.playerHair, job.look.extra);
  }

  private placePortals(): void {
    for (const portal of this.world.map.portals) {
      for (let y = portal.area.y; y < portal.area.y + portal.area.h; y++) {
        for (let x = portal.area.x; x < portal.area.x + portal.area.w; x++) {
          const p = tileToWorld(x, y);
          const swirl = this.add.image(p.x, p.y, 'portal').setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: swirl, scale: { from: 0.85, to: 1.1 }, alpha: { from: 0.7, to: 1 }, yoyo: true, repeat: -1, duration: 900 });
        }
      }
    }
  }

  private placeNpcs(): void {
    for (const npc of this.world.npcs) {
      const p = tileToWorld(npc.x, npc.y);
      const body =
        npc.sprite === 'board'
          ? this.add.image(0, 0, 'board').setOrigin(0.5, feetOrigin(this, 'board', 54))
          : this.add
              .image(0, 0, ensureChibi(this, `npc-${npc.id}`, hexColor(npc.look.body), hexColor(npc.look.hair)))
              .setOrigin(0.5, chibiOrigin(this, `npc-${npc.id}`))
              .setFlipX(hash(npc.x, npc.y) % 2 === 0);
      const label = this.add
        .text(0, -66, npc.name, { ...WORLD_TEXT, fontSize: '12px', color: '#ffe27a' })
        .setOrigin(0.5, 1);
      const view = this.add.container(p.x, p.y, [this.add.image(0, 0, 'shadow'), body, label]).setDepth(depthFor(p.y));
      this.tweens.add({ targets: body, scaleY: { from: 1, to: 0.97 }, yoyo: true, repeat: -1, duration: 1200 + (hash(npc.x, npc.y) % 400) });
      this.npcViews.set(npc.id, view);
    }
  }

  // ---- Per-frame sync ----------------------------------------------------

  private syncPlayer(): void {
    const p = this.world.player;
    const statuses = [...p.statuses.keys()];
    this.statusLabel
      .setText(statuses.map((s) => STATUS_INFO[s].name).join(' · '))
      .setColor(statuses[0] ? STATUS_INFO[statuses[0]].color : '#ffffff');
    if (p.statuses.has('poison') && !this.playerBody.isTinted) this.playerBody.setTint(0xb6f59a);
    else if (!p.statuses.has('poison') && this.playerBody.tintTopLeft === 0xb6f59a) this.playerBody.clearTint();
    this.castBar.clear();
    if (p.casting) {
      const frac = 1 - Math.max(0, p.casting.remainingMs) / p.casting.totalMs;
      this.castBar.fillStyle(0x141a24, 0.85).fillRoundedRect(-22, 8, 44, 7, 3);
      this.castBar.fillStyle(0x9be3ff).fillRoundedRect(-21, 9, Math.max(2, 42 * frac), 5, 2);
    }
    const pos = renderPosition(p, this.alpha);
    const w = tileToWorld(pos.x, pos.y);
    let ox = 0;
    let oy = 0;
    const now = this.time.now;
    if (now < this.attackAnimUntil) {
      const k = Math.sin(((this.attackAnimUntil - now) / 180) * Math.PI) * 6;
      ox = this.attackDir.x * k;
      oy = this.attackDir.y * k;
    }
    this.player.setPosition(w.x + ox, w.y + oy).setDepth(depthFor(w.y) + 0.5);

    if (Math.abs(w.x - this.lastPlayerX) > 0.5) this.playerBody.setFlipX(w.x < this.lastPlayerX);
    this.lastPlayerX = w.x;

    const moving = p.next !== null;
    const bob = moving ? Math.abs(Math.sin(now / 70)) * 2 : 0;
    this.playerBody.setY(-bob);
    this.playerBody.setScale(1, p.sitting ? 0.72 : 1);
    this.player.setAlpha(p.dead ? 0.35 : 1);
    // Fainted players lie down; stunned ones wobble.
    this.playerBody.setAngle(p.dead ? 90 : p.statuses.has('stun') ? Math.sin(this.time.now / 60) * 6 : 0);
  }

  /** Trees just in front of the player turn see-through so the player never vanishes behind one. */
  private fadeOccluders(): void {
    const p = this.world.player.next ?? this.world.player.tile;
    for (const { img, tile } of this.trees) {
      const dx = tile.x - p.x;
      const dy = tile.y - p.y;
      const inFront = dx + dy > 0 && dx + dy <= 4 && Math.abs(dx - dy) <= 1;
      img.setAlpha(inFront ? 0.45 : 1);
    }
  }

  private syncMonsters(): void {
    const seen = new Set<number>();
    for (const m of this.world.monsters.values()) {
      seen.add(m.id);
      const view = this.monsterViews.get(m.id) ?? this.createMonsterView(m);
      const pos = renderPosition(m, this.alpha);
      const w = tileToWorld(pos.x, pos.y);
      view.root.setPosition(w.x, w.y).setDepth(depthFor(w.y));
      if (Math.abs(w.x - view.lastX) > 0.5) view.body.setFlipX(w.x < view.lastX);
      view.lastX = w.x;

      const t = this.time.now / 1000 + m.id;
      const squash = m.next ? Math.sin(t * 14) * 0.12 : Math.sin(t * 3) * 0.04;
      const s = m.def.look.scale;
      view.body.setScale(s * (1 + squash), s * (1 - squash));

      view.hpBar.clear();
      if (m.hp < m.def.hp) {
        const frac = Math.max(0, m.hp / m.def.hp);
        view.hpBar.fillStyle(COLORS.barBack).fillRect(-16, 6, 32, 4);
        view.hpBar.fillStyle(frac > 0.3 ? COLORS.hpBar : COLORS.hpBarLow).fillRect(-16, 6, 32 * frac, 4);
      }
    }
    for (const [id, view] of this.monsterViews) {
      if (!seen.has(id)) {
        this.monsterViews.delete(id);
        this.tweens.add({
          targets: view.root,
          alpha: 0,
          scaleY: 0.2,
          duration: 300,
          onComplete: () => view.root.destroy(),
        });
      }
    }
  }

  private createMonsterView(m: Monster): MonsterView {
    const color = Phaser.Display.Color.HexStringToColor(m.def.look.color).color;
    const shape = m.def.look.shape;
    const body = this.add.image(0, 0, shape).setOrigin(0.5, feetOrigin(this, shape, MONSTER_FEET[shape])).setTint(color);
    const hpBar = this.add.graphics();
    const root = this.add.container(0, 0, [this.add.image(0, 0, 'shadow').setScale(0.9), body, hpBar]);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 400 });
    const view = { root, body, hpBar, lastX: 0 };
    this.monsterViews.set(m.id, view);
    return view;
  }

  private syncPet(): void {
    const pet = this.world.player.pet;
    const mover = this.world.petMover;
    const key = pet ? `${pet.species}:${pet.name}` : '';
    if (this.petView && (!pet || !mover || this.petView.key !== key)) {
      this.petView.root.destroy();
      this.petView = null;
    }
    if (!pet || !mover) return;
    if (!this.petView) {
      const def = this.world.content.monsters.get(pet.species)!;
      const shape = def.look.shape;
      const body = this.add
        .image(0, 0, shape)
        .setOrigin(0.5, feetOrigin(this, shape, MONSTER_FEET[shape]))
        .setTint(Phaser.Display.Color.HexStringToColor(def.look.color).color);
      const label = this.add.text(0, -34, pet.name, { ...WORLD_TEXT, fontSize: '10px', color: '#ffb8d8' }).setOrigin(0.5, 1);
      const root = this.add.container(0, 0, [this.add.image(0, 0, 'shadow').setScale(0.6), body, label]);
      this.petView = { root, body, label, key, lastX: 0 };
    }
    const view = this.petView;
    const pos = renderPosition(mover, this.alpha);
    const w = tileToWorld(pos.x, pos.y);
    view.root.setPosition(w.x, w.y).setDepth(depthFor(w.y) + 0.2);
    if (Math.abs(w.x - view.lastX) > 0.5) view.body.setFlipX(w.x < view.lastX);
    view.lastX = w.x;
    const t = this.time.now / 1000;
    const hop = mover.next ? Math.abs(Math.sin(t * 12)) * 4 : 0;
    const squash = mover.next ? Math.sin(t * 14) * 0.08 : Math.sin(t * 3) * 0.03;
    // Pets are drawn smaller than their wild cousins.
    view.body.setScale(0.62 * (1 + squash), 0.62 * (1 - squash)).setY(-hop);
  }

  /** Little hearts rising from the pet (or the player if there is none on screen). */
  private hearts(count: number): void {
    const at = this.petView ? { x: this.petView.root.x, y: this.petView.root.y - 30 } : { x: this.player.x, y: this.player.y - 60 };
    for (let i = 0; i < count; i++) {
      const heart = this.add
        .text(at.x + Phaser.Math.Between(-14, 14), at.y, '♥', { fontFamily: IMPACT_FONT, fontSize: '20px', color: '#ff5a8a', stroke: '#16131c', strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(6000);
      this.tweens.add({ targets: heart, y: at.y - 40 - i * 6, alpha: 0, delay: i * 120, duration: 800, onComplete: () => heart.destroy() });
    }
  }

  private syncDrops(): void {
    for (const drop of this.world.drops.values()) {
      if (this.dropViews.has(drop.id)) {
        const img = this.dropViews.get(drop.id)!;
        img.setAlpha(drop.expiresIn < 5000 ? 0.4 + 0.6 * Math.abs(Math.sin(this.time.now / 150)) : 1);
        continue;
      }
      const item = this.world.content.items.get(drop.itemId)!;
      const w = tileToWorld(drop.tile.x, drop.tile.y);
      const img = this.add
        .image(w.x, w.y, 'drop')
        .setOrigin(0.5, feetOrigin(this, 'drop', 18))
        .setTint(DROP_TINT[item.type] ?? 0xffffff)
        .setDepth(depthFor(w.y) - 1);
      this.tweens.add({ targets: img, y: { from: w.y - 18, to: w.y }, duration: 350, ease: 'Bounce.easeOut' });
      this.dropViews.set(drop.id, img);
    }
    for (const [id, img] of this.dropViews) {
      if (!this.world.drops.has(id)) {
        img.destroy();
        this.dropViews.delete(id);
      }
    }
  }

  // ---- Input -------------------------------------------------------------

  private bindInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown()) return;
      this.holdTimer = HOLD_REPATH_MS;
      this.pressOnMap = true;
      this.handleClick(ptr);
    });
  }

  private handleClick(ptr: Phaser.Input.Pointer): void {
    const monster = this.monsterAt(ptr.worldX, ptr.worldY);
    if (monster) {
      this.world.attack(monster.id);
      return;
    }
    const pet = this.petView;
    if (pet && Phaser.Math.Distance.Between(ptr.worldX, ptr.worldY, pet.root.x, pet.root.y - 12) < this.pickRadius()) {
      this.game.events.emit('openPet');
      return;
    }
    const npcId = this.npcAt(ptr.worldX, ptr.worldY);
    if (npcId) {
      this.world.talkTo(npcId);
      return;
    }
    const dropId = this.dropAt(ptr.worldX, ptr.worldY);
    if (dropId !== null) {
      this.world.pickUp(dropId);
      return;
    }
    const tile = worldToTile(ptr.worldX, ptr.worldY);
    if (this.world.moveTo(tile)) this.flashMarker(tile);
  }

  /** Holding the button keeps walking toward the pointer, unless a fight or pickup is under way. */
  private updateHold(delta: number): void {
    const ptr = this.input.activePointer;
    if (!ptr.isDown) this.pressOnMap = false;
    if (!this.pressOnMap || !ptr.isDown || ptr.rightButtonDown() || this.world.player.intent.kind !== 'move' && this.world.player.intent.kind !== 'none') return;
    this.holdTimer -= delta;
    if (this.holdTimer > 0) return;
    this.holdTimer = HOLD_REPATH_MS;
    ptr.updateWorldPoint(this.cameras.main);
    const tile = worldToTile(ptr.worldX, ptr.worldY);
    const goal = this.world.player.goal;
    if (!goal || goal.x !== tile.x || goal.y !== tile.y) this.world.moveTo(tile);
  }

  private monsterAt(wx: number, wy: number): Monster | null {
    let best: Monster | null = null;
    let bestDist = this.pickRadius();
    for (const m of this.world.monsters.values()) {
      const view = this.monsterViews.get(m.id);
      if (!view) continue;
      const d = Phaser.Math.Distance.Between(wx, wy, view.root.x, view.root.y - 16);
      if (d < bestDist) {
        best = m;
        bestDist = d;
      }
    }
    return best;
  }

  private npcAt(wx: number, wy: number): string | null {
    for (const [id, view] of this.npcViews) {
      if (Phaser.Math.Distance.Between(wx, wy, view.x, view.y - 24) < this.pickRadius() * 1.2) return id;
    }
    return null;
  }

  private dropAt(wx: number, wy: number): number | null {
    for (const [id, img] of this.dropViews) {
      if (Phaser.Math.Distance.Between(wx, wy, img.x, img.y - 8) < this.pickRadius() * 0.7) return id;
    }
    return null;
  }

  /** Fingers are less precise than a mouse, so taps get a bigger target. */
  private pickRadius(): number {
    return this.sys.game.device.input.touch ? PICK_RADIUS * 1.5 : PICK_RADIUS;
  }

  private updateHover(): void {
    const ptr = this.input.activePointer;
    ptr.updateWorldPoint(this.cameras.main);
    const overMonster = this.monsterAt(ptr.worldX, ptr.worldY) !== null;
    const overDrop = !overMonster && (this.dropAt(ptr.worldX, ptr.worldY) !== null || this.npcAt(ptr.worldX, ptr.worldY) !== null);
    this.input.setDefaultCursor(overMonster ? 'crosshair' : overDrop ? 'pointer' : 'default');
    const tile = worldToTile(ptr.worldX, ptr.worldY);
    const w = tileToWorld(tile.x, tile.y);
    this.hover
      .setPosition(w.x, w.y)
      .setVisible(!this.sys.game.device.input.touch && this.world.grid.inBounds(tile.x, tile.y) && !overMonster)
      .setTint(this.world.grid.isWalkable(tile.x, tile.y) ? 0xffffff : 0xff6060);
  }

  private flashMarker(tile: Tile): void {
    const w = tileToWorld(tile.x, tile.y);
    const marker = this.add.image(w.x, w.y, 'tile-outline').setDepth(3).setTint(0xffe27a);
    this.tweens.add({ targets: marker, alpha: 0, scale: 0.6, duration: 450, onComplete: () => marker.destroy() });
  }

  // ---- Combat feedback ---------------------------------------------------

  private bindEvents(): void {
    const ev = this.world.events;
    const offs = [
      // Rebuild everything for the new map; the UI scene stays up.
      ev.on('mapChanged', () => this.scene.restart()),
      ev.on('damage', (e) => {
        const crit = e.crit;
        const toPlayer = e.targetId === 'player';
        const color = toPlayer ? '#ff5a4a' : crit ? '#ffd84a' : '#ffffff';
        this.damageNumber(e.targetId, e.amount === 0 && toPlayer ? 'BLOCK' : String(e.amount), e.amount === 0 && toPlayer ? '#fff6c8' : color, crit ? 30 : 22);
        if (crit) this.soundEffect(e.targetId, pick(SFX.hit), '#ffd84a', true);
        else if (toPlayer && e.sourceId !== 'player' && e.amount >= this.world.player.hp * 0.5) this.soundEffect('player', pick(SFX.hurt), '#ff5a4a');
        if (e.sourceId === 'player') this.playAttack(e.targetId);
        this.flashHit(e.targetId);
      }),
      ev.on('miss', (e) => {
        this.damageNumber(e.targetId, 'MISS', '#8fd0ff', 18);
        if (e.sourceId === 'player') this.playAttack(e.targetId);
      }),
      ev.on('heal', (e) => {
        if (e.hp > 0) this.floatText('player', `+${e.hp}`, '#7dff9a', 15);
      }),
      ev.on('jobChanged', () => {
        this.playerBody.setTexture(this.playerTexture());
        this.soundEffect('player', 'JOB CHANGE!!', '#ffe27a', true);
        speedLines(this, this.player.x, this.player.y - 30, { inner: 50, outer: 220, count: 40 });
        this.cameras.main.flash(300, 255, 240, 180);
      }),
      ev.on('skillUsed', (e) => this.skillEffect(e.skillId, e.targets, e.at)),
      ev.on('petTamed', () => {
        // The pet view appears on the next frame; celebrate from the player.
        this.soundEffect('player', 'TAMED!!', '#ff8fb8', true);
        speedLines(this, this.player.x, this.player.y - 30, { inner: 40, outer: 180, count: 30, color: 0xff5a8a });
        this.time.delayedCall(50, () => this.hearts(5));
      }),
      ev.on('tameFailed', () => this.floatText('player', 'It got away…', '#ffb8d8', 15, 1000)),
      ev.on('petFed', (e) => (e.delta > 0 ? this.hearts(e.delta >= 40 ? 3 : 1) : this.floatText('player', 'Too full!', '#ffb8d8', 14))),
      ev.on('telegraph', (e) => this.telegraph(e.tile, e.radius, e.ms)),
      ev.on('slam', (e) => {
        const at = tileToWorld(e.tile.x, e.tile.y);
        const burst = this.add.ellipse(at.x, at.y, TILE_W * (e.radius * 2 + 1), TILE_H * (e.radius * 2 + 1), 0xffb15a, 0.5).setDepth(3);
        this.tweens.add({ targets: burst, alpha: 0, scale: 1.15, duration: 350, onComplete: () => burst.destroy() });
        this.cameras.main.shake(220, 0.01);
        this.soundEffect(e.monsterId, pick(SFX.slam), '#ff9a4a', true);
        speedLines(this, at.x, at.y, { inner: 60, outer: 200, count: 34 });
      }),
      ev.on('castInterrupted', () => this.floatText('player', 'Interrupted!', '#ff9a7a', 14, 700)),
      ev.on('refined', (e) => {
        this.floatText('player', e.success ? `+${e.level}!` : 'Shattered…', e.success ? '#ffe27a' : '#ff6b6b', 18, 1200);
        if (e.success && e.level >= 5) this.cameras.main.flash(250, 255, 240, 180);
        if (!e.success) this.cameras.main.shake(200, 0.008);
      }),
      ev.on('levelUp', (e) => {
        this.soundEffect('player', e.kind === 'base' ? 'LEVEL UP!!' : 'JOB UP!!', '#ffe27a', true);
        speedLines(this, this.player.x, this.player.y - 30, { inner: 45, outer: 200, count: 36 });
        this.cameras.main.flash(200, 255, 240, 180);
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));
  }

  /** A red circle on the ground that fills up until an area attack lands. */
  private telegraph(tile: Tile, radius: number, ms: number): void {
    const at = tileToWorld(tile.x, tile.y);
    const w = TILE_W * (radius * 2 + 1);
    const h = TILE_H * (radius * 2 + 1);
    const ring = this.add.ellipse(at.x, at.y, w, h).setStrokeStyle(3, 0xff4a4a, 0.9).setDepth(3);
    const fill = this.add.ellipse(at.x, at.y, w, h, 0xff4a4a, 0.25).setDepth(3).setScale(0.05);
    this.tweens.add({ targets: fill, scale: 1, duration: ms, onComplete: () => (ring.destroy(), fill.destroy()) });
  }

  /** A streak from the caster to the target for each bolt. */
  private boltEffect(targets: number[], color: number): void {
    const view = targets[0] !== undefined ? this.monsterViews.get(targets[0]) : undefined;
    if (!view) return;
    const from = { x: this.player.x, y: this.player.y - 40 };
    const to = { x: view.root.x, y: view.root.y - 18 };
    const orb = this.add.circle(from.x, from.y, 7, color, 0.95).setDepth(4000).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: orb,
      x: to.x,
      y: to.y,
      duration: 180,
      onComplete: () => {
        const burst = this.add.circle(to.x, to.y, 10, color, 0.7).setDepth(4000).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: burst, scale: 2.4, alpha: 0, duration: 260, onComplete: () => burst.destroy() });
        orb.destroy();
      },
    });
  }

  private skillEffect(skillId: string, targets: number[], tile?: Tile): void {
    const at = { x: this.player.x, y: this.player.y };
    const center = tile ? tileToWorld(tile.x, tile.y) : at;
    const target = targets[0];
    if (skillId === 'bash') {
      if (target !== undefined) this.soundEffect(target, pick(SFX.hit), '#ffb15a', true);
      this.cameras.main.shake(90, 0.004);
    } else if (skillId === 'magnum_break') {
      const ring = this.add.ellipse(at.x, at.y, 40, 20).setStrokeStyle(6, 0xff7a3a, 0.9).setDepth(4000).setBlendMode(Phaser.BlendModes.ADD);
      const glow = this.add.ellipse(at.x, at.y, 40, 20, 0xffb15a, 0.35).setDepth(3999).setBlendMode(Phaser.BlendModes.ADD);
      // Radius 2 tiles: 5 tiles across in iso space.
      this.tweens.add({ targets: [ring, glow], scaleX: (TILE_W * 5) / 40, scaleY: (TILE_H * 5) / 20, alpha: 0, duration: 420, onComplete: () => (ring.destroy(), glow.destroy()) });
      this.cameras.main.shake(150, 0.006);
      this.soundEffect('player', pick(SFX.magnum_break), '#ff7a3a', true);
      speedLines(this, at.x, at.y - 20, { inner: 50, outer: 190 });
    } else if (skillId in BOLT_COLORS) {
      this.boltEffect(targets, BOLT_COLORS[skillId]!);
      const sfx = SFX[skillId as keyof typeof SFX];
      if (target !== undefined && sfx) this.time.delayedCall(180, () => this.soundEffect(target, pick(sfx), '#' + BOLT_COLORS[skillId]!.toString(16).padStart(6, '0')));
    } else if (skillId === 'double_strafe') {
      if (target !== undefined) {
        this.time.delayedCall(90, () => this.arrowEffect(target));
        this.soundEffect('player', pick(SFX.double_strafe), '#9be38f');
      }
    } else if (skillId === 'arrow_shower') {
      this.arrowRain(targets);
      if (target !== undefined) this.soundEffect(target, pick(SFX.arrow_shower), '#9be38f', true);
    } else if (skillId === 'holy_light') {
      if (target !== undefined) this.holyBeam(target);
    } else if (skillId === 'heal') {
      this.lightPillar(0x7dff9a);
      this.soundEffect('player', 'HEAL!', '#7dff9a');
    } else if (skillId === 'pierce') {
      if (target !== undefined) this.soundEffect(target, 'PIERCE!', '#9fd8ff', true);
      this.cameras.main.shake(90, 0.004);
    } else if (skillId === 'bowling_bash') {
      this.ring(center, 0xffd84a, 3);
      this.soundEffect(target ?? 'player', 'KRASH!!', '#ffd84a', true);
      speedLines(this, center.x, center.y - 20, { inner: 40, outer: 160 });
      this.cameras.main.shake(160, 0.007);
    } else if (skillId === 'sight_rasher') {
      this.ring(at, 0xff7a3a, 5);
      this.soundEffect('player', 'FWOOM!', '#ff7a3a', true);
      this.cameras.main.shake(120, 0.005);
    } else if (skillId === 'thunderstorm') {
      for (const id of targets) this.lightning(id);
      this.soundEffect(target ?? 'player', 'KRAKOOM!', '#fff27a', true);
      this.cameras.main.flash(120, 255, 250, 200);
    } else if (skillId === 'meteor_storm') {
      this.meteors(center);
      this.time.delayedCall(260, () => {
        this.ring(center, 0xff7a3a, 5);
        this.soundEffect(target ?? 'player', 'DOOOM!!', '#ff7a3a', true);
        this.cameras.main.shake(260, 0.012);
      });
    } else if (skillId === 'blitz_beat') {
      if (target !== undefined) this.falcon(target);
    } else if (skillId === 'claymore_trap') {
      this.ring(center, 0xff9a4a, 3);
      this.soundEffect(target ?? 'player', 'BOOM!', '#ff9a4a', true);
      this.cameras.main.shake(140, 0.006);
    } else if (skillId === 'magnus_exorcismus') {
      this.ring(center, 0xfff6c8, 5);
      for (const id of targets) this.holyBeam(id);
      this.soundEffect('player', 'MAGNUS!', '#fff6c8', true);
    } else if (skillId in BUFF_SHOUTS) {
      this.soundEffect('player', BUFF_SHOUTS[skillId]!, '#ffe27a');
      this.lightPillar(0xffe27a);
      this.playerBody.setTint(0xffe9a8);
      this.time.delayedCall(400, () => this.playerBody.clearTint());
    }
  }

  /** A flat ring bursting outward on the ground; `tiles` across. */
  private ring(at: { x: number; y: number }, color: number, tiles: number): void {
    const ring = this.add.ellipse(at.x, at.y, 40, 20).setStrokeStyle(6, color, 0.9).setDepth(4000).setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.ellipse(at.x, at.y, 40, 20, color, 0.35).setDepth(3999).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: [ring, glow], scaleX: (TILE_W * tiles) / 40, scaleY: (TILE_H * tiles) / 20, alpha: 0, duration: 420, onComplete: () => (ring.destroy(), glow.destroy()) });
  }

  /** A jagged bolt from the sky onto a monster. */
  private lightning(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const g = this.add.graphics().setDepth(4000);
    const x = view.root.x;
    let y = view.root.y - 220;
    const pts = [{ x, y }];
    while (y < view.root.y - 16) {
      y += 24;
      pts.push({ x: x + Phaser.Math.Between(-12, 12), y });
    }
    g.lineStyle(7, 0x16131c).strokePoints(pts as Phaser.Math.Vector2[]);
    g.lineStyle(4, 0xfff27a).strokePoints(pts as Phaser.Math.Vector2[]);
    this.tweens.add({ targets: g, alpha: 0, delay: 120, duration: 200, onComplete: () => g.destroy() });
  }

  /** Flaming rocks streaking down onto an area. */
  private meteors(center: { x: number; y: number }): void {
    for (let i = 0; i < 4; i++) {
      const x = center.x + Phaser.Math.Between(-50, 50);
      const y = center.y + Phaser.Math.Between(-16, 16);
      const rock = this.add.circle(x - 120, y - 260, 11, 0xff7a3a).setStrokeStyle(3, 0x16131c).setDepth(4000);
      const tail = this.add.ellipse(x - 120, y - 260, 46, 12, 0xffd84a, 0.8).setDepth(3999).setRotation(Math.atan2(260, 120));
      this.tweens.add({
        targets: [rock, tail],
        x: (t: Phaser.GameObjects.GameObject) => (t === rock ? x : x - 14),
        y: (t: Phaser.GameObjects.GameObject) => (t === rock ? y : y - 30),
        delay: i * 70,
        duration: 260,
        onComplete: () => (rock.destroy(), tail.destroy()),
      });
    }
  }

  /** The Hunter's falcon swooping from the player onto a monster and back. */
  private falcon(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const bird = this.add.image(this.player.x, this.player.y - 70, 'bird').setScale(0.7).setTint(0xc9a36a).setDepth(4500);
    bird.setFlipX(view.root.x < this.player.x);
    this.tweens.chain({
      targets: bird,
      tweens: [
        { x: view.root.x, y: view.root.y - 24, duration: 180, ease: 'Quad.easeIn' },
        { x: this.player.x, y: this.player.y - 90, alpha: 0, duration: 300, ease: 'Quad.easeOut' },
      ],
      onComplete: () => bird.destroy(),
    });
    this.time.delayedCall(180, () => this.soundEffect(targetId, 'SCREE!', '#ffe27a', true));
  }

  /** An arrow flying from the player to a monster. */
  private arrowEffect(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const from = { x: this.player.x, y: this.player.y - 34 };
    const to = { x: view.root.x, y: view.root.y - 18 };
    const arrow = this.add.container(from.x, from.y, [
      this.add.rectangle(0, 0, 22, 3, 0x16131c),
      this.add.rectangle(-9, 0, 6, 5, 0xff6a5a).setStrokeStyle(1, 0x16131c),
      this.add.triangle(13, 0, 0, -4, 6, 0, 0, 4, 0xe8edf5).setStrokeStyle(1, 0x16131c),
    ]);
    arrow.setDepth(4000).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
    this.tweens.add({ targets: arrow, x: to.x, y: to.y, duration: 140, onComplete: () => arrow.destroy() });
  }

  /** Arrows falling from the sky onto each target. */
  private arrowRain(targets: number[]): void {
    for (const id of targets) {
      const view = this.monsterViews.get(id);
      if (!view) continue;
      for (let i = 0; i < 4; i++) {
        const x = view.root.x + Phaser.Math.Between(-18, 18);
        const y = view.root.y - 10 + Phaser.Math.Between(-6, 6);
        const arrow = this.add.container(x - 30, y - 140, [
          this.add.rectangle(0, 0, 20, 3, 0x16131c),
          this.add.triangle(12, 0, 0, -4, 6, 0, 0, 4, 0xe8edf5).setStrokeStyle(1, 0x16131c),
        ]);
        arrow.setDepth(4000).setRotation(Math.atan2(140, 30));
        this.tweens.add({ targets: arrow, x, y, delay: i * 60, duration: 160, onComplete: () => arrow.destroy() });
      }
    }
  }

  /** A pillar of light dropping onto a monster. */
  private holyBeam(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const beam = this.add.rectangle(view.root.x, view.root.y - 100, 34, 200, 0xfff6c8, 0.85).setStrokeStyle(3, 0x16131c).setDepth(4000).setScale(0.2, 1);
    this.tweens.add({ targets: beam, scaleX: 1, duration: 120, yoyo: true, hold: 120, onComplete: () => beam.destroy() });
    speedLines(this, view.root.x, view.root.y - 30, { inner: 30, outer: 120, count: 20 });
    this.soundEffect(targetId, pick(SFX.holy_light), '#fff6c8', true);
  }

  /** A soft column of light rising around the player, for heals and buffs. */
  private lightPillar(color: number): void {
    const x = this.player.x;
    const y = this.player.y;
    for (let i = 0; i < 8; i++) {
      const spark = this.add.star(x + Phaser.Math.Between(-20, 20), y - Phaser.Math.Between(0, 20), 4, 2, 6, color).setStrokeStyle(1.5, 0x16131c).setDepth(4000);
      this.tweens.add({ targets: spark, y: spark.y - 60, alpha: 0, angle: 180, delay: i * 40, duration: 600, onComplete: () => spark.destroy() });
    }
  }

  private anchorOf(id: EntityId): { x: number; y: number } | null {
    if (id === 'player') return { x: this.player.x, y: this.player.y - 56 };
    const view = this.monsterViews.get(id);
    return view ? { x: view.root.x, y: view.root.y - 40 } : null;
  }

  private floatText(id: EntityId, text: string, color: string, size: number, duration = 800): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const label = this.add
      .text(at.x + Phaser.Math.Between(-6, 6), at.y, text, { ...WORLD_TEXT, fontSize: `${size}px`, color })
      .setOrigin(0.5)
      .setDepth(6000);
    this.tweens.add({
      targets: label,
      y: at.y - 36,
      alpha: { from: 1, to: 0 },
      ease: 'Cubic.easeOut',
      duration,
      onComplete: () => label.destroy(),
    });
  }

  /** Comic damage number: impact font, heavy ink outline, pops in tilted then floats up. */
  private damageNumber(id: EntityId, text: string, color: string, size: number): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const label = this.add
      .text(at.x + Phaser.Math.Between(-10, 10), at.y, text, {
        fontFamily: IMPACT_FONT,
        fontSize: `${size}px`,
        color,
        stroke: '#16131c',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAngle(Phaser.Math.Between(-12, 12))
      .setScale(1.6)
      .setDepth(6000);
    this.tweens.add({ targets: label, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, y: at.y - 42, alpha: { from: 1, to: 0 }, delay: 250, duration: 650, ease: 'Cubic.easeIn', onComplete: () => label.destroy() });
  }

  /** Onomatopoeia ("BAM!") in a starburst next to whoever got hit. */
  private soundEffect(id: EntityId, text: string, color: string, burst = false): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const x = at.x + Phaser.Math.Between(-24, 24);
    const y = at.y - 18;
    const label = this.add
      .text(0, 0, text, { fontFamily: IMPACT_FONT, fontSize: '26px', color, stroke: '#16131c', strokeThickness: 7 })
      .setOrigin(0.5);
    const parts: Phaser.GameObjects.GameObject[] = [label];
    if (burst) parts.unshift(starburst(this.add.graphics(), Math.max(34, label.width * 0.75), 12, 0xffffff));
    const fx = this.add.container(x, y, parts).setDepth(6100).setAngle(Phaser.Math.Between(-15, 15)).setScale(0.3);
    this.tweens.add({ targets: fx, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: fx, alpha: 0, delay: 600, duration: 300, onComplete: () => fx.destroy() });
  }

  private playAttack(targetId: EntityId): void {
    if (targetId === 'player') return;
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const dx = view.root.x - this.player.x;
    const dy = view.root.y - this.player.y;
    if (weaponOf(this.world.player).type === 'bow') {
      // Archers don't lunge; the arrow does the travelling.
      this.playerBody.setFlipX(dx < 0);
      this.arrowEffect(targetId);
      return;
    }
    const len = Math.hypot(dx, dy) || 1;
    this.attackDir = { x: dx / len, y: dy / len };
    this.attackAnimUntil = this.time.now + 180;
    this.playerBody.setFlipX(dx < 0);
  }

  private flashHit(id: EntityId): void {
    if (id === 'player') {
      this.playerBody.setTintFill(0xffffff);
      this.time.delayedCall(80, () => this.playerBody.clearTint());
      return;
    }
    const view = this.monsterViews.get(id);
    if (!view) return;
    const m = this.world.monsters.get(id);
    view.body.setTintFill(0xffffff);
    this.time.delayedCall(80, () => {
      if (m) view.body.setTint(Phaser.Display.Color.HexStringToColor(m.def.look.color).color);
    });
  }

  // ---- Debug -------------------------------------------------------------

  private drawDebug(): void {
    const g = this.debugGfx;
    g.clear();
    if (!this.registry.get('debug')) return;
    const drawPath = (from: { x: number; y: number }, path: Tile[], color: number) => {
      if (path.length === 0) return;
      g.lineStyle(2, color, 0.8).beginPath();
      const s = tileToWorld(from.x, from.y);
      g.moveTo(s.x, s.y);
      for (const t of path) {
        const w = tileToWorld(t.x, t.y);
        g.lineTo(w.x, w.y);
      }
      g.strokePath();
    };
    const p = this.world.player;
    drawPath(p.next ?? p.tile, p.path, 0xffe27a);
    for (const m of this.world.monsters.values()) {
      drawPath(m.next ?? m.tile, m.path, m.hostile ? 0xff5050 : 0x80c0ff);
      const view = this.monsterViews.get(m.id);
      if (view) {
        g.fillStyle(m.hostile ? 0xff5050 : 0x80c0ff, 1).fillCircle(view.root.x, view.root.y - 44, 3);
      }
    }
  }
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}
