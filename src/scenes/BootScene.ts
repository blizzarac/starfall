import Phaser from 'phaser';
import { loadContent } from '../data/content';
import { SaveDb } from '../save/db';
import { audio } from '../audio/engine';
import { loadAudioSettings } from '../audio/settings';
import { loadQuality } from '../render/quality';
import { inkify, makeBurstTexture } from '../render/ink';
import { COLORS } from '../render/palette';
import { ART_RES, setArtRes } from '../render/art';

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
    const db = new SaveDb();
    this.registry.set('db', db);
    this.registry.set('debug', false);
    audio.install();
    void loadAudioSettings(db);
    void loadQuality(db, this.game);

    this.makeTextures();
    this.scene.start('Title');
  }

  private makeTextures(): void {
    // Everything is drawn ART_RES times bigger than its size in the world, so it stays sharp.
    const g = this.make.graphics({}, false).setScale(ART_RES);
    const gen = (key: string, w: number, h: number) => {
      g.generateTexture(key, w * ART_RES, h * ART_RES);
      setArtRes(key, ART_RES);
      return g;
    };
    const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

    // Flat, hard-edged manga shadow under everything that stands on the map.
    g.fillStyle(COLORS.shadow, 0.3).fillEllipse(20, 8, 40, 14);
    gen('shadow', 40, 16).clear();

    // Tree: trunk and puffy leaf clumps with ink curls, feet at (32, 88).
    g.fillStyle(COLORS.treeTrunk).fillPoints([V(27, 88), V(29, 54), V(35, 54), V(37, 88)], true);
    g.fillStyle(0x6e4226).fillRect(33, 56, 3, 32);
    const [l1, l2, l3] = COLORS.treeLeaves;
    g.fillStyle(l3).fillCircle(32, 42, 24).fillCircle(14, 40, 12).fillCircle(50, 40, 12);
    g.fillStyle(l1).fillCircle(20, 30, 16).fillCircle(44, 32, 15);
    g.fillStyle(l2).fillCircle(32, 18, 15).fillCircle(22, 22, 9);
    g.fillStyle(0xffffff, 0.35).fillEllipse(26, 12, 10, 4);
    g.lineStyle(1.6, COLORS.ink, 0.85);
    for (const [cx, cy] of [[24, 34], [40, 38], [32, 22], [16, 44], [46, 48]] as const) {
      g.beginPath().arc(cx, cy, 5, Math.PI * 0.15, Math.PI * 0.85).strokePath();
    }
    gen('tree', 64, 96).clear();

    // Rock, feet at (24, 28).
    g.fillStyle(COLORS.rockShade).fillEllipse(24, 20, 40, 22);
    g.fillStyle(COLORS.rock).fillEllipse(22, 16, 34, 18);
    g.fillStyle(0xffffff, 0.6).fillEllipse(16, 12, 10, 4);
    g.lineStyle(1.5, COLORS.ink, 0.8).lineBetween(26, 12, 31, 20).lineBetween(31, 20, 29, 25);
    gen('rock', 48, 32).clear();

    // Blob monster, drawn light so a tint gives it its color. Feet at (24, 38).
    g.fillStyle(0xffffff).fillEllipse(24, 26, 44, 26);
    g.fillStyle(0xffffff).fillCircle(24, 22, 17);
    g.fillStyle(0xffffff, 0.9).fillEllipse(17, 15, 10, 6);
    g.fillStyle(0x2a1e2e).fillEllipse(18, 25, 4, 7).fillEllipse(30, 25, 4, 7);
    g.fillStyle(0xffffff).fillCircle(19, 23, 1.2).fillCircle(31, 23, 1.2);
    g.lineStyle(1.5, 0x2a1e2e).beginPath().arc(24, 30, 3, 0.2, Math.PI - 0.2).strokePath();
    gen('blob', 48, 40).clear();

    // Beetle: domed shell split down the middle, little legs. Feet at (24, 36).
    g.fillStyle(0x2a1e2e).fillRect(8, 30, 4, 7).fillRect(18, 32, 4, 6).fillRect(28, 32, 4, 6).fillRect(37, 30, 4, 7);
    g.fillStyle(0xffffff).fillEllipse(24, 23, 40, 26);
    g.fillStyle(0xdddddd).fillEllipse(24, 12, 22, 10);
    g.lineStyle(2, 0x2a1e2e, 0.7).lineBetween(24, 12, 24, 35);
    g.fillStyle(0xffffff, 0.8).fillEllipse(15, 18, 8, 5);
    g.fillStyle(0x2a1e2e).fillCircle(18, 11, 2.2).fillCircle(30, 11, 2.2);
    g.lineStyle(2, 0x2a1e2e).lineBetween(20, 6, 15, 1).lineBetween(28, 6, 33, 1);
    gen('beetle', 48, 40).clear();

    // Sprout: round body with a leaf on top. Feet at (24, 40).
    g.fillStyle(0xffffff).fillEllipse(24, 30, 36, 22);
    g.fillStyle(0xffffff).fillCircle(24, 26, 15);
    g.fillStyle(0x2f8a3a).fillEllipse(17, 8, 14, 7).fillEllipse(31, 8, 14, 7).fillRect(23, 8, 2, 8);
    g.fillStyle(0x2a1e2e).fillEllipse(19, 27, 3.5, 6).fillEllipse(29, 27, 3.5, 6);
    g.fillStyle(0xff9aa8, 0.6).fillCircle(15, 32, 2.5).fillCircle(33, 32, 2.5);
    gen('sprout', 48, 44).clear();

    // Boar: bulky body, snout and tusks, facing right. Feet at (28, 40).
    g.fillStyle(0x2a1e2e).fillRect(12, 32, 6, 9).fillRect(22, 33, 6, 8).fillRect(34, 33, 6, 8).fillRect(44, 32, 6, 9);
    g.fillStyle(0xffffff).fillEllipse(28, 22, 46, 26);
    g.fillStyle(0xdddddd).fillEllipse(24, 11, 32, 10);
    g.fillStyle(0xffffff).fillEllipse(48, 25, 16, 14);
    g.fillStyle(0xf1c7b8).fillEllipse(54, 27, 7, 8);
    g.fillStyle(0xfffbe8).fillTriangle(48, 30, 52, 30, 47, 22);
    g.fillStyle(0x2a1e2e).fillCircle(46, 20, 2.2).fillCircle(53.5, 26, 1).fillCircle(55.5, 28, 1);
    g.fillStyle(0x2a1e2e).fillTriangle(38, 10, 44, 13, 40, 4);
    gen('boar', 60, 44).clear();

    // Loot bag, tinted per item type.
    g.fillStyle(0xffffff).fillCircle(10, 11, 7).fillRect(7, 2, 6, 5);
    g.fillStyle(0xdddddd).fillRect(6, 5, 8, 2);
    g.fillStyle(0xffffff, 0.9).fillCircle(7, 9, 2);
    gen('drop', 20, 20).clear();

    // House block: an isometric cube whose neighbors merge into buildings. Ground center at (32, 56).
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
      gen(windows ? 'house-window' : 'house', 64, 72).clear();
    }

    // Cave wall block: same cube as a house, in dark stone with crystal glints.
    g.fillStyle(0x4a4552).fillPoints([V(0, 56), V(32, 72), V(32, 34), V(0, 18)], true);
    g.fillStyle(0x3d3945).fillPoints([V(32, 72), V(64, 56), V(64, 18), V(32, 34)], true);
    g.fillStyle(0x5e5868).fillPoints([V(0, 18), V(32, 2), V(64, 18), V(32, 34)], true);
    g.fillStyle(0x9fd8ff, 0.7).fillTriangle(14, 40, 18, 30, 21, 42).fillTriangle(44, 48, 47, 38, 51, 47);
    gen('cavewall', 64, 72).clear();

    // Wolf facing right. Feet at (28, 40).
    g.fillStyle(0x2a1e2e).fillRect(14, 30, 5, 10).fillRect(22, 31, 5, 9).fillRect(34, 31, 5, 9).fillRect(41, 30, 5, 10);
    g.fillStyle(0xffffff).fillEllipse(28, 24, 40, 18);
    g.fillStyle(0xdddddd).fillTriangle(6, 18, 12, 26, 2, 30);
    g.fillStyle(0xffffff).fillEllipse(46, 18, 18, 15).fillEllipse(55, 21, 10, 7);
    g.fillStyle(0xffffff).fillTriangle(40, 12, 45, 2, 48, 12).fillTriangle(47, 12, 52, 3, 54, 13);
    g.fillStyle(0x2a1e2e).fillCircle(49, 16, 1.8).fillCircle(59, 21, 1.6);
    gen('wolf', 60, 44).clear();

    // Mushroom: spotted cap on a stubby stalk. Feet at (24, 42).
    g.fillStyle(0xfff2e0).fillRoundedRect(16, 22, 16, 20, 6);
    g.fillStyle(0xffffff).fillEllipse(24, 18, 44, 26);
    g.fillStyle(0xf5f5f5, 1).fillCircle(14, 14, 3.5).fillCircle(28, 9, 3).fillCircle(34, 18, 3.5);
    g.fillStyle(0x2a1e2e).fillEllipse(20, 31, 3, 5).fillEllipse(28, 31, 3, 5);
    gen('mushroom', 48, 44).clear();

    // Bat: round body, two wings, hovering. Feet (shadow) at (28, 40).
    g.fillStyle(0xdddddd).fillTriangle(4, 10, 22, 16, 18, 28).fillTriangle(52, 10, 34, 16, 38, 28);
    g.fillStyle(0xffffff).fillCircle(28, 18, 10);
    g.fillStyle(0xffffff).fillTriangle(21, 10, 24, 2, 27, 10).fillTriangle(29, 10, 32, 2, 35, 10);
    g.fillStyle(0xff4a4a).fillCircle(24, 17, 1.8).fillCircle(32, 17, 1.8);
    gen('bat', 56, 44).clear();

    // Golem: blocky stone body with crystal shoulders. Feet at (28, 52).
    g.fillStyle(0x2a1e2e, 0.9).fillRect(15, 42, 9, 10).fillRect(32, 42, 9, 10);
    g.fillStyle(0xffffff).fillRoundedRect(10, 16, 36, 30, 6);
    g.fillStyle(0xdddddd).fillRoundedRect(17, 4, 22, 16, 5);
    g.fillStyle(0xdddddd).fillRoundedRect(2, 20, 10, 20, 4).fillRoundedRect(44, 20, 10, 20, 4);
    g.fillStyle(0xc9f0ff).fillTriangle(6, 20, 10, 8, 14, 20).fillTriangle(42, 20, 46, 8, 50, 20);
    g.fillStyle(0x7fe3ff).fillCircle(23, 11, 2.2).fillCircle(33, 11, 2.2);
    gen('golem', 56, 56).clear();

    // Crab: wide shell, two big claws, eyes on stalks. Feet at (28, 36).
    g.fillStyle(0x2a1e2e).fillRect(10, 28, 4, 8).fillRect(17, 30, 4, 7).fillRect(35, 30, 4, 7).fillRect(42, 28, 4, 8);
    g.fillStyle(0xffffff).fillEllipse(28, 24, 38, 20);
    g.fillStyle(0xdddddd).fillEllipse(28, 30, 30, 8);
    g.fillStyle(0xffffff).fillCircle(7, 16, 7).fillCircle(49, 16, 7);
    g.fillStyle(0xdddddd).fillTriangle(2, 10, 8, 14, 4, 18).fillTriangle(54, 10, 48, 14, 52, 18);
    g.fillStyle(0xffffff).fillRect(21, 8, 3, 9).fillRect(32, 8, 3, 9);
    g.fillStyle(0x2a1e2e).fillCircle(22.5, 8, 3).fillCircle(33.5, 8, 3);
    g.fillStyle(0xffffff).fillCircle(21.6, 7, 1).fillCircle(32.6, 7, 1);
    g.lineStyle(1.5, 0x2a1e2e).beginPath().arc(28, 25, 4, 0.3, Math.PI - 0.3).strokePath();
    gen('crab', 56, 40).clear();

    // Gull: round white body, wide wings, orange beak, hovering. Feet (shadow) at (28, 42).
    g.fillStyle(0xdddddd).fillTriangle(2, 8, 24, 18, 18, 26).fillTriangle(54, 8, 32, 18, 38, 26);
    g.fillStyle(0x9aa3b0).fillTriangle(2, 8, 8, 9, 6, 13).fillTriangle(54, 8, 48, 9, 50, 13);
    g.fillStyle(0xffffff).fillEllipse(28, 21, 22, 18);
    g.fillStyle(0xffb03a).fillTriangle(36, 19, 44, 21, 36, 23);
    g.fillStyle(0x2a1e2e).fillCircle(33, 17, 1.8);
    g.fillStyle(0xffb03a).fillRect(24, 29, 2, 4).fillRect(30, 29, 2, 4);
    gen('bird', 56, 44).clear();

    // Palm: a leaning ringed trunk with drooping fronds and coconuts. Feet at (30, 92).
    g.fillStyle(0xa8703f).fillPoints([V(26, 92), V(30, 50), V(38, 30), V(42, 31), V(36, 52), V(34, 92)], true);
    g.lineStyle(1.4, COLORS.ink, 0.6);
    for (const y of [84, 74, 64, 54, 44]) g.lineBetween(27 + (92 - y) * 0.18, y, 35 + (92 - y) * 0.15, y - 2);
    g.fillStyle(0x3fae4f);
    for (const [ax, ay] of [[4, 34], [14, 18], [40, 10], [62, 22], [64, 40], [22, 46]] as const) g.fillPoints([V(40, 28), V(ax, ay), V((40 + ax) / 2, (28 + ay) / 2 + 6)], true);
    g.fillStyle(0x56c45a);
    for (const [ax, ay] of [[10, 26], [52, 14], [60, 32]] as const) g.fillPoints([V(40, 28), V(ax, ay), V((40 + ax) / 2 + 3, (28 + ay) / 2 + 4)], true);
    g.fillStyle(0x7a4a2a).fillCircle(37, 33, 3.2).fillCircle(43, 34, 3.2);
    gen('palm', 68, 96).clear();

    // Sandstone ruin block, plain and with a carved sun glyph.
    for (const glyph of [false, true]) {
      g.fillStyle(0xe8c486).fillPoints([V(0, 56), V(32, 72), V(32, 34), V(0, 18)], true);
      g.fillStyle(0xcfa564).fillPoints([V(32, 72), V(64, 56), V(64, 18), V(32, 34)], true);
      g.fillStyle(0xf4dba4).fillPoints([V(0, 18), V(32, 2), V(64, 18), V(32, 34)], true);
      g.lineStyle(1.2, COLORS.ink, 0.5).lineBetween(0, 37, 32, 53).lineBetween(32, 53, 64, 37).lineBetween(16, 26, 16, 46).lineBetween(48, 45, 48, 26);
      if (glyph) {
        g.lineStyle(2, 0x8a5a2a, 0.9).strokeCircle(16, 46, 5);
        for (let a = 0; a < 8; a++) g.lineBetween(16 + Math.cos(a * 0.785) * 7, 46 + Math.sin(a * 0.785) * 7, 16 + Math.cos(a * 0.785) * 10, 46 + Math.sin(a * 0.785) * 10);
      }
      gen(glyph ? 'ruin-glyph' : 'ruin', 64, 72).clear();
    }

    // Scorpion: segmented body, pincers, a tail curling over with a stinger. Feet at (30, 36).
    g.fillStyle(0x2a1e2e).fillRect(14, 30, 3, 6).fillRect(20, 31, 3, 6).fillRect(36, 31, 3, 6).fillRect(42, 30, 3, 6);
    g.fillStyle(0xffffff).fillEllipse(28, 27, 32, 14);
    g.fillStyle(0xdddddd).fillCircle(46, 26, 6).fillCircle(54, 22, 5);
    g.fillStyle(0xffffff).fillCircle(10, 24, 4).fillCircle(6, 18, 4.5).fillCircle(9, 11, 4.5).fillCircle(16, 6, 4);
    g.fillStyle(0x2a1e2e).fillTriangle(18, 4, 24, 6, 19, 10);
    g.fillStyle(0xffffff).fillEllipse(58, 19, 9, 6);
    g.fillStyle(0x2a1e2e).fillCircle(34, 23, 1.6).fillCircle(39, 23, 1.6);
    gen('scorpion', 64, 40).clear();

    // Sandworm rising out of the ground, mouth open. Feet at (28, 54).
    g.fillStyle(0xdddddd).fillEllipse(28, 52, 44, 10);
    g.fillStyle(0xffffff).fillRoundedRect(14, 18, 28, 36, 12);
    g.lineStyle(2, 0x2a1e2e, 0.5).lineBetween(15, 30, 41, 30).lineBetween(15, 40, 41, 40);
    g.fillStyle(0xffffff).fillCircle(28, 16, 14);
    g.fillStyle(0x7a2a3a).fillEllipse(28, 12, 16, 10);
    g.fillStyle(0xfff6e0).fillTriangle(21, 9, 24, 9, 22.5, 14).fillTriangle(32, 9, 35, 9, 33.5, 14).fillTriangle(26.5, 7, 29.5, 7, 28, 12);
    gen('worm', 56, 58).clear();

    // Skeleton: skull, ribs and bony limbs, holding a rusty blade. Feet at (24, 54). Drawn in real colors.
    g.fillStyle(0xe8e2d0).fillRect(17, 42, 4, 12).fillRect(27, 42, 4, 12);
    g.fillStyle(0xe8e2d0).fillRect(22, 22, 4, 20);
    g.lineStyle(3, 0xe8e2d0);
    for (const y of [26, 31, 36]) g.lineBetween(15, y, 33, y);
    g.lineBetween(14, 24, 8, 38).lineBetween(34, 24, 40, 36);
    g.fillStyle(0x9aa3b0).fillRect(39, 20, 3, 18);
    g.fillStyle(0xf4efe0).fillCircle(24, 12, 10);
    g.fillStyle(0x2a1e2e).fillCircle(20, 12, 3).fillCircle(28, 12, 3).fillTriangle(23, 16, 25, 16, 24, 18);
    g.fillStyle(0xff5a3a).fillCircle(20, 12, 1).fillCircle(28, 12, 1);
    gen('skeleton', 48, 58).clear();

    // Mummy: a wrapped figure with arms out and glowing eyes. Feet at (24, 54).
    g.fillStyle(0xffffff).fillRoundedRect(14, 18, 20, 36, 6);
    g.fillStyle(0xffffff).fillRect(4, 24, 12, 6).fillRect(32, 24, 12, 6);
    g.fillStyle(0xffffff).fillCircle(24, 13, 10);
    g.lineStyle(1.4, 0x2a1e2e, 0.45);
    for (let y = 8; y < 54; y += 5) g.lineBetween(14, y + 2, 34, y - 1);
    g.fillStyle(0x2a1e2e).fillRect(17, 10, 14, 5);
    g.fillStyle(0xffe27a).fillCircle(21, 12.5, 1.6).fillCircle(27, 12.5, 1.6);
    gen('mummy', 48, 58).clear();

    // Pharaoh: a tall mummy king with a striped golden headdress. Feet at (32, 62). Drawn in real colors.
    g.fillStyle(0xe9dfc4).fillRoundedRect(18, 26, 28, 36, 8);
    g.fillStyle(0xe9dfc4).fillRect(4, 32, 16, 7).fillRect(44, 32, 16, 7);
    g.lineStyle(1.4, 0x2a1e2e, 0.4);
    for (let y = 30; y < 62; y += 5) g.lineBetween(18, y + 2, 46, y - 1);
    g.fillStyle(0x3a6fd8).fillRect(22, 40, 20, 5);
    g.fillStyle(0xffc83a).fillPoints([V(14, 30), V(20, 6), V(44, 6), V(50, 30), V(42, 26), V(22, 26)], true);
    g.fillStyle(0x3a6fd8);
    for (const x of [22, 30, 38]) g.fillRect(x, 8, 3, 18);
    g.fillStyle(0xd9b98a).fillCircle(32, 20, 9);
    g.fillStyle(0x2a1e2e).fillRect(25, 17, 14, 5);
    g.fillStyle(0xff3a3a).fillCircle(29, 19.5, 1.8).fillCircle(35, 19.5, 1.8);
    g.fillStyle(0xffc83a).fillTriangle(29, 6, 35, 6, 32, 0);
    gen('pharaoh', 64, 66).clear();

    // Notice board on two posts, with pinned papers. Feet at (24, 54).
    g.fillStyle(0x6b4a2e).fillRect(8, 22, 4, 32).fillRect(36, 22, 4, 32);
    g.fillStyle(0x9a6b42).fillRoundedRect(2, 6, 44, 28, 3);
    g.fillStyle(0xf4ead2).fillRect(7, 10, 11, 13).fillRect(21, 12, 10, 12).fillRect(34, 9, 8, 10);
    g.fillStyle(0xc9452f).fillCircle(12, 11, 1.5).fillCircle(26, 13, 1.5).fillCircle(38, 10, 1.5);
    gen('board', 48, 58).clear();

    // Portal swirl lying on the ground.
    g.fillStyle(0x6fd6ff, 0.35).fillEllipse(32, 16, 60, 28);
    g.lineStyle(3, 0xbff0ff, 0.9).strokeEllipse(32, 16, 46, 20);
    g.lineStyle(2, 0xffffff, 0.8).strokeEllipse(32, 16, 26, 11);
    gen('portal', 64, 32).clear();

    // Tile outline for hover and click markers.
    g.lineStyle(2, 0xffffff, 1).strokePoints(
      [new Phaser.Math.Vector2(32, 1), new Phaser.Math.Vector2(63, 16), new Phaser.Math.Vector2(32, 31), new Phaser.Math.Vector2(1, 16)],
      true,
    );
    gen('tile-outline', 64, 32).clear();

    g.destroy();

    // Color-manga pass: ink outlines on everything, screentone on round shapes.
    for (const key of ['blob', 'beetle', 'sprout', 'boar', 'wolf', 'mushroom', 'bat', 'golem', 'crab', 'bird', 'scorpion', 'worm', 'skeleton', 'mummy', 'pharaoh', 'tree', 'palm', 'rock']) {
      inkify(this, key, { outline: 2.5, tone: true });
    }
    for (const key of ['house', 'house-window', 'cavewall', 'ruin', 'ruin-glyph', 'board']) inkify(this, key, { outline: 2 });
    inkify(this, 'drop', { outline: 2 });
    makeBurstTexture(this);
  }
}
