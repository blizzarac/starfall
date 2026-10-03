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

    // Beetle: domed shell split down the middle, little legs. Feet at (24, 36).
    g.fillStyle(0x2a1e2e).fillRect(8, 30, 4, 7).fillRect(18, 32, 4, 6).fillRect(28, 32, 4, 6).fillRect(37, 30, 4, 7);
    g.fillStyle(0xffffff).fillEllipse(24, 23, 40, 26);
    g.fillStyle(0xdddddd).fillEllipse(24, 12, 22, 10);
    g.lineStyle(2, 0x2a1e2e, 0.7).lineBetween(24, 12, 24, 35);
    g.fillStyle(0xffffff, 0.8).fillEllipse(15, 18, 8, 5);
    g.fillStyle(0x2a1e2e).fillCircle(18, 11, 2.2).fillCircle(30, 11, 2.2);
    g.lineStyle(2, 0x2a1e2e).lineBetween(20, 6, 15, 1).lineBetween(28, 6, 33, 1);
    g.generateTexture('beetle', 48, 40).clear();

    // Sprout: round body with a leaf on top. Feet at (24, 40).
    g.fillStyle(0xffffff).fillEllipse(24, 30, 36, 22);
    g.fillStyle(0xffffff).fillCircle(24, 26, 15);
    g.fillStyle(0x2f8a3a).fillEllipse(17, 8, 14, 7).fillEllipse(31, 8, 14, 7).fillRect(23, 8, 2, 8);
    g.fillStyle(0x2a1e2e).fillEllipse(19, 27, 3.5, 6).fillEllipse(29, 27, 3.5, 6);
    g.fillStyle(0xff9aa8, 0.6).fillCircle(15, 32, 2.5).fillCircle(33, 32, 2.5);
    g.generateTexture('sprout', 48, 44).clear();

    // Boar: bulky body, snout and tusks, facing right. Feet at (28, 40).
    g.fillStyle(0x2a1e2e).fillRect(12, 32, 6, 9).fillRect(22, 33, 6, 8).fillRect(34, 33, 6, 8).fillRect(44, 32, 6, 9);
    g.fillStyle(0xffffff).fillEllipse(28, 22, 46, 26);
    g.fillStyle(0xdddddd).fillEllipse(24, 11, 32, 10);
    g.fillStyle(0xffffff).fillEllipse(48, 25, 16, 14);
    g.fillStyle(0xf1c7b8).fillEllipse(54, 27, 7, 8);
    g.fillStyle(0xfffbe8).fillTriangle(48, 30, 52, 30, 47, 22);
    g.fillStyle(0x2a1e2e).fillCircle(46, 20, 2.2).fillCircle(53.5, 26, 1).fillCircle(55.5, 28, 1);
    g.fillStyle(0x2a1e2e).fillTriangle(38, 10, 44, 13, 40, 4);
    g.generateTexture('boar', 60, 44).clear();

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

    // Cave wall block: same cube as a house, in dark stone with crystal glints.
    g.fillStyle(0x4a4552).fillPoints([V(0, 56), V(32, 72), V(32, 34), V(0, 18)], true);
    g.fillStyle(0x3d3945).fillPoints([V(32, 72), V(64, 56), V(64, 18), V(32, 34)], true);
    g.fillStyle(0x5e5868).fillPoints([V(0, 18), V(32, 2), V(64, 18), V(32, 34)], true);
    g.fillStyle(0x9fd8ff, 0.7).fillTriangle(14, 40, 18, 30, 21, 42).fillTriangle(44, 48, 47, 38, 51, 47);
    g.generateTexture('cavewall', 64, 72).clear();

    // Wolf facing right. Feet at (28, 40).
    g.fillStyle(0x2a1e2e).fillRect(14, 30, 5, 10).fillRect(22, 31, 5, 9).fillRect(34, 31, 5, 9).fillRect(41, 30, 5, 10);
    g.fillStyle(0xffffff).fillEllipse(28, 24, 40, 18);
    g.fillStyle(0xdddddd).fillTriangle(6, 18, 12, 26, 2, 30);
    g.fillStyle(0xffffff).fillEllipse(46, 18, 18, 15).fillEllipse(55, 21, 10, 7);
    g.fillStyle(0xffffff).fillTriangle(40, 12, 45, 2, 48, 12).fillTriangle(47, 12, 52, 3, 54, 13);
    g.fillStyle(0x2a1e2e).fillCircle(49, 16, 1.8).fillCircle(59, 21, 1.6);
    g.generateTexture('wolf', 60, 44).clear();

    // Mushroom: spotted cap on a stubby stalk. Feet at (24, 42).
    g.fillStyle(0xfff2e0).fillRoundedRect(16, 22, 16, 20, 6);
    g.fillStyle(0xffffff).fillEllipse(24, 18, 44, 26);
    g.fillStyle(0xf5f5f5, 1).fillCircle(14, 14, 3.5).fillCircle(28, 9, 3).fillCircle(34, 18, 3.5);
    g.fillStyle(0x2a1e2e).fillEllipse(20, 31, 3, 5).fillEllipse(28, 31, 3, 5);
    g.generateTexture('mushroom', 48, 44).clear();

    // Bat: round body, two wings, hovering. Feet (shadow) at (28, 40).
    g.fillStyle(0xdddddd).fillTriangle(4, 10, 22, 16, 18, 28).fillTriangle(52, 10, 34, 16, 38, 28);
    g.fillStyle(0xffffff).fillCircle(28, 18, 10);
    g.fillStyle(0xffffff).fillTriangle(21, 10, 24, 2, 27, 10).fillTriangle(29, 10, 32, 2, 35, 10);
    g.fillStyle(0xff4a4a).fillCircle(24, 17, 1.8).fillCircle(32, 17, 1.8);
    g.generateTexture('bat', 56, 44).clear();

    // Golem: blocky stone body with crystal shoulders. Feet at (28, 52).
    g.fillStyle(0x2a1e2e, 0.9).fillRect(15, 42, 9, 10).fillRect(32, 42, 9, 10);
    g.fillStyle(0xffffff).fillRoundedRect(10, 16, 36, 30, 6);
    g.fillStyle(0xdddddd).fillRoundedRect(17, 4, 22, 16, 5);
    g.fillStyle(0xdddddd).fillRoundedRect(2, 20, 10, 20, 4).fillRoundedRect(44, 20, 10, 20, 4);
    g.fillStyle(0xc9f0ff).fillTriangle(6, 20, 10, 8, 14, 20).fillTriangle(42, 20, 46, 8, 50, 20);
    g.fillStyle(0x7fe3ff).fillCircle(23, 11, 2.2).fillCircle(33, 11, 2.2);
    g.generateTexture('golem', 56, 56).clear();

    // Notice board on two posts, with pinned papers. Feet at (24, 54).
    g.fillStyle(COLORS.shadow, 0.2).fillEllipse(24, 54, 40, 10);
    g.fillStyle(0x6b4a2e).fillRect(8, 22, 4, 32).fillRect(36, 22, 4, 32);
    g.fillStyle(0x9a6b42).fillRoundedRect(2, 6, 44, 28, 3);
    g.fillStyle(0xf4ead2).fillRect(7, 10, 11, 13).fillRect(21, 12, 10, 12).fillRect(34, 9, 8, 10);
    g.fillStyle(0xc9452f).fillCircle(12, 11, 1.5).fillCircle(26, 13, 1.5).fillCircle(38, 10, 1.5);
    g.generateTexture('board', 48, 58).clear();

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
