import Phaser from 'phaser';
import { loadContent } from '../data/content';
import { World } from '../core/world';
import { COLORS } from '../render/palette';

/**
 * Validates content, builds the simulation and draws placeholder textures.
 * Real sprite atlases replace the generated textures once art exists.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const content = loadContent();
    const map = content.maps.get('meadow-1')!;
    const world = new World(content, map);
    this.registry.set('world', world);
    this.registry.set('debug', false);

    this.makeTextures();
    this.scene.start('World');
    this.scene.launch('UI');
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

    // Chibi novice facing right, feet at (20, 54).
    g.fillStyle(0x3b3f52).fillRoundedRect(12, 44, 7, 10, 2).fillRoundedRect(21, 44, 7, 10, 2);
    g.fillStyle(COLORS.playerBody).fillRoundedRect(10, 28, 20, 19, 6);
    g.fillStyle(0xffffff, 0.2).fillRoundedRect(12, 30, 6, 12, 3);
    g.fillStyle(0x8a5a3b).fillRect(10, 40, 20, 3);
    g.fillStyle(COLORS.playerSkin).fillCircle(20, 18, 14);
    g.fillStyle(COLORS.playerHair).fillEllipse(18, 9, 30, 15).fillCircle(8, 16, 6);
    g.fillStyle(0x2a1e2e).fillEllipse(23, 20, 3.5, 6).fillEllipse(30, 20, 3.5, 6);
    g.fillStyle(0xffffff).fillCircle(23.6, 18.5, 1).fillCircle(30.6, 18.5, 1);
    g.fillStyle(0xff9aa8, 0.6).fillCircle(21, 25, 2.2).fillCircle(32, 25, 2);
    g.generateTexture('novice', 40, 56).clear();

    // Loot bag, tinted per item type.
    g.fillStyle(COLORS.shadow, 0.25).fillEllipse(10, 18, 16, 5);
    g.fillStyle(0xffffff).fillCircle(10, 11, 7).fillRect(7, 2, 6, 5);
    g.lineStyle(1.5, 0x333333, 0.6).strokeCircle(10, 11, 7);
    g.fillStyle(0xffffff, 0.6).fillCircle(7, 9, 2);
    g.generateTexture('drop', 20, 20).clear();

    // Tile outline for hover and click markers.
    g.lineStyle(2, 0xffffff, 1).strokePoints(
      [new Phaser.Math.Vector2(32, 1), new Phaser.Math.Vector2(63, 16), new Phaser.Math.Vector2(32, 31), new Phaser.Math.Vector2(1, 16)],
      true,
    );
    g.generateTexture('tile-outline', 64, 32).clear();

    g.destroy();
  }
}
