import Phaser from 'phaser';
import type { Monster } from '../core/entities';
import type { Pet } from '../core/pets';
import type { Tile } from '../core/grid';
import { weaponOf } from '../core/equipment';
import { jobOf } from '../core/jobs';
import { auraRadius, skillLevel, type SkillId } from '../core/skills';
import { STORY } from '../core/story';
import { STATUS_INFO } from '../core/status';
import type { MonsterDef, NpcDef } from '../data/schemas';
import { SimClock } from '../core/sim';
import type { SaveManager } from '../save/manager';
import { renderPosition, type EntityId, type World } from '../core/world';
import { WORLD_CHAR_SCALE, chibiOrigin, ensureChibi, hexColor, playerChibi, PORTRAIT_FRAME } from '../render/chibi';
import { animKey, type Anim, type Facing } from '../render/knight';
import { ensureMonster, MON_ORIGIN_Y, monsterAnimKey, WORLD_PX, type MonsterAnim } from '../render/monsters';
import { paintGround } from '../render/ground';
import { setArtRes } from '../render/art';
import type { FxKey } from '../render/fx';
import { mapLight } from '../render/lighting';
import { npcAppearance } from '../core/appearance';
import { BURST_RADIUS, feetOrigin, speedLines } from '../render/ink';
import { COLORS, IMPACT_FONT, WORLD_TEXT } from '../render/palette';
import { quality } from '../render/quality';
import { DPR, viewSize } from '../render/view';
import { depthFor, TILE_H, TILE_W, tileToWorld, worldToTile } from '../render/iso';

interface MonsterView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Graphics;
  lastX: number;
  /** Sheet key and the animation playing, so it only restarts on change. */
  key: string;
  anim: string;
  attackUntil: number;
  light?: Phaser.GameObjects.Image;
  /** Boss phase reached; tints it redder. */
  rage?: number;
  /** HP the bar was last drawn for; it's only redrawn when this changes. */
  lastHp: number;
}

/** A pet on screen. */
interface PetView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  key: string;
  sheet: string;
  anim: string;
  lastX: number;
  /** Scene time until which the bite animation plays. */
  biteUntil: number;
}

/** Each aura's ground glow: color, and its size relative to the reach. */
const AURA_LOOKS: Array<[SkillId, number, number]> = [
  ['battle_aura', 0x4fe6ff, 1],
  ['holy_aura', 0xfffbe8, 0.9],
];
/** How red an enraged boss glows in each phase. */
const RAGE_TINT = [0xffffff, 0xffc8b0, 0xff8a7a];
/** Lights sit above the dark overlay so they shine through it. */
const LIGHT_DEPTH = 5000;
/** Each job's energy color, for the glow around the player in the dark. */
const JOB_GLOW: Partial<Record<string, number>> = {
  novice: 0x6dffa8,
  swordsman: 0x4fe6ff,
  knight: 0x5aa8ff,
  mage: 0xc77dff,
  wizard: 0xff6ae0,
  archer: 0xa8ff5e,
  hunter: 0xffa84f,
  acolyte: 0xffe27a,
  priest: 0x8af0ff,
};
/** Glow color of each monster's eyes or core. */
const MONSTER_GLOW: Partial<Record<string, number>> = { drone: 0xff4a4a, automaton: 0xffa83a, titan: 0xff6a3a, boar: 0xff4a4a, bat: 0xff4a4a, skeleton: 0xff4a4a, pharaoh: 0xff4a4a, mummy: 0xffe27a, beetle: 0xffc84a, scorpion: 0x9dff5e, sprout: 0xc8ff8a };

