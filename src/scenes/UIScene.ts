import Phaser from 'phaser';
import * as F from '../core/combat/formulas';
import { STAT_NAMES, type StatName } from '../core/combat/formulas';
import type { SimClock } from '../core/sim';
import { derivedStats } from '../core/progression';
import type { World } from '../core/world';
import { COLORS, TEXT } from '../render/palette';

const HOTBAR: Array<{ key: string; itemId: string }> = [
  { key: 'F1', itemId: 'red_tonic' },
  { key: 'F2', itemId: 'sweet_apple' },
];
const LOG_LINES = 7;

/** HUD, stat window, message log and debug overlay, drawn above the world. */
export class UIScene extends Phaser.Scene {
  private world!: World;
  private bars!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private hotbarText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private log: string[] = [];
  private statWindow!: Phaser.GameObjects.Container;
  private statLines = new Map<StatName, Phaser.GameObjects.Text>();
  private statSummary!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private deathText!: Phaser.GameObjects.Text;
  private frameMs = 16;

  constructor() {
    super('UI');
  }

  create(): void {
    this.world = this.registry.get('world') as World;
    this.log = [];
    this.statLines.clear();

    this.add.graphics().fillStyle(COLORS.ui, 0.82).fillRoundedRect(8, 8, 236, 118, 8).lineStyle(1, COLORS.uiBorder, 0.6).strokeRoundedRect(8, 8, 236, 118, 8);
    this.bars = this.add.graphics();
    this.statusText = this.add.text(18, 14, '', { ...TEXT, fontSize: '12px', lineSpacing: 6 });
    this.hotbarText = this.add.text(0, 0, '', { ...TEXT, fontSize: '12px' }).setOrigin(0.5, 1);
    this.logText = this.add.text(12, 0, '', { ...TEXT, fontSize: '12px', lineSpacing: 2 }).setOrigin(0, 1);
    this.debugText = this.add
      .text(0, 12, '', { ...TEXT, fontFamily: 'Menlo, Consolas, monospace', fontSize: '11px', backgroundColor: '#000000aa', padding: { x: 8, y: 6 } })
      .setOrigin(1, 0)
      .setVisible(false);
    this.deathText = this.add
      .text(0, 0, '', { ...TEXT, fontSize: '22px', align: 'center', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setVisible(false);
    this.buildStatWindow();
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));

    this.bindKeys();
    this.bindEvents();
    this.addLog('Welcome to the Southern Meadow. Click a Jellop to attack it.');
  }

  override update(_time: number, delta: number): void {
    this.frameMs = this.frameMs * 0.9 + delta * 0.1;
    this.drawStatus();
    this.drawHotbar();
    this.drawStatWindow();
    this.drawDebug();
    const p = this.world.player;
    this.deathText.setVisible(p.dead).setText(`You have fainted.\nReturning to the save point in ${Math.ceil(p.respawnIn / 1000)}…`);
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.hotbarText.setPosition(width / 2, height - 10);
    this.logText.setPosition(12, height - 32);
    this.debugText.setPosition(width - 10, 10);
    this.deathText.setPosition(width / 2, height / 2 - 60);
    this.statWindow.setPosition(8, 134);
  }

  // ---- Status window -----------------------------------------------------

