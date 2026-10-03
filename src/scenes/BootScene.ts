import Phaser from 'phaser';
import { loadContent } from '../data/content';
import { SaveDb } from '../save/db';
import { audio } from '../audio/engine';
import { loadAudioSettings } from '../audio/settings';
import { loadQuality } from '../render/quality';
import { makeBurstTexture } from '../render/ink';
import { makeProps } from '../render/props';
import { makeFx } from '../render/fx';

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

  /** Pixel-art scenery, props and effects, plus the comic starburst used by sound effects. */
  private makeTextures(): void {
    makeProps(this);
    makeFx(this);
    makeBurstTexture(this);
  }
}
