import type Phaser from 'phaser';
import { mapLevelRange, nextGoal } from '../core/goals';
import { visitedFlag, type World } from '../core/world';
import { COLORS, TITLE_FONT, TEXT, TONE } from '../render/palette';
import { Panel } from './widgets';

/**
 * Where each map sits on the world map, as fractions of the drawing area.
 * A schematic, not geography: it only has to show what connects to what.
 */
const ROWS = 8;
/** Column (0, 0.5, 1) and row (0 = top) of a box. */
const cell = (x: number, row: number) => ({ x, y: row / (ROWS - 1) });
export const WORLD_LAYOUT: Record<string, { x: number; y: number }> = {
  town: cell(0, 0),
  'meadow-1': cell(0.5, 0),
  'meadow-2': cell(0.5, 1),
  'meadow-3': cell(0.5, 2),
  whisperwood: cell(0.5, 3),
  'caves-1': cell(0.5, 4),
  'caves-2': cell(0.5, 5),
  saltmere: cell(1, 2),
  'saltmere-coast': cell(1, 3),
  'clockwork-citadel': cell(0, 1),
  'iron-wastes': cell(0, 2),
  sunspire: cell(0, 3),
  'sunscorch-dunes': cell(0, 4),
  'sunken-ruins': cell(0, 5),
  // The Shattered Reach, by ship from Sunspire.
  lastlight: cell(1, 4),
  'glassfall-plains': cell(1, 5),
  'starfall-crater': cell(1, 6),
  'the-rift': cell(1, 7),
};

/** Ship routes (drawn dashed): they come from NPC dialogue, not portals. */
const SEA_ROUTES: Array<[string, string]> = [
  ['saltmere', 'sunspire'],
  ['sunspire', 'lastlight'],
];

/** Three columns of boxes; they shrink to fit narrow phones. */
const MAX_BOX_W = 116;
const BOX_GAP = 10;
const BOX_H = 44;

/** Every area you can reach: names and monster levels for places you've been, "???" for the rest. */
export class WorldMapWindow {
  readonly panel: Panel;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.panel = new Panel(
      scene,
      'World map',
      (sw, sh) => {
        const w = Math.min(420, sw - 24);
        const h = Math.min(640, sh - 40);
        return { w, h, x: Math.round((sw - w) / 2), y: Math.max(12, Math.round((sh - h) / 2)) };
      },
      () => this.close(),
      true,
    );
  }

  open(): void {
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
    const w = this.world;
    const p = this.panel;
    p.layout();
    p.clear();
    const goal = this.scene.add.text(12, 42, `★ ${nextGoal(w)}`, { ...TEXT, fontSize: '12px', fontStyle: 'bold', color: TONE.accent, wordWrap: { width: p.w - 24 } });
    p.add(goal);
    const top = goal.y + goal.height + 10;
    const BOX_W = Math.min(MAX_BOX_W, Math.floor((p.w - 24 - 2 * BOX_GAP) / 3));
    const area = { x: 12 + BOX_W / 2, y: top + BOX_H / 2, w: p.w - 24 - BOX_W, h: p.h - top - 16 - BOX_H };
    const at = (id: string) => {
      const l = WORLD_LAYOUT[id]!;
      return { x: area.x + l.x * area.w, y: area.y + l.y * area.h };
    };
    const been = (id: string) => w.flags.has(visitedFlag(id));
    // Places next to somewhere you've been show their name (but not their monsters) so you know where a road leads.
    const known = new Set<string>();
    for (const map of w.content.maps.values()) {
      if (!been(map.id)) continue;
      for (const portal of map.portals) known.add(portal.to.map);
    }
    for (const [a, b] of SEA_ROUTES) {
      if (been(a)) known.add(b);
      if (been(b)) known.add(a);
    }

    // Roads between maps (each pair once), and sea routes dashed.
    const g = this.scene.add.graphics();
    const seen = new Set<string>();
    for (const map of w.content.maps.values()) {
      for (const portal of map.portals) {
        const key = [map.id, portal.to.map].sort().join('|');
        if (seen.has(key) || !WORLD_LAYOUT[map.id] || !WORLD_LAYOUT[portal.to.map]) continue;
        seen.add(key);
        const a = at(map.id);
        const b = at(portal.to.map);
        g.lineStyle(4, COLORS.ink, been(map.id) && been(portal.to.map) ? 1 : 0.25).lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    for (const [from, to] of SEA_ROUTES) {
      const a = at(from);
      const b = at(to);
      const steps = 14;
      g.lineStyle(3, 0x2f8fd6, been(from) || been(to) ? 1 : 0.3);
      for (let i = 0; i < steps; i += 2) {
        g.lineBetween(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, a.x + ((b.x - a.x) * (i + 1)) / steps, a.y + ((b.y - a.y) * (i + 1)) / steps);
      }
    }
    p.add(g);

    for (const map of w.content.maps.values()) {
      if (!WORLD_LAYOUT[map.id]) continue;
      const c = at(map.id);
      const visited = been(map.id);
      const here = w.map.id === map.id;
      const fill = here ? 0xffd84a : !visited ? 0xd8d4cc : map.kind === 'town' ? 0xffffff : map.kind === 'dungeon' ? 0xc9c3d6 : 0xd9f2c4;
      p.add(this.scene.add.rectangle(c.x + 3, c.y + 3, BOX_W, BOX_H, COLORS.ink));
      p.add(this.scene.add.rectangle(c.x, c.y, BOX_W, BOX_H, fill).setStrokeStyle(here ? 3.5 : 2.5, COLORS.ink));
      const range = mapLevelRange(w, map);
      const name = visited || known.has(map.id) ? map.name : '???';
      const sub = !visited ? '' : map.kind === 'town' ? 'Town' : range ? `Lv ${range[0]}–${range[1]}` : '';
      const label = this.scene.add
        .text(c.x, c.y - (sub ? 7 : 0), name, { ...TEXT, fontSize: '11px', fontStyle: 'bold', align: 'center', wordWrap: { width: BOX_W - 8 }, lineSpacing: -2 })
        .setOrigin(0.5);
      // Long names wrap to two lines; then the level line moves down a little.
      p.add(label);
      if (sub) p.add(this.scene.add.text(c.x, c.y + (label.height > 18 ? 14 : 9), sub, { ...TEXT, fontSize: '10px', color: TONE.muted }).setOrigin(0.5));
      if (label.height > 18) label.setY(c.y - 6);
      if (here) {
        p.add(
          this.scene.add
            .text(c.x, c.y - BOX_H / 2 - 2, 'YOU', { fontFamily: TITLE_FONT, fontSize: '9px', color: '#ffffff', backgroundColor: '#16131c', padding: { x: 5, y: 1 } })
            .setOrigin(0.5, 1),
        );
      }
    }
  }
}