  private drawStatus(): void {
    const p = this.world.player;
    const d = derivedStats(p);
    const g = this.bars.clear();
    const bar = (y: number, frac: number, color: number) => {
      g.fillStyle(COLORS.barBack).fillRoundedRect(104, y, 130, 9, 3);
      const w = Math.max(0, Math.min(1, frac)) * 130;
      if (w >= 1) g.fillStyle(color).fillRoundedRect(104, y, w, 9, Math.min(3, w / 2));
    };
    const baseNeed = F.baseXpToNext(p.baseLevel);
    const jobNeed = F.jobXpToNext(p.jobLevel);
    bar(38, p.hp / d.maxHp, p.hp / d.maxHp > 0.25 ? COLORS.hpBar : COLORS.hpBarLow);
    bar(56, p.sp / d.maxSp, COLORS.spBar);
    bar(74, p.baseXp / baseNeed, COLORS.xpBar);
    bar(92, p.jobLevel >= p.maxJobLevel ? 1 : p.jobXp / jobNeed, COLORS.jobXpBar);

    const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
    this.statusText.setText(
      [
        `${p.name}  ·  ${p.jobName}${p.sitting ? '  (sitting)' : ''}`,
        `HP ${p.hp}/${d.maxHp}`,
        `SP ${p.sp}/${d.maxSp}`,
        `Base Lv ${p.baseLevel}  ${pct(p.baseXp, baseNeed)}`,
        `Job Lv ${p.jobLevel}  ${p.jobLevel >= p.maxJobLevel ? 'MAX' : pct(p.jobXp, jobNeed)}`,
      ].join('\n'),
    );
  }

  private drawHotbar(): void {
    const inv = this.world.player.inventory;
    const slots = HOTBAR.map(({ key, itemId }) => {
      const item = this.world.content.items.get(itemId)!;
      return `[${key}] ${item.name} ×${inv.get(itemId) ?? 0}`;
    });
    this.hotbarText.setText([...slots, '[Z] Sit', '[A] Stats', '[`] Debug'].join('    '));
  }

  // ---- Stat window -------------------------------------------------------

  private buildStatWindow(): void {
    const bg = this.add.graphics().fillStyle(COLORS.ui, 0.9).fillRoundedRect(0, 0, 236, 238, 8).lineStyle(1, COLORS.uiBorder, 0.6).strokeRoundedRect(0, 0, 236, 238, 8);
    const title = this.add.text(10, 8, 'Stats', { ...TEXT, fontStyle: 'bold' });
    const children: Phaser.GameObjects.GameObject[] = [bg, title];
    STAT_NAMES.forEach((stat, i) => {
      const y = 32 + i * 20;
      const line = this.add.text(10, y, '', { ...TEXT, fontSize: '12px' });
      const plus = this.add
        .text(200, y - 1, '+', { ...TEXT, fontSize: '14px', fontStyle: 'bold', backgroundColor: '#3a4a63', padding: { x: 5, y: 0 } })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.world.raiseStat(stat);
        });
      this.statLines.set(stat, line);
      children.push(line, plus);
    });
    this.statSummary = this.add.text(10, 156, '', { ...TEXT, fontSize: '12px', lineSpacing: 2 });
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
    kb.addCapture('F1,F2,F3');
    for (const { key, itemId } of HOTBAR) kb.on(`keydown-${key}`, () => this.world.useItem(itemId));
    kb.on('keydown-Z', () => this.world.toggleSit());
    kb.on('keydown-INSERT', () => this.world.toggleSit());
    kb.on('keydown-A', () => this.statWindow.setVisible(!this.statWindow.visible));
    const toggleDebug = () => {
      const on = !this.registry.get('debug');
      this.registry.set('debug', on);
      this.debugText.setVisible(on);
    };
    kb.on('keydown-BACKTICK', toggleDebug);
    kb.on('keydown-F3', toggleDebug);
  }

  // ---- Message log -------------------------------------------------------

  private bindEvents(): void {
    const ev = this.world.events;
    const offs = [
      ev.on('itemPicked', (e) => this.addLog(`Picked up ${e.item.name}.`)),
      ev.on('itemUsed', (e) => this.addLog(`Used ${e.item.name}.`)),
      ev.on('xpGained', (e) => this.addLog(`Gained ${e.base} base XP and ${e.job} job XP.`)),
      ev.on('levelUp', (e) =>
        this.addLog(e.kind === 'base' ? `Base level ${e.level}! Press A to spend stat points.` : `Job level ${e.level}!`),
      ),
      ev.on('playerDied', (e) => this.addLog(`You fainted and lost ${e.xpLost} XP.`)),
      ev.on('playerRespawned', () => this.addLog('You wake up at the save point.')),
      ev.on('notice', (e) => this.addLog(e.text)),
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
