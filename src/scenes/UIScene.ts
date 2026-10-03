import Phaser from 'phaser';
import * as F from '../core/combat/formulas';
import { STAT_NAMES, type StatName } from '../core/combat/formulas';
import { isJobId, jobOf, JOBS } from '../core/jobs';
import { STATUS_INFO } from '../core/status';
import type { SimClock } from '../core/sim';
import { derivedStats, effectiveStats, formatDeltas, previewStatRaise } from '../core/progression';
import type { World } from '../core/world';
import { downloadSave, type SaveManager } from '../save/manager';
import { endSession } from './session';
import { COLORS, TITLE_FONT, TEXT, TONE, WORLD_TEXT } from '../render/palette';
import { DialogueBox } from '../ui/DialogueBox';
import { InventoryWindow } from '../ui/InventoryWindow';
import { ShopWindow } from '../ui/ShopWindow';
import { QuestWindow } from '../ui/QuestWindow';
import { StorageWindow } from '../ui/StorageWindow';
import { PetWindow } from '../ui/PetWindow';
import { HotbarWindow } from '../ui/HotbarWindow';
import { Minimap } from '../ui/Minimap';
import { WorldMapWindow } from '../ui/WorldMapWindow';
import { AppearanceWindow } from '../ui/AppearanceWindow';
import { nextGoal } from '../core/goals';
import { audio } from '../audio/engine';
import type { SaveDb } from '../save/db';
import { quality, setQuality } from '../render/quality';
import { screenCamera, viewSize } from '../render/view';
import { nextVolume, updateAudioSettings, volumeLabel } from '../audio/settings';
import { RefineWindow } from '../ui/RefineWindow';
import { CraftWindow } from '../ui/CraftWindow';
import { SkillWindow } from '../ui/SkillWindow';
import { isSkillId, SKILLS, skillLevel, type SkillDef } from '../core/skills';
import { makeButton, type Panel } from '../ui/widgets';
import { drawPixelBox, PX } from '../ui/pixelui';

const LOG_LINES = 7;
/** Log lines stay this long (ms), fading out over the last LOG_FADE_MS. */
const LOG_LIFE_MS = 9000;
const LOG_FADE_MS = 2500;
const STAT_W = 312;
const STAT_ROW = 34;
const MENU_ROW = 41;
const BUTTON_R = 26;
const BUTTON_GAP = 8;
const SKILL_R = 22;
const MENU_BTN_W = 78;
const SKILL_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
/** Below this width the log moves above the button row. */
const NARROW = 700;
/** Size of the status panel in the top-left corner. */
const STATUS_W = 196;
const STATUS_H = 70;

interface HudButton {
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Image;
  /** Gold ring shown while the button's toggle is on. */
  ring: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Text;
  /** Badge text, whether the button is lit (active toggle), and whether it is usable. */
  state: () => { badge: string; lit: boolean; enabled: boolean };
}

/** HUD, stat window, message log and debug overlay, drawn above the world. */
export class UIScene extends Phaser.Scene {
  private world!: World;
  private bars!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private statusFoot!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private spText!: Phaser.GameObjects.Text;
  private buttons: HudButton[] = [];
  private logText!: Phaser.GameObjects.Text;
  /** Recent log lines and when they arrived; old ones fade away. */
  private log: Array<{ text: string; at: number }> = [];
  private statWindow!: Phaser.GameObjects.Container;
  private statLines = new Map<StatName, Phaser.GameObjects.Text>();
  private statPreviews = new Map<StatName, Phaser.GameObjects.Text>();
  private statPoints!: Phaser.GameObjects.Text;
  private logTimer = 0;
  private statSummary!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private deathText!: Phaser.GameObjects.Text;
  private menuButton!: Phaser.GameObjects.Container;
  private savedText!: Phaser.GameObjects.Text;
  private menu!: Phaser.GameObjects.Container;
  private menuDim!: Phaser.GameObjects.Rectangle;
  private menuPanel!: Phaser.GameObjects.Container;
  private frameMs = 16;
  private inventory!: InventoryWindow;
  private refineWindow!: RefineWindow;
  private craftWindow!: CraftWindow;
  private questWindow!: QuestWindow;
  private storageWindow!: StorageWindow;
  private petWindow!: PetWindow;
  private hotbarWindow!: HotbarWindow;
  private worldMap!: WorldMapWindow;
  private appearanceWindow!: AppearanceWindow;
  private minimap!: Minimap;
  /** Time of day under the minimap. */
  private clockText!: Phaser.GameObjects.Text;
  /** Active hunts under the status panel. */
  private tracker!: Phaser.GameObjects.Text;
  private skillWindow!: SkillWindow;
  /** Learned active skills, one round button each, above the main row. */
  /** Quick-bar buttons: a skill or a consumable item each. */
  private skillButtons: Array<{ id: string; skill: SkillDef | null; root: Phaser.GameObjects.Container; face: Phaser.GameObjects.Image; ring: Phaser.GameObjects.Image; cd: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text }> = [];
  private shop!: ShopWindow;
  private dialogue!: DialogueBox;
  private mapBanner!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossText!: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    screenCamera(this);
    this.world = this.registry.get('world') as World;
    this.log = [];
    this.statLines.clear();
    this.buttons = [];

