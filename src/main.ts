import '@fontsource/bangers/latin-400.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import Phaser from 'phaser';
import { audio } from './audio/engine';
import { DPR } from './render/view';
import { installArtImages } from './render/art';
import { setupPwa, showUpdateBanner } from './pwa';
import type { SaveManager } from './save/manager';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';


// Phaser draws text onto canvases, so the web fonts must be ready before the first scene.
async function fontsReady(): Promise<void> {
  const loads = ['32px Bangers', '400 14px "Pixelify Sans"', '700 14px "Pixelify Sans"', '400 14px Silkscreen', '700 14px Silkscreen'].map((f) => document.fonts.load(f));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 3000))]);
}
await fontsReady();

// Every Text renders at the screen's pixel density, so lettering stays sharp.
installArtImages();
const addText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (this: Phaser.GameObjects.GameObjectFactory, x, y, text, style) {
  return addText.call(this, x, y, text, { resolution: DPR, ...style });
};

// Phaser asks for the next frame only after a frame finishes, so one uncaught error would freeze
// the game for good. Log it and carry on with the next frame instead.
const step = Phaser.Game.prototype.step;
const reported = new Set<string>();
Phaser.Game.prototype.step = function (this: Phaser.Game, time, delta) {
  try {
    step.call(this, time, delta);
  } catch (err) {
    // Normally cleared at the end of rendering; left set, scene changes would queue forever.
    (this.scene as { isProcessing: boolean }).isProcessing = false;
    const key = String(err);
    if (!reported.has(key)) {
      reported.add(key);
      console.error('Frame error (game keeps running):', err);
    }
  }
};

const parent = document.getElementById('game')!;
const physicalSize = () => ({ width: Math.round(parent.clientWidth * DPR), height: Math.round(parent.clientHeight * DPR) });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#fffaf0',
  pixelArt: false,
  // The canvas is sized in physical pixels and shown at CSS size (zoom 1/DPR); cameras zoom by DPR.
  scale: { mode: Phaser.Scale.NONE, ...physicalSize(), zoom: 1 / DPR },
  scene: [BootScene, TitleScene, WorldScene, UIScene],
});
new ResizeObserver(() => {
  const { width, height } = physicalSize();
  if (width > 0 && height > 0 && (width !== game.scale.width || height !== game.scale.height)) game.scale.resize(width, height);
}).observe(parent);

// Lets browser tests and the console reach the running game in development.
if (import.meta.env.DEV) Object.assign(window, { game, audio });

// When a new version is ready, offer it; the current session is saved before reloading.
setupPwa((apply) => {
  showUpdateBanner(async () => {
    const saves = game.registry.get('saves') as SaveManager | undefined;
    await saves?.save();
    apply();
  });
});