const DROP_TINT: Record<string, number> = { etc: 0xc9d4e6, consumable: 0xff7a7a, card: 0xffd84a, equipment: 0x9be38f };
const BOLT_COLORS: Record<string, number> = {
  fire_bolt: 0xff7a3a,
  cold_bolt: 0x7fd3ff,
  lightning_bolt: 0xfff27a,
  soul_strike: 0xd9b8ff,
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
/** How long one attack animation plays (5 frames at 18 fps). */
const ATTACK_ANIM_MS = 280;

/** Draws the world from core state each frame and turns pointer input into intents. */
export class WorldScene extends Phaser.Scene {
  private world!: World;
  private clock!: SimClock;
  private alpha = 0;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Sprite;
  private monsterViews = new Map<number, MonsterView>();
  private dropViews = new Map<number, Phaser.GameObjects.Image>();
  /** Trees and buildings that fade when the player walks behind them. */
  private trees: Array<{ img: Phaser.GameObjects.Image; tile: Tile }> = [];
  private npcViews = new Map<string, Phaser.GameObjects.Container>();
  /** The pet following the player, and which species/name it was drawn for. */
  /** Each pet out with you, drawn. */
  private petViews = new Map<Pet, PetView>();
  private hover!: Phaser.GameObjects.Image;
  /** The knight's auras, drawn on the ground around the player to show their reach. */
  private auras = new Map<SkillId, { shape: Phaser.GameObjects.Polygon; radius: number }>();
  /** Pulsing ring under whatever the player is fighting. */
  private targetRing!: Phaser.GameObjects.Ellipse;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private castBar!: Phaser.GameObjects.Graphics;
  private statusLabel!: Phaser.GameObjects.Text;
  private textPool: Phaser.GameObjects.Text[] = [];
  /** Trees, rocks, houses and their shadows, hidden while off screen. */
  private decor: Phaser.GameObjects.Image[] = [];
  /** Darkening over underground maps, and glows that shine through it. */
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private lamps: Array<{ img: Phaser.GameObjects.Image; strength: number }> = [];
  private playerLight!: Phaser.GameObjects.Image;
  private night = 0;
  private lightTimer = 0;
  private cullTimer = 0;
  private holdTimer = 0;
  /** True while a press that started on the map (not on a HUD button) is held. */
  private pressOnMap = false;
  private lastPlayerX = 0;
  private lastPlayerY = 0;
  /** Which way the player faces: front (down the screen) or back, and mirrored for left. */
  private facing: Facing = 'F';
  private facingLeft = false;
  /** The animation playing on the player, so it's only restarted when it changes. */
  private playerAnim = '';
  private hurtUntil = 0;
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
    this.textPool = [];
    this.decor = [];
    this.npcViews.clear();
    this.night = mapLight(this.world.map.kind === 'dungeon').night;
    // The scene restarts on every map change; the old pet sprite went with the old run.
    this.petViews.clear();
    this.registry.set('clock', this.clock);

    const map = this.world.map;
    this.cameras.main.setBackgroundColor(map.kind === 'dungeon' ? '#16131c' : map.grass?.[0] === SAND_GROUND ? '#c9a35a' : '#3e7a45');
    this.drawGround();
    const before = this.children.list.length;
    this.placeObstacles();
    this.decor = this.children.list.slice(before) as Phaser.GameObjects.Image[];
    this.placePortals();
    this.placeNpcs();
    this.placeLamps();

    this.hover = this.add.image(0, 0, 'tile-outline').setDepth(2).setAlpha(0.6);
    this.targetRing = this.add.ellipse(0, 0, 58, 26).setStrokeStyle(3, 0xff4a4a, 0.95).setVisible(false);
    this.debugGfx = this.add.graphics().setDepth(5000);

    const playerKey = this.playerTexture();
    this.playerBody = this.add.sprite(0, 0, playerKey, PORTRAIT_FRAME).setOrigin(0.5, chibiOrigin()).setScale(WORLD_CHAR_SCALE);
    this.castBar = this.add.graphics();
    this.statusLabel = this.add.text(0, -86, '', { ...WORLD_TEXT, fontSize: '11px' }).setOrigin(0.5, 1);
    this.player = this.add.container(0, 0, [this.add.image(0, 0, 'shadow'), this.playerBody, this.castBar, this.statusLabel]);
    this.auras.clear();

    const cam = this.cameras.main;
    const { width, height } = this.world.map;
    const left = tileToWorld(0, height - 1).x - TILE_W;
    const right = tileToWorld(width - 1, 0).x + TILE_W;
    const bottom = tileToWorld(width - 1, height - 1).y + TILE_H;
    cam.setBounds(left, -TILE_H * 3, right - left, bottom + TILE_H * 3);
    cam.startFollow(this.player, true, 0.15, 0.15);
    // Phones in portrait need to see more of the map; big screens get a closer view.
    cam.setZoom((viewSize(this).width < 500 ? 0.9 : 1) * DPR);

    // Underground: a multiply tint over the world (covering any zoom), with glows added on top.
    this.nightOverlay = this.add
      .rectangle(cam.width / 2, cam.height / 2, 20000, 20000, 0xffffff)
      .setScrollFactor(0)
      .setDepth(LIGHT_DEPTH - 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setVisible(false);
    this.playerLight = this.lamp(0, 0, JOB_GLOW[jobOf(this.world.player).id] ?? 0x6ff2ff, 2.6, 0.55);
    this.lightTimer = 0;
    this.updateLighting(0);

    this.bindInput();
    this.bindEvents();
    cam.fadeIn(250, 47, 93, 58);
  }

  override update(_time: number, delta: number): void {
    this.alpha = this.clock.advance(delta);
    (this.registry.get('saves') as SaveManager).update(delta);
    this.syncPlayer();
    this.cullDecor(delta);
    this.updateLighting(delta);
    this.fadeOccluders();
    this.syncMonsters();
    this.syncDrops();
    this.syncPets();
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
    // Keep only the current map's ground texture.
    for (const k of this.textures.getTextureKeys()) if (k.startsWith('ground-') && k !== key) this.textures.remove(k);
    if (!this.textures.exists(key)) {
      const grid = this.world.grid;
      const grass = this.world.map.grass;
      const desert = grass?.[0] === SAND_GROUND;
      // Terrain classes: a seam is drawn wherever two different classes meet.
      const classOf = (x: number, y: number): string => {
        const t = grid.terrainAt(x, y);
        if (t === undefined) return 'void';
        if (t === 'tree' || t === 'rock' || t === 'flower') return desert ? 'sand' : 'grass';
        if (t === 'palm') return 'sand';
        return t === 'wall' || t === 'ruin' || t === 'machine' ? 'cobble' : t;
      };
      const canvas = paintGround({
        width,
        height,
        classOf,
        isFlower: (x, y) => grid.terrainAt(x, y) === 'flower',
        colorOf: (kind) => (grass && kind === 'grass' ? hexColor(grass[0]!) : ((COLORS[kind as keyof typeof COLORS] as readonly number[] | undefined)?.[0] ?? 0x444444)),
        dungeon: this.world.map.kind === 'dungeon',
      });
      this.textures.addCanvas(key, canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
      setArtRes(key, 0.5);
    }
    this.add.image(-ox, -oy, key).setOrigin(0, 0).setDepth(0);
  }

  private placeObstacles(): void {
    const { width, height } = this.world.map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = this.world.grid.terrainAt(x, y);
        if (t !== 'tree' && t !== 'rock' && t !== 'wall' && t !== 'cavewall' && t !== 'palm' && t !== 'ruin' && t !== 'machine') continue;
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
        } else if (t === 'cavewall' || t === 'ruin' || t === 'machine') {
          const key = t === 'ruin' ? (hash(x, y) % 4 === 0 ? 'ruin-glyph' : 'ruin') : t;
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
    return playerChibi(this, job, this.world.player.appearance, this.world.player.equipment);
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

  private refreshNpcs(): void {
    const ids = this.world.npcs.map((n) => n.id).join();
    if (ids === [...this.npcViews.keys()].join()) return;
    for (const view of this.npcViews.values()) view.destroy();
    this.npcViews.clear();
    this.placeNpcs();
  }

  private placeNpcs(): void {
    for (const npc of this.world.npcs) {
      const p = tileToWorld(npc.x, npc.y);
      const body =
        npc.sprite === 'board'
          ? this.add.image(0, 0, 'board').setOrigin(0.5, feetOrigin(this, 'board', 54))
          : npc.sprite === 'bench'
            ? this.add.image(0, 0, 'bench').setOrigin(0.5, feetOrigin(this, 'bench', 44))
            : npc.sprite === 'stone'
              ? this.add.image(0, 0, 'rock').setOrigin(0.5, 0.8).setScale(1.3)
              : this.npcSprite(npc);
      const labelY = npc.sprite === 'board' ? -66 : npc.sprite === 'bench' ? -56 : npc.sprite === 'stone' ? -40 : -84;
      // Places you can inspect get a pale label; people a gold one.
      const label = this.add
        .text(0, labelY, npc.name, { ...WORLD_TEXT, fontSize: '12px', color: npc.sprite === 'stone' ? '#e8e4d8' : '#ffe27a' })
        .setOrigin(0.5, 1);
      const view = this.add.container(p.x, p.y, [this.add.image(0, 0, 'shadow'), body, label]).setDepth(depthFor(p.y));
      this.npcViews.set(npc.id, view);
    }
  }

  // ---- Per-frame sync ----------------------------------------------------

  private syncPlayer(): void {
    const p = this.world.player;
    this.syncAura();
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
    const attacking = now < this.attackAnimUntil;
    if (attacking && this.attackDir.x !== 0) {
      // A small step into the swing.
      const k = Math.sin(((this.attackAnimUntil - now) / ATTACK_ANIM_MS) * Math.PI) * 3;
      ox = this.attackDir.x * k;
      oy = this.attackDir.y * k;
    }
    this.player.setPosition(w.x + ox, w.y + oy).setDepth(depthFor(w.y) + 0.5);

    const moving = p.next !== null;
    const dx = w.x - this.lastPlayerX;
    const dy = w.y - this.lastPlayerY;
    if (!attacking && Math.hypot(dx, dy) > 0.3) this.face(dx, dy);
    this.lastPlayerX = w.x;
    this.lastPlayerY = w.y;

    let anim: Anim = 'idle';
    if (p.dead) anim = 'hurt';
    else if (p.sitting) anim = 'sit';
    else if (attacking) anim = 'attack';
    else if (now < this.hurtUntil) anim = 'hurt';
    else if (p.casting) anim = 'cast';
    else if (moving) anim = 'walk';
    const key = animKey(this.playerBody.texture.key, this.facing, anim);
    if (key !== this.playerAnim) {
      this.playerAnim = key;
      this.playerBody.play(key);
    }
    this.playerBody.setFlipX(this.facingLeft);
    this.player.setAlpha(p.dead ? 0.35 : 1);
    // Fainted players lie down; stunned ones wobble.
    this.playerBody.setAngle(p.dead ? (this.facingLeft ? -90 : 90) : p.statuses.has('stun') ? Math.sin(this.time.now / 60) * 6 : 0);
  }

  /** Repaints the player after a change of look, job or gear. */
  private refreshPlayerSprite(): void {
    const key = this.playerTexture();
    if (key === this.playerBody.texture.key) return;
    this.playerBody.setTexture(key, PORTRAIT_FRAME);
    this.playerAnim = '';
  }

  /** Turns the player toward a screen direction. */
  private face(dx: number, dy: number): void {
    this.facing = dy < -0.2 * Math.abs(dx) ? 'B' : 'F';
    if (Math.abs(dx) > 0.1) this.facingLeft = dx < 0;
  }

  /** Restarts the attack animation toward a screen direction. */
  private startAttackAnim(dx: number, dy: number, lunge: boolean): void {
    const len = Math.hypot(dx, dy) || 1;
    this.attackDir = lunge ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
    this.attackAnimUntil = this.time.now + ATTACK_ANIM_MS;
    this.face(dx, dy);
    this.playerAnim = '';
  }

  private npcSprite(npc: NpcDef): Phaser.GameObjects.Sprite {
    const who = npc.lookAs ?? npc.id;
    const key = ensureChibi(this, `npc-${who}`, hexColor(npc.look.body), npcAppearance(who, hexColor(npc.look.hair)));
    const h = hash(npc.x, npc.y);
    // Everyone breathes on their own rhythm.
    return this.add
      .sprite(0, 0, key, PORTRAIT_FRAME)
      .setOrigin(0.5, chibiOrigin())
      .setScale(WORLD_CHAR_SCALE)
      .setFlipX(h % 2 === 0)
      .play({ key: animKey(key, 'F', 'idle'), startFrame: h % 4, frameRate: 4 + (h % 3) });
  }

  /** A glow that shines in the dark: `scale` sizes it, `strength` is its brightness at full dark. */
  private lamp(x: number, y: number, color: number, scale: number, strength: number, cull = false): Phaser.GameObjects.Image {
    // After the Silence ending, the Starglass glows are gone: lamps burn dim and grey.
    if (this.world.flags.get(STORY.ending) === 'silence') {
      color = 0x8a8a8a;
      strength *= 0.5;
    }
    const img = this.add.image(x, y, 'light').setTint(color).setScale(scale).setDepth(LIGHT_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.lamps.push({ img, strength });
    if (cull) this.decor.push(img);
    return img;
  }

  /** Lit windows, cave crystals, ruin glyphs, portals and the board's holo-screen. */
  private placeLamps(): void {
    this.lamps = [];
    // Outdoors it's always daylight: nothing to light.
    if (this.night === 0) return;
    const spots: Record<string, Array<[number, number, number]>> = {
      'house-window': [[-23, -11, 0xffd890], [23, -11, 0x6ff2ff]],
      cavewall: [[15, -7, 0x6ff2ff]],
      'ruin-glyph': [[-16, -6, 0xffc84a]],
      machine: [[-15, -18, 0x6ff2ff], [16, 4, 0xffa83a]],
    };
    // Only some blocks glow: lights add up, and a wall of them would wash the scene out.
    for (const img of [...this.decor]) {
      const key = img.texture.key;
      const h = hash(Math.round(img.x), Math.round(img.y));
      const every = key === 'cavewall' ? 11 : key === 'machine' ? (this.world.map.kind === 'dungeon' ? 16 : 3) : 1;
      if (h % every !== 0) continue;
      for (const [dx, dy, color] of spots[key] ?? []) this.lamp(img.x + dx, img.y + dy, color, key === 'house-window' ? 1 : 1.2, key === 'house-window' ? 0.55 : 0.5, true);
    }
    for (const portal of this.world.map.portals) {
      const c = tileToWorld(portal.area.x + (portal.area.w - 1) / 2, portal.area.y + (portal.area.h - 1) / 2);
      this.lamp(c.x, c.y, 0x6fd6ff, 3.2 + Math.max(portal.area.w, portal.area.h), 0.9);
    }
    for (const npc of this.world.npcs) {
      const p = tileToWorld(npc.x, npc.y);
      if (npc.sprite === 'board') this.lamp(p.x + 12, p.y - 40, 0x6ff2ff, 1.4, 0.8);
      if (npc.sprite === 'bench') this.lamp(p.x + 23, p.y - 32, 0x6ff2ff, 1.2, 0.8);
    }
  }

  /** Applies the map's lighting (dim underground, plain daylight outside) and keeps glows on their owners. */
  private updateLighting(delta: number): void {
    const pos = this.player;
    this.playerLight.setPosition(pos.x, pos.y - 34);
    for (const view of this.monsterViews.values()) view.light?.setPosition(view.root.x, view.root.y - 18 * view.body.scaleY / WORLD_PX);
    this.lightTimer -= delta;
    if (this.lightTimer > 0) return;
    this.lightTimer = 250;
    const light = mapLight(this.world.map.kind === 'dungeon');
    this.night = light.night;
    this.nightOverlay.setVisible(light.tint !== 0xffffff).setFillStyle(light.tint);
    for (const l of this.lamps) l.img.setAlpha(l.strength * light.night);
    // After the Gap ending you carry a light of your own, even in daylight.
    if (this.world.flags.get(STORY.ending) === 'gap') this.playerLight.setAlpha(Math.max(this.playerLight.alpha, 0.5)).setTint(0xfff2c8);
  }

  /** Hides scenery that's off screen, so the renderer skips it. Checked a few times a second. */
  private cullDecor(delta: number): void {
    this.cullTimer -= delta;
    if (this.cullTimer > 0) return;
    this.cullTimer = 200;
    const v = this.cameras.main.worldView;
    const m = 160;
    for (const img of this.decor) img.setVisible(img.x > v.x - m && img.x < v.right + m && img.y > v.y - m && img.y < v.bottom + m + 120);
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
    const intent = this.world.player.intent;
    const targetId = intent.kind === 'attack' || intent.kind === 'skill' ? intent.targetId : null;
    const targetView = targetId !== null ? this.monsterViews.get(targetId) : undefined;
    this.targetRing.setVisible(!!targetView);
    if (targetView) {
      const pulse = 1 + Math.sin(this.time.now / 120) * 0.08;
      this.targetRing.setPosition(targetView.root.x, targetView.root.y).setScale(pulse).setDepth(targetView.root.depth - 0.1);
    }
    for (const m of this.world.monsters.values()) {
      seen.add(m.id);
      const view = this.monsterViews.get(m.id) ?? this.createMonsterView(m);
      const pos = renderPosition(m, this.alpha);
      const w = tileToWorld(pos.x, pos.y);
      view.root.setPosition(w.x, w.y).setDepth(depthFor(w.y));
      if (Math.abs(w.x - view.lastX) > 0.5) view.body.setFlipX(w.x < view.lastX);
      view.lastX = w.x;

      const anim: MonsterAnim = this.time.now < view.attackUntil ? 'attack' : m.next ? 'move' : 'idle';
      if (anim !== view.anim) {
        view.anim = anim;
        view.body.play(monsterAnimKey(view.key, anim));
      }

      if (m.hp === view.lastHp) continue;
      view.lastHp = m.hp;
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
        if (view.light) {
          this.lamps = this.lamps.filter((l) => l.img !== view.light);
          view.light.destroy();
        }
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
    const key = ensureMonster(this, m.def.look.shape, hexColor(m.def.look.color));
    const body = this.add
      .sprite(0, 0, key)
      .setOrigin(0.5, MON_ORIGIN_Y)
      .setScale(WORLD_PX * m.def.look.scale)
      .play({ key: monsterAnimKey(key, 'idle'), startFrame: m.id % 4 });
    const hpBar = this.add.graphics();
    const root = this.add.container(0, 0, [this.add.image(0, 0, 'shadow').setScale(0.9 * Math.max(1, m.def.look.scale * 0.8)), body, hpBar]);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 400 });
    // Tech eyes and cores glow in the dark.
    const light = quality.low || this.night === 0 ? undefined : this.lamp(0, 0, MONSTER_GLOW[m.def.look.shape] ?? 0x6ff2ff, 1.2 * Math.max(1, m.def.look.scale), 0.6);
    light?.setAlpha(light ? 0.6 * this.night : 0);
    const view: MonsterView = { root, body, hpBar, lastX: 0, lastHp: m.def.hp, key, anim: 'idle', attackUntil: 0, light };
    this.monsterViews.set(m.id, view);
    return view;
  }

  private syncPets(): void {
    const movers = this.world.petMovers();
    const out = new Set(movers.map((m) => m.pet));
    for (const [pet, view] of this.petViews) {
      if (out.has(pet) && view.key === `${pet.species}:${pet.name}`) continue;
      view.root.destroy();
      this.petViews.delete(pet);
    }
    for (const { pet, mover } of movers) {
      let view = this.petViews.get(pet);
      if (!view) {
        const def = this.world.content.monsters.get(pet.species)!;
        const sheet = ensureMonster(this, def.look.shape, hexColor(def.look.color));
        // Pets are drawn smaller than their wild cousins.
        const body = this.add.sprite(0, 0, sheet).setOrigin(0.5, MON_ORIGIN_Y).setScale(WORLD_PX * 0.62);
        const label = this.add.text(0, -34, pet.name, { ...WORLD_TEXT, fontSize: '10px', color: '#ffb8d8' }).setOrigin(0.5, 1);
        const root = this.add.container(0, 0, [this.add.image(0, 0, 'shadow').setScale(0.6), body, label]);
        view = { root, body, label, key: `${pet.species}:${pet.name}`, sheet, anim: '', lastX: 0, biteUntil: 0 };
        this.petViews.set(pet, view);
      }
      const pos = renderPosition(mover, this.alpha);
      const w = tileToWorld(pos.x, pos.y);
      view.root.setPosition(w.x, w.y).setDepth(depthFor(w.y) + 0.2);
      if (Math.abs(w.x - view.lastX) > 0.5) view.body.setFlipX(w.x < view.lastX);
      view.lastX = w.x;
      const anim = monsterAnimKey(view.sheet, mover.next ? 'move' : 'idle');
      if (anim !== view.anim && this.time.now >= view.biteUntil) {
        view.anim = anim;
        view.body.play(anim);
      }
    }
  }

  /** The drawn pet at this index in the player's pets, if it's on screen. */
  private petViewAt(index: number | undefined): PetView | undefined {
    const pet = index === undefined ? undefined : this.world.player.pets[index];
    return pet ? this.petViews.get(pet) : undefined;
  }

  /** Little hearts rising from a pet (or the player if it isn't on screen). */
  private hearts(count: number, pet?: number): void {
    const view = this.petViewAt(pet ?? 0);
    const at = view ? { x: view.root.x, y: view.root.y - 30 } : { x: this.player.x, y: this.player.y - 60 };
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
    for (const [pet, view] of this.petViews) {
      if (Phaser.Math.Distance.Between(ptr.worldX, ptr.worldY, view.root.x, view.root.y - 12) < this.pickRadius()) {
        this.game.events.emit('openPet', this.world.player.pets.indexOf(pet));
        return;
      }
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
      // Big monsters are easier to hit: the target area grows with their size.
      const scale = Math.max(1, m.def.look.scale);
      const d = Phaser.Math.Distance.Between(wx, wy, view.root.x, view.root.y - 16 * scale) / scale;
      if (d < bestDist) {
        best = m;
        bestDist = d;
      }
    }
    return best;
  }

  private npcAt(wx: number, wy: number): string | null {
    for (const [id, view] of this.npcViews) {
      if (Phaser.Math.Distance.Between(wx, wy, view.x, view.y - 36) < this.pickRadius() * 1.2) return id;
    }
    return null;
  }

  private dropAt(wx: number, wy: number): number | null {
    for (const [id, img] of this.dropViews) {
      if (Phaser.Math.Distance.Between(wx, wy, img.x, img.y - 8) < this.pickRadius() * 0.9) return id;
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
      // Story characters come and go as the story moves.
      ev.on('storyChanged', () => this.refreshNpcs()),
      ev.on('damage', (e) => {
        const crit = e.crit;
        const toPlayer = e.targetId === 'player';
        const color = toPlayer ? '#ff5a4a' : crit ? '#ffd84a' : '#ffffff';
        this.damageNumber(e.targetId, e.amount === 0 && toPlayer ? 'BLOCK' : String(e.amount), e.amount === 0 && toPlayer ? '#fff6c8' : color, crit ? 30 : 22);
        if (crit) this.soundEffect(e.targetId, pick(SFX.hit), '#ffd84a', true);
        else if (toPlayer && e.sourceId !== 'player' && e.amount >= this.world.player.hp * 0.5) this.soundEffect('player', pick(SFX.hurt), '#ff5a4a');
        if (e.sourceId === 'player') this.playAttack(e.targetId);
        else this.monsterAttack(e.sourceId);
        if (toPlayer && e.amount > 0) this.hurtUntil = this.time.now + 200;
        if (e.amount > 0) this.hitSpark(e.targetId, crit);
        if (crit && e.sourceId === 'player') this.camFx('shake', 70, 0.003);
        this.flashHit(e.targetId);
      }),
      ev.on('miss', (e) => {
        this.damageNumber(e.targetId, 'MISS', '#8fd0ff', 18);
        if (e.sourceId === 'player') this.playAttack(e.targetId);
        else this.monsterAttack(e.sourceId);
      }),
      ev.on('heal', (e) => {
        if (e.hp > 0) this.floatText('player', `+${e.hp}`, '#7dff9a', 15);
      }),
      ev.on('equipmentChanged', () => this.refreshPlayerSprite()),
      ev.on('appearanceChanged', () => {
        this.refreshPlayerSprite();
      }),
      ev.on('jobChanged', () => {
        this.playerBody.setTexture(this.playerTexture(), PORTRAIT_FRAME);
        this.playerAnim = '';
        this.playerLight.setTint(JOB_GLOW[jobOf(this.world.player).id] ?? 0x6ff2ff);
        this.soundEffect('player', 'JOB CHANGE!!', '#ffe27a', true);
        this.lines(this.player.x, this.player.y - 30, { inner: 50, outer: 220, count: 40 });
        this.camFx('flash', 300, 255, 240, 180);
      }),
      ev.on('skillUsed', (e) => this.skillEffect(e.skillId, e.targets, e.at)),
      ev.on('petTamed', () => {
        // The pet view appears on the next frame; celebrate from the player.
        this.soundEffect('player', 'TAMED!!', '#ff8fb8', true);
        this.lines(this.player.x, this.player.y - 30, { inner: 40, outer: 180, count: 30, color: 0xff5a8a });
        this.time.delayedCall(50, () => this.hearts(5));
      }),
      ev.on('tameFailed', () => this.floatText('player', 'It got away…', '#ffb8d8', 15, 1000)),
      ev.on('petAttack', (e) => {
        this.damageNumber(e.targetId, String(e.amount), '#ffb8d8', 20);
        this.hitSpark(e.targetId, false);
        this.flashHit(e.targetId);
        const pet = this.petViewAt(e.pet);
        const target = this.monsterViews.get(e.targetId);
        if (!pet || !target) return;
        pet.body.setFlipX(target.root.x < pet.root.x);
        pet.anim = monsterAnimKey(pet.sheet, 'attack');
        pet.body.play(pet.anim);
        pet.biteUntil = this.time.now + 400;
      }),
      ev.on('auraHit', (e) => {
        this.damageNumber(e.targetId, String(e.amount), e.holy ? '#fff2a8' : '#8ff4ff', e.holy ? 16 : 18);
        this.hitSpark(e.targetId, false);
        this.flashHit(e.targetId);
        const skill = e.holy ? 'holy_aura' : 'battle_aura';
        const aura = this.auras.get(skill);
        if (aura) {
          const base = AURA_LOOKS.find(([s]) => s === skill)![2];
          aura.shape.setScale(base * 1.08);
          this.tweens.add({ targets: aura.shape, scale: base, duration: 250 });
        }
      }),
      ev.on('weakened', (e) => this.floatText(e.targetId, 'DEF↓', '#fff2a8', 13, 900)),
      ev.on('petLevelUp', (e) => {
        const view = this.petViewAt(e.pet);
        if (!view) return;
        const at = { x: view.root.x, y: view.root.y - 40 };
        const label = this.add.text(at.x, at.y, `Lv ${e.level}!`, { fontFamily: IMPACT_FONT, fontSize: '22px', color: '#c8b4ff', stroke: '#16131c', strokeThickness: 6 }).setOrigin(0.5).setDepth(6000);
        this.tweens.add({ targets: label, y: at.y - 46, alpha: 0, duration: 1400, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
        this.ring({ x: view.root.x, y: view.root.y }, 0xa98bff, 3);
        this.hearts(2, e.pet);
      }),
      ev.on('petFed', (e) => (e.delta > 0 ? this.hearts(e.delta >= 40 ? 3 : 1, e.pet) : this.floatText('player', 'Too full!', '#ffb8d8', 14))),
      ev.on('telegraph', (e) => this.telegraph(e.tile, e.radius, e.ms)),
      ev.on('slam', (e) => {
        const at = tileToWorld(e.tile.x, e.tile.y);
        const burst = this.add.polygon(at.x, at.y, this.slamArea(e.radius), 0xffb15a, 0.5).setDepth(3);
        this.tweens.add({ targets: burst, alpha: 0, scale: 1.15, duration: 350, onComplete: () => burst.destroy() });
        this.camFx('shake', 220, 0.01);
        this.soundEffect(e.monsterId, pick(SFX.slam), '#ff9a4a', true);
        this.lines(at.x, at.y, { inner: 60, outer: 200, count: 34 });
      }),
      ev.on('bossPhase', (e) => {
        const view = this.monsterViews.get(e.monsterId);
        if (!view) return;
        // Each phase runs hotter: the boss glows redder and its light grows.
        view.rage = e.phase;
        view.body.setTint(RAGE_TINT[Math.min(e.phase, RAGE_TINT.length - 1)]!);
        view.light?.setTint(0xff3a2a).setScale(view.light.scale * 1.4);
        this.soundEffect(e.monsterId, e.shout, '#ff6a3a', true);
        this.ring({ x: view.root.x, y: view.root.y }, 0xff6a3a, 6);
        this.lines(view.root.x, view.root.y - 40, { inner: 60, outer: 240, count: 44, color: 0x8a1a1a });
        this.camFx('flash', 220, 255, 90, 60);
        this.camFx('shake', 300, 0.012);
      }),
      ev.on('castInterrupted', () => this.floatText('player', 'Interrupted!', '#ff9a7a', 14, 700)),
      ev.on('refined', (e) => {
        this.refreshPlayerSprite();
        this.floatText('player', e.success ? `+${e.level}!` : 'Failed…', e.success ? '#ffe27a' : '#ff6b6b', 18, 1200);
        if (e.success && e.level >= 5) this.camFx('flash', 250, 255, 240, 180);
        if (!e.success) this.camFx('shake', 200, 0.008);
      }),
      ev.on('levelUp', (e) => {
        this.soundEffect('player', e.kind === 'base' ? 'LEVEL UP!!' : 'JOB UP!!', '#ffe27a', true);
        this.lines(this.player.x, this.player.y - 30, { inner: 45, outer: 200, count: 36 });
        this.camFx('flash', 200, 255, 240, 180);
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));
  }

  /** A red circle on the ground that fills up until an area attack lands. */
  private telegraph(tile: Tile, radius: number, ms: number): void {
    const at = tileToWorld(tile.x, tile.y);
    const diamond = this.slamArea(radius);
    // Above the night and cave darkness, so the warning is always bright.
    const ring = this.add.polygon(at.x, at.y, diamond).setStrokeStyle(4, 0xff5a4a, 1).setDepth(LIGHT_DEPTH + 1);
    const fill = this.add.polygon(at.x, at.y, diamond, 0xff4a3a, 0.28).setDepth(LIGHT_DEPTH + 1).setScale(0.05);
    // The outline pulses while the boss winds up.
    this.tweens.add({ targets: ring, alpha: 0.35, duration: 160, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: fill, scale: 1, duration: ms, onComplete: () => (this.tweens.killTweensOf(ring), ring.destroy(), fill.destroy()) });
  }

  /** The tiles a slam hits (every tile within `radius` steps), as one diamond on screen. */
  /**
   * Keeps each aura's glow under the player, sized to its reach: Battle Aura in
   * cyan, Holy Aura in pale gold and a little smaller so both outlines show.
   * Neither is red, so they never look like a slam warning.
   */
  private syncAura(): void {
    for (const [skill, color, scale] of AURA_LOOKS) {
      const lv = skillLevel(this.world.player, skill);
      const radius = lv > 0 ? auraRadius(lv) : 0;
      let aura = this.auras.get(skill);
      if (aura && aura.radius !== radius) {
        this.tweens.killTweensOf(aura.shape);
        aura.shape.destroy();
        this.auras.delete(skill);
        aura = undefined;
      }
      if (radius > 0 && !aura) {
        const shape = this.add.polygon(0, 0, this.slamArea(radius), color, 0.16).setStrokeStyle(3, color, 0.95).setDepth(2.5).setScale(scale);
        // A darker rim under the light outline, so a pale aura still reads on sand and stone.
        if (skill === 'holy_aura') {
          const rim = this.add.polygon(0, 0, this.slamArea(radius)).setStrokeStyle(6, 0xb07a10, 0.7).setDepth(2.49).setScale(scale);
          shape.on('destroy', () => rim.destroy());
          shape.setData('rim', rim);
        }
        this.tweens.add({ targets: shape, alpha: { from: 1, to: 0.6 }, yoyo: true, repeat: -1, duration: skill === 'holy_aura' ? 1300 : 900, ease: 'Sine.easeInOut' });
        aura = { shape, radius };
        this.auras.set(skill, aura);
      }
      if (aura) {
        aura.shape.setPosition(this.player.x, this.player.y);
        (aura.shape.getData('rim') as Phaser.GameObjects.Polygon | undefined)?.setPosition(this.player.x, this.player.y).setAlpha(aura.shape.alpha).setScale(aura.shape.scale);
      }
    }
  }

  private slamArea(radius: number): number[] {
    const w = TILE_W * (radius * 2 + 1);
    const h = TILE_H * (radius * 2 + 1);
    return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];
  }

  /** A streak from the caster to the target for each bolt. */
  /** Plays a pixel effect once at a world position, then removes it. */
  private playFx(key: FxKey, x: number, y: number, opts: { tint?: number; scale?: number; originY?: number; add?: boolean; depth?: number; flip?: boolean; angle?: number } = {}): Phaser.GameObjects.Sprite {
    const fx = this.add
      .sprite(x, y, key, '0')
      .setOrigin(0.5, opts.originY ?? 0.5)
      .setScale(opts.scale ?? WORLD_PX)
      .setDepth(opts.depth ?? LIGHT_DEPTH + 1)
      .setFlipX(!!opts.flip)
      .setAngle(opts.angle ?? 0);
    if (opts.tint !== undefined) fx.setTint(opts.tint);
    if (opts.add !== false) fx.setBlendMode(Phaser.BlendModes.ADD);
    fx.play(key).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.destroy());
    return fx;
  }

  /** A pixel spark where a hit lands; bigger and golden for crits. */
  private hitSpark(id: EntityId, crit: boolean): void {
    if (quality.low && !crit) return;
    const at = id === 'player' ? { x: this.player.x, y: this.player.y - 40 } : this.monsterViews.get(id)?.root;
    if (!at) return;
    const y = id === 'player' ? at.y : at.y - 22;
    this.playFx('fx-spark', at.x + Phaser.Math.Between(-6, 6), y + Phaser.Math.Between(-6, 6), { tint: crit ? 0xffd84a : 0xffffff, scale: crit ? 3.2 : 2, depth: LIGHT_DEPTH + 2 });
  }

  /** An energy orb flying from the player to the target, bursting on impact. */
  private boltEffect(targets: number[], color: number, size = 1): void {
    const view = targets[0] !== undefined ? this.monsterViews.get(targets[0]) : undefined;
    if (!view) return;
    const from = { x: this.player.x, y: this.player.y - 40 };
    const to = { x: view.root.x, y: view.root.y - 18 };
    const orb = this.add.sprite(from.x, from.y, 'fx-orb', '0').setScale(WORLD_PX * size).setTint(color).setDepth(LIGHT_DEPTH + 1).setBlendMode(Phaser.BlendModes.ADD).play('fx-orb');
    this.tweens.add({
      targets: orb,
      x: to.x,
      y: to.y,
      duration: 180,
      onComplete: () => {
        orb.destroy();
        this.playFx('fx-burst', to.x, to.y, { tint: color, scale: WORLD_PX * size });
      },
    });
  }

  private skillEffect(skillId: string, targets: number[], tile?: Tile): void {
    const at = { x: this.player.x, y: this.player.y };
    const center = tile ? tileToWorld(tile.x, tile.y) : at;
    const target = targets[0];
    const slash = (color: number) => {
      const v = target !== undefined ? this.monsterViews.get(target) : undefined;
      if (v) this.playFx('fx-slash', v.root.x, v.root.y - 22, { tint: color, scale: 2.4, flip: v.root.x < this.player.x });
    };
    if (skillId === 'bash') {
      slash(0xffb15a);
      if (target !== undefined) this.soundEffect(target, pick(SFX.hit), '#ffb15a', true);
      this.camFx('shake', 90, 0.004);
    } else if (skillId === 'magnum_break') {
      // Radius 2 tiles: 5 tiles across in iso space.
      this.ring(at, 0xff7a3a, 5);
      this.camFx('shake', 150, 0.006);
      this.soundEffect('player', pick(SFX.magnum_break), '#ff7a3a', true);
      this.lines(at.x, at.y - 20, { inner: 50, outer: 190 });
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
      this.lightPillar(0x7dff9a, true);
      this.soundEffect('player', 'HEAL!', '#7dff9a');
    } else if (skillId === 'pierce') {
      slash(0x9fd8ff);
      if (target !== undefined) this.soundEffect(target, 'PIERCE!', '#9fd8ff', true);
      this.camFx('shake', 90, 0.004);
    } else if (skillId === 'bowling_bash') {
      this.ring(center, 0xffd84a, 3);
      this.soundEffect(target ?? 'player', 'KRASH!!', '#ffd84a', true);
      this.lines(center.x, center.y - 20, { inner: 40, outer: 160 });
      this.camFx('shake', 160, 0.007);
    } else if (skillId === 'sight_rasher') {
      this.ring(at, 0xff7a3a, 5);
      this.soundEffect('player', 'FWOOM!', '#ff7a3a', true);
      this.camFx('shake', 120, 0.005);
    } else if (skillId === 'thunderstorm') {
      for (const id of targets) this.lightning(id);
      this.soundEffect(target ?? 'player', 'KRAKOOM!', '#fff27a', true);
      this.camFx('flash', 120, 255, 250, 200);
    } else if (skillId === 'meteor_storm') {
      this.meteors(center);
      this.time.delayedCall(260, () => {
        this.ring(center, 0xff7a3a, 5);
        this.soundEffect(target ?? 'player', 'DOOOM!!', '#ff7a3a', true);
        this.camFx('shake', 260, 0.012);
      });
    } else if (skillId === 'blitz_beat') {
      if (target !== undefined) this.falcon(target);
    } else if (skillId === 'claymore_trap') {
      this.ring(center, 0xff9a4a, 3);
      this.soundEffect(target ?? 'player', 'BOOM!', '#ff9a4a', true);
      this.camFx('shake', 140, 0.006);
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

  /** Screen shake and flash, skipped in Low effects. */
  private camFx(kind: 'shake' | 'flash', ms: number, ...args: number[]): void {
    if (quality.low) return;
    if (kind === 'shake') this.cameras.main.shake(ms, args[0]);
    else this.cameras.main.flash(ms, args[0], args[1], args[2]);
  }

  /** Manga speed lines, skipped in Low effects. */
  private lines(x: number, y: number, opts: Parameters<typeof speedLines>[3] = {}): void {
    if (!quality.low) speedLines(this, x, y, opts);
  }

  /** A pixel shockwave bursting outward on the ground; `tiles` across. */
  private ring(at: { x: number; y: number }, color: number, tiles: number): void {
    // The ring art ends 62 pixels across.
    this.playFx('fx-ring', at.x, at.y, { tint: color, scale: (TILE_W * tiles) / 62 });
  }

  /** A jagged pixel bolt from the sky onto a monster. */
  private lightning(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    this.playFx('fx-bolt', view.root.x, view.root.y, { tint: 0xfff27a, originY: 92 / 96, scale: 2.4 });
    this.playFx('fx-burst', view.root.x, view.root.y - 10, { tint: 0xfff27a });
  }

  /** Flaming rocks streaking down onto an area. */
  private meteors(center: { x: number; y: number }): void {
    for (let i = 0; i < (quality.low ? 2 : 4); i++) {
      const x = center.x + Phaser.Math.Between(-50, 50);
      const y = center.y + Phaser.Math.Between(-16, 16);
      const rock = this.add.sprite(x - 130, y - 260, 'fx-meteor', '0').setScale(WORLD_PX * 1.4).setDepth(4000).play('fx-meteor');
      this.tweens.add({
        targets: rock,
        x,
        y: y - 14,
        delay: i * 70,
        duration: 260,
        onComplete: () => {
          rock.destroy();
          this.playFx('fx-burst', x, y - 14, { tint: 0xff8a3a, scale: 3 });
        },
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

  /** A pixel arrow flying from the player to a monster. */
  private arrowEffect(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const from = { x: this.player.x, y: this.player.y - 34 };
    const to = { x: view.root.x, y: view.root.y - 18 };
    const arrow = this.add.image(from.x, from.y, 'fx-arrow', '0').setScale(WORLD_PX).setDepth(4000).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
    this.tweens.add({
      targets: arrow,
      x: to.x,
      y: to.y,
      duration: 140,
      onComplete: () => {
        arrow.destroy();
        this.playFx('fx-spark', to.x, to.y, { tint: 0x9be3ff });
      },
    });
  }

  /** Arrows falling from the sky onto each target. */
  private arrowRain(targets: number[]): void {
    for (const id of targets) {
      const view = this.monsterViews.get(id);
      if (!view) continue;
      for (let i = 0; i < (quality.low ? 2 : 4); i++) {
        const x = view.root.x + Phaser.Math.Between(-18, 18);
        const y = view.root.y - 10 + Phaser.Math.Between(-6, 6);
        const arrow = this.add.image(x - 30, y - 140, 'fx-arrow', '0').setScale(WORLD_PX).setDepth(4000).setRotation(Math.atan2(140, 30));
        this.tweens.add({ targets: arrow, x, y, delay: i * 60, duration: 160, onComplete: () => arrow.destroy() });
      }
    }
  }

  /** A pillar of light dropping onto a monster. */
  private holyBeam(targetId: number): void {
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    this.playFx('fx-pillar', view.root.x, view.root.y + 4, { tint: 0xfff6c8, originY: 60 / 64, scale: 2.6 });
    this.lines(view.root.x, view.root.y - 30, { inner: 30, outer: 120, count: 20 });
    this.soundEffect(targetId, pick(SFX.holy_light), '#fff6c8', true);
  }

  /** A column of light around the player, with "+" sparkles for heals. */
  private lightPillar(color: number, sparkles = false): void {
    const x = this.player.x;
    const y = this.player.y;
    this.playFx('fx-pillar', x, y + 4, { tint: color, originY: 60 / 64, scale: 2.2 });
    if (!sparkles) return;
    for (let i = 0; i < (quality.low ? 2 : 5); i++) {
      this.time.delayedCall(i * 70, () => {
        const plus = this.playFx('fx-plus', x + Phaser.Math.Between(-22, 22), y - Phaser.Math.Between(10, 60), { tint: color, depth: LIGHT_DEPTH + 2 });
        this.tweens.add({ targets: plus, y: plus.y - 24, duration: 400 });
      });
    }
  }

  private anchorOf(id: EntityId): { x: number; y: number } | null {
    if (id === 'player') return { x: this.player.x, y: this.player.y - 78 };
    const view = this.monsterViews.get(id);
    return view ? { x: view.root.x, y: view.root.y - 40 } : null;
  }

  /** Pooled text objects: creating a Text allocates a canvas and a texture, so combat text is reused. */
  private takeText(text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const t = this.textPool.pop() ?? this.add.text(0, 0, '');
    return t.setStyle({ resolution: DPR, ...style }).setText(text).setOrigin(0.5).setActive(true).setVisible(true).setAlpha(1).setScale(1).setAngle(0);
  }

  private releaseText(t: Phaser.GameObjects.Text): void {
    this.tweens.killTweensOf(t);
    t.setVisible(false).setActive(false);
    this.textPool.push(t);
  }

  private floatText(id: EntityId, text: string, color: string, size: number, duration = 800): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const label = this.takeText(text, { ...WORLD_TEXT, fontSize: `${size}px`, color })
      .setPosition(at.x + Phaser.Math.Between(-6, 6), at.y)
      .setDepth(6000);
    this.tweens.add({
      targets: label,
      y: at.y - 36,
      alpha: { from: 1, to: 0 },
      ease: 'Cubic.easeOut',
      duration,
      onComplete: () => this.releaseText(label),
    });
  }

  /** Comic damage number: impact font, heavy ink outline, pops in tilted then floats up. */
  private damageNumber(id: EntityId, text: string, color: string, size: number): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const label = this.takeText(text, { fontFamily: IMPACT_FONT, fontSize: `${size}px`, color, stroke: '#16131c', strokeThickness: 6 })
      .setPosition(at.x + Phaser.Math.Between(-10, 10), at.y)
      .setAngle(Phaser.Math.Between(-12, 12))
      .setScale(1.6)
      .setDepth(6000);
    this.tweens.add({ targets: label, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, y: at.y - 42, alpha: { from: 1, to: 0 }, delay: 250, duration: 650, ease: 'Cubic.easeIn', onComplete: () => this.releaseText(label) });
  }

  /** Onomatopoeia ("BAM!") in a starburst next to whoever got hit. */
  private soundEffect(id: EntityId, text: string, color: string, burst = false): void {
    const at = this.anchorOf(id);
    if (!at) return;
    const x = at.x + Phaser.Math.Between(-24, 24);
    const y = at.y - 18;
    const label = this.takeText(text, { fontFamily: IMPACT_FONT, fontSize: '26px', color, stroke: '#16131c', strokeThickness: 7 }).setPosition(0, 0);
    const parts: Phaser.GameObjects.GameObject[] = [label];
    // The starburst is a pre-drawn texture, scaled to fit the word.
    if (burst && !quality.low) parts.unshift(this.add.image(0, 0, 'burst').setScale(Math.max(34, label.width * 0.75) / BURST_RADIUS));
    const fx = this.add.container(x, y, parts).setDepth(6100).setAngle(Phaser.Math.Between(-15, 15)).setScale(0.3);
    this.tweens.add({ targets: fx, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: fx,
      alpha: 0,
      delay: 600,
      duration: 300,
      onComplete: () => {
        fx.remove(label);
        this.releaseText(label);
        fx.destroy();
      },
    });
  }

  /** Plays a monster's attack animation, facing the player. */
  private monsterAttack(id: EntityId): void {
    const view = typeof id === 'number' ? this.monsterViews.get(id) : undefined;
    if (!view) return;
    view.attackUntil = this.time.now + 260;
    view.anim = '';
    view.body.setFlipX(this.player.x < view.root.x);
  }

  private playAttack(targetId: EntityId): void {
    if (targetId === 'player') return;
    const view = this.monsterViews.get(targetId);
    if (!view) return;
    const dx = view.root.x - this.player.x;
    const dy = view.root.y - this.player.y;
    // Archers and staff users don't step in; the arrow or magic shot does the travelling.
    const type = weaponOf(this.world.player).type;
    const ranged = type === 'bow' || type === 'staff';
    this.startAttackAnim(dx, dy, !ranged);
    if (type === 'bow') this.time.delayedCall(ATTACK_ANIM_MS * 0.45, () => this.arrowEffect(targetId));
    if (type === 'staff') this.time.delayedCall(ATTACK_ANIM_MS * 0.35, () => this.boltEffect([targetId], JOB_GLOW[jobOf(this.world.player).id] ?? 0x9be3ff, 0.6));
  }

  private flashHit(id: EntityId): void {
    if (id === 'player') {
      this.playerBody.setTintFill(0xffffff);
      this.time.delayedCall(80, () => this.playerBody.clearTint());
      return;
    }
    const view = this.monsterViews.get(id);
    if (!view) return;
    view.body.setTintFill(0xffffff);
    this.time.delayedCall(80, () => (view.rage ? view.body.setTint(RAGE_TINT[Math.min(view.rage, RAGE_TINT.length - 1)]!) : view.body.clearTint()));
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
