import Phaser from 'phaser';
import type { Monster } from '../core/entities';
import type { Tile } from '../core/grid';
import { jobOf } from '../core/jobs';
import type { MonsterDef } from '../data/schemas';
import { SimClock } from '../core/sim';
import type { SaveManager } from '../save/manager';
import { renderPosition, type EntityId, type World } from '../core/world';
import { CHIBI_FEET_Y, CHIBI_H, ensureChibi, hexColor } from '../render/chibi';
import { COLORS, TEXT } from '../render/palette';
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
/** Feet position (origin Y) of each monster texture. */
const MONSTER_LOOKS: Record<MonsterDef['look']['shape'], { feet: number }> = {
  blob: { feet: 38 / 40 },
  beetle: { feet: 36 / 40 },
  sprout: { feet: 40 / 44 },
  boar: { feet: 40 / 44 },
  wolf: { feet: 40 / 44 },
  mushroom: { feet: 42 / 44 },
  bat: { feet: 40 / 44 },
  golem: { feet: 52 / 56 },
};
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
  private hover!: Phaser.GameObjects.Image;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private castBar!: Phaser.GameObjects.Graphics;
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

    this.cameras.main.setBackgroundColor(this.world.map.kind === 'dungeon' ? '#1d1b22' : '#2f5d3a');
    this.drawGround();
    this.placeObstacles();
    this.placePortals();
    this.placeNpcs();

    this.hover = this.add.image(0, 0, 'tile-outline').setDepth(2).setAlpha(0.6);
    this.debugGfx = this.add.graphics().setDepth(5000);

    this.playerBody = this.add.image(0, 0, this.playerTexture()).setOrigin(0.5, CHIBI_FEET_Y / CHIBI_H);
    this.castBar = this.add.graphics();
    this.player = this.add.container(0, 0, [this.add.image(0, 0, 'shadow'), this.playerBody, this.castBar]);

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
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const terrain = this.world.grid.terrainAt(x, y)!;
        const kind = terrain === 'tree' || terrain === 'rock' ? 'grass' : terrain;
        const grass = this.world.map.grass;
        const shade =
          grass && (kind === 'grass' || kind === 'flower') ? hexColor(grass[(x + y) % 2]!) : COLORS[kind][(x + y) % 2]!;
        const c = tileToWorld(x, y);
        const cx = c.x + ox;
        const cy = c.y + oy;
        g.fillStyle(shade).fillPoints(
          [
            new Phaser.Math.Vector2(cx, cy - TILE_H / 2),
            new Phaser.Math.Vector2(cx + TILE_W / 2, cy),
            new Phaser.Math.Vector2(cx, cy + TILE_H / 2),
            new Phaser.Math.Vector2(cx - TILE_W / 2, cy),
          ],
          true,
        );
        if (terrain === 'flower') {
          const h = hash(x, y);
          const petals = [0xffffff, 0xffd84a, 0xff8fb8, 0xb9a4ff];
          for (let i = 0; i < 3; i++) {
            const px = cx + (((h >>> (i * 4)) & 15) - 7.5) * 2.4;
            const py = cy + (((h >>> (i * 4 + 2)) & 7) - 3.5) * 1.6;
            g.fillStyle(petals[(h >>> (i * 3)) % petals.length]!).fillCircle(px, py, 2.2);
          }
        }
        if (terrain === 'water') {
          g.fillStyle(0xffffff, 0.25).fillEllipse(cx - 6 + (hash(x, y) % 12), cy, 10, 2);
        }
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
        if (t !== 'tree' && t !== 'rock' && t !== 'wall' && t !== 'cavewall') continue;
        const p = tileToWorld(x, y);
        let img: Phaser.GameObjects.Image;
        if (t === 'tree') {
          img = this.add.image(p.x, p.y + 4, 'tree').setOrigin(0.5, 88 / 96).setScale(0.9 + (hash(x, y) % 5) * 0.05);
          this.trees.push({ img, tile: { x, y } });
        } else if (t === 'wall') {
          img = this.add.image(p.x, p.y, hash(x, y) % 3 === 0 ? 'house-window' : 'house').setOrigin(0.5, 56 / 72);
          this.trees.push({ img, tile: { x, y } });
        } else if (t === 'cavewall') {
          img = this.add.image(p.x, p.y, 'cavewall').setOrigin(0.5, 56 / 72);
          this.trees.push({ img, tile: { x, y } });
        } else {
          img = this.add.image(p.x, p.y + 2, 'rock').setOrigin(0.5, 28 / 32);
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
      const key = ensureChibi(this, `npc-${npc.id}`, hexColor(npc.look.body), hexColor(npc.look.hair));
      const p = tileToWorld(npc.x, npc.y);
      const body = this.add.image(0, 0, key).setOrigin(0.5, CHIBI_FEET_Y / CHIBI_H).setFlipX(hash(npc.x, npc.y) % 2 === 0);
      const label = this.add
        .text(0, -62, npc.name, { ...TEXT, fontSize: '12px', color: '#ffe9a8' })
        .setOrigin(0.5, 1);
      const view = this.add.container(p.x, p.y, [this.add.image(0, 0, 'shadow'), body, label]).setDepth(depthFor(p.y));
      this.tweens.add({ targets: body, scaleY: { from: 1, to: 0.97 }, yoyo: true, repeat: -1, duration: 1200 + (hash(npc.x, npc.y) % 400) });
      this.npcViews.set(npc.id, view);
    }
  }

  // ---- Per-frame sync ----------------------------------------------------

  private syncPlayer(): void {
    const p = this.world.player;
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
    this.playerBody.setAngle(p.dead ? 90 : 0);
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
    const look = MONSTER_LOOKS[m.def.look.shape];
    const body = this.add.image(0, 0, m.def.look.shape).setOrigin(0.5, look.feet).setTint(color);
    const hpBar = this.add.graphics();
    const root = this.add.container(0, 0, [this.add.image(0, 0, 'shadow').setScale(0.9), body, hpBar]);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 400 });
    const view = { root, body, hpBar, lastX: 0 };
    this.monsterViews.set(m.id, view);
    return view;
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
        .setOrigin(0.5, 0.9)
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
        const color = e.targetId === 'player' ? '#ff6b6b' : crit ? '#ffd84a' : '#ffffff';
        this.floatText(e.targetId, String(e.amount), color, crit ? 22 : 16);
        if (e.sourceId === 'player') this.playAttack(e.targetId);
        this.flashHit(e.targetId);
      }),
      ev.on('miss', (e) => {
        this.floatText(e.targetId, 'Miss', '#8fd0ff', 14);
        if (e.sourceId === 'player') this.playAttack(e.targetId);
      }),
      ev.on('heal', (e) => {
        if (e.hp > 0) this.floatText('player', `+${e.hp}`, '#7dff9a', 15);
      }),
      ev.on('jobChanged', () => {
        this.playerBody.setTexture(this.playerTexture());
        this.floatText('player', 'JOB CHANGE!', '#ffe27a', 20, 1600);
        this.cameras.main.flash(300, 255, 240, 180);
      }),
      ev.on('skillUsed', (e) => this.skillEffect(e.skillId, e.targets)),
      ev.on('telegraph', (e) => this.telegraph(e.tile, e.radius, e.ms)),
      ev.on('slam', (e) => {
        const at = tileToWorld(e.tile.x, e.tile.y);
        const burst = this.add.ellipse(at.x, at.y, TILE_W * (e.radius * 2 + 1), TILE_H * (e.radius * 2 + 1), 0xffb15a, 0.5).setDepth(3);
        this.tweens.add({ targets: burst, alpha: 0, scale: 1.15, duration: 350, onComplete: () => burst.destroy() });
        this.cameras.main.shake(220, 0.01);
      }),
      ev.on('castInterrupted', () => this.floatText('player', 'Interrupted!', '#ff9a7a', 14, 700)),
      ev.on('refined', (e) => {
        this.floatText('player', e.success ? `+${e.level}!` : 'Shattered…', e.success ? '#ffe27a' : '#ff6b6b', 18, 1200);
        if (e.success && e.level >= 5) this.cameras.main.flash(250, 255, 240, 180);
        if (!e.success) this.cameras.main.shake(200, 0.008);
      }),
      ev.on('levelUp', (e) => {
        this.floatText('player', e.kind === 'base' ? 'LEVEL UP!' : 'JOB LEVEL UP!', '#ffe27a', 20, 1400);
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

  private skillEffect(skillId: string, targets: number[]): void {
    const at = { x: this.player.x, y: this.player.y };
    if (skillId === 'bash') {
      this.floatText('player', 'Bash!', '#ffb15a', 15, 600);
      this.cameras.main.shake(90, 0.004);
    } else if (skillId === 'magnum_break') {
      const ring = this.add.ellipse(at.x, at.y, 40, 20).setStrokeStyle(6, 0xff7a3a, 0.9).setDepth(4000).setBlendMode(Phaser.BlendModes.ADD);
      const glow = this.add.ellipse(at.x, at.y, 40, 20, 0xffb15a, 0.35).setDepth(3999).setBlendMode(Phaser.BlendModes.ADD);
      // Radius 2 tiles: 5 tiles across in iso space.
      this.tweens.add({ targets: [ring, glow], scaleX: (TILE_W * 5) / 40, scaleY: (TILE_H * 5) / 20, alpha: 0, duration: 420, onComplete: () => (ring.destroy(), glow.destroy()) });
      this.cameras.main.shake(150, 0.006);
    } else if (skillId in BOLT_COLORS) {
      this.boltEffect(targets, BOLT_COLORS[skillId]!);
    } else if (skillId === 'endure') {
      this.floatText('player', 'Endure', '#ffe27a', 15, 900);
      this.playerBody.setTint(0xffe9a8);
      this.time.delayedCall(400, () => this.playerBody.clearTint());
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
      .text(at.x + Phaser.Math.Between(-6, 6), at.y, text, { ...TEXT, fontSize: `${size}px`, color, fontStyle: 'bold' })
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

  private playAttack(targetId: EntityId): void {
    if (targetId === 'player') return;
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const dx = view.root.x - this.player.x;
    const dy = view.root.y - this.player.y;
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