    // Compact status panel: name line, HP/SP bars with their numbers inside, thin XP bars, gold/weight.
    this.swallowTaps(this.add.zone(8, 8, STATUS_W, STATUS_H).setOrigin(0));
    drawPixelBox(this.add.graphics(), 8, 8, STATUS_W, STATUS_H, COLORS.paper);
    this.bars = this.add.graphics();
    this.statusText = this.add.text(14, 11, '', { ...TEXT, fontSize: '11px', fontStyle: 'bold' });
    this.statusFoot = this.add.text(14, 62, '', { ...TEXT, fontSize: '10px', fontStyle: 'bold' });
    const barLabel = { ...WORLD_TEXT, fontSize: '9px', strokeThickness: 3 };
    this.hpText = this.add.text(18, 33.5, '', barLabel).setOrigin(0, 0.5);
    this.spText = this.add.text(18, 46, '', barLabel).setOrigin(0, 0.5);
    this.logText = this.add.text(12, 0, '', { ...WORLD_TEXT, fontSize: '12px', lineSpacing: 2 }).setOrigin(0, 1);
    this.debugText = this.add
      .text(0, 12, '', { ...TEXT, fontFamily: 'Menlo, Consolas, monospace', fontSize: '11px', backgroundColor: '#000000aa', padding: { x: 8, y: 6 } })
      .setOrigin(1, 0)
      .setVisible(false);
    this.deathText = this.add
      .text(0, 0, '', { ...WORLD_TEXT, fontFamily: TITLE_FONT, fontSize: '22px', align: 'center', fontStyle: 'normal', strokeThickness: 7 })
      .setOrigin(0.5)
      .setVisible(false);
    this.bossBar = this.add.graphics();
    this.bossText = this.add.text(0, 0, '', { ...WORLD_TEXT, fontSize: '12px' }).setOrigin(0.5, 0);
    // Manga caption box: black box, white impact lettering.
    this.mapBanner = this.add
      .text(0, 0, '', { fontFamily: TITLE_FONT, fontSize: '20px', color: '#ffffff', backgroundColor: '#16131c', padding: { x: 16, y: 6 } })
      .setOrigin(0.5)
      .setAlpha(0);
    this.buildStatWindow();
    this.inventory = new InventoryWindow(this, this.world);
    this.skillWindow = new SkillWindow(this, this.world);
    this.shop = new ShopWindow(this, this.world);
    this.refineWindow = new RefineWindow(this, this.world);
    this.craftWindow = new CraftWindow(this, this.world);
    this.questWindow = new QuestWindow(this, this.world);
    this.storageWindow = new StorageWindow(this, this.world);
    this.petWindow = new PetWindow(this, this.world);
    this.hotbarWindow = new HotbarWindow(this, this.world);
    this.worldMap = new WorldMapWindow(this, this.world);
    this.appearanceWindow = new AppearanceWindow(this, this.world);
    this.minimap = new Minimap(this, this.world, () => this.worldMap.toggle());
    this.clockText = this.add.text(0, 0, '', { ...WORLD_TEXT, fontSize: '10px', strokeThickness: 3 }).setOrigin(1, 0);
    const openPet = () => this.petWindow.open();
    this.game.events.on('openPet', openPet);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off('openPet', openPet));
    this.dialogue = new DialogueBox(
      this,
      this.world,
      (shopId) => this.shop.open(shopId),
      () => this.refineWindow.open(),
      () => this.questWindow.open(true),
      () => this.storageWindow.open(),
      () => this.craftWindow.open(),
    );
    this.tracker = this.add.text(12, 0, '', { ...WORLD_TEXT, fontSize: '11px', lineSpacing: 2 });
    this.buildButtons();
    this.buildMenu();
    this.buildSkillButtons();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));

    this.bindKeys();
    this.bindEvents();
    this.showMapName();
    // A brand-new character picks a look first.
    if (this.registry.get('newCharacter')) {
      this.registry.set('newCharacter', false);
      this.appearanceWindow.open();
    }
    if (this.world.player.baseLevel === 1 && this.world.player.baseXp === 0) {
      this.addLog(`Welcome to ${this.world.map.name}. ${this.isTouch() ? 'Tap' : 'Click'} Pell for tips, or head south to the meadow.`);
    }
  }

  override update(_time: number, delta: number): void {
    this.frameMs = this.frameMs * 0.9 + delta * 0.1;
    this.drawStatus();
    this.drawButtons();
    this.drawSkillButtons();
    this.minimap.update(delta);
    const tod = this.registry.get('timeOfDay') as string | undefined;
    this.clockText.setText(tod ? `${tod === 'Night' ? '☾' : '☀'} ${tod}` : '');
    this.logTimer -= delta;
    if (this.logTimer <= 0) {
      this.logTimer = 250;
      this.drawLog();
    }
    this.drawBossBar();
    this.drawTracker();
    this.drawStatWindow();
    this.drawDebug();
    const p = this.world.player;
    this.deathText.setVisible(p.dead).setText(`You have fainted.\nReturning to the save point in ${Math.ceil(p.respawnIn / 1000)}…`);
  }

  private layout(): void {
    const { width, height } = viewSize(this);
    const narrow = width < NARROW;
    this.menuButton.setPosition(width - 10 - MENU_BTN_W, 10);
    this.minimap.root.setPosition(width - 14 - this.minimap.width, 50);
    this.clockText.setPosition(width - 16, 50 + this.minimap.height + 6);
    this.savedText.setPosition(width - 18 - MENU_BTN_W, 18);
    this.menuDim.setSize(width, height);
    this.menuPanel.setPosition(width / 2, height / 2);
    this.buttons.forEach((b, i) => {
      const fromRight = this.buttons.length - 1 - i;
      b.root.setPosition(width - 12 - BUTTON_R - fromRight * (BUTTON_R * 2 + BUTTON_GAP), height - 12 - BUTTON_R);
    });
    // Skill buttons fill right-aligned rows above the main buttons, wrapping upward on narrow screens.
    const perRow = Math.max(1, Math.floor((width - 24 + BUTTON_GAP) / (SKILL_R * 2 + BUTTON_GAP)));
    const rows = Math.ceil(this.skillButtons.length / perRow);
    this.skillButtons.forEach((b, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, this.skillButtons.length - row * perRow);
      const fromRight = inRow - 1 - (i % perRow);
      b.root.setPosition(
        width - 12 - SKILL_R - fromRight * (SKILL_R * 2 + BUTTON_GAP),
        height - 24 - BUTTON_R * 2 - SKILL_R - (rows - 1 - row) * (SKILL_R * 2 + 10),
      );
    });
    const skillRow = rows * (SKILL_R * 2 + 10) + (rows > 0 ? 2 : 0);
    this.logText.setPosition(12, narrow ? height - 24 - BUTTON_R * 2 - skillRow : height - 10).setWordWrapWidth(narrow ? width - 24 : Math.min(520, width - 400));
    this.debugText.setFontSize(narrow ? 9 : 11).setPosition(width - 6, narrow ? STATUS_H + 18 : 52);
    this.deathText.setPosition(width / 2, height / 2 - 60);
    this.statWindow.setPosition(8, STATUS_H + 16);
    this.mapBanner.setPosition(width / 2, height * 0.28);
    for (const panel of this.panels()) {
      if (panel.layout() && panel.visible) this.refreshPanels();
    }
  }

  // ---- Status window -----------------------------------------------------

  private drawStatus(): void {
    const p = this.world.player;
    const d = derivedStats(p);
    const g = this.bars.clear();
    const bar = (x: number, y: number, w: number, h: number, frac: number, color: number) => {
      g.fillStyle(COLORS.barBack).fillRect(x, y, w, h);
      const fw = Math.max(0, Math.min(1, frac)) * w;
      if (fw >= 1) {
        g.fillStyle(color).fillRect(x, y, fw, h);
        g.fillStyle(0xffffff, 0.45).fillRect(x, y + 1, fw, Math.max(1, h * 0.28));
      }
      g.lineStyle(1.5, COLORS.ink).strokeRect(x, y, w, h);
    };
    const baseNeed = F.baseXpToNext(p.baseLevel);
    const job = jobOf(p);
    const jobNeed = F.jobXpToNext(p.jobLevel, job.jobXpFactor);
    const jobMax = p.jobLevel >= job.maxJobLevel;
    const inner = STATUS_W - 12;
    bar(14, 27, inner, 13, p.hp / d.maxHp, p.hp / d.maxHp > 0.25 ? COLORS.hpBar : COLORS.hpBarLow);
    bar(14, 41, inner, 10, p.sp / d.maxSp, COLORS.spBar);
    const half = (inner - 4) / 2;
    bar(14, 54, half, 5, p.baseXp / baseNeed, COLORS.xpBar);
    bar(18 + half, 54, half, 5, jobMax ? 1 : p.jobXp / jobNeed, COLORS.jobXpBar);
    const ratio = this.world.weightRatio();

    const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
    const buffs = [...p.buffs.keys()].map((id) => (isSkillId(id) ? SKILLS[id].short : id));
    this.statusText.setText(`${p.name} · ${job.name} · Lv ${p.baseLevel}/${p.jobLevel}${p.sitting ? ' · sit' : ''}${buffs.length ? ` · ${buffs.join(' ')}` : ''}`);
    this.hpText.setText(`HP ${p.hp}/${d.maxHp}`);
    this.spText.setText(`SP ${p.sp}/${d.maxSp}`);
    this.statusFoot.setText(
      `${pct(p.baseXp, baseNeed)} / ${jobMax ? 'MAX' : pct(p.jobXp, jobNeed)}  ·  ${p.gold}g  ·  Wt ${Math.round(ratio * 100)}%${ratio >= 0.9 ? '!!' : ratio >= 0.5 ? '!' : ''}`,
    );
  }

  // ---- Buttons -----------------------------------------------------------

  private isTouch(): boolean {
    return this.sys.game.device.input.touch;
  }

  /** Makes an area eat taps so they don't fall through to the world and move the player. */
  private swallowTaps<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    obj.setInteractive();
    return obj;
  }

  /** Round on-screen buttons for every keyboard action, so the game plays on touch screens. */
  private buildButtons(): void {
    // One potion button: drinks whatever fits the missing HP best.
    this.addButton('Potion', 'Q', 0xff5a6a, () => this.world.useBestPotion(), () => {
      const n = this.world.hpPotions().reduce((sum, it) => sum + (this.world.player.inventory.get(it.id) ?? 0), 0);
      return { badge: String(n), lit: false, enabled: n > 0 && !this.world.player.dead };
    });
    this.addButton('Auto', 'T', 0xff9a3a, () => this.world.setAuto(!this.world.auto), () => ({
      badge: '',
      lit: this.world.auto,
      enabled: !this.world.player.dead,
    }));
    this.addButton('Sit', 'Z', 0x3fcf8a, () => this.world.toggleSit(), () => ({
      badge: '',
      lit: this.world.player.sitting,
      enabled: !this.world.player.dead,
    }));
    this.addButton('Items', 'I', 0xffb52e, () => this.toggleInventory(), () => ({
      badge: '',
      lit: this.inventory.panel.visible,
      enabled: true,
    }));
    this.addButton('Skills', 'S', 0xa77cf0, () => this.toggleSkills(), () => {
      const pts = this.world.player.skillPoints;
      return { badge: pts > 0 ? String(pts) : '', lit: this.skillWindow.panel.visible, enabled: true };
    });
    this.addButton('Stats', 'A', 0x4f8ff0, () => this.toggleStats(), () => {
      const pts = this.world.player.statPoints;
      return { badge: pts > 0 ? String(pts) : '', lit: this.statWindow.visible, enabled: true };
    });
  }

  private addButton(label: string, key: string, color: number, onPress: () => void, state: HudButton['state']): void {
    const { shadow, face, ring } = this.orb(BUTTON_R, color, 4);
    const text = this.add.text(0, 0, label, { ...WORLD_TEXT, fontFamily: TITLE_FONT, fontSize: '12px', fontStyle: 'normal' }).setOrigin(0.5);
    const badge = this.add
      .text(BUTTON_R - 4, -BUTTON_R + 4, '', { ...TEXT, fontSize: '11px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#16131c', padding: { x: 4, y: 1 } })
      .setOrigin(0.5);
    const children: Phaser.GameObjects.GameObject[] = [shadow, face, ring, text, badge];
    if (!this.isTouch()) {
      children.push(this.add.text(0, BUTTON_R - 9, key, { ...WORLD_TEXT, fontSize: '9px', strokeThickness: 3 }).setOrigin(0.5));
    }
    const root = this.add.container(0, 0, children);
    face.on('pointerdown', () => {
      root.setScale(0.9);
      onPress();
    });
    face.on('pointerup', () => root.setScale(1));
    face.on('pointerout', () => root.setScale(1));
    this.buttons.push({ root, face, ring, badge, state });
  }

  /** A round pixel button face of radius `r` in `color`, its drop shadow, and its "on" ring. */
  private orb(r: number, color: number, drop: number): { shadow: Phaser.GameObjects.Image; face: Phaser.GameObjects.Image; ring: Phaser.GameObjects.Image } {
    const scale = (r * 2) / 26;
    const shadow = this.add.image(drop - 1, drop, 'ui-orb').setScale(scale).setTintFill(COLORS.ink);
    const face = this.add.image(0, 0, 'ui-orb').setScale(scale).setTint(color);
    face.setInteractive({ hitArea: new Phaser.Geom.Circle(13, 13, 13), hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true });
    const ring = this.add.image(0, 0, 'ui-orb-ring').setScale(((r + 4) * 2) / 30).setVisible(false);
    return { shadow, face, ring };
  }

  private drawButtons(): void {
    for (const b of this.buttons) {
      const st = b.state();
      b.badge.setText(st.badge).setVisible(st.badge !== '');
      b.ring.setVisible(st.lit);
      b.root.setAlpha(st.enabled ? 1 : 0.45);
    }
  }

  private toggleStats(): void {
    const show = !this.statWindow.visible;
    this.inventory.close();
    this.skillWindow.close();
    this.statWindow.setVisible(show);
  }

  private toggleInventory(): void {
    this.statWindow.setVisible(false);
    this.skillWindow.close();
    this.inventory.toggle();
  }

  private toggleSkills(): void {
    this.statWindow.setVisible(false);
    this.inventory.close();
    this.skillWindow.toggle();
  }

  /** Rebuilds the skill row from the learned active skills. */
  private buildSkillButtons(): void {
    for (const b of this.skillButtons) b.root.destroy();
    const p = this.world.player;
    this.skillButtons = p.hotbar.slice(0, SKILL_KEYS.length).map((id, i) => {
      const skill = isSkillId(id) ? SKILLS[id] : null;
      const item = skill ? null : this.world.content.items.get(id);
      const { shadow, face, ring } = this.orb(SKILL_R, skill ? 0xa77cf0 : 0xff9aa8, 3);
      const short = skill ? skill.short : shortItemName(item?.name ?? id);
      const label = this.add.text(0, -2, short, { ...WORLD_TEXT, fontFamily: TITLE_FONT, fontSize: short.length > 6 ? '9px' : '11px', fontStyle: 'normal' }).setOrigin(0.5);
      const cd = this.add.text(0, 11, '', { ...WORLD_TEXT, fontSize: '10px', color: '#ffe27a', strokeThickness: 3 }).setOrigin(0.5);
      const badge = this.add
        .text(SKILL_R - 2, -SKILL_R + 2, '', { ...TEXT, fontSize: '10px', color: '#ffffff', backgroundColor: '#16131c', padding: { x: 3, y: 0 } })
        .setOrigin(0.5);
      const children: Phaser.GameObjects.GameObject[] = [shadow, face, ring, label, cd, badge];
      if (!this.isTouch()) children.push(this.add.text(0, SKILL_R - 6, SKILL_KEYS[i]!, { ...WORLD_TEXT, fontSize: '8px', strokeThickness: 2 }).setOrigin(0.5));
      const root = this.add.container(0, 0, children);
      face.on('pointerdown', () => {
        root.setScale(0.9);
        this.world.useHotbar(i);
      });
      face.on('pointerup', () => root.setScale(1));
      face.on('pointerout', () => root.setScale(1));
      return { id, skill, root, face, ring, cd, badge };
    });
    this.layout();
  }

  private drawSkillButtons(): void {
    const p = this.world.player;
    for (const b of this.skillButtons) {
      if (!b.skill) {
        const n = p.inventory.get(b.id) ?? 0;
        b.badge.setText(String(n));
        b.cd.setText('');
        b.root.setAlpha(n > 0 && !p.dead ? 1 : 0.45);
        continue;
      }
      const lv = skillLevel(p, b.skill.id);
      const cost = b.skill.spCost(lv);
      const cdMs = p.cooldowns.get(b.skill.id) ?? 0;
      const buff = p.buffs.get(b.skill.id);
      b.badge.setText(`${cost}`);
      b.cd.setText(cdMs > 0 ? `${Math.ceil(cdMs / 1000)}s` : buff ? `${Math.ceil(buff.remainingMs / 1000)}s` : '');
      b.root.setAlpha(p.sp >= cost && cdMs === 0 && !p.dead ? 1 : 0.45);
      b.ring.setVisible(!!buff);
    }
  }

  private panels(): Panel[] {
    return [this.inventory.panel, this.shop.panel, this.dialogue.panel, this.skillWindow.panel, this.refineWindow.panel, this.craftWindow.panel, this.questWindow.panel, this.storageWindow.panel, this.petWindow.panel, this.hotbarWindow.panel, this.worldMap.panel, this.appearanceWindow.panel];
  }

  private refreshPanels(): void {
    if (this.skillWindow.panel.visible) this.skillWindow.refresh();
    if (this.inventory.panel.visible) this.inventory.refresh();
    if (this.shop.panel.visible) this.shop.refresh();
    if (this.refineWindow.panel.visible) this.refineWindow.refresh();
    if (this.craftWindow.panel.visible) this.craftWindow.refresh();
    if (this.questWindow.panel.visible) this.questWindow.refresh();
    if (this.storageWindow.panel.visible) this.storageWindow.refresh();
    if (this.petWindow.panel.visible) this.petWindow.refresh();
    if (this.hotbarWindow.panel.visible) this.hotbarWindow.refresh();
    if (this.worldMap.panel.visible) this.worldMap.refresh();
    if (this.appearanceWindow.panel.visible) this.appearanceWindow.refresh();
    if (this.dialogue.panel.visible) this.dialogue.refresh();
  }

  /** HP bar for an area boss on the current map, or the time until it returns. */
  private drawBossBar(): void {
    const { width } = viewSize(this);
    const narrow = width < NARROW;
    const g = this.bossBar.clear();
    const boss = [...this.world.monsters.values()].find((m) => m.def.boss);
    const respawn = this.world.bossRespawnAt();
    const w = narrow ? STATUS_W : Math.min(320, width - 520);
    const x = narrow ? 8 : (width - w) / 2;
    const y = narrow ? STATUS_H + 14 : 14;
    if (boss) {
      const frac = Math.max(0, boss.hp / boss.def.hp);
      g.fillStyle(COLORS.ink).fillRect(x + 4, y + 4, w, 32);
      g.fillStyle(COLORS.paper).fillRect(x, y, w, 32).lineStyle(3, COLORS.ink).strokeRect(x, y, w, 32);
      g.fillStyle(0xe9e3d6).fillRect(x + 6, y + 19, w - 12, 8);
      if (frac > 0) g.fillStyle(0xff4a3a).fillRect(x + 6, y + 19, (w - 12) * frac, 8);
      g.lineStyle(2, COLORS.ink).strokeRect(x + 6, y + 19, w - 12, 8);
      this.bossText.setPosition(x + w / 2, y + 3).setText(`${boss.def.name}  ${Math.ceil(frac * 100)}%`).setVisible(true);
    } else if (respawn !== null) {
      const mins = Math.max(0, Math.ceil((respawn - this.world.now()) / 60_000));
      this.bossText.setPosition(x + w / 2, y + 3).setText(`The hall is quiet… (boss returns in ~${mins} min)`).setVisible(true);
    } else {
      this.bossText.setVisible(false);
    }
  }

  private drawTracker(): void {
    const w = this.world;
    const quests = [...w.player.quests.active].map(([id, n]) => {
      const q = w.content.quests.get(id);
      if (!q) return '';
      const name = w.content.monsters.get(q.target.monster)?.name ?? q.target.monster;
      return n >= q.target.count ? `✓ ${q.name}: return to the board` : `${name} ${n}/${q.target.count}`;
    });
    const narrow = viewSize(this).width < NARROW;
    const bossShown = this.bossText.visible && narrow;
    // The goal only changes on level-ups and map changes; recomputing it every frame is cheap enough.
    const lines = [`★ ${nextGoal(w)}`, ...quests];
    this.tracker
      .setText(lines.join('\n'))
      .setPosition(12, STATUS_H + (bossShown ? 52 : 14))
      .setWordWrapWidth(Math.min(360, viewSize(this).width - 40 - this.minimap.width))
      .setVisible(!this.statWindow.visible);
  }

  private showBanner(text: string, color = '#f4f7fb'): void {
    this.tweens.killTweensOf(this.mapBanner);
    this.mapBanner.setText(text).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.mapBanner, alpha: 0, delay: 2200, duration: 900 });
  }

  private showMapName(): void {
    this.tweens.killTweensOf(this.mapBanner);
    this.mapBanner.setText(this.world.map.name).setColor('#f4f7fb').setAlpha(1);
    this.tweens.add({ targets: this.mapBanner, alpha: 0, delay: 1400, duration: 800 });
  }

  private toggleDebug(): void {
    const on = !this.registry.get('debug');
    this.registry.set('debug', on);
    this.debugText.setVisible(on);
  }

  // ---- Stat window -------------------------------------------------------

  private buildStatWindow(): void {
    const W = STAT_W;
    const H = 46 + STAT_NAMES.length * STAT_ROW + 74;
    const bg = drawPixelBox(this.add.graphics(), 0, 0, W, H, COLORS.paper).fillStyle(COLORS.ink).fillRect(PX, PX, W - PX * 2, 30 - PX);
    const title = this.add.text(10, 3, 'STATS', { ...TEXT, fontFamily: TITLE_FONT, fontSize: '14px', color: '#ffffff' });
    this.statPoints = this.add.text(W - 10, 6, '', { ...TEXT, fontSize: '13px', fontStyle: 'bold', color: '#ffd84a' }).setOrigin(1, 0);
    const children: Phaser.GameObjects.GameObject[] = [this.swallowTaps(this.add.zone(0, 0, W, H).setOrigin(0)), bg, title, this.statPoints];
    STAT_NAMES.forEach((stat, i) => {
      const y = 38 + i * STAT_ROW;
      const line = this.add.text(10, y, '', { ...TEXT, fontSize: '13px', fontStyle: 'bold' });
      // What one more point would do, so spending is an informed choice.
      const preview = this.add.text(10, y + 17, '', { ...TEXT, fontSize: '10px', color: TONE.muted, wordWrap: { width: W - 70 } });
      const plus = this.add
        .text(W - 48, y + 2, '+', { ...TEXT, fontSize: '18px', fontStyle: 'bold', color: '#16131c', backgroundColor: '#ffd84a', padding: { x: 11, y: 2 } })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.world.raiseStat(stat);
        });
      this.statLines.set(stat, line);
      this.statPreviews.set(stat, preview);
      children.push(line, preview, plus);
    });
    this.statSummary = this.add.text(10, 44 + STAT_NAMES.length * STAT_ROW, '', { ...TEXT, fontSize: '12px', lineSpacing: 2 });
    children.push(this.statSummary);
    this.statWindow = this.add.container(0, 0, children).setVisible(false);
  }

  private drawStatWindow(): void {
    if (!this.statWindow.visible) return;
    const p = this.world.player;
    const d = derivedStats(p);
    const eff = effectiveStats(p);
    this.statPoints.setText(`${p.statPoints} points`);
    for (const stat of STAT_NAMES) {
      const v = p.stats[stat];
      const extra = eff[stat] - v;
      const cost = F.statRaiseCost(v);
      this.statLines.get(stat)!.setText(`${stat.toUpperCase().padEnd(4)} ${v}${extra ? ` +${extra}` : ''}   (costs ${cost})`);
      this.statPreviews.get(stat)!.setText(`+1: ${formatDeltas(previewStatRaise(p, stat))}`).setColor(p.statPoints >= cost ? TONE.accent : TONE.muted);
    }
    this.statSummary.setText(
      [
        `ATK ${d.atk}   MATK ${d.matk}   DEF ${d.def}`,
        `HIT ${d.hit}  FLEE ${d.flee}  CRIT ${(d.crit * 100).toFixed(1)}%`,
        `ASPD ${d.aspd}  (${(1000 / d.attackDelayMs).toFixed(2)} hits/s)`,
      ].join('\n'),
    );
  }

  // ---- Input -------------------------------------------------------------

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    kb.addCapture('F1,F2,F3,F4,F5,F6');
    SKILL_KEYS.forEach((key, i) => kb.on(`keydown-${key}`, () => this.world.useHotbar(i)));
    kb.on('keydown-Q', () => this.world.useBestPotion());
    kb.on('keydown-T', () => this.world.setAuto(!this.world.auto));
    kb.on('keydown-S', () => this.toggleSkills());
    kb.on('keydown-Z', () => this.world.toggleSit());
    kb.on('keydown-INSERT', () => this.world.toggleSit());
    kb.on('keydown-A', () => this.toggleStats());
    kb.on('keydown-I', () => this.toggleInventory());
    kb.on('keydown-ESC', () => this.toggleMenu());
    kb.on('keydown-BACKTICK', () => this.toggleDebug());

  }

  // ---- Menu --------------------------------------------------------------

  private saves(): SaveManager {
    return this.registry.get('saves') as SaveManager;
  }

  private buildMenu(): void {
    const menuBtn = makeButton(this, 0, 0, MENU_BTN_W, 32, 'MENU', () => this.toggleMenu(), 0xffd84a);
    menuBtn.label.setFontFamily(TITLE_FONT).setFontSize(14);
    this.menuButton = menuBtn.root;
    this.savedText = this.add.text(0, 0, 'Saved', { ...WORLD_TEXT, fontSize: '12px', color: '#9be38f' }).setOrigin(1, 0).setAlpha(0);
    const onSaved = () => {
      this.tweens.killTweensOf(this.savedText);
      this.savedText.setAlpha(1);
      this.tweens.add({ targets: this.savedText, alpha: 0, delay: 1200, duration: 600 });
    };
    this.game.events.on('saved', onSaved);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off('saved', onSaved));

    // Full-screen dim layer eats taps so nothing reaches the world while the menu is open.
    this.menuDim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(0).setInteractive().on('pointerdown', () => this.toggleMenu());
    const w = 220;
    const db = this.registry.get('db') as SaveDb;
    const entries: Array<[string | (() => string), () => void]> = [
      ['Save now', () => void this.saves().save().then(() => this.addLog('Game saved.'))],
      [() => `Music: ${volumeLabel(audio.current.music)}`, () => updateAudioSettings(db, { music: nextVolume(audio.current.music), muted: false })],
      [() => `Sounds: ${volumeLabel(audio.current.sfx)}`, () => updateAudioSettings(db, { sfx: nextVolume(audio.current.sfx), muted: false })],
      [() => `Effects: ${quality.low ? 'Low (30 fps)' : 'Full'}`, () => setQuality(db, this.game, !quality.low)],
      ['Export save file', () => this.exportSave()],
      ['Quest log', () => (this.toggleMenu(), this.questWindow.open(false))],
      ['Pet', () => (this.toggleMenu(), this.petWindow.open())],
      ['World map', () => (this.toggleMenu(), this.worldMap.open())],
      ['Appearance', () => (this.toggleMenu(), this.appearanceWindow.open())],
      ['Edit quick bar', () => (this.toggleMenu(), this.hotbarWindow.open())],
      ['Toggle debug overlay', () => (this.toggleDebug(), this.toggleMenu())],
      ['Save and quit to title', () => void endSession(this)],
      ['Close', () => this.toggleMenu()],
    ];
    const h = 44 + entries.length * MENU_ROW;
    const chrome = drawPixelBox(this.add.graphics(), -w / 2, -h / 2, w, h, COLORS.paper).fillStyle(COLORS.ink).fillRect(-w / 2 + PX, -h / 2 + PX, w - PX * 2, 34 - PX);
    const panelChildren: Phaser.GameObjects.GameObject[] = [
      chrome,
      this.add.rectangle(0, 0, w, h, COLORS.paper, 0).setInteractive(),
      this.add.text(0, -h / 2 + 4, 'MENU', { ...TEXT, fontFamily: TITLE_FONT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 0),
    ];
    entries.forEach(([label, fn], i) => {
      const y = -h / 2 + 60 + i * MENU_ROW;
      const btn = makeButton(this, -(w - 28) / 2, y - 17, w - 28, 34, typeof label === 'string' ? label : label(), () => {
        fn();
        if (typeof label !== 'string') btn.label.setText(label());
      });
      panelChildren.push(btn.root);
    });
    this.menuPanel = this.add.container(0, 0, panelChildren);
    this.menu = this.add.container(0, 0, [this.menuDim, this.menuPanel]).setVisible(false).setDepth(100);
  }

  private toggleMenu(): void {
    this.menu.setVisible(!this.menu.visible);
  }

  private exportSave(): void {
    const doc = this.saves().snapshot();
    void this.saves().save();
    downloadSave(doc);
    this.addLog('Save file exported. Keep it somewhere safe.');
  }

  // ---- Message log -------------------------------------------------------

  private bindEvents(): void {
    const ev = this.world.events;
    const offs = [
      ev.on('itemPicked', (e) => this.addLog(`Picked up ${e.item.name}.`)),
      ev.on('itemUsed', (e) => this.addLog(`Used ${e.item.name}.`)),
      ev.on('levelUp', (e) =>
        this.addLog(e.kind === 'base' ? `Base level ${e.level}! Open Stats to spend your points.` : `Job level ${e.level}! Open Skills to spend the point.`),
      ),
      ev.on('playerDied', (e) => this.addLog(`You fainted and lost ${e.xpLost} XP.`)),
      ev.on('playerRespawned', () => this.addLog('You wake up at the save point.')),
      ev.on('notice', (e) => this.addLog(e.text)),
      ev.on('castInterrupted', () => this.addLog('Your cast was interrupted.')),
      ev.on('statusApplied', (e) => this.addLog(`You are ${STATUS_INFO[e.status].name.toLowerCase()}! ${STATUS_INFO[e.status].describe}`)),
      ev.on('statusEnded', (e) => this.addLog(`No longer ${STATUS_INFO[e.status].name.toLowerCase()}.`)),
      ev.on('questReady', (e) => this.addLog(`Hunt done: ${e.name}. Turn it in at the Hunting Board.`)),
      ev.on('questCompleted', (e) => this.showBanner(`Bounty collected: ${e.name}`, '#9be38f')),
      ev.on('bossPhase', (e) => {
        const boss = this.world.monsters.get(e.monsterId);
        if (boss) this.addLog(`${boss.def.name}: ${e.shout}`);
      }),
      ev.on('boss', (e) => {
        if (e.kind === 'appeared') {
          this.addLog(`${e.name} has appeared!`);
          this.time.delayedCall(1600, () => this.showBanner(`${e.name} has appeared!`, '#ff9a7a'));
        } else {
          this.addLog(`${e.name} has been defeated! MVP!`);
          this.showBanner(`MVP! ${e.name} defeated`, '#ffe27a');
        }
      }),
      ev.on('crafted', (e) => {
        const item = this.world.content.items.get(e.itemId);
        this.addLog(`Crafted ${item?.name ?? e.itemId}${e.count > 1 ? ` ×${e.count}` : ''}!`);
      }),
      ev.on('refined', (e) => this.addLog(e.success ? `Refined ${e.name} to +${e.level}!` : `${e.name} shattered at +${e.level}.`)),
      ev.on('skillsChanged', () => this.buildSkillButtons()),
      ev.on('hotbarChanged', () => this.buildSkillButtons()),
      ev.on('autoChanged', (e) => this.addLog(e.on ? 'Auto on: fighting nearby monsters and picking up loot. Tap the map to take over.' : 'Auto off.')),
      ev.on('petTamed', (e) => this.addLog(`You tamed a ${e.name}! Tap it to see how it's doing.`)),
      ev.on('tameFailed', (e) => this.addLog(`The ${e.name} wasn't fooled. Wear it down and try again.`)),
      ev.on('petRanAway', (e) => this.addLog(`${e.name} got too hungry and ran away…`)),
      ev.on('petLevelUp', (e) => this.addLog(`${e.name} reached level ${e.level}!`)),
      ev.on('jobChanged', (e) => {
        const name = isJobId(e.jobId) ? JOBS[e.jobId].name : e.jobId;
        this.addLog(`You are now ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}! Open Skills to learn new skills.`);
        this.buildSkillButtons();
      }),
      ev.on('talk', (e) => {
        this.inventory.close();
        this.skillWindow.close();
        this.statWindow.setVisible(false);
        this.dialogue.open(e.npc);
      }),
      ev.on('mapChanged', () => {
        this.questWindow.close();
        this.dialogue.close();
        this.shop.close();
        this.refineWindow.close();
        this.craftWindow.close();
        this.storageWindow.close();
        this.minimap.rebuild();
        this.layout();
        if (this.worldMap.panel.visible) this.worldMap.refresh();
        this.showMapName();
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));
  }

  private addLog(line: string): void {
    // Repeats (e.g. several "Not enough SP.") collapse into one line with a count.
    const last = this.log[this.log.length - 1];
    const base = last?.text.replace(/ ×\d+$/, '');
    if (last && base === line && this.time.now - last.at < LOG_LIFE_MS) {
      const n = Number(/ ×(\d+)$/.exec(last.text)?.[1] ?? 1) + 1;
      last.text = `${line} ×${n}`;
      last.at = this.time.now;
    } else {
      this.log.push({ text: line, at: this.time.now });
      if (this.log.length > LOG_LINES) this.log.shift();
    }
    this.drawLog();
  }

  /** Shows the lines that are still fresh; the block fades as its newest line ages. */
  private drawLog(): void {
    if (!this.logText) return;
    const now = this.time.now;
    this.log = this.log.filter((l) => now - l.at < LOG_LIFE_MS);
    const newest = this.log[this.log.length - 1];
    this.logText.setText(this.log.map((l) => l.text).join('\n'));
    const age = newest ? now - newest.at : LOG_LIFE_MS;
    this.logText.setAlpha(Math.max(0, Math.min(1, (LOG_LIFE_MS - age) / LOG_FADE_MS)));
  }

  // ---- Debug overlay -----------------------------------------------------

  private drawDebug(): void {
    if (!this.debugText.visible) return;
    const w = this.world;
    const s = w.session;
    const clock = this.registry.get('clock') as SimClock | undefined;
    const hours = Math.max(w.time, 1) / 3_600_000;
    const states = { idle: 0, wander: 0, chase: 0, attack: 0 };
    for (const m of w.monsters.values()) states[m.state] += 1;
    const p = w.player;
    this.debugText.setText(
      [
        `FPS ${(1000 / this.frameMs).toFixed(0)}   ticks ${clock?.ticks ?? 0}   sim ${(w.time / 1000).toFixed(0)}s`,
        `player ${p.tile.x},${p.tile.y}  intent ${p.intent.kind}  path ${p.path.length}`,
        `monsters ${w.monsters.size}  idle ${states.idle} wander ${states.wander} chase ${states.chase} attack ${states.attack}`,
        `drops on ground ${w.drops.size}`,
        '',
        `kills ${s.kills}   deaths ${s.deaths}`,
        `kills/min ${(s.kills / (hours * 60)).toFixed(1)}`,
        `base XP/h ${Math.round(s.baseXp / hours)}   job XP/h ${Math.round(s.jobXp / hours)}`,
        `loot gold/h ${Math.round(s.lootValue / hours)}  (NPC sell value)`,
      ].join('\n'),
    );
  }
}

/** A potion or item name short enough for a round button: "Red Tonic" → "Red". */
function shortItemName(name: string): string {
  const first = name.split(' ')[0]!;
  return first.length <= 7 ? first : first.slice(0, 6);
}
