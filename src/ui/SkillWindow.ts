import type Phaser from 'phaser';
import { jobOf } from '../core/jobs';
import { learnBlocker, skillLevel, skillsFor, type SkillDef } from '../core/skills';
import type { World } from '../core/world';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 70;

/** The skill tree for the current job and every earlier one. */
export class SkillWindow {
  readonly panel: Panel;
  private page = 0;
  private message = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Skills', centered(380, 560), () => this.close());
    const refresh = () => this.panel.visible && this.refresh();
    world.events.on('skillsChanged', refresh);
    world.events.on('jobChanged', refresh);
    world.events.on('levelUp', refresh);
  }

  open(): void {
    this.message = '';
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.panel.setVisible(false);
  }

  toggle(): void {
    if (this.panel.visible) this.close();
    else this.open();
  }

  refresh(): void {
    const p = this.world.player;
    const panel = this.panel;
    panel.layout();
    panel.clear();
    panel.setTitle(`Skills · ${jobOf(p).name}`);
    panel.add(this.scene.add.text(12, 40, `Skill points: ${p.skillPoints}`, { ...TEXT, fontSize: '13px', color: TONE.gold }));
    const skills = skillsFor(p.jobId);
    this.page = pagedList(
      panel,
      skills,
      this.page,
      66,
      34,
      ROW_H,
      (s, y, w) => this.row(s, y, w),
      (pg) => {
        this.page = pg;
        this.refresh();
      },
    );
    panel.add(this.scene.add.text(12, panel.h - 28, this.message, { ...TEXT, fontSize: '12px', color: TONE.bad, wordWrap: { width: panel.w - 24 } }));
  }

  private row(s: SkillDef, y: number, w: number): void {
    const p = this.world.player;
    const lv = skillLevel(p, s.id);
    const kind = s.kind === 'passive' ? 'passive' : `active · ${s.spCost(Math.max(1, lv))} SP`;
    this.panel.add(this.scene.add.text(12, y + 2, `${s.name}  ${lv}/${s.maxLevel}`, { ...TEXT, fontSize: '13px', fontStyle: 'bold' }));
    this.panel.add(this.scene.add.text(12, y + 20, kind, { ...TEXT, fontSize: '11px', color: TONE.accent }));
    const shown = lv === 0 ? 1 : lv;
    const blocker = learnBlocker(p, s.id);
    const req = blocker && /^Needs/.test(blocker) ? `  (${blocker})` : '';
    this.panel.add(
      this.scene.add.text(12, y + 36, `${lv === 0 ? 'Lv 1: ' : ''}${s.describe(shown)}${req}`, {
        ...TEXT,
        fontSize: '11px',
        color: TONE.muted,
        wordWrap: { width: w - 80 },
      }),
    );
    this.panel.add(
      makeButton(this.scene, w - 56, y + 6, 44, 40, '+', () => {
        this.message = this.world.learnSkill(s.id) ?? '';
        this.refresh();
      }).setEnabled(!blocker).root,
    );
  }
}
