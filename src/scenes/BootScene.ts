import Phaser from 'phaser';
import { loadContent } from '../data/content';
import { SaveDb } from '../save/db';
import { ensureChibi } from '../render/chibi';
import { COLORS } from '../render/palette';

/**
 * Validates content, opens the save database and draws placeholder textures.
 * Real sprite atlases replace the generated textures once art exists.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.registry.set('content', loadContent());
    this.registry.set('db', new SaveDb());
    this.registry.set('debug', false);

    this.makeTextures();
    ensureChibi(this, 'job-novice', COLORS.playerBody, COLORS.playerHair);
    this.scene.start('Title');
  }

  private makeTextures(): void {
    const g = this.make.graphics({}, false);

    // Soft ground shadow under everything that stands on the map.
    g.fillStyle(COLORS.shadow, 0.22).fillEllipse(20, 8, 40, 16);
    g.generateTexture('shadow', 40, 16).clear();

    // Tree: trunk and three leaf clumps, feet at (32, 88).
    g.fillStyle(COLORS.shadow, 0.2).fillEllipse(32, 88, 46, 16);
    g.fillStyle(COLORS.treeTrunk).fillRoundedRect(27, 54, 10, 34, 3);
    const [l1, l2, l3] = COLORS.treeLeaves;
    g.fillStyle(l3).fillCircle(32, 40, 26);
    g.fillStyle(l1).fillCircle(22, 34, 17).fillCircle(42, 36, 16);
    g.fillStyle(l2).fillCircle(32, 22, 16);
    g.fillStyle(0xffffff, 0.18).fillCircle(26, 18, 7);
    g.generateTexture('tree', 64, 96).clear();

    // Rock, feet at (24, 28).
    g.fillStyle(COLORS.shadow, 0.2).fillEllipse(24, 28, 42, 12);
    g.fillStyle(COLORS.rockShade).fillEllipse(24, 20, 40, 22);
    g.fillStyle(COLORS.rock).fillEllipse(22, 16, 34, 18);
    g.fillStyle(0xffffff, 0.25).fillEllipse(16, 12, 10, 5);
    g.generateTexture('rock', 48, 32).clear();

    // Blob monster, drawn light so a tint gives it its color. Feet at (24, 38).
    g.fillStyle(0xffffff).fillEllipse(24, 26, 44, 26);
    g.fillStyle(0xffffff).fillCircle(24, 22, 17);
    g.fillStyle(0xffffff, 0.9).fillEllipse(17, 15, 10, 6);
    g.fillStyle(0x2a1e2e).fillEllipse(18, 25, 4, 7).fillEllipse(30, 25, 4, 7);
    g.fillStyle(0xffffff).fillCircle(19, 23, 1.2).fillCircle(31, 23, 1.2);
    g.lineStyle(1.5, 0x2a1e2e).beginPath().arc(24, 30, 3, 0.2, Math.PI - 0.2).strokePath();
    g.generateTexture('blob', 48, 40).clear();

    // Loot bag, tinted per item type.
    g.fillStyle(COLORS.shadow, 0.25).fillEllipse(10, 18, 16, 5);
    g.fillStyle(0xffffff).fillCircle(10, 11, 7).fillRect(7, 2, 6, 5);
    g.lineStyle(1.5, 0x333333, 0.6).strokeCircle(10, 11, 7);
    g.fillStyle(0xffffff, 0.6).fillCircle(7, 9, 2);
    g.generateTexture('drop', 20, 20).clear();

    // House block: an isometric cube whose neighbors merge into buildings. Ground center at (32, 56).
    const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
    for (const windows of [false, true]) {
      g.fillStyle(COLORS.houseWall).fillPoints([V(0, 56), V(32, 72), V(32, 34), V(0, 18)], true);
      g.fillStyle(COLORS.houseShade).fillPoints([V(32, 72), V(64, 56), V(64, 18), V(32, 34)], true);
      g.fillStyle(COLORS.houseRoof).fillPoints([V(0, 18), V(32, 2), V(64, 18), V(32, 34)], true);
      g.fillStyle(COLORS.houseRoofShade).fillPoints([V(32, 34), V(64, 18), V(64, 22), V(32, 38)], true);
      g.fillStyle(COLORS.houseRoofShade).fillPoints([V(0, 18), V(32, 34), V(32, 38), V(0, 22)], true);
      if (windows) {
        g.fillStyle(0x5a7bb8).fillPoints([V(10, 38), V(20, 43), V(20, 53), V(10, 48)], true);
        g.fillStyle(0x4a6aa3).fillPoints([V(44, 43), V(54, 38), V(54, 48), V(44, 53)], true);
      }
      g.generateTexture(windows ? 'house-window' : 'house', 64, 72).clear();
    }

    // Portal swirl lying on the ground.
    g.fillStyle(0x6fd6ff, 0.35).fillEllipse(32, 16, 60, 28);
    g.lineStyle(3, 0xbff0ff, 0.9).strokeEllipse(32, 16, 46, 20);
    g.lineStyle(2, 0xffffff, 0.8).strokeEllipse(32, 16, 26, 11);
    g.generateTexture('portal', 64, 32).clear();

    // Tile outline for hover and click markers.
    g.lineStyle(2, 0xffffff, 1).strokePoints(
      [new Phaser.Math.Vector2(32, 1), new Phaser.Math.Vector2(63, 16), new Phaser.Math.Vector2(32, 31), new Phaser.Math.Vector2(1, 16)],
      true,
    );
    g.generateTexture('tile-outline', 64, 32).clear();

    g.destroy();
  }
}
