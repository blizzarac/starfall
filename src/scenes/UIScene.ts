import Phaser from 'phaser';
import * as F from '../core/combat/formulas';
import { STAT_NAMES, type StatName } from '../core/combat/formulas';
import { jobOf } from '../core/jobs';
import type { SimClock } from '../core/sim';
import { derivedStats } from '../core/progression';
import type { World } from '../core/world';
import { downloadSave, type SaveManager } from '../save/manager';
import { endSession } from './session';
import { COLORS, TEXT } from '../render/palette';
import { DialogueBox } from '../ui/DialogueBox';
import { InventoryWindow } from '../ui/InventoryWindow';
import { ShopWindow } from '../ui/ShopWindow';
import { SkillWindow } from '../ui/SkillWindow';
import { SKILLS, skillLevel, type SkillDef } from '../core/skills';
import type { Panel } from '../ui/widgets';

const HOTBAR: Array<{ key: string; itemId: string }> = [
  { key: 'F1', itemId: 'red_tonic' },
  { key: 'F2', itemId: 'sweet_apple' },
];
const LOG_LINES = 7;
const BUTTON_R = 26;
const BUTTON_GAP = 8;
const SKILL_R = 22;
const SKILL_KEYS = ['F3', 'F4', 'F5', 'F6'];
/** Below this width the log moves above the button row. */
const NARROW = 700;

interface HudButton {
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Arc;
  badge: Phaser.GameObjects.Text;
  /** Badge text, whether the button is lit (active toggle), and whether it is usable. */
  state: () => { badge: string; lit: boolean; enabled: boolean };
}

/** HUD, stat window, message log and debug overlay, drawn above the world. */
export class UIScene extends Phaser.Scene {
  private world!: World;
  private bars!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private buttons: HudButton[] = [];
  private logText!: Phaser.GameObjects.Text;
  private log: string[] = [];
  private statWindow!: Phaser.GameObjects.Container;
  private statLines = new Map<StatName, Phaser.GameObjects.Text>();
  private statSummary!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private deathText!: Phaser.GameObjects.Text;
  private menuButton!: Phaser.GameObjects.Text;
  private savedText!: Phaser.GameObjects.Text;
  private menu!: Phaser.GameObjects.Container;
  private menuDim!: Phaser.GameObjects.Rectangle;
  private menuPanel!: Phaser.GameObjects.Container;
  private frameMs = 16;
  private inventory!: InventoryWindow;
  private skillWindow!: SkillWindow;
  /** Learned active skills, one round button each, above the main row. */
  private skillButtons: Array<{ skill: SkillDef; root: Phaser.GameObjects.Container; face: Phaser.GameObjects.Arc; cd: Phaser.GameObjects.Text; badge: Phaser.GameObjects.Text }> = [];
  private shop!: ShopWindow;
  private dialogue!: DialogueBox;
  private mapBanner!: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    this.world = this.registry.get('world') as World;
    this.log = [];
    this.statLines.clear();
    this.buttons = [];

