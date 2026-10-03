import type Phaser from 'phaser';
import { refineChance, refineCost, REFINE_ORE } from '../core/combat/formulas';
import { MAX_REFINE, pieceName, type GearPiece } from '../core/equipment';
import type { World } from '../core/world';
import { TEXT, TONE } from '../render/palette';
import { centered, makeButton, pagedList, Panel } from './widgets';

const ROW_H = 54;

/** Greta's forge: pick a piece, see the odds, refine. Risky attempts need a second tap. */
export class RefineWindow {
  readonly panel: Panel;
  private page = 0;
  private message = '';
  private messageColor = TONE.good;
  /** Piece awaiting confirmation of a risky attempt. */
  private confirming: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(scene, 'Refine', centered(380, 560, 20), () => this.close(), true);
  }

  open(): void {
    this.message = '';
    this.confirming = null;
    this.panel.setVisible(true);
    this.refresh();
  }

  close(): void {
    this.panel.setVisible(false);
  }

  refresh(): void {
    const w = this.world;
    const p = this.panel;
    p.layout();
    p.clear();
    const ore = w.content.items.get(REFINE_ORE)!;
    p.add(
      this.scene.add.text(12, 40, `Gold ${w.player.gold}    ${ore.name} ×${w.itemCount(REFINE_ORE)}`, { ...TEXT, fontSize: '12px', color: TONE.gold }),
    );
    p.add(
      this.scene.add.text(12, 58, 'Up to +4 is safe. Above that a failed attempt destroys the piece.', {
        ...TEXT,
        fontSize: '11px',
        color: TONE.muted,
        wordWrap: { width: p.w - 24 },
      }),
    );
    const pieces = [...w.wornPieces().map(([, g]) => g), ...w.player.gear];
    this.page = pagedList(p, pieces, this.page, 84, 40, ROW_H, (g, y, pw) => this.row(g, y, pw), (pg) => {
      this.page = pg;
      this.refresh();
    });
    p.add(this.scene.add.text(12, p.h - 30, this.message, { ...TEXT, fontSize: '12px', color: this.messageColor, wordWrap: { width: p.w - 24 } }));
  }

  private row(piece: GearPiece, y: number, pw: number): void {
    const w = this.world;
    const worn = w.wornPieces().some(([, g]) => g === piece);
    const next = piece.refine + 1;
    this.panel.add(this.scene.add.text(12, y + 2, `${pieceName(piece)}${worn ? ' (worn)' : ''}`, { ...TEXT, fontSize: '13px' }));
    if (next > MAX_REFINE) {
      this.panel.add(this.scene.add.text(12, y + 20, 'Fully refined.', { ...TEXT, fontSize: '11px', color: TONE.good }));
      return;
    }
    const chance = refineChance(next);
    const risky = chance < 1;
    this.panel.add(
      this.scene.add.text(12, y + 20, `→ +${next}: ${Math.round(chance * 100)}% · ${refineCost(next)} gold + 1 ore${risky ? ' · may break' : ''}`, {
        ...TEXT,
        fontSize: '11px',
        color: risky ? TONE.warn : TONE.muted,
      }),
    );
    const confirming = this.confirming === piece.uid;
    const blocker = w.refineBlocker(piece.uid);
    this.panel.add(
      makeButton(this.scene, pw - 92, y + 4, 80, 38, confirming ? 'Sure?' : 'Refine', () => {
        if (risky && !confirming) {
          this.confirming = piece.uid;
          this.message = `Tap Sure? to risk ${pieceName(piece)} (${Math.round(chance * 100)}% to succeed).`;
          this.messageColor = TONE.warn;
          this.refresh();
          return;
        }
        this.confirming = null;
        const name = pieceName(piece);
        const result = w.refine(piece.uid);
        if ('error' in result) {
          this.message = result.error;
          this.messageColor = TONE.bad;
        } else if (result.success) {
          this.message = `Success! ${pieceName(piece)}.`;
          this.messageColor = TONE.good;
        } else {
          this.message = `${name} shattered.`;
          this.messageColor = TONE.bad;
        }
        this.refresh();
      }, confirming ? 0xff7a5a : 0xffffff).setEnabled(!blocker).root,
    );
  }
}
