import Phaser from 'phaser';
import { setupPwa, showUpdateBanner } from './pwa';
import type { SaveManager } from './save/manager';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2f5d3a',
  pixelArt: false,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, TitleScene, WorldScene, UIScene],
});

// Lets browser tests and the console reach the running game in development.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;

// When a new version is ready, offer it; the current session is saved before reloading.
setupPwa((apply) => {
  showUpdateBanner(async () => {
    const saves = game.registry.get('saves') as SaveManager | undefined;
    await saves?.save();
    apply();
  });
});
