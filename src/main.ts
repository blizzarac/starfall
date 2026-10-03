import '@fontsource/bangers/latin-400.css';
import '@fontsource/m-plus-rounded-1c/latin-500.css';
import '@fontsource/m-plus-rounded-1c/latin-800.css';
import Phaser from 'phaser';
import { setupPwa, showUpdateBanner } from './pwa';
import type { SaveManager } from './save/manager';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';


// Phaser draws text onto canvases, so the web fonts must be ready before the first scene.
async function fontsReady(): Promise<void> {
  const loads = ['32px Bangers', '500 14px "M PLUS Rounded 1c"', '800 14px "M PLUS Rounded 1c"'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 3000))]);
}
await fontsReady();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#fffaf0',
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