    this.swallowTaps(this.add.zone(8, 8, 236, 142).setOrigin(0));
    this.add.graphics().fillStyle(COLORS.ui, 0.82).fillRoundedRect(8, 8, 236, 142, 8).lineStyle(1, COLORS.uiBorder, 0.6).strokeRoundedRect(8, 8, 236, 142, 8);
    this.bars = this.add.graphics();
    this.statusText = this.add.text(18, 14, '', { ...TEXT, fontSize: '12px', lineSpacing: 6 });
    this.logText = this.add.text(12, 0, '', { ...TEXT, fontSize: '12px', lineSpacing: 2 }).setOrigin(0, 1);
    this.debugText = this.add
      .text(0, 12, '', { ...TEXT, fontFamily: 'Menlo, Consolas, monospace', fontSize: '11px', backgroundColor: '#000000aa', padding: { x: 8, y: 6 } })
      .setOrigin(1, 0)
      .setVisible(false);
    this.deathText = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '22px', align: 'center', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setVisible(false);
    this.mapBanner = this.add.text(0, 0, '', { ...TEXT, fontSize: '22px', fontStyle: 'bold', strokeThickness: 5 }).setOrigin(0.5).setAlpha(0);
    this.buildStatWindow();
    this.inventory = new InventoryWindow(this, this.world);
    this.skillWindow = new SkillWindow(this, this.world);
    this.shop = new ShopWindow(this, this.world);
    this.dialogue = new DialogueBox(this, this.world, (shopId) => this.shop.open(shopId));
    this.buildButtons();
    this.buildMenu();
    this.buildSkillButtons();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));

    this.bindKeys();
    this.bindEvents();
    this.showMapName();
    if (this.world.player.baseLevel === 1 && this.world.player.baseXp === 0) {
      this.addLog(`Welcome to ${this.world.map.name}. ${this.isTouch() ? 'Tap' : 'Click'} Pell for tips, or head south to the meadow.`);
    }
  }

  override update(_time: number, delta: number): void {
    this.frameMs = this.frameMs * 0.9 + delta * 0.1;
    this.drawStatus();
    this.drawButtons();
    this.drawSkillButtons();
    this.drawStatWindow();
    this.drawDebug();
    const p = this.world.player;
    this.deathText.setVisible(p.dead).setText(`You have fainted.\nReturning to the save point in ${Math.ceil(p.respawnIn / 1000)}…`);
  }

  private layout(): void {
    const { width, height } = this.scale;
    const narrow = width < NARROW;
    this.menuButton.setPosition(width - 10, 10);
    this.savedText.setPosition(width - 18 - this.menuButton.width, 18);
    this.menuDim.setSize(width, height);
    this.menuPanel.setPosition(width / 2, height / 2);
    this.buttons.forEach((b, i) => {
      const fromRight = this.buttons.length - 1 - i;
      b.root.setPosition(width - 12 - BUTTON_R - fromRight * (BUTTON_R * 2 + BUTTON_GAP), height - 12 - BUTTON_R);
    });
    this.skillButtons.forEach((b, i) => {
      const fromRight = this.skillButtons.length - 1 - i;
      b.root.setPosition(width - 12 - SKILL_R - fromRight * (SKILL_R * 2 + BUTTON_GAP), height - 24 - BUTTON_R * 2 - SKILL_R);
    });
    const skillRow = this.skillButtons.length > 0 ? SKILL_R * 2 + 12 : 0;
    this.logText.setPosition(12, narrow ? height - 24 - BUTTON_R * 2 - skillRow : height - 10).setWordWrapWidth(narrow ? width - 24 : Math.min(520, width - 400));
    this.debugText.setFontSize(narrow ? 9 : 11).setPosition(width - 6, narrow ? 158 : 52);
    this.deathText.setPosition(width / 2, height / 2 - 60);
    this.statWindow.setPosition(8, 158);
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
    const bar = (y: number, frac: number, color: number) => {
      g.fillStyle(COLORS.barBack).fillRoundedRect(128, y, 106, 9, 3);
      const w = Math.max(0, Math.min(1, frac)) * 106;
      if (w >= 1) g.fillStyle(color).fillRoundedRect(128, y, w, 9, Math.min(3, w / 2));
    };
    const baseNeed = F.baseXpToNext(p.baseLevel);
    const job = jobOf(p);
    const jobNeed = F.jobXpToNext(p.jobLevel, job.jobXpFactor);
    const jobMax = p.jobLevel >= job.maxJobLevel;
    bar(38, p.hp / d.maxHp, p.hp / d.maxHp > 0.25 ? COLORS.hpBar : COLORS.hpBarLow);
    bar(56, p.sp / d.maxSp, COLORS.spBar);
    bar(74, p.baseXp / baseNeed, COLORS.xpBar);
    bar(92, jobMax ? 1 : p.jobXp / jobNeed, COLORS.jobXpBar);
    const ratio = this.world.weightRatio();

    const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
    this.statusText.setText(
      [
        `${p.name}  ·  ${job.name}${p.sitting ? '  (sitting)' : ''}${p.buffs.has('endure') ? '  · Endure' : ''}`,
        `HP ${p.hp}/${d.maxHp}`,
        `SP ${p.sp}/${d.maxSp}`,
        `Base Lv ${p.baseLevel}  ${pct(p.baseXp, baseNeed)}`,
        `Job Lv ${p.jobLevel}  ${jobMax ? 'MAX' : pct(p.jobXp, jobNeed)}`,
        `Gold ${p.gold}   Wt ${Math.round(ratio * 100)}%${ratio >= 0.9 ? ' (overweight)' : ratio >= 0.5 ? ' (heavy)' : ''}`,
      ].join('\n'),
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
    const inv = () => this.world.player.inventory;
    for (const { key, itemId, label } of [
      { ...HOTBAR[0]!, label: 'Tonic' },
      { ...HOTBAR[1]!, label: 'Apple' },
    ]) {
      this.addButton(label, key, 0xc94a5a, () => this.world.useItem(itemId), () => {
        const n = inv().get(itemId) ?? 0;
        return { badge: String(n), lit: false, enabled: n > 0 };
      });
    }
    this.addButton('Sit', 'Z', 0x3f8f6a, () => this.world.toggleSit(), () => ({
      badge: '',
      lit: this.world.player.sitting,
      enabled: !this.world.player.dead,
    }));
    this.addButton('Items', 'I', 0xb0873f, () => this.toggleInventory(), () => ({
      badge: '',
      lit: this.inventory.panel.visible,
      enabled: true,
    }));
    this.addButton('Skills', 'S', 0x8a5fc0, () => this.toggleSkills(), () => {
      const pts = this.world.player.skillPoints;
      return { badge: pts > 0 ? String(pts) : '', lit: this.skillWindow.panel.visible, enabled: true };
    });
    this.addButton('Stats', 'A', 0x4f6fb0, () => this.toggleStats(), () => {
      const pts = this.world.player.statPoints;
      return { badge: pts > 0 ? String(pts) : '', lit: this.statWindow.visible, enabled: true };
    });
  }

  private addButton(label: string, key: string, color: number, onPress: () => void, state: HudButton['state']): void {
    const face = this.add.circle(0, 0, BUTTON_R, color, 0.92).setStrokeStyle(2, 0xffffff, 0.5);
    const text = this.add.text(0, 0, label, { ...TEXT, fontSize: '12px', fontStyle: 'bold' }).setOrigin(0.5);
    const badge = this.add
      .text(BUTTON_R - 4, -BUTTON_R + 4, '', { ...TEXT, fontSize: '11px', fontStyle: 'bold', backgroundColor: '#141a24', padding: { x: 4, y: 1 } })
      .setOrigin(0.5);
    const children: Phaser.GameObjects.GameObject[] = [face, text, badge];
    if (!this.isTouch()) {
      children.push(this.add.text(0, BUTTON_R - 9, key, { ...TEXT, fontSize: '9px', color: '#d6deea' }).setOrigin(0.5));
    }
    const root = this.add.container(0, 0, children);
    face.setInteractive({ useHandCursor: true });
    face.on('pointerdown', () => {
      root.setScale(0.9);
      onPress();
    });
    face.on('pointerup', () => root.setScale(1));
    face.on('pointerout', () => root.setScale(1));
    this.buttons.push({ root, face, badge, state });
  }

  private drawButtons(): void {
    for (const b of this.buttons) {
      const st = b.state();
      b.badge.setText(st.badge).setVisible(st.badge !== '');
      b.face.setStrokeStyle(st.lit ? 3 : 2, st.lit ? 0xffe27a : 0xffffff, st.lit ? 1 : 0.5);
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
    const actives = Object.values(SKILLS).filter((s) => s.kind !== 'passive' && skillLevel(p, s.id) > 0);
    this.skillButtons = actives.slice(0, SKILL_KEYS.length).map((skill, i) => {
      const face = this.add.circle(0, 0, SKILL_R, 0x6a4fa0, 0.92).setStrokeStyle(2, 0xffffff, 0.5);
      const label = this.add.text(0, -2, skill.short, { ...TEXT, fontSize: '11px', fontStyle: 'bold' }).setOrigin(0.5);
      const cd = this.add.text(0, 10, '', { ...TEXT, fontSize: '10px', color: '#ffe27a' }).setOrigin(0.5);
      const badge = this.add
        .text(SKILL_R - 2, -SKILL_R + 2, '', { ...TEXT, fontSize: '10px', backgroundColor: '#141a24', padding: { x: 3, y: 0 } })
        .setOrigin(0.5);
      const children: Phaser.GameObjects.GameObject[] = [face, label, cd, badge];
      if (!this.isTouch()) children.push(this.add.text(0, SKILL_R - 6, SKILL_KEYS[i]!, { ...TEXT, fontSize: '8px', color: '#d6deea' }).setOrigin(0.5));
      const root = this.add.container(0, 0, children);
      face.setInteractive({ useHandCursor: true });
      face.on('pointerdown', () => {
        root.setScale(0.9);
        this.world.useSkill(skill.id);
      });
      face.on('pointerup', () => root.setScale(1));
      face.on('pointerout', () => root.setScale(1));
      return { skill, root, face, cd, badge };
    });
    this.layout();
  }

  private drawSkillButtons(): void {
    const p = this.world.player;
    for (const b of this.skillButtons) {
      const lv = skillLevel(p, b.skill.id);
      const cost = b.skill.spCost(lv);
      const cdMs = p.cooldowns.get(b.skill.id) ?? 0;
      const buff = p.buffs.get(b.skill.id);
      b.badge.setText(`${cost}`);
      b.cd.setText(cdMs > 0 ? `${Math.ceil(cdMs / 1000)}s` : buff ? `${Math.ceil(buff.remainingMs / 1000)}s` : '');
      b.root.setAlpha(p.sp >= cost && cdMs === 0 && !p.dead ? 1 : 0.45);
      b.face.setStrokeStyle(buff ? 3 : 2, buff ? 0xffe27a : 0xffffff, buff ? 1 : 0.5);
    }
  }

  private panels(): Panel[] {
    return [this.inventory.panel, this.shop.panel, this.dialogue.panel, this.skillWindow.panel];
  }

  private refreshPanels(): void {
    if (this.skillWindow.panel.visible) this.skillWindow.refresh();
    if (this.inventory.panel.visible) this.inventory.refresh();
    if (this.shop.panel.visible) this.shop.refresh();
    if (this.dialogue.panel.visible) this.dialogue.refresh();
  }

  private showMapName(): void {
    this.tweens.killTweensOf(this.mapBanner);
    this.mapBanner.setText(this.world.map.name).setAlpha(1);
    this.tweens.add({ targets: this.mapBanner, alpha: 0, delay: 1400, duration: 800 });
  }

  private toggleDebug(): void {
    const on = !this.registry.get('debug');
    this.registry.set('debug', on);
    this.debugText.setVisible(on);
  }

  // ---- Stat window -------------------------------------------------------

  private buildStatWindow(): void {
    const bg = this.add.graphics().fillStyle(COLORS.ui, 0.9).fillRoundedRect(0, 0, 236, 262, 8).lineStyle(1, COLORS.uiBorder, 0.6).strokeRoundedRect(0, 0, 236, 262, 8);
    const title = this.add.text(10, 8, 'Stats', { ...TEXT, fontStyle: 'bold' });
    const children: Phaser.GameObjects.GameObject[] = [this.swallowTaps(this.add.zone(0, 0, 236, 262).setOrigin(0)), bg, title];
    STAT_NAMES.forEach((stat, i) => {
      const y = 34 + i * 24;
      const line = this.add.text(10, y, '', { ...TEXT, fontSize: '12px' });
      const plus = this.add
        .text(196, y - 3, '+', { ...TEXT, fontSize: '16px', fontStyle: 'bold', backgroundColor: '#3a4a63', padding: { x: 9, y: 1 } })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.world.raiseStat(stat);
        });
      this.statLines.set(stat, line);
      children.push(line, plus);
    });
    this.statSummary = this.add.text(10, 182, '', { ...TEXT, fontSize: '12px', lineSpacing: 2 });
    children.push(this.statSummary);
    this.statWindow = this.add.container(0, 0, children).setVisible(false);
  }

  private drawStatWindow(): void {
    if (!this.statWindow.visible) return;
    const p = this.world.player;
    const d = derivedStats(p);
    for (const stat of STAT_NAMES) {
      const v = p.stats[stat];
      this.statLines.get(stat)!.setText(`${stat.toUpperCase().padEnd(4)} ${String(v).padStart(3)}     cost ${F.statRaiseCost(v)}`);
    }
    this.statSummary.setText(
      [
        `Points left: ${p.statPoints}`,
        `ATK ${d.atk}   DEF ${d.def}   HIT ${d.hit}`,
        `FLEE ${d.flee}   CRIT ${(d.crit * 100).toFixed(1)}%`,
        `ASPD ${d.aspd}  (${(1000 / d.attackDelayMs).toFixed(2)} hits/s)`,
      ].join('\n'),
    );
  }

  // ---- Input -------------------------------------------------------------

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    kb.addCapture('F1,F2,F3,F4,F5,F6');
    SKILL_KEYS.forEach((key, i) => kb.on(`keydown-${key}`, () => this.skillButtons[i] && this.world.useSkill(this.skillButtons[i]!.skill.id)));
    kb.on('keydown-S', () => this.toggleSkills());
    for (const { key, itemId } of HOTBAR) kb.on(`keydown-${key}`, () => this.world.useItem(itemId));
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
    this.menuButton = this.add
      .text(0, 0, 'Menu', { ...TEXT, fontSize: '14px', fontStyle: 'bold', backgroundColor: '#1e2633dd', padding: { x: 12, y: 8 } })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleMenu());
    this.savedText = this.add.text(0, 0, 'Saved', { ...TEXT, fontSize: '12px', color: '#9be38f' }).setOrigin(1, 0).setAlpha(0);
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
    const entries: Array<[string, () => void]> = [
      ['Save now', () => void this.saves().save().then(() => this.addLog('Game saved.'))],
      ['Export save file', () => this.exportSave()],
      ['Toggle debug overlay', () => (this.toggleDebug(), this.toggleMenu())],
      ['Save and quit to title', () => void endSession(this)],
      ['Close', () => this.toggleMenu()],
    ];
    const h = 44 + entries.length * 46;
    const panelChildren: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(0, 0, w, h, COLORS.ui, 0.96).setStrokeStyle(1, COLORS.uiBorder, 0.7).setInteractive(),
      this.add.text(0, -h / 2 + 14, 'Menu', { ...TEXT, fontSize: '15px', fontStyle: 'bold' }).setOrigin(0.5, 0),
    ];
    entries.forEach(([label, fn], i) => {
      const y = -h / 2 + 62 + i * 46;
      const bg = this.add
        .rectangle(0, y, w - 28, 38, 0x3a4a63)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', fn);
      panelChildren.push(bg, this.add.text(0, y, label, { ...TEXT, fontSize: '13px' }).setOrigin(0.5));
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
      ev.on('xpGained', (e) => this.addLog(`Gained ${e.base} base XP and ${e.job} job XP.`)),
      ev.on('levelUp', (e) =>
        this.addLog(e.kind === 'base' ? `Base level ${e.level}! Open Stats to spend your points.` : `Job level ${e.level}! Open Skills to spend the point.`),
      ),
      ev.on('playerDied', (e) => this.addLog(`You fainted and lost ${e.xpLost} XP.`)),
      ev.on('playerRespawned', () => this.addLog('You wake up at the save point.')),
      ev.on('notice', (e) => this.addLog(e.text)),
      ev.on('skillsChanged', () => this.buildSkillButtons()),
      ev.on('jobChanged', (e) => {
        this.addLog(`You are now a ${e.jobId === 'swordsman' ? 'Swordsman' : e.jobId}! Open Skills to learn new skills.`);
        this.buildSkillButtons();
      }),
      ev.on('talk', (e) => {
        this.inventory.close();
        this.skillWindow.close();
        this.statWindow.setVisible(false);
        this.dialogue.open(e.npc);
      }),
      ev.on('mapChanged', () => {
        this.dialogue.close();
        this.shop.close();
        this.showMapName();
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.forEach((off) => off()));
  }

  private addLog(line: string): void {
    this.log.push(line);
    if (this.log.length > LOG_LINES) this.log.shift();
    this.logText?.setText(this.log.join('\n'));
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
